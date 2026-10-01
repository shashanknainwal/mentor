import { useEffect, useRef, useState } from 'react';
import { Activity, Bug, Copy, Download, FileJson, Radio, Trash2, Wrench } from 'lucide-react';
import { api, wsUrl } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Spinner, Tabs, fmtTime, useAsync, useLoad, PageHead } from '../components/ui.jsx';

function useEventStream() {
  const [events, setEvents] = useState([]);
  const [backend, setBackend] = useState([]);
  const [traces, setTraces] = useState([]);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let ws;
    let closed = false;
    (async () => {
      const [e, b, t] = await Promise.all([api.get('/api/diagnostics/events'), api.get('/api/diagnostics/backend'), api.get('/api/diagnostics/traces')]).catch(() => [[], [], []]);
      setEvents(e.slice(-500));
      setBackend(b.slice(-500));
      setTraces(t);
      if (closed) return;
      ws = new WebSocket(await wsUrl('/ws/events'));
      ws.onopen = () => setConnected(true);
      ws.onclose = () => setConnected(false);
      ws.onmessage = (m) => {
        const msg = JSON.parse(m.data);
        if (msg.stream === 'event') setEvents((x) => [...x.slice(-499), msg.event]);
        else if (msg.stream === 'backend') setBackend((x) => [...x.slice(-499), msg.event]);
        else if (msg.stream === 'trace') setTraces((x) => [msg.trace, ...x.filter((t) => t.id !== msg.trace.id)].slice(0, 200));
      };
    })();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);
  return { events, setEvents, backend, traces, connected };
}

function EventLog({ events, onClear }) {
  const end = useRef(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'end' }), [events.length]);
  const describe = (e) => {
    switch (e.kind) {
      case 'tool_call': return `→ ${e.tool} ${JSON.stringify(e.input).slice(0, 200)}`;
      case 'tool_result': return `← ${e.tool} ${e.ok ? 'ok' : 'FAILED'} (${e.duration}s) ${String(e.result).slice(0, 200)}`;
      case 'agent_step': return `✓ turn complete · ${e.tools_used} tools · ${e.duration}s · ${e.usage?.input_tokens ?? 0}+${e.usage?.output_tokens ?? 0} tokens`;
      default: return `${e.kind} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k]) => !['id', 'ts', 'kind', 'level'].includes(k)))).slice(0, 240)}`;
    }
  };
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="row" style={{ padding: 8 }}><span className="faint small grow">Captures while this panel is open.</span><Button size="sm" icon={Trash2} onClick={onClear}>Clear</Button></div>
      <div style={{ maxHeight: '62vh', overflow: 'auto' }}>
        {events.map((e) => (
          <div key={e.id} className={`log-line ${e.level === 'error' || e.kind === 'error' || e.ok === false ? 'error' : ''}`}>
            <span className="ts">{new Date(e.ts * 1000).toLocaleTimeString()}</span><span>{describe(e)}</span>
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

function ToolsTab() {
  const [tools] = useLoad('/api/tools');
  if (!tools) return <Spinner />;
  return (
    <>
      <p><strong>{tools.builtin.length}</strong> built-in + <strong>{tools.mcp.length}</strong> from integrations = <strong>{tools.total}</strong> total capabilities</p>
      <div className="grid cols-2">
        {[['Built-in tools', tools.builtin], ['MCP tools', tools.mcp]].map(([title, list]) => (
          <div key={title} className="card">
            <h3>{title}</h3>
            {list.length ? list.map((t) => <div key={t.name} className="small" style={{ marginBottom: 4 }}><span className="mono">{t.name}</span> <span className="faint">— {t.description.slice(0, 80)}</span></div>) : <div className="faint small">None connected.</div>}
          </div>
        ))}
      </div>
    </>
  );
}

function ActivityTab({ traces }) {
  const [scope, setScope] = useState('recent');
  const [open, setOpen] = useState(null);
  const { active, focused } = useApp();
  const sid = active[focused];
  const list = scope === 'session' ? traces.filter((t) => t.session_id === sid) : traces;
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Button size="sm" variant={scope === 'recent' ? 'primary' : ''} onClick={() => setScope('recent')}>Recent</Button>
        <Button size="sm" variant={scope === 'session' ? 'primary' : ''} onClick={() => setScope('session')}>Current session</Button>
      </div>
      {!list.length && <div className="faint">No activity yet{scope === 'session' ? ' in this session' : ''}. Send a chat message first.</div>}
      {list.map((t) => (
        <div key={t.id} className="card" style={{ marginBottom: 8, padding: 10 }}>
          <div className="row" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === t.id ? null : t.id)}>
            <span className={`dot ${t.status === 'ok' ? 'green' : t.status === 'error' ? 'red' : 'yellow'}`} />
            <strong className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.message}</strong>
            {t.agent && <span className="badge">{t.agent}</span>}
            <span className="faint small">{t.steps.filter((s) => s.kind === 'tool').length} tools · {t.ended ? `${(t.ended - t.started).toFixed(1)}s` : 'running…'}</span>
            <span className="faint small">{fmtTime(t.started)}</span>
          </div>
          {open === t.id && (
            <div style={{ marginTop: 8 }}>
              {t.steps.map((s, i) => (
                <div key={i} className="log-line" style={{ border: 0 }}>
                  <span className="ts">+{(s.ts - t.started).toFixed(2)}s</span>
                  <span>
                    {s.kind === 'context' && `Built context (${s.chars.toLocaleString()} chars, ${s.citations} citations)`}
                    {s.kind === 'model_call' && `Model call #${s.step + 1} (${s.messages} messages)`}
                    {s.kind === 'model_result' && `Model → ${s.stop_reason} in ${s.duration}s · ${s.usage?.input_tokens ?? '?'} in / ${s.usage?.output_tokens ?? '?'} out${s.text ? ` · “${s.text.slice(0, 120)}”` : ''}`}
                    {s.kind === 'tool' && <>{s.ok ? '✓' : '✗'} <span className="mono">{s.tool}</span> ({s.duration}s) {JSON.stringify(s.input).slice(0, 120)} → {String(s.result).slice(0, 160)}</>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function ConfigTab() {
  const [cfg] = useLoad('/api/config');
  const toast = useApp((s) => s.toast);
  if (!cfg) return <Spinner />;
  const text = JSON.stringify(cfg, null, 2);
  return (
    <>
      <Button size="sm" icon={Copy} onClick={() => { navigator.clipboard.writeText(text); toast('Config copied', 'success'); }} style={{ marginBottom: 8 }}>Copy</Button>
      <pre className="code-block">{text}</pre>
    </>
  );
}

export default function Diagnostics() {
  const [tab, setTab] = useState('log');
  const { events, setEvents, backend, traces, connected } = useEventStream();
  const { settings, saveSettings, toast } = useApp();
  const [run, busy] = useAsync();
  const debug = settings?.debug;
  return (
    <div className="page">
      <PageHead title="Diagnostics" subtitle="Debug Console — live tool calls, step-by-step traces, backend events and configuration.">
        <span className={`badge ${connected ? 'green' : 'red'}`}><Radio size={11} /> {connected ? 'live' : 'disconnected'}</span>
        <Button variant={debug ? 'primary' : ''} icon={Bug} onClick={() => saveSettings({ debug: !debug })}>Debug {debug ? 'ON' : 'OFF'}</Button>
        <Button icon={Download} disabled={busy} onClick={() => run(async () => { const r = await api.post('/api/diagnostics/bundle'); toast(`Support bundle saved: ${r.path}`, 'success'); window.mentor?.showItemInFolder?.(r.path); })}>Export support bundle</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'log', label: 'Event Log', icon: Radio }, { id: 'tools', label: 'Tools', icon: Wrench }, { id: 'activity', label: 'Activity Log', icon: Activity }, { id: 'events', label: 'Events', icon: Bug }, { id: 'config', label: 'Config', icon: FileJson }]} />
      {tab === 'log' && <EventLog events={events} onClear={() => setEvents([])} />}
      {tab === 'tools' && <ToolsTab />}
      {tab === 'activity' && <ActivityTab traces={traces} />}
      {tab === 'events' && (
        <div className="card" style={{ padding: 0, maxHeight: '64vh', overflow: 'auto' }}>
          {backend.map((b, i) => <div key={i} className={`log-line ${b.level === 'ERROR' ? 'error' : ''}`}><span className="ts">{new Date(b.ts * 1000).toLocaleTimeString()}</span><span className="faint">{b.level}</span><span className="faint">{b.logger}</span><span>{b.message}</span></div>)}
        </div>
      )}
      {tab === 'config' && <ConfigTab />}
    </div>
  );
}
