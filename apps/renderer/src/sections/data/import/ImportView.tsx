/**
 * رفع الملفات — منطقة الاختيار، المعاينة («لم يُحفظ شيء بعد»)، زر حفظ واحد، النتيجة،
 * سجل الاستيراد، والتكرارات القائمة. التصميم من prototype/sections/data.js › renderImport.
 *
 * عام: لا يعرف أنواع الملفات — انظر hooks/useImportSession.ts و lib/preview.ts.
 */
import { useCallback, useState } from 'react';
import { Button, Grid, Island, Num, PageHeader, toast, usePrefs } from '@/ui';
import { useGo } from '@/app/routes';
import { invalidate } from '@/data/queryClient';
import { useImportSession } from '../hooks/useImportSession';
import { useAiEnabled } from '../hooks/useSettings';
import { QUEUE_CHIP } from '../lib/labels';
import { BatchSummaryBanner, Callout, FileCard } from './parts';
import { BatchResultCard, BatchScanCard } from './Batch';
import { DuplicatesSection, HistorySection } from './History';
import { ClassifyModal, type ClassifyTarget } from './ClassifyModal';
import { AiRescueModal } from './AiRescueModal';
import '../data.css';

export default function ImportView() {
  usePrefs();
  const go = useGo();
  const aiEnabled = useAiEnabled();
  const [reloadToken, setReloadToken] = useState(0);
  // بعد أي حفظ/حذف: السجل هنا + كل شاشة تعرض أرقاماً (الخادم يبثّ invalidate أيضاً، هذا احتياط).
  const changed = useCallback(() => {
    setReloadToken((n) => n + 1);
    try { void invalidate(['imports', 'overview', 'today', 'dashboard', 'suppliers', 'supplier', 'contractors', 'contractor', 'coverage', 'trash', 'projects', 'budgetPlan']); } catch { /* الطبقة غير جاهزة */ }
  }, []);
  const s = useImportSession(changed);
  const [classify, setClassify] = useState<ClassifyTarget | null>(null);
  const [rescue, setRescue] = useState<{ path: string; name: string } | null>(null);

  const inPreview = s.queue.length > 0;
  const savedCount = s.queue.filter((q) => q.status === 'saved').length;

  return (
    <div className="sec-data">
      <PageHeader title="رفع الملفات"
        sub="كشوف الحساب وملفات الموردين والتقارير المجمّعة — يُعرض ما سيتغيّر قبل الحفظ، وتؤخذ نسخة احتياطية قبل كل استيراد"
        actions={<>
          {!s.idle && <Button onClick={s.reset} disabled={s.saving || s.batchBusy}>اختيار من جديد</Button>}
          <Button kind="primary" icon="file" onClick={() => void s.pickFiles()} disabled={s.saving}>اختيار ملفات</Button>
        </>} />
      <Grid>
        {s.idle && (
          <Island i={0}>
            {/* الإسقاط بالسحب يحتاج مسار الملف ونوعه من الجسر — النقر يفتح نافذة النظام */}
            <div className="drop" tabIndex={0} role="button" aria-label="اضغط لاختيار الملفات"
              onClick={() => void s.pickFiles()}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void s.pickFiles(); } }}>
              <b>اضغط لاختيار الملفات (يمكن تحديد أكثر من ملف)</b>
              <span className="cap">يتعرّف التطبيق على نوع كل ملف تلقائياً — كشف حساب، ملف مدد الموردين، تقرير مديونيات مجمّع، موازنة…</span>
            </div>
            <div className="pickrow">
              <Button size="sm" onClick={() => void s.pickFolder()} disabled={s.scanning}>{s.scanning ? 'جارٍ فحص المجلد…' : 'اختيار مجلد كامل'}</Button>
              <span className="cap">لا شيء يُحفظ قبل أن تراجع المعاينة وتضغط «حفظ»</span>
            </div>
          </Island>
        )}

        {s.pickErr && <Island i={0}><Callout tone="bad">{s.pickErr}</Callout></Island>}

        <BatchScanCard s={s} />
        <BatchResultCard s={s} aiEnabled={aiEnabled}
          onClassify={(r) => setClassify({ path: r.path, fileName: r.name, account: r.account ?? '', parsedName: r.supplierName ?? '' })}
          onRescue={(r) => setRescue({ path: r.path, name: r.name })} />

        {inPreview && (
          <Island i={1} title={s.done ? 'نتيجة الحفظ' : 'المعاينة — لم يُحفظ شيء بعد'} actions={<span className="cap"><Num value={s.queue.length} int /> ملف</span>}>
            {s.done && (
              <BatchSummaryBanner total={s.queue.length} saved={savedCount}
                failures={s.queue.filter((q) => q.status !== 'saved').map((q) => ({
                  name: q.file.name,
                  reason: q.error ?? (q.status === 'excluded' ? 'مُستبعد — لم يتطابق مع رصيد الكشف أو حدث خطأ قراءة' : QUEUE_CHIP[q.status].text),
                }))} />
            )}
            <div className="fcards">
              {s.queue.map((item, i) => (
                <FileCard key={item.file.path + i} item={item} i={i} aiEnabled={aiEnabled}
                  canRemove={!s.saving && !s.done && item.status !== 'saving'}
                  onRemove={() => s.dropFile(i)}
                  onRescue={() => setRescue({ path: item.file.path, name: item.file.name })}
                  onClassify={(account, name) => setClassify({ path: item.file.path, fileName: item.file.name, account, parsedName: name, queueIdx: i })}
                  onConfirmNew={async (f) => { await s.confirmNewParty(i, f); toast('أُنشئ الحساب وحُفظ الكشف', { kind: 'ok' }); }}
                  onDeclineNew={() => s.declineNewParty(i)}
                  onConfirmProject={async () => { await s.confirmProject(i); toast('أُنشئ المشروع وحُفظت الخطة التقديرية', { kind: 'ok' }); }}
                  onForceAccounts={async (accts) => { await s.forceAccounts(i, accts); toast(`حُفظ ${accts.length} حساب رغم الفرق`, { kind: 'ok' }); }} />
              ))}
            </div>
            <div className="confirmbar">
              {!s.done ? (
                <>
                  <div className="cap" aria-live="polite">
                    {s.stillReading ? 'جارٍ القراءة…'
                      : s.savable.length ? <>سيُحفظ <Num value={s.savable.length} int /> ملف · غير المطابق وخطأ القراءة يُستبعدان · نسخة «قبل الاستيراد» تؤخذ تلقائياً</>
                        : 'لا شيء جاهز للحفظ'}
                    {s.blockedByClass > 0 && <> · <Num value={s.blockedByClass} int /> ملف فيه حسابات تنتظر تصنيفك (تُحفظ بقيته)</>}
                  </div>
                  <div className="acts">
                    <Button onClick={s.reset} disabled={s.saving}>مسح الكل</Button>
                    <Button kind="primary" disabled={!s.canSave} onClick={() => void s.saveAll()}>
                      {s.saving ? 'جارٍ الحفظ…' : <>حفظ الملفات المطابقة (<Num value={s.savable.length} int />)</>}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="cap">انتهى الحفظ — راجع الأرقام في صفحات الأطراف واليوم.</div>
                  <div className="acts">
                    <Button onClick={() => go('parties.suppliers')}>عرض الموردين</Button>
                    <Button onClick={() => go('today.summary')}>اليوم</Button>
                    <Button kind="primary" onClick={s.reset}>رفع ملفات أخرى</Button>
                  </div>
                </>
              )}
            </div>
          </Island>
        )}

        {s.batch && (
          <Island i={2}>
            <div className="rowacts tight">
              <Button onClick={() => go('parties.suppliers')}>عرض الموردين</Button>
              <Button onClick={() => go('today.summary')}>اليوم</Button>
              <Button kind="primary" onClick={s.reset}>رفع ملفات أخرى</Button>
            </div>
          </Island>
        )}

        <HistorySection reloadToken={reloadToken} onPickFiles={() => void s.pickFiles()} onChanged={changed} />
        <DuplicatesSection reloadToken={reloadToken} onChanged={changed} />
      </Grid>

      {classify && (
        <ClassifyModal target={classify} aiEnabled={aiEnabled} onClose={() => setClassify(null)}
          onSaved={() => {
            const t = classify; setClassify(null);
            toast(`صُنّف الحساب ${t.account} — سنتذكّره`, { kind: 'ok' });
            if (t.queueIdx !== undefined) void s.previewOne(t.queueIdx);
            else void s.reimportBatchRow(t.path);
          }} />
      )}
      {rescue && <AiRescueModal path={rescue.path} fileName={rescue.name} onClose={() => setRescue(null)} onSaved={changed} />}
    </div>
  );
}
