/** نصوص عربية ثابتة للقسم — مكان واحد كي لا يتباعد اسم الحالة بين شاشتين. */
import type { BackupInfo, ClassKind, CoverageState, QueueStatus, TrashKind } from '../types';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';

export const QUEUE_CHIP: Record<QueueStatus, { text: string; tone: Tone }> = {
  pending: { text: 'بانتظار المعالجة', tone: 'neutral' },
  reading: { text: 'جارٍ القراءة', tone: 'warn' },
  ready: { text: 'جاهز للحفظ', tone: 'neutral' },
  reconciled: { text: 'مطابق', tone: 'ok' },
  unreconciled: { text: 'غير مطابق', tone: 'bad' },
  previewed: { text: 'عُوين — جاهز للحفظ', tone: 'ok' },
  read_error: { text: 'خطأ قراءة', tone: 'bad' },
  saving: { text: 'جارٍ الحفظ', tone: 'warn' },
  saved: { text: 'تم الحفظ', tone: 'ok' },
  save_error: { text: 'تعذّر الحفظ', tone: 'bad' },
  unknown_supplier: { text: 'حساب جديد — بانتظار قرار', tone: 'warn' },
  excluded: { text: 'مُستبعد', tone: 'neutral' },
  unsupported: { text: 'غير مدعوم', tone: 'bad' },
  needs_project: { text: 'مشروع جديد — بانتظار تأكيدك', tone: 'warn' },
};

/** حالات نتيجة الرفع الجماعي كما يرسلها الخادم؛ غير المعروف يُعرض بنصّه الخام. */
export const BATCH_CHIP: Record<string, { text: string; tone: Tone }> = {
  saved: { text: 'تم الحفظ', tone: 'ok' },
  contractor_saved: { text: 'تم الحفظ', tone: 'ok' },
  duplicate: { text: 'مكرر — سبق رفعه', tone: 'warn' },
  not_reconciled: { text: 'غير مطابق', tone: 'bad' },
  unknown_supplier: { text: 'مورد غير معروف', tone: 'warn' },
  no_account: { text: 'بلا رقم حساب', tone: 'warn' },
  needs_classification: { text: 'يحتاج تصنيفاً', tone: 'warn' },
  read_error: { text: 'تعذّرت القراءة', tone: 'bad' },
  needs_single: { text: 'يُرفع منفرداً', tone: 'warn' },
};
export const isBatchSaved = (s: string) => s === 'saved' || s === 'contractor_saved' || s === 'duplicate';

/** حالة حساب داخل كشف مجمّع — غير المعروف يظهر برسالة الخادم أو رمزه. */
export const BUNDLE_STATUS: Record<string, { text: string; tone: Tone }> = {
  reconciled: { text: 'يطابق — سيُحفظ', tone: 'ok' },
  saved: { text: 'حُفظ', tone: 'ok' },
  not_reconciled: { text: 'لا يطابق إجماليه — لن يُحفظ', tone: 'bad' },
  needs_classification: { text: 'بادئة غير معروفة — تحتاج تصنيفك', tone: 'warn' },
  read_error: { text: 'تعذّرت قراءته', tone: 'bad' },
  unknown_supplier: { text: 'حساب جديد — لم يُنشأ', tone: 'warn' },
};

export const CLASS_LABEL: Record<ClassKind, string> = {
  supplier: 'مورد', contractor: 'مقاول', guarantee: 'ضمان', ignore: 'تجاهل',
};
export const CLASS_ORDER: ClassKind[] = ['supplier', 'contractor', 'guarantee', 'ignore'];

/** تسمية مفاتيح rowCounts/newVsKnown — مفتاح جديد يظهر بنصّه بدل أن يختفي. */
export const PARTY_KIND_LABEL: Record<string, string> = {
  supplier: 'موردون', contractor: 'مقاولون', guarantee: 'ضمانات',
};

export const ND_SCOPE: Record<string, string> = { file: 'داخل هذا الملف', db: 'مقابل حركة محفوظة سابقاً' };
export const ND_LEDGER: Record<string, string> = { invoice: 'فاتورة', payment: 'دفعة', entry: 'حركة' };

export const COVERAGE_CHIP: Record<CoverageState, { text: string; tone: Tone }> = {
  none: { text: 'بلا كشوفات', tone: 'bad' },
  stale: { text: 'قديمة', tone: 'warn' },
  ok: { text: 'محدَّثة', tone: 'ok' },
};

/** `before-reset` يكتبه الخادم عند التصفير ولا يعرفه BackupKind في lib/api.ts —
 * v0.13 كان يعرض الاسم الخام. نوع غير معروف يظهر بنصّه بدل أن يختفي. */
export const BACKUP_KIND_LABEL: Record<BackupInfo['kind'] | 'before-reset', string> = {
  daily: 'يومية', manual: 'يدوية', 'before-update': 'قبل التحديث',
  'before-import': 'قبل الاستيراد', 'before-restore': 'قبل الاستعادة',
  'before-reset': 'قبل التصفير', legacy: 'قديمة',
};
export const backupKindLabel = (k: string) => (BACKUP_KIND_LABEL as Record<string, string>)[k] ?? k;

export const TRASH_KIND: Record<TrashKind, { one: string; many: string }> = {
  supplier: { one: 'مورد', many: 'موردون' },
  contractor: { one: 'مقاول', many: 'مقاولون' },
  invoice: { one: 'فاتورة', many: 'فواتير' },
  payment: { one: 'دفعة', many: 'دفعات' },
  contractor_entry: { one: 'حركة مقاول', many: 'حركات مقاولين' },
  import_log: { one: 'استيراد', many: 'استيرادات' },
  budget_month: { one: 'شهر موازنة', many: 'أشهر موازنة' },
};

/** حجم الملف — «١٫٢ م.ب» / «٣٤٠ ك.ب». */
export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
  return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
}

export const NOT_IN_APP = 'متاح داخل التطبيق فقط (وليس في المتصفح).';
