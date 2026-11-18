/**
 * حفظ حجم النافذة وموضعها — يُقرأ عند الإنشاء ويُكتب (مؤجَّلاً) عند كل تغيير.
 *
 * Stored in userData/window-state.json. If the saved bounds no longer fall on any
 * connected display (monitor unplugged), the position is dropped and the window centres.
 */
import { app, BrowserWindow, Rectangle, screen } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export const MIN_WIDTH = 1024;
export const MIN_HEIGHT = 680;

type SavedState = { x?: number; y?: number; width: number; height: number; maximized?: boolean; fullScreen?: boolean };

const file = () => path.join(app.getPath('userData'), 'window-state.json');

function visibleOnSomeDisplay(b: Rectangle): boolean {
  return screen.getAllDisplays().some(({ workArea: w }) =>
    b.x < w.x + w.width - 80 && b.x + b.width > w.x + 80 &&
    b.y >= w.y - 10 && b.y < w.y + w.height - 60);
}

export function loadWindowState(): SavedState {
  const fallback: SavedState = { width: 1600, height: 950 };
  try {
    const s = JSON.parse(fs.readFileSync(file(), 'utf8')) as SavedState;
    if (typeof s.width !== 'number' || typeof s.height !== 'number') return fallback;
    s.width = Math.max(MIN_WIDTH, s.width);
    s.height = Math.max(MIN_HEIGHT, s.height);
    if (typeof s.x === 'number' && typeof s.y === 'number'
        && !visibleOnSomeDisplay({ x: s.x, y: s.y, width: s.width, height: s.height })) {
      delete s.x; delete s.y;
    }
    return s;
  } catch {
    return fallback;
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const fullScreen = win.isFullScreen();
    // الأبعاد «العادية» لا أبعاد الوضع المكبَّر — حتى يعود الحجم السابق عند إلغاء التكبير.
    const b = win.getNormalBounds();
    const state: SavedState = { ...b, maximized, fullScreen };
    try { fs.writeFileSync(file(), JSON.stringify(state)); } catch { /* غير حرج */ }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', schedule);
  win.on('move', schedule);
  win.on('maximize', schedule);
  win.on('unmaximize', schedule);
  win.on('enter-full-screen', schedule);
  win.on('leave-full-screen', schedule);
  win.on('close', () => { if (timer) clearTimeout(timer); save(); });
}
