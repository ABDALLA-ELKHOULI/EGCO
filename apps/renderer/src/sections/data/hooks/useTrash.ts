/**
 * المحذوفات (م-٣١). التصفية بالنوع على الخادم؛ البحث النصي (من النموذج) محلي على
 * الاسم المطبَّع فقط — قائمة كاملة بلا صفحات، فلا رقم إجمالي يتناقض.
 */
import { useCallback, useMemo, useState } from 'react';
import { normAr } from '@/ui/format';
import { dataApi } from '../api';
import { useAction, useAsync } from './useAsync';
import type { TrashKind, TrashRow } from '../types';

export function useTrash() {
  const [kind, setKind] = useState<TrashKind | ''>('');
  const [search, setSearch] = useState('');
  const q = useAsync(() => dataApi.trash(kind || undefined), [kind]);
  // عدّاد كل نوع للتبويبات — من قائمة «الكل» دائماً.
  const all = useAsync(() => dataApi.trash(), [q.data]);
  const act = useAction();

  const counts = useMemo(() => {
    const c: Partial<Record<TrashKind, number>> = {};
    for (const r of all.data?.rows ?? []) c[r.kind] = (c[r.kind] ?? 0) + 1;
    return c;
  }, [all.data]);

  const rows = useMemo(() => {
    const s = normAr(search.trim());
    return (q.data?.rows ?? []).filter((r) => !s || normAr(r.name).includes(s));
  }, [q.data, search]);

  const restore = useCallback((r: TrashRow) => act.run(r.id, async () => {
    await dataApi.restoreTrash(r.kind, r.id); q.refetch();
    return { ok: true, text: `استُرجع «${r.name}»` };
  }), [act, q]);

  /** نهائي — يُستدعى فقط بعد نافذة تأكيد صريحة. */
  const purge = useCallback((r: TrashRow) => act.run(r.id, async () => {
    await dataApi.purgeTrash(r.kind, r.id); q.refetch();
  }), [act, q]);

  return {
    ...q, rows, total: all.data?.count ?? 0, counts, kind, setKind, search, setSearch,
    busy: act.busy, note: act.note, restore, purge,
  };
}

/** ملخّص الصف «مفتاح: قيمة» كما يرسله الخادم، بلا الأصفار والفراغات. */
export const trashSummary = (r: TrashRow) => Object.entries(r.summary)
  .filter(([, v]) => v !== 0 && v !== '' && v != null).map(([k, v]) => `${k}: ${v}`).join(' · ');
