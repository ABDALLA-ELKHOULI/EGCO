/**
 * لقطات مرجعية للوحة والموردين والمقاولين في الفاتح والداكن.
 * تُولَّد وتُشغَّل على macOS فقط (الخطوط تختلف بين الأنظمة) — على غيره تُتخطّى صراحة.
 * ما يتغيّر مع الأيام (تواريخ، عدّادات أيام) يُحجب حتى لا تنكسر اللقطة غداً.
 * التحديث: npm --workspace apps/renderer run e2e:update
 */
import { test, expect } from '@playwright/test';
import { gotoHash, TIME_SENSITIVE, useDarkTheme } from './helpers';

test.skip(process.platform !== 'darwin', 'اللقطات المرجعية مولَّدة على macOS فقط');
// اللقطات مولَّدة على جهاز التطوير بـGoogle Chrome (channel=chrome). مُشغِّل CI يستعمل Chromium
// المرفق (E2E_CHANNEL=bundled) على جهاز افتراضي مختلف العرض والخطوط (Cairo غير مضمَّن — الخط
// يسقط لما في النظام) — مقارنة بكسلية هناك تفشل لسبب بيئي لا لخلل. تُتخطّى صراحة؛ تُشغَّل وتُحدَّث محلياً.
test.skip(process.env.E2E_CHANNEL === 'bundled', 'لا لقطات مرجعية لبيئة Chromium المرفق (CI)');

// [العنوان، المسار، اسم اللقطة] — نفس الشاشات الثلاث قبل «أرخبيل» بمساراتها الجديدة.
const PAGES: [string, string, string][] = [
  ['المستحقات', '/today/due', 'due'],
  ['الموردون', '/parties/suppliers', 'suppliers'],
  ['المقاولون', '/parties/contractors', 'contractors'],
];

for (const scheme of ['light', 'dark'] as const) {
  test.describe(scheme === 'dark' ? 'الوضع الداكن' : 'الوضع الفاتح', () => {
    test.use({ colorScheme: scheme });
    for (const [label, route, shot] of PAGES) {
      test(`لقطة ${label}`, async ({ page }) => {
        if (scheme === 'dark') await useDarkTheme(page);
        await gotoHash(page, route);
        await page.evaluate(() => document.fonts.ready);
        await expect(page).toHaveScreenshot(`${shot}-${scheme}.png`, {
          fullPage: false,
          mask: [page.getByText(TIME_SENSITIVE)],
        });
      });
    }
  });
}
