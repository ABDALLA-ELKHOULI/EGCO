/**
 * أنواع سجلّ العروض — العقد بين الهيكل ووكلاء الأقسام (docs/next/FRONTEND-CONTRACT.md §١).
 * كل قسم يصدّر افتراضياً `SectionModule` من src/sections/<name>/index.tsx؛ routes.tsx يجمعها.
 */
import type { ComponentType } from 'react';

export type SectionKey = 'today' | 'parties' | 'projects' | 'cash' | 'reports' | 'data';
export type RouteParams = Record<string, string | number | undefined | null>;
export type Go = (viewKeyOrAlias: string, params?: RouteParams, opts?: { replace?: boolean }) => void;

export interface ViewDef {
  /** فريد عالمياً: '<section>.<name>'. نفس مفتاح عرض قديم = يستبدله. */
  key: string;
  /** مسار react-router (HashRouter)، مثل '/parties/suppliers/:account'. */
  path: string;
  /** عنوان النافذة ولوحة الأوامر. */
  title: string;
  /** React.lazy(() => import('./X')) — تصدير افتراضي. */
  component: ComponentType;
  /** يُملأ من SectionModule.section إن غاب. */
  section?: SectionKey;
  /** وجوده = تبويب في شريط تبويبات القسم. */
  tab?: string;
  /** ترتيب التبويب تصاعدياً (افتراضي 100). */
  order?: number;
  /** لعرض تفاصيل بلا تبويب: مفتاح التبويب الذي يُضاء. */
  parentTab?: string;
  /** أسماء روابط (إشعارات الخادم، النموذج) تقود إلى هذا العرض: 'supplier'، 'due'… */
  aliases?: string[];
  /** hook اختياري يعيد عدّاد التبويب الأحمر. يُستدعى في كل رسم للتبويبات — hooks فقط. */
  useBadge?: () => number | null | undefined;
  /** مسارات قديمة تُحوَّل إلى هذا العرض (مع نقل المعاملات بالاسم). */
  redirectFrom?: string[];
  /** داخلي: صفحة من pages/** تُغلَّف بـ.legacy-page. */
  legacy?: boolean;
}

export interface Command {
  group: string;
  label: string;
  sub?: string;
  /** كلمات بحث إضافية (تطبيع عربي). */
  keywords?: string;
  run: (ctx: { go: Go }) => void;
}

export interface SectionModule {
  section: SectionKey;
  views: ViewDef[];
  commands?: Command[];
}
