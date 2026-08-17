import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api,
  type ContractorGuaranteeTracked, type GuaranteeAccountDetail, type GuaranteeAccountRow,
  type GuaranteeDueStatus, type GuaranteesResponse,
} from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';
import { Modal } from '@/components/Modal';

const DUE_STATUS: Record<GuaranteeDueStatus, { label: string; cls: string }> = {
  due:       { label: 'مستحق الصرف', cls: 'red' },
  upcoming:  { label: 'يقترب',       cls: 'gold' },
  scheduled: { label: 'مجدول',       cls: '' },
  released:  { label: 'صُرف',        cls: 'ok' },
};

function MatchPill({ matches, difference }: { matches: boolean | null; difference: number | null }) {
  if (matches == null) return <span className="muted">—</span>;
  if (matches) return <span className="pill ok">مطابق</span>;
  return <span className="pill red">فرق {sar(Math.abs(difference ?? 0))} ر.س</span>;
}

export function Guarantees() {
  const nav = useNavigate();
  const [d, setD] = useState<GuaranteesResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openAccount, setOpenAccount] = useState<GuaranteeAccountRow | null>(null);

  const reload = () => { setErr(null); api.guarantees().then(setD).catch((e) => setErr(e.message)); };
  useEffect(() => { reload(); }, []);

  if (err) return <ErrorState message={err} onRetry={reload} />;

  const hasData = !!d && (d.accounts.length > 0 || d.contractorGuarantees.length > 0);

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>ضمانات المقاولين</h1>
          <p>مطابقة كشوفات حساب الضمان (٢١٦) بضمانات المقاولين المتتبَّعة لكل مشروع</p>
        </div>
      </div>

      {d && (
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Kpi label="المحتجز حسب الكشوف" value={sar(d.totals.statementsHeld)} unit="ر.س" hero
               explain={<ExplainDot metric="guaranteeStatementsHeld"
                                    values={{ guaranteeStatementsHeld: d.totals.statementsHeld }} />} />
          <Kpi label="المحتجز حسب المستخلصات" value={sar(d.totals.trackedHeld)} unit="ر.س"
               explain={<ExplainDot metric="guaranteeTrackedHeld"
                                    values={{ guaranteeTrackedHeld: d.totals.trackedHeld }} />} />
          <Kpi label="مستحقة الصرف" value={ar(d.totals.dueSoonCount + d.totals.overdueCount)}
               tone={d.totals.overdueCount > 0 ? 'red' : undefined}
               alert={d.totals.overdueCount > 0}
               explain={<ExplainDot metric="guaranteeDueSoon"
                                    values={{ guaranteeDueSoonCount: d.totals.dueSoonCount,
                                             guaranteeOverdueCount: d.totals.overdueCount }} />} />
        </div>
      )}

      {!d ? <State>جارٍ التحميل…</State>
        : !hasData ? (
          <Card>
            <EmptyState kind="no-data" title="لم تُرفع ضمانات بعد"
              body="ارفع كشف حساب ضمان ٢١٦ (مثال: كشف ضمان اعمال مقاول) لتظهر أرصدة الضمانات ومطابقتها هنا."
              ctaLabel="رفع الملفات" onCta={() => nav('/import')} />
          </Card>
        ) : (
        <>
          <Card title="حسابات الضمان (كشوفات ٢١٦)" sub="اضغط على حساب لعرض حركاته">
            {d.accounts.length === 0 ? (
              <EmptyState kind="no-data" title="لا حسابات ضمان مستوردة"
                body="لم يُرفع أي كشف حساب ضمان بعد."
                ctaLabel="رفع الملفات" onCta={() => nav('/import')} />
            ) : (
              <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>الحساب</th><th>الاسم</th><th>المقاول المرتبط</th>
                    <th className="ltr">الرصيد (ر.س)</th><th>عدد الحركات</th>
                    <th>آخر حركة</th><th>المطابقة</th>
                  </tr>
                </thead>
                <tbody>
                  {d.accounts.map((a) => (
                    <tr key={a.account} className="row-clickable" onClick={() => setOpenAccount(a)}>
                      <td className="num muted">{a.account}</td>
                      <td>{a.name || <span className="muted">—</span>}</td>
                      <td>
                        {a.linkedContractorCode ? (
                          <Link to={`/contractors/${a.linkedContractorCode}`}
                                onClick={(e) => e.stopPropagation()}>
                            {a.linkedContractorName ?? a.linkedContractorCode}
                          </Link>
                        ) : <span className="muted">غير مرتبط</span>}
                      </td>
                      <td className="ltr"><Money v={a.balance} /></td>
                      <td className="num">{ar(a.entryCount)}</td>
                      <td>{a.lastActivity ? arDate(a.lastActivity) : <span className="muted">—</span>}</td>
                      <td><MatchPill matches={a.matches} difference={a.difference} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Card>

          <Card title="ضمانات المقاولين المتتبَّعة" sub="من دفتر كل مقاول ومشروعه">
            {d.contractorGuarantees.length === 0 ? (
              <EmptyState kind="no-data" title="لا ضمانات متتبَّعة"
                body="لم تُسجَّل ضمانات مقاولين بعد."
                ctaLabel="المقاولون" onCta={() => nav('/contractors')} />
            ) : (
              <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>المقاول</th><th>المشروع</th><th className="ltr">المبلغ (ر.س)</th>
                    <th>نسبة الاستقطاع</th><th>موعد الفك</th><th>الحالة</th>
                  </tr>
                </thead>
                <tbody>
                  {d.contractorGuarantees.map((g: ContractorGuaranteeTracked) => {
                    const st = DUE_STATUS[g.dueStatus] ?? { label: g.dueStatus, cls: '' };
                    return (
                      <tr key={g.id}>
                        <td><Link to={`/contractors/${g.contractorCode}`}>{g.contractorName}</Link></td>
                        <td>{g.project || <span className="muted">—</span>}</td>
                        <td className="ltr">{g.amount != null ? <Money v={g.amount} /> : <span className="muted">—</span>}</td>
                        <td className="num">{g.retentionRate != null ? `${Math.round(g.retentionRate * 100)}٪` : <span className="muted">—</span>}</td>
                        <td>{g.releaseDue ? arDate(g.releaseDue) : <span className="muted">—</span>}</td>
                        <td><span className={'pill ' + st.cls}>{st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            )}
          </Card>
        </>
      )}

      {openAccount && (
        <GuaranteeAccountModal account={openAccount} onClose={() => setOpenAccount(null)} />
      )}
    </>
  );
}

function GuaranteeAccountModal({ account, onClose }:
  { account: GuaranteeAccountRow; onClose: () => void }) {
  const [d, setD] = useState<GuaranteeAccountDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadDetail = () => {
    setErr(null);
    api.guaranteeAccount(account.account).then(setD).catch((e) => setErr(e.message));
  };
  useEffect(() => { loadDetail(); }, [account.account]);

  return (
    <Modal title={`حساب ضمان ${account.account} — ${account.name}`} onClose={onClose}>
      {err ? <ErrorState message={err} onRetry={loadDetail} />
        : !d ? <State>جارٍ التحميل…</State>
        : (
        <>
          <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 12 }}>
            <Kpi label="الرصيد" value={sar(d.account.balance)} unit="ر.س" />
            {/* «فرق كذا ر.س» بلا شرح رقمٌ لا يُتحقَّق منه: لا يقول أي رقمين قُورنا
                ولا أين يُبحث عن السبب. */}
            <Kpi label="المطابقة" value={d.account.matches == null ? '—' : (d.account.matches ? 'مطابق' : `فرق ${sar(Math.abs(d.account.difference ?? 0))} ر.س`)}
                 tone={d.account.matches === false ? 'red' : d.account.matches ? 'ok' : undefined}
                 explain={<ExplainDot metric="guaranteeAccountMatch"
                                      values={{ balance: d.account.balance,
                                                // المتتبَّع مشتقّ من الرصيد والفرق — الخادم
                                                // يرسل الاثنين، فلا حاجة لحقل ثالث.
                                                tracked: d.account.balance - (d.account.difference ?? 0) }} />} />
          </div>
          {d.entries.length === 0 ? (
            <EmptyState kind="no-data" title="لا حركات" body="لا توجد حركات مسجّلة على هذا الحساب." />
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th><th>المستند</th><th>الوصف</th>
                  <th className="ltr">مدين (ر.س)</th><th className="ltr">دائن (ر.س)</th>
                </tr>
              </thead>
              <tbody>
                {d.entries.map((e) => (
                  <tr key={e.id}>
                    <td>{arDate(e.date)}</td>
                    <td className="num muted">{e.doc || '—'}</td>
                    <td>{e.description || <span className="muted">—</span>}</td>
                    <td className="ltr">{e.debit ? <Money v={e.debit} /> : <span className="muted">—</span>}</td>
                    <td className="ltr">{e.credit ? <Money v={e.credit} /> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
