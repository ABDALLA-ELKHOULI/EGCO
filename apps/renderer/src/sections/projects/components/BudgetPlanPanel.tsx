/**
 * «الخطة التقديرية» — الخطة الشهرية من ملف الموازنة التقديرية، والفعلي بجانبها
 * فقط حيث توجد لقطة موازنة فعلية لنفس الشهر. الإجماليات صف «الاجمالى» كما في
 * الملف (من الخادم)، لا جمع في المتصفح. الأحمر للمتأخر فقط.
 */
import { useEffect, useState } from 'react';
import { Button, EmptyState, Island, Money, Pill, Skeleton, usePrefs } from '@/ui';
import { useBudgetPlan, useBudgetPlans } from '../hooks';
import { ErrorBox } from './bits';
import { paths, useNav } from '../nav';

const n = (s: string | null | undefined) => (s == null ? null : Number(s));
const pct = (s: string | null | undefined) => (s == null ? '—' : `${(Number(s) * 100).toFixed(2)}٪`);

export function BudgetPlanPanel({ preferred, i }: { preferred?: string; i?: number }) {
  usePrefs();
  const go = useNav();
  const list = useBudgetPlans();
  const plans = list.data ?? [];
  const [sel, setSel] = useState<string>('');
  useEffect(() => {
    if (!plans.length) return;
    const match = preferred ? plans.find((p) => p.project === preferred) : undefined;
    if (match) setSel(match.project);
    else if (!sel || !plans.some((p) => p.project === sel)) setSel(plans[0].project);
  }, [plans, preferred]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = useBudgetPlan(sel || null);
  const d = q.data;

  if (list.error) return <div className="c12"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>;
  if (!list.data) return null;
  if (!plans.length) {
    return (
      <Island span={12} i={i} title="الخطة التقديرية">
        <EmptyState icon="inbox" title="لا توجد خطة تقديرية بعد"
          body="ارفع ملف «موازنة تقديرية — شركة …» من «رفع الملفات» لتظهر الخطة الشهرية هنا."
          cta="رفع الملفات" onCta={() => go(paths.imports)} />
      </Island>
    );
  }
  const totals = d?.totals ?? {};
  const avp = d?.actualVsPlan;
  return (
    <Island span={12} i={i} title={<>الخطة التقديرية{d ? ` — ${d.project}` : ''}</>}
      actions={plans.length > 1 ? (
        <label className="sp-filters"><span className="cap">المشروع</span>
          <select value={sel} onChange={(e) => setSel(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.project}>{p.project}</option>)}
          </select></label>
      ) : undefined}>
      {q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton rows={6} /> : (
        <div className="sp-stack">
          <p className="cap">
            الفترة: {d.period || `${d.startMonth} ← ${d.endMonth}`} · قيمة العقد شامل الضريبة <Money value={n(d.contract.inclVat)} />
            {' '}· بدون الضريبة <Money value={n(d.contract.exclVat)} />
            {d.contract.durationMonths != null && <> · {d.contract.durationMonths} شهراً</>}
            {d.sourceFile && <> · من ملف «{d.sourceFile}»</>}
          </p>
          {avp && avp.monthsWithActual > 0 ? (
            <p className="cap">
              الفعلي مقابل المخطط ({avp.monthsWithActual} شهر له لقطة فعلية): الفعلي <Money value={n(avp.actualExclVat)} />
              {' '}مقابل مخطط <Money value={n(avp.plannedExclVat)} /> — الفرق{' '}
              <Money value={n(avp.deviation)} className={Number(avp.deviation) < 0 ? 't-warn' : 't-ok'} />
            </p>
          ) : (
            <p className="cap">لا لقطة موازنة فعلية لأي شهر من أشهر الخطة بعد — عمود «الفعلي» يبقى فارغاً حتى تُرفع تقارير الانحراف الشهرية.</p>
          )}
          <div className="tbl-wrap">
            <table>
              <thead><tr>
                <th>الشهر</th><th className="n">الإنجاز المتوقع</th>
                <th className="n">المخطط بدون الضريبة</th><th className="n">شامل الضريبة</th>
                <th className="n">خصم الدفعة المقدمة</th><th className="n">خصم حسن الأداء</th><th className="n">خصم المواد</th>
                <th className="n">صافي المبلغ المحوّل</th>
                <th className="n">الفعلي (بدون الضريبة)</th><th className="n">الفرق</th>
              </tr></thead>
              <tbody>
                {d.months.map((m) => {
                  const late = m.deviation != null && Number(m.deviation) < 0;
                  return (
                    <tr key={m.month}>
                      <td>{m.label} <span className="cap num ltr">{m.month}</span></td>
                      <td className="n num">{pct(m.completionPct)}</td>
                      <td className="n"><Money value={n(m.plannedExclVat)} /></td>
                      <td className="n"><Money value={n(m.plannedInclVat)} /></td>
                      <td className="n"><Money value={n(m.advanceDeduction)} /></td>
                      <td className="n"><Money value={n(m.retentionDeduction)} /></td>
                      <td className="n"><Money value={n(m.materialsDeduction)} /></td>
                      <td className="n"><Money value={n(m.netTransfer)} /></td>
                      <td className="n">{m.hasActual ? <Money value={n(m.actualExclVat)} /> : <span className="dash">—</span>}</td>
                      <td className="n">{m.hasActual
                        ? <><Money value={n(m.deviation)} className={late ? 't-danger' : 't-ok'} />{late && <> <Pill tone="danger">متأخر</Pill></>}</>
                        : <span className="dash">—</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot><tr>
                <th>الاجمالى (من الملف)</th>
                <th className="n num">{pct(totals.completion_pct)}</th>
                <th className="n"><Money value={n(totals.planned_excl_vat)} /></th>
                <th className="n"><Money value={n(totals.planned_incl_vat)} /></th>
                <th className="n"><Money value={n(totals.advance_deduction)} /></th>
                <th className="n"><Money value={n(totals.retention_deduction)} /></th>
                <th className="n"><Money value={n(totals.materials_deduction)} /></th>
                <th className="n"><Money value={n(totals.net_transfer)} /></th>
                <th className="n">{avp && avp.monthsWithActual > 0 ? <Money value={n(avp.actualExclVat)} /> : <span className="dash">—</span>}</th>
                <th className="n">{avp && avp.monthsWithActual > 0 ? <Money value={n(avp.deviation)} /> : <span className="dash">—</span>}</th>
              </tr></tfoot>
            </table>
          </div>
          <p className="cap">الإجمالي هو صف «الاجمالى» في الملف بالهللة؛ أرقام الأشهر مقرَّبة للهللة كلٌّ على حدة، فقد يختلف جمعها يدوياً عن الإجمالي بهللات قليلة.</p>
          <div className="rowacts"><Button size="sm" kind="ghost" onClick={() => go(paths.project(d.project))}>صفحة المشروع</Button></div>
        </div>
      )}
    </Island>
  );
}
