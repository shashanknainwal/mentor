"""Artifacts: every file the AI generates, stored under ~/MentorDesktop/artifacts/<type>/."""

from __future__ import annotations

import mimetypes
import re
import shutil
import time
from pathlib import Path
from typing import Any

from .config import settings
from .events import bus
from .state import db

TYPE_BY_EXT = {
    ".png": "images", ".jpg": "images", ".jpeg": "images", ".gif": "images", ".webp": "images", ".svg": "images",
    ".docx": "documents", ".pdf": "documents", ".md": "documents", ".txt": "documents", ".html": "documents",
    ".xlsx": "spreadsheets", ".csv": "spreadsheets",
    ".pptx": "presentations",
    ".py": "code", ".js": "code", ".ts": "code", ".sql": "code", ".json": "code", ".sh": "code",
    ".mmd": "diagrams",
}


def _safe_name(name: str) -> str:
    name = re.sub(r"[^\w.\- ]+", "_", name).strip() or "artifact"
    return name[:120]


def save(
    name: str,
    data: bytes | str,
    session_id: str | None = None,
    tool: str | None = None,
    kind: str | None = None,
) -> dict[str, Any]:
    name = _safe_name(name)
    ext = Path(name).suffix.lower()
    kind = kind or TYPE_BY_EXT.get(ext, "other")
    folder = settings.artifacts_dir / kind
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / name
    i = 1
    while path.exists():
        path = folder / f"{Path(name).stem} ({i}){ext}"
        i += 1
    if isinstance(data, str):
        path.write_text(data, "utf-8")
    else:
        path.write_bytes(data)
    doc = db.put(
        "artifacts",
        {
            "name": path.name,
            "type": kind,
            "path": str(path),
            "size": path.stat().st_size,
            "mime": mimetypes.guess_type(path.name)[0] or "application/octet-stream",
            "session_id": session_id,
            "tool": tool,
        },
    )
    bus.emit("artifact_created", artifact_id=doc["id"], name=doc["name"], type=kind)
    return doc


def list_all(kind: str | None = None) -> list[dict[str, Any]]:
    docs = db.list("artifacts", order="created DESC")
    docs = [d for d in docs if Path(d["path"]).exists()]
    return [d for d in docs if not kind or d["type"] == kind]


def delete(artifact_id: str) -> bool:
    doc = db.get("artifacts", artifact_id)
    if not doc:
        return False
    Path(doc["path"]).unlink(missing_ok=True)
    return db.delete("artifacts", artifact_id)


def stats() -> dict[str, Any]:
    by_type: dict[str, dict[str, int]] = {}
    for d in list_all():
        t = by_type.setdefault(d["type"], {"count": 0, "bytes": 0})
        t["count"] += 1
        t["bytes"] += d.get("size", 0)
    return {"by_type": by_type, "total_bytes": sum(t["bytes"] for t in by_type.values()), "path": str(settings.artifacts_dir)}


def mirror_to_onedrive() -> int:
    """One-way copy of new/changed artifacts into the user's OneDrive folder. Never deletes."""
    if not settings.get("artifacts.onedrive_mirror"):
        return 0
    target_root = settings.get("artifacts.onedrive_path")
    if not target_root:
        return 0
    target = Path(target_root).expanduser() / "Mentor Artifacts"
    copied = 0
    for src in settings.artifacts_dir.rglob("*"):
        if not src.is_file():
            continue
        dst = target / src.relative_to(settings.artifacts_dir)
        if not dst.exists() or dst.stat().st_mtime < src.stat().st_mtime:
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied += 1
    if copied:
        bus.emit("onedrive_mirror", copied=copied, ts=time.time())
    return copied
