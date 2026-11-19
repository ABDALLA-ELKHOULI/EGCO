/**
 * مفاتيح الاستعلام — الجذر (العنصر الأول) هو اسم المورد الذي يرسله الخادم في أحداث
 * `invalidate {keys:[…]}`. لا تخترع جذراً جديداً دون إضافته هنا وإبلاغ الخادم (الوكيل B).
 */
import type { ContractorQuery, Period, SupplierQuery, TrashKind } from '@/lib/api';

export const qk = {
  dashboard: (p: object = {}) => ['dashboard', p] as const,
  overview: () => ['overview'] as const,
  today: () => ['today'] as const,
  suppliers: (q: SupplierQuery = {}) => ['suppliers', q] as const,
  supplier: (account: string, p: Period = {}) => ['supplier', account, p] as const,
  contractors: (q: ContractorQuery = {}) => ['contractors', q] as const,
  contractor: (code: string) => ['contractor', code] as const,
  guarantees: () => ['guarantees'] as const,
  projects: () => ['projects'] as const,
  project: (name: string) => ['project', name] as const,
  budget: (...args: unknown[]) => ['budget', ...args] as const,
  cashflow: (p: object = {}) => ['cashflow', p] as const,
  revenues: (p: object = {}) => ['revenues', p] as const,
  coverage: (staleDays = 90) => ['coverage', staleDays] as const,
  report: (...args: unknown[]) => ['report', ...args] as const,
  backups: () => ['backups'] as const,
  trash: (kind?: TrashKind) => ['trash', kind ?? null] as const,
  imports: () => ['imports'] as const,
  events: (status: 'unread' | 'all') => ['events', status] as const,
};

/** كل الجذور المعروفة — للتوثيق والتحقق. */
export const QUERY_ROOTS = ['dashboard', 'overview', 'today', 'suppliers', 'supplier', 'contractors', 'contractor', 'guarantees',
  'projects', 'project', 'budget', 'cashflow', 'revenues', 'coverage', 'report', 'backups', 'trash', 'imports', 'events'] as const;
