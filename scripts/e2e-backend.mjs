/**
 * خادم مؤقت لاختبارات الواجهة (م-٤٧) — بيانات مصنوعة على قاعدة مؤقتة.
 *
 * Starts uvicorn from the backend venv (same resolution as scripts/py.mjs, so it
 * works on Windows and macOS) on a dedicated port with EGCO_SEED=1 and a fresh
 * EGCO_DATA_DIR. It never touches the real app-data directory: the data dir is
 * created empty here, so the seed's "empty database" guard always passes, and the
 * real database (8756 / Application Support) is never opened.
 *
 *   node scripts/e2e-backend.mjs            # port 8790 by default
 *   E2E_API_PORT=8791 node scripts/e2e-backend.mjs
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'services', 'api');
const win = process.platform === 'win32';
const venvPy = win
  ? path.join(apiDir, '.venv', 'Scripts', 'python.exe')
  : path.join(apiDir, '.venv', 'bin', 'python');

if (!existsSync(venvPy)) {
  console.error(`\nلم يُعثر على بيئة بايثون في:\n  ${venvPy}\n\nشغّل أولاً:  npm run setup\n`);
  process.exit(1);
}

const port = process.env.E2E_API_PORT || '8790';
const dataDir = mkdtempSync(path.join(process.env.E2E_TMP_ROOT || os.tmpdir(), 'egco-e2e-'));
console.log(`[e2e-backend] port ${port} · data ${dataDir}`);

const child = spawn(venvPy, ['-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', port],
  {
    cwd: apiDir,
    stdio: 'inherit',
    env: { ...process.env, EGCO_SEED: '1', EGCO_DATA_DIR: dataDir, EGCO_API_PORT: port },
  });

const cleanup = () => {
  try { child.kill(); } catch { /* already gone */ }
  try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* best effort */ }
};
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
child.on('exit', (code) => { cleanup(); process.exit(code ?? 1); });
