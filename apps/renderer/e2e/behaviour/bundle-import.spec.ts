/**
 * قفل سلوك v0.13.1 — «كشوف مجمّعة»: PDF واحد بعدة حسابات يُقطَّع حساباً حساباً عبر
 * API الاستيراد الحقيقي (بلا monkeypatch). PDF مصنوع بـe2e/fixtures/make_bundle_pdf.py:
 * ٣ موردين، الثالث إجماليه المطبوع لا يطابق عمداً.
 * المتوقع: المعاينة ترى ٣ حسابات (٢ مطابق، ١ لا) · الحفظ يحفظ ٢ ويحجز الثالث وحده ·
 * كل حساب على صاحبه · إعادة الرفع لا تضيف شيئاً · المورد يظهر في الواجهة برصيده.
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { API_BASE, gotoHash, money } from '../helpers';

const here = path.dirname(fileURLToPath(import.meta.url));
const ACC = ['2119971', '2119972', '2119973'];
const FILE = 'كشوفات الموردين-قفل سلوك.pdf';
const root = path.resolve(here, '..', '..', '..', '..');
const py = path.join(root, 'services', 'api', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');

let pdf = '';
test.beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(process.env.E2E_TMP_ROOT || os.tmpdir(), 'egco-bundle-'));
  pdf = path.join(dir, FILE);
  execFileSync(py, [path.join(here, '..', 'fixtures', 'make_bundle_pdf.py'), pdf, ...ACC]);
});

test.afterEach(async ({ request }) => {
  const h = await (await request.get(`${API_BASE}/api/v1/import/history`)).json();
  for (const r of (h.rows ?? h.items ?? []) as { id: number; fileName?: string; file_name?: string }[]) {
    if ((r.fileName ?? r.file_name ?? '').includes('قفل سلوك')) {
      await request.delete(`${API_BASE}/api/v1/import/history/${r.id}`);
    }
  }
  for (const a of ACC) {
    await request.delete(`${API_BASE}/api/v1/suppliers/${a}?force=true`);
    await request.delete(`${API_BASE}/api/v1/trash/supplier/${a}?confirm=true`);
  }
});

test('كشف مجمّع: معاينة ثم حفظ كل حساب على صاحبه وحجز غير المطابق', async ({ page, request }) => {
  const pv = await request.post(`${API_BASE}/api/v1/import/preview`, { data: { path: pdf, source: 'pdf_statement' } });
  expect(pv.ok(), await pv.text()).toBeTruthy();
  const p = await pv.json();
  expect(p.bundle).toBe(true);
  expect(p.accounts).toBe(3);
  expect(p.counts).toEqual({ reconciled: 2, not_reconciled: 1 });

  const res = await request.post(`${API_BASE}/api/v1/import`, {
    data: { path: pdf, source: 'pdf_statement', allow_unreconciled: false },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const r = await res.json();
  expect(r.bundle).toBe(true);
  expect(r.saved).toBe(2);
  expect(r.problems.map((x: { account: string }) => x.account)).toEqual([ACC[2]]);

  const s1 = await (await request.get(`${API_BASE}/api/v1/suppliers/${ACC[0]}`)).json();
  const s2 = await request.get(`${API_BASE}/api/v1/suppliers/${ACC[1]}`);
  const s3 = await request.get(`${API_BASE}/api/v1/suppliers/${ACC[2]}`);
  expect(s1.outstanding).toBeCloseTo(1500, 2);
  expect(s2.ok()).toBeTruthy();
  expect(s3.status()).toBe(404);

  // إعادة الرفع لا تضيف حركة
  const again = await (await request.post(`${API_BASE}/api/v1/import`, {
    data: { path: pdf, source: 'pdf_statement', allow_unreconciled: false },
  })).json();
  const s1b = await (await request.get(`${API_BASE}/api/v1/suppliers/${ACC[0]}`)).json();
  expect(s1b.outstanding, JSON.stringify(again).slice(0, 400)).toBeCloseTo(1500, 2);

  await gotoHash(page, `/suppliers/${ACC[0]}`);
  await expect(page.getByText(money(1500)).first()).toBeVisible();
});
