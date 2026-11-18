/** قفل سلوك: نموذج متغيّر لا يُغلق بـEscape دون سؤال؛ «عودة» تحفظ ما كُتب؛ «تجاهل» يغلق. */
import { test, expect } from '@playwright/test';
import { gotoHash, tid } from '../helpers';

test('حارس التغييرات غير المحفوظة على نموذج المورد', async ({ page }) => {
  await gotoHash(page, '/suppliers');
  await tid(page, 'supplier-add', page.getByRole('button', { name: /^(إضافة مورد|\+ مورد)$/ })).click();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('اسم المورد');
  await name.fill('لم يُحفظ');

  await page.keyboard.press('Escape');
  const guard = tid(page, 'unsaved-guard', page.getByRole('alertdialog'));
  await expect(guard).toBeVisible();
  await tid(page, 'unsaved-back', page.getByRole('button', { name: /عودة/ })).click();
  await expect(guard).toHaveCount(0);
  await expect(name).toHaveValue('لم يُحفظ');

  await page.keyboard.press('Escape');
  await tid(page, 'unsaved-discard', page.getByRole('button', { name: /تجاهل/ })).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});

test('نموذج لم يتغيّر يُغلق بـEscape بلا سؤال', async ({ page }) => {
  await gotoHash(page, '/suppliers');
  await tid(page, 'supplier-add', page.getByRole('button', { name: /^(إضافة مورد|\+ مورد)$/ })).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
});
