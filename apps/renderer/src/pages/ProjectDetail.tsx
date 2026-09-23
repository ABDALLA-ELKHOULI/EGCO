import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, arDate, invoiceCount, k, sar } from '@/lib/format';
import { Card, ErrorState, Kpi, Money, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';

/** تفاصيل مشروع — الموردون واستحقاقاته القادمة. */
export function ProjectDetail() {
  const { project } = useParams();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const load = () => {
    if (!project) return;
    const my = ++seq.current;
    setErr(null);
    api.project(project)
      .then((r) => { if (my === seq.current) setD(r); })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => { load(); }, [project]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const suppliers = d.suppliers ?? [];
  const contractors = d.contractors ?? [];
  const schedule = d.schedule ?? [];
  const maxBar = Math.max(1, ...schedule.map((x: any) => x.amount || 0));

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{d.project}</h1>
          <p>{ar(d.supplierCount ?? suppliers.length)} مورداً</p>
        </div>
        <Link to="/projects"><button className="btn">رجوع</button></Link>
      </div>

      <div className="kpi-row">
        <Kpi label="المديونية المفتوحة" value={sar(d.outstanding ?? 0)} unit="ر.س"
             explain={<ExplainDot metric="projectDetailOutstanding" values={{ projectOutstanding: d.outstanding }} />} />
        <Kpi label="المتأخر" value={sar(d.overdue ?? 0)} unit="ر.س" tone="red" alert={(d.overdue ?? 0) > 0}
             explain={<ExplainDot metric="overdue" values={{ overdue: d.overdue }} />} />
        <Kpi label="مستحق للمقاولين" value={sar(d.contractorsOwed ?? 0)} unit="ر.س" tone="red" />
        <Kpi label="مستحق لنا من المقاولين" value={sar(d.contractorsOwedToUs ?? 0)} unit="ر.س" tone="ok" />
        <Kpi label="إجمالي الالتزام" value={sar(d.totalCommitment ?? 0)} unit="ر.س" hero />
        <Kpi label="تأخر الموازنة" value={d.budgetDelayPct !== null && d.budgetDelayPct !== undefined
          ? `${(d.budgetDelayPct * 100).toFixed(1)}٪` : '—'} />
      </div>
      {d.mergedSpellingAlert && (
        <p className="muted" style={{ fontSize: 12, margin: '4px 0 0' }}>
          دُمجت مديونية المقاولين من صيغ الاسم: {(d.contractorProjectNames ?? []).join('، ')} —
          يتجاهل مُطبِّع المطابقة أداة التعريف والمسافات فقط، لا يُعيد تسمية أي بيانات.
        </p>
      )}

      <div className="stack">
        {contractors.length > 0 && (
          <Card title="مقاولو المشروع">
            <table>
              <thead>
                <tr>
                  <th>المقاول</th><th>الكود</th>
                  <th className="ltr">الرصيد</th><th className="ltr">مستحق له</th>
                </tr>
              </thead>
              <tbody>
                {contractors.map((c: any) => (
                  <tr key={c.code}>
                    <td><Link to={`/contractors/${c.code}`}>{c.name}</Link></td>
                    <td className="num muted">{c.code}</td>
                    <td className="ltr">
                      <Money v={Math.abs(c.balance ?? 0)}
                             cls={c.balance < 0 ? 'red' : c.balance > 0 ? 'ok' : ''} />
                    </td>
                    <td>{c.balance < 0 ? 'لنا عليه' : c.balance > 0 ? 'له علينا' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <Card title="الموردون">
          {suppliers.length === 0 ? (
            <State>لا يوجد موردون بهذا المشروع.</State>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>المورد</th><th>رقم الحساب</th><th>المدة</th>
                  <th className="ltr">المديونية المفتوحة</th><th className="ltr">المتأخر</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s: any) => (
                  <tr key={s.account}>
                    <td><Link to={`/suppliers/${s.account}`}>{s.name}</Link></td>
                    <td className="num muted">{s.account}</td>
                    <td>{s.termKind === 'days' ? `${ar(s.termDays)} يوم` : s.term}</td>
                    <td className="ltr">
                      {s.outstanding > 0
                        ? <Money v={s.outstanding} cls={s.overdue > 0 ? 'red' : ''} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {s.overdue > 0 ? <Money v={s.overdue} cls="red" /> : <span className="muted">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="الاستحقاقات القادمة — ٩٠ يوماً">
          {schedule.length === 0 ? (
            <State>لا توجد استحقاقات قادمة.</State>
          ) : (
            <div className="bars">
              {schedule.slice(0, 8).map((b: any) => (
                <div className="col" key={b.date}>
                  <span className="num" style={{ fontSize: 12 }}>{k(b.amount ?? 0)}</span>
                  <div className="bar"
                       style={{ height: `${Math.max(6, ((b.amount || 0) / maxBar) * 130)}px`,
                                background: 'var(--gold)' }} />
                  <span style={{ fontSize: 11 }}>{arDate(b.date, false)}</span>
                  <span className="muted" style={{ fontSize: 10 }}>{invoiceCount(b.count ?? 0)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
