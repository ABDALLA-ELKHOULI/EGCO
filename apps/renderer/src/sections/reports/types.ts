/**
 * أنواع حمولات الخادم التي يستهلكها قسم «التقارير».
 *
 * مكتوبة من الخادم نفسه (services/api/app/services/report_service.py و
 * contractor_report_service.py و periods_service.py و ai_features_service.py)
 * لا من الواجهة القديمة — Report.tsx كان يقرأ كل شيء `any` فاختفت أخطاء الحقول.
 * المبالغ تصل float مقرَّبة مرة واحدة عند الحدّ (money() في payables.py)؛
 * الواجهة لا تجمعها ولا تطرحها — تعرضها فقط (CLAUDE.md §٢).
 */
import type { PartyScope } from '@/lib/api';

export type { PartyScope };

/* ───────── /api/v1/reports/analysis ───────── */

export type ScopeKind = 'company' | 'supplier' | 'project' | 'contractor';

export interface ReportMeta {
  company: string;
  department: string;
  title: string;
  serial: string;
  issued_on: string;
  period: string;
  opening_balance: number;
  closing_balance: number;
  invoiced_in_period: number;
  paid_in_period: number;
  period_from: string | null;
  period_to: string;
  basis: string;
  classification: string;
  currency: string;
  scope: ScopeKind;
  scope_label: string;
  parties?: PartyScope;
  includes?: { suppliers: boolean; contractors: boolean };
  ageing_covers?: 'suppliers';
}

export interface ReportSummary {
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  credit_balances: number;
  net_outstanding: number;
  overdue: number;
  due_within_7: number;
  supplier_count: number;
  contractor_count?: number;
  contractor_balance?: number;
}

export interface AgeingBucket { label: string; count: number; amount: number; pct: number }

export interface ScheduleItem {
  partyKind: 'supplier' | 'contractor';
  name: string;
  account: string;
  invoice: string;
  amount: number;
  overdue: boolean;
}

export interface ScheduleRow {
  date: string;
  date_ar: string;
  count: number;
  amount: number;
  status: string;
  overdue: boolean;
  items: ScheduleItem[];
}

export interface ReportSupplierRow {
  partyKind: 'supplier';
  account: string;
  name: string;
  project: string | null;
  term: string;
  outstanding: number;
  overdue: number;
}

export interface LastPayment { date: string; amount: number }

export interface ReportContractorRow {
  partyKind: 'contractor';
  code: string;
  name: string;
  account: string;
  projects: string[];
  invoiced: number;
  paid: number;
  deductions: number;
  outstanding: number;
  /** اصطلاح الكشف: سالب = نحن ندين له · موجب = يدين لنا (CLAUDE.md §٢). */
  balance: number;
  entryCount: number;
  lastActivity: string | null;
  lastPayment: LastPayment | string | null;
}

export interface ContractorTotals {
  count: number;
  invoiced: number;
  paid: number;
  deductions: number;
  outstanding: number;
  balance: number;
}

export interface ReportNote { title: string; body: string }

export interface ContractorDetailProject {
  project: string;
  invoiced: number;
  paid: number;
  deductions: number;
  balance: number;
  entryCount: number;
  entries: Record<string, unknown>[];
}

export interface AnalysisPayload {
  meta: ReportMeta;
  summary: ReportSummary;
  ageing: AgeingBucket[];
  ageingUndated: number;
  schedule: ScheduleRow[];
  suppliers: ReportSupplierRow[];
  notes: ReportNote[];
  contractors?: { rows: ReportContractorRow[]; totals: ContractorTotals };
  contractorDetail?: {
    partyKind: 'contractor'; code: string; name: string; byProject: ContractorDetailProject[];
  };
}

export interface AnalysisParams {
  account?: string;
  project?: string;
  contractor?: string;
  parties?: PartyScope;
  date_from?: string;
  date_to?: string;
}

/* ───────── /api/v1/reports/scopes ───────── */

export interface ScopesPayload {
  suppliers: { account: string; name: string; project: string; hasData: boolean }[];
  projects: string[];
  contractors: { code: string; name: string; hasData: boolean }[];
  parties: PartyScope[];
}

/* ───────── /api/v1/reports/project-summary ───────── */

export interface ProjectSummaryRow {
  partyKind: 'supplier' | 'contractor';
  account: string;
  name: string;
  totalInvoiced: number;
  totalPaid: number;
  outstanding: number;
  /** null للمقاولين: دفترهم بلا تواريخ استحقاق — غياب لا صفر. */
  delay: { amount: number; days: number; bucket: string; byBucket: Record<string, number> } | null;
  lastPayment: LastPayment | null;
}

export interface ProjectSummaryPayload {
  project: string;
  parties: PartyScope;
  today: string;
  rows: ProjectSummaryRow[];
  totals: {
    totalInvoiced: number; totalPaid: number; outstanding: number;
    delayedAmount: number; maxDelayDays: number;
    byBucket: Record<string, number>; companyCount: number;
  };
  contractorScopeNote: string | null;
}

/* ───────── /api/v1/reports/priorities  و  /api/v1/ai/priorities ───────── */

export interface PriorityItem {
  partyKind: 'supplier' | 'contractor';
  key: string;
  name: string;
  amount: number;
  score: number;
  reason: string;
  link?: string;
  /** من الخادم حين تُمرَّر ميزانية — لا يُحسب في الواجهة (كان محلياً في Report.tsx:408). */
  fitsInBudget?: boolean;
}

export interface PrioritiesPayload {
  items: PriorityItem[];
  budget: { budget: number; allocated: number; remaining: number } | null;
  /** من مسار الذكاء فقط. */
  narrative?: string;
}

/* ───────── /api/v1/reports/periodic ───────── */

export type Granularity = 'quarter' | 'half' | 'year';

export interface PeriodRow {
  label: string;
  from: string;
  to: string;
  opening: number;
  invoiced: number;
  paid: number;
  net: number;
  closing: number;
  cumulativePaid: number;
  byProject: { project: string; paid: number }[];
  topSuppliers: { account: string; name: string; paid: number }[];
  avgSettlementDays: number | null;
  complete: boolean;
}

export interface ComparisonRow {
  label: string;
  paid: number;
  prevPaid: number | null;
  prevPct: number | null;
  yoyPaid: number | null;
  yoyPct: number | null;
}

export interface PeriodicPayload {
  granularity: Granularity;
  year: number;
  coverage: { first: string | null; last: string | null };
  periods: PeriodRow[];
  comparison: ComparisonRow[];
}
