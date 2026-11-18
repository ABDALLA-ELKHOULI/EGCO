/** قفل سلوك م-٣٠: دمج مشروعين — معاينة الأثر ثم التنفيذ؛ المصدر يختفي ومورده ينتقل للهدف. */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, R, tid } from '../helpers';

const A = { account: '2119981', name: 'مورد دمج أ', project: 'مشروع دمج مصدر' };
const B = { account: '2119982', name: 'مورد دمج ب', project: 'مشروع دمج هدف' };

test.beforeEach(async ({ request }) => {
  for (const s of [A, B]) {
    const r = await request.post(`${API_BASE}/api/v1/suppliers`, {
      data: { account: s.account, name: s.name, project: s.project, projects: [s.project], term: '30 يوم' },
    });
    expect(r.ok(), await r.text()).toBeTruthy();
  }
});

test.afterEach(async ({ request }) => {
  for (const s of [A, B]) {
    await request.delete(`${API_BASE}/api/v1/suppliers/${s.account}`);
    await request.delete(`${API_BASE}/api/v1/trash/supplier/${s.account}?confirm=true`);
  }
});

test('دمج مشروع في آخر بعد المعاينة', async ({ page, request }) => {
  await gotoHash(page, R.projectAdmin);
  await tid(page, 'merge-from', page.getByRole('combobox').nth(0)).selectOption(A.project);
  await tid(page, 'merge-into', page.getByRole('combobox').nth(1)).selectOption(B.project);
  // القديم: زر «معاينة الأثر» · الجديد: المعاينة تلقائية عند الاختيار
  const pv = page.getByRole('button', { name: /معاينة/ });
  if (await pv.count()) await pv.click();
  await expect(page.getByText(/سيتأثر/)).toBeVisible();
  await tid(page, 'merge-run', page.getByRole('button', { name: /تنفيذ الدمج/ })).click();
  // الجديد يسأل تأكيداً في حوار؛ القديم ينفّذ مباشرة
  const ask = page.getByRole('dialog', { name: /دمج/ });
  if (await ask.waitFor({ timeout: 2000 }).then(() => true, () => false)) {
    await tid(page, 'confirm-ok', ask.getByRole('button', { name: 'دمج', exact: true })).click();
  }
  await expect.poll(async () =>
    (await (await request.get(`${API_BASE}/api/v1/suppliers/${A.account}`)).json()).project).toBe(B.project);

  const moved = await (await request.get(`${API_BASE}/api/v1/suppliers/${A.account}`)).json();
  expect(moved.project).toBe(B.project);
  const projects = await (await request.get(`${API_BASE}/api/v1/project-admin`)).json().catch(() => null);
  if (projects?.projects) expect(projects.projects).not.toContain(A.project);
  await expect(page.locator('option', { hasText: A.project })).toHaveCount(0);
  // BUG-004: المشروع المدموج لا يبقى خياراً في فلتر المشروع في الموردين
  await gotoHash(page, '/suppliers');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'المشروع' }).locator('option', { hasText: A.project })).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'المشروع' }).locator('option', { hasText: B.project })).toHaveCount(1);
});
