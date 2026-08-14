import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, Money, Kpi, State } from '@/components/ui';
import { AiBlock, AiDisabledHint, CopyButton } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';

interface Alert { level: 'danger' | 'warning' | 'info'; text: string }
interface Project { project: string; outstanding: number; overdue: number }

/** لوحة القيادة — نظرة واحدة على السيولة والمديونية والتغطية. */
export function CommandCentre() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { api.overview().then(setD).catch((e) => setErr(e.message)); }, []);

  if (err) return <State>تعذّر تحميل البيانات: {err}</State>;
  if (!d) return <State>جارٍ التحميل…</State>;

  const payables = d.payables ?? {};
  const coverage = d.coverage ?? {};
  const cash = d.cash ?? {};
  const projects: Project[] = Array.isArray(d.projects) ? d.projects : [];
  const alerts: Alert[] = Array.isArray(d.alerts) ? d.alerts : [];

  const maxOutstanding = Math.max(1, ...projects.map((p) => p.outstanding || 0));

  const calloutCls = (level: Alert['level']) =>
    level === 'danger' ? 'callout bad' : 'callout note';

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>لوحة القيادة</h1>
          <p>نظرة واحدة على السيولة والمديونية والتغطية{d.asOf ? ` · ${arDate(d.asOf)}` : ''}</p>
        </div>
      </div>

      <div className="stack" style={{ marginBottom: 18 }}>
        {alerts.length === 0 ? (
          <div className="callout ok">لا توجد تنبيهات — كل الالتزامات ضمن مواعيدها</div>
        ) : (
          alerts.map((a, i) => (
            <div
              key={i}
              className={calloutCls(a.level)}
              style={a.level === 'warning' ? { borderColor: 'var(--gold)' } : undefined}
            >
              {a.text}
            </div>
          ))
        )}
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi label="المديونية المفتوحة" value={sar(payables.outstanding ?? 0)} unit="ر.س" />
        <Kpi
          label="المتأخر"
          value={sar(payables.overdue ?? 0)}
          unit="ر.س"
          tone="red"
          alert={(payables.overdue ?? 0) > 0}
        />
        <Kpi label="مستحق خلال ٧ أيام" value={sar(payables.dueWithin7 ?? 0)} unit="ر.س" tone="gold" />
        <Kpi
          label="الموردون"
          value={ar(payables.supplierCount ?? 0)}
          unit={`${ar(payables.withData ?? 0)} منهم لديهم كشوفات`}
        />
      </div>

      <div className="two" style={{ marginTop: 18 }}>
        <Card title="التغطية">
          <div style={{ padding: '0 20px 16px' }}>
            <div className="value num" style={{ fontSize: 32, marginBottom: 10 }}>
              {coverage.coveredPct != null ? `${coverage.coveredPct}٪` : '—'}
            </div>
            <div style={{ background: 'var(--tint)', height: 10, borderRadius: 99, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${coverage.coveredPct ?? 0}%`,
                  background: 'var(--gold)',
                  height: '100%',
                }}
              />
            </div>
            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              {ar(coverage.withoutData ?? 0)} مورداً بلا كشوفات
            </div>
            <div className="muted" style={{ fontSize: 13 }}>
              {ar(coverage.stale ?? 0)} كشوفاتهم قديمة
            </div>
            <a href="#/coverage" className="btn" style={{ marginTop: 12, display: 'inline-block' }}>
              عرض فجوات التغطية
            </a>
          </div>
        </Card>

        <Card title="السيولة">
          <div style={{ padding: '0 20px 16px' }}>
            {!cash.hasReceivables ? (
              <>
                <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  لم تُرفع بيانات التحصيلات — لا يمكن حساب السيولة بعد
                </div>
                <a href="#/cashflow" className="btn">فتح التدفق النقدي</a>
              </>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 13 }}>أدنى رصيد</div>
                <div className="value num" style={{ fontSize: 24, marginBottom: 8 }}>
                  <Money v={cash.minBalance ?? 0} cls={(cash.minBalance ?? 0) < 0 ? 'red' : undefined} />
                </div>
                {cash.nextDeficit && (
                  <div className="red" style={{ fontSize: 13 }}>
                    أول عجز: {cash.nextDeficit.label} بمقدار {sar(cash.nextDeficit.amount)} ر.س
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="stack" style={{ marginTop: 18 }}>
        <Card title="أعلى المشاريع مديونية">
          {projects.length === 0 ? (
            <State>لا توجد بيانات مشاريع بعد.</State>
          ) : (
            <div style={{ padding: '0 20px 16px' }}>
              {projects.slice(0, 5).map((p, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: i < projects.length - 1 ? '1px solid var(--hair)' : undefined }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <a href={`#/projects/${encodeURIComponent(p.project)}`}>{p.project}</a>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                      {(p.overdue ?? 0) > 0 && (
                        <span className="red" style={{ fontSize: 12 }}>
                          متأخر <Money v={p.overdue} cls="red" />
                        </span>
                      )}
                      <Money v={p.outstanding ?? 0} />
                    </div>
                  </div>
                  <div style={{ background: 'var(--tint)', height: 6, borderRadius: 99, overflow: 'hidden' }}>
                    <div
                      style={{
                        width: `${((p.outstanding ?? 0) / maxOutstanding) * 100}%`,
                        background: 'var(--gold)',
                        height: '100%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <AiSection />
    </>
  );
}

/** قسم مساعد الذكاء الاصطناعي — سؤال حر عن البيانات، موجز أسبوعي، وفحص شذوذ. */
function AiSection() {
  const { enabled, loading } = useAiEnabled();

  if (loading) return null;
  if (!enabled) return <div style={{ marginTop: 18 }}><AiDisabledHint /></div>;

  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <AskCard />
      <BriefCard />
      <AnomaliesCard />
    </div>
  );
}

function AskCard() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ answer: string; sql?: string; rows?: any[] } | null>(null);

  async function ask() {
    if (!question.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.aiAsk(question.trim());
      setResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="اسأل بياناتك" sub="سؤال بالعربية عن بيانات لوحة القيادة — قراءة فقط">
      <div style={{ padding: '0 20px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            style={{ flex: 1 }}
            value={question}
            placeholder="مثال: من هم أكثر ثلاثة موردين مديونية متأخرة؟"
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') ask(); }}
          />
          <button className="btn primary" onClick={ask} disabled={busy || !question.trim()}>
            {busy ? 'جارٍ الإرسال…' : 'إرسال'}
          </button>
        </div>
        {(busy || error || result) && (
          <AiBlock busy={busy} error={error}>
            {result && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p style={{ margin: 0 }}>{result.answer}</p>
                {Array.isArray(result.rows) && result.rows.length > 0 && (
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12 }}>عرض بيانات الإثبات</summary>
                    <div className="table-scroll" style={{ marginTop: 8 }}>
                      <table>
                        <thead>
                          <tr>
                            {Object.keys(result.rows[0]).map((k) => <th key={k}>{k}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {result.rows.slice(0, 20).map((row, i) => (
                            <tr key={i}>
                              {Object.keys(result.rows![0]).map((k) => (
                                <td key={k} className="num">{String(row[k] ?? '—')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {result.sql && (
                  <details>
                    <summary style={{ cursor: 'pointer', fontSize: 12 }}>الاستعلام (SQL)</summary>
                    <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', direction: 'ltr', textAlign: 'left', marginTop: 8 }}>
                      {result.sql}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </AiBlock>
        )}
      </div>
    </Card>
  );
}

function BriefCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);

  async function run() {
    setBusy(true); setError(null); setBrief(null);
    try {
      const r = await api.aiBrief(7);
      setBrief(r.brief);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="الموجز الأسبوعي"
      actions={<button className="btn" onClick={run} disabled={busy}>{busy ? 'جارٍ التحضير…' : 'إنشاء الموجز'}</button>}
    >
      {(busy || error || brief) && (
        <div style={{ padding: '0 20px 16px' }}>
          <AiBlock busy={busy} error={error}>
            {brief && <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{brief}</p>}
          </AiBlock>
        </div>
      )}
    </Card>
  );
}

function AnomaliesCard() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<{ title: string; detail: string; link?: string }[] | null>(null);

  async function run() {
    setBusy(true); setError(null); setItems(null);
    try {
      const r = await api.aiAnomalies();
      setItems(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="فحص الشذوذ"
      actions={<button className="btn" onClick={run} disabled={busy}>{busy ? 'جارٍ الفحص…' : 'فحص الشذوذ'}</button>}
    >
      {(busy || error || items) && (
        <div style={{ padding: '0 20px 16px' }}>
          <AiBlock busy={busy} error={error}>
            {items && (
              items.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>لا شذوذ ملحوظ حالياً.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {items.map((it, i) => {
                    const body = (
                      <>
                        <b style={{ display: 'block', fontSize: 13 }}>{it.title}</b>
                        <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{it.detail}</div>
                      </>
                    );
                    return it.link ? (
                      <a key={i} href={it.link} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
                        {body}
                      </a>
                    ) : (
                      <div key={i}>{body}</div>
                    );
                  })}
                </div>
              )
            )}
          </AiBlock>
        </div>
      )}
    </Card>
  );
}
