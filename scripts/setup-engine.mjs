// Creates ./.venv and installs the engine's Python dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = process.platform === 'win32';
const sysPython = process.env.MENTOR_PYTHON || (win ? 'python' : 'python3');
const venv = path.join(root, '.venv');
const venvPy = path.join(venv, win ? 'Scripts/python.exe' : 'bin/python');

function run(cmd, args) {
  console.log(`> ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

if (!existsSync(venvPy)) run(sysPython, ['-m', 'venv', venv]);
run(venvPy, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPy, ['-m', 'pip', 'install', '-r', path.join('engine', 'requirements-dev.txt')]);
console.log('\nEngine environment ready. Next: npm run dev');
