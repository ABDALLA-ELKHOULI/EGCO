/** إضافة مورد → يظهر → حذف → يختفي → في السلّة → استرجاع → يعود. */
import { test, expect } from '@playwright/test';
import { API_BASE, collectErrors, gotoHash, R, tid } from './helpers';

/** زر الإضافة في رأس «الموردون» (كان «إضافة مورد» وصار «+ مورد»). */
const addSupplierButton = (page: import('@playwright/test').Page) =>
  tid(page, 'supplier-add', page.getByRole('button', { name: /^(إضافة مورد|\+ مورد)$/ }));

const ACCOUNT = '2119999';
const NAME = 'مورد اختبار الواجهة';

// تنظيف نهائي عبر API: حذف ثم إفراغ من السلّة — حتى لا يبقى المورد المصنوع في القاعدة
// المشتركة فيظهر في لقطات visual.spec المرجعية أو في عدّ الاختبارات التالية.
test.afterEach(async ({ request }) => {
  await request.delete(`${API_BASE}/api/v1/suppliers/${ACCOUNT}`);
  await request.delete(`${API_BASE}/api/v1/trash/supplier/${ACCOUNT}?confirm=true`);
});

test('دورة حياة المورد: إضافة ثم حذف ثم استرجاع من السلّة', async ({ page }) => {
  const errors = collectErrors(page);
  await gotoHash(page, '/parties/suppliers');

  // إضافة
  await addSupplierButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'إضافة مورد' })).toBeVisible();
  await dialog.locator('label', { hasText: 'رقم الحساب' }).locator('input').fill(ACCOUNT);
  await dialog.locator('label', { hasText: 'اسم المورد' }).locator('input').fill(NAME);
  await dialog.locator('label', { hasText: 'مدة السداد' }).locator('input').fill('30 يوم');
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toHaveCount(0);
  // التصميم الجديد يفتح صفحة المورد الجديد مباشرة بعد الحفظ، ثم نعود للقائمة
  await expect(page).toHaveURL(new RegExp(`#/parties/suppliers/${ACCOUNT}$`));
  await expect(page.getByText(NAME).first()).toBeVisible();
  await gotoHash(page, '/parties/suppliers');
  const row = page.locator('tbody tr', { hasText: NAME });
  await expect(row).toHaveCount(1);

  // حذف (مورد بلا حركات — تأكيد بسيط)
  await row.getByRole('button', { name: 'حذف' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByRole('heading', { name: 'حذف مورد' })).toBeVisible();
  await confirm.getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(0);

  // في السلّة
  await gotoHash(page, R.trash);
  const trashRow = page.locator('tbody tr', { hasText: NAME });
  await expect(trashRow).toHaveCount(1);
  await expect(trashRow).toContainText('مورد');

  // استرجاع
  await trashRow.getByRole('button', { name: 'استرجاع' }).click();
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(0);

  await gotoHash(page, '/parties/suppliers');
  await expect(page.locator('tbody tr', { hasText: NAME })).toHaveCount(1);

  expect(errors).toEqual([]);
});
