/**
 * «اليوم» — today.summary (`/today`، والمسار القديم `/`).
 * منقول من prototype/sections/today.js (renderToday) ويغطي CommandCentre.tsx كاملاً و«لوحة» Dashboard.tsx.
 * كل رقم هنا من الخادم؛ ما لا يدعمه الخادم بعد (رصيد البنك، «ماذا تغيّر») يُعرض «غير متاح» لا صفراً.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import {
  PageHeader, Grid, Island, Money, Num, Button, LineChart, Skeleton, EmptyState, toast,
  dateTxt, ago, digits, fmt, compact, usePrefs, uiPref, setUiPref,
} from '@/ui';
import { ExplainDot } from '@/components/Explain';
import {
  useOverviewData, useDashboardData, useTodayState, useClaimsDue, useGuaranteeList, useLastImport, useProjection,
} from './data.ts';
import {
  buildTasks, supplierOverdue, contractorOverdue, ageingBuckets, changeSummary, firstDeficit, minBalance,
  loadDone, toggleDone, plural, sumHalalas, type Task, type Sev, type DoneState,
} from './logic.ts';
import { PayModal, type PayTarget } from './Payments.tsx';
import { Assistant } from './Assistant.tsx';
import { useGo, target } from './nav.ts';
import { num, type TodayRaw } from './data.ts';

/** مهمة من /today.tasks → Task. الأحمر لـoverdue:* فقط؛ المتأخر يحمل «سجّل دفعة». */
function serverTask(x: TodayRaw['tasks'][number]): Task {
  const [, ptype, key] = x.id.split(':');
  const late = x.id.startsWith('overdue:');
  const amount = num(x.amount);
  const [ov, op] = target(x.action.view, x.action.params ?? {});
  const open = { view: ov, params: op };
  const pay = late && amount != null && (ptype === 'supplier' || ptype === 'contractor');
  return {
    id: x.id, sev: late ? 'd' : x.severity === 'info' ? 'i' : 'w', score: 0, title: x.title, amount, sub: x.detail,
    actLabel: pay ? 'سجّل دفعة' : x.action.label,
    action: pay ? { kind: 'pay', partyType: ptype as 'supplier' | 'contractor', key, name: x.title.replace(/^.*— /, ''), amount: amount as number } : { kind: 'go', ...open },
    open,
  };
}

const DONE_KEY = 'today.tasksDone';

/** التنبيهات من الخادم كما هي نصاً (P-029)؛ الأحمر للتأخر الزمني فقط. */
function alertSev(a: { level: string; kind?: string; text: string }): Sev {
  if (a.level === 'info') return 'i';
  if (a.level === 'danger' && (a.kind === 'contractors_overdue' || a.text.startsWith('متأخرات'))) return 'd';
  return 'w';
}
function alertTarget(a: { kind?: string; text: string }): [string, Record<string, string>] {
  if (a.kind === 'needs_term') return ['parties.suppliers', { filter: 'needsTerm' }];
  if (a.kind?.startsWith('contractors')) return ['parties.contractors', {}];
  if (a.text.includes('عجز') || a.text.includes('التحصيلات')) return ['cash.flow', {}];
  if (a.text.includes('كشوفات') || a.text.includes('بلا حركة')) return ['data.coverage', {}];
  if (a.text.includes('مستحق خلال')) return ['today.due', { range: '7' }];
  return ['today.due', {}];
}

export default function Today() {
  usePrefs();
  const go = useGo();
  const nav = (view: string, params?: Record<string, string>) => { const [k, p] = target(view, params); go(k, p); };
  const ov = useOverviewData();
  const db = useDashboardData();
  const { td, loading: tdLoading, error: tdError, refetch: tdRetry } = useTodayState();
  // /today يغطي المهام والمؤشرات والتوقع؛ المستخلصات والتوقع الأسبوعي احتياط فقط حين لا يتوفر.
  const claims = useClaimsDue(undefined, !!tdError);
  const guarantees = useGuaranteeList();
  const lastImp = useLastImport();
  const bank = td?.bankBalance ?? null;
  // التحذير فقط حين حُمِّل /today فعلاً وقال الخادم إن الرصيد غير مُدخل.
  const noBank = !!td && td.cashBasis === 'no_bank_balance';
  const cf = useProjection(!!tdError);
  const [qOpen, setQOpen] = useState(false);
  const [pay, setPay] = useState<PayTarget | null>(null);
  const [done, setDone] = useState<DoneState | null>(null);

  const o = ov.data, d = db.data;
  const today = d?.today ?? o?.asOf ?? '';
  const ds = done && done.day === today ? done : loadDone(JSON.stringify(uiPref(DONE_KEY, {})), today);

  const sup = useMemo(() => supplierOverdue(d?.payToday ?? []), [d]);
  const con = useMemo(() => contractorOverdue(claims.data?.rows ?? []), [claims.data]);
  const periods = cf?.periods ?? [];
  const series = td ? td.cash30 : periods.map((p) => ({ date: p.to, balance: p.balance }));
  const fneg = firstDeficit(periods);
  const neg = td ? (td.firstDeficitDate ? { from: td.firstDeficitDate } : null) : fneg;
  const low = td ? td.cashLow : minBalance(periods);
  const tasks: Task[] = useMemo(() => (td ? td.raw.tasks.map(serverTask) : o && d ? buildTasks({
    today, suppliers: sup, contractors: con, guarantees,
    deficit: fneg ? { from: fneg.from, amount: fneg.balance } : null,
    staleCount: o.coverage.stale, withoutDataCount: o.coverage.withoutData, needsTermCount: o.needsTerm,
  }) : []), [td, o, d, today, sup, con, guarantees, fneg]);

  if (ov.error || db.error) {
    return <EmptyState icon="alert" title="تعذّر تحميل البيانات" body={String((ov.error || db.error) as Error)} cta="إعادة المحاولة"
      onCta={() => { ov.refetch(); db.refetch(); }} />;
  }
  if (!o || !d) return <div className="sec-today"><PageHeader title="اليوم" /><Skeleton rows={8} /></div>;

  if (!d.summary.supplierCount) {
    return (
      <div className="sec-today">
        <PageHeader title="اليوم" />
        <EmptyState icon="file" title="لا توجد بيانات بعد" body="ابدأ من رفع كشف حساب." cta="رفع كشف حساب" onCta={() => go('data.import')} />
      </div>
    );
  }

  const left = tasks.filter((t) => !ds.done[t.id]).length;
  const hr = new Date().getHours();
  const overdueN = sup.reduce((m, s) => m + s.count, 0);
  const oldest = sup.reduce((m, s) => Math.max(m, s.oldestDays), 0);
  const alerts = o.alerts.map((a) => ({ ...a, sev: alertSev(a) }));
  const warnN = alerts.filter((a) => a.sev !== 'i').length + (noBank ? 1 : 0);
  const ageing = ageingBuckets(d.ageing);
  const ageTotal = ageing.reduce((c, b) => c + Math.round(b.amount * 100), 0) / 100;
  const projects = o.projects.filter((p) => (p.outstanding || 0) > 0);
  const hiddenProjects = o.projects.length - projects.length;
  const maxP = Math.max(1, ...projects.map((p) => p.outstanding));
  const upcoming = d.schedule.filter((b) => !b.overdue);
  const lateBuckets = d.schedule.length - upcoming.length;
  const maxU = Math.max(1, ...upcoming.slice(0, 8).map((b) => b.amount));
  const c = o.contractors;
  const lc = td?.lastChange ?? null;
  const invoiced = sumHalalas([d.summary.totalPaid, d.summary.outstanding], (x) => x);
  const paidPct = invoiced > 0 ? (d.summary.totalPaid / invoiced) * 100 : null; // نسبة عرض فقط

  const toggle = (id: string) => {
    const was = !!ds.done[id];
    const next = toggleDone(ds, id, Date.now());
    setDone(next); setUiPref(DONE_KEY, next);
    if (!was) toast('أُنجزت المهمة', { kind: 'ok', undo: () => { const back = toggleDone(next, id, 0); setDone(back); setUiPref(DONE_KEY, back); } });
  };
  const act = (t: Task) => {
    if (t.action.kind === 'pay') setPay({ partyType: t.action.partyType, key: t.action.key, name: t.action.name, amount: t.action.amount });
    else nav(t.action.view, t.action.params);
  };

  return (
    <div className="sec-today">
      <PageHeader
        title={hr < 12 ? 'صباح الخير' : 'مساء الخير'}
        sub={<span className="td-sub">
          {left ? <><b>{digits(left)}</b> {plural(left, 'أمر يحتاجك', 'أمران يحتاجانك', 'أمور تحتاجك', 'أمراً يحتاجك')} اليوم</> : 'لا شيء ينتظرك اليوم'}
          {' · '}{dateTxt(today, { weekday: true, year: true })}
          {lastImp && <> · آخر استيراد {ago(lastImp.date)}</>}
          {(alerts.length > 0 || noBank) && (
            <button type="button" className="quality td-q" aria-expanded={qOpen} aria-controls="tdQ" onClick={() => setQOpen(!qOpen)}>
              ⚠ {digits(warnN || alerts.length)} {plural(warnN || alerts.length, 'تنبيه', 'تنبيهان', 'تنبيهات', 'تنبيهاً')}
            </button>
          )}
        </span>}
        actions={<><Button onClick={() => go('today.due')}>المستحقات القادمة</Button><Button kind="primary" onClick={() => go('data.import')}>رفع كشف حساب</Button></>}
      />
      {qOpen && (
        <ul className="td-qlist" id="tdQ">
          {alerts.length === 0 && <li><span className="sev i" /><span>لا توجد تنبيهات — كل الالتزامات ضمن مواعيدها</span></li>}
          {alerts.map((a, k) => { const [v, p] = alertTarget(a); return (
            <li key={k}><span className={'sev ' + a.sev} /><span>{a.text}</span><button type="button" className="lnk" onClick={() => go(v, p)}>افتح ←</button></li>); })}
          {noBank && <li><span className="sev w" /><span>رصيد البنك غير مُدخل — التوقع يبدأ من رصيد افتتاحي صفر</span><button type="button" className="lnk" onClick={() => go('data.settings')}>افتح ←</button></li>}
        </ul>
      )}
      {!qOpen && alerts.length === 0 && <p className="cap td-allclear">لا توجد تنبيهات — كل الالتزامات ضمن مواعيدها</p>}

      <Grid>
        {/* المتأخر للموردين — P-031، P-045 */}
        <Island span={6} i={0} crit={o.payables.overdue > 0} title={<>المتأخر للموردين <ExplainDot metric="overdue" values={{ overdue: o.payables.overdue }} /></>}
          onClick={() => go('parties.suppliers', { filter: 'overdue' })} label="المتأخر للموردين — افتح الموردين">
          <div className={'hero' + (o.payables.overdue > 0 ? ' t-danger' : '')}><Money value={o.payables.overdue} count countKey="today.overdue" /></div>
          <div className="meta">
            <span>{digits(overdueN)} {plural(overdueN, 'فاتورة', 'فاتورتان', 'فواتير', 'فاتورة')} · {digits(sup.length)} {plural(sup.length, 'مورد', 'موردان', 'موردين', 'مورداً')}{oldest ? ' · أقدمها ' + digits(oldest) + ' يوماً' : ''}</span>
            <span>مستحق خلال ٧ أيام <Money value={o.payables.dueWithin7} /> <ExplainDot metric="dueWithin7" values={{ dueWithin7: o.payables.dueWithin7 }} /></span>
          </div>
          <div className="td-crow">
            <span className="cap">المديونية المفتوحة <ExplainDot metric="outstanding" values={{ totalInvoiced: invoiced, totalPaid: d.summary.totalPaid, outstanding: o.payables.outstanding }} /></span>
            <span className="kpi td-kpi-sm" data-testid="kpi-outstanding"><Money value={o.payables.outstanding} count countKey="today.outstanding" /></span>
          </div>
          {d.summary.totalPaid > 0 && paidPct != null && (
            <p className="disclose">سُدّد حتى الآن <Money value={d.summary.totalPaid} /> من إجمالي <Money value={invoiced} /> (<Num value={Math.round(paidPct * 10) / 10} />٪)</p>
          )}
        </Island>

        {/* النقد — P-035 */}
        <Island span={6} i={1} title="النقد" onClick={() => go('cash.flow')} label="النقد — افتح التدفق النقدي">
          {tdLoading ? <Skeleton rows={2} /> : tdError ? (
            <p className="disclose">تعذّر تحميل بيانات اليوم — <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); tdRetry(); }}>إعادة المحاولة</button></p>
          ) : bank != null ? (
            <><div className="cap">رصيد البنوك المُدخل</div><div className={'hero' + (bank < 0 ? ' t-warn' : '')}><Money value={bank} count countKey="today.bank" /></div></>
          ) : noBank ? (
            <><div className="cap">رصيد البنك غير مُدخل</div><div className="hero"><span className="dash">—</span></div></>
          ) : null}
          {!o.cash.hasReceivables ? (
            <p className="disclose">لم تُرفع بيانات التحصيلات — لا يمكن حساب السيولة بعد. <button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); go('cash.flow'); }}>فتح التدفق النقدي</button></p>
          ) : (
            <div className="meta">
              <span>أدنى رصيد (٨ أسابيع) <Money value={o.cash.minBalance} className={o.cash.minBalance < 0 ? 't-warn' : ''} /></span>
              {o.cash.nextDeficit && <span className="t-warn">أول عجز: {o.cash.nextDeficit.label} بمقدار <Money value={Math.abs(o.cash.nextDeficit.amount)} /></span>}
            </div>
          )}
          {noBank && <p className="disclose">التوقع محسوب من رصيد افتتاحي صفر حتى يُدخَل رصيد البنك.</p>}
        </Island>

        {/* مهام اليوم */}
        <Island span={4} i={2} className="td-tasks" title="مهام اليوم" actions={<span className="cap"><Num value={tasks.length - left} int />/<Num value={tasks.length} int /></span>}>
          {tasks.length ? (
            <>
              <ul className="tasks">
                {tasks.slice(0, 8).map((t) => { const isDone = !!ds.done[t.id]; return (
                  <li key={t.id} className={isDone ? 'done' : ''}>
                    <button type="button" className="chk" aria-label="تمّ" aria-pressed={isDone} onClick={() => toggle(t.id)}>
                      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 6.5l2.5 2.5L10 3.5" /></svg>
                    </button>
                    <span className={'sev ' + t.sev} />
                    <button type="button" className="tt" onClick={() => nav(t.open.view, t.open.params)}>
                      {t.title}{t.date ? ' ' + dateTxt(t.date) : ''}{t.amount != null && <> <Money value={t.amount} className={t.sev === 'd' ? 't-danger' : ''} /></>}
                      <small>{t.sub}</small>
                    </button>
                    <Button size="sm" className="td-act" onClick={() => act(t)}>{t.actLabel}</Button>
                  </li>); })}
              </ul>
              {tasks.length > 8 && <button type="button" className="lnk td-more" onClick={() => go('today.due')}>+ {digits(tasks.length - 8)} أخرى في المستحقات ←</button>}
            </>
          ) : <div className="empty-note">لا مهام — كل الالتزامات ضمن مواعيدها</div>}
        </Island>

        {/* الرصيد المتوقع */}
        <Island span={8} i={3} title={td ? 'الرصيد المتوقع — ٣٠ يوماً' : 'الرصيد المتوقع — ٥ أسابيع'} link={{ label: 'التفاصيل ←', onClick: () => go('cash.flow') }}>
          {series.length ? (
            <>
              <div className="td-chart">
                <LineChart label="الرصيد المتوقع" height={220} negArea
                  series={[{ name: 'الرصيد المتوقع', values: series.map((p) => p.balance), color: 'var(--chart-1)' }]}
                  dates={series.map((p) => p.date)} xLabels={series.map((p, k) => (td && k % 5 ? '' : dateTxt(p.date)))} />
              </div>
              <div className="legend">
                <span><i className="td-lg1" />الرصيد المتوقع</span>
                {low != null && <span>أدنى رصيد <Money value={low} className={low < 0 ? 't-warn' : ''} /></span>}
                {neg && <span className="t-warn">⚠ عجز من {dateTxt(neg.from)}</span>}
              </div>
              {noBank && <p className="disclose">من رصيد افتتاحي صفر — أدخل رصيد البنك ليصبح التوقع رصيداً فعلياً.</p>}
            </>
          ) : <div className="empty-note">لا توقع بعد</div>}
        </Island>

        {/* أعلى المشاريع مديونية — P-036 */}
        <Island span={4} i={4} title="أعلى المشاريع مديونية" link={{ label: 'المشاريع ←', onClick: () => go('projects.list') }}>
          {o.projects.length === 0 ? <div className="empty-note">لا توجد بيانات مشاريع بعد.</div> : (
            <div className="proj">
              {projects.slice(0, 5).map((p, k) => (
                <div key={p.project} className="prow click" role="link" tabIndex={0}
                  onClick={() => go('projects.project', { project: p.project })}
                  onKeyDown={(e) => { if (e.key === 'Enter') go('projects.project', { project: p.project }); }}>
                  <span className="td-pn">{p.project}</span>
                  <span className="bar"><i className="td-bar-gold" style={{ ['--i' as string]: k, ['--w' as string]: Math.max(0.04, p.outstanding / maxP) } as CSSProperties} /></span>
                  <span className="td-pv"><Money value={p.outstanding} noCur />{p.overdue > 0 && <small className="t-danger">متأخر <Money value={p.overdue} noCur /></small>}</span>
                </div>
              ))}
              {hiddenProjects > 0 && <p className="disclose">+{digits(hiddenProjects)} مشاريع بلا مديونية</p>}
            </div>
          )}
        </Island>

        {/* ماذا تغيّر */}
        <Island span={8} i={5} title="ماذا تغيّر"
          actions={<span className="cap">{lc ? 'منذ استيراد ' + (lc.file || '') + ' · ' + ago(lc.at) : 'لا لقطة قبل/بعد بعد'}</span>}>
          {lc ? (
            <>
              <div className="changes">
                {changeSummary(lc.before, lc.after).map((x) => (
                  <div key={x.key} className="chg-card">
                    <div className="cap">{x.label}</div>
                    <div className={'kpi chg ' + (x.tone === 'bad' ? 't-danger' : x.tone === 'good' ? 't-ok' : '')}>
                      {x.delta === 0 ? <Num value={0} /> : <><span className="td-ar">{x.delta > 0 ? '▲' : '▼'}</span>{x.delta > 0 ? '+' : '−'}{fmt(Math.abs(x.delta))}</>}
                    </div>
                    <div className="cap">كان {fmt(x.before)} · صار {fmt(x.after)}</div>
                  </div>
                ))}
              </div>
              <div className="changes td-chg2">
                <div className="chg-card"><div className="cap">فواتير جديدة</div><div className="kpi"><Num value={lc.newInvoices ?? null} int /></div></div>
                <div className="chg-card"><div className="cap">سُدّدت</div><div className="kpi t-ok"><Num value={lc.paidInvoices ?? null} int /></div><div className="cap">فواتير أُغلقت</div></div>
                <div className="chg-card"><div className="cap">أدنى رصيد متوقع</div><div className="kpi"><Money value={low} /></div><div className="cap"><button type="button" className="lnk" onClick={() => go('cash.flow')}>التدفق ←</button></div></div>
              </div>
            </>
          ) : (
            <div className="empty-note">يظهر هنا الفرق قبل/بعد آخر استيراد حين يتوفر — <button type="button" className="lnk" onClick={() => go('data.import')}>ارفع كشفاً</button></div>
          )}
        </Island>

        {/* المقاولون — P-046، P-047 */}
        <Island span={4} i={6} title="المقاولون" onClick={() => go('parties.contractors')} label="المقاولون — افتح القائمة">
          <div className="cap">المستحق للمقاولين · {digits(c.count)} مقاولاً</div>
          <div className="kpi"><Money value={c.owedToContractors} count countKey="today.conOwed" /></div>
          <div className="td-crow">
            <span className="cap">متأخر (لمن له مدة · {digits(c.withTermCount)})</span>
            <span className={c.overdue > 0 ? 't-danger' : ''}><Money value={c.withTermCount > 0 ? c.overdue : null} /></span>
          </div>
          {c.overdue > 0 && <div className="cap">{digits(c.overdueContractorCount)} مقاولاً متأخراً — غير مجموع مع رقم الموردين</div>}
          {c.withoutTermCount > 0 && (
            <p className="disclose"><button type="button" className="lnk" onClick={(e) => { e.stopPropagation(); go('parties.contractors', { noTerm: '1' }); }}>{digits(c.withoutTermCount)} مقاولاً بلا مدة سداد</button> — تأخرهم غير محسوب «—»</p>
          )}
          {c.withoutStatementCount > 0 && (
            <p className="disclose">{digits(c.withoutStatementCount)} مقاولاً بلا كشف حركات (رصيد مُبلَّغ فقط) بقيمة <Money value={c.withoutStatementOwed} /> — غير مُحتسبة ضمن المستحق أعلاه</p>
          )}
        </Island>

        {/* أعمار الديون — P-051 */}
        <Island span={8} i={7} title="أعمار الديون" actions={<span className="cap">الموردون · انقر شريحة للتصفية</span>}>
          <div className="td-aging">
            {ageing.map((b, k) => (
              <button key={b.key} type="button" className="td-ab" onClick={() => go('parties.suppliers', { aging: b.key })}>
                <span className="td-al">{b.label}</span>
                <span className="bar"><i className={b.late ? 'td-bar-late' : 'td-bar-cur'} style={{ ['--i' as string]: k, ['--w' as string]: Math.max(0.02, b.share) } as CSSProperties} /></span>
                <span className="td-av">{b.amount > 0 ? <Money value={b.amount} className={b.late ? 't-danger' : ''} /> : <span className="dash">—</span>}</span>
              </button>
            ))}
            <div className="td-agtot cap">الإجمالي <Money value={ageTotal} /></div>
          </div>
        </Island>

        {/* التغطية — P-033، P-034 */}
        <Island span={4} i={8} title={<>التغطية <ExplainDot metric="supplierCoverage" values={{ supplierWithData: o.payables.supplierCount - o.coverage.withoutData, supplierCount: o.payables.supplierCount, coveredPct: o.coverage.coveredPct }} /></>}
          link={{ label: 'عرض فجوات التغطية ←', onClick: () => go('data.coverage') }}>
          <div className="kpi">{o.coverage.coveredPct != null ? <><Num value={o.coverage.coveredPct} />٪</> : <span className="dash">—</span>}</div>
          <span className="bar td-covbar"><i className="td-bar-gold" style={{ ['--w' as string]: Math.max(0, Math.min(1, (o.coverage.coveredPct ?? 0) / 100)) } as CSSProperties} /></span>
          <div className="meta">
            <span>{digits(o.payables.supplierCount)} مورداً · {digits(o.payables.withData)} منهم لديهم كشوفات</span>
            <span>{digits(o.coverage.withoutData)} مورداً بلا كشوفات</span>
            <span>{digits(o.coverage.stale)} كشوفاتهم قديمة</span>
          </div>
          <p className="disclose">أرقام هذه الصفحة مبنية على من رُفعت كشوفاتهم فقط.</p>
        </Island>

        {/* الاستحقاقات القادمة — ٩٠ يوماً — P-050 */}
        <Island span={8} i={9} title="الاستحقاقات القادمة — ٩٠ يوماً" link={{ label: 'التقويم ←', onClick: () => go('today.calendar') }}>
          {upcoming.length === 0 ? <div className="empty-note">لا استحقاقات قادمة خلال ٩٠ يوماً</div> : (
            <div className="td-cols" role="list">
              {upcoming.slice(0, 8).map((b, k) => (
                <button key={b.date} type="button" role="listitem" className="td-col" onClick={() => go('today.calendar', { date: b.date })}
                  aria-label={dateTxt(b.date) + ' · ' + fmt(b.amount) + ' ر.س'}>
                  <span className="num td-colv">{compact(b.amount)}</span>
                  <span className="td-colbar" style={{ ['--i' as string]: k, ['--h' as string]: Math.max(0.05, b.amount / maxU) } as CSSProperties} />
                  <span className="cap">{dateTxt(b.date)}</span>
                  <span className="cap">{digits(b.count)} {plural(b.count, 'فاتورة', 'فاتورتان', 'فواتير', 'فاتورة')}</span>
                </button>
              ))}
            </div>
          )}
          {lateBuckets > 0 && <p className="disclose">{digits(lateBuckets)} تاريخ استحقاق متأخر لا يظهر هنا — انظر <button type="button" className="lnk" onClick={() => go('today.due')}>«المستحقات القادمة»</button></p>}
        </Island>

        <Assistant i={10} />
      </Grid>

      {pay && <PayModal key={pay.partyType + pay.key} target={pay} today={today} onClose={() => setPay(null)} />}
    </div>
  );
}
