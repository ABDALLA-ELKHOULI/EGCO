/** رقم واحد لـ«المديونية المفتوحة» في بطاقات المستحقات والموردين والمشاريع — الرقم المبذور نفسه. */
import { test, expect, type Page } from '@playwright/test';
import { gotoHash, SEED } from './helpers';

const exact = new RegExp(`^${SEED.outstanding.replace(/[.,]/g, '\\$&')}\\s*(ر\\.س)?$`);
/** قيمة بطاقة KPI (‹Kpi› في ui/charts.tsx) بعنوانها. */
const kpiValue = (page: Page, label: string) =>
  page.locator('.ui-kpi', { has: page.locator('.ih h2', { hasText: label }) }).first().locator(':scope > :is(.kpi, .hero)');

test('المديونية المفتوحة متطابقة في المستحقات والموردين والمشاريع', async ({ page }) => {
  await gotoHash(page, '/today/due'); // كان /payables
  await expect(kpiValue(page, 'المديونية المفتوحة')).toHaveText(exact);

  await gotoHash(page, '/parties/suppliers');
  await expect(kpiValue(page, 'المديونية المفتوحة')).toHaveText(exact);
  await expect(page.getByText(`مفتوح ${SEED.outstanding}`)).toBeVisible(); // سطر العدّ تحت العنوان

  await gotoHash(page, '/projects');
  await expect(kpiValue(page, 'مديونية الموردين المفتوحة')).toHaveText(exact);

  await gotoHash(page, '/today');
  await expect(page.getByTestId('kpi-outstanding')).toHaveText(exact);
});
