/**
 * تغطية الكشوفات. الخادم يدعم `q/project/state` على /coverage؛ التصفية بالأعمدة
 * الأخرى (تواريخ، مدى أيام، فواتير، مديونية) كانت في v0.13 داخل المتصفح على
 * القائمة الكاملة (لا صفحات) فالإجمالي لا يتناقض — نُبقيها كذلك حتى يضيفها الخادم.
 */
import { useMemo, useState } from 'react';
import { dataApi } from '../api';
import { useAsync } from './useAsync';
import type { CoverageRow } from '../types';

export interface CoverageFilters {
  name: string; account: string; project: string; state: string;
  firstFrom: string; firstTo: string; lastFrom: string; lastTo: string;
  sinceMin: string; sinceMax: string; invMin: string; invMax: string; outMin: string; outMax: string;
}
const EMPTY: CoverageFilters = {
  name: '', account: '', project: '', state: '', firstFrom: '', firstTo: '', lastFrom: '', lastTo: '',
  sinceMin: '', sinceMax: '', invMin: '', invMax: '', outMin: '', outMax: '',
};
type SortKey = keyof Pick<CoverageRow, 'name' | 'account' | 'project' | 'firstActivity' | 'lastActivity'
  | 'daysSinceLast' | 'invoiceCount' | 'outstanding' | 'state'>;

export function useCoverage(staleDays = 90) {
  const q = useAsync(() => dataApi.coverage(staleDays), [staleDays]);
  const [f, setF] = useState<CoverageFilters>(EMPTY);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' } | null>(null);

  const projects = useMemo(
    () => Array.from(new Set((q.data?.rows ?? []).map((r) => r.project).filter(Boolean))).sort(),
    [q.data]);

  const rows = useMemo(() => {
    let r = q.data?.rows ?? [];
    const n = (s: string) => Number(s);
    const name = f.name.trim().toLowerCase();
    r = r.filter((x) =>
      (!f.state || x.state === f.state) && (!f.project || x.project === f.project)
      && (!name || x.name.toLowerCase().includes(name)) && (!f.account || x.account.includes(f.account.trim()))
      && (!f.firstFrom || (!!x.firstActivity && x.firstActivity >= f.firstFrom))
      && (!f.firstTo || (!!x.firstActivity && x.firstActivity <= f.firstTo))
      && (!f.lastFrom || (!!x.lastActivity && x.lastActivity >= f.lastFrom))
      && (!f.lastTo || (!!x.lastActivity && x.lastActivity <= f.lastTo))
      && (!f.sinceMin || (x.daysSinceLast != null && x.daysSinceLast >= n(f.sinceMin)))
      && (!f.sinceMax || (x.daysSinceLast != null && x.daysSinceLast <= n(f.sinceMax)))
      && (!f.invMin || x.invoiceCount >= n(f.invMin)) && (!f.invMax || x.invoiceCount <= n(f.invMax))
      && (!f.outMin || x.outstanding >= n(f.outMin)) && (!f.outMax || x.outstanding <= n(f.outMax)));
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const v = (x: CoverageRow) => {
        const val = x[sort.key];
        return val ?? (sort.key === 'daysSinceLast' ? -1 : '');
      };
      r = [...r].sort((a, b) => (v(a) < v(b) ? -dir : v(a) > v(b) ? dir : 0));
    }
    return r;
  }, [q.data, f, sort]);

  return {
    ...q, rows, projects, filters: f, sort, setSort,
    setFilter: <K extends keyof CoverageFilters>(k: K, v: string) => setF((p) => ({ ...p, [k]: v })),
    clear: () => setF(EMPTY), filtering: Object.values(f).some(Boolean),
  };
}
