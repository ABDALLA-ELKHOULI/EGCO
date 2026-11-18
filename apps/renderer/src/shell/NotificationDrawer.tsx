/**
 * درج الإشعارات (يسار) — من prototype/shell.js: غير مقروء/الكل، تجميع حسب اليوم (اليوم/أمس/تاريخ)،
 * «تعليم الكل كمقروء»، أرشفة مع تراجع، النقر → يعلّمه مقروءاً وينتقل لرابطه.
 */
import { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Drawer } from '@/ui/Drawer';
import { Icon } from '@/ui/Icon';
import { Seg } from '@/ui/primitives';
import { toast } from '@/ui/Toast';
import { ago, dateTxt, digits } from '@/ui/format';
import { usePrefs } from '@/ui/prefs';
import { notifications, useNotifications, type AppEvent } from '@/data/notifications';
import { pathOf } from '@/app/routes';

/* ─ حالة الفتح (يفتحها زر الجزيرة، ⌘.، ولوحة الأوامر) ─ */
let open = false;
const subs = new Set<() => void>();
const set = (v: boolean) => { open = v; subs.forEach((f) => f()); };
export const openNotifications = () => set(!open);
export const closeNotifications = () => set(false);
export const useDrawerOpen = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => open);

function dayGroup(at: string) {
  const d = new Date(at), t = new Date();
  const key = (x: Date) => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
  if (key(d) === key(t)) return 'اليوم';
  const y = new Date(t); y.setDate(t.getDate() - 1);
  if (key(d) === key(y)) return 'أمس';
  return dateTxt(d, { weekday: true });
}
const SEV: Record<string, string> = { danger: 'd', warn: 'w', ok: 'o', info: 'i' };
const ICON: Record<string, string> = { d: '!', w: '△', o: '✓', i: 'i' };

export function linkPath(e: AppEvent): string | null {
  if (!e.link?.view) return null;
  return pathOf(e.link.view, e.link.params || {});
}

export function NotificationDrawer() {
  usePrefs();
  const isOpen = useDrawerOpen();
  const { items, unread } = useNotifications();
  const [tab, setTab] = useState<'unread' | 'all'>('unread');
  const nav = useNavigate();
  const list = tab === 'unread' ? items.filter((x) => !x.read) : items;
  const groups: { g: string; items: AppEvent[] }[] = [];
  for (const n of list) { const g = dayGroup(n.at); let grp = groups.find((x) => x.g === g); if (!grp) groups.push(grp = { g, items: [] }); grp.items.push(n); }

  const openNote = (n: AppEvent) => {
    notifications.markRead(n.id);
    const to = linkPath(n);
    if (to) { closeNotifications(); nav(to); }
  };
  return (
    <Drawer open={isOpen} onClose={closeNotifications} title="الإشعارات"
      actions={unread > 0 && <button type="button" className="lnk" onClick={() => notifications.markAllRead()}>تعليم الكل كمقروء</button>}
      sub={<div className="dtabs"><Seg label="عرض" value={tab} onChange={setTab}
        options={[{ value: 'unread', label: 'غير مقروء (' + digits(unread) + ')' }, { value: 'all', label: 'الكل' }]} /></div>}>
      {list.length ? groups.map((gr) => (
        <div key={gr.g}>
          <div className="grp">{gr.g}</div>
          {gr.items.map((n, i) => {
            const sev = SEV[n.severity] || 'i';
            return (
              <div key={n.id} className={'note' + (n.read ? ' read' : '')} style={{ animationDelay: Math.min(i, 8) * 40 + 'ms' }}
                tabIndex={0} role="button" aria-label={n.title}
                onClick={(e) => { if (!(e.target as HTMLElement).closest('.n-arch')) openNote(n); }}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openNote(n); } }}>
                <span className="ud" />
                <span className={'ic ' + sev}>{ICON[sev]}</span>
                <div className="bd"><div className="nt">{digits(n.title)}</div>{n.detail && <div className="nd">{digits(n.detail)}</div>}</div>
                <div className="n-side">
                  <span className="tm">{ago(n.at)}</span>
                  <button type="button" className="n-arch" aria-label="أرشفة" title="أرشفة"
                    onClick={() => { const undo = notifications.archive(n.id); toast('أُرشف الإشعار', { undo }); }}>
                    <Icon name="archive" size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )) : (
        <div className="dempty"><Icon name="bell" size={56} stroke={1.3} /><p>{tab === 'unread' ? 'لا شيء يحتاج انتباهك' : 'لا إشعارات'}</p></div>
      )}
    </Drawer>
  );
}
