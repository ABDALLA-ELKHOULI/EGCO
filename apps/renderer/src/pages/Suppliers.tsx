import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, arRange, sar, STATUS } from '@/lib/format';
import { Card, EmptyState, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { SupplierForm, type SupplierFormValues } from '@/components/SupplierForm';
import { AiBlock } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';

export function Suppliers() {
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [deleteRow, setDeleteRow] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  const reload = () => api.suppliers({ q, project, status }).then(setD).catch((e) => setErr(e.message));

  useEffect(() => {
    const t = setTimeout(() => {
      api.suppliers({ q, project, status }).then(setD).catch((e) => setErr(e.message));
    }, 200);
    return () => clearTimeout(t);
  }, [q, project, status]);

  const projects = useMemo(() => d?.projects ?? [], [d]);
  const filtering = Boolean(q || project || status);

  if (err) return <State>تعذّر التحميل: {err}</State>;

  async function handleAdd(values: SupplierFormValues) {
    setBusy(true); setFormErr(null);
    try {
      await api.createSupplier(values);
      setAddOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: SupplierFormValues) {
    if (!editRow) return;
    setBusy(true); setFormErr(null);
    try {
      await api.updateSupplier(editRow.account, { name: values.name, project: values.project, term: values.term });
      setEditRow(null);
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
          <h1>الموردون</h1>
          <p>مرتبون بالمتأخر ثم بالمديونية المفتوحة</p>
        </div>
        {!aiLoading && aiEnabled && (
          <button className="btn" onClick={() => setPrioritiesOpen((v) => !v)}>
            {prioritiesOpen ? 'إخفاء أولويات السداد' : 'أولويات السداد'}
          </button>
        )}
        <button className="btn primary" onClick={() => { setFormErr(null); setAddOpen(true); }}>
          إضافة مورد
        </button>
      </div>

      {prioritiesOpen && <PrioritiesPanel />}

      <div className="toolbar">
        <input placeholder="بحث بالاسم أو رقم الحساب…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">كل المشاريع</option>
          {projects.map((p: string) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="overdue">متأخر</option>
          <option value="due_soon">خلال ٧ أيام</option>
          <option value="awaiting_date">بانتظار تاريخ</option>
          <option value="open">منتظم</option>
          <option value="clear">مسدد بالكامل</option>
        </select>
        {d && <span className="count">{ar(d.count)} نتيجة · مفتوح {sar(d.totals.outstanding)} ر.س</span>}
      </div>

      <Card>
        {!d ? <State>جارٍ التحميل…</State>
          : d.rows.length === 0 ? (
            // فرّق بين «لا يوجد موردون بعد» و«البحث لم يطابق» — الرسالة الواحدة
            // كانت تُوهم أن القائمة فارغة بينما المشكلة أن الملف لم يُرفع أصلاً.
            filtering ? (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم يطابق البحث أو التصفية أي مورد."
                ctaLabel="مسح التصفية" onCta={() => { setQ(''); setProject(''); setStatus(''); }} />
            ) : (
              <EmptyState kind="no-data" title="لم تُرفع قائمة الموردين بعد"
                body="ارفع ملف «مدة مديونية الموردين» بصيغة Excel لتظهر هنا."
                ctaLabel="رفع الملف" onCta={() => nav('/import')} />
            )
          ) : (
          <table>
            <thead>
              <tr>
                <th>المورد</th><th>رقم الحساب</th><th>المشروع</th>
                <th>المدة</th><th>الحالة</th><th className="ltr">المديونية المفتوحة</th>
                <th className="ltr">آخر دفعة</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r: any) => {
                const st = STATUS[r.status] ?? { label: r.status, cls: '' };
                const rowCls = r.overdue > 0 ? 'row-overdue'
                  : r.status === 'due_soon' ? 'row-due-soon'
                  : r.status === 'clear' && r.outstanding === 0 && r.invoiceCount > 0 ? 'row-settled' : '';
                return (
                  <tr key={r.account} className={rowCls}>
                    <td>
                      <Link to={`/suppliers/${r.account}`}>{r.name}</Link>
                      {r.firstActivity && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          التغطية: {arRange(r.firstActivity, r.lastActivity)}
                        </div>
                      )}
                    </td>
                    <td className="num muted">{r.account}</td>
                    <td className="muted">{r.project}</td>
                    <td>{r.termKind === 'days' ? `${ar(r.termDays)} يوم` : r.term}</td>
                    <td><Pill kind={st.cls}>{st.label}</Pill></td>
                    <td className="ltr">
                      {r.outstanding > 0
                        ? <Money v={r.outstanding} cls={r.overdue > 0 ? 'red' : ''} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.lastPayment ? (
                        <>
                          <Money v={r.lastPayment.amount} />
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {arDate(r.lastPayment.date)}
                          </div>
                        </>
                      ) : <span className="muted">لا دفعات</span>}
                    </td>
                    <td className="ltr">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                                onClick={() => { setFormErr(null); setEditRow(r); }}>✎</button>
                        <button className="btn" style={{ padding: '4px 9px', fontSize: 12 }}
                                onClick={() => setDeleteRow(r)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {addOpen && (
        <Modal title="إضافة مورد" onClose={() => setAddOpen(false)}>
          <SupplierForm onSubmit={handleAdd} busy={busy} error={formErr} />
        </Modal>
      )}

      {editRow && (
        <Modal title="تعديل مورد" onClose={() => setEditRow(null)}>
          <SupplierForm
            initial={{ account: editRow.account, name: editRow.name, project: editRow.project, term: editRow.term }}
            onSubmit={handleEdit}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {deleteRow && (
        <DeleteSupplierModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => { setDeleteRow(null); reload(); }}
        />
      )}
    </>
  );
}

type PriorityItem = { partyKind: string; key: string; name: string; amount: number; score: number; reason: string };

/**
 * أولويات السداد — الترتيب والدرجة محسوبان بقواعد حتمية في الخادم، والنص فقط من المساعد.
 * ملاحظة عقد: لا يوجد حقل صريح في aiPriorities().items يفيد بأن بنداً «ضمن الميزانية» —
 * الحقول المتاحة هي partyKind/key/name/amount/score/reason فقط. لذا نُطبّق فحصاً محلياً
 * تراكمياً (تراكم amount حسب الترتيب حتى الميزانية المدخلة) بدل الاعتماد على علم من الخادم،
 * ونعرضه كتقدير وليس كحقيقة من الخادم.
 */
function PrioritiesPanel() {
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ items: PriorityItem[]; narrative: string } | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const b = budget.trim() ? Number(budget) : undefined;
      const r = await api.aiPriorities(b);
      setData(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { run(); /* عرض أولي بلا ميزانية */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const budgetNum = budget.trim() ? Number(budget) : null;
  let running = 0;

  return (
    <Card title="أولويات السداد" sub="الترتيب محسوب بقواعد حتمية، والشرح فقط من المساعد" >
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            ميزانية متاحة
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)}
                   style={{ marginInlineStart: 8, width: 160 }} dir="ltr" placeholder="اختياري" />
          </label>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'جارٍ الحساب…' : 'تحديث'}
          </button>
        </div>

        <AiBlock busy={busy} error={error}>
          {data && (
            data.items.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>لا بنود مرشّحة حالياً.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>الاسم</th><th></th><th className="ltr">المبلغ</th>
                        <th>السبب</th>{budgetNum != null && <th>ضمن الميزانية</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it, i) => {
                        const before = running;
                        running += it.amount || 0;
                        const fits = budgetNum != null ? before + (it.amount || 0) <= budgetNum : null;
                        return (
                          <tr key={it.partyKind + it.key + i}>
                            <td className="num">{ar(i + 1)}</td>
                            <td>{it.name}</td>
                            <td><span className={'pill party ' + it.partyKind}>
                              {it.partyKind === 'contractor' ? 'مقاول' : 'مورد'}
                            </span></td>
                            <td className="ltr"><Money v={it.amount} /></td>
                            <td className="muted">{it.reason}</td>
                            {budgetNum != null && (
                              <td>{fits && <Pill kind="ok">ضمن الميزانية</Pill>}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{data.narrative}</p>
                {budgetNum != null && (
                  <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                    «ضمن الميزانية» تقدير محلي تراكمي بترتيب القائمة — لا يوجد حقل من الخادم يفيد بذلك صراحة.
                  </p>
                )}
              </div>
            )
          )}
        </AiBlock>
      </div>
    </Card>
  );
}

function DeleteSupplierModal({ row, onClose, onDeleted }:
  { row: any; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [typed, setTyped] = useState('');

  async function tryDelete(force: boolean) {
    setBusy(true); setError(null);
    try {
      await api.deleteSupplier(row.account, force);
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && !force) {
        setNeedForce(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="حذف مورد" onClose={onClose}>
      <p>هل تريد حذف المورد «{row.name}» (حساب {row.account})؟</p>
      {error && <div className="callout bad">{error}</div>}

      {!needForce ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" disabled={busy} onClick={() => tryDelete(false)}>
            {busy ? 'جارٍ الحذف…' : 'حذف'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="callout bad">
            لهذا المورد فواتير أو دفعات مرتبطة. للمتابعة، اكتب رقم الحساب «{row.account}» أدناه لتأكيد الحذف النهائي.
          </div>
          <input
            style={{ marginTop: 10, width: '100%' }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={row.account}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="btn" onClick={onClose}>إلغاء</button>
            <button className="btn primary" disabled={busy || typed !== row.account}
                    onClick={() => tryDelete(true)}>
              {busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
