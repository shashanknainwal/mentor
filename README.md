# Mentor Desktop

An AI assistant for KPMG Advisory that runs as a desktop app. Chat, projects with cited answers, custom agents, scheduled tasks, skills and SOPs, semantic memory, a knowledge base, document/deck/chart generation, and MCP connectors to your data sources. All model calls go to **AWS Bedrock** (Claude).

```
Electron shell (window, tray, global shortcuts, native dialogs, engine supervisor)
  └─ React UI (Vite)  ──REST + WebSocket──▶  Python engine (FastAPI)
                                               ├─ agent runtime → AWS Bedrock (Claude Opus 5.5 by default)
                                               ├─ 41 built-in tools + MCP servers (your data sources)
                                               └─ local storage: ~/MentorDesktop (SQLite, vectors, artifacts)
```

## Quick start (about 10 minutes)

Prerequisites: **Node.js 20+**, **Python 3.11+**. To use connectors, also install Node (`npx`) and/or [uv](https://docs.astral.sh/uv/) (`uvx`).

```bash
npm install                # UI + Electron
npm run setup:engine       # creates .venv and installs the Python engine
npm run dev                # starts engine (8765) + Vite (5173) + Electron
```

No Electron (or headless dev)? Run `npm run web` and open http://localhost:5173.

### Connect AWS Bedrock

1. Sign in: `aws sso login --profile <your-profile>`
2. In Mentor, open **Settings › Models & AWS** (`Ctrl+,`).
3. Set **Provider = AWS Bedrock**, your **AWS profile** and **region**, then click **Test connection**.

Your AWS account needs Bedrock model access for:
- `anthropic.claude-opus-5-5` (chat; Sonnet 5.5 and Haiku 4.5 are selectable)
- `amazon.titan-embed-text-v2:0` (memory/knowledge embeddings; a local embedder is used if unavailable)
- `amazon.nova-canvas-v1:0` (image generation, optional)

Until Bedrock is configured you can switch **Provider = Demo mode**. It makes no AWS calls and still exercises streaming, tools, memory and approvals.

## Connecting data sources (MCP)

MCP is the plug-in point for KPMG data: SharePoint, Snowflake/SQL, internal APIs, Slack/Teams, and so on. You can add a server in four ways:

1. **Integrations › Add server › Setup wizard**: a curated registry (filesystem, fetch, git, sqlite, postgres, github, slack, ms365…).
2. **Install command**, typed in Integrations or pasted into chat:
   `install slack` · `aim mcp install <pkg>` · `mcp-registry install <pkg>` · `toolbox install <pkg>` · `uvx <pkg>` · `npx <pkg>`
3. **Manual**: a stdio command, or a remote **Streamable HTTP / SSE** URL with auth headers.
4. **Paste JSON** in Claude Desktop format, or edit `~/MentorDesktop/mcp.json` directly:

```json
{
  "mcpServers": {
    "client-dataroom": { "command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "C:/engagements/acme/dataroom.db"] },
    "kpmg-knowledge":  { "url": "https://mcp.internal.example/mcp", "headers": { "Authorization": "Bearer <token>" } }
  }
}
```

Each tool appears to the model as `server__tool`. Every connected tool is governed by **Security › Tool approvals**. Read-only MCP tools default to *allow*; all others default to *medium* risk.

To ship an approved connector to colleagues as a one-click install, add it to the `REGISTRY` in `engine/mentor_engine/mcp_manager.py` or package it in `engine/mentor_engine/catalog.py` (`MARKETPLACE`).

## What's in the box

| Area | What you get |
|---|---|
| **Chat** | Streaming responses; tabs and split panes; `@` project/folder mentions with citations; `/` skills & SOPs picker; `+` files and prompts; chat-as-agent persona chip; drag/drop/paste attachments (PDF, Office, images, code); inline tool calls; approval cards; voice input/TTS; export to Markdown |
| **Projects** | Templates (Client Engagement, Due Diligence, Proposal, Internal); files with a raw editor; live URL sources with refresh cadence; attached agent; AI status reports; share by alias (portable bundle) and import |
| **Agents** | Easy and Advanced modes; AI-drafted system prompts; per-agent tools, skills, model, effort, schemas, env vars; schedule tab; run history; export/import/duplicate |
| **Scheduled** | Plain-language schedules ("weekdays at 2pm") → cron in your timezone; run now; run log |
| **Capabilities** | Marketplace with security advisories; skills, SOPs, context packs, agent and connector packages; Build from scratch, from a description, or from a past conversation; AIM Manager with import, remove and refresh |
| **Prompts** | Locked built-ins (consulting-oriented); folders, tags, favourites; Cloud tab from an org catalog URL |
| **Data / Memory** | Knowledge base; automatic memory capture, semantic search, People cards, knowledge Graph; memory-indexed folders |
| **Directories** | Allow-listed folders with read or read+write access; Project, Memory or None index surface; per-file index status; incremental re-index |
| **Workspace** | Mission Control dashboard (role-based, morning briefing, health); Calendar with AI-suggested items to approve; Artifacts gallery; Presentations editor with real `.pptx` export/import |
| **System** | Security (tool approvals, exec safety, audit log); Diagnostics (event log, tools, activity traces, backend events, config, support bundle); Report Issue; Help Center; Settings |
| **Shell** | System tray; Spotlight quick-ask from any app (`Ctrl+Shift+Space`); launch at login; minimise to tray; single-instance; engine auto-restart |

Keyboard shortcuts are listed in **Help › Keyboard Shortcuts**.

## Project layout

```
electron/            main.cjs (window, tray, Spotlight, IPC) · engine.cjs (spawns/supervises Python) · preload.cjs
src/                 React UI
  chat/              ChatView (tabs/split) · ChatPane · Composer (@ / + pickers) · Message
  panels/            one file per sidebar view
  lib/               api.js (REST) · chatSocket.js (WebSocket protocol) · store.js (zustand)
  help/docs.js       in-app Help Center content
engine/mentor_engine Python engine
  app.py             FastAPI routes + /ws/chat + /ws/events
  runtime.py         the agent loop (context → Bedrock → tools → approvals → persistence)
  llm.py             Bedrock (Anthropic Messages API via Bedrock Mantle) + demo provider
  tools/             built-in tools (web, documents, code, productivity, system)
  mcp_manager.py     MCP client manager (stdio, Streamable HTTP, SSE)
  memory.py · knowledge.py · vectors.py · ingest.py · scheduler.py · library.py · catalog.py · …
docs/ARCHITECTURE.md how it all fits together
```

## Testing

```bash
npm test             # engine test suite (pytest, runs in demo mode in a temp data dir)
npm run build        # production UI build
```

## Packaging

`npm run dist` builds installers with electron-builder: NSIS on Windows, DMG on macOS, AppImage on Linux. The engine is copied into the app's `resources/engine`. On first launch the shell looks for `resources/engine/.venv`. For managed rollout, either bundle a venv per platform or build a frozen engine (for example with PyInstaller) and point `MENTOR_PYTHON` at it. Code-signing and the auto-update feed (`app:checkUpdates` in `electron/main.cjs`) must be set up before distributing.

## Data & privacy

Everything is stored locally under `~/MentorDesktop` (override with `MENTOR_HOME`): `mentor.db` (SQLite), `settings.json`, `mcp.json`, `artifacts/`, `uploads/`, `projects/`, `logs/`, `bundles/`. Message content goes to AWS Bedrock in your configured account and region. Support bundles exclude conversation content and mask secrets.

## Not yet production-ready

Gaps to close before a firm-wide rollout:
- **Sign-in**: there is no SSO yet. Add Entra ID (MSAL) in the shell and pass identity to the engine if you need per-user audit.
- **Secrets**: AWS keys entered in Settings are stored in `settings.json`. Prefer AWS SSO profiles, or move keys to the OS keychain (`keytar`/`safeStorage`).
- **Computer Use**: the panel, toggle and safety rules are in place. The desktop driver itself is expected to arrive as an approved MCP server.
- **Voice**: speech-to-text uses the Chromium Web Speech API, which isn't available in every Electron build. Wire Amazon Transcribe in as a backend if you need reliable dictation.
- **Built-in tools**: there are 41, not the "60+" in the reference product. Add more in `engine/mentor_engine/tools/` with the `@tool` decorator.
