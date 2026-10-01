import { lazy, Suspense, useEffect } from 'react';
import {
  Bot, Brain, Bug, Calendar, CalendarClock, BookText, Database, Flag, FolderKanban, HelpCircle, Images, LayoutDashboard,
  MessageSquare, MousePointerClick, PanelLeftClose, PanelLeftOpen, Plug, Presentation, Settings, ShieldCheck, Sparkles,
} from 'lucide-react';
import { useApp } from './lib/store.js';
import { Spinner, Toasts } from './components/ui.jsx';
import ChatView from './chat/ChatView.jsx';

const Projects = lazy(() => import('./panels/Projects.jsx'));
const Agents = lazy(() => import('./panels/Agents.jsx'));
const Scheduled = lazy(() => import('./panels/Scheduled.jsx'));
const Capabilities = lazy(() => import('./panels/Capabilities.jsx'));
const Prompts = lazy(() => import('./panels/Prompts.jsx'));
const Data = lazy(() => import('./panels/Data.jsx'));
const Memory = lazy(() => import('./panels/Memory.jsx'));
const Dashboard = lazy(() => import('./panels/Dashboard.jsx'));
const CalendarPanel = lazy(() => import('./panels/Calendar.jsx'));
const Artifacts = lazy(() => import('./panels/Artifacts.jsx'));
const Presentations = lazy(() => import('./panels/Presentations.jsx'));
const Integrations = lazy(() => import('./panels/Integrations.jsx'));
const ComputerUse = lazy(() => import('./panels/ComputerUse.jsx'));
const Security = lazy(() => import('./panels/Security.jsx'));
const Diagnostics = lazy(() => import('./panels/Diagnostics.jsx'));
const Help = lazy(() => import('./panels/Help.jsx'));
const SettingsPanel = lazy(() => import('./panels/Settings.jsx'));
const ReportIssue = lazy(() => import('./panels/ReportIssue.jsx'));

export const NAV = [
  { group: 'Work' },
  { id: 'chat', label: 'Chat', icon: MessageSquare, key: '1', el: null },
  { id: 'projects', label: 'Projects', icon: FolderKanban, el: Projects },
  { id: 'agents', label: 'Agents', icon: Bot, el: Agents },
  { id: 'scheduled', label: 'Scheduled', icon: CalendarClock, el: Scheduled },
  { id: 'capabilities', label: 'Capabilities', icon: Sparkles, el: Capabilities },
  { id: 'prompts', label: 'Prompts', icon: BookText, key: '7', el: Prompts },
  { group: 'Knowledge' },
  { id: 'data', label: 'Data', icon: Database, key: '4', el: Data },
  { id: 'memory', label: 'Memory', icon: Brain, key: '3', el: Memory },
  { group: 'Workspace' },
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, key: '6', el: Dashboard },
  { id: 'calendar', label: 'Calendar', icon: Calendar, el: CalendarPanel },
  { id: 'artifacts', label: 'Artifacts', icon: Images, el: Artifacts },
  { id: 'presentations', label: 'Presentations', icon: Presentation, el: Presentations },
  { group: 'System' },
  { id: 'integrations', label: 'Integrations', icon: Plug, key: '2', el: Integrations },
  { id: 'computer', label: 'Computer Use', icon: MousePointerClick, el: ComputerUse },
  { id: 'security', label: 'Security', icon: ShieldCheck, el: Security },
  { id: 'diagnostics', label: 'Diagnostics', icon: Bug, key: '5', el: Diagnostics },
  { id: 'help', label: 'Help', icon: HelpCircle, el: Help },
  { id: 'report', label: 'Report Issue', icon: Flag, el: ReportIssue },
  { id: 'settings', label: 'Settings', icon: Settings, key: '8', el: SettingsPanel },
];

const isMac = navigator.platform.toLowerCase().includes('mac');
export const MOD = isMac ? '⌘' : 'Ctrl';

function Sidebar() {
  const { view, setView, sidebarCollapsed, toggleSidebar } = useApp();
  return (
    <aside className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <img src="./favicon.png" alt="" />
        {!sidebarCollapsed && (
          <div>
            <div className="name">Mentor</div>
            <div className="sub">KPMG Advisory</div>
          </div>
        )}
      </div>
      <nav aria-label="Main">
        {NAV.map((n, i) =>
          n.group ? (
            <div key={`g${i}`} className="group">
              {n.group}
            </div>
          ) : (
            <button key={n.id} className={`nav-item ${view === n.id ? 'active' : ''}`} onClick={() => setView(n.id)} title={n.label}>
              <n.icon size={18} />
              <span className="label">{n.label}</span>
              {n.key && <span className="kbd">{MOD}+{n.key}</span>}
            </button>
          ),
        )}
      </nav>
      <div className="foot">
        <button className="nav-item" onClick={toggleSidebar} title={`Toggle sidebar (${MOD}+B)`}>
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          <span className="label">Collapse</span>
        </button>
      </div>
    </aside>
  );
}

function useTheme() {
  const theme = useApp((s) => s.theme);
  const settings = useApp((s) => s.settings);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'system' ? (mq.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    const fs = settings?.appearance?.font_size;
    if (fs) document.documentElement.style.setProperty('--fs', `${fs}px`);
  }, [settings?.appearance?.font_size]);
}

function useShortcuts() {
  useEffect(() => {
    const onKey = (e) => {
      const s = useApp.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === 'Escape' && !document.querySelector('.modal-backdrop')) {
        if (s.view !== 'chat') s.setView('chat');
        return;
      }
      if (!mod) return;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (!e.shiftKey && /^[1-8]$/.test(e.key)) {
        const item = NAV.find((n) => n.key === e.key);
        if (item) (handled(), s.setView(item.id));
      } else if (!e.shiftKey && k === 'n') (handled(), s.newChat());
      else if (!e.shiftKey && k === 't' && s.view === 'chat') (handled(), s.newChat());
      else if (!e.shiftKey && k === 'w' && s.view === 'chat') {
        const id = s.active[s.focused];
        if (id) (handled(), s.closeTab(id));
      } else if (k === 'tab') (handled(), s.cycleTab(e.shiftKey ? -1 : 1));
      else if (!e.shiftKey && k === ',') (handled(), s.setView('settings'));
      else if (!e.shiftKey && k === '/') (handled(), s.setView('help'));
      else if (!e.shiftKey && (k === 'b' || k === '\\')) (handled(), s.toggleSidebar());
      else if (e.shiftKey && k === '|') (handled(), s.toggleSplit()); // Ctrl+Shift+\ reports '|'
      else if (e.shiftKey && k === '\\') (handled(), s.toggleSplit());
      else if (e.shiftKey && k === 'd') (handled(), s.setView(s.view === 'diagnostics' ? 'chat' : 'diagnostics'));
      else if (e.shiftKey && k === 'm') (handled(), s.setView(s.view === 'dashboard' ? 'chat' : 'dashboard'));
      else if (e.shiftKey && k === 'l') (handled(), s.cycleTheme());
      else if (e.shiftKey && k === 'arrowleft' && s.split) (handled(), s.setFocused('left'));
      else if (e.shiftKey && k === 'arrowright' && s.split) (handled(), s.setFocused('right'));
      else if (e.shiftKey && k === 'e') (handled(), window.dispatchEvent(new CustomEvent('mentor:voice-toggle')));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
}

export default function App() {
  const view = useApp((s) => s.view);
  const engineOk = useApp((s) => s.engineOk);
  useTheme();
  useShortcuts();

  useEffect(() => {
    const s = useApp.getState();
    s.loadSettings();
    s.loadSessions();
    const off = window.mentor?.on?.('navigate', (route) => {
      const st = useApp.getState();
      if (route === 'new-chat') st.newChat();
      else if (route.startsWith('session:')) st.openSession(route.slice(8), 'Chat');
      else st.setView(route);
    });
    const t = setInterval(() => useApp.getState().engineOk === false && useApp.getState().loadSettings(), 3000);
    return () => {
      off?.();
      clearInterval(t);
    };
  }, []);

  const Panel = NAV.find((n) => n.id === view)?.el;
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {engineOk === false && (
          <div className="error-part" style={{ margin: 8, borderRadius: 8 }}>
            Can't reach the Mentor engine. If you're running from source, start it with <code>npm run dev</code> (or <code>npm run dev:engine</code>). Retrying…
          </div>
        )}
        <div className="content" style={{ display: view === 'chat' ? 'none' : 'block' }}>
          {Panel && (
            <Suspense fallback={<div className="page"><Spinner /></div>}>
              <Panel />
            </Suspense>
          )}
        </div>
        <div style={{ display: view === 'chat' ? 'flex' : 'none', flex: 1, minHeight: 0 }}>
          <ChatView />
        </div>
      </main>
      <Toasts />
    </div>
  );
}
