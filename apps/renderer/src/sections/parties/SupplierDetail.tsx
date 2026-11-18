/* كشف المورد — يستبدل pages/SupplierDetail.tsx (P-076…P-097، P-382) + م-٥٠. */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGo } from '@/app/routes';
import {
  Button, DataTable, EmptyState, ExportDialog, Field, FormGrid, Grid, Island, Kpi, Money, PageHeader, Pill,
  Skeleton, confirm, dateTxt, int, toast, useForm, usePrefs, type Column,
} from '@/ui';
import { dueLabel, dueTone } from '@/lib/format';
import { ExplainDot } from '@/components/Explain';
import { partiesApi } from './api';
import { SUPPLIER_ROOTS, useAllocationSetting, useApiMutation, useSupplier, useSuppliers } from './hooks';
import {
  DELAY_BUCKETS, EMPTY_INVOICE_FILTERS, EMPTY_PAYMENT_FILTERS, INVOICE_STATUS_OPTIONS, allocationBody, allocationTotals,
  initialAllocation, invoiceActions, invoiceFiltering, manualBody, manualPreview, paymentFiltering, pipeInvoices, pipePayments,
  todayIso, toggleAllocInvoice, validateManual, type AllocDraft, type InvoiceFilters, type PaymentFilters,
} from './logic/suppliers';
import type { SortState } from './logic/table';
import { BalanceWord, DeletePartyModal, ErrBox, FDates, FRange, FSelect, FText, PModal, RemindModal, errMsg, toneOf, useAi } from './components/shared';
import { PartyProjectsCard } from './components/PartyProjects';
import { SupplierFormModal } from './Suppliers';
import type { SupplierDetailResponse, SupplierInvoice, SupplierPayment } from './types';
import './parties.css';

export default function SupplierDetail() {
  usePrefs();
  const go = useGo();
  const { account = '' } = useParams();
  const q = useSupplier(account);
  const d = q.data;
  const ai = useAi();
  const alloc = useAllocationSetting();
  const togglePA = useApiMutation((enabled: boolean) => partiesApi.setAllocationSetting(enabled), { invalidate: ['supplier', 'suppliers'] });
  const known = useSuppliers({}).data?.projects ?? [];

  const [showPaid, setShowPaid] = useState(false);
  const [bucket, setBucket] = useState<string | null>(null);
  const [inv, setInv] = useState<InvoiceFilters>(EMPTY_INVOICE_FILTERS);
  const [invSort, setInvSort] = useState<SortState | null>(null);
  const [pay, setPay] = useState<PaymentFilters>(EMPTY_PAYMENT_FILTERS);
  const [paySort, setPaySort] = useState<SortState | null>(null);
  const [entry, setEntry] = useState<{ mode: 'invoice' | 'payment'; row?: SupplierInvoice } | null>(null);
  const [due, setDue] = useState<SupplierInvoice | null>(null);
  const [allocFor, setAllocFor] = useState<{ payment: SupplierPayment; candidates: SupplierInvoice[] } | null>(null);
  const [remind, setRemind] = useState(false);
  const [edit, setEdit] = useState(false);
  const [del, setDel] = useState(false);
  const [exp, setExp] = useState(false);
  useEffect(() => { setBucket(null); setInv(EMPTY_INVOICE_FILTERS); setPay(EMPTY_PAYMENT_FILTERS); }, [account]);

  const delInvoice = useApiMutation((id: string) => partiesApi.deleteManualInvoice(id), { invalidate: SUPPLIER_ROOTS, success: 'حُذفت المديونية' });
  const delPayment = useApiMutation((id: string) => partiesApi.deleteManualPayment(id), { invalidate: SUPPLIER_ROOTS, success: 'حُذفت الدفعة' });

  const invoices = useMemo(() => (d ? pipeInvoices(d.invoices ?? [], { showPaid, bucket, filters: inv, sort: invSort }) : []), [d, showPaid, bucket, inv, invSort]);
  const payments = useMemo(() => (d ? pipePayments(d.payments ?? [], pay, paySort) : []), [d, pay, paySort]);

  if (q.isError && !d) return (
    <><PageHeader title="المورد غير متاح" crumb={{ label: '→ الموردون', onClick: () => go('parties.suppliers') }} />
      <EmptyState icon="alert" title="تعذّر التحميل" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} /></>);
  if (!d) return <Skeleton rows={10} />;

  const paOn = alloc.data?.enabled ?? false;
  const setI = (p: Partial<InvoiceFilters>) => setInv((x) => ({ ...x, ...p }));
  const setP = (p: Partial<PaymentFilters>) => setPay((x) => ({ ...x, ...p }));
  const bkt = bucket ? DELAY_BUCKETS.find((b) => b.value === bucket) : null;

  const invCols: Column<SupplierInvoice>[] = [
    { key: 'number', label: 'الفاتورة', render: (i) => <><span className="num">{i.number ?? '—'}</span> {i.source === 'manual' && <Pill tone="warn">يدوي</Pill>}
      {i.description && <span className="pt-sub">{i.description}</span>}</> },
    { key: 'date', label: 'تاريخ الفاتورة', date: true, year: true },
    { key: 'dueDate', label: 'الاستحقاق', render: (i) => i.dueDate ? dateTxt(i.dueDate, { year: true }) : <span className="dash">—</span> },
    { key: 'amount', label: 'المبلغ', money: true },
    { key: 'paid', label: 'المسدد', money: true, render: (i) => i.paid > 0 ? <Money value={i.paid} className="t-ok" /> : <span className="dash">—</span> },
    { key: 'remaining', label: 'المتبقي', money: true, render: (i) => i.remaining > 0
      ? <Money value={i.remaining} className={dueTone(i.daysToDue) === 'red' ? 't-danger' : undefined} /> : <span className="dash">—</span> },
    { key: 'status', label: 'الحالة', sort: false, render: (i) => i.remaining > 0
      ? <Pill tone={toneOf(dueTone(i.daysToDue))}>{dueLabel(i.daysToDue)}</Pill> : <Pill tone="ok">مسددة</Pill> },
    { key: '_a', label: '', sort: false, required: true, render: (i) => {
      const a = invoiceActions(i);
      return (<span className="pt-acts">
        {a.canEdit && <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={() => setEntry({ mode: 'invoice', row: i })}>✎</button>}
        {a.canDelete && <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={async () => {
          if (await confirm({ title: 'حذف مديونية', body: <>هل تريد حذف هذه المديونية اليدوية بمبلغ <Money value={i.amount} />؟</>, danger: true, confirmLabel: 'حذف' })) delInvoice.mutate(i.id);
        }}>🗑</button>}
        {a.dueDateAction && <Button size="sm" onClick={() => setDue(i)}>{a.dueDateAction}</Button>}
      </span>);
    } },
  ];
  const payCols: Column<SupplierPayment>[] = [
    { key: 'date', label: 'التاريخ', date: true, year: true },
    { key: 'doc', label: 'المستند', render: (p) => p.doc ? <span className="num">{p.doc}</span> : <span className="dash">—</span> },
    { key: 'description', label: 'الوصف', render: (p) => p.description || <span className="cap">{p.source === 'manual' ? 'يدوي' : 'من كشف مرفوع'}</span> },
    { key: 'amount', label: 'المبلغ', money: true, render: (p) => <Money value={p.amount} className="t-ok" /> },
    { key: '_a', label: '', sort: false, required: true, render: (p) => (
      <span className="pt-acts">
        {paOn && p.id && <Button size="sm" title="تخصيص هذه الدفعة لفاتورة أو أكثر، أو تعديل تخصيص سابق"
          onClick={() => setAllocFor({ payment: p, candidates: (d.invoices ?? []).filter((i) => i.remaining > 0) })}>تخصيص</Button>}
        {p.source === 'manual' && p.id && <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={async () => {
          if (await confirm({ title: 'حذف دفعة', body: <>هل تريد حذف هذه الدفعة اليدوية بمبلغ <Money value={p.amount} />؟</>, danger: true, confirmLabel: 'حذف' })) delPayment.mutate(p.id);
        }}>🗑</button>}
      </span>) },
  ];

  return (
    <>
      <PageHeader title={d.name} crumb={{ label: '→ الموردون', onClick: () => go('parties.suppliers') }}
        sub={<>حساب <span className="num">{d.account}</span>{d.project ? ` · ${d.project}` : ''} · مدة السداد {d.termKind === 'days' && d.termDays != null ? `${int(d.termDays)} يوماً` : d.term} · {int(d.invoiceCount)} فاتورة</>}
        actions={<>
          <Button size="sm" onClick={() => setEntry({ mode: 'invoice' })}>+ مديونية</Button>
          <Button size="sm" onClick={() => setEntry({ mode: 'payment' })}>+ دفعة</Button>
          <Button size="sm" kind="primary" onClick={() => go('reports.report', { account: d.account })}>استخراج التحليل</Button>
          {ai && <Button size="sm" onClick={() => setRemind(true)}>صياغة مطالبة</Button>}
          <Button size="sm" disabled={togglePA.isPending || alloc.isError} onClick={() => togglePA.mutate(!paOn)}
            title="تخصيص الدفعات — عند التفعيل، الدفعات الغامضة تُعلَّق بانتظار قرارك بدل تخمين الفاتورة">
            {paOn ? 'إيقاف تخصيص الدفعات' : 'تفعيل تخصيص الدفعات'}</Button>
          <Button size="sm" onClick={() => setExp(true)}>تصدير الكشف</Button>
          <Button size="sm" onClick={() => setEdit(true)}>تعديل</Button>
          <Button size="sm" kind="danger" onClick={() => setDel(true)}>حذف</Button>
        </>} />

      {paOn && (d.unallocatedCount ?? 0) > 0 && (
        <div className="pt-note">{int(d.unallocatedCount)} {d.unallocatedCount === 1 ? 'دفعة بانتظار التخصيص' : 'دفعات بانتظار التخصيص'} —
          لا يمكن التطبيق تحديد فاتورتها بثقة، فبقيت الفواتير المرشَّحة مفتوحة حتى تقرر.</div>)}
      {d.needsManualDueDate && (
        <div className="pt-note warn">مدة هذا المورد «{d.term}» — لا يُحسب الاستحقاق تلقائياً، ويحتاج إدخال تاريخ يدوياً بعد اعتماد المستخلص.</div>)}

      <Grid>
        <Kpi span={3} i={0} label="إجمالي المفوتر" value={d.totalInvoiced} />
        <Kpi span={3} i={1} label="المسدد" value={d.totalPaid} tone="ok" />
        <Kpi span={3} i={2} size="hero" label={<>المديونية المفتوحة <ExplainDot metric="outstanding" values={{ totalInvoiced: d.totalInvoiced, totalPaid: d.totalPaid, outstanding: d.outstanding }} /></>}
          value={d.outstanding} hint={<BalanceWord balance={-d.outstanding} />} />
        <Kpi span={3} i={3} label={<>متأخر <ExplainDot metric="overdue" values={{ overdue: d.overdue }} /></>} value={d.overdue}
          tone={d.overdue > 0 ? 'danger' : undefined} crit={d.overdue > 0} />

        {d.delay?.amount > 0 && (
          <Island span={8} i={4} title="المتأخر حسب مدة التأخر"
            actions={bucket ? <Button size="sm" onClick={() => setBucket(null)}>عرض الكل</Button> : <span className="cap">انقر شريحة لعرض فواتيرها</span>}>
            <p className="cap">فئات الأعمار محسوبة من تاريخ الاستحقاق <ExplainDot metric="ageingByDueDate" values={{}} /></p>
            <div className="pt-aging">
              {DELAY_BUCKETS.filter((b) => b.value !== 'none').map((b) => {
                const v = d.delay.byBucket?.[b.value] ?? 0; const on = bucket === b.value;
                return (
                  <button key={b.value} type="button" className={'pt-ag' + (on ? ' on' : '')} aria-pressed={on} disabled={v <= 0}
                    onClick={() => setBucket(on ? null : b.value)}>
                    <b>{b.label}</b><span className="cap">{b.hint}</span>
                    {v > 0 ? <Money value={v} className="t-danger" /> : <span className="dash">—</span>}
                  </button>);
              })}
            </div>
          </Island>)}
        <PartyProjectsCard kind="supplier" id={d.account} known={known} span={d.delay?.amount > 0 ? 4 : 12} i={5}
          fallbackProjects={d.projects?.length ? d.projects : d.project ? [d.project] : []} />

        <Island span={12} i={6} title={showPaid ? 'كل الفواتير' : 'الفواتير المفتوحة'}
          actions={<>
            {invoiceFiltering(inv) && <Button size="sm" onClick={() => setInv(EMPTY_INVOICE_FILTERS)}>مسح تصفية الأعمدة</Button>}
            {bucket && <Button size="sm" onClick={() => setBucket(null)}>إلغاء التصفية</Button>}
            <Button size="sm" aria-pressed={showPaid} onClick={() => setShowPaid((v) => !v)}>{showPaid ? 'المفتوحة فقط' : 'إظهار المسددة'}</Button>
          </>}>
          <p className="cap">{bkt ? `مصفّاة: المتأخرة ${bkt.label} (${bkt.hint})` : 'السداد يُوزَّع بطريقة الأقدم أولاً (FIFO) — كما في كشف الحساب'}
            {' · '}عرض {int(invoices.length)} من {int((d.invoices ?? []).length)} — المؤشرات أعلاه للمجموعة كاملة</p>
          <div className="pt-xfil">
            <FText label="رقم الفاتورة" value={inv.num} onChange={(v) => setI({ num: v })} />
            <FDates label="تاريخ الفاتورة" from={inv.dateFrom} to={inv.dateTo} onFrom={(v) => setI({ dateFrom: v })} onTo={(v) => setI({ dateTo: v })} />
            <FDates label="الاستحقاق" from={inv.dueFrom} to={inv.dueTo} onFrom={(v) => setI({ dueFrom: v })} onTo={(v) => setI({ dueTo: v })} />
            <FRange label="المبلغ" min={inv.amtMin} max={inv.amtMax} onMin={(v) => setI({ amtMin: v })} onMax={(v) => setI({ amtMax: v })} />
            <FRange label="المسدد" min={inv.paidMin} max={inv.paidMax} onMin={(v) => setI({ paidMin: v })} onMax={(v) => setI({ paidMax: v })} />
            <FRange label="المتبقي" min={inv.remMin} max={inv.remMax} onMin={(v) => setI({ remMin: v })} onMax={(v) => setI({ remMax: v })} />
            <FSelect label="الحالة" value={inv.status} onChange={(v) => setI({ status: v as InvoiceFilters['status'] })} allLabel="كل الحالات" options={INVOICE_STATUS_OPTIONS} />
          </div>
          <DataTable<SupplierInvoice> id="parties.supplier.invoices" mode="server" rows={invoices} rowKey={(i) => i.id} columns={invCols}
            search={false} onQueryChange={(t) => setInvSort(t.sort)}
            empty={{ title: showPaid ? 'لا فواتير' : 'لا فواتير مفتوحة', body: 'أضف مديونية يدوياً أو ارفع كشفاً.', cta: '+ مديونية', onCta: () => setEntry({ mode: 'invoice' }) }} />
        </Island>

        {paOn && (d.unallocatedPayments ?? []).length > 0 && (
          <Island span={12} i={7} title="دفعات بانتظار التخصيص" crit>
            <p className="cap">اختر الفاتورة (أو الفواتير) التي تخص كل دفعة — أو ضعها على الحساب</p>
            <div className="pt-pend">{d.unallocatedPayments.map((u) => (
              <div key={u.payment.id}>
                <span>{dateTxt(u.payment.date, { year: true })} — <Money value={u.payment.amount} className="t-ok" />{u.payment.description ? ` — ${u.payment.description}` : ''}</span>
                <Button size="sm" onClick={() => setAllocFor({ payment: u.payment, candidates: u.candidates })}>تخصيص</Button>
                {u.reason && <span className="cap">{u.reason}</span>}
              </div>))}</div>
          </Island>)}

        <Island span={12} i={8} title={`الدفعات · ${int((d.payments ?? []).length)} دفعة`}
          actions={paymentFiltering(pay) && <Button size="sm" onClick={() => setPay(EMPTY_PAYMENT_FILTERS)}>مسح تصفية الأعمدة</Button>}>
          {paymentFiltering(pay) && <p className="cap">عرض {int(payments.length)} من {int((d.payments ?? []).length)}</p>}
          <div className="pt-xfil">
            <FDates label="التاريخ" from={pay.dateFrom} to={pay.dateTo} onFrom={(v) => setP({ dateFrom: v })} onTo={(v) => setP({ dateTo: v })} />
            <FText label="المستند" value={pay.doc} onChange={(v) => setP({ doc: v })} />
            <FText label="الوصف" value={pay.desc} onChange={(v) => setP({ desc: v })} />
            <FRange label="المبلغ" min={pay.amtMin} max={pay.amtMax} onMin={(v) => setP({ amtMin: v })} onMax={(v) => setP({ amtMax: v })} />
          </div>
          <DataTable<SupplierPayment> id="parties.supplier.payments" mode="server" rows={payments} rowKey={(p) => p.id} columns={payCols}
            search={false} onQueryChange={(t) => setPaySort(t.sort)}
            empty={{ title: 'لا دفعات', body: 'سجّل دفعة لتُوزَّع على الأقدم أولاً.', cta: '+ دفعة', onCta: () => setEntry({ mode: 'payment' }) }} />
        </Island>
      </Grid>

      <ManualEntryModal state={entry} d={d} onClose={() => setEntry(null)} />
      <DueDateModal invoice={due} onClose={() => setDue(null)} />
      <AllocationModal account={d.account} state={allocFor} onClose={() => setAllocFor(null)} />
      <RemindModal open={remind} kind="supplier" partyKey={d.account} onClose={() => setRemind(false)} />
      <SupplierFormModal open={edit} row={d} known={known} onClose={() => setEdit(false)} />
      <DeletePartyModal open={del} kind="supplier" name={d.name} keyValue={d.account} onClose={() => setDel(false)} onDeleted={() => go('parties.suppliers')} />
      <ExportDialog open={exp} onClose={() => setExp(false)} title={`كشف حساب ${d.name}`} fileName={`كشف-${d.account}.csv`}
        rows={[...(d.invoices ?? []).map((i) => ({ date: i.date, doc: i.number ?? '', desc: 'فاتورة' + (i.description ? ' — ' + i.description : ''), debit: 0, credit: i.amount })),
          ...(d.payments ?? []).map((p) => ({ date: p.date, doc: p.doc ?? '', desc: 'دفعة' + (p.description ? ' — ' + p.description : ''), debit: p.amount, credit: 0 }))]
          .sort((a, b) => a.date.localeCompare(b.date))}
        columns={[{ label: 'التاريخ', value: (r) => r.date }, { label: 'المستند', value: (r) => r.doc }, { label: 'البيان', value: (r) => r.desc },
          { label: 'مدين', value: (r) => r.debit }, { label: 'دائن', value: (r) => r.credit }]} />
    </>
  );
}

/** مديونية/دفعة يدوية (P-077/078/091/382) + معاينة الرصيد بعدها. */
function ManualEntryModal({ state, d, onClose }: { state: { mode: 'invoice' | 'payment'; row?: SupplierInvoice } | null; d: SupplierDetailResponse; onClose: () => void }) {
  usePrefs();
  const mode = state?.mode ?? 'invoice';
  const r = state?.row;
  const init = useMemo(() => ({ amount: r?.amount ?? null as number | null, date: r?.date ?? todayIso(), due_date: r?.dueDate ?? '',
    description: r?.description ?? '', reference: r?.doc ?? '' }), [r]);
  const form = useForm(init);
  useEffect(() => { if (state) form.reset(init); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, init]);
  const [err, setErr] = useState<string | null>(null);
  const save = useApiMutation(async () => {
    const b = manualBody(form.values, mode);
    if (r) return partiesApi.updateManualInvoice(r.id, b);
    if (mode === 'invoice') return partiesApi.addManualInvoice(d.account, b);
    return partiesApi.addManualPayment(d.account, { amount: b.amount, date: b.date, description: b.description, reference: b.reference });
  }, { invalidate: SUPPLIER_ROOTS, errorToast: false });
  const pv = manualPreview(d.outstanding, form.values.amount, mode, r?.amount ?? 0);
  return (
    <PModal open={!!state} onClose={onClose} dirty={form.dirty}
      title={mode === 'invoice' ? (r ? 'تعديل مديونية' : 'إضافة مديونية') : 'تسجيل دفعة'}
      actions={[{ label: 'إلغاء' }, { label: save.isPending ? 'جارٍ الحفظ…' : 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        setErr(null);
        const bad = validateManual(form.values);
        if (bad) { form.setError(bad.includes('التاريخ') ? 'date' : 'amount', bad); return; }
        try { await save.mutateAsync(undefined); close(true); toast(r ? 'حُفظ التعديل' : mode === 'invoice' ? 'أُضيفت المديونية' : 'سُجّلت الدفعة', { kind: 'ok' }); }
        catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <FormGrid>
        <Field form={form} name="amount" label="المبلغ" type="money" required min={0.01} />
        <Field form={form} name="date" label="التاريخ" type="date" required />
        {mode === 'invoice' && <Field form={form} name="due_date" label="تاريخ الاستحقاق" type="date" help="يُحسب من مدة المورد إن تُرك فارغاً" />}
        <Field form={form} name="description" label="الوصف" />
        <Field form={form} name="reference" label="رقم مرجعي" />
      </FormGrid>
      <div className="pt-preview" aria-live="polite">
        <div className="cap">{pv ? `الرصيد بعد ${mode === 'invoice' ? 'المديونية' : 'الدفعة'}` : 'الرصيد الحالي'}</div>
        <div className="pt-pvn"><Money value={-d.outstanding} />{pv && <> ← <b><Money value={-pv.after} /></b></>} <BalanceWord balance={-(pv ? pv.after : d.outstanding)} /></div>
        {pv?.overpaid && <div className="cap">الدفعة أكبر من المديونية المفتوحة — سيصبح المورد مديناً لنا.</div>}
      </div>
    </PModal>
  );
}

/** تحديد/تعديل الاستحقاق لفاتورة من كشف (P-092) — فارغ = مسح. */
function DueDateModal({ invoice, onClose }: { invoice: SupplierInvoice | null; onClose: () => void }) {
  const [v, setV] = useState('');
  useEffect(() => { setV(invoice?.dueDate ?? ''); }, [invoice]);
  const save = useApiMutation(() => partiesApi.setDueDate(invoice!.id, v || null), { invalidate: SUPPLIER_ROOTS, success: 'حُفظ الاستحقاق' });
  return (
    <PModal open={!!invoice} onClose={onClose} size="sm" title={invoice?.dueDate ? 'تعديل الاستحقاق' : 'تحديد الاستحقاق'}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (c) => { await save.mutateAsync(undefined); c(true); } }]}>
      <div className="pt-xfil"><label><span>تاريخ الاستحقاق</span><input type="date" dir="ltr" value={v} onChange={(e) => setV(e.target.value)} /></label></div>
    </PModal>
  );
}

/** تخصيص دفعة (P-094/096) + «إلغاء التخصيص» (P-406). المجموع يجب أن يساوي الدفعة بالهللة. */
function AllocationModal({ account, state, onClose }: { account: string; state: { payment: SupplierPayment; candidates: SupplierInvoice[] } | null; onClose: () => void }) {
  usePrefs();
  const [dr, setDr] = useState<AllocDraft>({ onAccount: false, lines: [] });
  useEffect(() => { if (state) setDr(initialAllocation(state.payment.amount, state.candidates)); }, [state]);
  const save = useApiMutation(() => partiesApi.allocatePayment(account, state!.payment.id, allocationBody(dr, state!.payment.amount)),
    { invalidate: SUPPLIER_ROOTS, success: 'حُفظ التخصيص' });
  const clear = useApiMutation(() => partiesApi.clearAllocation(account, state!.payment.id), { invalidate: SUPPLIER_ROOTS, success: 'أُلغي التخصيص — الدفعة بانتظار قرارك' });
  if (!state) return <PModal open={false} onClose={onClose} title="" />;
  const p = state.payment;
  const t = allocationTotals(dr, p.amount);
  return (
    <PModal open onClose={onClose} title="تخصيص دفعة"
      actions={[{ label: 'إلغاء' }, { label: 'إلغاء التخصيص', onClick: async (c) => { await clear.mutateAsync(undefined); c(true); } },
        { label: save.isPending ? 'جارٍ الحفظ…' : 'حفظ التخصيص', kind: 'primary', disabled: save.isPending || (!dr.onAccount && !t.balanced),
          onClick: async (c) => { await save.mutateAsync(undefined); c(true); } }]}>
      <p>دفعة بتاريخ {dateTxt(p.date, { year: true })} بمبلغ <Money value={p.amount} className="t-ok" />{p.description ? ` — ${p.description}` : ''}</p>
      <p className="cap">اختر الفاتورة (أو الفواتير) التي تخص هذه الدفعة، أو ضعها «على الحساب» بلا فاتورة محددة.</p>
      <div className="pt-alloc">
        {state.candidates.map((inv) => {
          const line = dr.lines.find((l) => l.invoiceId === inv.id);
          return (
            <label key={inv.id}>
              <input type="checkbox" checked={!!line} onChange={() => setDr(toggleAllocInvoice(dr, inv, p.amount))} />
              <span>فاتورة {inv.number ?? '—'} · {dateTxt(inv.date, { year: true })} · متبقٍ <Money value={inv.remaining} /></span>
              {line && <input type="text" inputMode="decimal" dir="ltr" value={line.amount} aria-label="مبلغ التخصيص"
                onChange={(e) => setDr({ ...dr, lines: dr.lines.map((l) => (l.invoiceId === inv.id ? { ...l, amount: e.target.value } : l)) })} />}
            </label>);
        })}
        <label><input type="radio" checked={dr.onAccount} onChange={() => setDr({ onAccount: true, lines: [] })} /><span>على الحساب — بلا فاتورة محددة</span></label>
      </div>
      {!dr.onAccount && !t.balanced && <p className="cap">مجموع التخصيص <Money value={t.total} /> — يجب أن يساوي مبلغ الدفعة <Money value={p.amount} /></p>}
    </PModal>
  );
}
