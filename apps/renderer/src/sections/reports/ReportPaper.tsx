/**
 * ورقة A4 لتقرير الفترة — تُعرض وتُطبع كما هي (P-310…P-320).
 * كل رقم هنا من حمولة الخادم كما وصل؛ لا جمع ولا طرح (CLAUDE.md §٢).
 */
import type { ReactNode } from 'react';
import { ExplainDot } from '@/components/Explain';
import { CopyButton } from '@/components/Ai';
import logoFull from '@/assets/logo-full.png';
import { Money, digits, dateTxt } from './uikit';
import { SECTIONS, isUnavailable, visibleSections, type GmReport, type ReportPrefs, type SectionKey } from './model';
import { BalanceCell, PartyCell, PartyPill, PKpi, Sec, lastPaymentText, projectsText } from './parts';
import { PrioritiesBlock } from './PrioritiesBlock';

const subOf = (k: SectionKey) => SECTIONS.find((s) => s.key === k);

export function ReportPaper({ r, prefs, aiDraft, onCloseAi }: {
  r: GmReport; prefs: ReportPrefs; aiDraft: string | null; onCloseAi: () => void;
}) {
  const m = r.meta, s = r.summary;
  const shown = visibleSections(r, prefs);
  const body: ReactNode[] = shown.map(({ key, no }) => {
    const def = subOf(key)!;
    const head = (explain?: ReactNode) => <Sec no={no} title={def.label} sub={def.sub} explain={explain} />;
    switch (key) {
      case 'summary': return (
        <section key={key}>
          {head()}
          {r.opening && (
            <>
              <div className="rp-kpis rp-k4">
                <PKpi label="الرصيد الافتتاحي" value={r.opening.opening}
                  explain={<ExplainDot metric="openingBalance" values={{ openingBalance: r.opening.opening }} />} />
                <PKpi label="المفوتر في الفترة" value={r.opening.invoicedInPeriod} />
                <PKpi label="المسدد في الفترة" value={r.opening.paidInPeriod} tone="ok" />
                <PKpi label="الرصيد الختامي" value={r.opening.closing}
                  explain={<ExplainDot metric="closingBalance" values={{
                    openingBalance: r.opening.opening, closingBalance: r.opening.closing }} />} />
              </div>
              <p className="rp-cap">الموردون فقط · الافتتاحي محسوب من كل الحركات المسجلة قبل {dateTxt(r.opening.periodFrom ?? m.period_to, { year: true })} · افتتاحي + مفوتر − مسدد = ختامي</p>
            </>
          )}
          <div className="rp-kpis">
            <PKpi label="إجمالي المفوتر" value={s.total_invoiced} />
            <PKpi label="المسدد" value={s.total_paid} tone="ok" />
            <PKpi label="المديونية المفتوحة" value={s.outstanding}
              hint={r.contractors ? <>منها للمقاولين <Money value={r.contractors.totals.outstanding} /></> : undefined} />
            {r.hasCreditBalance && <>
              <PKpi label="أرصدة لنا (مقدمة)" value={s.credit_balances} tone="ok"
                explain={<ExplainDot metric="netOutstanding" values={{ outstanding: s.outstanding, creditBalances: s.credit_balances, netOutstanding: s.net_outstanding }} />} />
              <PKpi label="الصافي (موردون)" value={s.net_outstanding} />
            </>}
            {r.showSuppliers && <PKpi label="المتأخر عن موعده" value={s.overdue} tone={s.overdue ? 'danger' : undefined}
              explain={<ExplainDot metric="overdue" values={{ overdue: s.overdue }} />} />}
          </div>
          <p className="rp-lede">
            يغطي هذا التقرير {digits(s.supplier_count)} مورداً
            {r.contractors && <> و{digits(r.contractors.totals.count)} مقاولاً</>}. المديونية المفتوحة <Money value={s.outstanding} />
            {r.contractors && <>، منها <Money value={r.contractors.totals.outstanding} /> مستحقة للمقاولين</>}
            {r.showSuppliers && <>. تجاوز منها موعدَ استحقاقه <Money value={s.overdue} />، ويستحق خلال سبعة أيام <Money value={s.due_within_7} /></>}.
            {r.hasCreditBalance && <> بعد خصم أرصدة موردين دفعنا لهم أكثر من فواتيرهم (<Money value={s.credit_balances} />) يصبح صافي الموردين <Money value={s.net_outstanding} />.</>}
            {r.showSuppliers && <> المبالغ محسوبة على تاريخ الفاتورة مضافاً إليه مدة سداد كل مورد.</>}
          </p>
        </section>
      );
      case 'ageing': return (
        <section key={key}>
          {head(<ExplainDot metric="reportAgeing" values={{}} />)}
          <div className="tbl-wrap"><table>
            <thead><tr><th>الفئة</th><th className="n">عدد الفواتير</th><th className="n">المبلغ</th><th className="n">النسبة</th></tr></thead>
            <tbody>
              {r.ageing.map((a) => (
                <tr key={a.label}><td>{a.label}</td><td className="n">{a.count ? digits(a.count) : '—'}</td>
                  <td className="n">{a.amount ? <Money value={a.amount} /> : '—'}</td>
                  <td className="n">{a.amount ? <span className="num">{digits(a.pct.toFixed(1))}٪</span> : '—'}</td></tr>
              ))}
              {r.ageingUndated > 0 && (
                <tr><td>بانتظار تاريخ استحقاق</td><td /><td className="n"><Money value={r.ageingUndated} /></td><td className="n">—</td></tr>
              )}
            </tbody>
            {r.parties === 'suppliers' && (
              <tfoot><tr><td><b>المديونية المفتوحة كاملةً</b></td><td /><td className="n"><b><Money value={s.outstanding} /></b></td><td /></tr></tfoot>
            )}
          </table></div>
          <p className="rp-cap">الأعمار للموردين فقط — حسابات المقاولين دفتر جارٍ بلا تواريخ استحقاق.</p>
        </section>
      );
      case 'schedule': return (
        <section key={key}>
          {head()}
          <div className="tbl-wrap"><table>
            <thead><tr><th>تاريخ الاستحقاق</th><th>الطرف</th><th className="n">الفواتير</th><th>الحالة</th><th className="n">المبلغ</th></tr></thead>
            <tbody>
              {r.schedule.length === 0 && <tr><td colSpan={5} className="rp-muted">لا استحقاقات.</td></tr>}
              {r.schedule.map((x) => (
                <tr key={x.date}><td className="rp-nowrap">{x.date_ar}</td><td><PartyCell row={x} /></td>
                  <td className="n">{digits(x.count)}</td>
                  <td className={x.overdue ? 't-danger' : undefined}>{x.status}</td>
                  <td className="n"><Money value={x.amount} className={x.overdue ? 't-danger' : undefined} /></td></tr>
              ))}
            </tbody>
          </table></div>
        </section>
      );
      case 'overdue': return (
        <section key={key}>
          {head()}
          <div className="tbl-wrap"><table>
            <thead><tr><th>الجهة</th><th>المشروع</th><th className="n">المتأخر</th></tr></thead>
            <tbody>
              {r.overdueTop.length === 0 && <tr><td colSpan={3} className="rp-muted">لا متأخرات.</td></tr>}
              {r.overdueTop.map((o) => (
                <tr key={o.key}><td>{o.name}<PartyPill kind={o.kind} /></td><td className="rp-muted">{o.project ?? '—'}</td>
                  <td className="n"><Money value={o.amount} className="t-danger" /></td></tr>
              ))}
            </tbody>
          </table></div>
          <p className="rp-cap">المقاولون غير مشمولين: دفترهم بلا تواريخ استحقاق فلا يُحسب لهم تأخر.</p>
        </section>
      );
      case 'contractors': return r.contractors && (
        <section key={key}>
          {head()}
          <div className="tbl-wrap"><table>
            <thead><tr><th>المقاول</th><th>الرمز</th><th>المشاريع</th><th className="n">المستخلص</th><th className="n">المسدد</th><th className="n">الرصيد</th><th>آخر دفعة</th></tr></thead>
            <tbody>
              {r.contractors.rows.map((c) => (
                <tr key={c.code}><td className="rp-nowrap">{c.name}</td><td className="num">{c.code}</td>
                  <td className="rp-muted">{projectsText(c.projects)}</td>
                  <td className="n"><Money value={c.invoiced} /></td><td className="n"><Money value={c.paid} /></td>
                  <td className="n"><BalanceCell balance={c.balance} /></td><td className="rp-nowrap">{lastPaymentText(c.lastPayment)}</td></tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>الإجمالي ({digits(r.contractors.totals.count)})</td>
              <td className="n"><Money value={r.contractors.totals.invoiced} /></td><td className="n"><Money value={r.contractors.totals.paid} /></td>
              <td className="n"><BalanceCell balance={r.contractors.totals.balance} /></td><td /></tr></tfoot>
          </table></div>
        </section>
      );
      case 'priorities': return <section key={key}>{head()}<PrioritiesBlock /></section>;
      case 'budget': case 'cash': case 'collections': {
        const u = r[key];
        return <section key={key} className="rp-noprint">{head()}<p className="rp-muted">{isUnavailable(u) ? u.reason : ''}</p></section>;
      }
      case 'notes': return (
        <section key={key}>
          {head()}
          <div className="rp-notes">{r.notes.map((n) => <div key={n.title}><b>{n.title}</b><p>{n.body}</p></div>)}</div>
        </section>
      );
      case 'disclosure': return (
        <section key={key}>
          {head()}
          <ul className="rp-disc">
            <li>النطاق: {r.scopeLabel} · {m.period} · أساس الاحتساب: {m.basis}.</li>
            {r.contractors && <li>رصيد المقاول يُعرض كاملاً عبر كل مشاريعه؛ السالب = نحن ندين له، الموجب = يدين لنا.</li>}
            <li>أولويات السداد على مستوى الشركة كلها، لا بنطاق هذا التقرير.</li>
            <li>المحذوفات في سلة المهملات مستبعدة. كل رقم محسوب على الخادم ويمكن تتبعه إلى كشفه.</li>
          </ul>
        </section>
      );
      default: return null;
    }
  });

  return (
    <article className="rp-paper" aria-label="معاينة صفحة A4">
      <header className="rp-head">
        <img src={logoFull} alt="" className="rp-logo-img" />
        <div><b>{m.company}</b><span>{m.department}</span></div>
        <dl>
          <dt>رقم الوثيقة</dt><dd className="num">{m.serial}</dd>
          <dt>تاريخ الإصدار</dt><dd>{prefs.issue ? dateTxt(prefs.issue, { year: true }) : m.issued_on}</dd>
          <dt>التصنيف</dt><dd>{m.classification}</dd>
        </dl>
      </header>
      <h3>{m.title}</h3>
      <p className="rp-sub">{r.scopeLabel} · {m.period} · جميع الأرقام بالريال السعودي</p>
      {prefs.note.trim() && <blockquote className="rp-note">{prefs.note}</blockquote>}
      {aiDraft && (
        <div className="rp-ai rp-noprint">
          <div><b>مسودة آلية — راجعها قبل الاعتماد</b><p>{aiDraft}</p></div>
          <div className="rp-ai-acts"><CopyButton text={aiDraft} /><button type="button" className="btn sm" onClick={onCloseAi} aria-label="إغلاق المسودة">✕</button></div>
        </div>
      )}
      {body.length ? body : <p className="rp-muted">اختر قسماً واحداً على الأقل.</p>}
      <footer className="rp-foot">
        <div className="rp-signs"><div>إعداد — الإدارة المالية</div><div>مراجعة — المدير المالي</div><div>اعتماد — الإدارة التنفيذية</div></div>
        <p>وثيقة داخلية · <span className="num">{m.serial}</span></p>
      </footer>
    </article>
  );
}
