/**
 * دخان الأقسام الجديدة: كل مسار مسجّل في src/sections/<قسم>/index.tsx (بلا معاملات، أو
 * بمعامل يُملأ من البذرة) يفتح بلا خطأ كونسول وبلا «تعذّر عرض الصفحة». القائمة تُقرأ
 * من ملفات التسجيل نفسها وقت التشغيل — قسمٌ يُسجَّل يدخل الاختبار تلقائياً.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectErrors, gotoHash, SEED } from '../helpers';

const sectionsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'sections');
const FILL: Record<string, string> = {
  ':account': SEED.supplierAccount, ':code': SEED.contractorCode,
  ':project': encodeURIComponent(SEED.project), ':name': encodeURIComponent(SEED.project),
};
const routes: { section: string; path: string }[] = [];
for (const s of fs.existsSync(sectionsDir) ? fs.readdirSync(sectionsDir) : []) {
  const f = ['index.tsx', 'index.ts'].map((n) => path.join(sectionsDir, s, n)).find((p) => fs.existsSync(p));
  if (!f) continue;
  for (const m of fs.readFileSync(f, 'utf8').matchAll(/path:\s*'([^']+)'/g)) {
    const p = m[1].replace(/:[a-zA-Z]+/g, (k) => FILL[k] ?? k);
    if (!p.includes(':')) routes.push({ section: s, path: p });
  }
}

for (const r of routes) {
  test(`[${r.section}] ${decodeURIComponent(r.path)} يفتح بلا أخطاء`, async ({ page }) => {
    const errors = collectErrors(page);
    await gotoHash(page, r.path);
    await expect(page.getByText('تعذّر عرض الصفحة')).toHaveCount(0);
    await expect(page.getByText('تعذّر الاتصال')).toHaveCount(0);
    expect(errors, `أخطاء في ${r.path}`).toEqual([]);
  });
}
