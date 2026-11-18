/* الموازنة التقديرية — يحل محل pages/Budget.tsx (P-182..P-203). الفلاتر على الخادم دائماً. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, apiBase, type BudgetRow, type BudgetStatus } from '@/lib/api';
import { invalidate } from '@/data/queryClient';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';
import {
  Button, Chip, DataTable, Drawer, EmptyState, ExportDialog, Grid, Island, Kpi, Money, PageHeader, Pill, Skeleton,
  confirm, dateTxt, fmt, int, toast, usePrefs, type Column,
} from '@/ui';
import { useBudgetList, useBudgetOverview, useBudgetProject, BUDGET_ROOTS } from '../hooks';
import { STATUS_LABEL, conflictMonths, cumTone, groupByProject, monthTone, splitBudgetFiles, type BudgetStatusFilter, type MonthGroup } from '../logic/budget';
import { paths, useNav } from '../nav';
import { BudgetDoc } from '../components/BudgetDoc';
import { BudgetEntryForm } from '../components/BudgetEntryForm';
import { DeltaArrow, ErrorBox, Pct } from '../components/bits';
import { BudgetPlanPanel } from '../components/BudgetPlanPanel';

const tcls = (t: string) => (t === 'ok' ? 't-ok' : t === 'red' ? 't-warn' : undefined);
const ktone = (t: string) => (t === 'ok' ? 'ok' : t === 'red' ? 'warn' : undefined);
interface Outcome { ok: boolean; message: string; details: string[] }

export default function BudgetView() {
  usePrefs();
  const go = useNav();
  const [sp] = useSearchParams();
  const [project, setProject] = useState(sp.get('project') ?? '');
  const [city, setCity] = useState('');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [status, setStatus] = useState<BudgetStatusFilter>('');
  const [hasClaims, setHasClaims] = useState(false);
  const [debounced, setDebounced] = useState({});
  const query = useMemo(() => ({
    project: project || undefined, city: city || undefined, from_month: fromMonth || undefined,
    to_month: toMonth || undefined, status: (status || undefined) as BudgetStatus | undefined, has_claims: hasClaims || undefined,
  }), [project, city, fromMonth, toMonth, status, hasClaims]);
  useEffect(() => { const t = setTimeout(() => setDebounced(query), 200); return () => clearTimeout(t); }, [query]);

  const list = useBudgetList(debounced);
  const overview = useBudgetOverview();
  const [docMode, setDocMode] = useState(false);
  const [printMode, setPrintMode] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [manage, setManage] = useState<string | null>(null);
  const [entry, setEntry] = useState<{ project: string; existing: BudgetRow | null; editable?: boolean } | null>(null);

  const clearAll = () => { setProject(''); setCity(''); setFromMonth(''); setToMonth(''); setStatus(''); setHasClaims(false); };
  const chips = [
    project && { k: 'p', label: `المشروع: ${project}`, clear: () => setProject('') },
    city && { k: 'c', label: `المدينة: ${city}`, clear: () => setCity('') },
    (fromMonth || toMonth) && { k: 'm', label: `الشهر: ${fromMonth ? dateTxt(fromMonth, { year: true }) : '—'} ← ${toMonth ? dateTxt(toMonth, { year: true }) : '—'}`,
      clear: () => { setFromMonth(''); setToMonth(''); } },
    status && { k: 's', label: `الحالة: ${STATUS_LABEL[status]}`, clear: () => setStatus('') },
    hasClaims && { k: 'h', label: 'لها مستخلصات', clear: () => setHasClaims(false) },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];
  const filtering = chips.length > 0;
  const filterLine = filtering ? chips.map((c) => c.label).join(' · ') : null;

  const exportUrl = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') p.set(k, String(v));
    const s = p.toString();
    return apiBase() + '/api/v1/budget/export.xlsx' + (s ? `?${s}` : '');
  }, [query]);

  async function upload() {
    setOutcome(null);
    if (!window.egco?.pickFiles) {
      setOutcome({ ok: false, message: 'اختيار الملفات متاح داخل التطبيق فقط — افتح «EGCO Dashboard» من مجلد التطبيقات.', details: [] });
      return;
    }
    let picked: { name: string; path: string }[] = [];
    try { picked = await window.egco.pickFiles(); }
    catch (e) { setOutcome({ ok: false, message: `تعذّر فتح نافذة اختيار الملفات: ${(e as Error)?.message ?? e}`, details: [] }); return; }
    if (!picked.length) return;
    const { accepted, rejected } = splitBudgetFiles(picked);
    if (!accepted.length) {
      setOutcome({ ok: false, details: rejected.map((f) => f.name),
        message: 'لم يُرفع شيء — تقرير الموازنة يجب أن يكون ملف Excel بامتداد .xlsx. ملف مسحٌ ضوئي (صورة) لا يُقرأ آلياً — استعمل الإدخال اليدوي وأرفقه كمرجع.' });
      return;
    }
    setUploading(true);
    let imported = 0, updated = 0;
    const projects = new Set<string>(); const failures: string[] = [];
    for (const f of accepted) {
      try {
        const r = await api.budgetImport(f.path);
        imported += r?.imported ?? 0; updated += r?.updated ?? 0;
        for (const p of r?.projects ?? []) projects.add(p);
      } catch (e) { failures.push(`${f.name} — ${(e as Error)?.message ?? e}`); }
    }
    setUploading(false);
    const skipped = rejected.length ? [`تُجوهل ${int(rejected.length)} ملفاً بامتداد غير مقبول: ${rejected.map((f) => f.name).join('، ')}`] : [];
    setOutcome(failures.length === 0
      ? { ok: true, details: skipped, message: `تم استيراد ${int(imported)} لقطة${updated ? ` وتحديث ${int(updated)}` : ''} لمشاريع: ${[...projects].join('، ') || '—'}` }
      : { ok: false, details: [...failures, ...skipped],
          message: imported + updated > 0 ? `اكتمل جزئياً — استُورد ${int(imported + updated)} لقطة، وفشل ${int(failures.length)}:` : 'لم يُستورد شيء:' });
    await invalidate(BUDGET_ROOTS);
  }

  if (docMode && overview.data) return <BudgetDoc d={overview.data} onBack={() => setDocMode(false)} />;

  const L = list.data;
  if (printMode && L) {
    const cols: PrintableColumn[] = [
      { key: 'project', label: 'المشروع', render: (r: BudgetRow) => r.project },
      { key: 'city', label: 'المدينة', render: (r: BudgetRow) => r.city || '—' },
      { key: 'month', label: 'الشهر', render: (r: BudgetRow) => dateTxt(r.month, { year: true }) },
      { key: 'actual', label: 'الفعلي (ر.س)', ltr: true, render: (r: BudgetRow) => fmt(r.actualMonth) },
      { key: 'planned', label: 'المخطط (ر.س)', ltr: true, render: (r: BudgetRow) => fmt(r.plannedMonth) },
      { key: 'deviation', label: 'انحراف الشهر (ر.س)', ltr: true, render: (r: BudgetRow) => <span className={tcls(monthTone(r.deviationMonth))}>{fmt(r.deviationMonth)}</span> },
      { key: 'cumActual', label: 'تراكمي فعلي (ر.س)', ltr: true, render: (r: BudgetRow) => fmt(r.cumActual) },
      { key: 'cumPlanned', label: 'تراكمي مخطط (ر.س)', ltr: true, render: (r: BudgetRow) => fmt(r.cumPlanned) },
      { key: 'delayPct', label: 'نسبة التأخر التراكمية', ltr: true, render: (r: BudgetRow) => <Pct value={r.delayPct} className={tcls(cumTone(r.delayPct))} /> },
      { key: 'status', label: 'الحالة', render: (r: BudgetRow) => STATUS_LABEL[r.status] ?? r.status },
      { key: 'source', label: 'المصدر', render: (r: BudgetRow) => (r.entrySource === 'manual' ? 'يدوي' : 'ملف') },
    ];
    return (
      <PrintableList docTitle="تقرير الموازنة — بالتصفية الحالية" fileStamp="موازنة-مصفّاة" scopeLine="مرتَّبة بالمشروع ثم بالشهر"
        filterLine={filterLine} countLabel={`${int(L.count)} شهر`} columns={cols} rows={L.rows}
        totalsCells={[`الإجمالي (${int(L.count)})`, '', '', fmt(L.totals.actualMonth), fmt(L.totals.plannedMonth), '',
          fmt(L.totals.cumActual), fmt(L.totals.cumPlanned), '', '', '']}
        summary={[
          { label: 'الفعلي', value: `${fmt(L.totals.actualMonth)} ر.س` }, { label: 'المخطط', value: `${fmt(L.totals.plannedMonth)} ر.س` },
          { label: 'التراكمي الفعلي', value: `${fmt(L.totals.cumActual)} ر.س` }, { label: 'التراكمي المخطط', value: `${fmt(L.totals.cumPlanned)} ر.س` },
        ]}
        onBack={() => setPrintMode(false)} />
    );
  }

  const groups = L ? groupByProject(L.rows) : [];
  return (
    <>
      <PageHeader title="الموازنة التقديرية" sub="حجم العمل الفعلي مقابل المخطط ونسب التأخر والإنجاز لكل مشروع"
        actions={<>
          {overview.data && overview.data.projects.length > 0 && <Button onClick={() => setDocMode(true)}>تقرير الموازنة (طباعة/PDF)</Button>}
          <Button size="sm" icon="download" onClick={() => setExportOpen(true)}>تصدير (بالتصفية)</Button>
          <Button size="sm" disabled={!L || L.count === 0} onClick={() => setPrintMode(true)}>طباعة/PDF (بالتصفية)</Button>
          <Button onClick={() => setEntry({ project: '', existing: null, editable: true })}>مشروع جديد — إدخال يدوي</Button>
          <Button kind="primary" icon="cloud" disabled={uploading} onClick={() => void upload()}>{uploading ? 'جارٍ الاستيراد…' : 'رفع تقرير الموازنة'}</Button>
        </>} />
      <Grid>
        {outcome && (
          <Island span={12} crit={!outcome.ok} className="sp-callout">
            <p className={outcome.ok ? 't-ok' : 't-warn'}>{outcome.message}</p>
            {outcome.details.length > 0 && <ul className="sp-list">{outcome.details.map((x, i) => <li key={i}>{x}</li>)}</ul>}
          </Island>
        )}
        {L && (L.projects.length > 0 || L.cities.length > 0) && (
          <Island span={12} i={0}>
            <div className="sp-filters">
              <label><span className="cap">المشروع</span><select value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">الكل</option>{L.projects.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
              <label><span className="cap">المدينة</span><select value={city} onChange={(e) => setCity(e.target.value)}>
                <option value="">الكل</option>{L.cities.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
              <label><span className="cap">من شهر</span><input type="month" value={fromMonth.slice(0, 7)}
                onChange={(e) => setFromMonth(e.target.value ? e.target.value + '-01' : '')} /></label>
              <label><span className="cap">إلى شهر</span><input type="month" value={toMonth.slice(0, 7)}
                onChange={(e) => setToMonth(e.target.value ? e.target.value + '-01' : '')} /></label>
              <label><span className="cap">الحالة</span><select value={status} onChange={(e) => setStatus(e.target.value as BudgetStatusFilter)}>
                <option value="">الكل</option><option value="ahead">متقدّم</option><option value="behind">متأخر</option><option value="on_track">مطابق</option></select></label>
              <Chip pressed={hasClaims} onClick={() => setHasClaims(!hasClaims)}>لها مستخلصات فقط</Chip>
              {filtering && <Button size="sm" kind="ghost" onClick={clearAll}>مسح الكل</Button>}
            </div>
            {filtering && <div className="sp-chips">{chips.map((c) => <Chip key={c.k} pressed onClick={c.clear}>{c.label} ✕</Chip>)}</div>}
            {L.count > 0 && <p className="cap">{int(L.count)} شهر · إجمالي الفعلي <Money value={L.totals.actualMonth} /> مقابل مخطط <Money value={L.totals.plannedMonth} /></p>}
          </Island>
        )}
        <BudgetPlanPanel preferred={project || undefined} i={0} />
        {list.error ? <div className="c12"><ErrorBox error={list.error} onRetry={() => void list.refetch()} /></div>
          : !L ? <div className="c12"><Skeleton rows={6} /></div>
          : groups.length === 0 ? (
            <Island span={12}>
              <EmptyState icon={filtering ? 'search' : 'inbox'}
                title={filtering ? 'لا نتائج مطابقة للتصفية' : 'لم تُرفع بيانات الموازنة بعد'}
                body={filtering ? 'لا شهور تطابق هذه الفلاتر — جرّب توسيع المدى أو مسح الفلاتر.' : 'ارفع ملف تقرير الانحراف الشهري أو أدخل شهراً يدوياً ليظهر هنا.'}
                cta={filtering ? 'مسح الفلاتر' : 'رفع الملفات'} onCta={filtering ? clearAll : () => go(paths.imports)} />
            </Island>
          ) : groups.map((g, i) => <ProjectCard key={g.project} g={g} i={i + 1} onManage={() => setManage(g.project)}
              onOpen={() => go(paths.project(g.project))} />)}
      </Grid>

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} title="تصدير الموازنة — بالتصفية الحالية"
        fileName="موازنة.csv" xlsxUrl={exportUrl} rows={L?.rows ?? []}
        columns={[
          { label: 'المشروع', value: (r: BudgetRow) => r.project }, { label: 'المدينة', value: (r: BudgetRow) => r.city },
          { label: 'الشهر', value: (r: BudgetRow) => r.month.slice(0, 7) }, { label: 'الفعلي', value: (r: BudgetRow) => r.actualMonth },
          { label: 'المخطط', value: (r: BudgetRow) => r.plannedMonth }, { label: 'انحراف الشهر', value: (r: BudgetRow) => r.deviationMonth },
          { label: 'التراكمي الفعلي', value: (r: BudgetRow) => r.cumActual }, { label: 'التراكمي المخطط', value: (r: BudgetRow) => r.cumPlanned },
          { label: 'نسبة التأخر', value: (r: BudgetRow) => r.delayPct }, { label: 'الحالة', value: (r: BudgetRow) => STATUS_LABEL[r.status] ?? r.status },
          { label: 'المصدر', value: (r: BudgetRow) => (r.entrySource === 'manual' ? 'يدوي' : 'ملف') }, { label: 'رقم الوثيقة', value: (r: BudgetRow) => r.docNo },
        ]} />

      {manage && <ManageDrawer project={manage} onClose={() => setManage(null)}
        onEntry={(existing) => setEntry({ project: manage, existing })} />}
      {entry && <BudgetEntryForm project={entry.project} existing={entry.existing} projectEditable={entry.editable}
        onClose={() => setEntry(null)} />}
    </>
  );
}

function ProjectCard({ g, i, onManage, onOpen }: { g: MonthGroup; i: number; onManage: () => void; onOpen: () => void }) {
  const latest = g.rows[g.rows.length - 1];
  const conflicts = conflictMonths(g.rows);
  return (
    <Island span={12} i={i} title={g.project + (g.city ? ` — ${g.city}` : '')} crit={conflicts.length > 0}
      actions={<><Button size="sm" kind="ghost" onClick={onOpen}>صفحة المشروع</Button>
        <Button data-testid="budget-manage" size="sm" onClick={onManage}>إدارة الأشهر ومقاولو المشروع</Button></>}>
      <p className="cap">آخر شهر: {dateTxt(latest.month, { year: true })}{latest.docNo ? ` · وثيقة ${latest.docNo}` : ''} · {latest.entrySource === 'manual' ? 'إدخال يدوي' : 'من ملف'}</p>
      {conflicts.length > 0 && <p className="t-warn">تعارض: {conflicts.map((m) => dateTxt(m + '-01', { year: true })).join('، ')} — أكثر من إدخال للشهر؛ لن نجمعهما بصمت.</p>}
      <div className="grid">
        <Kpi label="الفعلي للشهر" value={latest.actualMonth} />
        <Kpi label="المخطط للشهر" value={latest.plannedMonth} />
        <Kpi label="انحراف الشهر" value={latest.deviationMonth} tone={ktone(monthTone(latest.deviationMonth))} />
        <Kpi label="نسبة الإنجاز التراكمية ٪" money={false} size="hero" tone={ktone(cumTone(latest.delayPct))}
          value={latest.completionPct == null ? null : Math.round(latest.completionPct * 1000) / 10} />
      </div>
      <p className="cap">التراكمي: الفعلي <Money value={latest.cumActual} /> مقابل المخطط <Money value={latest.cumPlanned} /> · نسبة التأخر التراكمية{' '}
        <Pct value={latest.delayPct} className={tcls(cumTone(latest.delayPct))} /> <DeltaArrow deltaPp={latest.delayDeltaPp} /></p>
      <MonthsTable rows={g.rows} id="projects.budget.months" />
    </Island>
  );
}

function MonthsTable({ rows, id, onEdit, onDelete }: { rows: BudgetRow[]; id: string; onEdit?: (r: BudgetRow) => void; onDelete?: (r: BudgetRow) => void }) {
  const cols: Column<BudgetRow>[] = [
    { key: 'month', label: 'الشهر', date: true, year: true },
    { key: 'actualMonth', label: 'الفعلي', money: true },
    { key: 'plannedMonth', label: 'المخطط', money: true },
    { key: 'deviationMonth', label: 'انحراف الشهر', money: true, render: (r) => <Money value={r.deviationMonth} className={tcls(monthTone(r.deviationMonth))} /> },
    { key: 'cumActual', label: 'تراكمي فعلي', money: true, hidden: !onEdit },
    { key: 'cumPlanned', label: 'تراكمي مخطط', money: true, hidden: !onEdit },
    { key: 'delayPct', label: 'التأخر التراكمي', num: true, render: (r) => <Pct value={r.delayPct} className={tcls(cumTone(r.delayPct))} /> },
    { key: 'trend', label: 'الاتجاه', sort: false, render: (r) => <DeltaArrow deltaPp={r.delayDeltaPp} /> },
    { key: 'source', label: 'المصدر', sort: false, render: (r) => (<><Pill tone={r.entrySource === 'manual' ? 'warn' : 'neutral'}>
      {r.entrySource === 'manual' ? 'يدوي' : 'ملف'}</Pill>{r.hasAttachment && <span className="cap"> مرفق</span>}</>) },
  ];
  if (onEdit && onDelete) cols.push({ key: 'acts', label: '', sort: false, required: true, render: (r) => (
    <span className="sp-rowacts"><Button size="sm" onClick={() => onEdit(r)}>تعديل</Button>
      <Button size="sm" kind="ghost" onClick={() => onDelete(r)} aria-label={`حذف ${dateTxt(r.month, { year: true })}`}>حذف</Button></span>) });
  return <DataTable<BudgetRow> id={id} rows={rows} rowKey="id" columns={cols} density="compact" search={false}
    rowTestId={onEdit ? (r) => `budget-month-row-${r.month.slice(0, 7)}` : undefined}
    total={{ keys: ['actualMonth', 'plannedMonth'], label: 'الإجمالي' }} />;
}

function ManageDrawer({ project, onClose, onEntry }: { project: string; onClose: () => void; onEntry: (r: BudgetRow | null) => void }) {
  const q = useBudgetProject(project);
  const d = q.data;
  async function del(m: BudgetRow) {
    const ok = await confirm({ title: `حذف شهر ${dateTxt(m.month, { year: true })}؟`, danger: true, confirmLabel: 'حذف',
      body: 'سيُعاد حساب تراكمي الأشهر التالية بافتراض غيابه.' });
    if (!ok) return;
    try { await api.budgetDelete(m.id); await invalidate(BUDGET_ROOTS); toast('حُذف الشهر', { kind: 'ok' }); }
    catch (e) { toast(String((e as Error)?.message ?? e), { kind: 'error' }); }
  }
  return (
    <Drawer open onClose={onClose} title={`إدارة الموازنة — ${project}`} width={920}
      actions={<Button data-testid="budget-month-add" size="sm" kind="primary" onClick={() => onEntry(null)}>إضافة شهر</Button>}>
      {q.error ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !d ? <Skeleton rows={5} /> : (
        <div className="sp-stack">
          <p className="cap">{d.city ? `المدينة: ${d.city} · ` : ''}{int(d.months.length)} شهر مسجَّل</p>
          <MonthsTable rows={d.months} id="projects.budget.manage" onEdit={(r) => onEntry(r)} onDelete={(r) => void del(r)} />
          <section>
            <h3>التزامات مقاولي هذا المشروع</h3>
            <p className="cap">من وحدة المقاولين — مصدر منفصل تماماً عن رقم موازنة المشروع، لا يُجمع معه. السالب = نحن ندين له.</p>
            {d.contractors.length === 0 ? <p className="empty-note">لا مقاولون مربوطون بمشروع «{project}» في وحدة المقاولين.</p> : (
              <div className="tbl-wrap"><table><thead><tr><th>المقاول</th><th>الكود</th><th className="n">الرصيد</th></tr></thead>
                <tbody>{d.contractors.map((c, i) => (<tr key={String(c.code ?? i)}><td>{String(c.name ?? '—')}</td>
                  <td className="num">{String(c.code ?? '—')}</td>
                  <td className="n">{typeof c.balance === 'number' ? <Money value={c.balance} /> : <span className="dash">—</span>}</td></tr>))}</tbody></table></div>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}
