/** رقم واحد لـ«المديونية المفتوحة» في اللوحة والموردين والمشاريع — الرقم المبذور نفسه. */
import { test, expect } from '@playwright/test';
import { gotoHash, SEED } from './helpers';

test('المديونية المفتوحة متطابقة في اللوحة والموردين والمشاريع', async ({ page }) => {
  await gotoHash(page, '/payables');
  const dashKpi = page.locator('.kpi', { has: page.locator('.label', { hasText: 'المديونية المفتوحة' }) }).first();
  await expect(dashKpi.locator('.value')).toHaveText(SEED.outstanding);

  await gotoHash(page, '/suppliers');
  await expect(page.locator('.count')).toContainText(`مفتوح ${SEED.outstanding} ر.س`);

  await gotoHash(page, '/projects');
  const projKpi = page.locator('.kpi', { has: page.locator('.label', { hasText: 'مديونية الموردين المفتوحة' }) }).first();
  await expect(projKpi.locator('.value')).toHaveText(SEED.outstanding);
});
