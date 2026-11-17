/**
 * استيراد CSV صغير مصنوع (صيغة ingest/csv_statement) عبر API الخادم المؤقت —
 * صفحة الرفع تختار الملفات بحوار Electron (window.egco.pickFiles) لا بـinput[type=file]،
 * فالرفع يمرّ عبر /api/v1/import بمسار ملف، ثم يُتحقّق من السجل في الواجهة والإجمالي.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API_BASE, collectErrors, gotoHash, SEED } from './helpers';

const FILE_NAME = 'كشف-اختبار-الواجهة.csv';

test('رفع كشف CSV يظهر في سجل الرفع ويُطابق إجمالي المورد', async ({ page, request }) => {
  const before = await (await request.get(`${API_BASE}/api/v1/suppliers/${SEED.supplierAccount}`)).json();

  // فاتورة ٥٠٠٠ ودفعة ٥٠٠٠ — الإجمالي المفتوح لا يتغيّر (فلا تتأثر اختبارات الإجماليات)
  // بينما المفوتر يرتفع ٥٠٠٠ والمدفوع ٥٠٠٠ — وهذا ما يُطابَق.
  const today = new Date().toISOString().slice(0, 10);
  const csv = [
    'التاريخ,مدين,دائن,رقم المستند,الوصف,الحساب',
    `${today},,5000.00,E2E-INV-1,فاتورة توريد من CSV,${SEED.supplierAccount}`,
    `${today},5000.00,,E2E-PAY-1,دفعة من CSV,${SEED.supplierAccount}`,
    '',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(process.env.E2E_TMP_ROOT || os.tmpdir(), 'egco-csv-'));
  const filePath = path.join(dir, FILE_NAME);
  fs.writeFileSync(filePath, '﻿' + csv, 'utf8');

  const res = await request.post(`${API_BASE}/api/v1/import`, {
    data: { path: filePath, source: 'csv_statement', allow_unreconciled: false },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  const body = await res.json();
  expect(body.saved, JSON.stringify(body)).toBe(true);
  expect(body.added).toBe(2);
  expect(body.reconciled).toBe(true);

  const after = await (await request.get(`${API_BASE}/api/v1/suppliers/${SEED.supplierAccount}`)).json();
  expect(after.totalInvoiced - before.totalInvoiced).toBeCloseTo(5000, 2);
  expect(after.totalPaid - before.totalPaid).toBeCloseTo(5000, 2);
  expect(after.outstanding).toBeCloseTo(before.outstanding, 2);

  // يظهر في سجل الرفع على الواجهة
  const errors = collectErrors(page);
  await gotoHash(page, '/import');
  const row = page.locator('tbody tr', { hasText: FILE_NAME });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText(SEED.supplierName);
  expect(errors).toEqual([]);
});
