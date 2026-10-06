// Module 6 — Continuous Improvement (Lessons 18–21)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering-p/tree/main';

export default [
  {
    id: 'l18',
    num: 18,
    title: 'Prompt Optimisation',
    tagline: 'Prompt edits are code changes: measure against a baseline, ship the winner with a run_id.',
    minutes: 50,
    repo: `${REPO}/lesson18/aiam-day18`,
    summary: `
      Prompt editing becomes a controlled loop. **Candidates** (few-shot, chain-of-thought, format-spec) are scored against a fixed eval suite,
      a winner is selected only if it **beats the baseline**, losers are **archived** (never deleted), and every run gets a \`run_id\`
      that PRs and commits cite as evidence: \`72% → 81% [eval/<run_id>]\`.
    `,
    build: [
      '`PromptCandidate` objects with IDs instead of free-text diffs',
      'A deterministic harness that scores each candidate on a golden suite',
      '`PromptOptimiser.run()` with a minimum-improvement gate',
      'An audit record: baseline, winner, improvement_pp, archived losers, run_id',
    ],
    problem: `
      Lesson 17 prepared data for weight changes, but prompts still dominate accuracy and change constantly.
      Silent production prompt edits ship invisible regressions. This applies the same evidence bar used for model changes.
    `,
    flow: [
      ['Baseline', 'current production prompt'],
      ['Candidates', 'few-shot, CoT, format-spec …'],
      ['Harness', 'score each on the fixed suite'],
      ['Gate', 'winner must beat baseline by ≥ min_pp'],
      ['Audit', 'run_id, deltas, archived losers'],
    ],
    concepts: [
      ['Candidates as objects', 'Each variant has an ID and strategy. You compare objects with results, not prose diffs in a chat thread.'],
      ['Baseline gating', 'A candidate ships only if it beats the baseline pass rate (often by a team threshold). Otherwise keep the baseline.'],
      ['Harness separated from generation', 'Scoring is a pure function of outputs, so CI is deterministic. Swap the stub for real LLM scoring at the boundary, not in the UI.'],
      ['Archive losers', 'Failed candidates are evidence. Deleting them means rediscovering the same dead ends next quarter.'],
      ['run_id everywhere', 'Commit messages and PRs cite `run_id`, so rollbacks and reviews point at data.'],
    ],
    insights: [
      '**Measure before merge.**',
      '**Ties go to the baseline.** Change has a cost; do not churn production for zero gain.',
      'Run optimisation weekly even without a change request; drift happens anyway.',
    ],
    pitfalls: ['Editing prod prompts directly.', 'Picking a winner that only ties the baseline.', 'Deleting failed candidates.'],
    examples: [
      ['Support bot stuck at ~70%', 'Weekly optimiser promotes a few-shot candidate to 81% with PR evidence `72% → 81% [eval/<run_id>]`.'],
      ['Regulated assistant', 'Format-spec candidates fail schema gates and are archived; baseline is retained until one clears accuracy and format.'],
    ],
    labs: [
      {
        id: 'l18-optimiser',
        title: 'Gated prompt optimiser with audit trail',
        minutes: 25,
        goal: 'Implement `PromptOptimiser.run()` so only real improvements ship and every loser is archived.',
        steps: [
          'Score the baseline and every candidate with `self.harness.score(candidate, suite)` (returns a pass rate 0–1).',
          'Pick the best candidate by pass rate (first one wins ties among candidates).',
          '`improvement_pp = round((best - baseline) * 100, 1)`. If `improvement_pp >= min_pp` → winner = best, `deployed=True`; else winner = baseline, `deployed=False`.',
          'Every candidate that is not the winner goes into `archived` (list of IDs). The baseline is never archived.',
          'Return an `OptimisationRun` with `run_id` from `self.new_id()`, the baseline/winner IDs, rates and improvement. Append it to `self.history`.',
        ],
        hints: ['`max(candidates, key=lambda c: scores[c.id])` returns the first max on ties.', 'Store scores in a dict keyed by candidate ID.'],
        starter: py`
import itertools
from dataclasses import dataclass, field

@dataclass
class PromptCandidate:
    id: str
    strategy: str
    text: str

@dataclass
class OptimisationRun:
    run_id: str
    baseline_id: str
    winner_id: str
    baseline_rate: float
    winner_rate: float
    improvement_pp: float
    deployed: bool
    archived: list = field(default_factory=list)

class StubHarness:
    """Deterministic scores per strategy (a real harness would call the model)."""
    TABLE = {"baseline": 0.72, "few_shot": 0.81, "chain_of_thought": 0.78, "format_spec": 0.69}
    def score(self, candidate, suite):
        return self.TABLE.get(candidate.strategy, 0.5)

class PromptOptimiser:
    def __init__(self, harness=None, min_pp=3.0):
        self.harness = harness or StubHarness()
        self.min_pp = min_pp
        self.history = []
        self._ids = itertools.count(1)

    def new_id(self):
        return f"run-{next(self._ids):04d}"

    def run(self, baseline, candidates, suite=()):
        raise NotImplementedError


BASE = PromptCandidate("p0", "baseline", "Answer the question.")
CANDS = [
    PromptCandidate("p1", "few_shot", "Here are examples... Answer the question."),
    PromptCandidate("p2", "chain_of_thought", "Think step by step, then answer."),
    PromptCandidate("p3", "format_spec", "Answer in JSON with keys answer, sources."),
]

if __name__ == "__main__":
    r = PromptOptimiser().run(BASE, CANDS)
    print(f"{r.baseline_rate:.0%} -> {r.winner_rate:.0%} [{r.run_id}] deployed={r.deployed} archived={r.archived}")
`,
        solution: py`
import itertools
from dataclasses import dataclass, field

@dataclass
class PromptCandidate:
    id: str
    strategy: str
    text: str

@dataclass
class OptimisationRun:
    run_id: str
    baseline_id: str
    winner_id: str
    baseline_rate: float
    winner_rate: float
    improvement_pp: float
    deployed: bool
    archived: list = field(default_factory=list)

class StubHarness:
    """Deterministic scores per strategy (a real harness would call the model)."""
    TABLE = {"baseline": 0.72, "few_shot": 0.81, "chain_of_thought": 0.78, "format_spec": 0.69}
    def score(self, candidate, suite):
        return self.TABLE.get(candidate.strategy, 0.5)

class PromptOptimiser:
    def __init__(self, harness=None, min_pp=3.0):
        self.harness = harness or StubHarness()
        self.min_pp = min_pp
        self.history = []
        self._ids = itertools.count(1)

    def new_id(self):
        return f"run-{next(self._ids):04d}"

    def run(self, baseline, candidates, suite=()):
        base_rate = self.harness.score(baseline, suite)
        scores = {c.id: self.harness.score(c, suite) for c in candidates}
        best = max(candidates, key=lambda c: scores[c.id])
        improvement = round((scores[best.id] - base_rate) * 100, 1)
        deployed = improvement >= self.min_pp
        winner, winner_rate = (best, scores[best.id]) if deployed else (baseline, base_rate)
        run = OptimisationRun(
            run_id=self.new_id(),
            baseline_id=baseline.id,
            winner_id=winner.id,
            baseline_rate=base_rate,
            winner_rate=winner_rate,
            improvement_pp=improvement,
            deployed=deployed,
            archived=[c.id for c in candidates if c.id != winner.id],
        )
        self.history.append(run)
        return run


BASE = PromptCandidate("p0", "baseline", "Answer the question.")
CANDS = [
    PromptCandidate("p1", "few_shot", "Here are examples... Answer the question."),
    PromptCandidate("p2", "chain_of_thought", "Think step by step, then answer."),
    PromptCandidate("p3", "format_spec", "Answer in JSON with keys answer, sources."),
]

if __name__ == "__main__":
    r = PromptOptimiser().run(BASE, CANDS)
    print(f"{r.baseline_rate:.0%} -> {r.winner_rate:.0%} [{r.run_id}] deployed={r.deployed} archived={r.archived}")
`,
        tests: py`
def test_few_shot_wins():
    "few_shot wins with +9pp and losers are archived"
    r = PromptOptimiser().run(BASE, CANDS)
    assert r.winner_id == "p1" and r.deployed and r.improvement_pp == 9.0
    assert r.archived == ["p2", "p3"] and r.baseline_id == "p0"

def test_gate_keeps_baseline():
    "Below the gate, the baseline is retained and all candidates archived"
    r = PromptOptimiser(min_pp=10).run(BASE, CANDS)
    assert r.winner_id == "p0" and not r.deployed and r.winner_rate == 0.72
    assert r.archived == ["p1", "p2", "p3"]

def test_regression_never_ships():
    "A worse-only candidate set never ships"
    r = PromptOptimiser().run(BASE, [CANDS[2]])
    assert not r.deployed and r.improvement_pp == -3.0 and r.winner_id == "p0"

def test_run_ids_and_history():
    "Every run gets a unique run_id and is recorded"
    o = PromptOptimiser()
    a, b = o.run(BASE, CANDS), o.run(BASE, CANDS)
    assert a.run_id != b.run_id and o.history == [a, b]
`,
      },
    ],
    quiz: [
      { q: 'Best candidate scores 72.5% vs a 72% baseline, with a 3pp gate. What ships?', options: ['The candidate', 'The baseline; +0.5pp does not clear the gate', 'Both, A/B', 'Nothing runs'], answer: 1, why: 'Gates stop churn from noise-level "wins".' },
      { q: 'Why archive losing candidates instead of deleting them?', options: ['Disk is cheap', 'They are evidence; without them teams retry the same failed ideas', 'Compliance only', 'They might win later by luck'], answer: 1, why: 'Audit trails include what did not work.' },
      { q: 'What belongs in the PR description for a prompt change?', options: ['"Improved prompt"', 'Baseline → winner pass rate with the run_id', 'The full prompt only', 'A screenshot of one good reply'], answer: 1, why: 'Evidence makes review and rollback concrete.' },
    ],
    checklist: ['No ad-hoc production prompt edits', 'Fixed eval suite for every candidate', 'Improvement gate documented', 'run_id in commit/PR', 'Losers archived'],
  },

  {
    id: 'l19',
    num: 19,
    title: 'Multi-Agent Debate',
    tagline: 'Disagreement is an accuracy lever. Spend it only where the stakes justify the cost.',
    minutes: 55,
    repo: `${REPO}/lesson19/aiam-day19`,
    summary: `
      A **Generator** drafts, **N Critics** challenge it in parallel, and an **Arbiter** (at least as strong as the generator) synthesises the final answer.
      A **classifier** routes only high-stakes queries (medical, legal, financial, architecture) into debate; creative and trivial requests stay single-agent.
      Metrics report accuracy gain next to the **cost multiplier** (1 + N + 1 calls) and latency.
    `,
    build: [
      '`QueryClassifier` for cost-aware routing (debate vs skip)',
      '`DebateEngine` with parallel critics via `asyncio.gather` and an arbiter',
      'Cost multiplier and wall-clock accounting per answer',
      'Mixed-suite metrics that do not zero out accuracy on skip routes',
    ],
    problem: `
      Single-agent drafts miss omissions and weak claims that structured disagreement catches.
      But debating every query multiplies spend. Routing plus measurement turns debate into a controlled budget, not a default.
    `,
    flow: [
      ['Query', 'POST /debate'],
      ['Classify', 'high-stakes? → debate, else single agent'],
      ['Generate', 'draft answer (1 call)'],
      ['Critique ×N', 'parallel critics (N calls, ~1 hop latency)'],
      ['Arbitrate', 'synthesise final (1 call) → metrics + audit'],
    ],
    concepts: [
      ['Route before you spend', 'Debate on creative copy wastes money and flattens voice. Classify first; debate only labelled high-stakes routes.'],
      ['Parallel critics', 'Critics are independent, so gather them. Latency ≈ generator + one critic hop + arbiter, not N× sequential.'],
      ['Arbiter strength', 'The arbiter must be ≥ the generator, or it cannot overrule a weak draft.'],
      ['Cost multiplier is product data', '`1 + N + 1` calls. Report it beside the accuracy gain so the business can decide where it is worth it.'],
      ['Fail closed on high-stakes', 'If critics time out on a medical query, do not silently ship the unreviewed draft.'],
    ],
    insights: [
      '**Debate is an accuracy budget, not a default.** Over-routing burns margin; under-routing ships silent errors.',
      '**Sequential critics** multiply latency without adding independence. Gather them.',
      'Skip routes must not reset accuracy metrics after a mixed demo.',
    ],
    pitfalls: ['Debating every query.', 'A weaker arbiter than generator.', 'Sequential critic calls.'],
    examples: [
      ['Clinical decision support', 'Drug-interaction queries (e.g. SSRI + MAOI) go through debate before clinicians see them; FAQ stays single-agent.'],
      ['Architecture review', 'gRPC vs REST tradeoffs go through critics and an arbiter; creative copy skips debate to keep its voice.'],
    ],
    labs: [
      {
        id: 'l19-debate',
        title: 'Classifier-routed debate with parallel critics',
        minutes: 30,
        goal: 'Implement routing and the debate engine, with call counts and parallel critics.',
        steps: [
          '`QueryClassifier.classify(q)` → `"debate"` if any `HIGH_STAKES` keyword appears (case-insensitive) and no `CREATIVE` keyword does; else `"skip"`.',
          '`DebateEngine.answer(q)`: on `skip`, call `generate` once → `{"route": "skip", "answer", "calls": 1}`.',
          'On `debate`: `draft = await generate(q)`, then gather `critic(i, draft)` for `i in range(n_critics)`, then `final = await arbiter(q, draft, critiques)`.',
          'Return `{"route": "debate", "answer": final, "critiques": [...], "calls": 1 + n + 1, "cost_multiplier": 1 + n + 1}`.',
          'Critics must run concurrently (the test checks wall time).',
        ],
        hints: ['`await asyncio.gather(*[self.critic(i, draft) for i in range(self.n_critics)])`.', 'Check creative keywords first: "write a poem about medication" should skip.'],
        starter: py`
import asyncio

HIGH_STAKES = ["dose", "medication", "contraindication", "legal", "contract", "lawsuit", "invest", "tax", "architecture", "security"]
CREATIVE = ["poem", "story", "slogan", "joke", "tagline"]

class QueryClassifier:
    def classify(self, query):
        raise NotImplementedError

class DebateEngine:
    def __init__(self, n_critics=3, delay=0.05):
        self.n_critics, self.delay = n_critics, delay
        self.classifier = QueryClassifier()

    async def generate(self, q):
        await asyncio.sleep(self.delay)
        return f"Draft answer to: {q}"

    async def critic(self, i, draft):
        await asyncio.sleep(self.delay)
        return f"Critic {i}: missing caveats in '{draft[:30]}'"

    async def arbiter(self, q, draft, critiques):
        await asyncio.sleep(self.delay)
        return f"Final (addressed {len(critiques)} critiques): {draft}"

    async def answer(self, query):
        raise NotImplementedError


if __name__ == "__main__":
    eng = DebateEngine()
    for q in ["Max safe dose of ibuprofen with an SSRI medication?", "Write a poem about spring"]:
        r = await eng.answer(q)
        print(r["route"], r["calls"], "calls ->", r["answer"][:60])
`,
        solution: py`
import asyncio

HIGH_STAKES = ["dose", "medication", "contraindication", "legal", "contract", "lawsuit", "invest", "tax", "architecture", "security"]
CREATIVE = ["poem", "story", "slogan", "joke", "tagline"]

class QueryClassifier:
    def classify(self, query):
        q = query.lower()
        if any(k in q for k in CREATIVE):
            return "skip"
        return "debate" if any(k in q for k in HIGH_STAKES) else "skip"

class DebateEngine:
    def __init__(self, n_critics=3, delay=0.05):
        self.n_critics, self.delay = n_critics, delay
        self.classifier = QueryClassifier()

    async def generate(self, q):
        await asyncio.sleep(self.delay)
        return f"Draft answer to: {q}"

    async def critic(self, i, draft):
        await asyncio.sleep(self.delay)
        return f"Critic {i}: missing caveats in '{draft[:30]}'"

    async def arbiter(self, q, draft, critiques):
        await asyncio.sleep(self.delay)
        return f"Final (addressed {len(critiques)} critiques): {draft}"

    async def answer(self, query):
        if self.classifier.classify(query) == "skip":
            return {"route": "skip", "answer": await self.generate(query), "calls": 1}
        draft = await self.generate(query)
        critiques = await asyncio.gather(*[self.critic(i, draft) for i in range(self.n_critics)])
        final = await self.arbiter(query, draft, list(critiques))
        calls = 1 + self.n_critics + 1
        return {"route": "debate", "answer": final, "critiques": list(critiques), "calls": calls, "cost_multiplier": calls}


if __name__ == "__main__":
    eng = DebateEngine()
    for q in ["Max safe dose of ibuprofen with an SSRI medication?", "Write a poem about spring"]:
        r = await eng.answer(q)
        print(r["route"], r["calls"], "calls ->", r["answer"][:60])
`,
        tests: py`
import time

def test_classifier():
    "High-stakes debate, creative and trivial skip"
    c = QueryClassifier()
    assert c.classify("Is this CONTRACT clause legal?") == "debate"
    assert c.classify("Write a poem about medication") == "skip"
    assert c.classify("What time is it in Tokyo?") == "skip"

async def test_skip_is_single_call():
    "Skip route uses one call"
    r = await DebateEngine().answer("tell me a joke")
    assert r["route"] == "skip" and r["calls"] == 1

async def test_debate_calls_and_critiques():
    "Debate makes 1 + N + 1 calls"
    r = await DebateEngine(n_critics=4, delay=0.01).answer("tax implications of this investment?")
    assert r["route"] == "debate" and r["calls"] == 6 and r["cost_multiplier"] == 6
    assert len(r["critiques"]) == 4 and r["answer"].startswith("Final (addressed 4")

async def test_critics_run_in_parallel():
    "Critics overlap (wall ≈ 3 hops, not 2 + N)"
    eng = DebateEngine(n_critics=5, delay=0.05)
    t0 = time.perf_counter()
    await eng.answer("security architecture review for our API")
    ms = (time.perf_counter() - t0) * 1000
    assert ms < 260, f"{ms:.0f} ms: critics look sequential"
`,
      },
    ],
    quiz: [
      { q: 'With 3 critics, how many model calls does one debated answer cost?', options: ['3', '4', '5 (1 generator + 3 critics + 1 arbiter)', '9'], answer: 2, why: 'Report this multiplier next to the accuracy gain.' },
      { q: 'Why must the arbiter be at least as strong as the generator?', options: ['Billing rules', 'A weaker arbiter cannot reliably overrule a flawed draft', 'Latency', 'It is not required'], answer: 1, why: 'Synthesis quality is capped by the arbiter.' },
      { q: '"Write a slogan for our tax software" should be…', options: ['Debated: it mentions tax', 'Skipped: creative work gains little from debate and loses voice', 'Rejected', 'Sent to humans'], answer: 1, why: 'Route by task type, not keywords alone; creative intent wins.' },
    ],
    checklist: ['Debate only on labelled high-stakes routes', 'Cost multiplier documented beside accuracy gain', 'Arbiter ≥ generator strength', 'Critics run in parallel with timeouts', 'Fail closed when critics fail on high-stakes routes'],
  },

  {
    id: 'l20',
    num: 20,
    title: 'Knowledge Graph Integration',
    tagline: 'Embeddings find similar text. Graphs answer exact relationship questions.',
    minutes: 50,
    repo: `${REPO}/lesson20/aiam-day20`,
    summary: `
      "Which tools did alice trigger, through which agents, and what did it cost?" is a **traversal**, not a similarity search.
      You build an operational knowledge graph of Users, Agents, Tools and AuditEvents, with **LIMIT-safe** queries,
      access chains sorted by cost, and **context injection** of recent tool usage into the system prompt.
    `,
    build: [
      '`record_tool_call(user, agent, tool, cost)` creating nodes and an AuditEvent edge',
      '`query_access_chain(user, limit)` aggregating calls and cost per tool, top spenders first',
      '`build_graph_context(user)` that turns the chain into a system-prompt snippet',
      'A memory backend for tests/demos; Neo4j behind the same interface in production',
    ],
    problem: `
      Lesson 19 produced debate audits. Security and support teams now ask relationship questions about who used what.
      Scanning logs or nearest-neighbour search cannot answer them exactly. A graph can, in one bounded query.
    `,
    flow: [
      ['Tool call', 'user → agent → tool, cost'],
      ['MERGE nodes', 'User, Agent, Tool (idempotent)'],
      ['CREATE edge', 'AuditEvent with cost + time'],
      ['Query', 'access chain, LIMIT n'],
      ['Inject', 'recent usage → system prompt'],
    ],
    concepts: [
      ['Structured retrieval', 'Graphs return exact edges ("alice → web_search, 3 calls, $0.12"). Vectors return similar text. Use both.'],
      ['Access chains', 'Aggregate calls and cost per tool per user. Spend and blast radius become visible.'],
      ['LIMIT every traversal', 'Open-ended graph walks on dense graphs are an outage waiting to happen. `LIMIT 100` is policy.'],
      ['Context injection', 'Prepending "user recently used X, Y" lets the model avoid redoing expensive work the user already paid for.'],
      ['Async writes, replica reads', 'Graph writes stay off the response path; agent reads go to replicas. Retention follows audit policy.'],
    ],
    insights: [
      '**Graphs complement vectors**; they do not replace them.',
      'Sort access chains by cost (then name) so the riskiest tools come first.',
      'Richer schemas improve auditability but raise write amplification.',
    ],
    pitfalls: ['Blocking the response on a graph write.', 'Unbounded Cypher traversals.', 'Treating audit JSON as non-sensitive.'],
    examples: [
      ['Enterprise agent audit', 'Security asks who triggered `database_read` in 30 days; the access chain answers without scanning logs.'],
      ['Support personalisation', 'Recent tool usage is injected as context so the model avoids re-running searches the user already paid for.'],
    ],
    labs: [
      {
        id: 'l20-graph',
        title: 'In-memory agent knowledge graph',
        minutes: 25,
        goal: 'Record tool calls as graph edges and answer access-chain questions with limits.',
        steps: [
          '`record_tool_call(user, agent, tool, cost)`: validate non-empty IDs and `0 <= cost <= 100` (else `ValueError`). Add nodes to `self.nodes[kind]` sets, append an event dict to `self.events`.',
          '`query_access_chain(user, limit=100)`: aggregate by tool → `{"tool", "calls", "total_cost", "agents": sorted list}`; round cost to 4 dp.',
          'Sort by `(-total_cost, tool)` and return at most `limit` rows. Unknown user → `[]`.',
          '`build_graph_context(user, top=3)`: `""` if no usage; else `"Recent tool usage for <user>: tool (N calls, $X.XXXX); ..."` for the top rows.',
        ],
        hints: ['A dict of dicts works: `chain.setdefault(tool, {...})`.', 'Format cost with `f"{c:.4f}"`.'],
        starter: py`
class MemoryGraph:
    def __init__(self):
        self.nodes = {"User": set(), "Agent": set(), "Tool": set()}
        self.events = []

    def record_tool_call(self, user, agent, tool, cost):
        raise NotImplementedError

    def query_access_chain(self, user, limit=100):
        raise NotImplementedError

    def build_graph_context(self, user, top=3):
        raise NotImplementedError


DEMO = [
    ("alice", "research_agent", "web_search", 0.04),
    ("alice", "research_agent", "web_search", 0.05),
    ("alice", "data_agent", "database_read", 0.20),
    ("alice", "research_agent", "summarise", 0.01),
    ("bob", "support_agent", "ticket_lookup", 0.02),
    ("bob", "support_agent", "web_search", 0.03),
    ("alice", "data_agent", "web_search", 0.03),
    ("bob", "data_agent", "database_read", 0.15),
]

if __name__ == "__main__":
    g = MemoryGraph()
    for e in DEMO:
        g.record_tool_call(*e)
    for row in g.query_access_chain("alice"):
        print(row)
    print(g.build_graph_context("alice"))
`,
        solution: py`
class MemoryGraph:
    def __init__(self):
        self.nodes = {"User": set(), "Agent": set(), "Tool": set()}
        self.events = []

    def record_tool_call(self, user, agent, tool, cost):
        if not (user and agent and tool):
            raise ValueError("user, agent and tool are required")
        if not 0 <= cost <= 100:
            raise ValueError("cost out of range")
        self.nodes["User"].add(user)
        self.nodes["Agent"].add(agent)
        self.nodes["Tool"].add(tool)
        self.events.append({"user": user, "agent": agent, "tool": tool, "cost": cost})

    def query_access_chain(self, user, limit=100):
        chain = {}
        for e in self.events:
            if e["user"] != user:
                continue
            row = chain.setdefault(e["tool"], {"tool": e["tool"], "calls": 0, "total_cost": 0.0, "agents": set()})
            row["calls"] += 1
            row["total_cost"] += e["cost"]
            row["agents"].add(e["agent"])
        rows = [{**r, "total_cost": round(r["total_cost"], 4), "agents": sorted(r["agents"])} for r in chain.values()]
        rows.sort(key=lambda r: (-r["total_cost"], r["tool"]))
        return rows[:limit]

    def build_graph_context(self, user, top=3):
        rows = self.query_access_chain(user, limit=top)
        if not rows:
            return ""
        parts = ["%s (%d calls, $%.4f)" % (r["tool"], r["calls"], r["total_cost"]) for r in rows]
        return f"Recent tool usage for {user}: " + "; ".join(parts)


DEMO = [
    ("alice", "research_agent", "web_search", 0.04),
    ("alice", "research_agent", "web_search", 0.05),
    ("alice", "data_agent", "database_read", 0.20),
    ("alice", "research_agent", "summarise", 0.01),
    ("bob", "support_agent", "ticket_lookup", 0.02),
    ("bob", "support_agent", "web_search", 0.03),
    ("alice", "data_agent", "web_search", 0.03),
    ("bob", "data_agent", "database_read", 0.15),
]

if __name__ == "__main__":
    g = MemoryGraph()
    for e in DEMO:
        g.record_tool_call(*e)
    for row in g.query_access_chain("alice"):
        print(row)
    print(g.build_graph_context("alice"))
`,
        tests: py`
def _g():
    g = MemoryGraph()
    for e in DEMO:
        g.record_tool_call(*e)
    return g

def test_nodes_and_events():
    "Eight events, deduplicated nodes"
    g = _g()
    assert len(g.events) == 8 and g.nodes["User"] == {"alice", "bob"}
    assert len(g.nodes["Tool"]) == 4

def test_access_chain_sorted_by_cost():
    "Alice's chain is aggregated and sorted by cost"
    rows = _g().query_access_chain("alice")
    assert [r["tool"] for r in rows] == ["database_read", "web_search", "summarise"]
    ws = rows[1]
    assert ws["calls"] == 3 and ws["total_cost"] == 0.12 and ws["agents"] == ["data_agent", "research_agent"]

def test_limit_and_unknown_user():
    "LIMIT is respected; unknown users return []"
    g = _g()
    assert len(g.query_access_chain("alice", limit=1)) == 1
    assert g.query_access_chain("mallory") == []

def test_context_injection():
    "Context lists top tools with counts and cost"
    ctx = _g().build_graph_context("alice")
    assert ctx.startswith("Recent tool usage for alice: database_read (1 calls, $0.2000)")
    assert "web_search (3 calls, $0.1200)" in ctx
    assert _g().build_graph_context("nobody") == ""

def test_validation():
    "Empty IDs and absurd costs are rejected"
    g = MemoryGraph()
    for args in [("", "a", "t", 1), ("u", "a", "t", -1), ("u", "a", "t", 1000)]:
        try:
            g.record_tool_call(*args)
            raise AssertionError(f"accepted {args}")
        except ValueError:
            pass
`,
      },
    ],
    quiz: [
      { q: '"Which users triggered database_read last month?" is best answered by…', options: ['Vector similarity search over logs', 'A bounded graph traversal over audit edges', 'Asking the LLM', 'A full log scan each time'], answer: 1, why: 'Exact relationship questions are what graphs are for.' },
      { q: 'Why `LIMIT` every graph query?', options: ['Style', 'Unbounded traversals on dense graphs can exhaust memory and take down the database', 'Neo4j requires it', 'For sorting'], answer: 1, why: 'Bound fan-out as policy, not as an afterthought.' },
      { q: 'Should the agent response wait for the graph write?', options: ['Yes, always', 'No: write asynchronously so audit storage never adds to response latency', 'Only for admins', 'Only on Fridays'], answer: 1, why: 'Keep writes off the hot path; read from replicas.' },
    ],
    checklist: ['Schema (node/edge types) documented', 'LIMIT on every traversal', 'Async writes off the response path', 'Replica reads for agent queries', 'Audit retention matches policy'],
  },

  {
    id: 'l21',
    num: 21,
    title: 'The Full LLMOps Pipeline',
    tagline: 'Traces become eval cases, candidates face a baseline, and only gated winners deploy.',
    minutes: 60,
    repo: `${REPO}/lesson21/aiam-day21`,
    summary: `
      Agents improve when the loop closes: **traces from real traffic** (PII redacted) become **eval cases**,
      candidates are measured against the **baseline**, and a winner deploys only past a **3-point improvement gate**.
      Every cycle writes an audit record keyed by \`run_id\`.
    `,
    build: [
      '`anonymise()` that redacts emails and phone numbers at ingestion',
      'A trace store → eval suite builder (dedupe, cap size)',
      '`run_cycle()`: baseline eval → candidates → A/B → deploy or hold',
      'Cycle metrics: traces, cases, deployments, no-change decisions',
    ],
    problem: `
      Notebook prompt edits do not scale or survive audit. Failures you never logged are failures you will ship again.
      This lesson wires Lessons 15, 18 and 20 into one repeatable, evidence-producing loop.
    `,
    flow: [
      ['Traces', 'production queries + outcomes'],
      ['Anonymise', 'redact emails/phones at ingestion'],
      ['Eval suite', 'dedupe, cap to top N'],
      ['A/B', 'baseline vs candidates on the same suite'],
      ['Gate', 'Δ > 3pp → deploy, else hold; audit run_id'],
    ],
    concepts: [
      ['Trace-driven eval', 'Production queries, not synthetic sets, define regression risk. Yesterday\'s incident becomes today\'s test case.'],
      ['Redact at ingestion', 'PII handling belongs where traces enter the pipeline, not after they land in object storage or training sets.'],
      ['Same suite for everyone', 'Baseline and candidates are scored on identical cases, so deltas compare like with like.'],
      ['Explicit gate in code', '`if improvement > IMPROVEMENT_THRESHOLD_PP: deploy()`. Operations can grep the constant; it is not policy prose.'],
      ['Audit every cycle', 'Deploy *and* hold decisions get a run_id, baseline, winner and delta. "No change" is also evidence.'],
    ],
    insights: [
      '**Closing the loop is a product decision encoded in software.**',
      'Stricter gates reduce churn but slow iteration. Choose deliberately.',
      'Trigger a cycle after every Sev-1 so incident traces become eval cases the same day.',
    ],
    pitfalls: ['Deploying every candidate that beats baseline by epsilon.', 'Redacting PII after storage.', 'Unbounded eval suites.'],
    examples: [
      ['Fintech support bot', 'Weekly cycles with account numbers redacted; only candidates with +4pp on compliance prompts reach canary.'],
      ['Developer copilot', 'Post-outage traces become same-day eval cases; nothing deploys until a candidate clears 3pp on tool-call accuracy.'],
    ],
    labs: [
      {
        id: 'l21-pipeline',
        title: 'Close the loop: traces → eval → gated deploy',
        minutes: 30,
        goal: 'Implement `anonymise()`, `build_suite()` and `LLMOpsPipeline.run_cycle()`.',
        steps: [
          '`anonymise(text)`: replace emails with `[EMAIL]` and phone numbers (e.g. `415-555-0199`, `(415) 555 0199`) with `[PHONE]`.',
          '`build_suite(traces, cap=50)`: anonymise each trace query, skip blanks, dedupe (keep first occurrence), cap at `cap`.',
          '`run_cycle(traces, baseline, candidates)`: suite → baseline rate → each candidate\'s rate (`self.score(name, suite)`) → best.',
          '`improvement = round((best_rate - base_rate) * 100, 1)`. Deploy (call `self.deployer(best)`) only if `improvement > 3.0`.',
          'Return `{"run_id", "cases", "baseline_rate", "winner", "improvement_pp", "deployed"}` (winner is baseline when held) and update `self.metrics`.',
        ],
        hints: ['Phone regex: `r"\\(?\\b\\d{3}\\)?[-.\\s]?\\d{3}[-.\\s]\\d{4}\\b"`.', 'Use a `seen` set to dedupe while preserving order.'],
        starter: py`
import re
import uuid

IMPROVEMENT_THRESHOLD_PP = 3.0

def anonymise(text):
    raise NotImplementedError

def build_suite(traces, cap=50):
    raise NotImplementedError

class LLMOpsPipeline:
    def __init__(self, score, deployer):
        self.score = score            # score(prompt_name, suite) -> pass rate
        self.deployer = deployer      # deployer(prompt_name)
        self.metrics = {"cycles": 0, "deployments": 0, "no_change": 0, "eval_cases": 0}

    def run_cycle(self, traces, baseline, candidates):
        raise NotImplementedError


TRACES = [
    "Refund for order 123, email me at jane@corp.com",
    "My phone is 415-555-0199, reset my password",
    "Refund for order 123, email me at jane@corp.com",
    "   ",
    "How do I export my data?",
]
RATES = {"v1": 0.72, "v2_fewshot": 0.78, "v3_cot": 0.74}

if __name__ == "__main__":
    deployed = []
    p = LLMOpsPipeline(lambda name, suite: RATES[name], deployed.append)
    print(build_suite(TRACES))
    print(p.run_cycle(TRACES, "v1", ["v2_fewshot", "v3_cot"]), deployed)
`,
        solution: py`
import re
import uuid

IMPROVEMENT_THRESHOLD_PP = 3.0
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
PHONE = re.compile(r"\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]\d{4}\b")

def anonymise(text):
    return PHONE.sub("[PHONE]", EMAIL.sub("[EMAIL]", text))

def build_suite(traces, cap=50):
    seen, suite = set(), []
    for t in traces:
        q = anonymise(t).strip()
        if q and q not in seen:
            seen.add(q)
            suite.append(q)
    return suite[:cap]

class LLMOpsPipeline:
    def __init__(self, score, deployer):
        self.score = score            # score(prompt_name, suite) -> pass rate
        self.deployer = deployer      # deployer(prompt_name)
        self.metrics = {"cycles": 0, "deployments": 0, "no_change": 0, "eval_cases": 0}

    def run_cycle(self, traces, baseline, candidates):
        suite = build_suite(traces)
        base_rate = self.score(baseline, suite)
        rates = {c: self.score(c, suite) for c in candidates}
        best = max(candidates, key=lambda c: rates[c])
        improvement = round((rates[best] - base_rate) * 100, 1)
        deployed = improvement > IMPROVEMENT_THRESHOLD_PP
        if deployed:
            self.deployer(best)
        self.metrics["cycles"] += 1
        self.metrics["eval_cases"] += len(suite)
        self.metrics["deployments" if deployed else "no_change"] += 1
        return {
            "run_id": uuid.uuid4().hex[:12],
            "cases": len(suite),
            "baseline_rate": base_rate,
            "winner": best if deployed else baseline,
            "improvement_pp": improvement,
            "deployed": deployed,
        }


TRACES = [
    "Refund for order 123, email me at jane@corp.com",
    "My phone is 415-555-0199, reset my password",
    "Refund for order 123, email me at jane@corp.com",
    "   ",
    "How do I export my data?",
]
RATES = {"v1": 0.72, "v2_fewshot": 0.78, "v3_cot": 0.74}

if __name__ == "__main__":
    deployed = []
    p = LLMOpsPipeline(lambda name, suite: RATES[name], deployed.append)
    print(build_suite(TRACES))
    print(p.run_cycle(TRACES, "v1", ["v2_fewshot", "v3_cot"]), deployed)
`,
        tests: py`
def test_anonymise():
    "Emails and phones are redacted"
    assert anonymise("mail a.b+c@x.co.uk now") == "mail [EMAIL] now"
    assert anonymise("call 415-555-0199 or (415) 555 0199") == "call [PHONE] or [PHONE]"
    assert anonymise("order 12345") == "order 12345"

def test_build_suite():
    "Suite is anonymised, deduped, non-blank and capped"
    s = build_suite(TRACES)
    assert len(s) == 3 and all("@" not in q and "555" not in q for q in s)
    assert build_suite([f"q{i}" for i in range(100)], cap=10) == [f"q{i}" for i in range(10)]

def test_deploys_past_gate():
    "+6pp deploys the best candidate"
    deployed = []
    p = LLMOpsPipeline(lambda n, s: RATES[n], deployed.append)
    r = p.run_cycle(TRACES, "v1", ["v2_fewshot", "v3_cot"])
    assert r["deployed"] and r["winner"] == "v2_fewshot" and r["improvement_pp"] == 6.0
    assert deployed == ["v2_fewshot"] and p.metrics["deployments"] == 1

def test_holds_below_gate():
    "+2pp holds the baseline and does not deploy"
    deployed = []
    p = LLMOpsPipeline(lambda n, s: RATES[n], deployed.append)
    r = p.run_cycle(TRACES, "v1", ["v3_cot"])
    assert not r["deployed"] and r["winner"] == "v1" and deployed == []
    assert p.metrics["no_change"] == 1 and p.metrics["eval_cases"] == 3

def test_exactly_threshold_holds():
    "Exactly +3.0pp does not deploy (strictly greater)"
    p = LLMOpsPipeline(lambda n, s: {"a": 0.70, "b": 0.73}[n], lambda n: None)
    assert not p.run_cycle(["x"], "a", ["b"])["deployed"]
`,
      },
    ],
    quiz: [
      { q: 'Where should PII redaction happen in the LLMOps loop?', options: ['After traces are stored, during analysis', 'At ingestion, before traces become eval cases or are stored', 'Only before deployment', 'Never: eval needs real data'], answer: 1, why: 'Every downstream copy inherits whatever you failed to redact upstream.' },
      { q: 'A cycle finds no candidate above the gate. What do you record?', options: ['Nothing', 'A "no change" decision with run_id, baseline rate and best delta', 'Deploy the best anyway', 'Delete the traces'], answer: 1, why: 'Hold decisions are evidence too.' },
      { q: 'Why build eval cases from production traces?', options: ['They are free', 'They reflect real failure modes; synthetic sets miss what users actually do', 'Graders prefer them', 'Faster scoring'], answer: 1, why: 'Real traffic defines real regression risk.' },
    ],
    checklist: ['PII redacted at trace ingestion', 'Eval suite capped and refreshed from logs', 'Improvement gate explicit in code', 'run_id on every cycle (deploy or hold)', 'Cycle triggered weekly and after Sev-1 incidents'],
  },
];
