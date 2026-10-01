# Mentor Desktop — Architecture

## 1. Three layers

| Layer | Tech | Responsibility |
|---|---|---|
| Shell | Electron (`electron/`) | Window, tray, global Spotlight shortcut, native dialogs, notifications, login item, single instance; spawns and supervises the engine on a free localhost port |
| UI | React + Vite + zustand (`src/`) | Every panel; talks to the engine over REST and two WebSockets |
| Engine | Python 3.11 + FastAPI (`engine/mentor_engine/`) | Agent runtime, Bedrock calls, tools, MCP, memory, indexing, scheduling, storage |

The renderer is sandboxed (`contextIsolation`, no Node). It reaches the OS only through the small `window.mentor` bridge in `preload.cjs`. The engine binds to `127.0.0.1`, and CORS allows only `localhost` and `app://` / `file://` origins.

## 2. A chat turn, end to end

```
Composer ──ws /ws/chat {type:"chat", session_id, text, attachments, mentions, skill_id, prompt_id, agent_id}
  │
  ▼ runtime.run_turn
  1. persist user message (attachments → image / PDF document / extracted-text blocks)
  2. build_context
       base prompt + agent persona + skills/SOP + attached prompt
       + project instructions + top-k excerpts from @-mentioned projects/folders  (→ "citations" event)
       + top memories + memory-surface folder hits                               (<memory> block)
  3. available_tools = built-in registry (filtered by agent) + MCP tools (unless routing = cloud)
  4. loop ≤ 24 steps:
       llm.complete → Bedrock streaming   (→ "delta" events)
       stop_reason == tool_use → for each tool_use, in parallel:
           security.tool_policy → allow | ask (→ "approval_request", wait for reply) | deny
           built-in handler or mcp.call                                            (→ tool_start / tool_end)
       all tool_results returned in one user message → next step
  5. trace recorded (Diagnostics › Activity Log), "done" event with usage and artifacts
  6. background: memory.capture_turn (facts, people, calendar suggestions)
```

Messages are stored in **Anthropic Messages API shape**, including thinking blocks, and replayed append-only. That is required for Claude Opus 5.5's preserved-thinking checks.

### WebSocket protocol (`/ws/chat`)
Client → server: `chat`, `approval {approval_id, approved}`, `cancel {request_id}`, `ping`.
Server → client (all carry `request_id`, `session_id`): `start`, `session_title`, `citations`, `delta`, `tool_start`, `tool_end`, `approval_request`, `notice`, `error`, `done`.

`/ws/events` streams `event` (tool calls, errors, turn summaries), `backend` (Python logging) and `trace` updates to Diagnostics.

## 3. Model layer (`llm.py`)
- `BedrockProvider` uses `anthropic.AsyncAnthropicBedrockMantle` (the Anthropic Messages API on Bedrock), with streaming, tools and `output_config.effort`. Credentials resolve in this order: explicit keys, then AWS profile, then the default chain.
- Defaults: main model `anthropic.claude-opus-5-5` (effort `medium`), fast model `anthropic.claude-haiku-4-5` for memory extraction and drafting. Opus 5.5 always runs adaptive thinking, and effort is the only depth control.
- Errors map to clear user-facing messages: auth, access, throttling, region, network.
- `DemoProvider` is deterministic and offline. It triggers real tools from keywords so the full pipeline can be tested without AWS.
- Titan embeddings and Nova Canvas images go through `boto3` `bedrock-runtime`.

## 4. Routing modes
`settings.routing.mode` is engine-managed: `bedrock_direct` (default: Bedrock + built-in + MCP tools) or `cloud` (no MCP tools). Inference is always on Bedrock. "Local" means tools run on the machine.

## 5. Tools (`tools/`)
Tools are registered with `@tool(name, description, json_schema, risk, category)`. Each handler gets `(args, ToolContext)` and returns text or JSON. Risk drives approvals:
- `low`: read-only (search, read, list).
- `medium`: creates local content (artifacts, calendar, memory).
- `high`: changes the outside world or executes code (write_file, run_python, run_shell, memory_forget, mcp_install).

`run_python` / `run_shell` also pass **Exec Safety**: deny-list → allow-list → ask or block. File tools resolve paths through `knowledge.resolve_allowed`. Only Mentor's own folders and the allow-listed **Directories** are reachable, and writes need *Read + write* access.

## 6. MCP (`mcp_manager.py`)
- Config is `~/MentorDesktop/mcp.json` (Claude Desktop format).
- Each server runs in its own asyncio task that holds the transport (stdio / Streamable HTTP / SSE) and `ClientSession` open until stopped. The status is one of `connecting | online | error | stopped | disabled`.
- Tools are exposed as `server__tool`. Read-only annotations make a tool `low` risk; everything else is `medium`.
- Install paths: registry wizard, chat or UI install commands, manual entry, pasted JSON, and Marketplace connector packages.

## 7. Knowledge & memory
| Store | Namespace | Fed by | Used by |
|---|---|---|---|
| Knowledge base | `kb` | Data panel uploads | `knowledge_search` tool |
| Projects | `project:<id>` | project files, live URL sources | `@` mentions (auto-retrieval + citations), `project_search` |
| Indexed folders | `folder:<id>` | Settings › Directories | `@` (project surface) or automatic recall (memory surface) |
| Memory | `memory` | post-turn extraction, explicit `memory_save` | automatic recall every turn, Memory panel |

Pipeline: `ingest.extract_text` (PDF/DOCX/XLSX/PPTX/HTML/text) → `chunk_text` (paragraph-aware, ~1200 chars, 200 overlap) → `vectors.add` (Titan v2 512-d, or the local hashing embedder) → SQLite `vectors` table. Search is cosine similarity in numpy plus a small keyword boost, grouped by embedder so vector spaces never mix. For very large corpora, swap in FAISS behind `VectorStore.search`.

Memory extraction asks the fast model for durable facts, people and dated events as JSON. Without Bedrock it falls back to regex heuristics. Near-duplicates (cosine ≥ 0.92) bump a hit counter instead of creating a new memory. Dated events become **calendar suggestions** that you approve.

## 8. Library (`library.py`, `catalog.py`)
- Agents, skills, SOPs and prompts are JSON documents in the `docs` table.
- **AIM packages**: `install` records the package and `import` composes its skills, agents and MCP servers. `remove` tears those down but keeps any MCP server another imported package still needs; the package itself stays installed.
- Skills can be built from scratch, from a description, or from a conversation. The last two are drafted by the LLM.

## 9. Scheduler (`scheduler.py`)
A 20-second asyncio loop fires due tasks and agent schedules through `runtime.run_headless`. Background runs can't ask for approval, so tools that need it are refused. The same loop does housekeeping roughly every 10 minutes: refreshes live project sources, re-indexes folders set to auto re-index, and runs OneDrive mirroring. Plain-language schedules become cron via `parse_schedule`, evaluated in the user's timezone with `croniter` + `zoneinfo`.

## 10. Storage
`db.py` provides a JSON document store (`docs(collection, id, data)`) plus `messages` and `vectors` tables in SQLite (WAL mode). Settings are in `settings.json` (deep-merged over defaults). Secrets are masked in every API response and in support bundles.

## 11. Extending
- **New data source**: add an MCP server, optionally a registry entry or Marketplace package.
- **New built-in tool**: add an `@tool` function in `engine/mentor_engine/tools/*.py`.
- **New panel**: add `src/panels/X.jsx`, register it in `NAV` in `src/App.jsx`, and add REST routes in `app.py`.
- **New skill/SOP shipped to everyone**: add it to `MARKETPLACE` in `catalog.py`.
