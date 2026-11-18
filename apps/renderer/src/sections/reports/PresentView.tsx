/**
 * وجهة «عرض تقديمي» (P-307، P-330، P-369، P-581): مصغّرات + عرض ملء الشاشة.
 * الشرائح من نفس /reports/analysis بنفس نطاق الرابط — لا يمكن أن تختلف عن التقرير.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, EmptyState, Grid, PageHeader, Skeleton, digits, fmt, toast, usePrefs } from './uikit';
import { useAnalysis, useScopes } from './hooks';
import { buildGmReport, loadPrefs, savePrefs } from './model';
import { buildSlides, keyToAction, type SlideModel } from './slides';
import { exportPdf, pdfNames } from './exports';
import { useReportParams } from './useReportParams';
import { ScopeSelect } from './ScopeSelect';
import { SlideBodyView } from './SlideBodyView';
import './reports.css';

const COMPANY = 'شركة إعمار الخليج المصرية للمقاولات';

export default function PresentView() {
  usePrefs();
  const rp = useReportParams();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const scopes = useScopes();
  const q = useAnalysis(rp.params);
  const [notes, setNotes] = useState(() => loadPrefs().speakerNotes);
  const [start, setStart] = useState<number | null>(null);
  useEffect(() => { savePrefs({ ...loadPrefs(), speakerNotes: notes }); }, [notes]);

  const slides = useMemo(() => q.data ? buildSlides(buildGmReport(q.data, rp.parties), fmt, (n) => digits(n)) : [], [q.data, rp.parties]);

  return (
    <>
      <PageHeader title="عرض تقديمي"
        sub={slides.length ? `${digits(slides.length)} شرائح من نفس بيانات التقرير — لا يمكن أن تختلف عما تعرضه الشاشات` : 'من نفس بيانات التقرير'}
        crumb={{ label: 'التقرير', onClick: () => nav('/reports?' + sp.toString()) }}
        actions={<>
          <Button aria-pressed={notes} onClick={() => setNotes(!notes)}>ملاحظات المتحدث: {notes ? 'ظاهرة' : 'مخفية'}</Button>
          <Button kind="primary" disabled={!slides.length} onClick={() => setStart(0)}>ابدأ العرض</Button>
        </>} />
      <div className="rp-present-bar">
        <ScopeSelect scopes={scopes.data} value={rp.scope} onChange={(scope) => rp.patch({ scope })} />
      </div>
      <p className="rp-help">← / مسافة: التالي · →: السابق · Home/End · N: الملاحظات · F: ملء الشاشة · Esc: إغلاق.</p>
      {q.error && <EmptyState icon={null} title="تعذّر إعداد الشرائح" body={q.error} cta="إعادة المحاولة" onCta={q.reload} />}
      {!q.error && !q.data && <Skeleton rows={4} />}
      {slides.length > 0 && (
        <Grid>
          {slides.map((s, i) => (
            <button key={s.id} type="button" className="isl c4 click rp-thumb" style={{ '--i': i } as React.CSSProperties}
              aria-label={`ابدأ من الشريحة ${i + 1}`} onClick={() => setStart(i)}>
              <span className="rp-tn num">{digits(i + 1)}</span><b>{s.title}</b><span className="cap">{s.subtitle ?? ''}</span>
              {notes && s.note && <span className="rp-tnote">{s.note}</span>}
            </button>
          ))}
        </Grid>
      )}
      {start != null && slides.length > 0 && (
        <PresentOverlay slides={slides} start={start} notes={notes} onNotes={() => setNotes((n) => !n)} onClose={() => setStart(null)} />
      )}
    </>
  );
}

function PresentOverlay({ slides, start, notes, onNotes, onClose }: {
  slides: SlideModel[]; start: number; notes: boolean; onNotes: () => void; onClose: () => void;
}) {
  const [idx, setIdx] = useState(start);
  const [busy, setBusy] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const last = slides.length - 1;
  const go = useCallback((n: number) => setIdx(Math.max(0, Math.min(last, n))), [last]);

  const fullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) { void document.exitFullscreen(); return; }
      const p = root.current?.requestFullscreen?.();
      p?.catch(() => toast('ملء الشاشة غير مسموح — العرض يملأ النافذة بدلاً منه', { kind: 'info' }));
    } catch { toast('ملء الشاشة غير مسموح — العرض يملأ النافذة بدلاً منه', { kind: 'info' }); }
  }, []);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    document.documentElement.classList.add('rp-presenting');
    root.current?.querySelector<HTMLElement>('[data-p="next"]')?.focus();
    return () => {
      document.documentElement.classList.remove('rp-presenting');
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      prev?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && root.current) {
        const f = root.current.querySelectorAll<HTMLElement>('button:not([disabled])');
        if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
        return;
      }
      const a = keyToAction(e.key);
      if (!a) return;
      if (a === 'close' && document.fullscreenElement) return; // Esc يخرج من ملء الشاشة أولاً
      e.preventDefault(); e.stopPropagation();
      if (a === 'next') go(idx + 1); else if (a === 'prev') go(idx - 1);
      else if (a === 'first') go(0); else if (a === 'last') go(last);
      else if (a === 'close') onClose(); else if (a === 'notes') onNotes(); else if (a === 'fullscreen') fullscreen();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [idx, last, go, onClose, onNotes, fullscreen]);

  async function pdf() {
    setBusy(true);
    const r = await exportPdf(pdfNames.slides(), true);
    setBusy(false);
    if (r.error) toast('تعذّر إنشاء PDF: ' + r.error, { kind: 'error' });
  }

  const slideEl = (s: SlideModel, i: number, cls: string) => (
    <section key={s.id} className={'rp-slide ' + (s.body.kind === 'cover' ? 'title ' : '') + cls} aria-hidden={cls.includes('on') ? undefined : true}>
      <header><h1>{s.title}</h1>{s.subtitle && <p>{s.subtitle}</p>}</header>
      <div className="rp-sbody"><SlideBodyView b={s.body} /></div>
      <footer><span>{COMPANY}</span><span className="num">{digits(`${i + 1} / ${slides.length}`)}</span></footer>
    </section>
  );

  return createPortal(
    <div ref={root} className={'sec-reports rp-present rp-print-landscape' + (notes ? ' notes' : '')} role="dialog" aria-modal="true" aria-label="عرض تقديمي">
      <div className="rp-pbar rp-noprint">
        <Button size="sm" onClick={onClose}>إغلاق (Esc)</Button>
        <Button size="sm" aria-pressed={notes} onClick={onNotes}>ملاحظات المتحدث (N)</Button>
        <Button size="sm" onClick={fullscreen}>ملء الشاشة (F)</Button>
        <Button size="sm" disabled={busy} onClick={pdf}>{busy ? 'جارٍ إنشاء PDF…' : 'تصدير العرض PDF'}</Button>
        <span className="rp-grow" />
        <span className="rp-count" aria-live="polite">{digits(`${idx + 1} / ${slides.length}`)}</span>
        <Button size="sm" disabled={idx === 0} onClick={() => go(idx - 1)}>السابق</Button>
        <Button size="sm" data-p="next" disabled={idx === last} onClick={() => go(idx + 1)}>التالي</Button>
      </div>
      <div className="rp-stage rp-noprint" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button,table')) go(idx + 1); }}>
        {slides.map((s, i) => slideEl(s, i, i === idx ? 'on' : i < idx ? 'before' : 'after'))}
      </div>
      <div className="rp-snote rp-noprint" aria-live="polite">{slides[idx].note ?? ''}</div>
      <div className="rp-dots rp-noprint" role="tablist">
        {slides.map((s, i) => <button key={s.id} type="button" role="tab" aria-selected={i === idx} aria-label={`شريحة ${i + 1}: ${s.title}`} onClick={() => go(i)} />)}
      </div>
      {/* كل الشرائح مرتّبة للطباعة — التصدير يخرج العرض كاملاً لا الشريحة الظاهرة (Present.tsx:69) */}
      <div className="rp-print-slides">{slides.map((s, i) => slideEl(s, i, 'print'))}</div>
    </div>,
    document.body,
  );
}
