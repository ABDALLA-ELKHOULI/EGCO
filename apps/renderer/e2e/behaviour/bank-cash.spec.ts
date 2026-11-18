/** الرصيد البنكي (API-CONTRACT §٤): يُدخل من شاشة التدفق ← يصبح الرصيد الافتتاحي للتوقع وفي «اليوم». */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, money } from '../helpers';

const api = (p: string) => `${API_BASE}/api/v1${p}`;
test.afterEach(async ({ request }) => { await request.put(api('/settings/bank-balance'), { data: { balance: null } }); });

test('إدخال رصيد البنك يغذّي توقع النقد', async ({ page, request }) => {
  await request.put(api('/settings/bank-balance'), { data: { balance: null } });
  const before = await (await request.get(api('/cashflow?weeks=26'))).json();
  expect(before.openingBalanceSource).toBe('none');

  await gotoHash(page, '/cash/flow');
  await expect(page.getByRole('heading', { name: /كم في البنك/ })).toBeVisible();
  await page.getByLabel(/الرصيد البنكي/).first().fill('820000');
  await page.getByRole('button', { name: /احفظ/ }).click();

  await expect.poll(async () => (await (await request.get(api('/settings/bank-balance'))).json()).balance).toBe('820000.00');
  const after = await (await request.get(api('/cashflow?weeks=26'))).json();
  expect(after.openingBalanceSource).toBe('bank');
  await expect(page.getByText(money(820000)).first()).toBeVisible();

  const today = await (await request.get(api('/today'))).json();
  expect(today.cashBasis).toBe('bank');
  expect(Number(today.kpis?.bankBalance ?? today.bankBalance)).toBe(820000);
  // أول يوم في cash30 يبدأ من الرصيد البنكي (ناقص المتأخر) لا من صفر
  expect(Number(today.cash30[0].balance)).toBeGreaterThan(Number(before.summary?.opening ?? -Infinity) - 1);

  await gotoHash(page, '/today');
  // المرئي فقط (الرسم يحمل الرقم أيضاً في <title> مخفي) — ولا تنبيه «غير مُدخل» بجانبه (BUG-008)
  await expect(page.locator(`:text("${money(820000)}"):visible`).first()).toBeVisible();
  await expect(page.getByText(/رصيد البنك غير مُدخل/)).toHaveCount(0);
  await expect(page.getByText(/من رصيد افتتاحي صفر/)).toHaveCount(0);
});
