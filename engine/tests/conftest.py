import os
import sys
import tempfile
from pathlib import Path

# Isolate every test run in a throwaway data dir, in demo mode (no AWS calls).
os.environ["MENTOR_HOME"] = tempfile.mkdtemp(prefix="mentor-test-")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mentor_engine.config import settings  # noqa: E402

settings.update({"model": {"provider": "demo"}, "user": {"timezone": "Europe/London"}})
