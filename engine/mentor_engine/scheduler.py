"""Scheduled tasks: prompts or agents that run on a cron schedule in the user's timezone.

Plain-language schedules are converted to cron:
    "weekdays at 2pm"         -> 0 14 * * 1-5
    "every monday at 9:30am"  -> 30 9 * * 1
    "daily at 8am"            -> 0 8 * * *
    "every hour"              -> 0 * * * *
    "every 15 minutes"        -> */15 * * * *
    "fridays at 4pm"          -> 0 16 * * 5
    "1st of every month at 9" -> 0 9 1 * *
Raw cron expressions are accepted as-is.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

from croniter import croniter

from .config import settings
from .events import bus
from .state import db

log = logging.getLogger("mentor.scheduler")

DAYS = {"monday": 1, "tuesday": 2, "wednesday": 3, "thursday": 4, "friday": 5, "saturday": 6, "sunday": 0,
        "mon": 1, "tue": 2, "wed": 3, "thu": 4, "fri": 5, "sat": 6, "sun": 0}


def _time(text: str) -> tuple[int, int]:
    m = re.search(r"\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b", text)
    if not m or not (m.group(3) or "at" in text or ":" in (m.group(0) or "")):
        if "noon" in text:
            return 12, 0
        if "midnight" in text:
            return 0, 0
        if "morning" in text:
            return 8, 0
        if "evening" in text:
            return 18, 0
        return 9, 0
    h, mi = int(m.group(1)), int(m.group(2) or 0)
    if m.group(3) == "pm" and h < 12:
        h += 12
    if m.group(3) == "am" and h == 12:
        h = 0
    return h % 24, mi % 60


def parse_schedule(text: str) -> str:
    t = text.strip().lower()
    if croniter.is_valid(t):
        return t
    m = re.search(r"every\s+(\d+)\s*(minute|min|hour)s?", t)
    if m:
        k = int(m.group(1))
        return f"*/{k} * * * *" if m.group(2).startswith("min") else f"0 */{k} * * *"
    if re.search(r"\bevery hour\b|\bhourly\b", t):
        return "0 * * * *"
    h, mi = _time(t)
    m = re.search(r"(\d{1,2})(?:st|nd|rd|th)\s+of\s+(?:every|each|the)\s+month", t)
    if m:
        return f"{mi} {h} {int(m.group(1))} * *"
    if "weekday" in t or "every workday" in t:
        return f"{mi} {h} * * 1-5"
    if "weekend" in t:
        return f"{mi} {h} * * 0,6"
    days = sorted({DAYS[d] for d in re.findall(r"\b(" + "|".join(DAYS) + r")s?\b", t)})
    if days:
        return f"{mi} {h} * * {','.join(map(str, days))}"
    if "monthly" in t:
        return f"{mi} {h} 1 * *"
    if "weekly" in t:
        return f"{mi} {h} * * 1"
    if re.search(r"daily|every day|each day|every morning|every evening|every night", t) or re.search(r"\bat\b", t):
        return f"{mi} {h} * * *"
    raise ValueError(f"Couldn't understand the schedule '{text}'. Try 'weekdays at 2pm' or a cron expression.")


def tz() -> ZoneInfo:
    try:
        return ZoneInfo(settings.get("user.timezone") or "UTC")
    except Exception:
        return ZoneInfo("UTC")


def next_run(cron: str, after: float | None = None) -> float:
    base = datetime.fromtimestamp(after or time.time(), tz())
    return croniter(cron, base).get_next(datetime).timestamp()


def describe(cron: str) -> str:
    return f"cron '{cron}' ({settings.get('user.timezone')})"


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------
def create_task(data: dict[str, Any]) -> dict[str, Any]:
    cron = parse_schedule(data.get("schedule") or data.get("cron") or "")
    doc = db.put(
        "tasks",
        {
            "name": data.get("name") or (data.get("prompt") or "Scheduled task")[:60],
            "prompt": data.get("prompt", ""),
            "agent_id": data.get("agent_id"),
            "project_id": data.get("project_id"),
            "schedule": data.get("schedule") or cron,
            "cron": cron,
            "enabled": data.get("enabled", True),
            "next_run": next_run(cron),
            "last_run": None,
            "last_status": None,
        },
    )
    bus.emit("task_created", task_id=doc["id"], name=doc["name"], cron=cron)
    return doc


def update_task(task_id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
    if "schedule" in patch:
        patch["cron"] = parse_schedule(patch["schedule"])
        patch["next_run"] = next_run(patch["cron"])
    if patch.get("enabled") is True:
        t = db.get("tasks", task_id)
        if t:
            patch["next_run"] = next_run(patch.get("cron", t["cron"]))
    return db.patch("tasks", task_id, patch)


async def run_task(task_id: str, trigger: str = "schedule") -> dict[str, Any]:
    from .runtime import run_headless

    task = db.get("tasks", task_id)
    if not task:
        raise KeyError(task_id)
    started = time.time()
    run = db.put("agent_runs", {"task_id": task_id, "agent_id": task.get("agent_id"), "trigger": trigger,
                                "input": task["prompt"], "status": "running", "started": started})
    try:
        result = await run_headless(task["prompt"], agent_id=task.get("agent_id"),
                                    project_ids=[task["project_id"]] if task.get("project_id") else [],
                                    title=f"⏰ {task['name']}")
        run.update({"status": "ok", "output": result["text"], "tools_used": result["tools_used"],
                    "session_id": result["session_id"], "artifacts": [a["id"] for a in result["artifacts"]]})
    except Exception as e:
        log.exception("task %s failed", task_id)
        run.update({"status": "error", "error": str(e)})
    run["duration"] = round(time.time() - started, 2)
    db.put("agent_runs", run)
    task = db.get("tasks", task_id) or task
    task.update({"last_run": started, "last_status": run["status"], "next_run": next_run(task["cron"])})
    db.put("tasks", task)
    bus.emit("task_completed", task_id=task_id, name=task["name"], status=run["status"],
             level="error" if run["status"] == "error" else "info")
    return run


# ---------------------------------------------------------------------------
# Background loop (also drives periodic housekeeping)
# ---------------------------------------------------------------------------
_running: set[str] = set()


async def loop() -> None:
    from . import artifacts, knowledge

    tick = 0
    while True:
        try:
            now = time.time()
            for task in db.list("tasks", where=lambda t: t.get("enabled")):
                if task.get("next_run") and task["next_run"] <= now and task["id"] not in _running:
                    _running.add(task["id"])

                    async def go(tid=task["id"]):
                        try:
                            await run_task(tid)
                        finally:
                            _running.discard(tid)

                    asyncio.create_task(go())
            # agents with their own schedule tab
            for agent in db.list("agents", where=lambda a: (a.get("schedule") or {}).get("enabled")):
                sch = agent["schedule"]
                nr = sch.get("next_run") or next_run(sch["cron"])
                if nr <= now and agent["id"] not in _running:
                    _running.add(agent["id"])
                    sch["next_run"] = next_run(sch["cron"])
                    db.put("agents", agent)

                    async def go_agent(a=agent):
                        from .runtime import run_agent_once

                        try:
                            await run_agent_once(a["id"], a["schedule"].get("input") or "Run your scheduled job.", trigger="schedule")
                        finally:
                            _running.discard(a["id"])

                    asyncio.create_task(go_agent())
            if tick % 30 == 0:  # ~10 minutes
                await knowledge.refresh_due_sources()
                await knowledge.reindex_due_folders()
                await asyncio.to_thread(artifacts.mirror_to_onedrive)
        except Exception:
            log.exception("scheduler tick failed")
        tick += 1
        await asyncio.sleep(20)
