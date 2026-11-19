/**
 * مخزن الإشعارات — مرآة لـ /api/v1/events (الخادم B) + إشعارات محلية (إعادة تشغيل الخدمة، تحديث…).
 * القراءة/الأرشفة تفاؤلية (ليست أرقاماً مالية) ثم تُرسَل للخادم. الأرشفة لها «تراجع»: الطلب يُؤجَّل
 * 6 ثوانٍ لأن العقد لا يملك «إلغاء أرشفة».
 */
import { useSyncExternalStore } from 'react';
import { request } from './client';

export type Severity = 'danger' | 'warn' | 'ok' | 'info';
export interface EventLink { view: string; params?: Record<string, string | number | null | undefined> }
export interface AppEvent {
  id: string;
  at: string;
  kind: string;
  severity: Severity;
  title: string;
  detail?: string | null;
  link?: EventLink | null;
  read: boolean;
  archived: boolean;
  /** محلي فقط — لا يُرسل للخادم. */
  local?: boolean;
}

let items: AppEvent[] = [];
const subs = new Set<() => void>();
const newSubs = new Set<(e: AppEvent) => void>();
let snap = { items, unread: 0 };
const emit = () => {
  items = items.filter((x) => !x.archived).sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 300);
  snap = { items, unread: items.filter((x) => !x.read).length };
  subs.forEach((f) => f());
};

async function post(path: string) {
  try {
    // لا اكتشاف هنا: لا يُستدعى إلا لأحداث جاءت من الخادم، فالنقطة موجودة
    await request(path, { method: 'POST', body: '{}' });
  } catch { /* الحالة المحلية تبقى؛ المزامنة التالية تصححها */ }
}

export const notifications = {
  /** يستبدل القائمة بما أعاده الخادم (مع إبقاء المحلية). */
  replace(list: AppEvent[]) {
    const local = items.filter((x) => x.local);
    items = [...local, ...list.filter((x) => !x.archived)];
    emit();
  },
  /** يضيف/يحدّث حدثاً. يعيد true إن كان جديداً. */
  upsert(e: AppEvent): boolean {
    const i = items.findIndex((x) => x.id === e.id);
    if (i >= 0) { items[i] = { ...items[i], ...e }; emit(); return false; }
    items = [e, ...items]; emit();
    newSubs.forEach((f) => f(e));
    return true;
  },
  /** إشعار محلي (لا يمر بالخادم). */
  local(e: Partial<AppEvent> & { title: string }) {
    const ev: AppEvent = { id: 'local-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), at: new Date().toISOString(),
      kind: 'local', severity: 'info', detail: null, link: null, read: false, archived: false, ...e, local: true };
    notifications.upsert(ev);
    return ev;
  },
  markRead(id: string) {
    const e = items.find((x) => x.id === id); if (!e || e.read) return;
    e.read = true; emit();
    if (!e.local) void post(`/api/v1/events/${encodeURIComponent(id)}/read`);
  },
  markAllRead() {
    const hadServer = items.some((x) => !x.read && !x.local);
    items.forEach((x) => { x.read = true; }); emit();
    if (hadServer) void post('/api/v1/events/read-all');
  },
  /** أرشفة مع مهلة تراجع؛ يعيد دالة التراجع. */
  archive(id: string, graceMs = 6000): () => void {
    const e = items.find((x) => x.id === id); if (!e) return () => {};
    const copy = { ...e };
    items = items.filter((x) => x.id !== id); emit();
    let undone = false;
    const t = setTimeout(() => { if (!undone && !copy.local) void post(`/api/v1/events/${encodeURIComponent(id)}/archive`); }, graceMs);
    return () => { undone = true; clearTimeout(t); items = [copy, ...items]; emit(); };
  },
  get: (id: string) => items.find((x) => x.id === id),
  snapshot: () => snap,
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  /** يُستدعى لكل حدث جديد فعلاً (لا للمزامنة الأولى). */
  onNew(f: (e: AppEvent) => void) { newSubs.add(f); return () => { newSubs.delete(f); }; },
};

export function useNotifications() {
  return useSyncExternalStore(notifications.subscribe, notifications.snapshot, notifications.snapshot);
}
