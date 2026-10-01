"""Paths and persisted settings.

All user data lives under MENTOR_HOME (default ~/MentorDesktop):

    ~/MentorDesktop/
        mentor.db          SQLite: documents, messages, vectors
        settings.json      user settings (this module)
        mcp.json           MCP server config (Claude-Desktop compatible format)
        artifacts/<type>/  everything the AI generates
        uploads/           files attached in chat / knowledge base
        logs/              engine logs
        bundles/           support bundles and issue reports
"""

from __future__ import annotations

import copy
import json
import os
import threading
from pathlib import Path
from typing import Any

HOME = Path(os.environ.get("MENTOR_HOME", Path.home() / "MentorDesktop")).expanduser()

DEFAULT_SETTINGS: dict[str, Any] = {
    "user": {"name": "", "alias": "", "role": "Director", "timezone": "Europe/London"},
    "model": {
        # "bedrock" calls AWS Bedrock; "demo" is an offline stand-in so the UI works without creds.
        "provider": "bedrock",
        "model_id": "anthropic.claude-opus-5-5",
        "fast_model_id": "anthropic.claude-haiku-4-5",
        "effort": "medium",
        "max_tokens": 16000,
        "aws_region": "us-east-1",
        "aws_profile": "",
        "aws_access_key": "",
        "aws_secret_key": "",
        "aws_session_token": "",
        "embedding_model_id": "amazon.titan-embed-text-v2:0",
        "image_model_id": "amazon.nova-canvas-v1:0",
    },
    # Managed by the engine, shown read-only in Diagnostics (no picker in Settings).
    "routing": {"mode": "bedrock_direct"},
    "appearance": {"theme": "system", "accent": "kpmg", "density": "comfortable", "font_size": 14},
    "voice": {"stt": "browser", "tts": False, "tts_voice": ""},
    "privacy": {"memory_capture": True, "calendar_detection": True, "telemetry": False},
    "startup": {"launch_at_login": False, "minimize_to_tray": True, "check_updates": True},
    "security": {
        # exec_mode: disabled | ask | allowlist
        "exec_mode": "ask",
        "exec_allowlist": ["ls", "dir", "pwd", "echo", "git status", "git log", "python --version"],
        "exec_denylist": ["rm -rf /", "format ", "mkfs", "shutdown", "del /s", ":(){", "dd if="],
        # approval_mode: always_ask | ask_risky | never_ask
        "approval_mode": "ask_risky",
        "tool_overrides": {},  # tool name -> "allow" | "ask" | "deny"
    },
    "artifacts": {"onedrive_mirror": False, "onedrive_path": ""},
    "prompts": {"cloud_url": ""},
    "computer_use": {"enabled": False},
    "debug": False,
}


def _deep_merge(base: dict, override: dict) -> dict:
    out = copy.deepcopy(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out


SECRET_KEYS = {"aws_secret_key", "aws_session_token", "aws_access_key"}


class Settings:
    def __init__(self, home: Path = HOME):
        self.home = home
        self.path = home / "settings.json"
        self._lock = threading.Lock()
        self._data: dict[str, Any] = {}
        self.ensure_dirs()
        self.load()

    # ---- paths -------------------------------------------------------
    def ensure_dirs(self) -> None:
        for sub in ("", "artifacts", "uploads", "logs", "bundles", "skills"):
            (self.home / sub).mkdir(parents=True, exist_ok=True)

    @property
    def db_path(self) -> Path:
        return self.home / "mentor.db"

    @property
    def artifacts_dir(self) -> Path:
        return self.home / "artifacts"

    @property
    def uploads_dir(self) -> Path:
        return self.home / "uploads"

    @property
    def mcp_path(self) -> Path:
        return self.home / "mcp.json"

    # ---- data --------------------------------------------------------
    def load(self) -> None:
        raw = {}
        if self.path.exists():
            try:
                raw = json.loads(self.path.read_text("utf-8"))
            except json.JSONDecodeError:
                raw = {}
        self._data = _deep_merge(DEFAULT_SETTINGS, raw)

    def save(self) -> None:
        with self._lock:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._data, indent=2), "utf-8")
            tmp.replace(self.path)

    def get(self, dotted: str, default: Any = None) -> Any:
        cur: Any = self._data
        for part in dotted.split("."):
            if not isinstance(cur, dict) or part not in cur:
                return default
            cur = cur[part]
        return cur

    def all(self) -> dict[str, Any]:
        return copy.deepcopy(self._data)

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        self._data = _deep_merge(self._data, patch)
        self.save()
        return self.all()

    def sanitized(self) -> dict[str, Any]:
        """Settings with secrets masked - used by the Config tab and support bundles."""
        data = self.all()
        for k in SECRET_KEYS:
            if data["model"].get(k):
                data["model"][k] = "********"
        return data


settings = Settings()
