import asyncio
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from mentor_engine import ingest, scheduler, security
from mentor_engine.app import app
from mentor_engine.config import settings
from mentor_engine.mcp_manager import mcp
from mentor_engine.tools.system import safe_eval

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def chat(client, session_id, text, approve=True, **extra):
    events = []
    with client.websocket_connect("/ws/chat") as ws:
        ws.send_text(json.dumps({"type": "chat", "session_id": session_id, "text": text, **extra}))
        while True:
            m = json.loads(ws.receive_text())
            events.append(m)
            if m["type"] == "approval_request":
                ws.send_text(json.dumps({"type": "approval", "approval_id": m["approval_id"], "approved": approve}))
            if m["type"] == "done":
                return events


# ---- pure functions --------------------------------------------------------
@pytest.mark.parametrize(
    "text,cron",
    [
        ("weekdays at 2pm", "0 14 * * 1-5"),
        ("every monday at 9:30am", "30 9 * * 1"),
        ("daily at 8am", "0 8 * * *"),
        ("every hour", "0 * * * *"),
        ("every 15 minutes", "*/15 * * * *"),
        ("fridays at 4pm", "0 16 * * 5"),
        ("1st of every month at 9am", "0 9 1 * *"),
        ("0 8 * * 1-5", "0 8 * * 1-5"),
    ],
)
def test_parse_schedule(text, cron):
    assert scheduler.parse_schedule(text) == cron


def test_parse_schedule_rejects_nonsense():
    with pytest.raises(ValueError):
        scheduler.parse_schedule("whenever you feel like it")


def test_chunking_overlaps_and_bounds():
    text = "\n\n".join(f"Paragraph {i} " + "word " * 80 for i in range(30))
    chunks = ingest.chunk_text(text, size=1000, overlap=100)
    assert len(chunks) > 5
    assert all(len(c) <= 1200 for c in chunks)


def test_exec_safety():
    assert security.exec_check("rm -rf / --no-preserve-root")[0] == "deny"
    assert security.exec_check("git status")[0] == "allow"
    assert security.exec_check("curl example.com")[0] == "ask"


def test_tool_policy_modes():
    assert security.tool_policy("web_search", "low") == "allow"
    assert security.tool_policy("write_file", "high") == "ask"
    assert security.tool_policy("calendar_create", "medium") == "allow"


def test_calculator():
    assert safe_eval("(1250000*0.18)/12") == 18750
    with pytest.raises(Exception):
        safe_eval("__import__('os').system('echo hi')")


# ---- API ------------------------------------------------------------------
def test_health_and_tools(client):
    assert client.get("/api/health").json()["ok"]
    tools = client.get("/api/tools").json()
    assert tools["total"] >= 40


def test_chat_tool_loop_and_memory(client):
    s = client.post("/api/sessions", json={}).json()
    events = chat(client, s["id"], "what time is it?")
    kinds = [e["type"] for e in events]
    assert "tool_start" in kinds and "tool_end" in kinds and kinds[-1] == "done"
    events = chat(client, s["id"], "remember I always want UK English")
    assert any(e["type"] == "tool_end" and e["ok"] for e in events)
    mems = client.get("/api/memory", params={"q": "UK English spelling"}).json()
    assert any("UK English" in m["text"] for m in mems)
    full = client.get(f"/api/sessions/{s['id']}").json()
    assert full["title"].startswith("what time")
    assert len(full["messages"]) >= 6


def test_projects_mentions_and_retrieval(client):
    p = client.post("/api/projects", json={"name": "Project Atlas", "template": "due_diligence"}).json()
    assert p["sections"]
    client.post(f"/api/projects/{p['id']}/files", files={"file": ("findings.md", b"# Findings\n\nThe target's EBITDA margin fell to 12% in FY25 due to freight costs.")})
    s = client.post("/api/sessions", json={}).json()
    events = chat(client, s["id"], "What happened to EBITDA margin?", mentions=[p["id"]])
    cites = [e for e in events if e["type"] == "citations"]
    assert cites and cites[0]["citations"][0]["source"] == "findings.md"


def test_knowledge_base(client):
    doc = client.post("/api/kb", files={"file": ("policy.txt", b"Travel policy: economy class for flights under 6 hours.")}).json()
    assert doc["status"] == "indexed" and doc["chunks"] == 1
    hits = client.get("/api/kb/search", params={"q": "flight class travel"}).json()
    assert hits and "economy" in hits[0]["text"]


def test_calendar_and_suggestions(client):
    e = client.post("/api/calendar", json={"title": "SteerCo", "start": "2026-10-14T15:00"}).json()
    assert e["end"] == "2026-10-14T16:00:00"
    from mentor_engine import calendar_store

    sug = calendar_store.add_suggestion({"title": "Draft report due", "start": "2026-10-20", "kind": "deadline"}, None)
    assert client.get("/api/calendar-suggestions").json()
    client.post(f"/api/calendar-suggestions/{sug['id']}", json={"approve": True})
    titles = [x["title"] for x in client.get("/api/calendar").json()]
    assert "Draft report due" in titles


def test_tasks_and_agents(client):
    t = client.post("/api/tasks", json={"prompt": "what time is it", "schedule": "weekdays at 8am"}).json()
    assert t["cron"] == "0 8 * * 1-5"
    run = client.post(f"/api/tasks/{t['id']}/run").json()
    assert run["status"] == "ok" and "get_datetime" in run["tools_used"]
    a = client.post("/api/agents", json={"name": "Timekeeper", "description": "Tells the time", "tools": ["get_datetime"]}).json()
    assert "Timekeeper" in a["system_prompt"]
    exported = client.get(f"/api/agents/{a['id']}/export").json()
    imported = client.post("/api/agents/import", json=exported).json()
    assert imported["id"] != a["id"] and imported["name"] == "Timekeeper"
    run = client.post(f"/api/agents/{a['id']}/run", json={"input": "what time is it"}).json()
    assert run["status"] == "ok"


def test_marketplace_install_remove(client):
    pkg = client.post("/api/marketplace/pkg_proposal/install").json()
    assert pkg["stage"] == "imported" and pkg["components"]["agents"]
    agents = client.get("/api/agents").json()
    assert any(a["name"] == "Proposal Writer" for a in agents)
    pkg = client.post("/api/packages/pkg_proposal/remove").json()
    assert pkg["stage"] == "installed"
    assert not any(a["name"] == "Proposal Writer" for a in client.get("/api/agents").json())


def test_prompts_builtin_locked(client):
    prompts = client.get("/api/prompts").json()
    builtin = next(p for p in prompts if p["builtin"])
    assert client.patch(f"/api/prompts/{builtin['id']}", json={"content": "x"}).status_code == 403
    assert client.patch(f"/api/prompts/{builtin['id']}", json={"favorite": True}).status_code == 200


def test_presentation_export_roundtrip(client):
    deck = client.post("/api/decks", json={"title": "Q3 Status", "slides": [
        {"layout": "title", "title": "Q3 Status", "subtitle": "Steering committee"},
        {"layout": "bullets", "title": "Progress", "bullets": ["Phase 1 complete", "Phase 2 on track"], "notes": "Mention budget"},
        {"layout": "two_column", "title": "Risks vs mitigations", "bullets": ["Data access"], "right": ["Escalate to CIO"]},
    ]}).json()
    art = client.post(f"/api/decks/{deck['id']}/export").json()
    assert art["name"].endswith(".pptx")
    data = Path(art["path"]).read_bytes()
    back = client.post("/api/decks/import", files={"file": ("q3.pptx", data)}).json()
    assert len(back["slides"]) == 3 and back["slides"][1]["notes"] == "Mention budget"


def test_docx_tool():
    from mentor_engine.tools import ToolContext
    from mentor_engine.tools.documents import create_docx

    ctx = ToolContext()
    out = asyncio.run(create_docx({"title": "Memo", "markdown": "# Intro\n\n- **Point** one\n\n| a | b |\n|---|---|\n| 1 | 2 |"}, ctx))
    assert "Memo.docx" in out and ctx.created_artifacts


def test_folder_access_control(client, tmp_path):
    (tmp_path / "notes.md").write_text("Client prefers monthly invoicing.")
    f = client.post("/api/folders", json={"path": str(tmp_path), "access": "read", "surface": "none"}).json()
    from mentor_engine.knowledge import resolve_allowed

    assert resolve_allowed(str(tmp_path / "notes.md"))
    with pytest.raises(PermissionError):
        resolve_allowed(str(tmp_path / "notes.md"), write=True)
    with pytest.raises(PermissionError):
        resolve_allowed("/etc/passwd")
    files = client.get(f"/api/folders/{f['id']}/files").json()
    assert files[0]["status"] == "new"


def test_mcp_stdio_server(client):
    cfg = {"command": sys.executable, "args": [str(FIXTURES / "echo_mcp_server.py")]}
    info = client.post("/api/mcp/servers", json={"name": "echo", "config": cfg}).json()
    assert info["status"] == "online", info
    tools = client.get("/api/tools").json()
    assert any(t["name"] == "echo__echo" for t in tools["mcp"])
    assert client.delete("/api/mcp/servers/echo").json()["deleted"]


def test_install_command_parsing():
    assert mcp.parse_install_command("install slack")[0] == "slack"
    name, cfg = mcp.parse_install_command("npx @acme/mcp-server-crm --region eu")
    assert cfg["command"] == "npx" and cfg["args"][-2:] == ["--region", "eu"]
    name, cfg = mcp.parse_install_command("uvx mcp-server-time")
    assert cfg == {"command": "uvx", "args": ["mcp-server-time"]}


def test_support_bundle_has_no_secrets(client):
    settings.update({"model": {"aws_secret_key": "SUPERSECRET"}})
    res = client.post("/api/diagnostics/bundle").json()
    import zipfile

    with zipfile.ZipFile(res["path"]) as z:
        assert "SUPERSECRET" not in z.read("config.json").decode()
    settings.update({"model": {"aws_secret_key": ""}})
