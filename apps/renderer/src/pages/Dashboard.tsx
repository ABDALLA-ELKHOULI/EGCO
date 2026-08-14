import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, arDate, dueLabel, dueTone, invoiceCount, k, pct, sar } from '@/lib/format';
import { Card, EmptyState, Kpi, Money, Pill, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';

const STATUS_VALUES = ['overdue', 'soon'] as const;
type StatusFilter = typeof STATUS_VALUES[number] | '';

/** لوحة اليوم — ما يجب دفعه الآن وما يقترب. */
export function Dashboard() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<string[]>([]);

  const project = params.get('project') || '';
  const statusParam = params.get('status') || '';
  const status: StatusFilter = (STATUS_VALUES as readonly string[]).includes(statusParam)
    ? (statusParam as StatusFilter) : '';

  useEffect(() => {
    api.dashboard({ project: project || undefined }).then(setD).catch((e) => setErr(e.message));
  }, [project]);

  // project options come from the always-unfiltered /projects list, fetched once.
  useEffect(() => { api.projects().then((r: any) => setProjects((r.rows ?? []).map((row: any) => row.project))).catch(() => {}); }, []);

  function setFilter(key: 'project' | 'status', value: string) {
    const p = new URLSearchParams(params);
    if (value) p.set(key, value); else p.delete(key);
    setParams(p, { replace: true });
  }

  if (err) return <State>تعذّر تحميل البيانات: {err}</State>;
  if (!d) return <State>جارٍ التحميل…</State>;

  const s = d.summary;
  if (!s.supplierCount) {
    return (
      <>
        <div className="page-head"><div><h1>لوحة اليوم</h1></div></div>
        <State>
          لا توجد بيانات بعد.<br />
          ابدأ من <Link to="/import">رفع كشف حساب</Link>.
        </State>
      </>
    );
  }

  const maxBar = Math.max(1, ...d.schedule.map((x: any) => x.amount));
  const payToday = (d.payToday ?? []).filter((r: any) => {
    if (status === 'overdue') return r.daysToDue < 0;
    if (status === 'soon') return r.daysToDue >= 0;
    return true;
  });

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>لوحة اليوم</h1>
          <p>{arDate(d.today)} · {ar(s.supplierCount)} مورداً عليه حركة</p>
        </div>
        <Link to="/import"><button className="btn primary">رفع كشف حساب</button></Link>
      </div>

      <div className="toolbar">
        <select value={project} onChange={(e) => setFilter('project', e.target.value)} style={{ minWidth: 180 }}>
          <option value="">كل المشاريع</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">كل الحالات</option>
          <option value="overdue">متأخر</option>
          <option value="soon">مستحق قريباً</option>
        </select>
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <Kpi label="متأخر عن موعده" value={sar(s.overdue)} unit="ر.س" tone="red" alert={s.overdue > 0}
             explain={<ExplainDot metric="overdue" values={{ overdue: s.overdue }} />} />
        <Kpi label="مستحق خلال ٧ أيام" value={sar(s.dueWithin7)} unit="ر.س" tone="gold"
             explain={<ExplainDot metric="dueWithin7" values={{ dueWithin7: s.dueWithin7 }} />} />
        <Kpi label="إجمالي المديونية" value={sar(s.outstanding)} unit="ر.س"
             explain={<ExplainDot metric="outstanding" values={{ totalInvoiced: s.totalPaid + s.outstanding, totalPaid: s.totalPaid, outstanding: s.outstanding }} />} />
      </div>

      {s.totalPaid > 0 && (
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
          سُدّد هذا العام: <span className="num">{sar(s.totalPaid)}</span> ر.س من إجمالي{' '}
          <span className="num">{sar(s.totalPaid + s.outstanding)}</span> ر.س (
          <span className="num">{pct(s.totalPaid / (s.totalPaid + s.outstanding) * 100)}</span>)
        </div>
      )}

      <div className="stack">
        <Card title="ادفع اليوم" sub="مرتبة بالأولوية — الأقدم استحقاقاً أولاً">
          {payToday.length === 0 ? (
            <EmptyState kind="all-clear" title="لا توجد مستحقات قريبة"
              body="لا فواتير مستحقة خلال الأيام السبعة القادمة — لا إجراء مطلوب الآن." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>المورد</th><th>المشروع</th><th>الفاتورة</th>
                  <th>الاستحقاق</th><th>الحالة</th><th className="ltr">المبلغ</th>
                </tr>
              </thead>
              <tbody>
                {payToday.map((r: any, i: number) => (
                  <tr key={i} className={r.daysToDue < 0 ? 'row-overdue' : 'row-due-soon'}>
                    <td><Link to={`/suppliers/${r.account}`}>{r.supplier}</Link></td>
                    <td className="muted">{r.project}</td>
                    <td className="muted">{ar(r.invoice ?? '—')}</td>
                    <td>{arDate(r.dueDate)}</td>
                    <td><Pill kind={dueTone(r.daysToDue)}>{dueLabel(r.daysToDue)}</Pill></td>
                    <td className="ltr"><Money v={r.amount} cls={dueTone(r.daysToDue)} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>الإجمالي المطلوب خلال ٧ أيام</td>
                  <td className="ltr"><Money v={s.overdue + s.dueWithin7} /></td>
                </tr>
              </tfoot>
            </table>
          )}
        </Card>

        <div className="two">
          <Card title="الاستحقاقات القادمة — ٩٠ يوماً">
            <div className="bars">
              {d.schedule.slice(0, 8).reverse().map((b: any) => (
                <div className="col" key={b.date}>
                  <span className="num" style={{ fontSize: 12 }}>{k(b.amount)}</span>
                  <div className="bar"
                       style={{ height: `${Math.max(6, (b.amount / maxBar) * 130)}px`,
                                background: b.overdue ? 'var(--red)' : 'var(--gold)' }} />
                  <span style={{ fontSize: 11 }}>{arDate(b.date, false)}</span>
                  <span className="muted" style={{ fontSize: 10 }}>{invoiceCount(b.count)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card title="أعمار الديون">
            <div className="card-body">
              {[['لم يحن موعدها', d.ageing.current, ''],
                ['متأخر ١–٣٠', d.ageing.d1_30, 'red'],
                ['متأخر ٣١–٦٠', d.ageing.d31_60, 'red'],
                ['متأخر ٦١–٩٠', d.ageing.d61_90, 'red'],
                ['أكثر من ٩٠', d.ageing.d90_plus, 'red']].map(([label, v, cls]: any) => (
                <div className="age-row" key={label}>
                  <span className="muted">{label}</span>
                  {v > 0 ? <Money v={v} cls={cls} /> : <span className="muted">—</span>}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
