/* حكم «يكسب/يخسر» — من أرقام الخادم فقط (margin = contractValue − executed يحسبه الخادم بـDecimal).
   لا هامش بلا قيمة عقد؛ المُسند يُقارَن ولا يُطرح هنا. */
import type { Dec } from '../types';
import { cmp, num } from './money';

export type VerdictKind = 'loss' | 'watch' | 'gain';
/** عتبة «هامش ضيق» من النموذج: استهلاك ≥ ٩٠٪ من العقد. */
export const WATCH_RATIO = 0.9;

export interface Verdict {
  kind: VerdictKind | 'unknown';
  contractValue: number | null; assigned: number | null; executed: number | null; margin: number | null;
  /** نسب عرض فقط (ليست مبالغ). */
  marginPct: number | null; usedPct: number | null; assignedPct: number | null;
  assignedOverContract: boolean; assignedBelowExecuted: boolean;
  reasons: string[];
}

export function verdictOf(row: { contractValue?: Dec; assignedTotal?: Dec; executed?: Dec; margin?: Dec }): Verdict {
  const cv = num(row.contractValue), assigned = num(row.assignedTotal), executed = num(row.executed), margin = num(row.margin);
  const reasons: string[] = [];
  const assignedOverContract = cmp(row.assignedTotal, row.contractValue) === 1;
  const assignedBelowExecuted = cmp(row.assignedTotal, row.executed) === -1 && (assigned ?? 0) > 0;
  if (assignedOverContract) reasons.push('المُسند للأطراف يتجاوز قيمة العقد');
  if (assignedBelowExecuted) reasons.push('المنفّذ تجاوز مجموع الإسنادات — أطراف بلا مبلغ أو تجاوز');
  const base = { contractValue: cv, assigned, executed, assignedOverContract, assignedBelowExecuted };
  if (cv == null || cv <= 0 || margin == null) {
    reasons.unshift(row.contractValue == null ? 'قيمة العقد غير مُدخلة' : 'الهامش غير متاح من الخادم');
    return { ...base, kind: 'unknown', margin: null, marginPct: null, usedPct: null,
      assignedPct: null, reasons };
  }
  const used = executed != null ? executed / cv : null;
  const kind: VerdictKind = margin < 0 ? 'loss' : used != null && used >= WATCH_RATIO ? 'watch' : 'gain';
  if (kind === 'loss') reasons.push('المنفّذ تجاوز قيمة العقد');
  return { ...base, kind, margin, marginPct: (margin / cv) * 100, usedPct: used == null ? null : used * 100,
    assignedPct: assigned == null ? null : (assigned / cv) * 100, reasons };
}

/** ترتيب الخطر للقائمة: خاسر أولاً بحجم الخسارة، ثم ضيّق، ثم المجهول، ثم الرابح. */
export function riskRank(v: Verdict): number {
  if (v.kind === 'loss') return 3e12 - (v.margin ?? 0);
  if (v.kind === 'watch') return 2e12;
  if (v.assignedOverContract) return 1.5e12;
  if (v.kind === 'unknown') return 1e12;
  return 0;
}
