/** قفل سلوك: إضافة مورد → يظهر → حذف → في السلّة → استرجاع → يعود. */
import { test, expect } from '@playwright/test';
import { API_BASE, collectErrors, gotoHash, R, tid } from '../helpers';

const ACCOUNT = '2119991';
const NAME = 'مورد قفل السلوك';

test.afterEach(async ({ request }) => {
  await request.delete(`${API_BASE}/api/v1/suppliers/${ACCOUNT}`);
  await request.delete(`${API_BASE}/api/v1/trash/supplier/${ACCOUNT}?confirm=true`);
});

test('مورد: إضافة ثم حذف ثم استرجاع', async ({ page, request }) => {
  const errors = collectErrors(page);
  await gotoHash(page, '/suppliers');

  await tid(page, 'supplier-add', page.getByRole('button', { name: /^(إضافة مورد|\+ مورد)$/ })).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('رقم الحساب').fill(ACCOUNT);
  await dialog.getByLabel('اسم المورد').fill(NAME);
  await dialog.getByRole('button', { name: 'حفظ' }).click();
  await expect(dialog).toHaveCount(0);
  // الجديد ينقل لصفحة المورد بعد الإضافة، القديم يبقى في القائمة — كلاهما مقبول؛ يُتحقّق من القائمة
  await gotoHash(page, '/suppliers');
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toBeVisible();
  expect((await request.get(`${API_BASE}/api/v1/suppliers/${ACCOUNT}`)).ok()).toBeTruthy();

  const row = tid(page, `party-row-${ACCOUNT}`, page.getByRole('row', { name: new RegExp(NAME) }));
  await row.getByRole('button', { name: 'حذف' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'حذف', exact: true }).click();
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0);

  await gotoHash(page, R.trash);
  const trashRow = page.getByRole('row', { name: new RegExp(NAME) });
  await expect(trashRow).toBeVisible();
  await tid(page, 'trash-restore', trashRow.getByRole('button', { name: 'استرجاع' })).click();
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toHaveCount(0);

  await gotoHash(page, '/suppliers');
  await page.reload();
  await expect(page.getByRole('row', { name: new RegExp(NAME) })).toBeVisible();
  expect(errors).toEqual([]);
});
