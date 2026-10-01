"""In-process event bus feeding the Diagnostics panel.

Three streams:
  * event log   - tool calls, agent steps, errors (Diagnostics > Event Log)
  * traces      - per-request step-by-step activity (Diagnostics > Activity Log)
  * backend log - lower-level engine events (Diagnostics > Events)

Subscribers are WebSocket connections; everything is also kept in ring buffers
so a newly opened panel can show recent history.
"""

from __future__ import annotations

import asyncio
import logging
import time
from collections import deque
from typing import Any

from .db import new_id

log = logging.getLogger("mentor")


class EventBus:
    def __init__(self, maxlen: int = 2000):
        self.events: deque[dict] = deque(maxlen=maxlen)
        self.backend: deque[dict] = deque(maxlen=maxlen)
        self.traces: deque[dict] = deque(maxlen=200)
        self._subscribers: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=1000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    def _broadcast(self, payload: dict) -> None:
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                pass

    def emit(self, kind: str, **data: Any) -> dict:
        evt = {"id": new_id("evt_"), "ts": time.time(), "kind": kind, **data}
        self.events.append(evt)
        self._broadcast({"stream": "event", "event": evt})
        return evt

    def backend_log(self, level: str, message: str, **data: Any) -> None:
        evt = {"ts": time.time(), "level": level, "message": message, **data}
        self.backend.append(evt)
        self._broadcast({"stream": "backend", "event": evt})

    # ---- traces (Activity Log) ---------------------------------------
    def start_trace(self, session_id: str, message: str, agent: str | None = None) -> dict:
        trace = {
            "id": new_id("trc_"),
            "session_id": session_id,
            "agent": agent,
            "message": message[:500],
            "started": time.time(),
            "ended": None,
            "status": "running",
            "steps": [],
        }
        self.traces.append(trace)
        self._broadcast({"stream": "trace", "trace": trace})
        return trace

    def trace_step(self, trace: dict, kind: str, **data: Any) -> dict:
        step = {"ts": time.time(), "kind": kind, **data}
        trace["steps"].append(step)
        self._broadcast({"stream": "trace", "trace": trace})
        return step

    def end_trace(self, trace: dict, status: str = "ok") -> None:
        trace["ended"] = time.time()
        trace["status"] = status
        self._broadcast({"stream": "trace", "trace": trace})


bus = EventBus()


class BusLogHandler(logging.Handler):
    """Mirror Python logging into the Diagnostics > Events console."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            bus.backend_log(record.levelname, record.getMessage(), logger=record.name)
        except Exception:  # pragma: no cover - never let logging crash the engine
            pass
