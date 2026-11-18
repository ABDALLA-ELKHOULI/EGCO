/** يشغّل واجهة Vite ثم يبني غلاف Electron ويشغّله — والغلاف يشغّل الخدمة الخلفية بنفسه. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// مجلد بيانات منفصل للتطوير: لا نلمس قاعدة egco-dashboard الحقيقية أبداً.
const support = join(homedir(), 'Library', 'Application Support');
const devDir = process.env.EGCO_DATA_DIR || join(support, 'egco-dashboard-next-dev');
if (!existsSync(join(devDir, 'egco.db'))) {
  mkdirSync(devDir, { recursive: true });
  const seed = join(support, 'egco-dashboard', 'backups', 'before-reset-2026-11-17T23-04-09.db');
  if (existsSync(seed)) { copyFileSync(seed, join(devDir, 'egco.db')); console.log('نسخة تطوير من النسخة الاحتياطية:', devDir); }
}
process.env.EGCO_DATA_DIR = devDir;

const procs = [];
const shutdown = () => { procs.forEach((p) => { try { p.kill(); } catch {} }); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// persistent=true: خروجه يُنهي الكل (Vite وElectron). خطوة البناء تنتهي طبيعياً فلا تُنهي شيئاً.
const start = (cmd, args, name, persistent = true) => {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (c) => { console.log(`[${name}] exited ${c}`); if (persistent) shutdown(); });
  procs.push(p);
  return p;
};

start('npm', ['--workspace', 'apps/renderer', 'run', 'dev'], 'renderer');
setTimeout(() => {
  const build = start('npx', ['tsc', '-p', 'apps/desktop/tsconfig.json'], 'desktop:build', false);
  build.on('exit', (c) => {
    if (c !== 0) { console.error('فشل بناء غلاف سطح المكتب'); shutdown(); return; }
    start('npx', ['electron', '.'], 'electron');
  });
}, 1500);
