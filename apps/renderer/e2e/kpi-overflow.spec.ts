/** لا قيمة KPI تتجاوز عرض بطاقتها عند 1280 و1024 — الانكسار الذي كان يُكتشف باليد. */
import { test, expect } from '@playwright/test';
import { gotoHash } from './helpers';

const PAGES = ['/payables', '/projects', '/contractors', '/'];

for (const width of [1280, 1024]) {
  for (const route of PAGES) {
    test(`قيم KPI في ${route} لا تفيض عند ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await gotoHash(page, route);
      const values = page.locator('.kpi .value');
      await expect(values.first()).toBeVisible();
      const overflowing = await values.evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth + 1)
           .map((el) => `${el.textContent?.trim()} (${el.scrollWidth}>${el.clientWidth})`));
      expect(overflowing, `قيم تفيض عند ${width}px في ${route}`).toEqual([]);
    });
  }
}
