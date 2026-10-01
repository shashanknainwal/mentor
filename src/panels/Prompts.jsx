import { useState } from 'react';
import { BookText, Cloud, Download, Folder, Heart, Lock, Plus, Trash2, Pencil, Send } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, Tabs, useAsync, useLoad } from '../components/ui.jsx';

function PromptEditor({ prompt, folders, onClose, onSaved }) {
  const [p, setP] = useState(prompt || { name: '', content: '', category: '', folder: 'My prompts', tags: [] });
  const [run, busy] = useAsync();
  return (
    <Modal title={prompt?.id ? 'Edit prompt' : 'New prompt'} onClose={onClose}
      footer={<Button variant="primary" disabled={!p.name || !p.content || busy} onClick={() => run(async () => { prompt?.id ? await api.patch(`/api/prompts/${prompt.id}`, p) : await api.post('/api/prompts', p); onSaved(); }, 'Saved')}>Save</Button>}>
      <Field label="Name"><input className="input" value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} /></Field>
      <Field label="Prompt" hint="Write it as standing instructions: “You are a meticulous reviewer. Focus on…”">
        <textarea className="textarea" style={{ minHeight: 160 }} value={p.content} onChange={(e) => setP({ ...p, content: e.target.value })} />
      </Field>
      <div className="grid cols-3">
        <Field label="Category"><input className="input" value={p.category} onChange={(e) => setP({ ...p, category: e.target.value })} placeholder="Writing" /></Field>
        <Field label="Folder">
          <input className="input" list="prompt-folders" value={p.folder} onChange={(e) => setP({ ...p, folder: e.target.value })} />
          <datalist id="prompt-folders">{folders.map((f) => <option key={f} value={f} />)}</datalist>
        </Field>
        <Field label="Tags (comma separated)"><input className="input" value={(p.tags || []).join(', ')} onChange={(e) => setP({ ...p, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
      </div>
    </Modal>
  );
}

export default function Prompts() {
  const [tab, setTab] = useState('local');
  const [prompts, reload] = useLoad('/api/prompts');
  const [cloud, , cloudLoading, cloudErr] = useLoad(tab === 'cloud' ? '/api/prompts/cloud' : null);
  const [filter, setFilter] = useState({ folder: 'All', tag: null, fav: false, q: '' });
  const [editing, setEditing] = useState(undefined);
  const [run] = useAsync();
  const { setComposerDraft, setView } = useApp();
  const all = prompts || [];
  const folders = [...new Set(all.map((p) => p.folder || 'My prompts'))];
  const tags = [...new Set(all.flatMap((p) => p.tags || []))];
  const list = all.filter((p) =>
    (filter.folder === 'All' || p.folder === filter.folder) && (!filter.tag || (p.tags || []).includes(filter.tag)) && (!filter.fav || p.favorite) &&
    (!filter.q || `${p.name} ${p.content}`.toLowerCase().includes(filter.q.toLowerCase())));
  const use = (p) => { setComposerDraft({ prompt: p }); setView('chat'); };

  return (
    <div className="page">
      <PageHead title="Prompt Library" subtitle="Saved, reusable prompts. Attach one with the + button in chat — it applies to your next message.">
        <Button variant="primary" icon={Plus} onClick={() => setEditing(null)}>New prompt</Button>
      </PageHead>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'local', label: 'Local', icon: BookText }, { id: 'cloud', label: 'Cloud', icon: Cloud }]} />
      {tab === 'local' && (
        <div className="split">
          <div>
            <input className="input" placeholder="Search…" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} style={{ marginBottom: 10 }} />
            <div className="list">
              <div className={`list-item ${filter.fav ? 'active' : ''}`} onClick={() => setFilter({ ...filter, fav: !filter.fav })}><Heart size={15} /> Favorites</div>
              {['All', ...folders].map((f) => (
                <div key={f} className={`list-item ${filter.folder === f ? 'active' : ''}`} onClick={() => setFilter({ ...filter, folder: f })}><Folder size={15} /> {f} <span className="faint small" style={{ marginLeft: 'auto' }}>{f === 'All' ? all.length : all.filter((p) => p.folder === f).length}</span></div>
              ))}
            </div>
            <div className="section-title">Tags</div>
            <div className="row wrap">{tags.map((t) => <span key={t} className={`chip ${filter.tag === t ? 'blue' : ''}`} style={{ cursor: 'pointer' }} onClick={() => setFilter({ ...filter, tag: filter.tag === t ? null : t })}>{t}</span>)}</div>
          </div>
          <div>
            {!prompts ? <Spinner /> : list.length ? (
              <div className="grid cols-2">
                {list.map((p) => (
                  <div key={p.id} className="card">
                    <div className="row" style={{ marginBottom: 4 }}>
                      {p.builtin && <Lock size={13} className="faint" title="Built-in" />}
                      <h3 className="grow" style={{ margin: 0 }}>{p.name}</h3>
                      <button className="btn ghost icon sm" title="Favorite" onClick={() => run(async () => { await api.patch(`/api/prompts/${p.id}`, { favorite: !p.favorite }); reload(); })}>
                        <Heart size={14} fill={p.favorite ? 'var(--kpmg-pink)' : 'none'} color={p.favorite ? 'var(--kpmg-pink)' : 'currentColor'} />
                      </button>
                    </div>
                    <div className="row small faint" style={{ marginBottom: 6 }}>{p.category && <span className="badge">{p.category}</span>}{(p.tags || []).map((t) => <span key={t}>#{t}</span>)}</div>
                    <div className="desc" style={{ whiteSpace: 'pre-wrap', maxHeight: 90, overflow: 'hidden' }}>{p.content}</div>
                    <div className="row" style={{ marginTop: 10 }}>
                      <Button size="sm" icon={Send} onClick={() => use(p)}>Use in chat</Button>
                      {!p.builtin && <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(p)} />}
                      {!p.builtin && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm('Delete prompt?') && run(async () => { await api.del(`/api/prompts/${p.id}`); reload(); })} />}
                      {p.builtin && <Button size="sm" variant="ghost" onClick={() => setEditing({ ...p, id: undefined, builtin: false, folder: 'My prompts', name: `${p.name} (copy)` })}>Customise copy</Button>}
                    </div>
                  </div>
                ))}
              </div>
            ) : <Empty icon={BookText} title="No prompts match" />}
          </div>
        </div>
      )}
      {tab === 'cloud' && (
        cloudLoading ? <Spinner /> : cloudErr ? <div className="error-part">{cloudErr}</div> : (
          <>
            <div className="faint small" style={{ marginBottom: 12 }}>Prompts shared through Mentor Cloud. Set your organisation’s catalog URL in Settings › General.</div>
            <div className="grid cols-2">
              {(cloud || []).map((p) => (
                <div key={p.id} className="card">
                  <h3>{p.name}</h3>
                  <div className="row small faint" style={{ marginBottom: 6 }}><span className="badge">{p.category}</span> {p.author}</div>
                  <div className="desc">{p.content}</div>
                  <Button size="sm" icon={Download} style={{ marginTop: 10 }} onClick={() => run(async () => { await api.post('/api/prompts/cloud/pull', p); reload(); }, 'Added to your library')}>Add to library</Button>
                </div>
              ))}
            </div>
          </>
        )
      )}
      {editing !== undefined && <PromptEditor prompt={editing} folders={folders} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />}
    </div>
  );
}
