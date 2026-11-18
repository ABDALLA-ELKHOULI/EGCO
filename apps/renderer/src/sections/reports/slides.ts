/**
 * نموذج الشرائح — بيانات لا JSX.
 *
 * Present.tsx القديم كان يستقبل `body: ReactNode` جاهزاً، فلا يمكن اختبار ما في
 * الشريحة ولا إعادة استعماله للطباعة إلا بإعادة رسمه. هنا كل شريحة وصف مُنمَّط
 * (kind + data) يرسمه مكوّن واحد في المرحلة B للعرض وللـPDF معاً — فما يُعرض على
 * الإدارة هو حرفياً ما في التقرير (Report.tsx:1033-1034).
 */
import type { AgeingBucket, ReportContractorRow, ReportNote, ReportSupplierRow, ScheduleRow } from './types';
import type { Decision, GmReport, OverdueEntry } from './model';
import { buildDecisions } from './model';

export type SlideBody =
  | { kind: 'cover'; title: string; scope: string; period: string; serial: string; issuedOn: string }
  | { kind: 'kpis'; totalInvoiced: number; totalPaid: number; outstanding: number;
      overdue: number | null; overdueCount: number }
  | { kind: 'ageing'; buckets: AgeingBucket[]; undated: number }
  | { kind: 'schedule'; rows: ScheduleRow[] }
  | { kind: 'overdue'; rows: OverdueEntry[] }
  | { kind: 'topSuppliers'; rows: ReportSupplierRow[] }
  | { kind: 'contractors'; invoiced: number; paid: number; owed: number; rows: ReportContractorRow[] }
  | { kind: 'notes'; notes: ReportNote[] }
  | { kind: 'decisions'; items: Decision[] };

export interface SlideModel {
  id: string;
  title: string;
  subtitle?: string;
  /** ملاحظة المتحدث (N) — النموذج المعتمد. */
  note?: string;
  body: SlideBody;
}

export function buildSlides(
  r: GmReport,
  fmt: (n: number) => string,
  digits: (n: number) => string,
): SlideModel[] {
  const m = r.meta, s = r.summary, scope = r.scopeLabel;
  const out: SlideModel[] = [];

  out.push({
    id: 'cover', title: m.company, subtitle: m.department,
    note: 'افتتاح: الوضع حتى اليوم — كل رقم من الكشوف المستوردة ويمكن تتبعه.',
    body: { kind: 'cover', title: m.title, scope, period: m.period, serial: m.serial, issuedOn: m.issued_on },
  });

  out.push({
    id: 'kpis', title: 'الأرقام الرئيسية', subtitle: `${scope} · ${m.period}`,
    note: `المديونية المفتوحة ${fmt(s.outstanding)}` + (r.showSuppliers ? `، منها متأخر ${fmt(s.overdue)}.` : '.'),
    body: { kind: 'kpis', totalInvoiced: s.total_invoiced, totalPaid: s.total_paid, outstanding: s.outstanding,
      overdue: r.showSuppliers ? s.overdue : null, overdueCount: r.overdueTop.length },
  });

  if (r.showSuppliers && r.ageing.length) {
    const worst = r.ageing[r.ageing.length - 1];
    out.push({
      id: 'ageing', title: 'أعمار الديون', subtitle: `${scope} — المديونية المفتوحة حسب الأيام منذ الاستحقاق`,
      note: worst ? `${worst.label}: ${fmt(worst.amount)} — الأخطر على العلاقة مع الموردين.` : undefined,
      body: { kind: 'ageing', buckets: r.ageing, undated: r.ageingUndated },
    });
  }

  if (r.showSuppliers && r.schedule.length) {
    out.push({
      id: 'schedule', title: 'جدول السداد القادم', subtitle: `${scope} — ما يجب دفعه ومتى`,
      body: { kind: 'schedule', rows: r.schedule.slice(0, 10) },
    });
  }

  if (r.overdueTop.length) {
    out.push({
      id: 'overdue', title: 'أعلى المتأخرات', subtitle: 'أكبر خمس جهات',
      note: `الأكبر ${r.overdueTop[0].name} بـ${fmt(r.overdueTop[0].amount)}.`,
      body: { kind: 'overdue', rows: r.overdueTop },
    });
  }

  if (r.suppliers.length > 1) {
    out.push({
      id: 'top-suppliers', title: 'أعلى الموردين مديونية', subtitle: scope,
      body: { kind: 'topSuppliers', rows: r.suppliers.slice(0, 8) },
    });
  }

  // شريحة المقاولين فقط حين يشملهم النطاق — لا قسم فارغ أمام الحضور (Report.tsx:1156)
  if (r.contractors) {
    out.push({
      id: 'contractors', title: 'المقاولون', subtitle: `${scope} — الإجمالي وأعلى الأرصدة`,
      note: `مستحق للمقاولين ${fmt(r.contractors.totals.outstanding)} — ${digits(r.contractors.totals.count)} مقاولاً.`,
      body: { kind: 'contractors', invoiced: r.contractors.totals.invoiced, paid: r.contractors.totals.paid,
        owed: r.contractors.totals.outstanding, rows: r.contractors.rows.slice(0, 6) },
    });
  }

  if (r.notes.length) {
    out.push({ id: 'notes', title: 'ملاحظات ومخاطر', subtitle: scope, body: { kind: 'notes', notes: r.notes } });
  }

  out.push({
    id: 'decisions', title: 'قرارات مطلوبة', subtitle: scope,
    note: 'اطلب قراراً واضحاً لكل بند، مع مسؤول وموعد.',
    body: { kind: 'decisions', items: buildDecisions(r, fmt, digits).slice(0, 6) },
  });

  return out;
}

/* ───────── لوحة المفاتيح — RTL: الأيسر يتقدّم، الأيمن يرجع (Present.tsx:22) ───────── */

export type PresentAction = 'next' | 'prev' | 'first' | 'last' | 'close' | 'notes' | 'fullscreen' | null;

export function keyToAction(key: string): PresentAction {
  switch (key) {
    case 'ArrowLeft': case 'PageDown': case ' ': case 'Spacebar': return 'next';
    case 'ArrowRight': case 'PageUp': return 'prev';
    case 'Home': return 'first';
    case 'End': return 'last';
    case 'Escape': return 'close';
    case 'n': case 'N': case 'ى': return 'notes';
    case 'f': case 'F': case 'ب': return 'fullscreen';
    default: return null;
  }
}
