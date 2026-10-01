import { useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, X, Sparkles } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Field, Modal, PageHead, Switch, useAsync, useLoad } from '../components/ui.jsx';

const KINDS = ['event', 'task', 'reminder', 'deadline'];
const pad = (n) => String(n).padStart(2, '0');
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function EventEditor({ ev, onClose, onSaved }) {
  const [e, setE] = useState(ev);
  const [run, busy] = useAsync();
  const save = () => run(async () => { e.id ? await api.patch(`/api/calendar/${e.id}`, e) : await api.post('/api/calendar', e); onSaved(); }, 'Saved');
  return (
    <Modal title={e.id ? 'Edit item' : 'New item'} onClose={onClose}
      footer={<>{e.id && <Button variant="danger" icon={Trash2} onClick={() => run(async () => { await api.del(`/api/calendar/${e.id}`); onSaved(); })}>Delete</Button>}<Button variant="primary" disabled={!e.title || busy} onClick={save}>Save</Button></>}>
      <Field label="Title"><input className="input" autoFocus value={e.title} onChange={(x) => setE({ ...e, title: x.target.value })} /></Field>
      <div className="grid cols-3">
        <Field label="Type"><select className="select" value={e.kind} onChange={(x) => setE({ ...e, kind: x.target.value })}>{KINDS.map((k) => <option key={k}>{k}</option>)}</select></Field>
        <Field label="Start"><input className="input" type="datetime-local" value={e.start?.slice(0, 16)} onChange={(x) => setE({ ...e, start: x.target.value })} /></Field>
        <Field label="End"><input className="input" type="datetime-local" value={e.end?.slice(0, 16) || ''} onChange={(x) => setE({ ...e, end: x.target.value })} /></Field>
      </div>
      <Field label="Location"><input className="input" value={e.location || ''} onChange={(x) => setE({ ...e, location: x.target.value })} /></Field>
      <Field label="Notes"><textarea className="textarea" value={e.notes || ''} onChange={(x) => setE({ ...e, notes: x.target.value })} /></Field>
      {e.kind !== 'event' && <Switch checked={e.done} onChange={(v) => setE({ ...e, done: v })} label="Done" />}
    </Modal>
  );
}

export default function CalendarPanel() {
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(new Date());
  const [editing, setEditing] = useState(null);
  const [nl, setNl] = useState('');
  const [run] = useAsync();
  const { newChat, setComposerDraft, setView: setAppView, saveSettings, settings } = useApp();

  const range = useMemo(() => {
    const d = new Date(cursor);
    if (view === 'month') {
      const first = new Date(d.getFullYear(), d.getMonth(), 1);
      const start = new Date(first);
      start.setDate(1 - ((first.getDay() + 6) % 7));
      const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      return { days, start: days[0], end: days.at(-1) };
    }
    if (view === 'week') {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
      const days = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
      return { days, start, end: days.at(-1) };
    }
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return { days: [start], start, end: start };
  }, [cursor, view]);

  const endIso = isoLocal(new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate(), 23, 59));
  const [events, reload] = useLoad(`/api/calendar${qs({ start: isoLocal(range.start), end: endIso })}`, [range.start.getTime(), view]);
  const [suggestions, reloadSug] = useLoad('/api/calendar-suggestions');
  const evs = events || [];
  const move = (dir) => {
    const d = new Date(cursor);
    if (view === 'month') d.setMonth(d.getMonth() + dir);
    else d.setDate(d.getDate() + dir * (view === 'week' ? 7 : 1));
    setCursor(d);
  };
  const newAt = (day) => setEditing({ title: '', kind: 'event', start: isoLocal(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)), end: '', notes: '', done: false });
  const dayEvents = (day) => evs.filter((e) => sameDay(new Date(e.start), day));
  const title = view === 'month' ? cursor.toLocaleDateString([], { month: 'long', year: 'numeric' }) : view === 'week' ? `Week of ${range.start.toLocaleDateString([], { day: 'numeric', month: 'short' })}` : cursor.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="page">
      <PageHead title="Calendar & Tasks" subtitle="Events, tasks, reminders and deadlines. Mentor can suggest items it spots in your chats — you approve them.">
        <Button variant="primary" icon={Plus} onClick={() => newAt(new Date())}>New</Button>
      </PageHead>

      <div className="row" style={{ marginBottom: 12 }}>
        <input className="input" placeholder='Natural language: "Schedule a review meeting next Tuesday at 3pm"' value={nl} onChange={(e) => setNl(e.target.value)}
          onKeyDown={async (e) => { if (e.key === 'Enter' && nl) { await newChat({ title: 'Calendar' }); setComposerDraft({ text: nl }); setAppView('chat'); setNl(''); } }} />
        <Button icon={Sparkles} disabled={!nl} onClick={async () => { await newChat({ title: 'Calendar' }); setComposerDraft({ text: nl }); setAppView('chat'); setNl(''); }}>Ask Mentor</Button>
      </div>

      {suggestions?.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--kpmg-light)' }}>
          <div className="row" style={{ marginBottom: 6 }}><Sparkles size={16} /><strong>Suggested from your conversations</strong>
            <span style={{ marginLeft: 'auto' }}><Switch checked={settings?.privacy?.calendar_detection} onChange={(v) => saveSettings({ privacy: { calendar_detection: v } })} label="Detect" /></span></div>
          {suggestions.map((s) => (
            <div key={s.id} className="health-row">
              <span className="badge">{s.kind || 'event'}</span><span className="grow">{s.title}</span><span className="faint small">{s.start}</span>
              <Button size="sm" variant="primary" icon={Check} onClick={() => run(async () => { await api.post(`/api/calendar-suggestions/${s.id}`, { approve: true }); reload(); reloadSug(); })}>Add</Button>
              <Button size="sm" variant="ghost" icon={X} onClick={() => run(async () => { await api.post(`/api/calendar-suggestions/${s.id}`, { approve: false }); reloadSug(); })} />
            </div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 10 }}>
        <Button size="sm" icon={ChevronLeft} onClick={() => move(-1)} />
        <Button size="sm" onClick={() => setCursor(new Date())}>Today</Button>
        <Button size="sm" icon={ChevronRight} onClick={() => move(1)} />
        <h3 style={{ margin: '0 8px' }}>{title}</h3>
        <span style={{ flex: 1 }} />
        {['month', 'week', 'day'].map((v) => <Button key={v} size="sm" variant={view === v ? 'primary' : ''} onClick={() => setView(v)}>{v[0].toUpperCase() + v.slice(1)}</Button>)}
      </div>

      {view === 'month' ? (
        <div className="cal-grid">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="dow">{d}</div>)}
          {range.days.map((day) => (
            <div key={day.toISOString()} className={`cal-cell ${day.getMonth() !== cursor.getMonth() ? 'other' : ''} ${sameDay(day, new Date()) ? 'today' : ''}`} onDoubleClick={() => newAt(day)}>
              <span className="num">{day.getDate()}</span>
              {dayEvents(day).slice(0, 4).map((e) => (
                <span key={e.id} className={`cal-ev ${e.kind} ${e.done ? 'done' : ''}`} onClick={(x) => (x.stopPropagation(), setEditing(e))} title={e.title}>
                  {!e.all_day && new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {e.title}
                </span>
              ))}
              {dayEvents(day).length > 4 && <span className="faint small">+{dayEvents(day).length - 4} more</span>}
            </div>
          ))}
        </div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: `repeat(${range.days.length}, minmax(0,1fr))` }}>
          {range.days.map((day) => (
            <div key={day.toISOString()} className="card" style={{ minHeight: 360, padding: 10 }} onDoubleClick={() => newAt(day)}>
              <div className="row" style={{ marginBottom: 8 }}><strong>{day.toLocaleDateString([], { weekday: 'short', day: 'numeric' })}</strong>{sameDay(day, new Date()) && <span className="badge blue">today</span>}</div>
              {dayEvents(day).map((e) => (
                <div key={e.id} className={`cal-ev ${e.kind} ${e.done ? 'done' : ''}`} style={{ padding: '4px 6px', marginBottom: 4, whiteSpace: 'normal' }} onClick={() => setEditing(e)}>
                  <div style={{ fontWeight: 600 }}>{e.title}</div>
                  <div style={{ opacity: 0.85 }}>{e.all_day ? 'All day' : `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}–${new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}{e.location ? ` · ${e.location}` : ''}</div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      <div className="faint small" style={{ marginTop: 8 }}>Double-click a day to add. Connect Outlook via the Microsoft 365 connector (Capabilities) to work with your real calendar.</div>
      {editing && <EventEditor ev={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} />}
    </div>
  );
}
