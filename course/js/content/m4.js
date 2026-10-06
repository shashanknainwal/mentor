// Module 4 — Control Flow & Context (Lessons 12–14)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering-p/tree/main';

export default [
  {
    id: 'l12',
    num: 12,
    title: 'Agent State Machine',
    tagline: 'Explicit states and audited transitions beat boolean spaghetti.',
    minutes: 50,
    repo: `${REPO}/lesson12/aiam-day12`,
    summary: `
      Model the agent lifecycle as a **finite-state machine**: IDLE → VALIDATING → PROCESSING ⇄ TOOL_CALL → RESPONDING → DONE, with ERROR reachable
      from working states and recovering to IDLE. Illegal shortcuts (IDLE → DONE) raise, never mutate state, and increment a **blocked** counter.
    `,
    build: [
      'A `TRANSITIONS` table encoding every legal edge',
      '`AgentFSM.transition()` that rejects illegal edges without side effects',
      'An audit history of `{from, to, reason}` for every successful edge',
      'Error/recovery accounting: `error_count`, `recoveries`, `invalid_blocked`',
    ],
    problem: `
      Agents with flags like \`is_validating\`, \`has_tool_result\`, \`retrying\` hide loops and skipped steps.
      A booking agent that jumps to DONE without VALIDATING skips the fraud check. An explicit table makes that impossible and visible.
    `,
    flow: [
      ['IDLE', 'new request arrives'],
      ['VALIDATING', 'structured output + policy checks'],
      ['PROCESSING ⇄ TOOL_CALL', 'loop while tools are needed'],
      ['RESPONDING', 'grounded answer assembled'],
      ['DONE / ERROR → IDLE', 'finish, or recover and reset'],
    ],
    concepts: [
      ['Transition table as policy', '`TRANSITIONS[state] = [allowed next states]`. Adding a capability means adding an edge in one reviewed place.'],
      ['Fail closed, no mutation', 'An illegal edge raises before touching state. A half-applied transition is worse than none.'],
      ['Audit trail', 'Append `{from, to, reason}` on success. Dashboards, alerts and incident reviews read one source of truth.'],
      ['ERROR is a state', 'Detection (enter ERROR, count it) is separate from recovery (ERROR → IDLE, count recovery). Both are measurable.'],
      ['Blocked edges are a metric', '`invalid_blocked > 0` in prod means a code path tried to skip a step. That is a bug report, delivered.'],
    ],
    insights: [
      '**Demos must include blocked and error paths.** Zero `invalid_blocked` means your guards are untested.',
      'The FSM owns lifecycle; Lesson 13\'s async pipeline will run *inside* TOOL_CALL.',
      'Persist history externally before running multiple replicas.',
    ],
    pitfalls: ['Allowing any-to-any transitions.', 'Forgetting ERROR → IDLE recovery.', 'DONE reachable from IDLE.'],
    examples: [
      ['Support agent', 'VALIDATING per ticket, TOOL_CALL for CRM lookup, RESPONDING when grounded, ERROR on injection; recoveries feed SOC dashboards.'],
      ['Booking agent', 'Loops PROCESSING ⇄ TOOL_CALL for inventory, reaches DONE only after payment, and refuses IDLE → DONE shortcuts.'],
    ],
    labs: [
      {
        id: 'l12-fsm',
        title: 'Audited agent FSM',
        minutes: 25,
        goal: 'Implement `AgentFSM.transition()` and `run_scenario()` with full metrics.',
        steps: [
          'If `new_state` is not in `TRANSITIONS[self.state]`: increment `metrics["invalid_blocked"]` and raise `ValueError("Invalid: A -> B")`. Do not change state.',
          'Otherwise append `{"from", "to", "reason"}` to `history`, increment `metrics["transitions"]`, set the state.',
          'Entering ERROR increments `error_count`. Leaving ERROR for IDLE increments `metrics["recoveries"]`.',
          '`run_scenario(states)` applies each state in order and returns the final state name.',
        ],
        hints: ['Use `State.X.name` for readable messages.', 'Capture `from_state = self.state` before mutating.'],
        starter: py`
from enum import Enum, auto

class State(Enum):
    IDLE = auto()
    VALIDATING = auto()
    PROCESSING = auto()
    TOOL_CALL = auto()
    RESPONDING = auto()
    DONE = auto()
    ERROR = auto()

S = State
TRANSITIONS = {
    S.IDLE: [S.VALIDATING],
    S.VALIDATING: [S.PROCESSING, S.ERROR],
    S.PROCESSING: [S.TOOL_CALL, S.RESPONDING, S.ERROR],
    S.TOOL_CALL: [S.PROCESSING, S.ERROR],
    S.RESPONDING: [S.DONE, S.ERROR],
    S.DONE: [S.IDLE],
    S.ERROR: [S.IDLE],
}

class AgentFSM:
    def __init__(self):
        self.state = S.IDLE
        self.history = []
        self.error_count = 0
        self.metrics = {"transitions": 0, "invalid_blocked": 0, "recoveries": 0}

    def transition(self, new_state, reason=""):
        raise NotImplementedError

    def run_scenario(self, states):
        raise NotImplementedError


if __name__ == "__main__":
    fsm = AgentFSM()
    print(fsm.run_scenario([S.VALIDATING, S.PROCESSING, S.TOOL_CALL, S.PROCESSING, S.RESPONDING, S.DONE, S.IDLE]))
    try:
        fsm.transition(S.DONE, "shortcut")
    except ValueError as e:
        print("blocked:", e)
    print(fsm.metrics)
`,
        solution: py`
from enum import Enum, auto

class State(Enum):
    IDLE = auto()
    VALIDATING = auto()
    PROCESSING = auto()
    TOOL_CALL = auto()
    RESPONDING = auto()
    DONE = auto()
    ERROR = auto()

S = State
TRANSITIONS = {
    S.IDLE: [S.VALIDATING],
    S.VALIDATING: [S.PROCESSING, S.ERROR],
    S.PROCESSING: [S.TOOL_CALL, S.RESPONDING, S.ERROR],
    S.TOOL_CALL: [S.PROCESSING, S.ERROR],
    S.RESPONDING: [S.DONE, S.ERROR],
    S.DONE: [S.IDLE],
    S.ERROR: [S.IDLE],
}

class AgentFSM:
    def __init__(self):
        self.state = S.IDLE
        self.history = []
        self.error_count = 0
        self.metrics = {"transitions": 0, "invalid_blocked": 0, "recoveries": 0}

    def transition(self, new_state, reason=""):
        if new_state not in TRANSITIONS.get(self.state, []):
            self.metrics["invalid_blocked"] += 1
            raise ValueError(f"Invalid: {self.state.name} -> {new_state.name}")
        from_state = self.state
        self.history.append({"from": from_state.name, "to": new_state.name, "reason": reason})
        self.metrics["transitions"] += 1
        if new_state is S.ERROR:
            self.error_count += 1
        if from_state is S.ERROR and new_state is S.IDLE:
            self.metrics["recoveries"] += 1
        self.state = new_state

    def run_scenario(self, states):
        for s in states:
            self.transition(s)
        return self.state.name


if __name__ == "__main__":
    fsm = AgentFSM()
    print(fsm.run_scenario([S.VALIDATING, S.PROCESSING, S.TOOL_CALL, S.PROCESSING, S.RESPONDING, S.DONE, S.IDLE]))
    try:
        fsm.transition(S.DONE, "shortcut")
    except ValueError as e:
        print("blocked:", e)
    print(fsm.metrics)
`,
        tests: py`
HAPPY = [S.VALIDATING, S.PROCESSING, S.TOOL_CALL, S.PROCESSING, S.RESPONDING, S.DONE, S.IDLE]

def test_happy_path():
    "Seven legal edges, audited"
    f = AgentFSM()
    assert f.run_scenario(HAPPY) == "IDLE"
    assert f.metrics["transitions"] == 7 and len(f.history) == 7
    assert f.history[0] == {"from": "IDLE", "to": "VALIDATING", "reason": ""}

def test_illegal_edge_blocked_without_mutation():
    "IDLE → DONE is blocked and state is unchanged"
    f = AgentFSM()
    try:
        f.transition(S.DONE, "skip")
        raise AssertionError("expected ValueError")
    except ValueError as e:
        assert "IDLE -> DONE" in str(e)
    assert f.state is S.IDLE and f.history == [] and f.metrics["invalid_blocked"] == 1

def test_error_and_recovery():
    "ERROR is counted and recovery to IDLE is tracked"
    f = AgentFSM()
    f.run_scenario([S.VALIDATING, S.ERROR, S.IDLE])
    assert f.error_count == 1 and f.metrics["recoveries"] == 1 and f.state is S.IDLE

def test_tool_loop():
    "PROCESSING ⇄ TOOL_CALL can loop"
    f = AgentFSM()
    f.run_scenario([S.VALIDATING] + [S.PROCESSING, S.TOOL_CALL] * 3 + [S.PROCESSING, S.RESPONDING, S.DONE])
    assert f.state is S.DONE

def test_done_requires_idle_reset():
    "DONE can only go back to IDLE"
    f = AgentFSM()
    f.run_scenario(HAPPY[:-1])
    try:
        f.transition(S.VALIDATING)
        raise AssertionError("DONE -> VALIDATING should be blocked")
    except ValueError:
        pass
`,
      },
    ],
    quiz: [
      { q: 'An illegal transition is attempted. What must be true afterwards?', options: ['State changed to the target', 'State is unchanged, nothing appended to history, invalid_blocked incremented', 'The FSM resets to IDLE', 'The process exits'], answer: 1, why: 'Fail closed with zero side effects, and make the attempt visible.' },
      { q: 'Why model ERROR as its own state?', options: ['Enums need one', 'It separates detection from recovery so both can be counted and alerted on', 'Python requires it', 'For colours on the dashboard'], answer: 1, why: 'You want error_count and recoveries as distinct signals.' },
      { q: 'In production you see `invalid_blocked` rising. What does it mean?', options: ['Healthy traffic', 'Some code path is trying to skip lifecycle steps, which is a bug to investigate', 'Users are typing too fast', 'Metrics are broken'], answer: 1, why: 'Guards firing in prod point straight at the faulty caller.' },
    ],
    checklist: ['Transition table reviewed like policy', 'Illegal edges never mutate state', 'History persisted externally for multi-replica', 'Alert on stuck non-IDLE agents and rising invalid_blocked', 'Mutating routes authenticated'],
  },

  {
    id: 'l13',
    num: 13,
    title: 'Async Agent Pipeline',
    tagline: 'Independent tools should overlap: wall time ≈ slowest tool, not the sum.',
    minutes: 50,
    repo: `${REPO}/lesson13/aiam-day13`,
    summary: `
      Sequential \`await\` is your latency baseline. \`asyncio.gather\` overlaps independent I/O so wall time tracks the **slowest** tool.
      You build both runners, a **bounded** parallel runner (semaphore), and speedup metrics that catch accidental serialisation.
    `,
    build: [
      'A sequential runner (baseline) and an `asyncio.gather` runner',
      'A semaphore cap on concurrency to protect downstream APIs',
      'Partial-failure handling with `return_exceptions=True`',
      '`speedup = sequential_ms / parallel_ms` plus max observed concurrency',
    ],
    problem: `
      Lesson 12 defined *when* the agent is in TOOL_CALL. Inside that state, search, lookup and validate often share no data dependency.
      Awaiting them one by one adds their latencies together and inflates p95 for no reason.
    `,
    flow: [
      ['Tasks', 'name, delay, payload'],
      ['Dependency check', 'independent? → parallel; chained → sequential'],
      ['Gather', 'bounded by semaphore'],
      ['Collect', 'ordered results, exceptions as values'],
      ['Record', 'sequential vs parallel ms, speedup, concurrency'],
    ],
    concepts: [
      ['Data-flow decides', 'Independent tool I/O can run concurrently; dependent chains (B needs A\'s output) must stay sequential. "Always parallel" is wrong.'],
      ['Wall-clock vs tool latency', 'Sequential wall ≈ sum of delays. Parallel wall ≈ max delay. Users feel wall-clock.'],
      ['gather for I/O, not CPU', '`asyncio.gather` overlaps waiting (network). CPU-bound loops need processes, not coroutines.'],
      ['Bounded concurrency', 'Unbounded gather can fire 500 requests at a rate-limited API. `asyncio.Semaphore(n)` caps in-flight calls.'],
      ['Speedup ≈ 1.0 is a smell', 'For multi-tool work it usually means accidental serialisation, like an `await` inside a `for` loop.'],
    ],
    insights: [
      '**Run both modes in demos** so speedup is always defined and comparable.',
      'Cancel gathered work when the parent request times out.',
      'More concurrency lowers wall time but raises downstream load. Tune it; do not max it.',
    ],
    pitfalls: ['Awaiting in a loop when tools are independent.', 'Unbounded fan-out.', 'Using gather for CPU-heavy work.'],
    examples: [
      ['Research agent', 'Fans out web search, calculator and schema validation in parallel; operators watch speedup climb from ~1× to ~3×.'],
      ['Support agent', 'Gathers CRM lookup, KB search and policy check concurrently; cancelling the parent cancels the gather under load.'],
    ],
    labs: [
      {
        id: 'l13-runners',
        title: 'Sequential vs bounded-parallel runners',
        minutes: 25,
        goal: 'Implement both runners and a `compare()` that reports speedup and peak concurrency.',
        steps: [
          '`run_sequential(tasks)`: await each `tool_call` in order; return `(results, ms)`.',
          '`run_parallel(tasks, limit)`: wrap each call in `async with sem:` where `sem = asyncio.Semaphore(limit)`; gather with `return_exceptions=True`; return `(results, ms)`.',
          'Track the current and peak number of in-flight calls in `self.in_flight` / `self.peak`.',
          '`compare(tasks, limit)` returns `{"sequential_ms", "parallel_ms", "speedup", "peak_concurrency", "failures"}` where failures counts exceptions in the parallel results.',
        ],
        hints: ['Increment `in_flight` inside the semaphore block before awaiting, decrement in `finally`.', '`speedup = seq_ms / max(par_ms, 1e-6)`.'],
        starter: py`
import asyncio
import time

async def tool_call(name, delay, payload=None):
    await asyncio.sleep(delay)
    if payload == "FAIL":
        raise RuntimeError(f"{name} failed")
    return {"tool": name, "ms": round(delay * 1000)}

class Pipeline:
    def __init__(self):
        self.in_flight = 0
        self.peak = 0

    async def _tracked(self, name, delay, payload):
        # TODO: count in-flight calls and peak, then await tool_call
        raise NotImplementedError

    async def run_sequential(self, tasks):
        raise NotImplementedError

    async def run_parallel(self, tasks, limit=10):
        raise NotImplementedError

    async def compare(self, tasks, limit=10):
        raise NotImplementedError


if __name__ == "__main__":
    tasks = [("search", .08, None), ("calculate", .02, None), ("summarise", .06, None),
             ("lookup", .04, None), ("validate", .03, None)]
    print(await Pipeline().compare(tasks))
`,
        solution: py`
import asyncio
import time

async def tool_call(name, delay, payload=None):
    await asyncio.sleep(delay)
    if payload == "FAIL":
        raise RuntimeError(f"{name} failed")
    return {"tool": name, "ms": round(delay * 1000)}

class Pipeline:
    def __init__(self):
        self.in_flight = 0
        self.peak = 0

    async def _tracked(self, name, delay, payload):
        self.in_flight += 1
        self.peak = max(self.peak, self.in_flight)
        try:
            return await tool_call(name, delay, payload)
        finally:
            self.in_flight -= 1

    async def run_sequential(self, tasks):
        t0 = time.perf_counter()
        results = []
        for name, delay, payload in tasks:
            try:
                results.append(await self._tracked(name, delay, payload))
            except Exception as e:
                results.append(e)
        return results, (time.perf_counter() - t0) * 1000

    async def run_parallel(self, tasks, limit=10):
        sem = asyncio.Semaphore(limit)

        async def bounded(name, delay, payload):
            async with sem:
                return await self._tracked(name, delay, payload)

        t0 = time.perf_counter()
        results = await asyncio.gather(*[bounded(*t) for t in tasks], return_exceptions=True)
        return list(results), (time.perf_counter() - t0) * 1000

    async def compare(self, tasks, limit=10):
        _, seq_ms = await self.run_sequential(tasks)
        self.peak = 0
        results, par_ms = await self.run_parallel(tasks, limit)
        return {
            "sequential_ms": seq_ms,
            "parallel_ms": par_ms,
            "speedup": seq_ms / max(par_ms, 1e-6),
            "peak_concurrency": self.peak,
            "failures": sum(isinstance(r, Exception) for r in results),
        }


if __name__ == "__main__":
    tasks = [("search", .08, None), ("calculate", .02, None), ("summarise", .06, None),
             ("lookup", .04, None), ("validate", .03, None)]
    print(await Pipeline().compare(tasks))
`,
        tests: py`
TASKS = [("search", .08, None), ("calculate", .02, None), ("summarise", .06, None),
         ("lookup", .04, None), ("validate", .03, None)]

async def test_sequential_is_sum():
    "Sequential wall ≈ sum of delays"
    _, ms = await Pipeline().run_sequential(TASKS)
    assert ms >= 225, ms

async def test_parallel_is_max():
    "Parallel wall ≈ slowest tool"
    res, ms = await Pipeline().run_parallel(TASKS)
    assert ms < 160, ms
    assert [r["tool"] for r in res] == [t[0] for t in TASKS]

async def test_speedup():
    "Speedup > 2x on five independent tools"
    r = await Pipeline().compare(TASKS)
    assert r["speedup"] > 2 and r["peak_concurrency"] == 5 and r["failures"] == 0, r

async def test_semaphore_bounds_concurrency():
    "Semaphore caps in-flight calls"
    p = Pipeline()
    await p.run_parallel([("t", .02, None)] * 8, limit=2)
    assert p.peak == 2 and p.in_flight == 0

async def test_partial_failure():
    "One failure does not sink the batch"
    res, _ = await Pipeline().run_parallel(TASKS[:2] + [("bad", .01, "FAIL")])
    assert isinstance(res[-1], RuntimeError) and res[0]["tool"] == "search"
`,
      },
    ],
    quiz: [
      { q: 'Five independent tools take 80, 20, 60, 40, 30 ms. Expected parallel wall time?', options: ['230 ms', '≈ 80 ms', '46 ms', '20 ms'], answer: 1, why: 'With full overlap, wall time ≈ the slowest tool.' },
      { q: 'Tool B needs Tool A\'s output. How do you run them?', options: ['gather both', 'Sequentially: A then B (but B can be gathered with other independent tools)', 'Threads', 'Randomly'], answer: 1, why: 'Data dependencies force ordering. Parallelise only what is independent.' },
      { q: 'Why add a semaphore to gather?', options: ['To make it faster', 'To cap in-flight calls so you do not overload or get rate-limited by downstream APIs', 'Required by asyncio', 'To order results'], answer: 1, why: 'Unbounded fan-out is a self-inflicted DDoS.' },
    ],
    checklist: ['Only independent tools parallelised', 'Semaphore cap on fan-out', 'Gather cancelled on parent timeout', 'Shared HTTP connection pools', 'Alert when speedup ≈ 1.0 on multi-tool work'],
  },

  {
    id: 'l14',
    num: 14,
    title: 'Context Window Management',
    tagline: 'Budget before the call beats retry after the failure.',
    minutes: 50,
    repo: `${REPO}/lesson14/aiam-day14`,
    summary: `
      Parallel tool fan-out fills history faster than models accept it. You keep prompts inside
      \`available = max_tokens - reserved\` with two strategies: **priority trimming** (drop low-value messages first, keep system/policy)
      and a **sliding window** (keep the newest N, then enforce the ceiling).
    `,
    build: [
      'A pluggable `count_tokens()` (chars // 4 here; swap for a real tokenizer later)',
      '`ContextWindow` with `reserved` response headroom and validation',
      '`fit()`: drop lowest priority first (oldest first among ties) until under budget',
      '`sliding(keep)`: keep the newest messages, pin system, then enforce tokens',
    ],
    problem: `
      Lesson 13 made tools fast. Their outputs now pile into the prompt.
      Without a fit step, providers reject oversized prompts, or the model loses the goal under noise.
      FIFO deletion is worse: it deletes the system prompt first.
    `,
    flow: [
      ['History', 'system + turns + tool dumps'],
      ['Count', 'tokens per message'],
      ['Budget', 'available = max − reserved'],
      ['Trim', 'priority fit or sliding window'],
      ['Record', 'tokens before/after, dropped, utilization %'],
    ],
    concepts: [
      ['Reserve response headroom', 'If history uses the whole window, the model has no room to answer. `reserved` keeps space for the response.'],
      ['Priority beats FIFO', 'Chronological deletion removes the system/policy message first. Priority trimming drops tool dumps before compliance text.'],
      ['Sliding window', 'Keep the newest N messages (plus pinned system), then enforce the token ceiling from the oldest side.'],
      ['Utilization', '`100 × tokens / available`. Above 100% before a fit means overload; after a fit it must be ≤ 100%.'],
      ['Pluggable counters', 'Callers use `count_tokens()`; swapping chars//4 for a model tokenizer changes one function.'],
    ],
    insights: [
      '**Never return an over-budget success.** If it cannot fit, raise.',
      'Aggressive trimming saves tokens but can drop grounding facts. Pin what matters at max priority.',
      'Alert when `tokens_trimmed` stays zero under known overload (the fit is not running).',
    ],
    pitfalls: ['FIFO-only deletion.', 'Zero reserved headroom.', 'Logging full message content in trim events.'],
    examples: [
      ['Support agent', 'Keeps the latest six turns plus a pinned policy message; utilization falls from ~155% to under 100% without losing compliance text.'],
      ['Research agent', 'Priority-trims search dumps while keeping the user goal and synthesis.'],
    ],
    labs: [
      {
        id: 'l14-window',
        title: 'Priority fit and sliding window',
        minutes: 25,
        goal: 'Keep messages under `available` tokens with two strategies.',
        steps: [
          'Constructor: `reserved >= max_tokens` → `ValueError`. `available = max_tokens - reserved`.',
          '`fit()`: while total > available, remove the message with the **lowest priority**; among ties remove the **oldest**. Return the dropped messages. Keep order of the rest.',
          '`sliding(keep)`: keep all `system` messages plus the newest `keep` non-system messages; then, while over budget, drop the oldest non-system message. Return dropped.',
          'If the remaining messages still exceed the budget (e.g. only a huge system message), raise `ValueError`.',
          '`utilization()` returns `round(100 * tokens / available, 1)`.',
        ],
        hints: ['`min(range(len(msgs)), key=lambda i: (msgs[i]["priority"], i))` finds lowest priority, oldest first.', 'For sliding, first split into system vs others.'],
        starter: py`
def count_tokens(text):
    return max(1, len(text) // 4)

class ContextWindow:
    def __init__(self, max_tokens=200, reserved=50):
        # TODO: validate reserved < max_tokens, compute available
        self.messages = []

    def add(self, role, content, priority=1):
        self.messages.append({"role": role, "content": content, "priority": priority})

    def tokens(self):
        return sum(count_tokens(m["content"]) for m in self.messages)

    def utilization(self):
        raise NotImplementedError

    def fit(self):
        raise NotImplementedError

    def sliding(self, keep=6):
        raise NotImplementedError


def demo_window():
    ctx = ContextWindow(max_tokens=200, reserved=50)
    ctx.add("system", "You are a compliance-aware support agent. " * 3, priority=10)
    for i in range(8):
        ctx.add("user", f"question {i} " * 8, priority=2)
        ctx.add("assistant", f"tool dump {i} " * 10, priority=1)
    return ctx

if __name__ == "__main__":
    ctx = demo_window()
    print("before", ctx.tokens(), f"{ctx.utilization()}%")
    dropped = ctx.fit()
    print("after", ctx.tokens(), f"{ctx.utilization()}%", "dropped", len(dropped))
`,
        solution: py`
def count_tokens(text):
    return max(1, len(text) // 4)

class ContextWindow:
    def __init__(self, max_tokens=200, reserved=50):
        if reserved >= max_tokens:
            raise ValueError("reserved must be < max_tokens")
        self.max_tokens, self.reserved = max_tokens, reserved
        self.available = max_tokens - reserved
        self.messages = []

    def add(self, role, content, priority=1):
        self.messages.append({"role": role, "content": content, "priority": priority})

    def tokens(self):
        return sum(count_tokens(m["content"]) for m in self.messages)

    def utilization(self):
        return round(100 * self.tokens() / self.available, 1)

    def _ensure_fits(self):
        if self.tokens() > self.available:
            raise ValueError("cannot fit context within budget")

    def fit(self):
        dropped = []
        while self.tokens() > self.available and self.messages:
            i = min(range(len(self.messages)), key=lambda k: (self.messages[k]["priority"], k))
            if self.messages[i]["role"] == "system" and all(m["role"] == "system" for m in self.messages):
                break
            dropped.append(self.messages.pop(i))
        self._ensure_fits()
        return dropped

    def sliding(self, keep=6):
        system = [m for m in self.messages if m["role"] == "system"]
        others = [m for m in self.messages if m["role"] != "system"]
        dropped = others[:-keep] if keep else others[:]
        kept = others[-keep:] if keep else []
        while kept and sum(count_tokens(m["content"]) for m in system + kept) > self.available:
            dropped.append(kept.pop(0))
        keep_ids = {id(m) for m in system + kept}
        self.messages = [m for m in self.messages if id(m) in keep_ids]
        self._ensure_fits()
        return dropped


def demo_window():
    ctx = ContextWindow(max_tokens=200, reserved=50)
    ctx.add("system", "You are a compliance-aware support agent. " * 3, priority=10)
    for i in range(8):
        ctx.add("user", f"question {i} " * 8, priority=2)
        ctx.add("assistant", f"tool dump {i} " * 10, priority=1)
    return ctx

if __name__ == "__main__":
    ctx = demo_window()
    print("before", ctx.tokens(), f"{ctx.utilization()}%")
    dropped = ctx.fit()
    print("after", ctx.tokens(), f"{ctx.utilization()}%", "dropped", len(dropped))
`,
        tests: py`
def test_invalid_budget():
    "reserved >= max_tokens is rejected"
    try:
        ContextWindow(100, 100)
    except ValueError:
        return
    raise AssertionError("expected ValueError")

def test_fit_keeps_system_and_budget():
    "Priority fit lands under budget and keeps the system message"
    ctx = demo_window()
    assert ctx.utilization() > 100
    dropped = ctx.fit()
    assert ctx.tokens() <= ctx.available and ctx.utilization() <= 100
    assert ctx.messages[0]["role"] == "system" and dropped

def test_fit_drops_low_priority_oldest_first():
    "Lowest priority goes first, oldest first among ties"
    ctx = ContextWindow(40, 10)       # available 30
    ctx.add("user", "a" * 40, 2)      # 10 tok
    ctx.add("tool", "b" * 40, 1)      # 10 tok (oldest low)
    ctx.add("tool", "c" * 40, 1)      # 10 tok
    ctx.add("user", "d" * 40, 2)      # 10 tok
    dropped = ctx.fit()
    assert [d["content"][0] for d in dropped] == ["b"]
    assert [m["content"][0] for m in ctx.messages] == ["a", "c", "d"]

def test_sliding_keeps_newest_and_system():
    "Sliding window keeps system + newest messages"
    ctx = demo_window()
    ctx.sliding(keep=4)
    roles = [m["role"] for m in ctx.messages]
    assert roles[0] == "system" and len(ctx.messages) <= 5
    assert ctx.messages[-1]["content"].startswith("tool dump 7")
    assert ctx.tokens() <= ctx.available

def test_cannot_fit_raises():
    "A lone oversized system message cannot fit"
    ctx = ContextWindow(60, 10)
    ctx.add("system", "x" * 400, 10)
    try:
        ctx.fit()
    except ValueError:
        return
    raise AssertionError("expected ValueError")
`,
      },
    ],
    quiz: [
      { q: 'What goes wrong with chronological (FIFO) trimming?', options: ['Nothing', 'It deletes the oldest message first, which is usually the system/policy prompt', 'It is slow', 'It keeps too much'], answer: 1, why: 'Priority trimming protects pinned instructions while dropping noisy tool output.' },
      { q: 'Why reserve tokens out of `max_tokens`?', options: ['For metadata', 'So the model has room to generate its response', 'Providers charge less', 'For caching'], answer: 1, why: 'History and response share the same window.' },
      { q: 'After `fit()`, the window is still over budget. What should happen?', options: ['Return success anyway', 'Raise: never return an over-budget success', 'Truncate the system prompt silently', 'Retry forever'], answer: 1, why: 'A silent over-budget result fails later at the provider, far from the cause.' },
    ],
    checklist: ['Reserved headroom configured per model', 'System/policy messages pinned at max priority', 'Model-specific token counter in production', 'Trim events logged with role/priority/tokens only', 'Alert when tokens_trimmed is zero under overload'],
  },
];
