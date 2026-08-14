import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError, type BudgetMonth, type BudgetProject, type BudgetResponse } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, Kpi, Money, Pill, State } from '@/components/ui';
import { useAiEnabled } from '@/lib/useAi';
import type { PickedFile } from '@/types/global';

/** نتيجة رفع دفعة ملفات موازنة — تُجمع من ردود الخادم لكل ملف. */
interface UploadOutcome {
  ok: boolean;
  message: string;
  details?: string[];
}

/** الموازنة التقديرية — تقرير الانحراف الشهري لكل مشروع. */
export function Budget() {
  const nav = useNavigate();
  const [d, setD] = useState<BudgetResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [docMode, setDocMode] = useState(false);

  const load = useCallback(() => {
    api.budget().then(setD).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function upload() {
    setOutcome(null);
    if (!window.egco?.pickFiles) {
      setOutcome({
        ok: false,
        message: 'اختيار الملفات متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.',
      });
      return;
    }
    let picked: PickedFile[] = [];
    try {
      picked = await window.egco.pickFiles();
    } catch (e: any) {
      setOutcome({ ok: false, message: `تعذّر فتح نافذة اختيار الملفات: ${e?.message ?? e}` });
      return;
    }
    if (!picked.length) return; // المستخدم ألغى

    // تقرير الموازنة ملف Excel حصراً — نستبعد غيره قبل إرسال أي شيء للخادم
    const xlsx = picked.filter((f) => f.name.toLowerCase().endsWith('.xlsx'));
    const rejected = picked.filter((f) => !f.name.toLowerCase().endsWith('.xlsx'));
    if (xlsx.length === 0) {
      setOutcome({
        ok: false,
        message: 'لم يُرفع شيء — تقرير الموازنة يجب أن يكون ملف Excel بامتداد .xlsx',
        details: rejected.map((f) => f.name),
      });
      return;
    }

    setUploading(true);
    let imported = 0, updated = 0;
    const projects = new Set<string>();
    const failures: string[] = [];
    for (const f of xlsx) {
      try {
        const res = await api.budgetImport(f.path);
        imported += res?.imported ?? 0;
        updated += res?.updated ?? 0;
        for (const p of res?.projects ?? []) projects.add(p);
      } catch (e: any) {
        failures.push(`${f.name} — ${e?.message ?? e}`);
      }
    }
    setUploading(false);

    const skippedNote = rejected.length
      ? [`تُجوهل ${ar(rejected.length)} ملفاً بامتداد غير مقبول: ${rejected.map((f) => f.name).join('، ')}`]
      : [];
    if (failures.length === 0) {
      setOutcome({
        ok: true,
        message: `تم استيراد ${ar(imported)} لقطة${updated > 0 ? ` وتحديث ${ar(updated)}` : ''} لمشاريع: ${[...projects].join('، ') || '—'}`,
        details: skippedNote,
      });
    } else {
      setOutcome({
        ok: false,
        message: imported + updated > 0
          ? `اكتمل جزئياً — استُورد ${ar(imported + updated)} لقطة، وفشل ${ar(failures.length)}:`
          : 'لم يُستورد شيء:',
        details: [...failures, ...skippedNote],
      });
    }
    load(); // تحديث بيانات الشاشة بعد الاستيراد
  }

  if (err) return <State>تعذّر التحميل: {err}</State>;

  if (docMode && d) {
    return <BudgetDoc d={d} onBack={() => setDocMode(false)} />;
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>الموازنة التقديرية</h1>
          <p>حجم العمل الفعلي مقابل المخطط ونسب التأخر والإنجاز لكل مشروع</p>
        </div>
        {d && d.projects.length > 0 && (
          <button className="btn" onClick={() => setDocMode(true)}>تقرير الموازنة (طباعة/PDF)</button>
        )}
        <button className="btn primary" onClick={upload} disabled={uploading}>
          {uploading ? 'جارٍ الاستيراد…' : 'رفع تقرير الموازنة'}
        </button>
      </div>

      {outcome && (
        <div className={'callout ' + (outcome.ok ? 'ok' : 'bad')} style={{ marginBottom: 16 }}>
          {outcome.message}
          {outcome.details && outcome.details.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingInlineStart: 18 }}>
              {outcome.details.map((x, i) => <li key={i}>{x}</li>)}
            </ul>
          )}
        </div>
      )}

      {!d ? <State>جارٍ التحميل…</State>
        : d.projects.length === 0 ? (
          <Card>
            <EmptyState kind="no-data" title="لم تُرفع بيانات الموازنة بعد"
              body="ارفع ملف تقرير الانحراف الشهري لتظهر هنا مقارنة الفعلي بالمخطط لكل مشروع."
              ctaLabel="رفع الملفات" onCta={() => nav('/import')} />
          </Card>
        ) : (
          <div className="stack">
            {d.projects.map((p) => <ProjectBudget key={p.project} p={p} />)}
          </div>
        )}
    </>
  );
}

/* ==================== الوثيقة القابلة للطباعة ==================== */

/** يجمع مدى الأشهر المغطاة عبر كل المشاريع — لسطر «الفترة» في رأس الوثيقة. */
function coveredRange(d: BudgetResponse): string {
  const months = d.projects.flatMap((p) => p.months.map((m) => m.month)).sort();
  if (months.length === 0) return '—';
  const first = months[0], last = months[months.length - 1];
  return first === last ? arDate(first) : `${arDate(first)} ← ${arDate(last)}`;
}

function BudgetDoc({ d, onBack }: { d: BudgetResponse; onBack: () => void }) {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);

  // داخل التطبيق: حوار حفظ أصلي + printToPDF — وفي المتصفح: window.print كما في التقرير التحليلي
  async function exportPdf() {
    if (!window.egco?.exportPdf) { window.print(); return; }
    setExporting(true); setExportErr(null);
    const r = await window.egco.exportPdf({ filename: `EGCO-موازنة-${stamp}.pdf` });
    setExporting(false);
    if (r.error) setExportErr(r.error);
  }

  return (
    <>
      <div className="page-head no-print">
        <div className="grow">
          <h1>تقرير الموازنة التقديرية</h1>
          <p>جاهز للطباعة أو الحفظ بصيغة PDF</p>
        </div>
        <button className="btn" onClick={onBack}>عودة</button>
        <button className="btn primary" onClick={exportPdf} disabled={exporting}>
          {exporting ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}
        </button>
      </div>
      {exportErr && <div className="no-print"><State>{exportErr}</State></div>}

      <div className="sheet budget-doc">
        <header className="rpt-head">
          <div>
            <b>شركة إعمار الخليج المصرية للمقاولات</b>
            <span>الإدارة المالية</span>
          </div>
        </header>
        <hr className="rule-ink" />

        <h1 className="rpt-title">تقرير الموازنة التقديرية</h1>
        <p className="rpt-sub">
          الفترة المغطاة: {coveredRange(d)} · جميع الأرقام بالريال السعودي
        </p>
        <div className="rpt-meta">
          <div><span>تاريخ الإصدار</span><b>{arDate(stamp)}</b></div>
          <div><span>عدد المشاريع</span><b>{ar(d.projects.length)}</b></div>
          <div><span>أساس الاحتساب</span><b>تقارير الانحراف الشهرية</b></div>
          <div><span>التصنيف</span><b>وثيقة داخلية</b></div>
        </div>
        <hr />

        {d.projects.map((p, i) => (
          <ProjectDocSection key={p.project} p={p} index={i} />
        ))}

        <div className="rpt-foot">
          <hr />
          <div className="signs">
            <div>إعداد — الإدارة المالية</div>
            <div>مراجعة — المدير المالي</div>
            <div>اعتماد — الإدارة التنفيذية</div>
          </div>
          <p className="muted">وثيقة داخلية · تقرير الموازنة التقديرية · {arDate(stamp)}</p>
        </div>
      </div>
    </>
  );
}

function ProjectDocSection({ p, index }: { p: BudgetProject; index: number }) {
  const latest = p.latest ?? p.months[p.months.length - 1] ?? null;
  if (!latest) return null;
  return (
    <section className="budget-doc-project">
      <div className="rpt-section">
        <div>
          <span className="badge">٠{ar(index + 1)}</span>
          <b>مشروع {p.project}</b>
        </div>
        <p>
          آخر تقرير: {arDate(latest.month, true)}
          {latest.serial ? ` · تقرير رقم ${ar(latest.serial)}` : ''}
          {latest.issuedOn ? ` · صدر ${arDate(latest.issuedOn)}` : ''}
        </p>
      </div>

      <div className="rpt-kpis" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <DocKpi label="الفعلي للشهر" value={sar(latest.actualMonth)} />
        <DocKpi label="المخطط للشهر" value={sar(latest.plannedMonth)} />
        <DocKpi label="انحراف الشهر" value={sar(latest.deviationMonth)}
                cls={latest.deviationMonth < 0 ? 'red' : latest.deviationMonth > 0 ? 'ok' : ''} />
        <DocKpi label="نسبة التأخر" value={`${sar(latest.delayPct * 100)}٪`}
                cls={latest.delayPct > 0.10 ? 'red' : ''} unit="" />
        <DocKpi label="نسبة الإنجاز" value={`${sar(latest.completionPct * 100)}٪`} unit="" />
      </div>

      <MonthsTable months={p.months} />

      <div style={{ margin: '12px 0' }}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
          التراكمي: الفعلي {sar(latest.cumActual)} مقابل المخطط {sar(latest.cumPlanned)} ر.س
        </div>
        <DocBar label="الفعلي" value={latest.cumActual} max={Math.max(latest.cumActual, latest.cumPlanned, 1)} gold />
        <DocBar label="المخطط" value={latest.cumPlanned} max={Math.max(latest.cumActual, latest.cumPlanned, 1)} />
      </div>

      {latest.claims.length > 0 && (
        <>
          <b style={{ fontSize: 12, display: 'block', margin: '10px 0 6px' }}>مستخلصات الشهر الأخير</b>
          <table className="rpt-table">
            <thead>
              <tr><th>المستخلص</th><th className="ltr">المبلغ</th><th>التاريخ</th></tr>
            </thead>
            <tbody>
              {latest.claims.map((c, i) => {
                const pending = !c.amount || !c.date;
                return (
                  <tr key={c.no + i}>
                    <td className="num">{ar(c.no)}</td>
                    <td className="ltr num">{pending ? 'لم يصدر بعد' : sar(c.amount)}</td>
                    <td>{c.date ? arDate(c.date) : 'لم يصدر بعد'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      <BudgetNotesSection project={p.project} initial={latest.notes} />
    </section>
  );
}

/**
 * ملاحظات مالية — نص المستخدم يفوز دائماً؛ مسودة الذكاء تكتب فوق الحقل فقط
 * لحظة الضغط الصريح على الزر، ولا تُحفظ تلقائياً في أي مكان.
 */
function BudgetNotesSection({ project, initial }: { project: string; initial: string | null }) {
  const [notes, setNotes] = useState(initial ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  async function draft() {
    setBusy(true); setError(null);
    try {
      const r = await api.aiBudgetNotes(project);
      setNotes(r.notes);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rpt-notes no-print-controls" style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <b style={{ flex: 1 }}>ملاحظات مالية</b>
        {!aiLoading && aiEnabled && (
          <button type="button" className="btn no-print" onClick={draft} disabled={busy}>
            {busy ? 'جارٍ الصياغة…' : 'مسودة بالذكاء الاصطناعي'}
          </button>
        )}
      </div>
      {error && <div className="callout bad no-print" style={{ marginBottom: 6 }}>{error}</div>}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="ملاحظات مالية عن هذا المشروع…"
        rows={4}
        style={{ width: '100%', resize: 'vertical', font: 'inherit', fontSize: 12, padding: 8,
                 border: '1px solid var(--hair)', borderRadius: 'var(--r-control)',
                 background: 'var(--card)', color: 'var(--ink)', whiteSpace: 'pre-wrap' }}
      />
    </div>
  );
}

function MonthsTable({ months }: { months: BudgetMonth[] }) {
  if (months.length === 0) return null;
  return (
    <table className="rpt-table">
      <thead>
        <tr>
          <th>الشهر</th>
          <th className="ltr">الفعلي</th>
          <th className="ltr">المخطط</th>
          <th className="ltr">الانحراف</th>
          <th className="ltr">نسبة التأخر</th>
          <th className="ltr">نسبة الإنجاز</th>
        </tr>
      </thead>
      <tbody>
        {months.map((m) => (
          <tr key={m.month}>
            <td className="nowrap">{arDate(m.month)}</td>
            <td className="ltr num">{sar(m.actualMonth)}</td>
            <td className="ltr num">{sar(m.plannedMonth)}</td>
            <td className={'ltr num ' + (m.deviationMonth < 0 ? 'red' : m.deviationMonth > 0 ? 'ok' : '')}>
              {sar(m.deviationMonth)}
            </td>
            <td className={'ltr num' + (m.delayPct > 0.10 ? ' red' : '')}>{sar(m.delayPct * 100)}٪</td>
            <td className="ltr num">{sar(m.completionPct * 100)}٪</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DocKpi = ({ label, value, cls, unit = 'ر.س' }:
  { label: string; value: string; cls?: string; unit?: string }) => (
  <div className="rpt-kpi">
    <span>{label}</span>
    <b className={'num ' + (cls || '')}>{value}</b>
    {unit && <i>{unit}</i>}
  </div>
);

function DocBar({ label, value, max, gold }:
  { label: string; value: number; max: number; gold?: boolean }) {
  return (
    <div className="budget-doc-bar">
      <span>{label}</span>
      <div className="track">
        <div className={'fill' + (gold ? ' gold' : '')}
             style={{ width: `${Math.max((value / max) * 100, 0)}%` }} />
      </div>
      <span className="num amount">{sar(value)}</span>
    </div>
  );
}

/* ==================== الشاشة التفاعلية (كما كانت) ==================== */

function ProjectBudget({ p }: { p: BudgetProject }) {
  const latest = p.latest ?? p.months[p.months.length - 1] ?? null;
  const delta = p.trend?.delayDeltaPp;

  return (
    <Card
      title={p.project}
      sub={latest
        ? `آخر تقرير: ${latest.month}${latest.serial != null ? ` · تقرير رقم ${ar(latest.serial)}` : ''}${latest.issuedOn ? ` · صدر ${arDate(latest.issuedOn)}` : ''}`
        : undefined}
      actions={delta != null ? (
        <Pill kind={delta < 0 ? 'ok' : 'red'}>
          {delta < 0 ? `تحسّن ٪${sar(Math.abs(delta))}` : `تراجع ٪${sar(Math.abs(delta))}`}
        </Pill>
      ) : undefined}
    >
      {!latest ? (
        <EmptyState kind="no-data" title="لا تقارير لهذا المشروع"
          body="لم تُرفع تقارير انحراف لهذا المشروع بعد." />
      ) : (
        <div style={{ padding: '0 20px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="kpi-row" style={{ marginBottom: 0 }}>
            <Kpi label="حجم العمل الفعلي للشهر" value={sar(latest.actualMonth)} unit="ر.س" />
            <Kpi label="المخطط للشهر" value={sar(latest.plannedMonth)} unit="ر.س" />
            <Kpi label="انحراف الشهر" value={sar(latest.deviationMonth)} unit="ر.س"
                 tone={latest.deviationMonth < 0 ? 'red' : latest.deviationMonth > 0 ? 'ok' : 'muted'} />
            <Kpi label="نسبة الإنجاز" value={`${sar(latest.completionPct * 100)}٪`}
                 tone={latest.delayPct > 0.10 ? 'red' : ''} alert={latest.delayPct > 0.10} />
          </div>

          {/* مقارنة التراكمي — أعمدة CSS بسيطة بلا مكتبة رسوم */}
          <div>
            <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
              التراكمي: الفعلي {sar(latest.cumActual)} مقابل المخطط {sar(latest.cumPlanned)} ر.س
              {' '}· نسبة التأخر التراكمية{' '}
              <b className={latest.delayPct > 0.10 ? 'red' : ''}>{sar(latest.delayPct * 100)}٪</b>
            </div>
            <CumBars actual={latest.cumActual} planned={latest.cumPlanned} />
          </div>

          {p.months.length > 0 && (
            <table>
              <thead>
                <tr>
                  <th>الشهر</th>
                  <th className="ltr">الفعلي</th>
                  <th className="ltr">المخطط</th>
                  <th className="ltr">الانحراف</th>
                  <th className="ltr">نسبة التأخر</th>
                  <th className="ltr">نسبة الإنجاز</th>
                </tr>
              </thead>
              <tbody>
                {p.months.map((m) => (
                  <tr key={m.month}>
                    <td>{m.month}</td>
                    <td className="ltr"><Money v={m.actualMonth} /></td>
                    <td className="ltr muted"><Money v={m.plannedMonth} /></td>
                    <td className="ltr">
                      <Money v={m.deviationMonth} cls={m.deviationMonth < 0 ? 'red' : m.deviationMonth > 0 ? 'ok' : 'muted'} />
                    </td>
                    <td className={'ltr num' + (m.delayPct > 0.10 ? ' red' : '')}>{sar(m.delayPct * 100)}٪</td>
                    <td className="ltr num">{sar(m.completionPct * 100)}٪</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {latest.claims.length > 0 && (
            <div>
              <b style={{ fontSize: 13 }}>مستخلصات الشهر</b>
              <table style={{ marginTop: 6 }}>
                <thead>
                  <tr><th>المستخلص</th><th className="ltr">المبلغ</th><th>التاريخ</th></tr>
                </thead>
                <tbody>
                  {latest.claims.map((c, i) => {
                    const pending = !c.amount || !c.date;
                    return (
                      <tr key={c.no + i}>
                        <td className="num">{ar(c.no)}</td>
                        <td className="ltr">
                          {pending ? <span className="gold">لم يصدر بعد</span> : <Money v={c.amount} />}
                        </td>
                        <td>{c.date ? arDate(c.date) : <span className="gold">لم يصدر بعد</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {latest.notes && (
            <div className="callout note">
              <b style={{ fontSize: 12 }}>ملاحظات مالية</b>
              <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>{latest.notes}</div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CumBars({ actual, planned }: { actual: number; planned: number }) {
  const max = Math.max(actual, planned, 1);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <HBar label="الفعلي" value={actual} max={max} color="var(--gold)" />
      <HBar label="المخطط" value={planned} max={max} color="var(--hair)" />
    </div>
  );
}

function HBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
      <span className="muted" style={{ width: 52, flex: '0 0 52px' }}>{label}</span>
      <div style={{ flex: 1, background: 'var(--tint)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
        <div style={{
          width: `${Math.max((value / max) * 100, 0)}%`,
          height: '100%', background: color, borderRadius: 4,
        }} />
      </div>
      <span className="num" style={{ width: 110, flex: '0 0 110px', textAlign: 'left' }}>{sar(value)}</span>
    </div>
  );
}
