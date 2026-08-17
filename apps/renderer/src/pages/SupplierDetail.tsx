import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, apiBase } from '@/lib/api';
import { DELAY_BUCKETS, bucketOfDays } from '@/lib/delay';
import { ar, arDate, dueLabel, dueTone, sar } from '@/lib/format';
import { Card, ErrorState, Kpi, Money, Pill, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';
import { Modal } from '@/components/Modal';
import { ManualEntryForm, type ManualEntryValues } from '@/components/ManualEntryForm';
import { RemindModal } from '@/components/RemindModal';
import { useAiEnabled } from '@/lib/useAi';
import { Th, type SortState } from '@/components/ColumnMenu';

/** حالة تصفية «الحالة» لعمود الفواتير — مبنية على نفس منطق dueTone/dueLabel
 * (المسددة، ثم متأخر/قريب/لاحق حسب daysToDue، وبانتظار تاريخ حين لا استحقاق). */
function invoiceStatusKey(i: any): 'paid' | 'overdue' | 'due_soon' | 'pending' | 'no_date' {
  if (i.remaining <= 0) return 'paid';
  if (i.daysToDue == null) return 'no_date';
  if (i.daysToDue < 0) return 'overdue';
  if (i.daysToDue <= 7) return 'due_soon';
  return 'pending';
}

// ---------------------------------------------------------------- تخصيص الدفعات
// ميزة اختيارية (افتراضياً متوقفة) — انظر شرحها الكامل في services/api
// app/domain/payables.py (allocate_smart) وapp/db/models.py (PaymentAllocation).
// lib/api.ts مملوك لجهة أخرى فلا نضيف إليه؛ هذه نداءات مباشرة بنفس أسلوب
// معالجة الأخطاء المستخدم هناك (JSON body.detail عند الفشل).
async function paCall<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiBase() + path, { headers: { 'Content-Type': 'application/json' }, ...init });
  } catch {
    throw new ApiError('تعذّر الاتصال بالخدمة المحلية — تأكد أنها تعمل ثم أعد المحاولة');
  }
  if (!res.ok) {
    let msg = `خطأ ${res.status}`;
    try {
      const body = await res.json();
      if (body?.detail) msg = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep the status message */ }
    throw new ApiError(msg);
  }
  return (await res.json()) as T;
}

type AllocLine = { invoiceId: string | null; amount: string };

/** نافذة تخصيص دفعة واحدة — لفاتورة، فواتير مقسّمة، أو «على الحساب». */
function PaymentAllocationModal({ account, payment, candidates, onClose, onSaved }: {
  account: string; payment: any; candidates: any[]; onClose: () => void; onSaved: () => void;
}) {
  const [lines, setLines] = useState<AllocLine[]>(
    candidates.length === 1 ? [{ invoiceId: candidates[0].id, amount: String(payment.amount) }] : []);
  const [onAccount, setOnAccount] = useState(candidates.length === 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const total = onAccount ? payment.amount
    : lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);
  const balanced = Math.abs(total - payment.amount) < 0.01;

  function toggleInvoice(inv: any) {
    setOnAccount(false);
    setLines((cur) => {
      const exists = cur.find((l) => l.invoiceId === inv.id);
      if (exists) return cur.filter((l) => l.invoiceId !== inv.id);
      const remaining = payment.amount - cur.reduce((s, l) => s + (Number(l.amount) || 0), 0);
      const suggested = Math.max(0, Math.min(inv.remaining || inv.amount, remaining));
      return [...cur, { invoiceId: inv.id, amount: suggested ? String(suggested) : '' }];
    });
  }

  function setAmount(invoiceId: string, amount: string) {
    setLines((cur) => cur.map((l) => (l.invoiceId === invoiceId ? { ...l, amount } : l)));
  }

  async function save() {
    setBusy(true); setErr(null);
    try {
      const body = onAccount
        ? { lines: [{ invoiceId: null, amount: payment.amount }] }
        : { lines: lines.map((l) => ({ invoiceId: l.invoiceId, amount: Number(l.amount) || 0 })) };
      await paCall(`/api/v1/suppliers/${account}/payments/${payment.id}/allocate`, {
        method: 'POST', body: JSON.stringify(body),
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="تخصيص دفعة" onClose={onClose}>
      <p style={{ fontSize: 13 }}>
        دفعة بتاريخ {arDate(payment.date)} بمبلغ <Money v={payment.amount} cls="ok" />
        {payment.description ? ` — ${payment.description}` : ''}
      </p>
      <p className="muted" style={{ fontSize: 12 }}>
        اختر الفاتورة (أو الفواتير) التي تخص هذه الدفعة، أو ضعها «على الحساب» بلا فاتورة محددة.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
        {candidates.map((inv) => {
          const line = lines.find((l) => l.invoiceId === inv.id);
          return (
            <label key={inv.id}
                   style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                            border: '1px solid var(--border, #333)', borderRadius: 6 }}>
              <input type="checkbox" checked={Boolean(line)} onChange={() => toggleInvoice(inv)} />
              <span style={{ flex: 1, fontSize: 12 }}>
                فاتورة {inv.number ?? '—'} · {arDate(inv.date)} · متبقٍ <Money v={inv.remaining} />
              </span>
              {line && (
                <input type="number" className="ltr" value={line.amount}
                       onChange={(e) => setAmount(inv.id, e.target.value)}
                       style={{ width: 100 }} />
              )}
            </label>
          );
        })}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px',
                        border: '1px solid var(--border, #333)', borderRadius: 6 }}>
          <input type="radio" checked={onAccount}
                 onChange={() => { setOnAccount(true); setLines([]); }} />
          <span style={{ fontSize: 12 }}>على الحساب — بلا فاتورة محددة</span>
        </label>
      </div>
      {!onAccount && !balanced && (
        <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
          مجموع التخصيص <Money v={total} /> — يجب أن يساوي مبلغ الدفعة <Money v={payment.amount} />
        </p>
      )}
      {err && <div className="callout bad">{err}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn primary" disabled={busy || (!onAccount && !balanced)} onClick={save}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ التخصيص'}
        </button>
      </div>
    </Modal>
  );
}

const INVOICE_STATUS_OPTIONS = [
  { value: 'overdue', label: 'متأخرة' },
  { value: 'due_soon', label: 'مستحقة قريباً' },
  { value: 'pending', label: 'غير مستحقة بعد' },
  { value: 'no_date', label: 'بانتظار تاريخ' },
  { value: 'paid', label: 'مسددة' },
];

/** كشف مورد — الفواتير والدفعات، ومنه يُستخرج التحليل. */
export function SupplierDetail() {
  const { account } = useParams();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showPaid, setShowPaid] = useState(false);
  /** شريحة التأخر المختارة — تصفّي جدول الفواتير أدناه */
  const [bucket, setBucket] = useState<string | null>(null);

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

  // تخصيص الدفعات — إعداد عام (لا خاص بمورد)، افتراضياً متوقف. يُقرأ عند فتح
  // الشاشة حتى لا نضيف واجهته لمن لم يفعّله بعد.
  const [paEnabled, setPaEnabled] = useState(false);
  const [paBusy, setPaBusy] = useState(false);
  const [allocPayment, setAllocPayment] = useState<{ payment: any; candidates: any[] } | null>(null);

  useEffect(() => {
    paCall<{ enabled: boolean }>('/api/v1/suppliers/settings/payment-allocation')
      .then((r) => setPaEnabled(r.enabled)).catch(() => {});
  }, []);

  async function togglePaymentAllocation() {
    setPaBusy(true);
    try {
      const r = await paCall<{ enabled: boolean }>('/api/v1/suppliers/settings/payment-allocation', {
        method: 'PUT', body: JSON.stringify({ enabled: !paEnabled }),
      });
      setPaEnabled(r.enabled);
      reload();
    } catch { /* silent — الإعداد ثانوي، لا يمنع بقية الشاشة */ }
    finally { setPaBusy(false); }
  }

  // تصفية وترتيب جدول الفواتير — على العميل هنا لا الخادم، استثناءً موثّقاً:
  // d.invoices مصفوفة متداخلة داخل استجابة كشف المورد الواحد، لا نقطة قائمة، وهذا
  // الجدول لا يملك سطر إجماليات خاصاً به (مؤشرات الأداء أعلاه محسوبة في الخادم على
  // المجموعة الكاملة دائماً ولا تتأثر بهذه التصفية). لهذا نعرض «عرض N من M» بدل أن
  // نجازف بإيهام المستخدم أن المؤشرات تصف الصفوف المصفّاة.
  const [invNum, setInvNum] = useState('');
  const [invDateFrom, setInvDateFrom] = useState('');
  const [invDateTo, setInvDateTo] = useState('');
  const [dueFrom, setDueFrom] = useState('');
  const [dueTo, setDueTo] = useState('');
  const [amtMin, setAmtMin] = useState('');
  const [amtMax, setAmtMax] = useState('');
  const [paidMin, setPaidMin] = useState('');
  const [paidMax, setPaidMax] = useState('');
  const [remMin, setRemMin] = useState('');
  const [remMax, setRemMax] = useState('');
  const [invStatus, setInvStatus] = useState('');
  const [invSort, setInvSort] = useState<SortState | null>(null);

  // تصفية وترتيب جدول الدفعات — نفس الاستثناء الموثّق أعلاه: بلا سطر إجماليات خاص.
  const [payDateFrom, setPayDateFrom] = useState('');
  const [payDateTo, setPayDateTo] = useState('');
  const [payDoc, setPayDoc] = useState('');
  const [payDesc, setPayDesc] = useState('');
  const [payAmtMin, setPayAmtMin] = useState('');
  const [payAmtMax, setPayAmtMax] = useState('');
  const [paySort, setPaySort] = useState<SortState | null>(null);

  const reload = () => {
    if (account) api.supplier(account).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account]);

  if (err) return <ErrorState message={err} onRetry={reload} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const shown = showPaid ? (d.invoices ?? []) : (d.invoices ?? []).filter((i: any) => i.remaining > 0);
  // التصفية بالشريحة تعمل على نفس الأساس الذي حُسبت به مبالغها في الخادم: أيام
  // التأخر عن تاريخ الاستحقاق. daysToDue سالبٌ للمتأخر، فالتأخر هو نفيه.
  const invoices = bucket
    ? shown.filter((i: any) => i.remaining > 0 && i.daysToDue != null
                               && bucketOfDays(-i.daysToDue) === bucket)
    : shown;

  // تصفية العمود تعمل فوق ما أنتجه شريط الشرائح وزر «إظهار المسددة» — لا تنافسه.
  let filteredInvoices = invoices;
  if (invNum) filteredInvoices = filteredInvoices.filter((i: any) => String(i.number ?? '').includes(invNum));
  if (invDateFrom) filteredInvoices = filteredInvoices.filter((i: any) => i.date && i.date >= invDateFrom);
  if (invDateTo) filteredInvoices = filteredInvoices.filter((i: any) => i.date && i.date <= invDateTo);
  if (dueFrom) filteredInvoices = filteredInvoices.filter((i: any) => i.dueDate && i.dueDate >= dueFrom);
  if (dueTo) filteredInvoices = filteredInvoices.filter((i: any) => i.dueDate && i.dueDate <= dueTo);
  if (amtMin) filteredInvoices = filteredInvoices.filter((i: any) => (i.amount ?? 0) >= Number(amtMin));
  if (amtMax) filteredInvoices = filteredInvoices.filter((i: any) => (i.amount ?? 0) <= Number(amtMax));
  if (paidMin) filteredInvoices = filteredInvoices.filter((i: any) => (i.paid ?? 0) >= Number(paidMin));
  if (paidMax) filteredInvoices = filteredInvoices.filter((i: any) => (i.paid ?? 0) <= Number(paidMax));
  if (remMin) filteredInvoices = filteredInvoices.filter((i: any) => (i.remaining ?? 0) >= Number(remMin));
  if (remMax) filteredInvoices = filteredInvoices.filter((i: any) => (i.remaining ?? 0) <= Number(remMax));
  if (invStatus) filteredInvoices = filteredInvoices.filter((i: any) => invoiceStatusKey(i) === invStatus);
  if (invSort) {
    const dir = invSort.dir === 'asc' ? 1 : -1;
    const key = invSort.key;
    filteredInvoices = [...filteredInvoices].sort((a: any, b: any) => {
      let av: any; let bv: any;
      switch (key) {
        case 'number': av = a.number ?? ''; bv = b.number ?? ''; break;
        case 'date': av = a.date ?? ''; bv = b.date ?? ''; break;
        case 'dueDate': av = a.dueDate ?? ''; bv = b.dueDate ?? ''; break;
        case 'amount': av = a.amount ?? 0; bv = b.amount ?? 0; break;
        case 'paid': av = a.paid ?? 0; bv = b.paid ?? 0; break;
        case 'remaining': av = a.remaining ?? 0; bv = b.remaining ?? 0; break;
        case 'status': av = invoiceStatusKey(a); bv = invoiceStatusKey(b); break;
        default: av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  const invoiceFiltering = Boolean(invNum || invDateFrom || invDateTo || dueFrom || dueTo
    || amtMin || amtMax || paidMin || paidMax || remMin || remMax || invStatus);
  const clearInvoiceFilters = () => {
    setInvNum(''); setInvDateFrom(''); setInvDateTo(''); setDueFrom(''); setDueTo('');
    setAmtMin(''); setAmtMax(''); setPaidMin(''); setPaidMax(''); setRemMin(''); setRemMax('');
    setInvStatus('');
  };

  const payments = d.payments ?? [];
  let filteredPayments = payments;
  if (payDateFrom) filteredPayments = filteredPayments.filter((p: any) => p.date && p.date >= payDateFrom);
  if (payDateTo) filteredPayments = filteredPayments.filter((p: any) => p.date && p.date <= payDateTo);
  if (payDoc) filteredPayments = filteredPayments.filter((p: any) => String(p.doc ?? '').includes(payDoc));
  if (payDesc) filteredPayments = filteredPayments.filter((p: any) =>
    String(p.description ?? '').includes(payDesc));
  if (payAmtMin) filteredPayments = filteredPayments.filter((p: any) => (p.amount ?? 0) >= Number(payAmtMin));
  if (payAmtMax) filteredPayments = filteredPayments.filter((p: any) => (p.amount ?? 0) <= Number(payAmtMax));
  if (paySort) {
    const dir = paySort.dir === 'asc' ? 1 : -1;
    const key = paySort.key;
    filteredPayments = [...filteredPayments].sort((a: any, b: any) => {
      let av: any; let bv: any;
      switch (key) {
        case 'date': av = a.date ?? ''; bv = b.date ?? ''; break;
        case 'doc': av = a.doc ?? ''; bv = b.doc ?? ''; break;
        case 'description': av = a.description ?? ''; bv = b.description ?? ''; break;
        case 'amount': av = a.amount ?? 0; bv = b.amount ?? 0; break;
        default: av = 0; bv = 0;
      }
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }
  const paymentFiltering = Boolean(payDateFrom || payDateTo || payDoc || payDesc || payAmtMin || payAmtMax);
  const clearPaymentFilters = () => {
    setPayDateFrom(''); setPayDateTo(''); setPayDoc(''); setPayDesc(''); setPayAmtMin(''); setPayAmtMax('');
  };

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
        <button className="btn sm" onClick={() => { setFormErr(null); setAddInvoiceOpen(true); }}>
          إضافة مديونية
        </button>
        <button className="btn sm" onClick={() => { setFormErr(null); setAddPaymentOpen(true); }}>
          تسجيل دفعة
        </button>
        <button className="btn primary" onClick={() => nav(`/report?account=${d.account}`)}>
          استخراج التحليل
        </button>
        {!aiLoading && aiEnabled && (
          <button className="btn sm" onClick={() => setRemindOpen(true)}>صياغة مطالبة</button>
        )}
        <button className="btn sm" disabled={paBusy} onClick={togglePaymentAllocation}
                title="تخصيص الدفعات — عند التفعيل، الدفعات الغامضة تُعلَّق بانتظار قرارك بدل تخمين الفاتورة">
          {paEnabled ? 'إيقاف تخصيص الدفعات' : 'تفعيل تخصيص الدفعات'}
        </button>
        <Link to="/suppliers"><button className="btn sm">رجوع</button></Link>
      </div>

      {paEnabled && (d.unallocatedCount ?? 0) > 0 && (
        <div className="callout note" style={{ marginBottom: 14 }}>
          {ar(d.unallocatedCount)} {d.unallocatedCount === 1 ? 'دفعة بانتظار التخصيص' : 'دفعات بانتظار التخصيص'} —
          {' '}لا يمكن التطبيق تحديد فاتورتها بثقة، فبقيت الفواتير المرشَّحة مفتوحة حتى تقرر.
        </div>
      )}

      <p className="muted" style={{ fontSize: 11, marginTop: -8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 2 }}>
        فئات أعمار المديونية أدناه محسوبة من تاريخ الاستحقاق
        <ExplainDot metric="ageingByDueDate" values={{}} />
      </p>

      {d.needsManualDueDate && (
        <div className="callout note" style={{ marginBottom: 14 }}>
          مدة هذا المورد «{d.term}» — لا يُحسب الاستحقاق تلقائياً، ويحتاج إدخال تاريخ يدوياً
          بعد اعتماد المستخلص.
        </div>
      )}

      <div className="kpi-row">
        <Kpi label="إجمالي المفوتر" value={sar(d.totalInvoiced)} unit="ر.س" />
        <Kpi label="المسدد" value={sar(d.totalPaid)} unit="ر.س" tone="ok" />
        <Kpi label="المتبقي" value={sar(d.outstanding)} unit="ر.س" hero
             explain={<ExplainDot metric="outstanding" values={{ totalInvoiced: d.totalInvoiced, totalPaid: d.totalPaid, outstanding: d.outstanding }} />} />
        <Kpi label="متأخر" value={sar(d.overdue)} unit="ر.س" tone="red" alert={d.overdue > 0}
             explain={<ExplainDot metric="overdue" values={{ overdue: d.overdue }} />} />
      </div>

      {/* شرائح التأخر — سبع شرائح شهرية بدل «٩٠+» الغامضة. كل شريحة قابلة للنقر
          فتُصفّي جدول الفواتير أدناه، فيصير الرقم قابلاً للتتبع إلى الفواتير التي
          كوّنته بدل أن يبقى مجموعاً مغلقاً. */}
      {d.delay?.amount > 0 && (
        <Card title="المتأخر حسب مدة التأخر"
              sub="محسوبة من تاريخ الاستحقاق — انقر شريحة لعرض فواتيرها"
              actions={bucket && (
                <button className="btn sm" onClick={() => setBucket(null)}>عرض الكل</button>
              )}>
          <div className="bucket-strip">
            {DELAY_BUCKETS.filter((b) => b.value !== 'none').map((b) => {
              const v = d.delay.byBucket?.[b.value] ?? 0;
              const on = bucket === b.value;
              return (
                <button key={b.value}
                        className={'bucket-cell' + (on ? ' on' : '') + (v > 0 ? '' : ' empty')}
                        disabled={v <= 0}
                        onClick={() => setBucket(on ? null : b.value)}>
                  <span className="bucket-label">{b.label}</span>
                  <span className="bucket-days">{b.hint}</span>
                  <span className={'bucket-amount' + (v > 0 ? ' red' : '')}>
                    {v > 0 ? sar(v) : '—'}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      <div className="stack">
        <Card
          title={showPaid ? 'كل الفواتير' : 'الفواتير المفتوحة'}
          sub={bucket
            ? `مصفّاة: المتأخرة ${DELAY_BUCKETS.find((b) => b.value === bucket)?.label} (${DELAY_BUCKETS.find((b) => b.value === bucket)?.hint})`
            : 'السداد يُوزَّع بطريقة الأقدم أولاً (FIFO) — كما في كشف الحساب'}
          actions={
            <>
              {invoiceFiltering && (
                <button className="btn sm" onClick={clearInvoiceFilters}>مسح تصفية الأعمدة</button>
              )}
              {bucket && (
                <button className="btn sm" onClick={() => setBucket(null)}>إلغاء التصفية</button>
              )}
              <button className="btn sm" onClick={() => setShowPaid(!showPaid)}>
                {showPaid ? 'المفتوحة فقط' : 'إظهار المسددة'}
              </button>
            </>
          }
        >
          {/* المؤشرات أعلى الصفحة محسوبة في الخادم على كل الفواتير دون تأثر بهذه
              التصفية — سطر العدّ هنا هو ما يصف الصفوف المعروضة فعلاً. */}
          <p className="muted" style={{ fontSize: 11, padding: '0 20px', marginTop: -4 }}>
            عرض {ar(filteredInvoices.length)} من {ar((d.invoices ?? []).length)}
          </p>
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <Th label="الفاتورة" sortKey="number" sort={invSort} onSort={setInvSort}
                    active={Boolean(invNum)}
                    filter={{ kind: 'text', value: invNum, onChange: setInvNum, placeholder: 'رقم الفاتورة…' }} />
                <Th label="تاريخ الفاتورة" sortKey="date" sort={invSort} onSort={setInvSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" active={Boolean(invDateFrom || invDateTo)}
                    filter={{ kind: 'dateRange', from: invDateFrom, to: invDateTo,
                              onFrom: setInvDateFrom, onTo: setInvDateTo }} />
                <Th label="الاستحقاق" sortKey="dueDate" sort={invSort} onSort={setInvSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" active={Boolean(dueFrom || dueTo)}
                    filter={{ kind: 'dateRange', from: dueFrom, to: dueTo, onFrom: setDueFrom, onTo: setDueTo }} />
                <Th label="المبلغ" className="ltr" sortKey="amount" sort={invSort} onSort={setInvSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" active={Boolean(amtMin || amtMax)}
                    filter={{ kind: 'range', min: amtMin, max: amtMax, onMin: setAmtMin, onMax: setAmtMax, unit: 'ر.س' }} />
                <Th label="المسدد" className="ltr" sortKey="paid" sort={invSort} onSort={setInvSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" active={Boolean(paidMin || paidMax)}
                    filter={{ kind: 'range', min: paidMin, max: paidMax, onMin: setPaidMin, onMax: setPaidMax, unit: 'ر.س' }} />
                <Th label="المتبقي" className="ltr" sortKey="remaining" sort={invSort} onSort={setInvSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" active={Boolean(remMin || remMax)}
                    filter={{ kind: 'range', min: remMin, max: remMax, onMin: setRemMin, onMax: setRemMax, unit: 'ر.س' }} />
                <Th label="الحالة" sortKey="status" sort={invSort} onSort={setInvSort}
                    active={Boolean(invStatus)}
                    filter={{ kind: 'select', value: invStatus, onChange: setInvStatus,
                              allLabel: 'كل الحالات', options: INVOICE_STATUS_OPTIONS }} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredInvoices.map((i: any, n: number) => (
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
                        <button className="btn sm"
                                onClick={() => { setFormErr(null); setEditInvoice(i); }} aria-label="تعديل" title="تعديل">✎</button>
                        <button className="btn sm"
                                onClick={() => { setFormErr(null); setDeleteInvoice(i); }} aria-label="حذف" title="حذف">🗑</button>
                      </div>
                    )}
                    {i.source === 'statement' && (
                      <button className="btn sm"

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
          </div>
        </Card>

        {paEnabled && (d.unallocatedPayments ?? []).length > 0 && (
          <Card title="دفعات بانتظار التخصيص"
                sub="اختر الفاتورة (أو الفواتير) التي تخص كل دفعة — أو ضعها على الحساب">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 20px 16px' }}>
              {(d.unallocatedPayments ?? []).map((u: any) => (
                <div key={u.payment.id}
                     style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '4px 0',
                              borderBottom: '1px solid var(--border, #333)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ flex: 1 }}>
                      {arDate(u.payment.date)} — <Money v={u.payment.amount} cls="ok" />
                      {u.payment.description ? ` — ${u.payment.description}` : ''}
                    </span>
                    <button className="btn sm"
                            onClick={() => setAllocPayment({ payment: u.payment, candidates: u.candidates })}>
                      تخصيص
                    </button>
                  </div>
                  {/* سبب التعليق — جملة عربية واحدة توضح لماذا لم يُطبَّق FIFO تلقائياً؛
                      انظر domain/payables.allocate_smart لتعريف كل إشارة تناقض. */}
                  {u.reason && (
                    <span className="muted" style={{ fontSize: 11 }}>{u.reason}</span>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card title="الدفعات" sub={`${ar((d.payments ?? []).length)} دفعة`}
          actions={paymentFiltering && (
            <button className="btn sm" onClick={clearPaymentFilters}>مسح تصفية الأعمدة</button>
          )}
        >
          {paymentFiltering && (
            <p className="muted" style={{ fontSize: 11, padding: '0 20px', marginTop: -4 }}>
              عرض {ar(filteredPayments.length)} من {ar(payments.length)}
            </p>
          )}
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <Th label="التاريخ" sortKey="date" sort={paySort} onSort={setPaySort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" active={Boolean(payDateFrom || payDateTo)}
                    filter={{ kind: 'dateRange', from: payDateFrom, to: payDateTo,
                              onFrom: setPayDateFrom, onTo: setPayDateTo }} />
                <Th label="المستند" sortKey="doc" sort={paySort} onSort={setPaySort}
                    active={Boolean(payDoc)}
                    filter={{ kind: 'text', value: payDoc, onChange: setPayDoc, placeholder: 'رقم المستند…' }} />
                <Th label="الوصف" sortKey="description" sort={paySort} onSort={setPaySort}
                    active={Boolean(payDesc)}
                    filter={{ kind: 'text', value: payDesc, onChange: setPayDesc, placeholder: 'الوصف…' }} />
                <Th label="المبلغ" className="ltr" sortKey="amount" sort={paySort} onSort={setPaySort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" active={Boolean(payAmtMin || payAmtMax)}
                    filter={{ kind: 'range', min: payAmtMin, max: payAmtMax,
                              onMin: setPayAmtMin, onMax: setPayAmtMax, unit: 'ر.س' }} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredPayments.map((p: any, n: number) => (
                <tr key={p.id ?? n}>
                  <td>{arDate(p.date)}</td>
                  <td className="num muted">{p.doc}</td>
                  <td className="muted">{p.description}</td>
                  <td className="ltr"><Money v={p.amount} cls="ok" /></td>
                  <td className="ltr">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {paEnabled && p.id && (
                        <button className="btn sm"
                                onClick={() => setAllocPayment({
                                  payment: p,
                                  candidates: (d.invoices ?? []).filter((i: any) => i.remaining > 0),
                                })}
                                title="تخصيص هذه الدفعة لفاتورة أو أكثر، أو تعديل تخصيص سابق">
                          تخصيص
                        </button>
                      )}
                      {p.source === 'manual' && p.id && (
                        <button className="btn sm"
                                onClick={() => { setFormErr(null); setDeletePayment(p); }} aria-label="حذف" title="حذف">🗑</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
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
          <div className="modal-foot">
            <button className="btn" onClick={() => setDeleteInvoice(null)}>إلغاء</button>
            <button className="btn danger" disabled={busy} onClick={confirmDeleteInvoice}>
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
            <div className="modal-foot">
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

      {allocPayment && account && (
        <PaymentAllocationModal
          account={account}
          payment={allocPayment.payment}
          candidates={allocPayment.candidates}
          onClose={() => setAllocPayment(null)}
          onSaved={reload}
        />
      )}

      {deletePayment && (
        <Modal title="حذف دفعة" onClose={() => setDeletePayment(null)}>
          <p>هل تريد حذف هذه الدفعة اليدوية بمبلغ <Money v={deletePayment.amount} />؟</p>
          {formErr && <div className="callout bad">{formErr}</div>}
          <div className="modal-foot">
            <button className="btn" onClick={() => setDeletePayment(null)}>إلغاء</button>
            <button className="btn danger" disabled={busy} onClick={confirmDeletePayment}>
              {busy ? 'جارٍ الحذف…' : 'حذف'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
