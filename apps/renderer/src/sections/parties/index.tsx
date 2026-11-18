/**
 * قسم «الأطراف» — التسجيل في سجلّ العروض (FRONTEND-CONTRACT §١). المفاتيح والمسارات حرفياً من جدول الاستبدال:
 * تحلّ محل pages/Suppliers، SupplierDetail، Contractors، ContractorDetail، Guarantees.
 */
import { lazy } from 'react';
import type { SectionModule } from '@/app/registry';
import { useContractors, useGuarantees, useSuppliers } from './hooks';
import './parties.css';

/** عدّادات التبويبات — من استجابات الخادم المخزّنة (نفس مفاتيح القوائم غير المصفّاة). */
function useSupplierBadge() { const d = useSuppliers({}).data; return d ? d.rows.filter((r) => r.overdue > 0).length || null : null; }
function useContractorBadge() { const d = useContractors({}).data; return d ? d.totals.overdueContractorCount || null : null; }
function useGuaranteeBadge() { const d = useGuarantees().data; return d ? (d.totals.dueSoonCount + d.totals.overdueCount) || null : null; }

const mod: SectionModule = {
  section: 'parties',
  views: [
    { key: 'parties.suppliers', path: '/parties/suppliers', tab: 'الموردون', order: 10, title: 'الموردون',
      component: lazy(() => import('./Suppliers')), aliases: ['suppliers'], redirectFrom: ['/suppliers'], useBadge: useSupplierBadge },
    { key: 'parties.supplier', path: '/parties/suppliers/:account', parentTab: 'parties.suppliers', title: 'كشف مورد',
      component: lazy(() => import('./SupplierDetail')), aliases: ['supplier'], redirectFrom: ['/suppliers/:account'] },
    { key: 'parties.contractors', path: '/parties/contractors', tab: 'المقاولون', order: 20, title: 'المقاولون',
      component: lazy(() => import('./Contractors')), aliases: ['contractors'], redirectFrom: ['/contractors'], useBadge: useContractorBadge },
    { key: 'parties.contractor', path: '/parties/contractors/:code', parentTab: 'parties.contractors', title: 'كشف مقاول',
      component: lazy(() => import('./ContractorDetail')), aliases: ['contractor'], redirectFrom: ['/contractors/:code'] },
    { key: 'parties.guarantees', path: '/parties/guarantees', tab: 'الضمانات', order: 30, title: 'الضمانات',
      component: lazy(() => import('./Guarantees')), aliases: ['guarantees'], redirectFrom: ['/guarantees'], useBadge: useGuaranteeBadge },
  ],
  commands: [
    { group: 'إجراءات', label: 'مورد جديد', sub: 'الأطراف', keywords: 'إضافة مورد', run: ({ go }) => go('parties.suppliers', { new: '1' }) },
    { group: 'إجراءات', label: 'مقاول جديد', sub: 'الأطراف', keywords: 'إضافة مقاول', run: ({ go }) => go('parties.contractors', { new: '1' }) },
    { group: 'إجراءات', label: 'الموردون المتأخرون', sub: 'الأطراف', keywords: 'متأخر', run: ({ go }) => go('parties.suppliers') },
  ],
};
export default mod;
