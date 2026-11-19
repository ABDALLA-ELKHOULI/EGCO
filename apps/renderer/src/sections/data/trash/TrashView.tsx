/**
 * المحذوفات (م-٣١، P-352..356) — لا شيء يختفي بلا رجعة. تبويبات بالنوع مع عدّاد،
 * بحث، استرجاع مع التبعيات، وحذف نهائي بتأكيد صريح.
 * «إفراغ السلّة» في النموذج لا مسار له في الخادم — لم يُبنَ (انظر PARITY-data.md).
 */
import { useEffect } from 'react';
import { Button, DataTable, Grid, Island, PageHeader, Tabs, confirm, dateTxt, ago, toast, usePrefs, type Column } from '@/ui';
import { trashSummary, useTrash } from '../hooks/useTrash';
import { TRASH_KIND } from '../lib/labels';
import { Callout } from '../import/parts';
import type { TrashKind, TrashRow } from '../types';
import '../data.css';

const ORDER: TrashKind[] = ['supplier', 'contractor', 'invoice', 'payment', 'contractor_entry', 'import_log', 'budget_month'];

export default function TrashView() {
  usePrefs();
  const t = useTrash();
  useEffect(() => { if (t.note) toast(t.note.text, { kind: t.note.ok ? 'ok' : 'error' }); }, [t.note]);

  async function askPurge(r: TrashRow) {
    const ok = await confirm({
      title: 'حذف نهائي — لا رجعة بعده', danger: true, confirmLabel: 'حذف نهائي',
      body: <>سيُحذف «{r.name}» ({TRASH_KIND[r.kind]?.one ?? r.kind}) نهائياً من القاعدة، ولن يظهر هنا بعد ذلك ولن يمكن استرجاعه إطلاقاً.</>,
    });
    if (ok) void t.purge(r);
  }

  const columns: Column<TrashRow>[] = [
    { key: 'kind', label: 'النوع', render: (r) => TRASH_KIND[r.kind]?.one ?? r.kind },
    { key: 'name', label: 'الاسم', required: true, render: (r) => <b data-testid={`trash-row-${r.kind}-${r.id}`}>{r.name}</b> },
    { key: 'summary', label: 'التفاصيل', sort: false, render: (r) => <span className="cap">{trashSummary(r) || '—'}</span> },
    { key: 'deletedAt', label: 'تاريخ الحذف', value: (r) => r.deletedAt,
      render: (r) => (r.deletedAt ? <>{dateTxt(r.deletedAt)}<div className="cap">{ago(r.deletedAt)}</div></> : <span className="dash">—</span>) },
    { key: '_a', label: '', sort: false, required: true, render: (r) => (
      <span className="rowacts tight">
        <Button size="sm" kind="primary" data-testid="trash-restore" disabled={t.busy === r.id} onClick={(e) => { e.stopPropagation(); void t.restore(r); }}>{t.busy === r.id ? '…' : 'استرجاع'}</Button>
        <Button size="sm" kind="danger" disabled={t.busy === r.id} onClick={(e) => { e.stopPropagation(); void askPurge(r); }}>حذف نهائي</Button>
      </span>
    ) },
  ];

  const tabs = [
    { value: '' as const, label: <>الكل <span className="cnt3 num">{t.total}</span></> },
    ...ORDER.filter((k) => (t.counts[k] ?? 0) > 0 || t.kind === k)
      .map((k) => ({ value: k, label: <>{TRASH_KIND[k].many} <span className="cnt3 num">{t.counts[k] ?? 0}</span></> })),
  ];

  return (
    <div className="sec-data">
      <PageHeader title="المحذوفات" sub="لا شيء يختفي بلا رجعة — كل صف هنا يُسترجع مع تبعياته، أو يُحذف نهائياً بتأكيد صريح" />
      <Grid>
        <Island i={0}>
          <div className="trtabs">
            <Tabs<TrashKind | ''> label="نوع المحذوف" value={t.kind} onChange={t.setKind}
              tabs={tabs} />
          </div>
          {t.error && <Callout tone="bad">{t.error} <Button size="sm" onClick={t.refetch}>إعادة المحاولة</Button></Callout>}
          {t.data && (
            <DataTable<TrashRow> id="data.trash" rows={t.rows} rowKey={(r) => `${r.kind}:${r.id}`} columns={columns}
              searchPlaceholder="ابحث في المحذوفات…"
              sort={{ key: 'deletedAt', dir: 'desc' }}
              empty={{ icon: 'trash', title: 'السلّة فارغة', body: 'لا يوجد محذوف بهذا النوع حالياً.' }} />
          )}
        </Island>
      </Grid>
    </div>
  );
}
