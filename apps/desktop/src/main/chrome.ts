/**
 * شريط العنوان المخصّص — حتى تجلس الجزيرة في منتصف أعلى النافذة.
 *
 * macOS: titleBarStyle 'hiddenInset' — traffic lights stay, content runs under the bar.
 * Windows/Linux: titleBarStyle 'hidden' + titleBarOverlay — native min/max/close are
 * drawn by the OS over our content in the top-right corner (the navy sidebar side in RTL).
 * The renderer reads `titleBarInsets()` to know which corners are taken and how tall
 * the drag strip is.
 */
import { BrowserWindow, BrowserWindowConstructorOptions, nativeTheme } from 'electron';

export const TITLE_BAR_HEIGHT = 44;

export type ThemeName = 'light' | 'dark';

/** ألوان مطابقة لرموز التصميم: الشريط الجانبي الكحلي ولوحة المحتوى الفاتحة/الداكنة. */
const SIDEBAR_NAVY = '#1B202B';
const CANVAS: Record<ThemeName, string> = { light: '#F5F4F1', dark: '#10131A' };

let currentTheme: ThemeName = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

export const canvasColor = (t: ThemeName = currentTheme) => CANVAS[t];

/** Windows: أزرار النظام فوق الشريط الجانبي (يمين في RTL) — كحلي ورموز فاتحة في الوضعين. */
function overlay(): Electron.TitleBarOverlay {
  return { color: SIDEBAR_NAVY, symbolColor: '#E8EAF0', height: TITLE_BAR_HEIGHT };
}

export function titleBarOptions(): Partial<BrowserWindowConstructorOptions> {
  if (process.platform === 'darwin') {
    return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 15 } };
  }
  return { titleBarStyle: 'hidden', titleBarOverlay: overlay() };
}

export type TitleBarInsets = {
  platform: NodeJS.Platform;
  /** ارتفاع شريط السحب/العنوان بالبكسل. */
  height: number;
  /** مساحة محجوزة لأزرار النظام من الحافة الفيزيائية اليسرى/اليمنى (لا تنعكس مع RTL). */
  left: number;
  right: number;
  fullScreen: boolean;
};

export function titleBarInsets(win: BrowserWindow | null): TitleBarInsets {
  const fullScreen = !!win && !win.isDestroyed() && win.isFullScreen();
  if (process.platform === 'darwin') {
    // في ملء الشاشة تختفي الإشارات الضوئية.
    return { platform: 'darwin', height: TITLE_BAR_HEIGHT, left: fullScreen ? 0 : 80, right: 0, fullScreen };
  }
  // ‏Windows: ثلاثة أزرار ~46px لكل منها (Electron يرسمها بعرض ثابت تقريباً).
  return { platform: process.platform, height: TITLE_BAR_HEIGHT, left: 0, right: fullScreen ? 0 : 138, fullScreen };
}

/** الواجهة تخبرنا بالسمة المختارة (قد تخالف سمة النظام) — نحدّث لون الخلفية والطبقة. */
export function applyTheme(win: BrowserWindow | null, theme: ThemeName): void {
  currentTheme = theme;
  if (!win || win.isDestroyed()) return;
  win.setBackgroundColor(canvasColor(theme));
  if (process.platform !== 'darwin') {
    try { win.setTitleBarOverlay(overlay()); } catch { /* Linux بلا دعم طبقة */ }
  }
}
