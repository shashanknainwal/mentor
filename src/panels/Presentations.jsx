import { useEffect, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Plus, Presentation, Trash2, Upload, Sparkles } from 'lucide-react';
import { api, artifactUrl } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { Button, Empty, Field, PageHead, Spinner, fmtTime, pickFile, useAsync, useLoad } from '../components/ui.jsx';

const THEMES = {
  kpmg: { bg: '#FFFFFF', title: '#00338D', text: '#1E1E1E', accent: '#0091DA' },
  midnight: { bg: '#0C1A3A', title: '#FFFFFF', text: '#DCE3F2', accent: '#00B8F5' },
  minimal: { bg: '#FAFAFA', title: '#111111', text: '#333333', accent: '#7213EA' },
};
const LAYOUTS = ['title', 'bullets', 'two_column', 'section', 'quote', 'closing'];
const newId = () => `sld_${Math.random().toString(36).slice(2, 10)}`;

function SlideView({ s, theme, scale = 1 }) {
  const t = THEMES[theme] || THEMES.kpmg;
  const big = ['title', 'section', 'closing', 'quote'].includes(s.layout);
  return (
    <div className="slide-canvas" style={{ background: t.bg, color: t.text, fontSize: 16 * scale, justifyContent: big ? 'center' : 'flex-start' }}>
      <div style={{ height: 4 * scale, width: 60 * scale, background: t.accent, marginBottom: 12 * scale, borderRadius: 2 }} />
      <div style={{ color: t.title, fontWeight: 700, fontSize: (big ? 2.4 : 1.7) * 16 * scale, lineHeight: 1.15, marginBottom: 10 * scale }}>
        {s.layout === 'quote' ? `“${s.title}”` : s.title || <span style={{ opacity: 0.4 }}>Untitled slide</span>}
      </div>
      {s.subtitle && <div style={{ fontSize: 1.15 * 16 * scale, opacity: 0.85 }}>{s.layout === 'quote' ? `— ${s.subtitle}` : s.subtitle}</div>}
      {!big && (
        <div style={{ display: 'grid', gridTemplateColumns: s.layout === 'two_column' ? '1fr 1fr' : '1fr', gap: 20 * scale }}>
          {[s.bullets, ...(s.layout === 'two_column' ? [s.right] : [])].map((col, i) => (
            <ul key={i} style={{ margin: 0, paddingLeft: 22 * scale, lineHeight: 1.5 }}>
              {(col || []).map((b, j) => <li key={j}>{b}</li>)}
            </ul>
          ))}
        </div>
      )}
    </div>
  );
}

function DeckEditor({ id, onBack }) {
  const [deck, setDeck] = useState(null);
  const [sel, setSel] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [run, busy] = useAsync();
  useEffect(() => { api.get(`/api/decks/${id}`).then(setDeck); }, [id]);
  if (!deck) return <div className="page"><Spinner /></div>;
  const s = deck.slides[sel] || deck.slides[0];
  const update = (patch) => { setDeck({ ...deck, ...patch }); setDirty(true); };
  const updateSlide = (patch) => update({ slides: deck.slides.map((x, i) => (i === sel ? { ...x, ...patch } : x)) });
  const save = () => run(async () => { setDeck(await api.put(`/api/decks/${id}`, deck)); setDirty(false); }, 'Saved');
  const exportPptx = () => run(async () => {
    if (dirty) await api.put(`/api/decks/${id}`, deck);
    const art = await api.post(`/api/decks/${id}/export`);
    window.open(await artifactUrl(art.id, true));
    setDirty(false);
  }, 'Exported to Artifacts');
  const moveSlide = (dir) => {
    const j = sel + dir;
    if (j < 0 || j >= deck.slides.length) return;
    const slides = [...deck.slides];
    [slides[sel], slides[j]] = [slides[j], slides[sel]];
    update({ slides });
    setSel(j);
  };

  return (
    <div className="page" style={{ maxWidth: 1400 }}>
      <Button variant="ghost" size="sm" icon={ArrowLeft} onClick={onBack}>All decks</Button>
      <div className="row" style={{ margin: '8px 0 14px' }}>
        <input className="input" style={{ fontSize: 18, fontWeight: 700, maxWidth: 520 }} value={deck.title} onChange={(e) => update({ title: e.target.value })} />
        <select className="select" style={{ width: 140 }} value={deck.theme} onChange={(e) => update({ theme: e.target.value })}>{Object.keys(THEMES).map((t) => <option key={t}>{t}</option>)}</select>
        <span style={{ flex: 1 }} />
        <Button disabled={!dirty || busy} onClick={save}>{dirty ? 'Save' : 'Saved'}</Button>
        <Button variant="primary" icon={Download} disabled={busy} onClick={exportPptx}>Export .pptx</Button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0,1fr) 320px', gap: 16 }}>
        <div className="list" style={{ maxHeight: '72vh', overflow: 'auto' }}>
          {deck.slides.map((x, i) => (
            <div key={x.id} onClick={() => setSel(i)}>
              <div className="faint small">{i + 1}</div>
              <div className={`slide-thumb ${i === sel ? 'active' : ''}`} style={{ padding: 0 }}><SlideView s={x} theme={deck.theme} scale={0.22} /></div>
            </div>
          ))}
          <Button size="sm" icon={Plus} onClick={() => { update({ slides: [...deck.slides, { id: newId(), layout: 'bullets', title: 'New slide', bullets: [], right: [], notes: '' }] }); setSel(deck.slides.length); }}>Add slide</Button>
        </div>
        <div><SlideView s={s} theme={deck.theme} /><div className="card" style={{ marginTop: 12 }}><div className="faint small">Speaker notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{s.notes || '—'}</div></div></div>
        <div className="card">
          <Field label="Layout"><select className="select" value={s.layout} onChange={(e) => updateSlide({ layout: e.target.value })}>{LAYOUTS.map((l) => <option key={l}>{l}</option>)}</select></Field>
          <Field label="Title"><input className="input" value={s.title} onChange={(e) => updateSlide({ title: e.target.value })} /></Field>
          <Field label="Subtitle"><input className="input" value={s.subtitle || ''} onChange={(e) => updateSlide({ subtitle: e.target.value })} /></Field>
          <Field label={s.layout === 'two_column' ? 'Left column (one per line)' : 'Bullets (one per line)'}>
            <textarea className="textarea" value={(s.bullets || []).join('\n')} onChange={(e) => updateSlide({ bullets: e.target.value.split('\n') })} />
          </Field>
          {s.layout === 'two_column' && <Field label="Right column"><textarea className="textarea" value={(s.right || []).join('\n')} onChange={(e) => updateSlide({ right: e.target.value.split('\n') })} /></Field>}
          <Field label="Speaker notes"><textarea className="textarea" value={s.notes || ''} onChange={(e) => updateSlide({ notes: e.target.value })} /></Field>
          <div className="row">
            <Button size="sm" icon={ArrowUp} onClick={() => moveSlide(-1)} />
            <Button size="sm" icon={ArrowDown} onClick={() => moveSlide(1)} />
            <Button size="sm" icon={Copy} onClick={() => { const slides = [...deck.slides]; slides.splice(sel + 1, 0, { ...s, id: newId() }); update({ slides }); setSel(sel + 1); }} />
            <Button size="sm" variant="danger" icon={Trash2} disabled={deck.slides.length < 2} onClick={() => { update({ slides: deck.slides.filter((_, i) => i !== sel) }); setSel(Math.max(0, sel - 1)); }} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Presentations() {
  const [decks, reload] = useLoad('/api/decks');
  const [openId, setOpenId] = useState(null);
  const [run] = useAsync();
  const { newChat, setComposerDraft, setView } = useApp();
  if (openId) return <DeckEditor id={openId} onBack={() => { setOpenId(null); reload(); }} />;
  return (
    <div className="page">
      <PageHead title="Presentations" subtitle="Slide decks Mentor drafted for you — edit them here and export real, editable PowerPoint.">
        <Button icon={Sparkles} onClick={async () => { await newChat({ title: 'New deck' }); setComposerDraft({ text: 'Create a 6-slide deck on ' }); setView('chat'); }}>Draft with AI</Button>
        <Button icon={Upload} onClick={async () => { const [f] = await pickFile('.pptx'); if (f) run(async () => { const d = await api.upload('/api/decks/import', f); setOpenId(d.id); }, 'Imported'); }}>Import .pptx</Button>
        <Button variant="primary" icon={Plus} onClick={() => run(async () => { const d = await api.post('/api/decks', { title: 'Untitled deck' }); setOpenId(d.id); })}>New deck</Button>
      </PageHead>
      {!decks ? <Spinner /> : decks.length ? (
        <div className="grid cards">
          {decks.map((d) => (
            <div key={d.id} className="card hover" style={{ padding: 10 }} onClick={() => setOpenId(d.id)}>
              {d.slides[0] && <div className="slide-thumb" style={{ padding: 0 }}><SlideView s={d.slides[0]} theme={d.theme} scale={0.35} /></div>}
              <div className="row" style={{ marginTop: 8 }}>
                <div className="grow"><strong>{d.title}</strong><div className="faint small">{d.slides.length} slides · {fmtTime(d.updated)}</div></div>
                <Button size="sm" variant="ghost" icon={Trash2} onClick={(e) => { e.stopPropagation(); confirm('Delete deck?') && run(async () => { await api.del(`/api/decks/${d.id}`); reload(); }); }} />
              </div>
            </div>
          ))}
        </div>
      ) : <Empty icon={Presentation} title="No decks yet">Ask in chat: “Create a 6-slide deck on our Q3 project status.”</Empty>}
    </div>
  );
}
