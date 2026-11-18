/* دمج المشاريع (ProjectAdmin.tsx) — أثر قبل التنفيذ، أزواج من الاقتراحات. */
import type { MergePreview } from '../types';

export const TABLE_LABEL: Record<string, string> = {
  suppliers: 'مورد', party_projects: 'ربط طرف بمشروع', contractor_entries: 'حركة مقاول',
  invoices: 'فاتورة', budget_snapshots: 'شهر موازنة', revenues: 'إيراد', guarantees: 'ضمان',
};

export function impactLines(p: MergePreview): { table: string; label: string; n: number }[] {
  return Object.entries(p.affected).filter(([, n]) => n > 0)
    .map(([table, n]) => ({ table, label: TABLE_LABEL[table] ?? table, n }))
    .sort((a, b) => b.n - a.n);
}

/** كل الأزواج المرتّبة داخل مجموعة مكرّرة (ProjectAdmin.tsx:93-98). */
export function mergePairs(variants: readonly string[]): { from: string; into: string }[] {
  return variants.flatMap((v) => variants.filter((x) => x !== v).map((into) => ({ from: v, into })));
}

export function canPreview(from: string, into: string): boolean {
  return !!from && !!into && from !== into;
}

export const affectedTotal = (affected: Record<string, number>) =>
  Object.values(affected).reduce((a, b) => a + b, 0);
