/* وثيقة الموازنة الرسمية للطباعة/PDF (P-188..P-191) — منقولة من Budget.tsx:852-1067 بمكوّنات @/ui. */
import { useState } from 'react';
import { api, type BudgetMonth, type BudgetProject, type BudgetResponse } from '@/lib/api';
import { useAiEnabled } from '@/lib/useAi';
import { Button, PageHeader, dateTxt, digits, fmt, int, usePrefs } from '@/ui';
import { cumTone, monthTone } from '../logic/budget';
import { DeltaArrow } from './bits';

const cls = (t: string) => (t === 'ok' ? 't-ok' : t === 'red' ? 't-warn' : '');
const pct = (x: number | null | undefined) => (x == null ? '—' : `${digits((x * 100).toFixed(1))}٪`);

function coveredRange(d: BudgetResponse): string {
  const ms = d.projects.flatMap((p) => p.months.map((m) => m.month)).sort();
  if (!ms.length) return '—';
  return ms[0] === ms[ms.length - 1] ? dateTxt(ms[0], { year: true }) : `${dateTxt(ms[0], { year: true })} ← ${dateTxt(ms[ms.length - 1], { year: true })}`;
}

export function BudgetDoc({ d, onBack }: { d: BudgetResponse; onBack: () => void }) {
  usePrefs();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  async function exportPdf() {
    if (!window.egco?.exportPdf) { window.print(); return; }
    setBusy(true); setErr(null);
    const r = await window.egco.exportPdf({ filename: `EGCO-موازنة-${stamp}.pdf` });
    setBusy(false);
    if (r.error) setErr(r.error);
  }

  return (
    <>
      <div className="no-print">
        <PageHeader title="تقرير الموازنة التقديرية" sub="جاهز للطباعة أو الحفظ بصيغة PDF"
          crumb={{ label: '‹ الموازنة', onClick: onBack }}
          actions={<Button kind="primary" disabled={busy} onClick={() => void exportPdf()}>{busy ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}</Button>} />
        {err && <p className="sp-err">{err}</p>}
      </div>
      <div className="sheet budget-doc paper">
        <header className="rpt-head"><div><b>شركة إعمار الخليج المصرية للمقاولات</b><span>الإدارة المالية</span></div></header>
        <hr className="rule-ink" />
        <h1 className="rpt-title">تقرير الموازنة التقديرية</h1>
        <p className="rpt-sub">الفترة المغطاة: {coveredRange(d)} · جميع الأرقام بالريال السعودي</p>
        <div className="rpt-meta">
          <div><span>تاريخ الإصدار</span><b>{dateTxt(stamp, { year: true })}</b></div>
          <div><span>عدد المشاريع</span><b>{int(d.projects.length)}</b></div>
          <div><span>أساس الاحتساب</span><b>تقارير الانحراف الشهرية</b></div>
          <div><span>التصنيف</span><b>وثيقة داخلية</b></div>
        </div>
        <hr />
        {d.projects.map((p, i) => <ProjectSection key={p.project} p={p} index={i} />)}
        <div className="rpt-foot">
          <hr />
          <div className="signs"><div>إعداد — الإدارة المالية</div><div>مراجعة — المدير المالي</div><div>اعتماد — الإدارة التنفيذية</div></div>
          <p className="cap">وثيقة داخلية · تقرير الموازنة التقديرية · {dateTxt(stamp, { year: true })}</p>
        </div>
      </div>
    </>
  );
}

function ProjectSection({ p, index }: { p: BudgetProject; index: number }) {
  const latest = p.latest ?? p.months[p.months.length - 1] ?? null;
  if (!latest) return null;
  const max = Math.max(latest.cumActual, latest.cumPlanned, 1);
  return (
    <section className="budget-doc-project">
      <div className="rpt-section">
        <div><span className="badge">{digits(String(index + 1).padStart(2, '0'))}</span><b>مشروع {p.project}</b></div>
        <p>آخر تقرير: {dateTxt(latest.month, { year: true })}{latest.serial ? ` · تقرير رقم ${digits(latest.serial)}` : ''}
          {latest.issuedOn ? ` · صدر ${dateTxt(latest.issuedOn, { year: true })}` : ''}</p>
      </div>
      <div className="rpt-kpis sp-kpis5">
        <DocKpi label="الفعلي للشهر" value={fmt(latest.actualMonth)} />
        <DocKpi label="المخطط للشهر" value={fmt(latest.plannedMonth)} />
        <DocKpi label="انحراف الشهر" value={fmt(latest.deviationMonth)} cls={cls(monthTone(latest.deviationMonth))} />
        <DocKpi label="نسبة التأخر" value={pct(latest.delayPct)} cls={cls(cumTone(latest.delayPct))} unit="" />
        <DocKpi label="نسبة الإنجاز" value={pct(latest.completionPct)} unit="" />
      </div>
      <MonthsTable months={p.months} />
      <div className="sp-docbars">
        <div className="cap">التراكمي: الفعلي {fmt(latest.cumActual)} مقابل المخطط {fmt(latest.cumPlanned)} ر.س</div>
        <DocBar label="الفعلي" value={latest.cumActual} max={max} gold />
        <DocBar label="المخطط" value={latest.cumPlanned} max={max} />
      </div>
      {latest.claims.length > 0 && (<>
        <b className="sp-doc-h">مستخلصات الشهر الأخير</b>
        <table className="rpt-table"><thead><tr><th>المستخلص</th><th className="ltr">المبلغ (ر.س)</th><th>التاريخ</th></tr></thead>
          <tbody>{latest.claims.map((c, i) => {
            const pending = !c.amount || !c.date;
            return (<tr key={c.no + i}><td className="num">{digits(c.no)}</td>
              <td className="ltr num">{pending ? 'لم يصدر بعد' : fmt(c.amount)}</td>
              <td>{c.date ? dateTxt(c.date, { year: true }) : 'لم يصدر بعد'}</td></tr>);
          })}</tbody></table>
      </>)}
      <NotesSection project={p.project} initial={latest.notes} />
    </section>
  );
}

/** نص المستخدم يفوز؛ مسودة الذكاء تكتب فوق الحقل لحظة الضغط فقط ولا تُحفظ تلقائياً. */
function NotesSection({ project, initial }: { project: string; initial: string | null }) {
  const [notes, setNotes] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const { enabled, loading } = useAiEnabled();
  async function draft() {
    setBusy(true); setErr(null);
    try { setNotes((await api.aiBudgetNotes(project)).notes); }
    catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  }
  return (
    <div className="rpt-notes">
      <div className="ih"><b>ملاحظات مالية</b>
        {!loading && enabled && <Button size="sm" className="no-print" disabled={busy} onClick={() => void draft()}>
          {busy ? 'جارٍ الصياغة…' : 'مسودة بالذكاء الاصطناعي'}</Button>}</div>
      {err && <p className="sp-err no-print">{err}</p>}
      <textarea className="sp-notes" rows={4} value={notes} aria-label={`ملاحظات مالية — ${project}`}
        onChange={(e) => setNotes(e.target.value)} placeholder="ملاحظات مالية عن هذا المشروع…" />
    </div>
  );
}

function MonthsTable({ months }: { months: BudgetMonth[] }) {
  if (!months.length) return null;
  return (
    <table className="rpt-table">
      <thead><tr><th>الشهر</th><th className="ltr">الفعلي (ر.س)</th><th className="ltr">المخطط (ر.س)</th><th className="ltr">الانحراف (ر.س)</th>
        <th className="ltr">نسبة التأخر</th><th className="ltr">نسبة الإنجاز</th><th className="ltr">الاتجاه</th></tr></thead>
      <tbody>{months.map((m) => (
        <tr key={m.month}>
          <td>{dateTxt(m.month, { year: true })}</td>
          <td className="ltr num">{fmt(m.actualMonth)}</td><td className="ltr num">{fmt(m.plannedMonth)}</td>
          <td className={'ltr num ' + cls(monthTone(m.deviationMonth))}>{fmt(m.deviationMonth)}</td>
          <td className={'ltr num ' + cls(cumTone(m.delayPct))}>{pct(m.delayPct)}</td>
          <td className="ltr num">{pct(m.completionPct)}</td>
          <td className="ltr"><DeltaArrow deltaPp={m.delayDeltaPp} /></td>
        </tr>))}</tbody>
    </table>
  );
}

const DocKpi = ({ label, value, cls: c, unit = 'ر.س' }: { label: string; value: string; cls?: string; unit?: string }) => (
  <div className="rpt-kpi"><span>{label}</span><b className={'num ' + (c || '')}>{value}</b>{unit && <i>{unit}</i>}</div>
);
const DocBar = ({ label, value, max, gold }: { label: string; value: number; max: number; gold?: boolean }) => (
  <div className="budget-doc-bar"><span>{label}</span>
    <div className="track"><div className={'fill' + (gold ? ' gold' : '')} style={{ width: `${Math.max((value / max) * 100, 0)}%` }} /></div>
    <span className="num amount">{fmt(value)} ر.س</span></div>
);
