/**
 * «المستحقات القادمة» — today.due (`/today/due`، والمسار القديم `/payables`).
 * منقول من prototype (renderDue) ويغطي جدول «ادفع اليوم» في Dashboard.tsx (P-041…P-049).
 * الموردون والمقاولون معاً، بالأقدم استحقاقاً، مع تحديد ← قائمة دفع/تسجيل كمدفوع.
 * الفلاتر في الرابط (?range=&project=&status=) قابلة للربط العميق.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PageHeader, Grid, Island, Kpi, Money, Pill, Seg, Button, DataTable, ExportDialog, EmptyState, Skeleton,
  dateTxt, digits, fmt, usePrefs,
} from '@/ui';
import { ExplainDot } from '@/components/Explain';
import { useDashboardData, useOverviewData, useTodayState, useClaimsDue, useSupplierDue, useProjectNames } from './data.ts';
import {
  mergeDue, dueTotals, groupByParty, paymentListCsv, sumHalalas, DUE_RANGES, type DueRange, type DueRow,
} from './logic.ts';
import { PayModal, useBulkPay, type PayTarget } from './Payments.tsx';
import { useGo } from './nav.ts';

const RANGES = new Set<string>(DUE_RANGES.map(([v]) => v));

export default function Due() {
  usePrefs();
  const go = useGo();
  const [sp, setSp] = useSearchParams();
  const range = (RANGES.has(sp.get('range') || '') ? sp.get('range') : '7') as DueRange;
  const project = sp.get('project') || '';
  const status = sp.get('status') === 'overdue' || sp.get('status') === 'late' ? 'late' : sp.get('status') === 'soon' ? 'soon' : '';
  const setParam = (k: string, v: string) => { const p = new URLSearchParams(sp); if (v) p.set(k, v); else p.delete(k); setSp(p, { replace: true }); };

  const db = useDashboardData(project);
  const ov = useOverviewData();
  const { td, loading: tdLoading, error: tdError, refetch: tdRetry } = useTodayState();
  const claims = useClaimsDue(project);
  const sup = useSupplierDue(range, project, db.data?.payToday);
  const projects = useProjectNames();
  const bulkPay = useBulkPay();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [exp, setExp] = useState<DueRow[] | null>(null);

  const today = db.data?.today ?? '';
  const all = useMemo(() => (today ? mergeDue(today, sup.rows, claims.data?.rows ?? [], range) : []), [today, sup.rows, claims.data, range]);
  const rows = useMemo(() => (status ? all.filter((r) => r.status === status) : all), [all, status]);
  const t = dueTotals(rows);
  const bank = td?.bankBalance ?? null;
  const picked = rows.filter((r) => sel.has(r.id));

  if (db.error) return <EmptyState icon="alert" title="تعذّر تحميل البيانات" body={String(db.error as Error)} cta="إعادة المحاولة" onCta={() => db.refetch()} />;
  if (!db.data) return <div className="sec-today"><PageHeader title="المستحقات القادمة" /><Skeleton rows={8} /></div>;
  const s = db.data.summary;
  const c = ov.data?.contractors;

  return (
    <div className="sec-today">
      <PageHeader title="المستحقات القادمة"
        sub={<>الموردون والمقاولون معاً · مرتبة بالأقدم استحقاقاً · حدّد ما ستدفعه لتكوين قائمة دفع · {dateTxt(today, { weekday: true, year: true })}</>}
        actions={<>
          <Seg<DueRange> value={range} onChange={(v) => setParam('range', v === '7' ? '' : v)} label="المدى"
            options={DUE_RANGES.map(([value, label]) => ({ value, label }))} />
          <select className="td-sel" aria-label="المشروع" value={project} onChange={(e) => setParam('project', e.target.value)}>
            <option value="">كل المشاريع</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <Button kind="primary" onClick={() => go('data.import')}>رفع كشف حساب</Button>
        </>} />

      <Grid>
        {/* أرقام الخادم للموردين — P-045 (لا تتأثر بتصفية الجدول) */}
        <Kpi span={4} i={0} label={<>متأخر عن موعده <ExplainDot metric="overdue" values={{ overdue: s.overdue }} /></>} value={s.overdue}
          tone={s.overdue > 0 ? 'danger' : undefined} crit={s.overdue > 0} countKey="due.overdue" hint="الموردون" />
        <Kpi span={4} i={1} label={<>مستحق خلال ٧ أيام <ExplainDot metric="dueWithin7" values={{ dueWithin7: s.dueWithin7 }} /></>} value={s.dueWithin7}
          tone="warn" countKey="due.d7" hint="الموردون" />
        <div className="td-contents" data-testid="kpi-outstanding">
        <Kpi span={4} i={2} label={<>المديونية المفتوحة <ExplainDot metric="outstanding" values={{ totalInvoiced: sumHalalas([s.totalPaid, s.outstanding], (x) => x), totalPaid: s.totalPaid, outstanding: s.outstanding }} /></>}
          value={s.outstanding} countKey="due.open"
          hint={s.totalPaid > 0 ? <>سُدّد حتى الآن {fmt(s.totalPaid)} من {fmt(sumHalalas([s.totalPaid, s.outstanding], (x) => x))} ر.س</> : undefined} />
        </div>

        {c && (c.withTermCount > 0 || c.withoutTermCount > 0) && (
          <Island span={12} i={3} className="td-conline">
            <p className="disclose">
              {c.overdue > 0
                ? <>+ <Money value={c.overdue} className="t-danger" /> متأخر للمقاولين ({digits(c.overdueContractorCount)} مقاولاً) — غير مجموع مع رقم الموردين أعلاه</>
                : c.withTermCount > 0 ? <>لا متأخرات على {digits(c.withTermCount)} مقاولاً لهم مدة سداد</> : null}
              {c.withoutTermCount > 0 && <>{c.withTermCount > 0 ? ' · ' : ''}<button type="button" className="lnk" onClick={() => go('parties.contractors', { noTerm: '1' })}>{digits(c.withoutTermCount)} مقاولاً بلا مدة سداد</button> — تأخرهم غير محسوب</>}
            </p>
            {(ov.data?.alerts ?? []).filter((a) => a.kind === 'contractors_overdue').map((a) => (
              <p key={a.kind} className={'td-alert ' + (a.level === 'danger' ? 'd' : 'i')}>{a.text}</p>
            ))}
          </Island>
        )}

        <Island span={4} i={4}>
          <div className="cap">إجمالي المستحق في المدى</div>
          <div className="kpi"><Money value={t.total} /></div>
          <div className="meta"><span>{digits(t.count)} استحقاق</span></div>
        </Island>
        <Island span={4} i={5} crit={t.late > 0}>
          <div className="cap">منها متأخر</div>
          <div className={'kpi' + (t.late > 0 ? ' t-danger' : '')}><Money value={t.late} /></div>
        </Island>
        <Island span={4} i={6} onClick={() => go('cash.flow')} label="النقد المتاح — افتح التدفق">
          <div className="cap">النقد المتاح مقابلها</div>
          {tdLoading ? <Skeleton rows={2} /> : tdError
            ? <p className="disclose">تعذّر تحميل بيانات اليوم — <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); tdRetry(); }}>إعادة المحاولة</button></p>
            : bank != null
            ? <><div className="kpi"><Money value={bank} /></div><div className="meta"><span>بعد الدفع <Money value={Math.round(bank * 100 - t.total * 100) / 100} className={bank - t.total < 0 ? 't-warn' : ''} /></span></div></>
            : td?.cashBasis === 'no_bank_balance'
            ? <><div className="kpi"><span className="dash">—</span></div><div className="meta"><span>رصيد البنك غير مُدخل</span></div></>
            : <div className="kpi"><span className="dash">—</span></div>}
        </Island>

        <Island span={12} i={7}>
          {sup.loading || claims.isLoading ? <Skeleton rows={6} /> : (
            <DataTable<DueRow>
              id="today.due" rows={rows} rowKey="id"
              columns={[
                { key: 'date', label: 'الاستحقاق', date: true, sortValue: (r) => r.date },
                { key: 'name', label: 'الطرف', render: (r) => <><b>{r.name}</b>{r.project && <div className="cap">{r.project}</div>}</>, searchValue: (r) => r.name + ' ' + r.project + ' ' + r.doc + ' ' + r.key },
                { key: 'partyType', label: 'النوع', render: (r) => <Pill tone="neutral">{r.partyType === 'contractor' ? 'مقاول' : 'مورد'}</Pill> },
                { key: 'doc', label: 'المستند', render: (r) => (r.doc ? <span className="num">{digits(r.doc)}</span> : <span className="dash">—</span>) },
                { key: 'late', label: 'الحالة', num: true, sortValue: (r) => -r.daysTo,
                  render: (r) => (r.late > 0 ? <Pill tone="danger">متأخر {digits(r.late)} يوماً</Pill>
                    : r.daysTo === 0 ? <Pill tone="warn">اليوم</Pill> : <Pill tone="warn">بعد {digits(r.daysTo)} يوماً</Pill>) },
                { key: 'amount', label: 'المبلغ', money: true, render: (r) => <Money value={r.amount} className={r.late > 0 ? 't-danger' : ''} /> },
                { key: '_act', label: '', sort: false, required: true,
                  render: (r) => <Button size="sm" onClick={(e) => { e.stopPropagation(); setPay({ partyType: r.partyType, key: r.key, name: r.name, amount: r.amount, doc: r.doc }); }}>دُفع</Button> },
              ]}
              sort={{ key: 'date', dir: 'asc' }}
              filters={[
                { key: 'partyType', label: 'النوع', options: [
                  { value: 'supplier', label: 'موردون', test: (r) => r.partyType === 'supplier' },
                  { value: 'contractor', label: 'مقاولون', test: (r) => r.partyType === 'contractor' }] },
              ]}
              toolbar={<Seg<string> value={status} onChange={(v) => setParam('status', v === 'late' ? 'overdue' : v)} label="الحالة"
                options={[{ value: '', label: 'كل الحالات' }, { value: 'late', label: 'متأخر' }, { value: 'soon', label: 'مستحق قريباً' }]} />}
              total={{ keys: ['amount'], label: 'الإجمالي' }}
              selectable selected={sel} onSelect={(keys) => setSel(new Set(keys))}
              selectionBar={{ label: 'المحدد', sumKey: 'amount', actions: [
                { label: 'قائمة دفع', onClick: (chosen) => setExp(chosen) },
                { label: 'تسجيل كمدفوع', onClick: async (chosen, clear) => { if (await bulkPay(groupByParty(chosen), today)) clear(); } },
              ] }}
              onRowClick={(r) => go(r.partyType === 'contractor' ? 'parties.contractor' : 'parties.supplier', r.partyType === 'contractor' ? { code: r.key } : { account: r.key })}
              empty={{ icon: 'check', title: 'لا مستحقات في هذا المدى', body: 'لا إجراء مطلوب الآن — جرّب مدى أوسع.', cta: range === 'all' ? undefined : 'الكل', onCta: () => setParam('range', 'all') }}
            />
          )}
          {sup.truncated && <p className="disclose t-warn">الخادم أعاد أول ٥٠٠ صف لكل فئة فقط — ضيّق المدى أو اختر مشروعاً لرؤية الكل.</p>}
          <p className="disclose">البطاقات العلوية (متأخر · ٧ أيام · المفتوحة) للموردين من الخادم ولا تتأثر بتصفية الجدول؛ إجماليات المدى والجدول تشمل مستخلصات المقاولين ذوي مدة السداد.</p>
          {bank != null && picked.length > 0 && (
            <p className="disclose">المحدد {fmt(sumHalalas(picked, (r) => r.amount))} ر.س — {bank - sumHalalas(picked, (r) => r.amount) < 0 ? 'يتجاوز النقد المتاح' : 'يتبقى ' + fmt(Math.round(bank * 100 - sumHalalas(picked, (r) => r.amount) * 100) / 100)}</p>
          )}
        </Island>
      </Grid>

      {pay && <PayModal key={pay.partyType + pay.key + pay.doc} target={pay} today={today} onClose={() => setPay(null)} />}
      <ExportDialog open={!!exp} onClose={() => setExp(null)}
        title={'قائمة دفع — ' + digits(exp?.length ?? 0) + ' استحقاق · ' + fmt(sumHalalas(exp ?? [], (r) => r.amount)) + ' ر.س'}
        fileName={'payment-list-' + today + '.csv'} csv={exp ? paymentListCsv(exp) : ''} />
    </div>
  );
}
