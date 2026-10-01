import { useEffect, useState } from 'react';
import { CalendarClock, Pause, Play, Plus, Trash2, Pencil } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, Switch, fmtTime, useAsync, useLoad } from '../components/ui.jsx';
import { Markdown } from '../components/Markdown.jsx';
import { useApp } from '../lib/store.js';

function TaskEditor({ task, onClose, onSaved }) {
  const [form, setForm] = useState(task || { name: '', prompt: '', schedule: 'weekdays at 8am', agent_id: '', project_id: '' });
  const [agents] = useLoad('/api/agents');
  const [projects] = useLoad('/api/projects');
  const [preview, setPreview] = useState(null);
  const [run, busy] = useAsync();
  useEffect(() => {
    const t = setTimeout(() => {
      if (!form.schedule) return setPreview(null);
      api.get(`/api/schedule/parse${qs({ text: form.schedule })}`).then(setPreview).catch((e) => setPreview({ error: e.message }));
    }, 300);
    return () => clearTimeout(t);
  }, [form.schedule]);
  const save = () => run(async () => {
    const body = { ...form, agent_id: form.agent_id || null, project_id: form.project_id || null };
    task ? await api.patch(`/api/tasks/${task.id}`, body) : await api.post('/api/tasks', body);
    onSaved();
  }, 'Task saved');
  return (
    <Modal title={task ? 'Edit task' : 'New scheduled task'} onClose={onClose} footer={<Button variant="primary" disabled={!form.prompt || !preview?.cron || busy} onClick={save}>Save</Button>}>
      <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Morning digest" /></Field>
      <Field label="Prompt" hint="Anything you could type in chat. It runs with full tool access (approval-gated tools are skipped).">
        <textarea className="textarea" value={form.prompt} onChange={(e) => setForm({ ...form, prompt: e.target.value })} placeholder="Summarise today’s calendar and any overnight scheduled results." />
      </Field>
      <Field label="Schedule" hint={preview?.error ? <span style={{ color: 'var(--err)' }}>{preview.error}</span> : preview ? `cron ${preview.cron} · next: ${preview.next_run_label}` : ' '}>
        <input className="input" value={form.schedule} onChange={(e) => setForm({ ...form, schedule: e.target.value })} />
      </Field>
      <div className="grid cols-2">
        <Field label="Run as agent (optional)">
          <select className="select" value={form.agent_id || ''} onChange={(e) => setForm({ ...form, agent_id: e.target.value })}>
            <option value="">Mentor (default)</option>
            {(agents || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="Project context (optional)">
          <select className="select" value={form.project_id || ''} onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">None</option>
            {(projects || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </Field>
      </div>
    </Modal>
  );
}

export default function Scheduled() {
  const [tasks, reload] = useLoad('/api/tasks');
  const [runs, reloadRuns] = useLoad('/api/agent-runs?limit=30');
  const [editing, setEditing] = useState(undefined);
  const [viewRun, setViewRun] = useState(null);
  const [run] = useAsync();
  const tz = useApp((s) => s.settings?.user?.timezone);
  return (
    <div className="page">
      <PageHead title="Scheduled" subtitle={`Agents and prompts that run automatically — in your timezone (${tz || 'not set'}).`}>
        <Button variant="primary" icon={Plus} onClick={() => setEditing(null)}>New task</Button>
      </PageHead>
      {!tasks ? <Spinner /> : tasks.length ? (
        <table className="table">
          <thead><tr><th>Task</th><th>Schedule</th><th>Next run</th><th>Last run</th><th>Enabled</th><th /></tr></thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td><strong>{t.name}</strong><div className="faint small">{t.prompt.slice(0, 90)}</div></td>
                <td>{t.schedule}<div className="faint small mono">{t.cron}</div></td>
                <td>{t.enabled ? fmtTime(t.next_run) : '—'}</td>
                <td>{fmtTime(t.last_run)} {t.last_status && <span className={`badge ${t.last_status === 'ok' ? 'green' : 'red'}`}>{t.last_status}</span>}</td>
                <td><Switch checked={t.enabled} onChange={(v) => run(async () => { await api.patch(`/api/tasks/${t.id}`, { enabled: v }); reload(); })} /></td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <Button size="sm" icon={Play} title="Run once now" onClick={() => run(async () => { setViewRun(await api.post(`/api/tasks/${t.id}/run`)); reload(); reloadRuns(); })} />
                  <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setEditing(t)} />
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm('Delete task?') && run(async () => { await api.del(`/api/tasks/${t.id}`); reload(); })} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty icon={CalendarClock} title="Nothing scheduled" action={<Button variant="primary" onClick={() => setEditing(null)}>Create a task</Button>}>
          Try “Every Friday at 4pm, generate the weekly metrics one-pager.” You can also ask Mentor in chat to schedule something.
        </Empty>
      )}
      <div className="section-title">Recent runs</div>
      <table className="table">
        <thead><tr><th>Started</th><th>Trigger</th><th>Input</th><th>Duration</th><th>Status</th></tr></thead>
        <tbody>
          {(runs || []).map((r) => (
            <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setViewRun(r)}>
              <td>{fmtTime(r.started)}</td><td>{r.trigger}</td><td>{(r.input || '').slice(0, 70)}</td><td>{r.duration ?? '…'}s</td>
              <td><span className={`badge ${r.status === 'ok' ? 'green' : r.status === 'error' ? 'red' : 'amber'}`}>{r.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      {editing !== undefined && <TaskEditor task={editing} onClose={() => setEditing(undefined)} onSaved={() => { setEditing(undefined); reload(); }} />}
      {viewRun && (
        <Modal wide title="Run result" onClose={() => setViewRun(null)}
          footer={viewRun.session_id && <Button onClick={() => { useApp.getState().openSession(viewRun.session_id, 'Scheduled run'); setViewRun(null); }}>Open as chat</Button>}>
          <div className="faint small" style={{ marginBottom: 8 }}>Tools: {(viewRun.tools_used || []).join(', ') || 'none'} · {viewRun.duration}s</div>
          <Markdown>{viewRun.output || viewRun.error || ''}</Markdown>
        </Modal>
      )}
    </div>
  );
}
