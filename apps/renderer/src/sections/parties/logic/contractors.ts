/* منطق المقاولين النقي — من Contractors.tsx / ContractorDetail.tsx / ContractorForm.tsx / ExportMenu.tsx. */
import { CONTRACTOR_EXPORT_GROUPS, CONTRACTOR_STATUSES, type ContractorExportOption } from '@/lib/api';
import type {
  ClaimDueRow, ContractorBodyX, ContractorClaim, ContractorClaimBody, ContractorDirection,
  ContractorEntry, ContractorEntryBody, ContractorGuarantee, ContractorGuaranteeBody, ContractorQuery,
  ContractorRowX, ContractorStatus, GuaranteeDueStatus,
} from '../types';
import { cents, fromCents, isBlank, numOrNull, parseAmount, round2, type NumIn } from './money';
import { applyFilters, sortRows, type SortState } from './table';

export { CONTRACTOR_STATUSES, CONTRACTOR_EXPORT_GROUPS };

/* ───────────── الإشارة والحالة ───────────── */

/** اصطلاح الإشارة (مُتحقَّق على ١٨ كشفاً): سالب = نحن ندين لهم «له» · موجب = يدينون لنا «لنا».
 * م-٣٦: الأحمر للتأخر الزمني فقط؛ «له» محايد، «لنا» أخضر (Contractors.tsx:27-31). */
export function balanceView(balance: number): { tone: '' | 'ok' | 'muted'; label: 'له' | 'لنا' | 'متوازن'; words: string } {
  if (balance < 0) return { tone: '', label: 'له', words: 'نحن ندين لهم' };
  if (balance > 0) return { tone: 'ok', label: 'لنا', words: 'يدينون لنا' };
  return { tone: 'muted', label: 'متوازن', words: 'متوازن' };
}

/** نزاع/قائمة سوداء تُقرأ من لونها قبل نصّها (Contractors.tsx:35-38). */
export const STATUS_TONE: Record<ContractorStatus, '' | 'ok' | 'warn' | 'red' | 'muted'> = {
  active: 'ok', paused: 'warn', finished: '', closed: 'muted', disputed: 'warn', blacklisted: 'red',
};
export const statusLabel = (v: string) => CONTRACTOR_STATUSES.find((s) => s.value === v)?.label ?? v;
/** النموذج المعتمد يطلب سبباً لـ«متوقف»/«متنازع عليه»؛ نضيف «قائمة سوداء» — قرار سلبي بلا سبب لا يُتتبَّع. */
export const STATUS_NEEDS_NOTE: readonly ContractorStatus[] = ['paused', 'disputed', 'blacklisted'];

export const DIRECTIONS: { value: ContractorDirection; label: string }[] = [
  { value: 'owed_to_them', label: 'مستحق له' },
  { value: 'owed_to_us', label: 'مستحق لنا' },
  { value: 'balanced', label: 'متوازن' },
];

/** أنواع حركات الدفتر — التسمية + نغمة الشارة (ContractorDetail.tsx:21-29). */
export const ENTRY_KIND: Record<string, { label: string; tone: string }> = {
  claim: { label: 'مستخلص', tone: 'gold' },
  payment: { label: 'دفعة', tone: 'ok' },
  retention: { label: 'تأمين', tone: 'warn' },
  deduction: { label: 'خصم', tone: 'red' },
  invoice: { label: 'فاتورة', tone: '' },
  opening: { label: 'افتتاحي', tone: '' },
  other: { label: 'أخرى', tone: '' },
};
/** الجانب الافتراضي لكل نوع (النموذج المعتمد parties.js:526) — المستخدم يستطيع تغييره. */
export const KIND_SIDE: Record<string, 'debit' | 'credit'> = {
  opening: 'credit', claim: 'credit', invoice: 'credit', payment: 'debit', retention: 'debit', deduction: 'debit', other: 'debit',
};
export const entryKind = (k: string) => ENTRY_KIND[k] ?? { label: k || 'أخرى', tone: '' };

export const GUARANTEE_DUE: Record<GuaranteeDueStatus, { label: string; tone: string }> = {
  due: { label: 'مستحق الصرف', tone: 'red' },
  upcoming: { label: 'يقترب', tone: 'gold' },
  scheduled: { label: 'مجدول', tone: '' },
  released: { label: 'صُرف', tone: 'ok' },
};

/** شرائح أعمار المستخلصات — نفس مفاتيح DELAY_BUCKETS في الخادم (ContractorDetail.tsx:49-52). */
export const CLAIM_BUCKETS: [string, string][] = [
  ['m1', 'شهر'], ['m2', 'شهران'], ['m3', '٣ أشهر'], ['m4', '٤ أشهر'],
  ['m5', '٥ أشهر'], ['m6', '٦ أشهر'], ['m6_plus', 'أكثر من ٦ أشهر'],
];

/* ───────────── القائمة ───────────── */

export interface ContractorListFilters {
  q: string; code: string; project: string; direction: '' | ContractorDirection; status: string; sort: SortState | null;
}
export const EMPTY_CONTRACTOR_FILTERS: ContractorListFilters = { q: '', code: '', project: '', direction: '', status: '', sort: null };

export const contractorQuery = (f: ContractorListFilters): ContractorQuery => ({
  q: f.q || f.code || undefined, project: f.project || undefined, direction: f.direction || undefined,
  status: f.status || undefined, sort: f.sort?.key, dir: f.sort?.dir,
});

/** معاملات التصدير = الاستعلام نفسه (ما تراه الشاشة هو ما يُصدَّر). */
export const exportParams = (q: ContractorQuery) => q as Record<string, string | number | undefined>;

export function contractorChipLabels(f: ContractorListFilters) {
  const out: { k: keyof ContractorListFilters; label: string }[] = [];
  if (f.q) out.push({ k: 'q', label: `بحث: ${f.q}` });
  if (f.code) out.push({ k: 'code', label: `الرمز: ${f.code}` });
  if (f.project) out.push({ k: 'project', label: `المشروع: ${f.project}` });
  if (f.direction) out.push({ k: 'direction', label: `الاتجاه: ${DIRECTIONS.find((x) => x.value === f.direction)?.label ?? f.direction}` });
  if (f.status) out.push({ k: 'status', label: `الحالة: ${statusLabel(f.status)}` });
  return out;
}

/** قائمة المشاريع لقائمة العمود — من صفوف الخادم المصفّاة (Contractors.tsx:211-215). */
export function knownProjects(rows: readonly { projects?: string[] | null }[]): string[] {
  const s = new Set<string>();
  for (const r of rows) for (const p of r.projects ?? []) s.add(p);
  return [...s].sort();
}

/** خلية «متأخر» (م-٤٦): null ← «—» مع تلميح؛ ٠ ← «لا تأخر»؛ > ٠ ← أحمر + «ن مستخلص · أقدمها ي يوماً». */
export type OverdueCell = { kind: 'no-term' } | { kind: 'none'; termDays: number } |
  { kind: 'late'; amount: number; count: number; maxDays: number };
export function overdueCell(r: Pick<ContractorRowX, 'overdue' | 'paymentTermDays'>): OverdueCell {
  if (r.overdue == null) return { kind: 'no-term' };
  if (r.overdue.amount > 0) return { kind: 'late', ...r.overdue };
  return { kind: 'none', termDays: r.paymentTermDays ?? 0 };
}

/** خلية الضمان المحتجز: بلا كشف ← «غير معروف» (لا «لا يوجد») — Contractors.tsx:534-539,611-615. */
export const retentionCell = (r: Pick<ContractorRowX, 'hasStatement' | 'retentionHeld'>):
  'unknown' | 'none' | 'amount' => (!r.hasStatement ? 'unknown' : r.retentionHeld > 0 ? 'amount' : 'none');

/** «تجميع بالمشروع» على المجموعة المصفّاة كاملةً: مقاول متعدد المشاريع يُحتسب تحت كل مشروع
 * بكامل رصيده (لا تجزئة مخترعة)، الأكبر «له» أولاً، الأبناء الأشد سالبية أولاً (Contractors.tsx:225-243,704-764). */
export const NO_PROJECT = '— بلا مشروع —';
export interface ProjectGroup { project: string; rows: ContractorRowX[]; owed: number; owedToUs: number }
export function groupByProject(rows: readonly ContractorRowX[]): ProjectGroup[] {
  const m = new Map<string, { project: string; rows: ContractorRowX[]; owed: number; owedToUs: number }>();
  for (const r of rows) {
    const ps = r.projects && r.projects.length ? r.projects : [NO_PROJECT];
    for (const p of ps) {
      const g = m.get(p) ?? { project: p, rows: [], owed: 0, owedToUs: 0 };
      g.rows.push(r);
      if (r.balance < 0) g.owed += cents(-r.balance); else if (r.balance > 0) g.owedToUs += cents(r.balance);
      m.set(p, g);
    }
  }
  return [...m.values()]
    .map((g) => ({ ...g, owed: fromCents(g.owed), owedToUs: fromCents(g.owedToUs),
      rows: [...g.rows].sort((a, b) => a.balance - b.balance) }))
    .sort((a, b) => b.owed - a.owed);
}

/** خيارات منتقي التصدير — ١٣ صيغة في القائمة + single_statement من زرّ الصف = ١٤. */
export const exportMenuGroups = (): { group: string; options: ContractorExportOption[] }[] =>
  CONTRACTOR_EXPORT_GROUPS.map((g) => ({ ...g, options: g.options.filter((o) => o.requires !== 'code') }));

/** حذف بخطوتين: ٤٠٩ بلا force ← اكتب الرمز/الحساب حرفياً ← force=true (Contractors.tsx:982-1040). */
export const canForceDelete = (typed: string, key: string) => typed === key;

/* ───────────── كشف المقاول ───────────── */

export interface EntryFilters {
  project: string; dateFrom: string; dateTo: string; kind: string; desc: string;
  debitMin: string; debitMax: string; creditMin: string; creditMax: string;
}
export const EMPTY_ENTRY_FILTERS: EntryFilters = {
  project: '', dateFrom: '', dateTo: '', kind: '', desc: '', debitMin: '', debitMax: '', creditMin: '', creditMax: '',
};
/** projectFilter مشترك مع بطاقات المشاريع وجدول المستخلصات — لا يُحتسب «تصفية أعمدة». */
export const entryColumnFiltering = (f: EntryFilters) =>
  Boolean(f.dateFrom || f.dateTo || f.kind || f.desc || f.debitMin || f.debitMax || f.creditMin || f.creditMax);

export function pipeEntries(all: readonly ContractorEntry[], f: EntryFilters, sort: SortState | null): ContractorEntry[] {
  const r = applyFilters<ContractorEntry>(all, [
    { kind: 'select', get: (e) => e.project, value: f.project },
    { kind: 'dateRange', get: (e) => e.date, from: f.dateFrom, to: f.dateTo },
    { kind: 'select', get: (e) => e.kind, value: f.kind },
    { kind: 'text', get: (e) => e.description, value: f.desc, ci: true },
    { kind: 'range', get: (e) => e.debit, min: f.debitMin, max: f.debitMax },
    { kind: 'range', get: (e) => e.credit, min: f.creditMin, max: f.creditMax },
  ]);
  return sortRows(r, sort, {
    date: (e) => e.date ?? '', kind: (e) => e.kind ?? '', description: (e) => e.description ?? '',
    project: (e) => e.project ?? '', debit: (e) => e.debit ?? 0, credit: (e) => e.credit ?? 0,
  });
}

/** الرصيد الجاري بالترتيب الزمني (النموذج المعتمد parties.js:681-683) — مدين − دائن تراكمياً
 * بالهللات؛ flip = تغيّر اتجاه الرصيد عند هذه الحركة. الخادم يرسل الحركات الأحدث أولاً. */
export function withRunningBalance(entries: readonly ContractorEntry[]) {
  const asc = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let run = 0;
  const m = new Map<string, { running: number; flip: boolean }>();
  for (const e of asc) {
    const prev = run;
    run += cents(e.debit) - cents(e.credit);
    m.set(e.id, { running: fromCents(run), flip: Math.sign(prev) !== 0 && Math.sign(run) !== 0 && Math.sign(prev) !== Math.sign(run) });
  }
  return m;
}

/** تفصيل جانب المدين — مجموع البنود يساوي debitTotal بالضبط (ContractorDetail.tsx:267-281). */
export function debitBreakdown(d: { paidTotal: number; deductionsTotal?: number; retentionTotal?: number; otherDebits?: number; debitTotal?: number }) {
  const parts: { label: string; amount: number }[] = [{ label: 'مدفوعات', amount: d.paidTotal }];
  if ((d.deductionsTotal ?? 0) !== 0) parts.push({ label: 'خصومات', amount: d.deductionsTotal! });
  if ((d.retentionTotal ?? 0) !== 0) parts.push({ label: 'تأمينات', amount: d.retentionTotal! });
  if ((d.otherDebits ?? 0) !== 0) parts.push({ label: 'فواتير محمّلة ورصيد افتتاحي', amount: d.otherDebits! });
  return { parts, total: d.debitTotal ?? null };
}

/** الضمان المحتجز في كشف المقاول = مجموع الضمانات غير المصروفة (ContractorDetail.tsx:203-204). */
export const heldRetention = (gs: readonly ContractorGuarantee[]) =>
  fromCents(gs.filter((g) => !g.releasedOn).reduce((a, g) => a + cents(g.amount ?? 0), 0));

export const claimDueTone = (c: ClaimDueRow) => (c.daysLate > 0 ? 'late' : c.remaining > 0 ? 'pending' : 'paid');

export interface ClaimFilters { project: string; number: string; dateFrom: string; dateTo: string; netMin: string; netMax: string }
export const EMPTY_CLAIM_FILTERS: ClaimFilters = { project: '', number: '', dateFrom: '', dateTo: '', netMin: '', netMax: '' };
export const claimColumnFiltering = (f: ClaimFilters) => Boolean(f.number || f.dateFrom || f.dateTo || f.netMin || f.netMax);

export function pipeClaims(all: readonly ContractorClaim[], f: ClaimFilters, sort: SortState | null): ContractorClaim[] {
  const r = applyFilters<ContractorClaim>(all, [
    { kind: 'select', get: (c) => c.project, value: f.project },
    { kind: 'text', get: (c) => c.number, value: f.number, ci: true },
    { kind: 'dateRange', get: (c) => c.date, from: f.dateFrom, to: f.dateTo },
    { kind: 'range', get: (c) => c.netDue, min: f.netMin, max: f.netMax },
  ]);
  return sortRows(r, sort, {
    number: (c) => c.number ?? '', project: (c) => c.project ?? '', date: (c) => c.date ?? '',
    grossCumulative: (c) => c.grossCumulative ?? 0, currentWork: (c) => claimCurrentWork(c),
    retentionAmount: (c) => c.retentionAmount ?? 0, netDue: (c) => c.netDue ?? 0,
  });
}
export const claimCurrentWork = (c: Pick<ContractorClaim, 'grossCumulative' | 'previousCumulative'>) =>
  fromCents(cents(c.grossCumulative) - cents(c.previousCumulative));

/* ───────────── النماذج ───────────── */

export interface ContractorFormValues {
  code: string; name: string; phone: string; notes: string;
  retention: NumIn; guaranteeDays: NumIn; term: NumIn; projects: string[];
  status: ContractorStatus; statusNote: string;
}
export function validateContractor(v: ContractorFormValues, isEdit: boolean): { field: keyof ContractorFormValues; msg: string } | null {
  const code = v.code.trim();
  if (!code) return { field: 'code', msg: 'الرمز مطلوب' };
  if (!isEdit && !/^212\d*$/.test(code.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))))
    return { field: 'code', msg: 'رمز المقاول يبدأ بـ212 — ٢١١ مورد و٢١٦ ضمان' };
  if (!v.name.trim()) return { field: 'name', msg: 'الاسم مطلوب' };
  if (!isBlank(v.term)) {
    const t = parseAmount(v.term);
    if (!Number.isInteger(t) || t < 0 || t > 365) return { field: 'term', msg: 'مدة السداد عدد صحيح بين ٠ و٣٦٥، أو اتركها فارغة' };
  }
  if (!isBlank(v.retention)) {
    const r = parseAmount(v.retention);
    if (!(r >= 0 && r <= 100)) return { field: 'retention', msg: 'النسبة بين ٠ و١٠٠' };
  }
  if (STATUS_NEEDS_NOTE.includes(v.status) && !v.statusNote.trim()) return { field: 'statusNote', msg: 'اكتب سبب الحالة' };
  return null;
}
/** فارغ = null صريح لمدة السداد: عند التعديل يجب أن يصل «امسح المدة» (ContractorForm.tsx:101-103). */
export function contractorBody(v: ContractorFormValues): ContractorBodyX {
  const b: ContractorBodyX = { code: v.code.trim(), name: v.name.trim(), projects: v.projects,
    status: v.status, statusNote: v.statusNote.trim() };
  if (v.phone.trim()) b.phone = v.phone.trim();
  if (v.notes.trim()) b.notes = v.notes.trim();
  const r = numOrNull(v.retention); if (r != null) b.defaultRetentionRate = r;
  const g = numOrNull(v.guaranteeDays); if (g != null) b.defaultGuaranteeDays = g;
  b.paymentTermDays = numOrNull(v.term);
  return b;
}

export interface EntryFormValues { date: string; side: 'debit' | 'credit'; amount: NumIn; description: string; project: string; kind: string }
export function entryFormInitial(src?: Partial<ContractorEntry> | Partial<ContractorEntryBody>, isEdit = false): EntryFormValues {
  return {
    date: src?.date ?? '', side: src && (src.credit ?? 0) > 0 ? 'credit' : 'debit',
    amount: src ? (src.debit || src.credit || null) : null, description: src?.description ?? '',
    project: isEdit ? (src as ContractorEntry).project ?? '' : '', kind: isEdit ? (src as ContractorEntry).kind ?? 'other' : 'other',
  };
}
export function entryBody(v: EntryFormValues): ContractorEntryBody {
  const amt = fromCents(cents(v.amount));
  const b: ContractorEntryBody = { date: v.date, debit: v.side === 'debit' ? amt : 0, credit: v.side === 'credit' ? amt : 0,
    description: v.description.trim(), kind: v.kind };
  if (v.project.trim()) b.project = v.project.trim();
  return b;
}
/** معاينة الرصيد بعد الحركة (parties.js:820-826): رصيد الخادم − أثر القديم + أثر الجديد. */
export function entryPreview(balance: number, v: Pick<EntryFormValues, 'amount' | 'side'>, old?: Pick<ContractorEntry, 'debit' | 'credit'>) {
  const a = parseAmount(v.amount);
  if (!(a > 0)) return null;
  const oldEff = old ? cents(old.debit) - cents(old.credit) : 0;
  const d = v.side === 'debit' ? cents(a) : -cents(a);
  return { before: balance, after: fromCents(cents(balance) - oldEff + d) };
}

/** نموذج المستخلص — أعمال الفترة = التراكمي − السابق؛ التأمين يُقترح من النسبة ويبقى قابلاً
 * للتعديل، والصافي كذلك؛ الرقم النهائي يعتمده المستخدم (ContractorDetail.tsx:934-983). */
export interface ClaimFormValues {
  project: string; number: string; date: string; gross: NumIn; previous: NumIn; rate: NumIn;
  retention: NumIn; retentionTouched: boolean; deductions: NumIn; netDue: NumIn; netTouched: boolean; description: string;
}
export function claimFormInitial(c: ContractorClaim | undefined, defaultRate: number | null): ClaimFormValues {
  return {
    project: c?.project ?? '', number: c?.number ?? '', date: c?.date ?? '',
    gross: c ? c.grossCumulative : null, previous: c ? c.previousCumulative : 0,
    rate: c?.retentionRate != null ? c.retentionRate : defaultRate,
    retention: c ? c.retentionAmount : null, retentionTouched: Boolean(c),
    deductions: c ? c.otherDeductions : 0, netDue: c ? c.netDue : null, netTouched: Boolean(c),
    description: c?.description ?? '',
  };
}
export function claimMath(v: ClaimFormValues) {
  const n = (s: NumIn) => { const x = parseAmount(s); return Number.isFinite(x) ? x : 0; };
  const currentWork = fromCents(cents(n(v.gross)) - cents(n(v.previous)));
  const suggestedRetention = !isBlank(v.rate) ? round2(currentWork * (n(v.rate) / 100)) : 0;
  const retention = v.retentionTouched ? round2(n(v.retention)) : suggestedRetention;
  const suggestedNet = fromCents(cents(currentWork) - cents(retention) - cents(n(v.deductions)));
  const net = v.netTouched ? round2(n(v.netDue)) : suggestedNet;
  return { currentWork, suggestedRetention, retention, suggestedNet, net };
}
export function claimBody(v: ClaimFormValues): ContractorClaimBody {
  const m = claimMath(v);
  const n = (s: NumIn) => { const x = parseAmount(s); return Number.isFinite(x) ? x : 0; };
  const b: ContractorClaimBody = {
    project: v.project.trim(), number: v.number.trim(), date: v.date,
    grossCumulative: n(v.gross), previousCumulative: n(v.previous),
    retentionAmount: m.retention, otherDeductions: n(v.deductions), netDue: m.net,
  };
  if (!isBlank(v.rate)) b.retentionRate = n(v.rate);
  if (v.description.trim()) b.description = v.description.trim();
  return b;
}

export interface GuaranteeFormValues {
  project: string; amount: NumIn; rate: NumIn; finishedOn: string; days: NumIn; releaseDue: string; releasedOn: string; notes: string;
}
export const guaranteeFormInitial = (g?: ContractorGuarantee): GuaranteeFormValues => ({
  project: g?.project ?? '', amount: g?.amount ?? null, rate: g?.retentionRate ?? null,
  finishedOn: g?.finishedOn ?? '', days: g?.guaranteeDays ?? null,
  releaseDue: g?.releaseDue ?? '', releasedOn: g?.releasedOn ?? '', notes: g?.notes ?? '',
});
export function guaranteeBody(v: GuaranteeFormValues): ContractorGuaranteeBody {
  const b: ContractorGuaranteeBody = { project: v.project.trim() };
  const a = numOrNull(v.amount); if (a != null) b.amount = a;
  const r = numOrNull(v.rate); if (r != null) b.retentionRate = r;
  if (v.finishedOn) b.finishedOn = v.finishedOn;
  const d = numOrNull(v.days); if (d != null) b.guaranteeDays = d;
  if (v.releaseDue) b.releaseDue = v.releaseDue;
  if (v.releasedOn) b.releasedOn = v.releasedOn;
  if (v.notes.trim()) b.notes = v.notes.trim();
  return b;
}
