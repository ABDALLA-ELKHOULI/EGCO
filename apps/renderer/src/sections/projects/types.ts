/* أنواع قسم «المشاريع» — مطابقة لـ docs/next/API-CONTRACT.md §٣.
   ProjectKey = uuid من سجل المشاريع، أو الاسم (كل /projects/{id} يقبل الاثنين). */

export type ProjectKey = string;
export type PartyType = 'supplier' | 'contractor';

/** مبلغ Decimal كنص من الخادم ("125000.50") — null = غير معروف، لا صفر (API-CONTRACT §٠). */
export type Dec = string | null;

/** م-٥٠ · طرف مُسند لمشروع (API-CONTRACT §٣ GET /projects/{id}/parties). */
export interface ProjectParty {
  partyType: PartyType;
  /** حساب المورد (٢١١…) أو كود المقاول (٢١٢…). */
  partyId: string;
  name: string;
  account: string;
  amount: Dec;
  notes: string;
  /** للمورد: فواتيره — فقط إن كان مرتبطاً بهذا المشروع وحده (attribution 'single')، وإلا null. */
  invoiced?: Dec;
  /** للمقاول: مستخلصاته على هذا المشروع. */
  claimed?: Dec;
  paid: Dec;
  open: Dec;
  overdue: Dec;
  attribution: 'single' | 'shared' | 'entries';
  /** false = مقاول له قيود في المشروع بلا رابط صريح. */
  linked: boolean;
}

export interface PartyAssignmentBody { amount: string | null; notes?: string }

/** GET /parties/search */
export interface PartySearchHit { partyType: PartyType; partyId: string; name: string; account: string; projects: string[] }

export interface ProjectRegistryItem {
  id: string; name: string; contractValue: Dec; contractValueAt: string | null; notes: string | null; aliases: string[];
}

/** صفّ قائمة المشاريع كما يعيده GET /api/v1/projects اليوم (Projects.tsx). */
export interface ProjectListRow {
  project: string;
  supplierCount?: number;
  suppliersWithData?: number;
  outstanding?: number;
  overdue?: number;
  contractorsOwed?: number;
  contractorsOwedToUs?: number;
  totalCommitment?: number;
  /** كسر لا نسبة: 0.17 = ١٧٪. null = لا موازنة. */
  budgetDelayPct?: number | null;
  mergedSpellingAlert?: boolean;
  contractorProjectNames?: string[];
  /* م-٥٠ (API-CONTRACT §٣) — نصوص Decimal. قد تغيب إن كان الخادم أقدم. */
  id?: string;
  contractValue?: Dec;
  assignedTotal?: Dec;
  /** supplierCost + contractorCost */
  executed?: Dec;
  /** contractValue − executed، أو null بلا قيمة عقد. */
  margin?: Dec;
  supplierCost?: Dec;
  contractorCost?: Dec;
}

export interface ProjectListResponse {
  rows: ProjectListRow[];
  totals?: Partial<Record<'outstanding' | 'overdue' | 'contractorsOwed' | 'contractorsOwedToUs' | 'totalCommitment', number>>;
}

export interface ProjectSupplierRow {
  account: string; name: string; term?: string; termKind?: string; termDays?: number;
  outstanding?: number; overdue?: number;
}
export interface ProjectContractorDetailRow { code: string; name: string; balance?: number }
export interface ProjectScheduleBucket { date: string; amount?: number; count?: number }

export interface ProjectDetailResponse extends ProjectListRow {
  suppliers?: ProjectSupplierRow[];
  contractors?: ProjectContractorDetailRow[];
  schedule?: ProjectScheduleBucket[];
  parties?: ProjectParty[];
}

export interface ProjectAdminResponse {
  projects: string[];
  possibleDuplicates: { key: string; variants: string[] }[];
}
export interface MergePreview { affected: Record<string, number>; total: number }

/* ── الموازنة التقديرية (خطة شهرية) — مبالغ نصية Decimal من الخادم ── */
export interface BudgetPlanListItem { id: string; project: string; period: string; startMonth: string | null; endMonth: string | null }
export interface BudgetPlanMonthRow {
  seq: number; label: string; month: string; completionPct: string | null;
  plannedExclVat: string | null; plannedInclVat: string | null;
  advanceDeduction: string | null; retentionDeduction: string | null; materialsDeduction: string | null;
  netClaim: string | null; netTransfer: string | null; values: Record<string, string | null>;
  /** الفعلي من لقطة الموازنة لنفس الشهر — null حين لا لقطة (لا فعلي مُخترع) */
  actualExclVat: string | null; deviation: string | null; actualRatio: string | null; hasActual: boolean;
}
export interface BudgetPlan {
  id: string; project: string; title: string; period: string; startMonth: string | null; endMonth: string | null;
  contract: { inclVat: string | null; exclVat: string | null; durationMonths: number | null };
  assumptions: Record<string, string | null>;
  columns: { key: string; label: string }[];
  totals: Record<string, string | null>;
  months: BudgetPlanMonthRow[];
  actualVsPlan: { monthsWithActual: number; actualExclVat: string | null; plannedExclVat: string | null; deviation: string | null };
  importedAt: string | null; sourceFile: string;
}
