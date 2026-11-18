/**
 * مكدّس الطبقات (نوافذ/أدراج) — Esc وفخ التركيز للطبقة العليا فقط، وقفل تمرير الصفحة.
 * منقول من prototype/ui.js (modalStack، lockScroll، FOCUSABLE).
 */
export const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface Layer { key: (e: KeyboardEvent) => void; kind: 'modal' | 'drawer' | 'palette' }
const stack: Layer[] = [];
let locks = 0;

export function pushLayer(l: Layer) { stack.push(l); }
export function popLayer(l: Layer) { const i = stack.indexOf(l); if (i >= 0) stack.splice(i, 1); }
export const isModalOpen = () => stack.some((l) => l.kind === 'modal');
export const topLayer = () => stack[stack.length - 1];

export function lockScroll(on: boolean) {
  locks = Math.max(0, locks + (on ? 1 : -1));
  document.documentElement.style.overflow = locks ? 'hidden' : '';
}

/** فخ تركيز Tab داخل `scope`. */
export function trapTab(e: KeyboardEvent, scope: HTMLElement) {
  const f = [...scope.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
  if (!f.length) { e.preventDefault(); return; }
  const first = f[0], last = f[f.length - 1];
  const a = document.activeElement;
  if (e.shiftKey && (a === first || !scope.contains(a))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (a === last || !scope.contains(a))) { e.preventDefault(); first.focus(); }
}

if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => { const top = topLayer(); if (top) top.key(e); }, true);
}
