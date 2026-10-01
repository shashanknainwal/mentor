import { useEffect, useMemo, useRef, useState } from 'react';
import { Brain, Folder, Network, Plus, Search, Trash2, User, Users } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, Modal, PageHead, Spinner, Tabs, fmtTime, useAsync, useLoad } from '../components/ui.jsx';
import { FolderManager } from './Settings.jsx';

function SearchTab() {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [mems, reload] = useLoad(`/api/memory${query ? qs({ q: query }) : ''}`, [query]);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const [run] = useAsync();
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" placeholder="Search by meaning — “my preferences”, “what do you know about Project Atlas”" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(q)} />
        <Button icon={Search} onClick={() => setQuery(q)}>Search</Button>
        <Button icon={Plus} onClick={() => setAdding(true)}>Add memory</Button>
        <Button variant="danger" icon={Trash2} onClick={() => confirm('Wipe ALL memories? This cannot be undone.') && run(async () => { await api.del('/api/memory'); reload(); }, 'Memory wiped')}>Wipe all</Button>
      </div>
      {!mems ? <Spinner /> : mems.length ? (
        <table className="table">
          <thead><tr><th>Memory</th><th>Kind</th><th>Topics</th><th>Captured</th>{query && <th>Score</th>}<th /></tr></thead>
          <tbody>
            {mems.map((m) => (
              <tr key={m.id}>
                <td>{m.text}{m.session_id && <div className="faint small" style={{ cursor: 'pointer' }} onClick={() => useApp.getState().openSession(m.session_id, 'Chat')}>from a conversation ↗</div>}</td>
                <td><span className="badge">{m.kind}</span></td>
                <td className="small">{(m.topics || []).join(', ')}</td>
                <td className="small">{fmtTime(m.created)}</td>
                {query && <td className="small">{m.score}</td>}
                <td><Button size="sm" variant="ghost" icon={Trash2} onClick={() => run(async () => { await api.del(`/api/memory/${m.id}`); reload(); })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Empty icon={Brain} title={query ? 'No related memories' : 'No memories yet'}>Mentor captures preferences, facts and decisions from your chats automatically. Say “remember that…” to be explicit.</Empty>}
      {adding && (
        <Modal title="Add a memory" onClose={() => setAdding(false)} footer={<Button variant="primary" disabled={!text} onClick={() => run(async () => { await api.post('/api/memory', { text }); setAdding(false); setText(''); reload(); })}>Save</Button>}>
          <Field label="What should Mentor remember?"><textarea className="textarea" value={text} onChange={(e) => setText(e.target.value)} placeholder="I lead the Finance Transformation practice in Manchester." /></Field>
        </Modal>
      )}
    </>
  );
}

function PeopleTab() {
  const [people, reload] = useLoad('/api/people');
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [run] = useAsync();
  if (!people) return <Spinner />;
  const list = people.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <input className="input" placeholder="Filter people…" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 360, marginBottom: 14 }} />
      {list.length ? (
        <div className="grid cards">
          {list.map((p) => (
            <div key={p.id} className="card hover" onClick={() => setEdit(p)}>
              <div className="row"><User size={18} /><h3 className="grow" style={{ margin: 0 }}>{p.name}</h3><span className="badge">{p.mentions} mentions</span></div>
              <div className="desc" style={{ marginTop: 6 }}>{[p.title, p.department, p.location].filter(Boolean).join(' · ') || 'No details yet'}</div>
              {p.notes?.length > 0 && <div className="small muted" style={{ marginTop: 6 }}>{p.notes.at(-1)}</div>}
              {p.profile_url && <a className="small" href={p.profile_url} onClick={(e) => e.stopPropagation()} target="_blank" rel="noreferrer">Directory profile ↗</a>}
            </div>
          ))}
        </div>
      ) : <Empty icon={Users} title="No people yet">Person cards appear as colleagues and client contacts come up in your conversations.</Empty>}
      {edit && (
        <Modal title={edit.name} onClose={() => setEdit(null)}
          footer={<>
            <Button variant="danger" onClick={() => run(async () => { await api.del(`/api/people/${edit.id}`); setEdit(null); reload(); })}>Delete</Button>
            <Button variant="primary" onClick={() => run(async () => { await api.patch(`/api/people/${edit.id}`, edit); setEdit(null); reload(); }, 'Saved')}>Save</Button>
          </>}>
          <div className="grid cols-2">
            {['title', 'department', 'location', 'email'].map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}><input className="input" value={edit[k] || ''} onChange={(e) => setEdit({ ...edit, [k]: e.target.value })} /></Field>
            ))}
          </div>
          <Field label="Directory / profile link" hint="e.g. your firm's people directory URL"><input className="input" value={edit.profile_url || ''} onChange={(e) => setEdit({ ...edit, profile_url: e.target.value })} /></Field>
          <Field label="Notes"><textarea className="textarea" value={(edit.notes || []).join('\n')} onChange={(e) => setEdit({ ...edit, notes: e.target.value.split('\n') })} /></Field>
        </Modal>
      )}
    </>
  );
}

const KIND_COLOR = { memory: '#0091DA', person: '#C6007E', topic: '#00A3A1', project: '#483698' };

function GraphTab() {
  const [graph] = useLoad('/api/memory-graph');
  const [hover, setHover] = useState(null);
  const [tick, setTick] = useState(0);
  const sim = useRef(null);
  const W = 1000, H = 620;

  const layout = useMemo(() => {
    if (!graph) return null;
    const nodes = graph.nodes.map((n, i) => ({ ...n, x: W / 2 + Math.cos(i) * 200 * Math.random(), y: H / 2 + Math.sin(i) * 200 * Math.random(), vx: 0, vy: 0 }));
    const idx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
    const edges = graph.edges.filter((e) => e.source in idx && e.target in idx).map((e) => [idx[e.source], idx[e.target]]);
    return { nodes, edges };
  }, [graph]);

  useEffect(() => {
    if (!layout) return undefined;
    let frame = 0;
    const { nodes, edges } = layout;
    const step = () => {
      const alpha = Math.max(0.02, 1 - frame / 220);
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          const d2 = dx * dx + dy * dy + 0.01;
          const f = (900 / d2) * alpha;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      for (const [s, t] of edges) {
        const a = nodes[s], b = nodes[t];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const f = ((d - 70) / d) * 0.04 * alpha;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      for (const n of nodes) {
        n.vx += (W / 2 - n.x) * 0.002 * alpha; n.vy += (H / 2 - n.y) * 0.002 * alpha;
        n.x = Math.max(20, Math.min(W - 20, n.x + n.vx)); n.y = Math.max(20, Math.min(H - 20, n.y + n.vy));
        n.vx *= 0.6; n.vy *= 0.6;
      }
      frame += 1;
      setTick((t) => t + 1);
      if (frame < 260) sim.current = requestAnimationFrame(step);
    };
    sim.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(sim.current);
  }, [layout]);

  if (!graph) return <Spinner />;
  if (!graph.nodes.length) return <Empty icon={Network} title="Nothing to map yet">The graph links memories, people, topics and projects as they accumulate.</Empty>;
  const { nodes, edges } = layout;
  const connected = hover !== null ? new Set(edges.filter(([s, t]) => s === hover || t === hover).flat()) : null;
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }} data-tick={tick}>
      <div className="row small" style={{ padding: '10px 14px', gap: 14 }}>
        {Object.entries(KIND_COLOR).map(([k, c]) => <span key={k} className="row" style={{ gap: 5 }}><span className="dot" style={{ background: c }} />{k}</span>)}
        <span className="faint" style={{ marginLeft: 'auto' }}>{nodes.length} nodes · {edges.length} links — hover to highlight</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', background: 'var(--bg-sunken)' }}>
        {edges.map(([s, t], i) => (
          <line key={i} x1={nodes[s].x} y1={nodes[s].y} x2={nodes[t].x} y2={nodes[t].y} stroke="var(--fg-faint)" strokeOpacity={connected ? (connected.has(s) && connected.has(t) ? 0.9 : 0.08) : 0.35} />
        ))}
        {nodes.map((n, i) => {
          const r = n.kind === 'memory' ? 5 : 7 + Math.min(8, n.weight);
          const dim = connected && !connected.has(i) && hover !== i;
          return (
            <g key={n.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: 'pointer' }} opacity={dim ? 0.2 : 1}>
              <circle cx={n.x} cy={n.y} r={r} fill={KIND_COLOR[n.kind]} stroke="var(--bg-elev)" strokeWidth={1.5} />
              {(n.kind !== 'memory' || hover === i) && <text x={n.x + r + 3} y={n.y + 4} fontSize={11} fill="var(--fg)">{n.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export default function Memory() {
  const [tab, setTab] = useState('search');
  return (
    <div className="page">
      <PageHead title="Memory" subtitle="What Mentor remembers about you and your work. Stored only on this machine — view, search and delete anything." />
      <Tabs value={tab} onChange={setTab} tabs={[{ id: 'search', label: 'Search', icon: Search }, { id: 'people', label: 'People', icon: Users }, { id: 'graph', label: 'Graph', icon: Network }, { id: 'folders', label: 'Folders', icon: Folder }]} />
      {tab === 'search' && <SearchTab />}
      {tab === 'people' && <PeopleTab />}
      {tab === 'graph' && <GraphTab />}
      {tab === 'folders' && <FolderManager defaultSurface="memory" filter={(f) => f.surface === 'memory'} />}
    </div>
  );
}
