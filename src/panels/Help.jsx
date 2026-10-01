import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DOCS } from '../help/docs.js';
import { Markdown } from '../components/Markdown.jsx';

export default function Help() {
  const [id, setId] = useState('getting-started');
  const [q, setQ] = useState('');
  const results = useMemo(() => {
    if (!q) return DOCS;
    const t = q.toLowerCase();
    return DOCS.filter((d) => d.title.toLowerCase().includes(t) || d.body.toLowerCase().includes(t));
  }, [q]);
  const doc = DOCS.find((d) => d.id === id) || DOCS[0];
  const groups = [...new Set(results.map((d) => d.group))];

  return (
    <div className="page" style={{ maxWidth: 1200 }}>
      <div className="split" style={{ gridTemplateColumns: '260px minmax(0,1fr)' }}>
        <div>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Help Center</h1>
          <div className="row" style={{ marginBottom: 10 }}>
            <Search size={15} />
            <input className="input" placeholder="Search help…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {groups.map((g) => (
            <div key={g}>
              <div className="section-title" style={{ margin: '12px 0 4px' }}>{g}</div>
              <div className="list">
                {results.filter((d) => d.group === g).map((d) => (
                  <div key={d.id} className={`list-item ${d.id === id ? 'active' : ''}`} onClick={() => setId(d.id)}>{d.title}</div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <article
          className="card"
          style={{ padding: '22px 28px' }}
          onClick={(e) => {
            const a = e.target.closest('a');
            const href = a?.getAttribute('href');
            if (href?.startsWith('#')) {
              e.preventDefault();
              setId(href.slice(1));
            }
          }}
        >
          <h1 style={{ marginTop: 0 }}>{doc.title}</h1>
          <Markdown>{doc.body}</Markdown>
        </article>
      </div>
    </div>
  );
}
