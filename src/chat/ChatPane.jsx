import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Briefcase, FileText, Globe, Image as ImageIcon, ShieldCheck, Sparkles } from 'lucide-react';
import { useApp } from '../lib/store.js';
import { answerApproval } from '../lib/chatSocket.js';
import { Button } from '../components/ui.jsx';
import Message from './Message.jsx';
import Composer from './Composer.jsx';

const SUGGESTIONS = [
  { icon: Briefcase, t: 'Prep for a client meeting', d: 'Brief me for tomorrow’s steering committee with the CFO of a retail client.' },
  { icon: FileText, t: 'Draft a document', d: 'Write a professional email declining a meeting invitation, warm but firm.' },
  { icon: Globe, t: 'Search the web', d: 'What are the latest UK regulatory changes affecting audit committees? Cite sources.' },
  { icon: ImageIcon, t: 'Create a chart', d: 'Make a bar chart of revenue by quarter: Q1 4.2m, Q2 4.8m, Q3 5.1m, Q4 6.0m.' },
  { icon: Sparkles, t: 'Build a deck', d: 'Create a 6-slide deck on our Q3 project status with risks and next steps.' },
  { icon: ShieldCheck, t: 'Analyse a file', d: 'Drag a PDF here and ask: “Summarise this document in 5 bullets.”' },
];

function Welcome({ onPick }) {
  const name = useApp((s) => s.settings?.user?.name);
  return (
    <div className="welcome">
      <img src="./favicon.png" alt="" width={48} height={48} style={{ borderRadius: 12 }} />
      <h2>{name ? `Good to see you, ${name.split(' ')[0]}` : 'How can Mentor help today?'}</h2>
      <p className="muted">
        Type <span className="kbd-key">@</span> to bring in a project, <span className="kbd-key">/</span> for skills & SOPs, and
        <span className="kbd-key">+</span> for files and prompts.
      </p>
      <div className="grid cols-3">
        {SUGGESTIONS.map((s) => (
          <div key={s.t} className="suggestion" onClick={() => onPick(s.d)}>
            <div className="t">
              <s.icon size={15} /> {s.t}
            </div>
            <div className="d">{s.d}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Approval({ sessionId, a }) {
  return (
    <div className="approval">
      <div className="row">
        <ShieldCheck size={16} />
        <strong>Approve {a.tool}?</strong>
        <span className="muted small">{a.reason}</span>
      </div>
      <pre>{JSON.stringify(a.input, null, 2)}</pre>
      <div className="row">
        <Button variant="primary" size="sm" onClick={() => answerApproval(sessionId, a.approval_id, true)}>
          Approve
        </Button>
        <Button size="sm" onClick={() => answerApproval(sessionId, a.approval_id, false)}>
          Deny
        </Button>
        <span className="faint small">Change defaults in Security › Tool Approvals</span>
      </div>
    </div>
  );
}

export default function ChatPane({ sessionId }) {
  const chat = useApp((s) => s.chats[sessionId]);
  const loadChat = useApp((s) => s.loadChat);
  const scroller = useRef(null);
  const stick = useRef(true);
  const [seed, setSeed] = useState(null);

  useEffect(() => {
    if (!chat?.loaded) loadChat(sessionId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [chat?.turns, chat?.approvals]);

  const turns = chat?.turns || [];
  return (
    <>
      <div
        className="messages"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {chat?.loaded && !turns.length && <Welcome onPick={setSeed} />}
        <div className="msg-wrap">
          {turns.map((t, i) => (
            <Message key={i} turn={t} sessionId={sessionId} streaming={chat.streaming && i === turns.length - 1} />
          ))}
          {chat?.streaming && turns.at(-1)?.role === 'user' && (
            <div className="msg assistant">
              <div className="avatar">M</div>
              <div className="body muted pulse">Thinking…</div>
            </div>
          )}
          {chat?.citations?.length > 0 && !chat.streaming && null}
          {chat?.notice && <div className="faint small" style={{ margin: '0 0 12px 40px' }}>{chat.notice}</div>}
        </div>
        {(chat?.approvals || []).map((a) => (
          <Approval key={a.approval_id} sessionId={sessionId} a={a} />
        ))}
      </div>
      <Composer sessionId={sessionId} seed={seed} onSeedUsed={() => setSeed(null)} />
    </>
  );
}
