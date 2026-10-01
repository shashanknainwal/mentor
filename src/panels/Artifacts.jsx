import { useEffect, useState } from 'react';
import { FolderOpen, Images } from 'lucide-react';
import { api, artifactUrl } from '../lib/api.js';
import { Button, Empty, PageHead, Spinner, fmtBytes, fmtTime, useAsync, useLoad } from '../components/ui.jsx';
import { ArtifactPreview, artifactIcon, isImage } from '../components/ArtifactPreview.jsx';

const TYPES = ['all', 'images', 'documents', 'spreadsheets', 'presentations', 'code', 'diagrams', 'shared', 'other'];

function Thumb({ a }) {
  const [src, setSrc] = useState(null);
  useEffect(() => { if (isImage(a)) artifactUrl(a.id).then(setSrc); }, [a]);
  const Icon = artifactIcon(a);
  return <div className="thumb">{src ? <img src={src} alt={a.name} loading="lazy" /> : <Icon size={40} className="faint" />}</div>;
}

export default function Artifacts() {
  const [type, setType] = useState('all');
  const [q, setQ] = useState('');
  const [items, reload] = useLoad(`/api/artifacts${type === 'all' ? '' : `?type=${type}`}`, [type]);
  const [stats, reloadStats] = useLoad('/api/artifacts/stats');
  const [open, setOpen] = useState(null);
  const [run] = useAsync();
  const list = (items || []).filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="page">
      <PageHead title="Artifacts" subtitle={stats ? `Everything Mentor has generated · ${fmtBytes(stats.total_bytes)} in ${stats.path}` : 'Everything Mentor has generated'}>
        {window.mentor?.isDesktop && stats && <Button icon={FolderOpen} onClick={() => window.mentor.openPath(stats.path)}>Open folder</Button>}
      </PageHead>
      <div className="row wrap" style={{ marginBottom: 14 }}>
        {TYPES.map((t) => (
          <Button key={t} size="sm" variant={type === t ? 'primary' : ''} onClick={() => setType(t)}>
            {t[0].toUpperCase() + t.slice(1)} {t !== 'all' && stats?.by_type?.[t] ? `(${stats.by_type[t].count})` : ''}
          </Button>
        ))}
        <input className="input" style={{ maxWidth: 260, marginLeft: 'auto' }} placeholder="Filter by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {!items ? <Spinner /> : list.length ? (
        <div className="gallery">
          {list.map((a) => (
            <div key={a.id} className="tile" onClick={() => setOpen(a)}>
              <Thumb a={a} />
              <div className="meta">
                <div className="n" title={a.name}>{a.name}</div>
                <div className="faint">{fmtBytes(a.size)} · {fmtTime(a.created)}</div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Empty icon={Images} title="No artifacts yet">Ask Mentor to create a document, chart, deck or image — it lands here and in ~/MentorDesktop/artifacts.</Empty>
      )}
      {open && (
        <ArtifactPreview artifact={open} onClose={() => setOpen(null)}
          onDelete={() => confirm(`Permanently delete ${open.name}? There is no recycle bin.`) && run(async () => { await api.del(`/api/artifacts/${open.id}`); setOpen(null); reload(); reloadStats(); }, 'Deleted')} />
      )}
    </div>
  );
}
