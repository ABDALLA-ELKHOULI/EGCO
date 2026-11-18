/**
 * Sparkline · LineChart · Kpi — منقولة من prototype/ui.js («مخططات» و«KPI»).
 * الزمن يُقرأ يميناً→يساراً (RTL): الأقدم يميناً.
 */
import type { ReactNode } from 'react';
import { compact, dateTxt, digits, fmt, int } from './format';
import { usePrefs } from './prefs';
import { Money, Pill, type PillTone, type Span } from './primitives';
import { useCountUp } from './motion';

export function Sparkline({ points, color = 'var(--chart-1)' }: { points: (number | null | undefined)[]; color?: string }) {
  const p = (points || []).map(Number).filter(Number.isFinite);
  if (p.length < 2) return null;
  const w = 300, h = 56, max = Math.max(...p), min = Math.min(...p);
  const xy = p.map((v, i) => [w - (i / (p.length - 1)) * w, h - 6 - ((v - min) / (max - min || 1)) * (h - 12)]);
  const line = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
  const len = Math.round(xy.reduce((a, q, i) => (i ? a + Math.hypot(q[0] - xy[i - 1][0], q[1] - xy[i - 1][1]) : 0), 0)) + 2;
  const last = xy[xy.length - 1];
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="a" d={`${line} L${last[0].toFixed(1)} ${h} L${w} ${h}Z`} style={{ fill: color }} />
      <path className="l" d={line} style={{ stroke: color, ['--len' as string]: len }} />
      <circle cx={last[0].toFixed(1)} cy={last[1].toFixed(1)} r="3.5" style={{ fill: color }} />
    </svg>
  );
}

const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
export interface Series { name: string; values: (number | null | undefined)[]; color?: string; dashed?: boolean }

export function LineChart({ series: raw, dates, xLabels, height = 280, negArea = true, xTicks = 6, label }: {
  series: Series[]; dates?: string[]; xLabels?: string[]; height?: number; negArea?: boolean; xTicks?: number; label?: string;
}) {
  usePrefs();
  const series = (raw || []).map((s, i) => ({ ...s, values: s.values.map((v) => (v == null ? null : +v)), color: s.color || CHART_COLORS[i % 4] }));
  const n = Math.max(0, ...series.map((s) => s.values.length));
  if (!n) return <div className="empty-note">لا بيانات للرسم</div>;
  const W = 1000, H = height, pl = 16, pr = 84, pt = 16, pb = 32;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  let max = Math.max(...all, 0), min = Math.min(...all, 0);
  const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
  max += pad; if (min < 0) min -= pad;
  const X = (i: number) => pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pr - pl);
  const Y = (v: number) => pt + ((max - v) / (max - min || 1)) * (H - pt - pb);
  const ticks = [max - pad, (max + min) / 2, 0, min < 0 ? min + pad : null].filter((v, i, a): v is number => v != null && a.indexOf(v) === i);
  const labelAt = (i: number) => (xLabels && xLabels[i] != null ? xLabels[i] : dates && dates[i] != null ? dateTxt(dates[i]) : digits(i + 1));
  const want = Math.min(n, xTicks);
  const tickIdx = Array.from({ length: want }, (_, k) => Math.round((k * (n - 1)) / Math.max(1, want - 1)));
  const s0 = series[0];
  let neg = '';
  if (negArea && s0) s0.values.forEach((v, i) => {
    if (v != null && v < 0) { const a = X(Math.max(0, i - 0.5)), b = X(Math.min(n - 1, i + 0.5)); neg += `M${a.toFixed(1)} ${Y(0).toFixed(1)}L${b.toFixed(1)} ${Y(0).toFixed(1)}L${b.toFixed(1)} ${Y(v).toFixed(1)}L${a.toFixed(1)} ${Y(v).toFixed(1)}Z`; }
  });
  const firstNeg = s0 ? s0.values.findIndex((v) => v != null && v < 0) : -1;
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" style={{ height: H }}
      aria-label={label || series.map((s) => s.name).join('، ')}>
      <g className="grid">
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={pl} x2={W - pr} y1={Y(v).toFixed(1)} y2={Y(v).toFixed(1)} />
            <text x={W - pr + 8} y={(Y(v) + 4).toFixed(1)}>{compact(v)}</text>
          </g>
        ))}
      </g>
      {neg && <path className="neg" d={neg} opacity=".9" />}
      {min < 0 && <line className="zero" x1={pl} x2={W - pr} y1={Y(0).toFixed(1)} y2={Y(0).toFixed(1)} />}
      {series.map((s, si) => {
        let d = '', pen = false, len = 0, prev: number[] | null = null;
        s.values.forEach((v, i) => {
          if (v == null) { pen = false; return; }
          const x = X(i), y = Y(v);
          d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
          if (pen && prev) len += Math.hypot(x - prev[0], y - prev[1]);
          prev = [x, y]; pen = true;
        });
        return <path key={si} className={s.dashed ? 'fc' : 'ln draw'} d={d} style={{ stroke: s.color, ['--len' as string]: Math.round(len) + 4 }} />;
      })}
      {tickIdx.map((i) => <text key={'x' + i} x={X(i).toFixed(1)} y={H - 8} textAnchor="middle">{labelAt(i)}</text>)}
      {firstNeg >= 0 && s0 && <circle className="cur-dot" cx={X(firstNeg).toFixed(1)} cy={Y(s0.values[firstNeg] as number).toFixed(1)} r="5" />}
      {s0 && s0.values.map((v, i) => v == null ? null : (
        <circle key={'h' + i} className="hit" cx={X(i).toFixed(1)} cy={Y(v).toFixed(1)} r="9">
          <title>{labelAt(i) + ' · ' + series.map((s) => s.name + ' ' + fmt(s.values[i])).join(' · ')}</title>
        </circle>
      ))}
    </svg>
  );
}

const TONE = { danger: 't-danger', ok: 't-ok', warn: 't-warn' } as const;
const TONE_COLOR = { danger: 'var(--danger-solid)', ok: 'var(--ok-solid)', warn: 'var(--warn-solid)' } as const;

function CountedInt({ value, countKey }: { value: number; countKey?: string }) {
  const v = useCountUp(value, countKey);
  return <span className="num">{int(v)}</span>;
}

export function Kpi({ label, value, money = true, tone, size = 'kpi', hint, spark, badge, badgeTone = 'neutral', crit, onClick, span = 3, i, countKey, testId }: {
  testId?: string;
  label: ReactNode; value: number | null | undefined; money?: boolean; tone?: 'danger' | 'ok' | 'warn';
  size?: 'hero' | 'kpi'; hint?: ReactNode; spark?: number[]; badge?: ReactNode; badgeTone?: PillTone;
  crit?: boolean; onClick?: () => void; span?: Span; i?: number; countKey?: string;
}) {
  usePrefs();
  const key = countKey ?? (typeof label === 'string' ? 'kpi:' + label : undefined);
  const val = value == null || !Number.isFinite(Number(value)) ? <span className="dash">—</span>
    : money ? <Money value={Number(value)} count countKey={key} /> : <CountedInt value={Number(value)} countKey={key} />;
  return (
    <section data-testid={testId} className={['isl', 'c' + span, 'ui-kpi', crit && 'crit', onClick && 'click'].filter(Boolean).join(' ')}
      style={i != null ? ({ '--i': i } as React.CSSProperties) : undefined}
      {...(onClick ? { role: 'button', tabIndex: 0, onClick, onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } } : {})}>
      <div className="ih"><h2>{crit && <span className="sev d" aria-hidden="true" />}{label}</h2>{badge != null && <Pill tone={badgeTone}>{badge}</Pill>}</div>
      <div className={(size === 'hero' ? 'hero' : 'kpi') + (tone ? ' ' + TONE[tone] : '')}>{val}</div>
      {hint != null && <div className="meta">{hint}</div>}
      {spark && spark.length > 1 && <Sparkline points={spark} color={tone ? TONE_COLOR[tone] : 'var(--chart-1)'} />}
    </section>
  );
}
