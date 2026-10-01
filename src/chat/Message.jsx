import { useState } from 'react';
import { AtSign, Bot, Check, ChevronDown, ChevronRight, Copy, BookText, Loader2, Paperclip, Slash, Wrench, XCircle, CheckCircle2 } from 'lucide-react';
import { useApp } from '../lib/store.js';
import { Markdown } from '../components/Markdown.jsx';
import { ArtifactChip } from '../components/ArtifactPreview.jsx';

function ToolCall({ part }) {
  const [open, setOpen] = useState(false);
  const Icon = part.status === 'running' ? Loader2 : part.status === 'error' ? XCircle : CheckCircle2;
  const color = part.status === 'error' ? 'var(--err)' : part.status === 'ok' ? 'var(--ok)' : 'var(--fg-muted)';
  const label = part.name.includes('__') ? `${part.name.split('__')[1]} · ${part.name.split('__')[0]}` : part.name;
  return (
    <>
      <div className="tool-call">
        <div className="head" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Wrench size={13} className="faint" />
          <span className="name">{label}</span>
          <span className="faint small" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
            {summarize(part.input)}
          </span>
          {part.duration !== undefined && <span className="faint small">{part.duration.toFixed(1)}s</span>}
          <Icon size={15} color={color} className={part.status === 'running' ? 'spin' : ''} />
        </div>
        {open && (
          <div className="detail">
            <div className="faint small">Input</div>
            <pre>{JSON.stringify(part.input, null, 2)}</pre>
            {part.result !== undefined && (
              <>
                <div className="faint small">Result</div>
                <pre>{part.result}</pre>
              </>
            )}
          </div>
        )}
      </div>
      {(part.artifacts || []).map((a) => (
        <ArtifactChip key={a.id} id={a.id} artifact={a.name ? a : undefined} />
      ))}
    </>
  );
}

function summarize(input) {
  if (!input) return '';
  const v = input.query || input.url || input.title || input.prompt || input.path || input.command || input.text || input.expression || input.name;
  return typeof v === 'string' ? v : Object.keys(input).length ? JSON.stringify(input).slice(0, 120) : '';
}

function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn ghost icon sm"
      title="Copy"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

export default function Message({ turn, sessionId, streaming }) {
  const agents = useApp((s) => s.agentsCache);
  if (turn.role === 'user') {
    const m = turn.meta || {};
    const labels = m.labels || {};
    return (
      <div className="msg user">
        <div className="avatar">You</div>
        <div className="body">
          {(m.attachments?.length > 0 || m.mentions?.length > 0 || m.skill_id || m.prompt_id || m.agent_id) && (
            <div className="chips">
              {(m.attachments || []).map((a) => (
                <span key={a.id || a.name} className="chip">
                  <Paperclip size={12} />
                  <span>{a.name}</span>
                </span>
              ))}
              {(labels.mentions || m.mentions || []).map((x) => (
                <span key={x} className="chip blue">
                  <AtSign size={12} />
                  <span>{x}</span>
                </span>
              ))}
              {m.skill_id && (
                <span className="chip purple">
                  <Slash size={12} />
                  <span>{labels.skill || 'skill'}</span>
                </span>
              )}
              {m.prompt_id && (
                <span className="chip teal">
                  <BookText size={12} />
                  <span>{labels.prompt || 'prompt'}</span>
                </span>
              )}
              {m.agent_id && (
                <span className="chip">
                  <Bot size={12} />
                  <span>{agents?.find((a) => a.id === m.agent_id)?.name || 'agent'}</span>
                </span>
              )}
            </div>
          )}
          <div className="bubble">{turn.text}</div>
        </div>
      </div>
    );
  }
  const fullText = turn.parts.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
  return (
    <div className="msg assistant">
      <div className="avatar">M</div>
      <div className="body">
        {turn.parts.map((p, i) =>
          p.type === 'text' ? (
            <Markdown key={i}>{p.text}</Markdown>
          ) : p.type === 'tool' ? (
            <ToolCall key={p.id || i} part={p} />
          ) : (
            <div key={i} className="error-part">
              {p.text}
            </div>
          ),
        )}
        {streaming && turn.live && <span className="pulse faint">▍</span>}
        {turn.citations?.length > 0 && (
          <div className="citations">
            {[...new Map(turn.citations.map((c) => [c.source, c])).values()].map((c) => (
              <span key={c.source} className="chip blue" title={`relevance ${c.score}`}>
                <AtSign size={12} />
                <span>{c.source}</span>
              </span>
            ))}
          </div>
        )}
        {!streaming && fullText && (
          <div className="msg-actions">
            <CopyButton text={fullText} />
            {turn.duration !== undefined && (
              <span className="msg-meta">
                {turn.duration}s{turn.usage?.output_tokens ? ` · ${turn.usage.input_tokens + turn.usage.output_tokens} tokens` : ''}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
