// Single WebSocket to the engine's /ws/chat, multiplexed by session_id.
import { wsUrl } from './api.js';
import { useApp } from './store.js';

let ws = null;
let connecting = null;
const queue = [];

function handle(evt) {
  const { session_id: sid, type } = evt;
  const app = useApp.getState();
  if (!sid) return;
  const update = (fn) => app.updateChat(sid, fn);

  const lastAssistant = (turns) => {
    const t = [...turns];
    let last = t.at(-1);
    if (!last || last.role !== 'assistant' || !last.live) {
      last = { role: 'assistant', parts: [], live: true, created: Date.now() / 1000 };
      t.push(last);
    } else {
      last = { ...last, parts: [...last.parts] };
      t[t.length - 1] = last;
    }
    return [t, last];
  };

  switch (type) {
    case 'start':
      update((c) => ({ streaming: true, requestId: evt.request_id, notice: null, citations: [] }));
      break;
    case 'session_title':
      app.renameTab(sid, evt.title);
      app.loadSessions();
      break;
    case 'citations':
      update(() => ({ citations: evt.citations }));
      break;
    case 'delta':
      update((c) => {
        const [turns, last] = lastAssistant(c.turns);
        const tail = last.parts.at(-1);
        if (tail && tail.type === 'text') last.parts[last.parts.length - 1] = { ...tail, text: tail.text + evt.text };
        else if (evt.text.trim()) last.parts.push({ type: 'text', text: evt.text });
        return { turns };
      });
      break;
    case 'tool_start':
      update((c) => {
        const [turns, last] = lastAssistant(c.turns);
        last.parts.push({ type: 'tool', id: evt.id, name: evt.name, input: evt.input, status: 'running', started: Date.now() });
        return { turns };
      });
      break;
    case 'tool_end':
      update((c) => {
        const [turns, last] = lastAssistant(c.turns);
        last.parts = last.parts.map((p) =>
          p.type === 'tool' && p.id === evt.id
            ? { ...p, status: evt.ok ? 'ok' : 'error', result: evt.result, artifacts: evt.artifacts || [], duration: (Date.now() - p.started) / 1000 }
            : p,
        );
        return { turns };
      });
      break;
    case 'approval_request':
      update((c) => ({ approvals: [...c.approvals, evt] }));
      window.mentor?.notify?.('Mentor needs your approval', `${evt.tool}: ${evt.reason}`);
      break;
    case 'notice':
      update(() => ({ notice: evt.text }));
      break;
    case 'error':
      update((c) => {
        const [turns, last] = lastAssistant(c.turns);
        last.parts.push({ type: 'error', text: evt.message });
        return { turns };
      });
      break;
    case 'done':
      update((c) => ({
        streaming: false,
        requestId: null,
        approvals: [],
        turns: c.turns.map((t) => (t.live ? { ...t, live: false, usage: evt.usage, duration: evt.duration, citations: c.citations } : t)),
      }));
      if (app.settings?.voice?.tts && window.speechSynthesis) {
        const last = useApp.getState().chats[sid]?.turns.at(-1);
        const said = (last?.parts || []).filter((p) => p.type === 'text').map((p) => p.text).join(' ').replace(/[#*`_>|-]/g, '');
        if (said) window.speechSynthesis.speak(new SpeechSynthesisUtterance(said.slice(0, 4000)));
      }
      if (evt.artifacts?.length) app.toast(`${evt.artifacts.length} file${evt.artifacts.length > 1 ? 's' : ''} saved to Artifacts`);
      break;
    default:
      break;
  }
}

async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;
  if (connecting) return connecting;
  connecting = new Promise(async (resolve, reject) => {
    const sock = new WebSocket(await wsUrl('/ws/chat'));
    sock.onopen = () => {
      ws = sock;
      connecting = null;
      while (queue.length) sock.send(queue.shift());
      resolve(sock);
    };
    sock.onmessage = (m) => handle(JSON.parse(m.data));
    sock.onclose = () => {
      ws = null;
      connecting = null;
      // mark in-flight chats as stopped
      const { chats, updateChat } = useApp.getState();
      for (const sid of Object.keys(chats)) if (chats[sid].streaming) updateChat(sid, () => ({ streaming: false, notice: 'Connection to the engine was lost.' }));
    };
    sock.onerror = (e) => {
      connecting = null;
      reject(e);
    };
  });
  return connecting;
}

export async function send(payload) {
  const msg = JSON.stringify(payload);
  try {
    const sock = await connect();
    sock.send(msg);
  } catch {
    queue.push(msg);
    useApp.getState().toast('Engine not reachable - check Diagnostics', 'error');
  }
}

export function sendChat(sessionId, { text, attachments = [], mentions = [], skill, prompt, agentId }) {
  const app = useApp.getState();
  app.updateChat(sessionId, (c) => ({
    turns: [
      ...c.turns,
      {
        role: 'user',
        text,
        created: Date.now() / 1000,
        meta: {
          attachments,
          mentions,
          skill_id: skill?.id,
          prompt_id: prompt?.id,
          agent_id: agentId,
          labels: { skill: skill?.name, prompt: prompt?.name, mentions: mentions.map((m) => m.name) },
        },
      },
    ],
    streaming: true,
  }));
  return send({
    type: 'chat',
    session_id: sessionId,
    text,
    attachments,
    mentions: mentions.map((m) => m.id),
    skill_id: skill?.id,
    prompt_id: prompt?.id,
    agent_id: agentId || undefined,
  });
}

export const cancelChat = (requestId) => send({ type: 'cancel', request_id: requestId });

export function answerApproval(sessionId, approvalId, approved) {
  useApp.getState().updateChat(sessionId, (c) => ({ approvals: c.approvals.filter((a) => a.approval_id !== approvalId) }));
  return send({ type: 'approval', approval_id: approvalId, approved });
}
