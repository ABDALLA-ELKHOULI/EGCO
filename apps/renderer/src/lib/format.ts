/** أدوات التنسيق — Arabic-aware formatters. */

const AR = '٠١٢٣٤٥٦٧٨٩';
const MONTHS = ['يناير','فبراير','مارس','أبريل','مايو','يونيو',
                'يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];

/** أرقام هندية للنصوص العربية الجارية (العدّ والتواريخ) — لا للمبالغ. */
export const ar = (v: string | number) => String(v).replace(/\d/g, (d) => AR[+d]);

/** المبالغ تبقى بالأرقام اللاتينية وبفواصل الآلاف، وتُعرض LTR. */
export const sar = (v: number, d = 2) =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export const sar0 = (v: number) => sar(v, 0);
export const k = (v: number) => (v / 1000).toLocaleString('en-US', { maximumFractionDigits: 0 }) + 'k';
export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '—' : `${v.toFixed(d)}٪`;

/** 2026-08-13 → ١٣ أغسطس ٢٠٢٦ — تتحمل تاريخ/وقت ISO كاملاً وقيماً غير سليمة. */
export function arDate(iso: string | null | undefined, withYear = true): string {
  if (!iso || typeof iso !== 'string') return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) || m < 1 || m > 12) return '—';
  return withYear ? `${ar(d)} ${MONTHS[m - 1]} ${ar(y)}` : `${ar(d)} ${MONTHS[m - 1]}`;
}

/**
 * مدى تاريخي. السنة تُذكر مرة واحدة إن تطابقت، ومرّتين إن اختلفت —
 * «١ يناير – ٦ أغسطس» لمدى يمتد من ٢٠٢٥ إلى ٢٠٢٦ يقرأه المستخدم كسنة واحدة.
 */
export function arRange(from: string | null | undefined, to: string | null | undefined): string {
  if (!from || !to) return arDate(from || to);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return sameYear ? `${arDate(from, false)} – ${arDate(to)}` : `${arDate(from)} – ${arDate(to)}`;
}

/**
 * تمييز العدد في العربية: ٠ نفي، ١ مفرد، ٢ مثنى، ٣–١٠ جمع، وما فوق مفرد.
 * «١ فواتير» و«٢ فواتير» أخطاء ظاهرة في كل جدول استحقاقات.
 */
export function arCount(n: number, forms: { zero: string; one: string; two: string; few: string; many: string }): string {
  if (!n) return forms.zero;
  if (n === 1) return forms.one;
  if (n === 2) return forms.two;
  return `${ar(n)} ${n >= 3 && n <= 10 ? forms.few : forms.many}`;
}

/** «٣ فواتير» / «فاتورة واحدة» / «١٢ فاتورة» */
export const invoiceCount = (n: number) =>
  arCount(n, { zero: 'لا فواتير', one: 'فاتورة واحدة', two: 'فاتورتان', few: 'فواتير', many: 'فاتورة' });

/** نص الحالة حسب عدد الأيام حتى الاستحقاق. */
export function dueLabel(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return 'بانتظار تاريخ';
  if (days < 0) return `متأخر ${ar(Math.abs(days))} يوماً`;
  if (days === 0) return 'مستحق اليوم';
  if (days <= 7) return `خلال ${ar(days)} أيام`;
  return `بعد ${ar(days)} يوماً`;
}

export function dueTone(days: number | null | undefined): 'red' | 'gold' | 'muted' {
  if (days == null || !Number.isFinite(days)) return 'muted';
  if (days < 0) return 'red';
  if (days <= 7) return 'gold';
  return 'muted';
}

export const STATUS: Record<string, { label: string; cls: string }> = {
  overdue:       { label: 'متأخر',        cls: 'red' },
  due_soon:      { label: 'خلال ٧ أيام',  cls: 'gold' },
  awaiting_date: { label: 'بانتظار تاريخ', cls: 'warn' },
  open:          { label: 'منتظم',        cls: 'ok' },
  clear:         { label: 'مسدد بالكامل', cls: 'ok' },
};
