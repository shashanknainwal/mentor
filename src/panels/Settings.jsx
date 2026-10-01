import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FolderPlus, RefreshCw, Trash2, XCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Field, Modal, Spinner, StatusDot, Switch, fmtTime, useAsync, useLoad } from '../components/ui.jsx';

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'Europe/London', 'America/New_York', 'Asia/Kolkata', 'Asia/Singapore', 'Australia/Sydney'];
  }
})();

// ---------------------------------------------------------------------------
// Indexed folders — shared with Memory › Folders
// ---------------------------------------------------------------------------
function FolderFiles({ folder }) {
  const [files, reload] = useLoad(`/api/folders/${folder.id}/files`);
  if (!files) return <Spinner />;
  const counts = files.reduce((a, f) => ((a[f.status] = (a[f.status] || 0) + 1), a), {});
  return (
    <div style={{ marginTop: 8 }}>
      <div className="row small" style={{ marginBottom: 6 }}>{Object.entries(counts).map(([k, v]) => <span key={k} className="badge">{k}: {v}</span>)}<Button size="sm" variant="ghost" icon={RefreshCw} onClick={reload} /></div>
      <div style={{ maxHeight: 260, overflow: 'auto' }}>
        <table className="table">
          <tbody>{files.slice(0, 400).map((f) => <tr key={f.path}><td className="mono small">{f.path}</td><td><span className={`badge ${f.status === 'indexed' ? 'green' : f.status === 'skipped' ? '' : 'amber'}`}>{f.status}</span></td><td className="small faint">{f.reason || (f.chunks ? `${f.chunks} chunks` : '')}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  );
}

export function FolderManager({ defaultSurface = 'project', filter }) {
  const [folders, reload] = useLoad('/api/folders');
  const [adding, setAdding] = useState(null);
  const [open, setOpen] = useState(null);
  const [run, busy] = useAsync();
  const timer = useRef(null);
  useEffect(() => {
    if (folders?.some((f) => f.status === 'indexing')) timer.current = setTimeout(reload, 1500);
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folders]);

  const choose = async () => {
    const path = window.mentor?.pickFolder ? await window.mentor.pickFolder() : prompt('Folder path to add:');
    if (path) setAdding({ path, access: 'read', surface: defaultSurface, auto_reindex: false });
  };
  const list = (folders || []).filter(filter || (() => true));
  return (
    <>
      <div className="row" style={{ marginBottom: 10 }}>
        <Button variant="primary" icon={FolderPlus} onClick={choose}>Add directory…</Button>
        <span className="faint small">Picking a folder is your consent. Grant a specific project folder, not your whole drive.</span>
      </div>
      {!folders ? <Spinner /> : list.map((f) => (
        <div key={f.id} className="card" style={{ marginBottom: 8 }}>
          <div className="row">
            <button className="btn ghost icon sm" onClick={() => setOpen(open === f.id ? null : f.id)}>{open === f.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button>
            <StatusDot status={f.status === 'indexed' || f.surface === 'none' ? 'ok' : f.status} />
            <div className="grow">
              <div className="mono small" style={{ fontWeight: 600 }}>{f.path}</div>
              <div className="faint small">
                {f.surface === 'none' ? 'Access only' : `${f.file_count} files · ${f.chunks} chunks`}
                {f.status === 'indexing' && f.progress && ` · indexing ${f.progress.done}/${f.progress.total}`}
                {f.last_indexed && ` · indexed ${fmtTime(f.last_indexed)}`}
              </div>
            </div>
            <select className="select" style={{ width: 130 }} value={f.access} onChange={(e) => {
              if (e.target.value === 'readwrite' && !confirm('Allow Mentor to create and modify files in this folder? Individual writes still need your approval.')) return;
              run(async () => { await api.patch(`/api/folders/${f.id}`, { access: e.target.value }); reload(); });
            }}>
              <option value="read">Read-only</option><option value="readwrite">Read + write</option>
            </select>
            <select className="select" style={{ width: 120 }} value={f.surface} onChange={(e) => run(async () => { await api.patch(`/api/folders/${f.id}`, { surface: e.target.value }); reload(); })}>
              <option value="project">Project</option><option value="memory">Memory</option><option value="none">None</option>
            </select>
            {f.surface !== 'none' && <Switch checked={f.auto_reindex} onChange={(v) => run(async () => { await api.patch(`/api/folders/${f.id}`, { auto_reindex: v }); reload(); })} label="Auto" />}
            {f.surface !== 'none' && <Button size="sm" icon={RefreshCw} title="Re-index changed files" onClick={() => run(async () => { await api.post(`/api/folders/${f.id}/reindex`); reload(); })} />}
            <Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm('Remove this folder? Its index is purged.') && run(async () => { await api.del(`/api/folders/${f.id}`); reload(); })} />
          </div>
          {open === f.id && <FolderFiles folder={f} />}
        </div>
      ))}
      {folders && !list.length && <div className="faint small">No folders yet.</div>}
      {adding && (
        <Modal title="Add directory" onClose={() => setAdding(null)} footer={<Button variant="primary" disabled={busy} onClick={() => run(async () => { await api.post('/api/folders', adding); setAdding(null); reload(); }, 'Folder added')}>Add</Button>}>
          <p className="mono small">{adding.path}</p>
          <Field label="Access">
            <select className="select" value={adding.access} onChange={(e) => setAdding({ ...adding, access: e.target.value })}>
              <option value="read">Read-only (default) — the agent can read files here</option>
              <option value="readwrite">Read + write — the agent can also create and modify files</option>
            </select>
          </Field>
          <Field label="Index surface" hint="Access and indexing are independent.">
            <select className="select" value={adding.surface} onChange={(e) => setAdding({ ...adding, surface: e.target.value })}>
              <option value="project">Project — @-mentionable, indexed in place</option>
              <option value="memory">Memory — recalled automatically when relevant</option>
              <option value="none">None — access only</option>
            </select>
          </Field>
          {adding.surface !== 'none' && <Switch checked={adding.auto_reindex} onChange={(v) => setAdding({ ...adding, auto_reindex: v })} label="Auto re-index changed files (hourly)" />}
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
const SECTIONS = [
  ['general', 'General'], ['models', 'Models & AWS'], ['appearance', 'Appearance'], ['voice', 'Voice'], ['directories', 'Directories'],
  ['privacy', 'Privacy'], ['startup', 'Startup & updates'], ['status', 'System status'],
];

export default function Settings() {
  const { settings, saveSettings, theme, setTheme, toast } = useApp();
  const [models] = useLoad('/api/models');
  const [health, reloadHealth] = useLoad('/api/health');
  const [draft, setDraft] = useState(null);
  const [test, setTest] = useState(null);
  const [current, setCurrent] = useState('general');
  const [run, busy] = useAsync();
  const [appInfo, setAppInfo] = useState(null);
  const scroller = useRef(null);
  useEffect(() => { if (settings && !draft) setDraft(structuredClone(settings)); }, [settings, draft]);
  useEffect(() => { window.mentor?.appInfo?.().then(setAppInfo); }, []);
  if (!draft) return <div className="page"><Spinner /></div>;

  const set = (section, key, value) => setDraft({ ...draft, [section]: { ...draft[section], [key]: value } });
  const save = (section) => run(async () => { const s = await saveSettings({ [section]: draft[section] }); setDraft(structuredClone(s)); }, 'Saved');
  const jump = (id) => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const m = draft.model;

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid var(--border)', padding: '22px 10px', position: 'sticky', top: 0 }}>
        <div className="list">{SECTIONS.map(([id, l]) => <div key={id} className={`list-item ${current === id ? 'active' : ''}`} onClick={() => jump(id)}>{l}</div>)}</div>
      </div>
      <div ref={scroller} style={{ flex: 1, overflow: 'auto' }} onScroll={(e) => {
        const top = e.currentTarget.getBoundingClientRect().top;
        const visible = SECTIONS.map(([id]) => [id, document.getElementById(`set-${id}`)?.getBoundingClientRect().top - top]).filter(([, y]) => y !== undefined && y < 120);
        if (visible.length) setCurrent(visible.at(-1)[0]);
      }}>
        <div className="page" style={{ maxWidth: 900, margin: 0 }}>
          <h1 style={{ fontSize: 22 }}>Settings</h1>

          <section id="set-general" className="card" style={{ marginBottom: 16 }}>
            <h3>General</h3>
            <div className="grid cols-2">
              <Field label="Your name"><input className="input" value={draft.user.name} onChange={(e) => set('user', 'name', e.target.value)} /></Field>
              <Field label="Alias / email"><input className="input" value={draft.user.alias} onChange={(e) => set('user', 'alias', e.target.value)} /></Field>
              <Field label="Role" hint="Tunes the Dashboard and suggestions.">
                <select className="select" value={draft.user.role} onChange={(e) => set('user', 'role', e.target.value)}>{['Partner', 'Director', 'Manager', 'Consultant', 'Analyst'].map((r) => <option key={r}>{r}</option>)}</select>
              </Field>
              <Field label="Timezone" hint="Scheduled tasks fire in this timezone.">
                <select className="select" value={draft.user.timezone} onChange={(e) => set('user', 'timezone', e.target.value)}>{TIMEZONES.map((t) => <option key={t}>{t}</option>)}</select>
              </Field>
            </div>
            <Field label="Cloud prompt catalog URL (optional)" hint="JSON list served by your team; powers Prompts › Cloud.">
              <input className="input" value={draft.prompts.cloud_url} onChange={(e) => set('prompts', 'cloud_url', e.target.value)} />
            </Field>
            <Button variant="primary" onClick={() => run(async () => { const s = await saveSettings({ user: draft.user, prompts: draft.prompts }); setDraft(structuredClone(s)); }, 'Saved')}>Save</Button>
          </section>

          <section id="set-models" className="card" style={{ marginBottom: 16 }}>
            <h3>Models & AWS Bedrock</h3>
            <p className="desc">AI inference always runs on AWS Bedrock. Use an AWS profile (recommended, works with SSO) or access keys. Demo mode makes no AWS calls.</p>
            <Field label="Provider">
              <select className="select" value={m.provider} onChange={(e) => set('model', 'provider', e.target.value)}>
                <option value="bedrock">AWS Bedrock</option><option value="demo">Demo mode (offline, canned responses)</option>
              </select>
            </Field>
            <div className="grid cols-2">
              <Field label="Main model">
                <select className="select" value={m.model_id} onChange={(e) => set('model', 'model_id', e.target.value)}>
                  {(models?.bedrock || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                  {!models?.bedrock?.some((x) => x.id === m.model_id) && <option value={m.model_id}>{m.model_id}</option>}
                </select>
              </Field>
              <Field label="Fast model" hint="Used for memory extraction, titles and drafts.">
                <select className="select" value={m.fast_model_id} onChange={(e) => set('model', 'fast_model_id', e.target.value)}>
                  {(models?.bedrock || []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
              </Field>
              <Field label="Effort" hint="Higher = deeper reasoning, slower, more tokens.">
                <select className="select" value={m.effort} onChange={(e) => set('model', 'effort', e.target.value)}>{(models?.efforts || []).map((x) => <option key={x}>{x}</option>)}</select>
              </Field>
              <Field label="Max output tokens"><input className="input" type="number" value={m.max_tokens} onChange={(e) => set('model', 'max_tokens', Number(e.target.value))} /></Field>
              <Field label="AWS region"><input className="input" value={m.aws_region} onChange={(e) => set('model', 'aws_region', e.target.value)} /></Field>
              <Field label="AWS profile" hint="From ~/.aws/config (e.g. after `aws sso login`)."><input className="input" value={m.aws_profile} onChange={(e) => set('model', 'aws_profile', e.target.value)} placeholder="kpmg-bedrock" /></Field>
              <Field label="Access key ID (optional)"><input className="input" value={m.aws_access_key} onChange={(e) => set('model', 'aws_access_key', e.target.value)} /></Field>
              <Field label="Secret access key (optional)"><input className="input" type="password" value={m.aws_secret_key} onChange={(e) => set('model', 'aws_secret_key', e.target.value)} /></Field>
              <Field label="Session token (optional)"><input className="input" type="password" value={m.aws_session_token} onChange={(e) => set('model', 'aws_session_token', e.target.value)} /></Field>
              <Field label="Embedding model"><input className="input mono" value={m.embedding_model_id} onChange={(e) => set('model', 'embedding_model_id', e.target.value)} /></Field>
              <Field label="Image model"><input className="input mono" value={m.image_model_id} onChange={(e) => set('model', 'image_model_id', e.target.value)} /></Field>
            </div>
            <div className="row">
              <Button variant="primary" onClick={() => save('model')}>Save</Button>
              <Button disabled={busy} onClick={() => run(async () => { await saveSettings({ model: draft.model }); setTest(await api.post('/api/settings/test-connection')); })}>Test connection</Button>
              {test && (test.ok ? <span className="row small" style={{ color: 'var(--ok)' }}><CheckCircle2 size={15} /> {test.provider} OK {test.model ? `· ${test.model}` : ''}</span> : <span className="row small" style={{ color: 'var(--err)' }}><XCircle size={15} /> {test.message}</span>)}
            </div>
            <div className="faint small" style={{ marginTop: 8 }}>Routing mode: <strong>{draft.routing.mode}</strong> (managed automatically by the engine).</div>
          </section>

          <section id="set-appearance" className="card" style={{ marginBottom: 16 }}>
            <h3>Appearance</h3>
            <div className="row" style={{ marginBottom: 12 }}>
              {['light', 'dark', 'system'].map((t) => <Button key={t} variant={theme === t ? 'primary' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</Button>)}
              <span className="faint small">Cycle with Ctrl+Shift+L</span>
            </div>
            <Field label={`Font size — ${draft.appearance.font_size}px`}>
              <input type="range" min={12} max={18} value={draft.appearance.font_size} onChange={(e) => set('appearance', 'font_size', Number(e.target.value))} onMouseUp={() => save('appearance')} />
            </Field>
          </section>

          <section id="set-voice" className="card" style={{ marginBottom: 16 }}>
            <h3>Voice</h3>
            <Field label="Speech-to-text" hint="Browser engine uses the OS/Chromium recogniser where available. Amazon Transcribe can be wired in as a backend.">
              <select className="select" value={draft.voice.stt} onChange={(e) => set('voice', 'stt', e.target.value)}>
                <option value="browser">Built-in (Web Speech)</option><option value="off">Off</option>
              </select>
            </Field>
            <Switch checked={draft.voice.tts} onChange={(v) => set('voice', 'tts', v)} label="Read responses aloud (text-to-speech)" />
            <div style={{ marginTop: 10 }}><Button variant="primary" onClick={() => save('voice')}>Save</Button></div>
          </section>

          <section id="set-directories" className="card" style={{ marginBottom: 16 }}>
            <h3>Directories</h3>
            <p className="desc">Folders the AI may read (or write), optionally indexed as an @-mentionable project or into memory. Indexing skips node_modules, .git, venv, build output and files over 25 MB.</p>
            <FolderManager />
            <div className="section-title">OneDrive</div>
            <Switch checked={draft.artifacts.onedrive_mirror} onChange={(v) => set('artifacts', 'onedrive_mirror', v)} label="Mirror generated artifacts to OneDrive (one-way copy, never deletes)" />
            {draft.artifacts.onedrive_mirror && (
              <Field label="OneDrive folder"><div className="row"><input className="input" value={draft.artifacts.onedrive_path} onChange={(e) => set('artifacts', 'onedrive_path', e.target.value)} placeholder={'C:\\Users\\you\\OneDrive - KPMG'} />
                {window.mentor?.pickFolder && <Button onClick={async () => { const p = await window.mentor.pickFolder(); if (p) set('artifacts', 'onedrive_path', p); }}>Browse</Button>}</div></Field>
            )}
            <Button variant="primary" onClick={() => save('artifacts')}>Save</Button>
          </section>

          <section id="set-privacy" className="card" style={{ marginBottom: 16 }}>
            <h3>Privacy</h3>
            <p className="desc">Files, conversations and memory are stored locally in ~/MentorDesktop. Message content is sent to AWS Bedrock for processing. Mentor does not sell or share your data.</p>
            <Switch checked={draft.privacy.memory_capture} onChange={(v) => set('privacy', 'memory_capture', v)} label="Capture memories from conversations" />
            <div style={{ height: 8 }} />
            <Switch checked={draft.privacy.calendar_detection} onChange={(v) => set('privacy', 'calendar_detection', v)} label="Suggest calendar items detected in conversations" />
            <div style={{ marginTop: 10 }}><Button variant="primary" onClick={() => save('privacy')}>Save</Button></div>
          </section>

          <section id="set-startup" className="card" style={{ marginBottom: 16 }}>
            <h3>Startup & updates</h3>
            <Switch checked={draft.startup.launch_at_login} onChange={(v) => { set('startup', 'launch_at_login', v); window.mentor?.setLoginItem?.(v); }} label="Launch Mentor at login" />
            <div style={{ height: 8 }} />
            <Switch checked={draft.startup.minimize_to_tray} onChange={(v) => set('startup', 'minimize_to_tray', v)} label="Closing the window keeps Mentor running in the system tray" />
            <div style={{ height: 8 }} />
            <Switch checked={draft.startup.check_updates} onChange={(v) => set('startup', 'check_updates', v)} label="Notify me when updates are available" />
            <div className="row" style={{ marginTop: 10 }}>
              <Button variant="primary" onClick={() => save('startup')}>Save</Button>
              <Button onClick={async () => { const r = window.mentor?.checkUpdates ? await window.mentor.checkUpdates() : await api.get('/api/updates/check'); toast(r.update_available ? `Update ${r.latest} available` : `You're on the latest version (${r.current})`, 'success'); }}>Check for updates</Button>
              {appInfo && <span className="faint small">App v{appInfo.version} · {appInfo.platform}</span>}
            </div>
          </section>

          <section id="set-status" className="card" style={{ marginBottom: 40 }}>
            <h3>System status</h3>
            {health ? (
              <div className="small">
                <div className="health-row"><StatusDot status="ok" /> Engine v{health.version} · up {Math.round(health.uptime / 60)} min</div>
                <div className="health-row"><StatusDot status={health.provider === 'demo' ? 'yellow' : 'ok'} /> Provider: {health.provider} · routing {health.routing_mode}</div>
                <div className="health-row"><StatusDot status="ok" /> Data directory: <span className="mono">{health.data_dir}</span></div>
              </div>
            ) : <div className="row"><StatusDot status="error" /> Engine not reachable</div>}
            <div className="row" style={{ marginTop: 10 }}>
              <Button icon={RefreshCw} onClick={reloadHealth}>Refresh</Button>
              {window.mentor?.restartEngine && <Button onClick={() => run(async () => { await window.mentor.restartEngine(); reloadHealth(); }, 'Engine restarted')}>Restart engine</Button>}
              {window.mentor?.openPath && health && <Button onClick={() => window.mentor.openPath(health.data_dir)}>Open data folder</Button>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
