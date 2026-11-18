/**
 * تنسيق الأرقام والتواريخ — منقول من prototype/ui.js («تنسيق»).
 * كل الدوال تقرأ تفضيل الأرقام (123/١٢٣) لحظة الاستدعاء؛ المكوّن الذي يعرض أرقاماً
 * يستدعي usePrefs() (أو يستعمل <Money>/<Num>) كي يُعاد رسمه عند تبديل التفضيل.
 *
 * تنبيه مالي: هذه دوال **عرض** فقط. الأرقام تأتي محسوبة بـDecimal من الخادم؛ لا تُجمع
 * مبالغ في الواجهة إلا بالهللات الصحيحة (انظر sumHalalas) ولا يُعاد حساب رقم معروض.
 */
import { getPrefs } from './prefs';

const AR = '٠١٢٣٤٥٦٧٨٩';
export const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
export const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

const isArab = () => getPrefs().digits === 'arab';

/** يحوّل الأرقام اللاتينية إلى عربية-هندية حسب التفضيل (والفاصلة ٬ والعشرية ٫). */
export function digits(s: unknown): string {
  const t = String(s == null ? '' : s);
  return isArab() ? t.replace(/[0-9]/g, (c) => AR[+c]).replace(/,/g, '٬').replace(/\./g, '٫') : t;
}

type N = number | string | null | undefined;
const num = (n: N): number | null => {
  if (n == null || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
};

/** مبلغ بخانتين عشريتين وعلامة ناقص حقيقية (−). null/غير رقم → «—». */
export function fmt(n: N): string {
  const v0 = num(n); if (v0 == null) return '—';
  const v = Math.round(v0 * 100) / 100;
  return digits((v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
}
/** عدد صحيح بفواصل الآلاف. */
export function int(n: N): string {
  const v0 = num(n); if (v0 == null) return '—';
  const v = Math.round(v0);
  return digits((v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US'));
}
/** مختصر: «4.71 م» · «850 ألف». للمحاور والتلميحات فقط — لا يُستعمل لرقم يُتّخذ عليه قرار. */
export function compact(n: N): string {
  const v = num(n); if (v == null) return '—';
  const a = Math.abs(v), s = v < 0 ? '−' : '';
  if (a >= 1e6) return digits(s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + ' م';
  if (a >= 1e3) return digits(s + (a / 1e3).toFixed(0)) + ' ألف';
  return digits(s + a.toFixed(0));
}

export function toDate(x: unknown): Date | null {
  if (x instanceof Date) return x;
  if (typeof x === 'number') return new Date(x);
  const s = String(x || '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1); }
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
}
/** «الثلاثاء 17 نوفمبر» · شهر (YYYY-MM) → «نوفمبر 2026». */
export function dateTxt(x: unknown, opts: { weekday?: boolean; year?: boolean } = {}): string {
  const d = toDate(x); if (!d) return '—';
  if (/^\d{4}-\d{2}$/.test(String(x))) return MONTHS[d.getMonth()] + ' ' + digits(d.getFullYear());
  return (opts.weekday ? DAYS[d.getDay()] + ' ' : '') + digits(d.getDate()) + ' ' + MONTHS[d.getMonth()] + (opts.year ? ' ' + digits(d.getFullYear()) : '');
}
/** «الآن» · «قبل 12 د» · «قبل 3 س» · «أمس» · «قبل 5 يوماً». */
export function ago(x: unknown): string {
  const t = toDate(x); if (!t) return '';
  const m = Math.round((Date.now() - t.getTime()) / 6e4);
  if (m < 1) return 'الآن';
  if (m < 60) return 'قبل ' + digits(m) + ' د';
  if (m < 1440) return 'قبل ' + digits(Math.round(m / 60)) + ' س';
  if (m < 2880) return 'أمس';
  return 'قبل ' + digits(Math.round(m / 1440)) + ' يوماً';
}

/** تطبيع عربي للبحث: يزيل التشكيل والتطويل، يوحّد الألف/التاء المربوطة/الياء، والأرقام. */
export function normAr(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6F0))
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** يقرأ رقماً كتبه المستخدم: أرقام عربية، ٬ ٫، (سالب بين قوسين)، − . فارغ → null، تالف → NaN. */
export function parseNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  let s = String(v).trim();
  if (!s) return null;
  s = s.replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x6F0));
  s = s.replace(/٬/g, '').replace(/,/g, '').replace(/٫/g, '.').replace(/[−–]/g, '-');
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[^0-9.-]/g, '');
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return NaN;
  return neg ? -n : n;
}

/** جمع مبالغ بالهللات الصحيحة — لا انحراف عائم. للعرض فقط (إجمالي صفوف مصفّاة/محددة). */
export function sumHalalas<T>(rows: T[], get: (r: T) => unknown): number {
  let h = 0;
  for (const r of rows) { const v = Number(get(r)); if (v != null && Number.isFinite(v)) h += Math.round(v * 100); }
  return h / 100;
}

export const esc = (s: unknown) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
