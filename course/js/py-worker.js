/* Pyodide runs here, off the main thread, so a runaway loop can be killed. */
let pyodide = null;

async function init(base) {
  importScripts(base + 'pyodide.js');
  pyodide = await loadPyodide({ indexURL: base });
  const harness = await (await fetch(new URL('harness.py', self.location))).text();
  pyodide.runPython(harness);
}

self.onmessage = async (event) => {
  const { id, type, base, code, tests } = event.data;
  try {
    if (type === 'init') {
      await init(base);
      self.postMessage({ id, ok: true, version: pyodide.version });
      return;
    }
    const globals = pyodide.globals;
    globals.set('__code', code ?? '');
    globals.set('__tests', tests ?? '');
    const expr = type === 'lab' ? 'await run_lab(__code, __tests)' : 'await run_script(__code)';
    const json = await pyodide.runPythonAsync(expr);
    self.postMessage({ id, ok: true, result: JSON.parse(json) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err && err.message ? err.message : err) });
  }
};
