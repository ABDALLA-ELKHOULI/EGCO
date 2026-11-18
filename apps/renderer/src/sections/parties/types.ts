/* أنواع قسم «الأطراف» — مطابقة حقلاً بحقل لما يرسله الخادم اليوم (v0.13.0):
 *   الموردون:   services/api/app/services/payables_service.py (position_json/invoice_json/payment_json)
 *               + services/api/app/api/routes/suppliers.py (list_suppliers)
 *   المقاولون:  services/api/app/services/contractors_service.py (contractors_list_json/
 *               contractor_detail_json/contractors_overview_json)
 *   الضمانات:   lib/api.ts (GuaranteesResponse/GuaranteeAccountDetail) — تُعاد تصديرها كما هي.
 * المبالغ أرقام JSON خرجت من محرك Decimal مقرّبة مرة واحدة عند الحدّ — لا تُقرَّب هنا ولا تُجمع
 * إلا بالهللات الصحيحة (logic/money.ts). م-٥٠ مؤقت حتى يصدر docs/next/API-CONTRACT.md. */

import type {
  ContractorClaim, ContractorClaimBody, ContractorDetailResponse, ContractorEntry,
  ContractorEntryBody, ContractorExportFormat, ContractorGuarantee, ContractorGuaranteeBody,
  ContractorRow, ContractorStatus, GuaranteeAccountDetail, GuaranteeAccountRow,
  GuaranteeDueStatus, GuaranteesResponse, ContractorGuaranteeTracked, SupplierQuery, ContractorQuery,
} from '@/lib/api';

export type {
  ContractorClaim, ContractorClaimBody, ContractorEntry, ContractorEntryBody, ContractorExportFormat,
  ContractorGuarantee, ContractorGuaranteeBody, ContractorStatus, GuaranteeAccountDetail,
  GuaranteeAccountRow, GuaranteeDueStatus, GuaranteesResponse, ContractorGuaranteeTracked,
  SupplierQuery, ContractorQuery,
};

export type PartyType = 'supplier' | 'contractor';

/* ───────────── الموردون ───────────── */

/** حالة المورد كما يحسبها payables_service.status_of — القائمة المغلقة في _VALID_STATUSES. */
export type SupplierStatus = 'overdue' | 'due_soon' | 'awaiting_date' | 'open' | 'clear';
export type TermKind = 'days' | 'cash' | 'claim' | 'unset' | string;

export interface SupplierDelay {
  days: number;
  bucket: string | null;
  amount: number;
  byBucket: Record<string, number>;
}

export interface SupplierRow {
  account: string; name: string; project: string | null; projects: string[];
  term: string; termKind: TermKind; termDays: number | null;
  totalInvoiced: number; totalPaid: number; outstanding: number; overdue: number;
  dueToday: number; dueWithin7: number; needsManualDueDate: boolean;
  ageing: { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number };
  invoiceCount: number; openInvoiceCount: number;
  delay: SupplierDelay;
  unallocatedCount: number;
  lastPayment: { date: string; amount: number } | null;
  status: SupplierStatus;
  firstActivity: string | null; lastActivity: string | null;
}

export interface SupplierListResponse {
  count: number;
  rows: SupplierRow[];
  projects: string[];
  totals: {
    count: number; invoiced: number; paid: number; outstanding: number; overdue: number;
    dueWithin7: number; creditBalances: number; delayByBucket: Record<string, number>; delayed: number;
    openingBalance?: number; invoicedInPeriod?: number; paidInPeriod?: number; closingBalance?: number;
  };
  filtersApplied: Record<string, unknown>;
}

export type InvoiceSource = 'statement' | 'manual' | string;

export interface SupplierInvoice {
  id: string; number: string | null; date: string; amount: number; paid: number; remaining: number;
  dueDate: string | null; daysToDue: number | null; doc: string | null; description: string | null;
  source: InvoiceSource;
}

export interface SupplierPayment {
  id: string; date: string; amount: number; doc: string | null; description: string | null;
  source: InvoiceSource;
}

export interface UnallocatedPayment {
  payment: SupplierPayment;
  candidates: SupplierInvoice[];
  /** جملة عربية تشرح لماذا لم يُطبَّق FIFO تلقائياً (domain/payables.allocate_smart). */
  reason: string | null;
}

export interface SupplierDetailResponse extends Omit<SupplierRow, 'status' | 'firstActivity' | 'lastActivity'> {
  invoices: SupplierInvoice[];
  payments: SupplierPayment[];
  unallocatedPayments: UnallocatedPayment[];
  openingBalance: number; closingBalance: number;
  invoicedInPeriod: number; paidInPeriod: number; hasHistoryBefore: boolean;
}

export interface SupplierBody {
  account: string; name: string; project: string; term: string; projects?: string[];
}

export interface ManualInvoiceBody {
  amount: number; date: string; due_date?: string; description?: string; reference?: string;
}
export type ManualPaymentBody = Omit<ManualInvoiceBody, 'due_date'>;

export interface AllocationLine { invoiceId: string | null; amount: number }
export interface PaymentAllocationSetting { enabled: boolean; pendingCount: number }

/* ───────────── المقاولون ───────────── */

export type ContractorDirection = 'owed_to_them' | 'owed_to_us' | 'balanced';

/** م-٤٦: حقول التأخر — null لمن لا مدة سداد له («غير محسوب» لا «صفر»). */
export interface ContractorRowX extends ContractorRow {
  paymentTermDays: number | null;
  overdue: { amount: number; count: number; maxDays: number } | null;
  dueSoon: { within7: number; within30: number } | null;
  duesTotal: number; paidTotal: number;
  deductionsTotal?: number;
}

export interface ContractorsByProject {
  project: string; owedToContractors: number; owedToUs: number; count: number; unassigned?: boolean;
}

export interface ContractorListResponse {
  count: number;
  rows: ContractorRowX[];
  totals: {
    count: number; overdueTotal: number; overdueContractorCount: number;
    dueWithin7Total: number; dueWithin30Total: number;
    withTermCount: number; withoutTermCount: number;
    claimsTotal: number; paidTotal: number; deductionsTotal: number; balance: number;
    owedToContractors: number; owedToUs: number; retentionHeld: number;
    byStatus: unknown; derivedFromEntriesCount: number;
    byProject: ContractorsByProject[];
  };
  filtersApplied: Record<string, unknown>;
}

export interface ClaimDueRow {
  entryId: string | null; date: string; dueDate: string; amount: number; paid: number;
  remaining: number; daysLate: number; doc: string; description: string;
  claimNo: string | null; project: string;
}

export interface ContractorDetail extends ContractorDetailResponse {
  projects: string[];
  paymentTermDays: number | null;
  delay: {
    overdue: { amount: number; count: number; maxDays: number };
    dueSoon: { within7: number; within30: number };
    byBucket: Record<string, number>;
    claims: ClaimDueRow[];
  } | null;
}

/** ContractorBody + م-٤٦ paymentTermDays (null صريح = امسح المدة). */
export interface ContractorBodyX {
  code: string; name: string; phone?: string; notes?: string;
  status?: ContractorStatus; statusNote?: string;
  defaultRetentionRate?: number; defaultGuaranteeDays?: number;
  paymentTermDays?: number | null;
  projects?: string[];
}

export interface ContractorsOverview {
  totals: { owedToContractors: number; contractorCount: number; retentionHeld: number };
  reported: { owed: number; contractorCount: number; byProject?: OverviewByProject[]; topOwed?: OverviewTopOwed[] } | null;
  withoutLedger: { count: number; owed: number };
  byProject: OverviewByProject[];
  topOwed: OverviewTopOwed[];
  guaranteeAccounts216: { total: number; count: number };
  balanceMismatches: { account: string; name: string | null; fileBalance: number | null; derivedBalance: number | null }[];
  lastDebtsReportImport: string | null;
  hasDebtsReportImport: boolean;
}
export interface OverviewByProject { project: string; owed: number; contractorCount: number }
export interface OverviewTopOwed { code: string; name: string; balance: number; projects: string[] }

/* ───────────── م-٥٠ · مشاريع الطرف بمبالغ ─────────────
 * GET  /api/v1/{suppliers|contractors}/{id}/projects            (الوكيل B — قيد البناء)
 * PUT  /api/v1/projects/{project}/parties/{type}/{id}  {amount, notes}   (نفس مسار قسم المشاريع)
 * DELETE /api/v1/projects/{project}/parties/{type}/{id}
 * يُطابَق مع docs/next/API-CONTRACT.md حين يصدر. */
export interface PartyProject {
  project: string;
  /** المبلغ المُسند (قيمة التعاقد/الإسناد على هذا المشروع). null = ربط قديم بلا مبلغ. */
  amount: number | null;
  notes: string | null;
  /** المنفّذ: فواتير المورد / مستخلصات المقاول على هذا المشروع — من الخادم. */
  executed: number;
  paid: number;
  open: number;
}
export interface PartyProjectsResponse {
  partyType: PartyType;
  partyId: string;
  projects: PartyProject[];
  /** مجموع المبالغ المُسندة — من الخادم (Decimal)؛ لا نعيد جمعه إلا للتحقق. */
  totalAmount?: number;
}
export interface PartyProjectBody { amount: number | null; notes?: string | null }

/* ───────────── AI (نص فقط) ───────────── */
export interface PriorityItem { partyKind: string; key: string; name: string; amount: number; score: number; reason: string }
export interface ParseTextProposal {
  partyKind?: string; key?: string; date?: string; debit?: number; credit?: number;
  description?: string; claimNo?: string;
}
