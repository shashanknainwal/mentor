import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, AtSign, Bot, BookText, CircleStop, Folder, FolderKanban, Mic, MicOff, Paperclip, Plus, Slash, Sparkles, X, ListChecks } from 'lucide-react';
import { api } from '../lib/api.js';
import { useApp } from '../lib/store.js';
import { cancelChat, sendChat } from '../lib/chatSocket.js';
import { Spinner } from '../components/ui.jsx';
import { MOD } from '../App.jsx';

function Popover({ items, sel, onPick, header, empty }) {
  return (
    <div className="popover" role="listbox">
      {header && <div className="hdr">{header}</div>}
      {!items.length && <div className="item faint">{empty || 'No matches'}</div>}
      {items.map((it, i) => (
        <div key={it.id} className={`item ${i === sel ? 'sel' : ''}`} role="option" aria-selected={i === sel}
          onMouseDown={(e) => (e.preventDefault(), onPick(it))}>
          {it.icon && <it.icon size={16} style={{ marginTop: 2, flexShrink: 0 }} />}
          <div style={{ minWidth: 0 }}>
            <div className="t">{it.name}</div>
            {it.desc && <div className="d">{it.desc}</div>}
          </div>
          {it.badge && <span className="badge" style={{ marginLeft: 'auto' }}>{it.badge}</span>}
        </div>
      ))}
    </div>
  );
}

function useSpeech(onText) {
  const [rec, setRec] = useState(null);
  const toast = useApp((s) => s.toast);
  const start = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      toast('Speech-to-text is not available in this runtime. See Settings › Voice.', 'error');
      return;
    }
    const r = new SR();
    r.continuous = true;
    r.interimResults = false;
    r.lang = navigator.language || 'en-GB';
    r.onresult = (e) => {
      const text = [...e.results].slice(e.resultIndex).map((x) => x[0].transcript).join(' ');
      onText(text);
    };
    r.onerror = (e) => {
      toast(`Voice input error: ${e.error}`, 'error');
      setRec(null);
    };
    r.onend = () => setRec(null);
    r.start();
    setRec(r);
  };
  const stop = () => {
    rec?.stop();
    setRec(null);
  };
  return [!!rec, () => (rec ? stop() : start())];
}

export default function Composer({ sessionId, seed, onSeedUsed }) {
  const chat = useApp((s) => s.chats[sessionId]);
  const { focused, active, agentsCache, loadAgents, composerDraft, setComposerDraft, toast } = useApp();
  const [text, setText] = useState('');
  const [attachments, setAttachments] = useState([]); // {id,name,path,mime,uploading}
  const [mentions, setMentions] = useState([]);
  const [skill, setSkill] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const [agentId, setAgentId] = useState(null);
  const [pop, setPop] = useState(null); // {kind, query}
  const [plusTab, setPlusTab] = useState('files');
  const [sel, setSel] = useState(0);
  const [drag, setDrag] = useState(false);
  const [hist, setHist] = useState(-1);
  const [catalog, setCatalog] = useState({ projects: [], skills: [], prompts: [] });
  const ta = useRef(null);
  const box = useRef(null);
  const isFocusedPane = active[focused] === sessionId;

  const [recording, toggleVoice] = useSpeech((t) => setText((cur) => (cur ? `${cur} ${t}` : t)));

  const refreshCatalog = async () => {
    const [projects, skills, prompts] = await Promise.all([
      api.get('/api/projects').catch(() => []),
      api.get('/api/skills').catch(() => []),
      api.get('/api/prompts').catch(() => []),
    ]);
    setCatalog({ projects, skills, prompts });
  };

  useEffect(() => {
    refreshCatalog();
    if (!agentsCache.length) loadAgents().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const s = chat?.session;
    if (s?.agent_id) setAgentId(s.agent_id);
  }, [chat?.session]);

  useEffect(() => {
    if (seed) {
      setText(seed);
      onSeedUsed?.();
      ta.current?.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // Handoffs from other panels ("Use in chat", "Run skill", "Chat as agent").
  useEffect(() => {
    if (!composerDraft || !isFocusedPane) return;
    if (composerDraft.text) setText(composerDraft.text);
    if (composerDraft.prompt) setPrompt(composerDraft.prompt);
    if (composerDraft.skill) setSkill(composerDraft.skill);
    if (composerDraft.agentId !== undefined) setAgentId(composerDraft.agentId);
    if (composerDraft.mention) setMentions((m) => [...m.filter((x) => x.id !== composerDraft.mention.id), composerDraft.mention]);
    setComposerDraft(null);
    refreshCatalog();
    setTimeout(() => ta.current?.focus(), 50);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composerDraft, isFocusedPane]);

  useEffect(() => {
    const onDown = (e) => box.current && !box.current.contains(e.target) && setPop(null);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    const onVoice = () => isFocusedPane && toggleVoice();
    window.addEventListener('mentor:voice-toggle', onVoice);
    return () => window.removeEventListener('mentor:voice-toggle', onVoice);
  });

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(260, el.scrollHeight)}px`;
  }, [text]);

  const sentHistory = useMemo(() => (chat?.turns || []).filter((t) => t.role === 'user' && t.text).map((t) => t.text).reverse(), [chat?.turns]);

  const items = useMemo(() => {
    if (!pop) return [];
    const q = (pop.query || '').toLowerCase();
    const match = (s) => !q || s.toLowerCase().includes(q);
    if (pop.kind === 'mention')
      return catalog.projects
        .filter((p) => match(p.name) || match(p.slug || ''))
        .map((p) => ({ id: p.id, name: p.name, desc: p.kind === 'folder' ? p.description : `${p.file_count || 0} files · ${p.description || ''}`, icon: p.kind === 'folder' ? Folder : FolderKanban, badge: p.kind === 'folder' ? 'folder' : undefined }));
    if (pop.kind === 'skill')
      return catalog.skills
        .filter((s) => match(s.name) || match(s.description || ''))
        .map((s) => ({ id: s.id, name: s.name, desc: s.description, icon: s.kind === 'sop' ? ListChecks : Sparkles, badge: s.kind.toUpperCase(), raw: s }));
    if (pop.kind === 'plus' && plusTab === 'prompts')
      return catalog.prompts
        .filter((p) => match(p.name) || (p.tags || []).some(match))
        .map((p) => ({ id: p.id, name: p.name, desc: p.content.slice(0, 90), icon: BookText, badge: p.builtin ? 'built-in' : p.category, raw: p }));
    if (pop.kind === 'agent')
      return [{ id: '', name: 'Mentor (default)', desc: 'General assistant', icon: Bot }, ...agentsCache.map((a) => ({ id: a.id, name: a.name, desc: a.description, icon: Bot }))];
    return [];
  }, [pop, catalog, plusTab, agentsCache]);

  useEffect(() => setSel(0), [pop?.kind, pop?.query, plusTab]);

  const detectTrigger = (value, caret) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)([@/])([\w.-]*)$/.exec(before);
    if (m) {
      const kind = m[2] === '@' ? 'mention' : 'skill';
      if (pop?.kind !== kind) refreshCatalog(); // pick up projects/skills created since mount
      setPop({ kind, query: m[3], start: caret - m[3].length - 1 });
    }
    else if (pop?.kind === 'mention' || pop?.kind === 'skill') setPop(null);
  };

  const stripTrigger = () => {
    if (pop?.start === undefined) return text;
    const caret = ta.current?.selectionStart ?? text.length;
    return text.slice(0, pop.start) + text.slice(caret);
  };

  const pick = (it) => {
    if (!it) return;
    if (pop.kind === 'mention') {
      setMentions((m) => (m.find((x) => x.id === it.id) ? m : [...m, { id: it.id, name: it.name }]));
      setText(stripTrigger());
    } else if (pop.kind === 'skill') {
      setSkill(it.raw);
      setText(stripTrigger());
    } else if (pop.kind === 'plus') {
      setPrompt(it.raw);
    } else if (pop.kind === 'agent') {
      setAgentId(it.id || null);
      api.patch(`/api/sessions/${sessionId}`, { agent_id: it.id || null }).catch(() => {});
    }
    setPop(null);
    ta.current?.focus();
  };

  const addFiles = async (files) => {
    for (const f of files) {
      const temp = { id: `tmp-${Math.random()}`, name: f.name, uploading: true };
      setAttachments((a) => [...a, temp]);
      try {
        const up = await api.upload('/api/uploads', f);
        setAttachments((a) => a.map((x) => (x.id === temp.id ? up : x)));
      } catch (e) {
        toast(`Upload failed: ${e.message}`, 'error');
        setAttachments((a) => a.filter((x) => x.id !== temp.id));
      }
    }
  };

  const pickFiles = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => addFiles([...input.files]);
    input.click();
    setPop(null);
  };

  const streaming = chat?.streaming;
  const canSend = (text.trim() || attachments.length) && !attachments.some((a) => a.uploading) && !streaming;

  const submit = () => {
    if (!canSend) return;
    sendChat(sessionId, { text: text.trim(), attachments, mentions, skill, prompt, agentId });
    setText('');
    setAttachments([]);
    setPrompt(null); // prompt chips apply to one turn
    setSkill(null);
    setHist(-1);
    setPop(null);
  };

  const onKeyDown = (e) => {
    if (pop && items.length) {
      if (e.key === 'ArrowDown') return e.preventDefault(), setSel((sel + 1) % items.length);
      if (e.key === 'ArrowUp') return e.preventDefault(), setSel((sel - 1 + items.length) % items.length);
      if (e.key === 'Enter' || e.key === 'Tab') return e.preventDefault(), pick(items[sel]);
    }
    if (pop && e.key === 'Escape') return e.preventDefault(), e.stopPropagation(), setPop(null);
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
      return;
    }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (!text || hist >= 0) && sentHistory.length) {
      e.preventDefault();
      const next = e.key === 'ArrowUp' ? Math.min(hist + 1, sentHistory.length - 1) : hist - 1;
      setHist(next);
      setText(next >= 0 ? sentHistory[next] : '');
    }
  };

  const agent = agentsCache.find((a) => a.id === agentId);

  return (
    <div className="composer-wrap">
      <div
        ref={box}
        className={`composer ${drag ? 'drag' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
        }}
      >
        {(attachments.length > 0 || mentions.length > 0 || skill || prompt) && (
          <div className="chiprow">
            {attachments.map((a) => (
              <span key={a.id} className="chip">
                {a.uploading ? <Spinner size={12} /> : <Paperclip size={12} />}
                <span>{a.name}</span>
                <button aria-label="Remove" onClick={() => setAttachments((x) => x.filter((y) => y.id !== a.id))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {mentions.map((m) => (
              <span key={m.id} className="chip blue">
                <AtSign size={12} />
                <span>{m.name}</span>
                <button aria-label="Remove" onClick={() => setMentions((x) => x.filter((y) => y.id !== m.id))}>
                  <X size={12} />
                </button>
              </span>
            ))}
            {skill && (
              <span className="chip purple" title={skill.description}>
                {skill.kind === 'sop' ? <ListChecks size={12} /> : <Slash size={12} />}
                <span>{skill.name}</span>
                <button aria-label="Remove" onClick={() => setSkill(null)}>
                  <X size={12} />
                </button>
              </span>
            )}
            {prompt && (
              <span className="chip teal" title={prompt.content}>
                <BookText size={12} />
                <span>{prompt.name}</span>
                <button aria-label="Remove" onClick={() => setPrompt(null)}>
                  <X size={12} />
                </button>
              </span>
            )}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={agent ? `Message ${agent.name}…` : 'Ask Mentor anything — @ to mention a project, / for skills'}
          onChange={(e) => {
            setText(e.target.value);
            setHist(-1);
            detectTrigger(e.target.value, e.target.selectionStart);
          }}
          onKeyDown={onKeyDown}
          onPaste={(e) => {
            const files = [...e.clipboardData.files];
            if (files.length) {
              e.preventDefault();
              addFiles(files);
            }
          }}
          onBlur={() => setTimeout(() => setPop((p) => (p?.kind === 'plus' || p?.kind === 'agent' ? p : null)), 150)}
          aria-label="Message"
        />
        <div className="bar">
          <button className="btn ghost icon sm" title="Add files or prompts" onClick={() => refreshCatalog() && setPop(pop?.kind === 'plus' ? null : { kind: 'plus', query: '' })}>
            <Plus size={16} />
          </button>
          <button className="btn ghost icon sm" title="Mention a project (@)" onClick={() => { refreshCatalog(); setText((t) => `${t}${t && !t.endsWith(' ') ? ' ' : ''}@`); setPop({ kind: 'mention', query: '', start: text.length + (text && !text.endsWith(' ') ? 1 : 0) }); ta.current?.focus(); }}>
            <AtSign size={15} />
          </button>
          <button className="btn ghost icon sm" title="Skills & SOPs (/)" onClick={() => { refreshCatalog(); setPop({ kind: 'skill', query: '' }); ta.current?.focus(); }}>
            <Slash size={15} />
          </button>
          <button className={`persona ${agent ? 'on' : ''}`} onClick={() => loadAgents().catch(() => {}) && setPop(pop?.kind === 'agent' ? null : { kind: 'agent', query: '' })} title="Chat as an agent">
            <Bot size={13} /> {agent ? agent.name : 'Mentor'}
          </button>
          <span style={{ flex: 1 }} />
          <span className="faint small" style={{ marginRight: 6 }}>{text.length > 2000 ? `${text.length.toLocaleString()} chars` : ''}</span>
          <button className={`btn ghost icon sm ${recording ? 'danger' : ''}`} title={`Voice input (${MOD}+Shift+E)`} onClick={toggleVoice}>
            {recording ? <MicOff size={16} className="pulse" /> : <Mic size={16} />}
          </button>
          {streaming ? (
            <button className="btn icon sm danger" title="Stop" onClick={() => chat.requestId && cancelChat(chat.requestId)}>
              <CircleStop size={16} />
            </button>
          ) : (
            <button className="btn primary icon sm" title="Send (Enter)" disabled={!canSend} onClick={submit}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>

        {pop?.kind === 'mention' && <Popover items={items} sel={sel} onPick={pick} header="Projects & folders" empty="No projects yet — create one in Projects." />}
        {pop?.kind === 'skill' && <Popover items={items} sel={sel} onPick={pick} header="Skills & SOPs" empty="No skills installed — browse Capabilities › Marketplace." />}
        {pop?.kind === 'agent' && <Popover items={items} sel={sel} onPick={pick} header="Chat as…" />}
        {pop?.kind === 'plus' && (
          <div className="popover">
            <div className="tabs" style={{ marginBottom: 6 }}>
              <button className={plusTab === 'files' ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), setPlusTab('files'))}>Files</button>
              <button className={plusTab === 'prompts' ? 'active' : ''} onMouseDown={(e) => (e.preventDefault(), setPlusTab('prompts'))}>Prompts</button>
            </div>
            {plusTab === 'files' ? (
              <div className="item" onMouseDown={(e) => (e.preventDefault(), pickFiles())}>
                <Paperclip size={16} />
                <div>
                  <div className="t">Attach files</div>
                  <div className="d">PDF, Word, Excel, PowerPoint, images, text and code. Or drag & drop / paste.</div>
                </div>
              </div>
            ) : (
              <>
                <input className="input" placeholder="Search prompts…" autoFocus value={pop.query} onChange={(e) => setPop({ ...pop, query: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') (e.preventDefault(), setSel((sel + 1) % Math.max(1, items.length)));
                    if (e.key === 'ArrowUp') (e.preventDefault(), setSel((sel - 1 + items.length) % Math.max(1, items.length)));
                    if (e.key === 'Enter') (e.preventDefault(), pick(items[sel]));
                    if (e.key === 'Escape') (e.stopPropagation(), setPop(null));
                  }} style={{ marginBottom: 6 }} />
                {items.map((it, i) => (
                  <div key={it.id} className={`item ${i === sel ? 'sel' : ''}`} onMouseDown={(e) => (e.preventDefault(), pick(it))}>
                    <BookText size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ minWidth: 0 }}>
                      <div className="t">{it.name}</div>
                      <div className="d">{it.desc}</div>
                    </div>
                    {it.badge && <span className="badge" style={{ marginLeft: 'auto' }}>{it.badge}</span>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
