/* عميل قسم المشاريع. المسارات القائمة عبر api (lib/api.ts)، ومسارات م-٥٠ (API-CONTRACT §٣)
   عبر request من @/data/client — العقد §٦ يمنع fetch مباشراً خارج @/data. */
import { api } from '@/lib/api';
import { request } from '@/data/client';
import type {
  PartyAssignmentBody, PartyType, ProjectAdminResponse, ProjectDetailResponse,
  ProjectKey, ProjectListResponse, BudgetPlan, BudgetPlanListItem, ProjectParty, PartySearchHit, ProjectRegistryItem, MergePreview,
} from './types';

const P = (id: ProjectKey) => `/api/v1/projects/${encodeURIComponent(id)}`;

export const projectsApi = {
  list: () => api.projects() as Promise<ProjectListResponse>,
  detail: (id: ProjectKey) => api.project(id) as Promise<ProjectDetailResponse>,
  admin: () => api.projectAdmin() as Promise<ProjectAdminResponse>,
  mergePreview: (from: string, into: string) => api.projectMergePreview(from, into) as Promise<MergePreview>,
  merge: (from: string, into: string) => api.projectMerge(from, into),

  /* الموازنة التقديرية (خطة شهرية) */
  budgetPlans: (signal?: AbortSignal) => request<BudgetPlanListItem[]>('/api/v1/projects/budget-plans', { signal }),
  budgetPlan: (id: ProjectKey, signal?: AbortSignal) => request<BudgetPlan>(`${P(id)}/budget-plan`, { signal }),

  /* م-٥٠ */
  parties: (id: ProjectKey, signal?: AbortSignal) => request<ProjectParty[]>(`${P(id)}/parties`, { signal }),
  searchParties: (q: string, type?: PartyType, signal?: AbortSignal) =>
    request<PartySearchHit[]>(`/api/v1/parties/search?${new URLSearchParams({ q, limit: '20', ...(type ? { type } : {}) })}`, { signal }),
  setContractValue: (id: ProjectKey, contractValue: string | null) =>
    request<ProjectRegistryItem>(P(id), { method: 'PUT', body: JSON.stringify({ contractValue }) }),
  putParty: (id: ProjectKey, t: PartyType, partyId: string, body: PartyAssignmentBody) =>
    request<unknown>(`${P(id)}/parties/${t}/${encodeURIComponent(partyId)}`,
      { method: 'PUT', body: JSON.stringify(body) }),
  removeParty: (id: ProjectKey, t: PartyType, partyId: string) =>
    request<unknown>(`${P(id)}/parties/${t}/${encodeURIComponent(partyId)}`, { method: 'DELETE' }),
};
