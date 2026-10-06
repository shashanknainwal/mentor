// Module 3 — Reasoning & Orchestration (Lessons 8–11)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering-p/tree/main';

export default [
  {
    id: 'l08',
    num: 8,
    title: 'Multi-Agent Orchestration',
    tagline: 'A supervisor fans typed work out to specialist workers in parallel, and measures the speedup.',
    minutes: 55,
    repo: `${REPO}/lesson8/aiam-day08`,
    summary: `
      Single-agent pipelines waste wall time when research, writing and summarising could overlap.
      A **supervisor** routes typed tasks to **specialist workers**, runs the batch concurrently, and records
      parallel wall-clock vs the serial estimate so speedup is *evidence*, not an assumption.
    `,
    build: [
      '`WorkerAgent`s per specialty (research, write, summarise)',
      '`SupervisorAgent.dispatch()`: route by type, run concurrently, keep result order',
      'Per-task failure isolation: one failure never blocks the batch',
      'Metrics: completed vs failed, per-type counts, `speedup = serial_estimate / parallel_wall`',
    ],
    problem: `
      Lesson 7 made code execution safe. Now multiple agents need to work at once without serialising every step,
      and without becoming ad-hoc threads with no shared metrics.
    `,
    flow: [
      ['Batch', 'tasks with id, type, payload'],
      ['Route', 'type → worker (unknown → summarise)'],
      ['Fan out', 'run all tasks concurrently'],
      ['Join', 'collect results in input order'],
      ['Record', 'completed / failed, wall vs serial, events'],
    ],
    concepts: [
      ['Supervisor owns routing, not logic', 'Workers stay thin specialists; the supervisor is a router. This keeps ownership and latency per specialty clear.'],
      ['Bounded parallelism', 'The reference uses `ThreadPoolExecutor(max_workers=len(tasks))`, intentionally sized to the batch. Unbounded pools overload downstream APIs.'],
      ['Speedup is measured', '`speedup = sum(task durations) / wall time`. Near 1.0 for a multi-task batch means something serialised by accident.'],
      ['Failure isolation', 'Record a failed task and keep going. In asyncio that is `gather(..., return_exceptions=True)`.'],
      ['In this browser lab', 'Pyodide has no threads, so the lab uses `asyncio.gather`. The orchestration contract (route, fan out, join, measure) is identical.'],
    ],
    insights: [
      '**Typed workers beat a generic agent pool** for latency and ownership.',
      '**Parallelism without metrics hides regressions.** Track speedup per batch.',
      'At scale, replace in-process concurrency with a queue/broker and idempotent task IDs.',
    ],
    pitfalls: ['Unbounded thread pools.', 'Shared mutable state across workers.', 'Treating speedup as a constant instead of a measured ratio.'],
    examples: [
      ['Research desk', 'Literature review, drafting and summary run on three pools; operators watch speedup before raising concurrency.'],
      ['Incident copilot', 'Log summarisation and timeline writing run in parallel; one failure does not block the other.'],
    ],
    labs: [
      {
        id: 'l08-supervisor',
        title: 'Async supervisor with speedup metrics',
        minutes: 25,
        goal: 'Implement `SupervisorAgent.dispatch(tasks)` with concurrent fan-out, failure isolation and measured speedup.',
        steps: [
          'Empty batch → `ValueError`.',
          'Route each task by `task["type"]`; unknown types fall back to the `"summarise"` worker.',
          'Run all tasks concurrently with `asyncio.gather(..., return_exceptions=True)`.',
          'Return `{"results": [...], "completed": n, "failed": n, "parallel_ms": wall, "serial_ms": sum, "speedup": serial/parallel}`. Results stay in input order; failed tasks appear as `{"id", "ok": False, "error"}`.',
          'Each successful worker result is `{"id", "ok": True, "worker", "output", "ms"}` (already produced by `WorkerAgent.run`).',
        ],
        hints: ['Measure wall time with `time.perf_counter()` around the gather.', '`serial_ms` = sum of `ms` from successful results.', 'Use `max(parallel_ms, 1e-6)` to avoid dividing by zero.'],
        starter: py`
import asyncio
import time

class WorkerAgent:
    def __init__(self, specialty, delay):
        self.specialty, self.delay = specialty, delay

    async def run(self, task):
        t0 = time.perf_counter()
        await asyncio.sleep(self.delay)          # simulated LLM/tool I/O
        if task["payload"] == "FAIL":
            raise RuntimeError("worker crashed")
        ms = (time.perf_counter() - t0) * 1000
        return {"id": task["id"], "ok": True, "worker": self.specialty,
                "output": f"[{self.specialty}] {task['payload']}", "ms": ms}

class SupervisorAgent:
    def __init__(self, delay=0.05):
        self.workers = {s: WorkerAgent(s, delay) for s in ("research", "write", "summarise")}

    async def dispatch(self, tasks):
        # TODO: validate, route, gather with return_exceptions, measure, return summary
        raise NotImplementedError


if __name__ == "__main__":
    tasks = [{"id": i, "type": t, "payload": f"topic {i}"}
             for i, t in enumerate(["research", "write", "summarise"] * 2)]
    r = await SupervisorAgent().dispatch(tasks)
    print(f"completed={r['completed']} speedup={r['speedup']:.1f}x")
`,
        solution: py`
import asyncio
import time

class WorkerAgent:
    def __init__(self, specialty, delay):
        self.specialty, self.delay = specialty, delay

    async def run(self, task):
        t0 = time.perf_counter()
        await asyncio.sleep(self.delay)          # simulated LLM/tool I/O
        if task["payload"] == "FAIL":
            raise RuntimeError("worker crashed")
        ms = (time.perf_counter() - t0) * 1000
        return {"id": task["id"], "ok": True, "worker": self.specialty,
                "output": f"[{self.specialty}] {task['payload']}", "ms": ms}

class SupervisorAgent:
    def __init__(self, delay=0.05):
        self.workers = {s: WorkerAgent(s, delay) for s in ("research", "write", "summarise")}

    async def dispatch(self, tasks):
        if not tasks:
            raise ValueError("empty batch")
        coros = [self.workers.get(t["type"], self.workers["summarise"]).run(t) for t in tasks]
        t0 = time.perf_counter()
        raw = await asyncio.gather(*coros, return_exceptions=True)
        parallel_ms = (time.perf_counter() - t0) * 1000
        results = []
        for task, r in zip(tasks, raw):
            if isinstance(r, Exception):
                results.append({"id": task["id"], "ok": False, "error": str(r)})
            else:
                results.append(r)
        ok = [r for r in results if r["ok"]]
        serial_ms = sum(r["ms"] for r in ok)
        return {
            "results": results,
            "completed": len(ok),
            "failed": len(results) - len(ok),
            "parallel_ms": parallel_ms,
            "serial_ms": serial_ms,
            "speedup": serial_ms / max(parallel_ms, 1e-6),
        }


if __name__ == "__main__":
    tasks = [{"id": i, "type": t, "payload": f"topic {i}"}
             for i, t in enumerate(["research", "write", "summarise"] * 2)]
    r = await SupervisorAgent().dispatch(tasks)
    print(f"completed={r['completed']} speedup={r['speedup']:.1f}x")
`,
        tests: py`
def _tasks(n=6):
    types = ["research", "write", "summarise"]
    return [{"id": i, "type": types[i % 3], "payload": f"p{i}"} for i in range(n)]

async def test_parallel_speedup():
    "Six tasks run concurrently (speedup > 3x)"
    r = await SupervisorAgent(delay=0.05).dispatch(_tasks())
    assert r["completed"] == 6 and r["failed"] == 0
    assert r["speedup"] > 3, r["speedup"]

async def test_order_and_routing():
    "Results keep input order and go to the right worker"
    r = await SupervisorAgent(delay=0.01).dispatch(_tasks(3))
    assert [x["id"] for x in r["results"]] == [0, 1, 2]
    assert [x["worker"] for x in r["results"]] == ["research", "write", "summarise"]

async def test_unknown_type_fallback():
    "Unknown types fall back to summarise"
    r = await SupervisorAgent(delay=0.01).dispatch([{"id": "x", "type": "poetry", "payload": "hi"}])
    assert r["results"][0]["worker"] == "summarise"

async def test_failure_isolated():
    "One failing task does not block the others"
    tasks = _tasks(3) + [{"id": 99, "type": "write", "payload": "FAIL"}]
    r = await SupervisorAgent(delay=0.01).dispatch(tasks)
    assert r["completed"] == 3 and r["failed"] == 1
    assert r["results"][-1] == {"id": 99, "ok": False, "error": "worker crashed"}

async def test_empty_batch_rejected():
    "Empty batch raises ValueError"
    try:
        await SupervisorAgent().dispatch([])
    except ValueError:
        return
    raise AssertionError("expected ValueError")
`,
      },
    ],
    quiz: [
      { q: 'A 6-task batch reports speedup ≈ 1.0. What does that suggest?', options: ['Perfect parallelism', 'Tasks are accidentally running serially (e.g. awaiting in a loop or a lock)', 'Workers are too fast', 'The metric is broken by design'], answer: 1, why: 'Independent tasks should overlap; ~1.0 means they did not.' },
      { q: 'What does the supervisor own?', options: ['Business logic for every specialty', 'Routing, fan-out, join and metrics', 'The LLM weights', 'The database schema'], answer: 1, why: 'Thin workers + a routing supervisor keeps responsibilities clear and testable.' },
      { q: 'Workers outgrow one host. What is the next step?', options: ['Bigger thread pool', 'A queue/broker with idempotent task IDs and dead-letter queues', 'Remove metrics', 'Run tasks serially'], answer: 1, why: 'Distributed workers need durable queues and idempotency for retries.' },
    ],
    checklist: ['Bounded concurrency per tenant', 'Typed task schemas with idempotent IDs', 'Failed tasks recorded without blocking the batch', 'Speedup and per-specialty latency exported', 'Authenticated /dispatch'],
  },

  {
    id: 'l09',
    num: 9,
    title: 'The ReAct Loop',
    tagline: 'Thought → Action → Observation, repeated until a Final Answer or the step limit.',
    minutes: 70,
    repo: `${REPO}/lesson9/aiam-day09`,
    summary: `
      **ReAct (Reason + Act)** alternates thoughts with tool calls until the agent answers or hits \`max_steps\`.
      Unlike one-shot prompting, every thought, action and observation is visible, so you can debug it.
      You build a strict action parser, an AST-safe calculator (no \`eval\`), tool dispatch and the bounded loop.
    `,
    build: [
      'A strict `Action: name[argument]` parser',
      '`safe_calculate()` that walks the AST and allows only numbers and arithmetic operators',
      'Tools: `search`, `calculate`, `lookup` behind a registry',
      '`ReActLoop.run()` with stopping reasons `final_answer` and `max_steps`',
    ],
    problem: `
      Lesson 8 ran independent work in parallel. Many questions need **sequential** grounding: look something up, then decide.
      Without a bounded, logged loop, agents either answer from guesswork or spin forever.
    `,
    flow: [
      ['Question', 'POST /run, max_steps'],
      ['Thought', 'planner (later: LLM) emits next step'],
      ['Parse', 'Action: name[arg] via strict regex'],
      ['Act', 'dispatch tool → observation'],
      ['Stop?', 'Final Answer → final_answer, else loop until max_steps'],
    ],
    concepts: [
      ['Visible reasoning', 'Each step records thought, action and observation. Debugging becomes reading a trace, not guessing.'],
      ['Strict parsing', '`Action:\\s*(\\w+)\\[(.+?)\\]`. Loose parsing lets malformed model output trigger the wrong tool.'],
      ['AST-only math', 'Never `eval()` model output. Parse with `ast.parse(mode="eval")` and evaluate only `Constant`, `BinOp`, `UnaryOp` with whitelisted operators.'],
      ['Stopping criteria', '`final_answer` when the thought contains "Final Answer:"; `max_steps` otherwise. Rising `max_steps_hits` is an alert.'],
      ['Planner is swappable', '`_plan_thought()` is a rule tree today and an LLM tomorrow. The action/observation contract and metrics stay the same.'],
    ],
    insights: [
      '**Quality comes from stopping criteria and tool grounding**, not longer prompts.',
      '**One demo question per tool.** A zero counter for a tool means a broken path.',
      'Unknown tools are skipped and observed as errors, never executed.',
    ],
    pitfalls: ['Using `eval()` for math.', 'Loose regexes that match half-formed actions.', 'No step limit.'],
    examples: [
      ['Support copilot', 'Searches docs, calculates SLA windows, looks up policy terms. Each step is logged for compliance.'],
      ['Analyst agent', 'Looks up definitions, runs safe arithmetic, and stops only when the Final Answer cites tool observations.'],
    ],
    labs: [
      {
        id: 'l09-calc',
        title: 'AST-safe calculator',
        minutes: 20,
        goal: 'Evaluate arithmetic from model output **without** `eval()`.',
        steps: [
          'Parse with `ast.parse(expr, mode="eval")`.',
          'Recursively evaluate: `ast.Expression` → its body; `ast.Constant` (int/float only); `ast.BinOp` with `+ - * / // % **`; `ast.UnaryOp` with `+ -`.',
          'Anything else (names, calls, attributes, strings) → `ValueError("unsupported")`.',
          'Guard `**`: exponents above 100 → `ValueError` (stops CPU bombs like `9**9**9`).',
        ],
        hints: ['Map node types to functions with the `operator` module: `{ast.Add: operator.add, ...}`.', '`isinstance(node.value, bool)` is also an int, so reject bools explicitly.'],
        starter: py`
import ast
import operator

BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod, ast.Pow: operator.pow,
}
UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}

def _eval(node):
    # TODO: Expression, Constant, BinOp, UnaryOp; else ValueError
    raise NotImplementedError

def safe_calculate(expr):
    return _eval(ast.parse(expr.strip(), mode="eval"))


if __name__ == "__main__":
    print(safe_calculate("17 * 34 + 88"))
`,
        solution: py`
import ast
import operator

BIN_OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod, ast.Pow: operator.pow,
}
UNARY_OPS = {ast.UAdd: operator.pos, ast.USub: operator.neg}

def _eval(node):
    if isinstance(node, ast.Expression):
        return _eval(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)) and not isinstance(node.value, bool):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in BIN_OPS:
        left, right = _eval(node.left), _eval(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large")
        return BIN_OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in UNARY_OPS:
        return UNARY_OPS[type(node.op)](_eval(node.operand))
    raise ValueError(f"unsupported: {type(node).__name__}")

def safe_calculate(expr):
    return _eval(ast.parse(expr.strip(), mode="eval"))


if __name__ == "__main__":
    print(safe_calculate("17 * 34 + 88"))
`,
        tests: py`
def test_basic_math():
    "Arithmetic works"
    assert safe_calculate("17 * 34 + 88") == 666
    assert safe_calculate("-(2 + 3) * 4") == -20
    assert safe_calculate("7 // 2 + 7 % 2 + 2 ** 3") == 12
    assert safe_calculate("1 / 4") == 0.25

def _rejects(expr):
    try:
        safe_calculate(expr)
    except (ValueError, SyntaxError):
        return True
    return False

def test_rejects_code():
    "Names, calls, attributes, strings are rejected"
    for bad in ["__import__('os')", "x + 1", "(1).__class__", "'a' * 3", "True + 1", "[1, 2]"]:
        assert _rejects(bad), bad

def test_rejects_power_bomb():
    "Huge exponents are rejected"
    assert _rejects("9 ** 9 ** 9")
`,
      },
      {
        id: 'l09-loop',
        title: 'The ReAct loop',
        minutes: 30,
        goal: 'Implement `parse_action()` and `ReActLoop.run()` with stopping reasons and a full step trace.',
        steps: [
          '`parse_action(thought)` returns `(name, arg)` using `ACTION_RE`, or `None`.',
          'In `run(question)`, loop up to `max_steps`: get `thought = self.plan(question, history)`.',
          'If the thought contains `"Final Answer:"`, return with the text after it, `stopped_reason="final_answer"`.',
          'Otherwise parse the action; known tool → observation = `TOOLS[name](arg)`; unknown/no action → observation `"error: unknown action"`.',
          'Append `{"thought", "action", "observation"}` to `history` each step. After the loop: `stopped_reason="max_steps"`, `answer=None`.',
        ],
        hints: ['`thought.split("Final Answer:", 1)[1].strip()`.', 'Catch exceptions from a tool and turn them into `"error: ..."` observations so the loop keeps going.'],
        starter: py`
import re

ACTION_RE = re.compile(r"Action:\s*(\w+)\[(.+?)\]")

KB = {
    "llm": "LLMs are transformer models trained to predict the next token.",
    "attention": "Attention lets each token weigh every other token when building its representation.",
}
TOOLS = {
    "search": lambda q: next((v for k, v in KB.items() if k in q.lower()), "no results"),
    "lookup": lambda term: KB.get(term.strip().lower(), "unknown term"),
    "calculate": lambda e: str(eval(e, {"__builtins__": {}})),  # use safe_calculate in real code
}

def rule_planner(question, history):
    """Stand-in for an LLM: pick a tool first, then answer from the observation."""
    if history:
        return f"I have what I need. Final Answer: {history[-1]['observation']}"
    q = question.lower()
    if "calculate" in q:
        return f"Thought: math. Action: calculate[{question.split('calculate', 1)[1].strip()}]"
    if "define" in q or "lookup" in q:
        return f"Thought: definition. Action: lookup[{q.split()[-1].strip('?')}]"
    return f"Thought: search. Action: search[{question}]"

def parse_action(thought):
    # TODO: return (name, arg) or None
    raise NotImplementedError

class ReActLoop:
    def __init__(self, plan=rule_planner, max_steps=5):
        self.plan, self.max_steps = plan, max_steps

    def run(self, question):
        history = []
        # TODO: loop; return {"answer", "steps": history, "stopped_reason"}
        raise NotImplementedError


if __name__ == "__main__":
    loop = ReActLoop()
    for q in ["What are LLMs?", "Please calculate 17 * 34 + 88", "Define attention"]:
        r = loop.run(q)
        print(r["stopped_reason"], "->", r["answer"])
`,
        solution: py`
import re

ACTION_RE = re.compile(r"Action:\s*(\w+)\[(.+?)\]")

KB = {
    "llm": "LLMs are transformer models trained to predict the next token.",
    "attention": "Attention lets each token weigh every other token when building its representation.",
}
TOOLS = {
    "search": lambda q: next((v for k, v in KB.items() if k in q.lower()), "no results"),
    "lookup": lambda term: KB.get(term.strip().lower(), "unknown term"),
    "calculate": lambda e: str(eval(e, {"__builtins__": {}})),  # use safe_calculate in real code
}

def rule_planner(question, history):
    """Stand-in for an LLM: pick a tool first, then answer from the observation."""
    if history:
        return f"I have what I need. Final Answer: {history[-1]['observation']}"
    q = question.lower()
    if "calculate" in q:
        return f"Thought: math. Action: calculate[{question.split('calculate', 1)[1].strip()}]"
    if "define" in q or "lookup" in q:
        return f"Thought: definition. Action: lookup[{q.split()[-1].strip('?')}]"
    return f"Thought: search. Action: search[{question}]"

def parse_action(thought):
    m = ACTION_RE.search(thought)
    return (m.group(1), m.group(2)) if m else None

class ReActLoop:
    def __init__(self, plan=rule_planner, max_steps=5):
        self.plan, self.max_steps = plan, max_steps

    def run(self, question):
        history = []
        for _ in range(self.max_steps):
            thought = self.plan(question, history)
            if "Final Answer:" in thought:
                answer = thought.split("Final Answer:", 1)[1].strip()
                return {"answer": answer, "steps": history, "stopped_reason": "final_answer"}
            action = parse_action(thought)
            if action and action[0] in TOOLS:
                try:
                    observation = TOOLS[action[0]](action[1])
                except Exception as e:
                    observation = f"error: {e}"
            else:
                observation = "error: unknown action"
            history.append({"thought": thought, "action": action, "observation": observation})
        return {"answer": None, "steps": history, "stopped_reason": "max_steps"}


if __name__ == "__main__":
    loop = ReActLoop()
    for q in ["What are LLMs?", "Please calculate 17 * 34 + 88", "Define attention"]:
        r = loop.run(q)
        print(r["stopped_reason"], "->", r["answer"])
`,
        tests: py`
def test_parse_action():
    "Strict action parsing"
    assert parse_action("Thought: x. Action: search[what is rag]") == ("search", "what is rag")
    assert parse_action("no action here") is None
    assert parse_action("Action: search(oops)") is None

def test_calculate_path():
    "calculate → observation 666 → final answer"
    r = ReActLoop().run("Please calculate 17 * 34 + 88")
    assert r["stopped_reason"] == "final_answer" and r["answer"] == "666"
    assert len(r["steps"]) == 1 and r["steps"][0]["action"][0] == "calculate"

def test_search_and_lookup_paths():
    "search and lookup ground the answer"
    loop = ReActLoop()
    assert "transformer" in loop.run("What are LLMs?")["answer"]
    assert "token" in loop.run("Define attention")["answer"]

def test_max_steps():
    "A planner that never finishes stops at max_steps"
    stubborn = lambda q, h: "Action: search[llm]"
    r = ReActLoop(plan=stubborn, max_steps=3).run("loop forever")
    assert r["stopped_reason"] == "max_steps" and r["answer"] is None and len(r["steps"]) == 3

def test_unknown_tool_not_executed():
    "Unknown tools are observed as errors"
    calls = iter(["Action: rm_rf[/]", "Final Answer: done"])
    r = ReActLoop(plan=lambda q, h: next(calls)).run("x")
    assert r["steps"][0]["observation"] == "error: unknown action" and r["answer"] == "done"

def test_tool_exception_becomes_observation():
    "Tool exceptions become observations"
    calls = iter(["Action: calculate[1/0]", "Final Answer: handled"])
    r = ReActLoop(plan=lambda q, h: next(calls)).run("x")
    assert r["steps"][0]["observation"].startswith("error:")
`,
      },
    ],
    quiz: [
      { q: 'Why is `max_steps` essential in a ReAct loop?', options: ['To reduce prompt size', 'Without it a confused planner can loop forever, burning tokens and time', 'It improves answer quality', 'Tools require it'], answer: 1, why: 'Bounded loops turn runaway agents into a measurable `max_steps` outcome.' },
      { q: 'The model outputs `Action: calculate[__import__("os").system("ls")]`. What protects you?', options: ['The regex', 'The AST-only evaluator rejects names and calls', 'The step limit', 'Nothing'], answer: 1, why: 'Only constants and whitelisted operators are evaluated; `Call` and `Name` nodes raise.' },
      { q: 'Production swaps the rule planner for an LLM. What should stay the same?', options: ['Nothing', 'The action/observation contract, stopping reasons and metrics', 'The KB contents', 'The demo questions'], answer: 1, why: 'Stable contracts let you change the brain without changing the plumbing or dashboards.' },
    ],
    checklist: ['Tool allowlist with strict action parsing', 'AST-only math, never eval', 'Max-step limit with alert on rising hit rate', 'Per-tool counters and full step traces persisted', 'Authenticated /run with input length cap'],
  },

  {
    id: 'l10',
    num: 10,
    title: 'Prompt Engineering',
    tagline: 'Templates, few-shot examples and deterministic routing, all testable without an API key.',
    minutes: 50,
    repo: `${REPO}/lesson10/aiam-day10`,
    summary: `
      Before any model call comes **prompt assembly**. You build a \`{{placeholder}}\` template engine that refuses to render
      with missing variables, a few-shot example formatter, and a keyword router for support messages
      (billing / technical / urgent / general), plus a token estimate as a budget check.
    `,
    build: [
      '`PromptTemplate.render()` that raises on unresolved `{{vars}}`',
      '`format_few_shot()` producing consistent `Message:` / `Category:` pairs',
      'First-match-wins keyword routing with a `general` default',
      '`estimate_tokens()` ≈ `len(prompt) // 4` as a pre-flight budget check',
    ],
    problem: `
      ReAct (Lesson 9) needs a planner prompt. Ad-hoc f-strings drift, silently ship \`{{message}}\` to the model when a variable is missing,
      and cannot be versioned or tested. Templates and routing make prompts auditable.
    `,
    flow: [
      ['Message', 'POST /classify (≤500 chars)'],
      ['Few-shot', 'format labelled examples'],
      ['Render', 'fill {{examples}} + {{message}}, fail on leftovers'],
      ['Route', 'keyword rules → category'],
      ['Record', 'renders, categories, token estimate'],
    ],
    concepts: [
      ['Structure vs data', 'Templates separate prompt structure from runtime values. Structure lives in Git and is reviewed; values arrive per request.'],
      ['Fail on unresolved variables', 'A leftover `{{message}}` means the model sees a broken prompt. Raising at render time catches typos before production.'],
      ['Few-shot primes behaviour', 'Consistent labelled pairs show the model the exact output format and category set.'],
      ['Deterministic pre-routing', 'Cheap keyword rules handle obvious cases and make unit tests possible without API keys. Rule order matters: first match wins.'],
      ['Token estimation', '`len // 4` is rough but good enough to refuse a 200k-character prompt before paying for it.'],
    ],
    insights: [
      '**Demo inputs must hit every category.** A zero counter means a broken path.',
      '**Overlapping rules are a bug.** Put the most specific/urgent rules first.',
      'Version templates and few-shot sets like code; A/B them in staging.',
    ],
    pitfalls: ['No placeholder validation.', 'Stale few-shot examples that no longer match categories.', 'Secrets embedded in templates.'],
    examples: [
      ['Support triage', 'Renders few-shot prompts per queue, routes billing keywords to a payments specialist, and logs category distribution for SLA dashboards.'],
      ['Moderation pipeline', 'Templates policy instructions, injects labelled violations, and pre-routes urgent keywords to human review before LLM scoring.'],
    ],
    labs: [
      {
        id: 'l10-template',
        title: 'Template engine + few-shot router',
        minutes: 25,
        goal: 'Render prompts safely and route messages to categories.',
        steps: [
          '`PromptTemplate.render(**kw)`: replace each `{{key}}` with `str(value)`. If any `{{name}}` remains, raise `ValueError` listing the missing names.',
          '`estimate_tokens(text)` returns `len(text) // 4`.',
          '`format_few_shot(examples)` joins `"Message: {m}\\nCategory: {c}\\n"` for each pair with `"\\n"`.',
          '`classify(message)`: lowercase, then return the category of the **first** rule whose keyword appears; default `"general"`.',
          '`build_prompt(message)` renders `SUPPORT_TEMPLATE` with formatted `FEW_SHOT` and the message; returns `(prompt, category, tokens)`.',
        ],
        hints: ['Find leftovers with `re.findall(r"\\{\\{(\\w+)\\}\\}", text)`.', 'Iterate `CLASSIFICATION_RULES` in order; `any(k in text for k in keywords)`.'],
        starter: py`
import re

SUPPORT_TEMPLATE = """You are a support triage assistant.
Classify the message into: billing, technical, urgent, general.

{{examples}}
Message: {{message}}
Category:"""

FEW_SHOT = [
    ("I was charged twice this month", "billing"),
    ("The API returns 500 errors", "technical"),
    ("URGENT: production is down", "urgent"),
    ("What are your office hours?", "general"),
]

CLASSIFICATION_RULES = [  # first match wins: most urgent first
    ("urgent", ["urgent", "down", "outage", "asap"]),
    ("billing", ["charge", "invoice", "refund", "payment"]),
    ("technical", ["500", "error", "bug", "timeout", "api"]),
]

class PromptTemplate:
    def __init__(self, text):
        self.text = text

    def render(self, **kwargs):
        raise NotImplementedError

def estimate_tokens(text):
    raise NotImplementedError

def format_few_shot(examples):
    raise NotImplementedError

def classify(message):
    raise NotImplementedError

def build_prompt(message):
    raise NotImplementedError


if __name__ == "__main__":
    prompt, cat, tokens = build_prompt("Refund my duplicate charge please")
    print(prompt)
    print("->", cat, f"(~{tokens} tokens)")
`,
        solution: py`
import re

SUPPORT_TEMPLATE = """You are a support triage assistant.
Classify the message into: billing, technical, urgent, general.

{{examples}}
Message: {{message}}
Category:"""

FEW_SHOT = [
    ("I was charged twice this month", "billing"),
    ("The API returns 500 errors", "technical"),
    ("URGENT: production is down", "urgent"),
    ("What are your office hours?", "general"),
]

CLASSIFICATION_RULES = [  # first match wins: most urgent first
    ("urgent", ["urgent", "down", "outage", "asap"]),
    ("billing", ["charge", "invoice", "refund", "payment"]),
    ("technical", ["500", "error", "bug", "timeout", "api"]),
]

class PromptTemplate:
    def __init__(self, text):
        self.text = text

    def render(self, **kwargs):
        text = self.text
        for key, value in kwargs.items():
            text = text.replace("{{" + key + "}}", str(value))
        missing = re.findall(r"\{\{(\w+)\}\}", text)
        if missing:
            raise ValueError(f"unresolved template variables: {missing}")
        return text

def estimate_tokens(text):
    return len(text) // 4

def format_few_shot(examples):
    return "\n".join(f"Message: {m}\nCategory: {c}\n" for m, c in examples)

def classify(message):
    text = message.lower()
    for category, keywords in CLASSIFICATION_RULES:
        if any(k in text for k in keywords):
            return category
    return "general"

def build_prompt(message):
    prompt = PromptTemplate(SUPPORT_TEMPLATE).render(examples=format_few_shot(FEW_SHOT), message=message)
    return prompt, classify(message), estimate_tokens(prompt)


if __name__ == "__main__":
    prompt, cat, tokens = build_prompt("Refund my duplicate charge please")
    print(prompt)
    print("->", cat, f"(~{tokens} tokens)")
`,
        tests: py`
def test_render_ok():
    "Placeholders are filled"
    assert PromptTemplate("Hi {{name}}, {{n}} msgs").render(name="Ana", n=3) == "Hi Ana, 3 msgs"

def test_render_missing_raises():
    "Unresolved variables raise ValueError naming them"
    try:
        PromptTemplate("{{a}} and {{b}}").render(a=1)
    except ValueError as e:
        assert "b" in str(e)
        return
    raise AssertionError("expected ValueError")

def test_few_shot_format():
    "Few-shot pairs are formatted consistently"
    out = format_few_shot([("x", "billing"), ("y", "general")])
    assert out == "Message: x\nCategory: billing\n\nMessage: y\nCategory: general\n"

def test_classify_all_categories():
    "Every category is reachable"
    assert classify("Why is there an extra charge?") == "billing"
    assert classify("API returns 500") == "technical"
    assert classify("URGENT site is down") == "urgent"
    assert classify("Can I change my phone number?") == "general"

def test_first_match_wins():
    "Urgent beats technical when both match"
    assert classify("urgent: api error") == "urgent"

def test_build_prompt():
    "build_prompt renders fully and estimates tokens"
    prompt, cat, tokens = build_prompt("double charge")
    assert "{{" not in prompt and prompt.endswith("Message: double charge\nCategory:")
    assert cat == "billing" and tokens == len(prompt) // 4
`,
      },
    ],
    quiz: [
      { q: 'Why raise on unresolved `{{placeholders}}` instead of leaving them?', options: ['Style preference', 'A broken prompt reaches the model silently and degrades answers; failing at render time catches it in tests', 'Templates cannot contain braces', 'It is faster'], answer: 1, why: 'Fail fast at the cheapest point.' },
      { q: 'A message contains both "urgent" and "error". What decides the category?', options: ['Random', 'Rule order: first match wins, so put the most critical rules first', 'The longest keyword', 'Alphabetical order'], answer: 1, why: 'Deterministic ordering makes routing predictable and testable.' },
      { q: 'What is `len(prompt) // 4` good for?', options: ['Exact billing', 'A cheap pre-flight budget check before calling a paid endpoint', 'Measuring quality', 'Nothing'], answer: 1, why: 'Rough estimates still stop absurd prompts before they cost money.' },
    ],
    checklist: ['Templates versioned in Git', 'Render fails on unresolved variables', 'Few-shot examples cover every category', 'No secrets in templates', 'Alert on zero coverage for any category'],
  },

  {
    id: 'l11',
    num: 11,
    title: 'Structured Output',
    tagline: 'Model text is not data until it passes a schema.',
    minutes: 50,
    repo: `${REPO}/lesson11/aiam-day11`,
    summary: `
      Downstream systems (billing, CRM, tool routers) need **typed fields**, not prose.
      The reference project uses **Pydantic v2** (\`model_validate_json\`, \`field_validator\`) to enforce allowed entity types,
      clamp confidence to [0, 1], and fail loudly on bad JSON or schema violations. In this lab you build the same contract by hand,
      so you see exactly what Pydantic does for you.
    `,
    build: [
      'A `StructuredResponse` contract: non-empty `answer`, typed `entities`, `confidence` in [0,1], optional `follow_up`',
      'An entity-type allowlist: `person`, `org`, `location`, `date`',
      'Confidence clamping (5.0 → 1.0) instead of rejecting usable records',
      '`parse_structured()` → `ParseResult(ok, data, error)` that never raises',
    ],
    problem: `
      \`json.loads\` only checks syntax. \`{"type": "alien"}\` is valid JSON and still corrupts your CRM.
      Schema enforcement turns formatting drift into a visible \`parse_fail\` counter before customers see breakage.
    `,
    flow: [
      ['Raw text', 'LLM output, ≤8k chars'],
      ['Decode', 'JSON syntax → fail = parse error'],
      ['Validate', 'types, allowlist, non-empty, clamp'],
      ['Result', 'ParseResult(ok, data | error)'],
      ['Record', 'ok/fail, entities, follow-ups, latency'],
    ],
    concepts: [
      ['Schema-first contracts', 'Define what you accept before you prompt for it. Fail closed so bad output never reaches business systems.'],
      ['Semantic vs syntactic validity', 'Well-formed JSON with `"type": "alien"` is syntactically valid and semantically wrong. Allowlists catch it.'],
      ['Clamp vs reject', 'Out-of-range confidence is recoverable (clamp). An unknown entity type is not (reject). Decide per field.'],
      ['Parse vs validate', 'Separate JSON decode errors from schema errors. Both become `ok=False` with a truncated, PII-free message.'],
      ['Pydantic v2 in production', '`StructuredResponse.model_validate_json(text)` with `@field_validator`. Avoid deprecated v1 `parse_raw`.'],
    ],
    insights: [
      '**Demos must include failures.** Zero `parse_fail` means the rejection path is untested.',
      '**Truncate errors** (e.g. 240 chars) before logging or displaying; raw payloads may contain PII.',
      'Rising `parse_fail` after a model or prompt change is your earliest regression signal.',
    ],
    pitfalls: ['Trusting `json.loads` alone.', 'Pydantic v1 validators in a v2 codebase.', 'Logging raw model output with PII.'],
    examples: [
      ['Insurance claims bot', 'Requires claimant (person), insurer (org) and loss date (date). Invalid types go to human review; parse_fail feeds evaluation dashboards.'],
      ['Travel assistant', 'Extracts destination and travel date. A schema failure triggers a follow-up question instead of booking on corrupted fields.'],
    ],
    extra: `
      ### The Pydantic version (for the real project)
      \`\`\`python
      from pydantic import BaseModel, field_validator

      class Entity(BaseModel):
          name: str
          type: str

          @field_validator("type")
          @classmethod
          def allowed(cls, v):
              if v.lower() not in {"person", "org", "location", "date"}:
                  raise ValueError(f"invalid type: {v}")
              return v.lower()

      class StructuredResponse(BaseModel):
          answer: str
          entities: list[Entity] = []
          confidence: float
          follow_up: str | None = None

          @field_validator("confidence")
          @classmethod
          def clamp(cls, v):
              return max(0.0, min(1.0, v))

      StructuredResponse.model_validate_json(raw)  # raises ValidationError on bad input
      \`\`\`
    `,
    labs: [
      {
        id: 'l11-parse',
        title: 'Build the schema validator by hand',
        minutes: 25,
        goal: 'Implement `parse_structured(raw)` returning a `ParseResult` that never raises.',
        steps: [
          '`json.loads` the stripped text. Decode error → `ok=False`, error starts with `"invalid JSON"`.',
          'Top level must be an object. `answer` must be a non-empty string.',
          '`entities` (default `[]`) must be a list of objects with string `name` and `type` in `ALLOWED_ENTITY_TYPES` (case-insensitive, stored lowercase).',
          '`confidence` must be a number (not bool); clamp to [0, 1]. `follow_up` is optional (`None` or str).',
          'Any schema error → `ok=False` with the message truncated to 240 chars. Success → `ok=True, data=dict`.',
        ],
        hints: ['Raise `ValueError` inside a helper `_validate(obj)` and catch it once in `parse_structured`.', 'Bools are ints in Python: check `isinstance(c, bool)` first.'],
        starter: py`
import json
from dataclasses import dataclass

ALLOWED_ENTITY_TYPES = {"person", "org", "location", "date"}

@dataclass
class ParseResult:
    ok: bool
    data: dict = None
    error: str = ""

def _validate(obj):
    # TODO: return a cleaned dict or raise ValueError
    raise NotImplementedError

def parse_structured(raw):
    # TODO: decode, validate, wrap in ParseResult (never raise)
    raise NotImplementedError


if __name__ == "__main__":
    print(parse_structured('{"answer": "Paris", "entities": [{"name": "Paris", "type": "LOCATION"}], "confidence": 5}'))
    print(parse_structured('{"answer": "x", "entities": [{"name": "Zork", "type": "alien"}], "confidence": 0.5}'))
    print(parse_structured("Sure! The answer is Paris."))
`,
        solution: py`
import json
from dataclasses import dataclass

ALLOWED_ENTITY_TYPES = {"person", "org", "location", "date"}

@dataclass
class ParseResult:
    ok: bool
    data: dict = None
    error: str = ""

def _validate(obj):
    if not isinstance(obj, dict):
        raise ValueError("top level must be an object")
    answer = obj.get("answer")
    if not isinstance(answer, str) or not answer.strip():
        raise ValueError("answer must be a non-empty string")
    entities = obj.get("entities", [])
    if not isinstance(entities, list):
        raise ValueError("entities must be a list")
    clean = []
    for e in entities:
        if not isinstance(e, dict) or not isinstance(e.get("name"), str) or not isinstance(e.get("type"), str):
            raise ValueError("entity needs string name and type")
        t = e["type"].lower()
        if t not in ALLOWED_ENTITY_TYPES:
            raise ValueError(f"invalid type: {e['type']}")
        clean.append({"name": e["name"], "type": t})
    c = obj.get("confidence")
    if isinstance(c, bool) or not isinstance(c, (int, float)):
        raise ValueError("confidence must be a number")
    follow_up = obj.get("follow_up")
    if follow_up is not None and not isinstance(follow_up, str):
        raise ValueError("follow_up must be a string or null")
    return {"answer": answer, "entities": clean, "confidence": max(0.0, min(1.0, float(c))), "follow_up": follow_up}

def parse_structured(raw):
    try:
        obj = json.loads(raw.strip())
    except json.JSONDecodeError as e:
        return ParseResult(False, error=f"invalid JSON: {e}"[:240])
    try:
        return ParseResult(True, data=_validate(obj))
    except ValueError as e:
        return ParseResult(False, error=str(e)[:240])


if __name__ == "__main__":
    print(parse_structured('{"answer": "Paris", "entities": [{"name": "Paris", "type": "LOCATION"}], "confidence": 5}'))
    print(parse_structured('{"answer": "x", "entities": [{"name": "Zork", "type": "alien"}], "confidence": 0.5}'))
    print(parse_structured("Sure! The answer is Paris."))
`,
        tests: py`
import json

def test_valid_payload():
    "Valid payload parses and normalizes type case"
    r = parse_structured('{"answer":"Paris","entities":[{"name":"Paris","type":"Location"}],"confidence":0.9}')
    assert r.ok and r.data["entities"] == [{"name": "Paris", "type": "location"}]
    assert r.data["follow_up"] is None

def test_confidence_clamped():
    "Confidence is clamped into [0, 1]"
    assert parse_structured('{"answer":"a","confidence":5.0}').data["confidence"] == 1.0
    assert parse_structured('{"answer":"a","confidence":-2}').data["confidence"] == 0.0

def test_bad_entity_type():
    "Unknown entity types fail"
    r = parse_structured('{"answer":"a","entities":[{"name":"Zork","type":"alien"}],"confidence":0.5}')
    assert not r.ok and "alien" in r.error

def test_non_json():
    "Prose fails as invalid JSON"
    r = parse_structured("Sure! Paris.")
    assert not r.ok and r.error.startswith("invalid JSON")

def test_empty_answer_and_bool_confidence():
    "Empty answer and boolean confidence fail"
    assert not parse_structured('{"answer":"  ","confidence":0.5}').ok
    assert not parse_structured('{"answer":"a","confidence":true}').ok
    assert not parse_structured('[1,2]').ok

def test_error_truncated():
    "Errors are truncated to 240 chars"
    r = parse_structured(json.dumps({"answer": "a", "entities": [{"name": "x", "type": "t" * 1000}], "confidence": 1}))
    assert not r.ok and len(r.error) <= 240

def test_follow_up():
    "follow_up is optional string"
    assert parse_structured('{"answer":"a","confidence":1,"follow_up":"Which date?"}').data["follow_up"] == "Which date?"
    assert not parse_structured('{"answer":"a","confidence":1,"follow_up":3}').ok
`,
      },
    ],
    quiz: [
      { q: '`{"answer":"ok","entities":[{"name":"X","type":"alien"}],"confidence":0.5}`. What should happen?', options: ['Accept: it is valid JSON', 'Reject: valid syntax, invalid semantics (type not in allowlist)', 'Silently drop the entity', 'Change type to "org"'], answer: 1, why: 'Schema enforcement is semantic. Silent coercion hides defects until something downstream breaks.' },
      { q: 'Why clamp confidence but reject unknown entity types?', options: ['Inconsistent design', 'An out-of-range number is recoverable without inventing data; an unknown type would require guessing', 'Clamping is faster', 'Pydantic forces it'], answer: 1, why: 'Choose recover-vs-reject per field based on whether recovery invents information.' },
      { q: 'Which is the Pydantic v2 way to validate a JSON string?', options: ['`Model.parse_raw(s)`', '`Model.model_validate_json(s)`', '`json.loads(s)`', '`Model(**s)`'], answer: 1, why: '`parse_raw` is deprecated v1 API.' },
    ],
    checklist: ['Schemas versioned next to the service', 'Entity/enum allowlists', 'Invalid output never reaches business handlers', 'parse_fail rate on the dashboard with alerts', 'Errors truncated; no raw PII in logs'],
  },
];
