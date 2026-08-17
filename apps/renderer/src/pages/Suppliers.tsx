import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, apiBase, ApiError, DELAY_BUCKETS, type SupplierQuery } from '@/lib/api';
import { Th, type SortState } from '@/components/ColumnMenu';
import { ar, arDate, arRange, sar, STATUS } from '@/lib/format';
import { Card, EmptyState, ErrorState, Money, Pill, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { SupplierForm, type SupplierFormValues } from '@/components/SupplierForm';
import { AiBlock } from '@/components/Ai';
import { useAiEnabled } from '@/lib/useAi';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';

export function Suppliers() {
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [status, setStatus] = useState('');
  const [err, setErr] = useState<string | null>(null);

  // تصفية العمود وترتيبه — كلاهما يُرسل للخادم فيُطبَّق على المجموعة كاملةً،
  // فيبقى سطر الإجماليات واصفاً لما تراه بالضبط.
  const [account, setAccount] = useState('');
  const [delay, setDelay] = useState('');
  const [minOut, setMinOut] = useState('');
  const [maxOut, setMaxOut] = useState('');
  const [payFrom, setPayFrom] = useState('');
  const [payTo, setPayTo] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [delayRow, setDelayRow] = useState<any>(null);

  const query = useMemo<SupplierQuery>(() => ({
    q: q || account || undefined,
    project: project || undefined,
    status: status || undefined,
    delay: delay || undefined,
    min_outstanding: minOut ? Number(minOut) : undefined,
    max_outstanding: maxOut ? Number(maxOut) : undefined,
    date_from: payFrom || undefined,
    date_to: payTo || undefined,
    sort: sort?.key,
    dir: sort?.dir,
  }), [q, account, project, status, delay, minOut, maxOut, payFrom, payTo, sort]);

  const clearAll = () => {
    setQ(''); setAccount(''); setProject(''); setStatus(''); setDelay('');
    setMinOut(''); setMaxOut(''); setPayFrom(''); setPayTo('');
  };

  // رابط تصدير Excel — بنفس معايير query بالضبط، حتى يصدَّر ما تراه الشاشة فعلاً
  // لا الدفتر كاملاً (نفس فكرة apiBase() في CashFlow.tsx/Report.tsx).
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== '') params.set(k, String(v));
    }
    const s = params.toString();
    return apiBase() + '/api/v1/suppliers/export.xlsx' + (s ? `?${s}` : '');
  }, [query]);

  const chips = [
    q && { k: 'q', label: `بحث: ${q}`, clear: () => setQ('') },
    account && { k: 'acct', label: `الحساب: ${account}`, clear: () => setAccount('') },
    project && { k: 'p', label: `المشروع: ${project}`, clear: () => setProject('') },
    status && { k: 's', label: `الحالة: ${STATUS[status]?.label ?? status}`, clear: () => setStatus('') },
    delay && { k: 'd', label: `التأخر: ${DELAY_BUCKETS.find((b) => b.value === delay)?.label}`,
               clear: () => setDelay('') },
    (minOut || maxOut) && { k: 'o', label: `المديونية: ${minOut || '—'} … ${maxOut || '—'}`,
                            clear: () => { setMinOut(''); setMaxOut(''); } },
    (payFrom || payTo) && { k: 'dt', label: `الفترة: ${payFrom || '—'} … ${payTo || '—'}`,
                            clear: () => { setPayFrom(''); setPayTo(''); } },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [deleteRow, setDeleteRow] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [prioritiesOpen, setPrioritiesOpen] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const { enabled: aiEnabled, loading: aiLoading } = useAiEnabled();

  // نفس نص شريط «تصفية نشطة» أعلى الجدول، مُعاد استخدامه على الورقة المطبوعة —
  // حتى لا يفقد قرارٌ يُبنى على النسخة الورقية سياق التصفية التي أنتجتها.
  const filterLine = chips.length > 0 ? chips.map((c) => c.label).join(' · ') : null;

  // «آخر دفعة» أُسقط من النسخة المطبوعة فقط: تسعة أعمدة (بما فيها التاريخ الفرعي
  // تحت الحساب) لا تسع عرض A4 حتى أفقياً دون انضغاط يصعب قراءته على الورق —
  // والتأخر/المديونية أهم لقرار السداد من تاريخ آخر دفعة.
  const printColumns: PrintableColumn[] = [
    { key: 'name', label: 'المورد', render: (r) => r.name },
    { key: 'account', label: 'رقم الحساب', ltr: true, render: (r) => r.account },
    { key: 'project', label: 'المشروع', render: (r) =>
      r.projects && r.projects.length > 0 ? r.projects.join('، ') : (r.project || '—') },
    { key: 'status', label: 'الحالة', render: (r) => {
      const st = STATUS[r.status] ?? { label: r.status, cls: '' };
      return <span className={`pill ${st.cls}`}>{st.label}</span>;
    } },
    { key: 'outstanding', label: 'المديونية المفتوحة (ر.س)', ltr: true,
      render: (r) => r.outstanding > 0 ? sar(r.outstanding) : '—' },
    { key: 'delay', label: 'التأخر (ر.س)', ltr: true,
      render: (r) => r.delay?.days > 0 ? sar(r.delay.amount) : '—' },
  ];

  const seq = useRef(0);
  const reload = () => {
    const my = ++seq.current;
    api.suppliers(query).then((r) => {
      if (my !== seq.current) return; // استجابة متأخرة لطلب سابق — تُهمل
      setD(r); setErr(null);
    }).catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      api.suppliers(query).then((r) => {
        if (my !== seq.current) return;
        setD(r); setErr(null);
      }).catch((e) => { if (my === seq.current) setErr(e.message); });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  const projects = useMemo(() => d?.projects ?? [], [d]);
  const filtering = chips.length > 0;

  if (err) return <ErrorState message={`تعذّر التحميل: ${err}`} onRetry={reload} />;

  // نسخة PDF قابلة للطباعة — نفس d.rows/d.totals المصفّاة التي يعرضها الجدول
  // بالضبط، فلا يمكن أن تكون الورقة المطبوعة أوسع أو أضيق مما تراه الشاشة.
  if (showPrint && d) {
    return (
      <PrintableList
        docTitle="قائمة الموردين"
        fileStamp="قائمة-الموردين"
        scopeLine="مرتبون بالمتأخر ثم بالمديونية المفتوحة"
        filterLine={filterLine}
        countLabel={`${ar(d.count)} نتيجة · مفتوح ${sar(d.totals.outstanding)} ر.س`}
        columns={printColumns}
        rows={d.rows}
        totalsCells={[
          `الإجمالي (${ar(d.count)})`, '', '', '',
          sar(d.totals.outstanding),
          sar(d.totals.delayed),
        ]}
        footNote={filterLine ? `متأخر ضمن التصفية: ${sar(d.totals.delayed)} ر.س` : undefined}
        onBack={() => setShowPrint(false)}
      />
    );
  }

  async function handleAdd(values: SupplierFormValues) {
    setBusy(true); setFormErr(null);
    try {
      await api.createSupplier(values);
      setAddOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: SupplierFormValues) {
    if (!editRow) return;
    setBusy(true); setFormErr(null);
    try {
      await api.updateSupplier(editRow.account,
        { name: values.name, project: values.project, term: values.term, projects: values.projects });
      setEditRow(null);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>الموردون</h1>
          <p>مرتبون بالمتأخر ثم بالمديونية المفتوحة</p>
        </div>
        {!aiLoading && aiEnabled && (
          <button className="btn sm" onClick={() => setPrioritiesOpen((v) => !v)}>
            {prioritiesOpen ? 'إخفاء أولويات السداد' : 'أولويات السداد'}
          </button>
        )}
        <button className="btn primary" onClick={() => { setFormErr(null); setAddOpen(true); }}>
          إضافة مورد
        </button>
      </div>

      {prioritiesOpen && <PrioritiesPanel />}

      <div className="toolbar">
        <input placeholder="بحث بالاسم أو رقم الحساب…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
        {/* المشروع والحالة انتقلا إلى قائمتي عمودَيهما — إبقاؤهما هنا أيضاً يعني
            مكانين لنفس الفلتر يختلفان بصمت. */}
        {d && <span className="count">{ar(d.count)} نتيجة · مفتوح {sar(d.totals.outstanding)} ر.س</span>}
        {/* يُصدِّر بالضبط ما تُصفّيه الشاشة الآن — لا الدفتر كاملاً. */}
        <a className="btn sm" href={exportUrl} download>تصدير Excel</a>
        <button className="btn sm" disabled={!d} onClick={() => setShowPrint(true)}>PDF</button>
      </div>

      <Card>
        {/* التصفية تُعلن عن نفسها. رقمٌ يصف مجموعة مصفّاة دون أن يقول ذلك أخطر من
            ألا يظهر أصلاً — الجدول يبدو كاملاً وهو ليس كذلك. */}
        {chips.length > 0 && (
          <div className="filter-bar">
            <b>{ar(chips.length)} تصفية نشطة</b>
            {chips.map((c) => (
              <span key={c.k} className="filter-chip">
                {c.label}
                <button onClick={c.clear} aria-label={`إزالة ${c.label}`}>×</button>
              </span>
            ))}
            <button className="btn sm" onClick={clearAll}>مسح الكل</button>
            {d && <span className="muted grow" style={{ textAlign: 'left' }}>
              متأخر ضمن التصفية: {sar(d.totals.delayed)} ر.س
            </span>}
          </div>
        )}
        {!d ? <State>جارٍ التحميل…</State>
          : d.rows.length === 0 ? (
            // فرّق بين «لا يوجد موردون بعد» و«البحث لم يطابق» — الرسالة الواحدة
            // كانت تُوهم أن القائمة فارغة بينما المشكلة أن الملف لم يُرفع أصلاً.
            filtering ? (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم يطابق البحث أو التصفية أي مورد."
                ctaLabel="مسح التصفية" onCta={clearAll} />
            ) : (
              <EmptyState kind="no-data" title="لم تُرفع قائمة الموردين بعد"
                body="ارفع ملف «مدة مديونية الموردين» بصيغة Excel لتظهر هنا."
                ctaLabel="رفع الملف" onCta={() => nav('/import')} />
            )
          ) : (
          // عمود التأخر رفع الأعمدة إلى تسعة، فانضغط اسم المورد إلى كلمة في كل سطر.
          // الجدول ينزلق أفقياً بدل أن تُسحق أعمدته — والاسم يحجز عرضاً أدنى لأنه
          // أول ما تبحث عنه العين في كل صف.
          <div className="table-scroll wide">
          <table>
            <thead>
              <tr>
                <Th label="المورد" className="party" sortKey="name" sort={sort} onSort={setSort}
                    ascLabel="أ ← ي" descLabel="ي ← أ" active={Boolean(q)}
                    filter={{ kind: 'text', value: q, onChange: setQ, placeholder: 'اسم المورد…' }} />
                <Th label="رقم الحساب" sortKey="account" sort={sort} onSort={setSort}
                    active={Boolean(account)}
                    filter={{ kind: 'text', value: account, onChange: setAccount, placeholder: '211…' }} />
                <Th label="المشروع" sortKey="project" sort={sort} onSort={setSort}
                    active={Boolean(project)}
                    filter={{ kind: 'select', value: project, onChange: setProject,
                              allLabel: 'كل المشاريع',
                              options: projects.map((p: string) => ({ value: p, label: p })) }} />
                <Th label="الحالة" sortKey="status" sort={sort} onSort={setSort}
                    ascLabel="الأحرج أولاً" descLabel="الأهدأ أولاً" active={Boolean(status)}
                    filter={{ kind: 'select', value: status, onChange: setStatus,
                              allLabel: 'كل الحالات',
                              options: Object.keys(STATUS).map((k) => ({ value: k, label: STATUS[k].label })) }} />
                <Th label="المديونية المفتوحة" className="ltr" sortKey="outstanding"
                    sort={sort} onSort={setSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً"
                    active={Boolean(minOut || maxOut)}
                    filter={{ kind: 'range', min: minOut, max: maxOut,
                              onMin: setMinOut, onMax: setMaxOut, unit: 'ر.س' }} />
                <Th label="التأخر" className="ltr" sortKey="delay" sort={sort} onSort={setSort}
                    ascLabel="الأقل تأخراً" descLabel="الأكثر تأخراً" active={Boolean(delay)}
                    filter={{ kind: 'select', value: delay, onChange: setDelay,
                              allLabel: 'كل الشرائح',
                              options: DELAY_BUCKETS.map((b) => ({ value: b.value, label: b.label, hint: b.hint })) }} />
                <Th label="آخر دفعة" className="ltr" sortKey="lastPaymentDate"
                    sort={sort} onSort={setSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً"
                    active={Boolean(payFrom || payTo)}
                    filter={{ kind: 'dateRange', from: payFrom, to: payTo,
                              onFrom: setPayFrom, onTo: setPayTo }} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {d.rows.map((r: any) => {
                const st = STATUS[r.status] ?? { label: r.status, cls: '' };
                const rowCls = r.overdue > 0 ? 'row-overdue'
                  : r.status === 'due_soon' ? 'row-due-soon'
                  : r.status === 'clear' && r.outstanding === 0 && r.invoiceCount > 0 ? 'row-settled' : '';
                return (
                  <tr key={r.account} className={rowCls}>
                    <td className="party">
                      <Link to={`/suppliers/${r.account}`}>{r.name}</Link>
                      {r.firstActivity && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                          التغطية: {arRange(r.firstActivity, r.lastActivity)}
                        </div>
                      )}
                    </td>
                    <td className="num muted">
                      {r.account}
                      {/* المدة سطرٌ تحت الحساب لا عموداً: تسعة أعمدة كانت تدفع أعمدة
                          المال خارج الشاشة، وهي أول ما تُقرأ. */}
                      <div style={{ fontSize: 11, marginTop: 2 }}>
                        {r.termKind === 'days' ? `${ar(r.termDays)} يوم` : r.term}
                        {/* مورد أُنشئ تلقائياً من كشف — مدة سداده لم تُحدَّد بعد، فلا
                            تأخّر يُحسب له حتى يُملأ هذا الحقل صراحةً. */}
                        {r.termKind === 'unset' && (
                          <div><Pill kind="warn">مدة السداد غير محدّدة</Pill></div>
                        )}
                      </div>
                    </td>
                    <td className="muted">
                      {/* أكثر من مشروع؟ الأول ثم «+ن» بدل نص طويل يكسر ارتفاع الصف —
                          العنوان الكامل (title) يفصح عن الباقي عند التحويم. */}
                      {r.projects && r.projects.length > 0 ? (
                        r.projects.length === 1 ? r.projects[0] : (
                          <span title={r.projects.join('، ')}>
                            {r.projects[0]} <span className="chip">+{ar(r.projects.length - 1)}</span>
                          </span>
                        )
                      ) : (r.project || <span className="muted">—</span>)}
                    </td>
                    <td><Pill kind={st.cls}>{st.label}</Pill></td>
                    <td className="ltr">
                      {r.outstanding > 0
                        ? <Money v={r.outstanding} cls={r.overdue > 0 ? 'red' : ''} />
                        : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.delay?.days > 0 ? (
                        // الرقم المعروض أسوأ تأخر عنده — والنقر يفتح توزيع المبلغ على
                        // الشرائح، لأن مورداً واحداً نادراً ما يكون تأخره رقماً واحداً.
                        <button className="link-btn" onClick={() => setDelayRow(r)}
                                title="عرض توزيع المتأخر على الشرائح">
                          <Money v={r.delay.amount} cls="red" />
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {DELAY_BUCKETS.find((b) => b.value === r.delay.bucket)?.label}
                            {' · '}{ar(r.delay.days)} يوم
                          </div>
                        </button>
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      {r.lastPayment ? (
                        <>
                          <Money v={r.lastPayment.amount} />
                          <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {arDate(r.lastPayment.date)}
                          </div>
                        </>
                      ) : <span className="muted">لا دفعات</span>}
                    </td>
                    <td className="ltr">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn sm"
                                onClick={() => { setFormErr(null); setEditRow(r); }} aria-label="تعديل" title="تعديل">✎</button>
                        <button className="btn sm"
                                onClick={() => setDeleteRow(r)} aria-label="حذف" title="حذف">🗑</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      {addOpen && (
        <Modal title="إضافة مورد" onClose={() => setAddOpen(false)}>
          <SupplierForm onSubmit={handleAdd} busy={busy} error={formErr} knownProjects={projects} />
        </Modal>
      )}

      {editRow && (
        <Modal title="تعديل مورد" onClose={() => setEditRow(null)}>
          <SupplierForm
            initial={{ account: editRow.account, name: editRow.name, project: editRow.project,
                      term: editRow.term, projects: editRow.projects }}
            onSubmit={handleEdit}
            busy={busy}
            error={formErr}
            knownProjects={projects}
          />
        </Modal>
      )}

      {delayRow && (
        <Modal title={`توزيع المتأخر — ${delayRow.name}`} onClose={() => setDelayRow(null)}>
          <p className="muted">
            المبلغ غير المسدد موزَّعاً بعمر التأخر عن تاريخ الاستحقاق. أقصى تأخر:{' '}
            <b>{ar(delayRow.delay.days)}</b> يوماً.
          </p>
          <table>
            <thead><tr><th>الشريحة</th><th className="ltr">المبلغ</th></tr></thead>
            <tbody>
              {DELAY_BUCKETS.filter((b) => b.value !== 'none').map((b) => {
                const v = delayRow.delay.byBucket?.[b.value] ?? 0;
                return (
                  <tr key={b.value} style={v > 0 ? undefined : { opacity: .45 }}>
                    <td>{b.label} <span className="muted">{b.hint}</span></td>
                    <td className="ltr">{v > 0 ? <Money v={v} cls="red" /> : <span className="muted">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr><td>الإجمالي المتأخر</td>
                  <td className="ltr"><Money v={delayRow.delay.amount} cls="red" /></td></tr>
            </tfoot>
          </table>
          <div className="row-gap-sm" style={{ marginTop: 'var(--space-lg16)' }}>
            <Link className="btn" to={`/suppliers/${delayRow.account}`}>فتح كشف المورد</Link>
          </div>
        </Modal>
      )}

      {deleteRow && (
        <DeleteSupplierModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => { setDeleteRow(null); reload(); }}
        />
      )}
    </>
  );
}

type PriorityItem = { partyKind: string; key: string; name: string; amount: number; score: number; reason: string };

/**
 * أولويات السداد — الترتيب والدرجة محسوبان بقواعد حتمية في الخادم، والنص فقط من المساعد.
 * ملاحظة عقد: لا يوجد حقل صريح في aiPriorities().items يفيد بأن بنداً «ضمن الميزانية» —
 * الحقول المتاحة هي partyKind/key/name/amount/score/reason فقط. لذا نُطبّق فحصاً محلياً
 * تراكمياً (تراكم amount حسب الترتيب حتى الميزانية المدخلة) بدل الاعتماد على علم من الخادم،
 * ونعرضه كتقدير وليس كحقيقة من الخادم.
 */
function PrioritiesPanel() {
  const [budget, setBudget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ items: PriorityItem[]; narrative: string } | null>(null);

  async function run() {
    setBusy(true); setError(null);
    try {
      const b = budget.trim() ? Number(budget) : undefined;
      const r = await api.aiPriorities(b);
      setData(r);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { run(); /* عرض أولي بلا ميزانية */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const budgetNum = budget.trim() ? Number(budget) : null;
  let running = 0;

  return (
    <Card title="أولويات السداد" sub="الترتيب محسوب بقواعد حتمية، والشرح فقط من المساعد" >
      <div className="card-body flow">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <label style={{ fontSize: 13, color: 'var(--muted)' }}>
            ميزانية متاحة
            <input type="number" value={budget} onChange={(e) => setBudget(e.target.value)}
                   style={{ marginInlineStart: 8, width: 160 }} dir="ltr" placeholder="اختياري" />
          </label>
          <button className="btn primary" onClick={run} disabled={busy}>
            {busy ? 'جارٍ الحساب…' : 'تحديث'}
          </button>
        </div>

        <AiBlock busy={busy} error={error}>
          {data && (
            data.items.length === 0 ? (
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>لا بنود مرشّحة حالياً.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>#</th><th>الاسم</th><th></th><th className="ltr">المبلغ</th>
                        <th>السبب</th>{budgetNum != null && <th>ضمن الميزانية</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((it, i) => {
                        const before = running;
                        running += it.amount || 0;
                        const fits = budgetNum != null ? before + (it.amount || 0) <= budgetNum : null;
                        return (
                          <tr key={it.partyKind + it.key + i}>
                            <td className="num">{ar(i + 1)}</td>
                            <td>{it.name}</td>
                            <td><span className={'pill party ' + it.partyKind}>
                              {it.partyKind === 'contractor' ? 'مقاول' : 'مورد'}
                            </span></td>
                            <td className="ltr"><Money v={it.amount} /></td>
                            <td className="muted">{it.reason}</td>
                            {budgetNum != null && (
                              <td>{fits && <Pill kind="ok">ضمن الميزانية</Pill>}</td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p style={{ margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' }}>{data.narrative}</p>
                {budgetNum != null && (
                  <p className="muted" style={{ fontSize: 11, margin: 0 }}>
                    «ضمن الميزانية» تقدير محلي تراكمي بترتيب القائمة — لا يوجد حقل من الخادم يفيد بذلك صراحة.
                  </p>
                )}
              </div>
            )
          )}
        </AiBlock>
      </div>
    </Card>
  );
}

function DeleteSupplierModal({ row, onClose, onDeleted }:
  { row: any; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [typed, setTyped] = useState('');

  async function tryDelete(force: boolean) {
    setBusy(true); setError(null);
    try {
      await api.deleteSupplier(row.account, force);
      onDeleted();
    } catch (e) {
      if (e instanceof ApiError && !force) {
        setNeedForce(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="حذف مورد" onClose={onClose}>
      <p>هل تريد حذف المورد «{row.name}» (حساب {row.account})؟</p>
      {error && <div className="callout bad">{error}</div>}

      {!needForce ? (
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>إلغاء</button>
          <button className="btn danger" disabled={busy} onClick={() => tryDelete(false)}>
            {busy ? 'جارٍ الحذف…' : 'حذف'}
          </button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div className="callout bad">
            لهذا المورد فواتير أو دفعات مرتبطة. للمتابعة، اكتب رقم الحساب «{row.account}» أدناه لتأكيد الحذف النهائي.
          </div>
          <input
            style={{ marginTop: 10, width: '100%' }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={row.account}
          />
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>إلغاء</button>
            <button className="btn danger" disabled={busy || typed !== row.account}
                    onClick={() => tryDelete(true)}>
              {busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
