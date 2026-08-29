import { CSSProperties, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  api, apiBase, CONTRACTOR_STATUSES, ApiError,
  type ContractorQuery, type ContractorRow, type ContractorDetailResponse, type ContractorEntry,
} from '@/lib/api';
import { Th, type SortState } from '@/components/ColumnMenu';
import { ar, arDate, sar } from '@/lib/format';
import { Card, EmptyState, ErrorState, Kpi, Money, State } from '@/components/ui';
import { Modal } from '@/components/Modal';
import { ContractorForm, type ContractorFormValues } from '@/components/ContractorForm';
import { ExplainDot } from '@/components/Explain';
import { PrintableList, type PrintableColumn } from '@/components/PrintableList';
import { Carousel, loadStoredCarouselView } from '@/components/Carousel';
import { ExportMenu, StatementExportButton } from '@/components/ExportMenu';

/**
 * المقاولون — قاعدة الإشارة (متفق عليها مع المستخدم):
 *   الرصيد سالب  = مستحق «له» (نحن مدينون للمقاول) → أحمر
 *   الرصيد موجب  = مستحق «لنا» (المقاول مدين لنا)   → أخضر
 */
export function balanceView(balance: number): { cls: string; label: string } {
  if (balance < 0) return { cls: 'red', label: 'له' };
  if (balance > 0) return { cls: 'ok', label: 'لنا' };
  return { cls: 'muted', label: 'متوازن' };
}

/** لون شارة الحالة — القرارات السلبية (نزاع/قائمة سوداء) تُقرأ من لونها قبل نصّها،
 *  فمقاولٌ ممنوع لا يجوز أن يبدو كمقاولٍ نشط في مسح سريع للجدول. */
const STATUS_TONE: Record<string, string> = {
  active: 'ok', paused: 'warn', finished: '', closed: 'muted',
  disputed: 'warn', blacklisted: 'red',
};
const statusLabel = (v: string) =>
  CONTRACTOR_STATUSES.find((s) => s.value === v)?.label ?? v;

/** تسمية أنواع حركات دفتر المقاول — نسخة مختصرة عن KIND في ContractorDetail.tsx
 * (ملف مملوك لوكيل آخر، لا يُعدَّل هنا) لتسمية عمود «النوع» في كشف الحساب المطبوع فقط. */
const ENTRY_KIND_LABEL: Record<string, string> = {
  claim: 'مستخلص', payment: 'دفعة', retention: 'تأمين', deduction: 'خصم',
  invoice: 'فاتورة', opening: 'رصيد افتتاحي', other: 'أخرى',
};

//: قيم الاتجاه كما يرسلها الخادم (app/services/contractors_service.py: _direction_of) —
//: لا فلترة محلية بعد اليوم، فلا مجال لقيم مختلفة بين الواجهة والخادم.
const DIRECTIONS: { value: string; label: string }[] = [
  { value: 'owed_to_them', label: 'مستحق له' },
  { value: 'owed_to_us', label: 'مستحق لنا' },
  { value: 'balanced', label: 'متوازن' },
];

/** مفتاح localStorage للصفحة الفعالة في شريط «نظرة المقاولين» — نفس نمط تسمية
 * مفاتيح Sidebar.tsx وKPI_VIEW_STORAGE_KEY في CashFlow.tsx. */
const OVERVIEW_STORAGE_KEY = 'egco.contractors.overviewView';

export function Contractors() {
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [overview, setOverview] = useState<any>(null);
  const [overviewErr, setOverviewErr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [project, setProject] = useState('');
  const [direction, setDirection] = useState('');
  const [status, setStatus] = useState('');

  // تصفية العمود وترتيبه — كلاهما يُرسل للخادم فيُطبَّق على المجموعة كاملةً،
  // فيبقى سطر الإجماليات واصفاً لما تراه بالضبط (نفس نمط Suppliers.tsx).
  const [code, setCode] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  // ترقيم الصفحات — على الصفوف بعد أن يُطبِّق الخادم التصفية/الترتيب على المجموعة
  // كاملةً (endpoint /api/v1/contractors لا يدعم page/pageSize بعد، فالخادم يرسل
  // كل الصفوف المطابقة دفعة واحدة والترقيم هنا محلي على تلك القائمة الكاملة).
  // الإجماليات (d.totals) والقائمة الكاملة (d.rows) من الخادم لا تتأثران بهذا
  // الترقيم — فيبقى سطر الإجماليات وشريط «تصفية نشطة» واصفَين للمجموعة المصفّاة
  // كاملةً كما ينص CLAUDE.md، لا للصفحة المعروضة فقط.
  const PAGE_SIZE = 50;
  const [page, setPage] = useState(1);

  // عرض بديل: تجميع بالمشروع بدل القائمة المسطّحة — يجيب السؤال الحقيقي «أي
  // مشروع أسدّد مستحقاته أولاً؟» الذي لا تجيبه القائمة المسطّحة ولا بطاقة
  // الكاروسيل الجانبية (تلك بلا تفاعل ولا ترتيب بحجم الالتزام).
  const [groupByProject, setGroupByProject] = useState(false);

  const query = useMemo<ContractorQuery>(() => ({
    q: q || code || undefined,
    project: project || undefined,
    direction: direction || undefined,
    status: status || undefined,
    sort: sort?.key,
    dir: sort?.dir,
  }), [q, code, project, direction, status, sort]);

  const clearAll = () => {
    setQ(''); setCode(''); setProject(''); setDirection(''); setStatus('');
  };

  // أي تغيير في التصفية/الترتيب يُعيد الصفحة إلى الأولى — وإلا بقي المستخدم على
  // صفحة رقم ٨ فارغة بعد تصفية تُنقص النتائج إلى صفحتين.
  useEffect(() => { setPage(1); }, [query]);

  // معاملات التصدير — نفس query الحالية بالضبط، تمرَّر لمنتقي الصيغ ولزر
  // «كشف حساب» في كل صف (ExportMenu.tsx). ما تراه الشاشة هو ما يُصدَّر.
  const exportParams = query as Record<string, string | number | undefined>;

  const chips = [
    q && { k: 'q', label: `بحث: ${q}`, clear: () => setQ('') },
    code && { k: 'c', label: `الرمز: ${code}`, clear: () => setCode('') },
    project && { k: 'p', label: `المشروع: ${project}`, clear: () => setProject('') },
    direction && { k: 'd', label: `الاتجاه: ${DIRECTIONS.find((x) => x.value === direction)?.label ?? direction}`,
                  clear: () => setDirection('') },
    status && { k: 's', label: `الحالة: ${statusLabel(status)}`, clear: () => setStatus('') },
  ].filter(Boolean) as { k: string; label: string; clear: () => void }[];

  const [addOpen, setAddOpen] = useState(false);
  const [editRow, setEditRow] = useState<ContractorRow | null>(null);
  const [deleteRow, setDeleteRow] = useState<ContractorRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [showPrint, setShowPrint] = useState(false);
  // كشف حساب مقاول واحد بصيغة PDF — أعلى صيغ التصدير قيمة (تُرسَل للمقاول نفسه
  // للمطابقة). state منفصل عن showPrint: يحمل رمز المقاول المطلوب طباعته + بيانات
  // كشفه بعد الجلب (api.contractor نفس ما تستعمله ContractorDetail.tsx)، وحقل
  // hasStatement مُلتقَط من صف الجدول وقت الضغط لأن استجابة تفاصيل المقاول لا
  // تحمل هذا الحقل (هو خاص باستجابة القائمة فقط — انظر ContractorRow في api.ts).
  const [printStatement, setPrintStatement] = useState<
    { code: string; name: string; hasStatement: boolean } | null
  >(null);
  const [statementData, setStatementData] = useState<ContractorDetailResponse | null>(null);
  const [statementErr, setStatementErr] = useState<string | null>(null);
  // «إجماليات المشاريع» بصيغة PDF — صفحة واحدة تجيب «أي مشروع أسدّد أولاً؟»،
  // على نفس d.totals.byProject المصفّاة بمعاملات الجدول الحالية بالضبط (لا حساب
  // محلي — البيانات محسوبة في _by_project_breakdown على الخادم).
  const [showProjectTotalsPrint, setShowProjectTotalsPrint] = useState(false);

  const openStatementPrint = (r: ContractorRow) => {
    setPrintStatement({ code: r.code, name: r.name, hasStatement: r.hasStatement });
    setStatementData(null); setStatementErr(null);
    api.contractor(r.code).then(setStatementData).catch((e) => setStatementErr(e.message));
  };

  // نفس نص شريط «تصفية نشطة» أعلى الجدول — يُطبع مع الجدول بدل أن يُفقد سياقه.
  const filterLine = chips.length > 0 ? chips.map((c) => c.label).join(' · ') : null;

  // «آخر دفعة» و«آخر حركة» أُسقطا من النسخة المطبوعة فقط: سبعة أعمدة على الشاشة
  // لا تسع عرض A4 حتى أفقياً — والاتجاه (له/لنا) والضمان المحتجز أهم لقرار
  // السداد من تاريخ آخر حركة أو دفعة.
  const printColumns: PrintableColumn[] = [
    { key: 'name', label: 'المقاول', render: (r: ContractorRow) => r.name },
    { key: 'code', label: 'الرمز', ltr: true, render: (r: ContractorRow) => r.code },
    { key: 'project', label: 'المشروع', render: (r: ContractorRow) =>
      (r.projects ?? []).length > 0 ? r.projects.join('، ') : '—' },
    { key: 'balance', label: 'الرصيد (ر.س)', ltr: true, render: (r: ContractorRow) => {
      const v = balanceView(r.balance);
      return `${sar(Math.abs(r.balance))} (${v.label})`;
    } },
    { key: 'retention', label: 'الضمان المحتجز (ر.س)', ltr: true,
      render: (r: ContractorRow) => r.retentionHeld > 0 ? sar(r.retentionHeld) : '—' },
  ];

  const seq = useRef(0);
  const reload = () => {
    const my = ++seq.current;
    api.contractorsList(query).then((r) => {
      if (my !== seq.current) return; // استجابة متأخرة لطلب سابق — تُهمل
      setD(r); setErr(null);
    }).catch((e) => { if (my === seq.current) setErr(e.message); });
  };

  useEffect(() => {
    const my = ++seq.current;
    const t = setTimeout(() => {
      api.contractorsList(query).then((r) => {
        if (my !== seq.current) return;
        setD(r); setErr(null);
      }).catch((e) => { if (my === seq.current) setErr(e.message); });
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // نظرة المقاولين — مُجمَّعة على مستوى الشركة كاملة، لا تتأثر بفلاتر الجدول أعلاه
  // (بحث/مشروع/اتجاه) ولذلك تُحمَّل مرة واحدة بمعزل عن query. لا تعديل على
  // lib/api.ts المملوك لوكيل آخر — نبني الرابط مباشرة عبر apiBase() تماماً كما
  // تفعل CashFlow.tsx مع fetchBreakdown.
  const loadOverview = () => {
    setOverviewErr(null);
    fetch(apiBase() + '/api/v1/contractors/overview')
      .then((res) => { if (!res.ok) throw new Error('تعذّر جلب نظرة المقاولين'); return res.json(); })
      .then(setOverview)
      .catch((e) => setOverviewErr(e.message));
  };
  useEffect(loadOverview, []);

  const projects = useMemo(() => {
    const set = new Set<string>();
    for (const r of d?.rows ?? []) for (const p of r.projects ?? []) set.add(p);
    return [...set].sort();
  }, [d]);

  const filtering = chips.length > 0;

  // صفحة العرض من المجموعة المصفّاة كاملةً — d.rows نفسها لا تتغيّر، فأي حساب
  // لاحق (تجميع بالمشروع، تصدير) يستعمل d.rows كاملة لا pageRows.
  const allRows: ContractorRow[] = d?.rows ?? [];
  const pageCount = Math.max(1, Math.ceil(allRows.length / PAGE_SIZE));
  const pageRows = allRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // تجميع بالمشروع — على المجموعة المصفّاة كاملةً (allRows) لا على صفحة واحدة،
  // وإلا اختفى مشروع بأكمله لمجرد وقوع مقاوليه في صفحة أخرى. مقاول على أكثر من
  // مشروع يُحتسب تحت كل مشروع بكامل رصيده (لا تجزئة — الخادم لا يعطي حصة كل
  // مشروع من رصيد المقاول، فتجزئة محلية هنا كانت ستخترع رقماً لا تدعمه البيانات).
  // الترتيب: الأكبر التزاماً (له) أولاً — هذا هو ترتيب قرار السداد نفسه.
  const projectGroups = useMemo(() => {
    const map = new Map<string, { project: string; rows: ContractorRow[]; owed: number; owedToUs: number }>();
    for (const r of allRows) {
      const projs = r.projects && r.projects.length > 0 ? r.projects : ['— بلا مشروع —'];
      for (const p of projs) {
        if (!map.has(p)) map.set(p, { project: p, rows: [], owed: 0, owedToUs: 0 });
        const g = map.get(p)!;
        g.rows.push(r);
        if (r.balance < 0) g.owed += -r.balance;
        else if (r.balance > 0) g.owedToUs += r.balance;
      }
    }
    return [...map.values()].sort((a, b) => b.owed - a.owed);
  }, [allRows]);

  if (err) return <ErrorState message={`تعذّر التحميل: ${err}`} onRetry={reload} />;

  // نسخة PDF قابلة للطباعة — نفس d.rows/d.totals المصفّاة التي يعرضها الجدول بالضبط.
  if (showPrint && d) {
    return (
      <PrintableList
        docTitle="قائمة المقاولين"
        fileStamp="قائمة-المقاولين"
        scopeLine="الرصيد السالب (له) مستحق للمقاول، والموجب (لنا) مستحق للشركة"
        filterLine={filterLine}
        countLabel={`${ar(d.count)} مقاولاً`}
        columns={printColumns}
        rows={d.rows}
        totalsCells={[
          // ست خلايا لستة أعمدة: المقاول، الرمز، المشروع، الرصيد، الحالة، الضمان.
          // خليةٌ ناقصة هنا تُزحزح رقم الضمان تحت عمود الحالة بصمت.
          `الإجمالي (${ar(d.count)})`, '', '', '', '',
          sar(d.totals.retentionHeld),
        ]}
        footNote={`إجمالي مستحق للمقاولين ${sar(d.totals.owedToContractors)} ر.س · إجمالي مستحق لنا ${sar(d.totals.owedToUs)} ر.س`}
        onBack={() => setShowPrint(false)}
      />
    );
  }

  // كشف حساب PDF لمقاول واحد — نفس آلية PrintableList، لكن رأس الورقة يحمل اسم
  // المقاول ورمزه بدل عنوان قائمة عامة، والصفوف حركات دفتره الكاملة (بلا تصفية:
  // كشف حساب يُرسَل للمقاول يجب أن يعرض كل حركة، لا مجموعة مصفّاة جزئياً).
  if (printStatement) {
    if (statementErr) {
      return (
        <div className="page-head no-print">
          <div className="grow"><h1>تعذّر تحميل كشف الحساب</h1><p>{statementErr}</p></div>
          <button className="btn" onClick={() => setPrintStatement(null)}>رجوع</button>
        </div>
      );
    }
    if (!statementData) {
      return (
        <div className="page-head no-print">
          <div className="grow"><h1>جارٍ تحميل كشف الحساب…</h1></div>
          <button className="btn" onClick={() => setPrintStatement(null)}>رجوع</button>
        </div>
      );
    }
    const sd = statementData;
    const entryColumns: PrintableColumn[] = [
      { key: 'date', label: 'التاريخ', ltr: true, render: (e: ContractorEntry) => arDate(e.date) },
      { key: 'kind', label: 'النوع', render: (e: ContractorEntry) => ENTRY_KIND_LABEL[e.kind] ?? e.kind ?? 'أخرى' },
      { key: 'description', label: 'الوصف', render: (e: ContractorEntry) => e.description || '—' },
      { key: 'project', label: 'المشروع', render: (e: ContractorEntry) => e.project || '—' },
      { key: 'debit', label: 'مدين (ر.س)', ltr: true, render: (e: ContractorEntry) => e.debit ? sar(e.debit) : '—' },
      { key: 'credit', label: 'دائن (ر.س)', ltr: true, render: (e: ContractorEntry) => e.credit ? sar(e.credit) : '—' },
    ];
    const sv = balanceView(sd.balance);
    return (
      <PrintableList
        docTitle={`كشف حساب — ${sd.name}`}
        fileStamp={`كشف-حساب-${sd.code}`}
        scopeLine={`الرمز ${sd.code}${sd.perProject.length > 0 ? ` · ${sd.perProject.map((p) => p.project).join('، ')}` : ''}`}
        filterLine={null}
        countLabel={`${ar(sd.entries.length)} حركة`}
        columns={entryColumns}
        rows={sd.entries}
        totalsCells={[
          `الإجمالي (${ar(sd.entries.length)})`, '', '', '',
          sar(sd.debitTotal ?? 0), sar(sd.creditTotal ?? 0),
        ]}
        summary={[
          { label: `الرصيد الختامي (${sv.label})`, value: `${sar(Math.abs(sd.balance))} ر.س` },
          { label: 'إجمالي مدين', value: `${sar(sd.debitTotal ?? 0)} ر.س` },
          { label: 'إجمالي دائن', value: `${sar(sd.creditTotal ?? 0)} ر.س` },
          { label: 'الضمان المحتجز', value: sd.retentionTotal ? `${sar(sd.retentionTotal)} ر.س` : '—' },
        ]}
        warnBanner={!printStatement.hasStatement
          ? 'لا كشف حساب مرفوع لهذا المقاول — الرصيد أعلاه من ملف مديونيات مستورد فقط، والحركات أدناه (إن وُجدت) لا تمثّل كشف حسابه الكامل.'
          : undefined}
        footNote="كشف حساب داخلي من دفتر الشركة — للمطابقة مع سجلات المقاول."
        onBack={() => setPrintStatement(null)}
      />
    );
  }

  // إجماليات المشاريع PDF — d.totals.byProject مرتّبة من الخادم بالأكبر التزاماً
  // (له) أولاً، وهو ترتيب قرار السداد نفسه (نفس فرز projectGroups أعلاه لكن من
  // الخادم مباشرة هنا لا حساب محلي). وسم «بلا كشف» غير منطبق على هذا المستوى:
  // الصف هنا مشروع لا مقاول بعينه.
  if (showProjectTotalsPrint && d) {
    const byProject: { project: string; owedToContractors: number; owedToUs: number; count: number; unassigned?: boolean }[] =
      d.totals.byProject ?? [];
    const projectColumns: PrintableColumn[] = [
      { key: 'project', label: 'المشروع', render: (r: any) => r.project },
      { key: 'count', label: 'عدد المقاولين', ltr: true, render: (r: any) => ar(r.count) },
      { key: 'owed', label: 'مستحق للمقاولين — له (ر.س)', ltr: true,
        render: (r: any) => r.owedToContractors > 0 ? sar(r.owedToContractors) : '—' },
      { key: 'owedUs', label: 'مستحق لنا (ر.س)', ltr: true,
        render: (r: any) => r.owedToUs > 0 ? sar(r.owedToUs) : '—' },
    ];
    return (
      <PrintableList
        docTitle="إجماليات المشاريع — نظرة القرار"
        fileStamp="إجماليات-المشاريع"
        scopeLine="مرتّبة بالأكبر مستحقاً للمقاولين أولاً — أي مشروع أسدّد مستحقاته أولاً"
        filterLine={filterLine}
        countLabel={`${ar(byProject.length)} مشروعاً`}
        columns={projectColumns}
        rows={byProject}
        totalsCells={[
          `الإجمالي (${ar(byProject.length)})`, ar(d.count),
          sar(d.totals.owedToContractors), sar(d.totals.owedToUs),
        ]}
        summary={[
          { label: 'إجمالي مستحق للمقاولين', value: `${sar(d.totals.owedToContractors)} ر.س` },
          { label: 'إجمالي مستحق لنا', value: `${sar(d.totals.owedToUs)} ر.س` },
          { label: 'الضمانات المحتجزة', value: `${sar(d.totals.retentionHeld)} ر.س` },
        ]}
        footNote="مقاول على أكثر من مشروع يُحتسب تحت كل مشروع بكامل رصيده — لا تجزئة محلية غير مدعومة بالبيانات."
        onBack={() => setShowProjectTotalsPrint(false)}
      />
    );
  }

  async function handleAdd(values: ContractorFormValues) {
    setBusy(true); setFormErr(null);
    try {
      await api.createContractor(values);
      setAddOpen(false);
      reload();
    } catch (e) {
      setFormErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleEdit(values: ContractorFormValues) {
    if (!editRow) return;
    setBusy(true); setFormErr(null);
    try {
      const { code: _code, ...rest } = values;
      await api.updateContractor(editRow.code, rest);
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
          <h1>المقاولون</h1>
          <p>الرصيد السالب (بالأحمر) مستحق «له»، والموجب (بالأخضر) مستحق «لنا»</p>
          {/* الغياب يُشرح ولا يُترك. صفحة الموردين تعرض عمود «التأخر» بارزاً، فخلوّ
              هذه الصفحة منه يُقرأ «البيانات ناقصة» لا «لا ينطبق هنا». وعرض صفرٍ
              بدلاً منه أسوأ: الصفر يعني «لا تأخر عليه» وهو ما لا نعلمه أصلاً. */}
          <p className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            لا يُحسب «التأخر» للمقاولين: حركاتهم قيود مدين/دائن بلا تواريخ استحقاق،
            بخلاف فواتير الموردين. يظهر التأخر لهم عند إدخال المستخلصات بتواريخها.
          </p>
        </div>
        <button className="btn primary" onClick={() => { setFormErr(null); setAddOpen(true); }}>
          إضافة مقاول
        </button>
      </div>

      {d && (
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <Kpi label="إجمالي مستحق للمقاولين" value={sar(d.totals.owedToContractors)} unit="ر.س" tone="red" hero
               explain={<ExplainDot metric="contractorsOwed" values={{ contractorsOwed: d.totals.owedToContractors }} />} />
          <Kpi label="إجمالي مستحق لنا" value={sar(d.totals.owedToUs)} unit="ر.س" tone="ok"
               explain={<ExplainDot metric="contractorsOwedToUs" values={{ contractorsOwedToUs: d.totals.owedToUs }} />} />
          <Kpi label="الضمانات المحتجزة" value={sar(d.totals.retentionHeld)} unit="ر.س"
               explain={<ExplainDot metric="contractorsRetention" values={{ contractorsRetention: d.totals.retentionHeld }} />} />
        </div>
      )}

      <ContractorsOverview data={overview} error={overviewErr} onRetry={loadOverview} onImport={() => nav('/import')} />

      <div className="toolbar">
        <input placeholder="بحث بالاسم أو الرمز…" value={q}
               onChange={(e) => setQ(e.target.value)} style={{ minWidth: 300 }} />
        {/* المشروع والاتجاه انتقلا إلى قائمتي عمودَيهما — نفس منطق Suppliers.tsx. */}
        {d && <span className="count">{ar(d.count)} مقاولاً</span>}
        {/* تبديل العرض: قائمة مسطّحة أو تجميع بالمشروع بمجموع فرعي لكل مشروع —
            كلاهما على نفس d.rows المصفّاة كاملةً، فلا يفقد أحدهما تصفية الآخر. */}
        <div className="seg" role="tablist" aria-label="طريقة العرض">
          <button className={'btn sm' + (!groupByProject ? ' active' : '')}
                  aria-pressed={!groupByProject} onClick={() => setGroupByProject(false)}>
            قائمة
          </button>
          <button className={'btn sm' + (groupByProject ? ' active' : '')}
                  aria-pressed={groupByProject} onClick={() => setGroupByProject(true)}>
            تجميع بالمشروع
          </button>
        </div>
        <ExportMenu params={exportParams} projects={projects} />
        <button className="btn sm" disabled={!d} onClick={() => setShowPrint(true)}>PDF</button>
        <button className="btn sm" disabled={!d} onClick={() => setShowProjectTotalsPrint(true)}
                title="ورقة واحدة: أي مشروع أسدّد مستحقاته أولاً">PDF إجماليات المشاريع</button>
      </div>

      <Card>
        {/* التصفية تُعلن عن نفسها — نفس تعليق Suppliers.tsx بالحرف. */}
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
          </div>
        )}
        {!d ? <State>جارٍ التحميل…</State>
          : d.rows.length === 0 ? (
            filtering ? (
              <EmptyState kind="no-results" title="لا نتائج مطابقة"
                body="لم يطابق البحث أو التصفية أي مقاول."
                ctaLabel="مسح التصفية" onCta={clearAll} />
            ) : (
              <EmptyState kind="no-data" title="لم تُرفع بيانات المقاولين بعد"
                body="ارفع كشوف حسابات المقاولين لتظهر أرصدتهم ومستخلصاتهم هنا."
                ctaLabel="رفع الملفات" onCta={() => nav('/import')} />
            )
          ) : groupByProject ? (
            <ProjectGroupsView groups={projectGroups} />
          ) : (
          <div className="table-scroll wide">
          <table>
            <thead>
              <tr>
                <Th label="المقاول" className="party" sortKey="name" sort={sort} onSort={setSort}
                    ascLabel="أ ← ي" descLabel="ي ← أ" active={Boolean(q)}
                    filter={{ kind: 'text', value: q, onChange: setQ, placeholder: 'اسم المقاول…' }} />
                <Th label="الرمز" sortKey="code" sort={sort} onSort={setSort}
                    active={Boolean(code)}
                    filter={{ kind: 'text', value: code, onChange: setCode, placeholder: '212…' }} />
                <Th label="المشروع" sortKey={undefined} sort={sort} onSort={setSort}
                    active={Boolean(project)}
                    filter={{ kind: 'select', value: project, onChange: setProject,
                              allLabel: 'كل المشاريع',
                              options: projects.map((p: string) => ({ value: p, label: p })) }} />
                <Th label="الاتجاه" className="ltr" sortKey="balance" sort={sort} onSort={setSort}
                    ascLabel="الأشد استحقاقاً له" descLabel="الأشد استحقاقاً لنا"
                    active={Boolean(direction)}
                    filter={{ kind: 'select', value: direction, onChange: setDirection,
                              allLabel: 'كل الاتجاهات',
                              options: DIRECTIONS }} />
                <Th label="الحالة" sortKey="status" sort={sort} onSort={setSort}
                    ascLabel="أ ← ي" descLabel="ي ← أ"
                    active={Boolean(status)}
                    filter={{ kind: 'select', value: status, onChange: setStatus,
                              allLabel: 'كل الحالات',
                              options: CONTRACTOR_STATUSES.map((x) => ({ value: x.value, label: x.label })) }} />
                <Th label="الضمان المحتجز" className="ltr" sortKey="retentionHeld"
                    sort={sort} onSort={setSort}
                    ascLabel="الأصغر أولاً" descLabel="الأكبر أولاً" />
                <Th label="آخر دفعة" className="ltr" sortKey="lastPaymentDate"
                    sort={sort} onSort={setSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" />
                <Th label="آخر حركة" sortKey="lastActivity" sort={sort} onSort={setSort}
                    ascLabel="الأقدم أولاً" descLabel="الأحدث أولاً" />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r: ContractorRow) => {
                const v = balanceView(r.balance);
                // hasStatement من الخادم مباشرة (لا entryCount>0 — كانت خاطئة: تُصفَّر
                // أيضاً بعد فلترة الفترة فلا تظهر أبداً بعد الاستيراد، عطب م-٢٦).
                // ٥٩٨ من ٥٩٩ مقاولاً مستوردون بأرصدة ملف فقط بلا كشف حركة مرفوع بعد —
                // الفراغ في عمود الضمان لهم يعني «غير معروف» لا «لا ضمان»، والفرق هنا
                // مالي: إفراج عن ضمان غير معروف للنظام.
                const hasStatement = r.hasStatement;
                return (
                  <tr key={r.code} className={r.balance < 0 ? 'row-overdue' : ''}>
                    <td className="party">
                      <Link to={`/contractors/${r.code}`}>{r.name}</Link>
                      {r.releaseAlerts > 0 && (
                        <span className="release-dot" title={`ضمانات مستحقة الصرف: ${ar(r.releaseAlerts)}`} />
                      )}
                      {!hasStatement && (
                        <span className="pill" title="لا قيود دفترية لهذا المقاول — الرصيد من ملف مستورد فقط. أعمدة الضمان والمستخلصات هنا «غير معروفة» لا «لا يوجد»."
                              style={{ marginInlineStart: 6, fontSize: 10 }}>
                          بلا كشف مرفوع
                        </span>
                      )}
                      {r.phone && (
                        <div className="muted num" style={{ fontSize: 11, marginTop: 2 }}>{r.phone}</div>
                      )}
                    </td>
                    <td className="num muted">{r.code}</td>
                    <td>
                      {/* أكثر من مشروع؟ الأول ثم «+ن» — نفس نمط Suppliers.tsx، حتى لا
                          يكسر شريط طويل من الشرائح ارتفاع الصف. العنوان الكامل يظهر
                          عند التحويم. */}
                      {(r.projects ?? []).length > 0 ? (
                        r.projects.length === 1 ? (
                          <span className="chip">{r.projects[0]}</span>
                        ) : (
                          <span title={r.projects.join('، ')}>
                            <span className="chip">{r.projects[0]}</span>{' '}
                            <span className="chip">+{ar(r.projects.length - 1)}</span>
                          </span>
                        )
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="ltr">
                      <Money v={r.balance} cls={v.cls} />{' '}
                      <span className={'balance-tag ' + v.cls}>{v.label}</span>
                    </td>
                    <td>
                      <span className={`pill ${STATUS_TONE[r.status] ?? ''}`}
                            title={r.statusNote || undefined}>
                        {statusLabel(r.status)}
                      </span>
                      {/* الملاحظة تفسّر «لماذا متوقف» — تظهر مقتطعة تحت الشارة
                          وكاملةً عند التحويم، فالحالة وحدها لا تقول السبب. */}
                      {r.statusNote && (
                        <div className="muted" style={{ fontSize: 11, marginTop: 2,
                                                        maxWidth: 160, overflow: 'hidden',
                                                        textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {r.statusNote}
                        </div>
                      )}
                    </td>
                    <td className="ltr">
                      {!hasStatement ? (
                        <span className="muted" title="لا كشف حساب مرفوع — لا نعلم إن كان محتجزاً ضمان أم لا">غير معروف</span>
                      ) : r.retentionHeld > 0 ? <Money v={r.retentionHeld} /> : <span className="muted">لا يوجد</span>}
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
                    <td>{r.lastActivity ? arDate(r.lastActivity) : <span className="muted">—</span>}</td>
                    <td className="ltr">
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <StatementExportButton code={r.code} params={exportParams} />
                        <button className="btn sm" onClick={() => openStatementPrint(r)}
                                aria-label="طباعة كشف الحساب PDF" title="طباعة كشف الحساب (PDF)">🖶</button>
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
        {/* الترقيم يصف الصفحة المعروضة فقط — العدّاد أعلى الجدول وسطر الإجماليات
            في بطاقات KPI يبقيان يصفان d.totals/d.count الكاملين، لا هذه الصفحة. */}
        {d && !groupByProject && allRows.length > PAGE_SIZE && (
          <div className="pager" style={{ display: 'flex', alignItems: 'center',
                                          justifyContent: 'space-between', gap: 8, padding: '10px 4px 0' }}>
            <span className="muted" style={{ fontSize: 12 }}>
              عرض {ar((page - 1) * PAGE_SIZE + 1)}–{ar(Math.min(page * PAGE_SIZE, allRows.length))} من {ar(allRows.length)}
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage(1)}>الأولى</button>
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>السابقة</button>
              <span className="muted" style={{ fontSize: 12, alignSelf: 'center', padding: '0 6px' }}>
                {ar(page)} / {ar(pageCount)}
              </span>
              <button className="btn sm" disabled={page >= pageCount} onClick={() => setPage((p) => p + 1)}>التالية</button>
              <button className="btn sm" disabled={page >= pageCount} onClick={() => setPage(pageCount)}>الأخيرة</button>
            </div>
          </div>
        )}
      </Card>

      {addOpen && (
        <Modal title="إضافة مقاول" onClose={() => setAddOpen(false)}>
          <ContractorForm onSubmit={handleAdd} busy={busy} error={formErr} knownProjects={projects} />
        </Modal>
      )}

      {editRow && (
        <Modal title="تعديل مقاول" onClose={() => setEditRow(null)}>
          <ContractorForm
            initial={{ code: editRow.code, name: editRow.name, phone: editRow.phone ?? '',
                      projects: editRow.projects ?? [] }}
            codeLocked
            knownProjects={projects}
            onSubmit={handleEdit}
            busy={busy}
            error={formErr}
          />
        </Modal>
      )}

      {deleteRow && (
        <DeleteContractorModal
          row={deleteRow}
          onClose={() => setDeleteRow(null)}
          onDeleted={() => { setDeleteRow(null); reload(); }}
        />
      )}
    </>
  );
}

/** عرض «تجميع بالمشروع» في الجدول الرئيسي — الفجوة الأهم مالياً: أمام ٣٩٢ داعناً
 * و١٢ مشروعاً، هذا هو المكان الوحيد الذي يجيب «أي مشروع أسدّد مستحقاته أولاً؟»
 * بالنزول مباشرة من المشروع إلى مقاوليه، مرتّباً بحجم الالتزام (له) الأكبر أولاً —
 * خلاف بطاقة الكاروسيل الجانبية أعلى الصفحة التي لا تتيح النزول لمقاولي مشروع بعينه. */
function ProjectGroupsView({ groups }: {
  groups: { project: string; rows: ContractorRow[]; owed: number; owedToUs: number }[];
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  if (groups.length === 0) return <State>لا بيانات لتجميعها.</State>;
  const toggle = (p: string) => setOpen((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p); else n.add(p);
    return n;
  });
  return (
    <div className="table-scroll wide">
      <table>
        <thead>
          <tr>
            <th>المشروع</th>
            <th>عدد المقاولين</th>
            <th className="ltr">مستحق للمقاولين (له)</th>
            <th className="ltr">مستحق لنا</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <>
              <tr key={g.project} className="group-row"
                  onClick={() => toggle(g.project)} style={{ cursor: 'pointer' }}>
                <td><b>{open.has(g.project) ? '▾' : '◂'} {g.project}</b></td>
                <td>{ar(g.rows.length)}</td>
                <td className="ltr">{g.owed > 0 ? <Money v={g.owed} cls="red" /> : <span className="muted">—</span>}</td>
                <td className="ltr">{g.owedToUs > 0 ? <Money v={g.owedToUs} cls="ok" /> : <span className="muted">—</span>}</td>
              </tr>
              {open.has(g.project) && g.rows
                .slice()
                .sort((a, b) => a.balance - b.balance)
                .map((r) => {
                  const v = balanceView(r.balance);
                  return (
                    <tr key={g.project + '/' + r.code} className="group-child">
                      <td style={{ paddingInlineStart: 28 }}>
                        <Link to={`/contractors/${r.code}`}>{r.name}</Link>
                      </td>
                      <td className="num muted">{r.code}</td>
                      <td className="ltr" colSpan={2}>
                        <Money v={r.balance} cls={v.cls} />{' '}
                        <span className={'balance-tag ' + v.cls}>{v.label}</span>
                      </td>
                    </tr>
                  );
                })}
            </>
          ))}
        </tbody>
      </table>
      <p className="muted text-caption-micro" style={{ margin: '8px 0 0' }}>
        النطاق: كل المشاريع من المجموعة المصفّاة كاملةً (بلا ترقيم صفحات) — مرتّبة
        بأكبر مستحق للمقاولين أولاً. مقاول على أكثر من مشروع يظهر تحت كل مشروع
        بكامل رصيده (الخادم لا يعطي حصة كل مشروع من رصيده الكلي).
      </p>
    </div>
  );
}

// ============================================================== نظرة المقاولين (Carousel)

/**
 * أربع صفحات لا تتكرر مع بطاقات «إجمالي مستحق للمقاولين / لنا / الضمانات المحتجزة»
 * الظاهرة دائماً أعلى الشاشة — هذه الشاشة كانت تعرض مقاولاً واحداً فقط قبل استيراد
 * تقرير المديونيات المجمّع؛ بعده تعرض نحو ٣٢١ مقاولاً، فلا تكفي بطاقات الإجمالي وحدها
 * لاتخاذ قرار سداد. الصفحات الأربع اختيرت لأنها الأسئلة التي يطرحها القرار فعلاً:
 * أي مشروع يستحق الأولوية، من أكبر عشرة مقاولين، كم محتجز في حسابات الضمان
 * المستقلة (216 — منفصلة تماماً عن ضمانات المشاريع per-contractor أعلاه)،
 * وأين قد يكون الرقم نفسه غير موثوق (اختلاف رصيد الملف عن المحسوب من الحركات).
 * رُفض عرض «إجمالي المستحق وعدد المقاولين» كصفحة مستقلة لأنه مكرر حرفياً لبطاقة
 * الإجمالي الثابتة أعلى الشاشة. كل رقم هنا من /api/v1/contractors/overview —
 * لا حساب مالي في هذا الملف.
 */
const OVERVIEW_VIEWS: { key: string; title: string }[] = [
  { key: 'byProject', title: 'التوزيع على المشاريع' },
  { key: 'topOwed', title: 'أكبر ١٠ مقاولين بالمستحق' },
  { key: 'guarantees216', title: 'الضمانات المستقلة (216)' },
  { key: 'mismatches', title: 'اختلافات الرصيد' },
];

function ContractorsOverview({ data, error, onRetry, onImport }: {
  data: any; error: string | null; onRetry: () => void; onImport: () => void;
}) {
  const [activeView, setActiveView] = useState<number>(
    () => loadStoredCarouselView(OVERVIEW_STORAGE_KEY, OVERVIEW_VIEWS.length));

  useEffect(() => {
    localStorage.setItem(OVERVIEW_STORAGE_KEY, String(activeView));
  }, [activeView]);

  const bodyStyle: CSSProperties = { padding: '0 10px' };

  if (error) return <ErrorState message={error} onRetry={onRetry} />;
  if (!data) return null; // نفس اللحظة تُغطّى بـ «جارٍ التحميل…» في الجدول أسفل — لا تكرار هنا

  // قبل أي استيراد لتقرير المديونيات المجمّع ولا حركات مقاولين على الإطلاق: الشاشة
  // كانت فارغة قبل هذه الميزة تماماً، فبدل عرض أصفار كأنها حقيقة نقول ماذا ستعرضه
  // هذه اللوحة وكيف يصل إليها المستخدم — نفس مبدأ EmptyState «no-data» في باقي التطبيق.
  if (!data.hasDebtsReportImport && data.totals.contractorCount === 0) {
    return (
      <div style={{ border: '1px dashed var(--hair)', borderRadius: 'var(--r-card, 10px)',
                   padding: '16px 20px', marginBottom: 14 }}>
        <b style={{ fontSize: 13 }}>نظرة المقاولين ستظهر هنا بعد الرفع</b>
        <p className="muted" style={{ fontSize: 12, margin: '6px 0 10px', lineHeight: 1.7 }}>
          بعد رفع تقرير مديونيات المقاولين والموردين (أو كشوف حساب فردية) ستعرض هذه
          اللوحة: توزيع المستحق على المشاريع، أكبر عشرة مقاولين بالمستحق، إجمالي
          حسابات الضمان المستقلة، وأي اختلاف بين رصيد الملف والرصيد المحسوب من الحركات.
        </p>
        <button className="btn primary" onClick={onImport}>رفع الملفات</button>
      </div>
    );
  }

  return (
    <>
      <Carousel views={OVERVIEW_VIEWS} activeView={activeView} onViewChange={setActiveView}
                ariaLabel="نظرة المقاولين">
        <div style={bodyStyle}>
          {/* الطبقة المُبلَّغة هي التي تصف الحقيقة بعد استيراد التقرير: ٣٢٠ من
              ٣٢١ مقاولاً بلا قيود دفترية، فالمشتقّ من الحركات يصف واحداً فقط
              (٥٦٬٦٥١.٩٩ مقابل ٧٬٧٨٢٬٢٦٦.٩٠ الحقيقية). نرجع للمشتقّ فقط قبل
              أي استيراد للتقرير. */}
          {activeView === 0 && <ByProjectView rows={data.reported?.byProject?.length ? data.reported.byProject : data.byProject} />}
          {activeView === 1 && <TopOwedView rows={data.reported?.topOwed?.length ? data.reported.topOwed : data.topOwed} />}
          {activeView === 2 && <Guarantees216View g={data.guaranteeAccounts216} />}
          {activeView === 3 && <MismatchesView rows={data.balanceMismatches}
            hasImport={data.hasDebtsReportImport} importedAt={data.lastDebtsReportImport} />}
        </div>
      </Carousel>
      {/* الرقمان مصدران مختلفان ولا يُجمعان أبداً: «المُبلَّغ» من تقرير المديونيات
          المجمّع (يغطي كل المقاولين)، و«المشتقّ» من قيود الدفتر (يغطي من رُفعت
          كشوفهم فقط). عرض أحدهما بلا الآخر يجعل الرقم صحيح الحساب خاطئ الوصف. */}
      {data.hasDebtsReportImport && data.reported && (
        <p className="muted text-caption-micro" style={{ margin: '-10px 4px 14px', lineHeight: 1.7 }}>
          الأرقام أعلاه من <b>تقرير المديونيات المجمّع</b> ({sar(data.reported.owed)} ر.س
          على {ar(data.reported.contractorCount)} مقاولاً). المحسوب من حركات الدفتر
          المرفوعة فعلاً: {sar(data.totals.owedToContractors)} ر.س — الفرق طبيعي لأن معظم
          المقاولين لم تُرفع كشوف حساباتهم بعد، وليس خطأً حسابياً.
        </p>
      )}
    </>
  );
}

/** «التوزيع على المشاريع» — أي مشروع يحمل أكبر مستحق للمقاولين. النطاق: مجموع
 * أرصدة المقاولين السالبة (له) لكل مشروع من حركاتهم الحيّة، لا رصيدهم الكلي —
 * مقاول على أكثر من مشروع يظهر تحت كل مشروع بنصيبه منه فقط. */
function ByProjectView({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return <State>لا بيانات مشاريع بعد.</State>;
  const max = Math.max(1, ...rows.map((r) => r.owed || 0));
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>المشروع</th><th className="ltr">المستحق للمقاولين (المشروع)</th><th>عدد المقاولين</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.project}>
              <td>{r.project}</td>
              <td className="ltr">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-end' }}>
                  <div style={{ width: 60, height: 6, borderRadius: 3, background: 'var(--tint)', overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(4, ((r.owed || 0) / max) * 100)}%`, height: '100%', background: 'var(--red)' }} />
                  </div>
                  <Money v={r.owed} cls="red" />
                </div>
              </td>
              <td>{ar(r.contractorCount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-caption-micro" style={{ margin: '8px 0 0' }}>
        النطاق: مجموع مستحق المقاولين (رصيد سالب) على حركات كل مشروع وحده — لا الرصيد
        الكلي للمقاول عبر كل مشاريعه. مشروع برصيد موجب فقط (مستحق لنا) لا يظهر هنا.
      </p>
    </div>
  );
}

/** «أكبر ١٠ مقاولين بالمستحق» — نفس ترتيب الجدول الافتراضي (الأشد سالبية أولاً)،
 * مقصور على أول عشرة، بلا تصفية شاشة القائمة أسفل (يعرض دائماً المستحق كاملاً). */
function TopOwedView({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return <State>لا مستحقات مسجَّلة للمقاولين.</State>;
  return (
    <div className="table-scroll">
      <table>
        <thead><tr><th>المقاول</th><th>المشاريع</th><th className="ltr">المستحق</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code}>
              <td><Link to={`/contractors/${r.code}`}>{r.name}</Link></td>
              <td>{(r.projects ?? []).length > 0 ? r.projects.join('، ') : <span className="muted">—</span>}</td>
              <td className="ltr"><Money v={Math.abs(r.balance)} cls="red" /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-caption-micro" style={{ margin: '8px 0 0' }}>
        النطاق: كل المقاولين، بلا فلترة الجدول أسفل — رصيد سالب (له) فقط، الأكبر أولاً.
      </p>
    </div>
  );
}

/** «الضمانات المستقلة (216)» — إجمالي حسابات الضمان المستوردة من تقرير المديونيات
 * المجمّع (جدول GuaranteeAccount)، مستقل تماماً عن «الضمانات المحتجزة» في بطاقة
 * الإجمالي أعلى الشاشة (تلك من ضمانات المشاريع لكل مقاول — ContractorGuarantee).
 * لم تُربط هذه الحسابات بمقاول بعد في أغلبها؛ الرابط اليدوي مهمة لاحقة. */
function Guarantees216View({ g }: { g: any }) {
  if (!g || g.count === 0) {
    return <State>لا حسابات ضمان مستقلة (216) مستوردة بعد.</State>;
  }
  return (
    <div style={{ padding: '4px 0 0' }}>
      <div className="kpi-row" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <Kpi label="إجمالي حسابات الضمان المستقلة (216)" value={sar(g.total)} unit="ر.س" hero={false} />
        <Kpi label="عدد الحسابات" value={ar(g.count)} hero={false} />
      </div>
      <p className="muted text-caption-micro" style={{ margin: '10px 0 0', lineHeight: 1.7 }}>
        النطاق: حسابات بادئتها 216 من تقرير المديونيات المجمّع فقط — رقم مختلف تماماً
        عن «الضمانات المحتجزة» في بطاقة الإجمالي أعلى الشاشة (تلك ضمانات مشاريع
        مربوطة بمقاول بعينه). لم يُربط أغلب هذه الحسابات بمقاول محدد بعد.
      </p>
    </div>
  );
}

/** «اختلافات الرصيد» — أكثر ما يستحق ثقة المستخدم: حين يختلف رصيد الملف المرفوع
 * عن الرصيد المشتق من حركات الدفتر المحفوظة لنفس الحساب. من أحدث استيراد لتقرير
 * المديونيات المجمّع فقط — استيراد لاحق يستبدل قائمة التحذيرات المرجعية بالكامل. */
function MismatchesView({ rows, hasImport, importedAt }: {
  rows: any[]; hasImport: boolean; importedAt: string | null;
}) {
  if (!hasImport) {
    return <State>لا يوجد استيراد لتقرير مديونيات مجمّع بعد — لا مطابقة لعرضها.</State>;
  }
  if (!rows || rows.length === 0) {
    return (
      <EmptyState kind="all-clear" title="لا اختلافات رصيد"
        body="رصيد كل مقاول في آخر تقرير مديونيات مجمّع مطابق (بحدود الهللة) للرصيد المحسوب من حركاته المحفوظة." />
    );
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr><th>المقاول</th><th className="ltr">رصيد الملف</th><th className="ltr">المحسوب من الحركات</th><th className="ltr">الفرق</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account}>
              <td><Link to={`/contractors/${r.account}`}>{r.name || r.account}</Link></td>
              <td className="ltr">{r.fileBalance != null ? <Money v={r.fileBalance} /> : '—'}</td>
              <td className="ltr">{r.derivedBalance != null ? <Money v={r.derivedBalance} /> : '—'}</td>
              <td className="ltr">
                {r.fileBalance != null && r.derivedBalance != null
                  ? <Money v={r.fileBalance - r.derivedBalance} cls="red" /> : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted text-caption-micro" style={{ margin: '8px 0 0' }}>
        النطاق: مقاولون فقط (بادئة حساب 212) من أحدث استيراد لتقرير مديونيات مجمّع
        {importedAt ? ` (${arDate(importedAt)})` : ''} — استيراد لاحق للتقرير نفسه يستبدل
        هذه القائمة بالكامل.
      </p>
    </div>
  );
}

/** حذف بخطوتين — مطابق لحذف المورد: 409 بلا force يستوجب كتابة الرمز للتأكيد. */
function DeleteContractorModal({ row, onClose, onDeleted }:
  { row: ContractorRow; onClose: () => void; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needForce, setNeedForce] = useState(false);
  const [typed, setTyped] = useState('');

  async function tryDelete(force: boolean) {
    setBusy(true); setError(null);
    try {
      await api.deleteContractor(row.code, force);
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
    <Modal title="حذف مقاول" onClose={onClose}>
      <p>هل تريد حذف المقاول «{row.name}» (رمز {row.code})؟</p>
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
            لهذا المقاول حركات مسجّلة. للمتابعة، اكتب الرمز «{row.code}» أدناه لتأكيد الحذف النهائي.
          </div>
          <input
            style={{ marginTop: 10, width: '100%' }}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={row.code}
          />
          <div className="modal-foot">
            <button className="btn" onClick={onClose}>إلغاء</button>
            <button className="btn danger" disabled={busy || typed !== row.code}
                    onClick={() => tryDelete(true)}>
              {busy ? 'جارٍ الحذف…' : 'حذف نهائي'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
