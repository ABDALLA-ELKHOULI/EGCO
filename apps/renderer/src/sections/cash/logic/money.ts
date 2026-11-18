/**
 * حساب بالهللات (أعداد صحيحة) للسيناريو فقط. الخادم يحسب بـ Decimal ويقرّب مرة واحدة؛
 * هنا نحوّل كل مبلغ قادم إلى هللات مرة واحدة ونجمع أعداداً صحيحة — فلا انحراف عشري
 * يجعل «الأصل» المعروض بجانب السيناريو يختلف عن رقم الخادم بهللة.
 */
export type Halalas = number & { readonly __h: unique symbol };

export const toH = (sar: number): Halalas => Math.round((Number.isFinite(sar) ? sar : 0) * 100) as Halalas;
export const fromH = (h: Halalas | number): number => h / 100;
export const addH = (a: Halalas, b: Halalas): Halalas => (a + b) as Halalas;
export const subH = (a: Halalas, b: Halalas): Halalas => (a - b) as Halalas;
export const ZERO_H = 0 as Halalas;
export const sumH = <T>(rows: readonly T[], get: (r: T) => number): Halalas =>
  rows.reduce<Halalas>((acc, r) => addH(acc, toH(get(r))), ZERO_H);

/* ─── تواريخ ISO (yyyy-mm-dd) — بالتوقيت العالمي كي لا يزيح التوقيت الصيفي يوماً ─── */
export function isoAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const t = Date.UTC(y, (m ?? 1) - 1, d ?? 1) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}
export function isoDiffDays(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return Date.UTC(y, (m ?? 1) - 1, d ?? 1); };
  return Math.round((p(a) - p(b)) / 86_400_000);
}
export const todayIso = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
