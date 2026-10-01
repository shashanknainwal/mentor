import { MousePointerClick, ShieldAlert } from 'lucide-react';
import { useApp } from '../lib/store.js';
import { PageHead, Switch } from '../components/ui.jsx';

export default function ComputerUse() {
  const { settings, saveSettings } = useApp();
  const enabled = settings?.computer_use?.enabled;
  return (
    <div className="page">
      <PageHead title="Computer Use" subtitle="Let the AI operate applications on your machine — take screenshots, click and type — to complete tasks that have no API." />
      <div className="grid cols-2">
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}><MousePointerClick size={18} /><h3 style={{ margin: 0 }}>Status</h3></div>
          <Switch checked={enabled} onChange={(v) => saveSettings({ computer_use: { enabled: v } })} label="Allow computer use (per-session approval still required)" />
          <p className="desc" style={{ marginTop: 12 }}>
            Computer use runs through Claude’s computer-use tool on Bedrock and a local driver that captures the screen and sends input events.
            This build ships the switch, approvals and plumbing; the OS driver is connected through an MCP server (for example a desktop-automation server)
            so it can be approved and audited like any other connector. Add one in <strong>Integrations</strong>.
          </p>
        </div>
        <div className="card" style={{ borderColor: 'var(--warn)' }}>
          <div className="row" style={{ marginBottom: 8 }}><ShieldAlert size={18} /><h3 style={{ margin: 0 }}>Safety rules</h3></div>
          <ul className="desc">
            <li>Every session starts with an explicit approval, and you can stop it at any time.</li>
            <li>Mentor never enters passwords, MFA codes or payment details on your behalf.</li>
            <li>Client systems: only operate apps you are authorised to use for the engagement.</li>
            <li>All actions are logged in Diagnostics › Activity Log and Security › Audit.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
