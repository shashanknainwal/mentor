// Module 2 — Guardrails & Operations (Lessons 4–7)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering/tree/main';

export default [
  {
    id: 'l04',
    num: 4,
    title: 'Rate Limiting and Cost Control',
    tagline: 'Throughput control and spend control ship together, and both run before the model.',
    minutes: 60,
    repo: `${REPO}/lesson4/aiam-day04`,
    summary: `
      Lesson 3 *observed* usage. Now you **enforce** policy. A token bucket throttles requests per tier
      (\`standard\`, \`premium\`, \`admin\`), and a cost tracker converts input/output tokens into USD **per request**,
      firing budget alerts before the invoice surprises anyone.
    `,
    build: [
      '`TokenBucket`: capacity + refill rate, allows bursts but caps sustained traffic',
      '`RateLimiter`: one bucket per user, sized by tier config (no per-tier code paths)',
      '`CostTracker`: per-user spend from token counts, budget alerts at a threshold',
      'A `check_request()` transaction: throttle → account → emit metrics → decide',
    ],
    problem: `
      Request count alone cannot represent AI cost risk (one request can be 50k tokens), and spend-only limits cannot protect latency under bursts.
      Guardrails must run **before** model invocation, or you pay for the traffic you are trying to stop.
    `,
    flow: [
      ['Request', 'user, tier, est. input/output tokens'],
      ['Token bucket', 'refill by elapsed time, consume 1 or throttle'],
      ['Cost tracker', 'tokens × price → USD, add to user spend'],
      ['Budget check', 'crossed alert threshold? emit alert'],
      ['Decision', 'allowed / throttled + remaining budget'],
    ],
    concepts: [
      ['Token bucket vs fixed window', 'A fixed window lets a user send 2× the limit across a boundary (end of minute 1 + start of minute 2). A bucket refills continuously, allowing controlled bursts but a strict sustained rate.'],
      ['Tiers are config, not code', '`TIERS = {"standard": (capacity, refill), ...}`. New plans are a dict entry, not a new `if` branch.'],
      ['Account per request', 'Convert tokens to dollars as each request completes. Batch reconciliation at month-end is too late to stop a runaway loop.'],
      ['Budget alerts are edge-triggered', 'Alert once when spend crosses 80% of budget, not on every request after. Otherwise on-call drowns.'],
      ['Injected clocks', 'Rate math depends on time. Passing `clock` in makes refill behavior deterministic in tests.'],
    ],
    insights: [
      '**Check before you spend.** Throttling after the model call protects nothing.',
      '**Demos must force state transitions.** If the throttle counter never moves, the integration path is untested.',
      '**Shared state goes to Redis** once you run more than one replica, or each pod enforces its own limit.',
    ],
    pitfalls: [
      'Using fixed windows and getting boundary spikes.',
      'Counting requests but not tokens.',
      'Alerting on every request above budget instead of on the crossing.',
    ],
    examples: [
      ['SaaS copilot plans', 'Free users get a 5-request burst refilling at 1/sec; premium gets 50 at 10/sec. Same code, different config row.'],
      ['Runaway agent loop', 'An agent stuck in a tool loop hits its per-user budget alert in minutes instead of being found on the monthly bill.'],
    ],
    labs: [
      {
        id: 'l04-bucket',
        title: 'Token bucket with tiers',
        minutes: 20,
        goal: 'Implement `TokenBucket.consume()` and a tier-aware `RateLimiter`.',
        steps: [
          'Bucket starts full (`tokens = capacity`).',
          'On `consume(n)`, first refill: `tokens = min(capacity, tokens + elapsed * refill_rate)`, then update `last`.',
          'If `tokens >= n`, subtract and return `True`; otherwise return `False`.',
          '`RateLimiter.check(user, tier)` lazily creates one bucket per user from `TIERS[tier]`. Unknown tier → `ValueError`.',
          'Count `allowed` and `throttled` in `self.stats`.',
        ],
        hints: ['Elapsed = `self.clock() - self.last`.', 'Store buckets in a dict keyed by user id; create with `self.buckets.setdefault(...)` or an `if` check.'],
        starter: py`
import time

TIERS = {  # tier: (capacity, refill_per_second)
    "standard": (5, 1.0),
    "premium": (20, 5.0),
    "admin": (100, 50.0),
}

class TokenBucket:
    def __init__(self, capacity, refill_rate, clock=time.monotonic):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.clock = clock
        self.tokens = float(capacity)
        self.last = clock()

    def consume(self, n=1):
        # TODO: refill based on elapsed time, then try to take n tokens
        raise NotImplementedError

class RateLimiter:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.buckets = {}
        self.stats = {"allowed": 0, "throttled": 0}

    def check(self, user, tier):
        # TODO: validate tier, get/create bucket, consume, update stats
        raise NotImplementedError
`,
        solution: py`
import time

TIERS = {  # tier: (capacity, refill_per_second)
    "standard": (5, 1.0),
    "premium": (20, 5.0),
    "admin": (100, 50.0),
}

class TokenBucket:
    def __init__(self, capacity, refill_rate, clock=time.monotonic):
        self.capacity = capacity
        self.refill_rate = refill_rate
        self.clock = clock
        self.tokens = float(capacity)
        self.last = clock()

    def consume(self, n=1):
        now = self.clock()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.refill_rate)
        self.last = now
        if self.tokens >= n:
            self.tokens -= n
            return True
        return False

class RateLimiter:
    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.buckets = {}
        self.stats = {"allowed": 0, "throttled": 0}

    def check(self, user, tier):
        if tier not in TIERS:
            raise ValueError(f"unknown tier: {tier}")
        if user not in self.buckets:
            cap, rate = TIERS[tier]
            self.buckets[user] = TokenBucket(cap, rate, self.clock)
        ok = self.buckets[user].consume()
        self.stats["allowed" if ok else "throttled"] += 1
        return ok
`,
        tests: py`
def _clock():
    t = {"now": 0.0}
    return t, (lambda: t["now"])

def test_burst_then_throttle():
    "Allows a burst up to capacity, then throttles"
    t, clk = _clock()
    b = TokenBucket(3, 1.0, clk)
    assert [b.consume() for _ in range(4)] == [True, True, True, False]

def test_refill_over_time():
    "Refills continuously by elapsed time"
    t, clk = _clock()
    b = TokenBucket(3, 2.0, clk)
    for _ in range(3): b.consume()
    t["now"] = 0.5          # +1 token
    assert b.consume() and not b.consume()

def test_never_exceeds_capacity():
    "Refill is capped at capacity"
    t, clk = _clock()
    b = TokenBucket(3, 10.0, clk)
    t["now"] = 100
    assert sum(b.consume() for _ in range(10)) == 3

def test_tiers_and_stats():
    "Tier config sizes buckets; stats count both outcomes"
    t, clk = _clock()
    rl = RateLimiter(clk)
    std = sum(rl.check("a", "standard") for _ in range(10))
    prem = sum(rl.check("b", "premium") for _ in range(30))
    assert (std, prem) == (5, 20)
    assert rl.stats == {"allowed": 25, "throttled": 15}

def test_unknown_tier():
    "Unknown tier raises ValueError"
    rl = RateLimiter()
    try:
        rl.check("a", "platinum")
    except ValueError:
        return
    raise AssertionError("expected ValueError")
`,
      },
      {
        id: 'l04-cost',
        title: 'Per-request cost tracking with budget alerts',
        minutes: 15,
        goal: 'Convert tokens to dollars per request and fire **one** alert when a user crosses 80% of budget.',
        steps: [
          '`record(user, input_tokens, output_tokens)` computes cost with `PRICE_PER_1K` (input and output are priced differently).',
          'Add it to `self.spend[user]` and return the request cost rounded to 6 decimals.',
          'When spend crosses `alert_ratio * budget` for the first time, append the user to `self.alerts`.',
          '`remaining(user)` returns `max(0, budget - spend)`.',
        ],
        hints: ['cost = `input/1000 * price_in + output/1000 * price_out`.', 'Edge-trigger: compare spend *before* and *after* this request against the threshold.'],
        starter: py`
PRICE_PER_1K = {"input": 0.003, "output": 0.015}

class CostTracker:
    def __init__(self, budget_usd=1.0, alert_ratio=0.8):
        self.budget = budget_usd
        self.alert_ratio = alert_ratio
        self.spend = {}
        self.alerts = []

    def record(self, user, input_tokens, output_tokens):
        raise NotImplementedError

    def remaining(self, user):
        raise NotImplementedError
`,
        solution: py`
PRICE_PER_1K = {"input": 0.003, "output": 0.015}

class CostTracker:
    def __init__(self, budget_usd=1.0, alert_ratio=0.8):
        self.budget = budget_usd
        self.alert_ratio = alert_ratio
        self.spend = {}
        self.alerts = []

    def record(self, user, input_tokens, output_tokens):
        cost = input_tokens / 1000 * PRICE_PER_1K["input"] + output_tokens / 1000 * PRICE_PER_1K["output"]
        before = self.spend.get(user, 0.0)
        after = before + cost
        self.spend[user] = after
        threshold = self.alert_ratio * self.budget
        if before < threshold <= after:
            self.alerts.append(user)
        return round(cost, 6)

    def remaining(self, user):
        return max(0.0, self.budget - self.spend.get(user, 0.0))
`,
        tests: py`
def test_cost_math():
    "Input and output tokens are priced separately"
    c = CostTracker()
    assert c.record("u", 1000, 1000) == 0.018
    assert abs(c.spend["u"] - 0.018) < 1e-12

def test_remaining():
    "remaining() never goes negative"
    c = CostTracker(budget_usd=0.01)
    c.record("u", 0, 1000)
    assert c.remaining("u") == 0.0 and c.remaining("new") == 0.01

def test_alert_fires_once_on_crossing():
    "Alert fires once when crossing 80% of budget"
    c = CostTracker(budget_usd=0.1)
    c.record("u", 0, 3000)   # 0.045
    assert c.alerts == []
    c.record("u", 0, 3000)   # 0.09 -> crosses 0.08
    c.record("u", 0, 3000)   # still over, no new alert
    assert c.alerts == ["u"]

def test_users_isolated():
    "Spend is tracked per user"
    c = CostTracker()
    c.record("a", 1000, 0); c.record("b", 2000, 0)
    assert c.spend["a"] < c.spend["b"]
`,
      },
    ],
    quiz: [
      { q: 'Why prefer a token bucket over a fixed one-minute window?', options: ['It uses less memory', 'Fixed windows allow ~2× the limit across a window boundary; buckets refill smoothly', 'Buckets need no clock', 'Fixed windows cannot be tiered'], answer: 1, why: 'A burst at 0:59 plus another at 1:00 doubles the effective rate with fixed windows.' },
      { q: 'Where in the pipeline should throttling run?', options: ['After the LLM responds', 'Before the model call, near ingress', 'In the dashboard', 'Nightly batch'], answer: 1, why: 'Guardrails protect capacity and money only if they run before the expensive step.' },
      { q: 'You scale to 4 replicas with in-memory buckets. What happens?', options: ['Limits are enforced exactly', 'Each replica enforces its own limit, so users get up to ~4× the intended rate', 'Requests fail', 'Costs drop'], answer: 1, why: 'Shared counters (Redis) are required for consistent limits across replicas.' },
    ],
    checklist: ['Limits enforced before model invocation', 'Tier policy in config, not code', 'Per-request cost accounting', 'Edge-triggered budget alerts', 'Shared store (Redis) for multi-replica limits'],
  },

  {
    id: 'l05',
    num: 5,
    title: 'Security Hardening',
    tagline: 'Guard what leaves the system: redact secrets and PII, sign payloads with HMAC.',
    minutes: 55,
    repo: `${REPO}/lesson5/aiam-day05`,
    summary: `
      Models can echo secrets or personal data that were in prompts, context or tool results.
      This lesson adds an **egress guard**: scan generated text for API keys, tokens, emails, phones and card numbers, redact them,
      and sign payloads with **HMAC-SHA256** so receivers can detect tampering.
    `,
    build: [
      '`OutputGuard.scan()` → findings by category + a redacted copy, in one pass',
      '`SignatureVerifier` with `sign()` and constant-time `verify()`',
      'Intent-aware metrics: a caught tamper is a **success**, not an error',
    ],
    problem: `
      Lesson 4 enforced limits on what comes **in**. Nothing yet checks what goes **out**.
      Without an egress guard, one tool result containing a customer email or an \`sk-...\` key is shipped straight to the user and your logs.
    `,
    flow: [
      ['Model output', 'raw text from L1 or a tool'],
      ['Scan', 'compiled patterns: secrets + PII'],
      ['Redact', 'replace each match with [CATEGORY]'],
      ['Sign', 'HMAC-SHA256 over the payload'],
      ['Deliver + verify', 'receiver recomputes, compare_digest'],
    ],
    concepts: [
      ['Pattern-based detection', 'Secrets and PII have stable shapes (`sk-...`, `Bearer ...`, emails, 16-digit cards). Compile patterns once; scan every response cheaply.'],
      ['Detect and redact together', 'Detection drives metrics and block decisions; redaction produces safe output. Shipping one without the other is incomplete.'],
      ['HMAC = integrity, not secrecy', 'A shared key produces a signature only key-holders can produce. Anyone can read the payload; nobody can alter it undetected.'],
      ['Constant-time comparison', '`==` stops at the first differing byte, leaking timing. `hmac.compare_digest` takes the same time regardless.'],
      ['Intent-aware status', 'A tampered payload correctly *rejected* is `tamper_caught` (good). An unexpected accept is the real failure.'],
    ],
    insights: [
      '**Never log the raw findings.** Store categories and counts only, or your logs become the leak.',
      '**Fail closed on scan errors.** If the guard crashes, do not ship the unscanned text.',
      '**Coverage vs false positives** is the core tradeoff of regex guards. Tune per category.',
    ],
    pitfalls: [
      'Comparing signatures with `==`.',
      'Scanning only user input, not model output.',
      'Overlapping patterns (a card number inside a phone pattern) producing garbled redactions.',
    ],
    examples: [
      ['Support chatbot', 'Redacts customer emails and card numbers from replies before they are displayed or logged.'],
      ['Webhook integrity', 'A deploy service signs payloads with HMAC; receivers reject forged requests.'],
    ],
    labs: [
      {
        id: 'l05-guard',
        title: 'OutputGuard: scan and redact',
        minutes: 20,
        goal: 'Return findings by category and a redacted string, in one scan.',
        steps: [
          'Compile every pattern in `PATTERNS` once in `__init__`.',
          '`scan(text)` returns `{"counts": {category: n}, "redacted": str, "blocked": bool}`.',
          'Replace each match with `[CATEGORY]` (uppercase category name).',
          '`blocked` is `True` if any **secret** category (`api_key`, `bearer`) matched.',
          'Only categories that matched appear in `counts`.',
        ],
        hints: ['`pattern.subn(repl, text)` returns `(new_text, count)` in one call.', 'Apply secret patterns first so a key is not partially eaten by a broader pattern.'],
        starter: py`
import re

PATTERNS = {  # order matters: secrets first
    "api_key": r"sk-[A-Za-z0-9]{16,}",
    "bearer": r"Bearer\s+[A-Za-z0-9._\-]{10,}",
    "email": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "card": r"\b(?:\d[ -]?){15}\d\b",
    "phone": r"\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b",
}
SECRET_CATEGORIES = {"api_key", "bearer"}

class OutputGuard:
    def __init__(self):
        # TODO: compile patterns
        pass

    def scan(self, text):
        # TODO: counts, redacted text, blocked flag
        raise NotImplementedError


if __name__ == "__main__":
    g = OutputGuard()
    print(g.scan("Mail jane@corp.com, key sk-ABCDEFGHIJKLMNOPQRST"))
`,
        solution: py`
import re

PATTERNS = {  # order matters: secrets first
    "api_key": r"sk-[A-Za-z0-9]{16,}",
    "bearer": r"Bearer\s+[A-Za-z0-9._\-]{10,}",
    "email": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "card": r"\b(?:\d[ -]?){15}\d\b",
    "phone": r"\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b",
}
SECRET_CATEGORIES = {"api_key", "bearer"}

class OutputGuard:
    def __init__(self):
        self.compiled = [(name, re.compile(p)) for name, p in PATTERNS.items()]

    def scan(self, text):
        counts = {}
        for name, pattern in self.compiled:
            text, n = pattern.subn(f"[{name.upper()}]", text)
            if n:
                counts[name] = n
        blocked = any(c in SECRET_CATEGORIES for c in counts)
        return {"counts": counts, "redacted": text, "blocked": blocked}


if __name__ == "__main__":
    g = OutputGuard()
    print(g.scan("Mail jane@corp.com, key sk-ABCDEFGHIJKLMNOPQRST"))
`,
        tests: py`
def test_clean_text_untouched():
    "Clean text passes unchanged"
    r = OutputGuard().scan("The weather is nice.")
    assert r == {"counts": {}, "redacted": "The weather is nice.", "blocked": False}

def test_api_key_blocked():
    "API keys are redacted and block the response"
    r = OutputGuard().scan("use sk-ABCDEFGHIJKLMNOPQRST now")
    assert r["redacted"] == "use [API_KEY] now" and r["blocked"]

def test_pii_redacted_not_blocked():
    "PII is redacted but does not block"
    r = OutputGuard().scan("Email bob@x.io or call 415-555-0199")
    assert r["counts"] == {"email": 1, "phone": 1}
    assert "bob@x.io" not in r["redacted"] and "[PHONE]" in r["redacted"]
    assert not r["blocked"]

def test_card_and_bearer():
    "Cards and bearer tokens are caught"
    r = OutputGuard().scan("card 4111 1111 1111 1111, header Bearer abc.def-ghi_jkl")
    assert r["counts"].get("card") == 1 and r["counts"].get("bearer") == 1

def test_multiple_counts():
    "Counts every occurrence"
    r = OutputGuard().scan("a@b.co c@d.co e@f.co")
    assert r["counts"] == {"email": 3}
`,
      },
      {
        id: 'l05-hmac',
        title: 'HMAC signing and tamper detection',
        minutes: 15,
        goal: 'Sign payloads, verify in constant time, and classify verification outcomes by **intent**.',
        steps: [
          '`sign(payload)` returns the hex HMAC-SHA256 of `payload` (str) with `self.key` (bytes).',
          '`verify(payload, signature)` uses `hmac.compare_digest`.',
          '`check(payload, signature, expect_reject=False)` returns a status string:',
          '  valid + not expecting reject → `"hmac_ok"`; invalid + expecting reject → `"tamper_caught"`;',
          '  invalid + not expecting → `"hmac_fail"`; valid + expecting reject → `"unexpected_accept"`.',
        ],
        hints: ['`hmac.new(key, msg.encode(), hashlib.sha256).hexdigest()`.', 'Write the 4 cases as a small truth table.'],
        starter: py`
import hashlib
import hmac

class SignatureVerifier:
    def __init__(self, key: bytes):
        self.key = key

    def sign(self, payload: str) -> str:
        raise NotImplementedError

    def verify(self, payload: str, signature: str) -> bool:
        raise NotImplementedError

    def check(self, payload, signature, expect_reject=False):
        raise NotImplementedError
`,
        solution: py`
import hashlib
import hmac

class SignatureVerifier:
    def __init__(self, key: bytes):
        self.key = key

    def sign(self, payload: str) -> str:
        return hmac.new(self.key, payload.encode(), hashlib.sha256).hexdigest()

    def verify(self, payload: str, signature: str) -> bool:
        return hmac.compare_digest(self.sign(payload), signature)

    def check(self, payload, signature, expect_reject=False):
        ok = self.verify(payload, signature)
        if ok:
            return "unexpected_accept" if expect_reject else "hmac_ok"
        return "tamper_caught" if expect_reject else "hmac_fail"
`,
        tests: py`
import hashlib, hmac as _h

def test_sign_matches_reference():
    "sign() is standard HMAC-SHA256 hex"
    v = SignatureVerifier(b"k")
    assert v.sign("hello") == _h.new(b"k", b"hello", hashlib.sha256).hexdigest()

def test_verify_roundtrip():
    "A signed payload verifies"
    v = SignatureVerifier(b"secret")
    assert v.verify('{"a":1}', v.sign('{"a":1}'))

def test_tamper_detected():
    "Changing one byte breaks verification"
    v = SignatureVerifier(b"secret")
    sig = v.sign('{"amount":10}')
    assert not v.verify('{"amount":99}', sig)

def test_wrong_key_rejected():
    "A different key cannot forge"
    a, b = SignatureVerifier(b"a"), SignatureVerifier(b"b")
    assert not a.verify("x", b.sign("x"))

def test_intent_statuses():
    "Statuses reflect intent"
    v = SignatureVerifier(b"k")
    good = v.sign("p")
    assert v.check("p", good) == "hmac_ok"
    assert v.check("p2", good, expect_reject=True) == "tamper_caught"
    assert v.check("p2", good) == "hmac_fail"
    assert v.check("p", good, expect_reject=True) == "unexpected_accept"
`,
      },
    ],
    quiz: [
      { q: 'What does an HMAC signature guarantee?', options: ['Confidentiality (nobody can read the payload)', 'Integrity and authenticity (only key-holders could have produced it; changes are detected)', 'Compression', 'That the payload has no PII'], answer: 1, why: 'HMAC proves the payload was not altered by someone without the key. It does not hide the content.' },
      { q: 'Why `hmac.compare_digest` instead of `==`?', options: ['It is faster', 'It runs in constant time, preventing timing attacks that guess the signature byte by byte', 'It handles unicode', '`==` does not work on strings'], answer: 1, why: '`==` returns early on the first mismatch, leaking how many leading bytes were right.' },
      { q: 'The guard found an API key. What should go in your logs?', options: ['The full key so you can rotate it', 'The category (`api_key`) and a count, never the raw value', 'Nothing at all', 'A hash of the user prompt'], answer: 1, why: 'Logging raw findings turns your log pipeline into the leak.' },
    ],
    checklist: ['Output scanned before every response leaves the service', 'Signing keys come from env/secret manager', 'Constant-time signature comparison', 'Logs store categories, never raw findings', 'Guard fails closed on errors'],
  },

  {
    id: 'l06',
    num: 6,
    title: 'Observability Stack',
    tagline: 'Averages hide tail pain. Percentiles and RED metrics expose it.',
    minutes: 55,
    repo: `${REPO}/lesson6/aiam-day06`,
    summary: `
      Production failures are often **gradual latency growth** and **intermittent errors**, not crashes.
      You build structured JSON logs (one document per event), a latency histogram with nearest-rank **p50/p95/p99**,
      and thread-safe **RED** metrics: Rate, Errors, Duration.
    `,
    build: [
      'A JSON log formatter with route, status, latency and request ID (no payloads)',
      'Nearest-rank percentile math and a bounded latency store',
      'A locked `MetricsStore` with RED counters, per-route totals and a recent-events ring',
      'Severity rules that separate *slow success* from *failure*',
    ],
    problem: `
      Lesson 5 protected the output. But you still cannot answer "is the service healthy right now?"
      Without structured events and percentiles, a p99 regression from 300 ms to 4 s stays invisible behind a flat average.
    `,
    flow: [
      ['Request', 'route + work'],
      ['Classify', 'status, latency → INFO / WARNING / ERROR'],
      ['Log', 'one JSON line to stdout with request_id'],
      ['Metrics', 'lock → counters, histogram, events ring'],
      ['Snapshot', 'copy under lock → /metrics → dashboard'],
    ],
    concepts: [
      ['Structured logging', 'One JSON object per event makes every field indexable. Route, status, latency and request ID enable correlation. Payloads are excluded because they may contain private data.'],
      ['Nearest-rank percentile', 'Sort the samples; take index `ceil(p/100 × n) − 1`. Deterministic and easy to test. Production uses bounded histogram buckets to cap memory.'],
      ['RED method', 'Rate (demand), Errors (reliability), Duration (user-visible performance). More throughput is *unhealthy* if errors and p99 rise with it.'],
      ['Locks + snapshots', 'One lock keeps counters, histogram and events coherent. Snapshots return copies so the UI never reads a half-updated state.'],
      ['Never average percentiles', 'Averaging p99s across replicas is mathematically wrong. Aggregate the underlying histograms, then compute.'],
    ],
    insights: [
      '**Telemetry must never break user requests.** Wrap it so failures are swallowed and counted.',
      '**Bound label cardinality.** `route="/users/123"` per user ID will melt Prometheus. Use route templates.',
      'Slow success (WARNING) and failure (ERROR) are different on-call stories. Keep them separate.',
    ],
    pitfalls: ['Logging prompts, completions or auth headers.', 'Unbounded latency lists (memory leak).', 'Averaging percentiles across pods.'],
    examples: [
      ['Model gateway', 'Compares provider p95 latency and error rate, shifting traffic away from a degrading provider before the SLO budget is gone.'],
      ['Retrieval pipeline', 'Correlates request IDs across search, rerank and generation to isolate which stage regressed.'],
    ],
    labs: [
      {
        id: 'l06-red',
        title: 'Percentiles, severity, and a RED metrics store',
        minutes: 25,
        goal: 'Implement nearest-rank percentiles, a severity classifier, JSON log lines and a thread-safe RED store.',
        steps: [
          '`percentile(values, p)`: `0.0` for empty; else `sorted(values)[max(1, ceil(p/100*n)) - 1]`.',
          '`severity(status, latency_ms)`: `ERROR` if status ≥ 400, else `WARNING` if latency ≥ 500, else `INFO`.',
          '`log_line(route, status, latency_ms, request_id)`: a JSON string with those keys plus `level` (no other fields).',
          '`MetricsStore.record(route, status, latency_ms)`: under the lock, update `requests`, `errors` (status ≥ 400), per-route counts, latencies (keep last `max_samples`).',
          '`snapshot()` returns `{requests, errors, error_rate, p50, p95, p99, routes}` as fresh copies.',
        ],
        hints: ['`math.ceil` for the rank.', 'Use a `collections.deque(maxlen=max_samples)` for bounded latencies.', '`json.dumps({...}, sort_keys=True)` keeps output stable.'],
        starter: py`
import json
import math
import threading
from collections import deque

def percentile(values, p):
    raise NotImplementedError

def severity(status, latency_ms):
    raise NotImplementedError

def log_line(route, status, latency_ms, request_id):
    raise NotImplementedError

class MetricsStore:
    def __init__(self, max_samples=1000):
        self._lock = threading.Lock()
        self.requests = 0
        self.errors = 0
        self.routes = {}
        self.latencies = deque(maxlen=max_samples)

    def record(self, route, status, latency_ms):
        raise NotImplementedError

    def snapshot(self):
        raise NotImplementedError


if __name__ == "__main__":
    m = MetricsStore()
    for i, ms in enumerate([20, 30, 40, 900, 35]):
        m.record("/chat", 500 if i == 3 else 200, ms)
    print(m.snapshot())
    print(log_line("/chat", 200, 35, "req-1"))
`,
        solution: py`
import json
import math
import threading
from collections import deque

def percentile(values, p):
    if not values:
        return 0.0
    ordered = sorted(values)
    rank = max(1, math.ceil((p / 100) * len(ordered)))
    return ordered[rank - 1]

def severity(status, latency_ms):
    return "ERROR" if status >= 400 else "WARNING" if latency_ms >= 500 else "INFO"

def log_line(route, status, latency_ms, request_id):
    return json.dumps({
        "level": severity(status, latency_ms),
        "route": route,
        "status": status,
        "latency_ms": latency_ms,
        "request_id": request_id,
    }, sort_keys=True)

class MetricsStore:
    def __init__(self, max_samples=1000):
        self._lock = threading.Lock()
        self.requests = 0
        self.errors = 0
        self.routes = {}
        self.latencies = deque(maxlen=max_samples)

    def record(self, route, status, latency_ms):
        with self._lock:
            self.requests += 1
            if status >= 400:
                self.errors += 1
            self.routes[route] = self.routes.get(route, 0) + 1
            self.latencies.append(latency_ms)

    def snapshot(self):
        with self._lock:
            lat = list(self.latencies)
            return {
                "requests": self.requests,
                "errors": self.errors,
                "error_rate": self.errors / self.requests if self.requests else 0.0,
                "p50": percentile(lat, 50),
                "p95": percentile(lat, 95),
                "p99": percentile(lat, 99),
                "routes": dict(self.routes),
            }


if __name__ == "__main__":
    m = MetricsStore()
    for i, ms in enumerate([20, 30, 40, 900, 35]):
        m.record("/chat", 500 if i == 3 else 200, ms)
    print(m.snapshot())
    print(log_line("/chat", 200, 35, "req-1"))
`,
        tests: py`
import json, threading

def test_percentile_nearest_rank():
    "Nearest-rank percentiles"
    vals = list(range(1, 101))
    assert (percentile(vals, 50), percentile(vals, 95), percentile(vals, 99)) == (50, 95, 99)
    assert percentile([], 99) == 0.0 and percentile([7], 50) == 7

def test_percentiles_ordered():
    "p50 <= p95 <= p99 and tail is visible"
    vals = [10] * 98 + [2000, 3000]
    assert percentile(vals, 50) == 10 and percentile(vals, 99) == 2000

def test_severity():
    "Severity separates slow success from failure"
    assert severity(200, 100) == "INFO"
    assert severity(200, 800) == "WARNING"
    assert severity(503, 50) == "ERROR"

def test_log_line_fields():
    "Log line has exactly the safe fields"
    d = json.loads(log_line("/chat", 200, 42, "r1"))
    assert d == {"level": "INFO", "route": "/chat", "status": 200, "latency_ms": 42, "request_id": "r1"}

def test_store_red_and_copy():
    "RED snapshot is correct and a copy"
    m = MetricsStore()
    for s, ms in [(200, 10), (200, 20), (500, 30), (200, 40)]:
        m.record("/a", s, ms)
    snap = m.snapshot()
    assert snap["requests"] == 4 and snap["errors"] == 1 and snap["error_rate"] == 0.25
    snap["routes"]["/a"] = 999
    assert m.snapshot()["routes"]["/a"] == 4

def test_bounded_samples():
    "Latency samples are bounded"
    m = MetricsStore(max_samples=10)
    for i in range(100):
        m.record("/a", 200, i)
    assert len(m.latencies) == 10 and m.snapshot()["p50"] >= 90

def test_thread_safe():
    "Concurrent records are not lost"
    m = MetricsStore()
    def work():
        for _ in range(500):
            m.record("/t", 200, 1)
    ts = [threading.Thread(target=work) for _ in range(4)]
    try:
        for t in ts: t.start()
        for t in ts: t.join()
    except RuntimeError:  # browsers (Pyodide) cannot start threads
        for _ in range(4): work()
    assert m.snapshot()["requests"] == 2000
`,
      },
    ],
    quiz: [
      { q: 'Average latency is flat at 120 ms, but users complain. What metric most likely reveals the issue?', options: ['Request count', 'p99 latency', 'CPU usage', 'Number of routes'], answer: 1, why: 'Averages hide the long tail. A small fraction of very slow requests shows up in p95/p99.' },
      { q: 'You run 3 replicas. How do you get the service-wide p99?', options: ['Average the three p99 values', 'Take the max p99', 'Merge the underlying histograms/samples, then compute p99', 'Use p50 instead'], answer: 2, why: 'Percentiles are not additive. Aggregate the raw distribution first.' },
      { q: 'Which field should NOT be in a structured request log?', options: ['request_id', 'route', 'latency_ms', 'the full user prompt'], answer: 3, why: 'Prompts can contain PII and secrets. Log metadata only.' },
    ],
    checklist: ['JSON logs with request IDs, no payloads', 'p50/p95/p99 on the dashboard', 'Bounded histograms and label cardinality', 'Alerts on SLO burn rate and tail latency', 'Telemetry failures never fail requests'],
  },

  {
    id: 'l07',
    num: 7,
    title: 'Sandboxed Code Execution',
    tagline: 'Model-written code is untrusted code. Isolate it, deny dangerous imports, and enforce limits.',
    minutes: 65,
    repo: `${REPO}/lesson7/aiam-day07`,
    summary: `
      Agents often produce runnable snippets. Executing them raw is unsafe.
      The reference project runs each snippet in a **child process** with a cleaned environment, an **import deny-list** and a **hard timeout**,
      then classifies the outcome as \`OK\`, \`BLOCKED\`, \`TIMEOUT\` or \`ERROR\`.
    `,
    build: [
      'A deny-list import guard (`os`, `subprocess`, `socket`, …) that still allows normal stdlib',
      'A runaway-loop limit that turns hangs into a structured `TIMEOUT` outcome',
      'Outcome classification and metrics so operators see whether policy or capacity is failing',
    ],
    problem: `
      Model-generated code may read files, spawn shells or open sockets. One busy loop in the API process freezes every user.
      You need containment (blast radius), fail-closed policy, and measurement.
    `,
    flow: [
      ['Submit code', 'POST /execute with timeout bounds'],
      ['Wrap', 'install import guard'],
      ['Isolate', 'child process, clean env, temp file'],
      ['Limit', 'timeout kills runaway loops'],
      ['Classify', 'OK / BLOCKED / TIMEOUT / ERROR → metrics'],
    ],
    concepts: [
      ['Process isolation', 'A crash or busy loop in user code must not corrupt the gateway. The real project uses `subprocess` with a timeout; production adds cgroups, read-only rootfs and no network.'],
      ['Deny-list over allow-list', 'Strict allow-lists break because stdlib modules import helpers transitively (e.g. `collections` pulls `keyword`). Denying escape roots (`os`, `subprocess`, `socket`) keeps useful stdlib working.'],
      ['Timeouts as outcomes', 'A hang becomes a deterministic `TIMEOUT` result. Operators alert on `timeout=True` instead of guessing from missing responses.'],
      ['A deny-list is not a jail', 'Python-level guards are bypassable by a determined attacker. Pair them with OS isolation: separate executor pods, dropped capabilities, default-deny network.'],
      ['In this browser lab', 'Pyodide cannot spawn processes, so the lab enforces limits in-process: a custom `__import__` and a `sys.settrace` step counter. Same contract, different mechanism.'],
    ],
    insights: [
      '**Isolation without measurement invites silent failure.** Count every outcome class.',
      '**Syntax errors are ERROR, not TIMEOUT.** Classification must be precise to be useful.',
      '**Never mount docker.sock** into an executor container. That is root on the host.',
    ],
    pitfalls: ['Running user code in the API worker process.', 'Brittle allow-lists that break `json`/`collections`.', 'Logging full untrusted source code.'],
    examples: [
      ['Coding agent', 'Proposed PR snippets run in ephemeral executors; blocked `subprocess` calls increment policy metrics and never reach CI hosts.'],
      ['Analytics copilot', 'Customer formulas are evaluated server-side; timeouts protect shared capacity from an infinite loop while other tenants keep being served.'],
    ],
    labs: [
      {
        id: 'l07-sandbox',
        title: 'In-process sandbox: import guard + step limit',
        minutes: 30,
        goal: 'Implement `Sandbox.run(code)` returning a `SandboxResult` with outcome `OK`, `BLOCKED`, `TIMEOUT` or `ERROR`.',
        steps: [
          'Build a builtins dict that copies `builtins.__dict__` but replaces `__import__` with a guard that raises `ImportError("Blocked: <name>")` when the **root** module is in `BLOCKED`.',
          'Capture `print` output with `contextlib.redirect_stdout(io.StringIO())`.',
          'Install a `sys.settrace` tracer that counts `"line"` events and raises `StepLimitExceeded` past `max_steps`. Always remove it in `finally`.',
          'Compile first: `SyntaxError` → `ERROR`. Then `exec` with `{"__builtins__": safe_builtins}`.',
          'Map: blocked ImportError → `BLOCKED`; `StepLimitExceeded` → `TIMEOUT`; other exceptions → `ERROR`; success → `OK`.',
        ],
        hints: [
          'Root module: `name.split(".")[0]`.',
          'The tracer must return itself to keep receiving line events: `def tracer(frame, event, arg): ...; return tracer`.',
          'Detect a blocked import with `isinstance(e, ImportError) and str(e).startswith("Blocked:")`.',
        ],
        starter: py`
import builtins
import contextlib
import io
import sys
from dataclasses import dataclass

BLOCKED = {"os", "subprocess", "socket", "shutil", "sys", "ctypes", "importlib", "pathlib"}

class StepLimitExceeded(Exception):
    pass

@dataclass
class SandboxResult:
    outcome: str      # OK | BLOCKED | TIMEOUT | ERROR
    output: str = ""
    error: str = ""

class Sandbox:
    def __init__(self, max_steps=20_000):
        self.max_steps = max_steps
        self.metrics = {"OK": 0, "BLOCKED": 0, "TIMEOUT": 0, "ERROR": 0}

    def _guarded_import(self, name, *args, **kwargs):
        # TODO: block root modules in BLOCKED, else delegate to the real import
        raise NotImplementedError

    def run(self, code):
        # TODO: compile, exec with safe builtins + tracer + captured stdout, classify
        raise NotImplementedError


if __name__ == "__main__":
    sb = Sandbox()
    print(sb.run("import json; print(json.dumps({'ok': 1}))"))
    print(sb.run("import os; os.system('rm -rf /')"))
    print(sb.run("while True: pass"))
    print(sb.metrics)
`,
        solution: py`
import builtins
import contextlib
import io
import sys
from dataclasses import dataclass

BLOCKED = {"os", "subprocess", "socket", "shutil", "sys", "ctypes", "importlib", "pathlib"}

class StepLimitExceeded(Exception):
    pass

@dataclass
class SandboxResult:
    outcome: str      # OK | BLOCKED | TIMEOUT | ERROR
    output: str = ""
    error: str = ""

class Sandbox:
    def __init__(self, max_steps=20_000):
        self.max_steps = max_steps
        self.metrics = {"OK": 0, "BLOCKED": 0, "TIMEOUT": 0, "ERROR": 0}

    def _guarded_import(self, name, *args, **kwargs):
        if name.split(".")[0] in BLOCKED:
            raise ImportError("Blocked: " + name)
        return builtins.__import__(name, *args, **kwargs)

    def _finish(self, outcome, output="", error=""):
        self.metrics[outcome] += 1
        return SandboxResult(outcome, output, error)

    def run(self, code):
        try:
            compiled = compile(code, "<sandbox>", "exec")
        except SyntaxError as e:
            return self._finish("ERROR", error=f"SyntaxError: {e.msg}")
        safe_builtins = dict(builtins.__dict__)
        safe_builtins["__import__"] = self._guarded_import
        steps = 0

        def tracer(frame, event, arg):
            nonlocal steps
            if event == "line":
                steps += 1
                if steps > self.max_steps:
                    raise StepLimitExceeded()
            return tracer

        buf = io.StringIO()
        old_trace = sys.gettrace()
        try:
            with contextlib.redirect_stdout(buf):
                sys.settrace(tracer)
                try:
                    exec(compiled, {"__builtins__": safe_builtins, "__name__": "__sandbox__"})
                finally:
                    sys.settrace(old_trace)
        except StepLimitExceeded:
            return self._finish("TIMEOUT", buf.getvalue(), "TIMED OUT")
        except ImportError as e:
            if str(e).startswith("Blocked:"):
                return self._finish("BLOCKED", buf.getvalue(), str(e))
            return self._finish("ERROR", buf.getvalue(), f"ImportError: {e}")
        except Exception as e:
            return self._finish("ERROR", buf.getvalue(), f"{type(e).__name__}: {e}")
        return self._finish("OK", buf.getvalue())


if __name__ == "__main__":
    sb = Sandbox()
    print(sb.run("import json; print(json.dumps({'ok': 1}))"))
    print(sb.run("import os; os.system('rm -rf /')"))
    print(sb.run("while True: pass"))
    print(sb.metrics)
`,
        tests: py`
def test_ok_with_stdlib():
    "Safe stdlib code runs and output is captured"
    r = Sandbox().run("import json, math, collections\nprint(json.dumps({'r': math.isqrt(49)}))")
    assert r.outcome == "OK" and r.output.strip() == '{"r": 7}', r

def test_blocked_imports():
    "os / subprocess / socket are blocked"
    sb = Sandbox()
    for code in ["import os", "import subprocess", "from socket import socket", "import os.path"]:
        r = sb.run(code)
        assert r.outcome == "BLOCKED", (code, r)
    assert sb.metrics["BLOCKED"] == 4

def test_infinite_loop_times_out():
    "Infinite loops become TIMEOUT"
    r = Sandbox(max_steps=5000).run("x = 0\nwhile True:\n    x += 1")
    assert r.outcome == "TIMEOUT", r

def test_syntax_error_is_error():
    "Syntax errors are ERROR, not TIMEOUT"
    r = Sandbox().run("def broken(:")
    assert r.outcome == "ERROR" and "SyntaxError" in r.error

def test_runtime_error_is_error():
    "Runtime exceptions are ERROR"
    r = Sandbox().run("print('before')\n1/0")
    assert r.outcome == "ERROR" and "ZeroDivisionError" in r.error and "before" in r.output

def test_tracer_removed():
    "The tracer is removed after every run"
    import sys as _s
    sb = Sandbox(max_steps=100)
    sb.run("while True: pass")
    assert _s.gettrace() is None or _s.gettrace().__name__ != "tracer"
`,
      },
    ],
    quiz: [
      { q: 'Why does the reference sandbox use a deny-list rather than an allow-list of imports?', options: ['Deny-lists are more secure', 'Allow-lists break because stdlib modules import helper modules transitively', 'Python does not support allow-lists', 'Performance'], answer: 1, why: 'For example `collections` imports `keyword`. An allow-list must chase every transitive dependency.' },
      { q: 'Is an import deny-list enough to safely run untrusted code in production?', options: ['Yes', 'No: pair it with OS isolation (separate process/pod, cgroups, no network, read-only fs)', 'Only with a timeout', 'Only on Linux'], answer: 1, why: 'Python-level guards can be bypassed. Defense in depth needs OS-level containment.' },
      { q: 'A snippet has a syntax error. Which outcome?', options: ['TIMEOUT', 'BLOCKED', 'ERROR', 'OK'], answer: 2, why: 'Precise classification tells operators whether policy, capacity, or code quality is the issue.' },
    ],
    checklist: ['Executor separate from the public API pod', 'CPU/memory limits (cgroups) and timeouts', 'Default-deny network, read-only rootfs', 'Never mount docker.sock', 'Alert on timeout rate; log outcome + duration, not source'],
  },
];
