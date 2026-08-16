/**
 * شرائح التأخر — مصدر واحد للحقيقة في الواجهة.
 *
 * These mirror DELAY_BUCKETS in services/api/app/domain/payables.py. The server is
 * the authority for every AMOUNT; this table exists only so the UI can label a
 * bucket and decide which invoice rows belong to it when the user clicks one.
 * Keeping the boundaries in one place is the point: two copies of «61–90» that
 * drift apart would put an invoice in a bucket whose total does not contain it.
 */
export interface DelayBucket {
  value: string;
  label: string;
  hint: string;
  /** الحد الأعلى بالأيام — null يعني «ما بعد ذلك» */
  upper: number | null;
}

export const DELAY_BUCKETS: DelayBucket[] = [
  { value: 'm1', label: 'شهر', hint: '١–٣٠ يوماً', upper: 30 },
  { value: 'm2', label: 'شهران', hint: '٣١–٦٠', upper: 60 },
  { value: 'm3', label: '٣ أشهر', hint: '٦١–٩٠', upper: 90 },
  { value: 'm4', label: '٤ أشهر', hint: '٩١–١٢٠', upper: 120 },
  { value: 'm5', label: '٥ أشهر', hint: '١٢١–١٥٠', upper: 150 },
  { value: 'm6', label: '٦ أشهر', hint: '١٥١–١٨٠', upper: 180 },
  { value: 'm6_plus', label: 'أكثر من ٦ أشهر', hint: '١٨١+', upper: null },
  { value: 'none', label: 'بلا تأخر', hint: '', upper: null },
];

/** الشريحة التي يقع فيها تأخر بمقدار late يوماً — null إن لم يتأخر بعد. */
export function bucketOfDays(late: number): string | null {
  if (late <= 0) return null;
  for (const b of DELAY_BUCKETS) {
    if (b.value === 'none') continue;
    if (b.upper === null || late <= b.upper) return b.value;
  }
  return 'm6_plus';
}

export const bucketLabel = (v: string | null | undefined) =>
  DELAY_BUCKETS.find((b) => b.value === v)?.label ?? '';
