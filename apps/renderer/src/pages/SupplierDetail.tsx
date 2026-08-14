import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, dueLabel, dueTone, sar } from '@/lib/format';
import { Card, Kpi, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { ManualEntryForm, type ManualEntryValues } from '@/components/ManualEntryForm';
import { RemindModal } from '@/components/RemindModal';
import { useAiEnabled } from '@/lib/useAi';

/** كشف مورد — الفواتير والدفعات، ومنه يُستخرج التحليل. */
export function SupplierDetail() {
  const { account } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);

  const [addInvoiceOpen, setAddInvoiceOpen] = useState(false);
  const [addPaymentOpen, setAddPaymentOpen] = useState(false);
  const [editInvoice, setEditInvoice] = useState<any>(null);
  const [deleteInvoice, setDeleteInvoice] = useState<any>(null);
  const [deletePayment, setDeletePayment] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [dueDateInvoice, setDueDateInvoice] = useState<any>(null);
  const [dueDateValue, setDueDateValue] = useState('');
  const [remindOpen, setRemindOpen] = useState(false);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  const reload = () => {
    if (account) api.supplier(account).then(setD).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  if (err) return <State>{err}</State>;
  if (!d) return <State>جارٍ التحميل…</State>;

  const invoices = showPaid ? d.invoices : d.invoices.filter((i: any) => i.remaining > 0);

  async function handleAddInvoice(values: ManualEntryValues) {
    if (!account) return;
    setBusy(true); setFormErr(null);
    try {
      await api.addManualInvoice({ account, ...values });
      setAddInvoiceOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleAddPayment(values: ManualEntryValues) {
    if (!account) return;
    setBusy(true); setFormErr(null);
    try {
      await api.addManualPayment({ account, amount: values.amount, date: values.date,
        description: values.description, reference: values.reference });
      setAddPaymentOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEditInvoice(values: ManualEntryValues) {
    if (!editInvoice) return;
    setBusy(true); setFormErr(null);
    try {
      await api.updateManualInvoice(editInvoice.id, values);
      setEditInvoice(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteInvoice() {
    if (!deleteInvoice) return;
    setBusy(true); setFormErr(null);
    try {
      await api.deleteManualInvoice(deleteInvoice.id);
      setDeleteInvoice(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveDueDate() {
    if (!dueDateInvoice) return;
    setBusy(true); setFormErr(null);
    try {
      await api.setDueDate(dueDateInvoice.id, dueDateValue || null);
      setDueDateInvoice(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeletePayment() {
    if (!deletePayment) return;
    setBusy(true); setFormErr(null);
    try {
      await api.deleteManualPayment(deletePayment.id);
      setDeletePayment(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{d.name}</h1>
          <p>
            حساب <span className="num">{d.account}</span> · {d.project} ·
            {' '}مدة السداد {d.termKind === 'days' ? `${ar(d.termDays)} يوماً` : d.term} ·
            {' '}{ar(d.invoiceCount)} فاتورة
          </p>
        </div>
        <button className="btn" onClick={() => { setFormErr(null); setAddInvoiceOpen(true); }}>
          إضافة مديونية
        </button>
        <button className="btn" onClick={() => { setFormErr(null); setAddPaymentOpen(true); }}>
          تسجيل دفعة
        </button>
        <button className="btn primary" onClick={() => nav(`/report?account=${d.account}`)}>
          استخراج التحليل
        </button>
        {!aiLoading && aiEnabled && (
          <button className="btn" onClick={() => setRemindOpen(true)}>صياغة مطالبة</button>
        )}
        <Link to="/suppliers"><button className="btn">رجوع</button></Link>
      </div>

      {d.needsManualDueDate && (
        <div className="callout note" style={{ marginBottom: 14 }}>
          مدة هذا المورد «{d.term}» — لا يُحسب الاستحقاق تلقائياً، ويحتاج إدخال تاريخ يدوياً
          بعد اعتماد المستخلص.
        </div>
      )}

      <div className="kpi-row">
        <Kpi label="إجمالي المفوتر" value={sar(d.totalInvoiced)} unit="ر.س" />
        <Kpi label="المسدد" value={sar(d.totalPaid)} unit="ر.س" tone="ok" />
        <Kpi label="المتبقي" value={sar(d.outstanding)} unit="ر.س" />
        <Kpi label="متأخر" value={sar(d.overdue)} unit="ر.س" tone="red" alert={d.overdue > 0} />
      </div>

      <div className="stack">
        <Card
          title={showPaid ? 'كل الفواتير' : 'الفواتير المفتوحة'}
          sub="السداد يُوزَّع بطريقة الأقدم أولاً (FIFO) — كما في كشف الحساب"
          actions={
            <button className="btn" onClick={() => setShowPaid(!showPaid)}>
              {showPaid ? 'المفتوحة فقط' : 'إظهار المسددة'}
            </button>
          }
        >
          <table>
            <thead>
              <tr>
                <th>الفاتورة</th><th>تاريخ الفاتورة</th><th>الاستحقاق</th>
                <th className="ltr">المبلغ</th><th className="ltr">المسدد</th>
                <th className="ltr">المتبقي</th><th>الحالة</th><th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i: any, n: number) => (
                <tr key={(i.number ?? '') + n}>
                  <td className="num">
                    {ar(i.number ?? '—')}
                    {i.source === 'manual' && <Pill kind="warn"> يدوي</Pill>}
                  </td>
                  <td>{arDate(i.date)}</td>
                  <td>{i.dueDate ? arDate(i.dueDate) : <span className="muted">—</span>}</td>
                  <td className="ltr muted"><Money v={i.amount} /></td>
                  <td className="ltr">{i.paid > 0 ? <Money v={i.paid} cls="ok" /> : <span className="muted">—</span>}</td>
                  <td className="ltr">{i.remaining > 0 ? <Money v={i.remaining} cls={dueTone(i.daysToDue)} /> : <span className="muted">—</span>}</td>
                  <td>{i.remaining > 0
                    ? <Pill kind={dueTone(i.daysToDue)}>{dueLabel(i.daysToDue)}</Pill>
                    : <Pill kind="ok">مسددة</Pill>}</td>
                  <td className="ltr">
                    {i.source === 'manual' && (
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                                onClick={() => { setFormErr(null); setEditInvoice(i); }}>✎</button>
                        <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                                onClick={() => { setFormErr(null); setDeleteInvoice(i); }}>🗑</button>
                      </div>
                    )}
                    {i.source === 'statement' && (
                      <button
                        className="btn"
                        style={{ padding: '4px 9px', fontSize: 12 }}
                        onClick={() => {
                          setFormErr(null);
                          setDueDateValue(i.dueDate ?? '');
                          setDueDateInvoice(i);
                        }}
                      >
                        {i.dueDate ? 'تعديل الاستحقاق' : 'تحديد الاستحقاق'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <Card title="الدفعات" sub={`${ar(d.payments.length)} دفعة`}>
          <table>
            <thead><tr><th>التاريخ</th><th>المستند</th><th>الوصف</th><th className="ltr">المبلغ</th><th></th></tr></thead>
            <tbody>
              {d.payments.map((p: any, n: number) => (
                <tr key={p.id ?? n}>
                  <td>{arDate(p.date)}</td>
                  <td className="num muted">{p.doc}</td>
                  <td className="muted">{p.description}</td>
                  <td className="ltr"><Money v={p.amount} cls="ok" /></td>
                  <td className="ltr">
                    {p.source === 'manual' && p.id && (
                      <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                              onClick={() => { setFormErr(null); setDeletePayment(p); }}>🗑</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      {addInvoiceOpen && (
        <Modal title="إضافة مديونية" onClose={() => setAddInvoiceOpen(false)}>
          <ManualEntryForm mode="invoice" onSubmit={handleAddInvoice} busy={busy} error={formErr} />
        </Modal>
      )}

      {addPaymentOpen && (
        <Modal title="تسجيل دفعة" onClose={() => setAddPaymentOpen(false)}>
          <ManualEntryForm mode="payment" onSubmit={handleAddPayment} busy={busy} error={formErr} />
        </Modal>
      )}

      {editInvoice && (
        <Modal title="تعديل مديونية" onClose={() => setEditInvoice(null)}>
          <ManualEntryForm
            mode="invoice"
            initial={{
              amount: editInvoice.amount,
              date: editInvoice.date,
              due_date: editInvoice.dueDate ?? undefined,
              description: editInvoice.description,
              reference: editInvoice.doc,
            }}
            onSubmit={handleEditInvoice}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {deleteInvoice && (
        <Modal title="حذف مديونية" onClose={() => setDeleteInvoice(null)}>
          <p>هل تريد حذف هذه المديونية اليدوية بمبلغ <Money v={deleteInvoice.amount} />؟</p>
          {formErr && <div className="callout bad">{formErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={() => setDeleteInvoice(null)}>إلغاء</button>
            <button className="btn primary" disabled={busy} onClick={confirmDeleteInvoice}>
              {busy ? 'جارٍ الحذف…' : 'حذف'}
            </button>
          </div>
        </Modal>
      )}

      {dueDateInvoice && (
        <Modal
          title={dueDateInvoice.dueDate ? 'تعديل الاستحقاق' : 'تحديد الاستحقاق'}
          onClose={() => setDueDateInvoice(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <label style={{ fontSize: 13 }}>
              تاريخ الاستحقاق
              <input
                type="date"
                value={dueDateValue}
                onChange={(e) => setDueDateValue(e.target.value)}
                style={{ display: 'block', width: '100%', marginTop: 6 }}
              />
            </label>
            {formErr && <div className="callout bad">{formErr}</div>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
              <button className="btn" onClick={() => setDueDateInvoice(null)}>إلغاء</button>
              <button className="btn primary" disabled={busy} onClick={handleSaveDueDate}>
                {busy ? 'جارٍ الحفظ…' : 'حفظ'}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {remindOpen && (
        <RemindModal partyKind="supplier" partyKey={d.account} onClose={() => setRemindOpen(false)} />
      )}

      {deletePayment && (
        <Modal title="حذف دفعة" onClose={() => setDeletePayment(null)}>
          <p>هل تريد حذف هذه الدفعة اليدوية بمبلغ <Money v={deletePayment.amount} />؟</p>
          {formErr && <div className="callout bad">{formErr}</div>}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={() => setDeletePayment(null)}>إلغاء</button>
            <button className="btn primary" disabled={busy} onClick={confirmDeletePayment}>
              {busy ? 'جارٍ الحذف…' : 'حذف'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
