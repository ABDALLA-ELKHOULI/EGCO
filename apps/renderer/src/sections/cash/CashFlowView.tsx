/**
 * «التدفق النقدي» — cash.flow. أرقام الخادم أولاً؛ الطبقة الوحيدة المحسوبة هنا هي السيناريو
 * (logic/scenario.ts) فوق فترات الخادم، والأصل يبقى ظاهراً بجانبه. خريطة البنود: PARITY-cash.md.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button, EmptyState, Grid, Island, LineChart, Money, PageHeader, Seg, Skeleton, dateTxt, digits, fmt, parseNum, usePrefs,
} from '@/ui';
import { useBankBalance, useCashflow, useSaveBankBalance, useScenarioRows } from './hooks';
import { toH } from './logic/money';
import {
  HORIZONS, PERIOD_DAYS_DEFAULT, PERIOD_PRESETS, clampPeriodDays, loadPrefs, parseParties, periodDaysLabel, savePrefs,
} from './logic/prefs';
import { applyScenario, assertBaselineMatches, loadScenario, saveScenario, toItems, type Tweak } from './logic/scenario';
import type { CashflowQuery, Parties } from './types';
import { BarsStrip } from './parts/BarsStrip';
import { BreakdownModal, type BreakdownRequest } from './parts/BreakdownModal';
import { ExplainDot } from './parts/ExplainDot';
import { KpiCarousel } from './parts/KpiCarousel';
import { PeriodTable } from './parts/PeriodTable';
import { ReconFooter } from './parts/ReconFooter';
import { ScenarioPanel } from './parts/ScenarioPanel';
import './cash.css';

const PARTIES_OPTS: { value: Parties; label: string }[] = [
  { value: 'both', label: 'كلاهما' }, { value: 'suppliers', label: 'موردون' }, { value: 'contractors', label: 'مقاولون' },
];

export default function CashFlowView() {
  usePrefs();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const project = params.get('project') || '';
  const parties = parseParties(params.get('parties'));
  const rawPd = Number(params.get('period_days'));
  const periodDays = Number.isFinite(rawPd) && rawPd >= 1 && rawPd <= 92 ? Math.round(rawPd) : PERIOD_DAYS_DEFAULT;
  const setParam = (k: string, v: string | null) => {
    const p = new URLSearchParams(params);
    if (v == null) p.delete(k); else p.set(k, v);
    setParams(p, { replace: true });
  };

  const [prefs, setPrefsState] = useState(loadPrefs);
  useEffect(() => { savePrefs(prefs); }, [prefs]);

  /* الرصيد الافتتاحي: محفوظ على الخادم إن دعمه (B)، وإلا حقل يدوي غير محفوظ (P-208) */
  const bank = useBankBalance();
  const bankSupported = bank.data !== null && bank.data !== undefined;
  const [manualOpening, setManualOpening] = useState(0);
  // مع رصيد محفوظ لا نرسل opening_balance إطلاقاً — الخادم يبدأ منه (مصدر واحد مع /today)
  const opening: number | null = bank.data === null ? manualOpening : null; // null فقط = خادم بلا المسار (404)
  const saveBank = useSaveBankBalance();

  const q: CashflowQuery = { weeks: prefs.weeks, openingBalance: opening, project, parties, periodDays };
  const cf = useCashflow(q);
  const d = cf.data;

  /* السيناريو */
  const [tweaks, setTweaks] = useState<Tweak[]>(() => loadScenario() ?? []);
  const [saved, setSaved] = useState(() => loadScenario() != null);
  const [scnOpen, setScnOpen] = useState(false);
  const changeTweaks = (t: Tweak[]) => { setTweaks(t); setSaved(false); if (!t.length) saveScenario(null); };
  const rows = useScenarioRows(q, scnOpen || tweaks.length > 0);
  const items = useMemo(() => ({
    scheduled: [...toItems(rows.scheduled?.rows ?? [], 'out', false), ...toItems(rows.forecast?.rows ?? [], 'in', false)],
    overdue: toItems(rows.overdue?.rows ?? [], 'out', true),
  }), [rows.scheduled, rows.forecast, rows.overdue]);
  const res = useMemo(() => (d ? applyScenario(d.periods, d.openingBalance, items, tweaks) : null), [d, items, tweaks]);
  const baselineBad = useMemo(() => (d ? assertBaselineMatches(d.periods, d.openingBalance) : null), [d]);
  const scenario = tweaks.length > 0;

  const [bd, setBd] = useState<BreakdownRequest | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  const pinAndScroll = (i: number | null) => {
    setPinned(i);
    if (i == null) return;
    requestAnimationFrame(() => {
      const el = tbody.current?.querySelector(`tr[data-idx="${i}"]`);
      el?.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  useEffect(() => { setPinned(null); }, [prefs.weeks, periodDays, parties, project]);

  const head = (
    <PageHeader title="التدفق النقدي"
      sub={`هل يكفي النقد؟ الرصيد المتوقع بفترات ${periodDaysLabel(periodDays, digits)} من الاستحقاقات والتحصيلات المسجّلة`}
      actions={<>
        <Seg label="الأفق" value={String(prefs.weeks)} onChange={(v) => setPrefsState((p) => ({ ...p, weeks: Number(v) }))}
          options={HORIZONS.map((h) => ({ value: String(h.weeks), label: h.label }))} />
        <ExplainDot metric="cashflowHorizon" values={{ periodDays }} />
        <Button kind={scnOpen || scenario ? 'primary' : undefined} aria-expanded={scnOpen} onClick={() => setScnOpen((o) => !o)}>
          سيناريو +{scenario && <span className="sec-cash-badge">{digits(tweaks.length)}</span>}
        </Button>
      </>} />
  );

  const isCustom = !PERIOD_PRESETS.some((p) => p.days === periodDays);
  const [customDays, setCustomDays] = useState(String(periodDays));
  const [customOpen, setCustomOpen] = useState(isCustom);
  const applyCustom = () => { const n = clampPeriodDays(Number(customDays)); setParam('period_days', n === PERIOD_DAYS_DEFAULT ? null : String(n)); };
  const filters = (
    <div className="sec-cash-filters">
      <Seg label="الأطراف" value={parties} onChange={(v) => setParam('parties', v === 'both' ? null : v)} options={PARTIES_OPTS} />
      <label className="sec-cash-sel"><span className="cap">المشروع</span>
        <select value={project} onChange={(e) => setParam('project', e.target.value || null)}>
          <option value="">كل المشاريع</option>
          {(d?.projects ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
        </select></label>
      <label className="sec-cash-sel"><span className="cap">طول الفترة</span>
        <select value={customOpen || isCustom ? 'custom' : String(periodDays)} onChange={(e) => {
          if (e.target.value === 'custom') { setCustomOpen(true); setCustomDays(String(periodDays)); return; }
          setCustomOpen(false); const n = Number(e.target.value); setParam('period_days', n === PERIOD_DAYS_DEFAULT ? null : String(n));
        }}>
          {PERIOD_PRESETS.map((p) => <option key={p.days} value={p.days}>{p.label} ({digits(p.days)} يوماً){p.days === PERIOD_DAYS_DEFAULT ? ' — الافتراضي' : ''}</option>)}
          <option value="custom">مخصّص…</option>
        </select></label>
      {(customOpen || isCustom) && (
        <label className="sec-cash-sel"><span className="cap">أيام (١–٩٢)</span>
          <input className="sec-cash-in sec-cash-days" type="number" dir="ltr" min={1} max={92} value={customDays}
            onChange={(e) => setCustomDays(e.target.value)} onBlur={applyCustom} onKeyDown={(e) => { if (e.key === 'Enter') applyCustom(); }} /></label>
      )}
      {!bankSupported && !bank.isLoading && (
        <OpeningField value={manualOpening} onApply={setManualOpening} />
      )}
    </div>
  );

  /* إعداد الرصيد البنكي — فقط حين يدعمه الخادم ولم يُدخل بعد */
  if (bankSupported && bank.data?.balance == null) {
    return (<div className="sec-cash">{head}<Grid><BankSetup busy={saveBank.isPending} onSave={(v) => saveBank.mutate(v)} /></Grid></div>);
  }
  if (cf.error && !d) {
    return (<div className="sec-cash">{head}<Grid><Island span={12}>
      <div className="sec-cash-call w"><span>تعذّر تحميل التدفق النقدي: {cf.error.message}</span><Button size="sm" onClick={() => cf.refetch()}>أعد المحاولة</Button></div>
    </Island></Grid></div>);
  }
  if (!d || !res) return (<div className="sec-cash">{head}{filters}<Grid><Island span={12}><Skeleton rows={8} /></Island></Grid></div>);

  const s = d.summary;
  const allZero = d.periods.length > 0 && d.periods.every((p) => p.inflow === 0 && p.outflow === 0);
  const firstNeg = scenario ? res.firstDeficitIndex : (s.firstDeficit ? d.periods.findIndex((p) => p.from === s.firstDeficit!.from) : -1);
  const minIdx = scenario ? res.minIndex : d.periods.findIndex((p) => toH(p.balance) === toH(s.minBalance));
  const cur = scenario
    ? { totalInflow: res.totalInflow, totalOutflow: res.totalOutflow, netTotal: res.netTotal, minBalance: res.minBalance, scenario: true }
    : { totalInflow: s.totalInflow, totalOutflow: s.totalOutflow, netTotal: s.netTotal, minBalance: s.minBalance, scenario: false };
  const end = res.endBalance;
  const lastTo = d.periods.length ? d.periods[d.periods.length - 1].to : d.asOf;

  return (
    <div className="sec-cash">
      {head}
      {filters}
      <div className="sec-cash-calls">
        {!s.hasReceivables && (
          <div className="sec-cash-call w"><span>{d.warnings.length ? d.warnings.join(' — ') : 'لم تُرفع بيانات التحصيلات بعد — الداخل أدناه ليس تقديراً فعلياً.'} <b>الداخل صفر ليس تقديراً</b>، بل غياب بيانات.</span>
            <Button size="sm" onClick={() => nav('/cash/revenues?new=1')}>أضف تحصيلاً</Button></div>
        )}
        {s.hasReceivables && d.warnings.length > 0 && <div className="sec-cash-call w"><span>{d.warnings.join(' — ')}</span></div>}
        {s.firstDeficit && !scenario && (
          <div className="sec-cash-call d"><span>أول عجز متوقع في {dateTxt(s.firstDeficit.from)} — {dateTxt(s.firstDeficit.to)} بمقدار <Money value={Math.abs(s.firstDeficit.amount)} /></span>
            <Button size="sm" onClick={() => pinAndScroll(firstNeg)}>اعرض الفترة</Button></div>
        )}
        {parties !== 'suppliers' && d.undatedContractorDues > 0 && (
          <div className="sec-cash-call w"><span>مستحق للمقاولين بلا تواريخ استحقاق <Money value={d.undatedContractorDues} /> — <b>غير موزّع على المنحنى</b> لأن دفاتر المقاولين لا تحمل تواريخ.</span>
            <Button size="sm" onClick={() => setBd({ term: 'undated', title: 'بلا تواريخ', amount: d.reconciliation.outflow?.undated ?? d.undatedContractorDues, rule: 'فواتير موردين بلا تاريخ استحقاق، أو رصيد مقاولين مستحق يتجاوز ما لهم من ضمانات مؤرَّخة.' })}>التفاصيل</Button></div>
        )}
        {project && d.contractorBalanceScopeNote && <div className="sec-cash-call i"><span>{d.contractorBalanceScopeNote}</span></div>}
        {scenario && (
          <div className="sec-cash-call s"><span><b>{saved ? 'سيناريو محفوظ مطبَّق' : 'سيناريو مؤقت'}</b> — الخط المتقطع هو الأصل من الخادم. الفرق في النهاية: <Money value={end - res.baseEndBalance} className={end - res.baseEndBalance < 0 ? 't-danger' : 't-ok'} />{res.pushedBeyond.out > 0 && <> · دُفع خارج الأفق <Money value={res.pushedBeyond.out} /></>}</span>
            <Button size="sm" onClick={() => setScnOpen(true)}>عدّل</Button></div>
        )}
        {baselineBad != null && (
          <div className="sec-cash-call d"><span>تنبيه داخلي: إعادة بناء الرصيد من الفترات لا تطابق الخادم في الفترة {digits(baselineBad + 1)} — أرقام السيناريو غير موثوقة، والأرقام الأصلية سليمة.</span></div>
        )}
      </div>

      <Grid>
        <Island span={12} crit={firstNeg >= 0} title={<>الرصيد بعد {HORIZONS.find((h) => h.weeks === prefs.weeks)?.label}{scenario ? ' (سيناريو)' : ''}{' '}
          <ExplainDot metric="end" subst={`${fmt(d.openingBalance)} + ${fmt(cur.totalInflow)} − ${fmt(cur.totalOutflow)} = ${fmt(end)}`} /></>}
          actions={firstNeg >= 0
            ? <button className="pill d sec-cash-pillbtn" onClick={() => pinAndScroll(firstNeg)}>عجز من {dateTxt(d.periods[firstNeg].from, { weekday: true })}</button>
            : <span className="pill o">لا عجز في هذا الأفق</span>}>
          <div className={'hero ' + (end < 0 ? 't-danger' : '')}><Money value={end} count countKey="cash-end" />{end < 0 && <span className="sec-cash-sw t-danger">عجز</span>}</div>
          <div className="meta">
            <span>أدنى رصيد <Money value={cur.minBalance} className={cur.minBalance < 0 ? 't-danger' : ''} />{minIdx >= 0 && <> في {dateTxt(d.periods[minIdx].from)}</>}</span>
            <span>{d.openingBalanceSource === 'bank' ? 'البنك' : 'الرصيد الافتتاحي'}{bankSupported && bank.data?.at ? ` (${dateTxt(bank.data.at)})` : ''} <Money value={d.openingBalance} />{bankSupported && <> <BankEdit current={bank.data?.balance ?? 0} busy={saveBank.isPending} onSave={(v) => saveBank.mutate(v)} /></>}</span>
            <span>حتى {dateTxt(lastTo)}</span>
          </div>
          {allZero ? (
            <EmptyState icon="inbox" title="لا حركة نقدية في هذا الأفق"
              body="لا داخل ولا خارج مسجَّل لأي فترة ضمن هذا الأفق — راجع شاشة التحصيلات وتأكد من رفع الملفات اللازمة."
              cta="التحصيلات" onCta={() => nav('/cash/revenues')} />
          ) : (
            <div className="sec-cash-chartwrap">
              <LineChart label={`الرصيد المتوقع خلال ${digits(d.periods.length)} فترة`}
                dates={res.periods.map((p) => p.from)}
                series={[
                  { name: scenario ? 'الرصيد (سيناريو)' : 'الرصيد المتوقع', values: res.periods.map((p) => p.balance) },
                  ...(scenario ? [{ name: 'بلا سيناريو', values: d.periods.map((p) => p.balance), dashed: true, color: 'var(--text-3)' }] : []),
                ]} />
              <BarsStrip periods={res.periods} pinned={pinned} onPin={pinAndScroll} />
              <div className="legend">
                <span><i className="sec-cash-lg-bal" />الرصيد</span>{scenario && <span><i className="sec-cash-lg-base" />بلا سيناريو</span>}
                <span><i className="sec-cash-lg-in" />{s.hasReceivables ? 'داخل' : 'لا بيانات تحصيلات'}</span>
                <span><i className="sec-cash-lg-out" />خارج</span><span><i className="sec-cash-lg-neg" />خارج (عجز)</span>
              </div>
            </div>
          )}
        </Island>

        {scnOpen && (
          <ScenarioPanel tweaks={tweaks} onChange={changeTweaks} saved={saved}
            onSave={() => { saveScenario(tweaks); setSaved(true); }}
            scheduled={items.scheduled} overdue={items.overdue} loading={rows.loading} error={rows.error}
            truncated={rows.truncated} skipped={res.skipped} project={project} />
        )}

        <KpiCarousel d={d} cur={cur} view={prefs.kpiView} onView={(i) => setPrefsState((p) => ({ ...p, kpiView: i }))}
          onOpen={setBd} onJumpMin={() => pinAndScroll(minIdx >= 0 ? minIdx : null)} />

        <Island span={12} title={<>جدول الفترات <span className="cap">كل صف = {periodDaysLabel(periodDays, digits)}</span> <ExplainDot metric="cashflowColumns" /></>}>
          {d.periods.length === 0 ? <div className="sec-cash-empty">لا توجد بيانات لهذه الفترة.</div>
            : <PeriodTable ref={tbody} periods={res.periods} scenario={scenario} pinned={pinned} onPin={setPinned} onOpen={setBd} />}
        </Island>

        <Island span={12} className="sec-cash-recon">
          <ReconFooter recon={d.reconciliation} note={d.reconciliationNote} parties={parties} project={project}
            onOpen={setBd} scenarioActive={scenario} />
        </Island>
      </Grid>

      <BreakdownModal req={bd} query={q} onClose={() => setBd(null)} />
    </div>
  );
}

/** حقل الرصيد الافتتاحي اليدوي — حين لا يحفظ الخادم رصيداً بنكياً بعد. يُطبَّق بزر (كالقديم). */
function OpeningField({ value, onApply }: { value: number; onApply: (v: number) => void }) {
  const [txt, setTxt] = useState(value ? String(value) : '');
  const [bad, setBad] = useState(false);
  const apply = () => { const v = txt.trim() === '' ? 0 : parseNum(txt); if (v == null || Number.isNaN(v)) { setBad(true); return; } setBad(false); onApply(v); };
  return (
    <form className="sec-cash-sel sec-cash-open" onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <span className="cap">الرصيد الافتتاحي (ر.س) — غير محفوظ</span>
      <span className="sec-cash-askrow">
        <input className={'sec-cash-in' + (bad ? ' sec-cash-shake' : '')} aria-invalid={bad} inputMode="decimal" dir="ltr" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="0.00" />
        <Button size="sm" kind="primary" type="submit">تطبيق</Button>
      </span>
    </form>
  );
}

function BankSetup({ busy, onSave }: { busy: boolean; onSave: (v: number) => void }) {
  const [txt, setTxt] = useState(''); const [bad, setBad] = useState(false);
  return (
    <section className="isl c12 sec-cash-setup">
      <h2>كم في البنك اليوم؟</h2>
      <p className="sec-cash-lead">لا نعرض توقّعاً قبل أن نعرف نقطة البداية — صفر أخضر هنا كان سيوحي بالأمان وهو مجرد غياب بيانات.</p>
      <form className="sec-cash-setf" onSubmit={(e) => { e.preventDefault(); const v = parseNum(txt); if (v == null || Number.isNaN(v)) { setBad(true); return; } onSave(v); }}>
        <label><span className="cap">الرصيد البنكي اليوم (ر.س)</span>
          <input name="bal" className={bad ? 'sec-cash-shake' : ''} aria-invalid={bad} inputMode="decimal" dir="ltr" placeholder="0.00" autoComplete="off" required autoFocus value={txt} onChange={(e) => setTxt(e.target.value)} /></label>
        <Button kind="primary" type="submit" disabled={busy}>احفظ وتابع</Button>
      </form>
      <p className="cap">يُحفظ ويُستخدم في كل زيارة. يمكن أن يكون سالباً (سحب على المكشوف).</p>
    </section>
  );
}

function BankEdit({ current, busy, onSave }: { current: number; busy: boolean; onSave: (v: number) => void }) {
  const [open, setOpen] = useState(false); const [txt, setTxt] = useState(String(current));
  if (!open) return <button className="sec-cash-lnk" onClick={() => { setTxt(String(current)); setOpen(true); }}>تعديل الرصيد</button>;
  return (
    <form className="sec-cash-askrow" onSubmit={(e) => { e.preventDefault(); const v = parseNum(txt); if (v == null || Number.isNaN(v)) return; onSave(v); setOpen(false); }}>
      <input className="sec-cash-in" aria-label="الرصيد البنكي" inputMode="decimal" dir="ltr" value={txt} onChange={(e) => setTxt(e.target.value)} autoFocus />
      <Button size="sm" kind="primary" type="submit" disabled={busy}>حفظ</Button>
      <Button size="sm" kind="ghost" type="button" onClick={() => setOpen(false)}>إلغاء</Button>
    </form>
  );
}
