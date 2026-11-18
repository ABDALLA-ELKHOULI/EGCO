/** الوجهات الست في الشريط الجانبي — من prototype/shell.js (SECTIONS). */
import type { SectionKey } from '@/app/registry';
import type { IconName } from '@/ui/Icon';

export interface SectionDef { key: SectionKey; label: string; group?: string; icon: IconName }
export const SECTIONS: SectionDef[] = [
  { key: 'today', label: 'اليوم', group: 'العمل اليومي', icon: 'sun' },
  { key: 'parties', label: 'الأطراف', icon: 'users' },
  { key: 'projects', label: 'المشاريع', icon: 'grid' },
  { key: 'cash', label: 'النقد', icon: 'trend' },
  { key: 'reports', label: 'التقارير', icon: 'report' },
  { key: 'data', label: 'البيانات', group: 'النظام', icon: 'db' },
];
export const SECTION_KEYS = SECTIONS.map((s) => s.key);
export const sectionOf = (k: string) => SECTIONS.find((s) => s.key === k);
