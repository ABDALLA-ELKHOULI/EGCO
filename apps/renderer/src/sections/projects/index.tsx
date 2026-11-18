/* قسم «المشاريع» — S3. التسجيل حسب FRONTEND-CONTRACT.md §١ (المفاتيح والمسارات حرفياً). */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';
import './projects.css';

const mod: SectionModule = {
  section: 'projects',
  views: [
    { key: 'projects.list', path: '/projects', tab: 'المشاريع', order: 10, title: 'المشاريع',
      component: lazy(() => import('./views/ProjectsView')), aliases: ['projects'] },
    { key: 'projects.project', path: '/projects/:project', parentTab: 'projects.list', title: 'مشروع',
      component: lazy(() => import('./views/ProjectView')), aliases: ['project'] },
    { key: 'projects.budget', path: '/projects/budget', tab: 'الموازنة', order: 20, title: 'الموازنة التقديرية',
      component: lazy(() => import('./views/BudgetView')), aliases: ['budget'], redirectFrom: ['/budget'] },
    { key: 'projects.admin', path: '/projects/admin', tab: 'إدارة المشاريع', order: 30, title: 'إدارة المشاريع — الدمج',
      component: lazy(() => import('./views/MergeView')), aliases: ['merge', 'projectAdmin'], redirectFrom: ['/settings/projects'] },
  ],
  commands: [
    { group: 'إجراءات', label: 'رفع تقرير الموازنة', sub: 'المشاريع', keywords: 'موازنة استيراد', run: ({ go }) => go('projects.budget') },
    { group: 'إجراءات', label: 'دمج مشروعين مكرّرين', sub: 'المشاريع', keywords: 'دمج تكرار', run: ({ go }) => go('projects.admin') },
  ],
};
export default mod;
