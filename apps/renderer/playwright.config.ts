/**
 * اختبارات الواجهة (م-٤٧) — Playwright headless على خادم مؤقت ببيانات مصنوعة.
 *
 * webServer يشغّل اثنين: الخادم (scripts/e2e-backend.mjs — منفذ 8790، قاعدة
 * مؤقتة، EGCO_SEED=1) ثم Vite على 5174 بإعداد e2e/vite.e2e.config.ts الذي
 * يوكّل /api و/health إلى 8790. المنفذان 8756 و5173 لا يُلمسان أبداً.
 *
 * workers=1 عمداً: الخادم واحد وقاعدته مشتركة، والاختبارات تُضيف وتحذف
 * (مورد، استيراد) — التوازي هنا يصنع تذبذباً لا سرعة. retries=0 عمداً أيضاً:
 * الاختبار المتذبذب يُبلَّغ عنه لا يُخفى.
 */
import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_PORT = process.env.E2E_API_PORT || '8790';
const WEB_PORT = process.env.E2E_WEB_PORT || '5174';
const root = path.resolve(__dirname, '..', '..');

/**
 * المتصفح: Chromium المرفق مع Playwright حين يكون منزَّلاً (CI: playwright install
 * chromium). وإن غاب محلياً (تنزيله قد يتعطّل على شبكة بطيئة) يُستعمل Google Chrome
 * المثبَّت على الجهاز عبر channel — والاختيار يُطبع عند التشغيل حتى لا يكون خفياً.
 */
function pickChannel(): string | undefined {
  if (process.env.E2E_CHANNEL) return process.env.E2E_CHANNEL === 'bundled' ? undefined : process.env.E2E_CHANNEL;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH
    || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')
      : process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright')
      : path.join(os.homedir(), '.cache', 'ms-playwright'));
  const hasBundled = fs.existsSync(cache) && fs.readdirSync(cache).some((d) => d.startsWith('chromium'));
  if (hasBundled) return undefined;
  const chrome = process.platform === 'darwin' ? '/Applications/Google Chrome.app' : undefined;
  if (chrome && fs.existsSync(chrome)) {
    console.log('[e2e] Chromium المرفق غير منزَّل — يُستعمل Google Chrome المثبَّت (channel=chrome)');
    return 'chrome';
  }
  return undefined;
}
const channel = pickChannel();

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' },
  },
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  // لقطات مرجعية بلا لاحقة نظام التشغيل — تُولَّد على macOS وتُشغَّل عليه فقط.
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  outputDir: process.env.E2E_OUTPUT_DIR || 'e2e/.results',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    viewport: { width: 1280, height: 800 },
    locale: 'ar',
    timezoneId: 'Asia/Riyadh',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel, viewport: { width: 1280, height: 800 } } }],
  webServer: [
    {
      command: `node ${path.join(root, 'scripts', 'e2e-backend.mjs')}`,
      url: `http://127.0.0.1:${API_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PORT: API_PORT },
    },
    {
      command: `npx vite --config e2e/vite.e2e.config.ts`,
      url: `http://localhost:${WEB_PORT}/`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { E2E_API_PORT: API_PORT, E2E_WEB_PORT: WEB_PORT },
    },
  ],
});
