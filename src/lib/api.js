// REST client for the Python engine.
// In Electron the engine URL comes from the main process (random free port);
// in the browser (npm run web) requests go through Vite's /api proxy.

let baseUrl = null;

export async function engineBase() {
  if (baseUrl !== null) return baseUrl;
  if (window.mentor?.engineUrl) {
    baseUrl = (await window.mentor.engineUrl()) || '';
  } else {
    baseUrl = import.meta.env.VITE_ENGINE_URL || '';
  }
  return baseUrl;
}

export async function wsUrl(path) {
  const base = await engineBase();
  if (base) return base.replace(/^http/, 'ws') + path;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}

export async function fileUrl(path) {
  return `${await engineBase()}/api/file?path=${encodeURIComponent(path)}`;
}

export async function artifactUrl(id, download = false) {
  return `${await engineBase()}/api/artifacts/${id}/file${download ? '?download=true' : ''}`;
}

async function request(method, path, body, opts = {}) {
  const base = await engineBase();
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(base + path, init);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail || detail;
    } catch {
      /* not json */
    }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  if (opts.text) return res.text();
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}

export const api = {
  get: (p, opts) => request('GET', p, undefined, opts),
  post: (p, b) => request('POST', p, b ?? {}),
  put: (p, b) => request('PUT', p, b),
  patch: (p, b) => request('PATCH', p, b),
  del: (p) => request('DELETE', p),
  upload: (p, file, field = 'file') => {
    const fd = new FormData();
    fd.append(field, file);
    return request('POST', p, fd);
  },
};

export const qs = (params) =>
  '?' +
  Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
