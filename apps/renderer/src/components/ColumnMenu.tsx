import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * قائمة العمود — الترتيب والتصفية في مكان واحد، كما في جداول Google.
 *
 * كل التصفية والترتيب يجريان على الخادم على المجموعة كاملةً، لا على الصفحة المعروضة.
 * That is not an implementation detail: sorting or filtering in the browser would leave
 * the totals row describing a different set than the rows above it, and this app's
 * whole contract is that every number on screen can be traced and adds up.
 */

export type SortDir = 'asc' | 'desc';
export interface SortState { key: string; dir: SortDir }

export type FilterControl =
  | { kind: 'text'; value: string; onChange: (v: string) => void; placeholder?: string }
  | { kind: 'select'; value: string; onChange: (v: string) => void;
      options: { value: string; label: string; hint?: string }[]; allLabel?: string }
  | { kind: 'range'; min: string; max: string;
      onMin: (v: string) => void; onMax: (v: string) => void; unit?: string }
  | { kind: 'dateRange'; from: string; to: string;
      onFrom: (v: string) => void; onTo: (v: string) => void };

export interface ColumnMenuProps {
  /** مفتاح الترتيب على الخادم — غيابه يعني عموداً غير قابل للترتيب */
  sortKey?: string;
  sort: SortState | null;
  onSort: (s: SortState | null) => void;
  filter?: FilterControl;
  /** هل لهذا العمود تصفية نشطة الآن — تُظهر النقطة على الأيقونة */
  active?: boolean;
  /** تسميتا الترتيب — «الأقدم/الأحدث» أوضح من «تصاعدي» في عمود تواريخ */
  ascLabel?: string;
  descLabel?: string;
}

export function ColumnMenu({ sortKey, sort, onSort, filter, active,
                             ascLabel = 'ترتيب تصاعدي', descLabel = 'ترتيب تنازلي' }: ColumnMenuProps) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const dir = sort && sort.key === sortKey ? sort.dir : null;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // موضع ثابت محسوب من الزر، لا موضع نسبي: البطاقة الحاوية تقصّ ما يفيض عنها
  // (‏.card { overflow: hidden })، فقائمة منسدلة داخلها تُقتطع نصفها. الحساب هنا
  // يُبقيها داخل الشاشة أفقياً أيضاً حين يكون العمود عند الحافة.
  useLayoutEffect(() => {
    const el = panel.current;
    const btn = wrap.current;
    if (!open || !el || !btn) return;
    const b = btn.getBoundingClientRect();
    el.style.top = `${b.bottom + 6}px`;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, b.right - w), window.innerWidth - w - 8);
    el.style.left = `${left}px`;
  }, [open]);

  // إغلاقها عند التمرير — قائمة معلّقة بموضع ثابت تنفصل عن عمودها إن تحرّك الجدول.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  const set = (d: SortDir) => {
    if (!sortKey) return;
    onSort(dir === d ? null : { key: sortKey, dir: d });
  };

  return (
    <span className="col-menu-wrap" ref={wrap}>
      <button
        type="button"
        className={'col-menu-btn' + (open ? ' open' : '') + (dir || active ? ' on' : '')}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="ترتيب وتصفية العمود"
      >
        {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '▾'}
        {active && <i className="col-menu-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="col-menu" ref={panel} role="menu">
          {sortKey && (
            <div className="col-menu-sort">
              <button type="button" className={dir === 'asc' ? 'on' : ''}
                      onClick={() => set('asc')}>▲ {ascLabel}</button>
              <button type="button" className={dir === 'desc' ? 'on' : ''}
                      onClick={() => set('desc')}>▼ {descLabel}</button>
            </div>
          )}

          {filter && (
            <div className="col-menu-filter">
              {filter.kind === 'text' && (
                <input autoFocus value={filter.value} placeholder={filter.placeholder ?? 'تصفية…'}
                       onChange={(e) => filter.onChange(e.target.value)} />
              )}

              {filter.kind === 'select' && (
                <select autoFocus value={filter.value}
                        onChange={(e) => filter.onChange(e.target.value)}>
                  <option value="">{filter.allLabel ?? 'الكل'}</option>
                  {filter.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}{o.hint ? ` — ${o.hint}` : ''}
                    </option>
                  ))}
                </select>
              )}

              {filter.kind === 'range' && (
                <div className="col-menu-pair">
                  <input inputMode="decimal" placeholder="من" value={filter.min}
                         onChange={(e) => filter.onMin(e.target.value)} />
                  <input inputMode="decimal" placeholder="إلى" value={filter.max}
                         onChange={(e) => filter.onMax(e.target.value)} />
                  {filter.unit && <span className="muted">{filter.unit}</span>}
                </div>
              )}

              {filter.kind === 'dateRange' && (
                <div className="col-menu-pair">
                  <input type="date" value={filter.from}
                         onChange={(e) => filter.onFrom(e.target.value)} />
                  <input type="date" value={filter.to}
                         onChange={(e) => filter.onTo(e.target.value)} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </span>
  );
}

/** عنوان عمود بقائمته — يوحّد المسافة بين النص والزر في كل الجداول. */
export function Th({ label, className, ...menu }: ColumnMenuProps &
                   { label: string; className?: string }) {
  return (
    <th className={className}>
      <span className="th-inner">
        <span>{label}</span>
        <ColumnMenu {...menu} />
      </span>
    </th>
  );
}
