import { CSSProperties, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiBase, ApiError } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, Pill, State } from '@/components/ui';
import { AiBlock } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';
import { ExplainDot } from '@/components/Explain';

type BreakdownTerm = 'scheduled' | 'overdue' | 'undated' | 'beyond' | 'collected' | 'forecast';

/** رأس تفصيل رقم مسحوب من /cashflow/breakdown — يحمل السياق اللازم لعرضه في نافذة. */
interface BreakdownRequest {
  term: BreakdownTerm;
  titleLabel: string;
  amount: number;
  period?: string; // period[i].from — يقصر المصطلح على فترة واحدة
  rule: string; // شرح القاعدة التي اختارت هذه الصفوف — عربي مباشر
}

/** يجلب صفوف المصدر وراء رقم واحد — لا تعديل على lib/api.ts المملوك لوكيل آخر،
 * فنبني الرابط مباشرة عبر apiBase() تماماً كما تفعل روابط تصدير Excel. */
async function fetchBreakdown(req: BreakdownRequest, opts: {
  project: string; parties: PartiesFilter; weeks: number; periodDays: number;
}): Promise<{ term: string; total: number; truncated: boolean; rows: any[] }> {
  const params = new URLSearchParams();
  params.set('term', req.term);
  if (req.period) params.set('period', req.period);
  params.set('weeks', String(opts.weeks));
  params.set('period_days', String(opts.periodDays));
  if (opts.project) params.set('project', opts.project);
  params.set('parties', opts.parties);
  const res = await fetch(apiBase() + '/api/v1/cashflow/breakdown?' + params.toString());
  if (!res.ok) throw new Error('تعذّر جلب تفاصيل هذا الرقم');
  return res.json();
}

type PartiesFilter = 'suppliers' | 'contractors' | 'both';

const PERIOD_DAYS_MIN = 1;
const PERIOD_DAYS_MAX = 92;
const PERIOD_DAYS_DEFAULT = 14;
const PERIOD_PRESETS = [7, 14, 30];
const MAX_RENDERED_PERIOD_ROWS = 60;

/** «يوم واحد» / «يومان» / «٣ أيام» ... — تعريب صحيح لعدد الأيام. */
function periodDaysLabel(n: number): string {
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  return `${ar(n)} أيام`;
}

/** رقم قابل للنقر يفتح نافذة تُبيّن الصفوف التي كوّنته — جوهر ميزة «من أين جاء هذا الرقم؟». */
function AmountCell({ amount, cls, onClick }: { amount: number; cls?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} title="اضغط لرؤية الصفوف التي كوّنت هذا الرقم"
            style={{ all: 'unset', cursor: 'pointer', borderBottom: '1px dashed var(--muted)' }}>
      <Money v={amount} cls={cls} />
    </button>
  );
}

/** التدفق النقدي — الداخل مقابل الخارج، بالفترات. */
export function CashFlow() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();

  const [opening, setOpening] = useState(0);
  const [weeksSel, setWeeksSel] = useState<13 | 26>(26);
  const project = params.get('project') || '';
  // الواجهة تفتح افتراضياً على «كلاهما» حتى مع بقاء افتراضي الخادم «الموردون فقط»
  // للتوافق الخلفي مع أي مستدعٍ قديم للـ API — لذا نُرسل parties=both صراحةً من هنا.
  const rawParties = params.get('parties') as PartiesFilter | null;
  const parties: PartiesFilter =
    rawParties === 'suppliers' || rawParties === 'contractors' || rawParties === 'both' ? rawParties : 'both';
  // الخادم افتراضياً ١٤ يوماً للتوافق الخلفي — نتبع نفس الافتراض هنا.
  const rawPeriodDays = Number(params.get('period_days'));
  const periodDays: number =
    Number.isFinite(rawPeriodDays) && rawPeriodDays >= PERIOD_DAYS_MIN && rawPeriodDays <= PERIOD_DAYS_MAX
      ? rawPeriodDays : PERIOD_DAYS_DEFAULT;
  const [customPeriodDays, setCustomPeriodDays] = useState(String(periodDays));
  const [applied, setApplied] = useState<{ weeks: 13 | 26; opening: number }>({ weeks: 26, opening: 0 });
  const [breakdownReq, setBreakdownReq] = useState<BreakdownRequest | null>(null);

  function openBreakdown(req: BreakdownRequest) {
    setBreakdownReq(req);
  }

  const seq = useRef(0);
  const load = (weeks: number, opening_balance: number, projectFilter: string, partiesFilter: PartiesFilter,
                periodDaysFilter: number) => {
    const my = ++seq.current;
    setErr(null);
    api.cashflow({ weeks, opening_balance, project: projectFilter || undefined, parties: partiesFilter,
                  period_days: periodDaysFilter })
      .then((r) => { if (my === seq.current) setD(r); })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => { load(applied.weeks, applied.opening, project, parties, periodDays); },
    [applied, project, parties, periodDays]);

  function apply() {
    setApplied({ weeks: weeksSel, opening: Number(opening) || 0 });
  }

  function setProject(value: string) {
    const p = new URLSearchParams(params);
    if (value) p.set('project', value); else p.delete('project');
    setParams(p, { replace: true });
  }

  function setParties(value: PartiesFilter) {
    const p = new URLSearchParams(params);
    if (value === 'both') p.delete('parties'); else p.set('parties', value);
    setParams(p, { replace: true });
  }

  function setPeriodDays(value: number) {
    const clamped = Math.min(PERIOD_DAYS_MAX, Math.max(PERIOD_DAYS_MIN, Math.round(value) || PERIOD_DAYS_DEFAULT));
    const p = new URLSearchParams(params);
    if (clamped === PERIOD_DAYS_DEFAULT) p.delete('period_days'); else p.set('period_days', String(clamped));
    setParams(p, { replace: true });
  }

  function onPeriodDaysPresetChange(value: string) {
    if (value === 'custom') { setCustomPeriodDays(String(periodDays)); return; }
    setPeriodDays(Number(value));
  }

  function applyCustomPeriodDays() {
    setPeriodDays(Number(customPeriodDays));
  }

  const isCustomPeriodDays = !PERIOD_PRESETS.includes(periodDays);

  if (err) return <ErrorState message={err} onRetry={() => load(applied.weeks, applied.opening, project, parties, periodDays)} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const periods = d.periods ?? [];
  const summary = d.summary ?? {};
  const hasReceivables = summary.hasReceivables !== false;
  const warnings: string[] = d.warnings ?? [];
  const maxAmt = Math.max(1, ...periods.map((p: any) => Math.max(p.inflow || 0, p.outflow || 0)));
  const undatedContractorDues: number = d.undatedContractorDues ?? 0;
  const allZero = periods.length > 0
    && periods.every((p: any) => (p.inflow ?? 0) === 0 && (p.outflow ?? 0) === 0);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>التدفق النقدي</h1>
          <p>الداخل مقابل الخارج، بفترات {periodDaysLabel(periodDays)}</p>
        </div>
      </div>

      {!hasReceivables && (
        <div className="callout bad" style={{ marginBottom: 14 }}>
          {warnings.length > 0
            ? warnings.join(' — ')
            : 'لم تُرفع بيانات التحصيلات بعد — التدفق الداخل أدناه ليس تقديراً فعلياً.'}
        </div>
      )}

      {/* تحذيرات الخارج (متأخر الآن / بلا تواريخ) تصل حتى حين تكون بيانات التحصيلات سليمة —
          وإلا لبقيت مخفية خلف شرط «لا توجد تحصيلات» أعلاه. */}
      {hasReceivables && warnings.length > 0 && (
        <div className="callout warn" style={{ marginBottom: 14 }}>{warnings.join(' — ')}</div>
      )}

      <div className="toolbar">
        <select value={project} onChange={(e) => setProject(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">كل المشاريع</option>
          {(d.projects ?? []).map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          الرصيد الافتتاحي
          <input type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value))}
                 style={{ marginInlineStart: 8, width: 140 }} />
        </label>
        <select value={weeksSel} onChange={(e) => setWeeksSel(Number(e.target.value) as 13 | 26)}>
          <option value={13}>٣ أشهر قادمة (١٣ أسبوعاً)</option>
          <option value={26}>٦ أشهر قادمة (٢٦ أسبوعاً)</option>
        </select>
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          طول الفترة
          <select value={isCustomPeriodDays ? 'custom' : String(periodDays)}
                  onChange={(e) => onPeriodDaysPresetChange(e.target.value)}
                  style={{ marginInlineStart: 8 }}>
            <option value="7">أسبوع (٧ أيام)</option>
            <option value="14">أسبوعان (١٤ يوماً) (الافتراضي)</option>
            <option value="30">شهر (٣٠ يوماً)</option>
            <option value="custom">مخصص…</option>
          </select>
        </label>
        {isCustomPeriodDays && (
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            أيام
            <input type="number" dir="ltr" value={customPeriodDays} min={PERIOD_DAYS_MIN} max={PERIOD_DAYS_MAX}
                   onChange={(e) => setCustomPeriodDays(e.target.value)}
                   onBlur={applyCustomPeriodDays}
                   onKeyDown={(e) => { if (e.key === 'Enter') applyCustomPeriodDays(); }}
                   style={{ marginInlineStart: 8, width: 80 }} />
          </label>
        )}
        <ExplainDot metric="cashflowHorizon" values={{ periodDays }} />
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          الأطراف
          <select value={parties} onChange={(e) => setParties(e.target.value as PartiesFilter)}
                  style={{ marginInlineStart: 8 }}>
            <option value="both">كلاهما</option>
            <option value="suppliers">الموردون فقط</option>
            <option value="contractors">المقاولون فقط</option>
          </select>
        </label>
        <button className="btn primary" onClick={apply}>تطبيق</button>
      </div>

      <div className="kpi-row">
        <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => openBreakdown({
          term: 'forecast', titleLabel: 'إجمالي الداخل (متوقّع)', amount: summary.totalInflow ?? 0,
          rule: 'كل تحصيل مفتوح (لم يُحصَّل بعد) له تاريخ استحقاق ضمن الأفق المعروض — هذا توقّع لا تاريخ.',
        })}>
          <Kpi label="إجمالي الداخل (متوقّع)" value={sar(summary.totalInflow ?? 0)} unit="ر.س" tone="ok" />
        </button>
        <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => openBreakdown({
          term: 'collected', titleLabel: 'إجمالي المحصّل خلال المدى', amount: d.collections?.inWindow ?? 0,
          rule: 'كل تحصيل بحالة «محصَّل» وتاريخ تحصيله الفعلي يقع داخل الأفق المعروض — هذا تاريخ فعلي لا توقّع.',
        })}>
          <Kpi label="إجمالي المحصّل خلال المدى" value={sar(d.collections?.inWindow ?? 0)} unit="ر.س" tone="ok" />
        </button>
        <button style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }} onClick={() => openBreakdown({
          term: 'scheduled', titleLabel: 'إجمالي الخارج (مجدول)', amount: summary.totalOutflow ?? 0,
          rule: 'كل فاتورة/ضمان مستحق داخل الأفق المعروض من الجدول الزمني.',
        })}>
          <Kpi label="إجمالي الخارج" value={sar(summary.totalOutflow ?? 0)} unit="ر.س" />
        </button>
        <Kpi label="صافي الفترة" value={sar(summary.netTotal ?? 0)} unit="ر.س"
             tone={(summary.netTotal ?? 0) < 0 ? 'red' : 'ok'} />
        <Kpi label="أدنى رصيد" value={sar(summary.minBalance ?? 0)} unit="ر.س"
             tone={(summary.minBalance ?? 0) < 0 ? 'red' : ''} alert={(summary.minBalance ?? 0) < 0} />
      </div>
      <p className="muted" style={{ fontSize: 11, margin: '0 0 14px', lineHeight: 1.7 }}>
        «إجمالي الداخل» توقّعٌ لتحصيلات لم تُحصَّل بعد ولها تاريخ استحقاق، أما «إجمالي المحصّل خلال المدى»
        فمبلغ حُصِّل فعلاً بتاريخ فعلي — الاثنان مختلفان ولا يُجمعان في رقم واحد. اضغط أي رقم أعلاه لرؤية
        الصفوف التي كوّنته.
      </p>

      {summary.firstDeficit && (
        <div className="callout bad" style={{ marginBottom: 14 }}>
          أول عجز متوقع في {arDate(summary.firstDeficit.from)} — {arDate(summary.firstDeficit.to)}{' '}
          بمقدار {sar(Math.abs(summary.firstDeficit.amount ?? 0))} ر.س
        </div>
      )}

      {parties !== 'suppliers' && undatedContractorDues > 0 && (
        <div className="callout warn" style={{ marginBottom: 14 }}>
          مستحق للمقاولين بلا تواريخ استحقاق: {sar(undatedContractorDues)} ر.س — غير موزّع على الجدول
          لأن دفاتر المقاولين لا تحمل تواريخ
        </div>
      )}

      <div className="stack">
        <Card title="الداخل مقابل الخارج">
          {periods.length === 0 ? (
            <State>لا توجد بيانات لهذه الفترة.</State>
          ) : allZero ? (
            <EmptyState kind="no-data" title="لا حركة نقدية في هذا الأفق"
              body="لا داخل ولا خارج مسجَّل لأي فترة ضمن هذا الأفق — راجع شاشة التحصيلات وتأكد من رفع الملفات اللازمة." />
          ) : (
            <>
              <div className="bars">
                {periods.map((p: any) => (
                  <div className="col" key={p.label}>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 130 }}>
                      <div className="bar" title="الداخل"
                           style={{ width: 10,
                                    height: `${Math.max(3, ((p.inflow || 0) / maxAmt) * 130)}px`,
                                    background: 'var(--ok)' }} />
                      <div className="bar" title="الخارج"
                           style={{ width: 10,
                                    height: `${Math.max(3, ((p.outflow || 0) / maxAmt) * 130)}px`,
                                    background: p.deficit ? 'var(--red)' : 'var(--gold)' }} />
                    </div>
                    <span style={{ fontSize: 11 }}>{arDate(p.from, false)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, padding: '0 20px 8px', fontSize: 12 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--ok)', borderRadius: 2, marginInlineEnd: 4 }} />
                  {hasReceivables ? 'الداخل' : 'لا توجد بيانات تحصيلات'}</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--gold)', borderRadius: 2, marginInlineEnd: 4 }} />الخارج</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--red)', borderRadius: 2, marginInlineEnd: 4 }} />خارج (عجز)</span>
              </div>

              <div style={{ display: 'flex', gap: 4, padding: '8px 20px 16px', overflowX: 'auto' }}>
                {periods.map((p: any) => (
                  <div key={p.label} style={{
                    flex: '1 0 60px', textAlign: 'center', fontSize: 11, padding: '4px 2px',
                    borderRadius: 4, background: p.balance < 0 ? 'var(--wash-red)' : 'var(--tint)',
                  }}>
                    <div className={'num' + (p.balance < 0 ? ' red' : '')}>{sar(p.balance ?? 0, 0)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="جدول الفترات">
          <p className="muted" style={{ fontSize: 11, margin: '0 20px 8px', display: 'flex', alignItems: 'center', gap: 2 }}>
            كل صف = {periodDaysLabel(periodDays)}
            <ExplainDot metric="cashflowColumns" values={{}} />
          </p>
          {periods.length === 0 ? (
            <State>لا توجد بيانات.</State>
          ) : (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>الفترة</th><th className="ltr">الداخل (متوقّع)</th>
                      <th className="ltr">التحصيل الفعلي</th>
                      <th className="ltr">الخارج</th>
                      <th className="ltr">صافي الحركة</th><th className="ltr">الرصيد التراكمي</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {periods.slice(0, MAX_RENDERED_PERIOD_ROWS).map((p: any) => (
                      <tr key={p.label} style={p.deficit ? { background: 'var(--tint)' } : undefined}>
                        <td className="nowrap">{arDate(p.from)} — {arDate(p.to)}</td>
                        <td className="ltr">
                          <AmountCell amount={p.inflow ?? 0} cls="ok" onClick={() => openBreakdown({
                            term: 'forecast', titleLabel: `الداخل المتوقّع — ${arDate(p.from)} — ${arDate(p.to)}`,
                            amount: p.inflow ?? 0, period: p.from,
                            rule: 'تحصيلات مفتوحة لها تاريخ استحقاق داخل هذه الفترة تحديداً.',
                          })} />
                        </td>
                        <td className="ltr">
                          <AmountCell amount={p.collected ?? 0} cls="ok" onClick={() => openBreakdown({
                            term: 'collected', titleLabel: `التحصيل الفعلي — ${arDate(p.from)} — ${arDate(p.to)}`,
                            amount: p.collected ?? 0, period: p.from,
                            rule: 'تحصيلات بحالة «محصَّل» بتاريخ تحصيل فعلي داخل هذه الفترة تحديداً.',
                          })} />
                        </td>
                        <td className="ltr">
                          <AmountCell amount={p.outflow ?? 0} onClick={() => openBreakdown({
                            term: 'scheduled', titleLabel: `الخارج المجدول — ${arDate(p.from)} — ${arDate(p.to)}`,
                            amount: p.outflow ?? 0, period: p.from,
                            rule: 'فواتير موردين/ضمانات مقاولين مستحقة داخل هذه الفترة تحديداً.',
                          })} />
                        </td>
                        <td className="ltr">
                          <Money v={p.net ?? 0} cls={(p.net ?? 0) < 0 ? 'red' : ''} />
                        </td>
                        <td className="ltr">
                          <Money v={p.balance ?? 0} cls={(p.balance ?? 0) < 0 ? 'red' : ''} />
                        </td>
                        <td>{p.deficit && <Pill kind="red">عجز</Pill>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {periods.length > MAX_RENDERED_PERIOD_ROWS && (
                <p className="muted" style={{ fontSize: 11, margin: '8px 20px 0' }}>
                  عُرضت أول {ar(MAX_RENDERED_PERIOD_ROWS)} فترة — قصّر الأفق أو أطل الفترة
                </p>
              )}
              <ReconciliationFooter recon={d.reconciliation} parties={parties} onTermClick={openBreakdown} />
            </>
          )}
        </Card>

        <WhatIfCard />
      </div>

      {breakdownReq && (
        <BreakdownModal req={breakdownReq} onClose={() => setBreakdownReq(null)}
          project={project} parties={parties} weeks={applied.weeks} periodDays={periodDays} />
      )}
    </>
  );
}

/** حدّ مقبول للفرق: أقل من نصف هللة — أي انحراف أكبر خطأ لا تقريب. */
const RECON_EPSILON = 0.005;

/** طرف واحد في المعادلة: علامة (+/−)، تسمية، مبلغ — قابل للنقر إن أعطي onClick. */
function ReconTerm({ sign, label, value, muted, onClick }: {
  sign?: string; label: string; value: number; muted?: boolean; onClick?: () => void;
}) {
  const body = (
    <>
      {sign && <span className="muted" style={{ fontSize: 13 }}>{sign}</span>}
      <span style={{ color: muted ? 'var(--muted)' : 'inherit' }}>{label}</span>
      <b className="num ltr" style={onClick ? { borderBottom: '1px dashed var(--muted)' } : undefined}>
        {sar(value)}
      </b>
    </>
  );
  if (onClick) {
    return (
      <button onClick={onClick} title="اضغط لرؤية الصفوف التي كوّنت هذا الرقم"
              style={{ all: 'unset', cursor: 'pointer', display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
        {body}
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
      {body}
    </span>
  );
}

/**
 * سطر المطابقة — لماذا لا يساوي مجموع عمود «الخارج» أعلاه رقمَ المديونية في شاشة الموردين.
 *
 * الجدول أعلاه يعرض ما يمكن جدولته فقط: مبلغ مضى استحقاقه لا دلو له، ومبلغ بعد نهاية
 * الأفق خارج الشاشة، وفاتورة بلا تاريخ استحقاق لا يمكن وضعها في فترة. هذه المصطلحات
 * الأربعة تُعرض هنا صراحةً، ومجموعها يساوي رقم الشاشة الأخرى بالهللة — والفرق (المفترض
 * أن يكون صفراً) يُعرض بنفسه إن لم يكن كذلك، فلا انحراف صامت.
 */
function ReconciliationFooter({ recon, parties, onTermClick }: {
  recon: any; parties: PartiesFilter; onTermClick: (req: BreakdownRequest) => void;
}) {
  if (!recon) return null;
  const o = recon.outflow;
  const inflow = recon.inflow;
  if (!o) return null;

  const partiesLabel = parties === 'suppliers' ? 'الموردين'
    : parties === 'contractors' ? 'المقاولين' : 'الموردين والمقاولين';
  const outDrift = Math.abs(o.difference ?? 0) >= RECON_EPSILON;
  const inDrift = inflow && Math.abs(inflow.difference ?? 0) >= RECON_EPSILON;

  const box: CSSProperties = {
    borderTop: '1px solid var(--hair)', margin: '12px 20px 0', padding: '12px 0 4px',
    display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12,
  };
  const row: CSSProperties = {
    display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8,
  };

  return (
    <div style={box}>
      <div style={row}>
        <b style={{ fontSize: 12 }}>مطابقة الخارج مع مديونية {partiesLabel}</b>
        <ExplainDot metric="cashflowReconciliation" values={{
          scheduled: o.scheduled, overdueNow: o.overdueNow, beyondHorizon: o.beyondHorizon,
          undated: o.undated, credits: o.credits, openDebt: o.openDebt,
        }} />
      </div>

      <div style={row}>
        <ReconTerm label="الخارج المجدول" value={o.scheduled ?? 0} onClick={() => onTermClick({
          term: 'scheduled', titleLabel: 'الخارج المجدول', amount: o.scheduled ?? 0,
          rule: 'فواتير موردين/ضمانات مقاولين مستحقة داخل الأفق المعروض.',
        })} />
        <ReconTerm sign="+" label="متأخر الآن" value={o.overdueNow ?? 0} onClick={() => onTermClick({
          term: 'overdue', titleLabel: 'متأخر الآن', amount: o.overdueNow ?? 0,
          rule: 'فواتير موردين/ضمانات مقاولين مضى تاريخ استحقاقها قبل بداية الأفق المعروض ولم تُسدَّد بالكامل.',
        })} />
        <ReconTerm sign="+" label="بعد نهاية الأفق" value={o.beyondHorizon ?? 0} onClick={() => onTermClick({
          term: 'beyond', titleLabel: 'بعد نهاية الأفق', amount: o.beyondHorizon ?? 0,
          rule: 'فواتير موردين/ضمانات مقاولين تستحق بعد آخر يوم في الأفق المعروض.',
        })} />
        <ReconTerm sign="+" label="بلا تواريخ" value={o.undated ?? 0} onClick={() => onTermClick({
          term: 'undated', titleLabel: 'بلا تواريخ', amount: o.undated ?? 0,
          rule: 'فواتير موردين بلا تاريخ استحقاق، أو رصيد مقاولين مستحق يتجاوز ما لهم من ضمانات مؤرَّخة.',
        })} />
        {(o.credits ?? 0) !== 0 && <ReconTerm sign="−" label="أرصدة دائنة" value={o.credits} muted />}
        {(o.excess ?? 0) !== 0 && <ReconTerm sign="−" label="ضمانات تتجاوز المستحق" value={o.excess} muted />}
        <span className="muted">=</span>
        <ReconTerm label="المديونية المفتوحة" value={o.openDebt ?? 0} />
        <span style={{ marginInlineStart: 'auto' }}>
          <Pill kind={outDrift ? 'red' : 'ok'}>
            {outDrift ? `فرق غير مفسَّر ${sar(o.difference)}` : 'مطابق بالهللة'}
          </Pill>
        </span>
      </div>

      {inflow && (
        <div style={row}>
          <ReconTerm label="الداخل المجدول" value={inflow.scheduled ?? 0} onClick={() => onTermClick({
            term: 'forecast', titleLabel: 'الداخل المجدول (متوقّع)', amount: inflow.scheduled ?? 0,
            rule: 'تحصيلات مفتوحة لها تاريخ استحقاق داخل الأفق المعروض.',
          })} />
          <ReconTerm sign="+" label="متأخر الآن" value={inflow.overdueNow ?? 0} />
          <ReconTerm sign="+" label="بعد نهاية الأفق" value={inflow.beyondHorizon ?? 0} />
          <ReconTerm sign="+" label="بلا تواريخ" value={inflow.undated ?? 0} />
          <span className="muted">=</span>
          <ReconTerm label="المستحق المفتوح" value={inflow.openTotal ?? 0} />
          <span style={{ marginInlineStart: 'auto' }}>
            <Pill kind={inDrift ? 'red' : 'ok'}>
              {inDrift ? `فرق غير مفسَّر ${sar(inflow.difference)}` : 'مطابق بالهللة'}
            </Pill>
          </span>
        </div>
      )}

      <p className="muted" style={{ margin: 0, fontSize: 11, lineHeight: 1.7 }}>
        «المديونية المفتوحة» و«المستحق المفتوح» هما رقما شاشتَي الموردين/المقاولين والتحصيلات
        نفسهما. الجدول أعلاه يعرض المجدول فقط — «متأخر الآن» مضى استحقاقه فلا دلو له،
        و«بعد نهاية الأفق» يستحق بعد {arDate(recon.horizonEnd)}، و«بلا تواريخ» فواتير
        ودفاتر بلا تاريخ استحقاق لا يمكن وضعها في فترة بأمانة. لا شيء من هذه الثلاثة داخل
        الرصيد التراكمي أعلاه.
      </p>
    </div>
  );
}

/**
 * نافذة «من أين جاء هذا الرقم؟» — الصفوف الفعلية وراء أي رقم في الشاشة، مع سطر
 * إجمالي يثبت أن مجموعها يساوي الرقم المعروض، وجملة عربية تشرح القاعدة التي اختارتها.
 */
function BreakdownModal({ req, onClose, project, parties, weeks, periodDays }: {
  req: BreakdownRequest; onClose: () => void;
  project: string; parties: PartiesFilter; weeks: number; periodDays: number;
}) {
  const [state, setState] = useState<{ total: number; truncated: boolean; rows: any[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const loadBreakdown = () => {
    const my = ++seq.current;
    setState(null); setError(null);
    fetchBreakdown(req, { project, parties, weeks, periodDays })
      .then((r) => { if (my === seq.current) setState(r); })
      .catch((e) => { if (my === seq.current) setError(e.message); });
  };
  useEffect(() => { loadBreakdown(); },
    [req.term, req.period, project, parties, weeks, periodDays]);

  const isSupplierRow = (r: any) => 'invoiceNumber' in r;
  const isContractorRow = (r: any) => 'contractorCode' in r;
  const isReceivableRow = (r: any) => 'client' in r;

  const overlay: CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex',
    alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20,
  };
  const box: CSSProperties = {
    background: 'var(--bg)', borderRadius: 'var(--r-card, 10px)', maxWidth: 720, width: '100%',
    maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    border: '1px solid var(--hair)',
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={box} onClick={(e) => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--hair)', display: 'flex',
                     justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <b style={{ fontSize: 14 }}>{req.titleLabel}</b>
            <div className="num ltr" style={{ fontSize: 18, marginTop: 4 }}>{sar(req.amount)} ر.س</div>
          </div>
          <button className="btn" onClick={onClose}>إغلاق</button>
        </div>

        <p className="muted" style={{ margin: '10px 20px 0', fontSize: 12, lineHeight: 1.7 }}>{req.rule}</p>

        <div style={{ overflowY: 'auto', padding: '10px 0' }}>
          {error && <ErrorState message={error} onRetry={loadBreakdown} />}
          {!error && !state && <State>جارٍ التحميل…</State>}
          {state && state.rows.length === 0 && <State>لا توجد صفوف لهذا الرقم.</State>}
          {state && state.rows.length > 0 && (
            <div className="table-scroll" style={{ padding: '0 20px' }}>
              <table>
                <thead>
                  <tr>
                    {isSupplierRow(state.rows[0]) && (
                      <><th>المورد</th><th>الفاتورة</th><th>تاريخ الفاتورة</th><th>الاستحقاق</th>
                        <th className="ltr">المبلغ</th><th>التأخر</th></>
                    )}
                    {isContractorRow(state.rows[0]) && (
                      <><th>المقاول</th><th>المشروع</th><th>الإفراج المتوقع</th><th className="ltr">المبلغ</th></>
                    )}
                    {isReceivableRow(state.rows[0]) && (
                      <><th>التاريخ</th><th>العميل</th><th>المشروع</th><th className="ltr">المبلغ</th></>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {state.rows.map((r: any, i: number) => (
                    <tr key={i}>
                      {isSupplierRow(r) && (
                        <>
                          <td><a href={`#/suppliers/${r.account}`}>{r.supplierName}</a></td>
                          <td className="nowrap">{r.invoiceNumber}</td>
                          <td className="nowrap">{arDate(r.invoiceDate)}</td>
                          <td className="nowrap">{r.dueDate ? arDate(r.dueDate) : '—'}</td>
                          <td className="ltr"><Money v={r.amount} /></td>
                          <td>{r.daysOverdue ? `${ar(r.daysOverdue)} يوماً` : '—'}</td>
                        </>
                      )}
                      {isContractorRow(r) && (
                        <>
                          <td><a href={`#/contractors/${r.contractorCode}`}>{r.contractorName}</a></td>
                          <td>{r.project || '—'}</td>
                          <td className="nowrap">{r.releaseDue ? arDate(r.releaseDue) : '—'}</td>
                          <td className="ltr"><Money v={r.amount} /></td>
                        </>
                      )}
                      {isReceivableRow(r) && (
                        <>
                          <td className="nowrap">{arDate(r.date)}</td>
                          <td>{r.client}</td>
                          <td>{r.project || '—'}</td>
                          <td className="ltr"><Money v={r.amount} /></td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={isSupplierRow(state.rows[0]) ? 4 : isContractorRow(state.rows[0]) ? 3 : 3}>
                      <b>الإجمالي</b>
                    </td>
                    <td className="ltr" colSpan={isSupplierRow(state.rows[0]) ? 2 : 1}>
                      <b className="num ltr">{sar(state.total)}</b>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {state?.truncated && (
            <p className="muted" style={{ fontSize: 11, margin: '8px 20px 0' }}>
              عُرض أول 500 صف فقط — الإجمالي أعلاه يشمل كل الصفوف رغم ذلك.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** بطاقة «ماذا لو؟» — تأجيل/تقديم دفعة طرف معيّن. الحساب حتمي من الخادم، والنص فقط من المساعد. */
function WhatIfCard() {
  const { enabled, loading } = useAiEnabled();
  const [parties, setParties] = useState<{
    suppliers: { account: string; name: string }[];
    contractors: { code: string; name: string }[];
  } | null>(null);
  const [partyValue, setPartyValue] = useState(''); // "supplier:ACCOUNT" أو "contractor:CODE"
  const [shiftDays, setShiftDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ narrative: string; before: any; after: any } | null>(null);

  useEffect(() => {
    if (loading || !enabled) return;
    Promise.all([api.suppliers({}), api.contractors()]).then(([sup, con]) => {
      setParties({
        suppliers: (sup.rows ?? []).map((r: any) => ({ account: r.account, name: r.name })),
        contractors: (con.rows ?? []).map((r: any) => ({ code: r.code, name: r.name })),
      });
    }).catch(() => setParties({ suppliers: [], contractors: [] }));
  }, [loading, enabled]);

  async function compute() {
    if (!partyValue) return;
    const [partyKind, key] = partyValue.split(':') as ['supplier' | 'contractor', string];
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.aiWhatIf({ partyKind, key, shiftDays: Number(shiftDays) || 0 });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !enabled) return null;

  return (
    <Card title="ماذا لو؟" sub="أثر تأجيل أو تقديم دفعة طرف معيّن على التدفق النقدي — على مستوى الشركة كاملة، بصرف النظر عن فلتر المشروع أعلاه">
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select value={partyValue} onChange={(e) => setPartyValue(e.target.value)} style={{ minWidth: 220 }}
                  disabled={!parties}>
            <option value="">اختر طرفاً…</option>
            {parties && parties.suppliers.length > 0 && (
              <optgroup label="الموردون">
                {parties.suppliers.map((s) => (
                  <option key={'s:' + s.account} value={`supplier:${s.account}`}>{s.name}</option>
                ))}
              </optgroup>
            )}
            {parties && parties.contractors.length > 0 && (
              <optgroup label="المقاولون">
                {parties.contractors.map((c) => (
                  <option key={'c:' + c.code} value={`contractor:${c.code}`}>{c.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            إزاحة الأيام
            <input type="number" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)}
                   style={{ marginInlineStart: 8, width: 100 }} dir="ltr" />
          </label>
          <button className="btn primary" onClick={compute} disabled={busy || !partyValue}>
            {busy ? 'جارٍ الحساب…' : 'احسب'}
          </button>
        </div>

        {(busy || error || result) && (
          <AiBlock busy={busy} error={error}>
            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <WhatIfSummary label="قبل" data={result.before} />
                  <WhatIfSummary label="بعد" data={result.after} />
                </div>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{result.narrative}</p>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  الأرقام محسوبة من بياناتك؛ النص فقط من المساعد
                </p>
              </div>
            )}
          </AiBlock>
        )}
      </div>
    </Card>
  );
}

/** يعرض حقول before/after رقمية أياً كانت أسماؤها — الشكل any من الخادم. */
function WhatIfSummary({ label, data }: { label: string; data: any }) {
  const entries: [string, unknown][] = data && typeof data === 'object' ? Object.entries(data) : [];
  return (
    <div style={{ border: '1px solid var(--hair)', borderRadius: 'var(--r-control)', padding: 10 }}>
      <b style={{ fontSize: 12 }}>{label}</b>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        ) : entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
            <span className="muted">{k}</span>
            <span className="num">{typeof v === 'number' ? sar(v) : String(v ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
