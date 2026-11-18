/**
 * وجهة «التقرير» (reports.report — تحلّ محل /report).
 * تبويبات: تقرير الفترة (لوحة إعداد + ورقة A4) · ملخّص بالمشروع · التحليل الدوري.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAiEnabled } from '@/lib/useAi';
import { Button, Chip, EmptyState, PageHeader, Seg, Skeleton, Tabs, fmt, toast, usePrefs } from './uikit';
import { requestAiSummary, useAnalysis, useScopes } from './hooks';
import { SECTIONS, buildGmReport, loadPrefs, reportText, savePrefs, type ReportPrefs, type SectionKey } from './model';
import { analysisExportUrl, copyText, download, exportPdf, pdfNames } from './exports';
import { useReportParams } from './useReportParams';
import { ReportPaper } from './ReportPaper';
import { ProjectSummaryTab } from './ProjectSummaryTab';
import { PeriodicTab } from './PeriodicTab';
import { ScopeSelect } from './ScopeSelect';
import type { PartyScope } from './types';
import './reports.css';

const PARTY_OPTS: { value: PartyScope; label: string }[] = [
  { value: 'suppliers', label: 'الموردون' }, { value: 'contractors', label: 'المقاولون' }, { value: 'both', label: 'الاثنان' },
];

export default function ReportView() {
  const rp = useReportParams();
  return (
    <>
      <div className="rp-noprint"><PageHeader title="التقرير" sub="جاهز للطباعة أو الحفظ بصيغة PDF" /></div>
      <div className="rp-tabs rp-noprint">
        <Tabs label="نوع التقرير" value={rp.tab as 'period' | 'project' | 'periodic'} onChange={rp.setTab}
          tabs={[{ value: 'period', label: 'تقرير الفترة' }, { value: 'project', label: 'ملخّص بالمشروع' }, { value: 'periodic', label: 'التحليل الدوري' }]} />
      </div>
      {rp.tab === 'project' ? <ProjectSummaryTab /> : rp.tab === 'periodic' ? <PeriodicTab account={rp.params.account} /> : <PeriodTab />}
    </>
  );
}

function PeriodTab() {
  usePrefs();
  const rp = useReportParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const scopes = useScopes();
  const q = useAnalysis(rp.params);
  const ai = useAiEnabled();
  const [prefs, setPrefsState] = useState<ReportPrefs>(loadPrefs);
  const [saved, setSaved] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);

  const setPrefs = (p: Partial<ReportPrefs>) => setPrefsState((cur) => ({ ...cur, ...p }));
  useEffect(() => {
    const t = setTimeout(() => { savePrefs(prefs); setSaved(true); }, 300);
    return () => clearTimeout(t);
  }, [prefs]);
  const paramsKey = JSON.stringify(rp.params);
  useEffect(() => { setAiDraft(null); }, [paramsKey]); // مسودة نطاق قديم لا تبقى

  const report = useMemo(() => (q.data ? buildGmReport(q.data, rp.parties) : null), [q.data, rp.parties]);

  async function pdf() {
    setPdfBusy(true);
    const r = await exportPdf(pdfNames.report(), prefs.landscape);
    setPdfBusy(false);
    if (r.error) toast('تعذّر إنشاء PDF: ' + r.error, { kind: 'error' });
    else if (r.path) toast('حُفظ PDF', { kind: 'ok' });
  }
  async function runAi() {
    setAiBusy(true);
    try { setAiDraft(await requestAiSummary(rp.params)); }
    catch (e) { toast(e instanceof Error ? e.message : String(e), { kind: 'error' }); }
    finally { setAiBusy(false); }
  }
  const toggle = (k: SectionKey) => setPrefs({ sections: { ...prefs.sections, [k]: !prefs.sections[k] } });

  return (
    <div className={'rp-layout' + (prefs.landscape ? ' rp-print-landscape' : ' rp-print-portrait')}>
      <aside className="isl rp-ctrl rp-noprint" aria-label="إعداد التقرير">
        <div className="ih"><h2>إعداد التقرير</h2></div>
        <ScopeSelect scopes={scopes.data} value={rp.scope} onChange={(scope) => rp.patch({ scope })} />
        <div className="rp-f"><span>الأطراف</span>
          <Seg label="الأطراف" value={rp.parties} onChange={(parties) => rp.patch({ parties })} options={PARTY_OPTS} /></div>
        <div className="rp-f2">
          <label className="rp-f"><span>من</span><input type="date" value={rp.from} max={rp.to} onChange={(e) => e.target.value && rp.patch({ from: e.target.value })} /></label>
          <label className="rp-f"><span>إلى</span><input type="date" value={rp.to} min={rp.from} onChange={(e) => e.target.value && rp.patch({ to: e.target.value })} /></label>
        </div>
        <label className="rp-f"><span>تاريخ الإصدار (الترويسة فقط)</span>
          <input type="date" value={prefs.issue ?? ''} onChange={(e) => setPrefs({ issue: e.target.value || null })} /></label>
        <div className="rp-f"><span>الأقسام</span>
          <div className="rp-toggles">{SECTIONS.map((s) => <Chip key={s.key} pressed={prefs.sections[s.key]} onClick={() => toggle(s.key)}>{s.label}</Chip>)}</div></div>
        <div className="rp-f"><span>اتجاه الورقة</span>
          <Seg label="اتجاه الورقة" value={prefs.landscape ? 'l' : 'p'} onChange={(v) => setPrefs({ landscape: v === 'l' })}
            options={[{ value: 'p', label: 'عمودي A4' }, { value: 'l', label: 'أفقي A4' }]} /></div>
        <label className="rp-f"><span>ملاحظة تنفيذية {saved && <small className="rp-saved" aria-live="polite">· حُفظت</small>}</span>
          <textarea rows={4} value={prefs.note} placeholder="تظهر أعلى التقرير — تُحفظ تلقائياً"
            onChange={(e) => { setSaved(false); setPrefs({ note: e.target.value }); }} /></label>
      </aside>

      <div className="rp-main">
        <div className="rp-actbar rp-noprint">
          {report && <span className="pill n">{report.scopeLabel}</span>}
          <span className="rp-grow" />
          {(ai.loading || ai.enabled) && (
            <Button onClick={runAi} disabled={ai.loading || aiBusy || !report}>{aiBusy ? 'جارٍ الصياغة…' : 'الملخص التنفيذي (AI)'}</Button>
          )}
          <Button onClick={() => nav('/reports/present?' + sp.toString())} disabled={!report}>عرض تقديمي</Button>
          <Button disabled={!report} onClick={async () => {
            if (!report) return;
            const ok = await copyText(reportText(report, prefs, fmt));
            toast(ok ? 'نُسخ التقرير نصاً' : 'تعذّر النسخ', { kind: ok ? 'ok' : 'error' });
          }}>نسخ كنص</Button>
          <Button onClick={() => download(analysisExportUrl(rp.params))}>تصدير Excel</Button>
          <Button kind="primary" disabled={!report || pdfBusy} onClick={pdf}>{pdfBusy ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}</Button>
        </div>
        <div className="rp-paper-wrap">
          {q.error && <EmptyState icon={null} title="تعذّر إعداد التقرير" body={q.error} cta="إعادة المحاولة" onCta={q.reload} />}
          {!q.error && !report && <Skeleton rows={8} />}
          {report && <ReportPaper r={report} prefs={prefs} aiDraft={aiDraft} onCloseAi={() => setAiDraft(null)} />}
        </div>
      </div>
    </div>
  );
}
