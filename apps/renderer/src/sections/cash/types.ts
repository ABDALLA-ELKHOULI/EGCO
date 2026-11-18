/**
 * أنواع استجابات الخادم لقسم «النقد» — منسوخة حرفياً من:
 *   services/api/app/services/cashflow_service.py (cashflow / breakdown / _overdue_view …)
 *   services/api/app/api/routes/revenues.py (_out / list_revenues)
 * لماذا هنا لا في lib/api.ts؟ lib/api.ts يعيد `any` ومملوك للمُدمِج؛ القسم يحتاج أنواعاً
 * صارمة كي يفشل tsc إن تغيّر شكل الخادم بدل أن يعرض رقماً خاطئاً بصمت.
 * المبالغ تصل أرقاماً عشرية مقرَّبة مرة واحدة على الخادم (money()) — لا نعيد تقريبها.
 */

export type Parties = 'suppliers' | 'contractors' | 'both';
export type BreakdownTerm = 'scheduled' | 'overdue' | 'undated' | 'beyond' | 'collected' | 'forecast';

export interface CashPeriod {
  label: string;
  from: string; // ISO yyyy-mm-dd
  to: string;
  inflow: number;
  outflow: number;
  net: number;
  balance: number;
  inflowCount: number;
  outflowCount: number;
  deficit: boolean;
  collected: number;
}

export interface FirstDeficit { label: string; from: string; to: string; amount: number }

export interface ReceivablesStats { total: number; dated: number; undated: number; collected: number }

export interface CashSummary {
  totalInflow: number;
  totalOutflow: number;
  netTotal: number;
  minBalance: number;
  firstDeficit: FirstDeficit | null;
  hasReceivables: boolean;
  receivablesStats: ReceivablesStats;
}

export interface CollectedRow { date: string; client: string; project: string | null; amount: number }

export interface Collections {
  inWindow: number;
  total: number;
  count: number;
  truncated: boolean;
  rows: CollectedRow[];
}

export interface AgeBucket {
  fromDays: number;
  toDays: number | null;
  outflowAmount: number;
  outflowCount: number;
  inflowAmount: number;
  inflowCount: number;
}

export interface OverdueView {
  totalOverdueOutflow: number;
  totalOverdueInflow: number;
  buckets: AgeBucket[];
  minBalanceIfOverdueOutflowSettledToday: number;
  minBalanceIfOverdueInflowCollectedToday: number;
}

export interface ForecastVsActual { expectedInflow: number; actualCollected: number; gap: number }

export interface ReconNote { noteCode: string; noteText: string | null; updatedAt: string }

export interface OutflowRecon {
  scheduled: number;
  overdueNow: number;
  beyondHorizon: number;
  undated: number;
  credits: number;
  excess: number;
  openDebt: number;
  difference: number;
}

export interface InflowRecon {
  scheduled: number;
  overdueNow: number;
  beyondHorizon: number;
  undated: number;
  openTotal: number;
  difference: number;
}

export interface Reconciliation {
  from: string;
  horizonEnd: string;
  outflow: OutflowRecon | null;
  suppliers: Record<string, number> | null;
  contractors: Record<string, number> | null;
  inflow: InflowRecon | null;
}

export interface CashflowResponse {
  asOf: string;
  openingBalance: number;
  /** مصدر الرصيد الافتتاحي (API-CONTRACT §٤) — اختياري لخوادم أقدم */
  openingBalanceSource?: 'query' | 'bank' | 'none';
  periodDays: number;
  periods: CashPeriod[];
  summary: CashSummary;
  warnings: string[];
  collections: Collections;
  overdueView: OverdueView;
  forecastVsActual: ForecastVsActual;
  reconciliationNote: ReconNote | null;
  projects: string[];
  parties: Parties;
  undatedContractorDues: number;
  contractorBalanceScopeNote: string | null;
  reconciliation: Reconciliation;
}

export interface CashflowQuery {
  weeks: number;
  /** null ⇒ لا يُرسل: الخادم يستعمل الرصيد البنكي المحفوظ */
  openingBalance: number | null;
  project: string; // '' = كل المشاريع
  parties: Parties;
  periodDays: number;
}

/* ─── صفوف /cashflow/breakdown — ثلاثة أشكال يميّزها حقل مميِّز ─── */
export interface SupplierBdRow {
  account: string;
  supplierName: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string | null;
  amount: number;
  daysOverdue: number | null;
}
export interface ContractorBdRow {
  contractorCode: string;
  contractorName: string;
  project: string | null;
  releaseDue: string | null;
  amount: number;
}
export interface ReceivableBdRow { date: string; client: string; project: string | null; amount: number }
export type BreakdownRow = SupplierBdRow | ContractorBdRow | ReceivableBdRow;

export interface BreakdownResponse { term: BreakdownTerm; total: number; truncated: boolean; rows: BreakdownRow[] }

export const isSupplierRow = (r: BreakdownRow): r is SupplierBdRow => 'invoiceNumber' in r;
export const isContractorRow = (r: BreakdownRow): r is ContractorBdRow => 'contractorCode' in r;
export const isReceivableRow = (r: BreakdownRow): r is ReceivableBdRow => 'client' in r;

/* ─── التحصيلات (/revenues) ─── */
export type RevenueStatus = 'open' | 'collected';

export interface Revenue {
  id: string;
  project: string;
  unit: string;
  client: string;
  amount: number;
  dueDate: string | null;
  collectedOn: string | null;
  status: RevenueStatus;
  source: string; // 'manual' | 'receivables_legacy_html' | 'receivables_excel'
  notes: string;
  createdAt: string | null;
}

export interface RevenueTotals {
  count: number;
  open: number;
  collected: number;
  all: number;
  overdueOpen: number;
  datedOpen: number;
  undatedOpen: number;
}

export interface RevenuesResponse {
  count: number;
  rows: Revenue[];
  totals: RevenueTotals;
  projects: string[];
  clients: string[];
  filtersApplied: Record<string, unknown>;
}

export type RevenueSortKey = 'client' | 'project' | 'amount' | 'dueDate' | 'status' | 'source';

export interface RevenuesQuery {
  q?: string;
  project?: string;
  status?: RevenueStatus | '';
  dateFrom?: string;
  dateTo?: string;
  dateField?: 'due' | 'collected';
  minAmount?: number;
  maxAmount?: number;
  sort?: RevenueSortKey;
  dir?: 'asc' | 'desc';
}

export interface RevenueInput {
  project: string;
  unit: string;
  client: string;
  amount: number;
  dueDate: string | null;
  status: RevenueStatus;
  collectedOn: string | null;
  notes: string;
}

/* ─── «ماذا لو؟» عبر الخادم (/ai/what-if) — مُبقى للتكافؤ ─── */
export interface WhatIfServerResult { narrative: string; before: Record<string, unknown>; after: Record<string, unknown> }
