/**
 * «الإيرادات/التحصيلات» — cash.revenues (P-230…P-240). التصفية والفرز على الخادم (DataTable
 * mode="server")، وإجماليات الجدول من `totals` الخادم. مؤشرات «خلال ٣٠ يوماً» و«هذا الشهر»
 * محسوبة بالهللات من كل صفوف النطاق حتى يضيفها B إلى totals (PARITY-cash.md §ثغرات ٦).
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Button, DataTable, ExportDialog, Grid, Island, Kpi, Money, PageHeader, Pill, confirm, dateTxt, digits, toast, usePrefs,
  type Column, type TableQuery,
} from '@/ui';
import { useCreateRevenue, useDeleteRevenue, useRevenues, useUpdateRevenue } from './hooks';
import { collectionsKpis, daysLate, revenueState } from './logic/collections';
import { todayIso } from './logic/money';
import type { Revenue, RevenueSortKey, RevenuesQuery } from './types';
import { BreakdownLite, type LiteReq } from './parts/BreakdownLite';
import { ExplainDot } from './parts/ExplainDot';
import { RevenueModal } from './parts/RevenueForm';
import './cash.css';

const SORTABLE: RevenueSortKey[] = ['client', 'project', 'amount', 'dueDate', 'status', 'source'];

export default function RevenuesView() {
  usePrefs();
  const today = todayIso();
  const [params, setParams] = useSearchParams();
  const [tq, setTq] = useState<TableQuery>({ q: '', sort: null, filters: {} });
  const [range, setRange] = useState({ dateFrom: '', dateTo: '', minAmount: '', maxAmount: '' });

  const query: RevenuesQuery = {
    q: tq.q || undefined,
    project: tq.filters.project || undefined,
    status: (tq.filters.status as 'open' | 'collected' | null) || undefined,
    dateFrom: range.dateFrom || undefined, dateTo: range.dateTo || undefined,
    minAmount: range.minAmount ? Number(range.minAmount) : undefined,
    maxAmount: range.maxAmount ? Number(range.maxAmount) : undefined,
    sort: tq.sort && SORTABLE.includes(tq.sort.key as RevenueSortKey) ? (tq.sort.key as RevenueSortKey) : undefined,
    dir: tq.sort?.dir,
  };
  const list = useRevenues(query);
  // نطاق المؤشرات: المشروع فقط (لا بحث/حالة) — كي تبقى ثابتة أثناء التصفية، كإجماليات الخادم
  const scope = useRevenues({ project: query.project });
  const d = list.data, all = scope.data?.rows ?? [];
  const k = useMemo(() => collectionsKpis(all, today), [all, today]);
  const filtering = Boolean(tq.q || tq.filters.project || tq.filters.status || range.dateFrom || range.dateTo || range.minAmount || range.maxAmount);

  const create = useCreateRevenue(), update = useUpdateRevenue(), del = useDeleteRevenue();
  const modal = params.get('new') ? 'add' : null;
  const [edit, setEdit] = useState<{ mode: 'add' | 'edit' | 'collect'; row: Revenue | null } | null>(null);
  const openId = params.get('id');
  const fromParam = openId ? all.find((r) => r.id === openId) ?? null : null;
  const active = edit ?? (modal ? { mode: 'add' as const, row: null } : fromParam ? { mode: 'edit' as const, row: fromParam } : null);
  const closeModal = () => {
    setEdit(null);
    if (params.get('new') || params.get('id')) { const p = new URLSearchParams(params); p.delete('new'); p.delete('id'); setParams(p, { replace: true }); }
  };
  const [lite, setLite] = useState<LiteReq | null>(null);
  const [exp, setExp] = useState(false);

  const uncollect = async (r: Revenue) => {
    await update.mutateAsync({ id: r.id, patch: { status: 'open', collectedOn: null } });
    toast('أُلغي التحصيل', { kind: 'info', undo: () => { update.mutate({ id: r.id, patch: { status: 'collected', collectedOn: r.collectedOn } }); } });
  };
  const remove = async (r: Revenue) => {
    const ok = await confirm({
      title: 'حذف تحصيل', danger: true, confirmLabel: 'حذف',
      body: `هل تريد حذف تحصيل «${r.client}» بمبلغ ${r.amount.toFixed(2)} ر.س؟` + (r.source !== 'manual' ? ' صف مستورد من ملف — حذفه لا يمنع إعادة رفعه لاحقاً.' : ''),
    });
    if (!ok) return;
    await del.mutateAsync(r.id);
    toast('حُذف التحصيل', { kind: 'info' });
  };

  const cols: Column<Revenue>[] = [
    { key: 'client', label: 'العميل', required: true, render: (r) => <><b>{r.client}</b>{r.unit && <div className="cap">{r.unit}</div>}</> },
    { key: 'project', label: 'المشروع', render: (r) => r.project || <span className="dash">—</span> },
    { key: 'dueDate', label: 'تاريخ الاستحقاق', render: (r) => (r.dueDate ? dateTxt(r.dueDate) : <span className="dash" title="بلا تاريخ — لا يدخل توقع التدفق">—</span>) },
    { key: 'status', label: 'الحالة', render: (r) => {
      const st = revenueState(r, today);
      if (st === 'late') return <Pill tone="danger">متأخر {digits(daysLate(r, today) ?? 0)} يوماً</Pill>;
      if (st === 'collected') return <Pill tone="ok">محصّل{r.collectedOn ? ' ' + dateTxt(r.collectedOn) : ''}</Pill>;
      return <Pill tone="warn">مفتوح</Pill>;
    } },
    { key: 'amount', label: 'المبلغ', money: true, render: (r) => <Money value={r.amount} className={r.status === 'collected' ? '' : 't-ok'} /> },
    { key: 'source', label: 'المصدر', hidden: true, render: (r) => (r.source === 'manual' ? 'يدوي' : 'ملف') },
    { key: '_a', label: '', sort: false, required: true, render: (r) => (
      <span className="sec-cash-ra" onClick={(e) => e.stopPropagation()}>
        {r.status !== 'collected'
          ? <Button size="sm" onClick={() => setEdit({ mode: 'collect', row: r })}>تحصيل</Button>
          : <Button size="sm" kind="ghost" onClick={() => { void uncollect(r); }}>إلغاء التحصيل</Button>}
        <Button size="sm" kind="ghost" onClick={() => setEdit({ mode: 'edit', row: r })}>تعديل</Button>
        <Button size="sm" kind="ghost" icon="trash" aria-label="حذف" className="sec-cash-del" onClick={() => { void remove(r); }} />
      </span>) },
  ];

  const t = d?.totals;
  return (
    <div className="sec-cash">
      <PageHeader title="التحصيلات" sub="ما يستحق لنا من المالك — كل تحصيل مؤرّخ يدخل التدفق النقدي مباشرة"
        actions={<>
          <Button onClick={() => setExp(true)} disabled={!d?.rows.length}>تصدير</Button>
          <Button kind="primary" onClick={() => setEdit({ mode: 'add', row: null })}>إضافة تحصيل</Button>
        </>} />
      {scope.data && scope.data.totals.undatedOpen > 0 && (
        <div className="sec-cash-calls"><div className="sec-cash-call w"><span>{digits(scope.data.totals.undatedOpen)} تحصيلاً مفتوحاً بلا تاريخ استحقاق (<Money value={k.undated.amount} />) — لا يدخل التدفق النقدي.</span></div></div>
      )}
      <Grid>
        <Kpi span={3} i={0} label={<>المستحق المفتوح <ExplainDot metric="revenuesOpen" values={{ revenuesOpen: scope.data?.totals.open }} /></>}
          value={scope.data?.totals.open ?? null} size="hero"
          onClick={() => setLite({ title: 'المستحق المفتوح', rule: 'كل التحصيلات غير المحصّلة، متأخرة أو لا، مؤرّخة أو لا.', rows: all.filter((r) => r.status !== 'collected'), total: scope.data?.totals.open ?? 0, dateKey: 'dueDate' })} />
        <Kpi span={3} i={1} label={<>متأخر <ExplainDot metric="rLate" /></>} value={scope.data?.totals.overdueOpen ?? null}
          tone={(scope.data?.totals.overdueOpen ?? 0) > 0 ? 'danger' : undefined} crit={(scope.data?.totals.overdueOpen ?? 0) > 0}
          onClick={() => setLite({ title: 'متأخر التحصيل', rule: 'غير محصّل وتاريخ استحقاقه قبل اليوم.', rows: k.late.rows, total: scope.data?.totals.overdueOpen ?? k.late.amount, dateKey: 'dueDate' })} />
        <Kpi span={3} i={2} label={<>خلال ٣٠ يوماً <ExplainDot metric="rIn30" /></>} value={scope.data ? k.in30.amount : null} tone="warn"
          onClick={() => setLite({ title: 'خلال ٣٠ يوماً', rule: 'غير محصّل باستحقاق من اليوم حتى ٣٠ يوماً.', rows: k.in30.rows, total: k.in30.amount, dateKey: 'dueDate' })} />
        <Kpi span={3} i={3} label={<>محصّل هذا الشهر <ExplainDot metric="rMonth" /></>} value={scope.data ? k.thisMonth.amount : null} tone="ok"
          onClick={() => setLite({ title: 'محصّل هذا الشهر', rule: 'تاريخ التحصيل داخل الشهر الجاري.', rows: k.thisMonth.rows, total: k.thisMonth.amount, dateKey: 'collectedOn' })} />
        <Island span={12} i={4}>
          <div className="sec-cash-filters sec-cash-rangebar">
            <label className="sec-cash-sel"><span className="cap">الاستحقاق من</span><input className="sec-cash-in" type="date" dir="ltr" value={range.dateFrom} onChange={(e) => setRange((r) => ({ ...r, dateFrom: e.target.value }))} /></label>
            <label className="sec-cash-sel"><span className="cap">إلى</span><input className="sec-cash-in" type="date" dir="ltr" value={range.dateTo} onChange={(e) => setRange((r) => ({ ...r, dateTo: e.target.value }))} /></label>
            <label className="sec-cash-sel"><span className="cap">المبلغ من</span><input className="sec-cash-in sec-cash-days" type="number" dir="ltr" value={range.minAmount} onChange={(e) => setRange((r) => ({ ...r, minAmount: e.target.value }))} /></label>
            <label className="sec-cash-sel"><span className="cap">إلى</span><input className="sec-cash-in sec-cash-days" type="number" dir="ltr" value={range.maxAmount} onChange={(e) => setRange((r) => ({ ...r, maxAmount: e.target.value }))} /></label>
            {d && <span className="cap">{digits(d.count)} نتيجة · مفتوح <Money value={t?.open ?? 0} /></span>}
            {filtering && <Button size="sm" kind="ghost" onClick={() => { setTq({ q: '', sort: null, filters: {} }); setRange({ dateFrom: '', dateTo: '', minAmount: '', maxAmount: '' }); }}>مسح كل التصفية</Button>}
          </div>
          {list.error && <div className="sec-cash-call w"><span>تعذّر التحميل: {list.error.message}</span><Button size="sm" onClick={() => list.refetch()}>أعد المحاولة</Button></div>}
          <DataTable<Revenue> id="cash.revenues" mode="server" rows={d?.rows ?? []} rowKey="id" columns={cols}
            onQueryChange={setTq} searchPlaceholder="العميل أو الوحدة…"
            filters={[
              { key: 'status', label: 'الحالة', options: [{ value: 'open', label: 'مفتوح' }, { value: 'collected', label: 'محصّل' }] },
              { key: 'project', label: 'المشروع', options: (d?.projects ?? []).map((p) => ({ value: p, label: p })) },
            ]}
            totals={{ amount: t?.all }} total={{ keys: ['amount'], label: 'الإجمالي' }}
            onRowClick={(r) => setEdit({ mode: 'edit', row: r })}
            empty={filtering
              ? { title: 'لا نتائج مطابقة', body: 'لم يطابق البحث أو التصفية أي تحصيل.', cta: 'مسح التصفية', onCta: () => { setTq({ q: '', sort: null, filters: {} }); setRange({ dateFrom: '', dateTo: '', minAmount: '', maxAmount: '' }); } }
              : { title: 'لا توجد تحصيلات بعد', body: 'أضف مستخلصات المالك المنتظرة حتى يظهر الداخل في التدفق النقدي — بدونها يكون صفراً لا تقديراً.', cta: 'إضافة تحصيل', onCta: () => setEdit({ mode: 'add', row: null }) }} />
        </Island>
      </Grid>

      <RevenueModal open={active != null} mode={active?.mode ?? 'add'} row={active?.row ?? null}
        projects={d?.projects ?? []} clients={d?.clients ?? []} allRows={all} onClose={closeModal}
        onSubmit={async (v) => {
          if (active?.row) await update.mutateAsync({ id: active.row.id, patch: v });
          else await create.mutateAsync(v);
          toast(active?.mode === 'add' ? 'أُضيف التحصيل — يدخل التدفق النقدي فوراً' : active?.mode === 'collect' ? 'سُجّل التحصيل' : 'حُفظ التعديل', { kind: 'ok' });
        }} />
      <BreakdownLite req={lite} onClose={() => setLite(null)} />
      <ExportDialog<Revenue> open={exp} onClose={() => setExp(false)} title="التحصيلات" fileName="collections.csv" rows={d?.rows ?? []}
        columns={[
          { label: 'العميل', value: (r) => r.client }, { label: 'الوحدة', value: (r) => r.unit }, { label: 'المشروع', value: (r) => r.project },
          { label: 'الاستحقاق', value: (r) => r.dueDate ?? '' }, { label: 'الحالة', value: (r) => (r.status === 'collected' ? 'محصّل' : 'مفتوح') },
          { label: 'تاريخ التحصيل', value: (r) => r.collectedOn ?? '' }, { label: 'المبلغ', value: (r) => r.amount.toFixed(2) },
          { label: 'المصدر', value: (r) => (r.source === 'manual' ? 'يدوي' : 'ملف') }, { label: 'ملاحظات', value: (r) => r.notes },
        ]} />
    </div>
  );
}
