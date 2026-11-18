/**
 * تجميع «تقرير المدير العام» من حمولات الخادم — دالة نقية بلا React.
 *
 * القاعدة: هذا الملف **ينتقي ويرتّب** أرقام الخادم ولا يحسب مبلغاً جديداً.
 * النموذج الأولي (prototype/sections/reports.js compute()) كان يجمع كل شيء في
 * المتصفح لأنه بلا خادم؛ هنا يُمنع ذلك (CLAUDE.md §٢). كل رقم لا يوفّره الخادم
 * بعد يُعلَّم `unavailable` بسبب صريح — عمود فارغ صادق خير من رقم مفبرك.
 */
import type {
  AnalysisPayload, AgeingBucket, PartyScope, ReportContractorRow, ReportNote,
  ReportSupplierRow, ScheduleRow,
} from './types';

/* ───────── تفضيلات التقرير (تُحفظ محلياً لكل مستخدم) ───────── */

export type SectionKey =
  | 'summary' | 'ageing' | 'schedule' | 'overdue' | 'contractors'
  | 'priorities' | 'budget' | 'cash' | 'collections' | 'notes' | 'disclosure';

/** ترتيب الأقسام وعناوينها — اتحاد أقسام Report.tsx القديمة وأقسام النموذج المعتمد. */
export const SECTIONS: readonly { key: SectionKey; label: string; sub?: string }[] = [
  { key: 'summary', label: 'الملخص التنفيذي', sub: 'الوضع الكلي في تاريخ التقرير' },
  { key: 'ageing', label: 'أعمار الديون', sub: 'المديونية المفتوحة موزعةً حسب عدد الأيام منذ الاستحقاق' },
  { key: 'schedule', label: 'جدول السداد القادم', sub: 'ما يجب دفعه ومتى — مرتباً بتاريخ الاستحقاق ومنسوباً لصاحبه' },
  { key: 'overdue', label: 'أعلى المتأخرات', sub: 'أكبر خمس جهات تأخراً بالمبلغ' },
  { key: 'contractors', label: 'المقاولون', sub: 'السالب = نحن ندين لهم · الموجب = يدينون لنا' },
  { key: 'priorities', label: 'أولويات السداد', sub: 'ترتيب حتمي على مستوى الشركة بالكامل — لا يتقيّد بنطاق هذا التقرير' },
  { key: 'budget', label: 'الموازنة', sub: 'المخطط مقابل الفعلي' },
  { key: 'cash', label: 'التدفق النقدي', sub: 'الرصيد المتوقع — يبدأ من رصيد البنك' },
  { key: 'collections', label: 'التحصيلات', sub: 'ما لنا عند الجهات المالكة' },
  { key: 'notes', label: 'ملاحظات ومخاطر', sub: 'بنود تحتاج قراراً أو تصحيحاً في المصدر' },
  { key: 'disclosure', label: 'ملاحظات الإفصاح' },
];

export interface ReportPrefs {
  sections: Record<SectionKey, boolean>;
  /** تاريخ الإصدار في الترويسة فقط — الأرقام دائماً حتى «اليوم» أو date_to. */
  issue: string | null;
  /** ملاحظة تنفيذية حرّة أعلى الورقة (النموذج المعتمد). */
  note: string;
  /** إظهار ملاحظات المتحدث في العرض. */
  speakerNotes: boolean;
  /** اتجاه الورقة للـPDF — نفس مفتاح PrintableList القديم ليبقى التفضيل واحداً. */
  landscape: boolean;
}

const PREF_KEY = 'egco-reports-v1';
const ORIENTATION_KEY = 'egco-print-landscape'; // PrintableList.tsx:17 — يُعاد استعماله عمداً

export const DEFAULT_PREFS: ReportPrefs = {
  sections: {
    summary: true, ageing: true, schedule: true, overdue: true, contractors: true,
    priorities: true, budget: true, cash: true, collections: true, notes: true, disclosure: true,
  },
  issue: null, note: '', speakerNotes: false, landscape: false,
};

export function loadPrefs(): ReportPrefs {
  let p: Partial<ReportPrefs> = {};
  let landscape = false;
  try { p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Partial<ReportPrefs>; } catch { /* افتراضي */ }
  try { landscape = localStorage.getItem(ORIENTATION_KEY) === '1'; } catch { /* افتراضي */ }
  return {
    ...DEFAULT_PREFS, ...p,
    sections: { ...DEFAULT_PREFS.sections, ...(p.sections ?? {}) },
    landscape,
  };
}

export function savePrefs(p: ReportPrefs): void {
  try {
    const { landscape, ...rest } = p;
    localStorage.setItem(PREF_KEY, JSON.stringify(rest));
    localStorage.setItem(ORIENTATION_KEY, landscape ? '1' : '0');
  } catch { /* تفضيل لا بيانات — فقدانه مقبول */ }
}

/* ───────── اتجاه الرصيد ───────── */

export type Tone = 'warn' | 'ok' | 'neutral';

/**
 * اصطلاح الكشف: سالب = «له» (نحن ندين) · موجب = «لنا». لا يُعكس (CLAUDE.md §٢).
 * الأحمر محجوز للتأخر الزمني وحده — Report.tsx:773 كان يلوّن «له» بالأحمر فيُقرأ
 * رصيدٌ جارٍ عادي كأنه متأخر. الكلمة تحمل الاتجاه، واللون محايد دائماً (P-591 — نفس اصطلاح قسم الأطراف).
 */
export function balanceView(balance: number): { tone: Tone; label: string; long: string } {
  if (balance < 0) return { tone: 'neutral', label: 'نحن ندين لهم', long: 'نحن ندين لهم' };
  if (balance > 0) return { tone: 'neutral', label: 'يدينون لنا', long: 'يدينون لنا' };
  return { tone: 'neutral', label: 'متوازن', long: 'متوازن' };
}

export const SCOPE_FALLBACK: Record<PartyScope, string> = {
  suppliers: 'كل الموردين', contractors: 'كل المقاولين', both: 'الموردون والمقاولون',
};

/* ───────── نموذج التقرير ───────── */

export interface Unavailable { unavailable: true; reason: string }
export const isUnavailable = (x: unknown): x is Unavailable =>
  typeof x === 'object' && x !== null && (x as Unavailable).unavailable === true;

export interface OverdueEntry {
  kind: 'supplier' | 'contractor';
  key: string;
  name: string;
  project: string | null;
  amount: number;
}

export interface GmReport {
  parties: PartyScope;
  scopeLabel: string;
  meta: AnalysisPayload['meta'];
  showSuppliers: boolean;
  /** الافتتاحي/الختامي — للموردين فقط، ويُخفى في تقرير المقاولين وحدهم (Report.tsx:447-450). */
  opening: null | {
    opening: number; invoicedInPeriod: number; paidInPeriod: number; closing: number;
    periodFrom: string | null;
  };
  summary: AnalysisPayload['summary'];
  hasCreditBalance: boolean;
  ageing: AgeingBucket[];
  ageingUndated: number;
  schedule: ScheduleRow[];
  /** أعلى المتأخرات — موردون فقط: الخادم لا يحسب تأخراً للمقاولين (دفتر بلا استحقاق). */
  overdueTop: OverdueEntry[];
  suppliers: ReportSupplierRow[];
  contractors: null | {
    rows: ReportContractorRow[];
    /** الأشد سالبية أولاً — كما يرتّبها الخادم (contractor_report_service.rows). */
    totals: { invoiced: number; paid: number; balance: number; outstanding: number; count: number };
  };
  notes: ReportNote[];
  /** أقسام النموذج التي تحتاج مسارات لم تُربط بعد بالتقرير — انظر PARITY-reports.md §ج. */
  budget: Unavailable;
  cash: Unavailable;
  collections: Unavailable;
  /** الفرق عن الشهر الماضي — لا يوفره الخادم بعد. */
  deltaVsLastMonth: Unavailable;
}

const PENDING = (what: string): Unavailable => ({
  unavailable: true,
  reason: `${what} — بانتظار ربطه بمسار الخادم؛ لا يُعرض رقم غير محسوب على الخادم.`,
});

export function buildGmReport(d: AnalysisPayload, parties: PartyScope): GmReport {
  const m = d.meta, s = d.summary;
  const showSuppliers = parties !== 'contractors' && m.scope !== 'contractor';
  const con = d.contractors && d.contractors.rows.length > 0 ? d.contractors : null;

  const overdueTop: OverdueEntry[] = showSuppliers
    ? d.suppliers.filter((x) => x.overdue > 0)
      .map((x) => ({ kind: 'supplier' as const, key: x.account, name: x.name, project: x.project, amount: x.overdue }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
    : [];

  return {
    parties,
    scopeLabel: m.scope_label ?? SCOPE_FALLBACK[parties],
    meta: m,
    showSuppliers,
    opening: showSuppliers ? {
      opening: m.opening_balance,
      invoicedInPeriod: m.invoiced_in_period,
      paidInPeriod: m.paid_in_period,
      closing: m.closing_balance,
      periodFrom: m.period_from,
    } : null,
    summary: s,
    hasCreditBalance: (s.credit_balances ?? 0) > 0,
    ageing: d.ageing,
    ageingUndated: d.ageingUndated ?? 0,
    schedule: d.schedule,
    overdueTop,
    suppliers: d.suppliers,
    contractors: con ? {
      rows: con.rows,
      totals: {
        invoiced: con.totals.invoiced, paid: con.totals.paid, balance: con.totals.balance,
        outstanding: con.totals.outstanding, count: con.totals.count,
      },
    } : null,
    notes: d.notes ?? [],
    budget: PENDING('الموازنة'),
    cash: PENDING('التدفق النقدي'),
    collections: PENDING('التحصيلات'),
    deltaVsLastMonth: PENDING('الفرق عن الشهر الماضي'),
  };
}

/** ترقيم الأقسام يتبع ما ظهر فعلاً — قسم مخفي لا يترك فجوة (Report.tsx:454-457). */
export function visibleSections(r: GmReport, prefs: ReportPrefs): { key: SectionKey; no: number }[] {
  const has: Record<SectionKey, boolean> = {
    summary: true,
    ageing: r.showSuppliers,
    schedule: r.showSuppliers,
    overdue: r.showSuppliers,
    contractors: r.contractors !== null,
    priorities: true,
    budget: true, cash: true, collections: true, // تظهر بحالة «غير متاح» صريحة لا تختفي
    notes: r.notes.length > 0,
    disclosure: true,
  };
  let n = 0;
  return SECTIONS.filter((s) => prefs.sections[s.key] && has[s.key]).map((s) => ({ key: s.key, no: ++n }));
}

/* ───────── الإجراءات المطلوبة — مشتقّة من الأرقام لا نصاً ثابتاً ───────── */

export interface Decision { sev: 'd' | 'w' | 'i' | 'ok'; title: string; body?: string }

/**
 * يجمع منطق الشريحة الختامية القديمة (Report.tsx:1212-1240) وقائمة «قرارات مطلوبة»
 * في النموذج (reports.js decisions()). المبالغ تُنقل كما هي من الخادم؛ لا جمع.
 */
export function buildDecisions(r: GmReport, fmt: (n: number) => string, digits: (n: number) => string): Decision[] {
  const out: Decision[] = [];
  const s = r.summary;
  if (r.showSuppliers && s.overdue > 0) {
    const overdueDates = r.schedule.filter((x) => x.overdue).length;
    out.push({ sev: 'd', title: `تسوية ${fmt(s.overdue)} ر.س متأخرة`,
      body: `${digits(overdueDates)} موعد استحقاق تجاوزته الفواتير — أولوية فورية` });
  }
  const top = r.overdueTop[0];
  if (top) out.push({ sev: 'd', title: `سداد المتأخر الأكبر: ${top.name}`, body: `${fmt(top.amount)} ر.س متأخرة.` });
  const nextDue = r.schedule.find((x) => !x.overdue);
  if (nextDue) out.push({ sev: 'w', title: `تجهيز ${fmt(nextDue.amount)} ر.س لاستحقاق ${nextDue.date_ar}` });
  if (r.contractors && r.contractors.totals.outstanding > 0) {
    const worst = r.contractors.rows[0]; // الخادم يرتّب الأشد سالبية أولاً
    // 'w' لا 'd': مستحق المقاول رصيد جارٍ لا تأخر زمني — الخادم لا يحسب له استحقاقاً
    out.push({ sev: 'w', title: `استحقاق مقاولين ${fmt(r.contractors.totals.outstanding)} ر.س مستحقة لهم`,
      body: worst && worst.balance < 0 ? `أعلاها ${worst.name} بمبلغ ${fmt(Math.abs(worst.balance))} ر.س` : undefined });
  }
  if (r.notes.some((n) => n.title === 'موردو المستخلصات')) {
    out.push({ sev: 'i', title: 'استكمال تواريخ استحقاق فواتير موردي المستخلصات يدوياً' });
  }
  if (out.length === 0) {
    out.push({ sev: 'ok', title: 'لا التزامات متأخرة أو عاجلة في نطاق هذا التقرير — لا إجراء مطلوب الآن' });
  }
  return out;
}

/* ───────── نص التقرير (نسخ كنص — النموذج المعتمد) ───────── */

export function reportText(r: GmReport, prefs: ReportPrefs, fmt: (n: number) => string): string {
  const L: string[] = [];
  const on = prefs.sections;
  L.push(`${r.meta.company} — ${r.meta.title}`);
  L.push(`النطاق: ${r.scopeLabel} · ${r.meta.period} · رقم الوثيقة ${r.meta.serial}`);
  if (prefs.note.trim()) L.push('', 'ملاحظة تنفيذية:', prefs.note.trim());
  if (on.summary) {
    L.push('', '■ الملخص التنفيذي');
    L.push(`إجمالي المفوتر: ${fmt(r.summary.total_invoiced)} ر.س`);
    L.push(`المسدد: ${fmt(r.summary.total_paid)} ر.س`);
    L.push(`المديونية المفتوحة: ${fmt(r.summary.outstanding)} ر.س`);
    if (r.showSuppliers) L.push(`المتأخر عن موعده (موردون): ${fmt(r.summary.overdue)} ر.س`);
  }
  if (on.ageing && r.showSuppliers) {
    L.push('', '■ أعمار الديون (موردون)');
    r.ageing.forEach((a) => L.push(`${a.label}: ${fmt(a.amount)}`));
    if (r.ageingUndated > 0) L.push(`بانتظار تاريخ استحقاق: ${fmt(r.ageingUndated)}`);
  }
  if (on.overdue && r.overdueTop.length) {
    L.push('', '■ أعلى المتأخرات');
    r.overdueTop.forEach((o, i) => L.push(`${i + 1}. ${o.name} — ${fmt(o.amount)}`));
  }
  if (on.contractors && r.contractors) {
    L.push('', '■ المقاولون');
    r.contractors.rows.forEach((c) => L.push(`${c.name}: ${fmt(Math.abs(c.balance))} ${balanceView(c.balance).long}`));
  }
  if (on.notes && r.notes.length) {
    L.push('', '■ ملاحظات ومخاطر');
    r.notes.forEach((n) => L.push(`${n.title}: ${n.body}`));
  }
  return L.join('\n');
}
