/* منطق شاشة الضمانات — Guarantees.tsx. */
import type { GuaranteeAccountRow } from '../types';

/** شارة المطابقة: null ← «—»، مطابق، أو «فرق X ر.س» بالقيمة المطلقة (Guarantees.tsx:20-24). */
export type MatchState = { kind: 'unknown' } | { kind: 'ok' } | { kind: 'diff'; amount: number };
export function matchState(a: Pick<GuaranteeAccountRow, 'matches' | 'difference'>): MatchState {
  if (a.matches == null) return { kind: 'unknown' };
  if (a.matches) return { kind: 'ok' };
  return { kind: 'diff', amount: Math.abs(a.difference ?? 0) };
}
/** المتتبَّع = الرصيد − الفرق — الخادم يرسل الاثنين فلا حقل ثالث (Guarantees.tsx:182-184). */
export const trackedOf = (a: Pick<GuaranteeAccountRow, 'balance' | 'difference'>) =>
  Math.round((a.balance - (a.difference ?? 0)) * 100) / 100;
/** نسبة الاستقطاع في جدول الضمانات المتتبَّعة تأتي كسراً (0.1) — ×١٠٠ للعرض (Guarantees.tsx:136). */
export const ratePct = (r: number | null) => (r == null ? null : Math.round(r * 100));
