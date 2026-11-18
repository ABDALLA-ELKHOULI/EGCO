/**
 * آخر أخطاء الواجهة — تُرفق ببلاغ الدعم. حلقة صغيرة في الذاكرة، تُمحى بإغلاق التطبيق.
 * من يُبلّغ عن مشكلة لا يعرف أي خطأ ظهر في الخلفية؛ هذا يعرف.
 */
const MAX = 12;
const errors: { at: string; message: string }[] = [];

export function recordError(message: string): void {
  errors.push({ at: new Date().toISOString().slice(11, 19), message: message.slice(0, 300) });
  if (errors.length > MAX) errors.shift();
}

export function recentErrors(): { at: string; message: string }[] {
  return [...errors];
}

let installed = false;
export function installErrorCapture(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => recordError(e.message || String(e.error)));
  window.addEventListener('unhandledrejection', (e) =>
    recordError('Promise: ' + (e.reason?.message ?? String(e.reason))));
}
