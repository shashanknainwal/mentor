"""Memory, knowledge, projects, calendar, scheduling, presentations, and library lookups."""

from __future__ import annotations

from .. import artifacts, calendar_store, knowledge, memory, presentations, scheduler
from ..state import db, vectors
from . import ToolError, n, obj, s, tool

ARR_STR = {"type": "array", "items": {"type": "string"}}


# ---- memory ---------------------------------------------------------------
@tool("memory_search", "Search long-term memory about the user (preferences, facts, people, past decisions).",
      obj(["query"], query=s("What to look for"), limit=n("Default 8")), category="Memory")
async def memory_search(args, ctx):
    hits = await memory.search(args["query"], int(args.get("limit", 8)))
    return "\n".join(f"- {h['text']} (score {h['score']})" for h in hits) or "No related memories."


@tool("memory_save", "Save a durable fact or preference to long-term memory when the user asks you to remember something.",
      obj(["text"], text=s("One self-contained sentence"), kind=s("preference|fact|project|decision"), topics=ARR_STR),
      risk="medium", category="Memory")
async def memory_save(args, ctx):
    doc = await memory.save(args["text"], args.get("kind", "fact"), args.get("topics"), session_id=ctx.session_id, source="explicit")
    return f"Remembered: {doc['text']}" if doc else "Nothing saved (too short)."


@tool("memory_forget", "Delete memories matching a description (asks the user first).",
      obj(["query"], query=s("Description of what to forget")), risk="high", category="Memory")
async def memory_forget(args, ctx):
    hits = await memory.search(args["query"], 5)
    hits = [h for h in hits if h["score"] > 0.5]
    for h in hits:
        memory.delete(h["id"])
    return f"Deleted {len(hits)} memories." if hits else "No closely matching memories found."


@tool("person_lookup", "Look up a person card (title, department, location, notes) from memory.",
      obj(["name"], name=s("Person's name")), category="Memory")
async def person_lookup(args, ctx):
    q = args["name"].lower()
    people = [p for p in db.list("people") if q in p["name"].lower()]
    return people[:5] or "No person card found."


# ---- knowledge ---------------------------------------------------------------
@tool("knowledge_search", "Search documents uploaded to the Knowledge Base (Data panel). Cite document names.",
      obj(["query"], query=s("Question or keywords"), limit=n("Default 6")), category="Knowledge")
async def knowledge_search(args, ctx):
    hits = await vectors.search(["kb"], args["query"], k=int(args.get("limit", 6)))
    return "\n\n".join(f"[{h['meta'].get('name')}] {h['text'][:1200]}" for h in hits) or "No matching documents."


@tool("project_search", "Search files and sources inside a project (by id or name).",
      obj(["project", "query"], project=s("Project id or name"), query=s("Question or keywords")), category="Knowledge")
async def project_search(args, ctx):
    ref = args["project"].lower()
    match = next((p for p in knowledge.project_list() if p["id"] == args["project"] or ref in p["name"].lower()), None)
    if not match:
        raise ToolError(f"No project matching '{args['project']}'.")
    hits = await knowledge.retrieve([match["id"]], args["query"], k=8)
    return "\n\n".join(f"[{h['source_name']}] {h['text'][:1200]}" for h in hits) or "No matching content."


@tool("list_projects", "List the user's projects and @-mentionable folders.", obj(), category="Knowledge")
async def list_projects(args, ctx):
    return [{"id": p["id"], "name": p["name"], "description": p.get("description", ""), "files": p.get("file_count", 0),
             "status": p.get("status")} for p in knowledge.project_list()]


# ---- calendar ------------------------------------------------------------------
@tool("calendar_list", "List calendar events, tasks, reminders and deadlines for the next N days.",
      obj(days=n("Default 7")), category="Calendar")
async def calendar_list(args, ctx):
    items = calendar_store.upcoming(int(args.get("days", 7)))
    return [{k: e[k] for k in ("id", "title", "start", "end", "kind", "done", "location")} for e in items] or "Nothing scheduled."


@tool("calendar_create", "Create a calendar event, task, reminder or deadline. Use ISO local datetimes (2026-10-14T15:00).",
      obj(["title", "start"], title=s("Title"), start=s("ISO start"), end=s("ISO end (optional)"),
          kind=s("event|task|reminder|deadline"), notes=s("Notes"), location=s("Location")),
      risk="medium", category="Calendar")
async def calendar_create(args, ctx):
    try:
        e = calendar_store.create({**args, "source": "assistant"})
    except ValueError as ex:
        raise ToolError(str(ex))
    return f"Created {e['kind']} '{e['title']}' on {e['start']} (id {e['id']})."


@tool("calendar_update", "Update or complete a calendar item by id.",
      obj(["id"], id=s("Event id"), title=s("Title"), start=s("ISO start"), end=s("ISO end"), done={"type": "boolean"}),
      risk="medium", category="Calendar")
async def calendar_update(args, ctx):
    e = calendar_store.update(args.pop("id"), args)
    return f"Updated '{e['title']}'." if e else "Not found."


@tool("calendar_delete", "Delete a calendar item by id.", obj(["id"], id=s("Event id")), risk="high", category="Calendar")
async def calendar_delete(args, ctx):
    return "Deleted." if calendar_store.delete(args["id"]) else "Not found."


# ---- scheduling -----------------------------------------------------------------
@tool("schedule_task",
      "Schedule a recurring prompt (or agent) to run automatically, e.g. 'weekdays at 8am'. Runs in the user's timezone.",
      obj(["prompt", "schedule"], name=s("Short name"), prompt=s("What to do each run"),
          schedule=s("Plain language or cron"), agent_id=s("Optional agent id"), project_id=s("Optional project id")),
      risk="medium", category="Automation")
async def schedule_task(args, ctx):
    try:
        t = scheduler.create_task(args)
    except ValueError as e:
        raise ToolError(str(e))
    from datetime import datetime

    nxt = datetime.fromtimestamp(t["next_run"], scheduler.tz()).strftime("%a %d %b %H:%M %Z")
    return f"Scheduled '{t['name']}' ({t['cron']}). Next run: {nxt}."


@tool("list_scheduled_tasks", "List scheduled tasks with their next run and last result.", obj(), category="Automation")
async def list_scheduled_tasks(args, ctx):
    return [{k: t.get(k) for k in ("id", "name", "schedule", "cron", "enabled", "last_status")} for t in db.list("tasks")] or "No scheduled tasks."


# ---- presentations ---------------------------------------------------------------
SLIDE = obj(["title"], layout=s("title|bullets|two_column|section|quote|closing"), title=s("Slide title"),
            subtitle=s("Subtitle (title/section/quote slides)"), bullets=ARR_STR, right=ARR_STR, notes=s("Speaker notes"))


@tool("create_presentation",
      "Create an editable slide deck (opens in the Presentations panel) and export it to .pptx. "
      "Keep 3-6 concise bullets per slide; put detail in speaker notes.",
      obj(["title", "slides"], title=s("Deck title"), theme=s("kpmg|midnight|minimal"),
          slides={"type": "array", "items": SLIDE}),
      risk="medium", category="Documents")
async def create_presentation(args, ctx):
    deck = presentations.create(args["title"], args["slides"], args.get("theme", "kpmg"), ctx.session_id)
    art = presentations.export(deck["id"])
    ctx.created_artifacts.append(art)
    return f"Created deck '{deck['title']}' with {len(deck['slides'])} slides [deck:{deck['id']}] and exported {art['name']} [artifact:{art['id']}]."


# ---- library lookups ---------------------------------------------------------------
@tool("list_artifacts", "List recently generated artifacts (files, images, decks).",
      obj(type=s("images|documents|spreadsheets|presentations|code|diagrams"), limit=n("Default 20")), category="Library")
async def list_artifacts(args, ctx):
    items = artifacts.list_all(args.get("type"))[: int(args.get("limit", 20))]
    return [{"id": a["id"], "name": a["name"], "type": a["type"], "path": a["path"]} for a in items] or "No artifacts yet."


@tool("list_agents", "List the user's custom agents.", obj(), category="Library")
async def list_agents(args, ctx):
    return [{"id": a["id"], "name": a["name"], "description": a.get("description", "")} for a in db.list("agents")]


@tool("list_skills", "List installed Skills and SOPs the user can run with '/'.", obj(), category="Library")
async def list_skills(args, ctx):
    return [{"id": x["id"], "name": x["name"], "kind": x["kind"], "description": x.get("description", "")} for x in db.list("skills")]
