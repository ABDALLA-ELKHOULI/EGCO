/**
 * إشعارات نظام التشغيل — DESIGN-DIRECTION §٦.١: فقط حين لا تكون النافذة مركَّزة،
 * وحدٌّ أقصى واحد يومياً لكل نوع. العدّاد محفوظ على القرص حتى لا يتجاوزه إعادة التشغيل.
 */
import { app, BrowserWindow, Notification } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type OsNotifyPayload = {
  title: string;
  body?: string;
  severity?: 'info' | 'success' | 'warning' | 'danger';
  /** مسار داخلي في الواجهة (مثلاً '/cash?alert=deficit') يُعاد عبر notify:clicked. */
  link?: string;
  /** مفتاح الحدّ اليومي (deficit · backup_failed ...). غيابه = العنوان نفسه. */
  kind?: string;
};

export type OsNotifyResult =
  | { shown: true }
  | { shown: false; reason: 'focused' | 'rate-limited' | 'unsupported' | 'invalid' };

const file = () => path.join(app.getPath('userData'), 'notify-rate.json');
const today = () => new Date().toISOString().slice(0, 10);

function readLog(): Record<string, string> {
  try { return JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, string>; } catch { return {}; }
}

/** إبقاء مرجع للإشعار — بدونه قد يجمعه جامع القمامة فيضيع حدث النقر (Windows). */
const live = new Set<Notification>();

export function showOsNotification(win: BrowserWindow | null, p: OsNotifyPayload): OsNotifyResult {
  if (!p || typeof p.title !== 'string' || !p.title.trim()) return { shown: false, reason: 'invalid' };
  if (!Notification.isSupported()) return { shown: false, reason: 'unsupported' };
  if (win && !win.isDestroyed() && win.isFocused()) return { shown: false, reason: 'focused' };

  const kind = String(p.kind || p.title).slice(0, 80);
  const log = readLog();
  if (log[kind] === today()) return { shown: false, reason: 'rate-limited' };
  log[kind] = today();
  // تنظيف المفاتيح القديمة.
  for (const k of Object.keys(log)) if (log[k] !== today()) delete log[k];
  try { fs.writeFileSync(file(), JSON.stringify(log)); } catch { /* غير حرج */ }

  const n = new Notification({
    title: p.title,
    body: p.body ?? '',
    urgency: p.severity === 'danger' ? 'critical' : 'normal',
    silent: p.severity !== 'danger' && p.severity !== 'warning',
  });
  live.add(n);
  n.on('click', () => {
    live.delete(n);
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      win.webContents.send('notify:clicked', { link: p.link ?? null, kind });
    }
  });
  n.on('close', () => live.delete(n));
  n.show();
  return { shown: true };
}

/** شارة عدد غير المقروء — Dock على macOS، Unity/Linux عبر setBadgeCount، Windows عبر overlay. */
export function setBadge(win: BrowserWindow | null, count: number): void {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  try { app.setBadgeCount(n); } catch { /* غير مدعوم */ }
  if (process.platform === 'win32' && win && !win.isDestroyed()) {
    // Windows لا يدعم setBadgeCount — وميض شريط المهام بدل أيقونة مرسومة.
    if (n > 0 && !win.isFocused()) win.flashFrame(true);
    if (n === 0) win.flashFrame(false);
  }
}
