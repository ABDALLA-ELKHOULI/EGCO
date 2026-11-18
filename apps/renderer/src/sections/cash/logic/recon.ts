/**
 * المطابقة — عرض فقط. كل مصطلح من الخادم؛ هنا نقرّر هل الفرق «حقيقي» ونبني قائمة
 * المصطلحات بترتيب المعادلة مع المصطلح القابل للتفصيل خلف كل منها.
 */
import { toH } from './money';
import type { BreakdownTerm, InflowRecon, OutflowRecon, Parties } from '../types';

/** فرق أقل من نصف هللة تقريبٌ لا خطأ؛ ما فوقه يُعرض «فرق غير مفسَّر».
 * نفس العتبة حرفياً كالقديم (CashFlow.tsx:412، ε=0.005 · P-224) — لا toH هنا: Math.round(-0.5)
 * يعطي ‎-0 فيصير الحدّ غير متماثل بين الفرق الموجب والسالب. */
export const RECON_EPSILON = 0.005;
export const hasDrift = (difference: number | null | undefined): boolean => Math.abs(difference ?? 0) >= RECON_EPSILON;

export interface ReconTermView {
  sign: '' | '+' | '−' | '=';
  label: string;
  value: number;
  term?: BreakdownTerm;   // قابل للنقر ⇒ نافذة «من أين جاء هذا الرقم؟»
  rule?: string;
  muted?: boolean;
}

export function outflowTerms(o: OutflowRecon): ReconTermView[] {
  const t: ReconTermView[] = [
    { sign: '', label: 'الخارج المجدول', value: o.scheduled, term: 'scheduled', rule: 'فواتير موردين/ضمانات مقاولين مستحقة داخل الأفق المعروض.' },
    { sign: '+', label: 'متأخر الآن', value: o.overdueNow, term: 'overdue', rule: 'فواتير موردين/ضمانات مقاولين مضى تاريخ استحقاقها قبل بداية الأفق المعروض ولم تُسدَّد بالكامل.' },
    { sign: '+', label: 'بعد نهاية الأفق', value: o.beyondHorizon, term: 'beyond', rule: 'فواتير موردين/ضمانات مقاولين تستحق بعد آخر يوم في الأفق المعروض.' },
    { sign: '+', label: 'بلا تواريخ', value: o.undated, term: 'undated', rule: 'فواتير موردين بلا تاريخ استحقاق، أو رصيد مقاولين مستحق يتجاوز ما لهم من ضمانات مؤرَّخة.' },
  ];
  // credits معلومة معروضة لا طرف في المعادلة (انظر _combine_outflow على الخادم)
  if (toH(o.credits) !== 0) t.push({ sign: '−', label: 'أرصدة دائنة', value: o.credits, muted: true });
  if (toH(o.excess) !== 0) t.push({ sign: '−', label: 'ضمانات تتجاوز المستحق', value: o.excess, muted: true });
  t.push({ sign: '=', label: 'المديونية المفتوحة', value: o.openDebt });
  return t;
}

export function inflowTerms(i: InflowRecon): ReconTermView[] {
  return [
    { sign: '', label: 'الداخل المجدول', value: i.scheduled, term: 'forecast', rule: 'تحصيلات مفتوحة لها تاريخ استحقاق داخل الأفق المعروض.' },
    // لا مسار breakdown لمتأخر/بعد/بلا تواريخ الداخل بعد — غير قابلة للنقر (ثغرة خادم موثّقة)
    { sign: '+', label: 'متأخر الآن', value: i.overdueNow },
    { sign: '+', label: 'بعد نهاية الأفق', value: i.beyondHorizon },
    { sign: '+', label: 'بلا تواريخ', value: i.undated },
    { sign: '=', label: 'المستحق المفتوح', value: i.openTotal },
  ];
}

export const partiesLabel = (p: Parties): string =>
  p === 'suppliers' ? 'الموردين' : p === 'contractors' ? 'المقاولين' : 'الموردين والمقاولين';

export const RECON_DIFF_REASONS: readonly { code: string; label: string }[] = [
  { code: 'overdue_not_yet_billed', label: 'مبلغ متأخر لم يُرفع كشفه بعد' },
  { code: 'payment_not_recorded', label: 'دفعة لم تُسجَّل' },
];
