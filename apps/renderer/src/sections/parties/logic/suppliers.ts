/* منطق الموردين النقي — كل ما كان مبعثراً داخل Suppliers.tsx/SupplierDetail.tsx/SupplierForm.tsx. */
import { DELAY_BUCKETS, bucketOfDays } from '@/lib/delay';
import { STATUS } from '@/lib/format';
import type {
  AllocationLine, SupplierInvoice, SupplierPayment, SupplierQuery, SupplierRow, SupplierStatus,
} from '../types';
import { cents, fromCents, parseAmount, type NumIn } from './money';
import { applyFilters, sortRows, type ColFilter, type SortState } from './table';

export { DELAY_BUCKETS, bucketOfDays, STATUS };

/* ───────────── القائمة ───────────── */

/** حالة التصفية الكاملة لشاشة الموردين — كلها تُرسل للخادم (Suppliers.tsx:21-43). */
export interface SupplierListFilters {
  q: string; account: string; project: string; status: '' | SupplierStatus; delay: string;
  minOut: string; maxOut: string; payFrom: string; payTo: string; sort: SortState | null;
}
export const EMPTY_SUPPLIER_FILTERS: SupplierListFilters = {
  q: '', account: '', project: '', status: '', delay: '', minOut: '', maxOut: '', payFrom: '', payTo: '', sort: null,
};

/** يبني SupplierQuery: الحساب يُرسل عبر q (الخادم يبحث بالاسم أو الحساب) — Suppliers.tsx:33. */
export function supplierQuery(f: SupplierListFilters): SupplierQuery {
  const num = (s: string) => (s.trim() === '' ? undefined : parseAmount(s));
  return {
    q: f.q || f.account || undefined,
    project: f.project || undefined,
    status: f.status || undefined,
    delay: f.delay || undefined,
    min_outstanding: num(f.minOut),
    max_outstanding: num(f.maxOut),
    date_from: f.payFrom || undefined,
    date_to: f.payTo || undefined,
    sort: f.sort?.key,
    dir: f.sort?.dir,
  };
}

/** نص شرائح التصفية — نفس التسميات (م-١٨: «المديونية المفتوحة»). */
export function supplierChipLabels(f: SupplierListFilters): { k: keyof SupplierListFilters | 'o' | 'dt'; label: string }[] {
  const out: { k: keyof SupplierListFilters | 'o' | 'dt'; label: string }[] = [];
  if (f.q) out.push({ k: 'q', label: `بحث: ${f.q}` });
  if (f.account) out.push({ k: 'account', label: `الحساب: ${f.account}` });
  if (f.project) out.push({ k: 'project', label: `المشروع: ${f.project}` });
  if (f.status) out.push({ k: 'status', label: `الحالة: ${STATUS[f.status]?.label ?? f.status}` });
  if (f.delay) out.push({ k: 'delay', label: `التأخر: ${DELAY_BUCKETS.find((b) => b.value === f.delay)?.label ?? f.delay}` });
  if (f.minOut || f.maxOut) out.push({ k: 'o', label: `المديونية المفتوحة: ${f.minOut || '—'} … ${f.maxOut || '—'}` });
  if (f.payFrom || f.payTo) out.push({ k: 'dt', label: `الفترة: ${f.payFrom || '—'} … ${f.payTo || '—'}` });
  return out;
}

/** تلوين الصف: متأخر › قريب › مسدَّد بالكامل (Suppliers.tsx:293-295). */
export function supplierRowTone(r: Pick<SupplierRow, 'overdue' | 'status' | 'outstanding' | 'invoiceCount'>):
  'overdue' | 'due-soon' | 'settled' | '' {
  if (r.overdue > 0) return 'overdue';
  if (r.status === 'due_soon') return 'due-soon';
  if (r.status === 'clear' && r.outstanding === 0 && r.invoiceCount > 0) return 'settled';
  return '';
}

/** «الأول +ن» للمشاريع المتعددة (Suppliers.tsx:320-328). */
export function projectsSummary(projects: readonly string[] | null | undefined, fallback?: string | null) {
  const ps = projects && projects.length ? projects : fallback ? [fallback] : [];
  return { first: ps[0] ?? null, more: Math.max(0, ps.length - 1), all: ps.join('، ') };
}

/** المدة سطرٌ تحت الحساب: «٤٥ يوم» أو النص الخام؛ unset = «مدة السداد غير محدّدة». */
export const termText = (r: Pick<SupplierRow, 'termKind' | 'termDays' | 'term'>) =>
  r.termKind === 'days' && r.termDays != null ? { days: r.termDays, raw: null } : { days: null, raw: r.term };

/** توزيع المتأخر على الشرائح (نافذة Suppliers.tsx:409-437) — بلا «none». */
export const delayBreakdown = (byBucket: Record<string, number> | undefined) =>
  DELAY_BUCKETS.filter((b) => b.value !== 'none').map((b) => ({ ...b, amount: byBucket?.[b.value] ?? 0 }));

/* ───────────── كشف المورد: الفواتير ───────────── */

export type InvoiceStatusKey = 'paid' | 'overdue' | 'due_soon' | 'pending' | 'no_date';
/** SupplierDetail.tsx:16-22 — نفس منطق dueTone/dueLabel. */
export function invoiceStatusKey(i: Pick<SupplierInvoice, 'remaining' | 'daysToDue'>): InvoiceStatusKey {
  if (i.remaining <= 0) return 'paid';
  if (i.daysToDue == null) return 'no_date';
  if (i.daysToDue < 0) return 'overdue';
  if (i.daysToDue <= 7) return 'due_soon';
  return 'pending';
}
export const INVOICE_STATUS_OPTIONS: { value: InvoiceStatusKey; label: string }[] = [
  { value: 'overdue', label: 'متأخرة' },
  { value: 'due_soon', label: 'مستحقة قريباً' },
  { value: 'pending', label: 'غير مستحقة بعد' },
  { value: 'no_date', label: 'بانتظار تاريخ' },
  { value: 'paid', label: 'مسددة' },
];

export interface InvoiceFilters {
  num: string; dateFrom: string; dateTo: string; dueFrom: string; dueTo: string;
  amtMin: string; amtMax: string; paidMin: string; paidMax: string; remMin: string; remMax: string;
  status: '' | InvoiceStatusKey;
}
export const EMPTY_INVOICE_FILTERS: InvoiceFilters = {
  num: '', dateFrom: '', dateTo: '', dueFrom: '', dueTo: '', amtMin: '', amtMax: '',
  paidMin: '', paidMax: '', remMin: '', remMax: '', status: '',
};
export const invoiceFiltering = (f: InvoiceFilters) => Object.values(f).some((v) => v !== '');

/** خط الأنابيب كاملاً: «إظهار المسددة» ← شريحة التأخر ← تصفية الأعمدة ← الترتيب
 * (SupplierDetail.tsx:242-283). الشريحة على نفس أساس الخادم: أيام التأخر = −daysToDue. */
export function pipeInvoices(all: readonly SupplierInvoice[], o: {
  showPaid: boolean; bucket: string | null; filters: InvoiceFilters; sort: SortState | null;
}): SupplierInvoice[] {
  let r = o.showPaid ? [...all] : all.filter((i) => i.remaining > 0);
  if (o.bucket) r = r.filter((i) => i.remaining > 0 && i.daysToDue != null && bucketOfDays(-i.daysToDue) === o.bucket);
  const f = o.filters;
  const cf: ColFilter<SupplierInvoice>[] = [
    { kind: 'text', get: (i) => i.number, value: f.num },
    { kind: 'dateRange', get: (i) => i.date, from: f.dateFrom, to: f.dateTo },
    { kind: 'dateRange', get: (i) => i.dueDate, from: f.dueFrom, to: f.dueTo },
    { kind: 'range', get: (i) => i.amount, min: f.amtMin, max: f.amtMax },
    { kind: 'range', get: (i) => i.paid, min: f.paidMin, max: f.paidMax },
    { kind: 'range', get: (i) => i.remaining, min: f.remMin, max: f.remMax },
    { kind: 'select', get: (i) => invoiceStatusKey(i), value: f.status },
  ];
  r = applyFilters(r, cf);
  return sortRows(r, o.sort, {
    number: (i) => i.number ?? '', date: (i) => i.date ?? '', dueDate: (i) => i.dueDate ?? '',
    amount: (i) => i.amount ?? 0, paid: (i) => i.paid ?? 0, remaining: (i) => i.remaining ?? 0,
    status: (i) => invoiceStatusKey(i),
  });
}

/** إجراءات صفّ الفاتورة: يدوية ← تعديل/حذف؛ من كشف ← تحديد/تعديل الاستحقاق (SupplierDetail.tsx:570-590). */
export function invoiceActions(i: Pick<SupplierInvoice, 'source' | 'dueDate'>) {
  return {
    canEdit: i.source === 'manual',
    canDelete: i.source === 'manual',
    dueDateAction: i.source === 'statement' ? (i.dueDate ? 'تعديل الاستحقاق' : 'تحديد الاستحقاق') : null,
  };
}

/* ───────────── كشف المورد: الدفعات ───────────── */

export interface PaymentFilters { dateFrom: string; dateTo: string; doc: string; desc: string; amtMin: string; amtMax: string }
export const EMPTY_PAYMENT_FILTERS: PaymentFilters = { dateFrom: '', dateTo: '', doc: '', desc: '', amtMin: '', amtMax: '' };
export const paymentFiltering = (f: PaymentFilters) => Object.values(f).some((v) => v !== '');

export function pipePayments(all: readonly SupplierPayment[], f: PaymentFilters, sort: SortState | null): SupplierPayment[] {
  const r = applyFilters<SupplierPayment>(all, [
    { kind: 'dateRange', get: (p) => p.date, from: f.dateFrom, to: f.dateTo },
    { kind: 'text', get: (p) => p.doc, value: f.doc },
    { kind: 'text', get: (p) => p.description, value: f.desc },
    { kind: 'range', get: (p) => p.amount, min: f.amtMin, max: f.amtMax },
  ]);
  return sortRows(r, sort, {
    date: (p) => p.date ?? '', doc: (p) => p.doc ?? '', description: (p) => p.description ?? '', amount: (p) => p.amount ?? 0,
  });
}

/* ───────────── تخصيص دفعة (SupplierDetail.tsx:47-145) ───────────── */

export interface AllocDraft { onAccount: boolean; lines: { invoiceId: string; amount: string }[] }

/** مرشّح واحد ← سطر واحد بكامل المبلغ؛ لا مرشّحين ← «على الحساب». */
export function initialAllocation(paymentAmount: number, candidates: readonly SupplierInvoice[]): AllocDraft {
  if (candidates.length === 1) return { onAccount: false, lines: [{ invoiceId: candidates[0].id, amount: String(paymentAmount) }] };
  return { onAccount: candidates.length === 0, lines: [] };
}

/** تبديل فاتورة: إضافتها تقترح min(متبقيها، ما بقي من الدفعة). */
export function toggleAllocInvoice(d: AllocDraft, inv: SupplierInvoice, paymentAmount: number): AllocDraft {
  if (d.lines.some((l) => l.invoiceId === inv.id)) return { onAccount: false, lines: d.lines.filter((l) => l.invoiceId !== inv.id) };
  const used = d.lines.reduce((a, l) => a + cents(l.amount), 0);
  const left = cents(paymentAmount) - used;
  const sug = Math.max(0, Math.min(cents(inv.remaining || inv.amount), left));
  return { onAccount: false, lines: [...d.lines, { invoiceId: inv.id, amount: sug ? String(fromCents(sug)) : '' }] };
}

export function allocationTotals(d: AllocDraft, paymentAmount: number) {
  const total = d.onAccount ? cents(paymentAmount) : d.lines.reduce((a, l) => a + cents(l.amount), 0);
  return { total: fromCents(total), balanced: total === cents(paymentAmount) };
}

export function allocationBody(d: AllocDraft, paymentAmount: number): AllocationLine[] {
  return d.onAccount
    ? [{ invoiceId: null, amount: paymentAmount }]
    : d.lines.map((l) => ({ invoiceId: l.invoiceId, amount: fromCents(cents(l.amount)) }));
}

/* ───────────── نموذج المورد / الإدخال اليدوي ───────────── */

export interface SupplierFormValues { account: string; name: string; term: string; projects: string[] }

/** «بادئة الحساب تحسم النوع: ٢١١ مورد» — يُفرض عند الإنشاء فقط (الحساب لا يُعدَّل بعده). */
export function validateSupplier(v: SupplierFormValues, isEdit: boolean): { field: keyof SupplierFormValues; msg: string } | null {
  const acct = v.account.trim().replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));
  if (!acct) return { field: 'account', msg: 'رقم الحساب مطلوب' };
  if (!isEdit && !/^211\d*$/.test(acct)) return { field: 'account', msg: 'رقم حساب المورد يبدأ بـ211 — ٢١٢ مقاول و٢١٦ ضمان' };
  if (!v.name.trim()) return { field: 'name', msg: 'اسم المورد مطلوب' };
  return null;
}
export const supplierBody = (v: SupplierFormValues) => ({
  account: v.account.trim(), name: v.name.trim(), term: v.term.trim(), projects: v.projects, project: v.projects[0] ?? '',
});

export interface ManualEntryValues { amount: NumIn; date: string; due_date: string; description: string; reference: string }
export const todayIso = () => new Date().toISOString().slice(0, 10);
export function validateManual(v: ManualEntryValues): string | null {
  const a = parseAmount(v.amount);
  if (!(a > 0)) return 'أدخل مبلغاً أكبر من صفر';
  if (!v.date) return 'التاريخ مطلوب';
  return null;
}
export function manualBody(v: ManualEntryValues, mode: 'invoice' | 'payment') {
  return {
    amount: fromCents(cents(v.amount)), date: v.date,
    due_date: mode === 'invoice' && v.due_date ? v.due_date : undefined,
    description: v.description.trim() || undefined, reference: v.reference.trim() || undefined,
  };
}

/** معاينة الرصيد بعد المديونية/الدفعة (النموذج المعتمد parties.js:449-456) — المفتوح من
 * الخادم ± المبلغ المكتوب، بالهللات. لا يُحفظ؛ الرقم الحقيقي يعود من الخادم بعد الحفظ. */
export function manualPreview(open: number, amount: NumIn, mode: 'invoice' | 'payment', oldAmount = 0) {
  const a = parseAmount(amount);
  if (!(a > 0)) return null;
  const delta = cents(a) - cents(oldAmount);
  const next = mode === 'invoice' ? cents(open) + delta : cents(open) - delta;
  return { before: open, after: fromCents(next), overpaid: mode === 'payment' && next < 0 };
}

/* ───────────── أولويات السداد ───────────── */

/** «ضمن الميزانية» تقدير محلي تراكمي بترتيب الخادم — لا حقل صريح منه (Suppliers.tsx:452-458). */
export function fitBudget<T extends { amount: number }>(items: readonly T[], budget: NumIn) {
  const b = budget == null || String(budget).trim() === '' ? null : cents(parseAmount(budget));
  let run = 0;
  return items.map((it) => {
    run += cents(it.amount);
    return { ...it, fits: b == null ? null : run <= b };
  });
}
