/**
 * «التقويم المالي» — today.calendar (`/today/calendar`، والمسار القديم `/calendar`).
 * منقول من prototype (renderCalendar/openDay) ويغطي Calendar.tsx (P-253…P-262).
 * شهر/أسبوع، الأسبوع يبدأ السبت كالتقويم القديم، أحمر للمتأخر زمنياً فقط، أجندة على الشاشات الضيقة.
 * المعاملات في الرابط: ?project= · ?date= (يفتح الشهر الذي فيه التاريخ) · ?mode=week.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  PageHeader, Grid, Island, Money, Pill, Seg, Button, Modal, EmptyState, Skeleton,
  dateTxt, digits, fmt, compact, usePrefs,
} from '@/ui';
import { MONTHS } from '@/ui/format';
import { useDashboardData, useClaimsDue, useGuaranteeList, useProjectNames, useDayDetail, type DayDetail } from './data.ts';
import {
  calendarEvents, gridCells, weekStartOf, dayNames, periodTotals, iso, parseISO, addDays, sumHalalas, EV_LABEL, type CalEvent,
} from './logic.ts';
import { useGo } from './nav.ts';

const WEEK_START = 6; // السبت
const sevOf = (e: CalEvent) => (e.late ? 'd' : e.kind === 'guarantee' ? 'i' : 'w');

export default function Calendar() {
  usePrefs();
  const go = useGo();
  const [sp, setSp] = useSearchParams();
  const project = sp.get('project') || '';
  const mode: 'month' | 'week' = sp.get('mode') === 'week' ? 'week' : 'month';
  const setParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp);
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    setSp(p, { replace: true });
  };

  const db = useDashboardData(project);
  const claims = useClaimsDue(project);
  const guarantees = useGuaranteeList();
  const projects = useProjectNames();
  const [open, setOpen] = useState<string | null>(null);

  const today = db.data?.today ?? '';
  const t0 = today ? parseISO(today) : null;
  const anchor = parseISO(sp.get('date') || today || iso(new Date()));
  const y = anchor.getFullYear(), m = anchor.getMonth();
  const weekStart = weekStartOf(anchor, WEEK_START);
  const cells = useMemo(() => gridCells(mode, y, m, weekStart, WEEK_START), [mode, y, m, weekStart.getTime()]); // eslint-disable-line react-hooks/exhaustive-deps
  const ev = useMemo(() => calendarEvents(db.data?.schedule ?? [], claims.data?.rows ?? [], guarantees, project || undefined),
    [db.data, claims.data, guarantees, project]);

  if (db.error) return <EmptyState icon="alert" title="تعذّر تحميل التقويم" body={String(db.error as Error)} cta="إعادة المحاولة" onCta={() => db.refetch()} />;
  if (!db.data || !t0) return <div className="sec-today"><PageHeader title="التقويم المالي" /><Skeleton rows={8} /></div>;

  const inRange = (d: Date) => mode === 'week' || d.getMonth() === m;
  const tot = periodTotals(cells, ev, inRange);
  const title = mode === 'month' ? MONTHS[m] + ' ' + digits(y) : dateTxt(cells[0]) + ' – ' + dateTxt(cells[6]);
  const nav = (n: number) => {
    if (n === 0) { setParams({ date: '' }); return; }
    const d = mode === 'month' ? new Date(y, m + n, 1) : addDays(weekStart, 7 * n);
    setParams({ date: iso(d) });
  };
  const todayIso = iso(t0);
  const agenda = cells.filter((c) => inRange(c) && (ev[iso(c)] || []).length);

  return (
    <div className="sec-today">
      <PageHeader title="التقويم المالي"
        sub={<>{title} · إجمالي الاستحقاقات <Money value={tot.due} />{tot.guarantees ? <> · ضمانات تُصرف <Money value={tot.guarantees} /></> : null} · {digits(tot.count)} استحقاق · انقر أي يوم لعرض تفاصيله</>}
        actions={<>
          <Button onClick={() => nav(-1)}>→ {mode === 'month' ? 'الشهر السابق' : 'الأسبوع السابق'}</Button>
          <Button onClick={() => nav(0)}>اليوم</Button>
          <Button onClick={() => nav(1)}>{mode === 'month' ? 'الشهر التالي' : 'الأسبوع التالي'} ←</Button>
          <Seg<'month' | 'week'> value={mode} onChange={(v) => setParams({ mode: v === 'week' ? 'week' : '' })} label="العرض"
            options={[{ value: 'month', label: 'شهر' }, { value: 'week', label: 'أسبوع' }]} />
          <select className="td-sel" aria-label="المشروع" value={project} onChange={(e) => setParams({ project: e.target.value })}>
            <option value="">كل المشاريع</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </>} />

      <Grid>
        <Island span={12} i={0}>
          <div className={'cal td-cal' + (mode === 'week' ? ' td-week' : '')} role="grid" aria-label={title}>
            {dayNames(WEEK_START).map((w) => <div key={w} className="dh2" role="columnheader">{w}</div>)}
            {cells.map((c) => {
              const k = iso(c), es = ev[k] || [], late = es.some((e) => e.late);
              const amt = sumHalalas(es.filter((e) => e.kind !== 'guarantee'), (e) => e.amount);
              const show = mode === 'week' ? es : es.slice(0, 3);
              return (
                <button key={k} type="button" role="gridcell"
                  className={'day td-day' + (mode === 'month' && c.getMonth() !== m ? ' out' : '') + (k === todayIso ? ' today' : '') + (late ? ' td-late' : '')}
                  aria-label={dateTxt(c, { weekday: true }) + ' · ' + digits(es.length) + ' حدث'} onClick={() => setOpen(k)}>
                  <span className="dn num">{digits(c.getDate())}{k === todayIso && <span className="cap"> اليوم</span>}</span>
                  {show.map((e, n) => (
                    <span key={n} className={'ev ' + sevOf(e)}>
                      {e.kind === 'invoices' ? digits(e.count) + ' ' + (e.count === 1 ? 'فاتورة' : 'فواتير') : e.label}
                      {mode === 'week' && e.amount ? ' · ' + fmt(e.amount) : ''}
                    </span>
                  ))}
                  {es.length > show.length && <span className="cap">+{digits(es.length - show.length)} أخرى</span>}
                  {amt > 0 && <span className={'num td-damt' + (late ? ' t-danger' : '')}>{compact(amt)}</span>}
                </button>
              );
            })}
          </div>

          <ul className="td-agenda">
            {agenda.length ? agenda.map((c) => { const k = iso(c); return (
              <li key={k}>
                <button type="button" className="td-agday" onClick={() => setOpen(k)}>
                  <b>{dateTxt(c, { weekday: true })}</b>{k === todayIso && <Pill tone="warn">اليوم</Pill>}
                </button>
                <ul>{ev[k].map((e, n) => (
                  <li key={n}><span className={'sev ' + sevOf(e)} /><span>{e.kind === 'invoices' ? EV_LABEL.invoices + ' · ' + digits(e.count) : e.label}<small className="cap"> · {EV_LABEL[e.kind]}</small></span><Money value={e.amount} className={e.late ? 't-danger' : ''} /></li>
                ))}</ul>
              </li>); }) : <li className="empty-note">لا استحقاقات في هذه الفترة</li>}
          </ul>

          <div className="legend">
            <span><span className="ev w td-lg">{EV_LABEL.invoices}</span></span>
            <span><span className="ev w td-lg">{EV_LABEL.claim}</span></span>
            <span><span className="ev i td-lg">{EV_LABEL.guarantee}</span></span>
            <span><span className="ev d td-lg">متأخر</span></span>
          </div>
          <p className="disclose">الاستحقاقات تشمل فواتير الموردين ومستخلصات المقاولين ذوي مدة السداد؛ صرف الضمانات يُعرض منفصلاً ولا يُجمع مع المستحق.</p>
        </Island>
      </Grid>

      <DayModal date={open} project={project} events={open ? ev[open] || [] : []} onClose={() => setOpen(null)}
        openParty={(kind, key) => { setOpen(null); go(kind === 'contractor' ? 'parties.contractor' : 'parties.supplier', kind === 'contractor' ? { code: key } : { account: key }); }} />
    </div>
  );
}

/** تفاصيل اليوم: فواتير الموردين والضمانات من /dashboard/day، والمستخلصات من أحداث اليوم نفسها. */
function DayModal({ date, project, events, onClose, openParty }: {
  date: string | null; project: string; events: CalEvent[]; onClose: () => void;
  openParty: (kind: 'supplier' | 'contractor', key: string) => void;
}) {
  const q = useDayDetail(date, project);
  const d = q.data as DayDetail | undefined;
  const dayClaims = events.filter((e) => e.kind === 'claim');
  const empty = d && d.suppliers.length === 0 && d.guarantees.length === 0 && dayClaims.length === 0;
  return (
    <Modal open={!!date} onClose={onClose} size="lg" title={date ? 'تفاصيل يوم ' + dateTxt(date, { weekday: true, year: true }) : ''} actions={[{ label: 'إغلاق' }]}>
      <div className="sec-today">
        {q.error ? <EmptyState icon="alert" title="تعذّر التحميل" body={String(q.error as Error)} cta="إعادة المحاولة" onCta={() => q.refetch()} />
          : !d ? <Skeleton rows={4} />
          : empty ? <p className="empty-note">لا استحقاقات في هذا اليوم.</p>
          : (
            <>
              {dayClaims.length > 0 && (
                <section className="td-dsec">
                  <h3>مستخلصات مقاولين تستحق · <Money value={sumHalalas(dayClaims, (e) => e.amount)} /></h3>
                  <ul className="td-dlist">{dayClaims.map((e, n) => (
                    <li key={n}><span className={'sev ' + sevOf(e)} />
                      <div className="td-dl"><b>{e.label}</b><div className="cap">{e.doc ? <>رقم <span className="num">{digits(e.doc)}</span> · </> : null}{e.project || '—'}</div></div>
                      <Money value={e.amount} className={e.late ? 't-danger' : ''} />
                      {e.late ? <Pill tone="danger">متأخر {digits(e.daysLate ?? 0)} يوماً</Pill> : <Pill tone="warn">مستحق</Pill>}
                      <Button size="sm" onClick={() => openParty('contractor', e.key || '')}>فتح كشف المقاول ←</Button>
                    </li>))}</ul>
                </section>
              )}
              {d.suppliers.length > 0 && (
                <section className="td-dsec">
                  <h3>فواتير موردين مستحقة · <Money value={d.totals.due} /></h3>
                  <ul className="td-dlist">{d.suppliers.map((s, n) => (
                    <li key={s.account + n}><span className={'sev ' + (s.overdue ? 'd' : 'w')} />
                      <div className="td-dl"><b>{s.supplier}</b><div className="cap">فاتورة {s.invoice ? <span className="num">{digits(s.invoice)}</span> : '—'}</div></div>
                      <Money value={s.amount} className={s.overdue ? 't-danger' : ''} />
                      {s.overdue ? <Pill tone="danger">متأخرة</Pill> : <Pill tone="warn">مستحقة</Pill>}
                      <Button size="sm" onClick={() => openParty('supplier', s.account)}>فتح كشف المورد ←</Button>
                    </li>))}</ul>
                </section>
              )}
              {d.guarantees.length > 0 && (
                <section className="td-dsec">
                  <h3>ضمانات مقاولين تستحق الصرف · <Money value={d.totals.guarantees} /></h3>
                  <ul className="td-dlist">{d.guarantees.map((g, n) => (
                    <li key={g.code + n}><span className="sev i" />
                      <div className="td-dl"><b>{g.name}</b><div className="cap">{g.project || '—'}</div></div>
                      <Money value={g.amount} />
                      <Button size="sm" onClick={() => openParty('contractor', g.code)}>فتح كشف المقاول ←</Button>
                    </li>))}</ul>
                </section>
              )}
            </>
          )}
      </div>
    </Modal>
  );
}
