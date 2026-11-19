/**
 * «سجل الاستيراد» + التكرارات القائمة + تصنيف حساب.
 * الفرز والتصفية على الخادم على المجموعة كاملةً (CLAUDE.md §٢) — لا في المتصفح.
 */
import { useCallback, useMemo, useState } from 'react';
import { dataApi } from '../api';
import { useAsync } from './useAsync';
import type { ClassKind, ImportHistoryQuery, ImportHistoryRow } from '../types';

export interface HistoryFilters {
  fileName: string; source: string; party: string;
  minMoves: string; maxMoves: string; dateFrom: string; dateTo: string; reconciled: string;
}
const EMPTY: HistoryFilters = {
  fileName: '', source: '', party: '', minMoves: '', maxMoves: '', dateFrom: '', dateTo: '', reconciled: '',
};

export function useImportHistory(reloadToken: number, enabled = true) {
  const [f, setF] = useState<HistoryFilters>(EMPTY);
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);
  const query = useMemo<ImportHistoryQuery>(() => ({
    file_name: f.fileName || undefined, source: f.source || undefined, party: f.party || undefined,
    min_moves: f.minMoves ? Number(f.minMoves) : undefined, max_moves: f.maxMoves ? Number(f.maxMoves) : undefined,
    date_from: f.dateFrom || undefined, date_to: f.dateTo || undefined,
    reconciled: f.reconciled || undefined, sort: sort?.key, dir: sort?.dir,
  }), [f, sort]);
  const q = useAsync(() => dataApi.history(query), [query, reloadToken], { enabled, debounceMs: 200 });
  const filtering = Object.values(f).some(Boolean);
  const setFilter = useCallback(<K extends keyof HistoryFilters>(k: K, v: HistoryFilters[K]) =>
    setF((p) => ({ ...p, [k]: v })), []);
  return { ...q, rows: q.data?.rows, filters: f, setFilter, clear: () => setF(EMPTY), filtering, sort, setSort };
}

/** «فشل» تقريبي: لا حقل صريح — لا مضاف ولا مطابق وليس سجلاً قديماً (م-٣٧). */
export const isImportFailed = (r: ImportHistoryRow) => !r.legacy && r.added === 0 && r.skipped === 0;

/**
 * حذف حركات ملف مستورد. السجل القديم (legacy) يُرفض بـ409 أولاً ويحتاج موافقة ثانية
 * على الحذف التقريبي (كل حركة للطرف خلال ٣ دقائق من وقت الرفع).
 */
export async function deleteImportRow(row: ImportHistoryRow, force: boolean):
  Promise<{ kind: 'deleted'; n: number } | { kind: 'needs-force' }> {
  try {
    const res = await dataApi.deleteImport(row.id, force);
    const d = res.deleted;
    return { kind: 'deleted', n: d.invoices + d.payments + d.entries + d.receivables + (d.guaranteeEntries ?? 0) };
  } catch (e) {
    if (row.legacy && !force) return { kind: 'needs-force' };
    throw e;
  }
}

export function useDuplicates(reloadToken: number) {
  const q = useAsync(() => dataApi.duplicates(), [reloadToken]);
  const [busy, setBusy] = useState<string | null>(null);
  const remove = useCallback(async (kind: string, id: string) => {
    setBusy(id);
    try { await dataApi.deleteDuplicate(kind, id); q.refetch(); } finally { setBusy(null); }
  }, [q]);
  return { ...q, busy, remove };
}

/** تصنيف حساب مجهول البادئة + اقتراح الذكاء (اختياري، فشله صامت). */
export function useClassify(path: string | null, aiEnabled: boolean) {
  const suggestion = useAsync(
    (): Promise<Partial<{ kind: string; reason: string }>> =>
      (path ? dataApi.suggestClass(path) : Promise.resolve({})),
    [path], { enabled: !!path && aiEnabled },
  );
  const save = (account: string, kind: ClassKind, name?: string) => dataApi.classify(account, kind, name);
  return { suggestion: suggestion.data?.kind ? suggestion.data : null, save };
}
