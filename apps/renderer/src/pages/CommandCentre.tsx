import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, ErrorState, Money, Kpi, State } from '@/components/ui';
import { AiBlock, AiDisabledHint, CopyButton } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';
import { ExplainDot } from '@/components/Explain';

interface Alert { level: 'danger' | 'warning' | 'info'; text: string }
interface Project { project: string; outstanding: number; overdue: number }

/** لوحة القيادة — نظرة واحدة على السيولة والمديونية والتغطية. */
export function CommandCentre() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setErr(null);
    api.overview().then(setD).catch((e) => setErr(e.message));
  };

  useEffect(() => { load(); }, []);

  if (err) return <ErrorState message={err} onRetry={load} />;
  if (!d) return <State>جارٍ التحميل…</State>;

  const payables = d.payables ?? {};
  const coverage = d.coverage ?? {};
  const cash = d.cash ?? {};
  const projects: Project[] = Array.isArray(d.projects) ? d.projects : [];
  const alerts: Alert[] = Array.isArray(d.alerts) ? d.alerts : [];

  const maxOutstanding = Math.max(1, ...projects.map((p) => p.outstanding || 0));
  const projectsWithDebt = projects.filter((p) => (p.outstanding || 0) > 0);
  const hiddenZeroProjects = projects.length - projectsWithDebt.length;

  const calloutCls = (level: Alert['level']) =>
    level === 'danger' ? 'callout bad'
      : level === 'warning' ? 'callout warn'
      : 'callout note';

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>لوحة القيادة</h1>
          <p>نظرة واحدة على السيولة والمديونية والتغطية{d.asOf ? ` · ${arDate(d.asOf)}` : ''}</p>
        </div>
      </div>

      {/* التنبيهات في شبكة عمودين على الشاشات العريضة — ستة أشرطة بعرض الصفحة
          كانت تبتلع الطية الأولى قبل ظهور أي رقم. */}
      <div className="alerts">
        {alerts.length === 0 ? (
          <div className="callout ok">لا توجد تنبيهات — كل الالتزامات ضمن مواعيدها</div>
        ) : (
          alerts.map((a, i) => (
            <div key={i} className={calloutCls(a.level)}>{a.text}</div>
          ))
        )}
      </div>

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
        <Kpi label="المديونية المفتوحة" value={sar(payables.outstanding ?? 0)} unit="ر.س"
             explain={<ExplainDot metric="outstanding" values={{ outstanding: payables.outstanding }} />} />
        <Kpi
          label="المتأخر"
          value={sar(payables.overdue ?? 0)}
          unit="ر.س"
          tone="red"
          alert={(payables.overdue ?? 0) > 0}
          explain={<ExplainDot metric="overdue" values={{ overdue: payables.overdue }} />}
        />
        <Kpi label="مستحق خلال ٧ أيام" value={sar(payables.dueWithin7 ?? 0)} unit="ر.س" tone="gold"
             explain={<ExplainDot metric="dueWithin7" values={{ dueWithin7: payables.dueWithin7 }} />} />
        <Kpi
          label="الموردون"
          value={ar(payables.supplierCount ?? 0)}
          unit={`${ar(payables.withData ?? 0)} منهم لديهم كشوفات`}
        />
      </div>

      <div className="two" style={{ marginTop: 18 }}>
        <Card title="التغطية">
          <div className="card-body">
            <div className="value num" style={{ fontSize: 32, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
              {coverage.coveredPct != null ? `${coverage.coveredPct}٪` : '—'}
              <ExplainDot metric="supplierCoverage" values={{
                supplierWithData: (payables.supplierCount ?? 0) - (coverage.withoutData ?? 0),
                supplierCount: payables.supplierCount, coveredPct: coverage.coveredPct,
              }} />
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
            <a href="#/coverage" className="btn" style={{ marginTop: 12 }}>
              عرض فجوات التغطية
            </a>
          </div>
        </Card>

        <Card title="السيولة">
          <div className="card-body">
            {!cash.hasReceivables ? (
              <>
                <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
                  لم تُرفع بيانات التحصيلات — لا يمكن حساب السيولة بعد
                </div>
                <a href="#/cashflow" className="btn">فتح التدفق النقدي</a>
              </>
            ) : (
              <>
                <div className="muted" style={{ fontSize: 13 }}>أدنى رصيد (ر.س)</div>
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
        <Card title="أعلى المشاريع مديونية (ر.س)">
          {projects.length === 0 ? (
            <State>لا توجد بيانات مشاريع بعد.</State>
          ) : (
            <div className="card-body">
              {projectsWithDebt.slice(0, 5).map((p, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: i < projectsWithDebt.length - 1 || hiddenZeroProjects > 0 ? '1px solid var(--hair)' : undefined }}>
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
              {hiddenZeroProjects > 0 && (
                <div className="muted" style={{ fontSize: 12, padding: '8px 0 0' }}>
                  +{ar(hiddenZeroProjects)} مشاريع بلا مديونية
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <AiSection />
    </>
  );
}

/** قسم مساعد الذكاء الاصطناعي — بطاقة «المساعد» واحدة تجمع السؤال الحر، الموجز
 * الأسبوعي، وفحص الشذوذ كأزرار ثانوية في رأسها؛ نتيجة أي إجراء تُعرض داخل نفس البطاقة. */
function AiSection() {
  const { enabled, loading } = useAiEnabled();

  if (loading) return null;
  if (!enabled) return <div style={{ marginTop: 18 }}><AiDisabledHint /></div>;

  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <AssistantCard />
    </div>
  );
}

type AssistantMode = 'ask' | 'brief' | 'anomalies';

function AssistantCard() {
  const [mode, setMode] = useState<AssistantMode>('ask');
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askResult, setAskResult] = useState<{ answer: string; sql?: string; rows?: any[] } | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<{ title: string; detail: string; link?: string }[] | null>(null);

  function switchMode(next: AssistantMode) {
    setMode(next); setError(null);
  }

  async function ask() {
    if (!question.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.aiAsk(question.trim());
      setAskResult(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runBrief() {
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

  async function runAnomalies() {
    setBusy(true); setError(null); setAnomalies(null);
    try {
      const r = await api.aiAnomalies();
      setAnomalies(r.items);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card
      title="المساعد"
      sub="سؤال حر، موجز أسبوعي، أو فحص شذوذ — كلها هنا"
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <button className={'btn sm' + (mode === 'ask' ? ' primary' : '')} onClick={() => switchMode('ask')}>
            اسأل بياناتك
          </button>
          <button className={'btn sm' + (mode === 'brief' ? ' primary' : '')}
                  onClick={() => { switchMode('brief'); runBrief(); }} disabled={busy}>
            الموجز الأسبوعي
          </button>
          <button className={'btn sm' + (mode === 'anomalies' ? ' primary' : '')}
                  onClick={() => { switchMode('anomalies'); runAnomalies(); }} disabled={busy}>
            فحص الشذوذ
          </button>
        </div>
      }
    >
      <div className="card-body flow">
        {mode === 'ask' && (
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
        )}

        {(busy || error || (mode === 'ask' && askResult) || (mode === 'brief' && brief) || (mode === 'anomalies' && anomalies)) && (
          <AiBlock busy={busy} error={error}>
            {mode === 'ask' && askResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <p className="ai-text">{askResult.answer}</p>
                {Array.isArray(askResult.rows) && askResult.rows.length > 0 && (
                  <details>
                    <summary>عرض بيانات الإثبات</summary>
                    <div className="table-scroll" style={{ marginTop: 8 }}>
                      <table>
                        <thead>
                          <tr>
                            {Object.keys(askResult.rows[0]).map((k) => <th key={k}>{k}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {askResult.rows.slice(0, 20).map((row, i) => (
                            <tr key={i}>
                              {Object.keys(askResult.rows![0]).map((k) => (
                                <td key={k} className="num">{String(row[k] ?? '—')}</td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                {askResult.sql && (
                  <details>
                    <summary>الاستعلام (SQL)</summary>
                    <pre className="ai-sql">{askResult.sql}</pre>
                  </details>
                )}
              </div>
            )}

            {mode === 'brief' && brief && <p className="ai-text">{brief}</p>}

            {mode === 'anomalies' && anomalies && (
              anomalies.length === 0 ? (
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>لا شذوذ ملحوظ حالياً.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {anomalies.map((it, i) => {
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
        )}
      </div>
    </Card>
  );
}
