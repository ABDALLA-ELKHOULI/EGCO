/**
 * قسم «البيانات» — يسجّله routes.tsx تلقائياً (FRONTEND-CONTRACT §١). المفاتيح والمسارات
 * حرفياً من جدول الاستبدال: data.import/coverage/settings/trash تحلّ محل الصفحات القديمة.
 */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';

export { WhatsNewTour } from './whatsnew/WhatsNewTour';
export { toursBetween, latestTour, cmpVersion } from './lib/tours';

const mod: SectionModule = {
  section: 'data',
  views: [
    { key: 'data.import', path: '/data/import', tab: 'رفع الملفات', order: 10, title: 'رفع الملفات',
      component: lazy(() => import('./import/ImportView')), aliases: ['import'], redirectFrom: ['/import'] },
    { key: 'data.coverage', path: '/data/coverage', tab: 'تغطية الكشوفات', order: 20, title: 'تغطية الكشوفات',
      component: lazy(() => import('./coverage/CoverageView')), aliases: ['coverage'], redirectFrom: ['/coverage'] },
    { key: 'data.backups', path: '/data/backups', tab: 'النسخ الاحتياطي', order: 30, title: 'النسخ الاحتياطي',
      component: lazy(() => import('./backups/BackupsView')), aliases: ['backups', 'backup'] },
    { key: 'data.trash', path: '/data/trash', tab: 'المحذوفات', order: 40, title: 'المحذوفات',
      component: lazy(() => import('./trash/TrashView')), aliases: ['trash'], redirectFrom: ['/settings/trash'] },
    { key: 'data.settings', path: '/data/settings', tab: 'الإعدادات', order: 50, title: 'الإعدادات',
      component: lazy(() => import('./settings/SettingsView')), aliases: ['settings'], redirectFrom: ['/settings'] },
  ],
  commands: [
    { group: 'إجراءات', label: 'رفع ملفات', sub: 'البيانات', keywords: 'استيراد كشف', run: ({ go }) => go('data.import') },
    { group: 'إجراءات', label: 'نسخة احتياطية', sub: 'البيانات', keywords: 'backup نسخ', run: ({ go }) => go('data.backups') },
    { group: 'إجراءات', label: 'المحذوفات', sub: 'البيانات', keywords: 'سلة استرجاع', run: ({ go }) => go('data.trash') },
  ],
};
export default mod;
