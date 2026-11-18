/**
 * درج الاختصارات — النسخة الحقيقية من شريط «جرّب» في النموذج المعتمد: كبسولة زجاجية
 * أسفل الشاشة بأزرار تعمل فعلاً (لا أحداث تجريبية): الإشعارات، البحث، رفع ملف، تحصيل
 * جديد، نسخة احتياطية الآن، الأرقام، والوضع. تُطوى إلى زر صغير ويُحفظ ذلك لكل مستخدم.
 */
import { useState } from 'react';
import { api } from '@/lib/api';
import { useGo } from '@/app/routes';
import { invalidate } from '@/data/queryClient';
import { useNotifications } from '@/data/notifications';
import { Icon } from '@/ui/Icon';
import { digits } from '@/ui/format';
import { getPrefs, resolvedTheme, setPrefs, usePrefs } from '@/ui/prefs';
import { toast } from '@/ui/Toast';
import { openPalette } from './CommandPalette';
import { island } from './islandStore';
import { openNotifications } from './NotificationDrawer';

const KEY = 'egco-quicktray-open';
const readOpen = () => { try { return localStorage.getItem(KEY) !== '0'; } catch { return true; } };

export function QuickTray() {
  const prefs = usePrefs();
  const go = useGo();
  const { unread } = useNotifications();
  const [open, setOpenState] = useState(readOpen);
  const [busy, setBusy] = useState(false);
  const setOpen = (v: boolean) => { setOpenState(v); try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* تخزين غير متاح */ } };

  const backupNow = async () => {
    if (busy) return;
    setBusy(true);
    island.event('backup', { phase: 'start' });
    try {
      await api.createBackup();
      island.event('backup', { phase: 'done' });
      await invalidate(['backups']);
    } catch (e) {
      toast('تعذّر أخذ النسخة الاحتياطية' + (e instanceof Error && e.message ? ': ' + e.message : ''), { kind: 'error' });
    } finally { setBusy(false); }
  };
  const dark = resolvedTheme(prefs.theme) === 'dark';

  if (!open) {
    return (
      <button type="button" className="qtray-fab" onClick={() => setOpen(true)} aria-label="إظهار الاختصارات" title="الاختصارات">
        <Icon name="star" size={18} />
        {unread > 0 && <span className="qtray-dot" aria-hidden="true" />}
      </button>
    );
  }
  return (
    <div className="qtray" role="toolbar" aria-label="اختصارات سريعة">
      <button type="button" className="qt" onClick={openNotifications} title="الإشعارات">
        <Icon name="bell" size={18} /><span>الإشعارات</span>
        {unread > 0 && <b className="qt-cnt">{digits(unread)}</b>}
      </button>
      <button type="button" className="qt" onClick={openPalette} title="بحث وأوامر (⌘K)">
        <Icon name="search" size={18} /><span>بحث</span><kbd>⌘K</kbd>
      </button>
      <i className="qt-sep" aria-hidden="true" />
      <button type="button" className="qt" onClick={() => go('data.import')} title="رفع كشف أو ملف">
        <Icon name="upload" size={18} /><span>رفع ملف</span>
      </button>
      <button type="button" className="qt" onClick={() => go('cash.revenues', { new: '1' })} title="تسجيل تحصيل جديد">
        <Icon name="plus" size={18} /><span>تحصيل</span>
      </button>
      <button type="button" className="qt" onClick={backupNow} disabled={busy} title="أخذ نسخة احتياطية الآن">
        <Icon name="archive" size={18} /><span>{busy ? 'جارٍ النسخ…' : 'نسخة احتياطية'}</span>
      </button>
      <i className="qt-sep" aria-hidden="true" />
      <button type="button" className="qt" aria-pressed={prefs.digits === 'arab'}
        onClick={() => setPrefs({ digits: getPrefs().digits === 'arab' ? 'latin' : 'arab' })} title="شكل الأرقام">
        <span className="qt-num">{prefs.digits === 'arab' ? '١٢٣' : '123'}</span>
      </button>
      <button type="button" className="qt" onClick={() => setPrefs({ theme: dark ? 'light' : 'dark' })} title={dark ? 'الوضع النهاري' : 'الوضع الليلي'}>
        <Icon name="sun" size={18} /><span>{dark ? 'نهاري' : 'ليلي'}</span>
      </button>
      <button type="button" className="qt qt-x" onClick={() => setOpen(false)} aria-label="طي الاختصارات" title="طي">
        <Icon name="chevron" size={16} />
      </button>
    </div>
  );
}
