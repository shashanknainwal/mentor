// Runtime config. Override the Pyodide location with ?pyodide=<url> (saved for the session).
const DEFAULT_PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

function pyodideBase() {
  try {
    const q = new URLSearchParams(location.search).get('pyodide');
    if (q) sessionStorage.setItem('pyodideBase', q);
    return sessionStorage.getItem('pyodideBase') || DEFAULT_PYODIDE;
  } catch {
    return DEFAULT_PYODIDE;
  }
}

export const CONFIG = {
  pyodideBase: pyodideBase().replace(/\/?$/, '/'),
  title: 'Agentic AI Playbook',
};
