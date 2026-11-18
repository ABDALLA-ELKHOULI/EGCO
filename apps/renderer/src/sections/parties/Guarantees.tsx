/* الضمانات — يستبدل pages/Guarantees.tsx (P-164…P-169). */
import { useState } from 'react';
import { useGo } from '@/app/routes';
import { DataTable, EmptyState, ExportDialog, Button, Grid, Island, Kpi, Money, PageHeader, Pill, Skeleton, dateTxt, int, usePrefs, type Column } from '@/ui';
import { ExplainDot } from '@/components/Explain';
import { useGuaranteeAccount, useGuarantees } from './hooks';
import { GUARANTEE_DUE } from './logic/contractors';
import { matchState, ratePct, trackedOf } from './logic/guarantees';
import { PModal, errMsg, toneOf } from './components/shared';
import type { ContractorGuaranteeTracked, GuaranteeAccountRow } from './types';
import type { GuaranteeEntry as GE } from '@/lib/api';
import './parties.css';

function MatchPill({ a }: { a: Pick<GuaranteeAccountRow, 'matches' | 'difference'> }) {
  const m = matchState(a);
  if (m.kind === 'unknown') return <span className="dash">—</span>;
  if (m.kind === 'ok') return <Pill tone="ok">مطابق</Pill>;
  return <Pill tone="danger">فرق <Money value={m.amount} /></Pill>;
}

export default function Guarantees() {
  usePrefs();
  const go = useGo();
  const q = useGuarantees();
  const d = q.data;
  const [open, setOpen] = useState<GuaranteeAccountRow | null>(null);
  const [exp, setExp] = useState(false);
  if (q.isError && !d) return <EmptyState icon="alert" title="تعذّر التحميل" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} />;
  const has = !!d && (d.accounts.length > 0 || d.contractorGuarantees.length > 0);

  const aCols: Column<GuaranteeAccountRow>[] = [
    { key: 'account', label: 'الحساب', render: (a) => <span className="num">{a.account}</span> },
    { key: 'name', label: 'الاسم', render: (a) => a.name || <span className="dash">—</span> },
    { key: 'linkedContractorName', label: 'المقاول المرتبط', render: (a) => a.linkedContractorCode
      ? <button type="button" className="pt-link" onClick={(e) => { e.stopPropagation(); go('parties.contractor', { code: a.linkedContractorCode! }); }}>{a.linkedContractorName ?? a.linkedContractorCode}</button>
      : <span className="cap">غير مرتبط</span> },
    { key: 'balance', label: 'الرصيد', money: true },
    { key: 'entryCount', label: 'عدد الحركات', num: true },
    { key: 'lastActivity', label: 'آخر حركة', render: (a) => a.lastActivity ? dateTxt(a.lastActivity, { year: true }) : <span className="dash">—</span> },
    { key: 'matches', label: 'المطابقة', sort: false, render: (a) => <MatchPill a={a} /> },
  ];
  const gCols: Column<ContractorGuaranteeTracked>[] = [
    { key: 'contractorName', label: 'المقاول', render: (g) => <button type="button" className="pt-link" onClick={(e) => { e.stopPropagation(); go('parties.contractor', { code: g.contractorCode }); }}>{g.contractorName}</button> },
    { key: 'project', label: 'المشروع', render: (g) => g.project || <span className="dash">—</span> },
    { key: 'amount', label: 'المبلغ', money: true },
    { key: 'retentionRate', label: 'نسبة الاستقطاع', num: true, render: (g) => { const p = ratePct(g.retentionRate); return p == null ? <span className="dash">—</span> : <span className="num">{int(p)}٪</span>; } },
    { key: 'releaseDue', label: 'موعد الفك', render: (g) => g.releaseDue ? dateTxt(g.releaseDue, { year: true }) : <span className="dash">—</span> },
    { key: 'dueStatus', label: 'الحالة', render: (g) => { const s = GUARANTEE_DUE[g.dueStatus] ?? { label: g.dueStatus, tone: '' }; return <Pill tone={toneOf(s.tone)}>{s.label}</Pill>; } },
  ];

  return (
    <>
      <PageHeader title="ضمانات المقاولين" sub="مطابقة كشوفات حساب الضمان (٢١٦) بضمانات المقاولين المتتبَّعة لكل مشروع"
        actions={<Button onClick={() => setExp(true)} disabled={!d}>تصدير</Button>} />
      {!d ? <Skeleton rows={8} /> : !has ? (
        <EmptyState icon="upload" title="لم تُرفع ضمانات بعد" body="ارفع كشف حساب ضمان ٢١٦ (مثال: كشف ضمان اعمال مقاول) لتظهر أرصدة الضمانات ومطابقتها هنا."
          cta="رفع الملفات" onCta={() => go('data.import')} />
      ) : (
        <Grid>
          <Kpi span={4} i={0} size="hero" label={<>المحتجز حسب الكشوف <ExplainDot metric="guaranteeStatementsHeld" values={{ guaranteeStatementsHeld: d.totals.statementsHeld }} /></>} value={d.totals.statementsHeld} />
          <Kpi span={4} i={1} label={<>المحتجز حسب المستخلصات <ExplainDot metric="guaranteeTrackedHeld" values={{ guaranteeTrackedHeld: d.totals.trackedHeld }} /></>} value={d.totals.trackedHeld} />
          <Kpi span={4} i={2} money={false} label={<>مستحقة الصرف <ExplainDot metric="guaranteeDueSoon" values={{ guaranteeDueSoonCount: d.totals.dueSoonCount, guaranteeOverdueCount: d.totals.overdueCount }} /></>}
            value={d.totals.dueSoonCount + d.totals.overdueCount} tone={d.totals.overdueCount > 0 ? 'danger' : undefined} crit={d.totals.overdueCount > 0} />
          <Island span={12} i={3} title="حسابات الضمان (كشوفات ٢١٦)">
            <p className="cap">اضغط على حساب لعرض حركاته</p>
            {d.accounts.length === 0 ? <EmptyState icon="upload" title="لا حسابات ضمان مستوردة" body="لم يُرفع أي كشف حساب ضمان بعد." cta="رفع الملفات" onCta={() => go('data.import')} />
              : <DataTable<GuaranteeAccountRow> id="parties.guarantees.accounts" rows={d.accounts} rowKey="account" columns={aCols} onRowClick={(a) => setOpen(a)}
                  total={{ keys: ['balance'], label: 'الإجمالي' }} searchPlaceholder="بحث بالحساب أو الاسم…" />}
          </Island>
          <Island span={12} i={4} title="ضمانات المقاولين المتتبَّعة">
            <p className="cap">من دفتر كل مقاول ومشروعه</p>
            {d.contractorGuarantees.length === 0 ? <EmptyState icon="file" title="لا ضمانات متتبَّعة" body="لم تُسجَّل ضمانات مقاولين بعد." cta="المقاولون" onCta={() => go('parties.contractors')} />
              : <DataTable<ContractorGuaranteeTracked> id="parties.guarantees.tracked" rows={d.contractorGuarantees} rowKey="id" columns={gCols}
                  onRowClick={(g) => go('parties.contractor', { code: g.contractorCode })}
                  filters={[{ key: 'dueStatus', label: 'الحالة', options: Object.entries(GUARANTEE_DUE).map(([k, s]) => ({ value: k, label: s.label })) }]}
                  total={{ keys: ['amount'], label: 'الإجمالي' }} />}
          </Island>
        </Grid>
      )}
      <AccountModal row={open} onClose={() => setOpen(null)} />
      <ExportDialog open={exp} onClose={() => setExp(false)} title="تصدير الضمانات المتتبَّعة" fileName="الضمانات.csv" rows={d?.contractorGuarantees ?? []}
        columns={[{ label: 'المقاول', value: (g: ContractorGuaranteeTracked) => g.contractorName }, { label: 'المشروع', value: (g) => g.project },
          { label: 'المبلغ', value: (g) => g.amount ?? '' }, { label: 'موعد الفك', value: (g) => g.releaseDue ?? '' },
          { label: 'تاريخ الصرف', value: (g) => g.releasedOn ?? '' }, { label: 'الحالة', value: (g) => GUARANTEE_DUE[g.dueStatus]?.label ?? g.dueStatus }]} />
    </>
  );
}

function AccountModal({ row, onClose }: { row: GuaranteeAccountRow | null; onClose: () => void }) {
  usePrefs();
  const q = useGuaranteeAccount(row?.account ?? null);
  const d = q.data;
  const eCols: Column<GE>[] = [
    { key: 'date', label: 'التاريخ', date: true, year: true },
    { key: 'doc', label: 'المستند', render: (e) => e.doc ? <span className="num">{e.doc}</span> : <span className="dash">—</span> },
    { key: 'description', label: 'الوصف' },
    { key: 'debit', label: 'مدين', money: true, render: (e) => e.debit ? <Money value={e.debit} /> : <span className="dash">—</span> },
    { key: 'credit', label: 'دائن', money: true, render: (e) => e.credit ? <Money value={e.credit} /> : <span className="dash">—</span> },
  ];
  return (
    <PModal open={!!row} onClose={onClose} size="lg" title={row ? `حساب ضمان ${row.account} — ${row.name}` : ''} actions={[{ label: 'إغلاق' }]}>
      {q.isError ? <EmptyState icon="alert" title="تعذّر التحميل" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} />
        : !d ? <Skeleton rows={5} /> : (<>
          <Grid>
            <Kpi span={6} label="الرصيد" value={d.account.balance} />
            <section className="isl c6">
              <div className="cap">المطابقة <ExplainDot metric="guaranteeAccountMatch" values={{ balance: d.account.balance, tracked: trackedOf(d.account) }} /></div>
              <div className="kpi pt-ks"><MatchPill a={d.account} /></div>
            </section>
          </Grid>
          {d.entries.length === 0 ? <EmptyState icon="inbox" title="لا حركات" body="لا توجد حركات مسجّلة على هذا الحساب." />
            : <DataTable<GE> id="parties.guarantees.entries" rows={d.entries} rowKey="id" columns={eCols} total={{ keys: ['debit', 'credit'] }} />}
        </>)}
    </PModal>
  );
}
