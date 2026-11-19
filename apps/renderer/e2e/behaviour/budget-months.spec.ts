/** قفل سلوك: إدارة أشهر الموازنة — إضافة شهر يدوياً، تعديله، حذفه. */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, money, moneyCell, R, tid } from '../helpers';

const PROJECT = 'السدن';
const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 3);
const MONTH = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

type Month = { id: number; month: string; actualMonth: number; plannedMonth: number };
async function months(request: import('@playwright/test').APIRequestContext): Promise<Month[]> {
  const r = await request.get(`${API_BASE}/api/v1/budget/project/${encodeURIComponent(PROJECT)}`);
  return (await r.json()).months;
}

test.afterEach(async ({ request }) => {
  for (const m of await months(request)) {
    if (m.month.startsWith(MONTH)) await request.delete(`${API_BASE}/api/v1/budget/${m.id}`);
  }
});

test('إضافة شهر ثم تعديله ثم حذفه', async ({ page, request }) => {
  page.on('dialog', (dlg) => dlg.accept()); // تأكيد الحذف (window.confirm اليوم)
  const n0 = (await months(request)).length;
  const cell = (v: number) => moneyCell(page, v);

  await gotoHash(page, R.budget);
  await tid(page, 'budget-manage', page.getByRole('button', { name: /إدارة الأشهر/ })).click();
  const manage = page.getByRole('dialog').first();
  await manage.getByRole('button', { name: 'إضافة شهر' }).click();
  const form = page.getByRole('dialog').last();
  // ui/fit.ts يعرض حقل الشهر الفارغ نصاً (عنصر نائب عربي) ويعيده type=month عند التركيز —
  // يُنتظر التحويل قبل الكتابة وإلا يسبق fill التحويلَ فتضيع القيمة.
  const monthInput = form.getByLabel('الشهر');
  await monthInput.focus();
  await expect(monthInput).toHaveAttribute('type', 'month');
  await monthInput.fill(MONTH);
  await expect(monthInput).toHaveValue(MONTH);
  await form.getByLabel(/الفعلي للشهر/).fill('1234');
  await form.getByLabel(/المخطط للشهر/).fill('4321');
  await form.getByRole('button', { name: 'حفظ' }).click();

  await expect.poll(async () => (await months(request)).length).toBe(n0 + 1);
  await expect(page.getByText(money(1234)).first()).toBeVisible();

  // تعديل
  const row = manage.getByRole('row').filter({ has: manage.getByTestId(`budget-month-row-${MONTH}`).or(cell(1234)) }).first();
  await row.getByRole('button', { name: 'تعديل' }).click();
  const edit = page.getByRole('dialog').last();
  await edit.getByLabel(/الفعلي للشهر/).fill('5678');
  await edit.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(async () =>
    (await months(request)).find((m) => m.month.startsWith(MONTH))?.actualMonth).toBe(5678);
  await expect(page.getByText(money(5678)).first()).toBeVisible();

  // حذف
  const row2 = manage.getByRole('row').filter({ has: manage.getByTestId(`budget-month-row-${MONTH}`).or(cell(5678)) }).first();
  await row2.getByRole('button', { name: /^حذف/ }).click();
  // الجديد: حوار تأكيد داخل التطبيق · القديم: window.confirm (مقبول تلقائياً أعلاه)
  const ask = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: /حذف شهر/ }) });
  if (await ask.count().then((n) => n > 0, () => false) || await ask.waitFor({ timeout: 2000 }).then(() => true, () => false)) {
    await tid(page, 'confirm-ok', ask.getByRole('button', { name: 'حذف', exact: true })).click();
  }
  await expect.poll(async () => (await months(request)).length).toBe(n0);
  await expect(cell(5678)).toHaveCount(0);
  // نص التأكيد يعد بأن «سيُعاد حساب تراكمي الأشهر التالية» — الشهر المبذور يعود تراكميه كما كان
  const seedMonth = (await months(request)).find((m) => !m.month.startsWith(MONTH)) as Month & { cumActual: number };
  expect(seedMonth.cumActual).toBeCloseTo(seedMonth.actualMonth, 2);
});
