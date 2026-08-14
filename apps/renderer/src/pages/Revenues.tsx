import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, Kpi, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';

type Revenue = {
  id: string; project: string; unit: string; client: string; amount: number;
  dueDate: string | null; collectedOn: string | null; status: 'open' | 'collected';
  source: string; notes: string; createdAt: string | null;
};

export function Revenues() {
  const [d, setD] = useState<any>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<Revenue | null>(null);
  const [collectRow, setCollectRow] = useState<Revenue | null>(null);
  const [deleteRow, setDeleteRow] = useState<Revenue | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const reload = () => api.revenues({ q, project, status }).then(setD).catch((e) => setErr(e.message));

  useEffect(() => {
    const t = setTimeout(() => {
      api.revenues({ q, project, status }).then(setD).catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, project, status]);

  const projects = useMemo(() => d?.projects ?? [], [d]);
  const filtering = Boolean(q || project || status);

  if (err) return <State>تعذّر التحميل: {err}</State>;

  async function handleAdd(values: RevenueFormValues) {
    setBusy(true); setFormErr(null);
    try {
      await api.createRevenue(values);
      setAddOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: RevenueFormValues) {
    if (!editRow && !collectRow) return;
    const id = (editRow ?? collectRow)!.id;
    setBusy(true); setFormErr(null);
    try {
      await api.updateRevenue(id, {
        project: values.project, unit: values.unit, client: values.client,
        amount: values.amount, dueDate: values.dueDate || null, status: values.status,
        collectedOn: values.status === 'collected' ? (values.collectedOn || null) : null,
        notes: values.notes,
      });
      setEditRow(null); setCollectRow(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const modalRow = editRow ?? collectRow;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>التحصيلات</h1>
          <p>الإيرادات المستحقة والمحصّلة — تدخل يدوياً أو من الملفات</p>
        </div>
        <button className="btn primary" onClick={() => { setFormErr(null); setAddOpen(true); }}>
          إضافة تحصيل
        </button>
      </div>

      {d && (
        <div className="kpi-row">
          <Kpi label="المستحق المفتوح" value={sar(d.totals.open)} unit="ر.س" tone="gold" />
          <Kpi label="المحصّل" value={sar(d.totals.collected)} unit="ر.س" tone="ok" />
          <Kpi label="الإجمالي" value={sar(d.totals.all)} unit="ر.س" />
        </div>
      )}

      <div className="toolbar">
        <input placeholder="بحث بالعميل أو الوحدة…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">كل المشاريع</option>
          {projects.map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">الكل</option>
          <option value="open">مفتوح</option>
          <option value="collected">محصّل</option>
        </select>
        {d && <span className="count">{ar(d.count)} نتيجة</span>}
      </div>

      <Card>
        {!d ? <State>جارٍ التحميل…</State>
          : d.rows.length === 0 ? (
            filtering ? (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم يطابق البحث أو التصفية أي تحصيل."
                ctaLabel="مسح التصفية" onCta={() => { setQ(''); setProject(''); setStatus(''); }} />
            ) : (
              <EmptyState kind="no-data" title="لا توجد تحصيلات بعد"
                body="أضف تحصيلاً يدوياً أو ارفع ملف التحصيلات من صفحة الرفع لتظهر هنا."
                ctaLabel="إضافة تحصيل" onCta={() => { setFormErr(null); setAddOpen(true); }} />
            )
          ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>العميل</th><th>المشروع</th><th className="ltr">المبلغ</th>
                <th>تاريخ الاستحقاق</th><th>الحالة</th><th>المصدر</th><th></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r: Revenue) => (
                <tr key={r.id}>
                  <td>
                    {r.client}
                    {r.unit && <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{r.unit}</div>}
                  </td>
                  <td className="muted">{r.project}</td>
                  <td className="ltr"><Money v={r.amount} /></td>
                  <td>
                    {r.dueDate ? arDate(r.dueDate) : (
                      <span className="gold" title="بلا تاريخ — لا يدخل توقع التدفق"
                            style={{ cursor: 'help' }}>—</span>
                    )}
                  </td>
                  <td><Pill kind={r.status === 'collected' ? 'ok' : 'gold'}>
                    {r.status === 'collected' ? 'محصّل' : 'مفتوح'}
                  </Pill></td>
                  <td className="muted">{r.source === 'manual' ? 'يدوي' : 'ملف'}</td>
                  <td className="ltr">
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      {r.status === 'open' && (
                        <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                                onClick={() => { setFormErr(null); setCollectRow(r); }}>
                          تحصيل
                        </button>
                      )}
                      <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                              onClick={() => { setFormErr(null); setEditRow(r); }}>✎</button>
                      <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                              onClick={() => setDeleteRow(r)}>🗑</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {addOpen && (
        <Modal title="إضافة تحصيل" onClose={() => setAddOpen(false)}>
          <RevenueForm projects={projects} onSubmit={handleAdd} busy={busy} error={formErr} />
        </Modal>
      )}

      {modalRow && (
        <Modal title={collectRow ? 'تسجيل تحصيل' : 'تعديل تحصيل'}
               onClose={() => { setEditRow(null); setCollectRow(null); }}>
          <RevenueForm
            projects={projects}
            initial={{
              project: modalRow.project, unit: modalRow.unit, client: modalRow.client,
              amount: modalRow.amount, dueDate: modalRow.dueDate || '',
              status: collectRow ? 'collected' : modalRow.status,
              collectedOn: collectRow ? new Date().toISOString().slice(0, 10) : (modalRow.collectedOn || ''),
              notes: modalRow.notes || '',
            }}
            onSubmit={handleEdit}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {deleteRow && (
        <DeleteRevenueModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => { setDeleteRow(null); reload(); }}
        />
      )}
    </>
  );
}

type RevenueFormValues = {
  project: string; unit: string; client: string; amount: number;
  dueDate: string; status: string; collectedOn: string; notes: string;
};

function RevenueForm({ projects, initial, onSubmit, busy, error }: {
  projects: string[];
  initial?: Partial<RevenueFormValues>;
  onSubmit: (v: RevenueFormValues) => void;
  busy: boolean;
  error: string | null;
}) {
  const [project, setProject] = useState(initial?.project ?? '');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [client, setClient] = useState(initial?.client ?? '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [dueDate, setDueDate] = useState(initial?.dueDate ?? '');
  const [status, setStatus] = useState(initial?.status ?? 'open');
  const [collectedOn, setCollectedOn] = useState(initial?.collectedOn ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      project, unit, client, amount: Number(amount), dueDate, status, collectedOn, notes,
    });
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="callout bad">{error}</div>}
      <label>
        العميل
        <input required value={client} onChange={(e) => setClient(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        المشروع
        <input list="revenue-projects" value={project} onChange={(e) => setProject(e.target.value)}
               style={{ width: '100%' }} />
        <datalist id="revenue-projects">
          {projects.map((p) => <option key={p} value={p} />)}
        </datalist>
      </label>
      <label>
        الوحدة
        <input value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        المبلغ
        <input required type="number" min="0.01" step="0.01" dir="ltr" value={amount}
               onChange={(e) => setAmount(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        تاريخ الاستحقاق
        <input type="date" dir="ltr" value={dueDate}
               onChange={(e) => setDueDate(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        الحالة
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: '100%' }}>
          <option value="open">مفتوح</option>
          <option value="collected">محصّل</option>
        </select>
      </label>
      {status === 'collected' && (
        <label>
          تاريخ التحصيل
          <input required type="date" dir="ltr" value={collectedOn}
                 onChange={(e) => setCollectedOn(e.target.value)} style={{ width: '100%' }} />
        </label>
      )}
      <label>
        ملاحظات
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} style={{ width: '100%' }} rows={2} />
      </label>
      <div className="modal-foot">
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}

function DeleteRevenueModal({ row, onClose, onDeleted }:
  { row: Revenue; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setBusy(true); setError(null);
    try {
      await api.deleteRevenue(row.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="حذف تحصيل" onClose={onClose}>
      <p>هل تريد حذف تحصيل «{row.client}» بمبلغ {sar(row.amount)} ر.س؟</p>
      {row.source !== 'manual' && (
        <div className="callout" style={{ marginTop: 8 }}>
          صف مستورد من ملف — حذفه لا يمنع إعادة رفعه لاحقاً.
        </div>
      )}
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn primary" disabled={busy} onClick={confirmDelete}>
          {busy ? 'جارٍ الحذف…' : 'حذف'}
        </button>
      </div>
    </Modal>
  );
}
