/* م-٥٠ · مشاريع الطرف بمبالغ — بطاقة في كشف المورد/المقاول: كل مشروع مُسند بمبلغه (قيمة التعاقد/الإسناد
 * على هذا المشروع)، والمنفّذ والمدفوع والمفتوح من الخادم. إضافة/تعديل/إزالة إسناد. لا تحديث تفاؤلي للمبالغ. */
import { useEffect, useMemo, useState } from 'react';
import { useGo } from '@/app/routes';
import { Button, EmptyState, Field, FormGrid, Island, Money, Skeleton, int, toast, useForm, usePrefs } from '@/ui';
import { invalidate } from '@/data';
import { partiesApi } from '../api';
import { usePartyProjectMutations, usePartyProjects } from '../hooks';
import { assignedTotal, executedPct, partyProjectBody, validatePartyProject } from '../logic/partyProjects';
import { ErrBox, PModal, errMsg } from './shared';
import type { PartyProject, PartyType } from '../types';

export function PartyProjectsCard({ kind, id, known, fallbackProjects, span = 12, i }: {
  kind: PartyType; id: string; known: string[];
  /** لائحة المشاريع من استجابة الكشف — تُعرض بلا مبالغ إن لم يتوفر مسار م-٥٠ بعد في الخادم. */
  fallbackProjects: string[]; span?: 4 | 6 | 8 | 12; i?: number;
}) {
  usePrefs();
  const go = useGo();
  const q = usePartyProjects(kind, id);
  const { remove } = usePartyProjectMutations(kind, id);
  const [edit, setEdit] = useState<{ row?: PartyProject } | null>(null);
  const rows = q.data?.projects ?? null;
  const tot = useMemo(() => (rows ? assignedTotal(rows) : null), [rows]);
  const total = q.data?.totalAmount ?? tot?.total ?? null;

  const doRemove = async (p: PartyProject) => {
    try {
      await remove.mutateAsync(p.project);
      toast(`أُزيل الإسناد من «${p.project}»`, { kind: 'info', undo: () => {
        void restoreAssignment(kind, id, p).catch((e) => toast(errMsg(e), { kind: 'error' }));
      } });
    } catch (e) { toast(errMsg(e), { kind: 'error' }); }
  };

  const unavailable = q.isError && (q.error as { status?: number })?.status === 404;
  return (
    <Island span={span} i={i} title="المشاريع"
      actions={!unavailable && <Button size="sm" onClick={() => setEdit({})}>+ إسناد مشروع</Button>}>
      {unavailable ? (
        // قبل أن يوفّر الخادم مسار م-٥٠: اللائحة بلا مبالغ — لا رقم مخترع.
        fallbackProjects.length ? (
          <div className="pt-plinks">{fallbackProjects.map((p) => (
            <button key={p} type="button" className="chip" onClick={() => go('projects.project', { project: p })}>{p}</button>))}
            <p className="disclose">مبالغ الإسناد لكل مشروع تظهر هنا بعد تحديث الخدمة المحلية.</p>
          </div>
        ) : <p className="disclose">لا مشاريع مرتبطة.</p>
      ) : q.isError ? <EmptyState icon="alert" title="تعذّر تحميل المشاريع" body={errMsg(q.error)} cta="إعادة المحاولة" onCta={() => q.refetch()} />
        : !rows ? <Skeleton rows={3} />
        : rows.length === 0 ? <EmptyState icon="grid" title="لا مشاريع مُسندة" body="أسند هذا الطرف لمشروع بمبلغ التعاقد عليه." cta="+ إسناد مشروع" onCta={() => setEdit({})} />
        : (
          <>
            <div className="tbl-wrap"><table>
              <thead><tr><th>المشروع</th><th className="n">المبلغ المُسند</th><th className="n">المنفّذ</th><th className="n">المدفوع</th><th className="n">المفتوح</th><th></th></tr></thead>
              <tbody>{rows.map((p) => {
                const pct = executedPct(p);
                return (
                  <tr key={p.project}>
                    <td><button type="button" className="pt-link" onClick={() => go('projects.project', { project: p.project })}>{p.project}</button>
                      {p.notes && <span className="pt-sub">{p.notes}</span>}</td>
                    <td className="n">{p.amount == null ? <span className="dash" title="مرتبط بلا مبلغ">—</span> : <Money value={p.amount} />}</td>
                    <td className="n"><Money value={p.executed} />{pct != null && <span className="pt-sub">{int(pct)}٪ من المُسند</span>}</td>
                    <td className="n"><Money value={p.paid} /></td>
                    <td className="n"><Money value={p.open} /></td>
                    <td><span className="pt-acts">
                      <button type="button" className="btn sm pt-ib" aria-label="تعديل المبلغ" title="تعديل المبلغ" onClick={() => setEdit({ row: p })}>✎</button>
                      <button type="button" className="btn sm pt-ib" aria-label="إزالة الإسناد" title="إزالة الإسناد" onClick={() => void doRemove(p)}>🗑</button>
                    </span></td>
                  </tr>);
              })}</tbody>
              <tfoot><tr><td>إجمالي المُسند ({int(rows.length)})</td><td className="n"><Money value={total} /></td><td colSpan={4} /></tr></tfoot>
            </table></div>
            {tot && tot.withoutAmount > 0 && <p className="disclose">{int(tot.withoutAmount)} مشروعاً بلا مبلغ — خارج الإجمالي.</p>}
          </>
        )}
      <PartyProjectModal kind={kind} id={id} known={known} existing={(rows ?? []).map((r) => r.project)}
        state={edit} onClose={() => setEdit(null)} />
    </Island>
  );
}

/** إعادة إسناد بعد «تراجع» — نفس المبلغ والملاحظات (خارج React: نداء مباشر ثم إبطال). */
async function restoreAssignment(kind: PartyType, id: string, p: PartyProject) {
  await partiesApi.putPartyProject(kind, id, p.project, { amount: p.amount, notes: p.notes });
  await invalidate([kind === 'supplier' ? 'supplier' : 'contractor', 'projects', 'project']);
  toast('استُرجع الإسناد', { kind: 'ok' });
}

function PartyProjectModal({ kind, id, known, existing, state, onClose }: {
  kind: PartyType; id: string; known: string[]; existing: string[];
  state: { row?: PartyProject } | null; onClose: () => void;
}) {
  const isEdit = !!state?.row;
  const init = useMemo(() => ({ project: state?.row?.project ?? '', amount: state?.row?.amount ?? null as number | null, notes: state?.row?.notes ?? '' }), [state]);
  const form = useForm(init);
  useEffect(() => { if (state) form.reset(init); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, init]);
  const { save } = usePartyProjectMutations(kind, id);
  const [err, setErr] = useState<string | null>(null);
  const choices = known.filter((p) => isEdit || !existing.includes(p));
  return (
    <PModal open={!!state} onClose={onClose} title={isEdit ? `تعديل الإسناد — ${init.project}` : 'إسناد مشروع'} size="sm" dirty={form.dirty}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', disabled: save.isPending, onClick: async (close) => {
        setErr(null);
        const bad = validatePartyProject(form.values, existing, known, isEdit);
        if (bad) { form.setError(bad.field, bad.msg); return; }
        try { await save.mutateAsync({ project: form.values.project.trim(), body: partyProjectBody(form.values) }); close(true); }
        catch (e) { setErr(errMsg(e)); }
      } }]}>
      <ErrBox msg={err} />
      <FormGrid>
        {isEdit ? <Field form={form} name="project" label="المشروع" readOnly full />
          : <Field form={form} name="project" label="المشروع" type="select" required full options={choices}
              help="المشاريع المعروفة — لإنشاء مشروع جديد استعمل «المشاريع»" />}
        <Field form={form} name="amount" label="المبلغ المُسند" type="money" min={0} help="قيمة التعاقد/الإسناد على هذا المشروع — اتركه فارغاً إن لم يُتفق" />
        <Field form={form} name="notes" label="ملاحظات" full />
      </FormGrid>
    </PModal>
  );
}
