/**
 * مشرف الخدمة الخلفية.
 *
 * Picks a free loopback port, starts FastAPI, waits for /health, restarts once if it
 * dies unexpectedly, and kills it on quit. The backend is never exposed to the network.
 */
import { app } from 'electron';
import { spawn, ChildProcess } from 'node:child_process';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';

let proc: ChildProcess | null = null;
let port = 0;
let restarts = 0;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
    s.on('error', reject);
  });
}

export const backendUrl = () => `http://127.0.0.1:${port}`;

async function waitForHealth(timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${backendUrl()}/health`);
      if (r.ok) return;
    } catch (e) { lastErr = e; }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`الخدمة لم تستجب في الوقت المحدد: ${String(lastErr)}`);
}

/** In development we run uvicorn from the repo's venv; the packaged app ships a binary. */
function devCommand(repoRoot: string): { cmd: string; args: string[]; cwd: string } {
  const apiDir = path.join(repoRoot, 'services', 'api');
  const venv = process.platform === 'win32'
    ? path.join(apiDir, '.venv', 'Scripts', 'python.exe')
    : path.join(apiDir, '.venv', 'bin', 'python');
  const py = fs.existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3');
  return {
    cmd: py,
    args: ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', String(port)],
    cwd: apiDir,
  };
}

export async function startBackend(): Promise<void> {
  port = await freePort();
  const env = {
    ...process.env,
    EGCO_API_PORT: String(port),
    EGCO_DATA_DIR: app.getPath('userData'),
    PYTHONUNBUFFERED: '1',
  };

  if (!app.isPackaged) {
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');
    const { cmd, args, cwd } = devCommand(repoRoot);
    proc = spawn(cmd, args, { cwd, env });
  } else {
    const exe = process.platform === 'win32' ? 'egco-api.exe' : 'egco-api';
    proc = spawn(path.join(process.resourcesPath, 'api', exe), [], { env });
  }

  proc.stdout?.on('data', (d) => console.log('[api]', String(d).trim()));
  proc.stderr?.on('data', (d) => console.error('[api]', String(d).trim()));

  proc.on('exit', (code) => {
    proc = null;
    if (code === 0) return;
    if (restarts++ < 1) {
      console.error('[api] exited unexpectedly — restarting once');
      startBackend().catch((e) => console.error('[api] restart failed', e));
    }
  });

  await waitForHealth();
}

export function stopBackend(): void {
  proc?.kill();
  proc = null;
}
