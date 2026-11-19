/**
 * «ما الجديد» — مرتّبة بالإصدار لا بموضع المدخل في المصفوفة.
 *
 * WHATS_NEW في lib/whatsNew.ts مرتّبة يدوياً (0.13 أولاً ثم 0.12 ثم 0.10 ثم 0.11…)،
 * فـ toursSince('0.12.0') هناك يُسقط جولة 0.13.0، وزر الإعدادات يعرض 0.11.1 على أنه
 * «الأحدث». هنا نرتّب بالإصدار فلا يتوقف الصواب على ترتيب الكتابة.
 */
import { WHATS_NEW, type VersionTour } from '@/lib/whatsNew';

export function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export const toursAscending = (): VersionTour[] =>
  [...WHATS_NEW].sort((x, y) => cmpVersion(x.version, y.version));

/** الإصدارات بعد آخر ما رآه المستخدم وحتى الحالي (شاملاً). */
export function toursBetween(lastSeen: string | null, current: string): VersionTour[] {
  if (lastSeen === null) return [];
  return toursAscending().filter((t) => cmpVersion(t.version, lastSeen) > 0 && cmpVersion(t.version, current) <= 0);
}

export function latestTour(current?: string): VersionTour | null {
  const all = toursAscending().filter((t) => !current || cmpVersion(t.version, current) <= 0);
  return all[all.length - 1] ?? null;
}
