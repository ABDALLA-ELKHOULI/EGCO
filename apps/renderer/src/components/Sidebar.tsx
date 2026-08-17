import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/components/Icon';
import logoMark from '@/assets/logo-mark.png';

const STORAGE_KEY = 'egco.sidebar.collapsed';

interface NavItem {
  to?: string;
  end?: boolean;
  icon: IconName;
  label: string;
  /** مفتاح التنبيه — نقطة حمراء تظهر عند وجود بند يحتاج إجراءً */
  alert?: 'overdue' | 'dueSoon' | 'coverage';
  /** الشاشة موجودة كإطار ولم تكتمل بعد — يُقال صراحةً بدل أن يظنّها المستخدم معطلة */
  soon?: boolean;
}

/**
 * التجميع بالمعنى المالي لا بنوع الشاشة.
 *
 * The old grouping (تشغيل/تحليل/بيانات) put «مديونية الموردين» and «الموردون» in
 * different sections under near-identical names — the user hit that confusion
 * directly. Grouping by what the money IS (owed out / liquidity / project) gives
 * every screen one obvious home, and gives the pages still to come an obvious
 * home too, which is the point: this list only grows.
 */
const GROUPS: { section: string; items: NavItem[] }[] = [
  {
    section: 'نظرة عامة',
    items: [
      { to: '/', end: true, icon: 'dashboard', label: 'لوحة القيادة' },
    ],
  },
  {
    section: 'التزاماتنا',
    items: [
      // «المستحقات القادمة» بدل «مديونية الموردين» — الاسم القديم كان يُخلط
      // مع صفحة «الموردون» وهما شاشتان مختلفتان تماماً.
      { to: '/payables', icon: 'payables', label: 'المستحقات القادمة', alert: 'overdue' },
      { to: '/suppliers', icon: 'suppliers', label: 'الموردون' },
      { to: '/contractors', icon: 'contractors', label: 'المقاولون' },
      { to: '/guarantees', icon: 'guarantee', label: 'الضمانات' },
    ],
  },
  {
    // كل ما يدخل ويخرج نقداً في مكان واحد: التحصيلات تدخل، والقروض والالتزامات
    // والمصاريف تخرج — وهي التي كان التدفق النقدي يجهلها فيبدو «أدنى رصيد» متفائلاً.
    section: 'السيولة',
    items: [
      { to: '/cashflow', icon: 'cashflow', label: 'التدفق النقدي', alert: 'dueSoon' },
      { to: '/revenues', icon: 'revenue', label: 'التحصيلات' },
      { to: '/loans', icon: 'loans', label: 'القروض', soon: true },
      { to: '/obligations', icon: 'obligations', label: 'الالتزامات الشهرية', soon: true },
      { to: '/expenses', icon: 'expenses', label: 'المصاريف التشغيلية', soon: true },
    ],
  },
  {
    section: 'المشاريع',
    items: [
      { to: '/projects', icon: 'projects', label: 'المشاريع' },
      { to: '/budget', icon: 'budget', label: 'الموازنة' },
    ],
  },
  {
    section: 'التحليل',
    items: [
      { to: '/report', icon: 'reports', label: 'التقارير التحليلية' },
      { to: '/calendar', icon: 'calendar', label: 'التقويم المالي' },
    ],
  },
  {
    section: 'البيانات',
    items: [
      { to: '/import', icon: 'upload', label: 'رفع الملفات' },
      { to: '/coverage', icon: 'coverage', label: 'تغطية الكشوفات', alert: 'coverage' },
    ],
  },
];

/**
 * التنقل الرئيسي — قابل للطي.
 *
 * The alert dots are the point of this component: without them the sidebar is a silent
 * list and you only discover an overdue invoice after clicking into the screen. They
 * stay visible when collapsed, because a collapse that hides information is worse than
 * no collapse at all.
 */
export function Sidebar() {
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1',
  );
  const [alerts, setAlerts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    let alive = true;
    api.overview()
      .then((d) => {
        if (!alive) return;
        setAlerts({
          overdue: (d?.payables?.overdue ?? 0) > 0,
          dueSoon: Boolean(d?.cash?.nextDeficit),
          coverage: (d?.coverage?.withoutData ?? 0) > 0,
        });
      })
      .catch(() => { /* الشريط يعمل بلا تنبيهات إن تعذّر الجلب */ });
    return () => { alive = false; };
  }, []);

  const link = ({ isActive }: { isActive: boolean }) => 'nav-item' + (isActive ? ' active' : '');

  return (
    <nav className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="side-head" style={collapsed ? { flexDirection: 'column', gap: 10 } : undefined}>
        <button
          className="side-toggle"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? 'توسيع الشريط' : 'طيّ الشريط'}
          aria-label={collapsed ? 'توسيع الشريط' : 'طيّ الشريط'}
          aria-expanded={!collapsed}
        >
          <Icon name={collapsed ? 'expand' : 'collapse'} size={18} />
        </button>
        {collapsed ? (
          <img
            src={logoMark}
            alt="إعمار الخليج المصرية للمقاولات"
            style={{ height: 22, width: 'auto', display: 'block', borderRadius: 6, background: '#fff', padding: 3, flex: 'none' }}
          />
        ) : (
          <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <img
              src={logoMark}
              alt=""
              style={{ height: 30, width: 'auto', display: 'block', borderRadius: 6, background: '#fff', padding: 3, flex: 'none' }}
            />
            <div style={{ minWidth: 0 }}>
              <b>إعمار الخليج</b>
              <span>المصرية للمقاولات</span>
            </div>
          </div>
        )}
      </div>

      {GROUPS.map((g) => (
        <div key={g.section} className="nav-group">
          <div className="section">{collapsed ? <i className="section-rule" /> : g.section}</div>
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to!} end={it.end} className={link} title={collapsed ? it.label : undefined}>
              <Icon name={it.icon} />
              <span className="nav-label">{it.label}</span>
              {it.soon && <span className="nav-soon">قريباً</span>}
              {it.alert && alerts[it.alert] && <i className="alert-dot" aria-hidden="true" />}
            </NavLink>
          ))}
        </div>
      ))}

      <div className="grow" />
      <NavLink to="/settings" className={link} title={collapsed ? 'الإعدادات' : undefined}>
        <Icon name="settings" />
        <span className="nav-label">الإعدادات</span>
      </NavLink>
    </nav>
  );
}
