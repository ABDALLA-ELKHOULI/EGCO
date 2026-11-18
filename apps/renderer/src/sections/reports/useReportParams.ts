/**
 * النطاق والفترة في الرابط لا في الحالة المحلية — تقرير قابل للمشاركة ولإعادة الفتح
 * على ما رآه مُرسله (Report.tsx:59-95، P-302). مورد/مشروع/مقاول: واحد فقط.
 */
import { useSearchParams } from 'react-router-dom';
import type { AnalysisParams, PartyScope } from './types';

const PARTIES: PartyScope[] = ['suppliers', 'contractors', 'both'];
export const DEFAULT_FROM = '2026-01-01'; // P-551 — بداية التقرير الافتراضية كما كانت
export const todayIso = () => new Date().toISOString().slice(0, 10);

export type ScopeValue = string; // 'company' | 'project:X' | 'supplier:211…' | 'contractor:C1'

export function useReportParams() {
  const [sp, setSp] = useSearchParams();
  const account = sp.get('account') || undefined;
  const contractor = sp.get('contractor') || undefined;
  const project = sp.get('project') || undefined;
  const raw = sp.get('parties') as PartyScope | null;
  const parties: PartyScope = raw && PARTIES.includes(raw) ? raw : 'suppliers';
  const from = sp.get('from') || DEFAULT_FROM;
  const to = sp.get('to') || todayIso();

  const scope: ScopeValue = contractor ? `contractor:${contractor}`
    : account ? `supplier:${account}` : project ? `project:${project}` : 'company';

  const params: AnalysisParams = { account, project, contractor, parties, date_from: from, date_to: to };

  function patch(next: Partial<{ scope: ScopeValue; parties: PartyScope; from: string; to: string }>) {
    const p = new URLSearchParams(sp);
    if (next.scope !== undefined) {
      p.delete('account'); p.delete('project'); p.delete('contractor');
      const i = next.scope.indexOf(':');
      if (i > 0) {
        const kind = next.scope.slice(0, i), v = next.scope.slice(i + 1);
        p.set(kind === 'supplier' ? 'account' : kind, v);
      }
    }
    if (next.parties !== undefined) {
      if (next.parties === 'suppliers') p.delete('parties'); else p.set('parties', next.parties);
    }
    if (next.from !== undefined) { if (next.from === DEFAULT_FROM) p.delete('from'); else p.set('from', next.from); }
    if (next.to !== undefined) { if (next.to === todayIso()) p.delete('to'); else p.set('to', next.to); }
    setSp(p, { replace: true });
  }

  return { params, scope, parties, from, to, patch, tab: sp.get('tab') || 'period',
    setTab: (t: string) => { const p = new URLSearchParams(sp); if (t === 'period') p.delete('tab'); else p.set('tab', t); setSp(p, { replace: true }); } };
}
