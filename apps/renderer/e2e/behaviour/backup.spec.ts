/** قفل سلوك م-٤٥: «نسخة الآن» تُنشئ نسخة يدوية تظهر في القائمة وفي الخادم. */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, R, tid } from '../helpers';

test('إنشاء نسخة احتياطية يدوية', async ({ page, request }) => {
  const list = async () => {
    const j = await (await request.get(`${API_BASE}/api/v1/backups`)).json();
    return (Array.isArray(j) ? j : j.items ?? j.backups ?? []) as { name: string; kind: string }[];
  };
  const before = (await list()).filter((b) => b.kind === 'manual').length;

  await gotoHash(page, R.backups);
  await tid(page, 'backup-now', page.getByRole('button', { name: 'نسخة الآن' })).click();
  await expect(page.getByText(/أُخذت (ال)?نسخة/)).toBeVisible();

  await expect.poll(async () => (await list()).filter((b) => b.kind === 'manual').length).toBe(before + 1);

  // تنظيف: حذف النسخة اليدوية التي صُنعت هنا
  const made = (await list()).filter((b) => b.kind === 'manual');
  for (const b of made.slice(0, made.length - before)) {
    await request.delete(`${API_BASE}/api/v1/backups/${encodeURIComponent(b.name)}`);
  }
});
