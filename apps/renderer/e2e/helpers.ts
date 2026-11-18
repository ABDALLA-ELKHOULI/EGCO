/** أدوات مشتركة لاختبارات الواجهة — التنقّل بالـhash وجمع أخطاء الكونسول. */
import { expect, type Locator, type Page } from '@playwright/test';

export const API_BASE = `http://127.0.0.1:${process.env.E2E_API_PORT || '8790'}`;

/** الأرقام المصنوعة في services/api/app/testing_seed.py — تُغيَّر هناك وهنا معاً. */
export const SEED = {
  outstanding: '245,000.50',
  supplierAccount: '2110004',
  supplierName: 'شركة الدهانات الوطنية',
  contractorCode: '2120001',
  project: 'السدن',
};

/**
 * يجمع أخطاء الكونسول وأخطاء الصفحة غير الملتقطة وأي استجابة ≥400 منذ لحظة الاستدعاء.
 * رسالة Chromium العامة «Failed to load resource» تُستبدل بعنوان الطلب الفعلي وحالته
 * (أدقّ في التقرير)، وطلب favicon.ico وحده يُستثنى: index.html بلا أيقونة وهذا 404
 * من Vite لا من التطبيق.
 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    if (msg.text().startsWith('Failed to load resource')) return; // يُلتقط أدناه بعنوانه
    errors.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('response', (res) => {
    if (res.status() < 400) return;
    if (new URL(res.url()).pathname === '/favicon.ico') return;
    errors.push(`http ${res.status()}: ${res.request().method()} ${res.url()}`);
  });
  page.on('requestfailed', (req) => {
    if (new URL(req.url()).pathname === '/favicon.ico') return;
    // ERR_ABORTED = طلب ألغاه التطبيق نفسه (TanStack Query عند مغادرة الشاشة/إعادة الجلب) — ليس خللاً
    if (req.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`requestfailed: ${req.method()} ${req.url()} — ${req.failure()?.errorText}`);
  });
  return errors;
}

/** يفتح مساراً داخل HashRouter وينتظر خروج شاشة الإقلاع وسكون الشبكة. */
export async function gotoHash(page: Page, route: string): Promise<void> {
  await page.goto(`/#${route}`);
  await expect(page.locator('.state', { hasText: 'جارٍ التشغيل' })).toHaveCount(0);
  await page.waitForLoadState('networkidle');
}

/** يفعّل الوضع الداكن كما يفعله التطبيق نفسه (localStorage قبل أول رسم). */
export async function useDarkTheme(page: Page): Promise<void> {
  await page.addInitScript(() => { try { localStorage.setItem('egco-theme', 'dark'); } catch { /* */ } });
}

/**
 * كل ما يتغيّر مع مرور الأيام — يُحجب في اللقطات البصرية حتى لا تنكسر غداً:
 * تاريخ (رقم + اسم شهر، أو ISO) وعدّاد أيام (رقم + يوم/يوماً/أيام). عناوين ثابتة مثل
 * «مستحق خلال ٧ أيام» تُستثنى بالنظر الخلفي لأنها لا تتغيّر.
 */
export const TIME_SENSITIVE =
  /((?<!خلال )[٠-٩0-9]+\s*(يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر|يوماً|يوم|أيام)|\d{4}-\d{2}-\d{2})/;

/**
 * محدِّد مقاوم لإعادة التصميم: data-testid إن أضافه وكيل القسم (القائمة في
 * docs/next/QA.md)، وإلا البديل الدلالي (دور/نص عربي) الذي يعمل على الواجهة الحالية.
 */
export function tid(page: Page, id: string, fallback: Locator): Locator {
  return page.getByTestId(id).or(fallback).first();
}

/** صيغة المبالغ المعروضة (lib/format.ts sar): أرقام لاتينية وفاصل آلاف ومنزلتان. */
export const money = (v: number): string =>
  Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * مسارات الشاشات بعد إعادة التصميم (sections/<قسم>/index.tsx). القديمة بقيت تعمل حتى تُستبدل؛
 * حين يسجّل قسمٌ عرضه الجديد تُحدَّث القيمة هنا وحدها.
 */
export const R = {
  suppliers: '/suppliers',
  trash: '/data/trash',
  imports: '/data/import',
  backups: '/data/backups',
  settings: '/data/settings',
  projects: '/projects',
  projectAdmin: '/projects/admin',
  budget: '/projects/budget',
  payables: '/payables',
};

/** خلية مبلغ: «1,234.00» مع «ر.س» ملتصقة أو بدونها (‹Money› الجديد يلصق الوحدة). */
export const moneyCell = (page: Page, v: number): Locator =>
  page.getByRole('cell', { name: new RegExp(`^${money(v).replace(/[.,]/g, '\\$&')}\\s*(ر\\.س)?$`) });
