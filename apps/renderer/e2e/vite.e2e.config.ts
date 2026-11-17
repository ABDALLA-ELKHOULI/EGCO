/**
 * إعداد Vite لاختبارات الواجهة — نفس الإعداد الأصلي مع منفذ 5174 ووكيل إلى
 * الخادم المؤقت (8790). الوكيل يجعل الواجهة والخادم على أصل واحد فلا يصطدم
 * بقائمة CORS في app/main.py (localhost:5173 فقط) دون تعديل الخادم.
 * VITE_API_URL تُعرَّف فارغة هنا فتقرأ lib/api.ts عنواناً نسبياً يمرّ بالوكيل.
 */
import { defineConfig, mergeConfig } from 'vite';
import base from '../vite.config';

const API = `http://127.0.0.1:${process.env.E2E_API_PORT || '8790'}`;

export default mergeConfig(base, defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
  server: {
    port: Number(process.env.E2E_WEB_PORT || 5174),
    strictPort: true,
    proxy: { '/api': API, '/health': API },
  },
}));
