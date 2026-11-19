/**
 * قراءة عامة لاستجابة المعاينة/الحفظ — بلا أي `switch` على نوع الملف.
 *
 * القرّاء يعاد بناؤهم في المستودع الأصلي؛ هذا الملف هو العقد الوحيد بين الواجهة
 * وما يعيدونه: «إن وُجد الحقل اعرضه». نوع جديد يعيد نفس الحقول يعمل فوراً.
 */
import type { ImportPayload, NearDuplicate, QueueStatus, UnknownAccount } from '../types';

export interface PreviewSummary {
  label: string | null;                 // التسمية العربية من الخادم
  partyName: string | null;
  account: string | null;
  isNewParty: boolean;
  /** null = لا بوابة رصيد لهذا الملف (تقرير مجمّع، موردين…) */
  balance: null | { reconciled: boolean; statement: number; computed: number; difference: number };
  counts: { label: string; value: number }[];
  byKind: { kind: string; total: number; fresh: number; known: number }[];
  unknownAccounts: UnknownAccount[];
  nearDuplicates: NearDuplicate[];
  parseIssues: number;
}

const COUNT_LABELS: [keyof ImportPayload, string][] = [
  ['invoiceCount', 'فواتير'], ['paymentCount', 'دفعات'],
  ['imported', 'مستورد'], ['created', 'جديد'], ['updated', 'محدَّث'],
  ['added', 'أُضيف'], ['skipped', 'مطابق مسبقاً'],
];

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function summarize(p: ImportPayload | undefined | null): PreviewSummary | null {
  if (!p) return null;
  const kinds = new Set([...Object.keys(p.rowCounts ?? {}), ...Object.keys(p.newVsKnown ?? {})]);
  return {
    label: p.detected ?? null,
    partyName: p.supplierName || p.statementName || p.partyName || p.suggestedName || null,
    account: p.account ?? p.partyAccount ?? null,
    isNewParty: p.isKnownSupplier === false,
    balance: typeof p.reconciled === 'boolean' && (p.statementBalance != null || p.computedBalance != null)
      ? { reconciled: p.reconciled, statement: num(p.statementBalance), computed: num(p.computedBalance), difference: num(p.difference) }
      : null,
    counts: COUNT_LABELS.filter(([k]) => typeof p[k] === 'number').map(([k, label]) => ({ label, value: num(p[k]) })),
    byKind: [...kinds].map((k) => {
      const nvk = p.newVsKnown?.[k];
      return { kind: k, total: p.rowCounts?.[k] ?? nvk?.total ?? 0, fresh: nvk?.new ?? 0, known: nvk?.known ?? 0 };
    }).filter((r) => r.total > 0),
    unknownAccounts: p.needsClassification ?? [],
    nearDuplicates: p.nearDuplicates ?? [],
    parseIssues: (p.parseIssues ?? []).length,
  };
}

/** الحالة بعد المعاينة: بوابة الرصيد تحكم إن وُجدت، وإلا «عُوين». */
export function statusAfterPreview(p: ImportPayload): QueueStatus {
  // ملف بحالات لكل حساب (الكشف المجمّع): «جاهز» متى طابق حساب واحد على الأقل — الخادم
  // يحفظ المطابق ويحجز غيره حساباً حساباً. معاملته كملف واحد كانت تُقصي ٣٩١ حساباً
  // سليماً بسبب حسابين لا يطابقان.
  if (p.counts && typeof p.counts === 'object' && typeof p.accounts === 'number') {
    return (p.counts.reconciled ?? 0) > 0 ? 'reconciled' : 'unreconciled';
  }
  if (typeof p.reconciled === 'boolean' && (p.statementBalance != null || p.computedBalance != null)) {
    return p.reconciled ? 'reconciled' : 'unreconciled';
  }
  return 'previewed';
}

/** الحالة بعد الحفظ — `saved:false` لا يُقرأ «تم» أبداً (الخلل الأصلي). */
export function statusAfterCommit(r: ImportPayload): { status: QueueStatus; error?: string } {
  // `saved` عددٌ في الكشف المجمّع — صفرٌ يعني لم يُحفظ شيء (لا «تم» كاذبة).
  if (typeof r.saved === 'number') {
    return r.saved > 0 ? { status: 'saved' }
      : { status: 'save_error', error: r.message || 'لم يُحفظ أي حساب من الملف — لا حساب يطابق إجماليه المطبوع' };
  }
  if (r.saved === false && r.reason === 'unknown_supplier') return { status: 'unknown_supplier' };
  if (r.saved === false && r.reason === 'project_missing') return { status: 'needs_project' };
  if (r.saved === false) return { status: 'save_error', error: r.message || r.reason || 'تعذّر الحفظ' };
  return { status: 'saved' };
}

export const SAVABLE: QueueStatus[] = ['ready', 'reconciled', 'previewed'];

/** ترتيب الحفظ: ملفات بلا معاينة (الموردون/الموازنة) أولاً كي تطابق الكشوفاتُ أطرافاً موجودة. */
export function saveOrder(q: { status: QueueStatus }[]): number[] {
  const idx = q.map((_, i) => i);
  return [
    ...idx.filter((i) => q[i].status === 'ready'),
    ...idx.filter((i) => q[i].status === 'reconciled'),
    ...idx.filter((i) => q[i].status === 'previewed'),
  ];
}

/**
 * تخمين اسم المشروع من ترويسة الكشف — «اليرموك- (شركة…)»: ما قبل أول «-» أو «(».
 * دائماً قابل للتعديل، ولا يُقترح شيء إن لم يوجد فاصل واضح.
 */
export function guessProjectFromHeader(raw: string): string {
  const s = (raw || '').trim();
  const cut = [s.indexOf('-'), s.indexOf('(')].filter((n) => n > 0).sort((a, b) => a - b)[0];
  return cut !== undefined ? s.slice(0, cut).trim() : '';
}
