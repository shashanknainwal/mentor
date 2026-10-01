"""Utility and system tools: date/time, calculator, unit conversion, MCP management, status."""

from __future__ import annotations

import ast
import math
import operator
from datetime import datetime

from ..config import settings
from ..mcp_manager import REGISTRY as MCP_REGISTRY, fill_params, mcp
from . import ToolError, obj, s, tool


@tool("get_datetime", "Current date, time, weekday and timezone for the user.", obj(), category="Utility")
async def get_datetime(args, ctx):
    from ..scheduler import tz

    now = datetime.now(tz())
    return now.strftime("%A %d %B %Y, %H:%M (%Z, UTC%z)") + f" | ISO week {now.isocalendar().week}"


_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.Pow: operator.pow, ast.Mod: operator.mod, ast.FloorDiv: operator.floordiv, ast.USub: operator.neg, ast.UAdd: operator.pos}
_FUNCS = {k: getattr(math, k) for k in ("sqrt", "log", "log10", "exp", "sin", "cos", "tan", "floor", "ceil", "fabs")}
_FUNCS.update({"abs": abs, "round": round, "min": min, "max": max, "pi": math.pi, "e": math.e})


def safe_eval(expr: str) -> float:
    def ev(node):
        if isinstance(node, ast.Expression):
            return ev(node.body)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
            return node.value
        if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
            left, right = ev(node.left), ev(node.right)
            if isinstance(node.op, ast.Pow) and abs(right) > 1000:
                raise ToolError("exponent too large")
            return _OPS[type(node.op)](left, right)
        if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
            return _OPS[type(node.op)](ev(node.operand))
        if isinstance(node, ast.Name) and node.id in _FUNCS and not callable(_FUNCS[node.id]):
            return _FUNCS[node.id]
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in _FUNCS:
            return _FUNCS[node.func.id](*[ev(a) for a in node.args])
        raise ToolError(f"Unsupported expression element: {ast.dump(node)[:60]}")

    return ev(ast.parse(expr.replace("^", "**").replace("×", "*").replace(",", ""), mode="eval"))


@tool("calculator", "Evaluate an arithmetic expression exactly (+ - * / ** % sqrt log round min max).",
      obj(["expression"], expression=s("e.g. (1250000*0.18)/12")), category="Utility")
async def calculator(args, ctx):
    try:
        return f"{args['expression']} = {safe_eval(args['expression']):,.10g}"
    except (SyntaxError, ZeroDivisionError, ValueError) as e:
        raise ToolError(f"Can't evaluate: {e}")


UNITS = {
    "km": ("m", 1000), "m": ("m", 1), "cm": ("m", 0.01), "mm": ("m", 0.001), "mi": ("m", 1609.344), "ft": ("m", 0.3048), "in": ("m", 0.0254),
    "kg": ("kg", 1), "g": ("kg", 0.001), "lb": ("kg", 0.45359237), "oz": ("kg", 0.028349523),
    "l": ("l", 1), "ml": ("l", 0.001), "gal": ("l", 3.785411784),
    "h": ("s", 3600), "min": ("s", 60), "s": ("s", 1), "day": ("s", 86400), "week": ("s", 604800),
}


@tool("unit_convert", "Convert between units (length, mass, volume, time, °C/°F).",
      obj(["value", "from_unit", "to_unit"], value={"type": "number"}, from_unit=s("e.g. mi"), to_unit=s("e.g. km")), category="Utility")
async def unit_convert(args, ctx):
    v, f, t = float(args["value"]), args["from_unit"].lower(), args["to_unit"].lower()
    if {f, t} <= {"c", "f", "°c", "°f"}:
        f, t = f.strip("°"), t.strip("°")
        out = v * 9 / 5 + 32 if f == "c" and t == "f" else (v - 32) * 5 / 9 if f == "f" and t == "c" else v
        return f"{v} °{f.upper()} = {out:.4g} °{t.upper()}"
    if f not in UNITS or t not in UNITS or UNITS[f][0] != UNITS[t][0]:
        raise ToolError(f"Can't convert {f} to {t}.")
    return f"{v:g} {f} = {v * UNITS[f][1] / UNITS[t][1]:.6g} {t}"


@tool("system_status", "Report Mentor's health: model provider, routing mode, MCP servers, tool counts.", obj(), category="System")
async def system_status(args, ctx):
    from . import REGISTRY

    return {
        "provider": settings.get("model.provider"),
        "model": settings.get("model.model_id"),
        "region": settings.get("model.aws_region"),
        "routing_mode": settings.get("routing.mode"),
        "builtin_tools": len(REGISTRY),
        "mcp_servers": [{"name": x["name"], "status": x["status"], "tools": len(x["tools"])} for x in mcp.status()],
    }


@tool("mcp_list_servers", "List configured MCP servers, their status and tools.", obj(), category="System")
async def mcp_list_servers(args, ctx):
    return [{"name": x["name"], "status": x["status"], "error": x.get("error"), "tools": [t["name"] for t in x["tools"]]}
            for x in mcp.status()] or "No MCP servers configured."


@tool("mcp_search_registry", "Search the MCP server registry for installable connectors.",
      obj(query=s("Keyword, e.g. 'slack'")), category="System")
async def mcp_search_registry(args, ctx):
    return mcp.search_registry(args.get("query", ""))


@tool(
    "mcp_install",
    "Install and connect an MCP server. Accepts chat commands like 'install slack', 'aim mcp install <pkg>', "
    "'mcp-registry install <pkg>', 'toolbox install <pkg>', 'uvx <pkg>', 'npx <pkg>', or a raw JSON config.",
    obj(["command"], command=s("Install command or JSON"), params={"type": "object", "description": "Values for placeholders like token/path"}),
    risk="high",
    category="System",
)
async def mcp_install(args, ctx):
    cmd = args["command"].strip()
    if cmd.startswith("{"):
        added = await mcp.import_json(cmd)
        return f"Imported {len(added)} server(s): {', '.join(added)}" if added else "No servers found in that JSON."
    parsed = mcp.parse_install_command(cmd)
    if not parsed:
        raise ToolError("Didn't recognise that install command.")
    name, cfg = parsed
    needed = MCP_REGISTRY.get(name, {}).get("params", [])
    params = args.get("params") or {}
    missing = [p for p in needed if p not in params]
    if missing:
        return f"To install '{name}' I need: {', '.join(missing)}. Ask the user for them, then call mcp_install again with params."
    cfg = fill_params(cfg, params)
    info = await mcp.add_server(name, cfg)
    if info.get("status") != "online":
        return f"Added '{name}' but it isn't online yet: {info.get('error') or info.get('status')}. Check Integrations."
    return f"Installed '{name}' - {len(info['tools'])} tools now available: {', '.join(t['name'] for t in info['tools'][:15])}"
