/**
 * سجلّ العروض — كل مسار في التطبيق، قديمه وجديده، بقسمه وتبويبه.
 *
 * ١) LEGACY_VIEWS: صفحات v0.13.0 (pages/**) بمفاتيح ومسارات الهيكل الجديد — «بيت مؤقت».
 * ٢) أقسام الموجة ١: src/sections/<name>/index.ts(x) يصدّر افتراضياً SectionModule
 *    (docs/next/FRONTEND-CONTRACT.md §١). عرضٌ بنفس key أو path لعرض قديم يحلّ محله.
 * ٣) REDIRECTS: كل مسار قديم يبقى يعمل (تحويل replace مع نقل المعاملات و?query).
 */
import { lazy, useCallback, type ComponentType } from 'react';
import { generatePath, matchPath, useNavigate } from 'react-router-dom';
import type { Command, Go, RouteParams, SectionKey, SectionModule, ViewDef } from './registry';
import { legacy } from './LegacyPage';
import { SECTION_KEYS } from '@/shell/sections';
import { useOverview } from '@/data/hooks';

/* lazy لتصدير مسمّى من صفحة قديمة، مغلَّف بـ.legacy-page */
function page<M>(load: () => Promise<M>, pick: (m: M) => ComponentType): ComponentType {
  return lazy(() => load().then((m) => ({ default: legacy(pick(m)) })));
}

/* شارات التبويبات — نفس «نقاط التنبيه» في الشريط القديم (Sidebar.tsx: api.overview). */
const useOverdue = () => { const d = useOverview().data; return d?.payables?.overdue ?? 0; };
const useNeedsTerm = () => { const d = useOverview().data; return d?.needsTerm ?? 0; };
const useCoverageGap = () => { const d = useOverview().data; return d?.coverage?.withoutData ?? 0; };
const useDeficitDot = () => { const d = useOverview().data; return d?.cash?.nextDeficit ? 1 : 0; };

export const LEGACY_VIEWS: ViewDef[] = [
  // ─ اليوم ─
  { key: 'today.summary', section: 'today', path: '/today', tab: 'الملخص', order: 10, title: 'اليوم', aliases: ['today', 'home'],
    component: page(() => import('@/pages/CommandCentre'), (m) => m.CommandCentre), redirectFrom: ['/'] },
  { key: 'today.due', section: 'today', path: '/today/due', tab: 'المستحقات', order: 20, title: 'المستحقات القادمة', aliases: ['due', 'payables'],
    component: page(() => import('@/pages/Dashboard'), (m) => m.Dashboard), redirectFrom: ['/payables'], useBadge: useOverdue },
  { key: 'today.calendar', section: 'today', path: '/today/calendar', tab: 'التقويم', order: 30, title: 'التقويم', aliases: ['calendar'],
    component: page(() => import('@/pages/Calendar'), (m) => m.CalendarPage), redirectFrom: ['/calendar'] },
  // ─ الأطراف ─
  { key: 'parties.suppliers', section: 'parties', path: '/parties/suppliers', tab: 'الموردون', order: 10, title: 'الموردون', aliases: ['suppliers', 'parties'],
    component: page(() => import('@/pages/Suppliers'), (m) => m.Suppliers), redirectFrom: ['/suppliers'], useBadge: useNeedsTerm },
  { key: 'parties.supplier', section: 'parties', path: '/parties/suppliers/:account', parentTab: 'parties.suppliers', title: 'كشف مورد', aliases: ['supplier'],
    component: page(() => import('@/pages/SupplierDetail'), (m) => m.SupplierDetail), redirectFrom: ['/suppliers/:account'] },
  { key: 'parties.contractors', section: 'parties', path: '/parties/contractors', tab: 'المقاولون', order: 20, title: 'المقاولون', aliases: ['contractors'],
    component: page(() => import('@/pages/Contractors'), (m) => m.Contractors), redirectFrom: ['/contractors'] },
  { key: 'parties.contractor', section: 'parties', path: '/parties/contractors/:code', parentTab: 'parties.contractors', title: 'كشف مقاول', aliases: ['contractor'],
    component: page(() => import('@/pages/ContractorDetail'), (m) => m.ContractorDetail), redirectFrom: ['/contractors/:code'] },
  { key: 'parties.guarantees', section: 'parties', path: '/parties/guarantees', tab: 'الضمانات', order: 30, title: 'الضمانات', aliases: ['guarantees'],
    component: page(() => import('@/pages/Guarantees'), (m) => m.Guarantees), redirectFrom: ['/guarantees'] },
  // ─ المشاريع ─
  { key: 'projects.list', section: 'projects', path: '/projects', tab: 'المشاريع', order: 10, title: 'المشاريع', aliases: ['projects'],
    component: page(() => import('@/pages/Projects'), (m) => m.Projects) },
  { key: 'projects.project', section: 'projects', path: '/projects/:project', parentTab: 'projects.list', title: 'مشروع', aliases: ['project'],
    component: page(() => import('@/pages/ProjectDetail'), (m) => m.ProjectDetail) },
  { key: 'projects.budget', section: 'projects', path: '/projects/budget', tab: 'الموازنة', order: 20, title: 'الموازنة', aliases: ['budget'],
    component: page(() => import('@/pages/Budget'), (m) => m.Budget), redirectFrom: ['/budget'] },
  { key: 'projects.admin', section: 'projects', path: '/projects/admin', tab: 'إدارة المشاريع', order: 30, title: 'إدارة المشاريع', aliases: ['merge', 'project-admin'],
    component: page(() => import('@/pages/ProjectAdmin'), (m) => m.ProjectAdmin), redirectFrom: ['/settings/projects'] },
  // ─ النقد ─
  { key: 'cash.flow', section: 'cash', path: '/cash/flow', tab: 'التدفق النقدي', order: 10, title: 'التدفق النقدي', aliases: ['cash', 'cashflow', 'deficit'],
    component: page(() => import('@/pages/CashFlow'), (m) => m.CashFlow), redirectFrom: ['/cashflow'], useBadge: useDeficitDot },
  { key: 'cash.revenues', section: 'cash', path: '/cash/revenues', tab: 'الإيرادات', order: 20, title: 'الإيرادات', aliases: ['revenues', 'collections'],
    component: page(() => import('@/pages/Revenues'), (m) => m.Revenues), redirectFrom: ['/revenues'] },
  { key: 'cash.loans', section: 'cash', path: '/cash/loans', title: 'القروض', aliases: ['loans'],
    component: page(() => import('@/pages/Loans'), (m) => m.Loans), redirectFrom: ['/loans'] },
  { key: 'cash.obligations', section: 'cash', path: '/cash/obligations', title: 'الالتزامات', aliases: ['obligations'],
    component: page(() => import('@/pages/Obligations'), (m) => m.Obligations), redirectFrom: ['/obligations'] },
  { key: 'cash.expenses', section: 'cash', path: '/cash/expenses', title: 'المصروفات', aliases: ['expenses'],
    component: page(() => import('@/pages/Expenses'), (m) => m.Expenses), redirectFrom: ['/expenses'] },
  // ─ التقارير ─
  { key: 'reports.report', section: 'reports', path: '/reports', tab: 'التقرير', order: 10, title: 'التقارير', aliases: ['report', 'reports'],
    component: page(() => import('@/pages/Report'), (m) => m.ReportPage), redirectFrom: ['/report'] },
  // ─ البيانات ─
  { key: 'data.import', section: 'data', path: '/data/import', tab: 'الاستيراد', order: 10, title: 'الاستيراد', aliases: ['import', 'data'],
    component: page(() => import('@/pages/Import'), (m) => m.ImportPage), redirectFrom: ['/import'] },
  { key: 'data.coverage', section: 'data', path: '/data/coverage', tab: 'التغطية', order: 20, title: 'تغطية الكشوفات', aliases: ['coverage'],
    component: page(() => import('@/pages/Coverage'), (m) => m.CoveragePage), redirectFrom: ['/coverage'], useBadge: useCoverageGap },
  { key: 'data.settings', section: 'data', path: '/data/settings', tab: 'الإعدادات', order: 40, title: 'الإعدادات', aliases: ['settings', 'backups'],
    component: page(() => import('@/pages/Settings'), (m) => m.Settings), redirectFrom: ['/settings'] },
  { key: 'data.trash', section: 'data', path: '/data/trash', tab: 'سلة المحذوفات', order: 50, title: 'سلة المحذوفات', aliases: ['trash'],
    component: page(() => import('@/pages/Trash'), (m) => m.Trash), redirectFrom: ['/settings/trash'] },
];

/* ═══ تحميل الأقسام ═══
 * كسول وكل قسم في try/catch: قسمٌ مكسور أثناء التطوير لا يُسقط الهيكل — تبقى صفحاته القديمة. */
const SECTION_LOADERS = import.meta.glob('../sections/*/index.{ts,tsx}');

function isSectionModule(x: unknown): x is SectionModule {
  const m = x as SectionModule | undefined;
  return !!m && typeof m === 'object' && SECTION_KEYS.includes(m.section) && Array.isArray(m.views);
}

export interface Registry {
  views: ViewDef[];
  commands: Command[];
  redirects: { from: string; to: string }[];
  /** أقسام فشل تحميلها (للتشخيص في الإعدادات/الكونسول التطويري). */
  failed: string[];
}

let registry: Registry = build([], []);

function build(mods: SectionModule[], failed: string[]): Registry {
  const views: ViewDef[] = [];
  const replaced = new Set<string>();
  const sectionViews: ViewDef[] = [];
  for (const m of mods) for (const v of m.views) {
    if (!v || !v.key || !v.path || !v.component) continue;
    sectionViews.push({ ...v, section: v.section || m.section });
  }
  if (import.meta.env.DEV) {
    const seenK = new Set<string>(), seenP = new Set<string>();
    for (const v of sectionViews) {
      if (seenK.has(v.key)) console.warn('[routes] مفتاح عرض مكرر', v.key);
      if (seenP.has(v.path)) console.warn('[routes] مسار عرض مكرر', v.path);
      seenK.add(v.key); seenP.add(v.path);
    }
  }
  for (const v of sectionViews) { replaced.add('k:' + v.key); replaced.add('p:' + v.path); }
  for (const v of LEGACY_VIEWS) {
    if (replaced.has('k:' + v.key) || replaced.has('p:' + v.path)) {
      // العرض القديم استُبدل — لكن مساراته القديمة تبقى تُحوَّل (إلى البديل)
      const sub = sectionViews.find((s) => s.key === v.key || s.path === v.path)!;
      sub.redirectFrom = [...new Set([...(sub.redirectFrom || []), ...(v.redirectFrom || [])])];
      // الاسم المستعار الذي يملكه عرضٌ آخر في الأقسام لا يُورَّث (A-007: exports/present)
      sub.aliases = [...new Set([...(sub.aliases || []), ...(v.aliases || []).filter((a) => !sectionViews.some((s) => s !== sub && s.aliases?.includes(a)))])];
      continue;
    }
    views.push({ ...v, legacy: true });
  }
  views.push(...sectionViews);
  const redirects: Registry['redirects'] = [];
  const own = new Set(views.map((v) => v.path));
  for (const v of views) for (const from of v.redirectFrom || []) if (!own.has(from)) redirects.push({ from, to: v.path });
  return { views, commands: mods.flatMap((m) => m.commands || []), redirects, failed };
}

/** يُستدعى مرة عند الإقلاع (App) قبل رسم الموجّه. */
export async function loadRegistry(): Promise<Registry> {
  const mods: SectionModule[] = [];
  const failed: string[] = [];
  await Promise.all(Object.entries(SECTION_LOADERS).map(async ([path, load]) => {
    try {
      const m = (await load()) as { default?: unknown };
      if (isSectionModule(m.default)) mods.push(m.default);
      else if (import.meta.env.DEV) failed.push(path + ' (لا تصدير افتراضي SectionModule)');
    } catch (e) {
      failed.push(path);
      if (import.meta.env.DEV) console.warn('[routes] تعذّر تحميل قسم', path, e);
    }
  }));
  mods.sort((a, b) => SECTION_KEYS.indexOf(a.section) - SECTION_KEYS.indexOf(b.section));
  registry = build(mods, failed);
  return registry;
}
export const getRegistry = () => registry;

/* ═══ التنقل ═══ */
export function findView(keyOrAlias: string): ViewDef | undefined {
  const r = registry.views;
  return r.find((v) => v.key === keyOrAlias) || r.find((v) => v.aliases?.includes(keyOrAlias))
    || (SECTION_KEYS.includes(keyOrAlias as SectionKey) ? defaultViewOf(keyOrAlias as SectionKey) : undefined);
}

/** مسار عرض مع معاملاته؛ معاملات ليست في المسار تصير ?query. params.id يملأ أول معامل مسار ناقص. */
export function pathOf(keyOrAlias: string, params: RouteParams = {}): string | null {
  const v = findView(keyOrAlias);
  if (!v) return null;
  const names = [...v.path.matchAll(/:([A-Za-z_]\w*)/g)].map((m) => m[1]);
  const p: Record<string, string> = {};
  const rest = new URLSearchParams();
  const used = new Set<string>();
  for (const n of names) {
    let val = params[n];
    if (val == null && params.id != null && !used.has('id')) { val = params.id; used.add('id'); }
    if (val == null) return null;
    p[n] = String(val); used.add(n);
  }
  for (const [k, val] of Object.entries(params)) if (!used.has(k) && val != null && val !== '') rest.set(k, String(val));
  const qs = rest.toString();
  return generatePath(v.path, p) + (qs ? '?' + qs : '');
}

export function matchView(pathname: string): { view: ViewDef; params: Record<string, string | undefined> } | null {
  // الثابت يغلب الديناميكي: '/projects/budget' قبل '/projects/:project'
  const sorted = [...registry.views].sort((a, b) => dyn(a.path) - dyn(b.path));
  for (const v of sorted) { const m = matchPath({ path: v.path, end: true }, pathname); if (m) return { view: v, params: m.params }; }
  return null;
}
const dyn = (p: string) => (p.match(/:/g) || []).length;

export function tabsOf(section: SectionKey): ViewDef[] {
  return registry.views.filter((v) => v.section === section && v.tab).sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

/* آخر تبويب زاره المستخدم في كل قسم (للجلسة) — النقر على القسم يعيده إليه */
const lastTab: Partial<Record<SectionKey, string>> = {};
export function rememberTab(v: ViewDef) {
  if (v.section) lastTab[v.section] = v.tab ? v.key : (v.parentTab || lastTab[v.section]);
}
export function defaultViewOf(sec: SectionKey): ViewDef | undefined {
  const last = lastTab[sec] && registry.views.find((v) => v.key === lastTab[sec]);
  return last || tabsOf(sec)[0] || registry.views.find((v) => v.section === sec);
}

export function useGo(): Go {
  const nav = useNavigate();
  return useCallback((k, params, opts) => {
    const to = pathOf(k, params || {});
    if (to) nav(to, { replace: !!opts?.replace });
    else if (import.meta.env.DEV) console.warn('[routes] عرض غير معروف', k, params);
  }, [nav]);
}
