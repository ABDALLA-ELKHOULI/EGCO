/** طبقة البيانات — العقد في docs/next/FRONTEND-CONTRACT.md §٣. */
export { queryClient, invalidate } from './queryClient';
export { qk, QUERY_ROOTS } from './keys';
export * from './hooks';
export { notifications, useNotifications } from './notifications';
export type { AppEvent, EventLink, Severity } from './notifications';
export { startEvents, restartEvents, stopEvents, onProgress } from './events';
export type { ProgressMsg } from './events';
export { request, serverPaths } from './client';
export { api, apiBase, ApiError } from '@/lib/api';
