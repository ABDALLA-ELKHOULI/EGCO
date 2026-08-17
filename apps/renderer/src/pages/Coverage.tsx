import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Pill, State } from '@/components/ui';
import { Th, type SortState } from '@/components/ColumnMenu';

const STATE_PILL: Record<string, { text: string; kind: string }> = {
  none: { text: 'بلا كشوفات', kind: 'red' },
  stale: { text: 'قديمة', kind: 'warn' },
  ok: { text: 'محدَّثة', kind: 'ok' },
};

const STATE_OPTIONS = [
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

  // شريط الأدوات القديم (بحث + قائمة حالة) استُبدل بقوائم الأعمدة أدناه — مكانان
  // لنفس الفلتر كانا يمكن أن يختلفا بصمت، فأُبقي فلتراً واحداً لكل عمود.
  const [name, setName] = useState('');
  const [account, setAccount] = useState('');
  const [project, setProject] = useState('');
  const [firstFrom, setFirstFrom] = useState('');
  const [firstTo, setFirstTo] = useState('');
  const [lastFrom, setLastFrom] = useState('');
  const [lastTo, setLastTo] = useState('');
  const [sinceMin, setSinceMin] = useState('');
  const [sinceMax, setSinceMax] = useState('');
  const [invMin, setInvMin] = useState('');
  const [invMax, setInvMax] = useState('');
  const [outMin, setOutMin] = useState('');
  const [outMax, setOutMax] = useState('');
  const [state, setState] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const load = () => {
    api.coverage(90).then((r) => { setD(r); setErr(null); }).catch((e) => setErr(e.message));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const projects = useMemo(() => {
    const all = (d?.rows ?? []) as CoverageRow[];
    return Array.from(new Set(all.map((r) => r.project).filter(Boolean))).sort();
  }, [d]);

  const clearAll = () => {
    setName(''); setAccount(''); setProject(''); setFirstFrom(''); setFirstTo('');
    setLastFrom(''); setLastTo(''); setSinceMin(''); setSinceMax('');
    setInvMin(''); setInvMax(''); setOutMin(''); setOutMax(''); setState('');
  };

  const filtering = Boolean(name || account || project || firstFrom || firstTo || lastFrom
    || lastTo || sinceMin || sinceMax || invMin || invMax || outMin || outMax || state);

  const rows: CoverageRow[] = useMemo(() => {
    if (!d) return [];
    let r: CoverageRow[] = d.rows ?? [];
    if (state) r = r.filter((row) => row.state === state);
    if (project) r = r.filter((row) => row.project === project);
    if (name) r = r.filter((row) => row.name.toLowerCase().includes(name.trim().toLowerCase()));
    if (account) r = r.filter((row) => row.account.includes(account.trim()));
    if (firstFrom) r = r.filter((row) => row.firstActivity && row.firstActivity >= firstFrom);
    if (firstTo) r = r.filter((row) => row.firstActivity && row.firstActivity <= firstTo);
    if (lastFrom) r = r.filter((row) => row.lastActivity && row.lastActivity >= lastFrom);
    if (lastTo) r = r.filter((row) => row.lastActivity && row.lastActivity <= lastTo);
    if (sinceMin) r = r.filter((row) => row.daysSinceLast != null && row.daysSinceLast >= Number(sinceMin));
    if (sinceMax) r = r.filter((row) => row.daysSinceLast != null && row.daysSinceLast <= Number(sinceMax));
    if (invMin) r = r.filter((row) => row.invoiceCount >= Number(invMin));
    if (invMax) r = r.filter((row) => row.invoiceCount <= Number(invMax));
    if (outMin) r = r.filter((row) => row.outstanding >= Number(outMin));
    if (outMax) r = r.filter((row) => row.outstanding <= Number(outMax));
    if (sort) {
      const dir = sort.dir === 'asc' ? 1 : -1;
      const key = sort.key;
      r = [...r].sort((a, b) => {
        let av: any; let bv: any;
        switch (key) {
          case 'name': av = a.name; bv = b.name; break;
          case 'account': av = a.account; bv = b.account; break;
          case 'project': av = a.project; bv = b.project; break;
          case 'firstActivity': av = a.firstActivity ?? ''; bv = b.firstActivity ?? ''; break;
          case 'lastActivity': av = a.lastActivity ?? ''; bv = b.lastActivity ?? ''; break;
          case 'daysSinceLast': av = a.daysSinceLast ?? -1; bv = b.daysSinceLast ?? -1; break;
          case 'invoiceCount': av = a.invoiceCount; bv = b.invoiceCount; break;
          case 'outstanding': av = a.outstanding; bv = b.outstanding; break;
          case 'state': av = a.state; bv = b.state; break;
          default: av = 0; bv = 0;
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    return r;
  }, [d, name, account, project, firstFrom, firstTo, lastFrom, lastTo, sinceMin, sinceMax,
      invMin, invMax, outMin, outMax, state, sort]);

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
        <Kpi label="نسبة التغطية" value={`${ar(d.totals?.coveredPct ?? 0)}٪`} hero />
      </div>

      <div className="callout note" style={{ marginBottom: 14 }}>
        أرقام لوحة اليوم مبنية على الموردين الذين رُفعت كشوفاتهم فقط — الموردون أدناه غير محسوبين.
      </div>

      <Card>
        <div className="card-body top" style={{ paddingBottom: 0 }}>
          <div className="toolbar">
            <div className="count">{ar(rows.length)} مورد</div>
            {filtering && <button className="btn sm" onClick={clearAll}>مسح كل التصفية</button>}
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState kind="no-results" title="لا نتائج مطابقة"
            body="لم يطابق البحث أو التصفية أي مورد."
            ctaLabel="مسح التصفية" onCta={clearAll} />
        ) : (
          <div className="table-scroll wide">
          <table>
            <thead>
              <tr>
                <Th label="المورد" sortKey="name" sort={sort} onSort={setSort}
                    ascLabel="أ ← ي" descLabel="ي ← أ" active={Boolean(name)}
                    filter={{ kind: 'text', value: name, onChange: setName, placeholder: 'اسم المورد…' }} />
                <Th label="رقم الحساب" sortKey="account" sort={sort} onSort={setSort}
                    active={Boolean(account)}
                    filter={{ kind: 'text', value: account, onChange: setAccount, placeholder: '211…' }} />
                <Th label="المشروع" sortKey="project" sort={sort} onSort={setSort}
                    active={Boolean(project)}
                    filter={{ kind: 'select', value: project, onChange: setProject,
                              allLabel: 'كل المشاريع', options: projects.map((p) => ({ value: p, label: p })) }} />
                <Th label="أول حركة" sortKey="firstActivity" sort={sort} onSort={setSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" active={Boolean(firstFrom || firstTo)}
                    filter={{ kind: 'dateRange', from: firstFrom, to: firstTo, onFrom: setFirstFrom, onTo: setFirstTo }} />
                <Th label="آخر حركة" sortKey="lastActivity" sort={sort} onSort={setSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" active={Boolean(lastFrom || lastTo)}
                    filter={{ kind: 'dateRange', from: lastFrom, to: lastTo, onFrom: setLastFrom, onTo: setLastTo }} />
                <Th label="منذ" sortKey="daysSinceLast" sort={sort} onSort={setSort}
                    ascLabel="الأقل أولاً" descLabel="الأكثر أولاً" active={Boolean(sinceMin || sinceMax)}
                    filter={{ kind: 'range', min: sinceMin, max: sinceMax, onMin: setSinceMin, onMax: setSinceMax, unit: 'يوم' }} />
                <Th label="الفواتير" className="ltr" sortKey="invoiceCount" sort={sort} onSort={setSort}
                    ascLabel="الأقل أولاً" descLabel="الأكثر أولاً" active={Boolean(invMin || invMax)}
                    filter={{ kind: 'range', min: invMin, max: invMax, onMin: setInvMin, onMax: setInvMax }} />
                <Th label="المديونية (ر.س)" className="ltr" sortKey="outstanding" sort={sort} onSort={setSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" active={Boolean(outMin || outMax)}
                    filter={{ kind: 'range', min: outMin, max: outMax, onMin: setOutMin, onMax: setOutMax, unit: 'ر.س' }} />
                <Th label="الحالة" sortKey="state" sort={sort} onSort={setSort}
                    active={Boolean(state)}
                    filter={{ kind: 'select', value: state, onChange: setState,
                              allLabel: 'كل الحالات', options: STATE_OPTIONS }} />
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
