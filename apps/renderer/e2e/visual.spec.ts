/**
 * لقطات مرجعية للوحة والموردين والمقاولين في الفاتح والداكن.
 * تُولَّد وتُشغَّل على macOS فقط (الخطوط تختلف بين الأنظمة) — على غيره تُتخطّى صراحة.
 * ما يتغيّر مع الأيام (تواريخ، عدّادات أيام) يُحجب حتى لا تنكسر اللقطة غداً.
 * التحديث: npm --workspace apps/renderer run e2e:update
 */
import { test, expect } from '@playwright/test';
import { gotoHash, TIME_SENSITIVE, useDarkTheme } from './helpers';

test.skip(process.platform !== 'darwin', 'اللقطات المرجعية مولَّدة على macOS فقط');

const PAGES: [string, string][] = [
  ['اللوحة', '/payables'],
  ['الموردون', '/suppliers'],
  ['المقاولون', '/contractors'],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'dark' ? 'الوضع الداكن' : 'الوضع الفاتح', () => {
    test.use({ colorScheme: scheme });
    for (const [label, route] of PAGES) {
      test(`لقطة ${label}`, async ({ page }) => {
        if (scheme === 'dark') await useDarkTheme(page);
        await gotoHash(page, route);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${route.slice(1)}-${scheme}.png`, {
          fullPage: false,
          mask: [page.getByText(TIME_SENSITIVE)],
        });
      });
    }
  });
}
