/**
 * جزيرة الحالة — نفس بنية prototype/shell.js (زر .status بخمسة وجوه .face، data-s يحدد الحجم،
 * الانتقال spring في CSS). النقر يفتح درج الإشعارات؛ «عرض» في S4 يذهب للنقد.
 */
import { useEffect, useRef } from 'react';
import logoMark from '@/assets/logo-mark.png';
import { dateTxt, digits } from '@/ui/format';
import { usePrefs } from '@/ui/prefs';
import { useNotifications } from '@/data/notifications';
import { useGo } from '@/app/routes';
import { island, useIsland } from './islandStore';
import { openNotifications, useDrawerOpen } from './NotificationDrawer';

export function StatusIsland() {
  usePrefs();
  const s = useIsland();
  const { unread } = useNotifications();
  const drawerOpen = useDrawerOpen();
  const go = useGo();
  const countRef = useRef<HTMLSpanElement>(null);
  const last = useRef(-1);
  useEffect(() => {
    if (last.current >= 0 && unread > last.current && countRef.current) {
      const el = countRef.current; el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
    }
    last.current = unread;
  }, [unread]);

  const dt = dateTxt(new Date(), { weekday: true });
  const face = (k: string) => 'face' + (s.state === k ? ' on' : '');
  const pct = s.import.pct;
  const kb = s.backup.sizeKb;
  return (
    <div className="island-dock">
      <button type="button" className={'status' + (drawerOpen ? ' paused' : '')} data-s={s.state}
        aria-live={s.state === 's4' ? 'assertive' : 'polite'}
        aria-label={(unread ? digits(unread) + ' إشعارات غير مقروءة' : 'لا تنبيهات') + ' — انقر لفتح الإشعارات'}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('.s4go')) { island.release('s4'); go('cash'); return; }
          openNotifications();
        }}>
        <div className={face('s0')} aria-hidden={s.state !== 's0'}><img className="st-logo" src={logoMark} alt="" aria-hidden="true" /><span className="pdot ok" /><span className="st-date">{dt}</span><span className="st-sep" /><span className="st-dim">لا تنبيهات</span></div>
        <div className={face('s1')} aria-hidden={s.state !== 's1'}><img className="st-logo" src={logoMark} alt="" aria-hidden="true" /><span className="pdot bad" /><span className="st-date">{dt}</span><span className="st-count" ref={countRef}>{digits(unread)}</span></div>
        <div className={face('s2') + ' f-s2'} aria-hidden={s.state !== 's2'}>
          <div className="f-row">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand-bronze-on-glass)" strokeWidth="1.8" aria-hidden="true"><path d="M14 3H6v18h12V7z" /><path d="M14 3v4h4" /></svg>
            <span className="st-trunc">{s.import.file || 'استيراد'}</span>
            <span className="num st-dim st-pct">{digits(pct)}%</span>
          </div>
          <span className="st-prog"><i style={{ transform: `scaleX(${pct / 100})` }} /></span>
        </div>
        <div className={face('s3')} aria-hidden={s.state !== 's3'}>
          {s.backup.phase === 'done' ? <span className="st-check">✓</span> : <span className="st-ring" />}
          <span>{s.backup.phase === 'done' ? 'تم الحفظ' + (kb ? ' — ' + digits(kb >= 1024 ? (kb / 1024).toFixed(1) + ' م.ب' : Math.round(kb) + ' ك.ب') : '') : 'نسخ احتياطي…'}</span>
        </div>
        <div className={face('s4') + ' s4 f-s4'} aria-hidden={s.state !== 's4'}>
          <div className="f-col">
            <div className="f-row"><span className="pdot bad" /><span className="t">عجز نقدي متوقع</span><span className="ghost s4go">عرض</span></div>
            <div className="d">{digits(s.deficit.detail)}</div>
          </div>
        </div>
      </button>
    </div>
  );
}
