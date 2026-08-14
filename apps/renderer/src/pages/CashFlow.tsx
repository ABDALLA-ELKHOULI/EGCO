import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, Kpi, Money, Pill, State } from '@/components/ui';
import { AiBlock } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';

/** التدفق النقدي — الداخل مقابل الخارج، بالفترات. */
export function CashFlow() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const [opening, setOpening] = useState(0);
  const [weeksSel, setWeeksSel] = useState<13 | 26>(26);
  const [applied, setApplied] = useState<{ weeks: 13 | 26; opening: number }>({ weeks: 26, opening: 0 });

  const load = (weeks: number, opening_balance: number) => {
    api.cashflow({ weeks, opening_balance }).then(setD).catch((e) => setErr(e.message));
  };

  useEffect(() => { load(applied.weeks, applied.opening); }, [applied]);

  function apply() {
    setApplied({ weeks: weeksSel, opening: Number(opening) || 0 });
  }

  if (err) return <State>تعذّر التحميل: {err}</State>;
  if (!d) return <State>جارٍ التحميل…</State>;

  const periods = d.periods ?? [];
  const summary = d.summary ?? {};
  const hasReceivables = summary.hasReceivables !== false;
  const warnings: string[] = d.warnings ?? [];
  const maxAmt = Math.max(1, ...periods.map((p: any) => Math.max(p.inflow || 0, p.outflow || 0)));

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>التدفق النقدي</h1>
          <p>الداخل مقابل الخارج، بفترات ١٤ يوماً</p>
        </div>
      </div>

      {!hasReceivables && (
        <div className="callout bad" style={{ marginBottom: 14 }}>
          {warnings.length > 0
            ? warnings.join(' — ')
            : 'لم تُرفع بيانات التحصيلات بعد — التدفق الداخل أدناه ليس تقديراً فعلياً.'}
        </div>
      )}

      <div className="toolbar">
        <label style={{ fontSize: 13, color: 'var(--muted)' }}>
          الرصيد الافتتاحي
          <input type="number" value={opening} onChange={(e) => setOpening(Number(e.target.value))}
                 style={{ marginInlineStart: 8, width: 140 }} />
        </label>
        <select value={weeksSel} onChange={(e) => setWeeksSel(Number(e.target.value) as 13 | 26)}>
          <option value={13}>١٣ فترة</option>
          <option value={26}>٢٦ فترة</option>
        </select>
        <button className="btn primary" onClick={apply}>تطبيق</button>
      </div>

      <div className="kpi-row">
        <Kpi label="إجمالي الداخل" value={sar(summary.totalInflow ?? 0)} unit="ر.س" tone="ok" />
        <Kpi label="إجمالي الخارج" value={sar(summary.totalOutflow ?? 0)} unit="ر.س" />
        <Kpi label="صافي الفترة" value={sar(summary.netTotal ?? 0)} unit="ر.س"
             tone={(summary.netTotal ?? 0) < 0 ? 'red' : 'ok'} />
        <Kpi label="أدنى رصيد" value={sar(summary.minBalance ?? 0)} unit="ر.س"
             tone={(summary.minBalance ?? 0) < 0 ? 'red' : ''} alert={(summary.minBalance ?? 0) < 0} />
      </div>

      {summary.firstDeficit && (
        <div className="callout bad" style={{ marginBottom: 14 }}>
          أول عجز متوقع في {arDate(summary.firstDeficit.from)} — {arDate(summary.firstDeficit.to)}{' '}
          بمقدار {sar(Math.abs(summary.firstDeficit.amount ?? 0))} ر.س
        </div>
      )}

      <div className="stack">
        <Card title="الداخل مقابل الخارج">
          {periods.length === 0 ? (
            <State>لا توجد بيانات لهذه الفترة.</State>
          ) : (
            <>
              <div className="bars">
                {periods.map((p: any) => (
                  <div className="col" key={p.label}>
                    <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 130 }}>
                      <div className="bar" title="الداخل"
                           style={{ width: 10,
                                    height: `${Math.max(3, ((p.inflow || 0) / maxAmt) * 130)}px`,
                                    background: 'var(--ok)' }} />
                      <div className="bar" title="الخارج"
                           style={{ width: 10,
                                    height: `${Math.max(3, ((p.outflow || 0) / maxAmt) * 130)}px`,
                                    background: p.deficit ? 'var(--red)' : 'var(--gold)' }} />
                    </div>
                    <span style={{ fontSize: 11 }}>{arDate(p.from, false)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 14, padding: '0 20px 8px', fontSize: 12 }}>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--ok)', borderRadius: 2, marginInlineEnd: 4 }} />
                  {hasReceivables ? 'الداخل' : 'لا توجد بيانات تحصيلات'}</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--gold)', borderRadius: 2, marginInlineEnd: 4 }} />الخارج</span>
                <span><span style={{ display: 'inline-block', width: 10, height: 10, background: 'var(--red)', borderRadius: 2, marginInlineEnd: 4 }} />خارج (عجز)</span>
              </div>

              <div style={{ display: 'flex', gap: 4, padding: '8px 20px 16px', overflowX: 'auto' }}>
                {periods.map((p: any) => (
                  <div key={p.label} style={{
                    flex: '1 0 60px', textAlign: 'center', fontSize: 11, padding: '4px 2px',
                    borderRadius: 4, background: p.balance < 0 ? 'rgba(192,39,26,.12)' : 'var(--tint)',
                  }}>
                    <div className={'num' + (p.balance < 0 ? ' red' : '')}>{sar(p.balance ?? 0, 0)}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>

        <Card title="جدول الفترات">
          {periods.length === 0 ? (
            <State>لا توجد بيانات.</State>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>الفترة</th><th className="ltr">الداخل</th><th className="ltr">الخارج</th>
                  <th className="ltr">صافي الحركة</th><th className="ltr">الرصيد التراكمي</th><th></th>
                </tr>
              </thead>
              <tbody>
                {periods.map((p: any) => (
                  <tr key={p.label} style={p.deficit ? { background: 'var(--tint)' } : undefined}>
                    <td className="nowrap">{arDate(p.from)} — {arDate(p.to)}</td>
                    <td className="ltr"><Money v={p.inflow ?? 0} cls="ok" /></td>
                    <td className="ltr"><Money v={p.outflow ?? 0} /></td>
                    <td className="ltr">
                      <Money v={p.net ?? 0} cls={(p.net ?? 0) < 0 ? 'red' : ''} />
                    </td>
                    <td className="ltr">
                      <Money v={p.balance ?? 0} cls={(p.balance ?? 0) < 0 ? 'red' : ''} />
                    </td>
                    <td>{p.deficit && <Pill kind="red">عجز</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <WhatIfCard />
      </div>
    </>
  );
}

/** بطاقة «ماذا لو؟» — تأجيل/تقديم دفعة طرف معيّن. الحساب حتمي من الخادم، والنص فقط من المساعد. */
function WhatIfCard() {
  const { enabled, loading } = useAiEnabled();
  const [parties, setParties] = useState<{
    suppliers: { account: string; name: string }[];
    contractors: { code: string; name: string }[];
  } | null>(null);
  const [partyValue, setPartyValue] = useState(''); // "supplier:ACCOUNT" أو "contractor:CODE"
  const [shiftDays, setShiftDays] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ narrative: string; before: any; after: any } | null>(null);

  useEffect(() => {
    if (loading || !enabled) return;
    Promise.all([api.suppliers({}), api.contractors()]).then(([sup, con]) => {
      setParties({
        suppliers: (sup.rows ?? []).map((r: any) => ({ account: r.account, name: r.name })),
        contractors: (con.rows ?? []).map((r: any) => ({ code: r.code, name: r.name })),
      });
    }).catch(() => setParties({ suppliers: [], contractors: [] }));
  }, [loading, enabled]);

  async function compute() {
    if (!partyValue) return;
    const [partyKind, key] = partyValue.split(':') as ['supplier' | 'contractor', string];
    setBusy(true); setError(null); setResult(null);
    try {
      const r = await api.aiWhatIf({ partyKind, key, shiftDays: Number(shiftDays) || 0 });
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !enabled) return null;

  return (
    <Card title="ماذا لو؟" sub="أثر تأجيل أو تقديم دفعة طرف معيّن على التدفق النقدي">
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <select value={partyValue} onChange={(e) => setPartyValue(e.target.value)} style={{ minWidth: 220 }}
                  disabled={!parties}>
            <option value="">اختر طرفاً…</option>
            {parties && parties.suppliers.length > 0 && (
              <optgroup label="الموردون">
                {parties.suppliers.map((s) => (
                  <option key={'s:' + s.account} value={`supplier:${s.account}`}>{s.name}</option>
                ))}
              </optgroup>
            )}
            {parties && parties.contractors.length > 0 && (
              <optgroup label="المقاولون">
                {parties.contractors.map((c) => (
                  <option key={'c:' + c.code} value={`contractor:${c.code}`}>{c.name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            إزاحة الأيام
            <input type="number" value={shiftDays} onChange={(e) => setShiftDays(e.target.value)}
                   style={{ marginInlineStart: 8, width: 100 }} dir="ltr" />
          </label>
          <button className="btn primary" onClick={compute} disabled={busy || !partyValue}>
            {busy ? 'جارٍ الحساب…' : 'احسب'}
          </button>
        </div>

        {(busy || error || result) && (
          <AiBlock busy={busy} error={error}>
            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <WhatIfSummary label="قبل" data={result.before} />
                  <WhatIfSummary label="بعد" data={result.after} />
                </div>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{result.narrative}</p>
                <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                  الأرقام محسوبة من بياناتك؛ النص فقط من المساعد
                </p>
              </div>
            )}
          </AiBlock>
        )}
      </div>
    </Card>
  );
}

/** يعرض حقول before/after رقمية أياً كانت أسماؤها — الشكل any من الخادم. */
function WhatIfSummary({ label, data }: { label: string; data: any }) {
  const entries: [string, unknown][] = data && typeof data === 'object' ? Object.entries(data) : [];
  return (
    <div style={{ border: '1px solid var(--hair)', borderRadius: 'var(--r-control)', padding: 10 }}>
      <b style={{ fontSize: 12 }}>{label}</b>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {entries.length === 0 ? (
          <span className="muted" style={{ fontSize: 12 }}>—</span>
        ) : entries.map(([k, v]) => (
          <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, gap: 8 }}>
            <span className="muted">{k}</span>
            <span className="num">{typeof v === 'number' ? sar(v) : String(v ?? '—')}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
