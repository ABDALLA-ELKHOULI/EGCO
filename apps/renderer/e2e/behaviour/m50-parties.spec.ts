/**
 * م-٥٠ — أطراف المشروع بمبالغ (API-CONTRACT §٣). موردٌ ومقاولٌ مصنوعان هنا (لا تُمسّ البذرة):
 * إسناد من صفحة المشروع بمبلغ ← نفس الطرف في مشروعين بمبلغين ← تعديل ← إزالة + «تراجع» ←
 * المبلغ ينجو من دمج المشروع.
 */
import { test, expect, type APIRequestContext } from '@playwright/test';
import { API_BASE, gotoHash, money } from '../helpers';

const SUP = { account: '2119961', name: 'مورد م٥٠ للاختبار' };
const CON = { code: '2129961', name: 'مقاول م٥٠ للاختبار' };
const P1 = 'السدن', P2 = 'المدينة';
const SRC = 'مشروع م٥٠ مصدر', DST = 'مشروع م٥٠ هدف';
// صف الطرف في لوحة «أطراف المشروع» (الأولى في الصفحة؛ جدول موردي المشروع أدناه يحمل الاسم نفسه)
const prow = (page: import('@playwright/test').Page, name: string) =>
  page.getByRole('row').filter({ hasText: name }).first();
const api = (p: string) => `${API_BASE}/api/v1${p}`;

async function projectId(r: APIRequestContext, name: string): Promise<string> {
  const reg = await (await r.get(api('/projects/registry'))).json();
  const hit = (reg as { id: string; name: string; aliases?: string[] }[])
    .find((p) => p.name === name || (p.aliases ?? []).includes(name));
  expect(hit, `مشروع ${name} في السجل`).toBeTruthy();
  return hit!.id;
}
async function partyAmount(r: APIRequestContext, pid: string, type: string, id: string): Promise<string | null | undefined> {
  const rows = await (await r.get(api(`/projects/${pid}/parties`))).json();
  return (rows as { partyType: string; partyId: string; amount: string | null }[])
    .find((x) => x.partyType === type && x.partyId === id)?.amount;
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(api('/suppliers'), { data: { account: SUP.account, name: SUP.name, term: '30 يوم' } })).ok()).toBeTruthy();
  expect((await request.post(api('/contractors'), { data: { code: CON.code, name: CON.name } })).ok()).toBeTruthy();
});

test.afterEach(async ({ request }) => {
  await request.delete(api(`/suppliers/${SUP.account}?force=true`));
  await request.delete(api(`/trash/supplier/${SUP.account}?confirm=true`));
  await request.delete(api(`/contractors/${CON.code}?force=true`));
  await request.delete(api(`/trash/contractor/${CON.code}?confirm=true`));
  for (const n of [SRC, DST]) {
    const reg = await (await request.get(api('/projects/registry'))).json();
    const p = (reg as { id: string; name: string }[]).find((x) => x.name === n);
    if (p) await request.delete(api(`/projects/${p.id}`));
  }
});

test('إسناد مورد ومقاول لمشروع بمبالغ من صفحة المشروع، تعديل، إزالة وتراجع', async ({ page, request }) => {
  const pid = await projectId(request, P1);
  await gotoHash(page, `/projects/${encodeURIComponent(P1)}`);

  for (const [who, type, id, amt] of [[SUP.name, 'supplier', SUP.account, 300000], [CON.name, 'contractor', CON.code, 500000]] as const) {
    await page.getByRole('button', { name: 'إضافة طرف' }).click();
    const dlg = page.getByRole('dialog', { name: 'إضافة طرف للمشروع' });
    await dlg.getByLabel('بحث عن طرف').fill(who);
    await dlg.getByRole('button', { name: new RegExp(who) }).click();
    await dlg.getByLabel(/مبلغ الإسناد/).fill(String(amt));
    await dlg.getByRole('button', { name: 'حفظ' }).click();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => partyAmount(request, pid, type, id)).toBe(amt.toFixed(2));
    await expect(prow(page, who)).toContainText(money(amt));
  }

  // تعديل مبلغ المورد
  await prow(page, SUP.name).getByRole('button', { name: 'تعديل' }).click();
  const ed = page.getByRole('dialog').last();
  await ed.getByLabel(/مبلغ الإسناد/).fill('350000');
  await ed.getByRole('button', { name: 'حفظ' }).click();
  await expect.poll(() => partyAmount(request, pid, 'supplier', SUP.account)).toBe('350000.00');

  // إزالة ثم «تراجع» يعيد الرابط بمبلغه
  await page.getByRole('button', { name: `إزالة ${SUP.name}` }).click();
  await expect.poll(() => partyAmount(request, pid, 'supplier', SUP.account)).toBeUndefined();
  await page.getByRole('button', { name: 'تراجع' }).click();
  await expect.poll(() => partyAmount(request, pid, 'supplier', SUP.account)).toBe('350000.00');
  await expect(prow(page, SUP.name)).toContainText(money(350000));
});

test('نفس المورد في مشروعين بمبلغين مختلفين', async ({ page, request }) => {
  const [a, b] = [await projectId(request, P1), await projectId(request, P2)];
  expect((await request.put(api(`/projects/${a}/parties/supplier/${SUP.account}`), { data: { amount: '100000.00' } })).ok()).toBeTruthy();
  expect((await request.put(api(`/projects/${b}/parties/supplier/${SUP.account}`), { data: { amount: '250000.00' } })).ok()).toBeTruthy();

  const mine = await (await request.get(api(`/suppliers/${SUP.account}/projects`))).json();
  const byName = Object.fromEntries((mine as { name: string; amount: string }[]).map((x) => [x.name, x.amount]));
  expect(byName[P1]).toBe('100000.00');
  expect(byName[P2]).toBe('250000.00');

  await gotoHash(page, `/projects/${encodeURIComponent(P1)}`);
  await expect(prow(page, SUP.name)).toContainText(money(100000));
  await gotoHash(page, `/projects/${encodeURIComponent(P2)}`);
  await page.reload();
  await expect(prow(page, SUP.name)).toContainText(money(250000));
});

test('المبلغ ينجو من دمج المشروع (لا مبلغ يتيم)', async ({ request }) => {
  for (const n of [SRC, DST]) {
    const r = await request.post(api('/projects'), { data: { name: n, contractValue: null } });
    expect(r.status(), await r.text()).toBe(201);
  }
  const src = await projectId(request, SRC);
  expect((await request.put(api(`/projects/${src}/parties/supplier/${SUP.account}`), { data: { amount: '77000.00' } })).ok()).toBeTruthy();
  expect((await request.put(api(`/projects/${src}/parties/contractor/${CON.code}`), { data: { amount: '88000.00' } })).ok()).toBeTruthy();

  const m = await request.post(api('/project-admin/merge'), { data: { fromName: SRC, intoName: DST } });
  expect(m.ok(), await m.text()).toBeTruthy();
  const dst = await projectId(request, DST);
  expect(await partyAmount(request, dst, 'supplier', SUP.account)).toBe('77000.00');
  expect(await partyAmount(request, dst, 'contractor', CON.code)).toBe('88000.00');
});
