/* تصفية وترتيب جداول متداخلة داخل استجابة طرف واحد (فواتير/دفعات/حركات/مستخلصات) —
 * استثناء موثَّق من قاعدة «التصفية على الخادم»: هذه مصفوفات داخل كشف واحد، وبطاقات
 * الإجمالي أعلاها محسوبة في الخادم على المجموعة كاملة. لذلك كل جدول مُصفّى يعرض
 * «عرض N من M» (انظر SupplierDetail.tsx:202-206 القديم). */

export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

export type ColFilter<T> =
  | { kind: 'text'; get: (r: T) => string | null | undefined; value: string; ci?: boolean }
  | { kind: 'select'; get: (r: T) => string | null | undefined; value: string }
  | { kind: 'range'; get: (r: T) => number | null | undefined; min: string; max: string }
  | { kind: 'dateRange'; get: (r: T) => string | null | undefined; from: string; to: string };

export function isActive<T>(f: ColFilter<T>): boolean {
  switch (f.kind) {
    case 'text': case 'select': return f.value !== '';
    case 'range': return f.min !== '' || f.max !== '';
    case 'dateRange': return f.from !== '' || f.to !== '';
  }
}

export function applyFilters<T>(rows: readonly T[], filters: readonly ColFilter<T>[]): T[] {
  let out = rows as T[];
  for (const f of filters) {
    if (!isActive(f)) continue;
    switch (f.kind) {
      case 'text': {
        const needle = f.ci ? f.value.trim().toLowerCase() : f.value;
        out = out.filter((r) => {
          const h = String(f.get(r) ?? '');
          return (f.ci ? h.toLowerCase() : h).includes(needle);
        });
        break;
      }
      case 'select': out = out.filter((r) => (f.get(r) ?? '') === f.value); break;
      case 'range': {
        const lo = f.min !== '' ? Number(f.min) : null;
        const hi = f.max !== '' ? Number(f.max) : null;
        out = out.filter((r) => {
          const v = f.get(r) ?? 0;
          return (lo == null || v >= lo) && (hi == null || v <= hi);
        });
        break;
      }
      case 'dateRange':
        // صفّ بلا تاريخ يخرج عند أي حدّ — كالقديم (i.date && i.date >= from).
        out = out.filter((r) => {
          const d = f.get(r);
          if (f.from && !(d && d >= f.from)) return false;
          if (f.to && !(d && d <= f.to)) return false;
          return true;
        });
        break;
    }
  }
  return out;
}

export function sortRows<T>(rows: readonly T[], sort: SortState | null,
  keys: Record<string, (r: T) => string | number>): T[] {
  if (!sort || !keys[sort.key]) return rows as T[];
  const g = keys[sort.key]; const dir = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = g(a); const bv = g(b);
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

/** دورة الترتيب لعمود: نقرة على نفس الاتجاه تلغيه (ColumnMenu.tsx:98-101 القديم). */
export const toggleSort = (cur: SortState | null, key: string, dir: SortDir): SortState | null =>
  cur && cur.key === key && cur.dir === dir ? null : { key, dir };

/** ترقيم محلي على مجموعة كاملة مصفّاة من الخادم (Contractors.tsx:86-93,219-223). */
export function paginate<T>(rows: readonly T[], page: number, size: number) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, page), pageCount);
  return { page: p, pageCount, rows: rows.slice((p - 1) * size, p * size),
    from: rows.length ? (p - 1) * size + 1 : 0, to: Math.min(p * size, rows.length), total: rows.length };
}

/** شرائح «تصفية نشطة» — نص كل شريحة يُعاد على الورقة المطبوعة كسطر التصفية. */
export interface Chip { k: string; label: string; clear: () => void }
export const compactChips = (xs: (Chip | false | '' | null | undefined | 0)[]): Chip[] => xs.filter(Boolean) as Chip[];
export const filterLine = (chips: Chip[]): string | null => chips.length ? chips.map((c) => c.label).join(' · ') : null;
