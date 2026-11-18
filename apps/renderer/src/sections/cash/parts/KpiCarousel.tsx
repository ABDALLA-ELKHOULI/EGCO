/**
 * شريط البطاقات بثلاث صفحات (P-213…P-217): الحالي · المتأخر · المتوقع مقابل الفعلي.
 * أسهم RTL («السابق» يميناً)، ←/→ من لوحة المفاتيح، سحب ٤٠px، نقاط، الصفحة محفوظة.
 * كل رقم من الخادم حرفياً؛ مع سيناريو نشط تُعرض أرقام السيناريو في «الحالي» موسومةً.
 */
import { useRef, type ReactNode, type KeyboardEvent, type TouchEvent } from 'react';
import { Money, digits, usePrefs } from '@/ui';
import { ageBucketLabel } from '../logic/prefs';
import type { CashflowResponse } from '../types';
import type { BreakdownRequest } from './BreakdownModal';
import { ExplainDot } from './ExplainDot';

const VIEWS = ['الحالي', 'المتأخر', 'المتوقع مقابل الفعلي'];

function K({ label, explain, value, tone, onClick, hint }: {
  label: ReactNode; explain?: ReactNode; value: number; tone?: string; onClick?: () => void; hint?: ReactNode;
}) {
  return (
    <div className="sec-cash-k">
      <div className="cap">{label} {explain}</div>
      {onClick ? (
        <button className={'sec-cash-kv kpi ' + (tone ?? '')} onClick={onClick} title="من أين جاء هذا الرقم؟">
          <Money value={value} />{value < 0 && <span className="sec-cash-sw t-danger">عجز</span>}
        </button>
      ) : <div className={'sec-cash-kv sec-cash-kvs kpi ' + (tone ?? '')}><Money value={value} /></div>}
      {hint && <div className="cap">{hint}</div>}
    </div>
  );
}

export interface CurrentNumbers { totalInflow: number; totalOutflow: number; netTotal: number; minBalance: number; scenario: boolean }

export function KpiCarousel({ d, cur, view, onView, onOpen, onJumpMin }: {
  d: CashflowResponse; cur: CurrentNumbers; view: number; onView: (i: number) => void;
  onOpen: (r: BreakdownRequest) => void; onJumpMin: () => void;
}) {
  usePrefs();
  const tx = useRef<number | null>(null);
  const go = (i: number) => onView(((i % 3) + 3) % 3);
  const onKey = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('.sec-cash-slide')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(view + 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); go(view - 1); }
  };
  const onTE = (e: TouchEvent) => {
    if (tx.current == null) return;
    const dx = (e.changedTouches[0]?.clientX ?? tx.current) - tx.current; tx.current = null;
    if (Math.abs(dx) >= 40) go(view + (dx < 0 ? 1 : -1));
  };
  const ov = d.overdueView, fa = d.forecastVsActual;
  const sTag = cur.scenario ? ' (سيناريو)' : '';
  const slides: ReactNode[] = [
    <>
      <div className="sec-cash-krow">
        <K label={'إجمالي الداخل (متوقّع)' + sTag} tone="t-ok" value={cur.totalInflow}
          onClick={cur.scenario ? undefined : () => onOpen({ term: 'forecast', title: 'إجمالي الداخل (متوقّع)', amount: cur.totalInflow, rule: 'كل تحصيل مفتوح (لم يُحصَّل بعد) له تاريخ استحقاق ضمن الأفق المعروض — هذا توقّع لا تاريخ.' })} />
        <K label="إجمالي المحصّل خلال المدى" tone="t-ok" value={d.collections.inWindow}
          onClick={() => onOpen({ term: 'collected', title: 'إجمالي المحصّل خلال المدى', amount: d.collections.inWindow, rule: 'كل تحصيل بحالة «محصَّل» وتاريخ تحصيله الفعلي يقع داخل الأفق المعروض — هذا تاريخ فعلي لا توقّع.' })} />
        <K label={'إجمالي الخارج' + sTag} value={cur.totalOutflow}
          onClick={cur.scenario ? undefined : () => onOpen({ term: 'scheduled', title: 'إجمالي الخارج (مجدول)', amount: cur.totalOutflow, rule: 'كل فاتورة/ضمان مستحق داخل الأفق المعروض من الجدول الزمني.' })} />
        <K label={'صافي الفترة' + sTag} tone={cur.netTotal < 0 ? 't-danger' : 't-ok'} value={cur.netTotal}
          explain={<ExplainDot metric="cashflowNetPeriod" values={{ totalInflow: cur.totalInflow, totalOutflow: cur.totalOutflow, netTotal: cur.netTotal }} />} />
        <K label={'أدنى رصيد' + sTag} tone={cur.minBalance < 0 ? 't-danger' : ''} value={cur.minBalance} onClick={onJumpMin}
          hint="اضغط للانتقال إلى فترته"
          explain={<ExplainDot metric="cashflowMinBalance" values={{ minBalance: cur.minBalance }} />} />
      </div>
      <p className="disclose">«إجمالي الداخل» توقّعٌ لتحصيلات لم تُحصَّل بعد ولها تاريخ استحقاق، أما «المحصّل خلال المدى» فمبلغ حُصِّل فعلاً بتاريخ فعلي — الاثنان مختلفان ولا يُجمعان في رقم واحد.</p>
    </>,
    <>
      <div className="sec-cash-krow">
        <K label="إجمالي الخارج المتأخر" explain={<ExplainDot metric="lateOut" subst={String(ov.totalOverdueOutflow)} />}
          tone={ov.totalOverdueOutflow > 0 ? 't-danger' : ''} value={ov.totalOverdueOutflow}
          onClick={() => onOpen({ term: 'overdue', title: 'الخارج المتأخر', amount: ov.totalOverdueOutflow, rule: 'فواتير موردين/ضمانات مقاولين مضى تاريخ استحقاقها قبل بداية الأفق المعروض ولم تُسدَّد بالكامل.' })} />
        <K label="الداخل المتأخر (تحصيلات فات استحقاقها)" explain={<ExplainDot metric="lateIn" />} tone="t-ok" value={ov.totalOverdueInflow} />
        <K label="أدنى رصيد لو سُدد كل المتأخر (خارج) اليوم" tone={ov.minBalanceIfOverdueOutflowSettledToday < 0 ? 't-danger' : 't-ok'} value={ov.minBalanceIfOverdueOutflowSettledToday} />
        <K label="أدنى رصيد لو حُصِّل كل المتأخر (داخل) اليوم" tone={ov.minBalanceIfOverdueInflowCollectedToday < 0 ? 't-danger' : 't-ok'} value={ov.minBalanceIfOverdueInflowCollectedToday} />
      </div>
      <p className="disclose">كل هذه الأرقام مقصورة على ما مضى تاريخ استحقاقه بالفعل («متأخر الآن» في سطر المطابقة) — لا تشمل المجدول ضمن الأفق ولا ما بعده.</p>
      {ov.buckets.some((b) => b.outflowCount > 0 || b.inflowCount > 0) && (
        <div className="tbl-wrap sec-cash-agewrap"><table className="sec-cash-age">
          <thead><tr><th>عمر التأخر</th><th className="n">الخارج المتأخر</th><th className="n">الداخل المتأخر</th></tr></thead>
          <tbody>{ov.buckets.filter((b) => b.outflowCount > 0 || b.inflowCount > 0).map((b) => (
            <tr key={b.fromDays}><td>{ageBucketLabel(b.fromDays, b.toDays, (n) => digits(n))}</td>
              <td className="n"><Money value={b.outflowAmount} /> <span className="cap">({digits(b.outflowCount)})</span></td>
              <td className="n"><Money value={b.inflowAmount} className="t-ok" /> <span className="cap">({digits(b.inflowCount)})</span></td></tr>
          ))}</tbody>
        </table></div>
      )}
    </>,
    <>
      <div className="sec-cash-krow">
        <K label="إجمالي الداخل المتوقّع لهذا الأفق" tone="t-ok" value={fa.expectedInflow}
          onClick={() => onOpen({ term: 'forecast', title: 'الداخل المتوقّع', amount: fa.expectedInflow, rule: 'تحصيلات مفتوحة لها تاريخ استحقاق داخل الأفق المعروض.' })} />
        <K label="إجمالي المحصّل فعلياً خلال نفس المدى" tone="t-ok" value={fa.actualCollected}
          onClick={() => onOpen({ term: 'collected', title: 'المحصّل فعلياً', amount: fa.actualCollected, rule: 'تحصيلات بحالة «محصَّل» بتاريخ تحصيل فعلي داخل نفس المدى.' })} />
        <K label="الفجوة (المحصّل فعلياً − المتوقّع)" explain={<ExplainDot metric="gap" subst={`${fa.actualCollected} − ${fa.expectedInflow} = ${fa.gap}`} />}
          tone={fa.gap < 0 ? 't-danger' : fa.gap > 0 ? 't-ok' : ''} value={fa.gap} />
      </div>
      <p className="disclose">«المتوقّع» تحصيلات لم تُحصَّل بعد ولها تاريخ استحقاق داخل الأفق، و«المحصّل فعلياً» تحصيلات سُددت بتاريخ فعلي داخل نفس المدى — مجموعتان مختلفتان، والفجوة تعرض الفرق صراحةً.</p>
    </>,
  ];
  return (
    <section className="isl c12 sec-cash-car" role="region" aria-roledescription="carousel" aria-label="بطاقات ملخّص التدفق النقدي"
      tabIndex={0} onKeyDown={onKey} onTouchStart={(e) => { tx.current = e.touches[0]?.clientX ?? null; }} onTouchEnd={onTE}>
      <div className="ih"><h2 aria-live="polite">{VIEWS[view]}</h2>
        <div className="sec-cash-nav">
          <button className="btn sm" aria-label="السابق" onClick={() => go(view - 1)}>›</button>
          <div className="sec-cash-dots">{VIEWS.map((v, i) => (
            <button key={v} aria-label={v} aria-current={i === view} onClick={() => onView(i)} />))}</div>
          <button className="btn sm" aria-label="التالي" onClick={() => go(view + 1)}>‹</button>
        </div>
      </div>
      <div className="sec-cash-vp"><div className="sec-cash-track" style={{ transform: `translateX(${view * 100}%)` }}>
        {slides.map((s, i) => (
          <div key={i} className="sec-cash-slide" aria-hidden={i !== view} {...(i !== view ? ({ inert: '' } as Record<string, string>) : {})}>{s}</div>
        ))}
      </div></div>
    </section>
  );
}
