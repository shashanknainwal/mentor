"""Security: Exec Safety (shell commands) and Tool Approvals.

Each tool declares a risk level:
    low    - read-only, no side effects (search, read file, list calendar)
    medium - creates local content (write artifact, add calendar event, save memory)
    high   - changes the outside world or runs code (write user files, exec, send email via MCP)
MCP tools default to `medium` unless their annotations say read-only.

approval_mode:
    always_ask - every medium/high tool needs approval
    ask_risky  - only high-risk tools need approval (default)
    never_ask  - no prompts (exec safety still applies)
Per-tool overrides ("allow" | "ask" | "deny") win over the mode.
"""

from __future__ import annotations

import shlex
import time
from typing import Any

from .config import settings
from .state import db


def tool_policy(tool_name: str, risk: str) -> str:
    sec = settings.get("security")
    override = sec.get("tool_overrides", {}).get(tool_name)
    if override in ("allow", "ask", "deny"):
        return override
    mode = sec.get("approval_mode", "ask_risky")
    if risk == "low" or mode == "never_ask":
        return "allow"
    if mode == "always_ask":
        return "ask"
    return "ask" if risk == "high" else "allow"


def exec_check(command: str) -> tuple[str, str]:
    """Returns (decision, reason) where decision is allow | ask | deny."""
    sec = settings.get("security")
    mode = sec.get("exec_mode", "ask")
    lowered = command.lower().strip()
    for bad in sec.get("exec_denylist", []):
        if bad.lower() in lowered:
            return "deny", f"matches blocked pattern '{bad}'"
    if mode == "disabled":
        return "deny", "command execution is disabled in Security › Exec Safety"
    try:
        head = " ".join(shlex.split(command)[:2])
    except ValueError:
        head = lowered
    for allowed in sec.get("exec_allowlist", []):
        if lowered == allowed.lower() or lowered.startswith(allowed.lower() + " ") or head.lower() == allowed.lower():
            return "allow", f"allow-listed ('{allowed}')"
    if mode == "allowlist":
        return "deny", "not on the exec allow-list"
    return "ask", "not on the allow-list - needs your approval"


def audit(tool: str, args: dict[str, Any], decision: str, session_id: str | None) -> None:
    db.put(
        "approvals_log",
        {"tool": tool, "args": {k: (str(v)[:300]) for k, v in (args or {}).items()}, "decision": decision,
         "session_id": session_id, "ts": time.time()},
    )
