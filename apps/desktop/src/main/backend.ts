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

const lastErrors: string[] = [];

/** آخر ما طبعته الخدمة على stderr — يُضمّ إلى رسالة الفشل. */
export function backendErrorTail(): string {
  return lastErrors.slice(-6).join('\n');
}

let proc: ChildProcess | null = null;
let port = 0;

/**
 * ميزانية إعادة التشغيل — نافذة زمنية منزلقة بدل «مرة واحدة طوال عمر التطبيق».
 *
 * قفل عابر واحد في الساعة الأولى لا يجب أن يترك التطبيق بلا قدرة على التعافي في
 * الساعة السادسة؛ لكن خدمة معطوبة فعلاً يجب ألا تُعيد المحاولة إلى ما لا نهاية.
 * خمس محاولات كل خمس دقائق تسمح بالتعافي من أعطال متكررة معقولة وتوقف عند عطل حقيقي.
 */
const RESTART_WINDOW_MS = 5 * 60 * 1000;
const RESTART_MAX_IN_WINDOW = 5;
let restartTimestamps: number[] = [];

function canRestart(): boolean {
  const now = Date.now();
  restartTimestamps = restartTimestamps.filter((t) => now - t < RESTART_WINDOW_MS);
  return restartTimestamps.length < RESTART_MAX_IN_WINDOW;
}

/** يُستدعى بعد كل محاولة إعادة تشغيل (نجحت أو فشلت) — الواجهة تسمع منه لتُحدّث
 * عنوان الخدمة المحفوظ لديها ولتُخبر المستخدم بما حدث. */
export type RestartInfo = { url: string; recovered: boolean; error?: string };
let restartListener: ((info: RestartInfo) => void) | null = null;
export function onBackendRestart(cb: (info: RestartInfo) => void): void {
  restartListener = cb;
}

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

/**
 * عند إعادة التشغيل نحاول العودة لنفس المنفذ الذي كانت الخدمة عليه — الواجهة
 * تحتفظ بعنوان الخدمة في متغيّر واحد يُقرأ مرة عند الإقلاع (lib/api.ts)، فإن بقي
 * المنفذ نفسه لا تحتاج لمعرفة شيء عن الانقطاع. المنفذ قد يبقى ممسوكاً لحظياً
 * (TIME_WAIT) أو يأخذه برنامج آخر بين موت العملية القديمة وهذه المحاولة — في هذه
 * الحالة نتراجع لمنفذ حرّ جديد فوراً، والمستمع أدناه (onBackendRestart) هو شبكة
 * الأمان: يُبلَّغ العنوان الفعلي دائماً مهما تغيّر.
 */
function pickPort(preferred: number): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(freePort()));
    s.listen(preferred, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
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

export async function startBackend(isRestart = false): Promise<void> {
  port = isRestart ? await pickPort(port) : await freePort();
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
  proc.stderr?.on('data', (d) => {
    const line = String(d).trim();
    console.error('[api]', line);
    // آخر أسطر الخطأ تُحتفظ لتُعرض للمستخدم: «الخدمة لم تستجب» وحدها لا تقول
    // شيئاً قابلاً للتصرف، بينما «database is locked» أو «Permission denied»
    // تقول له بالضبط ما يفعله (أغلق النسخة الأخرى · استثنِ المجلد من الحماية).
    lastErrors.push(line);
    if (lastErrors.length > 12) lastErrors.shift();
  });

  // spawn() نفسه قد يفشل — ملف مفقود أو حجَره مضاد الفيروسات (خطأ ٩٠٠٩ سابقاً).
  // بلا هذا المستمع يرفع Node الخطأ غير ملتقَط فينهار المسار الرئيسي بلا رسالة.
  proc.on('error', (err) => {
    proc = null;
    lastErrors.push(String(err));
  });

  proc.on('exit', (code) => {
    proc = null;
    if (code === 0) return;
    if (!canRestart()) {
      const msg = `تجاوزت الخدمة عدد محاولات إعادة التشغيل المسموح (${RESTART_MAX_IN_WINDOW} خلال ٥ دقائق) — على الأغلب عطل متكرر لا مجرد انقطاع عابر.`;
      console.error('[api]', msg);
      restartListener?.({ url: backendUrl(), recovered: false, error: `${msg}\n${backendErrorTail()}` });
      return;
    }
    restartTimestamps.push(Date.now());
    console.error('[api] exited unexpectedly — restarting');
    startBackend(true)
      .then(() => restartListener?.({ url: backendUrl(), recovered: true }))
      .catch((e) => {
        console.error('[api] restart failed', e);
        const tail = backendErrorTail();
        restartListener?.({
          url: backendUrl(),
          recovered: false,
          error: String(e) + (tail ? `\n\nتفاصيل من الخدمة:\n${tail}` : ''),
        });
      });
  });

  await waitForHealth();
}

export function stopBackend(): void {
  proc?.kill();
  proc = null;
}
