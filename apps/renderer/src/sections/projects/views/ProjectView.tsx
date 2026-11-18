/* تفاصيل مشروع — يحل محل pages/ProjectDetail.tsx (P-176..P-181) + م-٥٠. */
import { useParams } from 'react-router-dom';
import { Button, DataTable, Grid, Island, Kpi, Money, PageHeader, Skeleton, dateTxt, int, usePrefs, compact } from '@/ui';
import { ExplainDot } from '@/components/Explain';
import { useProject, useProjectParties } from '../hooks';
import { verdictOf } from '../logic/verdict';
import { num } from '../logic/money';
import { paths, useNav } from '../nav';
import { ErrorBox, Pct, VerdictPill } from '../components/bits';
import { VerdictPanel } from '../components/VerdictPanel';
import { PartiesPanel } from '../components/PartiesPanel';
import type { ProjectContractorDetailRow, ProjectParty, ProjectSupplierRow } from '../types';

/** اصطلاح الإشارة (CLAUDE.md §٢): سالب = نحن ندين لهم · موجب = يدينون لنا. لا أحمر هنا — الأحمر للمتأخر زمنياً فقط.
    (الصفحة القديمة كانت تلوّن السالب أحمر بعبارة «لنا عليه» — عكس الاصطلاح؛ صُحّح ولم يُنقل.) */
function ConBalance({ b }: { b: number | undefined }) {
  if (!b) return <span className="dash">—</span>;
  return <><Money value={Math.abs(b)} /> <small className="sp-word">{b < 0 ? 'نحن ندين له' : 'يدين لنا'}</small></>;
}

export default function ProjectView() {
  usePrefs();
  const { project = '' } = useParams();
  const go = useNav();
  const q = useProject(project);
  const pq = useProjectParties(project);  // احتياط إن لم يُضمِّن الخادم parties في التفاصيل
  const d = q.data;

  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!d) return <Skeleton rows={6} />;

  const pid = d.id ?? project;
  const parties: ProjectParty[] | undefined = d.parties ?? pq.data;
  const v = verdictOf(d);
  const suppliers = d.suppliers ?? [];
  const contractors = d.contractors ?? [];
  const schedule = (d.schedule ?? []).slice(0, 8);
  const maxBar = Math.max(1, ...schedule.map((x) => x.amount || 0));

  return (
    <>
      <PageHeader crumb={{ label: '‹ المشاريع', onClick: () => go(paths.list) }}
        title={<>{d.project} <VerdictPill v={v} /></>}
        sub={<>{int(d.supplierCount ?? suppliers.length)} مورداً · {int(contractors.length)} مقاولاً · {int((parties ?? []).filter((p) => p.linked).length)} طرفاً مُسنداً</>}
        actions={<>
          <Button onClick={() => go(paths.budget(d.project))}>الموازنة</Button>
          <Button onClick={() => go(paths.admin(d.project))}>دمج في مشروع آخر</Button>
        </>} />
      <Grid>
        <VerdictPanel i={0} v={v} projectId={pid} supplierCost={num(d.supplierCost)} contractorCost={num(d.contractorCost)} />

        <Kpi i={1} label={<>المديونية المفتوحة <ExplainDot metric="projectDetailOutstanding" values={{ projectOutstanding: d.outstanding }} /></>} value={d.outstanding ?? null} span={4} />
        <Kpi i={2} label={<>المتأخر <ExplainDot metric="overdue" values={{ overdue: d.overdue }} /></>} value={d.overdue ?? null} span={4}
          tone={(d.overdue ?? 0) > 0 ? 'danger' : undefined} crit={(d.overdue ?? 0) > 0} />
        <Kpi i={3} label="إجمالي الالتزام" value={d.totalCommitment ?? null} span={4} size="hero" />
        <Kpi i={4} label="مستحق للمقاولين (نحن ندين)" value={d.contractorsOwed ?? null} span={4} />
        <Kpi i={5} label="مستحق لنا من المقاولين" value={d.contractorsOwedToUs ?? null} span={4} tone="ok" />
        <Island i={6} span={4} title="تأخر الموازنة">
          <div className="kpi sp-kpi">{d.budgetDelayPct == null ? <span className="dash">لا موازنة</span>
            : <Pct value={Math.abs(d.budgetDelayPct)} className={d.budgetDelayPct > 0 ? 't-warn' : 't-ok'} />}</div>
          {d.budgetDelayPct != null && <span className="cap">{d.budgetDelayPct > 0 ? 'متأخر عن المخطط' : 'متقدّم/مطابق'}</span>}
        </Island>
        {d.mergedSpellingAlert && (
          <p className="c12 disclose">دُمجت مديونية المقاولين من صيغ الاسم: {(d.contractorProjectNames ?? []).join('، ')} —
            يتجاهل مُطبِّع المطابقة أداة التعريف والمسافات فقط، لا يُعيد تسمية أي بيانات.</p>
        )}

        <PartiesPanel project={pid} i={7} parties={parties} assignedTotal={d.assignedTotal}
          error={d.parties ? null : pq.error} loading={!parties && pq.isLoading} onRetry={() => { void q.refetch(); void pq.refetch(); }} />

        <Island i={8} span={6} title="الموردون">
          <DataTable<ProjectSupplierRow> id="projects.project.suppliers" rows={suppliers} rowKey="account"
            onRowClick={(r) => go(paths.supplier(r.account))}
            columns={[
              { key: 'name', label: 'المورد', render: (r) => <b>{r.name}</b>, searchValue: (r) => `${r.name} ${r.account}` },
              { key: 'account', label: 'الحساب', render: (r) => <span className="num">{r.account}</span> },
              { key: 'term', label: 'المدة', render: (r) => r.termKind === 'days' && r.termDays != null ? `${int(r.termDays)} يوم` : (r.termKind !== 'days' && r.term ? r.term : '—') },
              { key: 'outstanding', label: 'مفتوح', money: true },
              { key: 'overdue', label: 'متأخر', money: true,
                render: (r) => r.overdue ? <Money value={r.overdue} className="t-danger" /> : <span className="dash">—</span> },
            ]}
            sort={{ key: 'outstanding', dir: 'desc' }}
            total={{ keys: ['outstanding', 'overdue'], label: 'الإجمالي' }}
            empty={{ icon: 'users', title: 'لا يوجد موردون بهذا المشروع' }} />
        </Island>
        <Island i={9} span={6} title="المقاولون">
          <DataTable<ProjectContractorDetailRow> id="projects.project.contractors" rows={contractors} rowKey="code"
            onRowClick={(r) => go(paths.contractor(r.code))}
            columns={[
              { key: 'name', label: 'المقاول', render: (r) => <b>{r.name}</b>, searchValue: (r) => `${r.name} ${r.code}` },
              { key: 'code', label: 'الكود', render: (r) => <span className="num">{r.code}</span> },
              { key: 'balance', label: 'الرصيد على المشروع', num: true, render: (r) => <ConBalance b={r.balance} /> },
            ]}
            sort={{ key: 'name', dir: 'asc' }}
            empty={{ icon: 'users', title: 'لا مقاولين لهذا المشروع' }} />
        </Island>

        <Island i={10} span={12} title="الاستحقاقات القادمة — ٩٠ يوماً">
          {schedule.length === 0 ? <p className="empty-note">لا توجد استحقاقات قادمة.</p> : (
            <div className="sp-bars" role="img" aria-label="الاستحقاقات القادمة">
              {schedule.map((b) => (
                <div className="sp-bcol" key={b.date}>
                  <span className="num cap">{b.amount == null ? "—" : compact(b.amount)}</span>
                  <i className="sp-bar" style={{ '--h': Math.max(0.05, (b.amount || 0) / maxBar) } as React.CSSProperties} />
                  <span className="cap">{dateTxt(b.date)}</span>
                  <span className="cap">{b.count == null ? "—" : `${int(b.count)} فاتورة`}</span>
                </div>
              ))}
            </div>
          )}
        </Island>
      </Grid>
    </>
  );
}
