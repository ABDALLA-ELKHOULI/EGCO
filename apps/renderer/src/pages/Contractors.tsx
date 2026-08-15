import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type ContractorRow, type ContractorsResponse } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { ContractorForm, type ContractorFormValues } from '@/components/ContractorForm';
import { ExplainDot } from '@/components/Explain';

/**
 * المقاولون — قاعدة الإشارة (متفق عليها مع المستخدم):
 *   الرصيد سالب  = مستحق «له» (نحن مدينون للمقاول) → أحمر
 *   الرصيد موجب  = مستحق «لنا» (المقاول مدين لنا)   → أخضر
 */
export function balanceView(balance: number): { cls: string; label: string } {
  if (balance < 0) return { cls: 'red', label: 'له' };
  if (balance > 0) return { cls: 'ok', label: 'لنا' };
  return { cls: 'muted', label: 'متوازن' };
}

type Direction = '' | 'owed_to_him' | 'owed_to_us' | 'balanced';

export function Contractors() {
  const nav = useNavigate();
  const [d, setD] = useState<ContractorsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [direction, setDirection] = useState<Direction>('');

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ContractorRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ContractorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);

  const reload = () => { setErr(null); api.contractors().then(setD).catch((e) => setErr(e.message)); };
  useEffect(() => { reload(); }, []);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const r of d?.rows ?? []) for (const p of r.projects ?? []) set.add(p);
    return [...set].sort();
  }, [d]);

  const rows = useMemo(() => {
    if (!d) return [];
    const needle = q.trim();
    return d.rows.filter((r) => {
      if (needle && !r.name.includes(needle) && !r.code.includes(needle)) return false;
      if (project && !(r.projects ?? []).includes(project)) return false;
      if (direction === 'owed_to_him' && !(r.balance < 0)) return false;
      if (direction === 'owed_to_us' && !(r.balance > 0)) return false;
      if (direction === 'balanced' && r.balance !== 0) return false;
      return true;
    });
  }, [d, q, project, direction]);

  const filtering = Boolean(q || project || direction);

  if (err) return <ErrorState message={err} onRetry={reload} />;

  async function handleAdd(values: ContractorFormValues) {
    setBusy(true); setFormErr(null);
    try {
      await api.createContractor(values);
      setAddOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: ContractorFormValues) {
    if (!editRow) return;
    setBusy(true); setFormErr(null);
    try {
      const { code, ...rest } = values;
      await api.updateContractor(editRow.code, rest);
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
          <h1>المقاولون</h1>
          <p>الرصيد السالب (بالأحمر) مستحق «له»، والموجب (بالأخضر) مستحق «لنا»</p>
        </div>
        <button className="btn primary" onClick={() => { setFormErr(null); setAddOpen(true); }}>
          إضافة مقاول
        </button>
      </div>

      {d && (
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Kpi label="إجمالي مستحق للمقاولين" value={sar(d.totals.owedToContractors)} unit="ر.س" tone="red" hero
               explain={<ExplainDot metric="contractorsOwed" values={{ contractorsOwed: d.totals.owedToContractors }} />} />
          <Kpi label="إجمالي مستحق لنا" value={sar(d.totals.owedToUs)} unit="ر.س" tone="ok"
               explain={<ExplainDot metric="contractorsOwedToUs" values={{ contractorsOwedToUs: d.totals.owedToUs }} />} />
          <Kpi label="الضمانات المحتجزة" value={sar(d.totals.retentionHeld)} unit="ر.س"
               explain={<ExplainDot metric="contractorsRetention" values={{ contractorsRetention: d.totals.retentionHeld }} />} />
        </div>
      )}

      <div className="toolbar">
        <input placeholder="بحث بالاسم أو الرمز…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
        <select value={project} onChange={(e) => setProject(e.target.value)}>
          <option value="">كل المشاريع</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={direction} onChange={(e) => setDirection(e.target.value as Direction)}>
          <option value="">الكل</option>
          <option value="owed_to_him">مستحق له</option>
          <option value="owed_to_us">مستحق لنا</option>
          <option value="balanced">متوازن</option>
        </select>
        {d && <span className="count">{ar(rows.length)} من {ar(d.count)} مقاولاً</span>}
      </div>

      <Card>
        {!d ? <State>جارٍ التحميل…</State>
          : rows.length === 0 ? (
            filtering ? (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم يطابق البحث أو التصفية أي مقاول."
                ctaLabel="مسح التصفية" onCta={() => { setQ(''); setProject(''); setDirection(''); }} />
            ) : (
              <EmptyState kind="no-data" title="لم تُرفع بيانات المقاولين بعد"
                body="ارفع كشوف حسابات المقاولين لتظهر أرصدتهم ومستخلصاتهم هنا."
                ctaLabel="رفع الملفات" onCta={() => nav('/import')} />
            )
          ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المقاول</th><th>الرمز</th><th>المشاريع</th>
                <th className="ltr">الرصيد</th><th className="ltr">الضمان المحتجز</th>
                <th className="ltr">آخر دفعة</th><th>آخر حركة</th><th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const v = balanceView(r.balance);
                return (
                  <tr key={r.code} className={r.balance < 0 ? 'row-overdue' : ''}>
                    <td>
                      <Link to={`/contractors/${r.code}`}>{r.name}</Link>
                      {r.releaseAlerts > 0 && (
                        <span className="release-dot" title={`ضمانات مستحقة الصرف: ${ar(r.releaseAlerts)}`} />
                      )}
                      {r.phone && (
                        <div className="muted num" style={{ fontSize: 11, marginTop: 2 }}>{r.phone}</div>
                      )}
                    </td>
                    <td className="num muted">{r.code}</td>
                    <td>
                      {(r.projects ?? []).length > 0 ? (
                        <div className="chip-row">
                          {r.projects.map((p) => <span key={p} className="chip">{p}</span>)}
                        </div>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      <Money v={r.balance} cls={v.cls} />{' '}
                      <span className={'balance-tag ' + v.cls}>{v.label}</span>
                    </td>
                    <td className="ltr">
                      {r.retentionHeld > 0 ? <Money v={r.retentionHeld} /> : <span className="muted">—</span>}
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
                    <td>{r.lastActivity ? arDate(r.lastActivity) : <span className="muted">—</span>}</td>
                    <td className="ltr">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn sm"
                                onClick={() => { setFormErr(null); setEditRow(r); }} aria-label="تعديل" title="تعديل">✎</button>
                        <button className="btn sm"
                                onClick={() => setDeleteRow(r)} aria-label="حذف" title="حذف">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {addOpen && (
        <Modal title="إضافة مقاول" onClose={() => setAddOpen(false)}>
          <ContractorForm onSubmit={handleAdd} busy={busy} error={formErr} />
        </Modal>
      )}

      {editRow && (
        <Modal title="تعديل مقاول" onClose={() => setEditRow(null)}>
          <ContractorForm
            initial={{ code: editRow.code, name: editRow.name, phone: editRow.phone ?? '' }}
            codeLocked
            onSubmit={handleEdit}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {deleteRow && (
        <DeleteContractorModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => { setDeleteRow(null); reload(); }}
        />
      )}
    </>
  );
}

/** حذف بخطوتين — مطابق لحذف المورد: 409 بلا force يستوجب كتابة الرمز للتأكيد. */
function DeleteContractorModal({ row, onClose, onDeleted }:
  { row: ContractorRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [typed, setTyped] = useState('');

  async function tryDelete(force: boolean) {
    setBusy(true); setError(null);
    try {
      await api.deleteContractor(row.code, force);
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
    <Modal title="حذف مقاول" onClose={onClose}>
      <p>هل تريد حذف المقاول «{row.name}» (رمز {row.code})؟</p>
      {error && <div className="callout bad">{error}</div>}

      {!needForce ? (
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn danger" disabled={busy} onClick={() => tryDelete(false)}>
            {busy ? 'جارٍ الحذف…' : 'حذف'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="callout bad">
            لهذا المقاول حركات مسجّلة. للمتابعة، اكتب الرمز «{row.code}» أدناه لتأكيد الحذف النهائي.
          </div>
          <input
            style={{ marginTop: 10, width: '100%' }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={row.code}
          />
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>إلغاء</button>
            <button className="btn danger" disabled={busy || typed !== row.code}
                    onClick={() => tryDelete(true)}>
              {busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
