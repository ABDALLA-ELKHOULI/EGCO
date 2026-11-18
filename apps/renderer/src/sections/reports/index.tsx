/** قسم «التقارير» (S5) — تسجيل العروض (FRONTEND-CONTRACT §١) + الواجهة البرمجية للقسم. */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';

export * from './types';
export * from './hooks';
export * from './model';
export * from './slides';
export * from './exports';

const mod: SectionModule = {
  section: 'reports',
  views: [
    { key: 'reports.report', path: '/reports', tab: 'التقرير', order: 10, title: 'التقرير',
      component: lazy(() => import('./ReportView')), aliases: ['report'], redirectFrom: ['/report'] },
    { key: 'reports.present', path: '/reports/present', tab: 'عرض تقديمي', order: 20, title: 'عرض تقديمي',
      component: lazy(() => import('./PresentView')), aliases: ['present'] },
    { key: 'reports.exports', path: '/reports/exports', tab: 'التصدير', order: 30, title: 'التصدير',
      component: lazy(() => import('./ExportsView')), aliases: ['exports'] },
  ],
  commands: [
    { group: 'إجراءات', label: 'طباعة التقرير PDF', sub: 'التقارير', keywords: 'pdf طباعة تقرير', run: ({ go }) => go('reports.report') },
    { group: 'إجراءات', label: 'بدء العرض التقديمي', sub: 'التقارير', keywords: 'عرض شرائح', run: ({ go }) => go('reports.present') },
    { group: 'إجراءات', label: 'تصدير Excel', sub: 'التقارير', keywords: 'excel xlsx تصدير', run: ({ go }) => go('reports.exports') },
  ],
};
export default mod;
