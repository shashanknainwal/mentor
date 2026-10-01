import { useState } from 'react';
import { Hammer, ListChecks, Package, Pencil, Play, Plus, RefreshCw, ShieldAlert, Sparkles, Store, Trash2, Wand2, MessageSquare } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, StatusDot, Tabs, fmtTime, useAsync, useLoad } from '../components/ui.jsx';

const KIND_BADGE = { skill: 'blue', sop: 'purple', agent: 'green', context: '', connector: 'amber' };

function SkillEditor({ skill, onClose, onSaved }) {
  const [s, setS] = useState(skill || { name: '', kind: 'skill', description: '', instructions: '', steps: [] });
  const [run, busy] = useAsync();
  return (
    <Modal wide title={skill?.id ? `Edit ${skill.name}` : 'New skill'} onClose={onClose}
      footer={<Button variant="primary" disabled={!s.name || busy} onClick={() => run(async () => { skill?.id ? await api.put(`/api/skills/${skill.id}`, s) : await api.post('/api/skills', s); onSaved(); }, 'Saved')}>Save</Button>}>
      <div className="grid cols-2">
        <Field label="Name"><input className="input" value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} /></Field>
        <Field label="Type">
          <select className="select" value={s.kind} onChange={(e) => setS({ ...s, kind: e.target.value })}>
            <option value="skill">Skill — a workflow used inside any conversation</option>
            <option value="sop">SOP — a step-by-step playbook that runs immediately</option>
            <option value="context">Context — background knowledge / house style</option>
          </select>
        </Field>
      </div>
      <Field label="One-line description"><input className="input" value={s.description} onChange={(e) => setS({ ...s, description: e.target.value })} /></Field>
      <Field label="Instructions (markdown)"><textarea className="textarea" style={{ minHeight: 180 }} value={s.instructions} onChange={(e) => setS({ ...s, instructions: e.target.value })} /></Field>
      {s.kind === 'sop' && (
        <Field label="Steps" hint="One step per line.">
          <textarea className="textarea" style={{ minHeight: 140 }} value={(s.steps || []).join('\n')} onChange={(e) => setS({ ...s, steps: e.target.value.split('\n') })} />
        </Field>
      )}
    </Modal>
  );
}

function Marketplace() {
  const [items, reload] = useLoad('/api/marketplace');
  const [detail, setDetail] = useState(null);
  const [q, setQ] = useState('');
  const [run, busy] = useAsync();
  if (!items) return <Spinner />;
  const list = items.filter((i) => !q || `${i.name} ${i.description} ${i.kind}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input className="input" placeholder="Search skills, SOPs, agents, connectors…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 14, maxWidth: 420 }} />
      <div className="grid cards">
        {list.map((i) => (
          <div key={i.id} className="card hover" onClick={() => setDetail(i)}>
            <div className="row" style={{ marginBottom: 6 }}>
              <h3 className="grow" style={{ margin: 0 }}>{i.name}</h3>
              <span className={`badge ${KIND_BADGE[i.kind]}`}>{i.kind}</span>
            </div>
            <div className="desc">{i.description}</div>
            <div className="row small faint" style={{ marginTop: 10 }}>
              {i.author} · v{i.version}
              <span style={{ marginLeft: 'auto' }} className={`badge ${i.advisory.risk === 'low' ? 'green' : 'amber'}`}><ShieldAlert size={11} /> {i.advisory.risk} risk</span>
            </div>
            <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}>
              {i.stage === 'available' && <Button size="sm" variant="primary" disabled={busy} onClick={() => run(async () => { await api.post(`/api/marketplace/${i.id}/install`); reload(); useApp.getState().loadAgents(); }, `${i.name} installed — type / in chat`)}>Install</Button>}
              {i.stage === 'installed' && <Button size="sm" disabled={busy} onClick={() => run(async () => { await api.post(`/api/packages/${i.id}/import`); reload(); }, 'Imported')}>Import</Button>}
              {i.stage === 'imported' && <span className="badge green">Installed</span>}
            </div>
          </div>
        ))}
      </div>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <p>{detail.description}</p>
          <p className="small"><strong>Author:</strong> {detail.author} · <strong>Version:</strong> {detail.version}</p>
          <p className="small"><strong>Contains:</strong> {detail.contents.skills} skills/SOPs · {detail.contents.agents} agents · {detail.contents.mcp} connectors</p>
          <div className="card" style={{ borderColor: detail.advisory.risk === 'low' ? 'var(--border)' : 'var(--warn)' }}>
            <div className="row"><ShieldAlert size={16} /> <strong>Security advisory — {detail.advisory.risk} risk</strong></div>
            <p className="desc">{detail.advisory.notes}</p>
          </div>
        </Modal>
      )}
    </>
  );
}

function Library({ onEdit }) {
  const [skills, reload] = useLoad('/api/skills');
  const [run] = useAsync();
  const { setComposerDraft, setView } = useApp();
  if (!skills) return <Spinner />;
  if (!skills.length) return <Empty icon={Sparkles} title="No skills yet">Install from the Marketplace or create one in Build.</Empty>;
  return (
    <table className="table">
      <thead><tr><th>Name</th><th>Type</th><th>Source</th><th>Description</th><th /></tr></thead>
      <tbody>
        {skills.map((s) => (
          <tr key={s.id}>
            <td><strong>{s.name}</strong></td>
            <td><span className={`badge ${KIND_BADGE[s.kind]}`}>{s.kind}</span></td>
            <td className="small">{s.source}{s.version ? ` · v${s.version}` : ''}</td>
            <td className="small muted">{s.description}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              <Button size="sm" icon={Play} onClick={() => { setComposerDraft({ skill: s }); setView('chat'); }}>Use</Button>
              <Button size="sm" variant="ghost" icon={Pencil} disabled={s.source === 'marketplace'} title={s.source === 'marketplace' ? 'Marketplace skills update from source — build your own copy to customise' : 'Edit'} onClick={() => onEdit(s, reload)} />
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm(`Delete ${s.name}?`) && run(async () => { await api.del(`/api/skills/${s.id}`); reload(); })} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Build({ onEdit }) {
  const [mode, setMode] = useState('description');
  const [kind, setKind] = useState('skill');
  const [desc, setDesc] = useState('');
  const [sessionId, setSessionId] = useState('');
  const sessions = useApp((s) => s.sessions);
  const [run, busy] = useAsync();
  const build = () => run(async () => {
    const skill = await api.post('/api/skills/build', mode === 'conversation' ? { session_id: sessionId, kind } : { description: desc, kind });
    onEdit(skill, () => {});
  }, 'Draft created — review and save');
  return (
    <div className="grid cols-3">
      {[
        { id: 'scratch', icon: Pencil, t: 'From scratch', d: 'Write the skill yourself with the guided editor.' },
        { id: 'description', icon: Wand2, t: 'From a description', d: 'Describe what you want; AI drafts it.' },
        { id: 'conversation', icon: MessageSquare, t: 'From a conversation', d: 'Distil a chat where you did the task well into a reusable skill.' },
      ].map((m) => (
        <div key={m.id} className="card hover" style={mode === m.id ? { borderColor: 'var(--kpmg-light)' } : {}} onClick={() => (m.id === 'scratch' ? onEdit(null, () => {}) : setMode(m.id))}>
          <m.icon size={20} />
          <h3 style={{ marginTop: 8 }}>{m.t}</h3>
          <div className="desc">{m.d}</div>
        </div>
      ))}
      <div className="card" style={{ gridColumn: '1 / -1' }}>
        <Field label="Build a">
          <select className="select" style={{ maxWidth: 240 }} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="skill">Skill</option>
            <option value="sop">SOP (step-by-step)</option>
          </select>
        </Field>
        {mode === 'description' ? (
          <Field label="What should it do?"><textarea className="textarea" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="e.g. Turn raw interview notes into a themed insights summary with quotes and implications for the client." /></Field>
        ) : (
          <Field label="Conversation to distil">
            <select className="select" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>
              <option value="">Choose a chat…</option>
              {sessions.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </select>
          </Field>
        )}
        <Button variant="primary" icon={Hammer} disabled={busy || (mode === 'description' ? !desc : !sessionId)} onClick={build}>{busy ? 'Drafting…' : 'Draft skill'}</Button>
        <span className="faint small" style={{ marginLeft: 10 }}>Your authored skills stay local to you.</span>
      </div>
    </div>
  );
}

function AimManager() {
  const [pkgs, reload] = useLoad('/api/packages');
  const [run, busy] = useAsync();
  const [detail, setDetail] = useState(null);
  if (!pkgs) return <Spinner />;
  if (!pkgs.length) return <Empty icon={Package} title="Nothing installed">Packages you install from the Marketplace appear here.</Empty>;
  return (
    <>
      <table className="table">
        <thead><tr><th>Package</th><th>Kind</th><th>Stage</th><th>Health</th><th>Installed</th><th /></tr></thead>
        <tbody>
          {pkgs.map((p) => (
            <tr key={p.id} style={{ cursor: 'pointer' }} onClick={() => setDetail(p)}>
              <td><strong>{p.name}</strong> <span className="faint small">v{p.version}</span></td>
              <td><span className={`badge ${KIND_BADGE[p.kind]}`}>{p.kind}</span></td>
              <td>{p.stage}</td>
              <td><StatusDot status={p.health === 'ok' ? 'ok' : 'error'} /> <span className="small">{p.health}</span></td>
              <td className="small">{fmtTime(p.installed_at)}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                {p.stage === 'imported' ? (
                  <>
                    <Button size="sm" icon={RefreshCw} disabled={busy} title="Refresh" onClick={() => run(async () => { await api.post(`/api/packages/${p.id}/remove`); await api.post(`/api/packages/${p.id}/import`); reload(); }, 'Refreshed')} />
                    <Button size="sm" variant="danger" disabled={busy} onClick={() => run(async () => { await api.post(`/api/packages/${p.id}/remove`); reload(); useApp.getState().loadAgents(); }, 'Removed — package stays installed')}>Remove</Button>
                  </>
                ) : (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => run(async () => { await api.post(`/api/packages/${p.id}/import`); reload(); }, 'Imported')}>Import</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} title="Uninstall" onClick={() => run(async () => { await api.del(`/api/packages/${p.id}`); reload(); })} />
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {detail && (
        <Modal title={detail.name} onClose={() => setDetail(null)}>
          <p className="small">Stage: <strong>{detail.stage}</strong> · Health: {detail.health}</p>
          <pre className="code-block">{JSON.stringify(detail.components, null, 2)}</pre>
          <p className="faint small">Remove tears down the agents, skills and context composed from this package and disconnects its MCP servers (unless another package still needs them). The package itself stays installed.</p>
        </Modal>
      )}
    </>
  );
}

export default function Capabilities() {
  const [tab, setTab] = useState('marketplace');
  const [editing, setEditing] = useState(undefined);
  return (
    <div className="page">
      <PageHead title="Capabilities" subtitle="Teach Mentor new tricks: Skills (workflows), SOPs (playbooks), context packs, agents and connectors. Type / in chat to use them.">
        <Button variant="primary" icon={Plus} onClick={() => setEditing({ skill: null, done: () => {} })}>New skill</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'marketplace', label: 'Marketplace', icon: Store }, { id: 'library', label: 'My skills & SOPs', icon: ListChecks }, { id: 'build', label: 'Build', icon: Hammer }, { id: 'aim', label: 'AIM Manager', icon: Package }]} />
      {tab === 'marketplace' && <Marketplace />}
      {tab === 'library' && <Library onEdit={(skill, done) => setEditing({ skill, done })} />}
      {tab === 'build' && <Build onEdit={(skill, done) => setEditing({ skill, done })} />}
      {tab === 'aim' && <AimManager />}
      {editing && <SkillEditor skill={editing.skill} onClose={() => setEditing(undefined)} onSaved={() => { editing.done?.(); setEditing(undefined); setTab('library'); }} />}
    </div>
  );
}
