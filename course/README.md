# Agentic AI Playbook

A personal, browser-based course on building production AI agents. It has 26 lessons in 7 modules and 31 coding labs. Every lab runs real Python in the browser through [Pyodide](https://pyodide.org), so there is nothing to install.

Each lesson has four tabs:

| Tab | What you do | Time |
|---|---|---|
| **Learn** | Problem, request flow, core concepts, insights, common mistakes, real examples | ~10 min |
| **Build** | Implement the core component in the editor until the tests go green (`Ctrl/⌘+Enter`) | 15–30 min per lab |
| **Quiz** | 3 "why" questions, each with an explanation | ~3 min |
| **Ship** | Run the Dockerized reference project, tick the production checklist, write notes | ~10 min |

Progress, code drafts, checklists and notes are saved in `localStorage`. Back them up from **Progress & data**.

## Modules

1. **The Secure Agent Kernel**: 4-layer architecture, tool execution, memory
2. **Guardrails & Operations**: rate limiting/cost, output security, observability, sandboxing
3. **Reasoning & Orchestration**: multi-agent fan-out, ReAct, prompt engineering, structured output
4. **Control Flow & Context**: state machines, async pipelines, context windows
5. **Knowledge & Evaluation**: eval framework, vector store/RAG, fine-tuning data
6. **Continuous Improvement**: prompt optimisation, debate, knowledge graphs, LLMOps loop
7. **Enterprise Production**: Kubernetes, KEDA autoscaling, SOC 2, HIPAA, disaster recovery

## Run locally

It is a static site: no build step and no dependencies.

```bash
cd course
python3 -m http.server 8080
# open http://localhost:8080
```

ES modules and Web Workers do not work from `file://`, so serve the folder over HTTP.

## Deploy

Every option below serves the `course/` folder as-is. There is **no build command**.

- **Vercel**: New Project → import this repo → *Root Directory* `course` → Framework preset *Other* → Deploy.
- **Netlify**: Add new site → import repo → *Base directory* `course`, *Publish directory* `course`, leave the build command empty.
- **Cloudflare Pages**: Create project → *Build output directory* `course`, no build command.
- **GitHub Pages**: copy `course/` into its own repo (or a `gh-pages` branch) and enable Pages on the root.

At runtime the site loads Pyodide from `cdn.jsdelivr.net` and CodeMirror from `cdnjs.cloudflare.com`. If CodeMirror is blocked, the editor falls back to a plain textarea. To self-host Pyodide, add `?pyodide=/path/to/pyodide/` to the URL. The value is remembered for the session.

## Add a lesson

Lessons are plain data in `js/content/m1.js` … `m7.js`. To add Lesson 27:

1. Append a lesson object to a module file, or create `m8.js` and register it in `js/content/index.js`. Copy any existing lesson as a template.
2. For each lab, write `starter`, `solution`, and `tests`. Tests are `def test_*()` functions (they can be `async`), and the first line of the docstring is the label shown in the UI. Put demo code under `if __name__ == "__main__":`. It runs on **Run** but not during tests.
3. Verify: `node scripts/verify-labs.mjs l27`. This checks that the solution passes and the starter fails.

Labs use the standard library only, so they load fast in Pyodide. Pyodide has no threads or subprocesses, so labs model concurrency with `asyncio`.

## Checks

```bash
node scripts/verify-labs.mjs          # all labs: solution passes, starter fails (uses local python3)
# browser smoke test, with every lab solution run inside real Pyodide:
npm i --prefix /tmp/pw pyodide@0.26.4 codemirror@5.65.16
PYODIDE_DIR=/tmp/pw/node_modules/pyodide CM_DIR=/tmp/pw/node_modules/codemirror node scripts/e2e.mjs
```

The e2e script needs Playwright installed (`npm i playwright`).

## Reference code

The Dockerized reference implementations (FastAPI service, dashboard, tests, scripts) live in
[`sysdr/production-ai-engineering`](https://github.com/sysdr/production-ai-engineering) (lessons 1–7) and
[`sysdr/production-ai-engineering-p`](https://github.com/sysdr/production-ai-engineering-p) (lessons 8+). Each lesson's **Ship** tab links to its folder.
