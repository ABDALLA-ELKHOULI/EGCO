/**
 * قسم «اليوم» — التسجيل في سجلّ العروض (FRONTEND-CONTRACT §١).
 * المفاتيح والمسارات حرفياً من جدول الاستبدال: تحلّ محل CommandCentre (/) وDashboard (/payables) وCalendar (/calendar).
 */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';
import { useOverviewData, useDashboardData } from './data.ts';
import { supplierOverdue } from './logic.ts';
import './today.css';

/** عدّاد تبويب «المستحقات»: عدد الأطراف المتأخرة زمنياً (موردون من payToday + مقاولون من /overview). */
function useDueBadge(): number | null {
  const o = useOverviewData().data;
  const d = useDashboardData().data;
  if (!o || !d) return null;
  const n = supplierOverdue(d.payToday).length + (o.contractors.overdueContractorCount || 0);
  return n || null;
}

const mod: SectionModule = {
  section: 'today',
  views: [
    { key: 'today.summary', path: '/today', tab: 'الملخص', order: 10, title: 'اليوم',
      component: lazy(() => import('./Today.tsx')), aliases: ['today', 'home'], redirectFrom: ['/'] },
    { key: 'today.due', path: '/today/due', tab: 'المستحقات', order: 20, title: 'المستحقات القادمة',
      component: lazy(() => import('./Due.tsx')), aliases: ['due', 'payables'], redirectFrom: ['/payables'], useBadge: useDueBadge },
    { key: 'today.calendar', path: '/today/calendar', tab: 'التقويم', order: 30, title: 'التقويم المالي',
      component: lazy(() => import('./Calendar.tsx')), aliases: ['calendar'], redirectFrom: ['/calendar'] },
  ],
  commands: [
    { group: 'إجراءات', label: 'قائمة دفع', sub: 'المستحقات القادمة', keywords: 'دفع سداد', run: ({ go }) => go('today.due', { range: '7' }) },
    { group: 'إجراءات', label: 'المتأخر فقط', sub: 'المستحقات القادمة', keywords: 'متأخر', run: ({ go }) => go('today.due', { range: 'all', status: 'overdue' }) },
    { group: 'إجراءات', label: 'تقويم هذا الأسبوع', sub: 'التقويم المالي', run: ({ go }) => go('today.calendar', { mode: 'week' }) },
  ],
};
export default mod;
