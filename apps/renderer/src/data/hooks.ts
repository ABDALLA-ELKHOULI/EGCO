/**
 * hooks البيانات — أغلفة رقيقة فوق lib/api.ts بمفاتيح qk. الفرز والتصفية تبقى على الخادم:
 * معاملات الاستعلام جزء من المفتاح، و keepPreviousData يمنع الوميض عند تغييرها.
 */
import { useMutation, useQuery, type QueryKey, type UseQueryOptions } from '@tanstack/react-query';
import { api, type ContractorQuery, type Period, type SupplierQuery, type TrashKind } from '@/lib/api';
import { toast } from '@/ui/Toast';
import { invalidate } from './queryClient';
import { qk } from './keys';
import { hasPath, request } from './client';

type Opts<T> = Omit<UseQueryOptions<T, Error, T, QueryKey>, 'queryKey' | 'queryFn'>;

/** أي نقطة بلا hook جاهز: useApi(['root', …args], () => api.something(…)). */
export function useApi<T>(key: QueryKey, fn: (signal: AbortSignal) => Promise<T>, opts: Opts<T> = {}) {
  return useQuery<T, Error, T, QueryKey>({ queryKey: key, queryFn: ({ signal }) => fn(signal), ...opts });
}

export const useDashboard = (p: Period & { project?: string } = {}) => useApi(qk.dashboard(p), () => api.dashboard(p));
export const useOverview = () => useApi(qk.overview(), () => api.overview());
/** /api/v1/today (الخادم B، جديد). قبل وجوده: خطأ هادئ بلا طلب 404 (يُكتشف من openapi). */
export function useToday<T = unknown>() {
  return useApi<T>(qk.today(), async (signal) => {
    if ((await hasPath('/api/v1/today')) === false) throw Object.assign(new Error('مسار «اليوم» غير متاح في هذه النسخة من الخدمة'), { status: 404 });
    return request<T>('/api/v1/today', { signal });
  }, { staleTime: 0 });
}
export const useSuppliers = (q: SupplierQuery = {}) => useApi(qk.suppliers(q), () => api.suppliers(q));
export const useSupplier = (account: string, p: Period = {}) =>
  useApi(qk.supplier(account, p), () => api.supplier(account, p), { enabled: !!account });
export const useContractors = (q: ContractorQuery = {}) => useApi(qk.contractors(q), () => api.contractorsList(q));
export const useContractor = (code: string) => useApi(qk.contractor(code), () => api.contractor(code), { enabled: !!code });
export const useGuarantees = () => useApi(qk.guarantees(), () => api.guarantees());
export const useProjects = () => useApi(qk.projects(), () => api.projects());
export const useProject = (name: string) => useApi(qk.project(name), () => api.project(name), { enabled: !!name });
export const useBudget = () => useApi(qk.budget('overview'), () => api.budget());
export const useCashflow = (p: Parameters<typeof api.cashflow>[0] = {}) => useApi(qk.cashflow(p ?? {}), () => api.cashflow(p));
export const useRevenues = (p: Parameters<typeof api.revenues>[0] = {}) => useApi(qk.revenues(p ?? {}), () => api.revenues(p));
export const useCoverage = (staleDays = 90) => useApi(qk.coverage(staleDays), () => api.coverage(staleDays));
export const useBackups = () => useApi(qk.backups(), () => api.backups());
export const useTrash = (kind?: TrashKind) => useApi(qk.trash(kind), () => api.trash(kind));
export const useImportHistory = () => useApi(qk.imports(), () => api.importHistory());

export interface MutationOpts<R> {
  /** جذور المفاتيح التي تُبطَل بعد النجاح. */
  invalidate?: string[];
  /** نص toast النجاح (أو دالة من النتيجة). */
  success?: string | ((r: R) => string);
  /** false = لا toast للخطأ (المستدعي يعرضه). */
  errorToast?: boolean;
  onSuccess?: (r: R) => void;
}
/** طفرة + إبطال + toast. لا تحديث تفاؤلي لأي رقم مالي. */
export function useApiMutation<V, R>(fn: (v: V) => Promise<R>, o: MutationOpts<R> = {}) {
  return useMutation<R, Error, V>({
    mutationFn: fn,
    onSuccess: async (r) => {
      if (o.invalidate?.length) await invalidate(o.invalidate);
      if (o.success) toast(typeof o.success === 'function' ? o.success(r) : o.success);
      o.onSuccess?.(r);
    },
    onError: (e) => { if (o.errorToast !== false) toast(String(e?.message || e), { kind: 'error' }); },
  });
}
