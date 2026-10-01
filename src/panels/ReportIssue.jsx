import { useState } from 'react';
import { Flag } from 'lucide-react';
import { api } from '../lib/api.js';
import { Button, Field, PageHead, fmtTime, useAsync, useLoad } from '../components/ui.jsx';

export default function ReportIssue() {
  const [form, setForm] = useState({ title: '', description: '', severity: 'medium', area: 'Chat' });
  const [done, setDone] = useState(null);
  const [run, busy] = useAsync();
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <PageHead title="Report an issue" subtitle="Diagnostics and recent logs are attached automatically (no conversation content, secrets masked)." />
      {done ? (
        <div className="card">
          <h3><Flag size={16} /> Issue filed</h3>
          <p className="desc">Bundle saved to <span className="mono">{done.bundle}</span>. Send it to the Mentor support channel, or attach it to your ticket.</p>
          <div className="row">
            {window.mentor?.showItemInFolder && <Button onClick={() => window.mentor.showItemInFolder(done.bundle)}>Show bundle</Button>}
            <Button onClick={() => { setDone(null); setForm({ ...form, title: '', description: '' }); }}>Report another</Button>
          </div>
        </div>
      ) : (
        <div className="card">
          <Field label="Summary"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Excel export fails for large tables" /></Field>
          <div className="grid cols-2">
            <Field label="Area"><select className="select" value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })}>{['Chat', 'Projects', 'Agents', 'Scheduled', 'Memory', 'Data', 'Integrations', 'Presentations', 'Settings', 'Other'].map((a) => <option key={a}>{a}</option>)}</select></Field>
            <Field label="Severity"><select className="select" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>{['low', 'medium', 'high', 'blocking'].map((a) => <option key={a}>{a}</option>)}</select></Field>
          </div>
          <Field label="What happened? What did you expect?"><textarea className="textarea" style={{ minHeight: 160 }} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Button variant="primary" disabled={!form.title || busy} onClick={() => run(async () => setDone(await api.post('/api/issues', form)))}>Submit report</Button>
        </div>
      )}
      <PastIssues />
    </div>
  );
}

function PastIssues() {
  const [issues] = useLoad('/api/issues');
  if (!issues?.length) return null;
  return (
    <>
      <div className="section-title">Your reports</div>
      <table className="table">
        <tbody>{issues.map((i) => <tr key={i.id}><td>{i.title}</td><td><span className="badge">{i.severity}</span></td><td className="small faint">{fmtTime(i.created)}</td></tr>)}</tbody>
      </table>
    </>
  );
}
