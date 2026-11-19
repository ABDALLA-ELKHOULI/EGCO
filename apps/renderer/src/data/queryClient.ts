/**
 * TanStack Query — ذاكرة مؤقتة + إلغاء التكرار + الإبطال بالحدث. الإعدادات من
 * FRONTEND-ANALYSIS §طبقة البيانات: staleTime 30s، gcTime 5min، تحديث هادئ عند عودة التركيز.
 */
import { keepPreviousData, QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: true,
      placeholderData: keepPreviousData,
      retry: (n, err) => n < 2 && !/^خطأ 4\d\d/.test(String((err as Error)?.message)) && (err as { status?: number })?.status !== 404,
    },
    mutations: { retry: 0 },
  },
});

/** يبطل الاستعلامات بجذر مفتاحها (المفتاح الأول) — نفس أسماء أحداث invalidate من الخادم. '*' = الكل. */
export function invalidate(keys: string[] | '*' | string) {
  if (keys === '*' || (Array.isArray(keys) && keys.includes('*'))) return queryClient.invalidateQueries();
  const set = new Set(Array.isArray(keys) ? keys : [keys]);
  return queryClient.invalidateQueries({ predicate: (q) => set.has(String(q.queryKey[0])) });
}
