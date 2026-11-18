/**
 * أعمدة الداخل/الخارج لكل فترة تحت المنحنى (P-221) — LineChart في @/ui لا يرسم أعمدة.
 * الخارج في فترة عجز بلون الخطر كما في القديم. ارتفاعات نسبية فقط (عرض لا حساب).
 */
import { dateTxt, fmt, usePrefs } from '@/ui';
import type { CashPeriod } from '../types';

export function BarsStrip({ periods, pinned, onPin }: { periods: CashPeriod[]; pinned: number | null; onPin: (i: number) => void }) {
  usePrefs();
  const n = periods.length;
  if (!n) return null;
  const max = Math.max(1, ...periods.map((p) => Math.max(p.inflow, p.outflow)));
  const W = 1000, H = 60, slot = W / n, bw = Math.max(1.5, slot / 2 - 2);
  return (
    <svg className="sec-cash-bars" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="الداخل مقابل الخارج لكل فترة">
      {periods.map((p, i) => {
        // RTL: الفترة الأولى يميناً، كما في محور LineChart
        const x = W - (i + 0.5) * slot;
        const hi = (p.inflow / max) * (H - 4), ho = (p.outflow / max) * (H - 4);
        return (
          <g key={p.from} className={'sec-cash-bar' + (pinned === i ? ' on' : '')} onClick={() => onPin(i)}>
            <title>{`${dateTxt(p.from)} — داخل ${fmt(p.inflow)} · خارج ${fmt(p.outflow)}`}</title>
            <rect className="hit" x={x - slot / 2} y={0} width={slot} height={H} />
            <rect className="bi" x={x + 1} y={H - hi} width={bw} height={hi} />
            <rect className={p.deficit ? 'bo neg' : 'bo'} x={x - bw - 1} y={H - ho} width={bw} height={ho} />
          </g>
        );
      })}
    </svg>
  );
}
