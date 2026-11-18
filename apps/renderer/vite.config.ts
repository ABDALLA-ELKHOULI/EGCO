import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * EGCO_API_PROXY (اختياري، للتطوير والاختبار في المتصفح): يوكّل /api و/health و/openapi.json
 * إلى خادم محلي فتصبح الطلبات من نفس الأصل (لا CORS). شغّل معه VITE_API_URL= (فارغ) كي
 * يستعمل lib/api.ts عنواناً نسبياً. Electron لا يحتاجه — يأخذ العنوان من الجسر.
 * يعمل التيار (SSE) عبر الوكيل كما هو.
 */
const proxyTarget = process.env.EGCO_API_PROXY;
const proxy = proxyTarget
  ? Object.fromEntries(['/api', '/health', '/openapi.json'].map((p) => [p, { target: proxyTarget, changeOrigin: true }]))
  : undefined;

export default defineConfig({
  plugins: [react()],
  base: './',                                   // required for file:// in the packaged app
  build: {
    outDir: '../desktop/dist/renderer',
    emptyOutDir: true,
    // Electron 33 = Chromium 130: لا داعي لتخفيض CSS الحديث (@scope، التداخل، linear())
    cssTarget: 'chrome120',
    target: 'chrome120',
  },
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: { port: Number(process.env.VITE_PORT) || 5173, strictPort: true, proxy },
});
