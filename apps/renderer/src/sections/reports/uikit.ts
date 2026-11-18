/**
 * نقطة استيراد واحدة لمكتبة الواجهة داخل القسم.
 * العقد يقول `@/ui`؛ وقت الكتابة لم يكن `src/ui/index.ts` قد أُنشئ بعد، فنستورد من
 * ملفات F مباشرة هنا وحدها — يوم يصل الفهرس تُستبدل هذه الأسطر بـ `export * from '@/ui'`.
 */
export {
  Money, Num, Pill, Chip, Seg, Tabs, Button, PageHeader, Grid, Island, EmptyState, Skeleton,
  type PillTone,
} from '@/ui/primitives';
export { Modal, confirm } from '@/ui/Modal';
export { toast } from '@/ui/Toast';
export { fmt, int, digits, dateTxt } from '@/ui/format';
export { usePrefs } from '@/ui/prefs';
