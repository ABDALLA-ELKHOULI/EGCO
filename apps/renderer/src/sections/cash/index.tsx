/**
 * تسجيل قسم «النقد» (العقد §١). المفاتيح والمسارات حرفياً من جدول الاستبدال: cash.flow و
 * cash.revenues يحلّان محل CashFlow.tsx وRevenues.tsx، وcash.loans/obligations/expenses تبويبات ظاهرة (كانت مخفية فبدت الصفحات ناقصة).
 * «التحصيلات» اسم مستعار لـcash.revenues (النموذج يسمّي الشاشة كذلك).
 */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';
import { useCashflow, useRevenues } from './hooks';
import { HORIZON_DEFAULT, PERIOD_DAYS_DEFAULT } from './logic/prefs';

/** شارة التبويب: ١ إن ظهر عجز في الأفق الافتراضي (كل المشاريع، كلا الطرفين). */
function useDeficitBadge(): number {
  const cf = useCashflow({ weeks: HORIZON_DEFAULT, openingBalance: null, project: '', parties: 'both', periodDays: PERIOD_DAYS_DEFAULT });
  return cf.data?.summary.firstDeficit ? 1 : 0;
}
/** شارة التحصيلات: وجود متأخر. الخادم يعيد مبلغ المتأخر لا عدده بعد — نعدّ من الصفوف. */
function useLateBadge(): number {
  const r = useRevenues({ status: 'open' });
  const today = new Date().toISOString().slice(0, 10);
  return (r.data?.rows ?? []).filter((x) => x.dueDate != null && x.dueDate < today).length;
}

const mod: SectionModule = {
  section: 'cash',
  views: [
    { key: 'cash.flow', path: '/cash/flow', tab: 'التدفق النقدي', order: 10, title: 'التدفق النقدي',
      component: lazy(() => import('./CashFlowView')), aliases: ['cash', 'cashflow', 'deficit'], redirectFrom: ['/cashflow'],
      useBadge: useDeficitBadge },
    { key: 'cash.revenues', path: '/cash/revenues', tab: 'التحصيلات', order: 20, title: 'التحصيلات',
      component: lazy(() => import('./RevenuesView')), aliases: ['revenues', 'collections', 'receivables', 'receivable'],
      redirectFrom: ['/revenues'], useBadge: useLateBadge },
    { key: 'cash.loans', path: '/cash/loans', tab: 'القروض', order: 30, title: 'القروض',
      component: lazy(() => import('./LoansView')), aliases: ['loans'], redirectFrom: ['/loans'] },
    { key: 'cash.obligations', path: '/cash/obligations', tab: 'الالتزامات', order: 40, title: 'الالتزامات الشهرية',
      component: lazy(() => import('./ObligationsView')), aliases: ['obligations'], redirectFrom: ['/obligations'] },
    { key: 'cash.expenses', path: '/cash/expenses', tab: 'المصاريف', order: 50, title: 'المصاريف التشغيلية',
      component: lazy(() => import('./ExpensesView')), aliases: ['expenses'], redirectFrom: ['/expenses'] },
  ],
  commands: [
    { group: 'إجراءات', label: 'تحصيل جديد', sub: 'النقد', keywords: 'إيراد مستخلص مالك', run: ({ go }) => go('cash.revenues', { new: '1' }) },
    { group: 'إجراءات', label: 'سيناريو «ماذا لو؟» للتدفق', sub: 'النقد', keywords: 'تأجيل دفعة', run: ({ go }) => go('cash.flow') },
  ],
};
export default mod;
