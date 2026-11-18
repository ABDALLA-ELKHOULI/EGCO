/* المقاولون — يستبدل pages/Contractors.tsx + components/ExportMenu.tsx (P-098…P-135، P-364، P-365، P-555…P-572).
 * الإشارة: سالب «له» محايد · موجب «لنا» أخضر · الأحمر للتأخر الزمني فقط (م-٣٦). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGo } from '@/app/routes';
import {
  Button, DataTable, EmptyState, Field, FormGrid, Grid, Island, Kpi, Money, PageHeader, Pill, Seg, Skeleton,
  dateTxt, int, toast, uiPref, setUiPref, useForm, usePrefs, type Column, type TableQuery,
} from '@/ui';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';
import { Carousel } from '@/components/Carousel';
import { ExplainDot } from '@/components/Explain';
import { partiesApi } from './api';
import { CONTRACTOR_ROOTS, useApiMutation, useContractor, useContractors, useContractorsOverview } from './hooks';
import {
  CONTRACTOR_STATUSES, DIRECTIONS, EMPTY_CONTRACTOR_FILTERS, ENTRY_KIND, STATUS_TONE, balanceView, contractorBody,
  contractorChipLabels, contractorQuery, exportMenuGroups, exportParams, groupByProject, knownProjects, overdueCell,
  retentionCell, statusLabel, validateContractor, type ContractorFormValues, type ContractorListFilters,
} from './logic/contractors';
import { filterLine, paginate, type Chip as ChipT } from './logic/table';
import { ChipsBar, DeletePartyModal, ErrBox, FSelect, FText, PModal, ProjectChips, errMsg, toneOf } from './components/shared';
import type {
  ContractorEntry, ContractorExportFormat, ContractorListResponse, ContractorRowX, ContractorStatus, ContractorsOverview,
} from './types';
import type { ContractorExportOption } from '@/lib/api';
import './parties.css';

const PAGE = 50;
const OVERVIEW_KEY = 'egco.contractors.overviewView';

export default function Contractors() {
  usePrefs();
  const go = useGo();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState<ContractorListFilters>(() => ({ ...EMPTY_CONTRACTOR_FILTERS, project: sp.get('project') ?? '' }));
  const set = (p: Partial<ContractorListFilters>) => setF((x) => ({ ...x, ...p }));
  const [deb, setDeb] = useState(f);
  useEffect(() => { const t = setTimeout(() => setDeb(f), 200); return () => clearTimeout(t); }, [f]);
  const query = useMemo(() => contractorQuery(deb), [deb]);
  const list = useContractors(query);
  const d = list.data;
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [query]);
  const [view, setView] = useState<'list' | 'proj'>('list');
  const [form, setForm] = useState<{ row?: ContractorRowX } | null>(sp.get('new') ? {} : null);
  const [del, setDel] = useState<ContractorRowX | null>(null);
  const [print, setPrint] = useState<'list' | 'projects' | { code: string; name: string; hasStatement: boolean } | null>(null);

  const chips: ChipT[] = contractorChipLabels(f).map((c) => ({ k: c.k, label: c.label, clear: () => set({ [c.k]: '' } as Partial<ContractorListFilters>) }));
  const clearAll = () => { setF({ ...EMPTY_CONTRACTOR_FILTERS, sort: f.sort }); if (sp.get('project')) setSp({}, { replace: true }); };
  const fl = filterLine(chips);
  const rows = useMemo(() => d?.rows ?? [], [d]);
  const projects = useMemo(() => knownProjects(rows), [rows]);
  const pg = paginate(rows, page, PAGE);
  const groups = useMemo(() => groupByProject(rows), [rows]);
  const params = exportParams(query);

  if (print === 'list' && d) return <ContractorsPrint d={d} line={fl} onBack={() => setPrint(null)} />;
  if (print === 'projects' && d) return <ProjectTotalsPrint d={d} line={fl} onBack={() => setPrint(null)} />;
  if (print && typeof print === 'object') return <StatementPrint target={print} onBack={() => setPrint(null)} />;

  const cols: Column<ContractorRowX>[] = [
    { key: 'name', label: 'المقاول', required: true, render: (r) => (<>
      <b data-testid={`party-row-${r.code}`}>{r.name}</b>
      {r.releaseAlerts > 0 && <span className="pt-dot" title={`ضمانات مستحقة الصرف: ${int(r.releaseAlerts)}`} />}
      {!r.hasStatement && <> <Pill>بلا كشف مرفوع</Pill></>}
      {r.phone && <span className="pt-sub num" dir="ltr">{r.phone}</span>}</>) },
    { key: 'code', label: 'الرمز', render: (r) => <span className="num">{r.code}</span> },
    { key: 'project', label: 'المشروع', sort: false, render: (r) => r.projects?.length
      ? <span title={r.projects.join('، ')}><span className="chip">{r.projects[0]}</span>{r.projects.length > 1 && <> <span className="chip">+{int(r.projects.length - 1)}</span></>}</span>
      : <span className="dash">—</span> },
    { key: 'balance', label: 'الاتجاه', num: true, render: (r) => { const v = balanceView(r.balance);
      return <><Money value={r.balance} className={v.tone === 'ok' ? 't-ok' : undefined} /> <span className="cap">{v.label}</span></>; } },
    { key: 'status', label: 'الحالة', render: (r) => (<>
      <Pill tone={toneOf(STATUS_TONE[r.status])}>{statusLabel(r.status)}</Pill>
      {r.statusNote && <span className="pt-sub pt-trunc" title={r.statusNote}>{r.statusNote}</span>}</>) },
    { key: 'overdue', label: 'متأخر', num: true, render: (r) => { const c = overdueCell(r);
      return c.kind === 'no-term' ? <span className="dash" title="اضبط مدة السداد في بطاقة المقاول">—</span>
        : c.kind === 'none' ? <span className="cap" title={`مدة السداد ${int(c.termDays)} يوماً — لا مستخلص تجاوز استحقاقه`}>لا تأخر</span>
        : <><Money value={c.amount} className="t-danger" /><span className="pt-sub">{int(c.count)} مستخلص · أقدمها {int(c.maxDays)} يوماً</span></>; } },
    { key: 'retentionHeld', label: 'الضمان المحتجز', num: true, render: (r) => { const c = retentionCell(r);
      return c === 'unknown' ? <span className="cap" title="لا كشف حساب مرفوع — لا نعلم إن كان محتجزاً ضمان أم لا">غير معروف</span>
        : c === 'none' ? <span className="cap">لا يوجد</span> : <Money value={r.retentionHeld} />; } },
    { key: 'lastPaymentDate', label: 'آخر دفعة', render: (r) => r.lastPayment
      ? <><Money value={r.lastPayment.amount} /><span className="pt-sub">{dateTxt(r.lastPayment.date, { year: true })}</span></> : <span className="cap">لا دفعات</span> },
    { key: 'lastActivity', label: 'آخر حركة', render: (r) => r.lastActivity ? dateTxt(r.lastActivity, { year: true }) : <span className="dash">—</span> },
    { key: '_a', label: '', sort: false, required: true, render: (r) => (
      <span className="pt-acts" onClick={(e) => e.stopPropagation()}>
        <a className="btn sm pt-ib" href={partiesApi.contractorsExportUrl('single_statement', params, { code: r.code })} download
          aria-label="تصدير كشف الحساب" title="تصدير كشف الحساب (Excel)">📄</a>
        <button type="button" className="btn sm pt-ib" aria-label="طباعة كشف الحساب PDF" title="طباعة كشف الحساب (PDF)"
          onClick={() => setPrint({ code: r.code, name: r.name, hasStatement: r.hasStatement })}>🖶</button>
        <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={() => setForm({ row: r })}>✎</button>
        <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={() => setDel(r)}>🗑</button>
      </span>) },
  ];
  const onQuery = (t: TableQuery) => { if (JSON.stringify(t.sort) !== JSON.stringify(f.sort)) set({ sort: t.sort }); };
  const t = d?.totals;

  return (
    <>
      <PageHeader title="المقاولون"
        sub={<>{d ? `${int(d.count)} مقاولاً · ` : ''}الرصيد السالب مستحق «له»، والموجب (بالأخضر) مستحق «لنا» — الأحمر هنا محجوز للتأخر عن الموعد فقط</>}
        actions={<>
          <Seg label="طريقة العرض" value={view} onChange={setView} options={[{ value: 'list', label: 'قائمة' }, { value: 'proj', label: 'تجميع بالمشروع' }]} />
          <ContractorExportMenu params={params} projects={projects} />
          <Button onClick={() => setPrint('list')} disabled={!d}>PDF</Button>
          <Button onClick={() => setPrint('projects')} disabled={!d} title="ورقة واحدة: أي مشروع أسدّد مستحقاته أولاً">PDF إجماليات المشاريع</Button>
          <Button kind="primary" data-testid="contractor-add" onClick={() => setForm({})}>+ مقاول</Button>
        </>} />
      <Grid>
        <Kpi span={3} i={0} size="hero" label={<>إجمالي مستحق للمقاولين <ExplainDot metric="contractorsOwed" values={{ contractorsOwed: t?.owedToContractors }} /></>}
          value={t?.owedToContractors ?? null} hint="نحن ندين لهم" />
        <Kpi span={3} i={1} tone="ok" label={<>إجمالي مستحق لنا <ExplainDot metric="contractorsOwedToUs" values={{ contractorsOwedToUs: t?.owedToUs }} /></>} value={t?.owedToUs ?? null} />
        <Kpi span={3} i={2} label={<>الضمانات المحتجزة <ExplainDot metric="contractorsRetention" values={{ contractorsRetention: t?.retentionHeld }} /></>} value={t?.retentionHeld ?? null} />
        <Kpi span={3} i={3} label="متأخر (لمن له مدة سداد)" value={t?.overdueTotal ?? null} tone={(t?.overdueTotal ?? 0) > 0 ? 'danger' : undefined}
          crit={(t?.overdueTotal ?? 0) > 0} onClick={() => set({ status: 'overdue' })}
          hint={t && t.withoutTermCount > 0 ? <>{int(t.withoutTermCount)} بلا مدة — تأخرهم غير محسوب{t.withTermCount > 0 && <> · على {int(t.withTermCount)} لهم مدة</>}</> : undefined} />
        <Island span={12} i={4} title="نظرة المقاولين"><ContractorsOverviewView /></Island>
        <Island span={12} i={5}>
          <p className="disclose">«متأخر» يُحسب على المستخلصات لمن ضُبطت له مدة سداد في بطاقته؛ من لا مدة له يظهر «—» ولا يدخل الإجمالي.</p>
          <div className="pt-xfil">
            <FText label="بحث" wide value={f.q} onChange={(v) => set({ q: v })} placeholder="بحث بالاسم أو الرمز…" />
            <FText label="الرمز" value={f.code} onChange={(v) => set({ code: v })} placeholder="212…" />
            <FSelect label="المشروع" value={f.project} onChange={(v) => set({ project: v })} allLabel="كل المشاريع" options={projects.map((p) => ({ value: p, label: p }))} />
            <FSelect label="الاتجاه" value={f.direction} onChange={(v) => set({ direction: v as ContractorListFilters['direction'] })} allLabel="كل الاتجاهات" options={DIRECTIONS} />
            <FSelect label="الحالة" value={f.status} onChange={(v) => set({ status: v })} allLabel="كل الحالات"
              options={[...CONTRACTOR_STATUSES.map((s) => ({ value: s.value as string, label: s.label as string })), { value: 'overdue', label: 'متأخر (لمن له مدة)' }]} />
          </div>
          <ChipsBar chips={chips.map((c) => (c.k === 'status' && f.status === 'overdue' ? { ...c, label: 'الحالة: متأخر' } : c))} onClearAll={clearAll} />
          {list.error && !d ? <EmptyState icon="alert" title="تعذّر التحميل" body={list.error.message} cta="إعادة المحاولة" onCta={() => list.refetch()} />
            : !d ? <Skeleton rows={8} />
            : rows.length === 0 && !chips.length ? <EmptyState icon="users" title="لم تُرفع بيانات المقاولين بعد"
                body="ارفع كشوف حسابات المقاولين لتظهر أرصدتهم ومستخلصاتهم هنا." cta="رفع الملفات" onCta={() => go('data.import')} />
            : view === 'proj' ? <ProjectGroupsView groups={groups} onOpen={(code) => go('parties.contractor', { code })} />
            : (<>
              <DataTable<ContractorRowX> id="parties.contractors" mode="server" rows={pg.rows} rowKey="code" columns={cols}
                search={false} sort={f.sort} onQueryChange={onQuery}
                onRowClick={(r) => go('parties.contractor', { code: r.code })}
                empty={{ icon: 'search', title: 'لا نتائج مطابقة', body: 'لم يطابق البحث أو التصفية أي مقاول.', cta: 'مسح التصفية', onCta: clearAll }} />
              {rows.length > PAGE && (
                <div className="pt-pager">
                  <span className="cap">عرض {int(pg.from)}–{int(pg.to)} من {int(pg.total)} — الإجماليات أعلاه للمجموعة كاملة</span>
                  <div>
                    <Button size="sm" disabled={pg.page <= 1} onClick={() => setPage(1)}>الأولى</Button>
                    <Button size="sm" disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)}>السابقة</Button>
                    <span className="cap">{int(pg.page)} / {int(pg.pageCount)}</span>
                    <Button size="sm" disabled={pg.page >= pg.pageCount} onClick={() => setPage(pg.page + 1)}>التالية</Button>
                    <Button size="sm" disabled={pg.page >= pg.pageCount} onClick={() => setPage(pg.pageCount)}>الأخيرة</Button>
                  </div>
                </div>)}
            </>)}
        </Island>
      </Grid>
      <ContractorFormModal open={!!form} row={form?.row} known={projects}
        onClose={() => { setForm(null); if (sp.get('new')) setSp({}, { replace: true }); }}
        onCreated={(code) => go('parties.contractor', { code })} />
      {del && <DeletePartyModal open kind="contractor" name={del.name} keyValue={del.code} onClose={() => setDel(null)} onDeleted={() => { setDel(null); void list.refetch(); }} />}
    </>
  );
}

/* ── تجميع بالمشروع (P-105) ── */
function ProjectGroupsView({ groups, onOpen }: { groups: ReturnType<typeof groupByProject>; onOpen: (code: string) => void }) {
  usePrefs();
  if (!groups.length) return <p className="disclose">لا بيانات لتجميعها.</p>;
  return (
    <div className="pt-groups">
      <p className="cap">النطاق: كل المشاريع من المجموعة المصفّاة كاملةً (بلا ترقيم صفحات) — مرتّبة بأكبر مستحق للمقاولين أولاً. مقاول على أكثر من مشروع يظهر تحت كل مشروع بكامل رصيده (الخادم لا يعطي حصة كل مشروع من رصيده الكلي) — لذا لا تُجمع المجموعات.</p>
      {groups.map((g) => (
        <details key={g.project} className="pt-grp">
          <summary><b>{g.project}</b><span className="cap">{int(g.rows.length)} مقاولاً</span>
            <span className="pt-gs">له {g.owed > 0 ? <Money value={g.owed} /> : '—'}</span>
            <span className="pt-gs">لنا {g.owedToUs > 0 ? <Money value={g.owedToUs} className="t-ok" /> : '—'}</span></summary>
          <div className="tbl-wrap"><table><tbody>{g.rows.map((r) => { const v = balanceView(r.balance); return (
            <tr key={g.project + '/' + r.code} className="go" onClick={() => onOpen(r.code)}>
              <td>{r.name}</td><td className="num">{r.code}</td>
              <td className="n"><Money value={r.balance} className={v.tone === 'ok' ? 't-ok' : undefined} /> <span className="cap">{v.label}</span></td>
            </tr>); })}</tbody></table></div>
        </details>))}
    </div>
  );
}

/* ── منتقي التصدير (P-364) — ١٣ صيغة في القائمة + كشف الصف = ١٤ ── */
function ContractorExportMenu({ params, projects }: { params: Record<string, string | number | undefined>; projects: string[] }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<ContractorExportOption | null>(null);
  const [pick, setPick] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const download = (fmt: ContractorExportFormat, extra?: { project?: string }) => { window.location.href = partiesApi.contractorsExportUrl(fmt, params, extra); };
  return (
    <div className="pt-menu" ref={ref}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>تصدير Excel ▾</Button>
      {open && (
        <div className="pt-menu-pop" role="menu">
          {exportMenuGroups().map((g) => (
            <div key={g.group}><div className="cap">{g.group}</div>
              {g.options.map((o) => <button key={o.format} type="button" role="menuitem" onClick={() => {
                if (o.requires === 'project') { setPick(projects[0] ?? ''); setPending(o); } else download(o.format);
                setOpen(false);
              }}>{o.title}</button>)}
            </div>))}
        </div>)}
      <PModal open={!!pending} onClose={() => setPending(null)} title="اختر المشروع للتصدير" size="sm" dirty={false}
        actions={[{ label: 'إلغاء' }, { label: 'تصدير', kind: 'primary', disabled: !pick, onClick: (c) => { if (pending) download(pending.format, { project: pick }); c(true); } }]}>
        <div className="pt-xfil"><label><span>المشروع</span>
          <select value={pick} onChange={(e) => setPick(e.target.value)} data-no-dirty>
            {projects.length === 0 && <option value="">لا مشاريع متاحة</option>}
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select></label></div>
      </PModal>
    </div>
  );
}

/* ── نظرة المقاولين (P-129…P-135) ── */
const VIEWS = [
  { key: 'byProject', title: 'التوزيع على المشاريع' }, { key: 'topOwed', title: 'أكبر ١٠ مقاولين بالمستحق' },
  { key: 'guarantees216', title: 'الضمانات المستقلة (216)' }, { key: 'mismatches', title: 'اختلافات الرصيد' },
];
function ContractorsOverviewView() {
  usePrefs();
  const go = useGo();
  const q = useContractorsOverview();
  const [i, setI] = useState(() => { const v = Number(uiPref<string>(OVERVIEW_KEY, '0')); return v >= 0 && v < VIEWS.length ? v : 0; });
  useEffect(() => { setUiPref(OVERVIEW_KEY, String(i)); }, [i]);
  const o = q.data;
  if (q.isError) return <EmptyState icon="alert" title="تعذّر جلب نظرة المقاولين" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} />;
  if (!o) return <Skeleton rows={4} />;
  if (!o.hasDebtsReportImport && o.totals.contractorCount === 0) return (
    <EmptyState icon="upload" title="نظرة المقاولين ستظهر هنا بعد الرفع"
      body="بعد رفع تقرير مديونيات المقاولين والموردين (أو كشوف حساب فردية) ستعرض هذه اللوحة: توزيع المستحق على المشاريع، أكبر عشرة مقاولين بالمستحق، إجمالي حسابات الضمان المستقلة، وأي اختلاف بين رصيد الملف والرصيد المحسوب من الحركات."
      cta="رفع الملفات" onCta={() => go('data.import')} />);
  const byProject = o.reported?.byProject?.length ? o.reported.byProject : o.byProject;
  const top = o.reported?.topOwed?.length ? o.reported.topOwed : o.topOwed;
  const max = Math.max(1, ...byProject.map((r) => r.owed || 0));
  return (
    <>
      <Carousel views={VIEWS} activeView={i} onViewChange={setI} ariaLabel="نظرة المقاولين">
        {i === 0 && (byProject.length ? (<div className="tbl-wrap"><table>
          <thead><tr><th>المشروع</th><th className="n">المستحق للمقاولين (المشروع)</th><th>عدد المقاولين</th></tr></thead>
          <tbody>{byProject.map((r) => (<tr key={r.project}><td>{r.project}</td>
            <td className="n"><span className="pt-sbar"><span style={{ width: `${Math.max(4, ((r.owed || 0) / max) * 100)}%` }} /></span><Money value={r.owed} /></td>
            <td className="num">{int(r.contractorCount)}</td></tr>))}</tbody></table>
          <p className="disclose">النطاق: مجموع مستحق المقاولين (رصيد سالب) على حركات كل مشروع وحده — لا الرصيد الكلي للمقاول عبر كل مشاريعه. مشروع برصيد موجب فقط (مستحق لنا) لا يظهر هنا.</p></div>)
          : <p className="disclose">لا بيانات مشاريع بعد.</p>)}
        {i === 1 && (top.length ? (<div className="tbl-wrap"><table>
          <thead><tr><th>المقاول</th><th>المشاريع</th><th className="n">المستحق</th></tr></thead>
          <tbody>{top.map((r) => (<tr key={r.code} className="go" onClick={() => go('parties.contractor', { code: r.code })}>
            <td>{r.name}</td><td>{r.projects?.length ? r.projects.join('، ') : <span className="dash">—</span>}</td>
            <td className="n"><Money value={Math.abs(r.balance)} /></td></tr>))}</tbody></table>
          <p className="disclose">النطاق: كل المقاولين، بلا تصفية الجدول أسفل — رصيد سالب (له) فقط، الأكبر أولاً.</p></div>)
          : <p className="disclose">لا مستحقات مسجَّلة للمقاولين.</p>)}
        {i === 2 && (o.guaranteeAccounts216.count === 0 ? <p className="disclose">لا حسابات ضمان مستقلة (216) مستوردة بعد.</p> : (<>
          <Grid><Kpi span={6} label="إجمالي حسابات الضمان المستقلة (216)" value={o.guaranteeAccounts216.total} />
            <Kpi span={6} label="عدد الحسابات" money={false} value={o.guaranteeAccounts216.count} /></Grid>
          <p className="disclose">النطاق: حسابات بادئتها 216 من تقرير المديونيات المجمّع فقط — رقم مختلف تماماً عن «الضمانات المحتجزة» أعلى الشاشة (تلك ضمانات مشاريع مربوطة بمقاول بعينه). لم يُربط أغلب هذه الحسابات بمقاول محدد بعد.</p></>))}
        {i === 3 && <Mismatches o={o} />}
      </Carousel>
      {o.hasDebtsReportImport && o.reported && (
        <p className="disclose">الأرقام أعلاه من <b>تقرير المديونيات المجمّع</b> (<Money value={o.reported.owed} /> على {int(o.reported.contractorCount)} مقاولاً).
          المحسوب من حركات الدفتر المرفوعة فعلاً: <Money value={o.totals.owedToContractors} /> — الفرق طبيعي لأن معظم المقاولين لم تُرفع كشوف حساباتهم بعد، وليس خطأً حسابياً.</p>)}
    </>
  );
}
function Mismatches({ o }: { o: ContractorsOverview }) {
  const go = useGo();
  if (!o.hasDebtsReportImport) return <p className="disclose">لا يوجد استيراد لتقرير مديونيات مجمّع بعد — لا مطابقة لعرضها.</p>;
  if (!o.balanceMismatches.length) return <EmptyState icon="check" title="لا اختلافات رصيد" body="رصيد كل مقاول في آخر تقرير مديونيات مجمّع مطابق (بحدود الهللة) للرصيد المحسوب من حركاته المحفوظة." />;
  return (<div className="tbl-wrap"><table>
    <thead><tr><th>المقاول</th><th className="n">رصيد الملف</th><th className="n">المحسوب من الحركات</th><th className="n">الفرق</th></tr></thead>
    <tbody>{o.balanceMismatches.map((r) => (<tr key={r.account} className="go" onClick={() => go('parties.contractor', { code: r.account })}>
      <td>{r.name || r.account}</td><td className="n"><Money value={r.fileBalance} /></td><td className="n"><Money value={r.derivedBalance} /></td>
      {/* الفرق يعرضه الخادم ضمناً (الملف − المحسوب)؛ الطرح هنا للعرض فقط بالهللات. */}
      <td className="n">{r.fileBalance != null && r.derivedBalance != null ? <Money value={Math.round(r.fileBalance * 100 - r.derivedBalance * 100) / 100} className="t-danger" /> : '—'}</td>
    </tr>))}</tbody></table>
    <p className="disclose">النطاق: مقاولون فقط (بادئة حساب 212) من أحدث استيراد لتقرير مديونيات مجمّع{o.lastDebtsReportImport ? ` (${dateTxt(o.lastDebtsReportImport, { year: true })})` : ''} — استيراد لاحق للتقرير نفسه يستبدل هذه القائمة بالكامل.</p></div>);
}

/* ── نموذج المقاول (P-381، P-126/127) + الحالة وسببها (فجوة v0.13 P-450/451) ── */
export function ContractorFormModal({ open, row, known, onClose, onCreated }: {
  open: boolean; known: string[]; onClose: () => void; onCreated?: (code: string) => void;
  row?: { code: string; name: string; phone?: string | null; notes?: string | null; projects?: string[]; status?: ContractorStatus;
    statusNote?: string | null; defaultRetentionRate?: number | null; defaultGuaranteeDays?: number | null; paymentTermDays?: number | null };
}) {
  const isEdit = !!row;
  const init = useMemo<ContractorFormValues>(() => ({
    code: row?.code ?? '212', name: row?.name ?? '', phone: row?.phone ?? '', notes: row?.notes ?? '',
    retention: row?.defaultRetentionRate ?? null, guaranteeDays: row?.defaultGuaranteeDays ?? null, term: row?.paymentTermDays ?? null,
    projects: row?.projects ?? [], status: row?.status ?? 'active', statusNote: row?.statusNote ?? '',
  }), [row]);
  const form = useForm(init as unknown as Record<string, unknown>) as unknown as ReturnType<typeof useForm<ContractorFormValues & Record<string, unknown>>>;
  useEffect(() => { if (open) form.reset(init as ContractorFormValues & Record<string, unknown>); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, init]);
  const [err, setErr] = useState<string | null>(null);
  const save = useApiMutation((v: ContractorFormValues) => {
    const b = contractorBody(v);
    if (!isEdit) return partiesApi.createContractor(b);
    const rest: Partial<typeof b> = { ...b };
    delete rest.code; // الرمز لا يُعدَّل
    return partiesApi.updateContractor(row!.code, rest);
  }, { invalidate: CONTRACTOR_ROOTS, errorToast: false });
  return (
    <PModal open={open} onClose={onClose} title={isEdit ? 'تعديل مقاول' : 'إضافة مقاول'} dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: save.isPending ? 'جارٍ الحفظ…' : 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        setErr(null);
        const v = form.values as ContractorFormValues;
        const bad = validateContractor(v, isEdit);
        if (bad) { form.setError(bad.field, bad.msg); return; }
        try { await save.mutateAsync(v); close(true); toast(isEdit ? 'حُفظ المقاول' : `أُضيف المقاول ${v.name.trim()}`, { kind: 'ok' }); if (!isEdit) onCreated?.(v.code.trim()); }
        catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <FormGrid>
        <Field form={form} name="code" label="الرمز" required dir="ltr" readOnly={isEdit} help={isEdit ? 'الرمز لا يُعدَّل' : 'يبدأ بـ212 ولا يتكرر'} />
        <Field form={form} name="name" label="الاسم" required />
        <Field form={form} name="phone" label="الهاتف" type="tel" dir="ltr" />
        <Field form={form} name="term" label="مدة السداد (يوماً)" type="number" min={0} max={365} help="اتركه فارغاً إن لم تُتفق مدة — لن يُحسب تأخر" />
        <Field form={form} name="retention" label="نسبة الضمان الافتراضية ٪" type="number" min={0} max={100} />
        <Field form={form} name="guaranteeDays" label="مدة الضمان الافتراضية (يوم)" type="number" min={0} />
        <Field form={form} name="status" label="الحالة" type="select" required options={CONTRACTOR_STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
        <Field form={form} name="statusNote" label="سبب الحالة" help="مطلوب عند «متوقف» أو «متنازع عليه» أو «قائمة سوداء»" />
        <Field form={form} name="notes" label="ملاحظات" full />
      </FormGrid>
      <ProjectChips label="المشاريع — قد يعمل المقاول على أكثر من مشروع، والأول هو الأساسي" value={(form.values.projects as string[]) ?? []}
        onChange={(v) => form.set('projects', v)} known={known} />
    </PModal>
  );
}

/* ── الطباعات (P-107/570، P-108/571، P-109/572) ── */
function ContractorsPrint({ d, line, onBack }: { d: ContractorListResponse; line: string | null; onBack: () => void }) {
  const columns: PrintableColumn[] = [
    { key: 'name', label: 'المقاول', render: (r: ContractorRowX) => r.name },
    { key: 'code', label: 'الرمز', ltr: true, render: (r: ContractorRowX) => r.code },
    { key: 'project', label: 'المشروع', render: (r: ContractorRowX) => (r.projects?.length ? r.projects.join('، ') : '—') },
    { key: 'balance', label: 'الرصيد (ر.س)', ltr: true, render: (r: ContractorRowX) => <><Money value={Math.abs(r.balance)} noCur /> ({balanceView(r.balance).label})</> },
    { key: 'status', label: 'الحالة', render: (r: ContractorRowX) => statusLabel(r.status) },
    { key: 'retention', label: 'الضمان المحتجز (ر.س)', ltr: true, render: (r: ContractorRowX) => (r.retentionHeld > 0 ? <Money value={r.retentionHeld} noCur /> : '—') },
  ];
  return <PrintableList docTitle="قائمة المقاولين" fileStamp="قائمة-المقاولين" scopeLine="الرصيد السالب (له) مستحق للمقاول، والموجب (لنا) مستحق للشركة"
    filterLine={line} countLabel={`${int(d.count)} مقاولاً`} columns={columns} rows={d.rows}
    totalsCells={[`الإجمالي (${int(d.count)})`, '', '', '', '', <Money key="r" value={d.totals.retentionHeld} noCur />]}
    footNote="الإجماليات: انظر الملخص أعلى الورقة — من الخادم على المجموعة المصفّاة كاملةً."
    summary={[{ label: 'إجمالي مستحق للمقاولين', value: <Money value={d.totals.owedToContractors} /> }, { label: 'إجمالي مستحق لنا', value: <Money value={d.totals.owedToUs} /> }]}
    onBack={onBack} />;
}
function ProjectTotalsPrint({ d, line, onBack }: { d: ContractorListResponse; line: string | null; onBack: () => void }) {
  const bp = d.totals.byProject ?? [];
  const columns: PrintableColumn[] = [
    { key: 'project', label: 'المشروع', render: (r: typeof bp[number]) => r.project },
    { key: 'count', label: 'عدد المقاولين', ltr: true, render: (r: typeof bp[number]) => int(r.count) },
    { key: 'owed', label: 'مستحق للمقاولين — له (ر.س)', ltr: true, render: (r: typeof bp[number]) => (r.owedToContractors > 0 ? <Money value={r.owedToContractors} noCur /> : '—') },
    { key: 'owedUs', label: 'مستحق لنا (ر.س)', ltr: true, render: (r: typeof bp[number]) => (r.owedToUs > 0 ? <Money value={r.owedToUs} noCur /> : '—') },
  ];
  return <PrintableList docTitle="إجماليات المشاريع — نظرة القرار" fileStamp="إجماليات-المشاريع"
    scopeLine="مرتّبة بالأكبر مستحقاً للمقاولين أولاً — أي مشروع أسدّد مستحقاته أولاً" filterLine={line}
    countLabel={`${int(bp.length)} مشروعاً`} columns={columns} rows={bp}
    totalsCells={[`الإجمالي (${int(bp.length)})`, int(d.count), <Money key="a" value={d.totals.owedToContractors} noCur />, <Money key="b" value={d.totals.owedToUs} noCur />]}
    summary={[{ label: 'إجمالي مستحق للمقاولين', value: <Money value={d.totals.owedToContractors} /> }, { label: 'إجمالي مستحق لنا', value: <Money value={d.totals.owedToUs} /> },
      { label: 'الضمانات المحتجزة', value: <Money value={d.totals.retentionHeld} /> }]}
    footNote="مقاول على أكثر من مشروع يُحتسب تحت كل مشروع بكامل رصيده — لا تجزئة محلية غير مدعومة بالبيانات." onBack={onBack} />;
}
export function StatementPrint({ target, onBack }: { target: { code: string; name: string; hasStatement: boolean }; onBack: () => void }) {
  const q = useContractor(target.code);
  const sd = q.data;
  if (q.isError) return <PageHeader title="تعذّر تحميل كشف الحساب" sub={errMsg(q.error)} actions={<Button onClick={onBack}>رجوع</Button>} />;
  if (!sd) return <PageHeader title="جارٍ تحميل كشف الحساب…" actions={<Button onClick={onBack}>رجوع</Button>} />;
  const v = balanceView(sd.balance);
  const columns: PrintableColumn[] = [
    { key: 'date', label: 'التاريخ', ltr: true, render: (e: ContractorEntry) => dateTxt(e.date, { year: true }) },
    { key: 'kind', label: 'النوع', render: (e: ContractorEntry) => ENTRY_KIND[e.kind]?.label ?? e.kind ?? 'أخرى' },
    { key: 'description', label: 'الوصف', render: (e: ContractorEntry) => e.description || '—' },
    { key: 'project', label: 'المشروع', render: (e: ContractorEntry) => e.project || '—' },
    { key: 'debit', label: 'مدين (ر.س)', ltr: true, render: (e: ContractorEntry) => (e.debit ? <Money value={e.debit} noCur /> : '—') },
    { key: 'credit', label: 'دائن (ر.س)', ltr: true, render: (e: ContractorEntry) => (e.credit ? <Money value={e.credit} noCur /> : '—') },
  ];
  return <PrintableList docTitle={`كشف حساب — ${sd.name}`} fileStamp={`كشف-حساب-${sd.code}`}
    scopeLine={`الرمز ${sd.code}${sd.perProject.length ? ` · ${sd.perProject.map((p) => p.project || 'بلا مشروع').join('، ')}` : ''}`}
    filterLine={null} countLabel={`${int(sd.entries.length)} حركة`} columns={columns} rows={sd.entries}
    totalsCells={[`الإجمالي (${int(sd.entries.length)})`, '', '', '', <Money key="d" value={sd.debitTotal ?? 0} noCur />, <Money key="c" value={sd.creditTotal ?? 0} noCur />]}
    summary={[{ label: `الرصيد الختامي (${v.label})`, value: <Money value={Math.abs(sd.balance)} /> }, { label: 'إجمالي مدين', value: <Money value={sd.debitTotal ?? 0} /> },
      { label: 'إجمالي دائن', value: <Money value={sd.creditTotal ?? 0} /> }, { label: 'الضمان المحتجز', value: sd.retentionTotal ? <Money value={sd.retentionTotal} /> : '—' }]}
    warnBanner={!target.hasStatement ? 'لا كشف حساب مرفوع لهذا المقاول — الرصيد أعلاه من ملف مديونيات مستورد فقط، والحركات أدناه (إن وُجدت) لا تمثّل كشف حسابه الكامل.' : undefined}
    footNote="كشف حساب داخلي من دفتر الشركة — للمطابقة مع سجلات المقاول." onBack={onBack} />;
}
