import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, sar } from '@/lib/format';
import { Card, ErrorState, Kpi, Money, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';

/** المشاريع — مديونية كل مشروع ومتأخراته. */
export function Projects() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.projects().then(setD).catch((e) => setErr(e.message));
  };

  useEffect(() => { load(); }, []);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const rows = d.rows ?? [];
  const maxOutstanding = Math.max(1, ...rows.map((r: any) => r.outstanding || 0));

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>المشاريع</h1>
          <p>مديونية كل مشروع ومتأخراته</p>
        </div>
      </div>

      {/* لا أعمدة ثابتة هنا: `repeat(5,1fr)` مكتوبة في JSX كانت تتغلّب على auto-fit في
          tokens.css فتُقصّ البطاقة الطرفية عند ١٢٨٠px (مُشاهَد بلقطة). الشبكة تلتفّ بنفسها. */}
      <div className="kpi-row">
        <Kpi label="مديونية الموردين المفتوحة" value={sar(d.totals?.outstanding ?? 0)} unit="ر.س"
             explain={<ExplainDot metric="projectsTotals" values={{ projectsOutstanding: d.totals?.outstanding }} />} />
        <Kpi label="المتأخر" value={sar(d.totals?.overdue ?? 0)} unit="ر.س" tone="red" alert={(d.totals?.overdue ?? 0) > 0}
             explain={<ExplainDot metric="overdue" values={{ overdue: d.totals?.overdue }} />} />
        <Kpi label="مستحق للمقاولين" value={sar(d.totals?.contractorsOwed ?? 0)} unit="ر.س" />
        <Kpi label="مستحق لنا من المقاولين" value={sar(d.totals?.contractorsOwedToUs ?? 0)} unit="ر.س" tone="ok" />
        <Kpi label="إجمالي الالتزام (موردون + مقاولون)" value={sar(d.totals?.totalCommitment ?? 0)} unit="ر.س" hero />
      </div>
      <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
        «مستحق للمقاولين» و«مستحق لنا» هما نفس أرقام شاشة <b>المقاولون</b> بالضبط، و«تأخر الموازنة»
        من شاشة <b>الموازنة</b> (آخر شهر مُدخَل إن وُجد) — لا حساب جديد هنا. الأحمر للمتأخر عن موعده فقط.
      </p>

      <div className="stack">
        <Card>
          {rows.length === 0 ? (
            <State>لا توجد مشاريع بعد.</State>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>المشروع</th><th>الموردون</th>
                  <th className="ltr">المديونية المفتوحة (ر.س)</th><th className="ltr">المتأخر (ر.س)</th>
                  <th className="ltr">مستحق للمقاولين (ر.س)</th><th className="ltr">مستحق لنا منهم (ر.س)</th>
                  <th className="ltr">إجمالي الالتزام (ر.س)</th><th>تأخر الموازنة ٪</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.project}>
                    <td>
                      <Link to={`/projects/${encodeURIComponent(r.project)}`}>{r.project}</Link>
                      {r.mergedSpellingAlert && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          يضم صيغ الاسم: {(r.contractorProjectNames ?? []).join('، ')}
                        </div>
                      )}
                    </td>
                    <td>
                      {ar(r.supplierCount ?? 0)}
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {ar(r.suppliersWithData ?? 0)} منهم لديهم كشوفات
                      </div>
                    </td>
                    <td className="ltr">
                      {r.outstanding > 0
                        ? <Money v={r.outstanding} cls={r.overdue > 0 ? 'red' : ''} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.overdue > 0 ? <Money v={r.overdue} cls="red" /> : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.contractorsOwed > 0
                        ? <Money v={r.contractorsOwed} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.contractorsOwedToUs > 0
                        ? <Money v={r.contractorsOwedToUs} cls="ok" />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr"><Money v={r.totalCommitment ?? 0} /></td>
                    <td>
                      {r.budgetDelayPct !== null && r.budgetDelayPct !== undefined
                        ? <span className={r.budgetDelayPct > 0 ? 'red' : 'ok'}>
                            {(r.budgetDelayPct * 100).toFixed(1)}٪
                          </span>
                        : <span className="muted">لا موازنة</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {rows.length > 0 && (
          <Card title="مقارنة المديونية المفتوحة بين المشاريع">
            <div style={{ padding: '4px 20px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {rows.map((r: any) => (
                <div key={r.project} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 160, fontSize: 13 }}>{r.project}</div>
                  <div style={{ flex: 1, background: 'var(--tint)', borderRadius: 4, height: 16, position: 'relative' }}>
                    <div style={{
                      height: '100%', borderRadius: 4, background: 'var(--gold)',
                      width: `${Math.max(2, ((r.outstanding || 0) / maxOutstanding) * 100)}%`,
                    }} />
                  </div>
                  <div className="num" style={{ width: 110, textAlign: 'left', fontSize: 12 }}>
                    <Money v={r.outstanding ?? 0} /> ر.س
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
