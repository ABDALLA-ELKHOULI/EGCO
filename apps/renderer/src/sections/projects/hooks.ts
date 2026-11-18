/* خطافات القسم فوق @/data (TanStack Query). لا تحديث تفاؤلي لأي رقم مالي (العقد §٣):
   الكتابة تُرسل ثم تُبطَل الجذور ويُعاد الجلب من الخادم. */
import { useApi, useApiMutation, useProjects as useProjectsBase, useProject as useProjectBase, useBudget } from '@/data/hooks';
import { api, type BudgetListResponse, type BudgetProjectDetail, type BudgetQuery, type BudgetResponse } from '@/lib/api';
import { projectsApi } from './api';
import type {
  BudgetPlan, BudgetPlanListItem, PartyAssignmentBody, PartySearchHit, PartyType, ProjectAdminResponse, ProjectDetailResponse, ProjectKey,
  ProjectListResponse, ProjectParty,
} from './types';

/** نتيجة استعلام مُنمَّطة صراحةً — كي لا يتسرّب any إن غابت أنواع @tanstack مؤقتاً. */
export interface Q<T> { data: T | undefined; error: unknown; isLoading: boolean; refetch: () => unknown }
const typed = <T,>(q: { data?: unknown; error?: unknown; isLoading?: boolean; refetch: () => unknown }): Q<T> =>
  ({ data: q.data as T | undefined, error: q.error ?? null, isLoading: !!q.isLoading, refetch: q.refetch });

/** الطرف يعرض مشاريعه ومبالغه — لذلك تُبطَل جذور الأطراف أيضاً. */
export const PARTY_ROOTS = ['projectParties', 'project', 'projects', 'supplier', 'contractor', 'suppliers', 'contractors'];
export const BUDGET_ROOTS = ['budget', 'projects', 'project'];

export const useProjects = () => typed<ProjectListResponse>(useProjectsBase());
export const useProject = (id: ProjectKey) => typed<ProjectDetailResponse>(useProjectBase(id));
export const useProjectAdmin = () => typed<ProjectAdminResponse>(useApi(['projects', 'admin'], () => projectsApi.admin()));

export const useProjectParties = (id: ProjectKey) => typed<ProjectParty[]>(
  useApi(['projectParties', id], (signal: AbortSignal) => projectsApi.parties(id, signal), { enabled: !!id, retry: false }));

export const usePartySearch = (q: string, type: PartyType | undefined, enabled: boolean) => typed<PartySearchHit[]>(
  useApi(['projectParties', 'search', q, type ?? null], (signal: AbortSignal) => projectsApi.searchParties(q, type, signal),
    { enabled, staleTime: 30_000 }));

export function usePartyMutations(id: ProjectKey) {
  const put = useApiMutation(
    (v: { t: PartyType; partyId: string; body: PartyAssignmentBody }) => projectsApi.putParty(id, v.t, v.partyId, v.body),
    { invalidate: PARTY_ROOTS });
  const remove = useApiMutation(
    (v: { t: PartyType; partyId: string }) => projectsApi.removeParty(id, v.t, v.partyId),
    { invalidate: PARTY_ROOTS });
  return { put, remove };
}

export const useContractValueMutation = () => useApiMutation(
  (v: { id: ProjectKey; contractValue: string | null }) => projectsApi.setContractValue(v.id, v.contractValue),
  { invalidate: ['projects', 'project', 'projectParties', 'overview', 'today'], success: 'حُفظت قيمة العقد' });

/* ─── الموازنة التقديرية (خطة شهرية) ─── */
export const useBudgetPlans = () => typed<BudgetPlanListItem[]>(
  useApi(['budgetPlan', 'list'], (signal: AbortSignal) => projectsApi.budgetPlans(signal)));
export const useBudgetPlan = (id: string | null) => typed<BudgetPlan>(
  useApi(['budgetPlan', id], (signal: AbortSignal) => projectsApi.budgetPlan(id as string, signal), { enabled: !!id, retry: false }));

/* ─── الموازنة ─── */
export const useBudgetList = (q: BudgetQuery) =>
  typed<BudgetListResponse>(useApi(['budget', 'list', q], () => api.budgetList(q)));
export const useBudgetProject = (name: string | null) =>
  typed<BudgetProjectDetail>(useApi(['budget', 'project', name], () => api.budgetProject(name as string), { enabled: !!name }));
export const useBudgetOverview = () => typed<BudgetResponse>(useBudget());
