"""Calendar & Tasks: events, tasks, reminders, deadlines + AI-detected suggestions."""

from __future__ import annotations

import time
from datetime import datetime, timedelta
from typing import Any

from .events import bus
from .state import db

KINDS = ("event", "task", "reminder", "deadline")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def create(data: dict[str, Any]) -> dict[str, Any]:
    start = _parse(data.get("start"))
    if start is None:
        raise ValueError("start must be an ISO date or datetime, e.g. 2026-10-14T15:00")
    end = _parse(data.get("end")) or (start + timedelta(hours=1) if "T" in data["start"] else start)
    kind = data.get("kind", "event") if data.get("kind") in KINDS else "event"
    doc = db.put(
        "calendar",
        {
            "title": data.get("title") or "Untitled",
            "start": start.isoformat(),
            "end": end.isoformat(),
            "all_day": "T" not in data["start"],
            "kind": kind,
            "notes": data.get("notes", ""),
            "location": data.get("location", ""),
            "done": bool(data.get("done", False)),
            "source": data.get("source", "manual"),
        },
    )
    bus.emit("calendar_created", event_id=doc["id"], title=doc["title"])
    return doc


def update(event_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    return db.patch("calendar", event_id, patch)


def delete(event_id: str) -> bool:
    return db.delete("calendar", event_id)


def list_range(start: str | None = None, end: str | None = None) -> list[dict[str, Any]]:
    s = _parse(start) if start else None
    e = _parse(end) if end else None
    out = []
    for ev in db.list("calendar"):
        es = _parse(ev["start"])
        if es is None:
            continue
        es_naive = es.replace(tzinfo=None)
        if s and es_naive < s.replace(tzinfo=None):
            continue
        if e and es_naive > e.replace(tzinfo=None):
            continue
        out.append(ev)
    out.sort(key=lambda ev: ev["start"])
    return out


def upcoming(days: int = 7) -> list[dict[str, Any]]:
    now = datetime.now()
    return list_range(now.replace(hour=0, minute=0).isoformat(), (now + timedelta(days=days)).isoformat())


# ---- suggestions (approval queue) -----------------------------------------
def add_suggestion(e: dict[str, Any], session_id: str | None) -> dict[str, Any] | None:
    if not e.get("title") or not _parse(e.get("start")):
        return None
    dupe = db.list("calendar_suggestions", where=lambda s: s["title"] == e["title"] and s["start"] == e["start"])
    if dupe:
        return None
    doc = db.put(
        "calendar_suggestions",
        {**{k: e.get(k) for k in ("title", "start", "end", "kind")}, "session_id": session_id, "status": "pending", "ts": time.time()},
    )
    bus.emit("calendar_suggestion", suggestion_id=doc["id"], title=doc["title"])
    return doc


def resolve_suggestion(sid: str, approve: bool) -> dict[str, Any] | None:
    s = db.get("calendar_suggestions", sid)
    if not s:
        return None
    s["status"] = "approved" if approve else "dismissed"
    db.put("calendar_suggestions", s)
    if approve:
        return create({**s, "source": "ai-suggestion"})
    return s
