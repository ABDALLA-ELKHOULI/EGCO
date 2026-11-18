/** أولويات السداد (P-318) — AI إن مفعّل وإلا الترتيب الحتمي؛ «ضمن الميزانية» من الخادم. */
import { useState } from 'react';
import { useAiEnabled } from '@/lib/useAi';
import { Money, Pill, digits } from './uikit';
import { parseBudget } from './prioritiesUtil';
import { usePriorities } from './hooks';
import { PartyPill } from './parts';

export function PrioritiesBlock() {
  const ai = useAiEnabled();
  const [draft, setDraft] = useState('');
  const [budget, setBudget] = useState<number | null>(null);
  const q = usePriorities(budget, ai.enabled, !ai.loading);
  const bad = draft.trim() !== '' && parseBudget(draft) === null;

  return (
    <div>
      <div className="rp-prio-bar rp-noprint">
        <label className="rp-inline">ميزانية متاحة
          <input dir="ltr" inputMode="decimal" value={draft} placeholder="اختياري" aria-invalid={bad}
            onChange={(e) => setDraft(e.target.value)} />
        </label>
        <button type="button" className="btn sm" disabled={q.loading || bad}
          onClick={() => { const b = parseBudget(draft); if (b === budget) q.reload(); else setBudget(b); }}>
          {q.loading ? 'جارٍ الحساب…' : 'تحديث'}
        </button>
        {bad && <span className="t-danger">أدخل رقماً صحيحاً</span>}
      </div>
      {q.error && <p className="t-danger">{q.error}</p>}
      {!q.error && q.loading && !q.data && <p className="rp-muted">جارٍ الحساب…</p>}
      {q.data && (q.data.items.length === 0 ? <p className="rp-muted">لا بنود مرشّحة حالياً.</p> : (
        <>
          <div className="tbl-wrap"><table>
            <thead><tr><th className="n">#</th><th>الاسم</th><th className="n">المبلغ</th><th>السبب</th>{q.data.budget && <th>ضمن الميزانية</th>}</tr></thead>
            <tbody>
              {q.data.items.map((it, i) => (
                <tr key={it.partyKind + it.key}>
                  <td className="n">{digits(i + 1)}</td>
                  <td className="rp-nowrap">{it.name}<PartyPill kind={it.partyKind} /></td>
                  <td className="n"><Money value={it.amount} /></td>
                  <td className="rp-muted">{it.reason}</td>
                  {q.data!.budget && <td>{it.fitsInBudget ? <Pill tone="ok">ضمن الميزانية</Pill> : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table></div>
          {q.data.budget && (
            <p className="rp-cap">الميزانية <Money value={q.data.budget.budget} /> · المخصّص <Money value={q.data.budget.allocated} /> · المتبقي <Money value={q.data.budget.remaining} /> — بترتيب القائمة، محسوبة على الخادم.</p>
          )}
          {q.data.narrative && <p className="rp-narr">{q.data.narrative}</p>}
          {q.data.note && <p className="rp-cap rp-noprint">{q.data.note}</p>}
        </>
      ))}
    </div>
  );
}
