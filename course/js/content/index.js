// Course map. To add a lesson: append it to the module file, or create a new module and list it here.
import m1 from './m1.js';
import m2 from './m2.js';
import m3 from './m3.js';
import m4 from './m4.js';
import m5 from './m5.js';
import m6 from './m6.js';
import m7 from './m7.js';

export const MODULES = [
  { id: 'kernel', num: 1, title: 'The Secure Agent Kernel', blurb: 'Perimeter, tools and memory: the core every later lesson extends.', lessons: m1 },
  { id: 'guardrails', num: 2, title: 'Guardrails & Operations', blurb: 'Rate limits, cost control, output security, observability and sandboxing.', lessons: m2 },
  { id: 'reasoning', num: 3, title: 'Reasoning & Orchestration', blurb: 'Multi-agent fan-out, the ReAct loop, prompts and structured output.', lessons: m3 },
  { id: 'control', num: 4, title: 'Control Flow & Context', blurb: 'State machines, async pipelines and context window budgets.', lessons: m4 },
  { id: 'knowledge', num: 5, title: 'Knowledge & Evaluation', blurb: 'Measure quality, retrieve evidence, and prepare fine-tuning data.', lessons: m5 },
  { id: 'improve', num: 6, title: 'Continuous Improvement', blurb: 'Prompt optimisation, debate, knowledge graphs and the full LLMOps loop.', lessons: m6 },
  { id: 'enterprise', num: 7, title: 'Enterprise Production', blurb: 'Kubernetes, autoscaling, SOC 2, HIPAA and disaster recovery.', lessons: m7 },
];

export const LESSONS = MODULES.flatMap((m) => m.lessons.map((l) => ({ ...l, module: m })));
export const lessonById = (id) => LESSONS.find((l) => l.id === id);
