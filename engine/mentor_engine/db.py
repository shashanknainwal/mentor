"""SQLite persistence.

Most entities (agents, prompts, projects, skills, tasks, calendar events, decks...)
are stored as JSON documents in one `docs` table keyed by (collection, id). That
keeps the schema stable while the product evolves. Chat messages and vectors get
their own tables because they are high-volume and queried differently.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    created REAL NOT NULL,
    updated REAL NOT NULL,
    PRIMARY KEY (collection, id)
);
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,      -- JSON: list of content blocks (Messages API shape)
    meta TEXT NOT NULL DEFAULT '{}',
    created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created);
CREATE TABLE IF NOT EXISTS vectors (
    id TEXT PRIMARY KEY,
    namespace TEXT NOT NULL,    -- memory | kb | project:<id> | folder:<id>
    source_id TEXT NOT NULL,    -- memory id / document id / file path
    chunk_index INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL,
    meta TEXT NOT NULL DEFAULT '{}',
    embedder TEXT NOT NULL,
    dim INTEGER NOT NULL,
    vector BLOB NOT NULL,
    created REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vectors_ns ON vectors(namespace);
CREATE INDEX IF NOT EXISTS idx_vectors_source ON vectors(namespace, source_id);
"""


def new_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:12]}"


class Database:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.RLock()
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def execute(self, sql: str, params: Iterable[Any] = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self.conn.execute(sql, tuple(params))
            self.conn.commit()
            return cur

    def query(self, sql: str, params: Iterable[Any] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.conn.execute(sql, tuple(params)).fetchall())

    # ---- document store ---------------------------------------------
    def put(self, collection: str, data: dict[str, Any], id: str | None = None) -> dict[str, Any]:
        now = time.time()
        doc_id = id or data.get("id") or new_id()
        existing = self.get(collection, doc_id)
        created = existing.get("created", now) if existing else now
        data = {**data, "id": doc_id, "created": created, "updated": now}
        self.execute(
            "INSERT OR REPLACE INTO docs(collection,id,data,created,updated) VALUES (?,?,?,?,?)",
            (collection, doc_id, json.dumps(data), created, now),
        )
        return data

    def patch(self, collection: str, id: str, patch: dict[str, Any]) -> dict[str, Any] | None:
        doc = self.get(collection, id)
        if doc is None:
            return None
        doc.update({k: v for k, v in patch.items() if k not in ("id", "created")})
        return self.put(collection, doc, id)

    def get(self, collection: str, id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT data FROM docs WHERE collection=? AND id=?", (collection, id))
        return json.loads(rows[0]["data"]) if rows else None

    def list(
        self,
        collection: str,
        where: Callable[[dict[str, Any]], bool] | None = None,
        order: str = "updated DESC",
        limit: int | None = None,
    ) -> list[dict[str, Any]]:
        assert order in ("updated DESC", "updated ASC", "created DESC", "created ASC")
        rows = self.query(f"SELECT data FROM docs WHERE collection=? ORDER BY {order}", (collection,))
        docs = [json.loads(r["data"]) for r in rows]
        if where:
            docs = [d for d in docs if where(d)]
        return docs[:limit] if limit else docs

    def delete(self, collection: str, id: str) -> bool:
        cur = self.execute("DELETE FROM docs WHERE collection=? AND id=?", (collection, id))
        return cur.rowcount > 0

    def count(self, collection: str) -> int:
        return self.query("SELECT COUNT(*) AS n FROM docs WHERE collection=?", (collection,))[0]["n"]

    # ---- messages ----------------------------------------------------
    def add_message(self, session_id: str, role: str, content: list[dict], meta: dict | None = None) -> dict:
        mid = new_id("msg_")
        now = time.time()
        self.execute(
            "INSERT INTO messages(id,session_id,role,content,meta,created) VALUES (?,?,?,?,?,?)",
            (mid, session_id, role, json.dumps(content), json.dumps(meta or {}), now),
        )
        return {"id": mid, "session_id": session_id, "role": role, "content": content, "meta": meta or {}, "created": now}

    def messages(self, session_id: str) -> list[dict]:
        rows = self.query("SELECT * FROM messages WHERE session_id=? ORDER BY created", (session_id,))
        return [
            {
                "id": r["id"],
                "session_id": r["session_id"],
                "role": r["role"],
                "content": json.loads(r["content"]),
                "meta": json.loads(r["meta"]),
                "created": r["created"],
            }
            for r in rows
        ]

    def delete_messages(self, session_id: str) -> None:
        self.execute("DELETE FROM messages WHERE session_id=?", (session_id,))
