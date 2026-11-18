/* خطافات «الأطراف» — فوق @/data (TanStack Query v5، FRONTEND-CONTRACT §٣). جذور المفاتيح من
 * QUERY_ROOTS فقط (suppliers/supplier/contractors/contractor/guarantees) كي تصلها أحداث invalidate
 * من الخادم. لا تحديث تفاؤلي لأي رقم مالي — كل طفرة تُبطل ثم يعيد الخادم الأرقام. */
import { useApi, useApiMutation, qk } from '@/data';
import { partiesApi } from './api';
import type {
  ContractorDetail, ContractorListResponse, ContractorQuery, ContractorsOverview, GuaranteeAccountDetail,
  GuaranteesResponse, PartyProjectBody, PartyProjectsResponse, PartyType, PaymentAllocationSetting,
  SupplierDetailResponse, SupplierListResponse, SupplierQuery,
} from './types';

/** ما يُبطَل بعد أي تعديل على مورد/مقاول — الأرقام تظهر أيضاً في اليوم والمشاريع والنقد. */
export const SUPPLIER_ROOTS = ['suppliers', 'supplier', 'overview', 'dashboard', 'today', 'projects', 'project', 'cashflow'];
export const CONTRACTOR_ROOTS = ['contractors', 'contractor', 'guarantees', 'overview', 'dashboard', 'today', 'projects', 'project', 'cashflow'];

/* ── الموردون ── */
export const useSuppliers = (q: SupplierQuery) =>
  useApi<SupplierListResponse>(qk.suppliers(q), () => partiesApi.suppliers(q));
export const useSupplier = (account: string) =>
  useApi<SupplierDetailResponse>(qk.supplier(account), () => partiesApi.supplier(account), { enabled: !!account });
/** إعداد «تخصيص الدفعات» — ثانوي: فشل قراءته لا يمنع الشاشة (retry:false، الخطأ يُتجاهل في العرض). */
export const useAllocationSetting = () =>
  useApi<PaymentAllocationSetting>(['supplier', 'allocation-setting'], () => partiesApi.allocationSetting(), { retry: false });

/* ── المقاولون ── */
export const useContractors = (q: ContractorQuery) =>
  useApi<ContractorListResponse>(qk.contractors(q), () => partiesApi.contractors(q));
/** النظرة مُجمَّعة على مستوى الشركة — لا تتأثر بتصفية الجدول. */
export const useContractorsOverview = () =>
  useApi<ContractorsOverview>(['contractors', 'overview'], () => partiesApi.contractorsOverview());
export const useContractor = (code: string) =>
  useApi<ContractorDetail>(qk.contractor(code), () => partiesApi.contractor(code), { enabled: !!code });

/* ── الضمانات ── */
export const useGuarantees = () => useApi<GuaranteesResponse>(qk.guarantees(), () => partiesApi.guarantees());
export const useGuaranteeAccount = (account: string | null) =>
  useApi<GuaranteeAccountDetail>(['guarantees', account], () => partiesApi.guaranteeAccount(account!), { enabled: !!account });

/* ── م-٥٠ · مشاريع الطرف بمبالغ ── */
const partyRoot = (t: PartyType) => (t === 'supplier' ? 'supplier' : 'contractor');
export const usePartyProjects = (t: PartyType, id: string) =>
  useApi<PartyProjectsResponse>([partyRoot(t), id, 'projects'], () => partiesApi.partyProjects(t, id),
    { enabled: !!id, retry: false });

export function usePartyProjectMutations(t: PartyType, id: string) {
  const roots = [partyRoot(t), t === 'supplier' ? 'suppliers' : 'contractors', 'projects', 'project'];
  const save = useApiMutation((v: { project: string; body: PartyProjectBody }) =>
    partiesApi.putPartyProject(t, id, v.project, v.body), { invalidate: roots, success: 'حُفظ إسناد المشروع' });
  const remove = useApiMutation((project: string) => partiesApi.removePartyProject(t, id, project), { invalidate: roots });
  return { save, remove };
}

export { useApiMutation };
