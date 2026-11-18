/**
 * ExportDialog — معاينة + نسخ + تنزيل CSV (من prototype/ui.js «التصدير»)، وفي التطبيق الحقيقي:
 * Excel من الخادم (xlsxUrl) و PDF عبر جسر Electron (window.egco.exportPdf) أو طباعة المتصفح.
 */
import { useMemo, useRef, useState } from 'react';
import { Modal } from './Modal';
import { toast } from './Toast';
import { int } from './format';
import { usePrefs } from './prefs';

export interface CsvColumn<T> { label: string; value: (r: T) => unknown }

/** يبني CSV (فاصلة، اقتباس عند الحاجة). المبالغ تُمرَّر أرقاماً خاماً لا نصاً منسّقاً. */
export function toCSV<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const q = (x: unknown) => {
    const s = x == null ? '' : String(x);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.map((c) => q(c.label)).join(','), ...rows.map((r) => columns.map((c) => q(c.value(r))).join(','))].join('\r\n');
}

function parseCSV(text: string): string[][] {
  const out: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); out.push(row); }
  return out;
}

async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', '');
    ta.className = 'ex-raw'; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  }
}

export interface ExportDialogProps<T = unknown> {
  open: boolean;
  onClose: () => void;
  title?: string;
  fileName?: string;
  csv?: string;
  columns?: CsvColumn<T>[];
  rows?: T[];
  xlsxUrl?: string;
  pdf?: { filename: string; landscape?: boolean };
}

export function ExportDialog<T>(p: ExportDialogProps<T>) {
  usePrefs();
  const csv = useMemo(() => p.csv ?? (p.columns && p.rows ? toCSV(p.columns, p.rows) : ''), [p.csv, p.columns, p.rows]);
  const grid = useMemo(() => (csv ? parseCSV(csv) : []), [csv]);
  const head = grid[0] || [], body = grid.slice(1), shown = body.slice(0, 200);
  const fileName = p.fileName || 'تصدير.csv';
  const [note, setNote] = useState<string | null>(null);
  const raw = useRef<HTMLTextAreaElement>(null);

  const download = () => {
    try {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setNote('طُلب التنزيل. إن لم يظهر الملف استخدم «نسخ» ثم الصق في Excel.');
    } catch { setNote('تعذّر التنزيل هنا — استخدم «نسخ» ثم الصق في Excel.'); }
  };
  const copy = async () => {
    if (await copyText(csv)) toast('نُسخ الملف — الصقه في Excel أو أي محرر', { kind: 'ok' });
    else { raw.current?.classList.add('show'); raw.current?.select(); toast('حدّدنا النص — اضغط ⌘C / Ctrl+C للنسخ', { kind: 'info' }); }
  };
  const pdf = async () => {
    if (!p.pdf) return;
    if (typeof window.egco?.exportPdf === 'function') {
      const r = await window.egco.exportPdf(p.pdf);
      if (r.saved) toast('حُفظ ملف PDF', { kind: 'ok' });
      else if (r.error) toast('تعذّر حفظ PDF: ' + r.error, { kind: 'error' });
    } else window.print();
  };
  const actions = [
    { label: 'إغلاق', onClick: (close: (f?: boolean) => void) => close(true) },
    ...(p.pdf ? [{ label: 'PDF', onClick: pdf }] : []),
    ...(p.xlsxUrl ? [{ label: 'Excel', onClick: () => { window.open(p.xlsxUrl, '_blank'); } }] : []),
    ...(csv ? [{ label: 'تنزيل CSV', onClick: download }, { label: 'نسخ', kind: 'primary' as const, onClick: copy }] : []),
  ];
  return (
    <Modal open={p.open} onClose={p.onClose} title={p.title || 'تصدير'} size="lg" autoDirty={false} actions={actions}>
      {csv ? (
        <>
          <div className="ex-meta">
            <span className="pill n">{fileName}</span>
            <span className="cap"><span className="num">{int(body.length)}</span> صف · <span className="num">{int(head.length)}</span> عمود</span>
          </div>
          <div className="ex-prev tbl-wrap">
            <table>
              <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
              <tbody>{shown.map((r, i) => <tr key={i}>{head.map((_, j) => <td key={j}>{r[j] ?? ''}</td>)}</tr>)}</tbody>
            </table>
          </div>
          {body.length > shown.length && <p className="cap">تُعرض أول <span className="num">{int(shown.length)}</span> صفاً — النسخ والتنزيل يشملان الكل.</p>}
        </>
      ) : <p className="m-text">اختر صيغة التصدير.</p>}
      {note && <p className="disclose">{note}</p>}
      <textarea ref={raw} className="ex-raw" readOnly data-no-dirty aria-label="نص CSV" value={csv} />
    </Modal>
  );
}
