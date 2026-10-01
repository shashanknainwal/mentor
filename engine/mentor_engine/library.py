"""Library services: prompts, agents, skills/SOPs, and the AIM package manager."""

from __future__ import annotations

import json
import time
from typing import Any

from . import llm
from .catalog import BUILTIN_PROMPTS, CLOUD_PROMPTS_SAMPLE, MARKETPLACE
from .config import settings
from .events import bus
from .mcp_manager import mcp
from .state import db


def seed() -> None:
    for p in BUILTIN_PROMPTS:
        db.put("prompts", {**p, "builtin": True, "folder": "Built-in", "favorite": False}, p["id"])


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------
async def cloud_prompts() -> list[dict[str, Any]]:
    url = settings.get("prompts.cloud_url")
    if url:
        import httpx

        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.get(url)
            r.raise_for_status()
            return r.json()
    return CLOUD_PROMPTS_SAMPLE


def pull_cloud_prompt(p: dict[str, Any]) -> dict[str, Any]:
    return db.put("prompts", {k: p.get(k) for k in ("name", "content", "category", "tags")} | {"folder": "Cloud", "builtin": False,
                                                                                                "favorite": False, "source": "cloud"})


# ---------------------------------------------------------------------------
# Agents
# ---------------------------------------------------------------------------
AGENT_DEFAULTS = {
    "description": "", "mode": "easy", "system_prompt": "", "personality": "Professional", "tools": [], "skills": [],
    "model": "", "effort": "", "max_tokens": None, "memory_enabled": True, "input_schema": None, "output_schema": None,
    "env": {}, "schedule": {"cron": "0 8 * * 1-5", "enabled": False, "input": ""}, "project_ids": [], "icon": "bot",
    "color": "#00338D",
}

PERSONALITY_TEXT = {
    "Professional": "Professional, precise, client-ready tone.",
    "Friendly": "Warm, encouraging and approachable.",
    "Concise": "Extremely concise. Bullets over prose. No preamble.",
    "Detailed": "Thorough and detailed, showing reasoning and evidence.",
}


def agent_save(data: dict[str, Any], agent_id: str | None = None) -> dict[str, Any]:
    from .scheduler import next_run, parse_schedule

    existing = db.get("agents", agent_id) if agent_id else None
    doc = {**AGENT_DEFAULTS, **(existing or {}), **data}
    sch = doc.get("schedule") or {}
    if sch.get("cron"):
        sch["cron"] = parse_schedule(sch["cron"])
        sch["next_run"] = next_run(sch["cron"]) if sch.get("enabled") else None
    if doc.get("personality") in PERSONALITY_TEXT and doc["mode"] == "easy" and not doc.get("system_prompt"):
        doc["system_prompt"] = f"You are {doc['name']}. {doc['description']}\nStyle: {PERSONALITY_TEXT[doc['personality']]}"
    return db.put("agents", doc, agent_id)


async def agent_draft_prompt(name: str, description: str, personality: str) -> str:
    return await llm.quick_text(
        f"Write a system prompt for an AI agent named '{name}' used by KPMG Advisory staff.\nPurpose: {description}\n"
        f"Style: {PERSONALITY_TEXT.get(personality, personality)}\n"
        "Include: role, what good output looks like (format), boundaries, when to ask clarifying questions. Max 250 words. Return only the prompt.",
        max_tokens=1200,
    )


def agent_export(agent_id: str) -> dict[str, Any]:
    a = db.get("agents", agent_id)
    if not a:
        raise KeyError(agent_id)
    skills = [db.get("skills", s) for s in a.get("skills", [])]
    return {"format": "mentor-agent/v1", "agent": {k: v for k, v in a.items() if k not in ("id", "created", "updated")},
            "skills": [s for s in skills if s]}


def agent_import(payload: dict[str, Any]) -> dict[str, Any]:
    agent = payload.get("agent", payload)
    skill_ids = []
    for s in payload.get("skills", []):
        s = {k: v for k, v in s.items() if k not in ("id", "created", "updated")}
        skill_ids.append(db.put("skills", {**s, "source": "imported"})["id"])
    agent = {k: v for k, v in agent.items() if k not in ("id", "created", "updated")}
    agent["skills"] = skill_ids or []
    agent["name"] = agent.get("name", "Imported agent")
    return agent_save(agent)


def agent_duplicate(agent_id: str) -> dict[str, Any]:
    a = db.get("agents", agent_id)
    if not a:
        raise KeyError(agent_id)
    copy = {k: v for k, v in a.items() if k not in ("id", "created", "updated")}
    copy["name"] = f"{a['name']} (copy)"
    copy["schedule"] = {**copy.get("schedule", {}), "enabled": False}
    return agent_save(copy)


# ---------------------------------------------------------------------------
# Skills / SOPs
# ---------------------------------------------------------------------------
def skill_save(data: dict[str, Any], skill_id: str | None = None) -> dict[str, Any]:
    base = {"kind": "skill", "description": "", "instructions": "", "steps": [], "source": "local", "author": settings.get("user.name") or "me",
            "version": "0.1.0", "published": False}
    existing = db.get("skills", skill_id) if skill_id else None
    return db.put("skills", {**base, **(existing or {}), **data}, skill_id)


async def skill_from_description(description: str, kind: str = "skill") -> dict[str, Any]:
    raw = await llm.quick_text(
        f"Draft a reusable {'SOP (step-by-step procedure)' if kind == 'sop' else 'skill (workflow instructions)'} for an AI assistant "
        f"used by KPMG Advisory staff.\nWhat it should do: {description}\n"
        'Return JSON: {"name": "...", "description": "<one line>", "instructions": "<markdown instructions>", "steps": ["..."]}'
        + (" Include 4-8 steps." if kind == "sop" else " steps may be empty."),
        max_tokens=2500,
    )
    data = llm.extract_json(raw) or {"name": description[:40], "description": description, "instructions": raw, "steps": []}
    return skill_save({**data, "kind": kind, "source": "built"})


async def skill_from_conversation(session_id: str, kind: str = "skill") -> dict[str, Any]:
    msgs = db.messages(session_id)
    transcript = []
    for m in msgs:
        for b in m["content"]:
            if b.get("type") == "text":
                transcript.append(f"{m['role'].upper()}: {b['text'][:2000]}")
            elif b.get("type") == "tool_use":
                transcript.append(f"TOOL CALL: {b['name']} {json.dumps(b.get('input'))[:300]}")
    raw = await llm.quick_text(
        "Here is a conversation where the user and an AI assistant completed a task well. Distil the workflow into a reusable "
        f"{'SOP with ordered steps' if kind == 'sop' else 'skill'} that would reproduce this quality on a new input. Generalise away specifics.\n"
        'Return JSON: {"name": "...", "description": "<one line>", "instructions": "<markdown>", "steps": ["..."]}\n\n'
        + "\n".join(transcript)[-30000:],
        max_tokens=2500,
    )
    data = llm.extract_json(raw) or {"name": "Distilled skill", "description": "", "instructions": raw, "steps": []}
    return skill_save({**data, "kind": kind, "source": "distilled", "from_session": session_id})


# ---------------------------------------------------------------------------
# AIM package manager
# ---------------------------------------------------------------------------
def marketplace() -> list[dict[str, Any]]:
    pkgs = {p["id"]: p for p in db.list("packages")}
    out = []
    for item in MARKETPLACE:
        st = pkgs.get(item["id"])
        out.append({**{k: item[k] for k in ("id", "name", "kind", "author", "version", "description", "advisory")},
                    "contents": {"skills": len(item.get("skills", [])), "agents": len(item.get("agents", [])), "mcp": len(item.get("mcp", []))},
                    "stage": st["stage"] if st else "available"})
    return out


async def install(package_id: str) -> dict[str, Any]:
    item = next((m for m in MARKETPLACE if m["id"] == package_id), None)
    if not item:
        raise KeyError(package_id)
    db.put("packages", {"name": item["name"], "kind": item["kind"], "version": item["version"], "stage": "installed",
                        "health": "ok", "components": {}, "installed_at": time.time()}, package_id)
    return await import_package(package_id)


async def import_package(package_id: str) -> dict[str, Any]:
    item = next((m for m in MARKETPLACE if m["id"] == package_id), None)
    pkg = db.get("packages", package_id)
    if not item or not pkg:
        raise KeyError(package_id)
    comps: dict[str, list[str]] = {"skills": [], "agents": [], "mcp": []}
    name_to_skill = {}
    for s in item.get("skills", []):
        doc = skill_save({**s, "source": "marketplace", "package_id": package_id, "author": item["author"], "version": item["version"]})
        comps["skills"].append(doc["id"])
        name_to_skill[s["name"]] = doc["id"]
    for a in item.get("agents", []):
        a = dict(a)
        skill_ids = [name_to_skill[n] for n in a.pop("skills_by_name", []) if n in name_to_skill]
        doc = agent_save({**a, "skills": skill_ids, "package_id": package_id, "mode": "advanced"})
        comps["agents"].append(doc["id"])
    health = "ok"
    for m in item.get("mcp", []):
        info = await mcp.add_server(m["name"], m["config"], start=True)
        comps["mcp"].append(m["name"])
        if info.get("status") != "online":
            health = f"connector '{m['name']}' unavailable: {info.get('error') or info.get('status')}"
    pkg.update({"stage": "imported", "components": comps, "health": health})
    bus.emit("package_imported", package_id=package_id, health=health)
    return db.put("packages", pkg, package_id)


async def remove_package(package_id: str) -> dict[str, Any]:
    pkg = db.get("packages", package_id)
    if not pkg:
        raise KeyError(package_id)
    comps = pkg.get("components", {})
    for aid in comps.get("agents", []):
        db.delete("agents", aid)
    for sid in comps.get("skills", []):
        db.delete("skills", sid)
    still_needed = {
        name for p in db.list("packages", where=lambda p: p["id"] != package_id and p.get("stage") == "imported")
        for name in p.get("components", {}).get("mcp", [])
    }
    for name in comps.get("mcp", []):
        if name not in still_needed:
            await mcp.remove_server(name)
    pkg.update({"stage": "installed", "components": {}, "health": "ok"})
    return db.put("packages", pkg, package_id)


def uninstall(package_id: str) -> bool:
    pkg = db.get("packages", package_id)
    if pkg and pkg.get("stage") == "imported":
        raise ValueError("Remove (un-import) the package first.")
    return db.delete("packages", package_id)
