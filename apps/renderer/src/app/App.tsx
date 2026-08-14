import { useEffect, useState } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import { Sidebar } from '@/components/Sidebar';
import { initApi, api } from '@/lib/api';
import { CommandCentre } from '@/pages/CommandCentre';
import { Dashboard } from '@/pages/Dashboard';
import { Suppliers } from '@/pages/Suppliers';
import { SupplierDetail } from '@/pages/SupplierDetail';
import { Projects } from '@/pages/Projects';
import { Contractors } from '@/pages/Contractors';
import { ContractorDetail } from '@/pages/ContractorDetail';
import { Budget } from '@/pages/Budget';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { CashFlow } from '@/pages/CashFlow';
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
        <Sidebar />
        <main className="main">
          <Routes>
            <Route path="/" element={<CommandCentre />} />
            <Route path="/payables" element={<Dashboard />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/suppliers/:account" element={<SupplierDetail />} />
            <Route path="/contractors" element={<Contractors />} />
            <Route path="/contractors/:code" element={<ContractorDetail />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:project" element={<ProjectDetail />} />
            <Route path="/cashflow" element={<CashFlow />} />
            <Route path="/coverage" element={<CoveragePage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/report" element={<ReportPage />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}
