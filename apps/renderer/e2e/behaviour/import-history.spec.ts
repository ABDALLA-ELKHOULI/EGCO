/** قفل سلوك: كشف CSV مستورد عبر API يظهر في سجل الرفع باسم ملفه ومورده. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { API_BASE, gotoHash, R, SEED } from '../helpers';

const FILE_NAME = 'قفل-سلوك-استيراد.csv';

test('استيراد CSV يظهر في السجل والإجمالي المفتوح لا يتغيّر', async ({ page, request }) => {
  const today = new Date().toISOString().slice(0, 10);
  const csv = [
    'التاريخ,مدين,دائن,رقم المستند,الوصف,الحساب',
    `${today},,1000.00,QA-INV-1,فاتورة قفل السلوك,${SEED.supplierAccount}`,
    `${today},1000.00,,QA-PAY-1,دفعة قفل السلوك,${SEED.supplierAccount}`,
    '',
  ].join('\n');
  const dir = fs.mkdtempSync(path.join(process.env.E2E_TMP_ROOT || os.tmpdir(), 'egco-qa-'));
  const filePath = path.join(dir, FILE_NAME);
  fs.writeFileSync(filePath, '﻿' + csv, 'utf8');

  const res = await request.post(`${API_BASE}/api/v1/import`, {
    data: { path: filePath, source: 'csv_statement', allow_unreconciled: false },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  expect((await res.json()).saved).toBe(true);

  await gotoHash(page, R.imports);
  const row = page.getByRole('row', { name: new RegExp(FILE_NAME) });
  await expect(row).toBeVisible();
  await expect(row).toContainText(SEED.supplierName);

  await gotoHash(page, '/suppliers');
  await expect(page.getByText(SEED.outstanding).first()).toBeVisible();
});
