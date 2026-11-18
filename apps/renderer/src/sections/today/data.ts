/**
 * قسم «اليوم» — طبقة البيانات: hooks مطبوعة فوق `@/data` (TanStack Query) وتحويل
 * الاستجابات إلى مدخلات `logic.ts`. لا حساب مالي هنا — تجميع/تصفية فقط.
 *
 * مصادر كل شاشة (حتى يكتمل `/api/v1/today` من الوكيل B):
 *  - اليوم:     /overview · /dashboard · /contractors/claims-due · /guarantees · /cashflow · /import/history · /today (اختياري)
 *  - المستحقات: /dashboard.payToday (≤٧ أيام) · /cashflow/breakdown (٣٠ يوماً/الكل) · /contractors/claims-due
 *  - التقويم:   /dashboard.schedule · /dashboard/day · /contractors/claims-due · /guarantees
 */
import { useMemo } from 'react';
import {
  api, request, useApi, useApiMutation, useDashboard, useOverview, useToday, useGuarantees, useImportHistory, useProjects,
} from '@/data';
import type {
  PayTodayRow, ClaimDueRow, BreakdownSupplierRow, GuaranteeLite, CashPeriod, Ageing, ScheduleBucket, Snapshot, DueRange,
} from './logic.ts';

/* ───────────────────────── أشكال الاستجابات (الحقول المستعملة فقط) ───────────────────────── */

export interface OverviewData {
  asOf: string;
  payables: { outstanding: number; overdue: number; dueWithin7: number; supplierCount: number; withData: number };
  coverage: { coveredPct: number | null; withoutData: number; stale: number };
  needsTerm: number;
  cash: { nextDeficit: { label: string; amount: number; from: string; to: string } | null; minBalance: number; hasReceivables: boolean };
  projects: { project: string; outstanding: number; overdue: number }[];
  alerts: { level: 'danger' | 'warning' | 'info'; kind?: string; text: string }[];
  contractors: {
    count: number; owedToContractors: number; overdue: number; overdueContractorCount: number; dueWithin7: number;
    withTermCount: number; withoutTermCount: number; withoutStatementCount: number; withoutStatementOwed: number;
  };
  guarantees: { heldTotal: number; dueCount: number; upcomingCount: number };
}
export interface DashboardData {
  today: string;
  summary: { overdue: number; dueWithin7: number; outstanding: number; totalPaid: number; supplierCount: number; awaitingDate: number };
  payToday: PayTodayRow[];
  ageing: Ageing;
  schedule: ScheduleBucket[];
}
export interface DayDetail {
  date: string;
  suppliers: { account: string; supplier: string; invoice: string | null; amount: number; overdue: boolean }[];
  guarantees: { code: string; name: string; project: string; amount: number; status: string }[];
  totals: { due: number; guarantees: number };
}
interface ClaimsDueResponse { rows: ClaimDueRow[]; count: number; totals: { amount: number; overdue: number } }
interface BreakdownResponse { term: string; total: number; truncated: boolean; rows: BreakdownSupplierRow[] }
interface CashflowData { asOf: string; openingBalance: number; periods: CashPeriod[]; summary: { minBalance: number; hasReceivables: boolean } }
interface GuaranteesData { contractorGuarantees: GuaranteeLite[] }
interface ImportRow { id: string; date: string; fileName: string; added: number }

/** /api/v1/today كما في docs/next/API-CONTRACT.md §٢ — المبالغ نصوص Decimal من الخادم. */
type MoneyStr = string | null;
interface TodaySnapRaw { supplierOpen?: MoneyStr; supplierOverdue?: MoneyStr; contractorOwed?: MoneyStr }
export interface TodayRaw {
  asOf: string;
  kpis: {
    supplierOpen: MoneyStr; supplierOverdue: MoneyStr; supplierDue7: MoneyStr;
    contractorOwed: MoneyStr; contractorOverdue: MoneyStr; withTerm: number; withoutTerm: number;
    bankBalance: MoneyStr; bankBalanceAt: string | null; cashLow: MoneyStr; cashLowDate: string | null; firstDeficitDate: string | null;
  };
  tasks: { id: string; severity: 'danger' | 'warn' | 'info'; title: string; detail: string; amount: MoneyStr;
    action: { label: string; view: string; params?: Record<string, string> } }[];
  lastChange: { at: string; file: string | null; before: TodaySnapRaw; after: TodaySnapRaw; newInvoices: number; paidInvoices: number } | null;
  cash30: { date: string; balance: MoneyStr }[];
  cashBasis: 'bank' | 'no_bank_balance';
}
/** نص Decimal → number للعرض فقط (لا حساب)؛ null يبقى null. */
export const num = (v: MoneyStr | number | undefined): number | null => (v == null || v === '' ? null : Number(v));
const snap = (x: TodaySnapRaw): Snapshot => ({ supplierOverdue: num(x.supplierOverdue) ?? undefined, supplierOpen: num(x.supplierOpen) ?? undefined, contractorOwed: num(x.contractorOwed) ?? undefined });

/** شكل مُطبَّع لما تستعمله الشاشات. */
export interface TodayData {
  raw: TodayRaw;
  bankBalance: number | null;
  cashBasis: 'bank' | 'no_bank_balance';
  cash30: { date: string; balance: number }[];
  firstDeficitDate: string | null;
  cashLow: number | null;
  lastChange: { at: string; file: string; before: Snapshot; after: Snapshot; newInvoices: number; paidInvoices: number } | null;
}

/* ───────────────────────── نقاط ليست في lib/api.ts بعد ─────────────────────────
 * /contractors/claims-due و/cashflow/breakdown موجودتان في الخادم بلا دالة في api.ts (ملك F)؛
 * نمرّ عبر `request` من @/data (لا fetch مباشر). حين تُضاف `api.claimsDue`/`api.cashflowBreakdown`
 * يُستبدل `get` أدناه بهما ولا يتغيّر شيء آخر. */
function get<T>(path: string, params: Record<string, string | number | undefined>, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') q.set(k, String(v));
  return request<T>(path + (q.toString() ? '?' + q.toString() : ''), { signal });
}

/* ───────────────────────── hooks ───────────────────────── */

export function useOverviewData() { return useOverview() as { data?: OverviewData; error: unknown; isLoading: boolean; refetch: () => unknown }; }
export function useDashboardData(project?: string) {
  return useDashboard({ project: project || undefined }) as { data?: DashboardData; error: unknown; isLoading: boolean; refetch: () => unknown };
}
/**
 * حالة /today الثلاثية — «لم يُحمَّل بعد/فشل» ليس «رصيد البنك غير مُدخل» (BUG-008).
 * td موجود فقط بعد نجاح الطلب؛ loading/error يُعرضان صراحةً.
 */
export function useTodayState() {
  const q = useToday<TodayRaw>();
  const td = useTodayData(q.error ? undefined : (q.data as TodayRaw | undefined));
  return { td, loading: !q.error && !q.data, error: q.error as unknown, refetch: () => { q.refetch(); } };
}
function useTodayData(r: TodayRaw | undefined) {
  return useMemo<TodayData | undefined>(() => (r && r.kpis ? {
    raw: r,
    bankBalance: num(r.kpis.bankBalance),
    cashBasis: r.cashBasis,
    cash30: (r.cash30 ?? []).map((p) => ({ date: p.date, balance: Number(p.balance) })),
    firstDeficitDate: r.kpis.firstDeficitDate,
    cashLow: num(r.kpis.cashLow),
    lastChange: r.lastChange ? { at: r.lastChange.at, file: r.lastChange.file || '', before: snap(r.lastChange.before), after: snap(r.lastChange.after),
      newInvoices: r.lastChange.newInvoices, paidInvoices: r.lastChange.paidInvoices } : null,
  } : undefined), [r]);
}
export function useClaimsDue(project?: string, enabled = true) {
  return useApi(['contractors', 'claims-due', project || ''], (signal) =>
    get<ClaimsDueResponse>('/api/v1/contractors/claims-due', { project }, signal), { enabled });
}
export function useGuaranteeList(): GuaranteeLite[] {
  const q = useGuarantees();
  return (q.data as GuaranteesData | undefined)?.contractorGuarantees ?? [];
}
export function useLastImport(): ImportRow | null {
  const q = useImportHistory() as { data?: { rows: ImportRow[] } };
  const rows = q.data?.rows ?? [];
  return rows.reduce<ImportRow | null>((m, r) => (!m || r.date > m.date ? r : m), null);
}
/** توقع ٣٠ يوماً بفترات أسبوعية — نفس /cashflow الذي تعرضه شاشة النقد، بالرصيد الافتتاحي الذي يعيده الخادم. */
export function useProjection(enabled: boolean) {
  // احتياطي فقط حين لا يتوفر /today.cash30. بلا opening_balance: الخادم يستعمل الرصيد البنكي المحفوظ إن وُجد.
  const p = { weeks: 5, period_days: 7 };
  const q = useApi<CashflowData>(['cashflow', p], () => api.cashflow(p) as Promise<CashflowData>, { enabled });
  return q.data;
}
export function useProjectNames(): string[] {
  const q = useProjects() as { data?: { rows?: { project: string }[] } };
  return useMemo(() => (q.data?.rows ?? []).map((r) => r.project), [q.data]);
}
export function useDayDetail(date: string | null, project?: string) {
  return useApi<DayDetail>(['dashboard', 'day', date || '', project || ''],
    () => api.calendarDay(date as string, { project: project || undefined }),
    { enabled: !!date });
}

/**
 * صفوف الموردين لقائمة المستحقات بحسب المدى.
 *  - اليوم/٧ أيام: /dashboard.payToday (الخادم يقصرها على ٧ أيام + كل المتأخر).
 *  - ٣٠ يوماً/الكل: /cashflow/breakdown بمصطلحات overdue + scheduled (+ beyond للكل).
 *    الخادم يقصّ كل مصطلح عند ٥٠٠ صف ويعلن ذلك في `truncated` — نُفصح عنه ولا نُخفيه.
 */
export function useSupplierDue(range: DueRange, project: string, payToday: PayTodayRow[] | undefined) {
  const wide = range === '30' || range === 'all';
  const weeks = range === 'all' ? 104 : 5;
  const terms = range === 'all' ? ['overdue', 'scheduled', 'beyond'] : ['overdue', 'scheduled'];
  const q = useApi(['cashflow', 'breakdown', range, project], async (signal) => {
    const parts = await Promise.all(terms.map((term) =>
      get<BreakdownResponse>('/api/v1/cashflow/breakdown', { term, weeks, period_days: 7, project: project || undefined, parties: 'suppliers' }, signal)));
    return { rows: parts.flatMap((p) => p.rows), truncated: parts.some((p) => p.truncated) };
  }, { enabled: wide });
  if (!wide) return { rows: payToday ?? [], truncated: false, loading: !payToday, error: null as unknown };
  return { rows: q.data?.rows ?? [], truncated: !!q.data?.truncated, loading: q.isLoading, error: q.error };
}

/* ───────────────────────── تسجيل الدفعات ───────────────────────── */

export interface PayInput { partyType: 'supplier' | 'contractor'; key: string; amount: number; date: string; doc?: string; note?: string }
export interface PayResult { partyType: 'supplier' | 'contractor'; key: string; id: string }

const PAY_INVALIDATES = ['dashboard', 'overview', 'today', 'suppliers', 'supplier', 'contractors', 'contractor', 'cashflow', 'projects'];

/** دفعة يدوية لمورد (/manual/payments) أو حركة دفع على دفتر مقاول (debit، kind=payment). */
export function useRecordPayment() {
  return useApiMutation(async (x: PayInput): Promise<PayResult> => {
    if (x.partyType === 'contractor') {
      const r = await api.createContractorEntry(x.key, {
        date: x.date, debit: x.amount, credit: 0, kind: 'payment',
        description: 'دفعة' + (x.doc ? ' — ' + x.doc : '') + (x.note ? ' — ' + x.note : ' — من «اليوم»'),
      }) as { id: string };
      return { partyType: 'contractor', key: x.key, id: r.id };
    }
    const r = await api.addManualPayment({ account: x.key, amount: x.amount, date: x.date, reference: x.doc || undefined, description: x.note || 'دفعة يدوية — من «اليوم»' }) as { id: string };
    return { partyType: 'supplier', key: x.key, id: r.id };
  }, { invalidate: PAY_INVALIDATES });
}
/** التراجع عن دفعة سُجّلت للتو (حذف منطقي في الخادم). */
export function useUndoPayment() {
  return useApiMutation(async (p: PayResult) => {
    if (p.partyType === 'contractor') await api.deleteContractorEntry(p.key, p.id);
    else await api.deleteManualPayment(p.id);
    return true;
  }, { invalidate: PAY_INVALIDATES, success: 'أُلغيت الدفعة' });
}
