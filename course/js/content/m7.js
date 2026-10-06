// Module 7 — Enterprise Production (Lessons 22–26)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering-p/tree/main';

export default [
  {
    id: 'l22',
    num: 22,
    title: 'Kubernetes Deployment',
    tagline: 'Manifests are policy: probes, limits, zero-downtime rollouts, and secrets out of ConfigMaps.',
    minutes: 55,
    repo: `${REPO}/lesson22/aiam-day22`,
    summary: `
      Shipping an agent is not a Docker tag. The cluster needs a **Deployment, Service, HPA, ConfigMap and Secret** that encode
      resource bounds, readiness/liveness probes and a rolling update with \`maxUnavailable: 0\`.
      You turn those manifests into a **checkable contract**: a validator that fails the build when a rule is broken.
    `,
    build: [
      'A six-point production checklist validator over parsed manifests',
      'Zero-downtime rule: `RollingUpdate` with `maxUnavailable: 0`',
      'Requests and limits on every container, readiness + liveness probes',
      'HPA bounds sanity, secrets-not-in-ConfigMap, non-root Dockerfile',
    ],
    problem: `
      Lesson 21 decides *what* ships. Something must ship it safely. Unbounded pods starve nodes, missing readiness probes send traffic to
      starting pods, and an \`OPENAI_API_KEY\` in a ConfigMap fails the audit. These are the first things auditors and outages find.
    `,
    flow: [
      ['CI image', 'approved agent build'],
      ['Load manifests', 'Deployment, HPA, ConfigMap, Dockerfile'],
      ['Validate', 'six production rules'],
      ['Apply', 'Namespace → ConfigMap → Secret → Deployment → Service → HPA'],
      ['Roll out', 'new pods ready before old ones leave'],
    ],
    concepts: [
      ['maxUnavailable: 0', 'Old pods stay until new ones pass readiness. Rollouts are slower, but no request hits a missing pod.'],
      ['Readiness vs liveness', 'Readiness = "send me traffic?" (`/health`). Liveness = "restart me?" (`/ping`). Mixing them causes restart storms or traffic to cold pods.'],
      ['Requests and limits', 'Requests let the scheduler pack nodes honestly; limits stop one agent from starving its neighbours.'],
      ['ConfigMap vs Secret', 'ConfigMaps hold editable non-secret config (log level, budget caps). Credentials go in Secrets (sealed or external), never ConfigMaps.'],
      ['Non-root containers', 'A `USER` line in the Dockerfile shrinks the blast radius of a container escape.'],
    ],
    insights: [
      '**Manifests are policy, not decoration.** Validate them in CI like code.',
      'HPA min ≥ 2 keeps one pod available during node drains.',
      'The real project validates YAML with PyYAML; here manifests are already-parsed dicts so the lab runs anywhere.',
    ],
    pitfalls: ['`OPENAI_API_KEY` in a ConfigMap "just for staging".', 'No resource limits.', 'Liveness probe on a slow dependency (restart loops).'],
    examples: [
      ['Fintech support agent', 'Zero-downtime rollout during market hours: `maxUnavailable: 0` and readiness on `/health` keep chats off starting pods.'],
      ['Healthcare intake bot', 'Model keys via sealed secrets; ConfigMap only for log level and budget caps; HPA absorbs daytime clinic load.'],
    ],
    labs: [
      {
        id: 'l22-manifests',
        title: 'Production manifest validator',
        minutes: 25,
        goal: 'Implement `validate_manifests(deployment, hpa, configmap, dockerfile)` returning six named checks and a status.',
        steps: [
          '`zero_downtime`: strategy type `RollingUpdate` and `rollingUpdate.maxUnavailable == 0`.',
          '`resources`: every container has `resources.requests` and `resources.limits`, each with `cpu` and `memory`.',
          '`probes`: every container has `readinessProbe` and `livenessProbe`.',
          '`hpa_bounds`: `2 <= minReplicas <= maxReplicas`. `secrets_not_in_configmap`: no ConfigMap key matches `KEY|SECRET|TOKEN|PASSWORD` (case-insensitive).',
          '`non_root`: Dockerfile has a `USER` line that is not `root`/`0`. Return `{"checks": {...}, "passed": n, "status": "VALIDATED" if all else "FAILED"}`.',
        ],
        hints: ['Containers live at `deployment["spec"]["template"]["spec"]["containers"]`.', 'Use `.get()` chains with `{}` defaults so missing sections fail instead of crashing.', 'For USER: `re.findall(r"^USER\\s+(\\S+)", dockerfile, re.M)` and check the last one.'],
        starter: py`
import copy
import re

DEPLOYMENT = {
    "kind": "Deployment",
    "spec": {
        "replicas": 3,
        "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxSurge": 1, "maxUnavailable": 0}},
        "template": {"spec": {"containers": [{
            "name": "agent",
            "image": "registry.example.com/agent:1.4.2",
            "resources": {"requests": {"cpu": "250m", "memory": "512Mi"}, "limits": {"cpu": "1", "memory": "1Gi"}},
            "readinessProbe": {"httpGet": {"path": "/health", "port": 8000}},
            "livenessProbe": {"httpGet": {"path": "/ping", "port": 8000}},
            "envFrom": [{"configMapRef": {"name": "agent-config"}}, {"secretRef": {"name": "agent-secrets"}}],
        }]}},
    },
}
HPA = {"kind": "HorizontalPodAutoscaler", "spec": {"minReplicas": 2, "maxReplicas": 10}}
CONFIGMAP = {"kind": "ConfigMap", "data": {"LOG_LEVEL": "info", "DAILY_BUDGET_USD": "50"}}
DOCKERFILE = """FROM python:3.12-slim
RUN useradd --create-home agent
WORKDIR /app
COPY . .
USER agent
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
"""

SECRET_KEY = re.compile(r"KEY|SECRET|TOKEN|PASSWORD", re.I)

def validate_manifests(deployment, hpa, configmap, dockerfile):
    raise NotImplementedError


if __name__ == "__main__":
    print(validate_manifests(DEPLOYMENT, HPA, CONFIGMAP, DOCKERFILE))
`,
        solution: py`
import copy
import re

DEPLOYMENT = {
    "kind": "Deployment",
    "spec": {
        "replicas": 3,
        "strategy": {"type": "RollingUpdate", "rollingUpdate": {"maxSurge": 1, "maxUnavailable": 0}},
        "template": {"spec": {"containers": [{
            "name": "agent",
            "image": "registry.example.com/agent:1.4.2",
            "resources": {"requests": {"cpu": "250m", "memory": "512Mi"}, "limits": {"cpu": "1", "memory": "1Gi"}},
            "readinessProbe": {"httpGet": {"path": "/health", "port": 8000}},
            "livenessProbe": {"httpGet": {"path": "/ping", "port": 8000}},
            "envFrom": [{"configMapRef": {"name": "agent-config"}}, {"secretRef": {"name": "agent-secrets"}}],
        }]}},
    },
}
HPA = {"kind": "HorizontalPodAutoscaler", "spec": {"minReplicas": 2, "maxReplicas": 10}}
CONFIGMAP = {"kind": "ConfigMap", "data": {"LOG_LEVEL": "info", "DAILY_BUDGET_USD": "50"}}
DOCKERFILE = """FROM python:3.12-slim
RUN useradd --create-home agent
WORKDIR /app
COPY . .
USER agent
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
"""

SECRET_KEY = re.compile(r"KEY|SECRET|TOKEN|PASSWORD", re.I)

def validate_manifests(deployment, hpa, configmap, dockerfile):
    spec = deployment.get("spec", {})
    strategy = spec.get("strategy", {})
    containers = spec.get("template", {}).get("spec", {}).get("containers", [])

    def has_bounds(c):
        res = c.get("resources", {})
        return all(all(k in res.get(kind, {}) for k in ("cpu", "memory")) for kind in ("requests", "limits"))

    users = re.findall(r"^USER\s+(\S+)", dockerfile or "", re.M)
    hspec = hpa.get("spec", {})
    lo, hi = hspec.get("minReplicas", 0), hspec.get("maxReplicas", 0)
    checks = {
        "zero_downtime": strategy.get("type") == "RollingUpdate"
            and strategy.get("rollingUpdate", {}).get("maxUnavailable") == 0,
        "resources": bool(containers) and all(has_bounds(c) for c in containers),
        "probes": bool(containers) and all("readinessProbe" in c and "livenessProbe" in c for c in containers),
        "hpa_bounds": 2 <= lo <= hi,
        "secrets_not_in_configmap": not any(SECRET_KEY.search(k) for k in configmap.get("data", {})),
        "non_root": bool(users) and users[-1] not in ("root", "0"),
    }
    passed = sum(checks.values())
    return {"checks": checks, "passed": passed, "status": "VALIDATED" if passed == len(checks) else "FAILED"}


if __name__ == "__main__":
    print(validate_manifests(DEPLOYMENT, HPA, CONFIGMAP, DOCKERFILE))
`,
        tests: py`
import copy

def _run(**over):
    args = dict(deployment=copy.deepcopy(DEPLOYMENT), hpa=copy.deepcopy(HPA),
                configmap=copy.deepcopy(CONFIGMAP), dockerfile=DOCKERFILE)
    args.update(over)
    return validate_manifests(**args)

def test_good_manifests_validate():
    "Reference manifests pass all six checks"
    r = _run()
    assert r["status"] == "VALIDATED" and r["passed"] == 6, r

def test_downtime_detected():
    "maxUnavailable > 0 fails zero_downtime"
    d = copy.deepcopy(DEPLOYMENT)
    d["spec"]["strategy"]["rollingUpdate"]["maxUnavailable"] = 1
    r = _run(deployment=d)
    assert not r["checks"]["zero_downtime"] and r["status"] == "FAILED"

def test_missing_limits_and_probe():
    "Missing limits or probes fail"
    d = copy.deepcopy(DEPLOYMENT)
    c = d["spec"]["template"]["spec"]["containers"][0]
    del c["resources"]["limits"]["memory"]
    del c["livenessProbe"]
    r = _run(deployment=d)
    assert not r["checks"]["resources"] and not r["checks"]["probes"]

def test_secret_in_configmap():
    "An API key in a ConfigMap fails"
    r = _run(configmap={"data": {"LOG_LEVEL": "info", "openai_api_key": "sk-..."}})
    assert not r["checks"]["secrets_not_in_configmap"]

def test_root_and_hpa():
    "Root user and bad HPA bounds fail"
    r = _run(dockerfile="FROM python:3.12-slim\nUSER root\n", hpa={"spec": {"minReplicas": 1, "maxReplicas": 10}})
    assert not r["checks"]["non_root"] and not r["checks"]["hpa_bounds"]
    assert not _run(dockerfile="FROM x\n")["checks"]["non_root"]
`,
      },
    ],
    quiz: [
      { q: 'What does `maxUnavailable: 0` guarantee during a rollout?', options: ['Faster rollouts', 'Old pods are only removed after new pods are ready, so capacity never drops', 'No new pods are created', 'Pods never restart'], answer: 1, why: 'Combined with `maxSurge`, it trades rollout speed for zero dropped requests.' },
      { q: 'A slow database makes the liveness probe fail. What happens?', options: ['Nothing', 'Kubernetes restarts healthy pods in a loop; liveness should check the process, not its dependencies', 'Traffic is paused', 'The HPA scales up'], answer: 1, why: 'Dependency checks belong in readiness, not liveness.' },
      { q: 'Where should `OPENAI_API_KEY` live?', options: ['ConfigMap', 'Dockerfile ENV', 'A Secret (sealed/external secrets), injected at runtime', 'In the image'], answer: 2, why: 'ConfigMaps are plain config visible to many; secrets need their own controls.' },
    ],
    checklist: ['Non-root container user', 'Requests and limits on every container', 'Readiness gates traffic; liveness checks the process', 'RollingUpdate with maxUnavailable 0', 'Secrets never in ConfigMaps or images'],
  },

  {
    id: 'l23',
    num: 23,
    title: 'Auto-Scaling with KEDA',
    tagline: 'Scale on queue depth, not CPU. Requests pile up before GPUs get busy.',
    minutes: 50,
    repo: `${REPO}/lesson23/aiam-day23`,
    summary: `
      CPU-based HPA lags behind agent workloads: spikes show up as **queued requests** before inference load rises.
      KEDA scales on \`agent_request_queue_depth\` (exposed via a Prometheus adapter), adds a **business-hours cron floor**,
      **scales to zero** off-hours, and you quantify the **FinOps savings**.
    `,
    build: [
      'Queue-derived replica math: `ceil(depth / threshold)`, capped at max',
      'A cron floor (min replicas during business hours) and scale-to-zero otherwise',
      'A 24-hour simulation and savings vs always-on peak capacity',
      'A ScaledObject validator (min 0, prometheus trigger, cron trigger, cooldown)',
    ],
    problem: `
      Lesson 22 gave you an HPA on CPU/memory. For LLM agents, CPU is a lagging signal and idle pods at 3 a.m. are pure cost.
      Backlog is the leading indicator, and zero is the right replica count when nobody is waiting.
    `,
    flow: [
      ['Prometheus', 'scrapes agent_request_queue_depth'],
      ['Adapter', 'exposes custom.metrics.k8s.io'],
      ['KEDA', 'ScaledObject: prometheus + cron triggers'],
      ['Replicas', 'ceil(depth/threshold), floor, cap, zero'],
      ['FinOps', 'replica-hours vs always-on → savings %'],
    ],
    concepts: [
      ['Queue depth vs CPU', 'Scaling on depth adds capacity while users are waiting, not after latency already spiked.'],
      ['ScaledObject', 'One object governs min/max, cooldown and multiple triggers (Prometheus, cron, SQS, Kafka).'],
      ['Scale-to-zero', 'Cuts idle cost, but adds cold starts. Test cold-start latency against your SLO.'],
      ['Cron floor', 'Keep ≥ 2 replicas during business hours so the first morning request does not pay a cold start.'],
      ['One metric source', 'HPA and KEDA reading the same custom metric avoids conflicting scale decisions.'],
    ],
    insights: [
      '**Backlog beats CPU** for LLM agents.',
      '**Enable KEDA only after the metric is visible** in the custom metrics API, or it scales on nothing.',
      'Tune threshold from historical p95 queue depth, not intuition.',
    ],
    pitfalls: ['Scale-to-zero without cold-start testing.', 'No cooldown → flapping.', 'Unbounded max replicas.'],
    examples: [
      ['SaaS support agent', 'Scales on ticket queue depth; cron keeps two pods in business hours; nights scale to zero, saving ~60% compute.'],
      ['Batch document processor', 'Redis backlog depth triggers scale-out before SLA breach; Grafana and KEDA read the same metric.'],
    ],
    labs: [
      {
        id: 'l23-keda',
        title: 'Queue-driven replicas, cron floor, and savings',
        minutes: 25,
        goal: 'Implement replica math, a 24-hour simulation, and a ScaledObject checklist.',
        steps: [
          '`replicas_for(depth, hour)`: `needed = ceil(depth / threshold)` (0 when depth is 0), capped at `max_replicas`.',
          'During business hours (`floor_start <= hour < floor_end`) the result is at least `cron_floor`; otherwise it may be 0 (scale-to-zero).',
          '`simulate(profile)` maps a 24-item list of queue depths to replica counts.',
          '`savings(profile)`: `always_on = max(replicas) * 24`; `keda = sum(replicas)`; return `round(100 * (1 - keda / always_on), 1)` (0.0 if always_on is 0).',
          '`validate_scaled_object(obj)` returns a dict of checks: `scale_to_zero` (minReplicaCount 0), `prometheus_trigger` (metricName `agent_request_queue_depth`), `cron_floor`, `cooldown` (cooldownPeriod ≥ 60), `max_replicas` (maxReplicaCount ≤ 20).',
        ],
        hints: ['`math.ceil(depth / threshold)`.', 'Find triggers by type: `[t for t in obj["spec"]["triggers"] if t["type"] == "prometheus"]`.'],
        starter: py`
import math

class KedaPolicy:
    def __init__(self, threshold=10, max_replicas=10, cron_floor=2, floor_start=8, floor_end=19):
        self.threshold, self.max_replicas = threshold, max_replicas
        self.cron_floor, self.floor_start, self.floor_end = cron_floor, floor_start, floor_end

    def replicas_for(self, depth, hour):
        raise NotImplementedError

    def simulate(self, profile):
        raise NotImplementedError

    def savings(self, profile):
        raise NotImplementedError

def validate_scaled_object(obj):
    raise NotImplementedError


# hourly queue depth over a day (00:00..23:00)
PROFILE = [0, 0, 0, 0, 0, 0, 2, 8, 25, 60, 85, 90, 70, 65, 80, 75, 50, 30, 12, 4, 0, 0, 0, 0]
SCALED_OBJECT = {
    "kind": "ScaledObject",
    "spec": {
        "minReplicaCount": 0, "maxReplicaCount": 10, "cooldownPeriod": 300,
        "triggers": [
            {"type": "prometheus", "metadata": {"metricName": "agent_request_queue_depth", "threshold": "10"}},
            {"type": "cron", "metadata": {"timezone": "America/New_York", "start": "0 8 * * *", "end": "0 19 * * *", "desiredReplicas": "2"}},
        ],
    },
}

if __name__ == "__main__":
    p = KedaPolicy()
    print(p.simulate(PROFILE))
    print(f"savings: {p.savings(PROFILE)}%")
    print(validate_scaled_object(SCALED_OBJECT))
`,
        solution: py`
import math

class KedaPolicy:
    def __init__(self, threshold=10, max_replicas=10, cron_floor=2, floor_start=8, floor_end=19):
        self.threshold, self.max_replicas = threshold, max_replicas
        self.cron_floor, self.floor_start, self.floor_end = cron_floor, floor_start, floor_end

    def replicas_for(self, depth, hour):
        needed = min(math.ceil(depth / self.threshold), self.max_replicas) if depth > 0 else 0
        if self.floor_start <= hour < self.floor_end:
            needed = max(needed, self.cron_floor)
        return needed

    def simulate(self, profile):
        return [self.replicas_for(d, h) for h, d in enumerate(profile)]

    def savings(self, profile):
        reps = self.simulate(profile)
        always_on = max(reps) * 24 if reps else 0
        if not always_on:
            return 0.0
        return round(100 * (1 - sum(reps) / always_on), 1)

def validate_scaled_object(obj):
    spec = obj.get("spec", {})
    triggers = spec.get("triggers", [])
    prom = [t for t in triggers if t.get("type") == "prometheus"]
    cron = [t for t in triggers if t.get("type") == "cron"]
    return {
        "scale_to_zero": spec.get("minReplicaCount") == 0,
        "prometheus_trigger": any(t.get("metadata", {}).get("metricName") == "agent_request_queue_depth" for t in prom),
        "cron_floor": bool(cron),
        "cooldown": spec.get("cooldownPeriod", 0) >= 60,
        "max_replicas": 0 < spec.get("maxReplicaCount", 0) <= 20,
    }


# hourly queue depth over a day (00:00..23:00)
PROFILE = [0, 0, 0, 0, 0, 0, 2, 8, 25, 60, 85, 90, 70, 65, 80, 75, 50, 30, 12, 4, 0, 0, 0, 0]
SCALED_OBJECT = {
    "kind": "ScaledObject",
    "spec": {
        "minReplicaCount": 0, "maxReplicaCount": 10, "cooldownPeriod": 300,
        "triggers": [
            {"type": "prometheus", "metadata": {"metricName": "agent_request_queue_depth", "threshold": "10"}},
            {"type": "cron", "metadata": {"timezone": "America/New_York", "start": "0 8 * * *", "end": "0 19 * * *", "desiredReplicas": "2"}},
        ],
    },
}

if __name__ == "__main__":
    p = KedaPolicy()
    print(p.simulate(PROFILE))
    print(f"savings: {p.savings(PROFILE)}%")
    print(validate_scaled_object(SCALED_OBJECT))
`,
        tests: py`
def test_replica_math():
    "ceil(depth/threshold), capped"
    p = KedaPolicy()
    assert p.replicas_for(25, 3) == 3 and p.replicas_for(10, 3) == 1 and p.replicas_for(500, 3) == 10

def test_scale_to_zero_off_hours():
    "Zero depth at night → zero replicas"
    assert KedaPolicy().replicas_for(0, 2) == 0

def test_cron_floor():
    "Business hours keep the floor"
    p = KedaPolicy()
    assert p.replicas_for(0, 9) == 2 and p.replicas_for(5, 18) == 2 and p.replicas_for(0, 19) == 0

def test_simulation_and_savings():
    "Daily simulation saves money vs always-on peak"
    p = KedaPolicy()
    reps = p.simulate(PROFILE)
    assert len(reps) == 24 and max(reps) == 9 and reps[0] == 0
    s = p.savings(PROFILE)
    assert 55 < s < 75, s
    assert KedaPolicy(cron_floor=0).savings([0] * 24) == 0.0

def test_scaled_object_checks():
    "Reference ScaledObject passes; broken one fails"
    assert all(validate_scaled_object(SCALED_OBJECT).values())
    bad = {"spec": {"minReplicaCount": 1, "maxReplicaCount": 100, "cooldownPeriod": 10,
                    "triggers": [{"type": "cpu", "metadata": {}}]}}
    assert not any(validate_scaled_object(bad).values())
`,
      },
    ],
    quiz: [
      { q: 'Why scale LLM agents on queue depth rather than CPU?', options: ['CPU metrics are unavailable', 'Queue depth rises as soon as users wait; CPU lags behind inference', 'Queue depth is cheaper to store', 'KEDA cannot read CPU'], answer: 1, why: 'Leading indicators add capacity before latency spikes.' },
      { q: 'What is the main risk of scale-to-zero?', options: ['Higher cost', 'Cold-start latency for the first requests', 'Data loss', 'Security'], answer: 1, why: 'Cron floors during business hours buy predictability.' },
      { q: 'You enable a ScaledObject but replicas never move. First check?', options: ['Increase max replicas', 'Whether the custom metric is actually visible in custom.metrics.k8s.io (adapter mapping)', 'Restart the cluster', 'Lower the threshold to 1'], answer: 1, why: 'KEDA cannot scale on a metric it cannot read.' },
    ],
    checklist: ['minReplicaCount 0 with cold-start SLO tested', 'Prometheus trigger on queue depth', 'Cron floor during business hours', 'Cooldown set to prevent flapping', 'Max replicas capped; savings tracked'],
  },

  {
    id: 'l24',
    num: 24,
    title: 'SOC 2 Compliance: Audit Trail',
    tagline: 'Auditors want proof: attributable actions, immutable logs, and detectable tampering.',
    minutes: 55,
    repo: `${REPO}/lesson24/aiam-day24`,
    summary: `
      Every agent action is written as an **append-only audit entry** whose hash covers its canonical content **and** the previous entry's hash.
      Change any field, delete any entry, or reorder them, and verification fails at that point.
      In production the entries go to **S3 with KMS and Object Lock** (WORM), retained 7 years.
    `,
    build: [
      'Canonical JSON + SHA-256 entry hashes',
      'A linked chain: each entry stores `prev_hash`',
      '`verify_chain()` that reports the first broken index',
      'Tamper simulation: edit a field, verify detection',
    ],
    problem: `
      Mutable application logs fail SOC 2 CC7.1: anyone with DB access can quietly rewrite history.
      Auditors need evidence that is retained, attributable, and provably unmodified.
    `,
    flow: [
      ['Agent action', 'actor, action, resource, ts'],
      ['Canonicalise', 'sorted-key JSON'],
      ['Hash', 'sha256(prev_hash + canonical)'],
      ['Append', 'WORM storage (S3 + KMS + Object Lock)'],
      ['Verify', 'recompute chain, report first break'],
    ],
    concepts: [
      ['Content hash', 'SHA-256 over canonical JSON (sorted keys, no whitespace) catches any field edit.'],
      ['Chain hash', 'Including the previous entry\'s hash links entries. Deleting or reordering breaks every later link.'],
      ['Why both', 'Checking only `prev_hash` pointers lets an attacker edit a field and leave pointers intact. Re-hashing content catches it.'],
      ['WORM storage', 'Object Lock + an IAM deny on `s3:DeleteObject` makes deletion impossible, not just discouraged.'],
      ['Sample in production', 'Verification is linear. Verify sampled ranges per request; run full verification in batch.'],
    ],
    insights: [
      '**Append-only storage plus hashes** beats trusting application database logs.',
      'Map each control (CC6.1 access, CC7.2 monitoring…) to an evidence artifact auditors can sample.',
      'Alert on any verification failure. It is a security incident, not a bug.',
    ],
    pitfalls: ['Verifying pointers without re-hashing content.', 'Non-canonical JSON (key order changes the hash).', 'Audit logs in a mutable table.'],
    examples: [
      ['FinTech copilot', 'Tool calls logged to S3 with KMS; the auditor samples 100 entries with zero tampering; RBAC export proves CC6.1.'],
      ['Healthcare scheduling agent', 'Seven-year retention; a tampered archived entry fails the content-hash check.'],
    ],
    labs: [
      {
        id: 'l24-chain',
        title: 'Tamper-evident hash chain',
        minutes: 25,
        goal: 'Implement `append_entry()` and `verify_chain()` so any edit, deletion or reorder is detected.',
        steps: [
          '`canonical(d)` = `json.dumps(d, sort_keys=True, separators=(",", ":"))`.',
          '`append_entry(chain, record)`: `prev = chain[-1]["entry_hash"]` or `GENESIS`; entry = `{**record, "seq": len(chain), "prev_hash": prev}`.',
          '`entry_hash` = sha256 hex of `canonical(entry without entry_hash)`. Append and return the entry.',
          '`verify_chain(chain)` returns `(True, None)` or `(False, index)` for the first entry whose `prev_hash`, `seq` or recomputed hash is wrong.',
        ],
        hints: ['`{k: v for k, v in e.items() if k != "entry_hash"}` strips the hash before re-hashing.', 'Track `expected_prev` as you walk the chain.'],
        starter: py`
import copy
import hashlib
import json

GENESIS = "0" * 64

def canonical(d):
    raise NotImplementedError

def _hash(entry):
    raise NotImplementedError

def append_entry(chain, record):
    raise NotImplementedError

def verify_chain(chain):
    raise NotImplementedError


EVENTS = [
    {"actor": "alice", "action": "tool_call", "resource": "web_search"},
    {"actor": "alice", "action": "tool_call", "resource": "database_read"},
    {"actor": "bob", "action": "login", "resource": "dashboard"},
    {"actor": "svc-agent", "action": "export", "resource": "report.pdf"},
    {"actor": "admin", "action": "role_change", "resource": "bob:viewer->editor"},
]

if __name__ == "__main__":
    chain = []
    for e in EVENTS:
        append_entry(chain, e)
    print(verify_chain(chain))
    chain[1]["resource"] = "nothing_to_see"
    print(verify_chain(chain))
`,
        solution: py`
import copy
import hashlib
import json

GENESIS = "0" * 64

def canonical(d):
    return json.dumps(d, sort_keys=True, separators=(",", ":"))

def _hash(entry):
    body = {k: v for k, v in entry.items() if k != "entry_hash"}
    return hashlib.sha256(canonical(body).encode()).hexdigest()

def append_entry(chain, record):
    prev = chain[-1]["entry_hash"] if chain else GENESIS
    entry = {**record, "seq": len(chain), "prev_hash": prev}
    entry["entry_hash"] = _hash(entry)
    chain.append(entry)
    return entry

def verify_chain(chain):
    expected_prev = GENESIS
    for i, e in enumerate(chain):
        if e.get("prev_hash") != expected_prev or e.get("seq") != i or e.get("entry_hash") != _hash(e):
            return False, i
        expected_prev = e["entry_hash"]
    return True, None


EVENTS = [
    {"actor": "alice", "action": "tool_call", "resource": "web_search"},
    {"actor": "alice", "action": "tool_call", "resource": "database_read"},
    {"actor": "bob", "action": "login", "resource": "dashboard"},
    {"actor": "svc-agent", "action": "export", "resource": "report.pdf"},
    {"actor": "admin", "action": "role_change", "resource": "bob:viewer->editor"},
]

if __name__ == "__main__":
    chain = []
    for e in EVENTS:
        append_entry(chain, e)
    print(verify_chain(chain))
    chain[1]["resource"] = "nothing_to_see"
    print(verify_chain(chain))
`,
        tests: py`
import copy, hashlib

def _chain():
    c = []
    for e in EVENTS:
        append_entry(c, e)
    return c

def test_canonical_is_order_independent():
    "Canonical JSON ignores key order"
    assert canonical({"b": 1, "a": 2}) == canonical({"a": 2, "b": 1}) == '{"a":2,"b":1}'

def test_links():
    "Entries link to the previous hash"
    c = _chain()
    assert c[0]["prev_hash"] == GENESIS and c[1]["prev_hash"] == c[0]["entry_hash"]
    assert len(c[0]["entry_hash"]) == 64 and verify_chain(c) == (True, None)

def test_field_edit_detected():
    "Editing a field is detected at that entry"
    c = _chain()
    c[1]["resource"] = "nothing_to_see"
    assert verify_chain(c) == (False, 1)

def test_recomputed_hash_breaks_next_link():
    "Re-hashing a tampered entry still breaks the next link"
    c = _chain()
    c[2]["actor"] = "mallory"
    c[2]["entry_hash"] = _hash(c[2])
    assert verify_chain(c) == (False, 3)

def test_delete_and_reorder_detected():
    "Deletion and reordering are detected"
    c = _chain(); del c[1]
    assert verify_chain(c) == (False, 1)
    c = _chain(); c[2], c[3] = c[3], c[2]
    assert verify_chain(c)[0] is False

def test_input_not_mutated():
    "append_entry does not mutate the caller's record"
    rec = {"actor": "x", "action": "y", "resource": "z"}
    snapshot = dict(rec)
    append_entry([], rec)
    assert rec == snapshot
`,
      },
    ],
    quiz: [
      { q: 'An attacker edits entry 7 and recomputes its entry_hash. Where does verification fail?', options: ['It passes', 'At entry 8, whose prev_hash no longer matches', 'At entry 0', 'At the last entry only'], answer: 1, why: 'The chain link carries the old hash forward; changing history breaks the next link.' },
      { q: 'Why canonical JSON with sorted keys?', options: ['Smaller files', 'The same logical record must always produce the same bytes, or hashes differ spuriously', 'Readability', 'Faster parsing'], answer: 1, why: 'Hashes are over bytes; key order must not matter.' },
      { q: 'Which storage setup best supports SOC 2 immutability?', options: ['A Postgres table', 'S3 with KMS encryption, Object Lock (WORM) and an IAM deny on delete', 'Local log files', 'Redis'], answer: 1, why: 'Make deletion impossible and encryption policy-bound.' },
    ],
    checklist: ['KMS-encrypted audit writes', 'Chain verified on samples (and full batch runs)', 'Object Lock / delete denied', '7-year retention lifecycle', 'Controls mapped to evidence (RBAC export, alert history)'],
  },

  {
    id: 'l25',
    num: 25,
    title: 'HIPAA-Ready Agents',
    tagline: 'Detect and redact PHI before it reaches the model or logs, and log off idle sessions at 15 minutes.',
    minutes: 50,
    repo: `${REPO}/lesson25/aiam-day25`,
    summary: `
      Healthcare agents routinely see **Protected Health Information** in prompts, tool inputs and logs.
      HIPAA's technical safeguards (164.312) require unique user identity, PHI-access auditability, integrity, and **automatic logoff**.
      You build a PHI detector/redactor, PHI-tagged audit entries, and a session manager with a **fixed 900-second** timeout.
    `,
    build: [
      '`PHIDetector.scan()` / `redact()` for SSN, MRN, DOB, email and clinical terms',
      'Audit entries tagged with PHI **types**, never raw values',
      '`HIPAASessionManager` with a non-configurable 15-minute idle timeout',
      'A safeguard map: Access, Audit, Integrity, Authentication',
    ],
    problem: `
      Lesson 24 made audit trails tamper-evident. HIPAA adds stricter requirements: PHI must be tagged wherever it appears,
      redacted before model or log sinks, and idle sessions must expire. A "configurable" timeout is a bypass waiting to happen.
    `,
    flow: [
      ['Input', 'prompt / tool payload'],
      ['Scan', 'typed PHI matches'],
      ['Redact', '[SSN], [MRN], [DOB] …'],
      ['Audit', 'entry tagged with PHI types'],
      ['Session', 'touch / assert valid (900 s idle)'],
    ],
    concepts: [
      ['Detection is a gate', 'Regex families catch high-frequency identifiers so pipelines can redact and tag before model/log sinks. It is not a complete privacy program.'],
      ['Typed redaction', '`[MRN]` keeps structure for downstream processing while removing the identifier.'],
      ['Fail-closed tagging', 'If PHI is present, every related audit entry must say so (types only).'],
      ['Fixed timeout', '164.312(a)(1): automatic logoff. A constant 900 s, not a setting someone "temporarily" raises.'],
      ['Missing session = expired', 'Unknown session IDs are treated exactly like expired ones.'],
    ],
    insights: [
      '**Evidence beats policy PDFs.** Dashboards should show PHI detections and auto-logoffs.',
      '**Log PHI types, never values.**',
      'BAAs are required whenever PHI leaves your boundary (including model providers).',
    ],
    pitfalls: ['Detectors without redaction.', 'Configurable or extendable timeouts.', 'Treating dashboard zeros as "healthy idle".'],
    examples: [
      ['Hospital scheduling agent', 'Intake text with MRN and DOB is redacted before the model call; audits mark MRN/DOB; idle sessions expire at 15 minutes.'],
      ['Payer claims assistant', 'Email and SSN in uploaded notes are tagged and redacted; detection and auto-logoff counters feed monthly evidence packs.'],
    ],
    labs: [
      {
        id: 'l25-phi',
        title: 'PHI detector and auto-logoff sessions',
        minutes: 25,
        goal: 'Detect and redact PHI by type, tag audits, and expire idle sessions at exactly 900 s.',
        steps: [
          '`PHIDetector.scan(text)` returns a sorted list of PHI **types** found (keys of `PATTERNS`).',
          '`PHIDetector.redact(text)` replaces each match with `[TYPE]`.',
          '`audit_entry(user_id, text)` returns `{"user_id", "phi": bool, "phi_types": [...], "text": redacted}`.',
          '`HIPAASessionManager.touch(sid, user_id)` records activity at `clock()`. `assert_valid(sid)` raises `PermissionError` if missing or idle ≥ `SESSION_TIMEOUT_SECS` (and removes it, counting `auto_logoffs`).',
          'The timeout is the module constant `SESSION_TIMEOUT_SECS = 900`; the manager must not accept a different timeout.',
        ],
        hints: ['Use a dict `sid -> {"user_id", "last"}`.', 'Pop the session on expiry so it cannot be revived by a later touch without re-auth.'],
        starter: py`
import re
import time

PATTERNS = {
    "SSN": r"\b\d{3}-\d{2}-\d{4}\b",
    "MRN": r"\bMRN[:#\s]*\d{6,10}\b",
    "DOB": r"\b(?:DOB[:\s]*)?\d{2}/\d{2}/\d{4}\b",
    "EMAIL": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "CLINICAL": r"\b(?:diagnosed with|prescribed|HIV|diabetes|chemotherapy)\b",
}
SESSION_TIMEOUT_SECS = 900  # HIPAA 164.312(a)(1): not configurable

class PHIDetector:
    COMPILED = {name: re.compile(p, re.I) for name, p in PATTERNS.items()}

    @classmethod
    def scan(cls, text):
        raise NotImplementedError

    @classmethod
    def redact(cls, text):
        raise NotImplementedError

def audit_entry(user_id, text):
    raise NotImplementedError

class HIPAASessionManager:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.sessions = {}
        self.auto_logoffs = 0

    def touch(self, sid, user_id):
        raise NotImplementedError

    def assert_valid(self, sid):
        raise NotImplementedError


if __name__ == "__main__":
    note = "Patient MRN: 12345678, DOB 04/12/1980, diagnosed with diabetes. Contact jo@clinic.org"
    print(PHIDetector.scan(note))
    print(PHIDetector.redact(note))
`,
        solution: py`
import re
import time

PATTERNS = {
    "SSN": r"\b\d{3}-\d{2}-\d{4}\b",
    "MRN": r"\bMRN[:#\s]*\d{6,10}\b",
    "DOB": r"\b(?:DOB[:\s]*)?\d{2}/\d{2}/\d{4}\b",
    "EMAIL": r"[\w.+-]+@[\w-]+\.[\w.]+",
    "CLINICAL": r"\b(?:diagnosed with|prescribed|HIV|diabetes|chemotherapy)\b",
}
SESSION_TIMEOUT_SECS = 900  # HIPAA 164.312(a)(1): not configurable

class PHIDetector:
    COMPILED = {name: re.compile(p, re.I) for name, p in PATTERNS.items()}

    @classmethod
    def scan(cls, text):
        return sorted(name for name, rx in cls.COMPILED.items() if rx.search(text))

    @classmethod
    def redact(cls, text):
        for name, rx in cls.COMPILED.items():
            text = rx.sub(f"[{name}]", text)
        return text

def audit_entry(user_id, text):
    types = PHIDetector.scan(text)
    return {"user_id": user_id, "phi": bool(types), "phi_types": types, "text": PHIDetector.redact(text)}

class HIPAASessionManager:
    def __init__(self, clock=time.time):
        self.clock = clock
        self.sessions = {}
        self.auto_logoffs = 0

    def touch(self, sid, user_id):
        self.sessions[sid] = {"user_id": user_id, "last": self.clock()}

    def assert_valid(self, sid):
        s = self.sessions.get(sid)
        if s is None:
            raise PermissionError("session expired or unknown")
        if self.clock() - s["last"] >= SESSION_TIMEOUT_SECS:
            self.sessions.pop(sid, None)
            self.auto_logoffs += 1
            raise PermissionError("session expired (automatic logoff)")
        return s["user_id"]


if __name__ == "__main__":
    note = "Patient MRN: 12345678, DOB 04/12/1980, diagnosed with diabetes. Contact jo@clinic.org"
    print(PHIDetector.scan(note))
    print(PHIDetector.redact(note))
`,
        tests: py`
NOTE = "Patient MRN: 12345678, DOB 04/12/1980, SSN 123-45-6789, diagnosed with diabetes. Contact jo@clinic.org"

def test_scan_types():
    "All five PHI types are detected"
    assert PHIDetector.scan(NOTE) == ["CLINICAL", "DOB", "EMAIL", "MRN", "SSN"]
    assert PHIDetector.scan("Schedule a follow-up next week") == []

def test_redact():
    "Redaction removes raw identifiers"
    r = PHIDetector.redact(NOTE)
    for raw in ["12345678", "04/12/1980", "123-45-6789", "jo@clinic.org", "diabetes"]:
        assert raw not in r, raw
    assert "[MRN]" in r and "[SSN]" in r

def test_audit_tags_types_not_values():
    "Audit entries carry types, not raw PHI"
    e = audit_entry("dr_lee", NOTE)
    assert e["phi"] and "SSN" in e["phi_types"] and "123-45-6789" not in str(e)
    assert audit_entry("dr_lee", "hello")["phi"] is False

def test_session_timeout():
    "Idle >= 900s logs off; activity keeps it alive"
    t = {"now": 0}
    m = HIPAASessionManager(clock=lambda: t["now"])
    m.touch("s1", "dr_lee")
    t["now"] = 899
    assert m.assert_valid("s1") == "dr_lee"
    m.touch("s1", "dr_lee")
    t["now"] = 899 + 900
    try:
        m.assert_valid("s1")
        raise AssertionError("should have expired")
    except PermissionError:
        pass
    assert m.auto_logoffs == 1 and "s1" not in m.sessions

def test_unknown_session_and_fixed_timeout():
    "Unknown sessions are rejected; timeout is the 900s constant"
    m = HIPAASessionManager()
    try:
        m.assert_valid("ghost")
        raise AssertionError("unknown session accepted")
    except PermissionError:
        pass
    assert SESSION_TIMEOUT_SECS == 900
    import inspect
    assert "timeout" not in inspect.signature(HIPAASessionManager.__init__).parameters
`,
      },
    ],
    quiz: [
      { q: 'Why is the session timeout a constant rather than a setting?', options: ['Simpler code', 'A configurable value invites "temporary" increases that silently break HIPAA automatic logoff', 'Performance', 'Python limitation'], answer: 1, why: 'Removing the knob removes the bypass.' },
      { q: 'What should a PHI-related audit entry contain?', options: ['The raw SSN for traceability', 'The PHI types detected (e.g. SSN, MRN) and redacted text', 'Nothing about PHI', 'A screenshot'], answer: 1, why: 'Tag types for evidence; never copy raw PHI into logs.' },
      { q: 'Your agent sends redacted prompts to a third-party model API. Is anything else required?', options: ['No', 'A Business Associate Agreement if any PHI could reach them, plus encryption in transit', 'Only a privacy policy', 'Only MFA'], answer: 1, why: 'Regex redaction is a gate, not a guarantee. Contracts and encryption still apply.' },
    ],
    checklist: ['PHI patterns tested (including edge cases)', 'PHI tagged on every related audit entry (types only)', 'Fixed 900 s automatic logoff', 'BAAs and encryption documented', 'Non-root runtime, least-privilege tool RBAC'],
  },

  {
    id: 'l26',
    num: 26,
    title: 'Disaster Recovery: Multi-Region Failover',
    tagline: 'A DR plan that has never been tested is not a DR plan.',
    minutes: 55,
    repo: `${REPO}/lesson26/aiam-day26`,
    summary: `
      Survive a regional outage within budget: primary \`us-east-1\`, standby \`us-west-2\`, **Route 53 health checks** (3 failures × 10 s),
      **RTO < 30 min** (time to serve again) and **RPO < 5 min** (data you can lose, measured by replica lag).
      A quarterly runbook proves it, and the test fails closed if either budget is missed.
    `,
    build: [
      '`RegionTopology` with primary and standby regions',
      '`FailoverSimulator`: detection time from health-check config + promotion warmup = RTO',
      'RPO check from replica lag',
      'A DR checklist that must pass 7/7 to be `VALIDATED`',
    ],
    problem: `
      Lesson 25 enforced PHI controls. A single-region agent is one regional event away from a total outage,
      and "we have a replica somewhere" is not recovery until RTO and RPO are measured against budgets.
    `,
    flow: [
      ['Probe', 'HTTPS /health every 10 s'],
      ['Detect', '3 consecutive failures → unhealthy (~30 s)'],
      ['Promote', 'us-west-2 + RDS replica'],
      ['Measure', 'RTO = detect + warmup; RPO = replica lag'],
      ['Report', 'checklist 7/7 → VALIDATED'],
    ],
    concepts: [
      ['RTO', 'Wall-clock from primary failure to serving traffic in DR: detection (~30 s via Route 53) + warmup. Must be < 30 min.'],
      ['RPO', 'Maximum acceptable data loss. Replica lag is the leading indicator. 60 s lag < 5 min budget.'],
      ['Explicit health-check thresholds', '3 × 10 s avoids flapping without waiting minutes. "Retry until it looks down" hides RTO.'],
      ['Executable runbooks', 'Two operators run the quarterly script independently and file results. Untested steps are not recovery.'],
      ['Fail closed', 'If either budget is missed, the DR test fails, even if DNS flipped quickly.'],
    ],
    insights: [
      '**Untested DR is fiction.**',
      'Hot standby lowers RTO but raises idle cost (the next FinOps conversation).',
      'Watch replica lag spikes *during* promotion: a fast DNS flip with lost data still misses RPO.',
    ],
    pitfalls: ['Health checks that never fail.', 'A standby that cannot actually serve traffic.', 'No documented failback (split-brain risk).'],
    examples: [
      ['US-East outage', 'Route 53 marks primary unhealthy after 30 s; us-west-2 serves; the RDS replica is promoted; RTO about two minutes.'],
      ['Quarterly game day', 'Staging runs the DR test; dashboard shows RTO/RPO pass; results filed, with a ticket for any budget miss.'],
    ],
    labs: [
      {
        id: 'l26-failover',
        title: 'Failover simulator with RTO/RPO budgets',
        minutes: 25,
        goal: 'Simulate a regional failure, measure RTO/RPO, and score the DR checklist.',
        steps: [
          '`detection_secs(cfg)` = `request_interval_secs * failure_threshold`.',
          '`FailoverSimulator.simulate(warmup_secs, replica_lag_secs)`: mark primary unhealthy; if the standby is healthy, promote it (`topology.active = standby`).',
          'RTO = detection + warmup. Return `{"dr_promoted", "active", "rto_secs", "rto_met", "rpo_secs", "rpo_met"}` (met = ≤ target).',
          'If the standby is unhealthy: no promotion, `rto_secs = None`, `rto_met = False`.',
          '`dr_checklist(result, runbook_steps_done)` returns 7 checks: two regions, health check 3×10, promoted, rto_met, rpo_met, runbook complete (7 steps), standby distinct from primary. Status `VALIDATED` only if all pass.',
        ],
        hints: ['Keep `TARGET_RTO_SECS, TARGET_RPO_SECS = 1800, 300` as module constants.', 'Health is a dict on the topology: `{"us-east-1": True, "us-west-2": True}`.'],
        starter: py`
from dataclasses import dataclass, field

ROUTE53_CONFIG = {"request_interval_secs": 10, "failure_threshold": 3}
TARGET_RTO_SECS, TARGET_RPO_SECS = 1800, 300

@dataclass
class RegionTopology:
    primary: str = "us-east-1"
    standby: str = "us-west-2"
    active: str = "us-east-1"
    health: dict = field(default_factory=lambda: {"us-east-1": True, "us-west-2": True})

def detection_secs(cfg=ROUTE53_CONFIG):
    raise NotImplementedError

class FailoverSimulator:
    def __init__(self, topology=None, cfg=ROUTE53_CONFIG):
        self.topology = topology or RegionTopology()
        self.cfg = cfg

    def simulate(self, warmup_secs=15, replica_lag_secs=60):
        raise NotImplementedError

def dr_checklist(result, runbook_steps_done, topology, cfg=ROUTE53_CONFIG):
    raise NotImplementedError


if __name__ == "__main__":
    sim = FailoverSimulator()
    r = sim.simulate()
    print(r)
    print(dr_checklist(r, 7, sim.topology))
`,
        solution: py`
from dataclasses import dataclass, field

ROUTE53_CONFIG = {"request_interval_secs": 10, "failure_threshold": 3}
TARGET_RTO_SECS, TARGET_RPO_SECS = 1800, 300

@dataclass
class RegionTopology:
    primary: str = "us-east-1"
    standby: str = "us-west-2"
    active: str = "us-east-1"
    health: dict = field(default_factory=lambda: {"us-east-1": True, "us-west-2": True})

def detection_secs(cfg=ROUTE53_CONFIG):
    return cfg["request_interval_secs"] * cfg["failure_threshold"]

class FailoverSimulator:
    def __init__(self, topology=None, cfg=ROUTE53_CONFIG):
        self.topology = topology or RegionTopology()
        self.cfg = cfg

    def simulate(self, warmup_secs=15, replica_lag_secs=60):
        t = self.topology
        t.health[t.primary] = False
        promoted = bool(t.health.get(t.standby))
        if promoted:
            t.active = t.standby
            rto = detection_secs(self.cfg) + warmup_secs
        else:
            rto = None
        return {
            "dr_promoted": promoted,
            "active": t.active,
            "rto_secs": rto,
            "rto_met": rto is not None and rto <= TARGET_RTO_SECS,
            "rpo_secs": replica_lag_secs,
            "rpo_met": replica_lag_secs <= TARGET_RPO_SECS,
        }

def dr_checklist(result, runbook_steps_done, topology, cfg=ROUTE53_CONFIG):
    checks = {
        "two_regions": len(topology.health) >= 2,
        "health_check_3x10": cfg["request_interval_secs"] == 10 and cfg["failure_threshold"] == 3,
        "dr_promoted": result["dr_promoted"],
        "rto_met": result["rto_met"],
        "rpo_met": result["rpo_met"],
        "runbook_complete": runbook_steps_done >= 7,
        "distinct_standby": topology.standby != topology.primary,
    }
    passed = sum(checks.values())
    return {"checks": checks, "passed": passed, "status": "VALIDATED" if passed == len(checks) else "FAILED"}


if __name__ == "__main__":
    sim = FailoverSimulator()
    r = sim.simulate()
    print(r)
    print(dr_checklist(r, 7, sim.topology))
`,
        tests: py`
def test_detection():
    "Route 53 detection = 3 × 10 s"
    assert detection_secs() == 30

def test_failover_promotes_and_measures():
    "Primary fails, standby promoted, RTO 45 s, RPO met"
    sim = FailoverSimulator()
    r = sim.simulate(warmup_secs=15, replica_lag_secs=60)
    assert r["dr_promoted"] and r["active"] == "us-west-2"
    assert r["rto_secs"] == 45 and r["rto_met"] and r["rpo_met"]

def test_rpo_miss_fails_closed():
    "Replica lag over 5 min misses RPO and fails validation"
    sim = FailoverSimulator()
    r = sim.simulate(replica_lag_secs=600)
    assert r["dr_promoted"] and not r["rpo_met"]
    assert dr_checklist(r, 7, sim.topology)["status"] == "FAILED"

def test_unhealthy_standby():
    "No promotion when standby is also down"
    topo = RegionTopology()
    topo.health["us-west-2"] = False
    r = FailoverSimulator(topo).simulate()
    assert not r["dr_promoted"] and r["rto_secs"] is None and not r["rto_met"] and r["active"] == "us-east-1"

def test_checklist_validated():
    "7/7 with a complete runbook; incomplete runbook fails"
    sim = FailoverSimulator()
    r = sim.simulate()
    ok = dr_checklist(r, 7, sim.topology)
    assert ok["status"] == "VALIDATED" and ok["passed"] == 7
    assert dr_checklist(r, 5, sim.topology)["checks"]["runbook_complete"] is False
`,
      },
    ],
    quiz: [
      { q: 'DNS failover completes in 2 minutes, but replica lag was 8 minutes at failure time. Did the DR test pass?', options: ['Yes: RTO was met', 'No: RPO (5 min) was missed, so up to 8 minutes of data was lost', 'Partially', 'Only if nobody noticed'], answer: 1, why: 'RTO and RPO are independent budgets; both must pass.' },
      { q: 'With checks every 10 s and a failure threshold of 3, detection takes about…', options: ['10 s', '30 s', '3 min', '10 min'], answer: 1, why: 'Interval × threshold. Explicit numbers make RTO predictable.' },
      { q: 'What makes a DR runbook trustworthy?', options: ['Detailed wiki pages', 'It is executed on schedule (e.g. quarterly) by different operators and results are filed', 'Approval by management', 'Length'], answer: 1, why: 'Only executed steps count as recovery.' },
    ],
    checklist: ['RTO measured in staging against budget', 'Route 53 thresholds explicit (3 × 10 s)', 'Replica lag monitored continuously (RPO)', 'Runbook executed quarterly by two operators', 'Failback documented; failover logs are PHI-free'],
  },
];
