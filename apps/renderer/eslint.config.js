// إعداد ESLint أدنى (م-٣٨-٢): لا يوجد إعداد ESLint في المشروع إطلاقاً رغم أن
// `tsc --strict` نظيف — الاثنان يفحصان أشياء مختلفة (tsc: أنواع، ESLint: قواعد
// hooks وأنماط شائعة الخطأ لا يراها مُصحِّح الأنواع). هذا الإعداد يفحص فقط —
// **لا يُصلح شيئاً هنا** لأن `src/` ملك فِرَق أخرى (راجع تعليق release.yml
// وتقرير التشغيل الأول لمعرفة عدد التحذيرات/الأخطاء الفعلي الذي وُجد).
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // قاعدة الـ hooks غير قابلة للتفاوض — خرقها يُنتج أعطالاً حقيقية (ترتيب
      // hooks متغيّر بين تصييرات)، فتبقى error لا warn.
      'react-hooks/rules-of-hooks': 'error',
      // تبعيات useEffect/useMemo/useCallback الناقصة تُنتج قيماً قديمة (stale
      // closures) بصمت — تحذير لا خطأ لأن بعض الإغفالات هنا متعمَّدة (راجع
      // ColumnMenu.tsx وأمثاله)، فلا نُفشل البناء على كل واحدة الآن.
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
);
