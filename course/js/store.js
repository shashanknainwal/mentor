// Progress lives in localStorage. Export/import lets you move it between browsers.
const KEY = 'agentic-playbook:v1';

const blank = () => ({ labs: {}, quizzes: {}, done: {}, drafts: {}, checklist: {}, notes: {}, last: null, theme: null });

let state = load();
const subs = new Set();

function load() {
  try {
    return { ...blank(), ...(JSON.parse(localStorage.getItem(KEY)) || {}) };
  } catch {
    return blank();
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode: progress is session-only */ }
  subs.forEach((fn) => fn(state));
}

export const store = {
  get: () => state,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  update(fn) { fn(state); save(); },
  exportJSON: () => JSON.stringify(state, null, 2),
  importJSON(text) { state = { ...blank(), ...JSON.parse(text) }; save(); },
  reset() { state = blank(); save(); },
};
