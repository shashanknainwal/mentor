import { useEffect, useRef } from 'react';
import { Columns2, Download, Plus, X } from 'lucide-react';
import { useApp } from '../lib/store.js';
import { api } from '../lib/api.js';
import { Button } from '../components/ui.jsx';
import ChatPane from './ChatPane.jsx';
import { MOD } from '../App.jsx';

function TabBar({ pane }) {
  const { tabs, panes, active, setActive, closeTab, newChat, reorderTab, moveTab, split, chats } = useApp();
  const ids = panes[pane];
  const refs = useRef({});

  const onKeyDown = (e, idx) => {
    const go = (i) => refs.current[ids[(i + ids.length) % ids.length]]?.focus();
    if (e.key === 'ArrowRight') go(idx + 1);
    else if (e.key === 'ArrowLeft') go(idx - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(ids.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') setActive(pane, ids[idx]);
    else if (e.key === 'Delete') closeTab(ids[idx]);
    else return;
    e.preventDefault();
  };

  return (
    <div className="tabbar" role="tablist" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        const id = e.dataTransfer.getData('mentor/tab');
        if (id && !ids.includes(id)) moveTab(id, pane);
      }}>
      {ids.map((id, idx) => {
        const t = tabs.find((x) => x.id === id) || { title: 'Chat' };
        return (
          <div
            key={id}
            ref={(el) => (refs.current[id] = el)}
            role="tab"
            tabIndex={0}
            aria-selected={active[pane] === id}
            className={`tab ${active[pane] === id ? 'active' : ''}`}
            onClick={() => setActive(pane, id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            onAuxClick={(e) => e.button === 1 && closeTab(id)}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('mentor/tab', id)}
            onDrop={(e) => {
              const from = e.dataTransfer.getData('mentor/tab');
              if (ids.includes(from)) {
                e.stopPropagation();
                reorderTab(pane, ids.indexOf(from), idx);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              moveTab(id, pane === 'left' ? 'right' : 'left');
            }}
            title={`${t.title}\nRight-click: move to ${pane === 'left' ? 'right' : 'left'} pane`}
          >
            {chats[id]?.streaming && <span className="live pulse" />}
            <span className="t">{t.title}</span>
            <button className="btn ghost icon sm x" aria-label="Close tab" onClick={(e) => (e.stopPropagation(), closeTab(id))}>
              <X size={13} />
            </button>
          </div>
        );
      })}
      <button className="add" title={`New chat (${MOD}+T)`} onClick={() => (useApp.getState().setFocused(pane), newChat())}>
        <Plus size={16} />
      </button>
      {split && pane === 'right' && !ids.length && <span className="faint small" style={{ alignSelf: 'center' }}>Drag a tab here</span>}
    </div>
  );
}

function TopBar() {
  const { active, focused, tabs, split, toggleSplit, settings, newChat } = useApp();
  const sid = active[focused];
  const title = tabs.find((t) => t.id === sid)?.title || 'Chat';
  const provider = settings?.model?.provider;
  const exportChat = async () => {
    const md = await api.get(`/api/sessions/${sid}/export`, { text: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }));
    a.download = `${title.replace(/[^\w -]+/g, '')}.md`;
    a.click();
  };
  return (
    <div className="topbar">
      <span className="title">{title}</span>
      <span className="badge blue" title="Routing mode is managed by the engine">
        {(settings?.routing?.mode || 'bedrock_direct').replace('_', ' ')}
      </span>
      {provider === 'demo' ? (
        <span className="badge amber" title="No AWS calls are made. Configure Bedrock in Settings › Models.">Demo mode</span>
      ) : (
        <span className="badge" title="Model">{settings?.model?.model_id?.replace('anthropic.', '')}</span>
      )}
      <span className="spacer" />
      {sid && <Button variant="ghost" size="sm" icon={Download} onClick={exportChat} title="Export conversation (Markdown)" />}
      <Button variant="ghost" size="sm" icon={Columns2} onClick={toggleSplit} title={`Split view (${MOD}+Shift+\\)`} className={split ? 'active' : ''} />
      <Button size="sm" variant="primary" icon={Plus} onClick={() => newChat()}>
        New chat
      </Button>
    </div>
  );
}

let bootstrapped = false; // StrictMode runs effects twice in dev; only create the first tab once

export default function ChatView() {
  const { split, panes, active, focused, setFocused, tabs, newChat } = useApp();

  useEffect(() => {
    // Ensure at least one tab exists.
    if (!tabs.length && !bootstrapped) newChat();
    bootstrapped = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderPane = (pane) => (
    <section className={`pane ${split && focused === pane ? 'focused' : ''}`} onMouseDown={() => focused !== pane && setFocused(pane)}>
      <TabBar pane={pane} />
      {active[pane] ? <ChatPane key={active[pane]} sessionId={active[pane]} /> : <div className="empty">No chat open in this pane.</div>}
    </section>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
      <TopBar />
      <div className="chat-area" style={{ flex: 1, minHeight: 0 }}>
        {renderPane('left')}
        {split && renderPane('right')}
      </div>
    </div>
  );
}
