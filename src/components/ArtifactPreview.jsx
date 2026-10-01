import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileSpreadsheet, FileText, FolderOpen, Image as ImageIcon, Presentation, Code2, File } from 'lucide-react';
import { api, artifactUrl } from '../lib/api.js';
import { Button, Modal, fmtBytes } from './ui.jsx';
import { Markdown } from './Markdown.jsx';

const TEXT_EXT = /\.(md|txt|csv|json|py|js|ts|sql|sh|mmd|yaml|yml|xml|log)$/i;

export function artifactIcon(a) {
  const n = a?.name || '';
  if (a?.type === 'images' || /\.(png|jpe?g|gif|webp|svg)$/i.test(n)) return ImageIcon;
  if (/\.(xlsx|csv)$/i.test(n)) return FileSpreadsheet;
  if (/\.pptx$/i.test(n)) return Presentation;
  if (/\.(py|js|ts|sql|json|sh)$/i.test(n)) return Code2;
  if (/\.(docx|pdf|md|txt|html)$/i.test(n)) return FileText;
  return File;
}

export const isImage = (a) => /\.(png|jpe?g|gif|webp|svg)$/i.test(a?.name || '');

export function useArtifact(idOrObj) {
  const [a, setA] = useState(typeof idOrObj === 'object' && idOrObj?.name ? idOrObj : null);
  useEffect(() => {
    const id = typeof idOrObj === 'string' ? idOrObj : idOrObj?.id;
    if (!a && id) api.get(`/api/artifacts/${id}`).then(setA).catch(() => setA({ id, name: '(deleted artifact)', missing: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idOrObj]);
  return a;
}

export function ArtifactImage({ artifact, onOpen }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    artifactUrl(artifact.id).then(setSrc);
  }, [artifact.id]);
  if (!src) return null;
  return <img className="artifact-img" src={src} alt={artifact.name} onClick={onOpen} />;
}

export function ArtifactPreview({ artifact, onClose, onDelete }) {
  const [url, setUrl] = useState(null);
  const [text, setText] = useState(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    artifactUrl(artifact.id).then(async (u) => {
      setUrl(u);
      if (TEXT_EXT.test(artifact.name)) setText(await (await fetch(u)).text());
    });
  }, [artifact.id, artifact.name]);

  useEffect(() => {
    if (!isImage(artifact)) return undefined;
    const onKey = (e) => {
      if (e.key === '+' || e.key === '=') setZoom((z) => Math.min(6, z * 1.25));
      if (e.key === '-') setZoom((z) => Math.max(0.2, z / 1.25));
      if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [artifact]);

  const desktop = window.mentor?.isDesktop;
  let body;
  if (!url) body = null;
  else if (isImage(artifact))
    body = (
      <div style={{ overflow: 'auto', maxHeight: '70vh', textAlign: 'center', background: 'var(--bg-sunken)', borderRadius: 8 }}>
        <img src={url} alt={artifact.name} style={{ transform: `scale(${zoom})`, transformOrigin: 'top center', maxWidth: '100%', background: '#fff' }} />
      </div>
    );
  else if (/\.md$/i.test(artifact.name) && text !== null) body = <Markdown>{text}</Markdown>;
  else if (text !== null) body = <pre className="code-block">{text}</pre>;
  else if (/\.(html|pdf)$/i.test(artifact.name)) body = <iframe title={artifact.name} src={url} style={{ width: '100%', height: '65vh', border: 0, background: '#fff', borderRadius: 8 }} />;
  else
    body = (
      <div className="empty">
        <p>
          {artifact.name} ({fmtBytes(artifact.size)}) opens in its native app{desktop ? '' : ' — download it to view'}.
        </p>
      </div>
    );

  return (
    <Modal
      wide
      title={artifact.name}
      onClose={onClose}
      footer={
        <>
          {isImage(artifact) && <span className="faint small" style={{ marginRight: 'auto' }}>Zoom: + / − / 0</span>}
          {onDelete && (
            <Button variant="danger" onClick={onDelete}>
              Delete
            </Button>
          )}
          {desktop && artifact.path && (
            <>
              <Button icon={FolderOpen} onClick={() => window.mentor.showItemInFolder(artifact.path)}>
                Show in folder
              </Button>
              <Button icon={ExternalLink} onClick={() => window.mentor.openPath(artifact.path)}>
                Open
              </Button>
            </>
          )}
          <Button variant="primary" icon={Download} onClick={async () => window.open(await artifactUrl(artifact.id, true))}>
            Download
          </Button>
        </>
      }
    >
      {body}
    </Modal>
  );
}

export function ArtifactChip({ id, artifact: given }) {
  const a = useArtifact(given || id);
  const [open, setOpen] = useState(false);
  if (!a) return null;
  const Icon = artifactIcon(a);
  return (
    <>
      {isImage(a) && !a.missing ? (
        <ArtifactImage artifact={a} onOpen={() => setOpen(true)} />
      ) : (
        <span className="artifact-card" onClick={() => !a.missing && setOpen(true)}>
          <Icon size={18} />
          <span>
            <div style={{ fontWeight: 600, fontSize: 13 }}>{a.name}</div>
            {a.size !== undefined && <div className="faint small">{fmtBytes(a.size)}</div>}
          </span>
        </span>
      )}
      {open && <ArtifactPreview artifact={a} onClose={() => setOpen(false)} />}
    </>
  );
}
