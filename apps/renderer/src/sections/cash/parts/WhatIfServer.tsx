/**
 * «اسأل المساعد» (P-229): إزاحة دفعات طرف كامل — الأرقام قبل/بعد حتمية من الخادم، النص فقط
 * من المساعد. يختفي أثناء التحميل وحين يكون المساعد معطّلاً (نفس سلوك القديم).
 */
import { useMemo, useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { useApi } from '@/data/hooks';
import { useAiEnabled } from '@/lib/useAi';
import { Button, fmt, usePrefs } from '@/ui';
import { useWhatIfServer } from '../hooks';

interface PartyOpt { kind: 'supplier' | 'contractor'; key: string; name: string }

export function WhatIfServer() {
  usePrefs();
  const { enabled, loading } = useAiEnabled();
  const sup = useApi(['suppliers', { whatIf: 1 }], () => api.suppliers({}), { enabled });
  const con = useApi(['contractors', { whatIf: 1 }], () => api.contractors(), { enabled });
  const [sel, setSel] = useState(''); const [days, setDays] = useState('0');
  const run = useWhatIfServer();
  const parties = useMemo<PartyOpt[]>(() => {
    const s = ((sup.data as { rows?: { account: string; name: string }[] } | undefined)?.rows ?? []).map((r) => ({ kind: 'supplier' as const, key: r.account, name: r.name }));
    const c = ((con.data as { rows?: { code: string; name: string }[] } | undefined)?.rows ?? []).map((r) => ({ kind: 'contractor' as const, key: r.code, name: r.name }));
    return [...s, ...c];
  }, [sup.data, con.data]);
  if (loading || !enabled) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const p = parties.find((x) => `${x.kind}:${x.key}` === sel); if (!p) return;
    run.mutate({ partyKind: p.kind, key: p.key, shiftDays: parseInt(days, 10) || 0 });
  };
  const r = run.data;
  return (
    <form className="sec-cash-scnf" onSubmit={submit}><b>اسأل المساعد: أزِح كل دفعات طرف</b>
      <label><span className="cap">الطرف</span>
        <select className="sec-cash-in" value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">اختر طرفاً…</option>
          <optgroup label="الموردون">{parties.filter((p) => p.kind === 'supplier').map((p) => <option key={'s' + p.key} value={`supplier:${p.key}`}>{p.name}</option>)}</optgroup>
          <optgroup label="المقاولون">{parties.filter((p) => p.kind === 'contractor').map((p) => <option key={'c' + p.key} value={`contractor:${p.key}`}>{p.name}</option>)}</optgroup>
        </select></label>
      <label><span className="cap">إزاحة الأيام</span><input className="sec-cash-in" type="number" dir="ltr" value={days} onChange={(e) => setDays(e.target.value)} /></label>
      <Button type="submit" disabled={run.isPending || !sel}>{run.isPending ? 'جارٍ الحساب…' : 'احسب'}</Button>
      {run.error && <div className="sec-cash-call w"><span>{run.error.message}</span></div>}
      {r && (
        <div className="sec-cash-wi">
          {(['before', 'after'] as const).map((k) => (
            <dl key={k}><dt>{k === 'before' ? 'قبل' : 'بعد'}</dt>
              {Object.entries(r[k] ?? {}).map(([n, v]) => <dd key={n}><span className="cap">{n}</span><span className="num">{typeof v === 'number' ? fmt(v) : String(v ?? '—')}</span></dd>)}
            </dl>))}
          <p>{r.narrative}</p>
          <p className="cap">الأرقام محسوبة من بياناتك؛ النص فقط من المساعد · على مستوى الشركة كاملة بصرف النظر عن فلتر المشروع</p>
        </div>
      )}
    </form>
  );
}
