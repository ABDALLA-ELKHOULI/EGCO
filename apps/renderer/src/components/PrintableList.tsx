import { useState, type ReactNode } from 'react';
import { arDate } from '@/lib/format';
import { State } from '@/components/ui';
import logoFull from '@/assets/logo-full.png';

/**
 * ورقة PDF مشتركة لقوائم الموردين والمقاولين — تعيد بالضبط نفس آلية Report.tsx:
 * حوار حفظ أصلي + printToPDF داخل التطبيق (window.egco.exportPdf)، ورجوع إلى
 * window.print() في المتصفح. لا آلية ثانية ولا مكتبة PDF جديدة في المشروع.
 *
 * البيانات كلها تُمرَّر جاهزة من الصفحة المستدعية (rows/totals من نفس استجابة
 * الخادم المصفّاة التي يعرضها الجدول التفاعلي) — هذا المكوّن لا يحسب مبلغاً
 * ولا يعيد فرزاً أو تصفيةً، فقط يعرض ما وُصِف له بالضبط.
 */
export type PrintableColumn = {
  key: string;
  label: string;
  ltr?: boolean;
  render: (row: any) => ReactNode;
};

export function PrintableList({
  docTitle, fileStamp, scopeLine, filterLine, countLabel,
  columns, rows, totalsCells, footNote, onBack,
}: {
  /** عنوان الوثيقة — «قائمة الموردين» أو «قائمة المقاولين» */
  docTitle: string;
  /** جزء اسم الملف عند الحفظ، بلا مسافات عربية إضافية */
  fileStamp: string;
  /** وصف مختصر أسفل العنوان، مثل ترتيب الجدول الافتراضي */
  scopeLine?: string;
  /** سطر التصفية النشطة كما يظهر على الشاشة — null إن لم توجد تصفية */
  filterLine: string | null;
  /** «١٢٣ نتيجة» كما يظهر في الشريط أعلى الجدول */
  countLabel: string;
  columns: PrintableColumn[];
  rows: any[];
  /** خلايا سطر الإجمالي، بنفس عدد وترتيب columns — من d.totals الجاهزة، لا حساب محلي */
  totalsCells: ReactNode[];
  footNote?: string;
  onBack: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const stamp = new Date().toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  // نفس دالة Report.tsx بالحرف: حوار حفظ أصلي داخل التطبيق، وwindow.print في المتصفح.
  async function exportPdf() {
    if (!window.egco?.exportPdf) { window.print(); return; }
    setExporting(true); setExportErr(null);
    const r = await window.egco.exportPdf({ filename: `EGCO-${fileStamp}-${stamp}.pdf`, landscape: true });
    setExporting(false);
    if (r.error) setExportErr(r.error);
  }

  return (
    <>
      <div className="page-head no-print">
        <div className="grow">
          <h1>{docTitle}</h1>
          <p>جاهزة للطباعة أو الحفظ بصيغة PDF</p>
        </div>
        <button className="btn" onClick={onBack}>رجوع إلى القائمة</button>
        <button className="btn primary" disabled={exporting} onClick={exportPdf}>
          {exporting ? 'جارٍ إنشاء PDF…' : 'طباعة / حفظ PDF'}
        </button>
      </div>
      {exportErr && <div className="no-print"><State>{exportErr}</State></div>}

      {/* .print-landscape تستدعي صفحة @page مسمّاة صراحةً (رأت tokens.css) —
          بدونها يتنازع حجم الصفحة مع قواعد @page أخرى في الملف والنتيجة حجمٌ
          عشوائي لا A4 أفقي كما طُلب من printToPDF. */}
      <div className="sheet print-landscape">
        <header className="rpt-head" style={{ alignItems: 'center', gap: 10 }}>
          <img src={logoFull} alt="" style={{ height: 34, width: 'auto', display: 'block', flex: 'none' }} />
          <div>
            <b>شركة إعمار الخليج المصرية للمقاولات</b>
            <span>الإدارة المالية — الفرع الرئيسي</span>
          </div>
        </header>
        <hr className="rule-ink" />

        <h1 className="rpt-title">{docTitle}</h1>
        <p className="rpt-sub">
          {countLabel} · تاريخ الإصدار {arDate(today)} · جميع الأرقام بالريال السعودي
          {scopeLine ? ` · ${scopeLine}` : ''}
        </p>
        {/* التصفية النشطة تُطبع مع الجدول — قرار يُبنى على ورقة مطبوعة يجب أن
            يعرف نطاقها، لا أن يظنّها القائمة الكاملة بصمت. */}
        <p className="rpt-sub muted">
          {filterLine ? `تصفية مطبَّقة: ${filterLine}` : 'بلا تصفية — القائمة كاملة'}
        </p>
        <hr />

        <div className="table-scroll wide">
          <table className="rpt-table">
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.ltr ? 'ltr' : undefined}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={r.account ?? r.code ?? i}>
                  {columns.map((c) => (
                    <td key={c.key} className={c.ltr ? 'ltr num' : undefined}>{c.render(r)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {totalsCells.map((cell, i) => (
                  <td key={columns[i]?.key ?? i} className={columns[i]?.ltr ? 'ltr num' : undefined}>
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>

        {footNote && (
          <p className="muted" style={{ fontSize: 11, margin: '10px 0 0' }}>{footNote}</p>
        )}

        <div className="rpt-foot">
          <hr />
          <p className="muted">وثيقة داخلية — {arDate(today)}</p>
        </div>
      </div>
    </>
  );
}
