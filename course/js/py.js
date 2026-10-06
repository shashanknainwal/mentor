// Main-thread client for the Pyodide worker: lazy start, timeouts, hard stop.
import { CONFIG } from './config.js';

let worker = null;
let readyPromise = null;
let seq = 0;
const pending = new Map();
const listeners = new Set();
export let status = 'idle'; // idle | loading | ready | busy | error

function setStatus(s, detail) {
  status = s;
  listeners.forEach((fn) => fn(s, detail));
}

export function onStatus(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

function post(msg) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...msg, id });
  });
}

function spawn() {
  worker = new Worker(new URL('./py-worker.js', import.meta.url));
  worker.onmessage = (e) => {
    const { id, ok, error, ...rest } = e.data;
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    ok ? p.resolve(rest) : p.reject(new Error(error));
  };
  worker.onerror = (e) => {
    setStatus('error', e.message);
  };
  setStatus('loading');
  readyPromise = post({ type: 'init', base: CONFIG.pyodideBase })
    .then((r) => { setStatus('ready', r.version); return r; })
    .catch((err) => { setStatus('error', err.message); readyPromise = null; throw err; });
  return readyPromise;
}

export function ensureReady() {
  if (readyPromise) return readyPromise;
  return spawn();
}

export function stop() {
  if (!worker) return;
  worker.terminate();
  worker = null;
  readyPromise = null;
  for (const [, p] of pending) p.reject(new Error('Stopped. Python restarted.'));
  pending.clear();
  setStatus('idle');
}

async function run(msg, timeoutMs) {
  await ensureReady();
  setStatus('busy');
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      stop();
      reject(new Error(`Timed out after ${timeoutMs / 1000}s. Python was restarted (infinite loop?).`));
    }, timeoutMs);
  });
  try {
    const r = await Promise.race([post(msg), timeout]);
    return r.result;
  } finally {
    clearTimeout(timer);
    if (worker) setStatus('ready');
  }
}

export const runScript = (code, timeoutMs = 15000) => run({ type: 'script', code }, timeoutMs);
export const runLab = (code, tests, timeoutMs = 20000) => run({ type: 'lab', code, tests }, timeoutMs);
