#!/usr/bin/env node
// Browser smoke test: loads the site, passes a lab with its solution, runs the playground.
// Needs Playwright plus local copies of Pyodide and CodeMirror 5 (npm i pyodide@0.26.4 codemirror@5.65.16):
//   PYODIDE_DIR=.../node_modules/pyodide CM_DIR=.../node_modules/codemirror node scripts/e2e.mjs
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { LESSONS } from '../js/content/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { PYODIDE_DIR, CM_DIR } = process.env;
if (!PYODIDE_DIR || !CM_DIR) { console.error('Set PYODIDE_DIR and CM_DIR'); process.exit(2); }
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.json': 'application/json', '.py': 'text/plain', '.zip': 'application/zip' };

const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = p.startsWith('/pyodide/') ? join(PYODIDE_DIR, p.slice(9)) : join(root, p === '/' ? 'index.html' : p);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
await ctx.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/codemirror\/[^/]+\/(.*)$/, async (route) => {
  const rel = route.request().url().match(/codemirror\/[^/]+\/(.*)$/)[1].replace('.min.', '.');
  const f = rel.startsWith('codemirror.') ? join(CM_DIR, 'lib', rel) : join(CM_DIR, rel);
  try { await route.fulfill({ body: await readFile(f), contentType: TYPES[extname(f)] }); } catch { await route.abort(); }
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/fonts|ERR_FAILED/.test(m.text())) errors.push(m.text()); });

const step = (name) => console.log('•', name);
let failed = false;
const expect = (cond, msg) => { if (!cond) { failed = true; console.error('  ✗', msg); } else console.log('  ✓', msg); };

step('home renders');
await page.goto(`${base}/?pyodide=/pyodide/#/`);
await page.waitForSelector('.module-card');
expect((await page.locator('.module-card').count()) === 7, '7 module cards');
expect((await page.locator('.side-lesson').count()) === LESSONS.length, `${LESSONS.length} lessons in sidebar`);
await page.screenshot({ path: join(process.env.SHOTS || '/tmp', 'home.png') });

step('every lesson tab renders without errors');
for (const l of LESSONS) {
  for (const tab of ['learn', 'quiz', 'ship']) {
    await page.goto(`${base}/#/l/${l.id}/${tab}`);
    await page.waitForSelector('#tabBody > *');
  }
}
expect(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);

step('lab: solution passes in Pyodide');
const lesson = LESSONS[0];
await page.goto(`${base}/#/l/${lesson.id}/learn`);
await page.screenshot({ path: join(process.env.SHOTS || '/tmp', 'learn.png'), fullPage: false });
await page.goto(`${base}/#/l/${lesson.id}/build`);
await page.waitForSelector('.CodeMirror');
expect(true, 'CodeMirror editor mounted');
const lab = page.locator('.lab').first();
await lab.locator('[data-act="test"]').click();
await lab.locator('.result-head').waitFor({ timeout: 120000 });
expect(/fail|load/i.test(await lab.locator('.result-head').innerText()), 'starter fails tests');
page.once('dialog', (d) => d.accept());
await lab.locator('[data-act="solution"]').click();
await lab.locator('[data-act="load-solution"]').click();
await lab.locator('[data-act="test"]').click();
await page.waitForFunction(() => /All tests pass/.test(document.querySelector('.lab .result-head')?.innerText || ''), null, { timeout: 60000 });
expect(true, 'solution passes all tests');
await page.screenshot({ path: join(process.env.SHOTS || '/tmp', 'lab.png'), fullPage: false });
await lab.locator('[data-act="run"]').click();
await page.waitForFunction(() => /Ran/.test(document.querySelector('.lab .result-head')?.innerText || ''), null, { timeout: 30000 });
expect(/blocked/.test(await lab.locator('.output').innerText()), 'Run executes __main__ demo');

step('every lab solution passes inside Pyodide');
const pyResults = await page.evaluate(async () => {
  const py = await import('/js/py.js');
  const { LESSONS } = await import('/js/content/index.js');
  const out = [];
  for (const l of LESSONS) {
    for (const lab of l.labs) {
      try {
        const r = await py.runLab(lab.solution, lab.tests, 60000);
        out.push({ id: lab.id, ok: r.ok, passed: r.passed, total: r.total, err: r.load_error || r.tests.filter((t) => !t.passed).map((t) => `${t.name}: ${t.error}`).join('; ') });
      } catch (e) {
        out.push({ id: lab.id, ok: false, err: String(e) });
      }
    }
  }
  return out;
});
for (const r of pyResults) if (!r.ok) console.error(`    ${r.id}: ${r.passed}/${r.total} ${r.err}`);
expect(pyResults.every((r) => r.ok), `${pyResults.filter((r) => r.ok).length}/${pyResults.length} solutions pass in Pyodide`);

step('progress persisted');
await page.reload();
await page.waitForSelector('.lab');
expect((await page.locator('.lab [data-role="status"]').first().innerText()).includes('passed'), 'lab marked passed after reload');

step('playground with top-level await + infinite-loop stop');
await page.goto(`${base}/#/playground`);
await page.waitForSelector('.CodeMirror');
await page.click('#pgRun');
await page.waitForFunction(() => /search/.test(document.querySelector('.output')?.innerText || ''), null, { timeout: 30000 });
expect(true, 'async playground output');

step('mobile layout');
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(`${base}/#/l/l01/learn`);
await page.waitForSelector('.flow');
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
expect(!overflow, 'no horizontal scroll at 390px');
await page.screenshot({ path: join(process.env.SHOTS || '/tmp', 'mobile.png') });

expect(errors.length === 0, `no page errors overall (${errors.slice(0, 3).join(' | ')})`);
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
