/**
 * تفضيلات الواجهة — الوضع، الأرقام (123/١٢٣)، طي الشريط، الجزيرة، إشعارات النظام،
 * وتفضيلات الجداول (الأعمدة المخفية). مخزن خارجي صغير + useSyncExternalStore: لا Redux.
 *
 * المفاتيح متوافقة مع v0.13.0 عمداً: 'egco-theme' (يكتبه Settings.tsx القديم مباشرة) و
 * 'egco.sidebar.collapsed' (Sidebar.tsx القديم) — المستخدم لا يفقد اختياره بعد الترقية.
 */
import { useSyncExternalStore } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type DigitsPref = 'latin' | 'arab';

export interface Prefs {
  theme: ThemePref;
  digits: DigitsPref;
  sideCollapsed: boolean;
  /** false = الجزيرة لا تتمدد إلا لحدث خطر (S4). */
  island: boolean;
  /** إشعارات النظام الأصلية (عبر جسر Electron) حين تكون النافذة غير مركّزة. */
  osNotifications: boolean;
}

const K = {
  theme: 'egco-theme',
  digits: 'egco-digits',
  side: 'egco.sidebar.collapsed',
  island: 'egco-island',
  os: 'egco-os-notify',
  ui: 'egco-ui',
} as const;

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function write(key: string, v: string | null) {
  try { if (v == null) localStorage.removeItem(key); else localStorage.setItem(key, v); } catch { /* وضع خاص: الذاكرة فقط */ }
}

function load(): Prefs {
  const t = read(K.theme);
  return {
    theme: t === 'light' || t === 'dark' ? t : 'system',
    digits: read(K.digits) === 'arab' ? 'arab' : 'latin',
    sideCollapsed: read(K.side) === '1',
    island: read(K.island) !== '0',
    osNotifications: read(K.os) !== '0',
  };
}

let state: Prefs = load();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

/** يطبّق الوضع على <html> — يُستدعى قبل أول رسم (main.tsx) وبعد كل تغيير. */
export function applyTheme(t: ThemePref = state.theme) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t; else delete root.dataset.theme;
  const resolved = resolvedTheme(t);
  // شريط عنوان Electron (titleBarOverlay على ويندوز) يتبع الوضع الفعلي — الجسر اختياري.
  try { void window.egco?.setTheme?.(resolved); } catch { /* المتصفح بلا جسر */ }
}
export function resolvedTheme(t: ThemePref = state.theme): 'light' | 'dark' {
  if (t !== 'system') return t;
  return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function setPrefs(patch: Partial<Prefs>) {
  state = { ...state, ...patch };
  if ('theme' in patch) { write(K.theme, state.theme === 'system' ? null : state.theme); applyTheme(); }
  if ('digits' in patch) write(K.digits, state.digits);
  if ('sideCollapsed' in patch) write(K.side, state.sideCollapsed ? '1' : '0');
  if ('island' in patch) write(K.island, state.island ? '1' : '0');
  if ('osNotifications' in patch) write(K.os, state.osNotifications ? '1' : '0');
  emit();
}
export const getPrefs = () => state;
export function subscribePrefs(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export function usePrefs(): Prefs { return useSyncExternalStore(subscribePrefs, getPrefs, getPrefs); }

export function cycleTheme() {
  const t = state.theme;
  setPrefs({ theme: t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system' });
}
export function toggleDigits() { setPrefs({ digits: state.digits === 'arab' ? 'latin' : 'arab' }); }
export const THEME_LABEL: Record<ThemePref, string> = { system: 'تلقائي', light: 'فاتح', dark: 'داكن' };

/* Settings.tsx القديم يكتب data-theme مباشرة — نراقبه كي يبقى المخزن صادقاً. */
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  new MutationObserver(() => {
    const d = document.documentElement.dataset.theme;
    const t: ThemePref = d === 'light' || d === 'dark' ? d : 'system';
    if (t !== state.theme) { state = { ...state, theme: t }; emit(); }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener?.('change', () => { if (state.theme === 'system') { applyTheme(); emit(); } });
  }
}

/* ─ تفضيلات حرة صغيرة (أعمدة الجداول المخفية، تبويب أخير…) — JSON واحد ─ */
export function uiPref<T>(key: string, fallback: T): T {
  try {
    const all = JSON.parse(read(K.ui) || '{}') as Record<string, unknown>;
    return key in all ? (all[key] as T) : fallback;
  } catch { return fallback; }
}
export function setUiPref(key: string, v: unknown) {
  try {
    const all = JSON.parse(read(K.ui) || '{}') as Record<string, unknown>;
    all[key] = v;
    write(K.ui, JSON.stringify(all));
  } catch { /* ذاكرة فقط */ }
}
