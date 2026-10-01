import { useState } from 'react';
import { Database, FileText, Search, Trash2, Upload } from 'lucide-react';
import { api, qs } from '../lib/api.js';
import { Button, Empty, PageHead, Spinner, StatusDot, fmtBytes, fmtTime, pickFile, useAsync, useLoad } from '../components/ui.jsx';

export default function Data() {
  const [docs, reload] = useLoad('/api/kb');
  const [q, setQ] = useState('');
  const [hits, setHits] = useState(null);
  const [run, busy] = useAsync();
  const [drag, setDrag] = useState(false);

  const upload = async (files) => {
    for (const f of files) await run(() => api.upload('/api/kb', f));
    reload();
  };

  return (
    <div className="page" onDragOver={(e) => (e.preventDefault(), setDrag(true))} onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); upload([...e.dataTransfer.files]); }}>
      <PageHead title="Data — Knowledge Base" subtitle="Upload reference documents (policies, methodologies, reports). Mentor searches them when relevant. Everything stays on this machine.">
        <Button variant="primary" icon={Upload} disabled={busy} onClick={async () => upload(await pickFile())}>{busy ? 'Indexing…' : 'Upload documents'}</Button>
      </PageHead>
      <div className="row" style={{ marginBottom: 14 }}>
        <input className="input" placeholder="Test a search across your knowledge base…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run(async () => setHits(await api.get(`/api/kb/search${qs({ q })}`)))} />
        <Button icon={Search} onClick={() => run(async () => setHits(await api.get(`/api/kb/search${qs({ q })}`)))}>Search</Button>
      </div>
      {hits && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>Top matches</div>
          {hits.length ? hits.map((h) => (
            <div key={h.id} style={{ marginBottom: 10 }}>
              <div className="row small"><FileText size={13} /> <strong>{h.meta?.name}</strong> <span className="faint">score {h.score.toFixed(2)}</span></div>
              <div className="desc" style={{ whiteSpace: 'pre-wrap' }}>{h.text.slice(0, 400)}…</div>
            </div>
          )) : <div className="faint">No matches.</div>}
        </div>
      )}
      <div className={drag ? 'card' : ''} style={drag ? { borderStyle: 'dashed', borderColor: 'var(--kpmg-light)' } : {}}>
        {!docs ? <Spinner /> : docs.length ? (
          <table className="table">
            <thead><tr><th>Document</th><th>Size</th><th>Chunks</th><th>Status</th><th>Added</th><th /></tr></thead>
            <tbody>
              {docs.map((d) => (
                <tr key={d.id}>
                  <td><FileText size={13} /> {d.name}</td>
                  <td>{fmtBytes(d.size)}</td>
                  <td>{d.chunks}</td>
                  <td><StatusDot status={d.status} /> {d.status}{d.error ? ` — ${d.error}` : ''}</td>
                  <td>{fmtTime(d.created)}</td>
                  <td style={{ textAlign: 'right' }}><Button size="sm" variant="ghost" icon={Trash2} onClick={() => confirm(`Remove ${d.name}?`) && run(async () => { await api.del(`/api/kb/${d.id}`); reload(); })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty icon={Database} title="Your knowledge base is empty">Drag PDFs, Word, Excel, PowerPoint or text files here. For work scoped to an engagement, use a Project instead.</Empty>
        )}
      </div>
    </div>
  );
}
