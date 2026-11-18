/* قطع صغيرة مشتركة في القسم. */
import { EmptyState, Money, Pill, digits, usePrefs } from '@/ui';
import type { Verdict } from '../logic/verdict';
import { trendOf } from '../logic/budget';

/** نسبة من كسر (0.17 → ١٧٫٠٪) أو من نسبة جاهزة (fromPct). */
export function Pct({ value, fromPct, className }: { value: number | null | undefined; fromPct?: boolean; className?: string }) {
  usePrefs();
  if (value == null || !Number.isFinite(value)) return <span className="dash">—</span>;
  const n = fromPct ? value : value * 100;
  return <span className={'num ' + (className ?? '')}>{digits(n.toFixed(1))}٪</span>;
}

export function VerdictPill({ v }: { v: Verdict }) {
  if (v.kind === 'unknown') return <Pill tone="neutral">لا حكم — {v.reasons[0] ?? 'قيمة العقد غير مُدخلة'}</Pill>;
  if (v.kind === 'loss') return <Pill tone="warn">يخسر · <Money value={Math.abs(v.margin ?? 0)} /></Pill>;
  if (v.kind === 'watch') return <Pill tone="warn">يكسب بهامش ضيق · <Pct value={v.marginPct} fromPct /></Pill>;
  return <Pill tone="ok">يكسب · هامش <Pct value={v.marginPct} fromPct /></Pill>;
}

/** سهم الاتجاه بين شهرين (Budget.tsx:45-55) — سالبٌ = تحسّن. */
export function DeltaArrow({ deltaPp }: { deltaPp: number | null | undefined }) {
  usePrefs();
  const t = trendOf(deltaPp);
  if (t === 'none') return <span className="dash">—</span>;
  if (t === 'flat') return <span className="cap">= بلا تغيّر</span>;
  const good = t === 'improving';
  return (
    <span className={good ? 't-ok' : 't-warn'}>
      {good ? '↓ يتحسّن' : '↑ يتفاقم'} {digits(Math.abs(deltaPp as number).toFixed(2))} ن.م
    </span>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState icon="alert" title="تعذّر التحميل" body={String((error as Error)?.message ?? error)}
      cta={onRetry ? 'إعادة المحاولة' : undefined} onCta={onRetry} />
  );
}

