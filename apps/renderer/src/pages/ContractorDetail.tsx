import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type ContractorClaim, type ContractorClaimBody,
  type ContractorDetailResponse, type ContractorEntry, type ContractorEntryBody,
  type ContractorGuarantee, type ContractorGuaranteeBody, type GuaranteeDueStatus,
} from '@/lib/api';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, Pill, State } from '@/components/ui';
import { ExplainDot } from '@/components/Explain';
import { Modal } from '@/components/Modal';
import { ContractorForm, type ContractorFormValues } from '@/components/ContractorForm';
import { balanceView } from '@/pages/Contractors';
import { RemindModal } from '@/components/RemindModal';
import { useAiEnabled } from '@/lib/useAi';
import { ApiError } from '@/lib/api';

/** أنواع الحركات في دفتر المقاول */
const KIND: Record<string, { label: string; cls: string }> = {
  claim:     { label: 'مستخلص',  cls: 'gold' },
  payment:   { label: 'دفعة',    cls: 'ok' },
  retention: { label: 'تأمين',   cls: 'warn' },
  deduction: { label: 'خصم',     cls: 'red' },
  invoice:   { label: 'فاتورة',  cls: '' },
  opening:   { label: 'افتتاحي', cls: '' },
  other:     { label: 'أخرى',    cls: '' },
};

const DUE_STATUS: Record<GuaranteeDueStatus, { label: string; cls: string }> = {
  due:       { label: 'مستحق الصرف', cls: 'red' },
  upcoming:  { label: 'يقترب',       cls: 'gold' },
  scheduled: { label: 'مجدول',       cls: '' },
  released:  { label: 'صُرف',        cls: 'ok' },
};


export function ContractorDetail() {
  const { code } = useParams();
  const [d, setD] = useState<ContractorDetailResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState('');

  const [editOpen, setEditOpen] = useState(false);
  const [entryModal, setEntryModal] = useState<{ entry?: ContractorEntry; draft?: Partial<ContractorEntryBody> } | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<ContractorEntry | null>(null);
  const [claimModal, setClaimModal] = useState<{ claim?: ContractorClaim } | null>(null);
  const [deleteClaim, setDeleteClaim] = useState<ContractorClaim | null>(null);
  const [guaranteeModal, setGuaranteeModal] = useState<{ guarantee?: ContractorGuarantee } | null>(null);
  const [deleteGuarantee, setDeleteGuarantee] = useState<ContractorGuarantee | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [remindOpen, setRemindOpen] = useState(false);
  const [parseTextOpen, setParseTextOpen] = useState(false);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  const seq = useRef(0);
  const reload = () => {
    if (!code) return;
    const my = ++seq.current;
    setErr(null);
    api.contractor(code)
      .then((r) => { if (my === seq.current) setD(r); })
      .catch((e) => { if (my === seq.current) setErr(e.message); });
  };
  useEffect(() => {
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  const projects = useMemo(() => (d?.perProject ?? []).map((p) => p.project), [d]);

  const entries = useMemo(() => {
    if (!d) return [];
    return projectFilter ? d.entries.filter((e) => e.project === projectFilter) : d.entries;
  }, [d, projectFilter]);

  // المستخلصات من دفتر الحساب لا من جدول الوثائق — the ledger carries the claim
  // credits even before any مستخلص document is registered; summing the (initially
  // empty) claims table showed a misleading 0.00 next to a 2.5M ledger.
  const duesTotal = d?.duesTotal ?? 0;
  const paidTotal = d?.paidTotal ?? 0;
  const retentionHeld = useMemo(
    () => (d?.guarantees ?? []).filter((g) => !g.releasedOn).reduce((s, g) => s + (g.amount || 0), 0), [d]);

  if (err) return <ErrorState message={err} onRetry={reload} />;
  if (!d || !code) return <State>جارٍ التحميل…</State>;

  const v = balanceView(d.balance);

  async function run(fn: () => Promise<unknown>, close: () => void) {
    setBusy(true); setFormErr(null);
    try {
      await fn();
      close();
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function changeEntryProject(entry: ContractorEntry, project: string) {
    try {
      await api.updateContractorEntry(code!, entry.id, { project: project || undefined });
      reload();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{d.name}</h1>
          <p>
            رمز <span className="num">{d.code}</span>
            {d.phone && <> · <span className="num">{d.phone}</span></>}
            {d.defaultRetentionRate != null && <> · ضمان {ar(d.defaultRetentionRate)}٪</>}
            {d.defaultGuaranteeDays != null && <> · مدة الضمان {ar(d.defaultGuaranteeDays)} يوماً</>}
          </p>
          {d.notes && <p className="muted" style={{ fontSize: 12 }}>{d.notes}</p>}
        </div>
        <button className="btn sm" onClick={() => { setFormErr(null); setEditOpen(true); }}>تعديل</button>
        <button className="btn sm primary" onClick={() => { setFormErr(null); setEntryModal({}); }}>إضافة حركة</button>
        {!aiLoading && aiEnabled && (
          <>
            <button className="btn sm" onClick={() => setRemindOpen(true)}>صياغة مطالبة</button>
            <button className="btn sm" onClick={() => setParseTextOpen(true)}>قيد من نص</button>
          </>
        )}
        <Link to="/contractors"><button className="btn sm">رجوع</button></Link>
      </div>

      <div className="kpi-row">
        <Kpi label={`الرصيد (${v.label})`} value={sar(d.balance)} unit="ر.س" tone={v.cls}
             alert={d.balance < 0}
             explain={<ExplainDot metric="contractorBalance" values={{ duesTotal, paidTotal, balance: d.balance }} />} />
        <Kpi label="إجمالي المستخلصات" value={sar(duesTotal)} unit="ر.س" />
        <Kpi label="إجمالي المدفوع" value={sar(paidTotal)} unit="ر.س" tone="ok" />
        <Kpi label="الضمان المحتجز" value={sar(retentionHeld)} unit="ر.س"
             explain={<ExplainDot metric="retentionHeld" values={{ retentionHeld }} />} />
      </div>
      {/* تفصيل جانب المدين بالكامل — أي مبلغ لا يظهر في بند هو مبلغ يبدو مفقوداً.
          المجموع أدناه يساوي «إجمالي المدين» بالضبط، فيمكن للمستخدم تدقيقه بنفسه. */}
      <div className="muted" style={{ fontSize: 11, margin: '-12px 0 18px', lineHeight: 1.9 }}>
        <div>
          جانب المدين ={' '}
          <b>{sar(paidTotal)}</b> مدفوعات
          {(d.deductionsTotal ?? 0) !== 0 && <> + <b>{sar(d.deductionsTotal!)}</b> خصومات</>}
          {(d.retentionTotal ?? 0) !== 0 && <> + <b>{sar(d.retentionTotal!)}</b> تأمينات</>}
          {(d.otherDebits ?? 0) !== 0 && <> + <b>{sar(d.otherDebits!)}</b> فواتير محمّلة ورصيد افتتاحي</>}
          {d.debitTotal != null && <> = <b>{sar(d.debitTotal)}</b> ر.س</>}
        </div>
        <div>
          الرصيد = إجمالي المدين − إجمالي الدائن (المستخلصات) — لذا لا يساوي المدفوع ناقص المستخلصات بالضرورة
        </div>
      </div>

      {d.perProject.length > 0 && (
        <div className="project-cards">
          {d.perProject.map((p) => {
            const pv = balanceView(p.balance);
            const active = projectFilter === p.project;
            return (
              <button
                key={p.project}
                className={'project-card' + (active ? ' active' : '')}
                onClick={() => setProjectFilter(active ? '' : p.project)}
                title={active ? 'إلغاء التصفية' : 'تصفية الدفتر على هذا المشروع'}
              >
                <div className="pc-name">{p.project}</div>
                <div className={'pc-balance num ' + pv.cls}>{sar(p.balance)} ر.س <small>{pv.label}</small></div>
                <div className="pc-count muted">{ar(p.entryCount)} حركة</div>
              </button>
            );
          })}
        </div>
      )}

      <div className="stack">
        <Card
          title={projectFilter ? `الدفتر — ${projectFilter}` : 'دفتر الحساب'}
          sub="مدين = دفعنا له أو خُصم منه · دائن = استحق له"
          actions={projectFilter
            ? <button className="btn sm" onClick={() => setProjectFilter('')}>إظهار الكل</button>
            : undefined}
        >
          {entries.length === 0 ? (
            <EmptyState kind={projectFilter ? 'no-results' : 'no-data'}
              title={projectFilter ? 'لا حركات لهذا المشروع' : 'لا توجد حركات بعد'}
              body={projectFilter ? 'لم تُسجّل حركات على هذا المشروع.' : 'أضف حركة يدوية أو ارفع كشف حساب المقاول.'}
              ctaLabel={projectFilter ? 'إظهار الكل' : 'إضافة حركة'}
              onCta={() => projectFilter ? setProjectFilter('') : setEntryModal({})} />
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th><th>النوع</th><th>الوصف</th><th>المشروع</th>
                  <th className="ltr">مدين</th><th className="ltr">دائن</th>
                  <th>المستند</th><th></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const k = KIND[e.kind] ?? { label: e.kind || 'أخرى', cls: '' };
                  return (
                    <tr key={e.id}>
                      <td>{arDate(e.date)}</td>
                      <td><Pill kind={k.cls}>{k.label}</Pill>
                        {e.claimNo && <span className="muted num" style={{ fontSize: 11 }}> #{e.claimNo}</span>}
                      </td>
                      <td className="muted">{e.description}</td>
                      <td>
                        <select
                          value={e.project ?? ''}
                          onChange={(ev) => changeEntryProject(e, ev.target.value)}
                          style={{ fontSize: 12, padding: '4px 8px' }}
                        >
                          <option value="">—</option>
                          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
                          {e.project && !projects.includes(e.project) && (
                            <option value={e.project}>{e.project}</option>
                          )}
                        </select>
                      </td>
                      <td className="ltr">{e.debit ? <Money v={e.debit} /> : <span className="muted">—</span>}</td>
                      <td className="ltr">{e.credit ? <Money v={e.credit} /> : <span className="muted">—</span>}</td>
                      <td className="num muted">{e.doc ?? '—'}</td>
                      <td className="ltr">
                        {e.source === 'manual' ? (
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                            <button className="btn sm"
                                    onClick={() => { setFormErr(null); setEntryModal({ entry: e }); }} aria-label="تعديل" title="تعديل">✎</button>
                            <button className="btn sm"
                                    onClick={() => { setFormErr(null); setDeleteEntry(e); }} aria-label="حذف" title="حذف">🗑</button>
                          </div>
                        ) : (
                          <button className="btn sm" disabled aria-label="حذف — غير متاح"
                                  title="حركة من كشف الحساب — تُحذف من «الملفات المرفوعة»">🗑</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <Card
          title="المستخلصات"
          sub={`${ar(d.claims.length)} مستخلصاً`}
          actions={
            <button className="btn sm" onClick={() => { setFormErr(null); setClaimModal({}); }}>
              إضافة مستخلص
            </button>
          }
        >
          <p className="muted" style={{ fontSize: 11, padding: '0 20px', marginTop: -4 }}>
            مستخلصات كشف الحساب تظهر في الدفتر أعلاه — هذا سجل وثائق المستخلصات التفصيلية (اختياري)
          </p>
          {d.claims.length === 0 ? (
            <EmptyState kind="no-data" title="لا مستخلصات بعد"
              body="سجّل المستخلصات هنا لمتابعة الأعمال التراكمية والتأمينات."
              ctaLabel="إضافة مستخلص" onCta={() => { setFormErr(null); setClaimModal({}); }} />
          ) : (
            <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>الرقم</th><th>المشروع</th><th>التاريخ</th>
                  <th className="ltr">التراكمي</th><th className="ltr">السابق</th>
                  <th className="ltr">أعمال الفترة</th><th className="ltr">التأمين</th>
                  <th className="ltr">خصومات أخرى</th><th className="ltr">الصافي المستحق</th><th></th>
                </tr>
              </thead>
              <tbody>
                {d.claims.map((c) => (
                  <tr key={c.id}>
                    <td className="num">{ar(c.number)}</td>
                    <td className="muted">{c.project}</td>
                    <td>{arDate(c.date)}</td>
                    <td className="ltr"><Money v={c.grossCumulative} /></td>
                    <td className="ltr muted"><Money v={c.previousCumulative} /></td>
                    <td className="ltr"><Money v={c.grossCumulative - c.previousCumulative} /></td>
                    <td className="ltr">
                      <Money v={c.retentionAmount} />
                      {c.retentionRate != null && (
                        <span className="muted" style={{ fontSize: 11 }}> ({ar(c.retentionRate)}٪)</span>
                      )}
                    </td>
                    <td className="ltr">{c.otherDeductions ? <Money v={c.otherDeductions} /> : <span className="muted">—</span>}</td>
                    <td className="ltr"><Money v={c.netDue} cls="ok" /></td>
                    <td className="ltr">
                      {c.source === 'manual' ? (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button className="btn sm"
                                  onClick={() => { setFormErr(null); setClaimModal({ claim: c }); }} aria-label="تعديل" title="تعديل">✎</button>
                          <button className="btn sm"
                                  onClick={() => { setFormErr(null); setDeleteClaim(c); }} aria-label="حذف" title="حذف">🗑</button>
                        </div>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }} title="من كشف الحساب">كشف</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </Card>

        <Card
          title="الضمانات"
          sub="تأمين الأعمال — يُصرف بعد انتهاء مدة الضمان من تاريخ إنهاء الأعمال"
          actions={
            <button className="btn sm" onClick={() => { setFormErr(null); setGuaranteeModal({}); }}>
              إضافة ضمان
            </button>
          }
        >
          {d.guarantees.length === 0 ? (
            <EmptyState kind="no-data" title="لا ضمانات مسجّلة"
              body="سجّل الضمانات المحتجزة لكل مشروع لمتابعة مواعيد صرفها."
              ctaLabel="إضافة ضمان" onCta={() => { setFormErr(null); setGuaranteeModal({}); }} />
          ) : (
            <div className="guarantee-grid">
              {d.guarantees.map((g) => {
                const st = DUE_STATUS[g.dueStatus] ?? { label: g.dueStatus, cls: '' };
                return (
                  <div key={g.id} className="guarantee-card">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <b style={{ flex: 1, fontSize: 14 }}>{g.project}</b>
                      <Pill kind={st.cls}>{st.label}</Pill>
                    </div>
                    <div className="num" style={{ fontSize: 20, fontWeight: 700 }}>
                      {g.amount != null ? `${sar(g.amount)} ر.س` : '—'}
                      {g.retentionRate != null && (
                        <small className="muted" style={{ fontWeight: 400 }}> ({ar(g.retentionRate)}٪)</small>
                      )}
                    </div>
                    <div className="muted" style={{ fontSize: 12, lineHeight: 1.9 }}>
                      إنهاء الأعمال: {arDate(g.finishedOn)}<br />
                      مدة الضمان: {g.guaranteeDays != null ? `${ar(g.guaranteeDays)} يوماً` : '—'}<br />
                      استحقاق الصرف: {g.releaseDue
                        ? <b className={g.dueStatus === 'due' ? 'red' : g.dueStatus === 'upcoming' ? 'gold' : ''}>{arDate(g.releaseDue)}</b>
                        : '—'}<br />
                      {g.releasedOn && <>تاريخ الصرف: {arDate(g.releasedOn)}<br /></>}
                      {g.notes && <>{g.notes}</>}
                    </div>
                    <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                      <button className="btn sm"
                              onClick={() => { setFormErr(null); setGuaranteeModal({ guarantee: g }); }} aria-label="تعديل" title="تعديل">✎</button>
                      <button className="btn sm"
                              onClick={() => { setFormErr(null); setDeleteGuarantee(g); }} aria-label="حذف" title="حذف">🗑</button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {editOpen && (
        <Modal title="تعديل مقاول" onClose={() => setEditOpen(false)}>
          <ContractorForm
            initial={{
              code: d.code, name: d.name, phone: d.phone ?? '', notes: d.notes ?? '',
              defaultRetentionRate: d.defaultRetentionRate,
              defaultGuaranteeDays: d.defaultGuaranteeDays,
            }}
            codeLocked
            onSubmit={(values: ContractorFormValues) => {
              const { code: _c, ...rest } = values;
              run(() => api.updateContractor(code, rest), () => setEditOpen(false));
            }}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {entryModal && (
        <Modal title={entryModal.entry ? 'تعديل حركة' : 'إضافة حركة'} onClose={() => setEntryModal(null)}>
          <EntryForm
            initial={entryModal.entry}
            draft={entryModal.draft}
            projects={projects}
            busy={busy}
            error={formErr}
            onSubmit={(b) => run(
              () => entryModal.entry
                ? api.updateContractorEntry(code, entryModal.entry.id, b)
                : api.createContractorEntry(code, b),
              () => setEntryModal(null),
            )}
          />
        </Modal>
      )}

      {remindOpen && (
        <RemindModal partyKind="contractor" partyKey={d.code} onClose={() => setRemindOpen(false)} />
      )}

      {parseTextOpen && (
        <ParseTextModal
          onClose={() => setParseTextOpen(false)}
          onProposal={(proposal) => {
            setParseTextOpen(false);
            setFormErr(null);
            setEntryModal({
              draft: {
                date: proposal.date,
                debit: proposal.debit,
                credit: proposal.credit,
                description: proposal.description,
              },
            });
          }}
        />
      )}

      {deleteEntry && (
        <ConfirmDelete
          text={<>هل تريد حذف هذه الحركة بتاريخ {arDate(deleteEntry.date)}؟</>}
          busy={busy} error={formErr}
          onClose={() => setDeleteEntry(null)}
          onConfirm={() => run(() => api.deleteContractorEntry(code, deleteEntry.id), () => setDeleteEntry(null))}
        />
      )}

      {claimModal && (
        <Modal title={claimModal.claim ? 'تعديل مستخلص' : 'إضافة مستخلص'} maxWidth={560}
               onClose={() => setClaimModal(null)}>
          <ClaimForm
            initial={claimModal.claim}
            projects={projects}
            defaultRetentionRate={d.defaultRetentionRate}
            busy={busy}
            error={formErr}
            onSubmit={(b) => run(
              () => claimModal.claim
                ? api.updateContractorClaim(code, claimModal.claim.id, b)
                : api.createContractorClaim(code, b),
              () => setClaimModal(null),
            )}
          />
        </Modal>
      )}

      {deleteClaim && (
        <ConfirmDelete
          text={<>هل تريد حذف المستخلص رقم {ar(deleteClaim.number)} ({deleteClaim.project})؟</>}
          busy={busy} error={formErr}
          onClose={() => setDeleteClaim(null)}
          onConfirm={() => run(() => api.deleteContractorClaim(code, deleteClaim.id), () => setDeleteClaim(null))}
        />
      )}

      {guaranteeModal && (
        <Modal title={guaranteeModal.guarantee ? 'تعديل ضمان' : 'إضافة ضمان'} maxWidth={560}
               onClose={() => setGuaranteeModal(null)}>
          <GuaranteeForm
            initial={guaranteeModal.guarantee}
            projects={projects}
            busy={busy}
            error={formErr}
            onSubmit={(b) => run(
              () => guaranteeModal.guarantee
                ? api.updateContractorGuarantee(code, guaranteeModal.guarantee.id, b)
                : api.createContractorGuarantee(code, b),
              () => setGuaranteeModal(null),
            )}
          />
        </Modal>
      )}

      {deleteGuarantee && (
        <ConfirmDelete
          text={<>هل تريد حذف ضمان مشروع «{deleteGuarantee.project}»؟</>}
          busy={busy} error={formErr}
          onClose={() => setDeleteGuarantee(null)}
          onConfirm={() => run(() => api.deleteContractorGuarantee(code, deleteGuarantee.id), () => setDeleteGuarantee(null))}
        />
      )}
    </>
  );
}

/* ---------------- نماذج فرعية ---------------- */

/**
 * قيد من نص — يلصق المستخدم رسالة واتساب أو بريد، والمقترح يُعرض للمراجعة
 * فقط. الحفظ الفعلي يمر دائماً عبر نموذج «إضافة حركة» القائم — لا حفظ مباشر هنا.
 */
function ParseTextModal({ onClose, onProposal }: {
  onClose: () => void;
  onProposal: (proposal: { partyKind?: string; key?: string; date?: string; debit?: number;
    credit?: number; description?: string; claimNo?: string }) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try {
      const r = await api.aiParseText(text.trim());
      onProposal(r.proposal ?? {});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="قيد من نص" onClose={onClose} maxWidth={560}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="الصق رسالة واتساب أو بريد…"
          rows={8}
          disabled={busy}
        />
        {error && <div className="callout bad">{error}</div>}
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn primary" onClick={submit} disabled={busy || !text.trim()}>
            {busy ? 'جارٍ التحليل…' : 'تحليل واقتراح'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ConfirmDelete({ text, busy, error, onClose, onConfirm }: {
  text: React.ReactNode; busy: boolean; error: string | null;
  onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal title="تأكيد الحذف" onClose={onClose}>
      <p>{text}</p>
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn" onClick={onClose}>إلغاء</button>
        <button className="btn danger" disabled={busy} onClick={onConfirm}>
          {busy ? 'جارٍ الحذف…' : 'حذف'}
        </button>
      </div>
    </Modal>
  );
}

function ProjectField({ value, onChange, projects }: {
  value: string; onChange: (v: string) => void; projects: string[];
}) {
  const known = value === '' || projects.includes(value);
  const [free, setFree] = useState(!known);
  return (
    <label className="field">
      المشروع
      {!free ? (
        <select value={value} onChange={(e) => {
          if (e.target.value === '__free__') { setFree(true); onChange(''); }
          else onChange(e.target.value);
        }}>
          <option value="">—</option>
          {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          <option value="__free__">مشروع جديد…</option>
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)}
               placeholder="اسم المشروع" autoFocus />
      )}
    </label>
  );
}

function EntryForm({ initial, draft, projects, busy, error, onSubmit }: {
  initial?: ContractorEntry;
  /** تعبئة مبدئية من اقتراح الذكاء الاصطناعي (aiParseText) — نص فقط، تُراجع وتُعدَّل قبل الحفظ. */
  draft?: Partial<ContractorEntryBody>;
  projects: string[];
  busy: boolean;
  error: string | null;
  onSubmit: (b: ContractorEntryBody) => void;
}) {
  const src = initial ?? draft;
  const [date, setDate] = useState(src?.date ?? '');
  const [side, setSide] = useState<'debit' | 'credit'>(
    src && (src.credit ?? 0) > 0 ? 'credit' : 'debit');
  const [amount, setAmount] = useState(src ? String(src.debit || src.credit || '') : '');
  const [description, setDescription] = useState(src?.description ?? '');
  const [project, setProject] = useState(initial?.project ?? '');
  const [kind, setKind] = useState(initial?.kind ?? 'other');

  function submit(e: FormEvent) {
    e.preventDefault();
    const amt = Number(amount) || 0;
    const b: ContractorEntryBody = {
      date,
      debit: side === 'debit' ? amt : 0,
      credit: side === 'credit' ? amt : 0,
      description: description.trim(),
      kind,
    };
    if (project.trim()) b.project = project.trim();
    onSubmit(b);
  }

  return (
    <form onSubmit={submit} className="form-stack">
      <label className="field">
        التاريخ
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="field">
        نوع الحركة
        <select value={side} onChange={(e) => setSide(e.target.value as 'debit' | 'credit')}>
          <option value="debit">مدين (دفعة/خصم)</option>
          <option value="credit">دائن (مستخلص)</option>
        </select>
      </label>
      <label className="field">
        المبلغ
        <input type="number" step="0.01" min="0" value={amount}
               onChange={(e) => setAmount(e.target.value)} required dir="ltr" />
      </label>
      <label className="field">
        الوصف
        <input value={description} onChange={(e) => setDescription(e.target.value)} required />
      </label>
      <ProjectField value={project} onChange={setProject} projects={projects} />
      <label className="field">
        التصنيف
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {Object.entries(KIND).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
      </label>
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}

/**
 * نموذج مستخلص — حساب تأمين حيّ:
 * أعمال الفترة = التراكمي − السابق؛ التأمين يُقترح آلياً من النسبة لكنه يبقى قابلاً للتعديل،
 * والصافي كذلك — الرقم النهائي يعتمده المستخدم لا النموذج.
 */
function ClaimForm({ initial, projects, defaultRetentionRate, busy, error, onSubmit }: {
  initial?: ContractorClaim;
  projects: string[];
  defaultRetentionRate: number | null;
  busy: boolean;
  error: string | null;
  onSubmit: (b: ContractorClaimBody) => void;
}) {
  const [project, setProject] = useState(initial?.project ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [gross, setGross] = useState(initial ? String(initial.grossCumulative) : '');
  const [previous, setPrevious] = useState(initial ? String(initial.previousCumulative) : '0');
  const [rate, setRate] = useState(
    initial?.retentionRate != null ? String(initial.retentionRate)
      : defaultRetentionRate != null ? String(defaultRetentionRate) : '');
  const [retention, setRetention] = useState(initial ? String(initial.retentionAmount) : '');
  const [retentionTouched, setRetentionTouched] = useState(Boolean(initial));
  const [deductions, setDeductions] = useState(initial ? String(initial.otherDeductions) : '0');
  const [netDue, setNetDue] = useState(initial ? String(initial.netDue) : '');
  const [netTouched, setNetTouched] = useState(Boolean(initial));
  const [description, setDescription] = useState(initial?.description ?? '');

  const currentWork = (Number(gross) || 0) - (Number(previous) || 0);
  const suggestedRetention = rate !== '' ? currentWork * (Number(rate) / 100) : 0;
  const effRetention = retentionTouched ? (Number(retention) || 0) : suggestedRetention;
  const suggestedNet = currentWork - effRetention - (Number(deductions) || 0);
  const effNet = netTouched ? (Number(netDue) || 0) : suggestedNet;

  function submit(e: FormEvent) {
    e.preventDefault();
    const b: ContractorClaimBody = {
      project: project.trim(),
      number: number.trim(),
      date,
      grossCumulative: Number(gross) || 0,
      previousCumulative: Number(previous) || 0,
      retentionAmount: round2(effRetention),
      otherDeductions: Number(deductions) || 0,
      netDue: round2(effNet),
    };
    if (rate !== '') b.retentionRate = Number(rate);
    if (description.trim()) b.description = description.trim();
    onSubmit(b);
  }

  return (
    <form onSubmit={submit} className="form-stack">
      <div className="field-grid">
        <ProjectField value={project} onChange={setProject} projects={projects} />
        <label className="field">
          رقم المستخلص
          <input value={number} onChange={(e) => setNumber(e.target.value)} required />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          التاريخ
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        </label>
        <label className="field">
          نسبة التأمين ٪
          <input type="number" step="0.1" min="0" max="100" value={rate}
                 onChange={(e) => setRate(e.target.value)} dir="ltr" />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          إجمالي الأعمال التراكمي
          <input type="number" step="0.01" min="0" value={gross}
                 onChange={(e) => setGross(e.target.value)} required dir="ltr" />
        </label>
        <label className="field">
          التراكمي السابق
          <input type="number" step="0.01" min="0" value={previous}
                 onChange={(e) => setPrevious(e.target.value)} dir="ltr" />
        </label>
      </div>

      <div className="callout note" style={{ fontSize: 12 }}>
        أعمال الفترة: <b className="num">{sar(currentWork)}</b> ر.س
        {rate !== '' && !retentionTouched && (
          <> · تأمين مقترح ({ar(rate)}٪): <b className="num">{sar(suggestedRetention)}</b></>
        )}
      </div>

      <div className="field-grid three">
        <label className="field">
          مبلغ التأمين
          <input type="number" step="0.01" min="0"
                 value={retentionTouched ? retention : String(round2(suggestedRetention))}
                 onChange={(e) => { setRetentionTouched(true); setRetention(e.target.value); }}
                 dir="ltr" />
        </label>
        <label className="field">
          خصومات أخرى
          <input type="number" step="0.01" min="0" value={deductions}
                 onChange={(e) => setDeductions(e.target.value)} dir="ltr" />
        </label>
        <label className="field">
          الصافي المستحق
          <input type="number" step="0.01"
                 value={netTouched ? netDue : String(round2(suggestedNet))}
                 onChange={(e) => { setNetTouched(true); setNetDue(e.target.value); }}
                 dir="ltr" />
        </label>
      </div>

      <label className="field">
        الوصف
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn primary" type="submit" disabled={busy || !project.trim() || !number.trim()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}

function GuaranteeForm({ initial, projects, busy, error, onSubmit }: {
  initial?: ContractorGuarantee;
  projects: string[];
  busy: boolean;
  error: string | null;
  onSubmit: (b: ContractorGuaranteeBody) => void;
}) {
  const [project, setProject] = useState(initial?.project ?? '');
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '');
  const [rate, setRate] = useState(initial?.retentionRate != null ? String(initial.retentionRate) : '');
  const [finishedOn, setFinishedOn] = useState(initial?.finishedOn ?? '');
  const [days, setDays] = useState(initial?.guaranteeDays != null ? String(initial.guaranteeDays) : '');
  const [releaseDue, setReleaseDue] = useState(initial?.releaseDue ?? '');
  const [releasedOn, setReleasedOn] = useState(initial?.releasedOn ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  function submit(e: FormEvent) {
    e.preventDefault();
    const b: ContractorGuaranteeBody = { project: project.trim() };
    if (amount !== '') b.amount = Number(amount);
    if (rate !== '') b.retentionRate = Number(rate);
    if (finishedOn) b.finishedOn = finishedOn;
    if (days !== '') b.guaranteeDays = Number(days);
    if (releaseDue) b.releaseDue = releaseDue;
    if (releasedOn) b.releasedOn = releasedOn;
    if (notes.trim()) b.notes = notes.trim();
    onSubmit(b);
  }

  return (
    <form onSubmit={submit} className="form-stack">
      <ProjectField value={project} onChange={setProject} projects={projects} />
      <div className="field-grid">
        <label className="field">
          المبلغ
          <input type="number" step="0.01" min="0" value={amount}
                 onChange={(e) => setAmount(e.target.value)} dir="ltr" />
        </label>
        <label className="field">
          نسبة التأمين ٪
          <input type="number" step="0.1" min="0" max="100" value={rate}
                 onChange={(e) => setRate(e.target.value)} dir="ltr" />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          تاريخ إنهاء الأعمال
          <input type="date" value={finishedOn} onChange={(e) => setFinishedOn(e.target.value)} />
        </label>
        <label className="field">
          مدة الضمان (يوم)
          <input type="number" min="0" value={days} onChange={(e) => setDays(e.target.value)} dir="ltr" />
        </label>
      </div>
      <div className="field-grid">
        <label className="field">
          تاريخ استحقاق الصرف
          <input type="date" value={releaseDue} onChange={(e) => setReleaseDue(e.target.value)} />
        </label>
        <label className="field">
          تاريخ الصرف الفعلي
          <input type="date" value={releasedOn} onChange={(e) => setReleasedOn(e.target.value)} />
        </label>
      </div>
      <label className="field">
        ملاحظات
        <input value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <div className="callout bad">{error}</div>}
      <div className="modal-foot">
        <button className="btn primary" type="submit" disabled={busy || !project.trim()}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </div>
    </form>
  );
}

const round2 = (v: number) => Math.round(v * 100) / 100;
