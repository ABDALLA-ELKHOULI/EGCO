import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, arDate, invoiceCount, k, sar } from '@/lib/format';
import { Card, ErrorState, Money, Pill, State } from '@/components/ui';

const DAYS = ['السبت','الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة'];

interface DayDetail {
  date: string;
  suppliers: { account: string; supplier: string; invoice: string | null;
               amount: number; overdue: boolean }[];
  guarantees: { code: string; name: string; project: string; amount: number;
                status: string }[];
  totals: { due: number; guarantees: number };
}

/** التقويم المالي — الاستحقاقات موزعة على أيام الشهر، وكل يوم قابل للنقر لعرض تفاصيله. */
export function CalendarPage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<DayDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const [projects, setProjects] = useState<string[]>([]);
  const project = params.get('project') || '';
  const seq = useRef(0);
  const detailSeq = useRef(0);

  const load = () => {
    const my = ++seq.current;
    setErr(null);
    api.dashboard({ project: project || undefined })
      .then((r) => { if (my === seq.current) setD(r); })
      .catch((e) => { if (my === seq.current) setErr(e instanceof Error ? e.message : String(e)); });
  };
  useEffect(() => { load(); }, [project]);

  useEffect(() => { api.projects().then((r: any) => setProjects((r.rows ?? []).map((row: any) => row.project))).catch(() => {}); }, []);

  const loadDetail = () => {
    if (!selected) { setDetail(null); return; }
    const my = ++detailSeq.current;
    setDetail(null); setDetailErr(null);
    api.calendarDay(selected, { project: project || undefined })
      .then((r) => { if (my === detailSeq.current) setDetail(r); })
      .catch((e) => { if (my === detailSeq.current) setDetailErr(e instanceof Error ? e.message : String(e)); });
  };
  useEffect(() => { loadDetail(); }, [selected, project]);

  function setProject(value: string) {
    const p = new URLSearchParams(params);
    if (value) p.set('project', value); else p.delete('project');
    setParams(p, { replace: true });
  }

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const today = new Date(d.today + 'T00:00:00');
  const view = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  const year = view.getFullYear(), month = view.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  // getDay(): 0=Sunday. Our grid starts on Saturday.
  const firstCol = (new Date(year, month, 1).getDay() + 1) % 7;

  const byDay: Record<number, { amount: number; count: number; overdue: boolean }> = {};
  for (const b of d.schedule ?? []) {
    const dt = new Date(b.date + 'T00:00:00');
    if (dt.getFullYear() === year && dt.getMonth() === month) {
      byDay[dt.getDate()] = { amount: b.amount, count: b.count, overdue: b.overdue };
    }
  }

  const iso = (day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const cells: (number | null)[] = Array(firstCol).fill(null);
  for (let i = 1; i <= daysInMonth; i++) cells.push(i);
  while (cells.length % 7) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const monthName = arDate(`${year}-${String(month + 1).padStart(2, '0')}-01`).split(' ').slice(1).join(' ');
  const monthTotal = Object.values(byDay).reduce((a, b) => a + b.amount, 0);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>التقويم المالي</h1>
          <p>{monthName} · إجمالي الاستحقاقات {sar(monthTotal)} ر.س · انقر أي يوم لعرض تفاصيله</p>
        </div>
        <button className="btn" onClick={() => setOffset(offset - 1)}>الشهر السابق</button>
        <button className="btn" onClick={() => setOffset(0)}>اليوم</button>
        <button className="btn" onClick={() => setOffset(offset + 1)}>الشهر التالي</button>
      </div>

      <div className="toolbar">
        <select value={project} onChange={(e) => setProject(e.target.value)} style={{ minWidth: 180 }}>
          <option value="">كل المشاريع</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>

      <Card>
        <div style={{ padding: 18 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 8 }}>
            {[...DAYS].reverse().map((n) => (
              <div key={n} className="muted" style={{ fontSize: 11, textAlign: 'center' }}>{n}</div>
            ))}
            {weeks.map((w, wi) => [...w].reverse().map((day, di) => {
              const mark = day ? byDay[day] : null;
              const isToday = day === today.getDate() && offset === 0;
              const isSelected = day !== null && selected === iso(day);
              return (
                <div key={`${wi}-${di}`}
                  onClick={() => day && setSelected(isSelected ? null : iso(day))}
                  role={day ? 'button' : undefined}
                  style={{
                    minHeight: 76, padding: 8, borderRadius: 6,
                    cursor: day ? 'pointer' : 'default',
                    border: isSelected
                      ? '2px solid var(--gold)'
                      : `1px solid ${mark?.overdue ? 'var(--red)' : 'var(--hair)'}`,
                    background: mark ? 'var(--tint)' : 'var(--card)',
                  }}>
                  {day && (
                    <>
                      <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400 }}>
                        {ar(day)}{isToday && <span className="ok" style={{ fontSize: 10 }}> اليوم</span>}
                      </div>
                      {mark && (
                        <div style={{ marginTop: 4 }}>
                          <div className={'num ' + (mark.overdue ? 'red' : 'gold')} style={{ fontSize: 12 }}>
                            {k(mark.amount)}
                          </div>
                          <div className="muted" style={{ fontSize: 10 }}>{invoiceCount(mark.count)}</div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            }))}
          </div>
        </div>
      </Card>

      {selected && (
        <Card title={`تفاصيل يوم ${arDate(selected)}`}>
          <div style={{ padding: '4px 20px 16px' }}>
            {detailErr && <ErrorState message={detailErr} onRetry={loadDetail} />}
            {!detail && !detailErr && <State>جارٍ التحميل…</State>}
            {detail && detail.suppliers.length === 0 && detail.guarantees.length === 0 && (
              <p className="muted">لا استحقاقات في هذا اليوم.</p>
            )}

            {detail && detail.suppliers.length > 0 && (
              <>
                <p style={{ margin: '10px 0 6px', fontWeight: 600 }}>
                  فواتير موردين مستحقة · {sar(detail.totals.due)} ر.س
                </p>
                <table>
                  <thead>
                    <tr><th>المورد</th><th>رقم الفاتورة</th>
                        <th className="ltr">المبلغ</th><th>الحالة</th><th></th></tr>
                  </thead>
                  <tbody>
                    {detail.suppliers.map((s, i) => (
                      <tr key={s.account + i} className={s.overdue ? 'row-overdue' : ''}>
                        <td><Link to={`/suppliers/${s.account}`}>{s.supplier}</Link></td>
                        <td className="num muted">{s.invoice ?? '—'}</td>
                        <td className="ltr"><Money v={s.amount} cls={s.overdue ? 'red' : ''} /></td>
                        <td>{s.overdue
                          ? <Pill kind="red">متأخرة</Pill>
                          : <Pill kind="gold">مستحقة</Pill>}</td>
                        <td>
                          <Link to={`/suppliers/${s.account}`}>
                            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }}>
                              فتح كشف المورد
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {detail && detail.guarantees.length > 0 && (
              <>
                <p style={{ margin: '14px 0 6px', fontWeight: 600 }}>
                  ضمانات مقاولين تستحق الصرف · {sar(detail.totals.guarantees)} ر.س
                </p>
                <table>
                  <thead>
                    <tr><th>المقاول</th><th>المشروع</th>
                        <th className="ltr">المبلغ</th><th></th></tr>
                  </thead>
                  <tbody>
                    {detail.guarantees.map((g, i) => (
                      <tr key={g.code + i}>
                        <td><Link to={`/contractors/${g.code}`}>{g.name}</Link></td>
                        <td className="muted">{g.project}</td>
                        <td className="ltr"><Money v={g.amount} /></td>
                        <td>
                          <Link to={`/contractors/${g.code}`}>
                            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }}>
                              فتح كشف المقاول
                            </button>
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </Card>
      )}
    </>
  );
}
