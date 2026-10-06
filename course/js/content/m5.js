// Module 5 — Knowledge & Evaluation (Lessons 15–17)
const py = String.raw;
const REPO = 'https://github.com/sysdr/production-ai-engineering-p/tree/main';

export default [
  {
    id: 'l15',
    num: 15,
    title: 'Evaluation Framework',
    tagline: 'You cannot judge an agent by reading a few replies. Score it against golden cases.',
    minutes: 60,
    repo: `${REPO}/lesson15/aiam-day15`,
    summary: `
      A scoring service grades outputs against **golden cases** with four metrics: strict **exact match**, soft **contains**,
      lexical **token-F1**, and an offline **LLM-as-judge** heuristic. Scores aggregate into means and a pass rate,
      turning "it feels better" into numbers you can gate releases on.
    `,
    build: [
      'Pure scorer functions registered by name in `METRIC_FNS`',
      'Token-F1 with precision/recall on whitespace tokens',
      'A graded judge stub with the same interface as a real model judge',
      '`evaluate(suite)` → per-case scores, means, pass rate',
    ],
    problem: `
      Lesson 14 made prompts bounded, which is the precondition for fair scoring (no silent truncation).
      Without a fixed suite, a model swap or prompt edit is a guess, and regressions reach users first.
    `,
    flow: [
      ['Golden cases', 'id, prompt, expected, actual'],
      ['Score', 'every case × every metric'],
      ['Pass/fail', 'threshold on the judge score'],
      ['Aggregate', 'means + pass rate under one lock'],
      ['Gate', 'compare to last build, alert on drops'],
    ],
    concepts: [
      ['Strict vs soft correctness', 'Exact match scores 0 for a correct answer wrapped in a sentence; contains accepts it. Reporting both separates *formatting* failures from *knowledge* failures.'],
      ['Token-F1', 'Precision = overlap / actual tokens; recall = overlap / expected tokens; F1 = harmonic mean. Partial credit for verbose-but-correct, penalty for padding.'],
      ['LLM-as-judge', 'Production judges call a stronger model. The stub returns graded scores (0.98 exact, 0.92 contained, 0.45 partial, 0.15 miss, 0.05 refusal): same interface, deterministic, offline.'],
      ['Registration by name', '`METRIC_FNS = {"exact": ..., ...}`. A new metric needs no change to the service, routes or UI loop.'],
      ['Deliberate failures', 'A suite where everything passes cannot detect regressions. Include known-bad cases.'],
    ],
    insights: [
      '**Never ship exact-match alone.** It fails correct answers and pushes teams to fix formatting instead of substance.',
      '**Update sums and means in the same critical section**, or a reader sees a new sum with a stale mean.',
      'Judge fidelity trades against cost and flakiness. Cache and timeout real judges.',
    ],
    pitfalls: ['Exact-match only.', 'Logging prompts in eval output.', 'Empty suites dividing by zero.'],
    examples: [
      ['Model upgrade gate', 'Exact-match falls while contains and judge rise, exposing a formatting change, not a quality loss.'],
      ['Prompt CI', 'An edit meant to shorten answers cuts token-F1 recall by 11 points and fails the build before release.'],
    ],
    labs: [
      {
        id: 'l15-scorers',
        title: 'Four scorers and a suite evaluator',
        minutes: 30,
        goal: 'Implement the scorers and `evaluate()` so a suite produces means and a pass rate.',
        steps: [
          '`normalize(s)`: lowercase, strip, collapse whitespace, remove trailing `.`, `!`, `?`.',
          '`exact_match` → 1.0 if normalized strings are equal; `contains` → 1.0 if normalized expected is in normalized actual.',
          '`token_f1`: whitespace tokens of normalized strings; overlap counted with multiplicity (`Counter &`); 0.0 if no overlap.',
          '`llm_judge`: refusal (actual starts with "i can\'t", "i cannot", "sorry") → 0.05; exact → 0.98; contains → 0.92; token_f1 ≥ 0.3 → 0.45; else 0.15.',
          '`evaluate(cases, threshold=0.5)`: score every case with every `METRIC_FNS`; a case passes when `llm_judge >= threshold`. Return `{"results", "means": {metric: mean rounded to 3}, "pass_rate"}`. Empty suite → means all 0.0, pass_rate 0.0.',
        ],
        hints: ['`Counter(a) & Counter(b)` gives overlapping tokens with min counts.', 'Order matters in the judge: check refusal first.'],
        starter: py`
from collections import Counter

def normalize(s):
    raise NotImplementedError

def exact_match(case):
    raise NotImplementedError

def contains(case):
    raise NotImplementedError

def token_f1(case):
    raise NotImplementedError

def llm_judge(case):
    raise NotImplementedError

METRIC_FNS = {"exact": exact_match, "contains": contains, "token_f1": token_f1, "llm_judge": llm_judge}

def evaluate(cases, threshold=0.5):
    raise NotImplementedError


SUITE = [
    {"id": "c1", "expected": "Paris", "actual": "Paris"},
    {"id": "c2", "expected": "4", "actual": "The answer is 4."},
    {"id": "c3", "expected": "transformer architecture", "actual": "LLMs use a transformer architecture with attention"},
    {"id": "c4", "expected": "blue whale", "actual": "The largest animal is the blue whale"},
    {"id": "c5", "expected": "1969", "actual": "I cannot answer that."},
    {"id": "c6", "expected": "Canberra", "actual": "Sydney"},
]

if __name__ == "__main__":
    r = evaluate(SUITE)
    print(r["means"], f"pass rate {r['pass_rate']:.1%}")
`,
        solution: py`
from collections import Counter

def normalize(s):
    return " ".join(s.lower().strip().split()).rstrip(".!?")

def exact_match(case):
    return 1.0 if normalize(case["actual"]) == normalize(case["expected"]) else 0.0

def contains(case):
    return 1.0 if normalize(case["expected"]) in normalize(case["actual"]) else 0.0

def token_f1(case):
    a, e = normalize(case["actual"]).split(), normalize(case["expected"]).split()
    overlap = sum((Counter(a) & Counter(e)).values())
    if not overlap:
        return 0.0
    precision, recall = overlap / len(a), overlap / len(e)
    return 2 * precision * recall / (precision + recall)

REFUSALS = ("i can't", "i cannot", "sorry")

def llm_judge(case):
    if normalize(case["actual"]).startswith(REFUSALS):
        return 0.05
    if exact_match(case):
        return 0.98
    if contains(case):
        return 0.92
    if token_f1(case) >= 0.3:
        return 0.45
    return 0.15

METRIC_FNS = {"exact": exact_match, "contains": contains, "token_f1": token_f1, "llm_judge": llm_judge}

def evaluate(cases, threshold=0.5):
    results = []
    sums = {name: 0.0 for name in METRIC_FNS}
    passed = 0
    for case in cases:
        scores = {name: fn(case) for name, fn in METRIC_FNS.items()}
        ok = scores["llm_judge"] >= threshold
        passed += ok
        for name, v in scores.items():
            sums[name] += v
        results.append({"id": case["id"], "scores": scores, "passed": ok})
    n = len(cases)
    return {
        "results": results,
        "means": {name: round(s / n, 3) if n else 0.0 for name, s in sums.items()},
        "pass_rate": passed / n if n else 0.0,
    }


SUITE = [
    {"id": "c1", "expected": "Paris", "actual": "Paris"},
    {"id": "c2", "expected": "4", "actual": "The answer is 4."},
    {"id": "c3", "expected": "transformer architecture", "actual": "LLMs use a transformer architecture with attention"},
    {"id": "c4", "expected": "blue whale", "actual": "The largest animal is the blue whale"},
    {"id": "c5", "expected": "1969", "actual": "I cannot answer that."},
    {"id": "c6", "expected": "Canberra", "actual": "Sydney"},
]

if __name__ == "__main__":
    r = evaluate(SUITE)
    print(r["means"], f"pass rate {r['pass_rate']:.1%}")
`,
        tests: py`
def test_exact_vs_contains():
    "Exact is strict, contains is soft"
    c = {"expected": "4", "actual": "The answer is 4."}
    assert exact_match(c) == 0.0 and contains(c) == 1.0
    assert exact_match({"expected": "Paris", "actual": "  paris. "}) == 1.0

def test_token_f1():
    "Token-F1 gives partial credit"
    c = {"expected": "transformer architecture", "actual": "a transformer architecture with attention"}
    # overlap 2, precision 2/5, recall 2/2 -> f1 = 0.5714...
    assert abs(token_f1(c) - 4/7) < 1e-9
    assert token_f1({"expected": "x", "actual": "y"}) == 0.0

def test_judge_grades():
    "Judge returns graded scores"
    assert llm_judge({"expected": "a", "actual": "a"}) == 0.98
    assert llm_judge({"expected": "a b", "actual": "it is a b"}) == 0.92
    assert llm_judge({"expected": "1969", "actual": "Sorry, I can't."}) == 0.05
    assert llm_judge({"expected": "Canberra", "actual": "Sydney"}) == 0.15

def test_suite_means_and_pass_rate():
    "Suite aggregates means and pass rate"
    r = evaluate(SUITE)
    assert r["means"]["exact"] == 0.167 and r["means"]["contains"] == 0.667
    assert abs(r["pass_rate"] - 4/6) < 1e-9
    assert [x["passed"] for x in r["results"]] == [True, True, True, True, False, False]

def test_empty_suite():
    "Empty suite does not divide by zero"
    r = evaluate([])
    assert r["pass_rate"] == 0.0 and r["means"]["exact"] == 0.0
`,
      },
    ],
    quiz: [
      { q: 'Exact-match drops 30 points after a model upgrade, but contains and judge scores rise. Most likely?', options: ['The new model is worse', 'The new model formats answers differently (e.g. full sentences) but is correct', 'The suite is broken', 'Token-F1 is wrong'], answer: 1, why: 'Reporting strict and soft metrics together separates formatting from knowledge.' },
      { q: 'Why include deliberately failing cases in a suite?', options: ['To lower the score', 'A suite where everything passes cannot detect regressions or prove the failure path works', 'Graders require it', 'For speed'], answer: 1, why: 'You need signal in both directions.' },
      { q: 'What does token-F1 penalise that contains does not?', options: ['Wrong casing', 'Padding: extra unrelated tokens lower precision', 'Short answers', 'Numbers'], answer: 1, why: 'Contains is satisfied by any superset; F1 rewards concise, complete answers.' },
    ],
    checklist: ['Golden suite versioned with the code', 'Strict + soft + judge metrics reported together', 'Known-bad cases included', 'Regression alert on pass-rate drop between builds', 'Case IDs and scores logged, never prompts'],
  },

  {
    id: 'l16',
    num: 16,
    title: 'Vector Store & RAG',
    tagline: 'Generation invents answers when knowledge is missing. Retrieval grounds them in evidence.',
    minutes: 60,
    repo: `${REPO}/lesson16/aiam-day16`,
    summary: `
      You build an in-memory vector store with **TF-IDF embeddings**, **cosine similarity** and **top-k** retrieval.
      It is small enough to understand completely, and it teaches the same geometry production ANN indexes approximate.
      A hit threshold separates *any* result from a *relevant* one.
    `,
    build: [
      'A tokenizer with light plural stemming',
      'Sparse TF-IDF vectors as dicts',
      'Cosine similarity and ranked top-k search',
      'A lazy index rebuilt only after writes, plus hit-rate metrics',
    ],
    problem: `
      Lesson 15 made quality measurable. Without retrieval, eval measures hallucination, not knowledge access.
      Keyword search misses paraphrase; vector ranking recovers semantic neighbours and returns ranked evidence for the prompt.
    `,
    flow: [
      ['Ingest', 'add documents → invalidate index'],
      ['Query', 'tokenise + TF-IDF vector'],
      ['Score', 'cosine vs every document'],
      ['Rank', 'sort desc, take top k'],
      ['Ground', 'top-k text into the prompt; hit if top-1 ≥ threshold'],
    ],
    concepts: [
      ['TF-IDF as a sparse embedding', 'Term frequency marks local importance; inverse document frequency down-weights words that appear everywhere. Sparse dicts suit small corpora.'],
      ['Cosine similarity', 'Compares direction, not length, so long documents do not win just by being long. No shared terms → 0.0, an honest miss.'],
      ['Lazy rebuild', 'Adding a document clears the vectors; the next search rebuilds. Correct and cheap when writes are rare.'],
      ['Hit threshold', 'Top-1 above a floor counts as a hit. Tuning `k` without a threshold hides misses.'],
      ['Same interface, better engine', 'Swap TF-IDF for dense embeddings + ANN behind the same `search(query, k)`; prompts and dashboards do not change.'],
    ],
    insights: [
      '**Sparse lexical retrieval misses paraphrase** that dense embeddings catch.',
      '**Retrieval without metrics** cannot separate index rot from prompt failure.',
      'Alert when hit rate collapses after an ingest or docs migration.',
    ],
    pitfalls: ['No hit threshold.', 'Logging full documents.', 'Rebuilding the index on every query.'],
    examples: [
      ['Support knowledge base', 'A ticket bot retrieves policy paragraphs first; a hit-rate alert catches a docs migration before wrong refunds ship.'],
      ['Internal code RAG', 'Top-1 falls after synonym-heavy rewrites; switching to dense embeddings behind the same `/search` restores ranking.'],
    ],
    labs: [
      {
        id: 'l16-tfidf',
        title: 'TF-IDF vector store with top-k search',
        minutes: 30,
        goal: 'Implement tokenise, TF-IDF, cosine and `VectorStore.search()`.',
        steps: [
          '`tokenise(text)`: lowercase words via `re.findall(r"[a-z0-9]+")`, drop `STOPWORDS`, strip a trailing `s` from words longer than 3 chars.',
          '`tfidf(tokens, df, n)`: term counts `tf`, then `{w: tf[w] * log((n + 1) / (df.get(w, 0) + 1) + 1)}`.',
          '`cosine(a, b)`: dot product over shared keys / (‖a‖ × ‖b‖); 0.0 if either is empty.',
          '`VectorStore.add(text)` appends and invalidates `_vecs`. `_build()` computes `df` across docs and each doc vector.',
          '`search(query, k)` returns up to `k` `{"score", "text"}` sorted by score desc; updates `queries` and `hits` (top-1 score ≥ `hit_threshold`). Empty store → `[]`.',
        ],
        hints: ['`df[w]` = number of documents containing `w` (use `set(tokens)` per doc).', 'Norm: `math.sqrt(sum(v*v for v in a.values()))`.'],
        starter: py`
import math
import re
from collections import Counter

STOPWORDS = {"the", "a", "an", "is", "are", "of", "to", "and", "in", "for", "on", "how", "what", "do", "does", "with"}

def tokenise(text):
    raise NotImplementedError

def tfidf(tokens, df, n):
    raise NotImplementedError

def cosine(a, b):
    raise NotImplementedError

class VectorStore:
    def __init__(self, hit_threshold=0.2):
        self.docs = []
        self._vecs = None
        self._df = {}
        self.hit_threshold = hit_threshold
        self.queries = 0
        self.hits = 0

    def add(self, text):
        raise NotImplementedError

    def _build(self):
        raise NotImplementedError

    def search(self, query, k=3):
        raise NotImplementedError


CORPUS = [
    "Transformers use self-attention to model relationships between tokens.",
    "Vector databases store embeddings and support nearest neighbour search.",
    "RBAC grants permissions to roles, and users inherit permissions from roles.",
    "Prompt injection tries to override system instructions with user content.",
    "Token buckets throttle requests while allowing short bursts.",
    "Cosine similarity compares the angle between two embedding vectors.",
]

if __name__ == "__main__":
    vs = VectorStore()
    for d in CORPUS:
        vs.add(d)
    for r in vs.search("how do I search embeddings in vector databases?"):
        print(f"{r['score']:.2f}  {r['text']}")
`,
        solution: py`
import math
import re
from collections import Counter

STOPWORDS = {"the", "a", "an", "is", "are", "of", "to", "and", "in", "for", "on", "how", "what", "do", "does", "with"}

def tokenise(text):
    out = []
    for w in re.findall(r"[a-z0-9]+", text.lower()):
        if w in STOPWORDS:
            continue
        if len(w) > 3 and w.endswith("s"):
            w = w[:-1]
        out.append(w)
    return out

def tfidf(tokens, df, n):
    tf = Counter(tokens)
    return {w: tf[w] * math.log((n + 1) / (df.get(w, 0) + 1) + 1) for w in tf}

def cosine(a, b):
    if not a or not b:
        return 0.0
    dot = sum(v * b[k] for k, v in a.items() if k in b)
    na = math.sqrt(sum(v * v for v in a.values()))
    nb = math.sqrt(sum(v * v for v in b.values()))
    return dot / (na * nb) if na and nb else 0.0

class VectorStore:
    def __init__(self, hit_threshold=0.2):
        self.docs = []
        self._vecs = None
        self._df = {}
        self.hit_threshold = hit_threshold
        self.queries = 0
        self.hits = 0

    def add(self, text):
        self.docs.append(text)
        self._vecs = None

    def _build(self):
        toks = [tokenise(d) for d in self.docs]
        df = Counter()
        for t in toks:
            df.update(set(t))
        self._df = dict(df)
        self._vecs = [tfidf(t, self._df, len(self.docs)) for t in toks]

    def search(self, query, k=3):
        self.queries += 1
        if not self.docs:
            return []
        if self._vecs is None:
            self._build()
        qv = tfidf(tokenise(query), self._df, len(self.docs))
        ranked = sorted(range(len(self.docs)), key=lambda i: -cosine(qv, self._vecs[i]))
        results = [{"score": cosine(qv, self._vecs[i]), "text": self.docs[i]} for i in ranked[:k]]
        if results and results[0]["score"] >= self.hit_threshold:
            self.hits += 1
        return results


CORPUS = [
    "Transformers use self-attention to model relationships between tokens.",
    "Vector databases store embeddings and support nearest neighbour search.",
    "RBAC grants permissions to roles, and users inherit permissions from roles.",
    "Prompt injection tries to override system instructions with user content.",
    "Token buckets throttle requests while allowing short bursts.",
    "Cosine similarity compares the angle between two embedding vectors.",
]

if __name__ == "__main__":
    vs = VectorStore()
    for d in CORPUS:
        vs.add(d)
    for r in vs.search("how do I search embeddings in vector databases?"):
        print(f"{r['score']:.2f}  {r['text']}")
`,
        tests: py`
def _store():
    vs = VectorStore()
    for d in CORPUS:
        vs.add(d)
    return vs

def test_tokenise():
    "Tokeniser lowercases, drops stopwords, stems plurals"
    assert tokenise("The Embeddings are in Vectors!") == ["embedding", "vector"]
    assert tokenise("bus is") == ["bus"]

def test_cosine():
    "Cosine basics"
    assert abs(cosine({"a": 1}, {"a": 3}) - 1.0) < 1e-9
    assert cosine({"a": 1}, {"b": 1}) == 0.0 and cosine({}, {"a": 1}) == 0.0

def test_semantic_query_ranks_right_doc():
    "Embedding query ranks the vector DB doc first"
    top = _store().search("how do I search embeddings in vector databases?", k=2)
    assert top[0]["text"].startswith("Vector databases") and top[0]["score"] > top[1]["score"]

def test_rbac_and_injection():
    "Other topics retrieve the right evidence"
    vs = _store()
    assert "RBAC" in vs.search("which role grants permission")[0]["text"]
    assert "injection" in vs.search("override system instructions")[0]["text"]

def test_hits_and_misses():
    "Hit rate counts only relevant top-1 results"
    vs = _store()
    vs.search("token bucket burst")
    vs.search("zebra giraffe safari")
    assert vs.queries == 2 and vs.hits == 1

def test_lazy_rebuild_and_empty():
    "Empty store returns []; add invalidates the index"
    vs = VectorStore()
    assert vs.search("x") == []
    vs.add("alpha beta"); vs.search("alpha")
    vs.add("gamma delta")
    assert vs._vecs is None
    assert vs.search("gamma")[0]["text"] == "gamma delta"
`,
      },
    ],
    quiz: [
      { q: 'Why cosine similarity instead of raw dot product?', options: ['Faster', 'It compares direction, so long documents do not score higher just for being long', 'It handles stopwords', 'It is required by TF-IDF'], answer: 1, why: 'Normalising by vector length removes the length bias.' },
      { q: 'What does IDF do?', options: ['Counts total words', 'Down-weights terms that appear in many documents', 'Removes plurals', 'Sorts results'], answer: 1, why: 'Common words carry little signal about which document is relevant.' },
      { q: 'Hit rate collapses right after a docs migration. First suspicion?', options: ['The LLM got worse', 'Documents were dropped or changed format during ingest (index coverage)', 'Users ask harder questions', 'Cosine is broken'], answer: 1, why: 'Retrieval metrics localise failures to the index before you blame the prompt.' },
    ],
    checklist: ['Hit threshold defined and monitored', 'Same search(query, k) interface for future dense/ANN swap', 'Ingest size validated; /add authenticated', 'Logs store query hash + top-1 score, not documents', 'Alert on hit-rate collapse after ingest'],
  },

  {
    id: 'l17',
    num: 17,
    title: 'Fine-tuning Pipeline',
    tagline: 'Data hygiene gates fine-tuning quality more than any learning-rate table.',
    minutes: 50,
    repo: `${REPO}/lesson17/aiam-day17`,
    summary: `
      Prompting alone cannot teach style or domain phrasing at scale. You build the **data gate** before GPU spend:
      chat-format examples (system → user → assistant), role-order validation, a deterministic seeded **80/20 train/val split**,
      and JSONL output that trainers accept.
    `,
    build: [
      '`make_example()` in chat JSONL format',
      '`validate_example()` returning a list of errors (role order, empty content)',
      'A seeded, reproducible `train_val_split()` that excludes invalid rows',
      'JSONL serialisation and a pipeline summary with valid rate',
    ],
    problem: `
      Trainers silently drop or mis-label malformed rows, wasting epochs. A holdout that contains broken rows lies about generalisation.
      Lesson 16's retrieved Q&A pairs become training data, so ranking failures become data problems here.
    `,
    flow: [
      ['Curated pairs', 'question + approved answer'],
      ['Build rows', '{"messages": [system, user, assistant]}'],
      ['Validate', 'roles, order, non-empty content'],
      ['Split', 'seeded shuffle, 80/20, valid rows only'],
      ['Write', 'train.jsonl / val.jsonl + metrics'],
    ],
    concepts: [
      ['Chat JSONL', 'One object per line with a `messages` array. System first, assistant last, so the loss aligns with the reply.'],
      ['Validate before you train', 'Wrong first/last roles or empty content waste GPU time on rows the trainer ignores or mislearns.'],
      ['Deterministic split', '`random.Random(seed).shuffle()` makes laptops and CI produce the same split. Same data, same metrics.'],
      ['Drop invalid by default', 'Only passing rows enter train/val. Including broken rows is an explicit opt-in for negative tests.'],
      ['Valid rate as a metric', 'A sudden drop (e.g. a CSV export bug dropping assistant replies) should alert before the overnight GPU job.'],
    ],
    insights: [
      '**Skipping validation burns GPU** on rows that never contribute.',
      'Use a local `random.Random(seed)`, never the global `random.seed()`, so other code cannot change your split.',
      'Keep the validate/split contract when moving to object storage and a managed trainer.',
    ],
    pitfalls: ['Invalid rows leaking into the validation split.', 'Unseeded shuffles (non-reproducible metrics).', 'PII in completions.'],
    examples: [
      ['Bank support tone', 'Role validation rejects rows missing assistant completions after a CSV bug, preventing empty-answer training.'],
      ['Internal copilot SFT', 'Valid-rate alerts fire when system prompts are dropped; fixing order restores the split before the GPU job.'],
    ],
    labs: [
      {
        id: 'l17-dataset',
        title: 'Validate, split, and serialise chat data',
        minutes: 25,
        goal: 'Build the data gate: validation errors, a seeded split of valid rows, and JSONL output.',
        steps: [
          '`make_example(q, a, system)` → `{"messages": [{"role": "system", ...}, {"role": "user", ...}, {"role": "assistant", ...}]}`.',
          '`validate_example(ex)` returns a list of error strings: `"no messages"`, `"first != system"`, `"last != assistant"`, `"empty content at i"`.',
          '`train_val_split(items, ratio, seed)`: copy, shuffle with `random.Random(seed)`, split at `max(1, int(len * ratio))`. `ratio` must be strictly between 0 and 1.',
          '`run_pipeline(pairs, broken=[])` builds examples, keeps only valid ones, splits 0.8, and returns `{"total", "valid", "valid_rate", "train", "val"}` (train/val are JSONL strings).',
        ],
        hints: ['`"\\n".join(json.dumps(x) for x in rows)` produces JSONL.', 'Check `content.strip()` for emptiness.'],
        starter: py`
import json
import random

SYSTEM = "You are a concise, friendly support agent."

def make_example(question, answer, system=SYSTEM):
    raise NotImplementedError

def validate_example(ex):
    raise NotImplementedError

def train_val_split(items, ratio=0.8, seed=42):
    raise NotImplementedError

def to_jsonl(rows):
    return "\n".join(json.dumps(r) for r in rows)

def run_pipeline(pairs, broken=()):
    raise NotImplementedError


PAIRS = [(f"How do I reset password {i}?", f"Go to Settings > Security > Reset ({i}).") for i in range(9)]
BROKEN = [{"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": ""}]}]

if __name__ == "__main__":
    s = run_pipeline(PAIRS, BROKEN)
    print({k: v for k, v in s.items() if k not in ("train", "val")})
`,
        solution: py`
import json
import random

SYSTEM = "You are a concise, friendly support agent."

def make_example(question, answer, system=SYSTEM):
    return {"messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
        {"role": "assistant", "content": answer},
    ]}

def validate_example(ex):
    msgs = ex.get("messages") or []
    if not msgs:
        return ["no messages"]
    errs = []
    roles = [m.get("role") for m in msgs]
    if roles[0] != "system":
        errs.append("first != system")
    if roles[-1] != "assistant":
        errs.append("last != assistant")
    for i, m in enumerate(msgs):
        if not str(m.get("content", "")).strip():
            errs.append(f"empty content at {i}")
    return errs

def train_val_split(items, ratio=0.8, seed=42):
    if not 0 < ratio < 1:
        raise ValueError("ratio must be between 0 and 1")
    items = list(items)
    random.Random(seed).shuffle(items)
    split = max(1, int(len(items) * ratio))
    return items[:split], items[split:]

def to_jsonl(rows):
    return "\n".join(json.dumps(r) for r in rows)

def run_pipeline(pairs, broken=()):
    examples = [make_example(q, a) for q, a in pairs] + list(broken)
    valid = [e for e in examples if not validate_example(e)]
    train, val = train_val_split(valid, 0.8)
    return {
        "total": len(examples),
        "valid": len(valid),
        "valid_rate": len(valid) / len(examples) if examples else 0.0,
        "train": to_jsonl(train),
        "val": to_jsonl(val),
    }


PAIRS = [(f"How do I reset password {i}?", f"Go to Settings > Security > Reset ({i}).") for i in range(9)]
BROKEN = [{"messages": [{"role": "user", "content": "hi"}, {"role": "assistant", "content": ""}]}]

if __name__ == "__main__":
    s = run_pipeline(PAIRS, BROKEN)
    print({k: v for k, v in s.items() if k not in ("train", "val")})
`,
        tests: py`
import json

def test_make_example_roles():
    "Rows are system → user → assistant"
    ex = make_example("q", "a")
    assert [m["role"] for m in ex["messages"]] == ["system", "user", "assistant"]
    assert validate_example(ex) == []

def test_validation_errors():
    "Broken rows report every error"
    errs = validate_example(BROKEN[0])
    assert "first != system" in errs and "empty content at 1" in errs
    assert validate_example({"messages": []}) == ["no messages"]
    assert "last != assistant" in validate_example({"messages": [{"role": "system", "content": "s"}, {"role": "user", "content": "u"}]})

def test_split_deterministic():
    "Same seed → same split; ratio respected"
    a = train_val_split(range(10), 0.8, seed=7)
    b = train_val_split(range(10), 0.8, seed=7)
    assert a == b and len(a[0]) == 8 and len(a[1]) == 2
    assert sorted(a[0] + a[1]) == list(range(10))

def test_bad_ratio():
    "Ratio must be strictly between 0 and 1"
    for r in (0, 1, 1.5):
        try:
            train_val_split([1, 2], r)
            raise AssertionError(f"ratio {r} accepted")
        except ValueError:
            pass

def test_pipeline_excludes_invalid():
    "Invalid rows never enter train or val"
    s = run_pipeline(PAIRS, BROKEN)
    assert s["total"] == 10 and s["valid"] == 9 and abs(s["valid_rate"] - 0.9) < 1e-9
    rows = [json.loads(x) for x in (s["train"] + "\n" + s["val"]).splitlines() if x]
    assert len(rows) == 9 and all(not validate_example(r) for r in rows)
    assert len(s["train"].splitlines()) > len(s["val"].splitlines())
`,
      },
    ],
    quiz: [
      { q: 'Why must the assistant message be last in each chat row?', options: ['Alphabetical order', 'The training loss is computed on the final assistant reply; a different last role misaligns what the model learns', 'JSONL requires it', 'It saves tokens'], answer: 1, why: 'SFT learns to produce the assistant turn given the preceding context.' },
      { q: 'Why `random.Random(seed)` rather than `random.seed(seed)`?', options: ['Faster', 'A local generator cannot be disturbed by other code using the global random state, so the split stays reproducible', 'It is more random', 'No difference'], answer: 1, why: 'Global state is shared; any import that calls random changes your sequence.' },
      { q: 'Valid rate drops from 98% to 60% overnight. Best response?', options: ['Train anyway', 'Block the training job and inspect the upstream export (e.g. dropped columns)', 'Lower the threshold', 'Increase epochs'], answer: 1, why: 'Data gates exist to stop wasted GPU spend on broken data.' },
    ],
    checklist: ['Every row validated before training', 'Seeded, reproducible split', 'Invalid rows excluded from both splits', 'Valid-rate alert on the pipeline', 'No secrets/PII in completions'],
  },
];
