import { parseNum } from '@/ui/format';
/** ميزانية من نص المستخدم (يقبل ١٢٣ و٬). فارغ → null؛ تالف → null مع رسالة في الواجهة. */
export function parseBudget(s: string): number | null {
  if (!s.trim()) return null;
  const v = parseNum(s);
  return v != null && Number.isFinite(v) && v >= 0 ? v : null;
}
