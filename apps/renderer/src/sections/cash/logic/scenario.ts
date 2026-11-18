/**
 * محرّك «ماذا لو؟» — العملية الحسابية الوحيدة في الواجهة.
 *
 * المبدأ: لا نعيد بناء الإسقاط من الصفر. خط الأساس هو فترات الخادم كما هي (`periods`
 * بأرصدتها)، والسيناريو «فروق» تُطبَّق فوقها:
 *   - تأجيل بند مجدول N يوماً: يُطرح من فترته ويُضاف لفترة تاريخه الجديد (أو يخرج من الأفق).
 *   - سداد بند متأخر في تاريخ: المتأخر خارج الرصيد التراكمي على الخادم؛ يدخل فترته الآن.
 *   - تحصيل افتراضي: يُضاف للداخل في فترة تاريخه.
 * ثم يُعاد حساب الرصيد التراكمي من الرصيد الافتتاحي. بلا سيناريو، الناتج = الخادم بالهللة
 * (يُتحقَّق منه في `assertBaselineMatches`) — أي انحراف يُعرض لا يُبتلع.
 */
import type { BreakdownRow, CashPeriod } from '../types';
import { isContractorRow, isReceivableRow, isSupplierRow } from '../types';
import { setUiPref, uiPref } from '@/ui/prefs';
import { addH, fromH, isoAddDays, subH, toH, ZERO_H, type Halalas } from './money';

/* ─── بنود قابلة للتحريك ─── */
export type ItemDir = 'in' | 'out';
export interface CashItem {
  key: string;          // مفتاح ثابت عبر الطلبات (انظر itemKey)
  dir: ItemDir;
  kind: 'supplier' | 'contractor' | 'receivable';
  party: string;
  partyRef: string;     // حساب المورد / كود المقاول / اسم العميل — للتنقّل
  doc: string;
  project: string | null;
  date: string | null;  // تاريخ الاستحقاق
  amount: number;
  overdue: boolean;
}

/**
 * مفتاح البند. صفوف breakdown لا تحمل `id` بعد (انظر PARITY-cash.md · ثغرات الخادم)،
 * فنركّب مفتاحاً من الحقول المميِّزة. تكرار نادر (فاتورتان بنفس الرقم والتاريخ) يُفصل
 * بلاحقة ترتيبية في `toItems`.
 */
export function itemKey(r: BreakdownRow): string {
  if (isSupplierRow(r)) return `inv:${r.account}:${r.invoiceNumber}:${r.dueDate ?? '-'}`;
  if (isContractorRow(r)) return `con:${r.contractorCode}:${r.project ?? '-'}:${r.releaseDue ?? '-'}`;
  return `rcv:${r.client}:${r.project ?? '-'}:${r.date}:${r.amount}`;
}

export function toItems(rows: readonly BreakdownRow[], dir: ItemDir, overdue: boolean): CashItem[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    let key = itemKey(r);
    const n = seen.get(key) ?? 0; seen.set(key, n + 1);
    if (n) key += `#${n}`;
    if (isSupplierRow(r)) return { key, dir, kind: 'supplier', party: r.supplierName, partyRef: r.account, doc: `فاتورة ${r.invoiceNumber}`, project: null, date: r.dueDate, amount: r.amount, overdue };
    if (isContractorRow(r)) return { key, dir, kind: 'contractor', party: r.contractorName, partyRef: r.contractorCode, doc: 'ضمان/مستحق', project: r.project, date: r.releaseDue, amount: r.amount, overdue };
    if (isReceivableRow(r)) return { key, dir, kind: 'receivable', party: r.client, partyRef: r.client, doc: '', project: r.project, date: r.date, amount: r.amount, overdue };
    throw new Error('صف تفصيل بشكل غير معروف');
  });
}

/* ─── تعديلات السيناريو ─── */
export type Tweak =
  | { id: string; kind: 'delay'; key: string; days: number; label: string }
  | { id: string; kind: 'settleOverdue'; key: string; date: string; label: string }
  | { id: string; kind: 'inflow'; date: string; amount: number; label: string };

export interface ScenarioPeriod extends CashPeriod {
  /** الرصيد الأصلي من الخادم — يُرسم متقطعاً بجانب السيناريو */
  baseBalance: number;
  /** البنود التي حرّكها السيناريو إلى/من هذه الفترة (للتلميح والتفصيل) */
  moved: { key: string; label: string; dir: ItemDir; delta: number }[];
}

export interface ScenarioResult {
  periods: ScenarioPeriod[];
  totalInflow: number;
  totalOutflow: number;
  netTotal: number;
  minBalance: number;
  minIndex: number;
  firstDeficitIndex: number; // -1 = لا عجز
  endBalance: number;
  baseEndBalance: number;
  /** ما دفعه السيناريو خارج نهاية الأفق — يظهر في المطابقة كـ«بعد نهاية الأفق» إضافي */
  pushedBeyond: { out: number; in: number };
  /** تعديلات لم تُطبَّق (بند لم يعد موجوداً بعد تغيير الفلتر) — تُعرض لا تُتجاهل */
  skipped: Tweak[];
}

export function periodIndexOf(periods: readonly CashPeriod[], iso: string): number {
  // الفترات متجاورة ومرتبة — بحث خطي كافٍ (≤ ٧٢٨ فترة نظرياً، عملياً ≤ ١٠٤)
  for (let i = 0; i < periods.length; i++) if (iso >= periods[i].from && iso <= periods[i].to) return i;
  return iso < (periods[0]?.from ?? '') ? -1 : periods.length; // -1 قبل الأفق · length بعده
}

export function applyScenario(
  periods: readonly CashPeriod[],
  openingBalance: number,
  /** scheduled = الخارج المجدول + الداخل المتوقع داخل الأفق؛ overdue = المتأخر خارج الرصيد */
  items: { scheduled: readonly CashItem[]; overdue: readonly CashItem[] },
  tweaks: readonly Tweak[],
): ScenarioResult {
  const inH: Halalas[] = periods.map((p) => toH(p.inflow));
  const outH: Halalas[] = periods.map((p) => toH(p.outflow));
  const moved: ScenarioPeriod['moved'][] = periods.map(() => []);
  const byKey = new Map<string, CashItem>();
  for (const it of items.scheduled) byKey.set(it.key, it);
  const overdueByKey = new Map<string, CashItem>();
  for (const it of items.overdue) overdueByKey.set(it.key, it);
  let beyondOut = ZERO_H, beyondIn = ZERO_H;
  const skipped: Tweak[] = [];

  const put = (idx: number, dir: ItemDir, h: Halalas, key: string, label: string) => {
    if (idx >= periods.length) { if (dir === 'out') beyondOut = addH(beyondOut, h); else beyondIn = addH(beyondIn, h); return; }
    const i = Math.max(0, idx); // قبل الأفق ⇒ أول فترة (يُدفع/يُحصَّل اليوم)
    if (dir === 'out') outH[i] = addH(outH[i], h); else inH[i] = addH(inH[i], h);
    moved[i].push({ key, label, dir, delta: fromH(h) });
  };

  // تأجيلات متعددة على نفس البند تتراكم — كما في النموذج المعتمد
  const delays = new Map<string, number>();
  for (const t of tweaks) if (t.kind === 'delay') delays.set(t.key, (delays.get(t.key) ?? 0) + t.days);

  for (const [key, days] of delays) {
    const it = byKey.get(key);
    const tw = tweaks.find((t) => t.kind === 'delay' && t.key === key) as Extract<Tweak, { kind: 'delay' }>;
    if (!it || !it.date) { skipped.push(tw); continue; }
    const from = periodIndexOf(periods, it.date);
    if (from < 0 || from >= periods.length) { skipped.push(tw); continue; }
    const h = toH(it.amount);
    if (it.dir === 'out') outH[from] = subH(outH[from], h); else inH[from] = subH(inH[from], h);
    moved[from].push({ key, label: tw.label, dir: it.dir, delta: -it.amount });
    put(periodIndexOf(periods, isoAddDays(it.date, days)), it.dir, h, key, tw.label);
  }
  for (const t of tweaks) {
    if (t.kind === 'settleOverdue') {
      const it = overdueByKey.get(t.key);
      if (!it) { skipped.push(t); continue; }
      put(periodIndexOf(periods, t.date), it.dir, toH(it.amount), t.key, t.label);
    } else if (t.kind === 'inflow') {
      if (!(t.amount > 0)) { skipped.push(t); continue; }
      put(periodIndexOf(periods, t.date), 'in', toH(t.amount), t.id, t.label);
    }
  }

  let bal = toH(openingBalance);
  let min = Number.POSITIVE_INFINITY, minIndex = 0, firstNeg = -1;
  let totIn = ZERO_H, totOut = ZERO_H;
  const out: ScenarioPeriod[] = periods.map((p, i) => {
    const net = subH(inH[i], outH[i]);
    bal = addH(bal, net); totIn = addH(totIn, inH[i]); totOut = addH(totOut, outH[i]);
    if (bal < min) { min = bal; minIndex = i; }
    if (bal < 0 && firstNeg < 0) firstNeg = i;
    return {
      ...p, inflow: fromH(inH[i]), outflow: fromH(outH[i]), net: fromH(net), balance: fromH(bal),
      deficit: bal < 0, baseBalance: p.balance, moved: moved[i],
    };
  });
  return {
    periods: out, totalInflow: fromH(totIn), totalOutflow: fromH(totOut), netTotal: fromH(subH(totIn, totOut)),
    minBalance: periods.length ? fromH(min) : openingBalance, minIndex, firstDeficitIndex: firstNeg,
    endBalance: fromH(bal), baseEndBalance: periods.length ? periods[periods.length - 1].balance : openingBalance,
    pushedBeyond: { out: fromH(beyondOut), in: fromH(beyondIn) }, skipped,
  };
}

/**
 * حارس: بلا تعديلات يجب أن يعيد المحرّك أرصدة الخادم بالهللة. إن لم يفعل فالخطأ في
 * فهمنا للاستجابة — نُرجع أول فترة مختلفة كي تعرضها الواجهة كتحذير لا أن تُخفيها.
 */
export function assertBaselineMatches(periods: readonly CashPeriod[], openingBalance: number): number | null {
  const r = applyScenario(periods, openingBalance, { scheduled: [], overdue: [] }, []);
  for (let i = 0; i < periods.length; i++) if (toH(r.periods[i].balance) !== toH(periods[i].balance)) return i;
  return null;
}

/* ─── حفظ السيناريو — تفضيل واجهة (uiPref، العقد §٦)، لا بيانات مالية: لا يكتب شيئاً في القاعدة ─── */
const SCN_KEY = 'cash.scenario';
export function loadScenario(): Tweak[] | null {
  const v = uiPref<unknown>(SCN_KEY, null);
  return Array.isArray(v) && v.length ? (v as Tweak[]) : null;
}
export function saveScenario(t: readonly Tweak[] | null): void {
  setUiPref(SCN_KEY, t && t.length ? t : null);
}
