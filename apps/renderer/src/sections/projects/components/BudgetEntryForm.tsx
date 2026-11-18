/* نموذج شهر الموازنة (P-199..P-203): ٦ حقول يُدخلها المستخدم؛ الخمسة المحسوبة حيّة من /budget/preview
   — لا تُخترع محلياً. التعارض بين مصدرين يُحسم بقرار صريح، لا كتابة صامتة. */
import { useEffect, useState } from 'react';
import { api, type BudgetClaim, type BudgetConflict, type BudgetPreviewResponse, type BudgetRow } from '@/lib/api';
import { invalidate } from '@/data/queryClient';
import { Button, Field, FormGrid, Kpi, Modal, confirm, digits, fmt, int, parseNum, toast, useForm } from '@/ui';
import { cumTone, monthTone } from '../logic/budget';
import { BUDGET_ROOTS } from '../hooks';

const tone = (t: string) => (t === 'ok' ? 'ok' : t === 'red' ? 'warn' : undefined);

export function BudgetEntryForm({ project, existing, projectEditable, onClose }: {
  project: string; existing: BudgetRow | null; projectEditable?: boolean; onClose: () => void;
}) {
  const form = useForm({
    project, month: existing ? existing.month.slice(0, 7) : '',
    docNo: existing?.docNo ?? '', issuedOn: existing?.issuedOn ?? '',
    actualMonth: existing?.actualMonth ?? (null as number | null),
    plannedMonth: existing?.plannedMonth ?? (0 as number | null),
    notes: existing?.notes ?? '',
  }, {
    project: (v) => (String(v).trim() ? null : 'اسم المشروع مطلوب'),
    month: { required: true, message: 'اختر الشهر أولاً' },
  });
  const [claims, setClaims] = useState<BudgetClaim[]>(existing?.claims ?? []);
  const [preview, setPreview] = useState<BudgetPreviewResponse | null>(null);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [attaching, setAttaching] = useState(false);
  const v = form.values;
  const monthIso = v.month ? `${v.month}-01` : '';

  useEffect(() => {
    if (!monthIso || !v.project.trim()) { setPreview(null); return; }
    const t = setTimeout(() => {
      api.budgetPreview({ project: v.project, month: monthIso, actualMonth: Number(v.actualMonth) || 0, plannedMonth: Number(v.plannedMonth) || 0 })
        .then((r) => { setPreview(r); setPreviewErr(null); })
        .catch((e: unknown) => setPreviewErr(String((e as Error)?.message ?? e)));
    }, 300);
    return () => clearTimeout(t);
  }, [v.project, monthIso, v.actualMonth, v.plannedMonth]);

  async function attach() {
    if (!window.egco?.pickFile) { toast('إرفاق الملفات متاح داخل التطبيق فقط.', { kind: 'error' }); return; }
    setAttaching(true);
    try {
      const picked = await window.egco.pickFile();
      if (picked) setAttachment((await api.budgetUploadAttachment(picked.path)).attachment);
    } catch (e) { toast(`تعذّر إرفاق الملف: ${(e as Error)?.message ?? e}`, { kind: 'error' }); }
    finally { setAttaching(false); }
  }

  async function save(force: boolean): Promise<boolean> {
    const body = {
      project: v.project.trim(), month: monthIso,
      actualMonth: Number(v.actualMonth) || 0, plannedMonth: Number(v.plannedMonth) || 0,
      claims, docNo: v.docNo, issuedOn: v.issuedOn || null, notes: v.notes,
      forceConflict: force, attachment: attachment ?? undefined,
    };
    const res = existing ? await api.budgetUpdate(existing.id, body) : await api.budgetCreate(body);
    if (!res.saved) {
      const c = res.conflict as BudgetConflict;
      const label = c.field === 'cumActual' ? 'التراكمي الفعلي' : 'نسبة التأخر';
      const f = (x: number) => (c.field === 'delayPct' ? `${digits((x * 100).toFixed(1))}٪` : `${fmt(x)} ر.س`);
      const ok = await confirm({
        title: 'تعارض بين مصدرين', confirmLabel: 'اعتماد القيمة الجديدة', cancelLabel: 'إلغاء — الاحتفاظ بالحالية',
        body: `القيمة الحالية لـ«${label}» ${f(c.current)} (من ${c.currentSource === 'file' ? 'ملف' : 'إدخال يدوي'}) — القيمة الجديدة ${f(c.incoming)} (يدوي). أيّهما تعتمد؟`,
      });
      return ok ? save(true) : false;
    }
    await invalidate(BUDGET_ROOTS);
    toast(existing ? 'حُفظ الشهر' : 'أُضيف الشهر', { kind: 'ok' });
    return true;
  }

  const c = preview?.computed;
  const conflict = preview?.conflict;
  return (
    <Modal open onClose={onClose} size="lg" title={existing ? 'تعديل شهر' : 'إضافة شهر — إدخال يدوي'}
      dirty={form.dirty || claims !== (existing?.claims ?? claims) || !!attachment}
      actions={[{ label: 'إلغاء' }, { label: 'حفظ', kind: 'primary', onClick: async (close) => {
        if (!form.validate()) return;
        if (await save(false)) close(true);
      } }]}>
      <FormGrid>
        {projectEditable && <Field form={form} name="project" label="المشروع" required placeholder="اسم المشروع" />}
        <Field form={form} name="month" label="الشهر" type="month" required disabled={!!existing} />
        <Field form={form} name="docNo" label="رقم الوثيقة" placeholder="EGCO/…" dir="ltr" />
        <Field form={form} name="issuedOn" label="تاريخ الإصدار" type="date" />
        <Field form={form} name="actualMonth" label="الفعلي للشهر" type="money" />
        <Field form={form} name="plannedMonth" label="المخطط للشهر" type="money" />
      </FormGrid>

      <section className="sp-block">
        <h3 className="cap">المحسوب تلقائياً (من الخادم)</h3>
        {previewErr && <p className="sp-err">{previewErr}</p>}
        {!c ? <p className="cap">اختر الشهر لعرض الحساب الحيّ.</p> : (
          <div className="grid">
            <Kpi label="انحراف الشهر" value={c.deviationMonth} tone={tone(monthTone(c.deviationMonth))} />
            <Kpi label="تراكمي الفعلي" value={c.cumActual} />
            <Kpi label="تراكمي المخطط" value={c.cumPlanned} />
            <Kpi label="نسبة الإنجاز ٪" money={false} value={c.completionPct == null ? null : Math.round(c.completionPct * 1000) / 10}
              tone={tone(cumTone(c.delayPct))} />
          </div>
        )}
        {preview && preview.chainImpact.length > 0 &&
          <p className="cap">سيتغيّر {int(preview.chainImpact.length)} شهراً تالياً بعد الحفظ (إعادة بناء سلسلة التراكمي).</p>}
        {conflict && <p className="sp-err"><b>تعارض بيانات:</b> القيمة الحالية {fmt(conflict.current)} (من {conflict.currentSource === 'file' ? 'ملف' : 'إدخال يدوي'})
          — الجديدة {fmt(conflict.incoming)}. ستُسأل أيّهما تعتمد عند الحفظ.</p>}
      </section>

      <section className="sp-block">
        <div className="ih"><h3 className="cap">المستخلصات</h3>
          <Button size="sm" onClick={() => setClaims((x) => [...x, { no: '', amount: 0, date: null }])}>إضافة مستخلص</Button></div>
        {claims.length === 0 ? <p className="cap">لا مستخلصات لهذا الشهر.</p> : (
          <div className="tbl-wrap"><table className="sp-claims">
            <thead><tr><th>الرقم</th><th className="n">المبلغ (ر.س)</th><th>التاريخ</th><th /></tr></thead>
            <tbody>{claims.map((cl, i) => {
              const up = (p: Partial<BudgetClaim>) => setClaims((x) => x.map((y, j) => (j === i ? { ...y, ...p } : y)));
              return (
                <tr key={i}>
                  <td><input aria-label="رقم المستخلص" value={cl.no} onChange={(e) => up({ no: e.target.value })} /></td>
                  <td><input aria-label="مبلغ المستخلص" dir="ltr" inputMode="decimal" defaultValue={cl.amount ? String(cl.amount) : ''}
                    onBlur={(e) => up({ amount: parseNum(e.target.value) ?? 0 })} /></td>
                  <td><input aria-label="تاريخ المستخلص" type="date" value={cl.date ?? ''} onChange={(e) => up({ date: e.target.value || null })} /></td>
                  <td><Button size="sm" kind="ghost" onClick={() => setClaims((x) => x.filter((_, j) => j !== i))}>حذف</Button></td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </section>

      <FormGrid><Field form={form} name="notes" label="الملاحظات" type="textarea" rows={3} full placeholder="نصّ حرّ — نِسَب ومقارنة الشهر السابق…" /></FormGrid>
      <div className="sp-attach">
        <Button size="sm" icon="file" disabled={attaching} onClick={() => void attach()}>
          {attaching ? 'جارٍ الإرفاق…' : 'إرفاق الملف الأصلي (PDF/Excel)'}</Button>
        {attachment && <span className="cap">نُسخت نسخة مرجعية: {attachment}</span>}
        {existing?.hasAttachment && !attachment && <span className="cap">يوجد مرفق سابق لهذا الشهر</span>}
      </div>
    </Modal>
  );
}
