/**
 * طبقة API لقسم «البيانات» — تغلّف lib/api.ts (ملك وكيل الأساس) بأنواع القسم،
 * وتضيف ما لا يوفّره: جلب السجل بمعاملات فرز/تصفية، والتكرارات القائمة، ومعاينة
 * تحتفظ برمز HTTP.
 *
 * لماذا رمز HTTP: الخادم يردّ 400 على المعاينة لأنواع لا معاينة لها (ملف موردين،
 * موازنة، تحصيلات…). بدل قائمة أنواع مكتوبة في الواجهة (تتقادم مع كل قارئ جديد)
 * نسأل الخادم: 400 = «احفظ مباشرة»، 422 = «تعذّرت القراءة».
 */
import { api } from '@/lib/api';
import { request } from '@/data/client';
import type {
  AiExtractResponse, BatchResult, CommitOptions, CoverageResponse, DuplicatesResponse,
  ImportHistoryQuery, ImportPayload, NewPartyForm, ScanResult, ClassKind, ImportHistoryRow,
} from './types';

/** عميل @/data يرفق `status` بالخطأ — نحتاجه لتمييز «لا معاينة لهذا النوع» (400). */
const req = request;
const statusOf = (e: unknown) => (e as { status?: number } | null)?.status;

const qs = (o: Record<string, unknown>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== null) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : '';
};

export type PreviewOutcome =
  | { kind: 'preview'; data: ImportPayload }
  | { kind: 'no-preview' }              // النوع يُحفظ مباشرة
  | { kind: 'error'; message: string };

export const dataApi = {
  /* ── الرفع ── */
  async preview(path: string, source: string): Promise<PreviewOutcome> {
    try {
      const data = await req<ImportPayload>('/api/v1/import/preview', {
        method: 'POST', body: JSON.stringify({ path, source }),
      });
      return { kind: 'preview', data };
    } catch (e) {
      if (statusOf(e) === 400) return { kind: 'no-preview' };
      return { kind: 'error', message: e instanceof Error ? e.message : String(e) };
    }
  },
  commit: (path: string, source: string, createParty?: NewPartyForm) =>
    api.runImport(path, source, false, createParty) as Promise<ImportPayload>,
  /** حفظ بقرار صريح إضافي: حسابات رغم الفرق، أو إنشاء مشروع الموازنة التقديرية. */
  commitWith: (path: string, source: string, o: CommitOptions) =>
    req<ImportPayload>('/api/v1/import', {
      method: 'POST',
      body: JSON.stringify({
        path, source, allow_unreconciled: false, create_supplier: o.createParty,
        allow_accounts: o.allowAccounts, confirm_project: !!o.confirmProject,
      }),
    }),
  scanDir: (dir: string) => api.scanDir(dir) as Promise<ScanResult>,
  batch: (paths: string[]) => api.batchImport(paths) as Promise<BatchResult>,

  history: (q: ImportHistoryQuery) =>
    req<{ rows: ImportHistoryRow[] }>('/api/v1/import/history' + qs({ ...q })),
  deleteImport: api.deleteImport,

  duplicates: () => req<DuplicatesResponse>('/api/v1/import/duplicates'),
  deleteDuplicate: (kind: string, id: string) =>
    req<unknown>('/api/v1/import/duplicates/delete', { method: 'POST', body: JSON.stringify({ kind, id }) }),

  classifications: api.importClassifications,
  classify: (account: string, kind: ClassKind, name?: string) =>
    api.setImportClassification({ account, kind, name }),
  unclassify: api.deleteImportClassification,
  suggestClass: api.suggestImportClassification,

  aiExtract: (path: string) => api.aiExtract(path) as Promise<AiExtractResponse>,
  aiCommitExtract: api.aiCommitExtract,
  contractors: api.contractors,

  /* ── التغطية ── */
  coverage: (staleDays = 90) => api.coverage(staleDays) as Promise<CoverageResponse>,

  /* ── النسخ ── */
  backups: api.backups,
  createBackup: api.createBackup,
  backupDailyIfDue: api.backupDailyIfDue,
  backupSettings: api.backupSettings,
  saveBackupSettings: api.saveBackupSettings,
  deleteBackup: api.deleteBackup,

  /* ── المحذوفات ── */
  trash: api.trash,
  restoreTrash: api.restoreTrash,
  purgeTrash: api.purgeTrash,

  /* ── الإعدادات ── */
  /** تخصيص الدفعات (P-081/P-543) — إعداد عام، افتراضياً متوقف. */
  paymentAllocation: () => req<{ enabled: boolean }>('/api/v1/suppliers/settings/payment-allocation'),
  setPaymentAllocation: (enabled: boolean) => req<{ enabled: boolean }>(
    '/api/v1/suppliers/settings/payment-allocation', { method: 'PUT', body: JSON.stringify({ enabled }) }),
  health: api.health,
  aiSettings: api.aiSettings,
  saveAiSettings: api.saveAiSettings,
  aiTest: api.aiTest,
  aiLearnedLayouts: api.aiLearnedLayouts,
  resetPreview: api.resetPreview,
  resetAll: api.resetAll,
};

export const errMsg = (e: unknown, fallback = 'حدث خطأ غير متوقع') =>
  e instanceof Error && e.message ? e.message : (typeof e === 'string' ? e : fallback);
