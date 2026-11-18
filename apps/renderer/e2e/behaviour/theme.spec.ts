/** قفل سلوك: تبديل الوضع الليلي/النهاري يُطبَّق فوراً ويبقى بعد إعادة التحميل. */
import { test, expect } from '@playwright/test';
import { gotoHash, R, tid } from '../helpers';

test('تبديل السمة يثبت بعد إعادة التحميل', async ({ page }) => {
  await page.addInitScript(() => {
    try { if (!sessionStorage.getItem('qa-init')) { localStorage.setItem('egco-theme', 'light'); sessionStorage.setItem('qa-init', '1'); } } catch { /* */ }
  });
  await gotoHash(page, R.settings);
  const html = page.locator('html');
  await expect(html).not.toHaveAttribute('data-theme', 'dark');

  // الجديد: أزرار «فاتح/داكن/تلقائي» · القديم: زر تبديل واحد «الوضع الليلي/النهاري»
  const dark = () => tid(page, 'theme-dark', page.getByRole('button', { name: /^(داكن|الوضع الليلي)$/ }));
  const light = () => tid(page, 'theme-light', page.getByRole('button', { name: /^(فاتح|الوضع النهاري)$/ }));
  await dark().click();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', 'dark');

  await light().click();
  await expect(html).not.toHaveAttribute('data-theme', 'dark');
});
