"""Built-in tool registry.

Add a tool with the @tool decorator:

    @tool("get_datetime", "Current date/time in the user's timezone.", {"type": "object", "properties": {}}, risk="low")
    async def get_datetime(args, ctx):
        return "..."

Handlers return a string (or something JSON-serialisable). Raise ToolError for
user-facing failures; anything else is reported as an unexpected error.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable


class ToolError(Exception):
    pass


@dataclass
class ToolContext:
    session_id: str | None = None
    agent_id: str | None = None
    project_ids: list[str] = field(default_factory=list)
    background: bool = False  # scheduled runs - no interactive approvals
    created_artifacts: list[dict[str, Any]] = field(default_factory=list)
    call_approved: bool = False  # set by the runtime when the user approved the current call
    approve: Callable[[str, dict, str], Awaitable[bool]] | None = None  # (tool, args, reason) -> approved?


Handler = Callable[[dict[str, Any], ToolContext], Awaitable[Any]]


@dataclass
class Tool:
    name: str
    description: str
    input_schema: dict[str, Any]
    handler: Handler
    risk: str = "low"
    category: str = "General"

    def spec(self) -> dict[str, Any]:
        return {"name": self.name, "description": self.description, "input_schema": self.input_schema}


REGISTRY: dict[str, Tool] = {}


def tool(name: str, description: str, schema: dict[str, Any], risk: str = "low", category: str = "General"):
    schema.setdefault("type", "object")
    schema.setdefault("properties", {})

    def wrap(fn: Handler) -> Handler:
        REGISTRY[name] = Tool(name, description, schema, fn, risk, category)
        return fn

    return wrap


def obj(required: list[str] | None = None, **props: dict[str, Any]) -> dict[str, Any]:
    return {"type": "object", "properties": props, "required": required or []}


def s(desc: str, **extra: Any) -> dict[str, Any]:
    return {"type": "string", "description": desc, **extra}


def n(desc: str, **extra: Any) -> dict[str, Any]:
    return {"type": "number", "description": desc, **extra}


def to_text(result: Any) -> str:
    if isinstance(result, str):
        return result
    return json.dumps(result, indent=2, default=str)


def load_all() -> dict[str, Tool]:
    # Importing registers the tools.
    from . import code, documents, productivity, system, web  # noqa: F401

    return REGISTRY
