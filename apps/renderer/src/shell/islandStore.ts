/**
 * آلة حالات جزيرة الحالة S0–S4 — منقولة حرفياً من prototype/shell.js (isl، claim، release، islandApi).
 *   S0 ساكنة بلا تنبيهات · S1 ساكنة مع غير مقروء · S2 استيراد جارٍ · S3 نسخ احتياطي · S4 حدث خطر.
 * الأولوية: S4 > S2 > S3 > الأساس (S1/S0). الحدث الأدنى لا يقاطع الأعلى.
 * تفضيل «الجزيرة» مطفأ = لا تمدد إلا لـS4.
 */
import { useSyncExternalStore } from 'react';
import { getPrefs } from '@/ui/prefs';
import { notifications } from '@/data/notifications';

export type IslandState = 's0' | 's1' | 's2' | 's3' | 's4';
export interface IslandSnap {
  state: IslandState;
  base: 's0' | 's1';
  import: { file: string; pct: number };
  backup: { phase: 'start' | 'done'; sizeKb?: number | null };
  deficit: { detail: string };
}

const RANK: Record<string, number> = { s4: 4, s2: 3, s3: 2 };
let active: IslandState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let snap: IslandSnap = {
  state: 's0', base: 's0',
  import: { file: '', pct: 0 },
  backup: { phase: 'start' },
  deficit: { detail: '' },
};
const subs = new Set<() => void>();
function emit(patch: Partial<IslandSnap> = {}) {
  snap = { ...snap, ...patch };
  snap.state = active || snap.base;
  subs.forEach((f) => f());
}
function release(s?: IslandState) {
  if (!s || active === s) { if (timer) clearTimeout(timer); active = null; emit(); }
}
function claim(s: IslandState, ms?: number): boolean {
  if (getPrefs().island === false && s !== 's4') return false;
  if (active && active !== s && RANK[active] > RANK[s]) return false;
  if (timer) clearTimeout(timer);
  active = s; emit();
  if (ms) timer = setTimeout(() => release(s), ms);
  return true;
}

export type IslandEvent =
  | ['import', { pct?: number; file?: string | null; done?: boolean }]
  | ['backup', { phase: 'start' | 'done'; sizeKb?: number | null }]
  | ['deficit', { detail?: string; ms?: number }]
  | ['idle', undefined?];

export const island = {
  event(...[kind, data]: IslandEvent) {
    if (kind === 'import') {
      const d = data || {};
      const pct = Math.max(0, Math.min(100, Math.round(d.pct || 0)));
      emit({ import: { file: d.file ? 'استيراد — ' + d.file : snap.import.file || 'استيراد', pct } });
      if (!claim('s2')) return;
      if (d.done || pct >= 100) { if (timer) clearTimeout(timer); timer = setTimeout(() => release('s2'), 700); }
    } else if (kind === 'backup') {
      if (data.phase === 'done') {
        if (active !== 's3' && !claim('s3')) return;
        emit({ backup: { phase: 'done', sizeKb: data.sizeKb } });
        if (timer) clearTimeout(timer); timer = setTimeout(() => release('s3'), 1600);
      } else {
        emit({ backup: { phase: 'start' } });
        claim('s3', 8000);
      }
    } else if (kind === 'deficit') {
      emit({ deficit: { detail: data?.detail || '' } });
      claim('s4', data?.ms || 6000);
    } else if (kind === 'idle') release();
  },
  release,
  get state() { return snap.state; },
  snapshot: () => snap,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
};

/* الأساس يتبع عدد غير المقروء */
notifications.subscribe(() => {
  const base = notifications.snapshot().unread ? 's1' : 's0';
  if (base !== snap.base) emit({ base });
});

export function useIsland() { return useSyncExternalStore(island.subscribe, island.snapshot, island.snapshot); }
