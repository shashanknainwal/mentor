"""Knowledge Base (Data panel), Projects, and Indexed Folders (Settings > Directories).

Namespaces in the vector store:
    kb               - Data panel documents
    project:<id>     - files and live sources added to a project
    folder:<id>      - indexed folders (surface = project or memory)
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from pathlib import Path
from typing import Any

from . import ingest, llm
from .config import settings
from .events import bus
from .state import db, vectors

log = logging.getLogger("mentor.knowledge")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "project"


# ---------------------------------------------------------------------------
# Knowledge base
# ---------------------------------------------------------------------------
async def kb_add(name: str, data: bytes) -> dict[str, Any]:
    dest_dir = settings.uploads_dir / "kb"
    dest_dir.mkdir(parents=True, exist_ok=True)
    doc = db.put("kb_docs", {"name": name, "size": len(data), "status": "indexing", "chunks": 0})
    path = dest_dir / f"{doc['id']}_{Path(name).name}"
    path.write_bytes(data)
    try:
        text = await asyncio.to_thread(ingest.extract_bytes, name, data)
        chunks = ingest.chunk_text(text)
        n = await vectors.add("kb", doc["id"], chunks, {"name": name})
        doc = db.patch("kb_docs", doc["id"], {"status": "indexed", "chunks": n, "path": str(path), "chars": len(text)})
    except Exception as e:
        log.exception("kb ingest failed")
        doc = db.patch("kb_docs", doc["id"], {"status": "error", "error": str(e), "path": str(path)})
    bus.emit("kb_indexed", doc_id=doc["id"], name=name, status=doc["status"])
    return doc


def kb_delete(doc_id: str) -> bool:
    doc = db.get("kb_docs", doc_id)
    if doc and doc.get("path"):
        Path(doc["path"]).unlink(missing_ok=True)
    vectors.remove_source("kb", doc_id)
    return db.delete("kb_docs", doc_id)


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------
PROJECT_TEMPLATES = {
    "blank": {"name": "Blank", "description": "Start from scratch.", "sections": []},
    "client_engagement": {
        "name": "Client Engagement",
        "description": "Delivery workspace for a live client engagement.",
        "sections": ["Engagement letter & scope", "Stakeholder map", "Workplan", "Status reports", "Deliverables"],
        "instructions": "This is a client engagement. Keep answers aligned to the agreed scope, flag scope creep, and cite source documents.",
    },
    "due_diligence": {
        "name": "Due Diligence",
        "description": "Financial / commercial / operational DD with a data room.",
        "sections": ["Data room index", "Request list", "Findings log", "Red flags", "Report drafts"],
        "instructions": "This is a due diligence project. Be evidence-led: every finding must cite a data-room document. Separate facts from judgements.",
    },
    "proposal": {
        "name": "Proposal / Pursuit",
        "description": "Win a new piece of work: RFP analysis, solution, pricing, team.",
        "sections": ["RFP & requirements", "Win themes", "Solution outline", "Team & credentials", "Commercials"],
        "instructions": "This is a pursuit. Focus on client needs, win themes and differentiation; keep claims about KPMG credentials verifiable.",
    },
    "internal": {
        "name": "Internal Initiative",
        "description": "Practice development, thought leadership, or internal change.",
        "sections": ["Objectives", "Plan", "Decisions", "Updates"],
    },
}


def project_list() -> list[dict[str, Any]]:
    projects = db.list("projects")
    for p in projects:
        p["file_count"] = len(db.list("project_files", where=lambda f, pid=p["id"]: f["project_id"] == pid))
        p["kind"] = "project"
    # indexed folders with the project surface are @-mentionable like projects
    for f in db.list("folders", where=lambda f: f.get("surface") == "project"):
        projects.append(
            {"id": f"folder:{f['id']}", "name": Path(f["path"]).name, "slug": slugify(Path(f["path"]).name),
             "description": f["path"], "kind": "folder", "file_count": len(f.get("files", {}))}
        )
    return projects


def project_create(data: dict[str, Any]) -> dict[str, Any]:
    tpl = PROJECT_TEMPLATES.get(data.get("template") or "blank", PROJECT_TEMPLATES["blank"])
    name = data.get("name") or "Untitled project"
    return db.put(
        "projects",
        {
            "name": name,
            "slug": slugify(name),
            "description": data.get("description") or tpl["description"],
            "template": data.get("template") or "blank",
            "sections": tpl.get("sections", []),
            "instructions": data.get("instructions") or tpl.get("instructions", ""),
            "status": data.get("status", "active"),
            "members": data.get("members", []),
            "agent_id": data.get("agent_id"),
            "sources": [],
            "color": data.get("color", "#00338D"),
            "reports": [],
        },
    )


def project_delete(project_id: str) -> bool:
    for f in db.list("project_files", where=lambda f: f["project_id"] == project_id):
        Path(f.get("path", "")).unlink(missing_ok=True) if f.get("path") else None
        db.delete("project_files", f["id"])
    vectors.remove_namespace(f"project:{project_id}")
    return db.delete("projects", project_id)


async def project_add_file(project_id: str, name: str, data: bytes) -> dict[str, Any]:
    dest = settings.home / "projects" / project_id
    dest.mkdir(parents=True, exist_ok=True)
    path = dest / Path(name).name
    path.write_bytes(data)
    existing = db.list("project_files", where=lambda f: f["project_id"] == project_id and f["name"] == path.name)
    doc = existing[0] if existing else db.put("project_files", {"project_id": project_id, "name": path.name})
    vectors.remove_source(f"project:{project_id}", doc["id"])
    try:
        text = await asyncio.to_thread(ingest.extract_text, path)
        n = await vectors.add(f"project:{project_id}", doc["id"], ingest.chunk_text(text), {"name": path.name})
        return db.patch("project_files", doc["id"], {"path": str(path), "size": len(data), "chunks": n, "status": "indexed"})
    except Exception as e:
        return db.patch("project_files", doc["id"], {"path": str(path), "size": len(data), "status": "error", "error": str(e)})


def project_remove_file(file_id: str) -> bool:
    f = db.get("project_files", file_id)
    if not f:
        return False
    vectors.remove_source(f"project:{f['project_id']}", file_id)
    if f.get("path"):
        Path(f["path"]).unlink(missing_ok=True)
    return db.delete("project_files", file_id)


async def project_add_source(project_id: str, url: str, refresh: str = "daily") -> dict[str, Any]:
    p = db.get("projects", project_id)
    if p is None:
        raise KeyError(project_id)
    src = {"id": hashlib.md5(url.encode()).hexdigest()[:10], "url": url, "refresh": refresh, "last_refreshed": None}
    p["sources"] = [s for s in p.get("sources", []) if s["url"] != url] + [src]
    db.put("projects", p)
    await refresh_source(project_id, src["id"])
    return db.get("projects", project_id)


async def refresh_source(project_id: str, source_id: str) -> None:
    from .tools.web import fetch_url_text

    p = db.get("projects", project_id)
    if not p:
        return
    for s in p.get("sources", []):
        if s["id"] == source_id:
            try:
                text = await fetch_url_text(s["url"])
                vectors.remove_source(f"project:{project_id}", f"src:{source_id}")
                await vectors.add(f"project:{project_id}", f"src:{source_id}", ingest.chunk_text(text), {"name": s["url"]})
                s["last_refreshed"] = time.time()
                s["status"] = "ok"
            except Exception as e:
                s["status"] = f"error: {e}"
    db.put("projects", p)


async def refresh_due_sources() -> None:
    period = {"hourly": 3600, "daily": 86400, "weekly": 7 * 86400}
    for p in db.list("projects"):
        for s in p.get("sources", []):
            every = period.get(s.get("refresh", "manual"))
            if every and time.time() - (s.get("last_refreshed") or 0) > every:
                await refresh_source(p["id"], s["id"])


def _namespaces_for(ref_ids: list[str]) -> list[str]:
    ns = []
    for rid in ref_ids:
        ns.append(rid if rid.startswith("folder:") else f"project:{rid}")
    return ns


async def retrieve(ref_ids: list[str], query: str, k: int = 8) -> list[dict[str, Any]]:
    """Top excerpts for @-mentioned projects/folders, with names for citations."""
    hits = await vectors.search(_namespaces_for(ref_ids), query, k=k)
    for h in hits:
        h["source_name"] = h["meta"].get("name") or h["source_id"]
    return hits


async def project_status_report(project_id: str) -> dict[str, Any]:
    p = db.get("projects", project_id)
    if not p:
        raise KeyError(project_id)
    files = db.list("project_files", where=lambda f: f["project_id"] == project_id)
    sessions = db.list("sessions", where=lambda s: project_id in s.get("project_ids", []), limit=10)
    convo = []
    for s in sessions:
        for m in db.messages(s["id"])[-6:]:
            convo.append(f"{m['role']}: " + " ".join(b.get("text", "") for b in m["content"] if b.get("type") == "text")[:600])
    excerpts = await vectors.search([f"project:{project_id}"], f"{p['name']} status progress risks next steps", k=10)
    prompt = (
        f"Write a concise project status report for '{p['name']}' ({p.get('description', '')}).\n"
        "Sections: Summary (RAG status with one-line rationale), Progress, Risks & Issues, Decisions needed, Next steps.\n"
        f"Files: {', '.join(f['name'] for f in files) or 'none'}\n\nRecent discussion:\n" + "\n".join(convo[-30:])
        + "\n\nDocument excerpts:\n" + "\n---\n".join(e["text"][:800] for e in excerpts)
    )
    text = await llm.quick_text(prompt, system="You are a KPMG engagement manager writing crisp status reports in markdown.", max_tokens=3000)
    report = {"ts": time.time(), "markdown": text}
    p["reports"] = (p.get("reports", []) + [report])[-10:]
    db.put("projects", p)
    return report


# ---------------------------------------------------------------------------
# Indexed folders
# ---------------------------------------------------------------------------
_index_tasks: dict[str, asyncio.Task] = {}


def folder_add(path: str, access: str = "read", surface: str = "none", auto_reindex: bool = False) -> dict[str, Any]:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"Not a folder: {p}")
    if p == Path.home().resolve() or str(p) in ("/", "C:\\"):
        raise ValueError("Grant a specific project folder, not your whole home directory or drive.")
    existing = db.list("folders", where=lambda f: f["path"] == str(p))
    doc = existing[0] if existing else {"path": str(p), "files": {}}
    doc.update({"access": access, "surface": surface, "auto_reindex": auto_reindex, "status": "idle"})
    doc = db.put("folders", doc)
    if surface != "none":
        start_index(doc["id"])
    return doc


def folder_update(folder_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    doc = db.get("folders", folder_id)
    if not doc:
        raise KeyError(folder_id)
    old_surface = doc.get("surface")
    doc.update({k: v for k, v in patch.items() if k in ("access", "surface", "auto_reindex")})
    if doc.get("surface") != old_surface:
        vectors.remove_namespace(f"folder:{folder_id}")
        doc["files"] = {}
    doc = db.put("folders", doc)
    if doc.get("surface") != old_surface and doc.get("surface") != "none":
        start_index(folder_id)
    return doc


def folder_remove(folder_id: str) -> bool:
    t = _index_tasks.pop(folder_id, None)
    if t:
        t.cancel()
    vectors.remove_namespace(f"folder:{folder_id}")
    return db.delete("folders", folder_id)


def folder_scan(folder_id: str) -> list[dict[str, Any]]:
    """Per-file status: indexed / new / changed / skipped / missing."""
    doc = db.get("folders", folder_id)
    if not doc:
        raise KeyError(folder_id)
    root = Path(doc["path"])
    known = doc.get("files", {})
    seen = set()
    out = []
    for path in sorted(root.rglob("*")):
        if not path.is_file():
            continue
        rel = str(path.relative_to(root))
        if any(part in ingest.SKIP_DIRS for part in path.relative_to(root).parts):
            continue
        seen.add(rel)
        reason = ingest.skip_reason(path, root)
        k = known.get(rel)
        if reason:
            status = "skipped"
        elif not k:
            status = "new"
        elif k.get("mtime") != path.stat().st_mtime:
            status = "changed"
        else:
            status = k.get("status", "indexed")
        out.append({"path": rel, "status": status, "reason": reason, "chunks": (k or {}).get("chunks", 0), "size": path.stat().st_size})
        if len(out) > 5000:
            break
    for rel, k in known.items():
        if rel not in seen:
            out.append({"path": rel, "status": "missing", "chunks": k.get("chunks", 0)})
    return out


def start_index(folder_id: str) -> None:
    running = _index_tasks.get(folder_id)
    if running and not running.done():
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    _index_tasks[folder_id] = loop.create_task(index_folder(folder_id))


async def index_folder(folder_id: str) -> dict[str, Any]:
    doc = db.get("folders", folder_id)
    if not doc or doc.get("surface") == "none":
        return doc or {}
    ns = f"folder:{folder_id}"
    root = Path(doc["path"])
    entries = folder_scan(folder_id)
    todo = [e for e in entries if e["status"] in ("new", "changed", "missing")]
    doc["status"] = "indexing"
    doc["progress"] = {"done": 0, "total": len(todo)}
    db.put("folders", doc)
    files = doc.get("files", {})
    for i, e in enumerate(todo, 1):
        rel = e["path"]
        vectors.remove_source(ns, rel)
        if e["status"] == "missing":
            files.pop(rel, None)
        else:
            path = root / rel
            try:
                text = await asyncio.to_thread(ingest.extract_text, path)
                n = await vectors.add(ns, rel, ingest.chunk_text(text), {"name": rel, "folder": str(root)})
                files[rel] = {"mtime": path.stat().st_mtime, "chunks": n, "status": "indexed"}
            except Exception as ex:
                files[rel] = {"mtime": path.stat().st_mtime, "chunks": 0, "status": "error", "error": str(ex)}
        doc["progress"] = {"done": i, "total": len(todo)}
        doc["files"] = files
        if i % 10 == 0 or i == len(todo):
            db.put("folders", doc)
            bus.emit("folder_index_progress", folder_id=folder_id, done=i, total=len(todo))
    doc["status"] = "indexed"
    doc["last_indexed"] = time.time()
    doc["files"] = files
    db.put("folders", doc)
    return doc


async def reindex_due_folders() -> None:
    for f in db.list("folders", where=lambda f: f.get("auto_reindex") and f.get("surface") != "none"):
        if time.time() - (f.get("last_indexed") or 0) > 3600:
            start_index(f["id"])


def memory_folder_namespaces() -> list[str]:
    return [f"folder:{f['id']}" for f in db.list("folders", where=lambda f: f.get("surface") == "memory")]


# ---------------------------------------------------------------------------
# Access control used by file tools
# ---------------------------------------------------------------------------
def resolve_allowed(path: str, write: bool = False) -> Path:
    """Return the resolved path if it lies within an allow-listed folder (or Mentor's own dirs)."""
    p = Path(path).expanduser()
    if not p.is_absolute():
        p = settings.home / "workspace" / p
    p = p.resolve()
    roots: list[tuple[Path, str]] = [(settings.home.resolve() / "workspace", "write"), (settings.artifacts_dir.resolve(), "write"),
                                     (settings.uploads_dir.resolve(), "read")]
    for f in db.list("folders"):
        roots.append((Path(f["path"]).resolve(), f.get("access", "read")))
    for root, access in roots:
        if p == root or root in p.parents:
            if write and access != "write" and access != "readwrite":
                raise PermissionError(f"{root} is read-only. Enable Read + write in Settings › Directories.")
            return p
    raise PermissionError(f"{p} is outside the folders Mentor may access. Add it in Settings › Directories.")


def ensure_workspace() -> Path:
    ws = settings.home / "workspace"
    ws.mkdir(parents=True, exist_ok=True)
    return ws
