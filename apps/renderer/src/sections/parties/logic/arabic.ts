/* تطبيع عربي للمقارنة فقط (لا يُخزَّن ولا يُعرض) — نفس قواعد app/utils/arabic.py:
 * الهمزات، التاء المربوطة، الياء الفارسية، التشكيل، التطويل. الهدف: اقتراح مشروع
 * موجود («المدينة») بدل توأم صامت («المدينه») — SupplierForm.tsx:9-20,67-74 القديم. */
export function normalizeAr(s: string): string {
  if (!s) return '';
  return s.normalize('NFKC')
    .replace(/[ؗ-ًؚ-ْٰۖ-ۭ]/g, '')
    .replace(/ـ/g, '')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[يیى]/g, 'ي')
    .replace(/[کﻙﻚ]/g, 'ك')
    .replace(/[ةھه]/g, 'ه')
    .replace(/\s+/g, ' ')
    .trim();
}

/** مشروع معروف بإملاء مختلف — تطابق حرفي كامل ليس اقتراحاً. */
export function similarProject(typed: string, known: readonly string[]): string | null {
  const v = typed.trim();
  if (!v) return null;
  const key = normalizeAr(v);
  return known.find((p) => p !== v && normalizeAr(p) === key) ?? null;
}

/** لائحة المشاريع: الأول «الأساسي» (يُرسل أيضاً كـ project المفرد للمورد). */
export function addProject(list: readonly string[], p: string): string[] {
  const v = p.trim();
  return !v || list.includes(v) ? [...list] : [...list, v];
}
export const removeProject = (list: readonly string[], p: string): string[] => list.filter((x) => x !== p);
export const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);
