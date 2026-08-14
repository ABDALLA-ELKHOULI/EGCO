import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Pill, State } from '@/components/ui';

const STATE_PILL: Record<string, { text: string; kind: string }> = {
  none: { text: 'بلا كشوفات', kind: 'red' },
  stale: { text: 'قديمة', kind: 'warn' },
  ok: { text: 'محدَّثة', kind: 'ok' },
};

const FILTERS = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'none', label: 'بلا كشوفات' },
  { value: 'stale', label: 'قديمة' },
  { value: 'ok', label: 'مكتملة' },
];

interface CoverageRow {
  account: string; name: string; project: string;
  firstActivity: string | null; lastActivity: string | null;
  daysSinceLast: number | null; invoiceCount: number; outstanding: number;
  state: 'none' | 'stale' | 'ok';
}

/** التغطية — الموردون الذين لم تُرفع لهم كشوفات أو أصبحت قديمة. */
export function CoveragePage() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');

  const load = () => {
    api.coverage(90).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rows: CoverageRow[] = useMemo(() => {
    if (!d) return [];
    let r: CoverageRow[] = d.rows ?? [];
    if (filter !== 'all') r = r.filter((row) => row.state === filter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      r = r.filter((row) =>
        row.name.toLowerCase().includes(needle) || row.account.toLowerCase().includes(needle));
    }
    return r;
  }, [d, filter, q]);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>تغطية الموردين</h1>
          <p>حالة الكشوفات المرفوعة لكل مورد — حتى {arDate(d.asOf)}</p>
        </div>
      </div>

      <div className="kpi-row">
        <Kpi
          label="موردون بلا كشوفات"
          value={ar(d.totals?.withoutData ?? 0)}
          tone="red"
          alert={(d.totals?.withoutData ?? 0) > 0}
        />
        <Kpi
          label={`كشوفاتهم قديمة (+${ar(d.staleDays ?? 0)} يوماً)`}
          value={ar(d.totals?.stale ?? 0)}
          tone="gold"
        />
        <Kpi label="نسبة التغطية" value={`${ar(d.totals?.coveredPct ?? 0)}٪`} />
      </div>

      <div className="callout note" style={{ marginBottom: 14 }}>
        أرقام لوحة اليوم مبنية على الموردين الذين رُفعت كشوفاتهم فقط — الموردون أدناه غير محسوبين.
      </div>

      <Card>
        <div className="card-body top" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <input
              placeholder="بحث بالاسم أو رقم الحساب"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 220 }}
            />
            <div className="count">{ar(rows.length)} مورد</div>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState kind="no-results" title="لا نتائج مطابقة"
            body="لم يطابق البحث أو التصفية أي مورد."
            ctaLabel="مسح التصفية" onCta={() => { setQ(''); setFilter('all'); }} />
        ) : (
          <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>المورد</th><th>رقم الحساب</th><th>المشروع</th>
                <th>أول حركة</th><th>آخر حركة</th><th>منذ</th>
                <th className="ltr">الفواتير</th><th className="ltr">المديونية (ر.س)</th><th>الحالة</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const pill = STATE_PILL[row.state] ?? { text: row.state, kind: '' };
                const rowCls = row.state === 'none' ? 'row-overdue'
                  : row.state === 'stale' ? 'row-due-soon' : '';
                return (
                  <tr key={row.account} className={rowCls}>
                    <td><Link to={`/suppliers/${row.account}`}>{row.name}</Link></td>
                    <td className="num muted">{row.account}</td>
                    <td className="muted">{row.project}</td>
                    <td>{arDate(row.firstActivity)}</td>
                    <td>{arDate(row.lastActivity)}</td>
                    <td>{row.daysSinceLast === null ? '—' : `${ar(row.daysSinceLast)} يوماً`}</td>
                    <td className="ltr num">{ar(row.invoiceCount)}</td>
                    <td className="ltr"><span className="num">{sar(row.outstanding)}</span></td>
                    <td><Pill kind={pill.kind}>{pill.text}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>
    </>
  );
}
