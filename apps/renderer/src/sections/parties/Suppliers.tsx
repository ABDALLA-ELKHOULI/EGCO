/* الموردون — يستبدل pages/Suppliers.tsx (P-052…P-075). كل تصفية وترتيب على الخادم؛ الإجماليات من الخادم. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useGo } from '@/app/routes';
import {
  Button, DataTable, EmptyState, ExportDialog, Field, FormGrid, Grid, Island, Kpi, Money, PageHeader, Pill,
  Skeleton, dateTxt, int, toast, useForm, usePrefs, type Column, type TableQuery,
} from '@/ui';
import { STATUS, arRange } from '@/lib/format';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';
import { AiBlock } from '@/components/Ai';
import { partiesApi } from './api';
import { SUPPLIER_ROOTS, useApiMutation, useSuppliers } from './hooks';
import {
  DELAY_BUCKETS, EMPTY_SUPPLIER_FILTERS, delayBreakdown, fitBudget, supplierBody, supplierChipLabels, supplierQuery,
  supplierRowTone, termText, validateSupplier, type SupplierListFilters,
} from './logic/suppliers';
import { filterLine, type Chip as ChipT } from './logic/table';
import { sumCents } from './logic/money';
import {
  ChipsBar, DeletePartyModal, FDates, FRange, FSelect, FText, PModal, ProjectChips, ProjectsCell, ErrBox, errMsg, toneOf, useAi,
} from './components/shared';
import type { PriorityItem, SupplierListResponse, SupplierRow } from './types';
import './parties.css';

// قاعدة الجرعة (DESIGN-DIRECTION §3.1): لا خلفية حمراء/صفراء للصف — اللون في شارة الحالة ومبلغ التأخر فقط.
const ROW_CLS = { overdue: '', 'due-soon': '', settled: 'pt-row-done', '': '' } as const;

export default function Suppliers() {
  usePrefs();
  const go = useGo();
  const [sp, setSp] = useSearchParams();
  const [f, setF] = useState<SupplierListFilters>(() => ({ ...EMPTY_SUPPLIER_FILTERS, project: sp.get('project') ?? '' }));
  const set = (patch: Partial<SupplierListFilters>) => setF((x) => ({ ...x, ...patch }));
  // البحث يُرسل بعد ٢٠٠ms من آخر حرف (P-052)؛ بقية الحقول فوراً.
  const [deb, setDeb] = useState(f);
  useEffect(() => { const t = setTimeout(() => setDeb(f), 200); return () => clearTimeout(t); }, [f]);
  const query = useMemo(() => supplierQuery(deb), [deb]);
  const list = useSuppliers(query);
  const d = list.data;

  const [form, setForm] = useState<{ row?: SupplierRow } | null>(sp.get('new') ? {} : null);
  const [del, setDel] = useState<SupplierRow | null>(null);
  const [delayRow, setDelayRow] = useState<SupplierRow | null>(null);
  const [prio, setPrio] = useState(false);
  const [print, setPrint] = useState(false);
  const [exp, setExp] = useState(false);
  const [pick, setPick] = useState<SupplierRow[]>([]);
  const [payExp, setPayExp] = useState(false);
  const ai = useAi();

  const chips: ChipT[] = supplierChipLabels(f).map((c) => ({
    k: c.k, label: c.label,
    clear: () => set(c.k === 'o' ? { minOut: '', maxOut: '' } : c.k === 'dt' ? { payFrom: '', payTo: '' }
      : { [c.k]: c.k === 'sort' ? null : '' } as Partial<SupplierListFilters>),
  }));
  const clearAll = () => { setF({ ...EMPTY_SUPPLIER_FILTERS, sort: f.sort }); if (sp.get('project')) setSp({}, { replace: true }); };
  const fl = filterLine(chips);
  const projects = d?.projects ?? [];

  if (print && d) return <SuppliersPrint d={d} filterLine={fl} onBack={() => setPrint(false)} />;

  const cols: Column<SupplierRow>[] = [
    { key: 'name', label: 'المورد', required: true, render: (r) => (
      <><b data-testid={`party-row-${r.account}`}>{r.name}</b>{r.firstActivity && <span className="pt-sub">التغطية: {arRange(r.firstActivity, r.lastActivity)}</span>}</>) },
    { key: 'account', label: 'رقم الحساب', render: (r) => {
      const t = termText(r);
      return (<><span className="num">{r.account}</span>
        <span className="pt-sub">{t.days != null ? `${int(t.days)} يوم` : t.raw}</span>
        {r.termKind === 'unset' && <Pill tone="warn">مدة السداد غير محدّدة</Pill>}</>);
    } },
    { key: 'project', label: 'المشروع', render: (r) => <ProjectsCell projects={r.projects} fallback={r.project} /> },
    { key: 'status', label: 'الحالة', render: (r) => { const st = STATUS[r.status] ?? { label: r.status, cls: '' }; return <Pill tone={toneOf(st.cls)}>{st.label}</Pill>; } },
    { key: 'delay', label: 'التأخر', num: true, render: (r) => r.delay?.days > 0 ? (
      <button type="button" className="pt-link" title="عرض توزيع المتأخر على الشرائح"
        onClick={(e) => { e.stopPropagation(); setDelayRow(r); }}>
        <Money value={r.delay.amount} className="t-danger" />
        <span className="pt-sub">{DELAY_BUCKETS.find((b) => b.value === r.delay.bucket)?.label} · {int(r.delay.days)} يوم</span>
      </button>) : <span className="dash">—</span> },
    // م-٣٥: المفتوح محايد — الأحمر للمتأخر وحده.
    { key: 'outstanding', label: 'المديونية المفتوحة', money: true, render: (r) => r.outstanding > 0 ? <Money value={r.outstanding} /> : <span className="dash">—</span> },
    { key: 'lastPaymentDate', label: 'آخر دفعة', render: (r) => r.lastPayment
      ? <><Money value={r.lastPayment.amount} /><span className="pt-sub">{dateTxt(r.lastPayment.date, { year: true })}</span></>
      : <span className="cap">لا دفعات</span> },
    { key: '_a', label: '', sort: false, required: true, render: (r) => (
      <span className="pt-acts">
        <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={(e) => { e.stopPropagation(); setForm({ row: r }); }}>✎</button>
        <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={(e) => { e.stopPropagation(); setDel(r); }}>🗑</button>
      </span>) },
  ];

  const onQuery = (q: TableQuery) => { if (JSON.stringify(q.sort) !== JSON.stringify(f.sort)) set({ sort: q.sort }); };

  return (
    <>
      <PageHeader title="الموردون"
        sub={<>{d ? `${int(d.count)} نتيجة · مفتوح ` : ''}{d && <Money value={d.totals.outstanding} />}{d ? ' · ' : ''}مرتّبون بالمتأخر ثم بالمديونية المفتوحة</>}
        actions={<>
          {ai && <Button aria-expanded={prio} onClick={() => setPrio((v) => !v)}>{prio ? 'إخفاء أولويات السداد' : 'أولويات السداد'}</Button>}
          <Button onClick={() => setExp(true)} disabled={!d}>تصدير</Button>
          <Button onClick={() => setPrint(true)} disabled={!d}>PDF</Button>
          <Button kind="primary" data-testid="supplier-add" onClick={() => setForm({})}>+ مورد</Button>
        </>} />
      <Grid>
        <div data-testid="kpi-outstanding" style={{ display: 'contents' }}><Kpi span={3} i={0} label="المديونية المفتوحة" value={d?.totals.outstanding ?? null} hint="ضمن التصفية الحالية" /></div>
        <Kpi span={3} i={1} label="متأخر" value={d?.totals.overdue ?? null} tone="danger" crit={(d?.totals.overdue ?? 0) > 0}
          onClick={() => set({ status: 'overdue' })} hint="انقر لعرض المتأخرين" />
        <Kpi span={3} i={2} label="مستحق خلال ٧ أيام" value={d?.totals.dueWithin7 ?? null} tone="warn" onClick={() => set({ status: 'due_soon' })} />
        <Kpi span={3} i={3} label="عدد الفواتير المفتوحة" money={false}
          value={d ? d.rows.reduce((a, r) => a + (r.openInvoiceCount || 0), 0) : null} />
        {prio && <Island span={12} i={4} title="أولويات السداد"><PrioritiesPanel /></Island>}
        <Island span={12} i={5}>
          <div className="pt-xfil">
            <FText label="بحث" wide value={f.q} onChange={(v) => set({ q: v })} placeholder="بحث بالاسم أو رقم الحساب…" />
            <FText label="رقم الحساب" value={f.account} onChange={(v) => set({ account: v })} placeholder="211…" />
            <FSelect label="المشروع" value={f.project} onChange={(v) => set({ project: v })} allLabel="كل المشاريع"
              options={projects.map((p) => ({ value: p, label: p }))} />
            <FSelect label="الحالة" value={f.status} onChange={(v) => set({ status: v as SupplierListFilters['status'] })} allLabel="كل الحالات"
              options={Object.keys(STATUS).map((k) => ({ value: k, label: STATUS[k].label }))} />
            <FSelect label="التأخر" value={f.delay} onChange={(v) => set({ delay: v })} allLabel="كل الشرائح"
              options={DELAY_BUCKETS.map((b) => ({ value: b.value, label: b.label, hint: b.hint }))} />
            <FRange label="المديونية المفتوحة" min={f.minOut} max={f.maxOut} onMin={(v) => set({ minOut: v })} onMax={(v) => set({ maxOut: v })} />
            <FDates label="آخر دفعة" from={f.payFrom} to={f.payTo} onFrom={(v) => set({ payFrom: v })} onTo={(v) => set({ payTo: v })} />
          </div>
          {/* التصفية تُعلن عن نفسها — رقمٌ يصف مجموعة مصفّاة دون أن يقول ذلك أخطر من ألا يظهر. */}
          <ChipsBar chips={chips} onClearAll={clearAll}
            extra={d && <>متأخر ضمن التصفية: <Money value={d.totals.delayed} /></>} />
          {list.error && !d ? <EmptyState icon="alert" title="تعذّر التحميل" body={list.error.message} cta="إعادة المحاولة" onCta={() => list.refetch()} />
            : !d ? <Skeleton rows={8} />
            : d.rows.length === 0 && !chips.length ? (
              <EmptyState icon="users" title="لم تُرفع قائمة الموردين بعد" body="ارفع ملف «مدة مديونية الموردين» بصيغة Excel لتظهر هنا."
                cta="رفع الملف" onCta={() => go('data.import')} />
            ) : (
              <DataTable<SupplierRow> id="parties.suppliers" mode="server" rows={d.rows} rowKey="account" columns={cols}
                search={false} sort={f.sort} onQueryChange={onQuery}
                total={{ keys: ['delay', 'outstanding'], label: `الإجمالي (${int(d.count)})` }}
                totals={{ delay: d.totals.delayed, outstanding: d.totals.outstanding }}
                rowClass={(r) => ROW_CLS[supplierRowTone(r)] || undefined}
                onRowClick={(r) => go('parties.supplier', { account: r.account })}
                selectable onSelect={(_k, rows) => setPick(rows)}
                selectionBar={{ label: 'قائمة الدفع — متأخر + خلال ٧ أيام', sumValue: (r) => sumCents([r], (x) => x.overdue) + sumCents([r], (x) => x.dueWithin7),
                  actions: [{ label: 'تصدير قائمة الدفع', kind: 'primary', onClick: () => setPayExp(true) }] }}
                empty={{ icon: 'search', title: 'لا نتائج مطابقة', body: 'لم يطابق البحث أو التصفية أي مورد.', cta: 'مسح التصفية', onCta: clearAll }} />
            )}
          {d && d.rows.length > 0 && (
            <p className="disclose">للسداد اليومي: <button type="button" className="pt-link" onClick={() => go('today.due')}>المستحقات القادمة</button></p>
          )}
        </Island>
      </Grid>

      <ExportDialog open={exp} onClose={() => setExp(false)} title="تصدير الموردين" fileName="الموردون.csv"
        xlsxUrl={partiesApi.suppliersExportUrl(query)} rows={d?.rows ?? []}
        columns={[
          { label: 'الحساب', value: (r: SupplierRow) => r.account }, { label: 'المورد', value: (r) => r.name },
          { label: 'المشاريع', value: (r) => (r.projects?.length ? r.projects : [r.project ?? '']).join('، ') },
          { label: 'الحالة', value: (r) => STATUS[r.status]?.label ?? r.status }, { label: 'التأخر', value: (r) => r.delay?.amount ?? 0 },
          { label: 'المديونية المفتوحة', value: (r) => r.outstanding },
          { label: 'آخر دفعة — التاريخ', value: (r) => r.lastPayment?.date ?? '' }, { label: 'آخر دفعة — المبلغ', value: (r) => r.lastPayment?.amount ?? '' },
        ]} />
      <ExportDialog open={payExp} onClose={() => setPayExp(false)} title="قائمة الدفع" fileName="قائمة-الدفع.csv" rows={pick}
        columns={[
          { label: 'الحساب', value: (r: SupplierRow) => r.account }, { label: 'المورد', value: (r) => r.name },
          { label: 'متأخر', value: (r) => r.overdue }, { label: 'خلال ٧ أيام', value: (r) => r.dueWithin7 },
          { label: 'المقترح للدفع', value: (r) => sumCents([r.overdue, r.dueWithin7], (x) => x) },
          { label: 'المديونية المفتوحة', value: (r) => r.outstanding },
        ]} />

      <SupplierFormModal open={!!form} row={form?.row} known={projects}
        onClose={() => { setForm(null); if (sp.get('new')) setSp({}, { replace: true }); }}
        onCreated={(account) => go('parties.supplier', { account })} />
      {del && <DeletePartyModal open kind="supplier" name={del.name} keyValue={del.account} onClose={() => setDel(null)}
        onDeleted={() => { setDel(null); void list.refetch(); }} />}
      <DelayBreakdownModal row={delayRow} onClose={() => setDelayRow(null)} onOpen={(a) => go('parties.supplier', { account: a })} />
    </>
  );
}

/** نافذة «توزيع المتأخر» (P-069). */
function DelayBreakdownModal({ row, onClose, onOpen }: { row: SupplierRow | null; onClose: () => void; onOpen: (a: string) => void }) {
  usePrefs();
  return (
    <PModal open={!!row} onClose={onClose} title={row ? `توزيع المتأخر — ${row.name}` : ''} size="sm"
      actions={[{ label: 'إغلاق' }, { label: 'فتح كشف المورد', kind: 'primary', onClick: (c) => { c(true); if (row) onOpen(row.account); } }]}>
      {row && (<>
        <p className="cap">المبلغ غير المسدد موزَّعاً بعمر التأخر عن تاريخ الاستحقاق. أقصى تأخر: <b className="num">{int(row.delay.days)}</b> يوماً.</p>
        <div className="tbl-wrap"><table>
          <thead><tr><th>الشريحة</th><th className="n">المبلغ</th></tr></thead>
          <tbody>{delayBreakdown(row.delay.byBucket).map((b) => (
            <tr key={b.value} className={b.amount > 0 ? undefined : 'pt-row-done'}>
              <td>{b.label} <span className="cap">{b.hint}</span></td>
              <td className="n">{b.amount > 0 ? <Money value={b.amount} className="t-danger" /> : <span className="dash">—</span>}</td>
            </tr>))}</tbody>
          <tfoot><tr><td>الإجمالي المتأخر</td><td className="n"><Money value={row.delay.amount} className="t-danger" /></td></tr></tfoot>
        </table></div>
      </>)}
    </PModal>
  );
}

/** أولويات السداد (P-074): الترتيب حتمي من الخادم دائماً؛ سرد المساعد فوقه حين يتوفر. «ضمن الميزانية» تقدير محلي تراكمي. */
function PrioritiesPanel() {
  usePrefs();
  const go = useGo();
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ items: PriorityItem[]; narrative: string } | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    const b = budget.trim() ? Number(budget) : undefined;
    try { setData(await partiesApi.aiPriorities(b)); }
    catch (e) { setError(errMsg(e)); }
    finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void run(); }, []);
  const rows = data ? fitBudget(data.items, budget) : [];
  const hasBudget = budget.trim() !== '';
  return (
    <>
      <span className="cap">الترتيب محسوب بقواعد حتمية، والشرح فقط من المساعد</span>
      <div className="pt-xfil">
        <label><span>ميزانية متاحة (ر.س)</span><input inputMode="decimal" dir="ltr" placeholder="اختياري" value={budget}
          onChange={(e) => setBudget(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void run(); }} /></label>
        <Button kind="primary" size="sm" disabled={busy} onClick={() => void run()}>{busy ? 'جارٍ الحساب…' : 'تحديث'}</Button>
      </div>
      <AiBlock busy={busy} error={error}>
        {data && (data.items.length === 0 ? <p className="disclose">لا بنود مرشّحة حالياً.</p> : (
          <>
            <div className="tbl-wrap"><table>
              <thead><tr><th>#</th><th>الاسم</th><th></th><th className="n">المبلغ</th><th>السبب</th>{hasBudget && <th>ضمن الميزانية</th>}</tr></thead>
              <tbody>{rows.map((it, i) => (
                <tr key={it.partyKind + it.key + i} className="go" onClick={() => go(it.partyKind === 'contractor' ? 'parties.contractor' : 'parties.supplier',
                  it.partyKind === 'contractor' ? { code: it.key } : { account: it.key })}>
                  <td className="num">{int(i + 1)}</td><td>{it.name}</td>
                  <td><Pill>{it.partyKind === 'contractor' ? 'مقاول' : 'مورد'}</Pill></td>
                  <td className="n"><Money value={it.amount} /></td><td className="cap">{it.reason}</td>
                  {hasBudget && <td>{it.fits && <Pill tone="ok">ضمن الميزانية</Pill>}</td>}
                </tr>))}</tbody>
            </table></div>
            {data.narrative && <p className="pt-notes">{data.narrative}</p>}
            {hasBudget && <p className="disclose">«ضمن الميزانية» تقدير محلي تراكمي بترتيب القائمة — لا يوجد حقل من الخادم يفيد بذلك صراحة.</p>}
          </>
        ))}
      </AiBlock>
    </>
  );
}

/** نموذج المورد (P-380، P-071، P-072). الحساب مقفل عند التعديل؛ ٢١١ يُفرض عند الإنشاء. */
export function SupplierFormModal({ open, row, known, onClose, onCreated }: {
  open: boolean; row?: Pick<SupplierRow, 'account' | 'name' | 'project' | 'projects' | 'term'>; known: string[];
  onClose: () => void; onCreated?: (account: string) => void;
}) {
  const isEdit = !!row;
  const init = useMemo(() => ({
    account: row?.account ?? '211', name: row?.name ?? '', term: row?.term ?? '',
    projects: row?.projects?.length ? row.projects : row?.project ? [row.project] : [] as string[],
  }), [row]);
  const form = useForm(init);
  useEffect(() => { if (open) form.reset(init); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, init]);
  const [err, setErr] = useState<string | null>(null);
  const save = useApiMutation((v: typeof init) => isEdit
    ? partiesApi.updateSupplier(row!.account, { name: v.name.trim(), term: v.term.trim(), projects: v.projects, project: v.projects[0] ?? '' })
    : partiesApi.createSupplier(supplierBody(v)), { invalidate: SUPPLIER_ROOTS, errorToast: false });
  return (
    <PModal open={open} onClose={onClose} title={isEdit ? 'تعديل مورد' : 'إضافة مورد'} dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: save.isPending ? 'جارٍ الحفظ…' : 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        setErr(null);
        const bad = validateSupplier(form.values, isEdit);
        if (bad) { form.setError(bad.field, bad.msg); return; }
        try {
          await save.mutateAsync(form.values);
          close(true);
          toast(isEdit ? 'حُفظ المورد' : `أُضيف المورد ${form.values.name.trim()}`, { kind: 'ok' });
          if (!isEdit) onCreated?.(form.values.account.trim());
        } catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <FormGrid>
        <Field form={form} name="account" label="رقم الحساب" required dir="ltr" readOnly={isEdit}
          help={isEdit ? 'رقم الحساب لا يُعدَّل' : 'يبدأ بـ211 ولا يتكرر'} />
        <Field form={form} name="name" label="اسم المورد" required />
        <Field form={form} name="term" label="مدة السداد" placeholder="مثال: ٤٥ يوم · كاش · مستخلص" full />
      </FormGrid>
      <ProjectChips label="المشاريع — قد يعمل المورد على أكثر من مشروع، والأول هو الأساسي في بقية الشاشات"
        value={form.values.projects} onChange={(v) => form.set('projects', v)} known={known} />
    </PModal>
  );
}

/** PDF القائمة (P-056/P-554) — نفس الصفوف والإجماليات المصفّاة من الخادم. */
function SuppliersPrint({ d, filterLine: line, onBack }: { d: SupplierListResponse; filterLine: string | null; onBack: () => void }) {
  const columns: PrintableColumn[] = [
    { key: 'name', label: 'المورد', render: (r: SupplierRow) => r.name },
    { key: 'account', label: 'رقم الحساب', ltr: true, render: (r: SupplierRow) => r.account },
    { key: 'project', label: 'المشروع', render: (r: SupplierRow) => (r.projects?.length ? r.projects.join('، ') : r.project || '—') },
    { key: 'status', label: 'الحالة', render: (r: SupplierRow) => STATUS[r.status]?.label ?? r.status },
    { key: 'delay', label: 'التأخر (ر.س)', ltr: true, render: (r: SupplierRow) => (r.delay?.days > 0 ? <Money value={r.delay.amount} noCur /> : '—') },
    { key: 'outstanding', label: 'المديونية المفتوحة (ر.س)', ltr: true, render: (r: SupplierRow) => (r.outstanding > 0 ? <Money value={r.outstanding} noCur /> : '—') },
  ];
  return (
    <PrintableList docTitle="قائمة الموردين" fileStamp="قائمة-الموردين" scopeLine="مرتبون بالمتأخر ثم بالمديونية المفتوحة"
      filterLine={line} countLabel={`${int(d.count)} نتيجة`} columns={columns} rows={d.rows}
      totalsCells={[`الإجمالي (${int(d.count)})`, '', '', '', <Money key="d" value={d.totals.delayed} noCur />, <Money key="o" value={d.totals.outstanding} noCur />]}
      footNote={line ? 'متأخر ضمن التصفية محسوب على المجموعة المصفّاة كاملةً' : undefined} onBack={onBack} />
  );
}
