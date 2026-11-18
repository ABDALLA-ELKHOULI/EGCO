/**
 * DataTable — React port لـ prototype/ui.js «الجدول»: فرز، بحث بتطبيع عربي، شرائح تصفية بعدّاداتها،
 * تحديد متعدد + شريط تحديد عائم بمجموعه وإجراءاته، قائمة أعمدة محفوظة، صف إجمالي من كل الصفوف
 * المصفّاة، رأس لاصق، حالات فراغ، لوحة مفاتيح، وافتراضية فوق ٢٠٠ صف (تُعطَّل عند الطباعة).
 *
 * mode="server": لا فرز/بحث/تصفية محلياً — الخادم يرتّب المجموعة كاملة (CLAUDE.md §٢)، والجدول
 * يبلّغ onQueryChange ويعرض totals/filterCounts القادمة من الخادم.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { dateTxt, digits, fmt, int, normAr, sumHalalas } from './format';
import { usePrefs, setUiPref, uiPref } from './prefs';
import { EmptyState } from './primitives';
import { Icon, type IconName } from './Icon';
import { Money } from './primitives';

export interface Column<T> {
  key: string;
  label: ReactNode;
  money?: boolean;
  num?: boolean;
  decimals?: boolean;
  date?: boolean;
  year?: boolean;
  render?: (r: T) => ReactNode;
  value?: (r: T) => unknown;
  sortValue?: (r: T) => unknown;
  searchValue?: (r: T) => unknown;
  totalValue?: (r: T) => unknown;
  sort?: boolean;
  hidden?: boolean;
  required?: boolean;
  width?: number | string;
  className?: string;
}
export interface FilterOption<T> { value: string; label: ReactNode; test?: (r: T) => boolean }
export interface Filter<T> { key: string; label?: ReactNode; options: FilterOption<T>[]; test?: (r: T, value: string) => boolean }
export interface SortState { key: string; dir: 'asc' | 'desc' }
export interface TableQuery { q: string; sort: SortState | null; filters: Record<string, string | null> }
export interface SelectionAction<T> { label: ReactNode; kind?: 'primary' | 'danger'; onClick: (chosen: T[], clear: () => void) => void }

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey?: keyof T & string | ((r: T) => string | number);
  id?: string;
  mode?: 'client' | 'server';
  onQueryChange?: (q: TableQuery) => void;
  totals?: Record<string, number | null | undefined>;
  filterCounts?: Record<string, Record<string, number>>;
  sort?: SortState | null;
  search?: boolean;
  searchPlaceholder?: string;
  searchKeys?: string[];
  filters?: Filter<T>[];
  columnMenu?: boolean;
  toolbar?: ReactNode;
  total?: { keys: string[]; label?: ReactNode; money?: boolean };
  selectable?: boolean;
  selected?: Set<string>;
  onSelect?: (keys: Set<string>, rows: T[]) => void;
  selectionBar?: { label?: ReactNode; sumKey?: string; sumValue?: (r: T) => unknown; hint?: ReactNode; actions?: SelectionAction<T>[] };
  onRowClick?: (r: T, e: React.SyntheticEvent) => void;
  rowClass?: (r: T) => string | undefined;
  density?: 'compact';
  empty?: { icon?: IconName; title?: ReactNode; body?: ReactNode; cta?: ReactNode; onCta?: () => void };
  /** عتبة الافتراضية (افتراضي 200). */
  virtualizeAbove?: number;
  /** data-testid لكل صف. */
  rowTestId?: (r: T) => string;
}

const VIRTUAL_H = 'min(70vh, 720px)';

export function DataTable<T>(o: DataTableProps<T>) {
  usePrefs();
  const server = o.mode === 'server';
  const cols = useMemo(() => o.columns.map((c) => ({ sort: true, ...c })), [o.columns]);
  const keyOf = (r: T): string => String(typeof o.rowKey === 'function' ? o.rowKey(r) : (r as Record<string, unknown>)[o.rowKey || 'id']);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortState | null>(o.sort ?? null);
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(o.id ? uiPref<string[]>('cols:' + o.id, cols.filter((c) => c.hidden).map((c) => c.key)) : cols.filter((c) => c.hidden).map((c) => c.key)));
  const [ownSel, setOwnSel] = useState<Set<string>>(() => new Set());
  const selected = o.selected ?? ownSel;
  const [menu, setMenu] = useState(false);
  const [printing, setPrinting] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => { if (server) o.onQueryChange?.({ q, sort, filters }); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, filters, server]);
  useEffect(() => {
    const b = () => setPrinting(true), a = () => setPrinting(false);
    window.addEventListener('beforeprint', b); window.addEventListener('afterprint', a);
    return () => { window.removeEventListener('beforeprint', b); window.removeEventListener('afterprint', a); };
  }, []);

  const vis = cols.filter((c) => !hidden.has(c.key));
  const valOf = (c: Column<T>, r: T) => (c.sortValue ? c.sortValue(r) : c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const searchKeys = o.searchKeys || cols.map((c) => c.key);
  const searchText = (r: T) => normAr(searchKeys.map((k) => {
    const c = cols.find((x) => x.key === k);
    const v = c?.searchValue ? c.searchValue(r) : (r as Record<string, unknown>)[k];
    return v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v);
  }).join(' '));
  const matchFilter = (f: Filter<T>, op: FilterOption<T>, r: T) => {
    if (op.test) return op.test(r);
    if (f.test) return f.test(r, op.value);
    const v = (r as Record<string, unknown>)[f.key];
    return Array.isArray(v) ? v.map(String).includes(op.value) : String(v) === op.value;
  };
  const filtered = (skip?: string) => {
    if (server) return o.rows;
    const nq = normAr(q);
    return o.rows.filter((r) => {
      if (nq && !searchText(r).includes(nq)) return false;
      for (const f of o.filters || []) {
        if (f.key === skip) continue;
        const v = filters[f.key]; if (v == null) continue;
        const op = f.options.find((x) => x.value === v); if (op && !matchFilter(f, op, r)) return false;
      }
      return true;
    });
  };
  const list0 = filtered();
  const list = useMemo(() => {
    if (server || !sort) return list0;
    const c = cols.find((x) => x.key === sort.key); if (!c) return list0;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return list0.slice().sort((a, b) => {
      const va = valOf(c, a), vb = valOf(c, b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'ar', { numeric: true }) * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list0, sort, server, cols]);

  const emitSel = (s: Set<string>) => {
    if (!o.selected) setOwnSel(new Set(s));
    o.onSelect?.(s, o.rows.filter((r) => s.has(keyOf(r))));
  };
  const toggle = (k: string) => { const s = new Set(selected); if (s.has(k)) s.delete(k); else s.add(k); emitSel(s); };
  const clearSel = () => emitSel(new Set());
  const allSel = !!o.selectable && list.length > 0 && list.every((r) => selected.has(keyOf(r)));

  const clickSort = (c: Column<T>) => {
    const first = c.num || c.money ? 'desc' : 'asc', second = first === 'desc' ? 'asc' : 'desc';
    setSort((s) => (!s || s.key !== c.key ? { key: c.key, dir: first } : s.dir === first ? { key: c.key, dir: second } : o.sort ?? null));
  };
  const cell = (c: Column<T>, r: T): ReactNode => {
    if (c.render) return c.render(r);
    const v = (r as Record<string, unknown>)[c.key];
    if (v == null || v === '') return <span className="dash">—</span>;
    if (c.money) return <Money value={Number(v)} />;
    if (c.num && typeof v === 'number') return <span className="num">{Number.isInteger(v) && !c.decimals ? int(v) : fmt(v)}</span>;
    if (c.date) return dateTxt(v, { year: c.year });
    return digits(v);
  };

  // ─ الافتراضية: صفوف بارتفاع ثابت داخل إطار قابل للتمرير، صفّا حشو أعلى/أسفل ─
  const rowH = o.density === 'compact' ? 36 : 48;
  const virtual = !printing && list.length > (o.virtualizeAbove ?? 200);
  const wrap = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(720);
  useEffect(() => {
    if (!virtual || !wrap.current) return;
    const el = wrap.current;
    const on = () => setScrollTop(el.scrollTop);
    const ro = new ResizeObserver(() => setViewH(el.clientHeight || 720));
    ro.observe(el); el.addEventListener('scroll', on, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', on); };
  }, [virtual]);
  const over = 10;
  const start = virtual ? Math.max(0, Math.floor(scrollTop / rowH) - over) : 0;
  const end = virtual ? Math.min(list.length, Math.ceil((scrollTop + viewH) / rowH) + over) : list.length;
  const shown = list.slice(start, end);

  const totalKeys = o.total?.keys || [];
  const sums = useMemo(() => {
    const s: Record<string, number | null> = {};
    for (const k of totalKeys) {
      if (server) { s[k] = o.totals?.[k] ?? null; continue; }
      const c = cols.find((x) => x.key === k);
      s[k] = sumHalalas(list, (r) => (c?.totalValue ? c.totalValue(r) : (r as Record<string, unknown>)[k]));
    }
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, totalKeys.join('|'), server, o.totals]);

  const span = vis.length + (o.selectable ? 1 : 0);
  const onRowKey = (e: KeyboardEvent<HTMLTableRowElement>, r: T) => {
    if (e.target !== e.currentTarget) return;
    const tr = e.currentTarget;
    if (e.key === 'Enter' || (e.key === ' ' && !o.selectable)) { e.preventDefault(); o.onRowClick?.(r, e); }
    else if (e.key === ' ' && o.selectable) { e.preventDefault(); toggle(keyOf(r)); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = (e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling) as HTMLElement | null;
      if (n?.dataset.k != null) n.focus();
      else if (virtual && wrap.current) wrap.current.scrollTop += e.key === 'ArrowDown' ? rowH : -rowH;
    }
  };

  const hasBar = o.search !== false || (o.filters || []).length > 0 || o.columnMenu !== false || !!o.toolbar;
  const sel = o.selectable && selected.size > 0 ? o.rows.filter((r) => selected.has(keyOf(r))) : [];
  const sb = o.selectionBar || {};
  const sumKey = sb.sumKey || totalKeys[0] || cols.find((c) => c.money || c.num)?.key;
  const selSum = sumKey ? sumHalalas(sel, (r) => (sb.sumValue ? sb.sumValue(r) : (r as Record<string, unknown>)[sumKey])) : null;

  return (
    <div className={'ui-tbl' + (o.density === 'compact' ? ' compact' : '')} ref={root}>
      {hasBar && (
        <div className="ut-bar">
          {o.search !== false && (
            <label className="ut-search">
              <Icon name="search" size={16} />
              <input type="search" placeholder={o.searchPlaceholder || 'بحث…'} aria-label="بحث في الجدول" data-no-dirty
                value={q} onChange={(e) => setQ(e.target.value)} />
            </label>
          )}
          <div className="ut-tools">
            {o.toolbar}
            {o.columnMenu !== false && (
              <>
                <button type="button" className="btn sm ut-colbtn" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
                  <Icon name="columns" size={14} />الأعمدة
                </button>
                {menu && <ColMenu cols={cols} hidden={hidden} onClose={() => setMenu(false)} onChange={(h) => {
                  setHidden(h); if (o.id) setUiPref('cols:' + o.id, [...h]);
                }} />}
              </>
            )}
          </div>
        </div>
      )}
      {(o.filters || []).length > 0 && (
        <div className="ut-chips">
          {(o.filters || []).map((f) => {
            const base = server ? null : filtered(f.key);
            const cnt = (op?: FilterOption<T>) => server
              ? (op ? o.filterCounts?.[f.key]?.[op.value] : o.filterCounts?.[f.key]?.['']) ?? null
              : op ? base!.filter((r) => matchFilter(f, op, r)).length : base!.length;
            const C = ({ n }: { n: number | null }) => (n == null ? null : <> <span className="num cap">{int(n)}</span></>);
            return (
              <div key={f.key} className="filters ut-fgroup" role="group" aria-label={typeof f.label === 'string' ? f.label : undefined}>
                {f.label && <span className="cap ut-flabel">{f.label}</span>}
                <button type="button" className="chip" aria-pressed={filters[f.key] == null} onClick={() => setFilters((x) => ({ ...x, [f.key]: null }))}>
                  الكل<C n={cnt()} />
                </button>
                {f.options.map((op) => (
                  <button key={op.value} type="button" className="chip" aria-pressed={filters[f.key] === op.value}
                    onClick={() => setFilters((x) => ({ ...x, [f.key]: op.value }))}>
                    {op.label}<C n={cnt(op)} />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
      {!o.rows.length && !server ? (
        <div className="ut-foot"><EmptyState icon={o.empty?.icon ?? 'inbox'} title={o.empty?.title ?? 'لا توجد سجلات'} body={o.empty?.body} cta={o.empty?.cta} onCta={o.empty?.onCta} /></div>
      ) : (
        <div className="tbl-wrap" ref={wrap} style={virtual ? { maxHeight: VIRTUAL_H, overflowY: 'auto' } : undefined}>
          <table aria-rowcount={list.length + 1}>
            <thead>
              <tr>
                {o.selectable && (
                  <th className="selc">
                    <button type="button" className="sel" role="checkbox" aria-checked={allSel} aria-label="تحديد الكل"
                      onClick={() => { const s = new Set(selected); list.forEach((r) => (allSel ? s.delete(keyOf(r)) : s.add(keyOf(r)))); emitSel(s); }} />
                  </th>
                )}
                {vis.map((c) => {
                  const s = sort && sort.key === c.key ? sort.dir : null;
                  return (
                    <th key={c.key} className={c.num || c.money ? 'n' : undefined} style={c.width ? { width: c.width } : undefined}
                      aria-sort={s ? (s === 'asc' ? 'ascending' : 'descending') : undefined}>
                      {c.sort !== false ? (
                        <button type="button" className="ut-sort" onClick={() => clickSort(c)}>
                          {c.label}<span className="ut-arr" aria-hidden="true">{s === 'asc' ? '↑' : s === 'desc' ? '↓' : ''}</span>
                        </button>
                      ) : c.label}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {!list.length ? (
                <tr className="ut-none"><td colSpan={span}>
                  <EmptyState icon="search" title="لا نتائج مطابقة" body="جرّب كلمة أخرى أو أزل التصفية" cta="مسح البحث والتصفية"
                    onCta={() => { setQ(''); setFilters({}); }} />
                </td></tr>
              ) : (
                <>
                  {virtual && start > 0 && <tr aria-hidden="true" style={{ height: start * rowH }}><td colSpan={span} style={{ padding: 0, border: 0, height: 'auto' }} /></tr>}
                  {shown.map((r, i) => {
                    const k = keyOf(r), isSel = selected.has(k);
                    const cls = [o.onRowClick && 'go', isSel && 'picked', o.rowClass?.(r)].filter(Boolean).join(' ');
                    return (
                      <tr key={k} data-k={k} data-testid={o.rowTestId?.(r)} className={cls || undefined} aria-rowindex={start + i + 2}
                        tabIndex={o.onRowClick || o.selectable ? 0 : undefined} onKeyDown={(e) => onRowKey(e, r)}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest('a,button,input,select,textarea,label')) return;
                          if (o.onRowClick) o.onRowClick(r, e); else if (o.selectable) toggle(k);
                        }}>
                        {o.selectable && (
                          <td className="selc"><button type="button" className="sel" role="checkbox" aria-checked={isSel} aria-label="تحديد الصف"
                            tabIndex={-1} onClick={() => toggle(k)} /></td>
                        )}
                        {vis.map((c) => <td key={c.key} className={[(c.num || c.money) && 'n', c.className].filter(Boolean).join(' ') || undefined}>{cell(c, r)}</td>)}
                      </tr>
                    );
                  })}
                  {virtual && end < list.length && <tr aria-hidden="true" style={{ height: (list.length - end) * rowH }}><td colSpan={span} style={{ padding: 0, border: 0, height: 'auto' }} /></tr>}
                </>
              )}
            </tbody>
            {o.total && list.length > 0 && (
              <tfoot>
                <tr>
                  {o.selectable && <td />}
                  {(() => {
                    let placed = false;
                    return vis.map((c) => {
                      if (totalKeys.includes(c.key)) return <td key={c.key} className="n">{c.money || o.total!.money !== false ? <Money value={sums[c.key]} /> : <span className="num">{fmt(sums[c.key])}</span>}</td>;
                      if (!placed) { placed = true; return <td key={c.key}>{o.total!.label || 'الإجمالي'} <span className="cap">({int(list.length)})</span></td>; }
                      return <td key={c.key} />;
                    });
                  })()}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
      {sel.length > 0 && (
        <div className="ut-selhost">
          <div className="paybar ut-selbar" role="region" aria-label="التحديد">
            <span>{sb.label || 'المحدد'} · <span className="num">{int(sel.length)}</span></span>
            {selSum != null && <span className="big num">{fmt(selSum)}<span className="cur ut-selcur">ر.س</span></span>}
            {sb.hint && <span className="st-dim">{sb.hint}</span>}
            <span className="ut-selacts">
              {(sb.actions || []).map((a, i) => (
                <button key={i} type="button" className={'btn sm' + (a.kind === 'primary' || (!a.kind && i === 0) ? ' primary' : a.kind === 'danger' ? ' danger' : '')}
                  onClick={() => a.onClick(sel, clearSel)}>{a.label}</button>
              ))}
              <button type="button" className="btn sm ut-clear" onClick={clearSel}>إلغاء التحديد</button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ColMenu<T>({ cols, hidden, onChange, onClose }: { cols: Column<T>[]; hidden: Set<string>; onChange: (h: Set<string>) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLInputElement>('input:not([disabled])')?.focus();
    const out = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current && !ref.current.contains(t) && !(t as HTMLElement).closest?.('.ut-colbtn')) onClose();
    };
    document.addEventListener('mousedown', out, true);
    return () => document.removeEventListener('mousedown', out, true);
  }, [onClose]);
  return (
    <div className="ut-pop" role="menu" ref={ref} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
      <div className="cap ut-poph">إظهار الأعمدة</div>
      {cols.map((c) => (
        <label key={c.key} className="ut-popi">
          <input type="checkbox" data-no-dirty checked={!hidden.has(c.key)} disabled={c.required}
            onChange={(e) => {
              const h = new Set(hidden);
              if (e.target.checked) h.delete(c.key);
              else { if (cols.length - h.size <= 1) return; h.add(c.key); }
              onChange(h);
            }} />
          <span>{c.label}</span>
        </label>
      ))}
    </div>
  );
}
