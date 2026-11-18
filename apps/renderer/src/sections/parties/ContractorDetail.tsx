/* كشف المقاول — يستبدل pages/ContractorDetail.tsx (P-136…P-163) + تغيير الحالة + م-٥٠. */
import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useGo } from '@/app/routes';
import {
  Button, Chip, DataTable, EmptyState, Field, FormGrid, Grid, Island, Kpi, Money, PageHeader, Pill, Skeleton,
  confirm, dateTxt, int, toast, useForm, usePrefs, type Column,
} from '@/ui';
import { ExplainDot } from '@/components/Explain';
import { partiesApi } from './api';
import { CONTRACTOR_ROOTS, useApiMutation, useContractor, useContractors } from './hooks';
import {
  CLAIM_BUCKETS, CONTRACTOR_STATUSES, EMPTY_CLAIM_FILTERS, EMPTY_ENTRY_FILTERS, ENTRY_KIND, GUARANTEE_DUE, KIND_SIDE,
  STATUS_NEEDS_NOTE, STATUS_TONE, balanceView, claimBody, claimColumnFiltering, claimCurrentWork, claimFormInitial, claimMath,
  debitBreakdown, entryBody, entryColumnFiltering, entryFormInitial, entryPreview, entryKind, guaranteeBody,
  guaranteeFormInitial, heldRetention, knownProjects, pipeClaims, pipeEntries, statusLabel, withRunningBalance,
  type ClaimFilters, type ClaimFormValues, type EntryFilters, type EntryFormValues, type GuaranteeFormValues,
} from './logic/contractors';
import type { SortState } from './logic/table';
import { BalanceWord, DeletePartyModal, ErrBox, FDates, FRange, FSelect, FText, PModal, ProjectField, RemindModal, errMsg, toneOf, useAi } from './components/shared';
import { PartyProjectsCard } from './components/PartyProjects';
import { ContractorFormModal, StatementPrint } from './Contractors';
import type { ContractorClaim, ContractorDetail as Detail, ContractorEntry, ContractorEntryBody, ContractorGuarantee, ContractorStatus } from './types';
import './parties.css';

export default function ContractorDetail() {
  usePrefs();
  const go = useGo();
  const { code = '' } = useParams();
  const q = useContractor(code);
  const d = q.data;
  const ai = useAi();
  const allRows = useContractors({}).data?.rows ?? [];
  const allKnown = knownProjects(allRows);
  // كشف المقاول في الخادم لا يحمل status/statusNote بعد (طُلب من B) — نأخذهما من صفّ القائمة.
  const listRow = allRows.find((r) => r.code === code);
  const [ef, setEf] = useState<EntryFilters>(EMPTY_ENTRY_FILTERS);
  const [eSort, setESort] = useState<SortState | null>(null);
  const [cf, setCf] = useState<ClaimFilters>(EMPTY_CLAIM_FILTERS);
  const [cSort, setCSort] = useState<SortState | null>(null);
  const [entry, setEntry] = useState<{ row?: ContractorEntry; draft?: Partial<ContractorEntryBody> } | null>(null);
  const [claim, setClaim] = useState<{ row?: ContractorClaim } | null>(null);
  const [gt, setGt] = useState<{ row?: ContractorGuarantee } | null>(null);
  const [edit, setEdit] = useState(false);
  const [status, setStatus] = useState(false);
  const [remind, setRemind] = useState(false);
  const [parse, setParse] = useState(false);
  const [del, setDel] = useState(false);
  const [print, setPrint] = useState(false);
  useEffect(() => { setEf(EMPTY_ENTRY_FILTERS); setCf(EMPTY_CLAIM_FILTERS); }, [code]);

  const upd = useApiMutation((v: { id: string; project: string }) => partiesApi.updateEntry(code, v.id, { project: v.project || undefined }),
    { invalidate: CONTRACTOR_ROOTS, success: 'نُقلت الحركة للمشروع' });
  const delEntry = useApiMutation((id: string) => partiesApi.deleteEntry(code, id), { invalidate: CONTRACTOR_ROOTS, success: 'حُذفت الحركة' });
  const delClaim = useApiMutation((id: string) => partiesApi.deleteClaim(code, id), { invalidate: CONTRACTOR_ROOTS, success: 'حُذف المستخلص' });
  const delGt = useApiMutation((id: string) => partiesApi.deleteGuarantee(code, id), { invalidate: CONTRACTOR_ROOTS, success: 'حُذف الضمان' });

  const running = useMemo(() => withRunningBalance(d?.entries ?? []), [d]);
  const entries = useMemo(() => pipeEntries(d?.entries ?? [], ef, eSort), [d, ef, eSort]);
  const claims = useMemo(() => pipeClaims(d?.claims ?? [], { ...cf, project: ef.project }, cSort), [d, cf, ef.project, cSort]);

  if (print && d) return <StatementPrint target={{ code: d.code, name: d.name, hasStatement: listRow?.hasStatement ?? d.entries.some((e) => e.source === 'statement') }} onBack={() => setPrint(false)} />;
  if (q.isError && !d) return (<><PageHeader title="المقاول غير متاح" crumb={{ label: '→ المقاولون', onClick: () => go('parties.contractors') }} />
    <EmptyState icon="alert" title="تعذّر التحميل" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} /></>);
  if (!d) return <Skeleton rows={10} />;

  const projects = d.perProject.map((p) => p.project).filter(Boolean);
  const knownAll = [...new Set([...projects, ...d.projects, ...allKnown])].sort();
  const v = balanceView(d.balance);
  const held = heldRetention(d.guarantees);
  const dbt = debitBreakdown(d);
  const proj = ef.project;
  const setE = (p: Partial<EntryFilters>) => setEf((x) => ({ ...x, ...p }));
  const setC = (p: Partial<ClaimFilters>) => setCf((x) => ({ ...x, ...p }));
  const dx = d as Detail & { status?: ContractorStatus; statusNote?: string };
  const status0 = dx.status ?? listRow?.status;
  const statusNote = dx.statusNote ?? listRow?.statusNote;

  const eCols: Column<ContractorEntry>[] = [
    { key: 'date', label: 'التاريخ', date: true, year: true },
    { key: 'kind', label: 'النوع', render: (e) => { const k = entryKind(e.kind); return <><Pill tone={toneOf(k.tone)}>{k.label}</Pill>{e.claimNo && <span className="cap num"> #{e.claimNo}</span>}</>; } },
    { key: 'description', label: 'الوصف', render: (e) => e.description || <span className="dash">—</span> },
    { key: 'project', label: 'المشروع', render: (e) => (
      <select className="pt-inline-sel" value={e.project ?? ''} aria-label="مشروع الحركة" data-no-dirty onClick={(ev) => ev.stopPropagation()}
        onChange={(ev) => upd.mutate({ id: e.id, project: ev.target.value })}>
        <option value="">—</option>
        {knownAll.map((p) => <option key={p} value={p}>{p}</option>)}
        {e.project && !knownAll.includes(e.project) && <option value={e.project}>{e.project}</option>}
      </select>) },
    { key: 'debit', label: 'مدين', money: true, render: (e) => e.debit ? <Money value={e.debit} /> : <span className="dash">—</span> },
    { key: 'credit', label: 'دائن', money: true, render: (e) => e.credit ? <Money value={e.credit} /> : <span className="dash">—</span> },
    { key: 'running', label: 'الرصيد', sort: false, num: true, render: (e) => { const r = running.get(e.id); return r ? <span className={r.flip ? 'pt-flip' : undefined} title={r.flip ? 'انقلب اتجاه الرصيد هنا' : undefined}><Money value={r.running} /></span> : null; } },
    { key: 'doc', label: 'المستند', render: (e) => e.doc ? <span className="num">{e.doc}</span> : <span className="dash">—</span> },
    { key: '_a', label: '', sort: false, required: true, render: (e) => e.source === 'manual' ? (
      <span className="pt-acts">
        <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={() => setEntry({ row: e })}>✎</button>
        <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={async () => {
          if (await confirm({ title: 'تأكيد الحذف', body: `هل تريد حذف هذه الحركة بتاريخ ${dateTxt(e.date, { year: true })}؟`, danger: true, confirmLabel: 'حذف' })) delEntry.mutate(e.id);
        }}>🗑</button></span>
    ) : <button type="button" className="btn sm pt-ib" disabled aria-label="حذف — غير متاح" title="حركة من كشف الحساب — تُحذف من «الملفات المرفوعة»">🗑</button> },
  ];
  const cCols: Column<ContractorClaim>[] = [
    { key: 'number', label: 'الرقم', render: (c) => <span className="num">{c.number}</span> },
    { key: 'project', label: 'المشروع' },
    { key: 'date', label: 'التاريخ', date: true, year: true },
    { key: 'grossCumulative', label: 'التراكمي', money: true, render: (c) => <><Money value={c.grossCumulative} /><span className="pt-sub">سابق <Money value={c.previousCumulative} /></span></> },
    { key: 'currentWork', label: 'أعمال الفترة', money: true, render: (c) => <Money value={claimCurrentWork(c)} /> },
    { key: 'retentionAmount', label: 'التأمين', money: true, render: (c) => <><Money value={c.retentionAmount} />{c.retentionRate != null && <span className="cap"> ({int(c.retentionRate)}٪)</span>}
      <span className="pt-sub">خصومات {c.otherDeductions ? <Money value={c.otherDeductions} /> : '—'}</span></> },
    { key: 'netDue', label: 'الصافي المستحق', money: true, render: (c) => <Money value={c.netDue} className="t-ok" /> },
    { key: '_a', label: '', sort: false, required: true, render: (c) => c.source === 'manual' ? (
      <span className="pt-acts">
        <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={() => setClaim({ row: c })}>✎</button>
        <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={async () => {
          if (await confirm({ title: 'تأكيد الحذف', body: `هل تريد حذف المستخلص رقم ${c.number} (${c.project})؟`, danger: true, confirmLabel: 'حذف' })) delClaim.mutate(c.id);
        }}>🗑</button></span>) : <span className="cap" title="من كشف الحساب">كشف</span> },
  ];

  return (
    <>
      <PageHeader title={d.name} crumb={{ label: '→ المقاولون', onClick: () => go('parties.contractors') }}
        sub={<>رمز <span className="num">{d.code}</span>
          {status0 && <> · <Pill tone={toneOf(STATUS_TONE[status0])}>{statusLabel(status0)}</Pill>{statusNote && <span className="cap"> {statusNote}</span>}</>}
          {d.phone && <> · <span className="num" dir="ltr">{d.phone}</span></>}
          {d.defaultRetentionRate != null && <> · ضمان {int(d.defaultRetentionRate)}٪</>}
          {d.defaultGuaranteeDays != null && <> · مدة الضمان {int(d.defaultGuaranteeDays)} يوماً</>}
          {d.paymentTermDays != null && <> · مدة السداد {int(d.paymentTermDays)} يوماً</>}</>}
        actions={<>
          <Button size="sm" kind="primary" onClick={() => setEntry({})}>+ حركة</Button>
          <Button size="sm" onClick={() => setClaim({})}>+ مستخلص</Button>
          <Button size="sm" onClick={() => setGt({})}>+ ضمان</Button>
          <Button size="sm" disabled={!status0} onClick={() => setStatus(true)}>تغيير الحالة</Button>
          {ai && <><Button size="sm" onClick={() => setRemind(true)}>صياغة مطالبة</Button><Button size="sm" onClick={() => setParse(true)}>قيد من نص</Button></>}
          <a className="btn sm" href={partiesApi.contractorsExportUrl('single_statement', {}, { code: d.code })} download title="تصدير كشف الحساب (Excel)">تصدير الكشف</a>
          <Button size="sm" onClick={() => setPrint(true)}>PDF الكشف</Button>
          <Button size="sm" onClick={() => setEdit(true)}>تعديل</Button>
          <Button size="sm" kind="danger" onClick={() => setDel(true)}>حذف</Button>
        </>} />
      {d.notes && <p className="cap pt-notes">{d.notes}</p>}
      <Grid>
        <Kpi span={3} i={0} size="hero" label={<>الرصيد ({v.label}) <ExplainDot metric="contractorBalance" values={{ duesTotal: d.duesTotal, paidTotal: d.paidTotal, balance: d.balance }} /></>}
          value={d.balance} tone={v.tone === 'ok' ? 'ok' : undefined} hint={<BalanceWord balance={d.balance} />} />
        <Kpi span={3} i={1} label="إجمالي المستخلصات" value={d.duesTotal} />
        <Kpi span={3} i={2} label="إجمالي المدفوع" value={d.paidTotal} tone="ok" />
        <Kpi span={3} i={3} label={<>الضمان المحتجز <ExplainDot metric="retentionHeld" values={{ retentionHeld: held }} /></>} value={held} />
        <Island span={12} i={4}>
          <div className="pt-dbt">جانب المدين = {dbt.parts.map((p, k) => <span key={p.label}>{k > 0 && ' + '}<b><Money value={p.amount} noCur /></b> {p.label}</span>)}
            {dbt.total != null && <> = <b><Money value={dbt.total} /></b></>}</div>
          <div className="pt-dbt">الرصيد = إجمالي المدين − إجمالي الدائن (المستخلصات) — لذا لا يساوي المدفوع ناقص المستخلصات بالضرورة</div>
        </Island>

        <Island span={12} i={5} title="الاستحقاق" crit={(d.delay?.overdue.amount ?? 0) > 0}
          actions={!d.delay && <Button size="sm" onClick={() => setEdit(true)}>اضبط مدة السداد</Button>}>
          <p className="cap">{d.delay ? `مدة السداد ${int(d.paymentTermDays ?? 0)} يوماً — استحقاق كل مستخلص = تاريخه + المدة، والمتبقي بعد الدفعات بالأقدم أولاً`
            : 'لا مدة سداد مضبوطة لهذا المقاول — لا يُحسب تأخر'}</p>
          {!d.delay ? <p className="disclose">اضبط «مدة السداد (يوماً)» في بطاقة المقاول ليُشتق استحقاق كل مستخلص ويظهر تأخره هنا وفي القائمة واللوحة والتقويم. بلا مدة يبقى العمود «—» عمداً — الصفر كان سيعني «لا تأخر عليه» وهو ما لا تدعمه البيانات.</p> : (<>
            <Grid>
              <div data-testid="contractor-overdue" style={{ display: 'contents' }}><Kpi span={3} label="متأخر" value={d.delay.overdue.amount} tone={d.delay.overdue.amount > 0 ? 'danger' : undefined} /></div>
              <Kpi span={3} label="خلال ٧ أيام" value={d.delay.dueSoon.within7} tone="warn" />
              <Kpi span={3} label="خلال ٣٠ يوماً" value={d.delay.dueSoon.within30} />
              <Kpi span={3} label="أقدم تأخر (يوم)" money={false} value={d.delay.overdue.maxDays > 0 ? d.delay.overdue.maxDays : null} tone={d.delay.overdue.maxDays > 0 ? 'danger' : undefined} />
            </Grid>
            {d.delay.overdue.amount > 0 && <div className="pt-aging">{CLAIM_BUCKETS.map(([k, l]) => (
              <div key={k} className="pt-ag"><b>{l}</b>{(d.delay!.byBucket[k] ?? 0) > 0 ? <Money value={d.delay!.byBucket[k]} className="t-danger" /> : <span className="dash">—</span>}</div>))}</div>}
            {d.delay.claims.length === 0 ? <p className="disclose">لا مستخلصات في دفتر هذا المقاول بعد.</p> : (
              <div className="tbl-wrap"><table>
                <thead><tr><th>المستخلص</th><th>المشروع</th><th>التاريخ</th><th>الاستحقاق</th><th className="n">المبلغ</th><th className="n">المسدَّد</th><th className="n">المتبقي</th><th>التأخر</th></tr></thead>
                <tbody>{d.delay.claims.map((c) => (
                  <tr key={c.entryId ?? c.date + c.doc}>
                    <td>{c.claimNo ? `مستخلص رقم ${c.claimNo}` : (c.description || '—')}</td><td className="cap">{c.project || '—'}</td>
                    <td>{dateTxt(c.date, { year: true })}</td><td>{dateTxt(c.dueDate, { year: true })}</td>
                    <td className="n"><Money value={c.amount} /></td>
                    <td className="n">{c.paid > 0 ? <Money value={c.paid} className="t-ok" /> : <span className="dash">—</span>}</td>
                    <td className="n">{c.remaining > 0 ? <Money value={c.remaining} className={c.daysLate > 0 ? 't-danger' : undefined} /> : <span className="cap">مسدَّد</span>}</td>
                    <td>{c.daysLate > 0 ? <Pill tone="danger">متأخر {int(c.daysLate)} يوماً</Pill> : c.remaining > 0 ? <Pill tone="warn">لم يحن</Pill> : <Pill tone="ok">مسدَّد</Pill>}</td>
                  </tr>))}</tbody></table></div>)}
          </>)}
        </Island>

        {d.perProject.length > 0 && (
          <Island span={12} i={6} title="الرصيد حسب المشروع">
            <div className="pt-pcards">{d.perProject.map((p) => { const pv = balanceView(p.balance); const on = proj === p.project; return (
              <button key={p.project || '_'} type="button" className="pt-pcard" aria-pressed={on} title={on ? 'إلغاء التصفية' : 'تصفية الدفتر والمستخلصات على هذا المشروع'}
                onClick={() => setE({ project: on ? '' : p.project })}>
                <b>{p.project || 'بلا مشروع'}</b>
                <span><Money value={p.balance} className={pv.tone === 'ok' ? 't-ok' : undefined} /> <span className="cap">{pv.label}</span></span>
                <span className="cap">{int(p.entryCount)} حركة</span>
              </button>); })}</div>
          </Island>)}
        <PartyProjectsCard kind="contractor" id={d.code} known={knownAll} fallbackProjects={d.projects ?? projects} i={7} />

        <Island span={12} i={8} title={proj ? `الدفتر — ${proj}` : 'دفتر الحساب'}
          actions={<>{entryColumnFiltering(ef) && <Button size="sm" onClick={() => setEf({ ...EMPTY_ENTRY_FILTERS, project: proj })}>مسح تصفية الأعمدة</Button>}
            {proj && <Button size="sm" onClick={() => setE({ project: '' })}>إظهار الكل</Button>}</>}>
          <p className="cap">مدين = دفعنا له أو خُصم منه · دائن = استحق له · الرصيد الجاري: سالب = نحن ندين لهم
            {(entryColumnFiltering(ef) || proj) && <> · عرض {int(entries.length)} من {int(d.entries.length)}</>}</p>
          <div className="pt-xfil">
            <FDates label="التاريخ" from={ef.dateFrom} to={ef.dateTo} onFrom={(x) => setE({ dateFrom: x })} onTo={(x) => setE({ dateTo: x })} />
            <FSelect label="النوع" value={ef.kind} onChange={(x) => setE({ kind: x })} allLabel="كل الأنواع" options={Object.entries(ENTRY_KIND).map(([k, m]) => ({ value: k, label: m.label }))} />
            <FText label="الوصف" value={ef.desc} onChange={(x) => setE({ desc: x })} />
            <FSelect label="المشروع" value={ef.project} onChange={(x) => setE({ project: x })} allLabel="كل المشاريع" options={projects.map((p) => ({ value: p, label: p }))} />
            <FRange label="مدين" min={ef.debitMin} max={ef.debitMax} onMin={(x) => setE({ debitMin: x })} onMax={(x) => setE({ debitMax: x })} />
            <FRange label="دائن" min={ef.creditMin} max={ef.creditMax} onMin={(x) => setE({ creditMin: x })} onMax={(x) => setE({ creditMax: x })} />
          </div>
          <div className="pt-kinds">{['', ...Object.keys(ENTRY_KIND)].filter((k) => !k || d.entries.some((e) => e.kind === k)).map((k) => (
            <Chip key={k || 'all'} pressed={ef.kind === k} onClick={() => setE({ kind: k })}>{k ? ENTRY_KIND[k].label : 'الكل'}</Chip>))}</div>
          <DataTable<ContractorEntry> id="parties.contractor.ledger" mode="server" rows={entries} rowKey={(e) => e.id} columns={eCols}
            search={false} onQueryChange={(t) => setESort(t.sort)}
            empty={proj || entryColumnFiltering(ef)
              ? { title: 'لا حركات مطابقة', body: 'لم تطابق التصفية أي حركة.', cta: 'مسح التصفية', onCta: () => setEf(EMPTY_ENTRY_FILTERS) }
              : { title: 'لا توجد حركات بعد', body: 'أضف حركة يدوية أو ارفع كشف حساب المقاول.', cta: 'إضافة حركة', onCta: () => setEntry({}) }} />
        </Island>

        <Island span={12} i={9} title={`المستخلصات · ${int(d.claims.length)} مستخلصاً`}
          actions={<>{claimColumnFiltering(cf) && <Button size="sm" onClick={() => setCf(EMPTY_CLAIM_FILTERS)}>مسح تصفية الأعمدة</Button>}
            <Button size="sm" onClick={() => setClaim({})}>إضافة مستخلص</Button></>}>
          <p className="cap">مستخلصات كشف الحساب تظهر في الدفتر أعلاه — هذا سجل وثائق المستخلصات التفصيلية (اختياري)
            {(proj || claimColumnFiltering(cf)) && <> · عرض {int(claims.length)} من {int(d.claims.length)}</>}</p>
          {d.claims.length > 0 && <div className="pt-xfil">
            <FText label="رقم المستخلص" value={cf.number} onChange={(x) => setC({ number: x })} />
            <FDates label="التاريخ" from={cf.dateFrom} to={cf.dateTo} onFrom={(x) => setC({ dateFrom: x })} onTo={(x) => setC({ dateTo: x })} />
            <FRange label="الصافي" min={cf.netMin} max={cf.netMax} onMin={(x) => setC({ netMin: x })} onMax={(x) => setC({ netMax: x })} />
          </div>}
          {d.claims.length === 0 ? <EmptyState icon="file" title="لا مستخلصات بعد" body="سجّل المستخلصات هنا لمتابعة الأعمال التراكمية والتأمينات." cta="إضافة مستخلص" onCta={() => setClaim({})} />
            : <DataTable<ContractorClaim> id="parties.contractor.claims" mode="server" rows={claims} rowKey={(c) => c.id} columns={cCols}
                search={false} onQueryChange={(t) => setCSort(t.sort)}
                empty={{ title: 'لا مستخلصات مطابقة', body: 'لم تطابق التصفية أي مستخلص.', cta: 'مسح التصفية', onCta: () => { setCf(EMPTY_CLAIM_FILTERS); setE({ project: '' }); } }} />}
        </Island>

        <Island span={12} i={10} title="الضمانات" actions={<Button size="sm" onClick={() => setGt({})}>إضافة ضمان</Button>}>
          <p className="cap">تأمين الأعمال — يُصرف بعد انتهاء مدة الضمان من تاريخ إنهاء الأعمال</p>
          {d.guarantees.length === 0 ? <EmptyState icon="file" title="لا ضمانات مسجّلة" body="سجّل الضمانات المحتجزة لكل مشروع لمتابعة مواعيد صرفها." cta="إضافة ضمان" onCta={() => setGt({})} />
            : <div className="pt-gcards">{d.guarantees.map((g) => { const st = GUARANTEE_DUE[g.dueStatus] ?? { label: g.dueStatus, tone: '' }; return (
              <div key={g.id} className="pt-gcard">
                <div className="pt-gh2"><b>{g.project}</b><Pill tone={toneOf(st.tone)}>{st.label}</Pill></div>
                <div className="kpi pt-ks">{g.amount != null ? <Money value={g.amount} /> : '—'}{g.retentionRate != null && <span className="cap"> ({int(g.retentionRate)}٪)</span>}</div>
                <div className="cap">إنهاء الأعمال: {g.finishedOn ? dateTxt(g.finishedOn, { year: true }) : '—'}<br />
                  مدة الضمان: {g.guaranteeDays != null ? `${int(g.guaranteeDays)} يوماً` : '—'}<br />
                  استحقاق الصرف: {g.releaseDue ? <b className={g.dueStatus === 'due' ? 't-danger' : g.dueStatus === 'upcoming' ? 't-warn' : undefined}>{dateTxt(g.releaseDue, { year: true })}</b> : '—'}
                  {g.releasedOn && <><br />تاريخ الصرف: {dateTxt(g.releasedOn, { year: true })}</>}
                  {g.notes && <><br />{g.notes}</>}</div>
                <span className="pt-acts">
                  <button type="button" className="btn sm pt-ib" aria-label="تعديل" title="تعديل" onClick={() => setGt({ row: g })}>✎</button>
                  <button type="button" className="btn sm pt-ib" aria-label="حذف" title="حذف" onClick={async () => {
                    if (await confirm({ title: 'تأكيد الحذف', body: `هل تريد حذف ضمان مشروع «${g.project}»؟`, danger: true, confirmLabel: 'حذف' })) delGt.mutate(g.id);
                  }}>🗑</button></span>
              </div>); })}</div>}
        </Island>
      </Grid>

      <EntryModal code={d.code} balance={d.balance} projects={knownAll} state={entry} onClose={() => setEntry(null)} />
      <ClaimModal code={d.code} projects={knownAll} defaultRate={d.defaultRetentionRate} state={claim} onClose={() => setClaim(null)} />
      <GuaranteeModal code={d.code} projects={knownAll} state={gt} onClose={() => setGt(null)} />
      <StatusModal open={status} code={d.code} status={status0 ?? 'active'} note={statusNote ?? ''} onClose={() => setStatus(false)} />
      <RemindModal open={remind} kind="contractor" partyKey={d.code} onClose={() => setRemind(false)} />
      <ParseTextModal open={parse} onClose={() => setParse(false)}
        onProposal={(p) => { setParse(false); setEntry({ draft: { date: p.date, debit: p.debit, credit: p.credit, description: p.description } }); }} />
      <ContractorFormModal open={edit} known={knownAll} onClose={() => setEdit(false)}
        row={{ ...d, status: status0, statusNote, projects: d.projects }} />
      <DeletePartyModal open={del} kind="contractor" name={d.name} keyValue={d.code} onClose={() => setDel(false)} onDeleted={() => go('parties.contractors')} />
    </>
  );
}

/** نموذج الحركة (P-155) + معاينة الرصيد + اختيار النوع يضبط الجانب. */
function EntryModal({ code, balance, projects, state, onClose }: { code: string; balance: number; projects: string[];
  state: { row?: ContractorEntry; draft?: Partial<ContractorEntryBody> } | null; onClose: () => void }) {
  usePrefs();
  const r = state?.row;
  const init = useMemo(() => {
    const v = entryFormInitial(r ?? state?.draft, !!r);
    return { ...v, date: v.date || (r ? '' : new Date().toISOString().slice(0, 10)) };
  }, [state, r]);
  const form = useForm<EntryFormValues & Record<string, unknown>>(init as EntryFormValues & Record<string, unknown>);
  useEffect(() => { if (state) form.reset(init as EntryFormValues & Record<string, unknown>); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, init]);
  const [err, setErr] = useState<string | null>(null);
  const save = useApiMutation((b: ContractorEntryBody) => (r ? partiesApi.updateEntry(code, r.id, b) : partiesApi.createEntry(code, b)), { invalidate: CONTRACTOR_ROOTS, errorToast: false });
  const v = form.values as EntryFormValues;
  const pv = entryPreview(balance, v, r);
  return (
    <PModal open={!!state} onClose={onClose} title={r ? 'تعديل حركة' : 'إضافة حركة'} dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        setErr(null);
        if (!v.date) { form.setError('date', 'التاريخ مطلوب'); return; }
        if (!(Number(v.amount) >= 0) || v.amount == null) { form.setError('amount', 'أدخل المبلغ'); return; }
        if (!v.description.trim()) { form.setError('description', 'الوصف مطلوب'); return; }
        try { await save.mutateAsync(entryBody(v)); close(true); toast(r ? 'حُفظ التعديل' : 'أُضيفت الحركة', { kind: 'ok' }); } catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      {state?.draft && <p className="pt-note">اقتراح من النص — راجعه وعدّله قبل الحفظ.</p>}
      <FormGrid>
        <Field form={form} name="date" label="التاريخ" type="date" required />
        <Field form={form} name="kind" label="التصنيف" type="select" required options={Object.entries(ENTRY_KIND).map(([k, m]) => ({ value: k, label: m.label }))} />
        <Field form={form} name="side" label="نوع الحركة" type="select" required options={[{ value: 'debit', label: 'مدين (دفعة/خصم) — ينقص ما ندين به' }, { value: 'credit', label: 'دائن (مستخلص) — يزيد ما ندين به' }]} />
        <Field form={form} name="amount" label="المبلغ" type="money" required min={0} />
        <Field form={form} name="description" label="الوصف" required full />
      </FormGrid>
      <ProjectField value={v.project} onChange={(x) => form.set('project', x)} projects={projects} />
      {!r && <p className="cap">اختيار التصنيف يقترح الجانب: <Button size="sm" onClick={() => form.set('side', KIND_SIDE[v.kind] ?? 'debit')}>طبّق جانب «{entryKind(v.kind).label}»</Button></p>}
      <div className="pt-preview" aria-live="polite"><div className="cap">{pv ? 'الرصيد بعد الحركة' : 'الرصيد الحالي'}</div>
        <div className="pt-pvn"><Money value={balance} />{pv && <> ← <b><Money value={pv.after} /></b></>} <BalanceWord balance={pv ? pv.after : balance} /></div></div>
    </PModal>
  );
}

/** نموذج المستخلص بحساب حيّ (P-159). */
function ClaimModal({ code, projects, defaultRate, state, onClose }: { code: string; projects: string[]; defaultRate: number | null; state: { row?: ContractorClaim } | null; onClose: () => void }) {
  usePrefs();
  const r = state?.row;
  const init = useMemo(() => claimFormInitial(r, defaultRate), [r, defaultRate]);
  const form = useForm<ClaimFormValues & Record<string, unknown>>(init as ClaimFormValues & Record<string, unknown>);
  useEffect(() => { if (state) form.reset(init as ClaimFormValues & Record<string, unknown>); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, init]);
  const [err, setErr] = useState<string | null>(null);
  const save = useApiMutation(() => { const b = claimBody(form.values as ClaimFormValues); return r ? partiesApi.updateClaim(code, r.id, b) : partiesApi.createClaim(code, b); },
    { invalidate: CONTRACTOR_ROOTS, errorToast: false });
  const v = form.values as ClaimFormValues;
  const m = claimMath(v);
  return (
    <PModal open={!!state} onClose={onClose} title={r ? 'تعديل مستخلص' : 'إضافة مستخلص'} size="lg" dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending || !v.project.trim() || !v.number.trim(), onClick: async (close) => {
        setErr(null);
        if (!v.date) { form.setError('date', 'التاريخ مطلوب'); return; }
        if (v.gross == null) { form.setError('gross', 'هذا الحقل مطلوب'); return; }
        try { await save.mutateAsync(undefined); close(true); toast('حُفظ المستخلص', { kind: 'ok' }); } catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <ProjectField value={v.project} onChange={(x) => form.set('project', x)} projects={projects} label="المشروع *" />
      <FormGrid>
        <Field form={form} name="number" label="رقم المستخلص" required />
        <Field form={form} name="date" label="التاريخ" type="date" required />
        <Field form={form} name="gross" label="إجمالي الأعمال التراكمي" type="money" required min={0} />
        <Field form={form} name="previous" label="التراكمي السابق" type="money" min={0} />
        <Field form={form} name="rate" label="نسبة التأمين ٪" type="number" min={0} max={100} step={0.1} />
      </FormGrid>
      <div className="pt-note">أعمال الفترة: <b><Money value={m.currentWork} /></b>{v.rate != null && v.rate !== '' && !v.retentionTouched && <> · تأمين مقترح ({int(Number(v.rate))}٪): <b><Money value={m.suggestedRetention} /></b></>}</div>
      <div className="pt-xfil">
        <label><span>مبلغ التأمين</span><input inputMode="decimal" dir="ltr" value={v.retentionTouched ? String(v.retention ?? '') : String(m.suggestedRetention)}
          onChange={(e) => form.setValues({ retentionTouched: true, retention: e.target.value } as Partial<ClaimFormValues & Record<string, unknown>>)} /></label>
        <label><span>خصومات أخرى</span><input inputMode="decimal" dir="ltr" value={String(v.deductions ?? '')} onChange={(e) => form.set('deductions', e.target.value)} /></label>
        <label><span>الصافي المستحق</span><input inputMode="decimal" dir="ltr" value={v.netTouched ? String(v.netDue ?? '') : String(m.suggestedNet)}
          onChange={(e) => form.setValues({ netTouched: true, netDue: e.target.value } as Partial<ClaimFormValues & Record<string, unknown>>)} /></label>
      </div>
      <FormGrid><Field form={form} name="description" label="الوصف" full /></FormGrid>
    </PModal>
  );
}

/** نموذج الضمان (P-162). */
function GuaranteeModal({ code, projects, state, onClose }: { code: string; projects: string[]; state: { row?: ContractorGuarantee } | null; onClose: () => void }) {
  const r = state?.row;
  const init = useMemo(() => guaranteeFormInitial(r), [r]);
  const form = useForm<GuaranteeFormValues & Record<string, unknown>>(init as GuaranteeFormValues & Record<string, unknown>);
  useEffect(() => { if (state) form.reset(init as GuaranteeFormValues & Record<string, unknown>); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, init]);
  const [err, setErr] = useState<string | null>(null);
  const v = form.values as GuaranteeFormValues;
  const save = useApiMutation(() => { const b = guaranteeBody(v); return r ? partiesApi.updateGuarantee(code, r.id, b) : partiesApi.createGuarantee(code, b); },
    { invalidate: CONTRACTOR_ROOTS, errorToast: false });
  return (
    <PModal open={!!state} onClose={onClose} title={r ? 'تعديل ضمان' : 'إضافة ضمان'} dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending || !v.project.trim(), onClick: async (close) => {
        setErr(null);
        try { await save.mutateAsync(undefined); close(true); toast('حُفظ الضمان', { kind: 'ok' }); } catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <ProjectField value={v.project} onChange={(x) => form.set('project', x)} projects={projects} label="المشروع *" />
      <FormGrid>
        <Field form={form} name="amount" label="المبلغ" type="money" min={0} />
        <Field form={form} name="rate" label="نسبة التأمين ٪" type="number" min={0} max={100} step={0.1} />
        <Field form={form} name="finishedOn" label="تاريخ إنهاء الأعمال" type="date" />
        <Field form={form} name="days" label="مدة الضمان (يوم)" type="number" min={0} />
        <Field form={form} name="releaseDue" label="تاريخ استحقاق الصرف" type="date" />
        <Field form={form} name="releasedOn" label="تاريخ الصرف الفعلي" type="date" />
        <Field form={form} name="notes" label="ملاحظات" full />
      </FormGrid>
    </PModal>
  );
}

/** تغيير الحالة سريعاً (فجوة v0.13: الحالة لم تكن قابلة للتعديل) — مع تراجع. */
function StatusModal({ open, code, status, note, onClose }: { open: boolean; code: string; status: ContractorStatus; note: string; onClose: () => void }) {
  const [s, setS] = useState<ContractorStatus>(status);
  const [n, setN] = useState(note);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setS(status); setN(note); setErr(null); } }, [open, status, note]);
  const save = useApiMutation((b: { status: ContractorStatus; statusNote: string }) => partiesApi.updateContractor(code, b), { invalidate: CONTRACTOR_ROOTS, errorToast: false });
  return (
    <PModal open={open} onClose={onClose} title="تغيير حالة المقاول" size="sm"
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        if (STATUS_NEEDS_NOTE.includes(s) && !n.trim()) { setErr('اكتب سبب الحالة'); return; }
        try {
          await save.mutateAsync({ status: s, statusNote: n.trim() }); close(true);
          toast(`صارت الحالة «${statusLabel(s)}»`, { kind: 'ok', undo: () => { void partiesApi.updateContractor(code, { status, statusNote: note }).then(() => save.reset()); } });
        } catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <div className="pt-xfil">
        <label><span>الحالة</span><select value={s} onChange={(e) => setS(e.target.value as ContractorStatus)}>
          {CONTRACTOR_STATUSES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
        <label><span>السبب / الملاحظة</span><input value={n} onChange={(e) => setN(e.target.value)} /></label>
      </div>
    </PModal>
  );
}

/** «قيد من نص» (P-140): المقترح يملأ نموذج الحركة فقط — لا حفظ مباشر. */
function ParseTextModal({ open, onClose, onProposal }: { open: boolean; onClose: () => void;
  onProposal: (p: { date?: string; debit?: number; credit?: number; description?: string }) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) { setText(''); setErr(null); } }, [open]);
  return (
    <PModal open={open} onClose={onClose} title="قيد من نص"
      actions={[{ label: 'إلغاء' }, { label: busy ? 'جارٍ التحليل…' : 'تحليل واقتراح', kind: 'primary', disabled: busy || !text.trim(), onClick: async (close) => {
        setBusy(true); setErr(null);
        try { const r = await partiesApi.aiParseText(text.trim()); close(true); onProposal(r.proposal ?? {}); }
        catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
      } }]}>
      <ErrBox msg={err} />
      <textarea className="pt-remind" rows={8} value={text} disabled={busy} placeholder="الصق رسالة واتساب أو بريد…" onChange={(e) => setText(e.target.value)} />
    </PModal>
  );
}
