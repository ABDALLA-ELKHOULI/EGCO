/* قائمة المشاريع — يحل محل pages/Projects.tsx (P-170..P-175) + حكم يكسب/يخسر من النموذج. */
import { useMemo, useState } from 'react';
import { Button, DataTable, Grid, Island, Kpi, Money, PageHeader, Seg, Skeleton, int, uiPref, setUiPref, usePrefs } from '@/ui';
import { ExplainDot } from '@/components/Explain';
import { useProjects } from '../hooks';
import { verdictOf, riskRank, type Verdict } from '../logic/verdict';
import { paths, useNav } from '../nav';
import { ErrorBox, Pct, VerdictPill } from '../components/bits';
import type { ProjectListRow } from '../types';

type Row = ProjectListRow & { v: Verdict; risk: number };
type Mode = 'table' | 'cards';

export default function ProjectsView() {
  usePrefs();
  const go = useNav();
  const q = useProjects();
  const [mode, setModeState] = useState<Mode>(() => (uiPref('projects.mode', 'table') as Mode));
  const setMode = (m: Mode) => { setModeState(m); setUiPref('projects.mode', m); };

  const rows: Row[] = useMemo(() => (q.data?.rows ?? []).map((r) => {
    const v = verdictOf(r);
    return { ...r, v, risk: riskRank(v) };
  }), [q.data]);

  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={8} />;

  const t = q.data.totals ?? {};
  const withValue = rows.filter((r) => r.v.kind !== 'unknown');
  const losing = withValue.filter((r) => r.v.kind === 'loss');
  const noValue = rows.filter((r) => r.contractValue == null);
  const hasM50 = rows.some((r) => r.executed !== undefined);
  const maxOut = Math.max(1, ...rows.map((r) => r.outstanding || 0));

  return (
    <>
      <PageHeader title="المشاريع" sub="مديونية كل مشروع ومتأخراته — وأيها يكسب أو يخسر حين تُعرف قيمة العقد"
        actions={<Seg label="طريقة العرض" value={mode} onChange={setMode}
          options={[{ value: 'table', label: 'جدول' }, { value: 'cards', label: 'بطاقات' }]} />} />
      <Grid>
        <Kpi i={0} label="مشاريع تخسر" money={false} value={losing.length} span={3}
          tone={losing.length ? 'warn' : 'ok'} hint={`من ${int(withValue.length)} لها قيمة عقد ومنفّذ معروف`} />
        <div data-testid="kpi-outstanding" className="sp-contents">
        <Kpi i={1} label={<>مديونية الموردين المفتوحة <ExplainDot metric="projectsTotals" values={{ projectsOutstanding: t.outstanding }} /></>}
          value={t.outstanding ?? null} span={3} />
        </div>
        <Kpi i={2} label={<>المتأخر <ExplainDot metric="overdue" values={{ overdue: t.overdue }} /></>} value={t.overdue ?? null} span={3}
          tone={(t.overdue ?? 0) > 0 ? 'danger' : undefined} crit={(t.overdue ?? 0) > 0} />
        <Kpi i={3} label="إجمالي الالتزام (موردون + مقاولون)" value={t.totalCommitment ?? null} span={3} size="hero" />
        <Kpi i={4} label="مستحق للمقاولين (نحن ندين)" value={t.contractorsOwed ?? null} span={6} />
        <Kpi i={5} label="مستحق لنا من المقاولين" value={t.contractorsOwedToUs ?? null} span={6} tone="ok" />
        <p className="c12 disclose">«مستحق للمقاولين» و«مستحق لنا» هما نفس أرقام شاشة المقاولين بالضبط، و«تأخر الموازنة» من شاشة
          الموازنة (آخر شهر مُدخَل إن وُجد) — لا حساب جديد هنا. الأحمر للمتأخر عن موعده فقط. الحكم «يكسب/يخسر» = قيمة العقد −
          المنفّذ المسجّل؛ لا نحسبه لمشروع بلا قيمة عقد.</p>
        {hasM50 && noValue.length > 0 && rows.length > 0 && (
          <Island i={6} span={12} className="sp-callout">
            <div className="sp-callout-row"><div>
              <b>{int(noValue.length)} {noValue.length === 1 ? 'مشروع بلا' : 'مشاريع بلا'} قيمة عقد</b>
              <div className="cap">{noValue.slice(0, 8).map((r) => r.project).join('، ')}{noValue.length > 8 ? '…' : ''} — لا يمكن معرفة إن كانت تكسب أو تخسر. أدخل القيمة من صفحة المشروع.</div>
            </div></div>
          </Island>
        )}

        <div className="c12">
          {rows.length === 0 ? (
            <Island><p className="empty-note">لا توجد مشاريع بعد.</p></Island>
          ) : mode === 'table' ? (
            <Island i={7}>
              <DataTable<Row> id="projects.list" rows={rows} rowKey="project"
                onRowClick={(r) => go(paths.project(r.id ?? r.project))}
                sort={{ key: 'risk', dir: 'desc' }}
                filters={[{ key: 'verdict', label: 'الحكم', options: [
                  { value: 'loss', label: 'يخسر', test: (r) => r.v.kind === 'loss' },
                  { value: 'watch', label: 'هامش ضيق', test: (r) => r.v.kind === 'watch' },
                  { value: 'unknown', label: 'بلا حكم', test: (r) => r.v.kind === 'unknown' },
                  { value: 'late', label: 'له متأخر', test: (r) => (r.overdue ?? 0) > 0 },
                ] }]}
                columns={[
                  { key: 'project', label: 'المشروع', required: true, render: (r) => (<>
                    <b>{r.project}</b>
                    {r.mergedSpellingAlert && <div className="cap">يضم صيغ الاسم: {(r.contractorProjectNames ?? []).join('، ')}</div>}</>) },
                  { key: 'verdict', label: 'الحكم', sort: false, render: (r) => <VerdictPill v={r.v} /> },
                  { key: 'risk', label: 'الخطر', hidden: true, num: true, render: (r) => int(r.risk > 0 ? 1 : 0) },
                  { key: 'cv', label: 'قيمة العقد', money: true, hidden: !hasM50, value: (r) => r.v.contractValue },
                  { key: 'assigned', label: 'المُسند', money: true, hidden: !hasM50, value: (r) => r.v.assigned },
                  { key: 'executedN', label: 'المنفّذ', money: true, hidden: !hasM50, value: (r) => r.v.executed },
                  { key: 'marginN', label: 'الهامش', money: true, hidden: !hasM50, value: (r) => r.v.margin,
                    render: (r) => r.v.margin == null ? <span className="dash">—</span> : <Money value={r.v.margin} className={r.v.margin < 0 ? 't-warn' : undefined} /> },
                  { key: 'supplierCount', label: 'الموردون', num: true, render: (r) => (<>{r.supplierCount == null ? <span className="dash">—</span> : int(r.supplierCount)}
                    {r.suppliersWithData != null && <div className="cap">{int(r.suppliersWithData)} منهم لديهم كشوفات</div>}</>) },
                  { key: 'outstanding', label: 'المديونية المفتوحة', money: true,
                    render: (r) => r.outstanding ? <Money value={r.outstanding} /> : <span className="dash">—</span> },
                  { key: 'overdue', label: 'المتأخر', money: true,
                    render: (r) => r.overdue ? <Money value={r.overdue} className="t-danger" /> : <span className="dash">—</span> },
                  { key: 'contractorsOwed', label: 'مستحق للمقاولين', money: true },
                  { key: 'contractorsOwedToUs', label: 'مستحق لنا منهم', money: true,
                    render: (r) => r.contractorsOwedToUs ? <Money value={r.contractorsOwedToUs} className="t-ok" /> : <span className="dash">—</span> },
                  { key: 'totalCommitment', label: 'إجمالي الالتزام', money: true },
                  { key: 'budgetDelayPct', label: 'تأخر الموازنة', num: true, sortValue: (r) => r.budgetDelayPct ?? -Infinity,
                    render: (r) => r.budgetDelayPct == null ? <span className="dash">لا موازنة</span>
                      : <Pct value={r.budgetDelayPct} className={r.budgetDelayPct > 0 ? 't-warn' : 't-ok'} /> },
                ]}
                totals={{ outstanding: t.outstanding, overdue: t.overdue, contractorsOwed: t.contractorsOwed,
                  contractorsOwedToUs: t.contractorsOwedToUs, totalCommitment: t.totalCommitment }}
                total={{ keys: ['outstanding', 'overdue', 'contractorsOwed', 'contractorsOwedToUs', 'totalCommitment'], label: 'الإجمالي' }}
                empty={{ icon: 'search', title: 'لا نتائج مطابقة' }}
                toolbar={<Button size="sm" onClick={() => go(paths.admin())}>دمج مشاريع مكرّرة</Button>} />
            </Island>
          ) : (
            <div className="sp-cards">
              {[...rows].sort((a, b) => b.risk - a.risk).map((r, i) => (
                <Island key={r.project} i={i + 7} className={'sp-card' + (r.v.kind === 'loss' ? ' sp-card-loss' : '')}
                  onClick={() => go(paths.project(r.id ?? r.project))} label={`فتح مشروع ${r.project}`}
                  title={r.project} actions={<VerdictPill v={r.v} />}>
                  <dl className="sp-dl">
                    <div><dt>مفتوح للموردين</dt><dd><Money value={r.outstanding ?? null} />{(r.overdue ?? 0) > 0 && <small className="t-danger"> متأخر <Money value={r.overdue ?? null} /></small>}</dd></div>
                    <div><dt>مستحق للمقاولين</dt><dd><Money value={r.contractorsOwed ?? null} /></dd></div>
                    <div><dt>إجمالي الالتزام</dt><dd><Money value={r.totalCommitment ?? null} /></dd></div>
                    <div><dt>تأخر الموازنة</dt><dd>{r.budgetDelayPct == null ? <span className="dash">لا موازنة</span> : <Pct value={r.budgetDelayPct} />}</dd></div>
                  </dl>
                </Island>
              ))}
            </div>
          )}
        </div>

        {rows.length > 0 && (
          <Island i={8} span={12} title="مقارنة المديونية المفتوحة بين المشاريع">
            <div className="sp-hbars">
              {rows.map((r) => (
                <div className="sp-hrow" key={r.project}>
                  <span className="sp-hname">{r.project}</span>
                  <span className="sp-htrack"><i style={{ '--w': Math.max(0.02, (r.outstanding || 0) / maxOut) } as React.CSSProperties} /></span>
                  <Money value={r.outstanding ?? null} />
                </div>
              ))}
            </div>
          </Island>
        )}
      </Grid>
    </>
  );
}
