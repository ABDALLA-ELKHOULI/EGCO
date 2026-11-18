/* المبالغ تصل نصوص Decimal ("125000.50"). هنا تحويل للعرض فقط ومقارنة بالهللات الصحيحة —
   لا جمع ولا طرح مالي في الواجهة (FRONTEND-CONTRACT §٠)؛ الجمع الوحيد إجمالي DataTable (sumHalalas). */
import type { Dec } from '../types';

/** نص Decimal → رقم للعرض؛ null يبقى null (غير معروف ≠ صفر). */
export function num(v: Dec | number | undefined): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
/** هللات صحيحة من نص Decimal دون المرور بفاصلة عائمة. */
export function halalas(v: Dec | number | undefined): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Math.round(v * 100);
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0'));
  return m[1] ? -h : h;
}
/** مقارنة بالهللة: >0 إن a أكبر. null إن أحدهما مجهول. */
export function cmp(a: Dec | number | undefined, b: Dec | number | undefined): number | null {
  const x = halalas(a), y = halalas(b);
  return x == null || y == null ? null : Math.sign(x - y);
}
/** رقم مُدخل (من Field type=money) → نص Decimal بمنزلتين للخادم. */
export function toDec(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n)) return null;
  return (Math.round(n * 100) / 100).toFixed(2);
}

/** إلى هللات صحيحة للجمع التراكمي — القيمة الغائبة تُعدّ صفراً هنا فقط لأن التراكمي
 *  يجمع أشهراً موجودة فعلاً؛ لا يُستعمل لعرض رقم مفقود. */
export function toH(v: Dec | number | undefined): number { return halalas(v) ?? 0; }
/** من هللات إلى ريال — مرة واحدة عند الحدّ. */
export function fromH(h: number): number { return Math.round(h) / 100; }
