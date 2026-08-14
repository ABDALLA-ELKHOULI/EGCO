/**
 * مشغّل بايثون متوافق مع ويندوز وماك.
 *
 * npm scripts cannot hardcode `.venv/bin/python` — Windows puts the interpreter in
 * `.venv\Scripts\python.exe`. Every script that needs the backend venv goes through
 * here so the build works on both machines.
 *
 *   node scripts/py.mjs -m pytest tests -q
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiDir = path.join(root, 'services', 'api');
const win = process.platform === 'win32';

const venvPy = win
  ? path.join(apiDir, '.venv', 'Scripts', 'python.exe')
  : path.join(apiDir, '.venv', 'bin', 'python');

if (!existsSync(venvPy)) {
  console.error(
    `\nلم يُعثر على بيئة بايثون في:\n  ${venvPy}\n\nشغّل أولاً:  npm run setup\n`,
  );
  process.exit(1);
}

const r = spawnSync(venvPy, process.argv.slice(2), { stdio: 'inherit', cwd: apiDir });
process.exit(r.status ?? 1);
