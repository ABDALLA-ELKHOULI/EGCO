/**
 * مكوّنات صغيرة: Money · Num · Pill · Chip · Seg · Tabs · Button · PageHeader · Grid · Island ·
 * EmptyState · Skeleton. كلها ترسم فئات النموذج (archipelago.css) كما هي.
 */
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { digits, fmt, int } from './format';
import { usePrefs } from './prefs';
import { useCountUp } from './motion';
import { Icon, type IconName } from './Icon';

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

/* ─ أرقام ─ */
export function Money({ value, className, count, countKey, noCur }: {
  value: number | null | undefined; className?: string; count?: boolean; countKey?: string; noCur?: boolean;
}) {
  usePrefs();
  const v = value == null || !Number.isFinite(Number(value)) ? null : Number(value);
  const shown = useCountUp(count ? v : null, countKey);
  if (v == null) return <span className={cx('dash', className)}>—</span>;
  return <span className={cx('num', className)}>{fmt(count ? shown : v)}{!noCur && <span className="cur">ر.س</span>}</span>;
}
export function Num({ value, int: asInt, className }: { value: number | null | undefined; int?: boolean; className?: string }) {
  usePrefs();
  if (value == null || !Number.isFinite(Number(value))) return <span className={cx('dash', className)}>—</span>;
  return <span className={cx('num', className)}>{asInt || Number.isInteger(value) ? int(value) : fmt(value)}</span>;
}

/* ─ شارات وشرائح ─ */
export type PillTone = 'danger' | 'warn' | 'ok' | 'neutral';
const PT: Record<PillTone, string> = { danger: 'd', warn: 'w', ok: 'o', neutral: 'n' };
export function Pill({ tone = 'neutral', children, className }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return <span className={cx('pill', PT[tone], className)}>{children}</span>;
}
export function Chip({ pressed, onClick, count, children }: { pressed?: boolean; onClick?: () => void; count?: number; children: ReactNode }) {
  usePrefs();
  return (
    <button type="button" className="chip" aria-pressed={!!pressed} onClick={onClick}>
      {children}{count != null && <> <span className="num cap">{int(count)}</span></>}
    </button>
  );
}
export interface Opt<V extends string = string> { value: V; label: ReactNode; badge?: number | null; testId?: string }
export function Seg<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: Opt<V>[]; label?: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" data-testid={o.testId} aria-pressed={o.value === value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}
/** تبويبات داخل الصفحة — نفس شكل تبويبات القسم (.tabs). الأسهم تتنقل (RTL: يسار = التالي). */
export function Tabs<V extends string>({ value, onChange, tabs, label }: { value: V; onChange: (v: V) => void; tabs: Opt<V>[]; label?: string }) {
  usePrefs();
  const ref = useRef<HTMLDivElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    let i = tabs.findIndex((t) => t.value === value);
    i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
    onChange(tabs[i].value);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus());
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.value} role="tab" type="button" data-testid={t.testId} aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1}
          onClick={() => onChange(t.value)}>
          {t.label}{t.badge ? <span className="cnt2">{digits(t.badge)}</span> : null}
        </button>
      ))}
    </div>
  );
}

/* ─ زر ─ */
export function Button({ kind, size, icon, className, children, type, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'danger' | 'ghost'; size?: 'sm'; icon?: IconName;
}) {
  return (
    <button type={type || 'button'} className={cx('btn', kind, size, className)} {...rest}>
      {icon && <Icon name={icon} size={16} />}{children}
    </button>
  );
}

/* ─ تخطيط ─ */
export function PageHeader({ title, sub, actions, crumb }: {
  title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: { label: ReactNode; onClick: () => void };
}) {
  return (
    <div className="ph">
      <div>
        {crumb && <button type="button" className="crumb" onClick={crumb.onClick}>{crumb.label}</button>}
        <h1>{title}</h1>
        {sub != null && <p>{sub}</p>}
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}
export function Grid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('grid', className)}>{children}</div>;
}
export type Span = 3 | 4 | 6 | 8 | 12;
export function Island({ span = 12, title, link, actions, crit, onClick, i, className, children, label, testId }: {
  testId?: string;
  span?: Span; title?: ReactNode; link?: { label: ReactNode; onClick: () => void }; actions?: ReactNode;
  crit?: boolean; onClick?: () => void; i?: number; className?: string; children?: ReactNode; label?: string;
}) {
  const clickable = !!onClick;
  return (
    <section data-testid={testId} className={cx('isl', 'c' + span, crit && 'crit', clickable && 'click', className)}
      style={i != null ? ({ '--i': i } as React.CSSProperties) : undefined}
      {...(clickable ? {
        role: 'button', tabIndex: 0, 'aria-label': label, onClick,
        onKeyDown: (e: KeyboardEvent) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); onClick?.(); } },
      } : {})}>
      {(title != null || link || actions) && (
        <div className="ih">
          <h2>{crit && <span className="sev d" aria-hidden="true" />}{title}</h2>
          {(link || actions) && (
            <div className="acts">
              {actions}
              {link && <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); link.onClick(); }}>{link.label}</button>}
            </div>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

/* ─ فارغ / هيكل ─ */
export function EmptyState({ icon = 'inbox', title = 'لا شيء هنا بعد', body, cta, onCta }: {
  icon?: IconName | null; title?: ReactNode; body?: ReactNode; cta?: ReactNode; onCta?: () => void;
}) {
  return (
    <div className="ui-empty">
      {icon && <div className="ue-ic"><Icon name={icon} size={48} stroke={1.3} /></div>}
      <b>{title}</b>
      {body != null && <p>{body}</p>}
      {cta && <button type="button" className="btn primary" onClick={onCta}>{cta}</button>}
    </div>
  );
}
/** هيكل عظمي — يظهر فقط إن تجاوز التحميل 200ms (لا ومضة). */
export function Skeleton({ rows = 4, delay = 200 }: { rows?: number; delay?: number }) {
  const [show, setShow] = useState(delay <= 0);
  useEffect(() => { if (delay <= 0) return; const t = setTimeout(() => setShow(true), delay); return () => clearTimeout(t); }, [delay]);
  if (!show) return <div className="ui-skel" aria-busy="true" aria-label="جارٍ التحميل" />;
  return (
    <div className="ui-skel" aria-busy="true" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }, (_, i) => <i key={i} style={{ width: 92 - ((i * 17) % 40) + '%' }} />)}
    </div>
  );
}
