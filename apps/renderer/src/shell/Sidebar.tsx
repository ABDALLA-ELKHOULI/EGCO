/**
 * الشريط الجانبي (يمين) — من prototype/shell.js: ٦ وجهات، شعار كامل ↔ علامة الرافعة عند الطي
 * (248 ↔ 72)، مؤشر ذهبي منزلق (spring)، عدّاد غير المقروء على «اليوم»، تذييل آخر نسخة احتياطية
 * وزر الطي. تحت 760px يصبح شريطاً سفلياً (CSS).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { SupportModal, captureRedacted } from '@/components/SupportModal';
import logoFull from '@/assets/logo-reverse.png';
import logoMark from '@/assets/logo-mark.png';
import { Icon } from '@/ui/Icon';
import { ago, digits } from '@/ui/format';
import { setPrefs, usePrefs } from '@/ui/prefs';
import { useBackups } from '@/data/hooks';
import { useNotifications } from '@/data/notifications';
import type { SectionKey } from '@/app/registry';
import { defaultViewOf, pathOf, tabsOf } from '@/app/routes';
import { SECTIONS } from './sections';

export function Sidebar({ current }: { current: SectionKey | null }) {
  const prefs = usePrefs();
  const nav = useNavigate();
  const { unread } = useNotifications();
  const loc = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (k: string) => open[k] ?? k === current;
  const [support, setSupport] = useState<{ open: boolean; shot: string | null }>({ open: false, shot: null });
  // اللقطة قبل النافذة — وإلا صوّرت النافذة نفسها بدل الشاشة التي فيها المشكلة
  const openSupport = async () => setSupport({ open: true, shot: await captureRedacted() });
  const navRef = useRef<HTMLElement>(null);
  const ind = useRef<HTMLSpanElement>(null);

  const moveIndicator = () => {
    const a = navRef.current?.querySelector<HTMLElement>('button[aria-current="page"]');
    if (a && ind.current) ind.current.style.transform = `translateY(${a.offsetTop + (a.offsetHeight - 20) / 2}px)`;
  };
  useLayoutEffect(moveIndicator, [current, prefs.sideCollapsed]);
  // شريط التمرير الظاهر: نعلّم الحافتين حتى يظهر التلاشي وزر «المزيد» حين يختفي جزء من القائمة
  const [edge, setEdge] = useState({ up: false, down: false });
  const syncEdge = () => {
    const n = navRef.current; if (!n) return;
    const up = n.scrollTop > 4, down = n.scrollTop + n.clientHeight < n.scrollHeight - 4;
    setEdge((e) => (e.up === up && e.down === down ? e : { up, down }));
  };
  useEffect(() => {
    const n = navRef.current; if (!n) return;
    syncEdge();
    const ro = new ResizeObserver(syncEdge); ro.observe(n);
    n.addEventListener('scroll', syncEdge, { passive: true });
    return () => { ro.disconnect(); n.removeEventListener('scroll', syncEdge); };
  }, [prefs.sideCollapsed]);
  useEffect(() => {
    window.addEventListener('resize', moveIndicator);
    const t = setTimeout(moveIndicator, 260);
    void document.fonts?.ready.then(moveIndicator);
    return () => { window.removeEventListener('resize', moveIndicator); clearTimeout(t); };
  }, [prefs.sideCollapsed]);
  useEffect(() => {
    document.documentElement.style.setProperty('--side-w', prefs.sideCollapsed ? '72px' : '264px');
  }, [prefs.sideCollapsed]);

  return (
    <aside className="side" aria-label="التنقل">
      <div className="brand">
        <img className="logo-full" src={logoFull} alt="إعمار الخليج للمقاولات — EGCO" width={148} />
        <img className="logo-mark" src={logoMark} alt="EGCO" height={32} />
      </div>
      <nav className="nav" ref={navRef} data-up={edge.up || undefined} data-down={edge.down || undefined}>
        <span className="indicator" ref={ind} aria-hidden="true" />
        {SECTIONS.map((s) => (
          <div key={s.key} className="nav-slot">
            {s.group && <div className="sec">{s.group}</div>}
            <button type="button" data-sec={s.key} aria-current={s.key === current ? 'page' : 'false'} title={s.label}
              aria-expanded={!prefs.sideCollapsed ? isOpen(s.key) : undefined}
              onClick={() => {
                // نقرة على القسم الحالي تطوي/تفتح قائمته؛ على غيره تنتقل إليه (فيُفتح تلقائياً)
                if (s.key === current && !prefs.sideCollapsed) { setOpen((o) => ({ ...o, [s.key]: !isOpen(s.key) })); return; }
                const v = defaultViewOf(s.key); const to = v && pathOf(v.key); if (to) nav(to);
              }}>
              <Icon name={s.icon} size={20} stroke={1.6} />
              <span className="lbl">{s.label}</span>
              {s.key === 'today' && unread > 0 && <span className="cnt">{digits(unread)}</span>}
              {!prefs.sideCollapsed && <span className={'nav-caret' + (isOpen(s.key) ? ' on' : '')} aria-hidden="true"
                onClick={(e) => { e.stopPropagation(); setOpen((o) => ({ ...o, [s.key]: !isOpen(s.key) })); }}><Icon name="chevron" size={14} /></span>}
            </button>
            {/* كل صفحات القسم ظاهرة تحته كما في النسخة السابقة — لا تُخفى خلف التبويبات */}
            {!prefs.sideCollapsed && isOpen(s.key) && (
              <div className="nav-sub">
                {(() => {
                  // أطول مسار مطابق فقط — «/today» لا يُضاء مع «/today/calendar»
                  const hits = tabsOf(s.key).map((v) => pathOf(v.key))
                    .filter((to): to is string => !!to && (loc.pathname === to || loc.pathname.startsWith(to + '/')));
                  const best = hits.sort((a, b) => b.length - a.length)[0];
                  return tabsOf(s.key).map((v) => {
                  const to = pathOf(v.key);
                  const on = !!to && to === best;
                  return (
                    <button key={v.key} type="button" className={'nav-subi' + (on ? ' on' : '')}
                      aria-current={on ? 'page' : undefined} onClick={() => to && nav(to)}>
                      {v.tab}
                    </button>
                  );
                });
                })()}
              </div>
            )}
          </div>
        ))}
      </nav>
      {edge.down && (
        <button type="button" className="nav-more" aria-label="عرض بقية الصفحات"
          onClick={() => navRef.current?.scrollBy({ top: navRef.current.clientHeight * 0.7, behavior: 'smooth' })}>
          <Icon name="chevron" size={14} /><span className="lbl">المزيد</span>
        </button>
      )}
      <div className="side-links">
        <button type="button" className="side-link" onClick={openSupport} title="الدعم — الإبلاغ عن مشكلة">
          <Icon name="help" size={18} stroke={1.6} /><span className="lbl">الدعم</span>
        </button>
        <button type="button" className="side-link" onClick={() => nav('/data/settings')} title="الإعدادات"
          aria-current={loc.pathname.startsWith('/data/settings') ? 'page' : undefined}>
          <Icon name="settings" size={18} stroke={1.6} /><span className="lbl">الإعدادات</span>
        </button>
      </div>
      {support.open && <SupportModal screenshot={support.shot} onClose={() => setSupport({ open: false, shot: null })} />}
      <div className="side-foot">
        <BackupFoot />
        <button type="button" className="side-tg" aria-expanded={!prefs.sideCollapsed}
          aria-label={prefs.sideCollapsed ? 'توسيع الشريط' : 'طي الشريط'}
          onClick={() => setPrefs({ sideCollapsed: !prefs.sideCollapsed })}>
          <Icon name="collapse" size={16} />
        </button>
      </div>
    </aside>
  );
}

function BackupFoot() {
  usePrefs();
  const { data, isError } = useBackups();
  const latest = (data?.items || []).map((b) => b.created_at).filter(Boolean).sort().pop();
  return (
    <div id="sideFoot">
      <span className={'dot' + (isError ? ' warn' : '')} />
      <span className="sf-t">{isError ? 'الخدمة غير متاحة' : latest ? 'آخر نسخة احتياطية ' + ago(latest) : 'لا نسخ احتياطية بعد'}</span>
    </div>
  );
}
