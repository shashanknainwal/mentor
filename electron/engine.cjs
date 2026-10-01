// Spawns and supervises the Python engine (mentor_engine) for the Electron shell.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');

function findFreePort(start = 8765) {
  return new Promise((resolve) => {
    const tryPort = (port) => {
      const srv = net.createServer();
      srv.once('error', () => tryPort(port + 1));
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort(start);
  });
}

function engineDir(app) {
  // Packaged: resources/engine. Dev: <repo>/engine.
  const packaged = path.join(process.resourcesPath || '', 'engine');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, '..', 'engine');
}

function findPython(dir) {
  if (process.env.MENTOR_PYTHON) return process.env.MENTOR_PYTHON;
  const win = process.platform === 'win32';
  const candidates = [
    path.join(dir, '.venv', win ? 'Scripts/python.exe' : 'bin/python'),
    path.join(dir, '..', '.venv', win ? 'Scripts/python.exe' : 'bin/python'),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return win ? 'python' : 'python3';
}

function waitForHealth(url, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(`${url}/api/health`, (res) => {
          res.resume();
          if (res.statusCode === 200) return resolve();
          retry();
        })
        .on('error', retry);
    };
    const retry = () => (Date.now() > deadline ? reject(new Error('Engine did not start in time')) : setTimeout(tick, 400));
    tick();
  });
}

class EngineProcess {
  constructor(app, { onLog, onExit } = {}) {
    this.app = app;
    this.onLog = onLog || (() => {});
    this.onExit = onExit || (() => {});
    this.proc = null;
    this.url = null;
    this.restarts = 0;
    this.stopping = false;
  }

  async start() {
    if (process.env.MENTOR_EXTERNAL_ENGINE) {
      // `npm run dev` starts the engine separately on 8765.
      this.url = process.env.MENTOR_ENGINE_URL || 'http://127.0.0.1:8765';
      await waitForHealth(this.url, 90000);
      return this.url;
    }
    const dir = engineDir(this.app);
    const port = await findFreePort(8765);
    const python = findPython(dir);
    this.url = `http://127.0.0.1:${port}`;
    this.onLog(`Starting engine: ${python} -m mentor_engine --port ${port} (cwd ${dir})`);
    this.proc = spawn(python, ['-m', 'mentor_engine', '--port', String(port)], {
      cwd: dir,
      env: { ...process.env, PYTHONUNBUFFERED: '1', MENTOR_PORT: String(port) },
      windowsHide: true,
    });
    this.proc.stdout.on('data', (d) => this.onLog(d.toString()));
    this.proc.stderr.on('data', (d) => this.onLog(d.toString()));
    this.proc.on('exit', (code) => {
      this.onLog(`Engine exited with code ${code}`);
      this.proc = null;
      if (!this.stopping && this.restarts < 3) {
        this.restarts += 1;
        setTimeout(() => this.start().catch((e) => this.onLog(String(e))), 1500);
      } else {
        this.onExit(code);
      }
    });
    await waitForHealth(this.url);
    return this.url;
  }

  async restart() {
    this.stop();
    this.stopping = false;
    this.restarts = 0;
    return this.start();
  }

  stop() {
    this.stopping = true;
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }
}

module.exports = { EngineProcess };
