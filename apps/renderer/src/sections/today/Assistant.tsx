/**
 * «المساعد» (P-037…P-040، P-375) — سؤال حر · الموجز الأسبوعي · الحركات غير المعتادة.
 * الذكاء الاصطناعي يكتب نصاً فقط؛ الصفوف المعروضة كإثبات تأتي من الخادم كما هي.
 * يختفي أثناء فحص التفعيل، ويُستبدل بتلميح إن كان معطلاً.
 */
import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAiEnabled } from '@/lib/useAi';
import { Island, Seg, Button, digits } from '@/ui';
import { useGo } from './nav.ts';

type Mode = 'ask' | 'brief' | 'anomalies';
interface AskResult { answer: string; sql?: string; rows?: Record<string, unknown>[] }
interface Anomaly { title: string; detail: string; link?: string }

export function Assistant({ i }: { i?: number }) {
  const { enabled, loading } = useAiEnabled();
  const go = useGo();
  const [mode, setMode] = useState<Mode>('ask');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ask, setAsk] = useState<AskResult | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [anoms, setAnoms] = useState<Anomaly[] | null>(null);

  if (loading) return null;
  if (!enabled) {
    return (
      <Island span={12} i={i} title="المساعد">
        <p className="cap">فعّل مساعد الذكاء من <button type="button" className="lnk" onClick={() => go('data.settings')}>الإعدادات</button></p>
      </Island>
    );
  }

  async function run<T>(f: () => Promise<T>, set: (v: T) => void) {
    setBusy(true); setErr(null);
    try { set(await f()); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); } finally { setBusy(false); }
  }
  function pick(m: Mode) {
    setMode(m); setErr(null);
    if (m === 'brief') run(() => api.aiBrief(7), (r) => setBrief(r.brief));
    if (m === 'anomalies') run(() => api.aiAnomalies(), (r) => setAnoms(r.items));
  }
  // روابط الشذوذ قديمة الشكل ('#/suppliers/211…') — تمرّ عبر التحويل القديم في الهيكل.
  const openLink = (href: string) => { window.location.hash = href.replace(/^#/, ''); };

  const cols = ask?.rows && ask.rows.length ? Object.keys(ask.rows[0]) : [];
  return (
    <Island span={12} i={i} title="المساعد"
      actions={<Seg<Mode> value={mode} onChange={pick} label="وضع المساعد"
        options={[{ value: 'ask', label: 'اسأل بياناتك' }, { value: 'brief', label: 'الموجز الأسبوعي' }, { value: 'anomalies', label: 'مراجعة الحركات غير المعتادة' }]} />}>
      <div className="td-ai">
        {mode === 'ask' && (
          <form className="td-ask" onSubmit={(e) => { e.preventDefault(); if (q.trim()) run(() => api.aiAsk(q.trim()), setAsk); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} data-no-dirty
              placeholder="مثال: من هم أكثر ثلاثة موردين مديونية متأخرة؟" aria-label="سؤالك" />
            <Button kind="primary" type="submit" disabled={busy || !q.trim()}>{busy ? 'جارٍ الإرسال…' : 'إرسال'}</Button>
          </form>
        )}
        {busy && <p className="cap" aria-live="polite">جارٍ التحميل…</p>}
        {err && <p className="td-err" role="alert">{err}</p>}
        {!busy && !err && mode === 'ask' && ask && (
          <div className="td-ai-out">
            <p className="td-ai-text">{ask.answer}</p>
            {cols.length > 0 && (
              <details><summary>عرض بيانات الإثبات</summary>
                <div className="tbl-wrap"><table>
                  <thead><tr>{cols.map((k) => <th key={k}>{k}</th>)}</tr></thead>
                  <tbody>{ask.rows!.slice(0, 20).map((row, r) => (
                    <tr key={r}>{cols.map((k) => <td key={k} className="num">{digits(String(row[k] ?? '—'))}</td>)}</tr>))}</tbody>
                </table></div>
              </details>
            )}
            {ask.sql && <details><summary>الاستعلام (SQL)</summary><pre className="td-sql" dir="ltr">{ask.sql}</pre></details>}
          </div>
        )}
        {!busy && !err && mode === 'brief' && brief && <p className="td-ai-text">{brief}</p>}
        {!busy && !err && mode === 'anomalies' && anoms && (anoms.length === 0
          ? <p className="cap">لا شذوذ ملحوظ حالياً.</p>
          : <ul className="td-anoms">{anoms.map((a, k) => (
              <li key={k}>
                {a.link
                  ? <button type="button" className="td-anom" onClick={() => openLink(a.link!)}><b>{a.title}</b><span className="cap">{a.detail}</span></button>
                  : <div className="td-anom"><b>{a.title}</b><span className="cap">{a.detail}</span></div>}
              </li>))}</ul>)}
      </div>
    </Island>
  );
}
