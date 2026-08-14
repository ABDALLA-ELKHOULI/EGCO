/** يشغّل واجهة Vite ثم غلاف Electron — والغلاف يشغّل الخدمة الخلفية بنفسه. */
import { spawn } from 'node:child_process';

const procs = [];
const shutdown = () => { procs.forEach((p) => { try { p.kill(); } catch {} }); process.exit(0); };
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const start = (cmd, args, name) => {
  const p = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (c) => { console.log(`[${name}] exited ${c}`); shutdown(); });
  procs.push(p);
  return p;
};

start('npm', ['--workspace', 'apps/renderer', 'run', 'dev'], 'renderer');
setTimeout(() => {
  start('npx', ['tsc', '-p', 'apps/desktop/tsconfig.json'], 'desktop:build');
  setTimeout(() => start('npx', ['electron', '.'], 'electron'), 3000);
}, 1500);
