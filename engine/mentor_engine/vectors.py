"""Embeddings and vector search.

Embedders:
  * `bedrock:<model>` - Amazon Titan Text Embeddings v2 on Bedrock (512 dims) when AWS is configured
  * `hash-v1`         - local feature-hashing embedder (unigrams + bigrams), zero dependencies

Each stored vector records its embedder, and queries are embedded once per
embedder present in a namespace, so switching embedders never mixes spaces.
Search is brute-force cosine in numpy, which is plenty fast for a single user's
corpus (100k chunks ~ a few ms). Swap `search()` for FAISS if you need more.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import re
import time
from typing import Any

import numpy as np

from .config import settings
from .db import Database, new_id

log = logging.getLogger("mentor.vectors")

HASH_DIM = 768
_TOKEN = re.compile(r"[a-z0-9][a-z0-9_\-']*")
_STOP = set(
    "a an the and or of to in on for with at by from is are was were be been it this that these those i you we "
    "my your our me as do does did not no so if then than but into about over under".split()
)


def hash_embed(text: str) -> np.ndarray:
    tokens = [t for t in _TOKEN.findall(text.lower()) if t not in _STOP]
    vec = np.zeros(HASH_DIM, dtype=np.float32)
    feats = tokens + [f"{a}_{b}" for a, b in zip(tokens, tokens[1:])]
    for f in feats:
        h = int.from_bytes(hashlib.blake2b(f.encode(), digest_size=8).digest(), "little")
        vec[h % HASH_DIM] += 1.0 if (h >> 63) & 1 else -1.0
        # light stemming signal: share a bucket with the 5-char prefix
        if len(f) > 6 and "_" not in f:
            h2 = int.from_bytes(hashlib.blake2b(f[:5].encode(), digest_size=8).digest(), "little")
            vec[h2 % HASH_DIM] += 0.5
    n = np.linalg.norm(vec)
    return vec / n if n else vec


class Embedder:
    def __init__(self) -> None:
        self._bedrock_failed_at = 0.0

    def preferred(self) -> str:
        if settings.get("model.provider") == "bedrock" and time.time() - self._bedrock_failed_at > 600:
            return f"bedrock:{settings.get('model.embedding_model_id')}"
        return "hash-v1"

    async def embed(self, texts: list[str], embedder: str | None = None) -> tuple[str, list[np.ndarray]]:
        name = embedder or self.preferred()
        if name.startswith("bedrock:"):
            from .llm import bedrock_embed_sync

            try:
                vecs = await asyncio.to_thread(bedrock_embed_sync, texts)
                return name, [np.asarray(v, dtype=np.float32) for v in vecs]
            except Exception as e:
                if embedder:  # caller insisted on this embedder (query against stored vectors)
                    raise
                log.warning("Bedrock embeddings unavailable, falling back to local: %s", e)
                self._bedrock_failed_at = time.time()
        return "hash-v1", [hash_embed(t) for t in texts]


embedder = Embedder()


class VectorStore:
    def __init__(self, db: Database):
        self.db = db

    async def add(
        self, namespace: str, source_id: str, chunks: list[str], meta: dict | None = None
    ) -> int:
        if not chunks:
            return 0
        name, vecs = await embedder.embed(chunks)
        now = time.time()
        for i, (text, vec) in enumerate(zip(chunks, vecs)):
            self.db.execute(
                "INSERT INTO vectors(id,namespace,source_id,chunk_index,text,meta,embedder,dim,vector,created)"
                " VALUES (?,?,?,?,?,?,?,?,?,?)",
                (new_id("vec_"), namespace, source_id, i, text, json.dumps(meta or {}), name, len(vec),
                 vec.astype(np.float32).tobytes(), now),
            )
        return len(chunks)

    def remove_source(self, namespace: str, source_id: str) -> None:
        self.db.execute("DELETE FROM vectors WHERE namespace=? AND source_id=?", (namespace, source_id))

    def remove_namespace(self, namespace: str) -> None:
        self.db.execute("DELETE FROM vectors WHERE namespace=?", (namespace,))

    def count(self, namespace: str | None = None) -> int:
        if namespace:
            return self.db.query("SELECT COUNT(*) n FROM vectors WHERE namespace=?", (namespace,))[0]["n"]
        return self.db.query("SELECT COUNT(*) n FROM vectors")[0]["n"]

    def chunks_for(self, namespace: str, source_id: str) -> int:
        return self.db.query(
            "SELECT COUNT(*) n FROM vectors WHERE namespace=? AND source_id=?", (namespace, source_id)
        )[0]["n"]

    async def search(
        self, namespaces: list[str], query: str, k: int = 6, min_score: float = 0.05
    ) -> list[dict[str, Any]]:
        if not namespaces or not query.strip():
            return []
        marks = ",".join("?" * len(namespaces))
        rows = self.db.query(
            f"SELECT id,namespace,source_id,chunk_index,text,meta,embedder,vector,created FROM vectors"
            f" WHERE namespace IN ({marks})",
            namespaces,
        )
        if not rows:
            return []
        by_embedder: dict[str, list] = {}
        for r in rows:
            by_embedder.setdefault(r["embedder"], []).append(r)
        results: list[dict[str, Any]] = []
        for name, group in by_embedder.items():
            try:
                _, (qv,) = await embedder.embed([query], embedder=name)
            except Exception:
                continue
            mat = np.stack([np.frombuffer(r["vector"], dtype=np.float32) for r in group])
            if mat.shape[1] != qv.shape[0]:
                continue
            scores = mat @ qv
            # keyword boost keeps exact-name lookups (people, clients) reliable
            q_terms = {t for t in _TOKEN.findall(query.lower()) if t not in _STOP}
            for r, s in zip(group, scores):
                text_l = r["text"].lower()
                boost = 0.05 * sum(1 for t in q_terms if t in text_l) / max(1, len(q_terms))
                results.append(
                    {
                        "id": r["id"],
                        "namespace": r["namespace"],
                        "source_id": r["source_id"],
                        "chunk_index": r["chunk_index"],
                        "text": r["text"],
                        "meta": json.loads(r["meta"]),
                        "score": float(s) + boost,
                        "created": r["created"],
                    }
                )
        results = [r for r in results if r["score"] >= min_score and not math.isnan(r["score"])]
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:k]
