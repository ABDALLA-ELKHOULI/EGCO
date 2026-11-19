/** حارس النموذج: Escape على نموذج متغيّر يسأل قبل الإغلاق، و«عودة للنموذج» يحفظ القيمة. */
import { test, expect } from '@playwright/test';
import { gotoHash, tid } from './helpers';

/** زر الإضافة في رأس «الموردون» (كان «إضافة مورد» وصار «+ مورد»). */
const addSupplierButton = (page: import('@playwright/test').Page) =>
  tid(page, 'supplier-add', page.getByRole('button', { name: /^(إضافة مورد|\+ مورد)$/ }));

test('Escape على نموذج «إضافة مورد» المتغيّر يعرض تأكيد التجاهل ويبقي القيمة', async ({ page }) => {
  await gotoHash(page, '/parties/suppliers');
  await addSupplierButton(page).click();
  const dialog = page.getByRole('dialog', { name: 'إضافة مورد' });
  const nameInput = dialog.locator('label', { hasText: 'اسم المورد' }).locator('input');
  await nameInput.fill('قيمة لم تُحفظ بعد');

  await page.keyboard.press('Escape');
  const guard = page.getByRole('alertdialog');
  await expect(guard).toHaveAccessibleName('تغييرات غير محفوظة');
  await expect(guard.getByText('تجاهل التغييرات غير المحفوظة؟', { exact: true })).toBeVisible();

  await guard.getByRole('button', { name: 'عودة للنموذج' }).click();
  await expect(guard).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(nameInput).toHaveValue('قيمة لم تُحفظ بعد');

  // ثم التجاهل الصريح يغلق فعلاً
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').getByRole('button', { name: 'تجاهل والإغلاق' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('Escape على نموذج لم يتغيّر يغلقه مباشرة بلا سؤال', async ({ page }) => {
  await gotoHash(page, '/parties/suppliers');
  await addSupplierButton(page).click();
  await expect(page.getByRole('dialog', { name: 'إضافة مورد' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
