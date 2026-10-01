import { useState } from 'react';
import { Activity, CalendarCheck, FolderKanban, MessageSquare, RefreshCw, Sparkles, Sun, Bot, Images, Check, X } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, PageHead, Spinner, fmtTime, useAsync, useLoad } from '../components/ui.jsx';
import { Markdown } from '../components/Markdown.jsx';
import { ArtifactChip } from '../components/ArtifactPreview.jsx';

const ROLES = {
  Partner: { focus: 'Portfolio, pipeline and client relationships', actions: ['Summarise my week across all projects', 'Draft a thank-you note to a client CFO after a steerco', 'What are the biggest risks across my active engagements?'] },
  Director: { focus: 'Engagement delivery, quality and team', actions: ['Prepare a status report for my most active project', 'Draft a proposal outline from the RFP I attach', 'List deadlines in the next 14 days'] },
  Manager: { focus: 'Workplans, deliverables and stakeholders', actions: ['Turn my meeting notes into actions with owners', 'Build a workplan table for a 10-week diagnostic', 'Draft the weekly client update email'] },
  Consultant: { focus: 'Research, analysis and drafting', actions: ['Research the latest trends in UK retail banking with sources', 'Analyse the spreadsheet I attach and chart the key metrics', 'Turn these findings into 5 slides'] },
  Analyst: { focus: 'Data, modelling and documentation', actions: ['Profile this dataset and flag data-quality issues', 'Write Python to reconcile two CSVs', 'Create an Excel summary from this table'] },
};

export default function Dashboard() {
  const [data, reload] = useLoad('/api/dashboard');
  const { settings, saveSettings, newChat, setComposerDraft, setView } = useApp();
  const [briefing, setBriefing] = useState(null);
  const [run, busy] = useAsync();
  const role = settings?.user?.role || 'Director';
  const cfg = ROLES[role] || ROLES.Director;
  if (!data) return <div className="page"><Spinner /></div>;

  const ask = async (text) => {
    await newChat();
    setComposerDraft({ text });
    setView('chat');
  };

  return (
    <div className="page">
      <PageHead title="Mission Control" subtitle={`${role} view — ${cfg.focus}`}>
        <select className="select" style={{ width: 160 }} value={role} onChange={(e) => saveSettings({ user: { role: e.target.value } })}>
          {Object.keys(ROLES).map((r) => <option key={r}>{r}</option>)}
        </select>
        <Button icon={RefreshCw} onClick={reload}>Refresh</Button>
      </PageHead>

      <div className="grid cols-3">
        <div className="card" style={{ gridColumn: 'span 2' }}>
          <div className="row" style={{ marginBottom: 8 }}>
            <Sun size={18} /> <h3 className="grow" style={{ margin: 0 }}>Morning briefing</h3>
            <Button size="sm" variant="primary" disabled={busy} onClick={() => run(async () => setBriefing(await api.post('/api/dashboard/briefing', { role })))}>{busy ? <Spinner /> : null} {briefing ? 'Regenerate' : 'Generate'}</Button>
          </div>
          {briefing ? <Markdown>{briefing.markdown}</Markdown> : <div className="muted">Your day at a glance: calendar, overnight scheduled results and projects to watch.</div>}
          <div className="section-title">Quick actions</div>
          <div className="row wrap">
            {cfg.actions.map((a) => <Button key={a} size="sm" icon={Sparkles} onClick={() => ask(a)}>{a}</Button>)}
          </div>
        </div>
        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}><Activity size={18} /><h3 style={{ margin: 0 }}>System health</h3></div>
          {Object.entries(data.health).map(([k, v]) => (
            <div key={k} className="health-row">
              <span className={`dot ${v.status}`} />
              <span style={{ textTransform: 'capitalize', fontWeight: 600, width: 80 }}>{k}</span>
              <span className="muted small grow">{v.detail}</span>
            </div>
          ))}
          {data.recent_errors.length > 0 && <Button size="sm" variant="ghost" onClick={() => setView('diagnostics')}>{data.recent_errors.length} recent errors → Diagnostics</Button>}
        </div>
      </div>

      <div className="grid cols-3" style={{ marginTop: 14 }}>
        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}><CalendarCheck size={18} /><h3 style={{ margin: 0 }}>Next 7 days</h3></div>
          {data.upcoming.length ? data.upcoming.map((e) => (
            <div key={e.id} className="health-row small">
              <span className="badge">{e.kind}</span><span className="grow">{e.title}</span><span className="faint">{new Date(e.start).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          )) : <div className="faint small">Nothing scheduled.</div>}
          {data.suggestions.length > 0 && (
            <>
              <div className="section-title">Suggested by Mentor</div>
              {data.suggestions.map((s) => (
                <div key={s.id} className="health-row small">
                  <span className="grow">{s.title} <span className="faint">{s.start}</span></span>
                  <Button size="sm" icon={Check} onClick={() => run(async () => { await api.post(`/api/calendar-suggestions/${s.id}`, { approve: true }); reload(); })} />
                  <Button size="sm" variant="ghost" icon={X} onClick={() => run(async () => { await api.post(`/api/calendar-suggestions/${s.id}`, { approve: false }); reload(); })} />
                </div>
              ))}
            </>
          )}
        </div>
        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}><Bot size={18} /><h3 style={{ margin: 0 }}>Recent agent runs</h3></div>
          {data.recent_runs.length ? data.recent_runs.map((r) => (
            <div key={r.id} className="health-row small" style={{ cursor: r.session_id ? 'pointer' : 'default' }} onClick={() => r.session_id && useApp.getState().openSession(r.session_id, 'Run')}>
              <span className={`dot ${r.status === 'ok' ? 'green' : r.status === 'error' ? 'red' : 'yellow'}`} />
              <span className="grow">{(r.input || '').slice(0, 50)}</span><span className="faint">{fmtTime(r.started)}</span>
            </div>
          )) : <div className="faint small">No runs yet. Schedule one in Scheduled.</div>}
        </div>
        <div className="card">
          <div className="row" style={{ marginBottom: 6 }}><Images size={18} /><h3 style={{ margin: 0 }}>Recent artifacts</h3></div>
          {data.recent_artifacts.length ? data.recent_artifacts.map((a) => <div key={a.id}><ArtifactChip artifact={a} /></div>) : <div className="faint small">Generated files appear here.</div>}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', marginTop: 14 }}>
        {[['sessions', MessageSquare, 'chats'], ['projects', FolderKanban, 'projects'], ['agents', Bot, 'agents'], ['skills', Sparkles, 'skills'], ['kb_docs', Activity, 'KB docs'], ['artifacts', Images, 'artifacts'], ['people', Activity, 'people']].map(([k, Icon, label]) => (
          <div key={k} className="card stat"><span className="v">{data.counts[k]}</span><span className="l"><Icon size={12} /> {label}</span></div>
        ))}
      </div>
    </div>
  );
}
