import { useState } from 'react';
import { Cloud, Plug, Plus, Power, RefreshCw, Trash2, Wrench, FileJson, Search } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, StatusDot, Tabs, useAsync, useLoad } from '../components/ui.jsx';

function AddServer({ onClose, onDone }) {
  const [mode, setMode] = useState('registry');
  const [registry] = useLoad('/api/mcp/registry');
  const [pick, setPick] = useState(null);
  const [params, setParams] = useState({});
  const [form, setForm] = useState({ name: '', transport: 'stdio', command: 'npx', args: '', url: '', env: '', headers: '' });
  const [json, setJson] = useState('');
  const [cmd, setCmd] = useState('');
  const [run, busy] = useAsync();

  const submit = () => run(async () => {
    let res;
    if (mode === 'registry') res = await api.post('/api/mcp/servers', { name: pick.name, registry: pick.name, params, config: {} });
    else if (mode === 'command') res = await api.post('/api/mcp/install', { command: cmd, params });
    else if (mode === 'json') res = await api.post('/api/mcp/import', { json });
    else {
      const kv = (txt) => Object.fromEntries(txt.split('\n').filter((l) => l.includes('=')).map((l) => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()]));
      const config = form.transport === 'stdio'
        ? { command: form.command, args: form.args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, '')) || [], env: kv(form.env) }
        : { url: form.url, transport: form.transport, headers: kv(form.headers) };
      res = await api.post('/api/mcp/servers', { name: form.name, config });
    }
    onDone(res);
  });

  return (
    <Modal wide title="Add MCP server" onClose={onClose} footer={<Button variant="primary" disabled={busy} onClick={submit}>{busy ? <><Spinner /> Connecting…</> : 'Add & connect'}</Button>}>
      <Tabs value={mode} onChange={setMode} tabs={[{ id: 'registry', label: 'Setup wizard' }, { id: 'command', label: 'Install command' }, { id: 'manual', label: 'Manual' }, { id: 'json', label: 'Paste JSON' }]} />
      {mode === 'registry' && (
        <div className="grid cols-3">
          {(registry || []).map((r) => (
            <div key={r.name} className="card hover" style={pick?.name === r.name ? { borderColor: 'var(--kpmg-light)' } : {}} onClick={() => { setPick(r); setParams({}); }}>
              <div className="row"><h3 className="grow" style={{ margin: 0 }}>{r.name}</h3>{r.installed && <span className="badge green">added</span>}</div>
              <div className="desc">{r.description}</div>
            </div>
          ))}
          {pick?.params?.length > 0 && (
            <div style={{ gridColumn: '1 / -1' }}>
              {pick.params.map((p) => <Field key={p} label={p}><input className="input" type={/token|secret|key/i.test(p) ? 'password' : 'text'} value={params[p] || ''} onChange={(e) => setParams({ ...params, [p]: e.target.value })} /></Field>)}
            </div>
          )}
        </div>
      )}
      {mode === 'command' && (
        <>
          <Field label="Command" hint="install slack · aim mcp install <pkg> · mcp-registry install <pkg> · toolbox install <pkg> · uvx <pkg> · npx <pkg>">
            <input className="input mono" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="uvx mcp-server-time" />
          </Field>
          <div className="faint small">Tip: you can also paste these straight into chat — Mentor will install and connect the server for you.</div>
        </>
      )}
      {mode === 'manual' && (
        <>
          <div className="grid cols-2">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="kpmg-data" /></Field>
            <Field label="Transport">
              <select className="select" value={form.transport} onChange={(e) => setForm({ ...form, transport: e.target.value })}>
                <option value="stdio">stdio (local process)</option><option value="http">Streamable HTTP (remote)</option><option value="sse">SSE (legacy remote)</option>
              </select>
            </Field>
          </div>
          {form.transport === 'stdio' ? (
            <>
              <div className="grid cols-2">
                <Field label="Command"><input className="input mono" value={form.command} onChange={(e) => setForm({ ...form, command: e.target.value })} /></Field>
                <Field label="Arguments"><input className="input mono" value={form.args} onChange={(e) => setForm({ ...form, args: e.target.value })} placeholder='-y @modelcontextprotocol/server-filesystem "C:/work"' /></Field>
              </div>
              <Field label="Environment (KEY=value per line)"><textarea className="textarea mono" value={form.env} onChange={(e) => setForm({ ...form, env: e.target.value })} /></Field>
            </>
          ) : (
            <>
              <Field label="URL"><input className="input mono" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://mcp.example.com/mcp" /></Field>
              <Field label="Headers (Name=value per line)" hint="e.g. Authorization=Bearer …"><textarea className="textarea mono" value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} /></Field>
            </>
          )}
        </>
      )}
      {mode === 'json' && (
        <Field label='Paste a config — {"mcpServers": {...}} (Claude Desktop / VS Code format)'>
          <textarea className="textarea mono" style={{ minHeight: 240 }} value={json} onChange={(e) => setJson(e.target.value)} />
        </Field>
      )}
    </Modal>
  );
}

function Servers() {
  const [servers, reload, loading] = useLoad('/api/mcp/servers');
  const [adding, setAdding] = useState(false);
  const [expanded, setExpanded] = useState(null);
  const [run, busy] = useAsync();
  const toast = useApp((s) => s.toast);
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Button variant="primary" icon={Plus} onClick={() => setAdding(true)}>Add server</Button>
        <Button icon={RefreshCw} onClick={reload}>Refresh</Button>
        {(loading || busy) && <Spinner />}
      </div>
      {servers?.length ? servers.map((s) => (
        <div key={s.name} className="card" style={{ marginBottom: 10 }}>
          <div className="row">
            <StatusDot status={s.status} />
            <strong>{s.name}</strong>
            <span className="badge">{s.transport}</span>
            <span className="muted small">{s.status}{s.tools.length ? ` · ${s.tools.length} tools` : ''}</span>
            <span style={{ flex: 1 }} />
            {s.tools.length > 0 && <Button size="sm" variant="ghost" icon={Wrench} onClick={() => setExpanded(expanded === s.name ? null : s.name)}>Tools</Button>}
            <Button size="sm" icon={RefreshCw} title="Restart" onClick={() => run(async () => { await api.post(`/api/mcp/servers/${s.name}/restart`); reload(); })} />
            <Button size="sm" icon={Power} title={s.status === 'disabled' ? 'Enable' : 'Disable'} onClick={() => run(async () => { await api.post(`/api/mcp/servers/${s.name}/enabled`, { enabled: s.status === 'disabled' }); reload(); })} />
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm(`Remove ${s.name}?`) && run(async () => { await api.del(`/api/mcp/servers/${s.name}`); reload(); })} />
          </div>
          {s.error && <div className="error-part" style={{ marginTop: 8 }}>{s.error}</div>}
          {expanded === s.name && (
            <table className="table" style={{ marginTop: 8 }}>
              <tbody>{s.tools.map((t) => <tr key={t.name}><td className="mono">{t.name}</td><td className="small muted">{t.description}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      )) : !loading && (
        <Empty icon={Plug} title="No MCP servers connected" action={<Button variant="primary" onClick={() => setAdding(true)}>Run the setup wizard</Button>}>
          MCP lets Mentor plug into data sources and tools — SharePoint, databases, Slack, internal APIs. Built-in tools work without any setup.
        </Empty>
      )}
      {adding && <AddServer onClose={() => setAdding(false)} onDone={(res) => { setAdding(false); reload(); toast(res?.status === 'online' ? `${res.name} connected — ${res.tools.length} tools` : res?.added ? `Imported ${res.added.length} server(s)` : `Added ${res?.name || ''}: ${res?.error || res?.status || ''}`, res?.error ? 'error' : 'success'); }} />}
    </>
  );
}

function ToolsCatalog() {
  const [tools] = useLoad('/api/tools');
  const [cloud] = useLoad('/api/cloud-tools');
  const [q, setQ] = useState('');
  if (!tools || !cloud) return <Spinner />;
  const cats = cloud.reduce((acc, t) => ((acc[t.category] ||= []).push(t), acc), {});
  const match = (t) => !q || `${t.name} ${t.description}`.toLowerCase().includes(q.toLowerCase());
  return (
    <>
      <div className="row" style={{ marginBottom: 12 }}>
        <Search size={16} /><input className="input" style={{ maxWidth: 360 }} placeholder="Search tools…" value={q} onChange={(e) => setQ(e.target.value)} />
        <span className="muted small">{tools.builtin.length} built-in + {tools.mcp.length} from integrations = {tools.total} capabilities</span>
      </div>
      <div className="section-title">Cloud Tools catalog</div>
      {Object.entries(cats).map(([c, list]) => (
        <div key={c} style={{ marginBottom: 12 }}>
          <div className="faint small" style={{ marginBottom: 6 }}>{c}</div>
          <div className="grid cards">{list.filter(match).map((t) => <div key={t.name} className="card"><div className="row"><Cloud size={15} /><h3 style={{ margin: 0 }}>{t.name}</h3></div><div className="desc">{t.description}</div><div className="faint small mono" style={{ marginTop: 6 }}>{t.builtin}</div></div>)}</div>
        </div>
      ))}
      <div className="section-title">All tools</div>
      <table className="table">
        <thead><tr><th>Tool</th><th>Source</th><th>Category</th><th>Risk</th><th>Description</th></tr></thead>
        <tbody>{[...tools.builtin, ...tools.mcp].filter(match).map((t) => <tr key={t.name}><td className="mono">{t.name}</td><td>{t.source}</td><td>{t.category}</td><td><span className={`badge ${t.risk === 'high' ? 'amber' : t.risk === 'medium' ? 'blue' : ''}`}>{t.risk}</span></td><td className="small muted">{t.description}</td></tr>)}</tbody>
      </table>
    </>
  );
}

function RawConfig() {
  const [cfg, reload] = useLoad('/api/mcp/config');
  const [text, setText] = useState(null);
  const [run, busy] = useAsync();
  if (!cfg) return <Spinner />;
  const value = text ?? JSON.stringify(cfg, null, 2);
  return (
    <>
      <div className="faint small" style={{ marginBottom: 8 }}>Stored at ~/MentorDesktop/mcp.json. Same format as Claude Desktop.</div>
      <textarea className="textarea mono" style={{ minHeight: 380 }} value={value} onChange={(e) => setText(e.target.value)} />
      <Button variant="primary" disabled={busy || text === null} style={{ marginTop: 8 }} onClick={() => run(async () => { await api.put('/api/mcp/config', JSON.parse(value)); setText(null); reload(); }, 'Saved and reconnected')}>Save & reconnect all</Button>
    </>
  );
}

export default function Integrations() {
  const [tab, setTab] = useState('servers');
  return (
    <div className="page">
      <PageHead title="Integrations" subtitle="MCP tool servers connected to Mentor, plus the catalog of tools the AI can use." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'servers', label: 'Servers', icon: Plug }, { id: 'tools', label: 'Tools', icon: Wrench }, { id: 'config', label: 'mcp.json', icon: FileJson }]} />
      {tab === 'servers' && <Servers />}
      {tab === 'tools' && <ToolsCatalog />}
      {tab === 'config' && <RawConfig />}
    </div>
  );
}
