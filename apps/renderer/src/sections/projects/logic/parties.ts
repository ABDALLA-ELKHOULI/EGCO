/* م-٥٠ · منطق أطراف المشروع — نقي. لا جمع مالي هنا: الإجماليات من الخادم (assignedTotal) أو من DataTable. */
import type { PartyType, ProjectParty } from '../types';
import { cmp, num } from './money';

export const partyKey = (t: PartyType, id: string) => `${t}:${id}`;

/** المنفّذ للطرف: فواتير المورد أو مستخلصات المقاول. null = غير قابل للنسبة لهذا المشروع. */
export const executedOf = (p: ProjectParty) => (p.partyType === 'supplier' ? p.invoiced : p.claimed) ?? null;

/** تجاوز المنفّذُ الإسنادَ (مقارنة بالهللة، لا طرح). */
export const isOverrun = (p: ProjectParty) => cmp(executedOf(p), p.amount) === 1;

export interface PartyCounts { total: number; noAmount: number; shared: number; unlinked: number; overrun: number }
export function countsOf(rows: readonly ProjectParty[]): PartyCounts {
  return {
    total: rows.length,
    noAmount: rows.filter((p) => p.amount == null).length,
    shared: rows.filter((p) => p.attribution === 'shared').length,
    unlinked: rows.filter((p) => !p.linked).length,
    overrun: rows.filter(isOverrun).length,
  };
}

/** صف عرض: أرقام للعرض (Money) مع إبقاء null. */
export interface PartyRowView extends ProjectParty {
  key: string; amountN: number | null; executedN: number | null; paidN: number | null; openN: number | null; overdueN: number | null;
}
export const toView = (p: ProjectParty): PartyRowView => ({
  ...p, key: partyKey(p.partyType, p.partyId), amountN: num(p.amount), executedN: num(executedOf(p)),
  paidN: num(p.paid), openN: num(p.open), overdueN: num(p.overdue),
});

export function validateAmount(raw: number | null): string | null {
  if (raw == null) return null;
  if (Number.isNaN(raw)) return 'أدخل مبلغاً صحيحاً';
  if (raw < 0) return 'المبلغ لا يكون سالباً';
  if (Math.abs(raw * 100 - Math.round(raw * 100)) > 1e-6) return 'أقصى دقة هللتان';
  return null;
}

/** يستبعد من نتائج البحث من هم مسندون لهذا المشروع أصلاً (بالرابط الصريح). */
export function excludeAssigned<T extends { partyType: PartyType; partyId: string }>(hits: readonly T[], assigned: readonly ProjectParty[]): T[] {
  const taken = new Set(assigned.filter((a) => a.linked).map((a) => partyKey(a.partyType, a.partyId)));
  return hits.filter((h) => !taken.has(partyKey(h.partyType, h.partyId)));
}
