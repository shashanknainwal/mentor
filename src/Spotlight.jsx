// Spotlight: a small always-on-top window (Ctrl/Cmd+Shift+Space from any app) for quick questions.
import { useEffect, useRef, useState } from 'react';
import { api } from './lib/api.js';
import { Markdown } from './components/Markdown.jsx';
import { Spinner } from './components/ui.jsx';
import './styles.css';

export default function Spotlight() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const input = useRef(null);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light';
    document.body.style.background = 'transparent';
    const off = window.mentor?.on?.('spotlight:open', () => {
      setQ('');
      setAnswer(null);
      setTimeout(() => input.current?.focus(), 30);
    });
    input.current?.focus();
    const onKey = (e) => e.key === 'Escape' && window.mentor?.hideSpotlight?.();
    window.addEventListener('keydown', onKey);
    return () => {
      off?.();
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const ask = async () => {
    if (!q.trim()) return;
    setBusy(true);
    try {
      setAnswer(await api.post('/api/quick-ask', { text: q }));
    } catch (e) {
      setAnswer({ text: `**Error:** ${e.message}` });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="spotlight">
      <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && ask()} placeholder="Ask Mentor…  (Enter to ask · Esc to close)" />
      <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}>
        {busy && <div className="row muted"><Spinner /> Thinking…</div>}
        {answer && <Markdown>{answer.text}</Markdown>}
        {!busy && !answer && <div className="faint small">Quick answers without leaving what you’re doing. Results are saved as a chat you can continue.</div>}
      </div>
      {answer?.session_id && (
        <div style={{ padding: '8px 20px', borderTop: '1px solid var(--border)' }}>
          <button className="btn sm" onClick={() => window.mentor?.openChatFromSpotlight?.(answer.session_id)}>Continue in Mentor →</button>
        </div>
      )}
    </div>
  );
}
