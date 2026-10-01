"""Semantic Memory: facts, preferences and people captured from conversations.

Pipeline (runs in the background after every chat turn):
  1. extract  - ask a fast model for durable facts, people and dated events
                (regex heuristics when Bedrock isn't configured)
  2. dedupe   - skip facts that are near-duplicates of an existing memory
  3. store    - memory doc + embedding in the `memory` namespace
  4. people   - upsert person cards; link memories <-> people <-> topics
  5. calendar - dated items become calendar *suggestions* awaiting approval

Recall: before each turn, the user's message is embedded and the top memories
(plus chunks from memory-surface indexed folders) are injected into the system
prompt inside <memory> tags.
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any

from . import llm
from .config import settings
from .events import bus
from .state import db, vectors

log = logging.getLogger("mentor.memory")

NS = "memory"

EXTRACT_PROMPT = """You maintain long-term memory for an AI assistant used by a consultant at KPMG.
From the exchange below, extract ONLY durable, useful information worth remembering in future chats:
user preferences, working style, role/team, clients and engagements, technical decisions, recurring topics,
deadlines. Skip small talk and anything only relevant to this one answer.

Return JSON:
{{"memories": [{{"text": "<one self-contained sentence>", "kind": "preference|fact|project|decision", "topics": ["..."], "people": ["Full Name"]}}],
 "people": [{{"name": "Full Name", "title": "", "department": "", "location": "", "email": "", "notes": "<what we learned>"}}],
 "events": [{{"title": "", "start": "<ISO 8601 local datetime or date>", "end": "", "kind": "event|task|reminder|deadline"}}]}}
Use empty lists when there is nothing. Today is {today}.

<user>{user}</user>
<assistant>{assistant}</assistant>"""

HEURISTICS = [
    (r"\b(?:remember(?: that)?|note that)\s+(.+)", "fact"),
    (r"\b(I (?:always|usually|never|prefer|like|don't like|hate)\b.+)", "preference"),
    (r"\b(my (?:name|role|title|team|client|manager|project|company|department) (?:is|are) .+)", "fact"),
    (r"\b(I(?:'m| am) (?:a|an|the|working|leading|responsible) .+)", "fact"),
]


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
async def save(
    text: str,
    kind: str = "fact",
    topics: list[str] | None = None,
    people: list[str] | None = None,
    session_id: str | None = None,
    source: str = "conversation",
) -> dict[str, Any] | None:
    text = text.strip()
    if len(text) < 4:
        return None
    dupes = await vectors.search([NS], text, k=1, min_score=0.92)
    if dupes:
        existing = db.get("memories", dupes[0]["source_id"])
        if existing:
            existing["hits"] = existing.get("hits", 1) + 1
            return db.put("memories", existing)
    doc = db.put(
        "memories",
        {
            "text": text,
            "kind": kind,
            "topics": [t.lower() for t in (topics or [])][:6],
            "people": people or [],
            "session_id": session_id,
            "source": source,
            "hits": 1,
        },
    )
    await vectors.add(NS, doc["id"], [text], {"kind": kind})
    bus.emit("memory_saved", memory_id=doc["id"], text=text[:200])
    return doc


async def search(query: str, k: int = 8) -> list[dict[str, Any]]:
    hits = await vectors.search([NS], query, k=k)
    out = []
    for h in hits:
        doc = db.get("memories", h["source_id"])
        if doc:
            out.append({**doc, "score": round(h["score"], 3)})
    return out


def delete(memory_id: str) -> bool:
    vectors.remove_source(NS, memory_id)
    return db.delete("memories", memory_id)


def wipe() -> int:
    n = db.count("memories")
    vectors.remove_namespace(NS)
    for d in db.list("memories"):
        db.delete("memories", d["id"])
    return n


def list_all(limit: int = 500) -> list[dict[str, Any]]:
    return db.list("memories", order="created DESC", limit=limit)


# ---------------------------------------------------------------------------
# People
# ---------------------------------------------------------------------------
def upsert_person(p: dict[str, Any]) -> dict[str, Any] | None:
    name = (p.get("name") or "").strip()
    if not name or len(name.split()) > 5:
        return None
    pid = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    existing = db.get("people", pid) or {"name": name, "mentions": 0, "notes": []}
    for key in ("title", "department", "location", "email", "profile_url"):
        if p.get(key):
            existing[key] = p[key]
    note = (p.get("notes") or "").strip()
    if note and note not in existing["notes"]:
        existing["notes"] = (existing["notes"] + [note])[-20:]
    existing["mentions"] = existing.get("mentions", 0) + 1
    existing["last_seen"] = time.time()
    return db.put("people", existing, pid)


# ---------------------------------------------------------------------------
# Extraction pipeline
# ---------------------------------------------------------------------------
def _heuristic_extract(user_text: str) -> dict[str, Any]:
    mems = []
    for pattern, kind in HEURISTICS:
        for m in re.finditer(pattern, user_text, flags=re.I):
            sentence = re.split(r"(?<=[.!?])\s", m.group(1))[0].strip()
            if len(sentence) > 8:
                mems.append({"text": sentence[0].upper() + sentence[1:], "kind": kind, "topics": [], "people": []})
    people = [
        {"name": m.group(1), "notes": "Mentioned in conversation"}
        for m in re.finditer(r"\b(?:with|from|to|cc|met|call(?:ed)?)\s+([A-Z][a-z]+ [A-Z][a-z]+)\b", user_text)
    ]
    return {"memories": mems[:5], "people": people[:5], "events": []}


async def capture_turn(session_id: str, user_text: str, assistant_text: str) -> dict[str, Any]:
    """Background task run after a chat turn completes."""
    if not settings.get("privacy.memory_capture", True) or not user_text.strip():
        return {}
    extracted: dict[str, Any] | None = None
    if llm.provider().name == "bedrock":
        try:
            from datetime import datetime

            raw = await llm.quick_text(
                EXTRACT_PROMPT.format(
                    today=datetime.now().strftime("%A %d %B %Y"),
                    user=user_text[:6000],
                    assistant=assistant_text[:4000],
                ),
                max_tokens=1500,
            )
            parsed = llm.extract_json(raw)
            if isinstance(parsed, dict):
                extracted = parsed
        except Exception as e:  # never fail the chat because of memory
            log.warning("memory extraction failed: %s", e)
    if extracted is None:
        extracted = _heuristic_extract(user_text)

    saved = []
    for m in extracted.get("memories", [])[:8]:
        doc = await save(m.get("text", ""), m.get("kind", "fact"), m.get("topics"), m.get("people"), session_id)
        if doc:
            saved.append(doc["id"])
    for p in extracted.get("people", [])[:8]:
        upsert_person(p)
    if settings.get("privacy.calendar_detection", True):
        from . import calendar_store as cal

        for e in extracted.get("events", [])[:5]:
            cal.add_suggestion(e, session_id)
    return {"memories": saved, "people": len(extracted.get("people", []))}


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------
def graph(limit: int = 300) -> dict[str, Any]:
    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def node(nid: str, label: str, kind: str, weight: float = 1) -> None:
        if nid not in nodes:
            nodes[nid] = {"id": nid, "label": label, "kind": kind, "weight": weight}
        else:
            nodes[nid]["weight"] += weight * 0.5

    for m in list_all(limit):
        mid = f"m:{m['id']}"
        node(mid, m["text"][:60], "memory")
        for t in m.get("topics", []):
            node(f"t:{t}", t, "topic")
            edges.append({"source": mid, "target": f"t:{t}"})
        for p in m.get("people", []):
            pid = "p:" + re.sub(r"[^a-z0-9]+", "-", p.lower()).strip("-")
            node(pid, p, "person")
            edges.append({"source": mid, "target": pid})
    for p in db.list("people", limit=200):
        node(f"p:{p['id']}", p["name"], "person")
    for pr in db.list("projects", limit=100):
        prid = f"pr:{pr['id']}"
        node(prid, pr["name"], "project", 2)
        for member in pr.get("members", []):
            pid = "p:" + re.sub(r"[^a-z0-9]+", "-", member.lower()).strip("-")
            if pid in nodes:
                edges.append({"source": prid, "target": pid})
    return {"nodes": list(nodes.values()), "edges": edges}
