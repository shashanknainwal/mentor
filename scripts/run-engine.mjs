// Runs the Python engine (or its tests) with the repo's virtualenv if present.
//   node scripts/run-engine.mjs          -> python -m mentor_engine --port 8765 --reload
//   node scripts/run-engine.mjs --test   -> python -m pytest
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engineDir = path.join(root, 'engine');
const win = process.platform === 'win32';
const venvPy = path.join(root, '.venv', win ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.MENTOR_PYTHON || (existsSync(venvPy) ? venvPy : win ? 'python' : 'python3');

const args = process.argv.includes('--test') ? ['-m', 'pytest', '-q'] : ['-m', 'mentor_engine', '--port', process.env.MENTOR_PORT || '8765', '--reload'];
const child = spawn(python, args, { cwd: engineDir, stdio: 'inherit', env: { ...process.env, PYTHONUNBUFFERED: '1' } });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
