import { create } from 'zustand';
import { api } from './api.js';

const LS = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`mentor.${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`mentor.${key}`, JSON.stringify(value));
    } catch {
      /* storage unavailable */
    }
  },
};

// Convert stored Messages-API messages into display turns.
export function toTurns(messages) {
  const turns = [];
  for (const m of messages) {
    const blocks = m.content || [];
    if (m.role === 'user') {
      if (blocks.length && blocks.every((b) => b.type === 'tool_result')) {
        const last = turns.at(-1);
        for (const b of blocks) {
          const part = last?.parts?.find((p) => p.type === 'tool' && p.id === b.tool_use_id);
          if (part) {
            part.status = b.is_error ? 'error' : 'ok';
            part.result = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            part.artifacts = [...(part.result.matchAll(/\[artifact:([a-z0-9]+)\]/g))].map((x) => ({ id: x[1] }));
          }
        }
        continue;
      }
      const text = blocks
        .filter((b) => b.type === 'text' && !b.text.startsWith('<attachment'))
        .map((b) => b.text)
        .join('\n');
      turns.push({ role: 'user', id: m.id, text, meta: m.meta || {}, created: m.created });
    } else {
      let last = turns.at(-1);
      if (!last || last.role !== 'assistant') {
        last = { role: 'assistant', id: m.id, parts: [], created: m.created };
        turns.push(last);
      }
      for (const b of blocks) {
        if (b.type === 'text' && b.text) last.parts.push({ type: 'text', text: b.text });
        if (b.type === 'tool_use') last.parts.push({ type: 'tool', id: b.id, name: b.name, input: b.input, status: 'running' });
      }
    }
  }
  return turns;
}

const emptyChat = () => ({ turns: [], streaming: false, requestId: null, approvals: [], citations: [], loaded: false, notice: null });

export const useApp = create((set, get) => ({
  // ---- navigation ---------------------------------------------------------
  view: 'chat',
  setView: (view) => set({ view }),
  sidebarCollapsed: LS.get('sidebarCollapsed', false),
  toggleSidebar: () => {
    const v = !get().sidebarCollapsed;
    LS.set('sidebarCollapsed', v);
    set({ sidebarCollapsed: v });
  },

  // ---- theme ----------------------------------------------------------------
  theme: LS.get('theme', 'system'),
  setTheme: (theme) => {
    LS.set('theme', theme);
    set({ theme });
  },
  cycleTheme: () => {
    const order = ['dark', 'light', 'system'];
    get().setTheme(order[(order.indexOf(get().theme) + 1) % order.length]);
  },

  // ---- settings ----------------------------------------------------------------
  settings: null,
  engineOk: null,
  loadSettings: async () => {
    try {
      const s = await api.get('/api/settings');
      set({ settings: s, engineOk: true });
      return s;
    } catch {
      set({ engineOk: false });
      return null;
    }
  },
  saveSettings: async (patch) => {
    const s = await api.patch('/api/settings', patch);
    set({ settings: s });
    return s;
  },

  // ---- toasts -------------------------------------------------------------------
  toasts: [],
  toast: (text, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    set({ toasts: [...get().toasts, { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), kind === 'error' ? 7000 : 3500);
  },

  // ---- sessions & tabs -----------------------------------------------------------
  sessions: [],
  loadSessions: async () => set({ sessions: await api.get('/api/sessions') }),
  tabs: LS.get('tabs', []), // [{id,title}]
  panes: LS.get('panes', { left: [], right: [] }),
  active: LS.get('active', { left: null, right: null }),
  split: LS.get('split', false),
  focused: 'left',
  persistTabs: () => {
    const { tabs, panes, active, split } = get();
    LS.set('tabs', tabs);
    LS.set('panes', panes);
    LS.set('active', active);
    LS.set('split', split);
  },
  setFocused: (pane) => set({ focused: pane }),

  openSession: (id, title = 'Chat', pane) => {
    const s = get();
    const target = pane || s.focused;
    let { tabs, panes, active } = s;
    if (!tabs.find((t) => t.id === id)) tabs = [...tabs, { id, title }];
    const inPane = panes.left.includes(id) ? 'left' : panes.right.includes(id) ? 'right' : null;
    if (!inPane) panes = { ...panes, [target]: [...panes[target], id] };
    const where = inPane || target;
    active = { ...active, [where]: id };
    set({ tabs, panes, active, focused: where, view: 'chat' });
    get().persistTabs();
  },
  newChat: async (opts = {}) => {
    const s = await api.post('/api/sessions', opts);
    get().openSession(s.id, s.title || 'New chat');
    get().loadSessions();
    return s;
  },
  renameTab: (id, title) => {
    set({ tabs: get().tabs.map((t) => (t.id === id ? { ...t, title } : t)) });
    get().persistTabs();
  },
  closeTab: (id) => {
    const s = get();
    const panes = { left: s.panes.left.filter((x) => x !== id), right: s.panes.right.filter((x) => x !== id) };
    const active = { ...s.active };
    for (const p of ['left', 'right']) {
      if (active[p] === id) {
        const old = s.panes[p];
        const idx = old.indexOf(id);
        active[p] = panes[p][Math.min(idx, panes[p].length - 1)] || null;
      }
    }
    let split = s.split;
    if (split && !panes.right.length) split = false;
    set({ tabs: s.tabs.filter((t) => t.id !== id), panes, active, split });
    get().persistTabs();
  },
  cycleTab: (dir) => {
    const s = get();
    const list = s.panes[s.focused];
    if (!list.length) return;
    const idx = list.indexOf(s.active[s.focused]);
    const next = list[(idx + dir + list.length) % list.length];
    set({ active: { ...s.active, [s.focused]: next } });
    get().persistTabs();
  },
  setActive: (pane, id) => {
    set({ active: { ...get().active, [pane]: id }, focused: pane });
    get().persistTabs();
  },
  toggleSplit: () => {
    const s = get();
    if (s.split) {
      const panes = { left: [...s.panes.left, ...s.panes.right], right: [] };
      set({ split: false, panes, focused: 'left' });
    } else {
      let { panes, active } = s;
      if (!panes.right.length && panes.left.length > 1) {
        const moving = active.left;
        panes = { left: panes.left.filter((x) => x !== moving), right: [moving] };
        active = { left: panes.left.at(-1), right: moving };
      }
      set({ split: true, panes, active });
    }
    get().persistTabs();
  },
  moveTab: (id, toPane) => {
    const s = get();
    const from = s.panes.left.includes(id) ? 'left' : 'right';
    if (from === toPane) return;
    const panes = { ...s.panes, [from]: s.panes[from].filter((x) => x !== id), [toPane]: [...s.panes[toPane], id] };
    const active = { ...s.active, [toPane]: id };
    if (active[from] === id) active[from] = panes[from].at(-1) || null;
    set({ panes, active, split: true });
    get().persistTabs();
  },
  reorderTab: (pane, fromIdx, toIdx) => {
    const list = [...get().panes[pane]];
    const [m] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, m);
    set({ panes: { ...get().panes, [pane]: list } });
    get().persistTabs();
  },

  // ---- chat state per session -------------------------------------------------
  chats: {},
  chat: (sid) => get().chats[sid] || emptyChat(),
  updateChat: (sid, fn) =>
    set((state) => {
      const cur = state.chats[sid] || emptyChat();
      return { chats: { ...state.chats, [sid]: { ...cur, ...fn(cur) } } };
    }),
  loadChat: async (sid) => {
    try {
      const s = await api.get(`/api/sessions/${sid}`);
      get().updateChat(sid, () => ({ turns: toTurns(s.messages), loaded: true, session: s }));
      get().renameTab(sid, s.title);
    } catch {
      get().updateChat(sid, () => ({ loaded: true, missing: true }));
    }
  },

  agentsCache: [],
  loadAgents: async () => set({ agentsCache: await api.get('/api/agents') }),

  // ---- composer handoff (e.g. "Use prompt" from the Prompt Library) -----------
  composerDraft: null,
  setComposerDraft: (d) => set({ composerDraft: d }),
}));

export { LS };
