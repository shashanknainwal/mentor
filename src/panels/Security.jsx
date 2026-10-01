import { useState } from 'react';
import { ShieldCheck, Terminal, ListChecks, ScrollText } from 'lucide-react';
import { useApp } from '../lib/store.js';
import { Button, Field, PageHead, Spinner, Tabs, fmtTime, useLoad } from '../components/ui.jsx';

function ExecSafety() {
  const { settings, saveSettings, toast } = useApp();
  const sec = settings?.security;
  const [allow, setAllow] = useState(null);
  const [deny, setDeny] = useState(null);
  if (!sec) return <Spinner />;
  return (
    <div className="grid cols-2">
      <div className="card">
        <h3>Command execution</h3>
        {[
          ['disabled', 'Disabled', 'The AI can never run shell commands or Python.'],
          ['ask', 'Ask (recommended)', 'Allow-listed commands run; everything else asks you first.'],
          ['allowlist', 'Allow-list only', 'Only allow-listed commands run; others are blocked without asking.'],
        ].map(([v, l, d]) => (
          <label key={v} className="row" style={{ alignItems: 'flex-start', marginBottom: 10, cursor: 'pointer' }}>
            <input type="radio" name="exec" checked={sec.exec_mode === v} onChange={() => saveSettings({ security: { exec_mode: v } })} />
            <span><strong>{l}</strong><br /><span className="muted small">{d}</span></span>
          </label>
        ))}
      </div>
      <div className="card">
        <Field label="Allow-list (one command prefix per line)">
          <textarea className="textarea mono" value={allow ?? sec.exec_allowlist.join('\n')} onChange={(e) => setAllow(e.target.value)} />
        </Field>
        <Field label="Always blocked (substring match)">
          <textarea className="textarea mono" value={deny ?? sec.exec_denylist.join('\n')} onChange={(e) => setDeny(e.target.value)} />
        </Field>
        <Button variant="primary" disabled={allow === null && deny === null} onClick={async () => {
          await saveSettings({ security: { exec_allowlist: (allow ?? sec.exec_allowlist.join('\n')).split('\n').filter(Boolean), exec_denylist: (deny ?? sec.exec_denylist.join('\n')).split('\n').filter(Boolean) } });
          setAllow(null); setDeny(null); toast('Saved', 'success');
        }}>Save lists</Button>
      </div>
    </div>
  );
}

function Approvals() {
  const { settings, saveSettings } = useApp();
  const [tools] = useLoad('/api/tools');
  const sec = settings?.security;
  if (!sec || !tools) return <Spinner />;
  const overrides = sec.tool_overrides || {};
  const setOverride = (name, v) => {
    const next = { ...overrides };
    if (v === 'default') delete next[name];
    else next[name] = v;
    // send full map so deletions persist
    saveSettings({ security: { tool_overrides: next } });
  };
  const effective = (t) => {
    if (overrides[t.name]) return overrides[t.name];
    if (t.risk === 'low' || sec.approval_mode === 'never_ask') return 'allow';
    if (sec.approval_mode === 'always_ask') return 'ask';
    return t.risk === 'high' ? 'ask' : 'allow';
  };
  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <h3>Default policy</h3>
        <div className="row wrap">
          {[['ask_risky', 'Ask for high-risk tools (recommended)'], ['always_ask', 'Ask for anything that changes something'], ['never_ask', 'Never ask (exec safety still applies)']].map(([v, l]) => (
            <label key={v} className="row" style={{ cursor: 'pointer', marginRight: 16 }}>
              <input type="radio" name="appr" checked={sec.approval_mode === v} onChange={() => saveSettings({ security: { approval_mode: v } })} /> {l}
            </label>
          ))}
        </div>
      </div>
      <table className="table">
        <thead><tr><th>Tool</th><th>Source</th><th>Risk</th><th>Effective</th><th>Override</th></tr></thead>
        <tbody>
          {[...tools.builtin, ...tools.mcp].map((t) => (
            <tr key={t.name}>
              <td className="mono">{t.name}</td><td className="small">{t.source}</td>
              <td><span className={`badge ${t.risk === 'high' ? 'amber' : t.risk === 'medium' ? 'blue' : ''}`}>{t.risk}</span></td>
              <td><span className={`badge ${effective(t) === 'deny' ? 'red' : effective(t) === 'ask' ? 'amber' : 'green'}`}>{effective(t)}</span></td>
              <td>
                <select className="select" style={{ width: 120 }} value={overrides[t.name] || 'default'} onChange={(e) => setOverride(t.name, e.target.value)}>
                  <option value="default">default</option><option value="allow">allow</option><option value="ask">ask</option><option value="deny">deny</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function Audit() {
  const [log, reload] = useLoad('/api/security/audit');
  if (!log) return <Spinner />;
  return (
    <>
      <Button size="sm" onClick={reload} style={{ marginBottom: 10 }}>Refresh</Button>
      <table className="table">
        <thead><tr><th>When</th><th>Tool</th><th>Decision</th><th>Arguments</th></tr></thead>
        <tbody>{log.map((l) => <tr key={l.id}><td className="small">{fmtTime(l.ts)}</td><td className="mono">{l.tool}</td><td><span className={`badge ${/denied|rejected/.test(l.decision) ? 'red' : 'green'}`}>{l.decision}</span></td><td className="mono small">{JSON.stringify(l.args).slice(0, 160)}</td></tr>)}</tbody>
      </table>
    </>
  );
}

export default function Security() {
  const [tab, setTab] = useState('approvals');
  return (
    <div className="page">
      <PageHead title="Security" subtitle="Control what the AI may do on your machine. Folder read/write grants live in Settings › Directories." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'approvals', label: 'Tool approvals', icon: ListChecks }, { id: 'exec', label: 'Exec safety', icon: Terminal }, { id: 'audit', label: 'Audit log', icon: ScrollText }]} />
      {tab === 'approvals' && <Approvals />}
      {tab === 'exec' && <ExecSafety />}
      {tab === 'audit' && <Audit />}
      <div className="faint small" style={{ marginTop: 16 }}><ShieldCheck size={12} /> Approvals happen inline in chat. Scheduled runs can't ask, so approval-gated tools are skipped there.</div>
    </div>
  );
}
