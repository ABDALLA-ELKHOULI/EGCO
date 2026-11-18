/**
 * خطافات قسم «النقد» فوق `@/data` (TanStack Query — العقد §٣).
 * الجذور 'cashflow' و'revenues' مطابقة لأحداث invalidate من الخادم، فتحديث بعد استيراد
 * يصل تلقائياً. كل كتابة في التحصيلات تبطل الجذرين معاً: تحصيل واحد يغيّر الداخل المتوقع.
 * نستورد من `@/data/hooks` مباشرة (index.ts أُضيف لاحقاً لدى F — مكافئ).
 */
import { useApi, useApiMutation } from '@/data/hooks';
import { cashApi } from './api';
import type {
  BreakdownResponse, BreakdownTerm, CashflowQuery, CashflowResponse, ReconNote, Revenue, RevenueInput,
  RevenuesQuery, RevenuesResponse, WhatIfServerResult,
} from './types';
import type { BankBalance } from './api';

/**
 * أشكال النتائج المستعملة فقط من UseQueryResult/UseMutationResult (TanStack v5). مكتوبة صراحةً كي
 * تبقى عروض القسم مكتوبة الأنواع حتى لو تعطّلت أنواع @/data مؤقتاً — والشكل مطابق فلا تحويل.
 */
export interface Q<T> { data: T | undefined; error: Error | null; isLoading: boolean; refetch: () => unknown }
export interface M<V, R> {
  mutate: (v: V) => void; mutateAsync: (v: V) => Promise<R>;
  isPending: boolean; error: Error | null; data: R | undefined;
}
const q = <T,>(x: unknown) => x as Q<T>;
const m = <V, R>(x: unknown) => x as M<V, R>;

export const CASH_ROOTS = ['cashflow', 'revenues'];

export const useCashflow = (cq: CashflowQuery): Q<CashflowResponse> =>
  q(useApi(['cashflow', cq], (s: AbortSignal) => cashApi.cashflow(cq, s)));

/** صفوف المصدر وراء رقم — لا تُجلب حتى تُفتح النافذة. */
export const useBreakdown = (cq: CashflowQuery, term: BreakdownTerm | null, period?: string): Q<BreakdownResponse> =>
  q(useApi(['cashflow', 'breakdown', cq, term, period ?? null],
    (s: AbortSignal) => cashApi.breakdown(cq, term ?? 'scheduled', period, s), { enabled: term != null }));

/** بنود السيناريو: الخارج المجدول + المتأخر + الداخل المتوقع، صفاً صفاً — عند فتح اللوحة فقط. */
export function useScenarioRows(cq: CashflowQuery, enabled: boolean) {
  const sched = q<BreakdownResponse>(useApi(['cashflow', 'breakdown', cq, 'scheduled', null], (s: AbortSignal) => cashApi.breakdown(cq, 'scheduled', undefined, s), { enabled }));
  const overdue = q<BreakdownResponse>(useApi(['cashflow', 'breakdown', cq, 'overdue', null], (s: AbortSignal) => cashApi.breakdown(cq, 'overdue', undefined, s), { enabled }));
  const forecast = q<BreakdownResponse>(useApi(['cashflow', 'breakdown', cq, 'forecast', null], (s: AbortSignal) => cashApi.breakdown(cq, 'forecast', undefined, s), { enabled }));
  return {
    scheduled: sched.data, overdue: overdue.data, forecast: forecast.data,
    loading: sched.isLoading || overdue.isLoading || forecast.isLoading,
    error: (sched.error ?? overdue.error ?? forecast.error)?.message ?? null,
    // صفوف مقصوصة (>٥٠٠) ⇒ السيناريو لا يرى كل البنود — تحذير بدل رقم ناقص صامت
    truncated: Boolean(sched.data?.truncated || overdue.data?.truncated || forecast.data?.truncated),
  };
}

/** الرصيد البنكي المحفوظ — `data === null` يعني أن الخادم لم يدعمه بعد (تراجع لحقل يدوي). */
export const useBankBalance = (): Q<BankBalance | null> => q(useApi(['cashflow', 'bank-balance'], (s: AbortSignal) => cashApi.bankBalance(s)));
export const useSaveBankBalance = (): M<number | null, BankBalance> =>
  m(useApiMutation((b: number | null) => cashApi.saveBankBalance(b), { invalidate: ['cashflow', 'today', 'overview'], success: 'حُفظ الرصيد البنكي' }));

export const useRevenues = (rq: RevenuesQuery): Q<RevenuesResponse> => q(useApi(['revenues', rq], (s: AbortSignal) => cashApi.revenues(rq, s)));

export const useSaveReconNote = (): M<Parameters<typeof cashApi.saveReconNote>[0], ReconNote> =>
  m(useApiMutation(cashApi.saveReconNote, { invalidate: ['cashflow'], success: 'حُفظ تفسير الفرق' }));

export const useCreateRevenue = (): M<RevenueInput, Revenue> =>
  m(useApiMutation((b: RevenueInput) => cashApi.createRevenue(b), { invalidate: CASH_ROOTS }));
export const useUpdateRevenue = (): M<{ id: string; patch: Partial<RevenueInput> }, Revenue> =>
  m(useApiMutation((v: { id: string; patch: Partial<RevenueInput> }) => cashApi.updateRevenue(v.id, v.patch), { invalidate: CASH_ROOTS }));
export const useDeleteRevenue = (): M<string, { deleted: boolean }> =>
  m(useApiMutation((id: string) => cashApi.deleteRevenue(id), { invalidate: CASH_ROOTS }));

/** «ماذا لو؟» عبر المساعد — الأرقام من الخادم، النص فقط من المساعد (P-229). */
export const useWhatIfServer = (): M<Parameters<typeof cashApi.whatIfServer>[0], WhatIfServerResult> =>
  m(useApiMutation(cashApi.whatIfServer, { errorToast: false }));
