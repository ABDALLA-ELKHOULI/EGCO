/**
 * الهيكل — من prototype/shell.js (build/bind): شريط يمين + جزيرة + تبويبات القسم + العرض،
 * ومعها toasts، التأكيد، درج الإشعارات، لوحة الأوامر، اختصارات ⌘K و⌘.، وربط أحداث الخادم
 * (الجزيرة، إشعارات النظام، شارة الأيقونة).
 */
import { Suspense, useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ToastHost } from '@/ui/Toast';
import { ConfirmHost } from '@/ui/Modal';
import { Skeleton, EmptyState } from '@/ui/primitives';
import { isModalOpen } from '@/ui/overlay';
import { getPrefs, usePrefs } from '@/ui/prefs';
import { notifications, useNotifications } from '@/data/notifications';
import { onProgress } from '@/data/events';
import type { ViewDef } from '@/app/registry';
import { getRegistry, matchView, rememberTab } from '@/app/routes';
import { Sidebar } from './Sidebar';
import { StatusIsland } from './StatusIsland';
import { SectionTabs } from './SectionTabs';
import { NotificationDrawer, linkPath, openNotifications } from './NotificationDrawer';
import { CommandPalette, openPalette } from './CommandPalette';
import { QuickTray } from './QuickTray';
import { ViewBoundary } from './ViewBoundary';
import { startDomEnhancers } from '@/ui/fit';
import { island } from './islandStore';
import { sectionOf } from './sections';

const visited = new Set<string>();

function ViewHost({ view }: { view: ViewDef }) {
  const C = view.component;
  useEffect(() => {
    rememberTab(view);
    document.title = (view.title ? view.title + ' · ' : '') + 'أرخبيل EGCO';
  }, [view]);
  return <C />;
}

/** تحويل مسار قديم إلى الجديد مع نقل المعاملات بالاسم و?query. */
function Redirect({ to }: { to: string }) {
  const params = useParams();
  const loc = useLocation();
  let path = to.replace(/:([A-Za-z_]\w*)/g, (_, n: string) => encodeURIComponent(params[n] ?? ''));
  if (path === '') path = '/';
  return <Navigate to={path + loc.search} replace />;
}

function Missing() {
  const loc = useLocation();
  return (
    <>
      <div className="ph"><div><h1>غير موجود</h1><p>هذا الجزء غير متاح في هذه النسخة</p></div></div>
      <div className="grid"><section className="isl c12">
        <EmptyState icon="file" title="لم يُحمَّل هذا العرض" body={<>لا توجد صفحة بالعنوان <code dir="ltr">{loc.pathname}</code>. بقية التطبيق يعمل كالمعتاد — اختر قسماً من الشريط.</>} />
      </section></div>
    </>
  );
}

export function Shell() {
  const prefs = usePrefs();
  const loc = useLocation();
  const nav = useNavigate();
  const m = matchView(loc.pathname);
  const view = m?.view ?? null;
  const section = view?.section ?? null;
  const { unread } = useNotifications();
  const reg = getRegistry();

  // أول زيارة للعرض = تتابع كامل؛ العودة = ظهور سريع (prototype: renderView 'revisit')
  const revisit = useRef(false);
  revisit.current = !!view && visited.has(view.key);
  useEffect(() => { if (view) visited.add(view.key); }, [view]);
  useEffect(() => { if (!revisit.current) window.scrollTo(0, 0); }, [loc.pathname]);

  useEffect(() => { startDomEnhancers(); }, []);

  // اختصارات عامة
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); }
      else if (mod && e.key === '.') { e.preventDefault(); if (!isModalOpen()) openNotifications(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // أحداث الخادم → الجزيرة / إشعار النظام
  useEffect(() => {
    const offP = onProgress((d) => {
      if (d.kind === 'import') island.event('import', { pct: d.pct, file: d.file, done: d.pct >= 100 });
      else island.event('backup', d.pct >= 100 ? { phase: 'done' } : { phase: 'start' });
    });
    const offN = notifications.onNew((n) => {
      if (n.severity === 'danger' && n.kind === 'deficit') island.event('deficit', { detail: n.detail || n.title });
      if (!n.read && !n.local && getPrefs().osNotifications && typeof window.egco?.notifyOs === 'function') {
        const sev = n.severity === 'ok' ? 'success' : n.severity === 'warn' ? 'warning' : n.severity;
        void window.egco.notifyOs({ title: n.title, body: n.detail || undefined, severity: sev, kind: n.kind, link: linkPath(n) || undefined }).catch(() => {});
      }
    });
    const offC = typeof window.egco?.onNotificationClicked === 'function'
      ? window.egco.onNotificationClicked((d) => { if (d.link) nav(d.link); else openNotifications(); })
      : () => {};
    return () => { offP(); offN(); offC(); };
  }, [nav]);

  // شارة أيقونة التطبيق (macOS)
  useEffect(() => { if (typeof window.egco?.setBadge === 'function') void window.egco.setBadge(unread).catch(() => {}); }, [unread]);

  return (
    <>
      <div className={'app' + (prefs.sideCollapsed ? ' collapsed' : '')} lang="ar" dir="rtl">
        <Sidebar current={section} />
        <main id="main">
          <StatusIsland />
          <SectionTabs section={section} current={view} />
          <div className={'view sec-' + (section || 'none') + (revisit.current ? ' revisit' : '')}>
            <ViewBoundary resetKey={loc.pathname} title={view?.title || sectionOf(section || '')?.label}>
              <Suspense fallback={<div className="grid"><section className="isl c12"><Skeleton rows={6} /></section></div>}>
                <Routes>
                  {reg.views.map((v) => <Route key={v.key} path={v.path} element={<ViewHost view={v} />} />)}
                  {reg.redirects.map((r) => <Route key={'r:' + r.from} path={r.from} element={<Redirect to={r.to} />} />)}
                  {/* عنوان القسم المجرّد (‎/parties، ‎/cash…) يفتح أول تبويب فيه بدل «غير موجود» */}
                  {[...new Set(reg.views.map((v) => v.section))]
                    .filter((sec) => !reg.views.some((v) => v.path === '/' + sec))
                    .map((sec) => {
                      const first = reg.views.filter((v) => v.section === sec && v.tab).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
                      return first ? <Route key={'s:' + sec} path={'/' + sec} element={<Redirect to={first.path} />} /> : null;
                    })}
                  <Route path="*" element={<Missing />} />
                </Routes>
              </Suspense>
            </ViewBoundary>
          </div>
        </main>
      </div>
      <QuickTray />
      <ToastHost />
      <ConfirmHost />
      <NotificationDrawer />
      <CommandPalette />
    </>
  );
}
