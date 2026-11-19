/**
 * أنواع قسم «البيانات».
 *
 * لماذا أنواع خاصة بالقسم بدل `any` في lib/api.ts: مسارات الرفع (preview/import/batch)
 * يعاد بناء قرّائها الآن في المستودع الأصلي، فشكل الاستجابة سيتغيّر. نصف هنا فقط
 * الحقول التي تقرؤها الواجهة — كلها اختيارية — والواجهة تعرض ما وصلها ولا تفترض نوع ملف.
 */
import type {
  AiSettings, BackupInfo, ImportClassification, ImportHistoryRow, LearnedLayout,
  ResetPreview, ResetResult, TrashKind, TrashRow,
} from '@/lib/api';
import type { PickedFile, UpdateStatus } from '@/types/global';

export type {
  AiSettings, BackupInfo, ImportClassification, ImportHistoryRow, LearnedLayout,
  ResetPreview, ResetResult, TrashKind, TrashRow, PickedFile, UpdateStatus,
};

export type ClassKind = ImportClassification['kind'];

/* ───────────── الرفع: ما يعيده الخادم (مجموعة حقول، لا مخطط ملف) ───────────── */

/** طرف واحد من زوج «تكرار محتمل». */
export interface NearDupSide { number?: string | null; doc: string; description: string }
export interface NearDuplicate {
  kind: string; // 'near_duplicate' | 'near_duplicate_more'
  scope?: 'file' | 'db';
  ledger?: string;
  date?: string;
  amount?: number;
  message: string;
  a?: NearDupSide;
  b?: NearDupSide;
}

/** حساب ببادئة غير ٢١١/٢١٢/٢١٦ — «اسأل، لا تخمّن». */
export interface UnknownAccount {
  account: string; name: string; project?: string; sheet?: string; prefix?: string;
}

export interface BundleAccount {
  account: string; name?: string; status: string; message?: string;
  difference?: number | null; kind?: string | null; pages?: number[];
}

export interface ParseIssue { severity?: string; message: string; sheet?: string }
export interface BalanceWarning { account?: string; name?: string; message: string }

/**
 * استجابة المعاينة أو الحفظ — اتحاد كل الحقول التي ظهرت في v0.13 عبر كل أنواع الملفات.
 * الحقول الجديدة التي قد يضيفها القرّاء الجدد تمرّ عبر `[k: string]: unknown` بلا كسر.
 */
export interface ImportPayload {
  [k: string]: unknown;
  // التعرّف
  detected?: string;          // تسمية عربية من الخادم
  source?: string;
  // الطرف
  account?: string | null;
  supplierName?: string | null;
  statementName?: string | null;
  suggestedName?: string | null;
  isKnownSupplier?: boolean;
  partyName?: string | null;
  partyAccount?: string | null;
  autoCreatedParty?: boolean;
  needsTerm?: boolean;
  supplier?: { name?: string; account?: string } | null;
  // بوابة الرصيد
  reconciled?: boolean;
  statementBalance?: number | null;
  computedBalance?: number | null;
  difference?: number | null;
  // الأعداد
  invoiceCount?: number; paymentCount?: number;
  added?: number; skipped?: number; imported?: number; created?: number; updated?: number;
  rowCounts?: Record<string, number>;
  newVsKnown?: Record<string, { total: number; new: number; known: number }>;
  // ما يحتاج قراراً أو انتباهاً
  needsClassification?: UnknownAccount[];
  parseIssues?: ParseIssue[];
  nearDuplicates?: NearDuplicate[];
  reconcileWarnings?: BalanceWarning[];
  // كشف مجمّع (v0.13.1): ملف واحد بمئات الحسابات، كل حساب يُطابَق ويُحفظ وحده
  bundle?: boolean;
  accounts?: number;
  pages?: number;
  /** عدد الحسابات لكل حالة: reconciled/saved/not_reconciled/needs_classification/read_error… */
  counts?: Record<string, number>;
  /** الحسابات التي لن تُحفظ (أو لم تُحفظ) وسببها. */
  problems?: BundleAccount[];
  // نتيجة الحفظ — منطقي لملف عادي، **عدد الحسابات المحفوظة** لكشف مجمّع
  saved?: boolean | number;
  reason?: string;            // 'unknown_supplier' | ...
  message?: string;
}

/** حالة ملف في طابور الرفع — مشتقة من استجابة الخادم، لا من نوع الملف. */
export type QueueStatus =
  | 'pending' | 'reading'
  | 'ready'            // لا معاينة متاحة لهذا النوع — يُحفظ مباشرة
  | 'reconciled' | 'unreconciled'
  | 'previewed'        // عُوين بلا بوابة رصيد (تقارير مجمّعة…)
  | 'read_error' | 'saving' | 'saved' | 'save_error'
  | 'unknown_supplier' | 'excluded' | 'unsupported'
  | 'needs_project';   // موازنة تقديرية لمشروع غير موجود — بانتظار تأكيد إنشائه

export interface QueueItem {
  file: PickedFile;
  status: QueueStatus;
  preview?: ImportPayload;
  saveResult?: ImportPayload;
  error?: string;
}

/** خيارات الحفظ الإضافية — كلها قرار صريح من المستخدم، لا افتراض. */
export interface CommitOptions {
  createParty?: NewPartyForm;
  /** كشف مجمّع: حسابات بعينها تُحفظ رغم فرق المطابقة («احفظ رغم الفرق») */
  allowAccounts?: string[];
  /** موازنة تقديرية: أنشئ المشروع إن لم يكن في السجل */
  confirmProject?: boolean;
}

/* ───────────── الموازنة التقديرية (خطة شهرية) ───────────── */
export interface BudgetPlanMonth {
  seq: number; label: string; month: string;
  completionPct: string | null; plannedExclVat: string | null; plannedInclVat: string | null;
  netTransfer: string | null; values: Record<string, string | null>;
}
export interface BudgetPlanCheck { key: string; label: string; sum: string | null; total: string | null; diff: string | null; ok: boolean | null }
export interface BudgetPlanPreview extends ImportPayload {
  kind: 'budget_plan';
  project: string; projectInFile: string; projectExists: boolean; projectMessage: string | null;
  title: string; period: string;
  contract: { inclVat: string | null; exclVat: string | null; durationMonths: number | null };
  assumptions: Record<string, string | null>;
  columns: { key: string; label: string }[];
  months: BudgetPlanMonth[]; monthCount: number; firstMonth: string; lastMonth: string;
  totals: Record<string, string | null>;
  check: BudgetPlanCheck[]; totalsOk: boolean;
  existing: { status: 'new' | 'identical' | 'changed'; message: string };
}

export type NewPartyForm = { name: string; project: string; term: string };

/* ───────────── الرفع الجماعي (مجلد) ───────────── */
export interface ScanResult {
  dir: string;
  files: { path: string; name: string; source: string; sizeKb: number }[];
  skipped: { name: string; reason: string }[];
}
export interface BatchRow extends ImportPayload {
  path: string; name: string; source: string; status: string;
}
export interface BatchResult {
  total: number; saved: number; duplicates?: number; failed: number;
  results: BatchRow[];
}

/* ───────────── الملفات المرفوعة ───────────── */
export interface ImportHistoryQuery {
  file_name?: string; source?: string; party?: string;
  date_from?: string; date_to?: string;
  min_moves?: number; max_moves?: number;
  reconciled?: string; sort?: string; dir?: string;
}

/* ───────────── التكرارات القائمة ───────────── */
export interface DuplicateGroup {
  kind: string; party: string; account: string; date: string; amount: number; doc?: string;
  rows: { id: string; number?: string | null; description?: string }[];
}
export interface DuplicatesResponse { count: number; totalAmount: number; groups: DuplicateGroup[] }

/* ───────────── الذكاء: الإنقاذ ───────────── */
export interface ExtractRow { date: string; debit: number; credit: number; description: string }
export interface AiExtractResponse { account?: string | null; name?: string | null; rows?: Partial<ExtractRow>[] }

/* ───────────── التغطية ───────────── */
export type CoverageState = 'none' | 'stale' | 'ok';
export interface CoverageRow {
  account: string; name: string; project: string;
  firstActivity: string | null; lastActivity: string | null;
  daysSinceLast: number | null; invoiceCount: number; outstanding: number;
  state: CoverageState;
}
export interface CoverageResponse {
  asOf: string; staleDays: number; rows: CoverageRow[];
  totals?: { withoutData?: number; stale?: number; coveredPct?: number };
}

/* ───────────── مشترك ───────────── */
export interface Note { ok: boolean; text: string }
export interface AppInfo { version: string; platform: string; dataDir: string }
export interface Health { status: string; db: string; version: string }
export type { ResetPreview as WipePreview, ResetResult as WipeResult };
