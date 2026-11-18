/** «التحليل الدوري» (P-325…P-329، P-577). السنوات من التغطية المسجلة بدل 2024–2026 الثابتة. */
import { useMemo, useState } from 'react';
import { Button, EmptyState, Grid, Island, Money, Pill, Seg, Skeleton, dateTxt, digits } from './uikit';
import { usePeriodic } from './hooks';
import { download, periodicExportUrl } from './exports';
import type { Granularity } from './types';

const THIS_YEAR = new Date().getFullYear();

export function PeriodicTab({ account }: { account?: string }) {
  const [g, setG] = useState<Granularity>('quarter');
  const [year, setYear] = useState(THIS_YEAR);
  const q = usePeriodic(g, year, account);
  const d = q.data;

  const years = useMemo(() => {
    const first = d?.coverage.first ? Number(d.coverage.first.slice(0, 4)) : 2024;
    const lo = Math.min(first, 2024, year), out: number[] = [];
    for (let y = Math.max(THIS_YEAR, year); y >= lo; y--) out.push(y);
    return out;
  }, [d?.coverage.first, year]);

  const last = d ? ([...d.periods].reverse().find((p) => p.complete) ?? d.periods[d.periods.length - 1]) : null;
  const pct = (v: number | null) => v == null ? '—' : <span className={'num ' + (v < 0 ? 't-danger' : 't-ok')}>{digits(v.toFixed(1))}٪</span>;

  return (
    <>
      <div className="rp-actbar">
        <Seg label="التقسيم" value={g} onChange={setG}
          options={[{ value: 'quarter', label: 'ربع سنوي' }, { value: 'half', label: 'نصف سنوي' }, { value: 'year', label: 'سنوي' }]} />
        <label className="rp-inline">السنة
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {years.map((y) => <option key={y} value={y}>{digits(y)}</option>)}
          </select>
        </label>
        <span className="rp-grow" />
        <Button onClick={() => download(periodicExportUrl(g, year, account))}>تصدير Excel</Button>
      </div>
      {q.error && <EmptyState icon={null} title="تعذّر التحميل" body={q.error} cta="إعادة المحاولة" onCta={q.reload} />}
      {!q.error && !d && <Skeleton rows={6} />}
      {d && (
        <Grid>
          <Island span={12}>
            <p className="rp-cap">التغطية المسجلة: {dateTxt(d.coverage.first, { year: true })} ← {dateTxt(d.coverage.last, { year: true })}</p>
            {d.periods.some((p) => !p.complete) && <p className="rp-alert">بعض الفترات خارج التغطية — أرقامها جزئية حتى تُرفع كشوفات أقدم</p>}
          </Island>
          <Island span={12} title="الفترات">
            <div className="tbl-wrap"><table>
              <thead><tr><th>الفترة</th><th className="n">الرصيد الافتتاحي</th><th className="n">المفوتر</th><th className="n">المسدد</th>
                <th className="n">صافي الحركة</th><th className="n">الرصيد الختامي</th><th className="n">متوسط عمر السداد (يوم)</th></tr></thead>
              <tbody>{d.periods.map((p) => (
                <tr key={p.label} className={p.complete ? undefined : 'rp-dim'}>
                  <td className="rp-nowrap">{p.label}{!p.complete && <Pill tone="warn">جزئي</Pill>}</td>
                  <td className="n"><Money value={p.opening} /></td><td className="n"><Money value={p.invoiced} /></td>
                  <td className="n"><Money value={p.paid} /></td><td className="n"><Money value={p.net} /></td>
                  <td className="n"><Money value={p.closing} /></td>
                  <td className="n">{p.avgSettlementDays != null ? digits(Math.round(p.avgSettlementDays)) : '—'}</td>
                </tr>))}</tbody>
            </table></div>
            <p className="rp-cap">«جزئي» = الفترة خارج التغطية المسجلة، فأرقامها ناقصة حتى تُرفع كشوفات أقدم.</p>
          </Island>
          <Island span={12} title="المقارنة">
            <div className="tbl-wrap"><table>
              <thead><tr><th>الفترة</th><th className="n">المسدد</th><th className="n">الفترة السابقة</th><th className="n">التغيّر</th>
                <th className="n">نفس الفترة العام الماضي</th><th className="n">التغيّر</th></tr></thead>
              <tbody>{d.comparison.map((c) => (
                <tr key={c.label}><td>{c.label}</td><td className="n"><Money value={c.paid} /></td>
                  <td className="n"><Money value={c.prevPaid} /></td><td className="n">{pct(c.prevPct)}</td>
                  <td className="n"><Money value={c.yoyPaid} /></td><td className="n">{pct(c.yoyPct)}</td></tr>))}</tbody>
            </table></div>
          </Island>
          {last && (
            <>
              <Island span={6} title={`التوزيع على المشاريع — ${last.label}`}>
                {last.byProject.length === 0 ? <p className="rp-muted">لا توجد بيانات</p> : (() => {
                  const max = Math.max(1, ...last.byProject.map((r) => r.paid));
                  return <div className="rp-bars">{last.byProject.map((r, i) => (
                    <div className="rp-bar" key={r.project}><span>{r.project}</span>
                      <div className="rp-track"><i style={{ '--w': (r.paid / max).toFixed(4), '--i': i } as React.CSSProperties} /></div>
                      <Money value={r.paid} /></div>))}</div>;
                })()}
              </Island>
              <Island span={6} title={`أعلى الموردين سداداً — ${last.label}`}>
                <div className="tbl-wrap"><table>
                  <thead><tr><th>المورد</th><th className="n">المسدد</th></tr></thead>
                  <tbody>{last.topSuppliers.slice(0, 5).map((s) => <tr key={s.account}><td>{s.name}</td><td className="n"><Money value={s.paid} /></td></tr>)}</tbody>
                </table></div>
              </Island>
            </>
          )}
        </Grid>
      )}
    </>
  );
}
