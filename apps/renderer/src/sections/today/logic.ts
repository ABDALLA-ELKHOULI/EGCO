/**
 * قسم «اليوم» — المنطق الصافي (بلا React، بلا شبكة، بلا '@/').
 *
 * لماذا ملف مستقل بلا استيرادات: كي يُختبر بـ `node logic.check.ts` مباشرةً دون
 * أي مُشغّل اختبارات، وكي لا يحسب أي مكوّن رقماً بنفسه. القاعدة هنا:
 *  - لا حساب مالي جديد. كل مبلغ يأتي من الخادم (Decimal) ونحن **نجمع بالهللة فقط**
 *    حين نعرض مجموع صفوف قادمة من الخادم نفسه (مثل إجمالي المحدَّد في قائمة الدفع).
 *  - لا رقم مخترَع: إن غاب الحقل يبقى null ويُعرض «—» مع سبب.
 *  - الأحمر (sev 'd') للتأخر الزمني حصراً — العجز النقدي وفشل الاستيراد تحذير ('w').
 */

/* ───────────────────────── أدوات تاريخ ───────────────────────── */

export const DAY_MS = 864e5;

/** 'YYYY-MM-DD' → Date محلي عند منتصف الليل (لا UTC: «اليوم» يجب ألا ينزلق يوماً). */
export function parseISO(s: string | Date): Date {
  if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const p = String(s || '').slice(0, 10).split('-');
  return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1);
}
export function iso(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
export function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
/** عدد الأيام من a إلى b (موجب إن كان b بعد a). */
export function daysBetween(a: string | Date, b: string | Date): number {
  return Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / DAY_MS);
}

/* ───────────────────────── أدوات أرقام ───────────────────────── */

/** جمع بالهللة الصحيحة — جمع float مباشرةً يُنتج 0.30000000000000004 ويناقض الخادم. */
export function sumHalalas<T>(rows: readonly T[], get: (r: T) => number | null | undefined): number {
  let c = 0;
  for (const r of rows) c += Math.round((Number(get(r)) || 0) * 100);
  return c / 100;
}
/** فرق بالهللة (after − before). */
export function diffHalalas(after: number | null | undefined, before: number | null | undefined): number {
  return (Math.round((Number(after) || 0) * 100) - Math.round((Number(before) || 0) * 100)) / 100;
}

/** صيغ العدد العربية: ١ · ٢ · ٣–١٠ · ١١+ */
export function plural(n: number, one: string, two: string, few: string, many: string): string {
  const a = Math.abs(n);
  if (a === 1) return one;
  if (a === 2) return two;
  if (a % 100 >= 3 && a % 100 <= 10) return few;
  return many;
}

/* ───────────────────────── مدخلات من الخادم (أشكال مختصرة) ───────────────────────── */

/** صف من /dashboard.payToday — فاتورة مورد مستحقة خلال ٧ أيام أو متأخرة. */
export interface PayTodayRow {
  account: string; supplier: string; project: string | null; invoice: string | null;
  dueDate: string; daysToDue: number; amount: number; overdue: boolean;
}
/** صف من /contractors/claims-due — المبلغ هو المتبقي بعد الدفعات (محسوب في الخادم). */
export interface ClaimDueRow {
  type: 'contractor_claim'; date: string; code: string; name: string;
  claimNo: string | null; doc: string; project: string; claimDate: string;
  amount: number; daysLate: number; overdue: boolean;
}
/** صف من /cashflow/breakdown (term=overdue|scheduled) — فاتورة مورد مفتوحة. */
export interface BreakdownSupplierRow {
  account: string; supplierName: string; invoiceNumber: string | null; invoiceDate: string;
  dueDate: string | null; amount: number; daysOverdue: number | null;
}
/** ضمان مقاول متتبَّع (من /guarantees.contractorGuarantees). */
export interface GuaranteeLite {
  id: string; contractorCode: string; contractorName: string; project: string;
  amount: number | null; releaseDue: string | null; releasedOn: string | null;
}
/** فترة من /cashflow.periods */
export interface CashPeriod { label: string; from: string; to: string; balance: number; deficit: boolean }

/* ───────────────────────── تجميع المتأخر لكل طرف ───────────────────────── */

export interface PartyOverdue {
  partyType: 'supplier' | 'contractor';
  key: string;          // رقم حساب المورد أو رمز المقاول
  name: string;
  overdue: number;      // مجموع المتبقي على المتأخر — من صفوف الخادم بالهللة
  count: number;
  oldestDays: number;
}

/** متأخر كل مورد من صفوف payToday ذات daysToDue<0 — نفس الفواتير التي يجمعها الخادم في summary.overdue. */
export function supplierOverdue(rows: readonly PayTodayRow[]): PartyOverdue[] {
  const by = new Map<string, PartyOverdue & { c: number }>();
  for (const r of rows) {
    if (!(r.daysToDue < 0) || !(r.amount > 0)) continue;
    const cur = by.get(r.account) ?? { partyType: 'supplier' as const, key: r.account, name: r.supplier, overdue: 0, count: 0, oldestDays: 0, c: 0 };
    cur.c += Math.round(r.amount * 100);
    cur.count += 1;
    cur.oldestDays = Math.max(cur.oldestDays, -r.daysToDue);
    by.set(r.account, cur);
  }
  return [...by.values()].map(({ c, ...x }) => ({ ...x, overdue: c / 100 }));
}

/** متأخر كل مقاول (لمن له مدة سداد فقط — الخادم لا يعيد غيرهم). */
export function contractorOverdue(rows: readonly ClaimDueRow[]): PartyOverdue[] {
  const by = new Map<string, PartyOverdue & { c: number }>();
  for (const r of rows) {
    if (!r.overdue || !(r.amount > 0)) continue;
    const cur = by.get(r.code) ?? { partyType: 'contractor' as const, key: r.code, name: r.name, overdue: 0, count: 0, oldestDays: 0, c: 0 };
    cur.c += Math.round(r.amount * 100);
    cur.count += 1;
    cur.oldestDays = Math.max(cur.oldestDays, r.daysLate);
    by.set(r.code, cur);
  }
  return [...by.values()].map(({ c, ...x }) => ({ ...x, overdue: c / 100 }));
}

/* ───────────────────────── مهام اليوم ───────────────────────── */

export type Sev = 'd' | 'w' | 'i';
export type TaskAction =
  | { kind: 'pay'; partyType: 'supplier' | 'contractor'; key: string; name: string; amount: number }
  | { kind: 'go'; view: string; params?: Record<string, string> };

export interface Task {
  id: string;            // ثابت عبر التحديثات كي تبقى علامة «تمّ» مرتبطة بالمهمة نفسها
  sev: Sev;
  score: number;         // للترتيب فقط — ليس رقماً يُعرض
  title: string;         // نص بلا مبلغ؛ المبلغ في `amount` يُنسَّق في العرض
  amount: number | null;
  /** تاريخ يُنسَّق في العرض ويُلحق بالعنوان (مثل بدء العجز) */
  date?: string;
  sub: string;
  actLabel: string;
  action: TaskAction;
  open: { view: string; params?: Record<string, string> };
}

export interface TaskInputs {
  today: string;
  suppliers: readonly PartyOverdue[];
  contractors: readonly PartyOverdue[];
  guarantees: readonly GuaranteeLite[];
  /** أول فترة عجز من /cashflow (رصيد افتتاحي كما أعاده الخادم) */
  deficit: { from: string; amount: number } | null;
  staleCount: number;
  withoutDataCount: number;
  needsTermCount: number;
}

const ar = (n: number | string) => String(n).replace(/\d/g, (d) => '٠١٢٣٤٥٦٧٨٩'[+d]);

/** يولّد مهام اليوم من بيانات الخادم — مرتّبة بالأهمية (المبلغ × عمر التأخر). */
export function buildTasks(x: TaskInputs): Task[] {
  const T: Task[] = [];
  // ١) العجز النقدي المتوقع — تحذير لا أحمر: ليس تأخراً زمنياً.
  if (x.deficit) {
    T.push({
      id: 'deficit:' + x.deficit.from, sev: 'w', score: 1e12,
      title: 'عجز نقدي متوقع', amount: Math.abs(x.deficit.amount),
      date: x.deficit.from, sub: 'راجع التدفق أو أجّل دفعات',
      actLabel: 'افتح التدفق', action: { kind: 'go', view: 'cash', params: { focus: x.deficit.from } },
      open: { view: 'cash', params: { focus: x.deficit.from } },
    });
  }
  // ٢) موردون متأخرون
  for (const s of x.suppliers) {
    if (!(s.overdue > 0)) continue;
    T.push({
      id: 'sup:' + s.key, sev: 'd', score: s.overdue * (1 + s.oldestDays / 30),
      title: 'ادفع لـ' + s.name, amount: s.overdue,
      sub: ar(s.count) + ' ' + plural(s.count, 'فاتورة متأخرة', 'فاتورتان متأخرتان', 'فواتير متأخرة', 'فاتورة متأخرة') + ' · أقدمها ' + ar(s.oldestDays) + ' يوماً',
      actLabel: 'سجّل دفعة', action: { kind: 'pay', partyType: 'supplier', key: s.key, name: s.name, amount: s.overdue },
      open: { view: 'supplier', params: { id: s.key } },
    });
  }
  // ٣) مستخلصات متأخرة (لمن له مدة سداد فقط)
  for (const c of x.contractors) {
    if (!(c.overdue > 0)) continue;
    T.push({
      id: 'con:' + c.key, sev: 'd', score: c.overdue * (1 + c.oldestDays / 30),
      title: 'مستخلص متأخر — ' + c.name, amount: c.overdue,
      sub: ar(c.count) + ' ' + plural(c.count, 'مستخلص متأخر', 'مستخلصان متأخران', 'مستخلصات متأخرة', 'مستخلصاً متأخراً') + ' · أقدمها ' + ar(c.oldestDays) + ' يوماً',
      actLabel: 'سجّل دفعة', action: { kind: 'pay', partyType: 'contractor', key: c.key, name: c.name, amount: c.overdue },
      open: { view: 'contractor', params: { id: c.key } },
    });
  }
  // ٤) ضمانات يحين صرفها خلال ٧ أيام
  for (const g of x.guarantees) {
    if (g.releasedOn || !g.releaseDue) continue;
    const d = daysBetween(x.today, g.releaseDue);
    if (d < 0 || d > 7) continue;
    T.push({
      id: 'gua:' + g.id, sev: 'w', score: (g.amount || 0) * (8 - d),
      title: 'ضمان ' + g.contractorName + ' يحين صرفه ' + (d === 0 ? 'اليوم' : 'خلال ' + ar(d) + ' ' + plural(d, 'يوم', 'يومين', 'أيام', 'يوماً')),
      amount: g.amount, sub: g.project || '',
      actLabel: 'افتح الضمان', action: { kind: 'go', view: 'guarantees', params: { id: g.id } },
      open: { view: 'contractor', params: { id: g.contractorCode } },
    });
  }
  // ٥) كشوفات قديمة / غائبة
  if (x.staleCount > 0) {
    T.push({
      id: 'stale:' + x.staleCount, sev: 'w', score: 5e4 * x.staleCount,
      title: 'جدّد ' + ar(x.staleCount) + ' ' + plural(x.staleCount, 'كشف', 'كشفين', 'كشوفات', 'كشفاً') + ' قديمة', amount: null,
      sub: 'موردون بلا حركة منذ فترة طويلة — قد تكون أرقامهم قديمة',
      actLabel: 'ارفع كشفاً', action: { kind: 'go', view: 'coverage' }, open: { view: 'coverage' },
    });
  }
  if (x.needsTermCount > 0) {
    T.push({
      id: 'term:' + x.needsTermCount, sev: 'w', score: 4e4 * x.needsTermCount,
      title: 'حدّد مدة السداد لـ' + ar(x.needsTermCount) + ' ' + plural(x.needsTermCount, 'مورد', 'موردَين', 'موردين', 'مورداً'), amount: null,
      sub: 'لا يُحسب لهم تأخر حتى تُحدَّد المدة',
      actLabel: 'افتح الموردين', action: { kind: 'go', view: 'suppliers', params: { filter: 'needsTerm' } },
      open: { view: 'suppliers', params: { filter: 'needsTerm' } },
    });
  }
  T.sort((a, b) => b.score - a.score);
  return T;
}

/* ───────────────────────── «تمّ» لمهام اليوم (محلي، يتصفّر يومياً) ───────────────────────── */

export interface DoneState { day: string; done: Record<string, number> }
export function loadDone(raw: string | null, today: string): DoneState {
  try {
    const o = JSON.parse(raw || '{}') as Partial<DoneState>;
    if (o && o.day === today && o.done && typeof o.done === 'object') return { day: today, done: o.done };
  } catch { /* تالف ⇒ يوم جديد */ }
  return { day: today, done: {} };
}
export function toggleDone(s: DoneState, id: string, now: number): DoneState {
  const done = { ...s.done };
  if (done[id]) delete done[id]; else done[id] = now;
  return { day: s.day, done };
}

/* ───────────────────────── أعمار الديون ───────────────────────── */

export interface Ageing { current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number }
export interface AgeBucket { key: keyof Ageing; label: string; amount: number; share: number; late: boolean }

/** شرائح /dashboard.ageing كما هي؛ share للرسم فقط (نسبة إلى أكبر شريحة). */
export function ageingBuckets(a: Partial<Ageing> | null | undefined): AgeBucket[] {
  const defs: [keyof Ageing, string, boolean][] = [
    ['current', 'لم يحن موعدها', false], ['d1_30', 'متأخر ١–٣٠', true], ['d31_60', 'متأخر ٣١–٦٠', true],
    ['d61_90', 'متأخر ٦١–٩٠', true], ['d90_plus', 'أكثر من ٩٠', true],
  ];
  const vals = defs.map(([k]) => Number(a?.[k]) || 0);
  const max = Math.max(1, ...vals);
  return defs.map(([key, label, late], i) => ({ key, label, amount: vals[i], share: vals[i] / max, late }));
}

/* ───────────────────────── «ماذا تغيّر» ───────────────────────── */

export interface Snapshot { supplierOverdue?: number; supplierOpen?: number; contractorOwed?: number }
export interface ChangeCard { key: keyof Snapshot; label: string; before: number; after: number; delta: number; tone: 'bad' | 'good' | 'flat' }

/** لكل رقم: كان/صار/الفرق. ارتفاع الدَّين = سيئ. الفرق بالهللة لا بالـfloat. */
export function changeSummary(before: Snapshot, after: Snapshot): ChangeCard[] {
  const defs: [keyof Snapshot, string][] = [['supplierOverdue', 'المتأخر للموردين'], ['supplierOpen', 'المديونية المفتوحة'], ['contractorOwed', 'للمقاولين']];
  return defs.map(([key, label]) => {
    const b = Number(before[key]) || 0, a = Number(after[key]) || 0, d = diffHalalas(a, b);
    return { key, label, before: b, after: a, delta: d, tone: d === 0 ? 'flat' : d > 0 ? 'bad' : 'good' };
  });
}

/* ───────────────────────── تنبيهات جودة البيانات ───────────────────────── */

export interface QualityWarning { sev: Sev; text: string; view: string; params?: Record<string, string> }
export interface QualityInputs {
  withoutData: number; stale: number; needsTerm: number;
  contractorsWithoutTerm: number; contractorsWithoutStatement: number;
  hasReceivables: boolean; bankBalanceKnown: boolean;
}
export function qualityWarnings(q: QualityInputs): QualityWarning[] {
  const W: QualityWarning[] = [];
  if (q.withoutData) W.push({ sev: 'w', text: ar(q.withoutData) + ' مورداً بلا كشوفات — مديونيتهم غير محسوبة', view: 'coverage' });
  if (q.stale) W.push({ sev: 'w', text: ar(q.stale) + ' كشوفاتهم قديمة', view: 'coverage' });
  if (q.needsTerm) W.push({ sev: 'w', text: ar(q.needsTerm) + ' مورداً بلا مدة سداد — تأخرهم غير محسوب', view: 'suppliers', params: { filter: 'needsTerm' } });
  if (q.contractorsWithoutTerm) W.push({ sev: 'i', text: ar(q.contractorsWithoutTerm) + ' مقاولاً بلا مدة سداد — تأخرهم غير محسوب', view: 'contractors', params: { noTerm: '1' } });
  if (q.contractorsWithoutStatement) W.push({ sev: 'w', text: ar(q.contractorsWithoutStatement) + ' مقاولاً بلا كشف حركات (رصيد مُبلَّغ فقط)', view: 'contractors' });
  if (!q.hasReceivables) W.push({ sev: 'i', text: 'لم تُرفع بيانات التحصيلات — التوقع لا يشمل الوارد', view: 'collections' });
  if (!q.bankBalanceKnown) W.push({ sev: 'w', text: 'رصيد البنك غير مُدخل — التوقع يبدأ من صفر', view: 'settings' });
  return W;
}

/* ───────────────────────── التوقع النقدي ───────────────────────── */

export function firstDeficit(periods: readonly CashPeriod[]): CashPeriod | null {
  return periods.find((p) => p.balance < 0) ?? null;
}
export function minBalance(periods: readonly CashPeriod[]): number | null {
  return periods.length ? Math.min(...periods.map((p) => p.balance)) : null;
}

/* ───────────────────────── المستحقات القادمة ───────────────────────── */

export type DueRange = '0' | '7' | '30' | 'all';
export const DUE_RANGES: [DueRange, string][] = [['0', 'اليوم'], ['7', '٧ أيام'], ['30', '٣٠ يوماً'], ['all', 'الكل']];

export interface DueRow {
  id: string;
  date: string;
  partyType: 'supplier' | 'contractor';
  key: string;
  name: string;
  project: string;
  doc: string;
  amount: number;
  late: number;            // أيام التأخر (٠ إن لم يتأخر)
  daysTo: number;          // أيام حتى الاستحقاق (سالب إن تأخر)
  status: 'late' | 'soon';
}

/** يدمج فواتير الموردين ومستخلصات المقاولين في قائمة واحدة مرتّبة بالأقدم استحقاقاً. */
export function mergeDue(
  today: string,
  suppliers: readonly BreakdownSupplierRow[] | readonly PayTodayRow[],
  claims: readonly ClaimDueRow[],
  range: DueRange,
  supplierProjects?: Readonly<Record<string, string>>,
): DueRow[] {
  const horizon = range === 'all' ? Infinity : Number(range);
  const out: DueRow[] = [];
  (suppliers as readonly (BreakdownSupplierRow | PayTodayRow)[]).forEach((r, i) => {
    const isPT = 'daysToDue' in r;
    const date = isPT ? r.dueDate : r.dueDate;
    if (!date) return; // بلا تاريخ استحقاق: لا يُخترع موعد
    const daysTo = daysBetween(today, date);
    if (daysTo > horizon) return;
    const key = r.account;
    out.push({
      id: 's:' + key + ':' + (isPT ? r.invoice : r.invoiceNumber) + ':' + date + ':' + i,
      date, partyType: 'supplier', key,
      name: isPT ? r.supplier : r.supplierName,
      project: (isPT ? r.project : supplierProjects?.[key]) || '',
      doc: (isPT ? r.invoice : r.invoiceNumber) || '',
      amount: r.amount, late: Math.max(0, -daysTo), daysTo, status: daysTo < 0 ? 'late' : 'soon',
    });
  });
  claims.forEach((c, i) => {
    const daysTo = daysBetween(today, c.date);
    if (daysTo > horizon) return;
    out.push({
      id: 'c:' + c.code + ':' + (c.claimNo || c.doc) + ':' + c.date + ':' + i,
      date: c.date, partyType: 'contractor', key: c.code, name: c.name, project: c.project || '',
      doc: c.claimNo || c.doc || '', amount: c.amount, late: Math.max(0, -daysTo, c.daysLate || 0), daysTo,
      status: daysTo < 0 || c.overdue ? 'late' : 'soon',
    });
  });
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount));
  return out;
}

export interface DueTotals { total: number; late: number; count: number }
export function dueTotals(rows: readonly DueRow[]): DueTotals {
  return { total: sumHalalas(rows, (r) => r.amount), late: sumHalalas(rows.filter((r) => r.status === 'late'), (r) => r.amount), count: rows.length };
}

/** دفعة واحدة لكل طرف عند «تسجيل كمدفوع» لعدة صفوف. */
export interface PartyPayment { partyType: 'supplier' | 'contractor'; key: string; name: string; amount: number; docs: string[] }
export function groupByParty(rows: readonly DueRow[]): PartyPayment[] {
  const by = new Map<string, PartyPayment & { c: number }>();
  for (const r of rows) {
    const k = r.partyType + ':' + r.key;
    const cur = by.get(k) ?? { partyType: r.partyType, key: r.key, name: r.name, amount: 0, docs: [], c: 0 };
    cur.c += Math.round(r.amount * 100);
    if (r.doc) cur.docs.push(r.doc);
    by.set(k, cur);
  }
  return [...by.values()].map(({ c, ...x }) => ({ ...x, amount: c / 100 }));
}

/** قائمة الدفع كـCSV (BOM لكي يفتحها Excel بالعربية سليمة). */
export function paymentListCsv(rows: readonly DueRow[]): string {
  const q = (s: unknown) => { const v = String(s ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const head = ['الاستحقاق', 'الطرف', 'النوع', 'المشروع', 'المستند', 'أيام التأخر', 'المبلغ'];
  const lines = rows.map((r) => [r.date, r.name, r.partyType === 'contractor' ? 'مقاول' : 'مورد', r.project, r.doc, r.late, r.amount.toFixed(2)].map(q).join(','));
  return '﻿' + [head.join(','), ...lines, ['الإجمالي', '', '', '', '', '', sumHalalas(rows, (r) => r.amount).toFixed(2)].join(',')].join('\n');
}

/* ───────────────────────── التقويم ───────────────────────── */

export type EvKind = 'invoices' | 'claim' | 'guarantee';
export interface CalEvent {
  kind: EvKind;
  date: string;
  label: string;
  amount: number;
  count: number;          // للفواتير: عدد الفواتير في الدلو
  late: boolean;          // تأخر زمني فقط ⇒ أحمر
  key?: string;           // رمز المقاول/الحساب
  doc?: string;
  project?: string;
  daysLate?: number;
}
/** دلو يوم من /dashboard.schedule */
export interface ScheduleBucket { date: string; amount: number; count: number; overdue: boolean }

export const EV_LABEL: Record<EvKind, string> = { invoices: 'فواتير موردين', claim: 'مستخلص', guarantee: 'صرف ضمان' };

/** أحداث التقويم مجمّعة باليوم. الموردون دلو واحد لليوم (هذا ما يعيده الخادم)، والتفصيل عند النقر. */
export function calendarEvents(
  schedule: readonly ScheduleBucket[], claims: readonly ClaimDueRow[], guarantees: readonly GuaranteeLite[], project?: string,
): Record<string, CalEvent[]> {
  const by: Record<string, CalEvent[]> = {};
  const add = (e: CalEvent) => { (by[e.date] = by[e.date] || []).push(e); };
  for (const b of schedule) if (b.amount || b.count) add({ kind: 'invoices', date: b.date, label: EV_LABEL.invoices, amount: b.amount, count: b.count, late: !!b.overdue });
  for (const c of claims) add({ kind: 'claim', date: c.date, label: 'مستخلص — ' + c.name, amount: c.amount, count: 1, late: !!c.overdue, key: c.code, doc: c.claimNo || c.doc, project: c.project, daysLate: c.daysLate });
  for (const g of guarantees) {
    if (g.releasedOn || !g.releaseDue) continue;
    if (project && g.project !== project) continue;
    add({ kind: 'guarantee', date: g.releaseDue, label: 'ضمان — ' + g.contractorName, amount: g.amount || 0, count: 1, late: false, key: g.contractorCode, project: g.project });
  }
  return by;
}

/** أول يوم في الأسبوع. السبت (6) افتراضاً — نفس شبكة التقويم القديمة وتقويم العمل المحلي. */
export function weekStartOf(d: Date, weekStartDay = 6): Date {
  return addDays(d, -((d.getDay() - weekStartDay + 7) % 7));
}
/** خلايا الشبكة: شهر (٣٥ أو ٤٢ خلية) أو أسبوع (٧). */
export function gridCells(mode: 'month' | 'week', y: number, m: number, weekStart: Date, weekStartDay = 6): Date[] {
  const cells: Date[] = [];
  if (mode === 'week') { for (let i = 0; i < 7; i++) cells.push(addDays(weekStart, i)); return cells; }
  const start = weekStartOf(new Date(y, m, 1), weekStartDay);
  for (let i = 0; i < 42; i++) cells.push(addDays(start, i));
  return cells[35].getMonth() !== m ? cells.slice(0, 35) : cells;
}
export function dayNames(weekStartDay = 6): string[] {
  const D = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  return Array.from({ length: 7 }, (_, i) => D[(weekStartDay + i) % 7]);
}
/** إجماليات الفترة المعروضة: الصادر (فواتير + مستخلصات) منفصلاً عن الضمانات. */
export function periodTotals(cells: readonly Date[], ev: Record<string, CalEvent[]>, inRange: (d: Date) => boolean) {
  let out = 0, gua = 0, n = 0;
  for (const c of cells) {
    if (!inRange(c)) continue;
    for (const e of ev[iso(c)] || []) {
      n += e.count;
      if (e.kind === 'guarantee') gua += Math.round(e.amount * 100); else out += Math.round(e.amount * 100);
    }
  }
  return { due: out / 100, guarantees: gua / 100, count: n };
}
