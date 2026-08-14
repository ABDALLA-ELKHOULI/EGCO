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

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi label="إجمالي المديونية" value={sar(d.totals?.outstanding ?? 0)} unit="ر.س"
             explain={<ExplainDot metric="projectsTotals" values={{ projectsOutstanding: d.totals?.outstanding }} />} />
        <Kpi label="المتأخر" value={sar(d.totals?.overdue ?? 0)} unit="ر.س" tone="red" alert={(d.totals?.overdue ?? 0) > 0}
             explain={<ExplainDot metric="overdue" values={{ overdue: d.totals?.overdue }} />} />
        <Kpi label="مستحق خلال ٧ أيام" value={sar(d.totals?.dueWithin7 ?? 0)} unit="ر.س" tone="gold"
             explain={<ExplainDot metric="dueWithin7" values={{ dueWithin7: d.totals?.dueWithin7 }} />} />
      </div>

      <div className="stack">
        <Card>
          {rows.length === 0 ? (
            <State>لا توجد مشاريع بعد.</State>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>المشروع</th><th>الموردون</th>
                  <th className="ltr">المفوتر (ر.س)</th><th className="ltr">المسدد (ر.س)</th>
                  <th className="ltr">المديونية المفتوحة (ر.س)</th><th className="ltr">المتأخر (ر.س)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
                  <tr key={r.project}>
                    <td>
                      <Link to={`/projects/${encodeURIComponent(r.project)}`}>{r.project}</Link>
                    </td>
                    <td>
                      {ar(r.supplierCount ?? 0)}
                      <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                        {ar(r.suppliersWithData ?? 0)} منهم لديهم كشوفات
                      </div>
                    </td>
                    <td className="ltr muted"><Money v={r.totalInvoiced ?? 0} /></td>
                    <td className="ltr"><Money v={r.totalPaid ?? 0} cls="ok" /></td>
                    <td className="ltr">
                      {r.outstanding > 0
                        ? <Money v={r.outstanding} cls={r.overdue > 0 ? 'red' : ''} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.overdue > 0 ? <Money v={r.overdue} cls="red" /> : <span className="muted">—</span>}
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
