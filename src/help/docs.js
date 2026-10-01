// In-app Help Center content. Link between pages with [text](#page-id).
export const DOCS = [
  {
    id: 'getting-started',
    group: 'Basics',
    title: 'Getting Started',
    body: `> **Quick guide:** Mentor Desktop is your AI-powered desktop assistant. Launch the app and start chatting — it's that simple.

## What is Mentor Desktop?
An all-in-one AI assistant that lives on your computer: answer questions, write documents, generate images and charts, search the web, run code, and work with your local files — from one chat interface. It's a real desktop app, so it can use local files, run tools on your machine and run tasks in the background. **AI inference always runs on AWS Bedrock**, so an internet connection is required.

## The three parts
| Layer | Technology | What it does |
|---|---|---|
| Desktop shell | Electron | Window, system tray, keyboard shortcuts, native OS integration |
| User interface | React | Chat, sidebar, settings and every panel |
| Engine | Python | Talks to AI models, runs tools, manages memory and knowledge, orchestrates tasks |

## Your first launch
- **Sidebar (left):** navigation — Chat, Projects, Agents, Integrations, Data, Memory, Settings and more.
- **Chat area (centre):** type a message, press **Enter**, and the response streams in.
- **Top bar:** session title, routing mode, model and quick controls (split view, export, new chat).

## First things to try
- *"What's the difference between a defined-benefit and a defined-contribution pension?"*
- *"Write me a professional email declining a meeting invitation."*
- *"What's the latest news on UK audit reform? Cite sources."*
- *"Create an image of a cosy cabin in the mountains at sunset."*
- Drag a PDF into chat and ask *"Summarise this document for me."*

## Marquee features
- **Projects and @-mentions** — group chats and files, then type **@** to bring a project into the conversation. See [Projects](#projects).
- **The / picker** — type **/** to run a Skill or SOP. See [Capabilities](#capabilities).
- **40+ built-in tools** — the AI picks the right one automatically. See [Tools & MCP](#tools-mcp).

## Common questions
**Do I need an internet connection?** Yes. "Local" in routing modes refers to tools on your machine, not offline AI.

**Is my data private?** Files, conversation history and memory are stored locally in \`~/MentorDesktop\`. Message content is sent to AWS Bedrock for processing. Mentor does not sell or share your data.

**What if the AI gives a wrong answer?** Verify important information and add detail to your question. The [Activity Log](#diagnostics) shows each step and tool call.`,
  },
  {
    id: 'chat',
    group: 'Basics',
    title: 'Chat Basics',
    body: `> **Quick guide:** Type a message, press Enter, get a streamed response. Use voice, attach files, **@**-mention projects and folders, run skills with **/**, and keep many conversations in tabs — even side by side.

## The composer
- **Enter** sends · **Shift+Enter** new line · **↑/↓** in an empty box recalls previous messages.
- **@** — mention a project or indexed folder; Mentor retrieves the most relevant excerpts and cites them.
- **/** — the unified Skills & SOPs picker.
- **+** — attach files or a saved prompt (Prompts tab). Prompt chips apply to one message, then clear.
- **Persona chip** — chat as any of your agents, with its instructions, tools and skills.
- **Mic** — voice input (**Ctrl+Shift+E**).
- **Drag & drop / paste** files: PDF, Word, Excel, PowerPoint, images, text and code.

## Responses
Responses stream in real time. Tool calls appear inline — click one to see its input and result. Generated files show as cards or inline images; click to preview, zoom (**+ / − / 0**), open or download.

## Tabs and split view
- **Ctrl+T** new tab, **Ctrl+W** close, **Ctrl+Tab / Ctrl+Shift+Tab** cycle.
- **Ctrl+Shift+\\\\** split into two panes; drag tabs between panes or right-click a tab to move it; **Ctrl+Shift+← / →** to focus a pane.

## Memory across chats
Each tab has its own context, and [Semantic Memory](#memory) recalls preferences and facts across sessions.

**Export:** use the download button in the top bar to save a conversation as Markdown.`,
  },
  {
    id: 'projects',
    group: 'Work',
    title: 'Projects',
    body: `> **Quick guide:** Projects group chats, files and live sources around a piece of work. Type **@** in chat to ground answers in a project, with citations.

## Creating a project
Open **Projects › New project** and choose a template — *Client Engagement*, *Due Diligence*, *Proposal / Pursuit*, *Internal Initiative* or *Blank*. Templates add sections and standing instructions that are applied whenever the project is mentioned.

## Inside a project
- **Files** — add documents; they're indexed locally. "Edit raw files" opens an editor that re-indexes on save.
- **Live sources** — URLs that refresh hourly/daily/weekly so answers stay current.
- **Chats** — conversations attached to the project.
- **Status reports** — AI-generated RAG status from files and recent chats.
- **Settings & sharing** — project instructions, attached agent, share by alias (creates a portable \`.mentorproject.zip\`).

## Common questions
**Do @-mentions send my whole project to the AI?** No — only the most relevant excerpts, plus any document the agent explicitly opens.

**Where is project data stored?** Locally under \`~/MentorDesktop/projects\`, with a per-project search index that's purged when the project is deleted.

**Can a chat use more than one project?** Yes — mention several.

## Tips
- One project per stream of work — focused projects retrieve better.
- Indexed folders with the **Project** surface (Settings › Directories) are @-mentionable too.`,
  },
  {
    id: 'agents',
    group: 'Work',
    title: 'Agent Builder',
    body: `> **Quick guide:** Agents are specialists with their own instructions, tools and skills.

## Easy mode vs Advanced mode
**Easy:** name, description, tools, personality (Professional, Friendly, Concise, Detailed) — use **Draft with AI** to write the system prompt.

**Advanced:** full system prompt, model, **effort** (thinking depth — current Claude models replace temperature with effort), max tokens, input/output JSON schemas, environment variables.

## Writing a good system prompt
- Be specific about the role ("a senior bid manager in Advisory", not "a writer").
- Define the output format.
- Set boundaries ("never invent credentials; use [TBC]").
- Include an example of a great answer.

## Using agents
- **Chat as the agent** — persona chip in the composer.
- **Attach to a project** — Project › Settings.
- **Schedule it** — Agent › Schedule tab (cron or plain language, in your timezone).
- **Run history** — every run is logged with input, output, tools, duration and status.

## Sharing
**Export** saves a JSON file (with its skills). **Import agent** loads one a colleague shared. **Duplicate** creates variations.`,
  },
  {
    id: 'scheduled',
    group: 'Work',
    title: 'Scheduled Tasks',
    body: `> **Quick guide:** Run prompts or agents automatically — "weekdays at 2pm", "every Monday morning" — in your configured timezone.

1. Open **Scheduled › New task**.
2. Write the prompt (anything you could type in chat).
3. Set the schedule in plain language or cron — the preview shows the next run.
4. Optionally choose an agent and a project for context.

Runs use the same pipeline as chat. Tools that need approval are skipped in background runs (there's nobody to ask). Generated files land in **Artifacts**; each run is logged and can be opened as a chat.

You can also ask in chat: *"Every Friday at 4pm, generate the weekly metrics one-pager."*`,
  },
  {
    id: 'capabilities',
    group: 'Work',
    title: 'Capabilities — Skills, SOPs & Packages',
    body: `> **Quick guide:** Browse and install Skills (workflows) and SOPs (step-by-step playbooks), manage packages, and author your own. Type **/** in chat to use them.

## Concepts
- **Skill** — a workflow the AI follows inside any conversation.
- **SOP** — an ordered procedure; runs immediately and tells you which step it's on.
- **Context pack** — background knowledge or house style.
- **Agent** — a full persona that can bundle skills.
- **Connector** — an MCP server packaged for one-click install.

## Tabs
- **Marketplace** — install packages; each card shows a **security advisory**.
- **My skills & SOPs** — your library; **Use** sends one to chat.
- **Build** — from scratch, from a description, or **from a conversation** (distil a chat that went well).
- **AIM Manager** — everything installed, with stage and health. **Remove** tears down the agents, skills and context composed from a package and disconnects its MCP servers (unless another package needs them); the package stays installed and can be re-imported.`,
  },
  {
    id: 'prompts',
    group: 'Work',
    title: 'Prompt Library',
    body: `> **Quick guide:** Save reusable prompts. Attach one with the **+** button in chat; it applies to your next message.

- **Local** — your prompts plus locked built-ins, filterable by folder, favourites and tags.
- **Cloud** — prompts shared by your organisation (set the catalog URL in Settings › General).
- Built-ins can't be edited — use **Customise copy**.
- For a workflow you run constantly, build an [agent](#agents); for step-by-step procedures, use an [SOP](#capabilities).`,
  },
  {
    id: 'knowledge-base',
    group: 'Knowledge',
    title: 'Knowledge Base (Data)',
    body: `> **Quick guide:** Upload reference documents the AI can search — policies, methodologies, reports.

Drag files into **Data** or click **Upload**. They're extracted, chunked and embedded locally (Amazon Titan embeddings when Bedrock is configured, a local embedder otherwise). Use the search box to test retrieval.

| | Semantic Memory | Knowledge Base |
|---|---|---|
| Created | Automatically from chats | By uploading documents |
| Contains | Facts, preferences, context | Documents and reference material |
| Best for | Personalisation and continuity | Reference library |

For engagement-specific material, prefer a [Project](#projects).`,
  },
  {
    id: 'memory',
    group: 'Knowledge',
    title: 'Semantic Memory',
    body: `> **Quick guide:** Mentor remembers useful facts and preferences across conversations — locally, under your control.

## How it works
After each turn, a fast model extracts durable facts (preferences, role, clients, decisions, deadlines), skips small talk, de-duplicates and stores them with embeddings. Before each turn, relevant memories are recalled into context automatically.

## The Memory hub
- **Search** — semantic search; delete individual memories or wipe everything.
- **People** — person cards (title, department, location, directory link, notes).
- **Graph** — how memories, people, topics and projects connect.
- **Folders** — feed local folders into memory (Memory surface).

## Tips
Be explicit: *"Remember that I prefer UK English and tables over prose."* Review memories occasionally. Turn capture off in Settings › Privacy.`,
  },
  {
    id: 'directories',
    group: 'Knowledge',
    title: 'Indexed Folders (Directories)',
    body: `> **Quick guide:** Allow-list local folders for the AI to read (or write), and optionally index them.

1. **Settings › Directories › Add directory…** — picking the folder is your consent.
2. Choose access: **Read-only** (default) or **Read + write** (asks you to confirm; each write still needs approval).
3. Choose an index surface: **Project** (@-mentionable, indexed in place), **Memory** (recalled automatically) or **None** (access only).

Click a folder to see per-file status: indexed, new, changed, skipped (and why) or missing. Re-index in one click or enable auto re-index (only changed files are re-processed). Indexing skips \`node_modules\`, \`.git\`, \`venv\`, build output, caches and files over 25 MB.`,
  },
  {
    id: 'tools-mcp',
    group: 'System',
    title: 'Tools & MCP',
    body: `> **Quick guide:** Tools are functions the AI calls automatically. MCP (Model Context Protocol) connects external tool servers — your data sources.

## Built-in tools
Web search & fetch · Word, Excel, CSV, HTML, Markdown, charts · image generation · Python & shell (exec-safety gated) · read/search/write local files · memory · knowledge base & project search · calendar · scheduling · presentations · calculator, unit conversion, date/time · MCP management.

## How an MCP tool call works
1. You send a message. 2. The model decides a tool helps. 3. Mentor sends a structured request to the MCP server. 4. The server returns results. 5. The model uses them in its answer.

## Connecting data sources
Open **Integrations › Add server**: the **setup wizard** (curated registry), an **install command**, **manual** (stdio command or remote HTTP/SSE URL with headers), or **paste JSON** in Claude Desktop format. You can also paste commands into chat:
- \`install slack\`, \`aim mcp install <pkg>\`, \`mcp-registry install <pkg>\`, \`toolbox install <pkg>\`, \`uvx <pkg>\`, \`npx <pkg>\`

Config lives in \`~/MentorDesktop/mcp.json\`. MCP tools appear to the model as \`server__tool\`.

## Troubleshooting
A red status in Integrations means the server isn't running — check the error, Node.js/uv availability, and credentials, then **Restart**.`,
  },
  {
    id: 'routing',
    group: 'System',
    title: 'Routing Modes',
    body: `> Routing modes control which agent path handles a request and whether MCP tools participate. Mentor manages this automatically — there's no picker.

- **AI inference always runs on AWS Bedrock.** "Local" refers to tools running locally.
- **bedrock_direct** (default) — Bedrock model + built-in and MCP tools.
- **cloud** — runs without MCP tools.
- The current mode is shown in the top bar and Diagnostics › Config.`,
  },
  {
    id: 'security',
    group: 'System',
    title: 'Security',
    body: `> **Quick guide:** Exec Safety governs command execution; Tool Approvals decide which tools need your OK.

- **Tool approvals** — default policy *ask for high-risk tools*, plus per-tool overrides (allow / ask / deny). Approvals appear inline in chat.
- **Exec safety** — Disabled, Ask (recommended) or Allow-list only, with an allow-list and an always-blocked list.
- **Audit log** — every gated decision is recorded.
- Folder read/write grants live in [Directories](#directories).`,
  },
  {
    id: 'artifacts',
    group: 'Workspace',
    title: 'Artifacts & Presentations',
    body: `## Artifacts
Everything Mentor generates is stored in \`~/MentorDesktop/artifacts/<type>/\` and shown in a gallery with type filters and previews. Deletion is permanent (no recycle bin). Optional one-way **OneDrive mirroring** in Settings › Directories.

## Presentations
Ask *"Create a 6-slide deck on our Q3 project status."* Decks open in **Presentations** with a filmstrip, editor (layouts, bullets, two columns, speaker notes, themes) and **Export .pptx** — real PowerPoint layouts that stay editable. Import an existing .pptx to edit it.`,
  },
  {
    id: 'dashboard',
    group: 'Workspace',
    title: 'Mission Control & Calendar',
    body: `## Dashboard
Pick your role (Partner, Director, Manager, Consultant, Analyst) to tailor quick actions. Generate a **morning briefing**, check **system health** (green / yellow / red / gray), upcoming items, recent agent runs and artifacts.

## Calendar & Tasks
Month, week and day views for events, tasks, reminders and deadlines. Create items in natural language via chat. Mentor can **suggest** items it detects in conversations — you approve or dismiss them. Connect Outlook through the Microsoft 365 connector to work with your real calendar.`,
  },
  {
    id: 'diagnostics',
    group: 'System',
    title: 'Diagnostics',
    body: `> The Debug Console shows what Mentor is doing under the hood.

- **Event Log** — live tool calls, turn summaries and errors (captured while the panel is open).
- **Tools** — built-in + MCP = total capabilities.
- **Activity Log** — step-by-step trace per request: context, model calls (stop reason, tokens, time), each tool call.
- **Events** — low-level engine log.
- **Config** — current configuration as JSON (secrets masked).

**Debug ON** switches the engine to DEBUG logging. **Export support bundle** creates a zip of logs, sanitised config and diagnostics — no conversation content. **Report Issue** (sidebar) files a report and attaches the bundle automatically.`,
  },
  {
    id: 'settings',
    group: 'System',
    title: 'Settings',
    body: `Open with **Ctrl+,**. Sections: General (name, role, timezone), **Models & AWS** (provider, model, effort, region, AWS profile or keys, **Test connection**), Appearance, Voice, Directories, Privacy, Startup & updates, System status.

**Connecting Bedrock:** run \`aws sso login --profile <name>\`, enter the profile and region, and click Test connection. Your account needs Bedrock model access for the chosen Claude model (and Titan embeddings / Nova Canvas for embeddings and images).`,
  },
  {
    id: 'shortcuts',
    group: 'Basics',
    title: 'Keyboard Shortcuts',
    body: `| Shortcut | Action |
|---|---|
| Ctrl+N | New chat |
| Ctrl+T / Ctrl+W | New / close tab (chat) |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous tab |
| Ctrl+Shift+\\\\ | Toggle split view |
| Ctrl+Shift+← / → | Focus left / right pane |
| Ctrl+B or Ctrl+\\\\ | Toggle sidebar |
| Ctrl+, | Settings |
| Ctrl+/ | Help Center |
| Ctrl+Shift+D | Diagnostics |
| Ctrl+Shift+M | Dashboard |
| Ctrl+Shift+L | Cycle theme (dark → light → system) |
| Ctrl+Shift+Space | Spotlight (from any app) |
| Ctrl+Shift+E | Voice input |
| Ctrl+1…8 | Chat, Integrations, Memory, Data, Diagnostics, Dashboard, Prompts, Settings |
| Esc | Back to chat / close modal |
| Enter / Shift+Enter | Send / new line |
| ↑ / ↓ (empty input) | Recall sent messages |
| + / − / 0 | Zoom image preview |

On macOS use ⌘ instead of Ctrl. In the tab bar: ←/→ move focus, Enter/Space switch, Home/End first/last, Delete closes.`,
  },
];
