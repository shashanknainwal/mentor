"""Code execution, gated by Security > Exec Safety."""

from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from pathlib import Path

from .. import artifacts, security
from ..knowledge import ensure_workspace
from . import ToolError, n, obj, s, tool

MAX_OUT = 20000


async def _run(cmd: list[str] | str, cwd: Path, timeout: int, shell: bool = False) -> tuple[int, str]:
    if shell:
        proc = await asyncio.create_subprocess_shell(
            cmd, cwd=str(cwd), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
    else:
        proc = await asyncio.create_subprocess_exec(
            *cmd, cwd=str(cwd), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT
        )
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return -1, f"Timed out after {timeout}s"
    text = out.decode("utf-8", errors="replace")
    if len(text) > MAX_OUT:
        text = text[:MAX_OUT] + f"\n... (truncated, {len(text):,} chars)"
    return proc.returncode or 0, text


async def _gate(ctx, tool_name: str, command: str) -> None:
    decision, reason = security.exec_check(command)
    if decision == "deny":
        security.audit(tool_name, {"command": command}, "denied", ctx.session_id)
        raise ToolError(f"Blocked by Exec Safety: {reason}")
    if decision == "ask" and not ctx.call_approved:
        if ctx.background or ctx.approve is None:
            raise ToolError(f"Needs approval ({reason}) - not available in background runs.")
        if not await ctx.approve(tool_name, {"command": command}, reason):
            security.audit(tool_name, {"command": command}, "rejected", ctx.session_id)
            raise ToolError("The user declined to run this command.")
    security.audit(tool_name, {"command": command}, "allowed", ctx.session_id)


@tool(
    "run_python",
    "Run a Python 3 script in a scratch folder and return stdout/stderr. Files the script writes to ./output/ "
    "are saved as artifacts. Use for calculations, data analysis and file conversions.",
    obj(["code"], code=s("Complete Python source"), timeout=n("Seconds, default 60, max 300")),
    risk="high",
    category="Code",
)
async def run_python(args, ctx):
    code = args["code"]
    await _gate(ctx, "run_python", f"python <script: {code.splitlines()[0][:80] if code else ''}...>")
    ws = ensure_workspace() / "runs"
    ws.mkdir(exist_ok=True)
    workdir = Path(tempfile.mkdtemp(prefix=time.strftime("%Y%m%d-%H%M%S-"), dir=ws))
    (workdir / "output").mkdir()
    script = workdir / "script.py"
    script.write_text(code, "utf-8")
    rc, out = await _run([sys.executable, str(script)], workdir, min(300, int(args.get("timeout", 60))))
    saved = []
    for f in (workdir / "output").iterdir():
        if f.is_file():
            doc = artifacts.save(f.name, f.read_bytes(), ctx.session_id, "run_python")
            ctx.created_artifacts.append(doc)
            saved.append(f"{doc['name']} [artifact:{doc['id']}]")
    result = f"exit code {rc}\n{out}"
    if saved:
        result += "\nSaved artifacts: " + ", ".join(saved)
    return result


@tool(
    "run_shell",
    "Run a shell command in the Mentor workspace folder. Subject to Exec Safety allow/deny lists and approval.",
    obj(["command"], command=s("Command line"), timeout=n("Seconds, default 60")),
    risk="high",
    category="Code",
)
async def run_shell(args, ctx):
    await _gate(ctx, "run_shell", args["command"])
    rc, out = await _run(args["command"], ensure_workspace(), min(300, int(args.get("timeout", 60))), shell=True)
    return f"exit code {rc}\n{out}"
