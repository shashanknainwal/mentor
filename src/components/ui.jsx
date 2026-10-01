import { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';

export function Button({ variant = '', size = '', icon: Icon, children, className = '', ...rest }) {
  const cls = ['btn', variant, size, !children && Icon ? 'icon' : '', className].filter(Boolean).join(' ');
  return (
    <button className={cls} {...rest}>
      {Icon && <Icon size={size === 'sm' ? 14 : 16} />}
      {children}
    </button>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && (e.stopPropagation(), onClose?.());
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <header>
          {title}
          <Button variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => {
        const id = typeof t === 'string' ? t : t.id;
        const label = typeof t === 'string' ? t : t.label;
        const Icon = t.icon;
        return (
          <button key={id} role="tab" aria-selected={value === id} className={value === id ? 'active' : ''} onClick={() => onChange(id)}>
            {Icon && <Icon size={15} />}
            {label}
            {t.count !== undefined && <span className="badge">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, label }) {
  return (
    <label className="row" style={{ cursor: 'pointer' }}>
      <span className="switch">
        <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
        <span />
      </span>
      {label && <span>{label}</span>}
    </label>
  );
}

export function Empty({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      {Icon && <Icon size={40} />}
      <h3>{title}</h3>
      <div>{children}</div>
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }) {
  return <Loader2 size={size} className="spin" />;
}

export function PageHead({ title, subtitle, children }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}

export function StatusDot({ status }) {
  const map = { online: 'green', ok: 'green', green: 'green', indexed: 'green', connecting: 'yellow', indexing: 'yellow', running: 'yellow', yellow: 'yellow', error: 'red', red: 'red', stopped: 'gray', disabled: 'gray', gray: 'gray' };
  return <span className={`dot ${map[status] || 'gray'}`} title={status} />;
}

export function Toasts() {
  const toasts = useApp((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

// Small data-loading hook: const [data, reload, loading, error] = useLoad('/api/x')
export function useLoad(path, deps = []) {
  const [state, setState] = useState({ data: null, loading: true, error: null });
  const load = async () => {
    if (!path) return;
    setState((s) => ({ ...s, loading: true }));
    try {
      setState({ data: await api.get(path), loading: false, error: null });
    } catch (e) {
      setState({ data: null, loading: false, error: e.message });
    }
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, ...deps]);
  return [state.data, load, state.loading, state.error];
}

export function fmtTime(ts) {
  if (!ts) return '—';
  const d = new Date(ts * 1000);
  const now = new Date();
  const same = d.toDateString() === now.toDateString();
  return same ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function fmtBytes(n = 0) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function useAsync() {
  const toast = useApp((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMsg) toast(okMsg, 'success');
      return r;
    } catch (e) {
      toast(e.message || String(e), 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  };
  return [run, busy];
}

export function downloadJson(name, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = true;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}
