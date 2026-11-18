/**
 * غلاف الصفحات القديمة (pages/**) داخل الهيكل الجديد — مؤقت حتى تستبدلها الموجة ١.
 * .legacy-page يحصر أنماط v0.13.0 (styles/legacy.css) ويستثنيها من أنماط «أرخبيل» (@scope).
 */
import type { ComponentType } from 'react';

export function legacy(C: ComponentType): ComponentType {
  function LegacyPage() {
    return <div className="legacy-page"><C /></div>;
  }
  LegacyPage.displayName = 'Legacy(' + (C.displayName || C.name || 'Page') + ')';
  return LegacyPage;
}
