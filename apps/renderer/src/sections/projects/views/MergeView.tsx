/* دمج المشاريع — يحل محل pages/ProjectAdmin.tsx (P-358..P-361). لا دمج قبل رؤية الأثر. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Grid, Island, PageHeader, Skeleton, confirm, int, usePrefs } from '@/ui';
import { useApi, useApiMutation } from '@/data/hooks';
import { useProjectAdmin, PARTY_ROOTS, BUDGET_ROOTS } from '../hooks';
import { projectsApi } from '../api';
import { affectedTotal, canPreview, impactLines, mergePairs } from '../logic/merge';
import { ErrorBox } from '../components/bits';
import type { MergePreview } from '../types';

export default function MergeView() {
  usePrefs();
  const [sp] = useSearchParams();
  const q = useProjectAdmin();
  const [from, setFrom] = useState(sp.get('from') ?? '');
  const [into, setInto] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const ready = canPreview(from, into);
  const pvq = useApi(['projects', 'mergePreview', from, into], () => projectsApi.mergePreview(from, into),
    { enabled: ready, retry: false });
  const pv = { data: pvq.data as MergePreview | undefined, error: pvq.error as unknown };
  const run = useApiMutation((v: { from: string; into: string }) => projectsApi.merge(v.from, v.into), {
    invalidate: ['projects', ...PARTY_ROOTS, ...BUDGET_ROOTS, 'suppliers', 'contractors', 'overview', 'dashboard', 'cashflow', 'revenues'],
  });

  function pick(a: string, b: string) {
    setFrom(a); setInto(b); setDone(null);
    requestAnimationFrame(() => document.querySelector('.sec-projects .sp-preview')?.scrollIntoView({ block: 'center' }));
  }

  async function doMerge() {
    if (!pv.data) return;
    const ok = await confirm({
      title: `دمج «${from}» في «${into}»؟`, danger: true, confirmLabel: 'دمج',
      body: `سيتأثر ${int(pv.data.total)} صفاً ويختفي «${from}». مبالغ إسناد الأطراف تنتقل مع الدمج. لا تراجع تلقائي — نسخة احتياطية تُؤخذ من «الإعدادات».`,
    });
    if (!ok) return;
    const r = (await run.mutateAsync({ from, into })) as { merged: { affected: Record<string, number> } };
    setDone(`تم الدمج — ${int(affectedTotal(r.merged.affected))} صفاً تأثّر`);
    setFrom(''); setInto('');
  }

  if (q.error) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  if (!q.data) return <Skeleton rows={5} />;
  const { projects, possibleDuplicates } = q.data;
  const opts = (<><option value="">اختر مشروعاً</option>{projects.map((p) => <option key={p} value={p}>{p}</option>)}</>);

  return (
    <>
      <PageHeader title="إدارة المشاريع — الدمج"
        sub="نفس المشروع قد يظهر باسمين إن أُدخل من وحدتين مختلفتين — ادمجهما هنا بعد أن ترى الأثر فعلياً" />
      <Grid>
        <Island i={0} title="مشاريع تبدو مكرّرة" actions={<span className="cap">نفس الاسم بعد تجاهل أل التعريف والتشكيل</span>}>
          {possibleDuplicates.length === 0 ? <p className="empty-note">لا أسماء مكرّرة ظاهرة. يمكنك الدمج يدوياً أدناه.</p> : (
            <div className="sp-sugs">
              {possibleDuplicates.map((d) => (
                <div className="sp-sug" key={d.key}>
                  <b>{d.variants.map((v) => `«${v}»`).join(' / ')}</b>
                  <div className="sp-sug-acts">
                    {mergePairs(d.variants).map((p) => (
                      <Button size="sm" key={p.from + '>' + p.into} onClick={() => pick(p.from, p.into)}>دمج «{p.from}» في «{p.into}»</Button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Island>
        <Island i={1} title="دمج يدوي">
          <div className="sp-mrow">
            <label><span className="cap">المصدر (سيختفي)</span>
              <select data-testid="merge-from" value={from} onChange={(e) => { setFrom(e.target.value); setDone(null); }}>{opts}</select></label>
            <span className="sp-arrow" aria-hidden="true">←</span>
            <label><span className="cap">الهدف (سيبقى)</span>
              <select data-testid="merge-into" value={into} onChange={(e) => { setInto(e.target.value); setDone(null); }}>{opts}</select></label>
          </div>
          <div className="sp-preview" aria-live="polite">
            {done && <p className="t-ok">{done}</p>}
            {!ready ? (from && into ? <p className="t-warn">اختر مشروعين مختلفين.</p>
              : !done && <p className="cap">اختر المصدر والهدف لمعاينة الأثر قبل الدمج.</p>)
              : pv.error ? <p className="sp-err">{String((pv.error as Error).message)}</p>
              : !pv.data ? <p className="cap">جارٍ حساب الأثر…</p> : (
                <div className="sp-impact">
                  <p>«{from}» ← «{into}» — سيتأثر {int(pv.data.total)} صفاً، ويختفي «{from}»:</p>
                  <ul>{impactLines(pv.data).map((l) => <li key={l.table}><b className="num">{int(l.n)}</b> {l.label}</li>)}</ul>
                  {pv.data.total === 0 && <p className="cap">لا سجلات مرتبطة — سيُحذف الاسم المكرّر فقط.</p>}
                  <Button data-testid="merge-run" kind="primary" disabled={run.isPending} onClick={() => void doMerge()}>
                    {run.isPending ? 'جارٍ الدمج…' : `تنفيذ الدمج — «${from}» ← «${into}»`}
                  </Button>
                </div>
              )}
          </div>
        </Island>
      </Grid>
    </>
  );
}
