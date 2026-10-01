"""The agent runtime - executes one chat turn end to end.

    user message
      -> resolve persona (agent), skill/SOP, attached prompt, @-mentions
      -> recall: semantic memory + memory-surface folders + @-mentioned projects/folders
      -> build system prompt + tool list (routing mode decides whether MCP tools participate)
      -> loop: model (Bedrock, streaming) -> tool calls (approval gate -> builtin or MCP) -> results -> model ...
      -> persist messages, record trace, kick off background memory capture

The same function serves interactive chat (WebSocket, with live approvals) and
headless runs (scheduled tasks/agents, where approval-gated tools are refused).
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import mimetypes
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

from . import knowledge, llm, memory, security
from .config import settings
from .events import bus
from .mcp_manager import mcp
from .scheduler import tz
from .state import db
from .tools import REGISTRY, ToolContext, ToolError, load_all, to_text

log = logging.getLogger("mentor.runtime")
load_all()

MAX_STEPS = 24
MAX_TOOL_RESULT = 60000

BASE_PROMPT = """You are Mentor, an AI assistant for professionals in KPMG's Advisory practice, running as a desktop app.
You help with research, analysis, drafting client-ready documents, data work, and planning.

How to work:
- Be direct and structured. Lead with the answer; use headings, bullets and tables when they help.
- Use tools when they give a better answer than memory alone: search the web for current facts, read files the user
  references, generate real files (Word/Excel/PowerPoint/charts) when asked for a deliverable.
- When you use retrieved context (projects, knowledge base, files), cite the source name in [brackets].
- Never invent client facts, figures or KPMG credentials. Say what you don't know and how to find out.
- Treat client information as confidential. Don't send it to external services unless the user asks.
- Generated files appear in the user's Artifacts gallery; mention the file name, don't paste the whole file back.

Current date/time: {now}. User: {user}."""


@dataclass
class TurnRequest:
    session_id: str
    text: str
    attachments: list[dict[str, Any]] = field(default_factory=list)  # [{id,name,path,mime}]
    mentions: list[str] = field(default_factory=list)  # project ids / folder:<id>
    skill_id: str | None = None
    prompt_id: str | None = None
    agent_id: str | None = None
    background: bool = False


Emit = Callable[[dict[str, Any]], Awaitable[None]]
Approve = Callable[[str, dict, str], Awaitable[bool]]


# ---------------------------------------------------------------------------
# Context building
# ---------------------------------------------------------------------------
def _user_line() -> str:
    u = settings.get("user")
    bits = [u.get("name") or "a KPMG professional", u.get("role") and f"({u['role']})", u.get("timezone") and f"timezone {u['timezone']}"]
    return " ".join(b for b in bits if b)


def _attachment_blocks(attachments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    from .ingest import extract_text

    blocks: list[dict[str, Any]] = []
    for a in attachments:
        path = Path(a.get("path", ""))
        if not path.is_file():
            continue
        mime = a.get("mime") or mimetypes.guess_type(path.name)[0] or ""
        if mime in ("image/png", "image/jpeg", "image/gif", "image/webp") and path.stat().st_size < 4_500_000:
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": mime,
                                                       "data": base64.b64encode(path.read_bytes()).decode()}})
        elif mime == "application/pdf" and path.stat().st_size < 30_000_000:
            blocks.append({"type": "document", "title": path.name,
                           "source": {"type": "base64", "media_type": "application/pdf",
                                      "data": base64.b64encode(path.read_bytes()).decode()}})
        else:
            try:
                text = extract_text(path)
            except Exception as e:
                text = f"(could not read: {e})"
            blocks.append({"type": "text", "text": f"<attachment name=\"{path.name}\" path=\"{path}\">\n{text[:150000]}\n</attachment>"})
    return blocks


async def build_context(req: TurnRequest, agent: dict | None) -> tuple[str, list[dict[str, Any]]]:
    """Returns (system_prompt, citations)."""
    parts = [BASE_PROMPT.format(now=datetime.now(tz()).strftime("%A %d %B %Y %H:%M %Z"), user=_user_line())]
    citations: list[dict[str, Any]] = []

    if agent:
        parts.append(f"<agent name=\"{agent['name']}\">\n{agent.get('system_prompt') or agent.get('description', '')}\n</agent>")
        if agent.get("personality") and agent["personality"] != "custom":
            parts.append(f"Response style: {agent['personality']}.")
        for env_k, env_v in (agent.get("env") or {}).items():
            parts.append(f"Variable {env_k} = {env_v}")
        if agent.get("output_schema"):
            parts.append(f"Always answer with JSON matching this schema:\n{json.dumps(agent['output_schema'])}")

    skill_ids = list(agent.get("skills", []) if agent else []) + ([req.skill_id] if req.skill_id else [])
    for sid in dict.fromkeys(skill_ids):
        sk = db.get("skills", sid)
        if sk:
            if sk["kind"] == "sop":
                steps = "\n".join(f"{i}. {st}" for i, st in enumerate(sk.get("steps", []), 1))
                parts.append(
                    f"<skill kind=\"sop\" name=\"{sk['name']}\">\nFollow this standard operating procedure step by step. "
                    f"Tell the user which step you are on, and wait for their input where a step needs it.\n"
                    f"{sk.get('instructions', '')}\nSteps:\n{steps}\n</skill>"
                )
            else:
                parts.append(f"<skill kind=\"{sk['kind']}\" name=\"{sk['name']}\">\n{sk.get('instructions', '')}\n</skill>")

    if req.prompt_id:
        p = db.get("prompts", req.prompt_id)
        if p:
            parts.append(f"<attached_prompt name=\"{p['name']}\">\n{p['content']}\n</attached_prompt>")

    # project context: explicit @-mentions plus projects attached to the session / agent
    session = db.get("sessions", req.session_id) or {}
    refs = list(dict.fromkeys(req.mentions + session.get("project_ids", [])))
    for rid in refs:
        if not rid.startswith("folder:"):
            pr = db.get("projects", rid)
            if pr and pr.get("instructions"):
                parts.append(f"<project name=\"{pr['name']}\">{pr['instructions']}</project>")
    if refs and req.text.strip():
        hits = await knowledge.retrieve(refs, req.text, k=8)
        if hits:
            lines = []
            for h in hits:
                citations.append({"source": h["source_name"], "namespace": h["namespace"], "score": round(h["score"], 3)})
                lines.append(f"[{h['source_name']}]\n{h['text'][:1500]}")
            parts.append("<context source=\"projects\">\nRelevant excerpts (cite by [name]):\n" + "\n---\n".join(lines) + "\n</context>")

    # semantic memory + memory-surface folders
    use_memory = agent.get("memory_enabled", True) if agent else True
    if use_memory and req.text.strip():
        mems = await memory.search(req.text, k=6)
        mems = [m for m in mems if m["score"] > 0.15]
        folder_ns = knowledge.memory_folder_namespaces()
        from .state import vectors

        fhits = await vectors.search(folder_ns, req.text, k=4, min_score=0.2) if folder_ns else []
        if mems or fhits:
            body = "\n".join(f"- {m['text']}" for m in mems)
            if fhits:
                body += "\n" + "\n".join(f"- [{h['meta'].get('name')}] {h['text'][:600]}" for h in fhits)
            parts.append(f"<memory>\nThings you know about the user and their work (use when relevant):\n{body}\n</memory>")
    return "\n\n".join(parts), citations


def available_tools(agent: dict | None) -> list[dict[str, Any]]:
    """Tool specs for the model; routing mode `cloud` runs without MCP tools."""
    allowed = set(agent.get("tools") or []) if agent else set()
    specs = []
    for t in REGISTRY.values():
        if settings.get("security.tool_overrides", {}).get(t.name) == "deny":
            continue
        if allowed and t.name not in allowed:
            continue
        if t.name == "generate_image" and settings.get("model.provider") == "demo":
            continue
        specs.append({**t.spec(), "_risk": t.risk})
    if settings.get("routing.mode") != "cloud":
        for m in mcp.tool_specs():
            if allowed and m["name"] not in allowed and f"mcp:{m['server']}" not in allowed:
                continue
            specs.append({"name": m["name"], "description": m["description"], "input_schema": m["input_schema"],
                          "_risk": m["risk"], "_mcp": (m["server"], m["tool"])})
    return specs


def history_messages(session_id: str, limit_chars: int = 400_000) -> list[dict[str, Any]]:
    """Session history in Messages API shape, trimmed from the oldest turn to fit."""
    msgs = [{"role": m["role"], "content": m["content"]} for m in db.messages(session_id) if m["role"] in ("user", "assistant")]
    total = sum(len(json.dumps(m)) for m in msgs)
    while msgs and total > limit_chars:
        dropped = msgs.pop(0)
        total -= len(json.dumps(dropped))
        while msgs and msgs[0]["role"] != "user":  # keep alternation valid
            total -= len(json.dumps(msgs.pop(0)))
    # never start on a tool_result-only user message
    while msgs and all(b.get("type") == "tool_result" for b in msgs[0]["content"]):
        msgs.pop(0)
        while msgs and msgs[0]["role"] != "user":
            msgs.pop(0)
    return msgs


# ---------------------------------------------------------------------------
# The turn
# ---------------------------------------------------------------------------
async def run_turn(req: TurnRequest, emit: Emit, approve: Approve | None = None) -> dict[str, Any]:
    session = db.get("sessions", req.session_id) or db.put("sessions", {"title": "New chat", "project_ids": []}, req.session_id)
    agent_id = req.agent_id or session.get("agent_id")
    agent = db.get("agents", agent_id) if agent_id else None
    trace = bus.start_trace(req.session_id, req.text, agent["name"] if agent else None)
    started = time.time()

    # persist the user turn
    user_content: list[dict[str, Any]] = _attachment_blocks(req.attachments)
    user_content.append({"type": "text", "text": req.text or "(see attachment)"})
    db.add_message(req.session_id, "user", user_content,
                   {"attachments": [{k: a.get(k) for k in ("id", "name", "mime")} for a in req.attachments],
                    "mentions": req.mentions, "skill_id": req.skill_id, "prompt_id": req.prompt_id, "agent_id": agent_id})
    if session.get("title") in (None, "", "New chat") and req.text.strip():
        session["title"] = req.text.strip().split("\n")[0][:60]
        db.put("sessions", session)
        await emit({"type": "session_title", "title": session["title"]})

    system, citations = await build_context(req, agent)
    bus.trace_step(trace, "context", chars=len(system), citations=len(citations))
    if citations:
        await emit({"type": "citations", "citations": citations})

    tools = available_tools(agent)
    tool_index = {t["name"]: t for t in tools}
    model_tools = [{k: v for k, v in t.items() if not k.startswith("_")} for t in tools]
    messages = history_messages(req.session_id)

    ctx = ToolContext(session_id=req.session_id, agent_id=agent_id, project_ids=req.mentions,
                      background=req.background, approve=approve)
    tools_used: list[str] = []
    final_text = ""
    usage_total = {"input_tokens": 0, "output_tokens": 0}
    status = "ok"

    try:
        for step in range(MAX_STEPS):
            bus.trace_step(trace, "model_call", step=step, messages=len(messages))
            t0 = time.time()

            async def on_text(chunk: str) -> None:
                await emit({"type": "delta", "text": chunk})

            result = await llm.complete(
                system, messages, model_tools or None, on_text,
                model=(agent or {}).get("model") or None,
                effort=(agent or {}).get("effort") or None,
                max_tokens=(agent or {}).get("max_tokens") or None,
            )
            for k in usage_total:
                usage_total[k] += int(result.usage.get(k, 0) or 0)
            bus.trace_step(trace, "model_result", step=step, stop_reason=result.stop_reason,
                           duration=round(time.time() - t0, 2), usage=result.usage, text=result.text[:400])
            messages.append({"role": "assistant", "content": result.content})
            db.add_message(req.session_id, "assistant", result.content, {"model": result.model, "usage": result.usage})
            final_text += result.text

            if result.stop_reason == "pause_turn":
                continue
            if result.stop_reason != "tool_use" or not result.tool_uses:
                if result.stop_reason == "max_tokens":
                    await emit({"type": "notice", "text": "Response hit the length limit - ask me to continue."})
                break

            tool_results = await asyncio.gather(
                *[_run_tool(tu, tool_index, ctx, emit, trace) for tu in result.tool_uses]
            )
            tools_used += [tu["name"] for tu in result.tool_uses]
            user_msg = {"role": "user", "content": list(tool_results)}
            messages.append(user_msg)
            db.add_message(req.session_id, "user", user_msg["content"], {"tool_results": True})
            await emit({"type": "delta", "text": "\n\n"})
        else:
            await emit({"type": "notice", "text": f"Stopped after {MAX_STEPS} steps."})
    except llm.LLMError as e:
        status = "error"
        bus.emit("error", message=str(e), session_id=req.session_id, level="error")
        await emit({"type": "error", "message": str(e)})
    except Exception as e:
        status = "error"
        log.exception("turn failed")
        bus.emit("error", message=f"{type(e).__name__}: {e}", session_id=req.session_id, level="error")
        await emit({"type": "error", "message": f"Unexpected error: {e}"})
    finally:
        bus.end_trace(trace, status)

    duration = round(time.time() - started, 2)
    bus.emit("agent_step", session_id=req.session_id, tools_used=len(tools_used), duration=duration, status=status,
             usage=usage_total)
    session["updated_turn"] = time.time()
    db.put("sessions", session)
    if status == "ok" and not req.background:
        asyncio.create_task(_capture(req.session_id, req.text, final_text))
    return {"text": final_text, "tools_used": tools_used, "artifacts": ctx.created_artifacts, "status": status,
            "usage": usage_total, "duration": duration, "session_id": req.session_id}


async def _capture(session_id: str, user_text: str, assistant_text: str) -> None:
    try:
        await memory.capture_turn(session_id, user_text, assistant_text)
    except Exception:
        log.exception("memory capture failed")


async def _run_tool(tu: dict, index: dict, ctx: ToolContext, emit: Emit, trace: dict) -> dict[str, Any]:
    name, args, call_id = tu["name"], tu.get("input") or {}, tu["id"]
    spec = index.get(name)
    t0 = time.time()
    await emit({"type": "tool_start", "id": call_id, "name": name, "input": args})
    bus.emit("tool_call", tool=name, input=args, session_id=ctx.session_id)

    def done(content: str, is_error: bool) -> dict[str, Any]:
        if len(content) > MAX_TOOL_RESULT:
            content = content[:MAX_TOOL_RESULT] + f"\n... (truncated from {len(content):,} chars)"
        dur = round(time.time() - t0, 2)
        bus.trace_step(trace, "tool", tool=name, input=args, ok=not is_error, duration=dur, result=content[:800])
        bus.emit("tool_result", tool=name, ok=not is_error, duration=dur, result=content[:500],
                 session_id=ctx.session_id, level="error" if is_error else "info")
        return {"type": "tool_result", "tool_use_id": call_id, "content": content, **({"is_error": True} if is_error else {})}

    if spec is None:
        res = done(f"Unknown tool '{name}'.", True)
        await emit({"type": "tool_end", "id": call_id, "ok": False, "result": res["content"][:2000]})
        return res

    # approval gate
    policy = security.tool_policy(name, spec.get("_risk", "medium"))
    ctx_local = ToolContext(**{**ctx.__dict__, "created_artifacts": ctx.created_artifacts})
    if policy == "deny":
        security.audit(name, args, "denied", ctx.session_id)
        res = done("This tool is disabled in Security › Tool Approvals.", True)
    elif policy == "ask" and (ctx.background or ctx.approve is None):
        security.audit(name, args, "denied-background", ctx.session_id)
        res = done("This tool needs the user's approval, which isn't possible in a background run.", True)
    else:
        approved = True
        if policy == "ask":
            approved = await ctx.approve(name, args, f"{spec.get('_risk', 'medium')}-risk tool")
            security.audit(name, args, "approved" if approved else "rejected", ctx.session_id)
            ctx_local.call_approved = approved
        if not approved:
            res = done("The user declined this tool call. Ask how they'd like to proceed.", True)
        else:
            try:
                if "_mcp" in spec:
                    server, tool_name = spec["_mcp"]
                    text, is_err = await mcp.call(server, tool_name, args)
                    res = done(text, is_err)
                else:
                    out = await REGISTRY[name].handler(args, ctx_local)
                    res = done(to_text(out), False)
            except ToolError as e:
                res = done(str(e), True)
            except Exception as e:
                log.exception("tool %s crashed", name)
                res = done(f"Tool error: {type(e).__name__}: {e}", True)
    await emit({"type": "tool_end", "id": call_id, "ok": not res.get("is_error"), "result": res["content"][:2000],
                "artifacts": [{k: a[k] for k in ("id", "name", "type", "mime")} for a in ctx_local.created_artifacts]})
    return res


# ---------------------------------------------------------------------------
# Headless runs (scheduled tasks, agent runs, spotlight)
# ---------------------------------------------------------------------------
async def _noop_emit(_: dict) -> None:
    return None


async def run_headless(prompt: str, agent_id: str | None = None, project_ids: list[str] | None = None,
                       title: str | None = None) -> dict[str, Any]:
    session = db.put("sessions", {"title": title or prompt[:60], "agent_id": agent_id, "project_ids": project_ids or [],
                                  "headless": True})
    return await run_turn(TurnRequest(session_id=session["id"], text=prompt, mentions=project_ids or [],
                                      agent_id=agent_id, background=True), _noop_emit, None)


async def run_agent_once(agent_id: str, input_text: str, trigger: str = "manual") -> dict[str, Any]:
    agent = db.get("agents", agent_id)
    if not agent:
        raise KeyError(agent_id)
    started = time.time()
    run = db.put("agent_runs", {"agent_id": agent_id, "trigger": trigger, "input": input_text, "status": "running",
                                "started": started})
    try:
        res = await run_headless(input_text, agent_id=agent_id,
                                 project_ids=agent.get("project_ids") or [], title=f"🤖 {agent['name']}")
        run.update({"status": res["status"], "output": res["text"], "tools_used": res["tools_used"],
                    "session_id": res["session_id"], "artifacts": [a["id"] for a in res["artifacts"]], "usage": res["usage"]})
    except Exception as e:
        run.update({"status": "error", "error": str(e)})
    run["duration"] = round(time.time() - started, 2)
    db.put("agent_runs", run)
    bus.emit("agent_run", agent_id=agent_id, status=run["status"], trigger=trigger,
             level="error" if run["status"] == "error" else "info")
    return run
