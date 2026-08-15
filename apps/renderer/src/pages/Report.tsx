import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError, type PartyScope } from '@/lib/api';
import { ar, arDate, invoiceCount, sar } from '@/lib/format';
import { ErrorState, Kpi, Money, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';
import { PeriodBar } from '@/components/PeriodBar';
import { ScopeBar, scopeParams, type Scope } from '@/components/ScopeBar';
import { Present, type Slide } from '@/components/Present';
import { CopyButton } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';

/**
 * التقرير التحليلي — تبويبان: تقرير الفترة (A4 قابل للطباعة) والتحليل الدوري.
 */
export function ReportPage() {
  const [params] = useSearchParams();
  const account = params.get('account') ?? undefined;
  const [tab, setTab] = useState<'period' | 'periodic'>('period');

  return (
    <>
      <div className="page-head no-print">
        <div className="grow">
          <h1>التقرير التحليلي</h1>
          <p>جاهز للطباعة أو الحفظ بصيغة PDF</p>
        </div>
      </div>

      <div className="toolbar no-print" style={{ marginBottom: 18 }}>
        <button className={'btn' + (tab === 'period' ? ' primary' : '')} onClick={() => setTab('period')}>تقرير الفترة</button>
        <button className={'btn' + (tab === 'periodic' ? ' primary' : '')} onClick={() => setTab('periodic')}>التحليل الدوري</button>
      </div>

      {tab === 'period' ? <PeriodTab /> : <PeriodicTab account={account} />}
    </>
  );
}

/* ==================== تبويب ١: تقرير الفترة ==================== */

const PARTY_VALUES: PartyScope[] = ['suppliers', 'contractors', 'both'];

/**
 * النطاق والأطراف يعيشان في الرابط لا في الحالة المحلية — حتى يكون التقرير
 * قابلاً للمشاركة ولإعادة الفتح على نفس ما رآه من أرسله.
 */
function PeriodTab() {
  const today = new Date().toISOString().slice(0, 10);
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState('2026-01-01');
  const [to, setTo] = useState(today);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const account = params.get('account') || undefined;
  const contractor = params.get('contractor') || undefined;
  const project = params.get('project') || undefined;
  const rawParties = params.get('parties') as PartyScope | null;
  const parties: PartyScope = rawParties && PARTY_VALUES.includes(rawParties) ? rawParties : 'suppliers';

  const scope: Scope =
    contractor ? { kind: 'contractor', contractor }
      : account ? { kind: 'supplier', account }
        : project ? { kind: 'project', project }
          : { kind: 'company' };

  function writeParams(next: { scope?: Scope; parties?: PartyScope }) {
    const p = new URLSearchParams(params);
    if (next.scope) {
      p.delete('account'); p.delete('project'); p.delete('contractor');
      const sp2 = scopeParams(next.scope);
      for (const [k, v] of Object.entries(sp2)) if (v) p.set(k, v);
    }
    if (next.parties) {
      if (next.parties === 'suppliers') p.delete('parties');
      else p.set('parties', next.parties);
    }
    setParams(p, { replace: true });
  }

  const sp = scopeParams(scope);
  const seq = useRef(0);

  const loadReport = () => {
    const my = ++seq.current;
    setD(null); setErr(null);
    api.report(sp.account, {
      date_from: from, date_to: to,
      project: sp.project, contractor: sp.contractor, parties,
    }).then((r) => { if (my === seq.current) { setD(r); setErr(null); } })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => {
    loadReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp.account, sp.project, sp.contractor, parties, from, to]);

  const exportParams = { ...sp, parties: parties === 'suppliers' ? undefined : parties };

  return (
    <>
      <ScopeBar scope={scope} onChange={(s) => writeParams({ scope: s })}
                parties={parties} onPartiesChange={(p) => writeParams({ parties: p })} />
      <PeriodBar from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
      {err && <ErrorState message={err} onRetry={loadReport} />}
      {!err && !d && <State>جارٍ إعداد التقرير…</State>}
      {d && <PeriodSheet d={d} from={from} to={to} scopeP={exportParams} parties={parties} />}
    </>
  );
}

/** زر «الملخص التنفيذي (AI)» — يمرّر نطاق التقرير الحالي كما يتتبعه Report.tsx بالفعل. */
function AiSummaryButton({ scopeP, from, to, onResult }: {
  scopeP: Record<string, string | undefined>;
  from: string; to: string;
  onResult: (summary: string) => void;
}) {
  const { enabled, loading } = useAiEnabled();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const r = await api.aiSummary({
        account: scopeP.account, project: scopeP.project, contractor: scopeP.contractor,
        parties: scopeP.parties, date_from: from, date_to: to,
      });
      onResult(r.summary);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !enabled) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 }}>
      <button className="btn" onClick={run} disabled={loading || busy}>
        {busy ? 'جارٍ الصياغة…' : 'الملخص التنفيذي (AI)'}
      </button>
      {error && <span className="red" style={{ fontSize: 11 }}>{error}</span>}
    </div>
  );
}

function PeriodSheet({ d, from, to, scopeP, parties }:
  { d: any; from: string; to: string;
    scopeP: Record<string, string | undefined>; parties: PartyScope }) {
  const m = d.meta, s = d.summary;
  // قسم المقاولين يظهر فقط إن طُلب فعلاً وأرسله الخادم — غيابه لا يكسر التقرير
  const con = parties !== 'suppliers' ? contractorsSection(d) : null;
  const showSuppliers = parties !== 'contractors';
  // الافتتاحي/الختامي محسوبان من مراكز الموردين وحدها؛ في تقرير المقاولين فقط
  // تكون الثلاثة أصفاراً فتقرأ كأن الحسابات فارغة — فلا تُعرض أصلاً.
  const hasOpening = showSuppliers &&
    m.opening_balance !== undefined && m.opening_balance !== null;
  // رصيد لنا (مقدم) — يظهر فقط إن وُجد فعلاً، وإلا فالسطر الإضافي ضجيج على تقرير سليم.
  const hasCreditBalance = (s.credit_balances ?? 0) > 0;
  const scopeLabel: string = m.scope_label ?? defaultScopeLabel(parties);
  // ترقيم الأقسام يتبع ما ظهر فعلاً — قسم مخفي لا يترك فجوة في الترقيم
  const shown = [1, ...(showSuppliers ? [2, 3] : []), ...(con ? [4] : []), ...(d.notes?.length ? [5] : [])];
  const sn = (id: number) => '٠' + ar(shown.indexOf(id) + 1);
  const [presenting, setPresenting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  // داخل التطبيق: حوار حفظ أصلي + printToPDF — وفي المتصفح: window.print كما كان
  async function exportPdf(filename: string, landscape: boolean) {
    if (!window.egco?.exportPdf) { window.print(); return; }
    setExporting(true); setExportErr(null);
    const r = await window.egco.exportPdf({ filename, landscape });
    setExporting(false);
    if (r.error) setExportErr(r.error);
  }
  const stamp = new Date().toISOString().slice(0, 10);

  return (
    <>
      {presenting && (
        <Present slides={reportSlides(d, parties)} onClose={() => setPresenting(false)}
                 onExport={() => exportPdf(`EGCO-عرض-${stamp}.pdf`, true)} />
      )}

      <div className="page-head no-print">
        <div className="grow">
          <span className="pill gold" style={{ fontSize: 12 }}>{scopeLabel}</span>
        </div>
        <AiSummaryButton scopeP={scopeP} from={from} to={to} onResult={setAiSummary} />
        <button className="btn" onClick={() => setPresenting(true)}>وضع العرض</button>
        <a className="btn" href={api.exportExcelUrl({ date_from: from, date_to: to, ...scopeP })} download>تصدير Excel</a>
        <button className="btn primary" disabled={exporting}
                onClick={() => exportPdf(`EGCO-تقرير-تحليلي-${stamp}.pdf`, false)}>
          {exporting ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}
        </button>
      </div>
      {exportErr && <div className="no-print"><State>{exportErr}</State></div>}

      <div className="sheet">
        <header className="rpt-head">
          <div>
            <b>{m.company}</b>
            <span>{m.department}</span>
          </div>
        </header>
        <hr className="rule-ink" />

        <h1 className="rpt-title">{m.title}</h1>
        {/* النطاق مطبوع على الوثيقة نفسها — نسخة ورقية بلا نطاق نسخة تُساء قراءتها */}
        <p className="rpt-sub">{scopeLabel} · {m.period} · جميع الأرقام بالريال السعودي</p>

        <div className="rpt-meta">
          <Meta label="رقم الوثيقة" value={m.serial} />
          <Meta label="تاريخ الإصدار" value={m.issued_on} />
          <Meta label="أساس الاحتساب" value={m.basis} />
          <Meta label="التصنيف" value={m.classification} />
        </div>
        <hr />

        {aiSummary && (
          <div className="callout note no-print" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div style={{ flex: 1 }}>
                <b style={{ fontSize: 12 }}>مسودة آلية — راجعها قبل الاعتماد</b>
                <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{aiSummary}</p>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <CopyButton text={aiSummary} />
                <button className="btn" onClick={() => setAiSummary(null)}>✕</button>
              </div>
            </div>
          </div>
        )}

        <Section num={sn(1)} title="الملخص التنفيذي" sub="الوضع الكلي في تاريخ التقرير" />

        {hasOpening && (
          <>
            <div className="rpt-kpis" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
              <RKpi label="الرصيد الافتتاحي" value={sar(m.opening_balance)}
                    explain={<ExplainDot metric="openingBalance" values={{ openingBalance: m.opening_balance }} />} />
              {/* الحركة من داخل الفترة لا من الإجماليات التاريخية، وإلا لم يعد
                  «افتتاحي + حركة = ختامي» صحيحاً على الوثيقة. */}
              <RKpi label="حركة الفترة (مفوتر − مسدد)"
                    value={sar((m.invoiced_in_period ?? s.total_invoiced ?? 0)
                               - (m.paid_in_period ?? s.total_paid ?? 0))}
                    explain={<ExplainDot metric="periodMovement" values={{
                      invoicedInPeriod: m.invoiced_in_period ?? s.total_invoiced,
                      paidInPeriod: m.paid_in_period ?? s.total_paid,
                      openingBalance: m.opening_balance, closingBalance: m.closing_balance,
                    }} />} />
              <RKpi label="الرصيد الختامي" value={sar(m.closing_balance)} cls="ok"
                    explain={<ExplainDot metric="closingBalance" values={{
                      openingBalance: m.opening_balance,
                      periodMovement: (m.invoiced_in_period ?? s.total_invoiced ?? 0) - (m.paid_in_period ?? s.total_paid ?? 0),
                      closingBalance: m.closing_balance,
                    }} />} />
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '0 0 12px' }}>
              الافتتاحي محسوب من كل الحركات المسجلة قبل {arDate(m.period_from ?? from)}
              {' · '}المفوتر داخل الفترة <span className="num">{sar(m.invoiced_in_period ?? 0)}</span>
              {' '}والمسدد <span className="num">{sar(m.paid_in_period ?? 0)}</span> ر.س
            </p>
          </>
        )}

        <div className="rpt-kpis" style={hasCreditBalance ? { gridTemplateColumns: 'repeat(3, 1fr)' } : undefined}>
          <RKpi label="إجمالي المفوتر" value={sar(s.total_invoiced)} />
          <RKpi label="المسدد" value={sar(s.total_paid)} cls="ok" />
          <RKpi label="المديونية المفتوحة" value={sar(s.outstanding)} />
          {hasCreditBalance && (
            <>
              <RKpi label="أرصدة لنا (مقدمة)" value={sar(s.credit_balances)} cls="ok"
                    explain={<ExplainDot metric="netOutstanding" values={{
                      outstanding: s.outstanding, creditBalances: s.credit_balances,
                      netOutstanding: s.net_outstanding,
                    }} />} />
              <RKpi label="الصافي" value={sar(s.net_outstanding)}
                    explain={<ExplainDot metric="netOutstanding" values={{
                      outstanding: s.outstanding, creditBalances: s.credit_balances,
                      netOutstanding: s.net_outstanding,
                    }} />} />
            </>
          )}
          <RKpi label="المتأخر عن موعده" value={sar(s.overdue)} cls="red"
                explain={<ExplainDot metric="overdue" values={{ overdue: s.overdue }} />} />
        </div>
        <p className="rpt-lede">
          يغطي هذا التقرير {ar(s.supplier_count)} مورداً
          {con && <> و{ar(con.rows.length)} مقاولاً</>}. المديونية المفتوحة{' '}
          <span className="num">{sar(s.outstanding)}</span> ر.س، منها{' '}
          <span className="num">{sar(s.overdue)}</span> ر.س تجاوزت موعد استحقاقها، و
          <span className="num">{sar(s.due_within_7)}</span> ر.س تستحق خلال سبعة أيام.
          {hasCreditBalance && (
            <> بعد خصم أرصدة موردين دفعنا لهم أكثر من فواتيرهم البالغة{' '}
              <span className="num">{sar(s.credit_balances)}</span> ر.س، يصبح الصافي{' '}
              <span className="num">{sar(s.net_outstanding)}</span> ر.س.
            </>
          )}
          {con && (
            <> يضاف إلى ذلك مستحقات المقاولين البالغة{' '}
              <span className="num">{sar(con.owed)}</span> ر.س، فيصبح إجمالي الالتزام على الشركة{' '}
              <span className="num">{sar(s.outstanding + con.owed)}</span> ر.س.
            </>
          )}
          {' '}جميع المبالغ محسوبة على تاريخ الفاتورة مضافاً إليه مدة سداد كل مورد.
        </p>

        {showSuppliers && (
          <>
            <Section num={sn(2)} title="أعمار الديون" sub="المتبقي موزعاً حسب عدد الأيام منذ الاستحقاق"
                     explain={<ExplainDot metric="reportAgeing" values={{}} />} />
            <div className="table-scroll">
              <table className="rpt-table">
                <thead><tr><th>الفئة</th><th>عدد الفواتير</th><th className="ltr">المبلغ (ر.س)</th><th className="ltr">النسبة</th></tr></thead>
                <tbody>
                  {d.ageing.map((a: any) => (
                    <tr key={a.label}>
                      <td className="nowrap">{a.label}</td>
                      <td>{a.count ? ar(a.count) : '—'}</td>
                      <td className="ltr num">{a.amount ? sar(a.amount) : '—'}</td>
                      <td className="ltr num">{a.amount ? a.pct.toFixed(1) + '٪' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr>
                  <td>الإجمالي</td><td /><td className="ltr num">{sar(s.outstanding)}</td><td className="ltr num">100٪</td>
                </tr></tfoot>
              </table>
            </div>

            <Section num={sn(3)} title="جدول السداد القادم" sub="ما يجب دفعه ومتى — مرتباً بتاريخ الاستحقاق ومنسوباً لصاحبه" />
            <div className="table-scroll">
              <table className="rpt-table">
                <thead><tr><th>تاريخ الاستحقاق</th><th>الطرف</th><th>الفواتير</th><th>الحالة</th><th className="ltr">المبلغ (ر.س)</th></tr></thead>
                <tbody>
                  {d.schedule.map((x: any) => (
                    <tr key={x.date}>
                      <td className="nowrap">{x.date_ar}</td>
                      <td><PartyCell row={x} fallback="supplier" /></td>
                      <td className="nowrap">{invoiceCount(x.count)}</td>
                      <td className={'nowrap ' + (x.overdue ? 'red' : '')}>{x.status}</td>
                      <td className="ltr num">{sar(x.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {con && (
          <>
            <Section num={sn(4)} title="المقاولون" sub="الرصيد السالب (بالأحمر) مستحق «له»، والموجب (بالأخضر) مستحق «لنا»" />
            <div className="table-scroll wide">
              <table className="rpt-table">
                <thead><tr>
                  <th>المقاول</th><th>الرمز</th><th>المشاريع</th>
                  <th className="ltr">المستخلص (ر.س)</th><th className="ltr">المسدد (ر.س)</th>
                  <th className="ltr">الرصيد (ر.س)</th><th>آخر دفعة</th>
                </tr></thead>
                <tbody>
                  {con.rows.map((c: any) => {
                    const v = balanceView(c.balance ?? 0);
                    return (
                      <tr key={c.code}>
                        <td className="nowrap">{c.name}<span className="pill party contractor">مقاول</span></td>
                        <td className="ltr num">{c.code}</td>
                        <td className="nowrap muted">{formatProjects(c.projects)}</td>
                        <td className="ltr num">{sar(c.invoiced ?? 0)}</td>
                        <td className="ltr num">{sar(c.paid ?? 0)}</td>
                        <td className={'ltr num ' + v.cls}>
                          {sar(Math.abs(c.balance ?? 0))} <span className="balance-tag">{v.label}</span>
                        </td>
                        <td className="nowrap">{formatLastPayment(c.lastPayment)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot><tr>
                  <td>الإجمالي</td><td /><td />
                  <td className="ltr num">{sar(con.totals.invoiced)}</td>
                  <td className="ltr num">{sar(con.totals.paid)}</td>
                  <td className={'ltr num ' + balanceView(con.totals.balance).cls}>
                    {sar(Math.abs(con.totals.balance))} <span className="balance-tag">{balanceView(con.totals.balance).label}</span>
                  </td>
                  <td />
                </tr></tfoot>
              </table>
            </div>
          </>
        )}

        {d.notes.length > 0 && (
          <>
            <Section num={sn(5)} title="ملاحظات ومخاطر" sub="بنود تحتاج قراراً أو تصحيحاً في المصدر" />
            <div className="rpt-notes">
              {d.notes.map((n: any) => (
                <div key={n.title}>
                  <b>{n.title}</b>
                  <p>{n.body}</p>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="rpt-foot">
          <hr />
          <div className="signs">
            <div>إعداد — الإدارة المالية</div>
            <div>مراجعة — المدير المالي</div>
            <div>اعتماد — الإدارة التنفيذية</div>
          </div>
          <p className="muted">وثيقة داخلية · {m.serial}</p>
        </div>
      </div>
    </>
  );
}

/* ---------- الأطراف: المقاولون، الوسوم، اتجاه الرصيد ---------- */

const SCOPE_FALLBACK: Record<PartyScope, string> = {
  suppliers: 'كل الموردين',
  contractors: 'كل المقاولين',
  both: 'الموردون والمقاولون',
};
function defaultScopeLabel(p: PartyScope) { return SCOPE_FALLBACK[p]; }

/**
 * يستخرج قسم المقاولين من الحمولة إن كان الخادم يرسله.
 * يعيد null بصمت إن غاب — الواجهة تعمل مع خادم لم يُحدَّث بعد.
 */
export function contractorsSection(d: any): {
  rows: any[];
  totals: { invoiced: number; paid: number; balance: number };
  owed: number;
} | null {
  const c = d?.contractors;
  const rows: any[] = Array.isArray(c?.rows) ? c.rows : [];
  if (!c || rows.length === 0) return null;
  const sum = (k: string) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0);
  const totals = {
    invoiced: c.totals?.invoiced ?? sum('invoiced'),
    paid: c.totals?.paid ?? sum('paid'),
    balance: c.totals?.balance ?? sum('balance'),
  };
  // ما ندين به للمقاولين = مجموع الأرصدة السالبة (اتجاه «له»)
  const owed = rows.reduce((a, r) => a + Math.max(0, -(Number(r.balance) || 0)), 0);
  return { rows, totals, owed };
}

/** اتجاه الرصيد بعُرف التطبيق: سالب = «له» أحمر، موجب = «لنا» أخضر. */
function balanceView(balance: number) {
  if (balance < 0) return { cls: 'red', label: 'له' };
  if (balance > 0) return { cls: 'ok', label: 'لنا' };
  return { cls: 'muted', label: 'متوازن' };
}

/** وسم الطرف على أي صف يعرض وثيقة — من يخصّه هذا المبلغ. */
export function PartyPill({ kind }: { kind: 'supplier' | 'contractor' }) {
  return (
    <span className={'pill party ' + kind}>{kind === 'contractor' ? 'مقاول' : 'مورد'}</span>
  );
}

/** اسم الطرف + وسمه.
 *
 * Schedule rows carry the real owners inside `items[]` (one row can bundle
 * several invoices due the same day) — reading only row-level fields showed the
 * generic «موردون» while the backend had the names all along. One item → its
 * name; several → first name + «و N آخرون»; the row-level fields stay as the
 * fallback for tables that do put the name at the top level.
 */
export function PartyCell({ row, fallback }:
  { row: any; fallback: 'supplier' | 'contractor' }) {
  const items: any[] = Array.isArray(row?.items) ? row.items : [];
  const first = items[0];
  const kind: 'supplier' | 'contractor' =
    (first?.partyKind ?? row?.partyKind) === 'contractor' ? 'contractor'
    : (first?.partyKind ?? row?.partyKind) === 'supplier' ? 'supplier' : fallback;
  const name = first?.name ?? row?.partyName ?? row?.supplier ?? row?.contractor ?? null;
  const extra = items.length > 1 ? items.length - 1 : 0;
  const mixed = extra > 0 && items.some((i) => i.partyKind !== first.partyKind);
  return (
    <span className="nowrap" title={items.length > 1
      ? items.map((i) => `${i.name} — ${sar(i.amount)}`).join('\n') : undefined}>
      {name ?? <span className="muted">{kind === 'contractor' ? 'مقاولون' : 'موردون'}</span>}
      {extra > 0 && <span className="muted"> و{ar(extra)} آخرون</span>}
      {!mixed && <PartyPill kind={kind} />}
    </span>
  );
}

function formatProjects(p: unknown): string {
  if (Array.isArray(p)) return p.length ? p.join('، ') : '—';
  return typeof p === 'string' && p ? p : '—';
}

function formatLastPayment(lp: any): string {
  if (!lp) return '—';
  if (typeof lp === 'string') return arDate(lp);
  return `${arDate(lp.date)}${lp.amount != null ? ' · ' + sar(lp.amount) : ''}`;
}

const Meta = ({ label, value }: { label: string; value: string }) => (
  <div><span>{label}</span><b>{value}</b></div>
);
const RKpi = ({ label, value, cls, explain }:
  { label: string; value: string; cls?: string; explain?: ReactNode }) => (
  <div className="rpt-kpi"><span>{label}{explain}</span><b className={'num ' + (cls || '')}>{value}</b><i>ر.س</i></div>
);
const Section = ({ num, title, sub, explain }: { num: string; title: string; sub?: string; explain?: ReactNode }) => (
  <div className="rpt-section">
    <div><span className="badge">{num}</span><b>{title}</b>{explain}</div>
    {sub && <p>{sub}</p>}
  </div>
);

/* ==================== تبويب ٢: التحليل الدوري ==================== */

const GRANULARITIES: { value: 'quarter' | 'half' | 'year'; label: string }[] = [
  { value: 'quarter', label: 'ربع سنوي' },
  { value: 'half', label: 'نصف سنوي' },
  { value: 'year', label: 'سنوي' },
];
const YEARS = [2024, 2025, 2026];

function PeriodicTab({ account }: { account?: string }) {
  const [granularity, setGranularity] = useState<'quarter' | 'half' | 'year'>('quarter');
  const [year, setYear] = useState(2026);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const loadPeriodic = () => {
    const my = ++seq.current;
    setD(null); setErr(null);
    api.periodic(granularity, year, account)
      .then((r) => { if (my === seq.current) { setD(r); setErr(null); } })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => {
    loadPeriodic();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, year, account]);

  return (
    <>
      <div className="toolbar no-print" style={{ marginBottom: 16 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          التقسيم
          <select value={granularity} onChange={(e) => setGranularity(e.target.value as any)}>
            {GRANULARITIES.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--muted)' }}>
          السنة
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map((y) => <option key={y} value={y}>{ar(y)}</option>)}
          </select>
        </label>
        <a className="btn" href={api.exportExcelUrl({ granularity, year, account })} download>تصدير Excel</a>
      </div>

      {err && <ErrorState message={err} onRetry={loadPeriodic} />}
      {!err && !d && <State>جارٍ التحميل…</State>}
      {d && <PeriodicBody d={d} />}
    </>
  );
}

function PeriodicBody({ d }: { d: any }) {
  const periods = d.periods as any[];
  const hasIncomplete = periods.some((p) => p.complete === false);

  const completePeriods = periods.filter((p) => p.complete !== false);
  const lastPeriod = completePeriods.length > 0 ? completePeriods[completePeriods.length - 1] : periods[periods.length - 1];

  return (
    <div className="stack">
      <div className="callout note">
        التغطية المسجلة: {arDate(d.coverage?.first)} ← {arDate(d.coverage?.last)}
      </div>
      {hasIncomplete && (
        <div className="callout bad">
          بعض الفترات خارج التغطية — أرقامها جزئية حتى تُرفع كشوفات أقدم
        </div>
      )}

      <div className="card">
        <div className="cap"><h2>الفترات</h2></div>
        {/* ثمانية أعمدة لا تُحشر في أي عرض — الجدول ينزلق داخل حاويته ولا يلتف */}
        <div className="table-scroll wide">
          <table>
            <thead>
              <tr>
                <th>الفترة</th>
                <th className="ltr">الرصيد الافتتاحي (ر.س)</th>
                <th className="ltr">المفوتر (ر.س)</th>
                <th className="ltr">المسدد (ر.س)</th>
                <th className="ltr">صافي الحركة (ر.س)</th>
                <th className="ltr">الرصيد الختامي (ر.س)</th>
                <th className="ltr">متوسط عمر السداد</th>
              </tr>
            </thead>
            <tbody>
              {periods.map((p) => (
                <tr key={p.label} className={p.complete === false ? 'muted' : ''}>
                  <td className="nowrap">
                    {p.label}
                    {p.complete === false && <span className="pill warn" style={{ marginInlineStart: 6 }}>جزئي</span>}
                  </td>
                  <td className="ltr num">{sar(p.opening)}</td>
                  <td className="ltr num">{sar(p.invoiced)}</td>
                  <td className="ltr num">{sar(p.paid)}</td>
                  <td className="ltr num">{sar(p.net)}</td>
                  <td className="ltr num">{sar(p.closing)}</td>
                  <td className="ltr num">{p.avgSettlementDays != null ? ar(Math.round(p.avgSettlementDays)) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11, margin: 0, padding: '8px 20px 14px' }}>
          «جزئي» = الفترة خارج التغطية المسجلة، فأرقامها ناقصة حتى تُرفع كشوفات أقدم.
          متوسط عمر السداد بالأيام.
        </p>
      </div>

      <div className="card">
        <div className="cap"><h2>المقارنة</h2></div>
        <div className="table-scroll wide">
          <table>
            <thead>
              <tr>
                <th>الفترة</th>
                <th className="ltr">المسدد (ر.س)</th>
                <th className="ltr">الفترة السابقة (ر.س)</th>
                <th className="ltr">التغيّر ٪</th>
                <th className="ltr">نفس الفترة العام الماضي (ر.س)</th>
                <th className="ltr">التغيّر ٪</th>
              </tr>
            </thead>
            <tbody>
              {d.comparison.map((c: any) => (
                <tr key={c.label}>
                  <td className="nowrap">{c.label}</td>
                  <td className="ltr num">{sar(c.paid)}</td>
                  <td className="ltr num">{c.prevPaid != null ? sar(c.prevPaid) : '—'}</td>
                  <td className={'ltr num ' + pctCls(c.prevPct)}>{c.prevPct != null ? c.prevPct.toFixed(1) + '٪' : '—'}</td>
                  <td className="ltr num">{c.yoyPaid != null ? sar(c.yoyPaid) : '—'}</td>
                  <td className={'ltr num ' + pctCls(c.yoyPct)}>{c.yoyPct != null ? c.yoyPct.toFixed(1) + '٪' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {lastPeriod && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div className="card">
            <div className="cap"><h2>التوزيع على المشاريع</h2><p>{lastPeriod.label}</p></div>
            <div style={{ padding: '4px 20px 18px' }}>
              <ByProjectBars rows={lastPeriod.byProject ?? []} />
            </div>
          </div>
          <div className="card">
            <div className="cap"><h2>أعلى الموردين سداداً</h2><p>{lastPeriod.label}</p></div>
            <table>
              <thead><tr><th>المورد</th><th className="ltr">المسدد (ر.س)</th></tr></thead>
              <tbody>
                {(lastPeriod.topSuppliers ?? []).slice(0, 5).map((sup: any) => (
                  <tr key={sup.account}>
                    <td>{sup.name}</td>
                    <td className="ltr num">{sar(sup.paid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function pctCls(v: number | null | undefined) {
  if (v == null) return '';
  return v < 0 ? 'red' : 'ok';
}

function ByProjectBars({ rows }: { rows: { project: string; paid: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.paid));
  return (
    <div className="stack" style={{ gap: 10 }}>
      {rows.map((r) => (
        <div key={r.project}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
            <span>{r.project}</span>
            <span className="num">{sar(r.paid)}</span>
          </div>
          <div style={{ height: 6, borderRadius: 4, background: 'var(--tint)' }}>
            <div style={{ height: '100%', borderRadius: 4, background: 'var(--gold)', width: `${(r.paid / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {rows.length === 0 && <p className="muted">لا توجد بيانات</p>}
    </div>
  );
}

/* ==================== شرائح العرض ====================
   تُبنى من نفس بيانات التقرير — ما يُعرض على الإدارة لا يمكن أن يختلف عمّا في الشاشة. */

function reportSlides(d: any, parties: PartyScope = 'suppliers'): Slide[] {
  const m = d.meta, s = d.summary;
  const scope = m.scope_label ?? defaultScopeLabel(parties);
  const con = parties !== 'suppliers' ? contractorsSection(d) : null;
  const slides: Slide[] = [];

  // شريحة الغلاف — هوية الوثيقة قبل أي رقم، كما في تقرير A4 المطبوع
  slides.push({
    title: 'شركة إعمار الخليج المصرية للمقاولات',
    subtitle: m.department,
    body: (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', textAlign: 'center', gap: 10,
      }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.6px' }}>{m.title}</div>
        <div style={{ fontSize: 16, color: 'var(--muted)' }}>{scope} · {m.period}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 18 }}>
          رقم الوثيقة {m.serial} · {m.issued_on}
        </div>
      </div>
    ),
  });

  slides.push({
    title: m.title,
    subtitle: `${scope} · ${m.period}`,
    body: (
      <div className="slide-kpis">
        <Kpi label="إجمالي المفوتر" value={sar(s.total_invoiced)} unit="ر.س" />
        <Kpi label="المسدد" value={sar(s.total_paid)} unit="ر.س" tone="ok" />
        <Kpi label="المديونية المفتوحة" value={sar(s.outstanding)} unit="ر.س" />
        <Kpi label="المتأخر" value={sar(s.overdue)} unit="ر.س" tone="red" alert={s.overdue > 0} />
      </div>
    ),
  });

  if (d.ageing?.length) {
    slides.push({
      title: 'أعمار الديون',
      subtitle: `${scope} — المتبقي موزعاً حسب الأيام منذ الاستحقاق`,
      body: (
        <div className="table-scroll">
          <table>
            <thead><tr><th>الفئة</th><th>عدد الفواتير</th><th className="ltr">المبلغ</th><th className="ltr">النسبة</th></tr></thead>
            <tbody>
              {d.ageing.map((a: any) => (
                <tr key={a.label}>
                  <td className="nowrap">{a.label}</td>
                  <td>{a.count || '—'}</td>
                  <td className="ltr">{a.amount ? <Money v={a.amount} /> : '—'}</td>
                  <td className="ltr num">{a.amount ? a.pct.toFixed(1) + '٪' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    });
  }

  if (d.schedule?.length) {
    slides.push({
      title: 'جدول السداد القادم',
      subtitle: `${scope} — ما يجب دفعه ومتى`,
      body: (
        <div className="table-scroll">
          <table>
            <thead><tr><th>تاريخ الاستحقاق</th><th>الطرف</th><th>الفواتير</th><th>الحالة</th><th className="ltr">المبلغ</th></tr></thead>
            <tbody>
              {d.schedule.slice(0, 10).map((x: any) => (
                <tr key={x.date}>
                  <td className="nowrap">{x.date_ar}</td>
                  <td><PartyCell row={x} fallback="supplier" /></td>
                  <td>{x.count}</td>
                  <td className={'nowrap ' + (x.overdue ? 'red' : '')}>{x.status}</td>
                  <td className="ltr"><Money v={x.amount} cls={x.overdue ? 'red' : ''} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    });
  }

  if (d.suppliers?.length > 1) {
    slides.push({
      title: 'أعلى الموردين مديونية',
      subtitle: scope,
      body: (
        <div className="table-scroll">
          <table>
            <thead><tr><th>المورد</th><th>المشروع</th><th className="ltr">المديونية</th><th className="ltr">المتأخر</th></tr></thead>
            <tbody>
              {d.suppliers.slice(0, 8).map((x: any) => (
                <tr key={x.account}>
                  <td className="nowrap">{x.name}<PartyPill kind="supplier" /></td>
                  <td className="muted">{x.project}</td>
                  <td className="ltr"><Money v={x.outstanding} /></td>
                  <td className="ltr">{x.overdue > 0 ? <Money v={x.overdue} cls="red" /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    });
  }

  // شريحة المقاولين — تظهر فقط حين يشملهم النطاق، فلا يرى الحضور قسماً فارغاً
  if (con) {
    const top = [...con.rows]
      .sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))
      .slice(0, 6);
    slides.push({
      title: 'المقاولون',
      subtitle: `${scope} — الإجمالي وأعلى الأرصدة`,
      body: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="slide-kpis">
            <Kpi label="إجمالي المستخلصات" value={sar(con.totals.invoiced)} unit="ر.س" />
            <Kpi label="المسدد للمقاولين" value={sar(con.totals.paid)} unit="ر.س" tone="ok" />
            <Kpi label="مستحق لهم" value={sar(con.owed)} unit="ر.س" tone="red" alert={con.owed > 0} />
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>المقاول</th><th>المشاريع</th><th className="ltr">الرصيد</th></tr></thead>
              <tbody>
                {top.map((c: any) => {
                  const v = balanceView(c.balance ?? 0);
                  return (
                    <tr key={c.code}>
                      <td className="nowrap">{c.name}<PartyPill kind="contractor" /></td>
                      <td className="muted nowrap">{formatProjects(c.projects)}</td>
                      <td className={'ltr num ' + v.cls}>
                        {sar(Math.abs(c.balance ?? 0))} <span className="balance-tag">{v.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ),
    });
  }

  if (d.notes?.length) {
    slides.push({
      title: 'ملاحظات ومخاطر',
      subtitle: scope,
      body: (
        <div>
          {d.notes.map((n: any) => (
            <div key={n.title} style={{ marginBottom: 18 }}>
              <b style={{ fontSize: 18, display: 'block', marginBottom: 4 }}>{n.title}</b>
              <p style={{ margin: 0, fontSize: 15, color: 'var(--muted)' }}>{n.body}</p>
            </div>
          ))}
        </div>
      ),
    });
  }

  // شريحة ختامية — الإجراءات المطلوبة، مُشتقّة من الأرقام نفسها لا نصاً ثابتاً
  const overdueCount = d.schedule?.filter((x: any) => x.overdue).length ?? 0;
  const nextDue = d.schedule?.find((x: any) => !x.overdue);
  const actions: { text: string; tone?: string }[] = [];
  if (s.overdue > 0) {
    actions.push({
      text: `تسوية ${sar(s.overdue)} ر.س متأخرة (${ar(overdueCount)} موعد استحقاق تجاوزته الفواتير) — أولوية فورية`,
      tone: 'red',
    });
  }
  if (nextDue) {
    actions.push({ text: `تجهيز ${sar(nextDue.amount)} ر.س لاستحقاق ${nextDue.date_ar}` });
  }
  // استحقاق المقاولين بند مستقل — لا يُدفن داخل أرقام الموردين
  if (con && con.owed > 0) {
    const worst = [...con.rows].sort((a, b) => (a.balance ?? 0) - (b.balance ?? 0))[0];
    actions.push({
      text: `استحقاق مقاولين ${sar(con.owed)} ر.س مستحقة لهم`
        + (worst && (worst.balance ?? 0) < 0
          ? ` — أعلاها ${worst.name} بمبلغ ${sar(Math.abs(worst.balance))} ر.س` : ''),
      tone: 'red',
    });
  }
  if (d.notes?.some((n: any) => n.title === 'موردو المستخلصات')) {
    actions.push({ text: 'استكمال تواريخ استحقاق فواتير موردي المستخلصات يدوياً' });
  }
  if (actions.length === 0) {
    actions.push({ text: 'لا التزامات متأخرة أو عاجلة في نطاق هذا التقرير — لا إجراء مطلوب الآن', tone: 'ok' });
  }

  slides.push({
    title: 'الإجراءات المطلوبة',
    subtitle: scope,
    body: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 6 }}>
        {actions.map((a, i) => (
          <div key={i} style={{
            display: 'flex', alignItems: 'center', gap: 12,
            padding: '14px 18px', borderRadius: 8,
            border: `1px solid ${a.tone === 'red' ? 'var(--red)' : a.tone === 'ok' ? 'var(--ok)' : 'var(--hair)'}`,
            background: a.tone === 'red' ? 'var(--wash-red)' : a.tone === 'ok' ? 'var(--wash-ok)' : 'transparent',
          }}>
            <span style={{
              fontSize: 20, fontWeight: 700, color: 'var(--gold)', minWidth: 26,
            }}>{ar(i + 1)}</span>
            <span style={{ fontSize: 15, color: a.tone === 'red' ? 'var(--red)' : 'var(--ink)' }}>{a.text}</span>
          </div>
        ))}
      </div>
    ),
  });

  return slides;
}
