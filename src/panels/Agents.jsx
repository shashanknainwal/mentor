import { useEffect, useState } from 'react';
import { ArrowLeft, Bot, Copy, Download, MessageSquare, Play, Plus, Trash2, Upload, Wand2, Clock } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, PageHead, Spinner, Switch, Tabs, downloadJson, fmtTime, pickFile, useAsync, useLoad } from '../components/ui.jsx';
import { Markdown } from '../components/Markdown.jsx';

const PERSONALITIES = ['Professional', 'Friendly', 'Concise', 'Detailed', 'custom'];

function ToolPicker({ value, onChange }) {
  const [tools] = useLoad('/api/tools');
  if (!tools) return <Spinner />;
  const all = [...tools.builtin, ...tools.mcp];
  const groups = all.reduce((acc, t) => ((acc[t.category] ||= []).push(t), acc), {});
  const set = new Set(value || []);
  const toggle = (name) => {
    const next = new Set(set);
    next.has(name) ? next.delete(name) : next.add(name);
    onChange([...next]);
  };
  return (
    <div>
      <div className="faint small" style={{ marginBottom: 8 }}>{set.size ? `${set.size} selected` : 'None selected = all tools available'}
        {set.size > 0 && <Button size="sm" variant="ghost" onClick={() => onChange([])}>Clear</Button>}</div>
      <div className="grid cols-3">
        {Object.entries(groups).map(([g, list]) => (
          <div key={g}>
            <div className="section-title" style={{ margin: '6px 0' }}>{g}</div>
            {list.map((t) => (
              <label key={t.name} className="row small" style={{ alignItems: 'flex-start', marginBottom: 6, cursor: 'pointer' }} title={t.description}>
                <input type="checkbox" checked={set.has(t.name)} onChange={() => toggle(t.name)} />
                <span><span className="mono">{t.name}</span> {t.risk === 'high' && <span className="badge amber">approval</span>}<br /><span className="faint">{t.description.slice(0, 90)}</span></span>
              </label>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function AgentEditor({ agentId, onBack }) {
  const isNew = !agentId;
  const [loaded] = useLoad(isNew ? null : `/api/agents/${agentId}`);
  const [skills] = useLoad('/api/skills');
  const [models] = useLoad('/api/models');
  const [runs, reloadRuns] = useLoad(isNew ? null : `/api/agent-runs?agent_id=${agentId}`);
  const [a, setA] = useState(isNew ? { name: '', description: '', mode: 'easy', personality: 'Professional', tools: [], skills: [], memory_enabled: true, schedule: { cron: '0 8 * * 1-5', enabled: false, input: '' }, env: {} } : null);
  const [tab, setTab] = useState('config');
  const [runInput, setRunInput] = useState('');
  const [lastRun, setLastRun] = useState(null);
  const [run, busy] = useAsync();
  const { setComposerDraft, newChat, loadAgents } = useApp();

  useEffect(() => { if (loaded) setA(loaded); }, [loaded]);
  if (!a) return <div className="page"><Spinner /></div>;
  const set = (patch) => setA({ ...a, ...patch });

  const save = () => run(async () => {
    const saved = isNew ? await api.post('/api/agents', a) : await api.put(`/api/agents/${agentId}`, a);
    loadAgents();
    if (isNew) onBack(saved.id);
    else setA(saved);
  }, 'Agent saved');

  return (
    <div className="page">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={() => onBack()}>All agents</Button>
      <PageHead title={a.name || 'New agent'} subtitle={a.description}>
        <div className="row" style={{ background: 'var(--bg-sunken)', padding: 3, borderRadius: 8 }}>
          {['easy', 'advanced'].map((m) => <Button key={m} size="sm" variant={a.mode === m ? 'primary' : 'ghost'} onClick={() => set({ mode: m })}>{m === 'easy' ? 'Easy mode' : 'Advanced mode'}</Button>)}
        </div>
        {!isNew && <Button icon={MessageSquare} onClick={async () => { await newChat({ agent_id: agentId, title: a.name }); setComposerDraft({ agentId }); }}>Chat as agent</Button>}
        <Button variant="primary" onClick={save} disabled={!a.name || busy}>Save</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'config', label: 'Configuration' }, ...(isNew ? [] : [{ id: 'schedule', label: 'Schedule', icon: Clock }, { id: 'run', label: 'Run & history', icon: Play }])]} />

      {tab === 'config' && (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1fr)', maxWidth: 980 }}>
          <div className="grid cols-2">
            <Field label="Name"><input className="input" value={a.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Proposal Writer" /></Field>
            <Field label="Personality">
              <select className="select" value={a.personality} onChange={(e) => set({ personality: e.target.value })}>{PERSONALITIES.map((p) => <option key={p}>{p}</option>)}</select>
            </Field>
          </div>
          <Field label="What does it do?" hint="Plain English. Mentor uses this to draft the system prompt.">
            <textarea className="textarea" value={a.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <Field label="System prompt" hint="The most important part: role, output format, boundaries, examples.">
            <textarea className="textarea" style={{ minHeight: a.mode === 'advanced' ? 260 : 140 }} value={a.system_prompt || ''} onChange={(e) => set({ system_prompt: e.target.value })} />
            <div><Button size="sm" icon={Wand2} disabled={!a.description || busy} onClick={() => run(async () => set({ system_prompt: (await api.post('/api/agents/draft-prompt', a)).system_prompt }), 'Draft ready — review it')}>Draft with AI</Button></div>
          </Field>
          <Field label="Tools"><ToolPicker value={a.tools} onChange={(tools) => set({ tools })} /></Field>
          <Field label="Skills & SOPs (auto-activate when chatting as this agent)">
            <div className="row wrap">
              {(skills || []).map((s) => (
                <label key={s.id} className="chip" style={{ cursor: 'pointer' }}>
                  <input type="checkbox" checked={(a.skills || []).includes(s.id)} onChange={(e) => set({ skills: e.target.checked ? [...(a.skills || []), s.id] : a.skills.filter((x) => x !== s.id) })} />
                  <span>{s.name}</span>
                </label>
              ))}
              {!skills?.length && <span className="faint small">Install skills in Capabilities.</span>}
            </div>
          </Field>
          <Switch checked={a.memory_enabled} onChange={(v) => set({ memory_enabled: v })} label="Use Semantic Memory" />
          {a.mode === 'advanced' && (
            <>
              <div className="section-title">Advanced</div>
              <div className="grid cols-3">
                <Field label="Model" hint="Blank = global default">
                  <select className="select" value={a.model || ''} onChange={(e) => set({ model: e.target.value })}>
                    <option value="">Default</option>
                    {(models?.bedrock || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                </Field>
                <Field label="Effort" hint="Thinking depth vs. speed/cost (replaces temperature on current models)">
                  <select className="select" value={a.effort || ''} onChange={(e) => set({ effort: e.target.value })}>
                    <option value="">Default</option>
                    {(models?.efforts || []).map((m) => <option key={m}>{m}</option>)}
                  </select>
                </Field>
                <Field label="Max output tokens"><input className="input" type="number" value={a.max_tokens || ''} onChange={(e) => set({ max_tokens: e.target.value ? Number(e.target.value) : null })} placeholder="16000" /></Field>
              </div>
              <div className="grid cols-2">
                <Field label="Input schema (JSON)" hint="For programmatic use."><textarea className="textarea mono" defaultValue={a.input_schema ? JSON.stringify(a.input_schema, null, 2) : ''} onBlur={(e) => { try { set({ input_schema: e.target.value ? JSON.parse(e.target.value) : null }); } catch { alert('Invalid JSON'); } }} /></Field>
                <Field label="Output schema (JSON)" hint="Agent answers with JSON matching this."><textarea className="textarea mono" defaultValue={a.output_schema ? JSON.stringify(a.output_schema, null, 2) : ''} onBlur={(e) => { try { set({ output_schema: e.target.value ? JSON.parse(e.target.value) : null }); } catch { alert('Invalid JSON'); } }} /></Field>
              </div>
              <Field label="Environment variables" hint="KEY=value per line; the agent can reference them.">
                <textarea className="textarea mono" defaultValue={Object.entries(a.env || {}).map(([k, v]) => `${k}=${v}`).join('\n')} onBlur={(e) => set({ env: Object.fromEntries(e.target.value.split('\n').filter((l) => l.includes('=')).map((l) => [l.split('=')[0].trim(), l.split('=').slice(1).join('=').trim()])) })} />
              </Field>
            </>
          )}
        </div>
      )}

      {tab === 'schedule' && (
        <div className="card" style={{ maxWidth: 680 }}>
          <Switch checked={a.schedule?.enabled} onChange={(v) => set({ schedule: { ...a.schedule, enabled: v } })} label="Run this agent on a schedule" />
          <Field label="When" hint="Cron (0 8 * * 1-5) or plain language (weekdays at 8am). Runs in your timezone.">
            <input className="input mono" value={a.schedule?.cron || ''} onChange={(e) => set({ schedule: { ...a.schedule, cron: e.target.value } })} />
          </Field>
          <div className="row wrap" style={{ marginBottom: 12 }}>
            {['weekdays at 8am', 'every monday at 9am', 'fridays at 4pm', 'every hour'].map((p) => <Button key={p} size="sm" onClick={() => set({ schedule: { ...a.schedule, cron: p } })}>{p}</Button>)}
          </div>
          <Field label="Input for each run"><textarea className="textarea" value={a.schedule?.input || ''} onChange={(e) => set({ schedule: { ...a.schedule, input: e.target.value } })} placeholder="e.g. Review @my-client for changes this week and draft a status note." /></Field>
          {a.schedule?.next_run && <div className="faint small">Next run: {fmtTime(a.schedule.next_run)}</div>}
          <div style={{ marginTop: 12 }}><Button variant="primary" onClick={save}>Save schedule</Button></div>
        </div>
      )}

      {tab === 'run' && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <input className="input" value={runInput} onChange={(e) => setRunInput(e.target.value)} placeholder="Input for this run" />
            <Button variant="primary" icon={Play} disabled={busy} onClick={() => run(async () => { setLastRun(await api.post(`/api/agents/${agentId}/run`, { input: runInput })); reloadRuns(); })}>{busy ? 'Running…' : 'Run now'}</Button>
          </div>
          {lastRun && <div className="card" style={{ marginBottom: 14 }}><Markdown>{lastRun.output || lastRun.error || ''}</Markdown></div>}
          <table className="table">
            <thead><tr><th>When</th><th>Trigger</th><th>Input</th><th>Tools</th><th>Duration</th><th>Status</th></tr></thead>
            <tbody>
              {(runs || []).map((r) => (
                <tr key={r.id} onClick={() => setLastRun(r)} style={{ cursor: 'pointer' }}>
                  <td>{fmtTime(r.started)}</td><td>{r.trigger}</td><td>{(r.input || '').slice(0, 60)}</td>
                  <td>{(r.tools_used || []).join(', ') || '—'}</td><td>{r.duration ?? '…'}s</td>
                  <td><span className={`badge ${r.status === 'ok' ? 'green' : r.status === 'error' ? 'red' : 'amber'}`}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

export default function Agents() {
  const [agents, reload] = useLoad('/api/agents');
  const [editing, setEditing] = useState(undefined); // undefined=list, null=new, id=edit
  const [run] = useAsync();
  const { setComposerDraft, newChat, loadAgents } = useApp();
  if (editing !== undefined) return <AgentEditor agentId={editing} onBack={(id) => { reload(); setEditing(id || undefined); }} />;
  return (
    <div className="page">
      <PageHead title="Agents" subtitle="Specialists with their own instructions, tools and skills. Chat as them, attach them to projects, or schedule them.">
        <Button icon={Upload} onClick={async () => { const [f] = await pickFile('.json'); if (f) run(async () => { await api.post('/api/agents/import', JSON.parse(await f.text())); reload(); loadAgents(); }, 'Agent imported'); }}>Import agent</Button>
        <Button variant="primary" icon={Plus} onClick={() => setEditing(null)}>New agent</Button>
      </PageHead>
      {!agents ? <Spinner /> : agents.length ? (
        <div className="grid cards">
          {agents.map((a) => (
            <div key={a.id} className="card hover" onClick={() => setEditing(a.id)}>
              <div className="row" style={{ marginBottom: 6 }}>
                <Bot size={18} />
                <h3 className="grow" style={{ margin: 0 }}>{a.name}</h3>
                {a.schedule?.enabled && <span className="badge blue"><Clock size={11} /> scheduled</span>}
              </div>
              <div className="desc">{a.description || a.system_prompt?.slice(0, 120)}</div>
              <div className="row" style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
                <Button size="sm" icon={MessageSquare} onClick={async () => { await newChat({ agent_id: a.id, title: a.name }); setComposerDraft({ agentId: a.id }); }}>Chat</Button>
                <Button size="sm" variant="ghost" icon={Copy} title="Duplicate" onClick={() => run(async () => { await api.post(`/api/agents/${a.id}/duplicate`); reload(); })} />
                <Button size="sm" variant="ghost" icon={Download} title="Export" onClick={async () => downloadJson(`${a.name}.agent.json`, await api.get(`/api/agents/${a.id}/export`))} />
                <Button size="sm" variant="ghost" icon={Trash2} title="Delete" onClick={() => confirm(`Delete ${a.name}?`) && run(async () => { await api.del(`/api/agents/${a.id}`); reload(); loadAgents(); })} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={Bot} title="No agents yet" action={<Button variant="primary" onClick={() => setEditing(null)}>Build an agent</Button>}>
          Or install ready-made agents from Capabilities › Marketplace (e.g. Proposal Writer, Research Assistant).
        </Empty>
      )}
    </div>
  );
}
