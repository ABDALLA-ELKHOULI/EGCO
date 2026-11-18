/**
 * قفل سلوك م-٤٦: تأخر المقاول يُحسب فقط لمن له مدة سداد. بلا مدة: لا رقم (لا صفر
 * مخترع). بمدة: المبلغ الذي يقوله الخادم يظهر في بطاقة المقاول.
 */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, money, SEED } from '../helpers';

const URL = `${API_BASE}/api/v1/contractors/${SEED.contractorCode}`;

test.afterEach(async ({ request }) => {
  await request.put(URL, { data: { paymentTermDays: null } });
});

test('المتأخر يظهر فقط بعد ضبط مدة السداد', async ({ page, request }) => {
  await request.put(URL, { data: { paymentTermDays: null } });
  const before = await (await request.get(URL)).json();
  expect(before.delay ?? null).toBeNull();

  await gotoHash(page, `/contractors/${SEED.contractorCode}`);
  await expect(page.getByText(/لا مدة سداد/).first()).toBeVisible();

  const put = await request.put(URL, { data: { paymentTermDays: 10 } });
  expect(put.ok(), await put.text()).toBeTruthy();
  const after = await (await request.get(URL)).json();
  const amount: number = after.delay?.overdue?.amount;
  expect(amount, JSON.stringify(after.delay)).toBeGreaterThan(0);

  // نفس الـhash = تنقّل داخل المستند بلا إعادة جلب — إعادة تحميل صريحة كما يفعل المستخدم
  await page.reload();
  await expect(page.getByText(/لا مدة سداد مضبوطة/)).toHaveCount(0);
  await expect(page.getByText(money(amount)).first()).toBeVisible();
});
