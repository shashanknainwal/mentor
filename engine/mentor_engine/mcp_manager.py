"""MCP (Model Context Protocol) client manager - the Integrations panel's backend.

Config lives in ~/MentorDesktop/mcp.json using the same shape as Claude Desktop, so
colleagues can paste configs straight in:

    {"mcpServers": {
        "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/work"]},
        "kpmg-data":  {"url": "https://mcp.internal.kpmg.example/mcp", "headers": {"Authorization": "Bearer ..."}},
        "legacy-sse": {"url": "https://host/sse", "transport": "sse"}
    }}

Each server runs in its own asyncio task that holds the transport + ClientSession
open until stopped. Tools are exposed to the model as `<server>__<tool>`.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
import shutil
import time
from typing import Any

from .config import settings
from .events import bus

log = logging.getLogger("mentor.mcp")

# A small curated registry. Extend with KPMG-internal servers as they are approved.
REGISTRY: dict[str, dict[str, Any]] = {
    "filesystem": {
        "description": "Read/write files in folders you choose.",
        "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "{path}"]},
        "params": ["path"],
    },
    "fetch": {"description": "Fetch web pages as markdown.", "config": {"command": "uvx", "args": ["mcp-server-fetch"]}},
    "git": {"description": "Inspect git repositories.", "config": {"command": "uvx", "args": ["mcp-server-git"]}},
    "sqlite": {
        "description": "Query a local SQLite database.",
        "config": {"command": "uvx", "args": ["mcp-server-sqlite", "--db-path", "{path}"]},
        "params": ["path"],
    },
    "github": {
        "description": "GitHub issues, PRs and code (needs a token).",
        "config": {"url": "https://api.githubcopilot.com/mcp/", "headers": {"Authorization": "Bearer {token}"}},
        "params": ["token"],
    },
    "slack": {
        "description": "Read and post Slack messages (needs a bot token).",
        "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-slack"],
                   "env": {"SLACK_BOT_TOKEN": "{token}", "SLACK_TEAM_ID": "{team_id}"}},
        "params": ["token", "team_id"],
    },
    "postgres": {
        "description": "Read-only access to a PostgreSQL database.",
        "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", "{connection_string}"]},
        "params": ["connection_string"],
    },
    "ms365": {
        "description": "Outlook mail & calendar, Teams, OneDrive, SharePoint via Microsoft Graph.",
        "config": {"command": "npx", "args": ["-y", "@softeria/ms-365-mcp-server"]},
    },
    "memory-graph": {"description": "Knowledge-graph memory server.", "config": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}},
}

# Cloud Tools catalog (Integrations > Tools tab). Categories of hosted tools the org can enable.
CLOUD_TOOLS = [
    {"category": "Research", "name": "Web search", "description": "Search the public web and summarise results.", "builtin": "web_search"},
    {"category": "Research", "name": "Web page reader", "description": "Fetch and read any URL.", "builtin": "web_fetch"},
    {"category": "Documents", "name": "Word generator", "description": "Create formatted .docx reports.", "builtin": "create_docx"},
    {"category": "Documents", "name": "Excel generator", "description": "Create .xlsx workbooks from tables.", "builtin": "create_xlsx"},
    {"category": "Documents", "name": "Slide decks", "description": "Draft editable PowerPoint decks.", "builtin": "create_presentation"},
    {"category": "Creative", "name": "Image generation", "description": "Amazon Nova Canvas on Bedrock.", "builtin": "generate_image"},
    {"category": "Data", "name": "Charting", "description": "Bar/line/pie charts as SVG.", "builtin": "create_chart"},
    {"category": "Data", "name": "Spreadsheet analysis", "description": "Profile and summarise CSV/XLSX data.", "builtin": "analyze_table"},
    {"category": "Code", "name": "Python runner", "description": "Run Python in a sandboxed subprocess.", "builtin": "run_python"},
    {"category": "Productivity", "name": "Calendar", "description": "Create and list events, tasks and deadlines.", "builtin": "calendar_create"},
]


def safe_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name)[:40]


class ServerHandle:
    def __init__(self, name: str, config: dict[str, Any]):
        self.name = name
        self.config = config
        self.status = "stopped"
        self.error: str | None = None
        self.tools: list[dict[str, Any]] = []
        self.session = None
        self.task: asyncio.Task | None = None
        self.stop_event = asyncio.Event()
        self.ready = asyncio.Event()
        self.started_at: float | None = None

    def info(self) -> dict[str, Any]:
        cfg = dict(self.config)
        if "env" in cfg:
            cfg["env"] = {k: "********" for k in cfg["env"]}
        if "headers" in cfg:
            cfg["headers"] = {k: "********" for k in cfg["headers"]}
        return {
            "name": self.name,
            "status": self.status,
            "error": self.error,
            "transport": transport_of(self.config),
            "tools": [{"name": t["name"], "description": t.get("description", "")} for t in self.tools],
            "config": cfg,
            "started_at": self.started_at,
        }


def transport_of(cfg: dict[str, Any]) -> str:
    if cfg.get("url"):
        return cfg.get("transport") or ("sse" if cfg["url"].rstrip("/").endswith("/sse") else "http")
    return "stdio"


class MCPManager:
    def __init__(self) -> None:
        self.servers: dict[str, ServerHandle] = {}

    # ---- config --------------------------------------------------------
    def read_config(self) -> dict[str, Any]:
        path = settings.mcp_path
        if not path.exists():
            return {"mcpServers": {}}
        try:
            data = json.loads(path.read_text("utf-8"))
            data.setdefault("mcpServers", {})
            return data
        except json.JSONDecodeError as e:
            log.error("mcp.json is invalid: %s", e)
            return {"mcpServers": {}}

    def write_config(self, data: dict[str, Any]) -> None:
        settings.mcp_path.write_text(json.dumps(data, indent=2), "utf-8")

    # ---- lifecycle -------------------------------------------------------
    async def start_all(self) -> None:
        for name, cfg in self.read_config()["mcpServers"].items():
            if not cfg.get("disabled"):
                await self.start(name, cfg, wait=False)

    async def stop_all(self) -> None:
        for name in list(self.servers):
            await self.stop(name)

    async def start(self, name: str, cfg: dict[str, Any], wait: bool = True) -> ServerHandle:
        await self.stop(name)
        h = ServerHandle(name, cfg)
        self.servers[name] = h
        h.status = "connecting"
        h.task = asyncio.create_task(self._run(h))
        if wait:
            try:
                await asyncio.wait_for(h.ready.wait(), timeout=45)
            except asyncio.TimeoutError:
                h.status, h.error = "error", "timed out connecting (45s)"
        return h

    async def stop(self, name: str) -> None:
        h = self.servers.pop(name, None)
        if h and h.task:
            h.stop_event.set()
            try:
                await asyncio.wait_for(h.task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError, Exception):
                h.task.cancel()

    async def restart(self, name: str) -> ServerHandle:
        cfg = self.read_config()["mcpServers"].get(name)
        if cfg is None:
            raise KeyError(name)
        return await self.start(name, cfg)

    async def _run(self, h: ServerHandle) -> None:
        from mcp import ClientSession

        cfg = h.config
        kind = transport_of(cfg)
        try:
            if kind == "stdio":
                from mcp.client.stdio import StdioServerParameters, stdio_client

                command = cfg["command"]
                if shutil.which(command) is None:
                    raise FileNotFoundError(
                        f"'{command}' is not installed or not on PATH. Install Node.js (npx) or uv (uvx) first."
                    )
                params = StdioServerParameters(
                    command=command, args=cfg.get("args", []), env={**os.environ, **cfg.get("env", {})}, cwd=cfg.get("cwd")
                )
                errlog = open(settings.home / "logs" / f"mcp-{safe_name(h.name)}.log", "a", encoding="utf-8")
                cm = stdio_client(params, errlog=errlog)
            elif kind == "sse":
                from mcp.client.sse import sse_client

                cm = sse_client(cfg["url"], headers=cfg.get("headers"))
            else:
                import httpx2  # bundled with the mcp SDK
                from mcp.client.streamable_http import streamable_http_client

                client = httpx2.AsyncClient(headers=cfg.get("headers") or {}, timeout=60)
                cm = streamable_http_client(cfg["url"], http_client=client)

            async with cm as streams:
                read, write = streams[0], streams[1]
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    listed = await session.list_tools()
                    h.tools = [
                        {
                            "name": t.name,
                            "description": t.description or "",
                            "input_schema": getattr(t, "input_schema", None) or getattr(t, "inputSchema", None) or {"type": "object"},
                            "read_only": bool(getattr(getattr(t, "annotations", None), "read_only_hint", False)
                                              or getattr(getattr(t, "annotations", None), "readOnlyHint", False)),
                        }
                        for t in listed.tools
                    ]
                    h.session = session
                    h.status = "online"
                    h.error = None
                    h.started_at = time.time()
                    h.ready.set()
                    bus.emit("mcp_connected", server=h.name, tools=len(h.tools))
                    await h.stop_event.wait()
            h.status = "stopped"
        except asyncio.CancelledError:
            h.status = "stopped"
        except BaseException as e:  # ExceptionGroup from anyio task groups included
            msg = str(e)
            if hasattr(e, "exceptions") and e.exceptions:  # type: ignore[attr-defined]
                msg = "; ".join(str(x) for x in e.exceptions)  # type: ignore[attr-defined]
            h.status, h.error = "error", msg[:500]
            log.warning("MCP server %s failed: %s", h.name, msg)
            bus.emit("mcp_error", server=h.name, error=msg[:500], level="error")
        finally:
            h.session = None
            h.ready.set()

    # ---- tools -------------------------------------------------------------
    def tool_specs(self) -> list[dict[str, Any]]:
        specs = []
        for h in self.servers.values():
            if h.status != "online":
                continue
            for t in h.tools:
                schema = t["input_schema"] if isinstance(t["input_schema"], dict) else {"type": "object"}
                specs.append(
                    {
                        "name": f"{safe_name(h.name)}__{safe_name(t['name'])}"[:64],
                        "description": f"[{h.name}] {t['description']}"[:1024],
                        "input_schema": schema,
                        "server": h.name,
                        "tool": t["name"],
                        "risk": "low" if t.get("read_only") else "medium",
                    }
                )
        return specs

    async def call(self, server: str, tool: str, args: dict[str, Any]) -> tuple[str, bool]:
        h = self.servers.get(server)
        if not h or h.session is None:
            return f"MCP server '{server}' is not connected.", True
        res = await h.session.call_tool(tool, args)
        parts = []
        for c in getattr(res, "content", []) or []:
            if getattr(c, "type", "") == "text":
                parts.append(c.text)
            elif getattr(c, "type", "") == "image":
                parts.append(f"[image {getattr(c, 'mime_type', getattr(c, 'mimeType', ''))}]")
            else:
                parts.append(str(c))
        structured = getattr(res, "structured_content", None) or getattr(res, "structuredContent", None)
        if not parts and structured:
            parts.append(json.dumps(structured))
        is_error = bool(getattr(res, "is_error", False) or getattr(res, "isError", False))
        return "\n".join(parts) or "(no content)", is_error

    def status(self) -> list[dict[str, Any]]:
        cfg = self.read_config()["mcpServers"]
        out = []
        for name, c in cfg.items():
            h = self.servers.get(name)
            if h:
                out.append(h.info())
            else:
                out.append({"name": name, "status": "disabled" if c.get("disabled") else "stopped", "error": None,
                            "transport": transport_of(c), "tools": [], "config": {}})
        return out

    # ---- install / edit ------------------------------------------------------
    async def add_server(self, name: str, cfg: dict[str, Any], start: bool = True) -> dict[str, Any]:
        name = safe_name(name)
        data = self.read_config()
        data["mcpServers"][name] = cfg
        self.write_config(data)
        if start and not cfg.get("disabled"):
            await self.start(name, cfg)
        return self.servers[name].info() if name in self.servers else {"name": name, "status": "stopped"}

    async def remove_server(self, name: str) -> bool:
        await self.stop(name)
        data = self.read_config()
        existed = data["mcpServers"].pop(name, None) is not None
        self.write_config(data)
        return existed

    async def set_enabled(self, name: str, enabled: bool) -> None:
        data = self.read_config()
        cfg = data["mcpServers"].get(name)
        if cfg is None:
            raise KeyError(name)
        cfg["disabled"] = not enabled
        self.write_config(data)
        if enabled:
            await self.start(name, cfg)
        else:
            await self.stop(name)

    async def import_json(self, text: str) -> list[str]:
        """Bulk import a pasted {"mcpServers": {...}} (or bare {...}) snippet."""
        data = json.loads(text)
        servers = data.get("mcpServers", data)
        added = []
        for name, cfg in servers.items():
            if isinstance(cfg, dict) and (cfg.get("command") or cfg.get("url")):
                await self.add_server(name, cfg, start=True)
                added.append(name)
        return added

    def parse_install_command(self, text: str) -> tuple[str, dict[str, Any]] | None:
        """Understand chat install commands:
        install slack | aim mcp install <pkg> | mcp-registry install <pkg> | toolbox install <pkg> | uvx <pkg> | npx <pkg>
        """
        t = text.strip()
        m = re.match(r"^(?:install|aim mcp install|mcp-registry install|toolbox install)\s+(\S+)(.*)$", t, flags=re.I)
        if m:
            pkg, rest = m.group(1), m.group(2).strip()
            key = pkg.lower().split("/")[-1].replace("server-", "").replace("mcp-", "")
            if key in REGISTRY:
                cfg = json.loads(json.dumps(REGISTRY[key]["config"]))
                return key, cfg
            if pkg.startswith("@") or "/" in pkg:
                return safe_name(pkg.split("/")[-1]), {"command": "npx", "args": ["-y", pkg, *shlex.split(rest)]}
            return safe_name(pkg), {"command": "uvx", "args": [pkg, *shlex.split(rest)]}
        m = re.match(r"^(uvx|npx)\s+(?:-y\s+)?(\S+)(.*)$", t)
        if m:
            runner, pkg, rest = m.groups()
            args = (["-y"] if runner == "npx" else []) + [pkg, *shlex.split(rest)]
            return safe_name(pkg.split("/")[-1]), {"command": runner, "args": args}
        return None

    def search_registry(self, query: str = "") -> list[dict[str, Any]]:
        q = query.lower()
        return [
            {"name": k, "description": v["description"], "params": v.get("params", []), "installed": k in self.read_config()["mcpServers"]}
            for k, v in REGISTRY.items()
            if not q or q in k or q in v["description"].lower()
        ]


mcp = MCPManager()


def fill_params(cfg: dict[str, Any], params: dict[str, str]) -> dict[str, Any]:
    raw = json.dumps(cfg)
    for k, v in params.items():
        raw = raw.replace("{" + k + "}", json.dumps(v)[1:-1])
    return json.loads(raw)
