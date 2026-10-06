#!/usr/bin/env node
// Checks every lab: the solution must pass all tests, the starter must fail at least one.
// Usage: node scripts/verify-labs.mjs [lessonId...]
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODULES, LESSONS } from '../js/content/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'labs-'));
const only = process.argv.slice(2);

const driver = `
import asyncio, json, sys
sys.path.insert(0, ${JSON.stringify(join(root, 'js'))})
import harness
code = open(sys.argv[1]).read()
tests = open(sys.argv[2]).read()
print(asyncio.run(harness.run_lab(code, tests)))
`;
writeFileSync(join(dir, 'driver.py'), driver);

function run(code, tests) {
  writeFileSync(join(dir, 'code.py'), code);
  writeFileSync(join(dir, 'tests.py'), tests);
  const out = execFileSync('python3', ['-I', join(dir, 'driver.py'), join(dir, 'code.py'), join(dir, 'tests.py')], {
    encoding: 'utf8', timeout: 60000,
  });
  return JSON.parse(out.trim().split('\n').pop());
}

let failures = 0;
let labs = 0;
const ids = new Set();
for (const m of MODULES) {
  if (!m.lessons.length) { console.error(`module ${m.id} has no lessons`); failures++; }
}
for (const lesson of LESSONS) {
  if (only.length && !only.includes(lesson.id)) continue;
  for (const q of lesson.quiz || []) {
    if (!(q.answer >= 0 && q.answer < q.options.length)) { console.error(`✗ ${lesson.id} quiz answer out of range: ${q.q}`); failures++; }
  }
  for (const lab of lesson.labs || []) {
    labs++;
    if (ids.has(lab.id)) { console.error(`✗ duplicate lab id ${lab.id}`); failures++; }
    ids.add(lab.id);
    const sol = run(lab.solution, lab.tests);
    const st = run(lab.starter, lab.tests);
    const solOk = sol.ok;
    const starterFails = !st.ok;
    const mark = solOk && starterFails ? '✓' : '✗';
    console.log(`${mark} ${lab.id.padEnd(22)} solution ${sol.passed}/${sol.total}  starter ${st.passed}/${st.total}`);
    if (!solOk) {
      failures++;
      if (sol.load_error) console.log('   load error:\n' + sol.load_error);
      for (const t of sol.tests.filter((x) => !x.passed)) console.log(`   - ${t.name}: ${t.error}`);
    }
    if (!starterFails) { failures++; console.log('   starter passes all tests — tests are too weak'); }
  }
}
console.log(`\n${labs} labs checked, ${failures} problem(s).`);
process.exit(failures ? 1 : 0);
