/**
 * جدول الفترات (P-222/P-223): الفترة · الداخل المتوقّع · التحصيل الفعلي · الخارج · الصافي · الرصيد
 * التراكمي · عجز. كل مبلغ قابل للنقر ⇒ تفصيل تلك الفترة. أول ٦٠ فترة. مع سيناريو: عمود «الأصل»
 * من الخادم بجانب رصيد السيناريو، والخلايا المحرَّكة غير قابلة للتفصيل (التفصيل يصف بياناتك لا السيناريو).
 */
import { forwardRef } from 'react';
import { Money, Pill, dateTxt, digits, usePrefs } from '@/ui';
import { MAX_RENDERED_PERIOD_ROWS } from '../logic/prefs';
import type { ScenarioPeriod } from '../logic/scenario';
import type { BreakdownRequest } from './BreakdownModal';

const range = (a: string, b: string) => `${dateTxt(a)} — ${dateTxt(b)}`;

function Cell({ v, tone, onClick }: { v: number; tone?: string; onClick?: () => void }) {
  if (!onClick) return <Money value={v} className={tone} />;
  return <button className="sec-cash-lnk sec-cash-cell" title="اضغط لرؤية الصفوف التي كوّنت هذا الرقم" onClick={onClick}><Money value={v} className={tone} /></button>;
}

export const PeriodTable = forwardRef<HTMLTableSectionElement, {
  periods: ScenarioPeriod[]; scenario: boolean; pinned: number | null; onPin: (i: number | null) => void;
  onOpen: (r: BreakdownRequest) => void;
}>(function PeriodTable({ periods, scenario, pinned, onPin, onOpen }, ref) {
  usePrefs();
  const shown = periods.slice(0, MAX_RENDERED_PERIOD_ROWS);
  return (
    <>
      <div className="tbl-wrap"><table className="sec-cash-pt">
        <thead><tr>
          <th>الفترة</th><th className="n">الداخل (متوقّع)</th><th className="n">التحصيل الفعلي</th><th className="n">الخارج</th>
          <th className="n">صافي الحركة</th><th className="n">الرصيد التراكمي</th>{scenario && <th className="n">الأصل</th>}<th />
        </tr></thead>
        <tbody ref={ref}>
          {shown.map((p, i) => {
            const touched = scenario && p.moved.length > 0;
            const lbl = range(p.from, p.to);
            return (
              <tr key={p.from} data-idx={i} className={(p.deficit ? 'sec-cash-def ' : '') + (pinned === i ? 'sec-cash-pin' : '')}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button')) onPin(pinned === i ? null : i); }}>
                <td className="nowrap">{lbl}{touched && <> <Pill tone="warn">سيناريو</Pill></>}</td>
                <td className="n"><Cell v={p.inflow} tone="t-ok" onClick={touched ? undefined : () => onOpen({ term: 'forecast', period: p.from, title: `الداخل المتوقّع — ${lbl}`, amount: p.inflow, rule: 'تحصيلات مفتوحة لها تاريخ استحقاق داخل هذه الفترة تحديداً.' })} /></td>
                <td className="n"><Cell v={p.collected} tone="t-ok" onClick={() => onOpen({ term: 'collected', period: p.from, title: `التحصيل الفعلي — ${lbl}`, amount: p.collected, rule: 'تحصيلات بحالة «محصَّل» بتاريخ تحصيل فعلي داخل هذه الفترة تحديداً.' })} /></td>
                <td className="n"><Cell v={p.outflow} onClick={touched ? undefined : () => onOpen({ term: 'scheduled', period: p.from, title: `الخارج المجدول — ${lbl}`, amount: p.outflow, rule: 'فواتير موردين/ضمانات مقاولين مستحقة داخل هذه الفترة تحديداً.' })} /></td>
                <td className="n"><Money value={p.net} className={p.net < 0 ? 't-danger' : ''} /></td>
                <td className="n"><Money value={p.balance} className={p.balance < 0 ? 't-danger' : ''} /></td>
                {scenario && <td className="n"><Money value={p.baseBalance} className="sec-cash-muted" /></td>}
                <td>{p.deficit && <Pill tone="danger">عجز</Pill>}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      {periods.length > MAX_RENDERED_PERIOD_ROWS && (
        <p className="cap">عُرضت أول {digits(MAX_RENDERED_PERIOD_ROWS)} فترة — قصّر الأفق أو أطل الفترة</p>
      )}
    </>
  );
});
