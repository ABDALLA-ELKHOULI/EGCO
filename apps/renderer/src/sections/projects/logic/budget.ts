/* الموازنة: ألوان بالاتجاه (Budget.tsx:24-43)، التراكمي، التعارضات. */
import type { BudgetRow } from '@/lib/api';
import { toH, fromH } from './money';

export type Tone = 'ok' | 'red' | '';
export const monthTone = (deviation: number): Tone => deviation > 0 ? 'ok' : deviation < 0 ? 'red' : '';
export function cumTone(delayPct: number | null): Tone {
  if (delayPct == null) return '';
  if (delayPct < -0.0001) return 'ok';
  if (delayPct > 0.0001) return 'red';
  return '';
}
export type Trend = 'none' | 'flat' | 'improving' | 'worsening';
export function trendOf(deltaPp: number | null | undefined): Trend {
  if (deltaPp == null) return 'none';
  if (Math.abs(deltaPp) < 0.01) return 'flat';
  return deltaPp < 0 ? 'improving' : 'worsening';
}

export interface MonthGroup { project: string; city: string; rows: BudgetRow[] }

/** تجميع القائمة المفلترة حسب المشروع بترتيب الخادم (Budget.tsx:262-272). */
export function groupByProject(rows: readonly BudgetRow[]): MonthGroup[] {
  const by = new Map<string, BudgetRow[]>();
  for (const r of rows) { const a = by.get(r.project) ?? []; a.push(r); by.set(r.project, a); }
  return [...by].map(([project, rs]) => ({ project, city: rs[0]?.city ?? '', rows: rs }))
    .sort((a, b) => a.project.localeCompare(b.project, 'ar'));
}

/** أشهر لها أكثر من إدخال — لا جمع صامت. */
export function conflictMonths(rows: readonly Pick<BudgetRow, 'month'>[]): string[] {
  const n = new Map<string, number>();
  for (const r of rows) n.set(r.month.slice(0, 7), (n.get(r.month.slice(0, 7)) ?? 0) + 1);
  return [...n].filter(([, c]) => c > 1).map(([m]) => m).sort();
}

/** تراكمي من أشهر شهرية (للمخطط/الإدخال اليدوي قبل رد الخادم) — بالهللات. */
export function cumulative(rows: readonly { month: string; actualMonth: number; plannedMonth: number }[]) {
  let ca = 0, cp = 0;
  return [...rows].sort((a, b) => a.month.localeCompare(b.month)).map((r) => {
    ca += toH(r.actualMonth); cp += toH(r.plannedMonth);
    return { month: r.month, cumActual: fromH(ca), cumPlanned: fromH(cp), cumVariance: fromH(ca - cp),
      /** كسر كالخادم: موجب = متأخر. */
      delayPct: cp > 0 ? (cp - ca) / cp : null };
  });
}

export type BudgetStatusFilter = '' | 'ahead' | 'behind' | 'on_track';
export const STATUS_LABEL: Record<Exclude<BudgetStatusFilter, ''>, string> =
  { ahead: 'متقدّم', behind: 'متأخر', on_track: 'مطابق' };

/** ملف الموازنة: .xlsx فقط (Budget.tsx:159-160). */
export const splitBudgetFiles = <T extends { name: string }>(files: readonly T[]) => ({
  accepted: files.filter((f) => f.name.toLowerCase().endsWith('.xlsx')),
  rejected: files.filter((f) => !f.name.toLowerCase().endsWith('.xlsx')),
});
