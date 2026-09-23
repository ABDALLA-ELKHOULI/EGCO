import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Card, ErrorState, State } from '@/components/ui';

/**
 * «المشاريع والدمج» (م-٣٠) — «السدن»/«سدن» مشروعان لا يلتقيان في أي فلتر لأنهما
 * أُدخلا من وحدتين مختلفتين بصيغتين مختلفتين لأل التعريف. الاستيراد يطابقهما
 * تلقائياً من الآن فصاعداً (services/api/app/services/party_projects.py
 * resolve_to_known_project)، لكن ما استُورد قبل هذا الإصلاح يحتاج دمجاً يدوياً
 * — بقرار صريح موثَّق في docs/feedback/PLAN.md §٣: **لا هجرة تُعيد التسمية
 * تلقائياً**، فهذه الشاشة هي الزرّ الذي يراه المستخدم ويوافق عليه.
 */
export function ProjectAdmin() {
  const [data, setData] = useState<{ projects: string[];
    possibleDuplicates: { key: string; variants: string[] }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [fromName, setFromName] = useState('');
  const [intoName, setIntoName] = useState('');
  const [preview, setPreview] = useState<
    { affected: Record<string, number>; total: number } | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  function load() {
    setErr(null);
    api.projectAdmin().then(setData)
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'تعذّر تحميل المشاريع'));
  }

  useEffect(load, []);

  function pickPair(from: string, into: string) {
    setFromName(from);
    setIntoName(into);
    setPreview(null);
    setPreviewErr(null);
    setDoneMsg(null);
  }

  async function runPreview() {
    setPreviewErr(null);
    setPreview(null);
    if (!fromName || !intoName) return;
    try {
      const r = await api.projectMergePreview(fromName, intoName);
      setPreview(r);
    } catch (e) {
      setPreviewErr(e instanceof ApiError ? e.message : 'تعذّرت المعاينة');
    }
  }

  async function runMerge() {
    if (!preview) return;
    setBusy(true);
    try {
      const r = await api.projectMerge(fromName, intoName);
      setDoneMsg(`تم الدمج — ${Object.values(r.merged.affected).reduce((a, b) => a + b, 0)} صفاً تأثّر`);
      setPreview(null);
      setFromName('');
      setIntoName('');
      load();
    } catch (e) {
      setPreviewErr(e instanceof ApiError ? e.message : 'تعذّر الدمج');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>المشاريع والدمج</h1>
          <p>نفس المشروع قد يظهر باسمين إن أُدخل من وحدتين مختلفتين — ادمجهما هنا بعد أن ترى الأثر فعلياً</p>
        </div>
        <Link className="btn" to="/settings">رجوع للإعدادات</Link>
      </div>

      {err && <ErrorState message={err} onRetry={load} />}
      {!err && !data && <State>جارٍ التحميل…</State>}

      {data && (
        <div className="stack">
          {data.possibleDuplicates.length > 0 && (
            <Card title="مشاريع تبدو مكرّرة" sub="نفس الاسم بعد تجاهل أل التعريف والتشكيل">
              <div className="card-body">
                {data.possibleDuplicates.map((d) => (
                  <div key={d.key} className="callout" style={{ marginBottom: 8 }}>
                    <strong>{d.variants.join(' / ')}</strong>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      {d.variants.map((v) => d.variants.filter((x) => x !== v).map((other) => (
                        <button key={`${v}->${other}`} className="btn sm"
                                onClick={() => pickPair(v, other)}>
                          دمج «{v}» في «{other}»
                        </button>
                      )))}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="دمج يدوي">
            <div className="card-body">
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>المصدر (سيختفي)</div>
                  <select value={fromName} onChange={(e) => { setFromName(e.target.value); setPreview(null); }}>
                    <option value="">اختر مشروعاً</option>
                    {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <label>
                  <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>الهدف (سيبقى)</div>
                  <select value={intoName} onChange={(e) => { setIntoName(e.target.value); setPreview(null); }}>
                    <option value="">اختر مشروعاً</option>
                    {data.projects.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </label>
                <button className="btn" disabled={!fromName || !intoName || fromName === intoName}
                        onClick={runPreview}>
                  معاينة الأثر
                </button>
              </div>

              {previewErr && <p style={{ color: 'var(--red)' }}>{previewErr}</p>}
              {doneMsg && <p style={{ color: 'var(--ok)' }}>{doneMsg}</p>}

              {preview && (
                <div className="callout" style={{ marginTop: 12 }}>
                  <div>سيتأثر {preview.total} صفاً:</div>
                  <ul>
                    {Object.entries(preview.affected).filter(([, n]) => n > 0).map(([table, n]) => (
                      <li key={table}>{table}: {n}</li>
                    ))}
                  </ul>
                  <button className="btn primary" disabled={busy} onClick={runMerge}>
                    {busy ? '…' : `تنفيذ الدمج — «${fromName}» ← «${intoName}»`}
                  </button>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}
