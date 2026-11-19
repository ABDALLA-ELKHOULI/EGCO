/**
 * الموازنة التقديرية (خطة شهرية) في شاشة الرفع — معاينة مقروءة قبل الحفظ، وتأكيد
 * إنشاء المشروع إن لم يكن في السجل. كل رقم من الخادم كما هو (Decimal نصي)؛ لا
 * حساب هنا — `Number()` للعرض فقط.
 */
import { useState } from 'react';
import { Button, Money, Num, Pill, usePrefs } from '@/ui';
import { errMsg } from '../api';
import type { BudgetPlanPreview, ImportPayload } from '../types';
import { Callout } from './parts';

const n = (s: string | null | undefined) => (s == null ? null : Number(s));
const pct = (s: string | null | undefined) => (s == null ? '—' : `${(Number(s) * 100).toFixed(2)}٪`);

export const isBudgetPlan = (p: ImportPayload | undefined | null): p is BudgetPlanPreview =>
  !!p && p.kind === 'budget_plan' && Array.isArray(p.months);

export function BudgetPlanSummary({ data }: { data: BudgetPlanPreview }) {
  usePrefs();
  const [open, setOpen] = useState(false);
  const failed = data.check.filter((c) => c.ok === false);
  const a = data.assumptions;
  return (
    <div className="sumline">
      <p className="sumline">
        <b>مشروع {data.project}</b>
        <span className="cap"> · الفترة: {data.period || `${data.firstMonth} ← ${data.lastMonth}`} · <Num value={data.monthCount} int /> شهراً</span>
        {' '}{data.projectExists ? <Pill tone="ok">المشروع موجود</Pill> : <Pill tone="warn">مشروع جديد</Pill>}
        {' '}<Pill tone={data.existing.status === 'identical' ? 'neutral' : data.existing.status === 'changed' ? 'warn' : 'ok'}>
          {data.existing.status === 'identical' ? 'مطابق مسبقاً' : data.existing.status === 'changed' ? 'سيستبدل الخطة المحفوظة' : 'خطة جديدة'}
        </Pill>
      </p>
      <p className="cap sumline">
        قيمة العقد شامل الضريبة <Money value={n(data.contract.inclVat)} /> · بدون الضريبة <Money value={n(data.contract.exclVat)} />
        {data.contract.durationMonths != null && <> · مدة التنفيذ <Num value={data.contract.durationMonths} int /> شهراً</>}
      </p>
      <p className="cap sumline">
        الفروض: دفعة مقدمة <Money value={n(a.advancePayment)} /> · فورمة ألمنيوم <Money value={n(a.aluminiumFormwork)} />
        {' '}· خصم الدفعة المقدمة {pct(a.advanceRate)} · حسن الأداء {pct(a.retentionRate)} · المواد {pct(a.materialsRate)}
        {a.vatFactor ? <> · معامل الضريبة <span className="num ltr">{a.vatFactor}</span></> : null}
      </p>
      {failed.length === 0
        ? <Callout tone="ok">مجموع الأشهر يطابق صف «الاجمالى» في كل الأعمدة (<Num value={data.check.length} int /> عموداً) — بفرق لا يتجاوز هللة.</Callout>
        : <Callout tone="bad">لا يطابق: {failed.map((c) => `${c.label} (الفرق ${c.diff})`).join('، ')}</Callout>}
      {!data.projectExists && data.projectMessage && <Callout tone="warn">{data.projectMessage}</Callout>}
      <details className="errs" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
        <summary>الأشهر (<Num value={data.monthCount} int />) — المخطط وصافي المبلغ المحوّل</summary>
        {open && (
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>#</th><th>الشهر</th><th className="n">الإنجاز المتوقع</th>
                <th className="n">المخطط بدون الضريبة</th><th className="n">شامل الضريبة</th><th className="n">صافي المبلغ المحوّل</th>
              </tr></thead>
              <tbody>
                {data.months.map((m) => (
                  <tr key={m.month}>
                    <td className="num">{m.seq}</td>
                    <td>{m.label} <span className="cap num ltr">{m.month}</span></td>
                    <td className="n num">{pct(m.completionPct)}</td>
                    <td className="n"><Money value={n(m.plannedExclVat)} /></td>
                    <td className="n"><Money value={n(m.plannedInclVat)} /></td>
                    <td className="n"><Money value={n(m.netTransfer)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr>
                <th /><th>الاجمالى (من الملف)</th>
                <th className="n num">{pct(data.totals.completion_pct)}</th>
                <th className="n"><Money value={n(data.totals.planned_excl_vat)} /></th>
                <th className="n"><Money value={n(data.totals.planned_incl_vat)} /></th>
                <th className="n"><Money value={n(data.totals.net_transfer)} /></th>
              </tr></tfoot>
            </table>
          </div>
        )}
      </details>
    </div>
  );
}

/** المشروع غير موجود — لا شيء يُحفظ حتى يؤكد المستخدم إنشاءه (مثل إنشاء المورد). */
export function NeedsProjectPanel({ data, onConfirm, onDecline }: {
  data: ImportPayload; onConfirm: () => Promise<void>; onDecline: () => void;
}) {
  usePrefs();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);
  const project = String(data.project ?? '—');
  if (declined) return <p className="cap">لم يُحفظ شيء — لم يُنشأ المشروع</p>;
  return (
    <Callout tone="warn">
      <b>المشروع «{project}» غير موجود في سجل المشاريع</b>
      <div className="cap">لم يُحفظ شيء. أكّد إنشاء المشروع لتُحفظ خطته الشهرية، أو تجاهل الملف.</div>
      {err && <Callout tone="bad">{err}</Callout>}
      <div className="rowacts">
        <Button kind="primary" size="sm" disabled={busy} onClick={async () => {
          setBusy(true); setErr(null);
          try { await onConfirm(); } catch (e) { setErr(errMsg(e)); setBusy(false); }
        }}>{busy ? 'جارٍ الحفظ…' : `إنشاء مشروع «${project}» وحفظ الخطة`}</Button>
        <Button size="sm" disabled={busy} onClick={() => { setDeclined(true); onDecline(); }}>تجاهل هذا الملف</Button>
      </div>
    </Callout>
  );
}
