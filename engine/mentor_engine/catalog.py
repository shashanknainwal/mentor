"""Built-in content: locked prompts, the capabilities marketplace, and cloud prompt samples.

Marketplace items are *packages* (managed by AIM, the package manager). A package
bundles any of: skills, SOPs, context packs, agents, and MCP connectors.

    install  -> package recorded (stage "installed")
    import   -> components composed into the user's library (stage "imported")
    remove   -> tears down composed agents/skills/context + disconnects its MCP servers
                (servers another imported package still needs are kept); the package
                stays installed so the row flips back to "Import".
"""

from __future__ import annotations

from typing import Any

BUILTIN_PROMPTS: list[dict[str, Any]] = [
    {"id": "bp_exec_summary", "name": "Executive summary", "category": "Writing", "tags": ["summary", "client"],
     "content": "Write an executive summary for a senior client audience: 5 bullets max, lead with the 'so what', quantify impact where the source allows, and end with a recommended next step."},
    {"id": "bp_email_pro", "name": "Professional email", "category": "Writing", "tags": ["email"],
     "content": "Draft a concise, warm, professional email. Clear subject line, purpose in the first sentence, explicit ask and deadline, no jargon."},
    {"id": "bp_meeting_notes", "name": "Meeting notes → actions", "category": "Productivity", "tags": ["meetings"],
     "content": "Turn these notes into: Decisions, Action items (owner, due date), Open questions, and a 3-line summary I can paste into Teams."},
    {"id": "bp_code_review", "name": "Code reviewer", "category": "Coding", "tags": ["code"],
     "content": "You are a meticulous code reviewer. Find bugs first (with line references), then security issues, then simplifications. Be specific; skip praise."},
    {"id": "bp_pyramid", "name": "Pyramid principle", "category": "Consulting", "tags": ["structure", "storyline"],
     "content": "Restructure this using the Minto pyramid principle: governing thought, 3 key lines (MECE), supporting evidence under each. Flag gaps in evidence."},
    {"id": "bp_risk_register", "name": "Risk register", "category": "Consulting", "tags": ["risk"],
     "content": "Produce a risk register table: Risk, Cause, Impact (H/M/L), Likelihood (H/M/L), Owner, Mitigation, Status. Sort by impact x likelihood."},
    {"id": "bp_swot", "name": "SWOT analysis", "category": "Strategy", "tags": ["strategy"],
     "content": "Produce a SWOT analysis as a 2x2 table, then the 3 most important strategic implications with 'so what' for the client."},
    {"id": "bp_data_analyst", "name": "Data analyst", "category": "Data", "tags": ["data", "charts"],
     "content": "Act as a data analyst. Profile the data first, state assumptions, then answer with a table and a chart (use create_chart). Call out data-quality issues."},
    {"id": "bp_plain_english", "name": "Plain English rewrite", "category": "Writing", "tags": ["editing"],
     "content": "Rewrite in plain English for a non-specialist executive. Short sentences, active voice, no acronyms without expansion. Keep all facts."},
    {"id": "bp_interview_guide", "name": "Stakeholder interview guide", "category": "Consulting", "tags": ["interviews"],
     "content": "Create a 45-minute stakeholder interview guide: objectives, warm-up, 8-10 open questions grouped by theme, probes, and a closing question."},
]

CLOUD_PROMPTS_SAMPLE: list[dict[str, Any]] = [
    {"id": "cp_rfp_triage", "name": "RFP triage", "category": "Pursuits", "tags": ["rfp"], "author": "Advisory Pursuits",
     "content": "Triage this RFP: scope summary, evaluation criteria and weights, mandatory requirements, red flags, bid/no-bid considerations, and questions for the client."},
    {"id": "cp_dd_request", "name": "DD information request list", "category": "Deal Advisory", "tags": ["due diligence"], "author": "Deal Advisory",
     "content": "Draft a due diligence information request list grouped by workstream (financial, commercial, operational, tax, people, IT), each with priority and rationale."},
    {"id": "cp_board_paper", "name": "Board paper", "category": "Governance", "tags": ["board"], "author": "Risk Advisory",
     "content": "Draft a board paper: Purpose, Background, Options (with pros/cons), Recommendation, Risks, Decision required. Max 2 pages."},
]

MARKETPLACE: list[dict[str, Any]] = [
    {
        "id": "pkg_meeting_prep",
        "name": "Client Meeting Prep",
        "kind": "skill",
        "author": "Mentor Team",
        "version": "1.2.0",
        "description": "Builds a one-page brief before a client meeting: attendees, agenda, context, talking points, risks.",
        "advisory": {"risk": "low", "notes": "Uses web search and your calendar. No data leaves your machine except model calls."},
        "skills": [{
            "name": "Client Meeting Prep", "kind": "skill",
            "description": "One-page brief before a client meeting.",
            "instructions": "Produce a one-page meeting brief. Gather: meeting purpose, attendees (use person_lookup and memory), latest client news (web_search, last 90 days), "
                            "open items from related projects (project_search). Output sections: Objective, Attendees & what they care about, Context, Talking points (5), "
                            "Questions to ask, Risks / sensitivities. Offer to save it as a Word doc.",
        }],
    },
    {
        "id": "pkg_dd_sop",
        "name": "Due Diligence Kick-off SOP",
        "kind": "sop",
        "author": "Deal Advisory",
        "version": "2.0.1",
        "description": "Step-by-step playbook to stand up a DD workstream: scope, request list, data room index, findings log.",
        "advisory": {"risk": "low", "notes": "Creates local files and calendar items only."},
        "skills": [{
            "name": "DD Kick-off", "kind": "sop",
            "description": "Stand up a due diligence workstream.",
            "instructions": "You are running a due diligence kick-off with the user. Keep outputs evidence-led.",
            "steps": [
                "Confirm target, deal type, DD scope (financial/commercial/operational/tax/IT) and deadline with the user.",
                "Create a project for the deal if one doesn't exist (tell the user to use the Due Diligence template).",
                "Draft the information request list grouped by workstream, with priority; save it as an Excel file.",
                "Draft a data room index structure and a findings log template (Excel).",
                "Propose key milestones and add them to the calendar as deadlines after the user confirms.",
                "Summarise what was created and the next three actions.",
            ],
        }],
    },
    {
        "id": "pkg_proposal",
        "name": "Proposal Writer",
        "kind": "agent",
        "author": "Advisory Pursuits",
        "version": "1.0.0",
        "description": "An agent that turns an RFP into win themes, a solution outline and a draft proposal document.",
        "advisory": {"risk": "low", "notes": "Reads attached RFPs; writes Word documents to Artifacts."},
        "skills": [{
            "name": "Win Themes", "kind": "skill", "description": "Derive 3-4 win themes from client needs.",
            "instructions": "Derive 3-4 win themes. Each: client need (with evidence from the RFP), our response, proof point (only verifiable ones), differentiator.",
        }],
        "agents": [{
            "name": "Proposal Writer",
            "description": "Turns RFPs into proposals.",
            "system_prompt": "You are a senior bid manager in KPMG Advisory. Read the RFP carefully. Always: 1) triage requirements, 2) derive win themes, "
                             "3) outline the solution and team, 4) draft the proposal in Word with create_docx. Never invent credentials or prices; leave [TBC] placeholders.",
            "personality": "Professional",
            "tools": ["web_search", "web_fetch", "read_document", "create_docx", "create_xlsx", "knowledge_search", "project_search", "memory_search"],
            "skills_by_name": ["Win Themes"],
        }],
    },
    {
        "id": "pkg_research",
        "name": "Research Assistant",
        "kind": "agent",
        "author": "Mentor Team",
        "version": "1.1.0",
        "description": "Searches the web, reads sources and writes a cited briefing in a fixed format.",
        "advisory": {"risk": "low", "notes": "Uses public web search."},
        "agents": [{
            "name": "Research Assistant",
            "description": "Cited web research briefings.",
            "system_prompt": "You research topics thoroughly. Run several web_search queries, read the best 3-5 sources with web_fetch, then write: "
                             "Key findings (bullets with [n] citations), Detail, Disagreements between sources, Sources (numbered URLs). Prefer primary sources.",
            "personality": "Detailed",
            "tools": ["web_search", "web_fetch", "create_docx", "memory_search", "get_datetime"],
        }],
    },
    {
        "id": "pkg_status_report",
        "name": "Weekly Status Report",
        "kind": "skill",
        "author": "Mentor Team",
        "version": "1.0.0",
        "description": "RAG status report from project files, chats and calendar.",
        "advisory": {"risk": "low", "notes": "Read-only over your projects and calendar."},
        "skills": [{
            "name": "Weekly Status Report", "kind": "skill", "description": "RAG weekly status report.",
            "instructions": "Build a weekly status report: overall RAG with rationale, progress this week, plan next week, risks & issues (table), decisions needed, "
                            "upcoming deadlines (calendar_list 14 days). Use project_search for evidence. Offer to export to Word.",
        }],
    },
    {
        "id": "pkg_kpmg_style",
        "name": "KPMG Writing Style",
        "kind": "context",
        "author": "Brand & Comms",
        "version": "1.0.0",
        "description": "Context pack: house style for client-facing writing.",
        "advisory": {"risk": "low", "notes": "Instructions only."},
        "skills": [{
            "name": "KPMG Writing Style", "kind": "context", "description": "House style for client deliverables.",
            "instructions": "House style: UK English; sentence-case headings; numbers 1-9 in words, 10+ as numerals; avoid superlatives; "
                            "'KPMG' always capitalised; no unverifiable claims; executive summaries lead with implications; tables have a source line.",
        }],
    },
    {
        "id": "pkg_ms365",
        "name": "Microsoft 365 Connector",
        "kind": "connector",
        "author": "Community",
        "version": "0.9.0",
        "description": "Outlook mail & calendar, Teams and OneDrive via Microsoft Graph (MCP).",
        "advisory": {"risk": "medium", "notes": "Can read and send email on your behalf. Requires Node.js and an Entra ID sign-in. Approve sends individually."},
        "mcp": [{"name": "ms365", "config": {"command": "npx", "args": ["-y", "@softeria/ms-365-mcp-server"]}}],
    },
]
