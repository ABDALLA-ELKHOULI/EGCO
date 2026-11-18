/**
 * نقاط قسم «النقد» التي لا دالة لها في lib/api.ts بعد. تمرّ عبر `request` من `@/data/client`
 * (عميل F الرسمي — العقد §٦ يمنع fetch مباشراً، لا هذا). كل بارامتر بالاسم الذي يقرؤه الخادم.
 *
 * الرصيد البنكي (API-CONTRACT §٤): يُطلب مباشرةً؛ 404 فقط ⇒ «غير مدعوم» (تراجع لحقل يدوي).
 * لا اعتماد على فحص openapi — كان يفشل فيُخفي الإعداد رغم وجود المسار (BUG-006).
 */
import { request } from '@/data/client';
import type {
  BreakdownResponse, BreakdownTerm, CashflowQuery, CashflowResponse, ReconNote,
  Revenue, RevenueInput, RevenuesQuery, RevenuesResponse, WhatIfServerResult,
} from './types';

function qs(p: Record<string, string | number | undefined | null>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== null && v !== '') s.set(k, String(v));
  const out = s.toString();
  return out ? '?' + out : '';
}

/** `parties` يُرسل صراحةً دائماً: افتراض الخادم «suppliers» للتوافق الخلفي، والواجهة «both» (P-205). */
// openingBalance=null ⇒ لا يُرسل الباراميتر فيبدأ الخادم من الرصيد البنكي المحفوظ
// (openingBalanceSource="bank") — نفس مصدر /today kpis.bankBalance، فلا يختلف الرقمان.
const cashParams = (q: CashflowQuery) => ({
  weeks: q.weeks, opening_balance: q.openingBalance, project: q.project || undefined,
  parties: q.parties, period_days: q.periodDays,
});

export const BANK_BALANCE_PATH = '/api/v1/settings/bank-balance';
/** الشكل حرفياً من الخادم: المبلغ نص Decimal أو null، و`at` وقت الحفظ. */
export interface BankBalanceWire { balance: string | null; at: string | null }
export interface BankBalance { balance: number | null; at: string | null }
const fromWire = (w: BankBalanceWire): BankBalance => ({ balance: w.balance == null ? null : Number(w.balance), at: w.at });

export const cashApi = {
  cashflow: (q: CashflowQuery, signal?: AbortSignal) =>
    request<CashflowResponse>('/api/v1/cashflow' + qs(cashParams(q)), { signal }),

  breakdown: (q: CashflowQuery, term: BreakdownTerm, period?: string, signal?: AbortSignal) =>
    request<BreakdownResponse>('/api/v1/cashflow/breakdown' + qs({
      term, period, weeks: q.weeks, period_days: q.periodDays,
      project: q.project || undefined, parties: q.parties,
    }), { signal }),

  saveReconNote: (b: { parties: CashflowQuery['parties']; project: string | null; noteCode: string; noteText: string | null }) =>
    request<ReconNote>('/api/v1/cashflow/reconciliation-note', { method: 'POST', body: JSON.stringify(b) }),

  /** null = النقطة غير موجودة بعد على الخادم (طلب B). */
  bankBalance: async (signal?: AbortSignal): Promise<BankBalance | null> => {
    try {
      return fromWire(await request<BankBalanceWire>(BANK_BALANCE_PATH, { signal }));
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null; // خادم أقدم بلا المسار
      throw e;
    }
  },
  /** يُرسل نصاً بخانتين كي لا يمر المبلغ عبر float على الخادم. */
  saveBankBalance: async (balance: number | null) =>
    fromWire(await request<BankBalanceWire>(BANK_BALANCE_PATH, {
      method: 'PUT', body: JSON.stringify({ balance: balance == null ? null : balance.toFixed(2) }),
    })),

  revenues: (q: RevenuesQuery, signal?: AbortSignal) =>
    request<RevenuesResponse>('/api/v1/revenues' + qs({
      q: q.q, project: q.project, status: q.status, date_from: q.dateFrom, date_to: q.dateTo,
      date_field: q.dateField, min_amount: q.minAmount, max_amount: q.maxAmount, sort: q.sort, dir: q.dir,
    }), { signal }),
  createRevenue: (b: RevenueInput) => request<Revenue>('/api/v1/revenues', { method: 'POST', body: JSON.stringify(b) }),
  updateRevenue: (id: string, b: Partial<RevenueInput>) =>
    request<Revenue>(`/api/v1/revenues/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteRevenue: (id: string) =>
    request<{ deleted: boolean }>(`/api/v1/revenues/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  whatIfServer: (b: { partyKind: 'supplier' | 'contractor'; key: string; shiftDays: number }) =>
    request<WhatIfServerResult>('/api/v1/ai/what-if', { method: 'POST', body: JSON.stringify(b) }),
};
