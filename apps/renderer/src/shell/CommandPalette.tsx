/**
 * لوحة الأوامر ⌘K — من prototype/shell.js: الصفحات (كل تبويب)، الموردون، المقاولون، المشاريع،
 * إجراءات (نسخة احتياطية، الإشعارات، الوضع، الأرقام، طي الشريط) + أوامر الأقسام (SectionModule.commands).
 * بحث بتطبيع عربي، ↑/↓/Enter/Esc، aria combobox/listbox.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/ui/Icon';
import { normAr } from '@/ui/format';
import { cycleTheme, getPrefs, setPrefs, toggleDigits } from '@/ui/prefs';
import { toast } from '@/ui/Toast';
import { popLayer, pushLayer, type Layer } from '@/ui/overlay';
import { isModalOpen } from '@/ui/overlay';
import { useContractors, useProjects, useSuppliers } from '@/data/hooks';
import { api } from '@/lib/api';
import { invalidate } from '@/data/queryClient';
import { getRegistry, useGo } from '@/app/routes';
import type { Go } from '@/app/registry';
import { sectionOf } from './sections';
import { closeNotifications, openNotifications } from './NotificationDrawer';
import { island } from './islandStore';

let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { open = v; subs.forEach((f) => f()); };
export function openPalette() { if (open) { set(false); return; } if (isModalOpen()) return; closeNotifications(); set(true); }
export const closePalette = () => set(false);
const usePalOpen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => open);

interface Item { group: string; label: string; sub: string; keywords?: string; run: () => void }
type Rows = { rows?: Record<string, unknown>[]; items?: Record<string, unknown>[] } | Record<string, unknown>[] | undefined;
const rowsOf = (d: unknown) => { const x = d as Rows; return Array.isArray(x) ? x : x?.rows || x?.items || []; };

export async function backupNow() {
  island.event('backup', { phase: 'start' });
  try {
    const r = await api.createBackup();
    island.event('backup', { phase: 'done', sizeKb: r.backup?.size_bytes ? r.backup.size_bytes / 1024 : null });
    void invalidate(['backups']);
    if (r.backup?.warning) toast(r.backup.warning, { kind: 'info' });
  } catch (e) {
    island.release('s3');
    toast('تعذّرت النسخة الاحتياطية: ' + String((e as Error).message || e), { kind: 'error' });
  }
}

export function CommandPalette() {
  const isOpen = usePalOpen();
  if (!isOpen) return null;
  return createPortal(<PaletteInner />, document.body);
}

function PaletteInner() {
  const go = useGo();
  const [q, setQ] = useState('');
  const [idx, setIdx] = useState(0);
  const inp = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sup = useSuppliers({});
  const con = useContractors({});
  const prj = useProjects();

  const src = useMemo(() => buildSource(go, sup.data, con.data, prj.data), [go, sup.data, con.data, prj.data]);
  const items = useMemo(() => {
    const nq = normAr(q);
    return (nq ? src.filter((x) => normAr(x.label + ' ' + x.sub + ' ' + x.group + ' ' + (x.keywords || '')).includes(nq))
      : src.filter((x) => x.group === 'الصفحات' || x.group === 'إجراءات')).slice(0, 40);
  }, [q, src]);
  const cur = Math.min(idx, Math.max(0, items.length - 1));

  useEffect(() => {
    const layer: Layer = { kind: 'palette', key: (e) => { if (e.key === 'Escape') { e.preventDefault(); closePalette(); } } };
    pushLayer(layer);
    inp.current?.focus();
    return () => popLayer(layer);
  }, []);
  useEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [cur]);

  const run = (i: number) => { const it = items[i]; closePalette(); if (it) try { it.run(); } catch (e) { console.error(e); } };
  let g: string | null = null;
  return (
    <div className="pal-scrim" lang="ar" dir="rtl" onMouseDown={(e) => { if (e.target === e.currentTarget) closePalette(); }}>
      <div className="pal" role="dialog" aria-modal="true" aria-label="بحث شامل">
        <div className="pal-in">
          <Icon name="search" size={18} />
          <input ref={inp} type="text" placeholder="ابحث عن مورد، مقاول، مشروع، صفحة…" aria-label="بحث" role="combobox"
            aria-expanded="true" aria-controls="palList" autoComplete="off" value={q}
            aria-activedescendant={items.length ? 'pal' + cur : undefined}
            onChange={(e) => { setQ(e.target.value); setIdx(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setIdx(Math.min(items.length - 1, cur + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx(Math.max(0, cur - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(cur); }
              else if (e.key === 'Tab') e.preventDefault();
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="pal-list" id="palList" role="listbox" ref={listRef}>
          {items.length ? items.map((x, i) => {
            const head = x.group !== g ? <div className="pal-g">{(g = x.group)}</div> : null;
            return (
              <div key={x.group + ':' + x.label + ':' + i}>
                {head}
                <div className="pal-i" role="option" id={'pal' + i} aria-selected={i === cur}
                  onMouseMove={() => { if (i !== cur) setIdx(i); }} onClick={() => run(i)}>
                  <span>{x.label}</span><span className="cap num">{x.sub}</span>
                </div>
              </div>
            );
          }) : <div className="pal-none">لا نتائج لـ«{q}»</div>}
        </div>
      </div>
    </div>
  );
}

function buildSource(go: Go, sup: unknown, con: unknown, prj: unknown): Item[] {
  const reg = getRegistry();
  const out: Item[] = [];
  for (const v of reg.views) if (v.tab) out.push({ group: 'الصفحات', label: v.tab, sub: sectionOf(v.section || '')?.label || '', keywords: v.title, run: () => go(v.key) });
  for (const s of rowsOf(sup)) if (s.account) out.push({ group: 'الموردون', label: String(s.name ?? s.account), sub: String(s.account), run: () => go('supplier', { account: String(s.account) }) });
  for (const c of rowsOf(con)) if (c.code) out.push({ group: 'المقاولون', label: String(c.name ?? c.code), sub: String(c.code), run: () => go('contractor', { code: String(c.code) }) });
  for (const p of rowsOf(prj)) { const n = p.name ?? p.project; if (n) out.push({ group: 'المشاريع', label: String(n), sub: 'مشروع', run: () => go('project', { project: String(n) }) }); }
  for (const c of reg.commands) out.push({ group: c.group, label: c.label, sub: c.sub || '', keywords: c.keywords, run: () => c.run({ go }) });
  out.push({ group: 'إجراءات', label: 'استيراد ملفات', sub: 'البيانات', run: () => go('import') });
  out.push({ group: 'إجراءات', label: 'نسخة احتياطية الآن', sub: '', run: () => { void backupNow(); } });
  out.push({ group: 'إجراءات', label: 'فتح الإشعارات', sub: '⌘.', run: () => openNotifications() });
  out.push({ group: 'إجراءات', label: 'تبديل الوضع (فاتح/داكن/تلقائي)', sub: '', run: cycleTheme });
  out.push({ group: 'إجراءات', label: 'تبديل الأرقام 123 / ١٢٣', sub: '', run: toggleDigits });
  out.push({ group: 'إجراءات', label: getPrefs().sideCollapsed ? 'توسيع الشريط الجانبي' : 'طي الشريط الجانبي', sub: '', run: () => setPrefs({ sideCollapsed: !getPrefs().sideCollapsed }) });
  return out;
}
