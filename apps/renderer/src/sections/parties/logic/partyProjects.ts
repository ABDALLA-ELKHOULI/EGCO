/* م-٥٠ · مشاريع الطرف بمبالغ — تعديل متفائل نقي (القسم يعرض فوراً ثم يعيد الجلب من الخادم). */
import type { PartyProject, PartyProjectBody } from '../types';
import { cents, fromCents, isBlank, parseAmount, type NumIn } from './money';
import { similarProject } from './arabic';

export function upsertProject(list: readonly PartyProject[], project: string, b: PartyProjectBody): PartyProject[] {
  const i = list.findIndex((p) => p.project === project);
  if (i < 0) return [...list, { project, amount: b.amount, notes: b.notes ?? null, executed: 0, paid: 0, open: 0 }];
  const next = [...list];
  next[i] = { ...next[i], amount: b.amount, notes: b.notes ?? next[i].notes };
  return next;
}
export const removeProjectRow = (list: readonly PartyProject[], project: string) => list.filter((p) => p.project !== project);

/** مجموع المُسند — للعرض فقط حين لا يرسل الخادم totalAmount؛ null ← لا يدخل الجمع (لا صفر مخترع). */
export function assignedTotal(list: readonly PartyProject[]) {
  const withAmount = list.filter((p) => p.amount != null);
  return { total: fromCents(withAmount.reduce((a, p) => a + cents(p.amount), 0)), withoutAmount: list.length - withAmount.length };
}

/** المنفّذ مقابل المُسند لكل مشروع — نسبة للعرض فقط؛ بلا مبلغ ← null. */
export const executedPct = (p: PartyProject) => (p.amount && p.amount > 0 ? Math.round((p.executed / p.amount) * 100) : null);

export interface PartyProjectForm { project: string; amount: NumIn; notes: string }
export function validatePartyProject(v: PartyProjectForm, existing: readonly string[], known: readonly string[], isEdit: boolean):
  { field: keyof PartyProjectForm; msg: string; suggest?: string } | null {
  const p = v.project.trim();
  if (!p) return { field: 'project', msg: 'اختر المشروع' };
  if (!isEdit && existing.includes(p)) return { field: 'project', msg: 'الطرف مُسند لهذا المشروع أصلاً — عدّل مبلغه بدل إضافته مرتين' };
  if (!isEdit && !known.includes(p)) {
    const s = similarProject(p, known);
    if (s) return { field: 'project', msg: `يوجد مشروع مشابه «${s}» — اختره بدل إنشاء توأم`, suggest: s };
  }
  if (!isBlank(v.amount)) {
    const a = parseAmount(v.amount);
    if (!(a >= 0)) return { field: 'amount', msg: 'المبلغ رقم موجب أو اتركه فارغاً' };
  }
  return null;
}
export const partyProjectBody = (v: PartyProjectForm): PartyProjectBody => ({
  amount: isBlank(v.amount) ? null : fromCents(cents(v.amount)), notes: v.notes.trim() || null,
});
