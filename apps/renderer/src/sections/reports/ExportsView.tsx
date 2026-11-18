/**
 * وجهة «التصدير» — كل ما يُرسل للمحاسب أو المدير في مكان واحد. كل بطاقة مسار خادم
 * حقيقي (XLSX) أو PDF عبر Electron — لا «نسخ فقط» كما في النموذج المنشور.
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid, Modal, PageHeader, Seg, digits, toast } from './uikit';
import { useScopes } from './hooks';
import {
  CATALOG, CONTRACTOR_EXPORT_GROUPS, analysisExportUrl, budgetExportUrl, contractorsExportUrl, download,
  periodicExportUrl, projectSummaryExportUrl, suppliersExportUrl, type CatalogKey, type ContractorExportFormat,
} from './exports';
import { DEFAULT_FROM, todayIso, type ScopeValue } from './useReportParams';
import { ScopeSelect } from './ScopeSelect';
import type { Granularity, PartyScope } from './types';
import './reports.css';

const THIS_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: THIS_YEAR - 2023 }, (_, i) => THIS_YEAR - i);
const PARTY_OPTS: { value: PartyScope; label: string }[] = [
  { value: 'suppliers', label: 'الموردون' }, { value: 'contractors', label: 'المقاولون' }, { value: 'both', label: 'الاثنان' },
];

function scopeToParams(s: ScopeValue): { account?: string; project?: string; contractor?: string } {
  const i = s.indexOf(':');
  if (i < 0) return {};
  const k = s.slice(0, i), v = s.slice(i + 1);
  return k === 'supplier' ? { account: v } : k === 'project' ? { project: v } : { contractor: v };
}

export default function ExportsView() {
  const nav = useNavigate();
  const [open, setOpen] = useState<CatalogKey | null>(null);

  function pick(k: CatalogKey) {
    if (k === 'gm') { nav('/reports'); return; }
    if (k === 'suppliers') { download(suppliersExportUrl()); toast('بدأ تنزيل قائمة الموردين (القائمة كاملة)', { kind: 'info' }); return; }
    if (k === 'budget') { download(budgetExportUrl()); toast('بدأ تنزيل الموازنة (كل المشاريع)', { kind: 'info' }); return; }
    setOpen(k);
  }

  return (
    <>
      <PageHeader title="التصدير" sub="كل ما يُرسل للمحاسب أو المدير في مكان واحد — Excel من الخادم وPDF من التطبيق" />
      <Grid>
        {CATALOG.map((it, i) => (
          <button key={it.key} type="button" className="isl c4 click rp-xcard" style={{ '--i': i } as React.CSSProperties} onClick={() => pick(it.key)}>
            <div className="ih"><h2>{it.title}</h2><span className="pill n">{it.formats.join(' · ')}</span></div>
            <span className="rp-xdesc">{it.desc}</span>
          </button>
        ))}
      </Grid>
      <p className="rp-help">قوائم الموردين والمقاولين والموازنة بتصفيتها الحالية تُصدَّر من شاشاتها؛ هنا تُصدَّر كاملة.</p>
      {open === 'analysis' && <AnalysisDialog onClose={() => setOpen(null)} />}
      {open === 'periodic' && <PeriodicDialog onClose={() => setOpen(null)} />}
      {open === 'projectSummary' && <ProjectDialog onClose={() => setOpen(null)} />}
      {open === 'contractors' && <ContractorsDialog onClose={() => setOpen(null)} />}
    </>
  );
}

function AnalysisDialog({ onClose }: { onClose: () => void }) {
  const scopes = useScopes();
  const [scope, setScope] = useState<ScopeValue>('company');
  const [parties, setParties] = useState<PartyScope>('suppliers');
  const [from, setFrom] = useState(DEFAULT_FROM);
  const [to, setTo] = useState(todayIso());
  return (
    <Modal open onClose={onClose} title="تصدير — التحليل الكامل" size="md" dirty={false} autoDirty={false}
      actions={[{ label: 'إلغاء' }, { label: 'تنزيل Excel', kind: 'primary', onClick: (close) => {
        download(analysisExportUrl({ ...scopeToParams(scope), parties, date_from: from, date_to: to })); close(true);
      } }]}>
      <div className="sec-reports">
        <ScopeSelect scopes={scopes.data} value={scope} onChange={setScope} />
        <div className="rp-f"><span>الأطراف</span><Seg label="الأطراف" value={parties} onChange={setParties} options={PARTY_OPTS} /></div>
        <div className="rp-f2">
          <label className="rp-f"><span>من</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="rp-f"><span>إلى</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <p className="rp-cap">أولويات السداد تُدرَج في التصدير على مستوى الشركة فقط؛ نطاق مقاول يخرج بورقة المقاولين وحدها.</p>
      </div>
    </Modal>
  );
}

function PeriodicDialog({ onClose }: { onClose: () => void }) {
  const [g, setG] = useState<Granularity>('quarter');
  const [year, setYear] = useState(THIS_YEAR);
  return (
    <Modal open onClose={onClose} title="تصدير — التحليل الدوري" size="sm" dirty={false} autoDirty={false}
      actions={[{ label: 'إلغاء' }, { label: 'تنزيل Excel', kind: 'primary', onClick: (close) => { download(periodicExportUrl(g, year)); close(true); } }]}>
      <div className="sec-reports">
        <div className="rp-f"><span>التقسيم</span><Seg label="التقسيم" value={g} onChange={setG}
          options={[{ value: 'quarter', label: 'ربع سنوي' }, { value: 'half', label: 'نصف سنوي' }, { value: 'year', label: 'سنوي' }]} /></div>
        <label className="rp-f"><span>السنة</span>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{YEARS.map((y) => <option key={y} value={y}>{digits(y)}</option>)}</select></label>
      </div>
    </Modal>
  );
}

function ProjectDialog({ onClose }: { onClose: () => void }) {
  const scopes = useScopes();
  const [project, setProject] = useState('');
  const [parties, setParties] = useState<PartyScope>('both');
  const p = project || scopes.data?.projects[0] || '';
  return (
    <Modal open onClose={onClose} title="تصدير — ملخّص بالمشروع" size="sm" dirty={false} autoDirty={false}
      actions={[{ label: 'إلغاء' }, { label: 'تنزيل Excel', kind: 'primary', disabled: !p, onClick: (close) => { download(projectSummaryExportUrl(p, parties)); close(true); } }]}>
      <div className="sec-reports">
        <label className="rp-f"><span>المشروع</span>
          <select value={p} onChange={(e) => setProject(e.target.value)}>
            {!scopes.data?.projects.length && <option value="">لا مشاريع</option>}
            {scopes.data?.projects.map((x) => <option key={x} value={x}>{x}</option>)}
          </select></label>
        <div className="rp-f"><span>الأطراف</span><Seg label="الأطراف" value={parties} onChange={setParties} options={PARTY_OPTS} /></div>
        <p className="rp-cap">نسخة PDF من تبويب «ملخّص بالمشروع» في التقرير.</p>
      </div>
    </Modal>
  );
}

/** ١٣ صيغة (P-364، P-555…P-569). «مشروع واحد…» يطلب مشروعاً قبل التنزيل — لا ٤٢٢. */
function ContractorsDialog({ onClose }: { onClose: () => void }) {
  const scopes = useScopes();
  const [format, setFormat] = useState<ContractorExportFormat>('full');
  const [project, setProject] = useState('');
  const needsProject = format === 'single_project';
  const p = project || scopes.data?.projects[0] || '';
  return (
    <Modal open onClose={onClose} title="تصدير — المقاولون" size="md" dirty={false} autoDirty={false}
      actions={[{ label: 'إلغاء' }, { label: 'تنزيل Excel', kind: 'primary', disabled: needsProject && !p, onClick: (close) => {
        download(contractorsExportUrl(format, {}, needsProject ? { project: p } : undefined)); close(true);
      } }]}>
      <div className="sec-reports">
        <label className="rp-f"><span>الصيغة</span>
          <select value={format} onChange={(e) => setFormat(e.target.value as ContractorExportFormat)}>
            {CONTRACTOR_EXPORT_GROUPS.map((g) => (
              <optgroup key={g.group} label={g.group}>
                {g.options.filter((o) => o.requires !== 'code').map((o) => <option key={o.format} value={o.format}>{o.title}</option>)}
              </optgroup>
            ))}
          </select></label>
        {needsProject && (
          <label className="rp-f"><span>المشروع</span>
            <select value={p} onChange={(e) => setProject(e.target.value)}>
              {!scopes.data?.projects.length && <option value="">لا مشاريع متاحة</option>}
              {scopes.data?.projects.map((x) => <option key={x} value={x}>{x}</option>)}
            </select></label>
        )}
        <p className="rp-cap">كشف حساب مقاول مفرد يُصدَّر من صفّه في شاشة المقاولين.</p>
      </div>
    </Modal>
  );
}
