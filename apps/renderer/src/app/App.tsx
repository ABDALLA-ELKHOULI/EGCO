/**
 * جذر التطبيق: إقلاع الخدمة المحلية (٥ محاولات ثم زر)، تحميل سجل الأقسام، المزوّدات
 * (TanStack Query)، الموجّه (HashRouter لأن التطبيق المحزوم يُحمَّل عبر file://)، الهيكل،
 * جولة «ما الجديد»، وإعادة تشغيل الخدمة في الخلفية (تحديث العنوان + إشعار بدل الشريط القديم).
 */
import { useEffect, useState } from 'react';
import { HashRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { initApi, api, setApiBase } from '@/lib/api';
import { queryClient, invalidate } from '@/data/queryClient';
import { restartEvents, startEvents } from '@/data/events';
import { notifications } from '@/data/notifications';
import { forgetServerPaths } from '@/data/client';
import { toast } from '@/ui/Toast';
import { Shell } from '@/shell/Shell';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { toursSince, type VersionTour } from '@/lib/whatsNew';
import { loadRegistry } from './routes';

const LAST_SEEN_VERSION_KEY = 'egco-last-seen-version';

export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [whatsNewTours, setWhatsNewTours] = useState<VersionTour[] | null | undefined>(undefined);

  // «ما الجديد» — كما في v0.13.0: أول تشغيل على الإطلاق يسجّل الإصدار بصمت.
  useEffect(() => {
    if (!ready || !window.egco?.info) return;
    let alive = true;
    window.egco.info().then((info) => {
      if (!alive) return;
      let lastSeen: string | null = null;
      try { lastSeen = localStorage.getItem(LAST_SEEN_VERSION_KEY); } catch { /* وضع خاص */ }
      if (lastSeen === null) { try { localStorage.setItem(LAST_SEEN_VERSION_KEY, info.version); } catch { /* وضع خاص */ } return; }
      if (lastSeen === info.version) return;
      const tours = toursSince(lastSeen);
      if (tours.length === 0) { try { localStorage.setItem(LAST_SEEN_VERSION_KEY, info.version); } catch { /* وضع خاص */ } return; }
      setWhatsNewTours(tours);
    }).catch(() => {});
    return () => { alive = false; };
  }, [ready]);

  function closeWhatsNew() {
    setWhatsNewTours(null);
    window.egco?.info?.().then((info) => {
      try { localStorage.setItem(LAST_SEEN_VERSION_KEY, info.version); } catch { /* وضع خاص */ }
    }).catch(() => {});
  }

  // الخدمة ماتت وأُعيدت (قد يتغير المنفذ): نحدّث العنوان، نعيد قناة الأحداث، نبطل الذاكرة.
  useEffect(() => {
    if (!window.egco?.onBackendRestarted) return;
    return window.egco.onBackendRestarted((info) => {
      if (info.recovered) {
        setApiBase(info.url);
        forgetServerPaths();
        restartEvents();
        void invalidate('*');
        toast('انقطع الاتصال بالخدمة المحلية للحظات ثم عاد للعمل تلقائياً.', { kind: 'info' });
        notifications.local({ severity: 'info', kind: 'backend', title: 'عادت الخدمة المحلية للعمل', detail: 'انقطع الاتصال للحظات ثم أُعيد تلقائياً. لم تُفقد بيانات.' });
      } else {
        setReady(false);
        setError(info.error || 'انقطع الاتصال بالخدمة المحلية ولم تُفلح إعادة تشغيلها.');
      }
    });
  }, []);

  // تحديث جاهز للتثبيت → إشعار في المركز (يكمّل واجهة التحديث في الإعدادات)
  useEffect(() => {
    if (!window.egco?.onUpdateStatus) return;
    return window.egco.onUpdateStatus((s) => {
      if (s.state === 'downloaded') notifications.local({ severity: 'ok', kind: 'update', title: 'تحديث جاهز للتثبيت', detail: 'الإصدار ' + s.version + ' — يُثبَّت عند إعادة التشغيل.', link: { view: 'data.settings' } });
    });
  }, []);

  // الإقلاع: ٥ محاولات متباعدة ثم زر يدوي (الإقلاع البارد للخدمة يستغرق ثانية أو اثنتين).
  useEffect(() => {
    let alive = true;
    let tries = 0;
    async function boot() {
      const reg = loadRegistry();
      while (alive && tries < 5) {
        try {
          await initApi();
          await api.health();
          await reg;
          if (alive) { setReady(true); startEvents(); }
          return;
        } catch (e) {
          tries += 1;
          if (tries >= 5) { if (alive) setError(String((e as Error).message || e)); return; }
          await new Promise((r) => setTimeout(r, 1200 * tries));
        }
      }
    }
    void boot();
    return () => { alive = false; };
  }, [attempt]);

  if (error) {
    return (
      <div className="boot" lang="ar" dir="rtl">
        <b>تعذّر الاتصال بالخدمة المحلية.</b>
        <span className="cap">{error}</span>
        <button className="btn primary" type="button" onClick={() => { setError(null); setAttempt((a) => a + 1); }}>إعادة المحاولة</button>
      </div>
    );
  }
  if (!ready) return <div className="boot" lang="ar" dir="rtl" aria-busy="true"><span className="st-ring" />جارٍ التشغيل…</div>;

  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Shell />
        {whatsNewTours && <div className="legacy-page"><WhatsNewModal tours={whatsNewTours} onClose={closeWhatsNew} /></div>}
      </HashRouter>
    </QueryClientProvider>
  );
}
