/* حساب بالهللات الصحيحة — الواجهة لا تحسب أرقاماً مالية جديدة؛ هذا فقط لما كانت الصفحات
 * القديمة تحسبه محلياً (مجموع التخصيص، أعمال الفترة، التأمين المقترح، تراكم الميزانية)
 * حتى لا يظهر انحراف ٠٫٠٠٠٠٠١ يجعل «متوازن» يبدو غير متوازن. */

/** قيمة رقمية من حقل نموذج: نص مكتوب، أو رقم من Field type=money، أو null للفارغ. */
export type NumIn = string | number | null | undefined;
export const isBlank = (v: NumIn) => v == null || (typeof v === 'string' && v.trim() === '');
/** رقم أو null للفارغ/التالف — للحقول الاختيارية. */
export const numOrNull = (v: NumIn): number | null => { if (isBlank(v)) return null; const x = parseAmount(v); return Number.isFinite(x) ? x : null; };

export const cents = (n: NumIn): number => {
  const v = typeof n === 'string' ? parseAmount(n) : Number(n ?? 0);
  return Number.isFinite(v) ? Math.round(v * 100) : 0;
};
export const fromCents = (c: number): number => c / 100;
export const sumCents = <T>(arr: readonly T[], f: (x: T) => NumIn): number =>
  fromCents(arr.reduce((a, x) => a + cents(f(x)), 0));
export const round2 = (v: number): number => fromCents(cents(v));

/** يقبل أرقاماً عربية-هندية وفواصل الآلاف (٬ ,) والفاصلة العشرية (٫). فارغ ← NaN. */
export function parseAmount(v: string | number | null | undefined): number {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  const s = v.replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)))
    .replace(/[,٬\s]/g, '').replace('٫', '.');
  return s === '' ? NaN : Number(s);
}
