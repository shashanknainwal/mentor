import { useState } from 'react';
import { ArrowLeft, AtSign, FileText, FolderKanban, Globe, MessageSquare, Plus, RefreshCw, Share2, Trash2, Upload, Pencil, Bot, Download } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, StatusDot, Tabs, fmtBytes, fmtTime, pickFile, useAsync, useLoad } from '../components/ui.jsx';
import { Markdown } from '../components/Markdown.jsx';

function NewProject({ onClose, onCreated }) {
  const [templates] = useLoad('/api/projects/templates');
  const [form, setForm] = useState({ name: '', description: '', template: 'client_engagement' });
  const [run, busy] = useAsync();
  return (
    <Modal title="New project" onClose={onClose}
      footer={<Button variant="primary" disabled={!form.name || busy} onClick={() => run(async () => onCreated(await api.post('/api/projects', form)))}>Create project</Button>}>
      <Field label="Name"><input className="input" autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Acme – Finance Transformation" /></Field>
      <Field label="Template">
        <div className="grid cols-2">
          {(templates || []).map((t) => (
            <div key={t.id} className={`card hover ${form.template === t.id ? 'active' : ''}`} style={form.template === t.id ? { borderColor: 'var(--kpmg-light)' } : {}} onClick={() => setForm({ ...form, template: t.id })}>
              <h3>{t.name}</h3>
              <div className="desc">{t.description}</div>
            </div>
          ))}
        </div>
      </Field>
      <Field label="Description (optional)"><textarea className="textarea" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
    </Modal>
  );
}

function RawEditor({ file, onClose, onSaved }) {
  const [content] = useLoad(`/api/projects/files/${file.id}/raw`);
  const [draft, setDraft] = useState(null);
  const [run, busy] = useAsync();
  const value = draft ?? (typeof content === 'string' ? content : '');
  return (
    <Modal wide title={`Edit raw file — ${file.name}`} onClose={onClose}
      footer={<Button variant="primary" disabled={busy || draft === null} onClick={() => run(async () => { await api.put(`/api/projects/files/${file.id}/raw`, { content: value }); onSaved(); onClose(); }, 'Saved and re-indexed')}>Save & re-index</Button>}>
      {content === null ? <Spinner /> : <textarea className="textarea mono" style={{ minHeight: '55vh' }} value={value} onChange={(e) => setDraft(e.target.value)} />}
      <div className="faint small" style={{ marginTop: 6 }}>Binary formats (PDF/DOCX/XLSX) show extracted text; saving writes plain text.</div>
    </Modal>
  );
}

function ProjectDetail({ id, onBack }) {
  const [p, reload] = useLoad(`/api/projects/${id}`);
  const [agents] = useLoad('/api/agents');
  const [tab, setTab] = useState('files');
  const [run, busy] = useAsync();
  const [editing, setEditing] = useState(null);
  const [srcUrl, setSrcUrl] = useState('');
  const [aliases, setAliases] = useState('');
  const { setComposerDraft, newChat, toast } = useApp();
  if (!p) return <div className="page"><Spinner /></div>;

  const upload = async () => {
    const files = await pickFile();
    for (const f of files) await run(() => api.upload(`/api/projects/${id}/files`, f));
    toast(`${files.length} file(s) indexed`, 'success');
    reload();
  };
  const chatHere = async () => {
    const s = await newChat({ project_ids: [id], title: `${p.name}` });
    setComposerDraft({ mention: { id, name: p.name } });
    return s;
  };

  return (
    <div className="page">
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>All projects</Button>
      <PageHead title={p.name} subtitle={p.description}>
        <select className="select" style={{ width: 130 }} value={p.status} onChange={(e) => run(async () => { await api.patch(`/api/projects/${id}`, { status: e.target.value }); reload(); })}>
          {['active', 'on hold', 'completed', 'archived'].map((s) => <option key={s}>{s}</option>)}
        </select>
        <Button icon={MessageSquare} variant="primary" onClick={chatHere}>Chat with @{p.slug}</Button>
      </PageHead>
      <div className="row wrap" style={{ marginBottom: 14, gap: 8 }}>
        <span className="badge blue">{p.template.replace('_', ' ')}</span>
        <span className="badge">{p.files.length} files · {p.chunks} chunks indexed</span>
        {p.members?.length > 0 && <span className="badge purple">Shared with {p.members.join(', ')}</span>}
        {p.agent && <span className="badge"><Bot size={11} /> {p.agent.name}</span>}
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'files', label: 'Files', count: p.files.length }, { id: 'sources', label: 'Live sources', count: p.sources?.length || 0 }, { id: 'chats', label: 'Chats', count: p.sessions.length }, { id: 'reports', label: 'Status reports' }, { id: 'settings', label: 'Settings & sharing' }]} />

      {tab === 'files' && (
        <>
          <div className="row" style={{ marginBottom: 10 }}>
            <Button icon={Upload} onClick={upload} disabled={busy}>Add files</Button>
            {busy && <Spinner />}
            <span className="faint small">Files are indexed locally. @-mentions retrieve only the most relevant excerpts.</span>
          </div>
          {p.files.length ? (
            <table className="table">
              <thead><tr><th>Name</th><th>Size</th><th>Chunks</th><th>Status</th><th /></tr></thead>
              <tbody>
                {p.files.map((f) => (
                  <tr key={f.id}>
                    <td><FileText size={13} /> {f.name}</td>
                    <td>{fmtBytes(f.size)}</td>
                    <td>{f.chunks ?? '—'}</td>
                    <td><StatusDot status={f.status} /> {f.status}{f.error ? ` — ${f.error}` : ''}</td>
                    <td style={{ textAlign: 'right' }}>
                      <Button size="sm" variant="ghost" icon={Pencil} title="Edit raw file" onClick={() => setEditing(f)} />
                      <Button size="sm" variant="ghost" icon={Trash2} title="Remove" onClick={() => run(async () => { await api.del(`/api/projects/files/${f.id}`); reload(); })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <Empty icon={FileText} title="No files yet">Add documents, PDFs and Office files to ground answers in this project.</Empty>}
        </>
      )}

      {tab === 'sources' && (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <input className="input" placeholder="https://… (web page, SharePoint export, RSS, PDF)" value={srcUrl} onChange={(e) => setSrcUrl(e.target.value)} />
            <Button icon={Globe} disabled={!srcUrl || busy} onClick={() => run(async () => { await api.post(`/api/projects/${id}/sources`, { url: srcUrl, refresh: 'daily' }); setSrcUrl(''); reload(); }, 'Source added')}>Add source</Button>
          </div>
          <div className="faint small" style={{ marginBottom: 10 }}>Live sources refresh themselves on a cadence so answers stay current. Connect Slack/Teams channels through an MCP connector.</div>
          {(p.sources || []).map((s) => (
            <div key={s.id} className="card row" style={{ marginBottom: 8 }}>
              <Globe size={16} />
              <div className="grow"><div style={{ fontWeight: 600 }}>{s.url}</div><div className="faint small">Refreshed {fmtTime(s.last_refreshed)} · {s.status}</div></div>
              <select className="select" style={{ width: 120 }} value={s.refresh} onChange={(e) => run(async () => { await api.patch(`/api/projects/${id}`, { sources: p.sources.map((x) => (x.id === s.id ? { ...x, refresh: e.target.value } : x)) }); reload(); })}>
                {['manual', 'hourly', 'daily', 'weekly'].map((r) => <option key={r}>{r}</option>)}
              </select>
              <Button size="sm" icon={RefreshCw} onClick={() => run(async () => { await api.post(`/api/projects/${id}/sources/${s.id}/refresh`); reload(); })} />
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => run(async () => { await api.del(`/api/projects/${id}/sources/${s.id}`); reload(); })} />
            </div>
          ))}
        </>
      )}

      {tab === 'chats' && (
        p.sessions.length ? (
          <div className="list">
            {p.sessions.map((s) => (
              <div key={s.id} className="list-item" onClick={() => useApp.getState().openSession(s.id, s.title)}>
                <MessageSquare size={15} /> <span className="grow">{s.title}</span> <span className="faint small">{fmtTime(s.updated)}</span>
              </div>
            ))}
          </div>
        ) : <Empty icon={MessageSquare} title="No chats yet" action={<Button onClick={chatHere}>Start a chat</Button>}>Chats started from this project stay attached to it.</Empty>
      )}

      {tab === 'reports' && (
        <>
          <Button variant="primary" disabled={busy} onClick={() => run(async () => { await api.post(`/api/projects/${id}/report`); reload(); }, 'Status report generated')}>
            {busy ? <Spinner /> : null} Generate status report
          </Button>
          {[...(p.reports || [])].reverse().map((r) => (
            <div key={r.ts} className="card" style={{ marginTop: 12 }}>
              <div className="faint small" style={{ marginBottom: 6 }}>{fmtTime(r.ts)}</div>
              <Markdown>{r.markdown}</Markdown>
            </div>
          ))}
        </>
      )}

      {tab === 'settings' && (
        <div className="grid cols-2">
          <div className="card">
            <h3>Project instructions</h3>
            <p className="desc">Added to the AI’s context whenever this project is mentioned.</p>
            <textarea className="textarea" defaultValue={p.instructions} onBlur={(e) => run(() => api.patch(`/api/projects/${id}`, { instructions: e.target.value }), 'Saved')} />
            <Field label="Attached agent">
              <select className="select" value={p.agent_id || ''} onChange={(e) => run(async () => { await api.patch(`/api/projects/${id}`, { agent_id: e.target.value || null }); reload(); })}>
                <option value="">None</option>
                {(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="card">
            <h3>Share with teammates</h3>
            <p className="desc">Add colleagues by alias. Mentor records them as members and creates a portable <code>.mentorproject.zip</code> in Artifacts they can import.</p>
            <div className="row">
              <input className="input" placeholder="alias1, alias2" value={aliases} onChange={(e) => setAliases(e.target.value)} />
              <Button icon={Share2} disabled={!aliases} onClick={() => run(async () => { await api.post(`/api/projects/${id}/share`, { aliases: aliases.split(',') }); setAliases(''); reload(); }, 'Shared — bundle saved to Artifacts')}>Share</Button>
            </div>
            <div className="section-title">Danger zone</div>
            <Button variant="danger" icon={Trash2} onClick={() => confirm(`Delete ${p.name} and its index?`) && run(async () => { await api.del(`/api/projects/${id}`); onBack(); })}>Delete project</Button>
          </div>
        </div>
      )}
      {editing && <RawEditor file={editing} onClose={() => setEditing(null)} onSaved={reload} />}
    </div>
  );
}

export default function Projects() {
  const [projects, reload] = useLoad('/api/projects');
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [run] = useAsync();
  if (openId) return <ProjectDetail id={openId} onBack={() => (setOpenId(null), reload())} />;
  const list = (projects || []).filter((p) => p.kind === 'project');
  const folders = (projects || []).filter((p) => p.kind === 'folder');
  return (
    <div className="page">
      <PageHead title="Projects" subtitle="Group chats, files and live sources around a piece of work. Type @ in chat to bring a project in.">
        <Button icon={Download} onClick={async () => { const [f] = await pickFile('.zip'); if (f) run(async () => { await api.upload('/api/projects/import', f); reload(); }, 'Project imported'); }}>Import shared</Button>
        <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>New project</Button>
      </PageHead>
      {!projects ? <Spinner /> : list.length ? (
        <div className="grid cards">
          {list.map((p) => (
            <div key={p.id} className="card hover" onClick={() => setOpenId(p.id)}>
              <div className="row" style={{ marginBottom: 6 }}>
                <FolderKanban size={18} color={p.color} />
                <h3 style={{ margin: 0 }} className="grow">{p.name}</h3>
                <span className={`badge ${p.status === 'active' ? 'green' : ''}`}>{p.status}</span>
              </div>
              <div className="desc">{p.description}</div>
              <div className="row faint small" style={{ marginTop: 10 }}>
                <AtSign size={12} />{p.slug} · {p.file_count} files {p.members?.length ? `· ${p.members.length} members` : ''}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={FolderKanban} title="No projects yet" action={<Button variant="primary" onClick={() => setCreating(true)}>Create your first project</Button>}>
          Tip: ask Mentor to “set me up with a sample project”.
        </Empty>
      )}
      {folders.length > 0 && (
        <>
          <div className="section-title">Indexed folders (project surface)</div>
          <div className="list">{folders.map((f) => <div key={f.id} className="list-item"><FolderKanban size={15} /> {f.name} <span className="faint small">{f.description}</span></div>)}</div>
        </>
      )}
      {creating && <NewProject onClose={() => setCreating(false)} onCreated={(p) => { setCreating(false); setOpenId(p.id); }} />}
    </div>
  );
}
