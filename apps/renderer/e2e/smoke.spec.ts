/** كل مسار في App.tsx يفتح بلا خطأ كونسول وبلا شاشة «تعذّر الاتصال». */
import { test, expect } from '@playwright/test';
import { collectErrors, gotoHash, SEED } from './helpers';

// نفس القائمة في apps/renderer/src/app/App.tsx — المسارات ذات المعاملات تُملأ من البذرة.
const ROUTES = [
  '/', '/payables', '/suppliers', `/suppliers/${SEED.supplierAccount}`,
  '/contractors', `/contractors/${SEED.contractorCode}`, '/guarantees', '/budget',
  '/projects', `/projects/${encodeURIComponent(SEED.project)}`, '/cashflow', '/revenues',
  '/loans', '/obligations', '/expenses', '/coverage', '/calendar', '/import', '/report',
  '/settings', '/settings/trash', '/settings/projects',
];

for (const route of ROUTES) {
  test(`المسار ${route} يفتح بلا أخطاء`, async ({ page }) => {
    const errors = collectErrors(page);
    await gotoHash(page, route);
    await expect(page.locator('main.main')).toBeVisible();
    await expect(page.getByText('تعذّر الاتصال')).toHaveCount(0);
    await expect(page.getByText('حدث خطأ غير متوقع')).toHaveCount(0);
    expect(errors, `أخطاء الكونسول في ${route}`).toEqual([]);
  });
}
