"""FastAPI application: REST API for every panel + WebSockets for chat and diagnostics."""

from __future__ import annotations

import asyncio
import io
import json
import logging
import platform
import sys
import time
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, PlainTextResponse

from . import __version__, artifacts, calendar_store, knowledge, library, llm, memory, presentations, scheduler
from .config import settings
from .db import new_id
from .events import BusLogHandler, bus
from .mcp_manager import CLOUD_TOOLS, fill_params, mcp, REGISTRY as MCP_REGISTRY
from .runtime import TurnRequest, run_agent_once, run_headless, run_turn
from .state import db, vectors
from .tools import REGISTRY as TOOLS

log = logging.getLogger("mentor")
STARTED = time.time()


def _setup_logging() -> None:
    root = logging.getLogger()
    root.setLevel(logging.DEBUG if settings.get("debug") else logging.INFO)
    fh = logging.FileHandler(settings.home / "logs" / "engine.log", encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s: %(message)s"))
    root.addHandler(fh)
    root.addHandler(BusLogHandler())


@asynccontextmanager
async def lifespan(app: FastAPI):
    _setup_logging()
    library.seed()
    knowledge.ensure_workspace()
    sched = asyncio.create_task(scheduler.loop())
    mcp_start = asyncio.create_task(mcp.start_all())
    log.info("Mentor engine %s started (data dir %s)", __version__, settings.home)
    yield
    sched.cancel()
    mcp_start.cancel()
    await mcp.stop_all()


app = FastAPI(title="Mentor Engine", version=__version__, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(app://.*|file://.*|http://(localhost|127\.0\.0\.1)(:\d+)?)$",
    allow_methods=["*"],
    allow_headers=["*"],
)


def _404(what: str = "Not found"):
    raise HTTPException(404, what)


# ===========================================================================
# Health, settings, config
# ===========================================================================
@app.get("/api/health")
async def health():
    return {"ok": True, "version": __version__, "uptime": round(time.time() - STARTED), "provider": settings.get("model.provider"),
            "routing_mode": settings.get("routing.mode"), "data_dir": str(settings.home)}


@app.get("/api/settings")
async def get_settings():
    return settings.sanitized()


@app.patch("/api/settings")
async def patch_settings(patch: dict[str, Any]):
    # Don't overwrite secrets with the masked placeholder.
    for k in ("aws_access_key", "aws_secret_key", "aws_session_token"):
        if patch.get("model", {}).get(k) == "********":
            patch["model"].pop(k)
    patch.pop("routing", None)  # routing is engine-managed
    overrides = patch.get("security", {}).get("tool_overrides")
    settings.update(patch)
    if overrides is not None:  # replace (not merge) so removed overrides stay removed
        settings._data["security"]["tool_overrides"] = overrides
        settings.save()
    logging.getLogger().setLevel(logging.DEBUG if settings.get("debug") else logging.INFO)
    return settings.sanitized()


@app.post("/api/settings/test-connection")
async def test_connection():
    return await llm.test_connection()


@app.get("/api/models")
async def models():
    return {"bedrock": llm.BEDROCK_MODELS, "efforts": ["low", "medium", "high", "xhigh", "max"]}


@app.get("/api/config")
async def config():
    return {"settings": settings.sanitized(), "mcp": mcp.read_config(), "version": __version__, "python": sys.version,
            "platform": platform.platform(), "data_dir": str(settings.home)}


@app.get("/api/updates/check")
async def check_updates():
    return {"current": __version__, "latest": __version__, "update_available": False,
            "message": "Updates are delivered by the desktop shell's auto-updater when a release feed is configured."}


# ===========================================================================
# Sessions & chat
# ===========================================================================
@app.get("/api/sessions")
async def list_sessions(include_headless: bool = False):
    sessions = db.list("sessions", where=lambda s: include_headless or not s.get("headless"))
    return sessions


@app.post("/api/sessions")
async def create_session(body: dict[str, Any] | None = None):
    body = body or {}
    return db.put("sessions", {"title": body.get("title", "New chat"), "project_ids": body.get("project_ids", []),
                               "agent_id": body.get("agent_id")})


@app.get("/api/sessions/{sid}")
async def get_session(sid: str):
    s = db.get("sessions", sid) or _404()
    return {**s, "messages": db.messages(sid)}


@app.patch("/api/sessions/{sid}")
async def patch_session(sid: str, patch: dict[str, Any]):
    return db.patch("sessions", sid, patch) or _404()


@app.delete("/api/sessions/{sid}")
async def delete_session(sid: str):
    db.delete_messages(sid)
    return {"deleted": db.delete("sessions", sid)}


@app.get("/api/sessions/{sid}/export")
async def export_session(sid: str):
    s = db.get("sessions", sid) or _404()
    lines = [f"# {s.get('title', 'Chat')}", ""]
    for m in db.messages(sid):
        texts = [b["text"] for b in m["content"] if b.get("type") == "text"]
        tools = [f"`{b['name']}`" for b in m["content"] if b.get("type") == "tool_use"]
        if texts:
            lines += [f"**{'You' if m['role'] == 'user' else 'Mentor'}:**", "", "\n".join(texts), ""]
        if tools:
            lines += [f"_Used tools: {', '.join(tools)}_", ""]
    return PlainTextResponse("\n".join(lines), media_type="text/markdown")


@app.post("/api/uploads")
async def upload(file: UploadFile = File(...)):
    data = await file.read()
    fid = new_id("up_")
    dest = settings.uploads_dir / fid
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / Path(file.filename or "file").name
    path.write_bytes(data)
    return {"id": fid, "name": path.name, "path": str(path), "mime": file.content_type, "size": len(data)}


@app.get("/api/file")
async def serve_file(path: str):
    p = Path(path).resolve()
    if settings.home.resolve() not in p.parents or not p.is_file():
        _404()
    return FileResponse(p)


class ChatConnection:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.lock = asyncio.Lock()
        self.tasks: dict[str, asyncio.Task] = {}
        self.approvals: dict[str, asyncio.Future] = {}

    async def send(self, payload: dict[str, Any]) -> None:
        async with self.lock:
            await self.ws.send_text(json.dumps(payload, default=str))

    async def handle_chat(self, msg: dict[str, Any]) -> None:
        rid = msg.get("request_id") or new_id("req_")
        sid = msg["session_id"]

        async def emit(evt: dict[str, Any]) -> None:
            await self.send({**evt, "request_id": rid, "session_id": sid})

        async def approve(tool: str, args: dict, reason: str) -> bool:
            aid = new_id("apr_")
            fut: asyncio.Future = asyncio.get_running_loop().create_future()
            self.approvals[aid] = fut
            await emit({"type": "approval_request", "approval_id": aid, "tool": tool, "input": args, "reason": reason})
            try:
                return bool(await asyncio.wait_for(fut, timeout=600))
            except asyncio.TimeoutError:
                return False
            finally:
                self.approvals.pop(aid, None)

        req = TurnRequest(session_id=sid, text=msg.get("text", ""), attachments=msg.get("attachments", []),
                          mentions=msg.get("mentions", []), skill_id=msg.get("skill_id"), prompt_id=msg.get("prompt_id"),
                          agent_id=msg.get("agent_id"))

        async def go():
            await emit({"type": "start"})
            try:
                result = await run_turn(req, emit, approve)
                await emit({"type": "done", "status": result["status"], "usage": result["usage"], "duration": result["duration"],
                            "artifacts": [{k: a[k] for k in ("id", "name", "type", "mime", "path")} for a in result["artifacts"]]})
            except asyncio.CancelledError:
                await emit({"type": "done", "status": "cancelled"})
            finally:
                self.tasks.pop(rid, None)

        self.tasks[rid] = asyncio.create_task(go())


@app.websocket("/ws/chat")
async def ws_chat(ws: WebSocket):
    await ws.accept()
    conn = ChatConnection(ws)
    try:
        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "chat":
                await conn.handle_chat(msg)
            elif kind == "approval":
                fut = conn.approvals.get(msg.get("approval_id"))
                if fut and not fut.done():
                    fut.set_result(bool(msg.get("approved")))
            elif kind == "cancel":
                t = conn.tasks.get(msg.get("request_id"))
                if t:
                    t.cancel()
            elif kind == "ping":
                await conn.send({"type": "pong"})
    except WebSocketDisconnect:
        pass
    finally:
        for t in conn.tasks.values():
            t.cancel()


@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    await ws.accept()
    q = bus.subscribe()
    try:
        while True:
            payload = await q.get()
            await ws.send_text(json.dumps(payload, default=str))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        bus.unsubscribe(q)


@app.post("/api/quick-ask")
async def quick_ask(body: dict[str, Any]):
    """Spotlight: one-shot question answered in a headless session."""
    res = await run_headless(body["text"], title=f"✨ {body['text'][:50]}")
    db.patch("sessions", res["session_id"], {"headless": False})
    return res


# ===========================================================================
# Projects
# ===========================================================================
@app.get("/api/projects")
async def projects():
    return knowledge.project_list()


@app.get("/api/projects/templates")
async def project_templates():
    return [{"id": k, **v} for k, v in knowledge.PROJECT_TEMPLATES.items()]


@app.post("/api/projects")
async def create_project(body: dict[str, Any]):
    return knowledge.project_create(body)


@app.get("/api/projects/{pid}")
async def get_project(pid: str):
    p = db.get("projects", pid) or _404()
    files = db.list("project_files", where=lambda f: f["project_id"] == pid)
    sessions = db.list("sessions", where=lambda s: pid in s.get("project_ids", []))
    agent = db.get("agents", p["agent_id"]) if p.get("agent_id") else None
    return {**p, "files": files, "sessions": sessions, "agent": agent, "chunks": vectors.count(f"project:{pid}")}


@app.patch("/api/projects/{pid}")
async def patch_project(pid: str, patch: dict[str, Any]):
    return db.patch("projects", pid, patch) or _404()


@app.delete("/api/projects/{pid}")
async def delete_project(pid: str):
    return {"deleted": knowledge.project_delete(pid)}


@app.post("/api/projects/{pid}/files")
async def add_project_file(pid: str, file: UploadFile = File(...)):
    db.get("projects", pid) or _404()
    return await knowledge.project_add_file(pid, file.filename or "file", await file.read())


@app.delete("/api/projects/files/{fid}")
async def delete_project_file(fid: str):
    return {"deleted": knowledge.project_remove_file(fid)}


@app.get("/api/projects/files/{fid}/raw")
async def project_file_raw(fid: str):
    f = db.get("project_files", fid) or _404()
    return PlainTextResponse(Path(f["path"]).read_text("utf-8", errors="ignore")[:500000])


@app.put("/api/projects/files/{fid}/raw")
async def project_file_save(fid: str, body: dict[str, Any]):
    f = db.get("project_files", fid) or _404()
    return await knowledge.project_add_file(f["project_id"], f["name"], body["content"].encode("utf-8"))


@app.post("/api/projects/{pid}/sources")
async def add_source(pid: str, body: dict[str, Any]):
    return await knowledge.project_add_source(pid, body["url"], body.get("refresh", "daily"))


@app.post("/api/projects/{pid}/sources/{src}/refresh")
async def refresh_source(pid: str, src: str):
    await knowledge.refresh_source(pid, src)
    return db.get("projects", pid)


@app.delete("/api/projects/{pid}/sources/{src}")
async def delete_source(pid: str, src: str):
    p = db.get("projects", pid) or _404()
    p["sources"] = [s for s in p.get("sources", []) if s["id"] != src]
    vectors.remove_source(f"project:{pid}", f"src:{src}")
    return db.put("projects", p)


@app.post("/api/projects/{pid}/report")
async def project_report(pid: str):
    return await knowledge.project_status_report(pid)


@app.post("/api/projects/{pid}/share")
async def share_project(pid: str, body: dict[str, Any]):
    """Share with teammates by alias: records members and writes a portable .mentorproject bundle."""
    p = db.get("projects", pid) or _404()
    p["members"] = sorted(set(p.get("members", []) + [a.strip() for a in body.get("aliases", []) if a.strip()]))
    db.put("projects", p)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.json", json.dumps({k: v for k, v in p.items() if k not in ("reports",)}, indent=2))
        for f in db.list("project_files", where=lambda f: f["project_id"] == pid):
            if f.get("path") and Path(f["path"]).exists():
                z.write(f["path"], f"files/{f['name']}")
    art = artifacts.save(f"{p['name']}.mentorproject.zip", buf.getvalue(), tool="share_project", kind="shared")
    return {"project": p, "bundle": art}


@app.post("/api/projects/import")
async def import_project(file: UploadFile = File(...)):
    z = zipfile.ZipFile(io.BytesIO(await file.read()))
    meta = json.loads(z.read("project.json"))
    p = knowledge.project_create({k: meta.get(k) for k in ("name", "description", "template", "instructions", "members")})
    for name in z.namelist():
        if name.startswith("files/") and not name.endswith("/"):
            await knowledge.project_add_file(p["id"], Path(name).name, z.read(name))
    return p


# ===========================================================================
# Knowledge base
# ===========================================================================
@app.get("/api/kb")
async def kb_list():
    return db.list("kb_docs")


@app.post("/api/kb")
async def kb_upload(file: UploadFile = File(...)):
    return await knowledge.kb_add(file.filename or "document", await file.read())


@app.delete("/api/kb/{doc_id}")
async def kb_delete(doc_id: str):
    return {"deleted": knowledge.kb_delete(doc_id)}


@app.get("/api/kb/search")
async def kb_search(q: str, k: int = 8):
    return await vectors.search(["kb"], q, k=k)


# ===========================================================================
# Memory
# ===========================================================================
@app.get("/api/memory")
async def memory_list(q: str | None = None):
    return await memory.search(q, 30) if q else memory.list_all()


@app.post("/api/memory")
async def memory_add(body: dict[str, Any]):
    return await memory.save(body["text"], body.get("kind", "fact"), body.get("topics"), source="manual")


@app.delete("/api/memory/{mid}")
async def memory_delete(mid: str):
    return {"deleted": memory.delete(mid)}


@app.delete("/api/memory")
async def memory_wipe():
    return {"deleted": memory.wipe()}


@app.get("/api/people")
async def people():
    return db.list("people")


@app.patch("/api/people/{pid}")
async def patch_person(pid: str, patch: dict[str, Any]):
    return db.patch("people", pid, patch) or _404()


@app.delete("/api/people/{pid}")
async def delete_person(pid: str):
    return {"deleted": db.delete("people", pid)}


@app.get("/api/memory-graph")
async def memory_graph():
    return memory.graph()


# ===========================================================================
# Indexed folders
# ===========================================================================
@app.get("/api/folders")
async def folders():
    return [{**{k: v for k, v in f.items() if k != "files"}, "file_count": len(f.get("files", {})),
             "chunks": sum(x.get("chunks", 0) for x in f.get("files", {}).values())} for f in db.list("folders")]


@app.post("/api/folders")
async def add_folder(body: dict[str, Any]):
    try:
        return knowledge.folder_add(body["path"], body.get("access", "read"), body.get("surface", "none"), body.get("auto_reindex", False))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/folders/{fid}")
async def patch_folder(fid: str, patch: dict[str, Any]):
    return knowledge.folder_update(fid, patch)


@app.delete("/api/folders/{fid}")
async def delete_folder(fid: str):
    return {"deleted": knowledge.folder_remove(fid)}


@app.get("/api/folders/{fid}/files")
async def folder_files(fid: str):
    return knowledge.folder_scan(fid)


@app.post("/api/folders/{fid}/reindex")
async def reindex_folder(fid: str):
    knowledge.start_index(fid)
    return db.get("folders", fid)


# ===========================================================================
# Agents
# ===========================================================================
@app.get("/api/agents")
async def agents():
    return db.list("agents")


@app.post("/api/agents")
async def create_agent(body: dict[str, Any]):
    return library.agent_save(body)


@app.get("/api/agents/{aid}")
async def get_agent(aid: str):
    return db.get("agents", aid) or _404()


@app.put("/api/agents/{aid}")
async def update_agent(aid: str, body: dict[str, Any]):
    db.get("agents", aid) or _404()
    return library.agent_save(body, aid)


@app.delete("/api/agents/{aid}")
async def delete_agent(aid: str):
    return {"deleted": db.delete("agents", aid)}


@app.post("/api/agents/{aid}/duplicate")
async def duplicate_agent(aid: str):
    return library.agent_duplicate(aid)


@app.get("/api/agents/{aid}/export")
async def export_agent(aid: str):
    return library.agent_export(aid)


@app.post("/api/agents/import")
async def import_agent(body: dict[str, Any]):
    return library.agent_import(body)


@app.post("/api/agents/draft-prompt")
async def draft_prompt(body: dict[str, Any]):
    return {"system_prompt": await library.agent_draft_prompt(body.get("name", "Agent"), body.get("description", ""), body.get("personality", "Professional"))}


@app.post("/api/agents/{aid}/run")
async def run_agent(aid: str, body: dict[str, Any]):
    return await run_agent_once(aid, body.get("input") or "Run your job.", trigger="manual")


@app.get("/api/agent-runs")
async def agent_runs(agent_id: str | None = None, task_id: str | None = None, limit: int = 50):
    return db.list("agent_runs", where=lambda r: (not agent_id or r.get("agent_id") == agent_id) and (not task_id or r.get("task_id") == task_id),
                   order="created DESC", limit=limit)


# ===========================================================================
# Scheduled tasks
# ===========================================================================
@app.get("/api/tasks")
async def tasks():
    return db.list("tasks")


@app.post("/api/tasks")
async def create_task(body: dict[str, Any]):
    try:
        return scheduler.create_task(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/tasks/{tid}")
async def patch_task(tid: str, patch: dict[str, Any]):
    try:
        return scheduler.update_task(tid, patch) or _404()
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.delete("/api/tasks/{tid}")
async def delete_task(tid: str):
    return {"deleted": db.delete("tasks", tid)}


@app.post("/api/tasks/{tid}/run")
async def run_task_now(tid: str):
    return await scheduler.run_task(tid, trigger="manual")


@app.get("/api/schedule/parse")
async def parse_schedule(text: str):
    try:
        cron = scheduler.parse_schedule(text)
        from datetime import datetime

        nxt = scheduler.next_run(cron)
        return {"cron": cron, "next_run": nxt,
                "next_run_label": datetime.fromtimestamp(nxt, scheduler.tz()).strftime("%a %d %b %Y %H:%M %Z")}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ===========================================================================
# Capabilities: skills, SOPs, marketplace, AIM
# ===========================================================================
@app.get("/api/skills")
async def skills():
    return db.list("skills")


@app.post("/api/skills")
async def create_skill(body: dict[str, Any]):
    return library.skill_save(body)


@app.put("/api/skills/{sid}")
async def update_skill(sid: str, body: dict[str, Any]):
    return library.skill_save(body, sid)


@app.delete("/api/skills/{sid}")
async def delete_skill(sid: str):
    return {"deleted": db.delete("skills", sid)}


@app.post("/api/skills/build")
async def build_skill(body: dict[str, Any]):
    if body.get("session_id"):
        return await library.skill_from_conversation(body["session_id"], body.get("kind", "skill"))
    return await library.skill_from_description(body["description"], body.get("kind", "skill"))


@app.get("/api/marketplace")
async def marketplace():
    return library.marketplace()


@app.post("/api/marketplace/{pkg}/install")
async def install_pkg(pkg: str):
    return await library.install(pkg)


@app.get("/api/packages")
async def packages():
    return db.list("packages")


@app.post("/api/packages/{pkg}/import")
async def import_pkg(pkg: str):
    return await library.import_package(pkg)


@app.post("/api/packages/{pkg}/remove")
async def remove_pkg(pkg: str):
    return await library.remove_package(pkg)


@app.delete("/api/packages/{pkg}")
async def uninstall_pkg(pkg: str):
    try:
        return {"deleted": library.uninstall(pkg)}
    except ValueError as e:
        raise HTTPException(400, str(e))


# ===========================================================================
# Prompts
# ===========================================================================
@app.get("/api/prompts")
async def prompts():
    return db.list("prompts", order="created ASC")


@app.post("/api/prompts")
async def create_prompt(body: dict[str, Any]):
    return db.put("prompts", {"name": body.get("name", "Untitled"), "content": body.get("content", ""), "category": body.get("category", ""),
                              "folder": body.get("folder", "My prompts"), "tags": body.get("tags", []), "favorite": False, "builtin": False})


@app.patch("/api/prompts/{pid}")
async def patch_prompt(pid: str, patch: dict[str, Any]):
    p = db.get("prompts", pid) or _404()
    if p.get("builtin") and set(patch) - {"favorite"}:
        raise HTTPException(403, "Built-in prompts are locked. Create your own copy to customise.")
    return db.patch("prompts", pid, patch)


@app.delete("/api/prompts/{pid}")
async def delete_prompt(pid: str):
    p = db.get("prompts", pid) or _404()
    if p.get("builtin"):
        raise HTTPException(403, "Built-in prompts can't be deleted.")
    return {"deleted": db.delete("prompts", pid)}


@app.get("/api/prompts/cloud")
async def cloud_prompts():
    try:
        return await library.cloud_prompts()
    except Exception as e:
        raise HTTPException(502, f"Could not load cloud prompts: {e}")


@app.post("/api/prompts/cloud/pull")
async def pull_cloud(body: dict[str, Any]):
    return library.pull_cloud_prompt(body)


# ===========================================================================
# Calendar
# ===========================================================================
@app.get("/api/calendar")
async def calendar(start: str | None = None, end: str | None = None):
    return calendar_store.list_range(start, end)


@app.post("/api/calendar")
async def create_event(body: dict[str, Any]):
    try:
        return calendar_store.create(body)
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.patch("/api/calendar/{eid}")
async def patch_event(eid: str, patch: dict[str, Any]):
    return calendar_store.update(eid, patch) or _404()


@app.delete("/api/calendar/{eid}")
async def delete_event(eid: str):
    return {"deleted": calendar_store.delete(eid)}


@app.get("/api/calendar-suggestions")
async def suggestions():
    return db.list("calendar_suggestions", where=lambda s: s["status"] == "pending")


@app.post("/api/calendar-suggestions/{sid}")
async def resolve_suggestion(sid: str, body: dict[str, Any]):
    return calendar_store.resolve_suggestion(sid, bool(body.get("approve"))) or _404()


# ===========================================================================
# Artifacts & presentations
# ===========================================================================
@app.get("/api/artifacts")
async def list_artifacts(type: str | None = None):
    return artifacts.list_all(type)


@app.get("/api/artifacts/stats")
async def artifact_stats():
    return artifacts.stats()


@app.get("/api/artifacts/{aid}")
async def get_artifact(aid: str):
    return db.get("artifacts", aid) or _404()


@app.get("/api/artifacts/{aid}/file")
async def artifact_file(aid: str, download: bool = False):
    a = db.get("artifacts", aid) or _404()
    return FileResponse(a["path"], filename=a["name"] if download else None, media_type=a.get("mime"))


@app.delete("/api/artifacts/{aid}")
async def delete_artifact(aid: str):
    return {"deleted": artifacts.delete(aid)}


@app.get("/api/decks")
async def decks():
    return db.list("decks")


@app.post("/api/decks")
async def create_deck(body: dict[str, Any]):
    return presentations.create(body.get("title", "Untitled deck"), body.get("slides") or [{"layout": "title", "title": body.get("title", "Untitled deck")}],
                                body.get("theme", "kpmg"))


@app.get("/api/decks/{did}")
async def get_deck(did: str):
    return db.get("decks", did) or _404()


@app.put("/api/decks/{did}")
async def update_deck(did: str, body: dict[str, Any]):
    return presentations.update(did, body) or _404()


@app.delete("/api/decks/{did}")
async def delete_deck(did: str):
    return {"deleted": db.delete("decks", did)}


@app.post("/api/decks/{did}/export")
async def export_deck(did: str):
    return presentations.export(did)


@app.post("/api/decks/import")
async def import_deck(file: UploadFile = File(...)):
    return presentations.import_pptx(file.filename or "deck.pptx", await file.read())


# ===========================================================================
# Integrations (MCP) & tools
# ===========================================================================
@app.get("/api/mcp/servers")
async def mcp_servers():
    return mcp.status()


@app.post("/api/mcp/servers")
async def mcp_add(body: dict[str, Any]):
    cfg = body["config"]
    if body.get("registry"):
        entry = MCP_REGISTRY.get(body["registry"]) or _404("Unknown registry entry")
        cfg = fill_params(entry["config"], body.get("params", {}))
    return await mcp.add_server(body["name"], cfg)


@app.delete("/api/mcp/servers/{name}")
async def mcp_delete(name: str):
    return {"deleted": await mcp.remove_server(name)}


@app.post("/api/mcp/servers/{name}/restart")
async def mcp_restart(name: str):
    try:
        return (await mcp.restart(name)).info()
    except KeyError:
        _404()


@app.post("/api/mcp/servers/{name}/enabled")
async def mcp_enable(name: str, body: dict[str, Any]):
    await mcp.set_enabled(name, bool(body.get("enabled")))
    return mcp.status()


@app.post("/api/mcp/import")
async def mcp_import(body: dict[str, Any]):
    try:
        return {"added": await mcp.import_json(body["json"])}
    except json.JSONDecodeError as e:
        raise HTTPException(400, f"Invalid JSON: {e}")


@app.post("/api/mcp/install")
async def mcp_install(body: dict[str, Any]):
    parsed = mcp.parse_install_command(body["command"])
    if not parsed:
        raise HTTPException(400, "Unrecognised install command")
    name, cfg = parsed
    return await mcp.add_server(name, fill_params(cfg, body.get("params", {})))


@app.get("/api/mcp/registry")
async def mcp_registry(q: str = ""):
    return mcp.search_registry(q)


@app.get("/api/mcp/config")
async def mcp_config():
    return mcp.read_config()


@app.put("/api/mcp/config")
async def mcp_config_put(body: dict[str, Any]):
    mcp.write_config(body)
    await mcp.stop_all()
    await mcp.start_all()
    return mcp.status()


@app.get("/api/cloud-tools")
async def cloud_tools():
    return CLOUD_TOOLS


@app.get("/api/tools")
async def tools():
    builtin = [{"name": t.name, "description": t.description, "risk": t.risk, "category": t.category, "source": "built-in"}
               for t in TOOLS.values()]
    mcp_tools = [{"name": m["name"], "description": m["description"], "risk": m["risk"], "category": m["server"], "source": "mcp"}
                 for m in mcp.tool_specs()]
    return {"builtin": builtin, "mcp": mcp_tools, "total": len(builtin) + len(mcp_tools)}


# ===========================================================================
# Security
# ===========================================================================
@app.get("/api/security/audit")
async def security_audit(limit: int = 200):
    return db.list("approvals_log", order="created DESC", limit=limit)


# ===========================================================================
# Diagnostics, dashboard, issues
# ===========================================================================
@app.get("/api/diagnostics/events")
async def diag_events():
    return list(bus.events)


@app.get("/api/diagnostics/backend")
async def diag_backend():
    return list(bus.backend)


@app.get("/api/diagnostics/traces")
async def diag_traces(session_id: str | None = None):
    traces = [t for t in bus.traces if not session_id or t["session_id"] == session_id]
    return list(reversed(traces))


def _bundle_bytes(extra: dict[str, Any] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("config.json", json.dumps(settings.sanitized(), indent=2))
        z.writestr("mcp_status.json", json.dumps(mcp.status(), indent=2, default=str))
        z.writestr("events.json", json.dumps(list(bus.events), indent=2, default=str))
        z.writestr("backend.json", json.dumps(list(bus.backend), indent=2, default=str))
        # traces without message content
        z.writestr("traces.json", json.dumps([{**t, "message": "(redacted)", "steps": [{k: v for k, v in s.items() if k not in ("text", "result", "input")}
                                                                                        for s in t["steps"]]} for t in bus.traces], indent=2, default=str))
        z.writestr("system.json", json.dumps({"version": __version__, "python": sys.version, "platform": platform.platform(),
                                              "uptime": time.time() - STARTED, **(extra or {})}, indent=2))
        for log_file in (settings.home / "logs").glob("*.log"):
            z.writestr(f"logs/{log_file.name}", log_file.read_bytes()[-2_000_000:])
    return buf.getvalue()


@app.post("/api/diagnostics/bundle")
async def support_bundle():
    path = settings.home / "bundles" / f"mentor-support-{time.strftime('%Y%m%d-%H%M%S')}.zip"
    path.write_bytes(_bundle_bytes())
    return {"path": str(path), "size": path.stat().st_size}


@app.get("/api/issues")
async def list_issues():
    return db.list("issues", order="created DESC")


@app.post("/api/issues")
async def report_issue(body: dict[str, Any]):
    ts = time.strftime("%Y%m%d-%H%M%S")
    path = settings.home / "bundles" / f"mentor-issue-{ts}.zip"
    path.write_bytes(_bundle_bytes({"issue": {k: body.get(k) for k in ("title", "description", "severity", "area")}}))
    issue = db.put("issues", {**{k: body.get(k) for k in ("title", "description", "severity", "area")}, "bundle": str(path), "status": "filed"})
    return issue


@app.get("/api/dashboard")
async def dashboard():
    servers = mcp.status()
    online = sum(1 for s in servers if s["status"] == "online")
    errored = [s["name"] for s in servers if s["status"] == "error"]
    recent_errors = [e for e in list(bus.events)[-200:] if e.get("level") == "error"][-5:]
    return {
        "health": {
            "backend": {"status": "green", "detail": f"up {round((time.time() - STARTED) / 60)} min"},
            "model": {"status": "yellow" if settings.get("model.provider") == "demo" else "green",
                      "detail": "Demo mode" if settings.get("model.provider") == "demo" else settings.get("model.model_id")},
            "mcp": {"status": "gray" if not servers else ("red" if errored else "green"),
                    "detail": f"{online}/{len(servers)} online" + (f" · errors: {', '.join(errored)}" if errored else "")},
            "memory": {"status": "green", "detail": f"{db.count('memories')} memories · {vectors.count()} vectors"},
            "tools": {"status": "green", "detail": f"{len(TOOLS)} built-in + {len(mcp.tool_specs())} MCP"},
            "scheduler": {"status": "green" if db.count("tasks") else "gray", "detail": f"{db.count('tasks')} tasks"},
        },
        "counts": {k: db.count(k) for k in ("sessions", "projects", "agents", "skills", "prompts", "kb_docs", "artifacts", "decks", "people")},
        "upcoming": calendar_store.upcoming(7)[:10],
        "suggestions": db.list("calendar_suggestions", where=lambda s: s["status"] == "pending")[:5],
        "recent_runs": db.list("agent_runs", order="created DESC", limit=8),
        "recent_artifacts": artifacts.list_all()[:6],
        "recent_errors": recent_errors,
        "role": settings.get("user.role"),
    }


@app.post("/api/dashboard/briefing")
async def briefing(body: dict[str, Any] | None = None):
    role = (body or {}).get("role") or settings.get("user.role")
    events = calendar_store.upcoming(2)
    runs = db.list("agent_runs", order="created DESC", limit=5)
    projects = db.list("projects", where=lambda p: p.get("status") == "active", limit=8)
    prompt = (
        f"Write a short morning briefing for a {role} in KPMG Advisory. Sections: Today (from calendar), Overnight results (from scheduled runs), "
        "Projects to watch, Suggested first action. Max 180 words, bullets.\n\n"
        f"Calendar: {json.dumps([{k: e[k] for k in ('title', 'start', 'kind')} for e in events])}\n"
        f"Runs: {json.dumps([{'status': r.get('status'), 'output': (r.get('output') or '')[:300]} for r in runs])}\n"
        f"Projects: {json.dumps([{'name': p['name'], 'status': p.get('status')} for p in projects])}"
    )
    try:
        text = await llm.quick_text(prompt, system="You write crisp executive briefings.", max_tokens=800)
    except llm.LLMError as e:
        text = f"Briefing unavailable: {e}"
    return {"markdown": text, "ts": time.time()}
