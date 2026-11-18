/**
 * قفل سلوك (قبل إعادة التصميم): «المديونية المفتوحة» رقم واحد في كل شاشة تعرضه،
 * ويساوي ما يقوله الخادم. لا يعتمد على بنية DOM — فقط أن الرقم نفسه مرئي.
 */
import { test, expect } from '@playwright/test';
import { API_BASE, gotoHash, money, SEED } from '../helpers';

test('المديونية المفتوحة نفسها في اللوحة والموردين والمشاريع وتطابق الخادم', async ({ page, request }) => {
  const list = await (await request.get(`${API_BASE}/api/v1/suppliers`)).json();
  // الخادم مصدر الحقيقة: مجموع أرصدة الموردين المبذورين = الرقم الذهبي
  const rows: { outstanding: number }[] = Array.isArray(list) ? list : (list.rows ?? list.items ?? []);
  if (rows.length) {
    const sum = rows.reduce((a, r) => a + (r.outstanding ?? 0), 0);
    expect(money(sum)).toBe(SEED.outstanding);
  }

  for (const route of ['/payables', '/suppliers', '/projects']) {
    await gotoHash(page, route);
    await expect(page.getByText(SEED.outstanding).first(), `الرقم في ${route}`).toBeVisible();
  }
});
