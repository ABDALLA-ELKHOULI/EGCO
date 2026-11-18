/**
 * مؤشرات شاشة التحصيلات. ما يوفّره الخادم يُؤخذ منه (open/collected/all/overdueOpen من
 * /revenues totals). «خلال ٣٠ يوماً» و«محصّل هذا الشهر» غير موجودين على الخادم بعد —
 * يُحسبان هنا بالهللات من **كل** صفوف النطاق (لا صفحة)، وموسومان كثغرة في PARITY-cash.md.
 * يجب استدعاؤهما على استجابة بلا فلتر حالة/بحث وإلا وصفا مجموعة أخرى.
 */
import type { Revenue } from '../types';
import { fromH, isoAddDays, sumH } from './money';

export type RevenueState = 'late' | 'open' | 'collected';

export function revenueState(r: Revenue, today: string): RevenueState {
  if (r.status === 'collected') return 'collected';
  return r.dueDate && r.dueDate < today ? 'late' : 'open';
}

export const STATE_LABEL: Record<RevenueState, string> = { late: 'متأخر', open: 'مفتوح', collected: 'محصّل' };

export interface CollectionsKpis {
  in30: { amount: number; rows: Revenue[] };
  thisMonth: { amount: number; rows: Revenue[] };
  undated: { amount: number; rows: Revenue[] };
  late: { amount: number; rows: Revenue[] };
}

export function collectionsKpis(all: readonly Revenue[], today: string): CollectionsKpis {
  const t30 = isoAddDays(today, 30), month = today.slice(0, 7);
  const open = all.filter((r) => r.status !== 'collected');
  const pick = (rows: Revenue[]) => ({ amount: fromH(sumH(rows, (r) => r.amount)), rows });
  return {
    in30: pick(open.filter((r) => r.dueDate != null && r.dueDate >= today && r.dueDate <= t30)),
    thisMonth: pick(all.filter((r) => r.status === 'collected' && (r.collectedOn ?? '').slice(0, 7) === month)),
    undated: pick(open.filter((r) => r.dueDate == null)),
    late: pick(open.filter((r) => r.dueDate != null && r.dueDate < today)),
  };
}

export const daysLate = (r: Revenue, today: string): number | null => {
  if (!r.dueDate || r.status === 'collected' || r.dueDate >= today) return null;
  const [a, b] = [today, r.dueDate].map((s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)));
  return Math.round((a - b) / 86_400_000);
};

/** وحدات سبق استعمالها لنفس العميل — اقتراحات حقل «الوحدة» (تكافؤ Revenues.tsx:283). */
export function unitsForClient(all: readonly Revenue[], client: string): string[] {
  if (!client) return [];
  return Array.from(new Set(all.filter((r) => r.client === client && r.unit).map((r) => r.unit)));
}
