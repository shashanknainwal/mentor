import { MODULES, LESSONS, lessonById } from './content/index.js';
import { md, inline } from './md.js';
import { store } from './store.js';
import * as py from './py.js';
import { createEditor } from './editor.js';

const $ = (sel, el = document) => el.querySelector(sel);
const main = $('#main');
const sidebar = $('#sidebar');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const TABS = [
  ['learn', 'Learn'],
  ['build', 'Build'],
  ['quiz', 'Quiz'],
  ['ship', 'Ship'],
];

// ---------- progress helpers ----------
function lessonProgress(lesson) {
  const s = store.get();
  const labs = lesson.labs || [];
  const labsPassed = labs.filter((l) => s.labs[l.id]?.passed).length;
  const quiz = s.quizzes[lesson.id];
  const quizDone = !!quiz && quiz.answered === (lesson.quiz || []).length;
  const units = labs.length + 1;
  const doneUnits = labsPassed + (quizDone ? 1 : 0);
  const done = !!s.done[lesson.id] || doneUnits === units;
  return { labsPassed, labsTotal: labs.length, quizDone, quiz, done, pct: done ? 1 : doneUnits / units };
}

function courseProgress() {
  const done = LESSONS.filter((l) => lessonProgress(l).done).length;
  const labsTotal = LESSONS.reduce((n, l) => n + (l.labs?.length || 0), 0);
  const labsPassed = LESSONS.reduce((n, l) => n + lessonProgress(l).labsPassed, 0);
  return { done, total: LESSONS.length, labsPassed, labsTotal, pct: LESSONS.length ? done / LESSONS.length : 0 };
}

function checkMark(lesson) {
  const p = lessonProgress(lesson);
  if (p.done) return '<span class="check done" aria-label="complete">✓</span>';
  if (p.pct > 0) return '<span class="check partial" aria-label="in progress">•</span>';
  return '<span class="check" aria-label="not started"></span>';
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------- shell ----------
function renderSidebar(route) {
  const currentId = route.view === 'lesson' ? route.id : null;
  sidebar.innerHTML = `
    <a class="side-link ${route.view === 'home' ? 'active' : ''}" href="#/">⌂ Course home</a>
    <a class="side-link ${route.view === 'playground' ? 'active' : ''}" href="#/playground">▶ Python playground</a>
    <a class="side-link ${route.view === 'progress' ? 'active' : ''}" href="#/progress">◎ Progress & data</a>
    ${MODULES.map((m) => {
      const done = m.lessons.filter((l) => lessonProgress(l).done).length;
      return `
      <div class="side-module">
        <div class="side-module-head"><span>M${m.num} · ${esc(m.title)}</span><span>${done}/${m.lessons.length}</span></div>
        ${m.lessons.map((l) => `
          <a class="side-lesson ${l.id === currentId ? 'active' : ''}" href="#/l/${l.id}">
            ${checkMark(l)}<span><span class="muted">${l.num}.</span> ${esc(l.title)}</span>
          </a>`).join('')}
      </div>`;
    }).join('')}
  `;
  const cp = courseProgress();
  $('#progressPill').textContent = `${cp.done}/${cp.total} lessons · ${Math.round(cp.pct * 100)}%`;
}

py.onStatus((s, detail) => {
  const el = $('#pyStatus');
  const labels = { idle: 'Python idle', loading: 'Loading Python…', ready: 'Python ready', busy: 'Running…', error: 'Python failed' };
  el.querySelector('.dot').className = `dot ${s}`;
  el.querySelector('.txt').textContent = labels[s] || s;
  el.title = s === 'error' ? `Could not load Pyodide: ${detail}` : 'In-browser Python (Pyodide)';
});

const themeBtn = $('#themeBtn');
const paintThemeBtn = () => {
  const dark = (document.documentElement.dataset.theme || 'dark') === 'dark';
  themeBtn.textContent = dark ? '☀' : '☾';
  themeBtn.title = dark ? 'Switch to light theme' : 'Switch to dark theme';
};
paintThemeBtn();
themeBtn.addEventListener('click', () => {
  const next = (document.documentElement.dataset.theme || 'dark') === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  store.update((s) => { s.theme = next; });
  paintThemeBtn();
});
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) document.body.classList.remove('nav-open'); });

// ---------- router ----------
function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'l' && lessonById(parts[1])) return { view: 'lesson', id: parts[1], tab: TABS.some((t) => t[0] === parts[2]) ? parts[2] : 'learn' };
  if (parts[0] === 'playground') return { view: 'playground' };
  if (parts[0] === 'progress') return { view: 'progress' };
  return { view: 'home' };
}

let cleanup = [];
function render() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
  const route = parseRoute();
  renderSidebar(route);
  if (route.view === 'lesson') renderLesson(route);
  else if (route.view === 'playground') renderPlayground();
  else if (route.view === 'progress') renderProgress();
  else renderHome();
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', render);

// ---------- home ----------
function nextUp() {
  const s = store.get();
  if (s.last && lessonById(s.last.id) && !lessonProgress(lessonById(s.last.id)).done) return s.last;
  const l = LESSONS.find((x) => !lessonProgress(x).done);
  return l ? { id: l.id, tab: 'learn' } : null;
}

function renderHome() {
  const cp = courseProgress();
  const up = nextUp();
  const upLesson = up && lessonById(up.id);
  main.innerHTML = `
  <div class="page">
    <section class="hero">
      <div class="eyebrow">Personal course · ${LESSONS.length} lessons · ${MODULES.length} modules</div>
      <h1>Build <span class="grad">production AI agents</span>, one runnable lesson at a time.</h1>
      <p class="lede">Each lesson pairs the concepts with labs you code and test right here in the browser. Python runs locally on your machine through Pyodide, so there is nothing to install.</p>
    </section>

    ${upLesson ? `
    <div class="card continue">
      <div>
        <div class="eyebrow">${cp.done ? 'Continue' : 'Start here'}</div>
        <h3 style="margin:4px 0 2px">Lesson ${upLesson.num}: ${esc(upLesson.title)}</h3>
        <div class="muted">${esc(upLesson.module.title)} · ~${upLesson.minutes} min · ${upLesson.labs.length} lab${upLesson.labs.length === 1 ? '' : 's'}</div>
      </div>
      <a class="btn primary" href="#/l/${upLesson.id}/${up.tab || 'learn'}">${cp.done ? 'Resume' : 'Start lesson 1'} →</a>
    </div>` : `<div class="callout ok"><b>Course complete.</b> Every lesson is done. Revisit any lab to practise again.</div>`}

    <div class="stats">
      <div class="stat"><b>${cp.done}/${cp.total}</b><span>lessons complete</span></div>
      <div class="stat"><b>${cp.labsPassed}/${cp.labsTotal}</b><span>labs passing</span></div>
      <div class="stat"><b>${Math.round(cp.pct * 100)}%</b><span>course progress</span></div>
      <div class="stat"><b>~${Math.round(LESSONS.reduce((n, l) => n + l.minutes, 0) / 60)}h</b><span>total hands-on time</span></div>
    </div>

    <h2>The path</h2>
    <div class="grid grid-2">
      ${MODULES.map((m) => {
        const done = m.lessons.filter((l) => lessonProgress(l).done).length;
        return `
        <div class="card module-card">
          <div class="eyebrow">Module ${m.num}</div>
          <h3>${esc(m.title)}</h3>
          <div class="muted" style="font-size:14px">${esc(m.blurb)}</div>
          <div class="progress"><span style="width:${(done / m.lessons.length) * 100}%"></span></div>
          <ol>${m.lessons.map((l) => `<li><a href="#/l/${l.id}">${checkMark(l)}<span><span class="muted">${l.num}.</span> ${esc(l.title)}</span></a></li>`).join('')}</ol>
        </div>`;
      }).join('')}
    </div>

    <h2>How each lesson works</h2>
    <div class="grid grid-2 how">
      <div class="card"><h3>1 · Learn</h3><p class="muted">The problem, the request flow, core concepts, tradeoffs and real examples. About 10 minutes.</p></div>
      <div class="card"><h3>2 · Build</h3><p class="muted">Implement the core component in the browser editor and run the tests until they are green. <span class="kbd">Ctrl/⌘ + Enter</span> runs tests.</p></div>
      <div class="card"><h3>3 · Quiz</h3><p class="muted">Three questions that check the <em>why</em>, not trivia. Each answer explains itself.</p></div>
      <div class="card"><h3>4 · Ship</h3><p class="muted">Run the full Dockerized reference project locally, tick the production checklist, and keep notes.</p></div>
    </div>
    <footer class="foot">Progress is saved in this browser. Back it up from <a href="#/progress">Progress & data</a>.</footer>
  </div>`;
}

// ---------- lesson ----------
function renderLesson({ id, tab }) {
  const lesson = lessonById(id);
  store.update((s) => { s.last = { id, tab }; });
  const p = lessonProgress(lesson);
  const idx = LESSONS.indexOf(lesson);
  const prev = LESSONS[idx - 1];
  const next = LESSONS[idx + 1];
  const tabState = {
    build: p.labsTotal && p.labsPassed === p.labsTotal,
    quiz: p.quizDone,
    ship: !!store.get().done[id],
  };
  main.innerHTML = `
  <div class="page">
    <div class="lesson-head">
      <div class="eyebrow">Module ${lesson.module.num} · ${esc(lesson.module.title)}</div>
      <h1>Lesson ${lesson.num}: ${esc(lesson.title)}</h1>
      <p class="lede" style="margin:0">${inline(lesson.tagline)}</p>
      <div class="lesson-meta">
        <span class="tag">⏱ ~${lesson.minutes} min</span>
        <span class="tag ${p.labsPassed === p.labsTotal && p.labsTotal ? 'ok' : ''}">🧪 ${p.labsPassed}/${p.labsTotal} labs</span>
        <span class="tag ${p.quizDone ? 'ok' : ''}">❓ quiz ${p.quizDone ? `${p.quiz.correct}/${lesson.quiz.length}` : 'not taken'}</span>
        ${p.done ? '<span class="tag ok">✓ complete</span>' : ''}
        <a class="tag" href="${lesson.repo}" target="_blank" rel="noopener">↗ reference code</a>
      </div>
    </div>
    <nav class="tabs" role="tablist">
      ${TABS.map(([k, label], i) => `<a role="tab" class="tab ${k === tab ? 'active' : ''}" href="#/l/${id}/${k}"><span class="n">${i + 1}</span>${label}${tabState[k] ? ' <span class="tick">✓</span>' : ''}</a>`).join('')}
    </nav>
    <div id="tabBody"></div>
  </div>`;
  const body = $('#tabBody');
  if (tab === 'learn') renderLearn(body, lesson, prev, next);
  if (tab === 'build') renderBuild(body, lesson);
  if (tab === 'quiz') renderQuiz(body, lesson);
  if (tab === 'ship') renderShip(body, lesson, next);
}

function nextBanner(label, title, href, cta = 'Go') {
  return `<div class="card next-banner"><div><div class="label">${label}</div><b>${title}</b></div><a class="btn primary" href="${href}">${cta} →</a></div>`;
}

function renderLearn(body, lesson, prev) {
  body.innerHTML = `
    ${md(lesson.summary)}
    <h2>What you'll build</h2>
    <ul class="list-ok">${lesson.build.map((b) => `<li>${inline(b)}</li>`).join('')}</ul>
    <h2>Why it exists</h2>
    <div class="callout">${md(lesson.problem)}</div>
    <h2>Request flow</h2>
    <div class="flow">${lesson.flow.map(([t, d], i) => `<div class="flow-step"><span class="i">${i + 1}</span><b>${inline(t)}</b><span>${inline(d)}</span></div>`).join('')}</div>
    ${prev ? `<p class="muted" style="font-size:14px">Builds on <a href="#/l/${prev.id}">Lesson ${prev.num}: ${esc(prev.title)}</a>.</p>` : ''}
    <h2>Core concepts</h2>
    <div class="grid grid-2">${lesson.concepts.map(([t, d]) => `<div class="card concept"><h3>${inline(t)}</h3><p>${inline(d)}</p></div>`).join('')}</div>
    <h2>Key insights</h2>
    <ul>${lesson.insights.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>
    <h2>Common mistakes</h2>
    <ul class="list-bad">${lesson.pitfalls.map((x) => `<li>${inline(x)}</li>`).join('')}</ul>
    <h2>In the real world</h2>
    <div class="grid grid-2">${lesson.examples.map(([t, d]) => `<div class="card concept"><h3>${inline(t)}</h3><p>${inline(d)}</p></div>`).join('')}</div>
    ${lesson.extra ? md(lesson.extra) : ''}
    ${nextBanner('Next action', `Build: ${esc(lesson.labs[0].title)} (~${lesson.labs[0].minutes} min)`, `#/l/${lesson.id}/build`, 'Open the lab')}
  `;
}

function renderResult(out, r, kind) {
  if (kind === 'script') {
    out.innerHTML = `
      <div class="result-head ${r.ok ? 'ok' : 'bad'}">${r.ok ? '▶ Ran' : '✗ Error'} <span class="muted" style="font-weight:400">${r.ms} ms</span></div>
      ${r.stdout ? `<pre>${esc(r.stdout)}</pre>` : r.ok ? '<pre>(no output: add print() calls)</pre>' : ''}
      ${r.error ? `<div class="err"><pre>${esc(r.error)}</pre></div>` : ''}`;
    return;
  }
  if (r.load_error) {
    out.innerHTML = `<div class="result-head bad">✗ Your code failed to load</div><div class="err"><pre>${esc(r.load_error)}</pre></div>${r.stdout ? `<pre>${esc(r.stdout)}</pre>` : ''}`;
    return;
  }
  out.innerHTML = `
    <div class="result-head ${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓ All tests pass' : '✗ Some tests fail'} · ${r.passed}/${r.total}</div>
    ${r.tests.map((t) => `<div class="test ${t.passed ? 'pass' : 'fail'}"><span class="m">${t.passed ? '✓' : '✗'}</span><span>${esc(t.label)}</span>${t.error ? `<pre>${esc(t.error)}</pre>` : ''}</div>`).join('')}
    ${r.stdout ? `<details style="margin-top:8px"><summary class="muted">printed output</summary><pre>${esc(r.stdout)}</pre></details>` : ''}`;
}

function renderBuild(body, lesson) {
  const s = store.get();
  body.innerHTML = `
    <div class="callout"><b>How labs work:</b> edit the code, press <b>Run tests</b> (<span class="kbd">Ctrl/⌘ + Enter</span>). Drafts save automatically. The first run downloads Python (~10 MB, cached afterwards).</div>
    ${lesson.labs.map((lab, i) => `
    <section class="lab" data-lab="${lab.id}">
      <div class="lab-head">
        <div>
          <div class="eyebrow">Lab ${i + 1} of ${lesson.labs.length} · ~${lab.minutes} min</div>
          <h2>${esc(lab.title)}</h2>
        </div>
        <span class="tag ${s.labs[lab.id]?.passed ? 'ok' : ''}" data-role="status">${s.labs[lab.id]?.passed ? '✓ passed' : 'not passed yet'}</span>
      </div>
      <p>${inline(lab.goal)}</p>
      <ol class="lab-steps">${lab.steps.map((x) => `<li>${inline(x)}</li>`).join('')}</ol>
      <div class="editor-wrap">
        <div class="editor-bar">
          <span class="file">solution.py</span>
          <div class="row">
            <button class="btn small ghost" data-act="hint">💡 Hint <span data-role="hintn"></span></button>
            <button class="btn small ghost" data-act="reset">↺ Reset</button>
            <button class="btn small ghost" data-act="solution">👁 Solution</button>
            <button class="btn small" data-act="run">▶ Run</button>
            <button class="btn small primary" data-act="test">✓ Run tests</button>
            <button class="btn small ghost" data-act="stop" hidden>■ Stop</button>
          </div>
        </div>
        <div class="editor-host"></div>
        <div class="output" aria-live="polite"></div>
      </div>
      <div class="hints"></div>
      <div class="solution" hidden></div>
    </section>`).join('')}
    <div id="buildNext"></div>
  `;

  const updateNext = () => {
    const p = lessonProgress(lesson);
    $('#buildNext').innerHTML = p.labsPassed === p.labsTotal
      ? nextBanner('All labs passing', 'Next: lock it in with the 3-question quiz', `#/l/${lesson.id}/quiz`, 'Take the quiz')
      : `<p class="muted" style="margin-top:20px">${p.labsPassed}/${p.labsTotal} labs passing. Next: make the tests above go green.</p>`;
  };
  updateNext();

  lesson.labs.forEach((lab) => {
    const section = body.querySelector(`[data-lab="${lab.id}"]`);
    const out = $('.output', section);
    const draft = store.get().drafts[lab.id];
    const editor = createEditor($('.editor-host', section), draft ?? lab.starter.trimStart(), {
      onChange: (code) => store.update((st) => { st.drafts[lab.id] = code; }),
      onRunTests: () => act('test'),
    });
    cleanup.push(() => editor.destroy());
    let hintsShown = 0;
    const hintBtn = $('[data-act="hint"]', section);
    const updHintBtn = () => {
      $('[data-role="hintn"]', section).textContent = `${hintsShown}/${lab.hints.length}`;
      hintBtn.disabled = hintsShown >= lab.hints.length;
    };
    updHintBtn();

    const setBusy = (busy) => {
      section.querySelectorAll('[data-act="run"],[data-act="test"]').forEach((b) => { b.disabled = busy; });
      $('[data-act="stop"]', section).hidden = !busy;
    };

    async function act(kind) {
      if (kind === 'hint') {
        if (hintsShown >= lab.hints.length) return;
        $('.hints', section).insertAdjacentHTML('beforeend', `<div class="callout warn hint"><b>Hint ${hintsShown + 1}:</b> ${inline(lab.hints[hintsShown])}</div>`);
        hintsShown++;
        updHintBtn();
        return;
      }
      if (kind === 'reset') {
        if (!confirm('Replace your code with the starter? Your draft will be lost.')) return;
        editor.setValue(lab.starter.trimStart());
        out.innerHTML = '';
        return;
      }
      if (kind === 'solution') {
        const sol = $('.solution', section);
        if (sol.hidden) {
          sol.innerHTML = `<div class="callout warn">Try a hint first. Reading the solution before attempting it teaches a lot less. <button class="btn small" data-act="load-solution">Load into editor</button></div><pre class="code"><code>${esc(lab.solution.trim())}</code></pre>`;
          $('[data-act="load-solution"]', sol).onclick = () => {
            if (confirm('Overwrite your editor with the reference solution?')) editor.setValue(lab.solution.trimStart());
          };
        }
        sol.hidden = !sol.hidden;
        return;
      }
      if (kind === 'stop') { py.stop(); return; }
      setBusy(true);
      out.innerHTML = `<div class="muted">${py.status === 'ready' ? 'Running…' : 'Starting Python (first run takes a few seconds)…'}</div>`;
      try {
        if (kind === 'run') {
          renderResult(out, await py.runScript(editor.getValue()), 'script');
        } else {
          const r = await py.runLab(editor.getValue(), lab.tests);
          renderResult(out, r, 'lab');
          const was = store.get().labs[lab.id]?.passed;
          if (r.ok) {
            store.update((st) => { st.labs[lab.id] = { passed: true, at: Date.now() }; });
            const tag = $('[data-role="status"]', section);
            tag.textContent = '✓ passed';
            tag.classList.add('ok');
            if (!was) toast(`Lab passed: ${lab.title} ✓`);
            renderSidebar(parseRoute());
            updateNext();
          }
        }
      } catch (err) {
        out.innerHTML = `<div class="result-head bad">✗ ${esc(err.message)}</div>${py.status === 'error' || /pyodide|load/i.test(err.message) ? '<p class="muted">Python could not load. Check your connection (Pyodide is served from cdn.jsdelivr.net), then try again.</p>' : ''}`;
      } finally {
        setBusy(false);
      }
    }
    section.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (b && b.dataset.act !== 'load-solution') act(b.dataset.act);
    });
  });
  py.ensureReady().catch(() => {});
}

function renderQuiz(body, lesson) {
  const saved = store.get().quizzes[lesson.id]?.answers || {};
  const answers = { ...saved };
  const draw = () => {
    const answered = Object.keys(answers).length;
    const correct = lesson.quiz.filter((q, i) => answers[i] === q.answer).length;
    body.innerHTML = `
      ${lesson.quiz.map((q, i) => {
        const a = answers[i];
        const locked = a !== undefined;
        return `
        <div class="card q">
          <h3>${i + 1}. ${inline(q.q)}</h3>
          ${q.options.map((o, j) => {
            let cls = '';
            if (locked && j === q.answer) cls = 'right';
            else if (locked && j === a) cls = 'wrong';
            return `<button class="opt ${cls}" data-q="${i}" data-o="${j}" ${locked ? 'disabled' : ''}>${inline(o)}</button>`;
          }).join('')}
          ${locked ? `<div class="why"><b>${a === q.answer ? '✓ Correct.' : '✗ Not quite.'}</b> ${inline(q.why)}</div>` : ''}
        </div>`;
      }).join('')}
      <div class="row" style="justify-content:space-between">
        <span class="muted">${answered}/${lesson.quiz.length} answered · ${correct} correct</span>
        ${answered ? '<button class="btn small ghost" id="retry">↺ Retry quiz</button>' : ''}
      </div>
      ${answered === lesson.quiz.length ? nextBanner(`Quiz done · ${correct}/${lesson.quiz.length}`, 'Next: run the real project and tick the production checklist', `#/l/${lesson.id}/ship`, 'Ship it') : ''}
    `;
    body.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      answers[b.dataset.q] = +b.dataset.o;
      const ans = Object.keys(answers).length;
      const cor = lesson.quiz.filter((q, i) => answers[i] === q.answer).length;
      store.update((s) => { s.quizzes[lesson.id] = { answers: { ...answers }, answered: ans, correct: cor }; });
      if (ans === lesson.quiz.length) { renderSidebar(parseRoute()); toast(`Quiz complete: ${cor}/${lesson.quiz.length}`); }
      draw();
    }));
    const retry = $('#retry');
    if (retry) retry.onclick = () => {
      Object.keys(answers).forEach((k) => delete answers[k]);
      store.update((s) => { delete s.quizzes[lesson.id]; });
      renderSidebar(parseRoute());
      draw();
    };
  };
  draw();
}

function renderShip(body, lesson, next) {
  const s = store.get();
  const dir = lesson.repo.split('/').slice(-2).join('/');
  const repoRoot = lesson.repo.split('/tree/')[0];
  const checks = s.checklist[lesson.id] || {};
  const done = !!s.done[lesson.id];
  body.innerHTML = `
    <h2 style="margin-top:0">Run the reference project</h2>
    <p class="muted">The full Dockerized service (FastAPI, dashboard, tests) lives in the reference repo. About 10 minutes, with Docker installed.</p>
    <pre class="code"><code>git clone ${esc(repoRoot)}.git
cd ${esc(repoRoot.split('/').pop())}/${esc(dir)}
./start.sh        # build and start the container + dashboard
./demo.sh         # drive demo traffic; dashboard metrics should leave zero
./run_tests.sh    # pytest + smoke checks
./cleanup.sh      # stop and remove containers/images</code></pre>
    <p><a href="${lesson.repo}" target="_blank" rel="noopener">↗ Open ${esc(dir)} on GitHub</a></p>

    <h2>Production checklist</h2>
    <div class="card">
      ${lesson.checklist.map((c, i) => `<label class="checkline"><input type="checkbox" data-i="${i}" ${checks[i] ? 'checked' : ''}/><span>${inline(c)}</span></label>`).join('')}
    </div>

    <h2>My notes</h2>
    <textarea class="notes" id="notes" placeholder="What surprised you? What would you change in production? Saved automatically.">${esc(s.notes[lesson.id] || '')}</textarea>

    <div class="card next-banner">
      <div><div class="label">${done ? 'Lesson complete' : 'Finish'}</div><b>${done ? `Lesson ${lesson.num} is marked complete ✓` : 'Mark this lesson complete'}</b></div>
      <div class="row">
        <button class="btn ${done ? 'ghost' : 'ok'}" id="markDone">${done ? 'Unmark' : '✓ Mark complete'}</button>
        ${next ? `<a class="btn primary" href="#/l/${next.id}">Next: Lesson ${next.num} →</a>` : '<a class="btn primary" href="#/">Course home →</a>'}
      </div>
    </div>`;
  body.querySelectorAll('.checkline input').forEach((cb) => cb.addEventListener('change', () => {
    store.update((st) => { (st.checklist[lesson.id] ||= {})[cb.dataset.i] = cb.checked; });
  }));
  let t;
  $('#notes').addEventListener('input', (e) => {
    clearTimeout(t);
    t = setTimeout(() => store.update((st) => { st.notes[lesson.id] = e.target.value; }), 300);
  });
  $('#markDone').onclick = () => {
    store.update((st) => { st.done[lesson.id] = !done; if (done) delete st.done[lesson.id]; });
    if (!done) toast(`Lesson ${lesson.num} complete ✓`);
    render();
  };
}

// ---------- playground ----------
const PLAYGROUND_DEFAULT = `# Scratchpad: stdlib Python runs here (Pyodide). Top-level await works.
import asyncio, json, re

async def tool(name, delay):
    await asyncio.sleep(delay)
    return {"tool": name, "ms": int(delay * 1000)}

results = await asyncio.gather(tool("search", 0.2), tool("lookup", 0.1))
print(json.dumps(results, indent=2))
`;

function renderPlayground() {
  main.innerHTML = `
  <div class="page">
    <div class="eyebrow">Sandbox</div>
    <h1>Python playground</h1>
    <p class="lede">Try ideas from any lesson. Standard library only. Code is saved in this browser.</p>
    <div class="editor-wrap">
      <div class="editor-bar"><span class="file">scratch.py</span>
        <div class="row"><button class="btn small ghost" id="pgReset">↺ Reset</button><button class="btn small ghost" id="pgStop" hidden>■ Stop</button><button class="btn small primary" id="pgRun">▶ Run</button></div>
      </div>
      <div class="editor-host"></div>
      <div class="output"></div>
    </div>
  </div>`;
  const out = $('.output', main);
  const ed = createEditor($('.editor-host', main), store.get().drafts.__playground ?? PLAYGROUND_DEFAULT, {
    onChange: (c) => store.update((s) => { s.drafts.__playground = c; }),
    onRunTests: () => run(),
  });
  cleanup.push(() => ed.destroy());
  async function run() {
    $('#pgRun').disabled = true;
    $('#pgStop').hidden = false;
    out.innerHTML = '<div class="muted">Running…</div>';
    try { renderResult(out, await py.runScript(ed.getValue()), 'script'); }
    catch (err) { out.innerHTML = `<div class="result-head bad">✗ ${esc(err.message)}</div>`; }
    finally { $('#pgRun').disabled = false; $('#pgStop').hidden = true; }
  }
  $('#pgRun').onclick = run;
  $('#pgStop').onclick = () => py.stop();
  $('#pgReset').onclick = () => ed.setValue(PLAYGROUND_DEFAULT);
  py.ensureReady().catch(() => {});
}

// ---------- progress & data ----------
function renderProgress() {
  const cp = courseProgress();
  main.innerHTML = `
  <div class="page">
    <div class="eyebrow">Your data</div>
    <h1>Progress & data</h1>
    <div class="stats">
      <div class="stat"><b>${cp.done}/${cp.total}</b><span>lessons</span></div>
      <div class="stat"><b>${cp.labsPassed}/${cp.labsTotal}</b><span>labs</span></div>
      <div class="stat"><b>${Object.keys(store.get().quizzes).length}</b><span>quizzes taken</span></div>
      <div class="stat"><b>${Object.values(store.get().notes).filter(Boolean).length}</b><span>lessons with notes</span></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Lesson</th><th>Labs</th><th>Quiz</th><th>Status</th></tr></thead>
      <tbody>${LESSONS.map((l) => { const p = lessonProgress(l); return `<tr><td><a href="#/l/${l.id}">${l.num}. ${esc(l.title)}</a></td><td>${p.labsPassed}/${p.labsTotal}</td><td>${p.quizDone ? `${p.quiz.correct}/${l.quiz.length}` : '–'}</td><td>${p.done ? '<span class="tag ok">✓ done</span>' : p.pct ? 'in progress' : '–'}</td></tr>`; }).join('')}</tbody>
    </table></div>
    <h2>Backup</h2>
    <p class="muted">Progress, drafts and notes live in this browser's localStorage. Export them to move to another device.</p>
    <div class="row">
      <button class="btn" id="exp">⤓ Export JSON</button>
      <label class="btn">⤒ Import JSON<input type="file" accept="application/json" id="imp" hidden /></label>
      <button class="btn ghost" id="rst" style="color:var(--bad)">Reset all progress</button>
    </div>
  </div>`;
  $('#exp').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.exportJSON()], { type: 'application/json' }));
    a.download = `agentic-playbook-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };
  $('#imp').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { store.importJSON(await f.text()); toast('Progress imported ✓'); render(); }
    catch { alert('That file is not a valid progress export.'); }
  };
  $('#rst').onclick = () => { if (confirm('Delete ALL progress, drafts and notes in this browser?')) { store.reset(); render(); } };
}

render();
