import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, TrashKind, TrashRow } from '@/lib/api';
import { Card, EmptyState, ErrorState, State } from '@/components/ui';

const KIND_LABEL: Record<TrashKind, string> = {
  supplier: 'مورد',
  contractor: 'مقاول',
  invoice: 'فاتورة',
  payment: 'دفعة',
  contractor_entry: 'حركة مقاول',
  import_log: 'استيراد',
  budget_month: 'شهر موازنة',
};

const KIND_FILTERS: { value: TrashKind | ''; label: string }[] = [
  { value: '', label: 'الكل' },
  { value: 'supplier', label: 'موردون' },
  { value: 'contractor', label: 'مقاولون' },
  { value: 'invoice', label: 'فواتير' },
  { value: 'payment', label: 'دفعات' },
  { value: 'contractor_entry', label: 'حركات مقاولين' },
  { value: 'import_log', label: 'استيرادات' },
  { value: 'budget_month', label: 'أشهر موازنة' },
];

function summaryText(row: TrashRow): string {
  return Object.entries(row.summary)
    .filter(([, v]) => v !== 0 && v !== '' && v != null)
    .map(([k, v]) => `${k}: ${v}`)
    .join(' · ');
}

/**
 * شاشة «المحذوفات» (م-٣١) — كل ما هو محذوف منطقياً في التطبيق كله بنوع واحد،
 * بدل أن يبقى غير مرئي في القاعدة بلا أي طريق إليه من الواجهة. راجع
 * services/api/app/api/routes/trash.py لشرح كيف يُعاد كل نوع مع تبعياته.
 */
export function Trash() {
  const [rows, setRows] = useState<TrashRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState<TrashKind | ''>('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmPurge, setConfirmPurge] = useState<TrashRow | null>(null);

  function load() {
    setErr(null);
    api.trash(filter || undefined).then((r) => setRows(r.rows))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'تعذّر تحميل المحذوفات'));
  }

  useEffect(load, [filter]);

  async function restore(row: TrashRow) {
    setBusyId(row.id);
    try {
      await api.restoreTrash(row.kind, row.id);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الاسترجاع');
    } finally {
      setBusyId(null);
    }
  }

  async function purge(row: TrashRow) {
    setBusyId(row.id);
    try {
      await api.purgeTrash(row.kind, row.id);
      setConfirmPurge(null);
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'تعذّر الحذف النهائي');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>المحذوفات</h1>
          <p>لا شيء يختفي بلا رجعة — كل صف هنا يمكن استرجاعه مع تبعياته، أو حذفه نهائياً بتأكيد صريح</p>
        </div>
        <Link className="btn" to="/settings">رجوع للإعدادات</Link>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        {KIND_FILTERS.map((f) => (
          <button key={f.value} className={'btn sm' + (filter === f.value ? ' primary' : '')}
                  onClick={() => setFilter(f.value)}>
            {f.label}
          </button>
        ))}
      </div>

      {err && <ErrorState message={err} onRetry={load} />}
      {!err && rows === null && <State>جارٍ التحميل…</State>}
      {!err && rows !== null && rows.length === 0 && (
        <EmptyState kind="all-clear" title="السلّة فارغة" body="لا يوجد محذوف بهذا النوع حالياً" />
      )}

      {!err && rows !== null && rows.length > 0 && (
        <Card>
          <table className="table">
            <thead>
              <tr>
                <th>النوع</th>
                <th>الاسم</th>
                <th>تاريخ الحذف</th>
                <th>التفاصيل</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.kind}:${r.id}`}>
                  <td>{KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td>{r.name}</td>
                  <td style={{ direction: 'ltr', fontSize: 12 }}>
                    {r.deletedAt ? new Date(r.deletedAt).toLocaleString('ar-SA') : '—'}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>{summaryText(r) || '—'}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn sm primary" disabled={busyId === r.id}
                              onClick={() => restore(r)}>
                        {busyId === r.id ? '…' : 'استرجاع'}
                      </button>
                      <button className="btn sm" disabled={busyId === r.id}
                              onClick={() => setConfirmPurge(r)}>
                        حذف نهائي
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {confirmPurge && (
        <div className="modal-scrim" onClick={() => setConfirmPurge(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h2>حذف نهائي — لا رجعة بعده</h2></div>
            <p>
              سيُحذف «{confirmPurge.name}» ({KIND_LABEL[confirmPurge.kind]}) نهائياً من القاعدة،
              ولن يظهر في هذه القائمة بعد ذلك ولن يمكن استرجاعه إطلاقاً.
            </p>
            <div className="modal-foot">
              <button className="btn" onClick={() => setConfirmPurge(null)}>إلغاء</button>
              <button className="btn danger" disabled={busyId === confirmPurge.id}
                      onClick={() => purge(confirmPurge)}>
                {busyId === confirmPurge.id ? '…' : 'حذف نهائي'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
