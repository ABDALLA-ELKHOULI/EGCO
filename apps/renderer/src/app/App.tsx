import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { initApi, api, setApiBase } from '@/lib/api';
import { CommandCentre } from '@/pages/CommandCentre';
import { Dashboard } from '@/pages/Dashboard';
import { Suppliers } from '@/pages/Suppliers';
import { SupplierDetail } from '@/pages/SupplierDetail';
import { Projects } from '@/pages/Projects';
import { Contractors } from '@/pages/Contractors';
import { ContractorDetail } from '@/pages/ContractorDetail';
import { Guarantees } from '@/pages/Guarantees';
import { Budget } from '@/pages/Budget';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { CashFlow } from '@/pages/CashFlow';
import { Revenues } from '@/pages/Revenues';
import { Loans } from '@/pages/Loans';
import { Obligations } from '@/pages/Obligations';
import { Expenses } from '@/pages/Expenses';
import { CoveragePage } from '@/pages/Coverage';
import { CalendarPage } from '@/pages/Calendar';
import { ImportPage } from '@/pages/Import';
import { ReportPage } from '@/pages/Report';
import { Settings } from '@/pages/Settings';

/** HashRouter لأن التطبيق المحزوم يُحمَّل عبر file:// */
export function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // إشعار هادئ وقابل للإغلاق: الخدمة الخلفية ماتت وأعادت نفسها أثناء الجلسة.
  const [restartRecovered, setRestartRecovered] = useState(false);

  // الخدمة قد تموت وتُعاد على منفذ مختلف — العنوان الذي حفظه initApi() عند
  // الإقلاع (lib/api.ts) لا يُعاد سؤاله أبداً بنفسه، فهذا هو ما يدفعه له.
  // نجحت إعادة التشغيل: نحدّث العنوان بصمت ونعرض سطراً قابلاً للإغلاق.
  // فشلت (أو تجاوزت ميزانية المحاولات): نعيد استخدام شاشة فشل الإقلاع نفسها
  // بدل اختراع مسار موازٍ — نفس زر «إعادة المحاولة» يعمل لأنه يستدعي initApi()
  // من جديد، وهي تسأل main عن العنوان الحالي الفعلي.
  useEffect(() => {
    if (!window.egco?.onBackendRestarted) return;
    return window.egco.onBackendRestarted((info) => {
      if (info.recovered) {
        setApiBase(info.url);
        setRestartRecovered(true);
      } else {
        setReady(false);
        setError(info.error || 'انقطع الاتصال بالخدمة المحلية ولم تُفلح إعادة تشغيلها.');
      }
    });
  }, []);

  // الخدمة المحلية تستغرق ثانية أو اثنتين عند الإقلاع البارد — فحص واحد فاشل كان
  // يترك التطبيق ميتاً بلا زر إعادة. الآن: 5 محاولات متباعدة ثم زر يدوي.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    async function boot() {
      while (alive && tries < 5) {
        try {
          await initApi();
          await api.health();
          if (alive) setReady(true);
          return;
        } catch (e) {
          tries += 1;
          if (tries >= 5) {
            if (alive) setError(String((e as Error).message || e));
            return;
          }
          await new Promise((r) => setTimeout(r, 1200 * tries));
        }
      }
    }
    boot();
    return () => { alive = false; };
  }, [attempt]);

  if (error) {
    return (
      <div className="state">
        تعذّر الاتصال بالخدمة المحلية.<br />
        <span className="muted">{error}</span>
        <div style={{ marginTop: 14 }}>
          <button className="btn primary"
                  onClick={() => { setError(null); setAttempt((a) => a + 1); }}>
            إعادة المحاولة
          </button>
        </div>
      </div>
    );
  }
  if (!ready) return <div className="state">جارٍ التشغيل…</div>;

  // الشريط الجانبي أولاً في الـDOM حتى يظهر على اليمين في التخطيط العربي.
  return (
    <HashRouter>
      <div className="app">
        {restartRecovered && (
          <div style={{
            position: 'fixed', top: 10, insetInlineEnd: 14, zIndex: 1000,
            background: '#FBFAF7', border: '1px solid #D8D2C4', borderRadius: 8,
            padding: '8px 14px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
          }}>
            <span>انقطع الاتصال بالخدمة المحلية للحظات ثم عاد للعمل تلقائياً.</span>
            <button className="btn" onClick={() => setRestartRecovered(false)}>إغلاق</button>
          </div>
        )}
        <Sidebar />
        <main className="main">
          <RoutedPages />
        </main>
      </div>
    </HashRouter>
  );
}

/**
 * الصفحات داخل حاجز أخطاء — خطأ في شاشة لا يُفرغ التطبيق كله.
 *
 * `resetKey` is the current path: navigating away from a broken screen clears
 * the error instead of leaving the boundary latched for the rest of the session.
 */
function RoutedPages() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>
            <Route path="/" element={<CommandCentre />} />
            <Route path="/payables" element={<Dashboard />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/suppliers/:account" element={<SupplierDetail />} />
            <Route path="/contractors" element={<Contractors />} />
            <Route path="/contractors/:code" element={<ContractorDetail />} />
            <Route path="/guarantees" element={<Guarantees />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:project" element={<ProjectDetail />} />
            <Route path="/cashflow" element={<CashFlow />} />
            <Route path="/revenues" element={<Revenues />} />
            {/* أبواب السيولة القادمة — إطارٌ يشرح ما ستفعله الشاشة، بلا تفاصيل بعد */}
            <Route path="/loans" element={<Loans />} />
            <Route path="/obligations" element={<Obligations />} />
            <Route path="/expenses" element={<Expenses />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/settings" element={<Settings />} />
      </Routes>
    </ErrorBoundary>
  );
}
