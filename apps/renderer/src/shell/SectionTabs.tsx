/**
 * تبويبات القسم — تُبنى تلقائياً من السجل (tabsOf): تظهر إن كان للقسم ≥ ٢ تبويب. عدّاد أحمر من
 * useBadge لكل عرض. أسهم ←/→ تتنقل (RTL)، Home/End.
 */
import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { SectionKey, ViewDef } from '@/app/registry';
import { pathOf, tabsOf } from '@/app/routes';
import { digits } from '@/ui/format';
import { usePrefs } from '@/ui/prefs';

// الشارة في مكوّن منفصل: لكل عرض خطّافه الخاص (أو لا شيء)، فتغيّر العرض لا يغيّر ترتيب خطّافات الزر
function Badge({ use }: { use: () => number | null | undefined }) {
  usePrefs();
  const n = use() || 0;
  return n > 0 ? <span className="cnt2">{digits(n)}</span> : null;
}

function TabButton({ v, active }: { v: ViewDef; active: boolean }) {
  const nav = useNavigate();
  return (
    <button role="tab" type="button" aria-selected={active} tabIndex={active ? 0 : -1} data-tab={v.key}
      onClick={() => { const to = pathOf(v.key); if (to) nav(to); }}>
      {v.tab}{v.useBadge && <Badge key={v.key} use={v.useBadge} />}
    </button>
  );
}

export function SectionTabs({ section, current }: { section: SectionKey | null; current: ViewDef | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const nav = useNavigate();
  const tabs = section ? tabsOf(section) : [];
  if (tabs.length < 2) return <div className="tabs" role="tablist" hidden />;
  const active = current?.tab ? current.key : current?.parentTab || tabs[0].key;
  return (
    <div className="tabs" role="tablist" aria-label="صفحات القسم" ref={ref}
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        const b = (e.target as HTMLElement).closest<HTMLElement>('[data-tab]'); if (!b) return;
        e.preventDefault();
        let i = tabs.findIndex((t) => t.key === b.dataset.tab);
        i = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? 1 : -1) + tabs.length) % tabs.length;
        const to = pathOf(tabs[i].key); if (to) nav(to);
        requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(tabs[i].key)}"]`)?.focus());
      }}>
      {tabs.map((v) => <TabButton key={v.key} v={v} active={v.key === active} />)}
    </div>
  );
}
