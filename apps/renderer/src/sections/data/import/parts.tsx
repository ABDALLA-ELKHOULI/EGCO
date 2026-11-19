/**
 * أجزاء شاشة الرفع — كلها تقرأ استجابة الخادم عبر summarize() ولا تعرف نوع الملف.
 */
import { useState, type ReactNode } from 'react';
import { Button, Field, FormGrid, Money, Num, Pill, dateTxt, useForm, usePrefs } from '@/ui';
import { BUNDLE_STATUS, ND_LEDGER, ND_SCOPE, PARTY_KIND_LABEL, QUEUE_CHIP, type Tone } from '../lib/labels';
import { guessProjectFromHeader, summarize } from '../lib/preview';
import { errMsg } from '../api';
import type { BalanceWarning, BundleAccount, ImportPayload, NearDuplicate, NewPartyForm, QueueItem } from '../types';
import { BudgetPlanSummary, NeedsProjectPanel, isBudgetPlan } from './BudgetPlanCard';

export const toneToPill = (t: Tone) => (t === 'bad' ? 'danger' : t === 'info' ? 'neutral' : t);

export function Callout({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <div className={'callout ' + (tone === 'info' ? '' : tone)} role={tone === 'bad' ? 'alert' : undefined}>{children}</div>;
}

/**
 * لافتة نتيجة الدفعة — الأخضر فقط حين حُفظ الجميع؛ وإلا كل ملف لم يُحفظ مع سببه
 * (P-280). كان المستخدم يقرأ «تم» بينما لم يُحفظ صف واحد.
 */
export function BatchSummaryBanner({ total, saved, duplicates = 0, failures }: {
  total: number; saved: number; duplicates?: number; failures: { name: string; reason: string }[];
}) {
  usePrefs();
  const dup = duplicates > 0 ? <> و<Num value={duplicates} int /> مكرر (مرفوع سابقاً)</> : null;
  if (total > 0 && failures.length === 0) {
    return <Callout tone="ok">حُفظ <Num value={saved} int /> من <Num value={total} int /> ملفات{dup} — اكتمل الرفع بنجاح.</Callout>;
  }
  return (
    <Callout tone="bad">
      <b>حُفظ <Num value={saved} int /> من <Num value={total} int /> ملفات{dup} — <Num value={failures.length} int /> لم يُحفظ:</b>
      <ul>{failures.map((f, i) => <li key={f.name + i}>{f.name} — {f.reason}</li>)}</ul>
    </Callout>
  );
}

/**
 * «تكرار محتمل» (P-277) — معلوماتي بحت: لا يمنع الحفظ ولا يدمج؛ يضع الحركتين جنباً
 * إلى جنب. القيد الفريد يمنع المطابق حرفياً فقط؛ سند أُعيد إصداره برقم آخر يمرّ.
 */
export function NearDuplicateNotice({ items, title }: { items: NearDuplicate[]; title?: string }) {
  usePrefs();
  const pairs = items.filter((n) => n.kind === 'near_duplicate');
  const more = items.find((n) => n.kind === 'near_duplicate_more');
  if (!pairs.length && !more) return null;
  return (
    <Callout tone="warn">
      <b>{title ?? 'تكرار محتمل'} — <Num value={pairs.length} int /> حالة تحتاج نظرك</b>
      <div className="cap">حركتان بنفس التاريخ والمبلغ ويختلف سندهما — تأكّد أنهما ليستا حركة واحدة. لم يُحذف ولم يُدمج شيء.</div>
      <ul>
        {pairs.map((n, i) => (
          <li key={i}>
            <b>{dateTxt(n.date ?? '')} · <Money value={Math.abs(n.amount ?? 0)} /> · {ND_LEDGER[n.ledger ?? ''] ?? 'حركة'}
              {n.scope ? ` · ${ND_SCOPE[n.scope] ?? ''}` : ''}</b>
            <div className="cap">سند {n.a?.doc || '—'} — «{n.a?.description || '—'}»</div>
            <div className="cap">سند {n.b?.doc || '—'} — «{n.b?.description || '—'}»</div>
          </li>
        ))}
      </ul>
      {more && <div className="cap">{more.message}</div>}
    </Callout>
  );
}

/** «فرق بين رصيد الملف ورصيد سجل الحركات» (P-275) — بارز ومنفصل، رسالة الخادم كما هي. */
export function BalanceMismatchPanel({ warnings }: { warnings: BalanceWarning[] }) {
  if (!warnings.length) return null;
  return (
    <Callout tone="bad">
      <b><Num value={warnings.length} int /> فرق بين رصيد الملف ورصيد سجل الحركات — يستحق مراجعتك</b>
      <ul>{warnings.map((w, i) => <li key={(w.account ?? '') + i}>{w.message}</li>)}</ul>
    </Callout>
  );
}

/** ملخّص عام لأي استجابة: الطرف، بوابة الرصيد، الأعداد، التوزيع بالنوع. */
export function PayloadSummary({ payload }: { payload: ImportPayload }) {
  usePrefs();
  const s = summarize(payload);
  if (!s) return null;
  return (
    <>
      {(s.partyName || s.account) && (
        <p className="sumline">
          <b>{s.partyName ?? '—'}</b>
          {s.account && <span className="cap"> · حساب <span className="num ltr">{s.account}</span></span>}
          {s.isNewParty && <> <Pill tone="warn">حساب جديد</Pill></>}
        </p>
      )}
      {s.counts.length > 0 && (
        <p className="cap sumline">
          {s.counts.map((c, i) => <span key={c.label}>{i > 0 && ' · '}{c.label}: <Num value={c.value} int /></span>)}
        </p>
      )}
      {s.balance && (
        <p className="cap sumline">
          رصيد الكشف: <Money value={s.balance.statement} /> · المحسوب: <Money value={s.balance.computed} />
          {' — '}
          {s.balance.reconciled
            ? <Pill tone="ok">مطابق</Pill>
            : <><Pill tone="danger">غير مطابق</Pill> الفرق <Money value={s.balance.difference} /></>}
        </p>
      )}
      {s.byKind.length > 0 && (
        <div className="kinds">
          {s.byKind.map((k) => (
            <div key={k.kind}>
              <div className="cap">{PARTY_KIND_LABEL[k.kind] ?? k.kind}</div>
              <div className="kn"><Num value={k.total} int /></div>
              {(k.fresh > 0 || k.known > 0) && (
                <div className="cap">
                  {k.fresh > 0 && <span className="t-danger"><Num value={k.fresh} int /> جديد</span>}
                  {k.fresh > 0 && k.known > 0 && ' · '}
                  {k.known > 0 && <><Num value={k.known} int /> معروف مسبقاً</>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {s.parseIssues > 0 && (
        <p className="cap sumline"><Num value={s.parseIssues} int /> ملاحظة قراءة (صفوف بلا رقم حساب أو أوراق غير متعرَّف عليها) — لن تمنع الحفظ.</p>
      )}
    </>
  );
}

/**
 * ملخّص ملف بحالات لكل حساب (الكشف المجمّع، v0.13.1). الأعداد أولاً — جواب «هل قُرئ
 * الملف؟» — ثم ما لن يُحفظ ولماذا: حساب محجوز لا يختفي بصمت بين مئات المحفوظة. القائمة
 * الكاملة لا تُعرض؛ مئات الصفوف تُغرق القليلة التي تحتاج انتباهاً.
 */
export function BundleSummary({ data, saved, onClassify }: {
  data: ImportPayload; saved: boolean; onClassify?: (account: string, name: string) => void;
}) {
  usePrefs();
  const [open, setOpen] = useState(false);
  const c = data.counts ?? {};
  const ok = saved ? (typeof data.saved === 'number' ? data.saved : (c.saved ?? 0)) : (c.reconciled ?? 0);
  const problems: BundleAccount[] = data.problems ?? [];
  const kinds = (data.kinds && typeof data.kinds === 'object') ? Object.entries(data.kinds as Record<string, number>) : [];
  const others = Object.entries(c).filter(([k, n]) => n > 0 && k !== 'reconciled' && k !== 'saved');
  return (
    <div className="sumline">
      <p className="sumline"><b>ملف بحسابات متعددة</b> — <Num value={data.accounts ?? 0} int /> حساباً
        {data.pages ? <> في <Num value={data.pages} int /> صفحة</> : null}
        {kinds.length > 0 && <span className="cap"> · {kinds.map(([k, n], i) => <span key={k}>{i > 0 && ' · '}{PARTY_KIND_LABEL[k] ?? (k === 'unknown' ? 'غير مصنّف' : k)} <Num value={n} int /></span>)}</span>}
      </p>
      <div className="filters">
        <Pill tone="ok">{saved ? 'حُفظ' : 'يطابق'}: <Num value={ok} int /></Pill>
        {others.map(([k, n]) => {
          const st = BUNDLE_STATUS[k] ?? { text: k, tone: 'neutral' as const };
          return <Pill key={k} tone={toneToPill(st.tone)}>{st.text.split(' — ')[0]}: <Num value={n} int /></Pill>;
        })}
      </div>
      {problems.length > 0 && (
        <details className="errs" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary>الحسابات التي {saved ? 'لم تُحفظ' : 'لن تُحفظ'} (<Num value={problems.length} int />)</summary>
          {open && (
            <div className="tbl-wrap">
              <table>
                <thead><tr><th>الحساب</th><th>الاسم</th><th>السبب</th><th className="n">الفرق</th><th /></tr></thead>
                <tbody>
                  {problems.map((p) => {
                    const st = BUNDLE_STATUS[p.status] ?? { text: p.message || p.status, tone: 'neutral' as const };
                    return (
                      <tr key={p.account}>
                        <td className="num ltr">{p.account}</td>
                        <td>{p.name || '—'}</td>
                        <td><Pill tone={toneToPill(st.tone)}>{st.text}</Pill>{p.message && st.text !== p.message && <div className="cap">{p.message}</div>}</td>
                        <td className="n">{p.difference != null ? <Money value={p.difference} /> : <span className="dash">—</span>}</td>
                        <td>{p.status === 'needs_classification' && onClassify && <Button size="sm" onClick={() => onClassify(p.account, p.name ?? '')}>تصنيف…</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

/**
 * «حساب جديد لم نره من قبل» (P-274) — كشف مطابق لرصيده لكن حسابه غير موجود. اسم
 * المورد من الترويسة، المشروع تخمين قابل للتعديل، ومدة السداد إلزامية لأنها تحدّد
 * تواريخ الاستحقاق ومنها كل حساب التأخر.
 */
export function NewPartyPanel({ fileName, data, onConfirm, onDecline }: {
  fileName: string; data: ImportPayload;
  onConfirm: (f: NewPartyForm) => Promise<void>; onDecline: () => void;
}) {
  usePrefs();
  const suggested = data.suggestedName ?? data.statementName ?? '';
  const form = useForm<NewPartyForm>(
    { name: suggested, project: guessProjectFromHeader(suggested), term: '' },
    { name: { required: true, message: 'اسم المورد إلزامي' }, term: { required: true, message: 'مدة السداد إلزامية' } },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declined, setDeclined] = useState(false);

  if (declined) return <p className="cap">لم يُحفظ شيء — لم يُنشأ الحساب</p>;

  async function confirm() {
    if (!form.validate()) return;
    setSaving(true); setError(null);
    try {
      const v = form.values;
      await onConfirm({ name: v.name.trim(), project: v.project.trim(), term: v.term.trim() });
    } catch (e) { setError(errMsg(e)); setSaving(false); }
  }

  return (
    <Callout tone="warn">
      <b>حساب جديد لم نره من قبل: <span className="num ltr">{data.account || '—'}</span></b>
      <div className="cap">كشف «{fileName}» مطابق تماماً لرصيده لكن رقم الحساب غير موجود — لن يُحفظ شيء حتى تقرر إنشاء الحساب أو تجاهل الملف.</div>
      <p className="cap sumline">
        فواتير: <Num value={data.invoiceCount ?? 0} int /> · دفعات: <Num value={data.paymentCount ?? 0} int />
        {' '}· رصيد الكشف: <Money value={data.statementBalance ?? 0} /> · المحسوب: <Money value={data.computedBalance ?? 0} />
      </p>
      <FormGrid>
        <Field form={form} name="name" label="اسم المورد" help="من ترويسة الكشف — عدّله إن احتاج تنظيفاً" required />
        <Field form={form} name="project" label="المشروع" help="تخمين من الترويسة — تحقّق منه" />
        <Field form={form} name="term" label="مدة السداد" required placeholder="مثال: ٤٥ يوم · كاش · مستخلص"
          help="تحدّد تواريخ الاستحقاق، وتواريخ الاستحقاق تحدّد التأخر" full />
      </FormGrid>
      {error && <Callout tone="bad">{error}</Callout>}
      <div className="rowacts">
        <Button kind="primary" size="sm" disabled={saving} onClick={confirm}>{saving ? 'جارٍ الحفظ…' : 'إنشاء الحساب وحفظ الكشف'}</Button>
        <Button size="sm" disabled={saving} onClick={() => { setDeclined(true); onDecline(); }}>تجاهل هذا الملف</Button>
      </div>
    </Callout>
  );
}

/**
 * «احفظ رغم الفرق» — بعد حفظ كشف مجمّع: الحسابات التي لم تطابق إجماليها المطبوع
 * تُعرض بأسمائها وفروقها، ولا تُحفظ إلا بضغطتين صريحتين. تُحفظ هذه الحسابات وحدها.
 */
export function ForceAccountsPanel({ problems, onForce }: {
  problems: BundleAccount[]; onForce: (accounts: string[]) => Promise<void>;
}) {
  usePrefs();
  const rows = problems.filter((p) => p.status === 'not_reconciled');
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <Callout tone="warn">
      <b><Num value={rows.length} int /> حساب لم يُحفظ لأن رصيده المحسوب يختلف عن إجماليه المطبوع</b>
      <ul>
        {rows.map((p) => (
          <li key={p.account}>
            <span className="num ltr">{p.account}</span> — {p.name || 'بلا اسم'} · الفرق <Money value={p.difference ?? null} />
          </li>
        ))}
      </ul>
      {armed && <div className="cap">تأكيد: ستُحفظ حركات هذه الحسابات كما في الكشف رغم الفرق المذكور، ويُسجَّل الحساب «غير مطابق». بقية الملف لا تتأثر.</div>}
      {err && <Callout tone="bad">{err}</Callout>}
      <div className="rowacts">
        {!armed
          ? <Button size="sm" onClick={() => setArmed(true)}>احفظ رغم الفرق…</Button>
          : <>
            <Button kind="primary" size="sm" disabled={busy} onClick={async () => {
              setBusy(true); setErr(null);
              try { await onForce(rows.map((r) => r.account)); } catch (e) { setErr(errMsg(e)); setBusy(false); }
            }}>{busy ? 'جارٍ الحفظ…' : <>نعم، احفظ <Num value={rows.length} int /> حساب رغم الفرق</>}</Button>
            <Button size="sm" disabled={busy} onClick={() => setArmed(false)}>تراجع</Button>
          </>}
      </div>
    </Callout>
  );
}

/** بطاقة ملف واحد في المعاينة (P-269..279). */
export function FileCard({ item, i, aiEnabled, canRemove, onRemove, onRescue, onClassify, onConfirmNew, onDeclineNew,
  onConfirmProject, onForceAccounts }: {
  item: QueueItem; i: number; aiEnabled: boolean; canRemove: boolean;
  onRemove: () => void; onRescue: () => void;
  onClassify: (account: string, name: string) => void;
  onConfirmNew: (f: NewPartyForm) => Promise<void>; onDeclineNew: () => void;
  onConfirmProject?: () => Promise<void>; onForceAccounts?: (accounts: string[]) => Promise<void>;
}) {
  usePrefs();
  const { file, status, preview, saveResult, error } = item;
  const chip = QUEUE_CHIP[status];
  const shown = saveResult ?? preview;
  const label = (shown?.detected as string | undefined) ?? null;
  const unknown = preview?.needsClassification ?? [];
  return (
    <article className="fcard" style={{ '--i': i } as React.CSSProperties}>
      <header>
        <div>
          <b className="fname">{file.name}</b>
          {label && <div className="cap">{label}</div>}
        </div>
        <div className="fact">
          <Pill tone={toneToPill(chip.tone)}>{status === 'reading' || status === 'saving' ? <><span className="spin" aria-hidden="true" /> {chip.text}</> : chip.text}</Pill>
          {canRemove && <Button size="sm" onClick={onRemove} aria-label={`إزالة ${file.name} من القائمة`}>إزالة</Button>}
        </div>
      </header>

      {isBudgetPlan(preview)
        ? <>
          <BudgetPlanSummary data={preview} />
          {status === 'saved' && saveResult?.message && <Callout tone="ok">{String(saveResult.message)}</Callout>}
        </>
        : shown?.bundle
        ? <BundleSummary data={shown} saved={!!saveResult?.bundle} onClassify={status === 'saved' ? undefined : onClassify} />
        : shown && status !== 'unknown_supplier' && <PayloadSummary payload={shown} />}

      {unknown.length > 0 && status !== 'saved' && (
        <Callout tone="warn">
          <b><Num value={unknown.length} int /> حساب يحتاج تصنيفك قبل أن يُحفظ</b>
          <div className="cap">رقم الحساب لا يبدأ بـ٢١١ (مورد) ولا ٢١٢ (مقاول) ولا ٢١٦ (ضمان) — لن يُحفظ حتى تختار تصنيفه؛ بقية الملف يُحفظ بلا انتظاره.</div>
          <ul className="cls">
            {unknown.map((u, k) => (
              <li key={u.account + k}>
                <div><b>{u.name || 'بلا اسم'}</b><div className="cap">حساب <span className="num ltr">{u.account}</span>{u.project ? ` · ${u.project}` : ''}</div></div>
                <Button size="sm" onClick={() => onClassify(u.account, u.name)}>تصنيف…</Button>
              </li>
            ))}
          </ul>
        </Callout>
      )}

      <NearDuplicateNotice items={shown?.nearDuplicates ?? []} />

      {status === 'unsupported' && (
        <Callout tone="bad">صيغة هذا الملف غير مدعومة في هذا الإصدار من التطبيق — لن يُحفظ. تأكد من نوع الملف، أو حدِّث التطبيق إن كان يُفترض دعمه.</Callout>
      )}
      {status === 'read_error' && (
        <Callout tone="bad">
          خطأ قراءة: {error}
          {aiEnabled && <div className="rowacts"><Button size="sm" onClick={onRescue}>محاولة القراءة بالذكاء الاصطناعي</Button></div>}
        </Callout>
      )}
      {status === 'save_error' && <Callout tone="bad">تعذّر الحفظ: {error}</Callout>}
      {status === 'excluded' && <p className="cap sumline">{error ?? 'مُستبعد من الحفظ (لم يتطابق أو حدث خطأ قراءة)'}</p>}
      {status === 'unknown_supplier' && saveResult && (
        <NewPartyPanel fileName={file.name} data={saveResult} onConfirm={onConfirmNew} onDecline={onDeclineNew} />
      )}
      {status === 'saved' && saveResult?.autoCreatedParty && (
        <Callout tone="warn">
          أُنشئ حساب «{saveResult.partyName ?? '—'}» (<span className="num ltr">{saveResult.partyAccount ?? '—'}</span>) تلقائياً من هذا الكشف.
          {saveResult.needsTerm ? ' مدة سداده غير محدّدة — يُنصح بتحديدها من شاشة الأطراف.' : ''}
        </Callout>
      )}
      {status === 'needs_project' && saveResult && onConfirmProject && (
        <NeedsProjectPanel data={saveResult} onConfirm={onConfirmProject} onDecline={onDeclineNew} />
      )}
      {status === 'saved' && saveResult?.bundle && onForceAccounts && (
        <ForceAccountsPanel problems={saveResult.problems ?? []} onForce={onForceAccounts} />
      )}
      {status === 'saved' && (saveResult?.forcedAccounts as string[] | undefined)?.length ? (
        <Callout tone="warn">حُفظ رغم الفرق: {(saveResult?.forcedAccounts as string[]).join('، ')}</Callout>
      ) : null}
      {status === 'saved' && <BalanceMismatchPanel warnings={saveResult?.reconcileWarnings ?? []} />}
    </article>
  );
}

