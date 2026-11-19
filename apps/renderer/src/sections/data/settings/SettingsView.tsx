/**
 * الإعدادات (P-331..351) — المظهر والتنبيهات (تفضيلات الهيكل)، الافتراضات، مكان
 * البيانات، النقل لجهاز آخر، تصنيفات الحسابات، المساعد الذكي، التحديثات، عن التطبيق،
 * ومنطقة الخطر (تصفير البيانات). التصميم من prototype/sections/data.js › renderSettings.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Button, Grid, Island, Modal, Num, PageHeader, Pill, Seg, THEME_LABEL, dateTxt, setPrefs, toast, usePrefs } from '@/ui';
import { useGo } from '@/app/routes';
import {
  useAiSettings, useAppInfo, useClassifications, useDataTransfer, usePaymentAllocation, useUpdates, useWipe,
} from '../hooks/useSettings';
import { inApp } from '../hooks/useAsync';
import { CLASS_LABEL, CLASS_ORDER, NOT_IN_APP } from '../lib/labels';
import { latestTour } from '../lib/tours';
import { Callout } from '../import/parts';
import { WhatsNewTour } from '../whatsnew/WhatsNewTour';
import type { ClassKind, Note } from '../types';
import '../data.css';

function Row({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return <div className="srow"><div><div className="slbl">{label}</div>{help && <div className="cap">{help}</div>}</div><div className="sctl">{children}</div></div>;
}
function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return <button type="button" className="sw" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={onChange}><i /></button>;
}
function useNoteToast(note: Note | null) {
  useEffect(() => { if (note) toast(note.text, { kind: note.ok ? 'ok' : 'error' }); }, [note]);
}

export default function SettingsView() {
  const prefs = usePrefs();
  const go = useGo();
  const app = inApp();
  const { health, info, revealDataDir } = useAppInfo();
  const [tourOpen, setTourOpen] = useState(false);
  const tour = latestTour(info?.version);

  return (
    <div className="sec-data">
      <PageHeader title="الإعدادات" sub="البيانات محفوظة على هذا الجهاز فقط — لا يوجد اتصال بأي خادم خارجي"
        actions={tour && <Button onClick={() => setTourOpen(true)}>ما الجديد</Button>} />
      <Grid>
        <Island span={6} i={0} title="المظهر">
          <Row label="الوضع">
            {/* أزرار بدل <Seg> لأن QA يحتاج data-testid لكل خيار (Seg لا يمرّرها) */}
            <div className="seg" role="group" aria-label="الوضع">
              {(['system', 'light', 'dark'] as const).map((v) => (
                <button key={v} type="button" aria-pressed={prefs.theme === v} data-testid={`theme-${v === 'system' ? 'auto' : v}`}
                  onClick={() => setPrefs({ theme: v })}>{THEME_LABEL[v]}</button>
              ))}
            </div>
          </Row>
          <Row label="الأرقام" help="تُطبَّق على كل الأرقام والتواريخ">
            <Seg label="الأرقام" value={prefs.digits} onChange={(v) => setPrefs({ digits: v })}
              options={[{ value: 'latin', label: '123' }, { value: 'arab', label: '١٢٣' }]} />
          </Row>
        </Island>

        <Island span={6} i={1} title="التنبيهات">
          <Row label="إشعارات النظام" help="تنبيه خارج التطبيق عند عجز نقدي متوقع أو فشل نسخة احتياطية — حين تكون النافذة في الخلفية">
            <Switch on={prefs.osNotifications} label="إشعارات النظام" disabled={!app} onChange={() => setPrefs({ osNotifications: !prefs.osNotifications })} />
          </Row>
          <Row label="جزيرة الحالة" help="الشريط العائم أعلى الشاشة: الاستيراد والنسخ والعجز. مطفأة = أحداث الخطر فقط">
            <Switch on={prefs.island} label="جزيرة الحالة" onChange={() => setPrefs({ island: !prefs.island })} />
          </Row>
        </Island>

        <DefaultsCard />
        <ClassificationsCard />
        <AiCard />

        <Island span={6} i={5} title="البيانات والنقل إلى جهاز آخر">
          <ul className="assume">
            <li><span>مكان قاعدة البيانات</span><b className="ltr">{health?.db ?? '—'}</b></li>
            <li><span>مجلد التطبيق</span><b className="ltr">{info?.dataDir ?? '—'}</b></li>
            <li><span>نظام التشغيل</span><b className="ltr">{info?.platform ?? 'متصفح'}</b></li>
          </ul>
          <TransferBlock />
          <div className="rowacts">
            <Button size="sm" disabled={!app} onClick={() => void revealDataDir()}>فتح مجلد البيانات</Button>
          </div>
        </Island>

        <UpdatesCard version={info?.version} onWhatsNew={tour ? () => setTourOpen(true) : undefined} />

        <Island span={6} i={7} title="عن التطبيق">
          <ul className="assume">
            <li><span>إصدار التطبيق</span><b className="num">{info?.version ?? '—'}</b></li>
            <li><span>إصدار الخدمة</span><b className="num">{health?.version ?? '—'}</b></li>
            <li><span>الاتصال بالشبكة</span><b>لا يوجد — يعمل دون إنترنت</b></li>
            <li><span>اختصارات</span><b className="ltr">⌘K · ⌘.</b></li>
          </ul>
          <p className="cap">حذف مورد أو مقاول أو استيراد لا يمحو شيئاً فعلياً — يبقى في المحذوفات قابلاً للاسترجاع. ومن «إدارة المشاريع»: دمج مشروعين ظهرا باسمين مختلفين.</p>
          <div className="rowacts">
            <Button size="sm" onClick={() => go('data.trash')}>المحذوفات</Button>
            <Button size="sm" onClick={() => go('data.backups')}>النسخ الاحتياطي</Button>
            <Button size="sm" onClick={() => go('projects.admin')}>المشاريع والدمج</Button>
          </div>
        </Island>

        <DangerZone />
      </Grid>
      {tourOpen && tour && <WhatsNewTour tours={[tour]} onClose={() => setTourOpen(false)} />}
    </div>
  );
}

/** P-342 (عرض) + تخصيص الدفعات (P-081/P-543). تعديل مدة السداد/رصيد البنك من النموذج لا مسار له بعد. */
function DefaultsCard() {
  usePrefs();
  const a = usePaymentAllocation();
  useNoteToast(a.note);
  return (
    <Island span={6} i={2} title="الافتراضات">
      <ul className="assume">
        <li><span>مدة السداد عند غياب القيمة</span><b>كاش — استحقاق فوري</b></li>
        <li><span>طريقة توزيع الدفعات</span><b>الأقدم أولاً (FIFO)</b></li>
        <li><span>نافذة التنبيه</span><b><Num value={7} int /> أيام</b></li>
        <li><span>عتبة قِدَم الكشف (التغطية)</span><b><Num value={90} int /> يوماً</b></li>
      </ul>
      <Row label="تخصيص الدفعات على الفواتير" help="إعداد عام: عند التفعيل، الدفعات الغامضة تُعلَّق بانتظار قرارك في صفحة المورد بدل تخمين الفاتورة">
        {a.enabled === undefined ? <span className="cap">{a.error ?? '…'}</span>
          : <Switch on={a.enabled} label="تخصيص الدفعات" disabled={a.busy} onChange={() => void a.toggle()} />}
      </Row>
    </Island>
  );
}

/** P-347 — حسابات ببادئة غير معروفة صنّفها المستخدم من شاشة الرفع. */
function ClassificationsCard() {
  usePrefs();
  const c = useClassifications();
  return (
    <Island span={6} i={3} title="تصنيفات الحسابات">
      <p className="cap">حسابات برقم بادئة غير معروفة (ليست ٢١١/٢١٢/٢١٦) صنّفتها يدوياً من شاشة الرفع — تُطبَّق تلقائياً في كل رفع قادم.</p>
      {c.error && <Callout tone="bad">{c.error}</Callout>}
      {c.rows && c.rows.length === 0 && <p className="empty-note">لا توجد تصنيفات محفوظة بعد.</p>}
      {c.rows && c.rows.length > 0 && (
        <ul className="cls">
          {c.rows.map((r) => (
            <li key={r.account}>
              <div><b className="num ltr">{r.account}</b><div className="cap">{r.name || '—'}{r.decidedAt ? ` · ${dateTxt(r.decidedAt)}` : ''}</div></div>
              <Seg<ClassKind> label={`تصنيف ${r.account}`} value={r.kind}
                onChange={(k) => void c.change(r.account, k, r.name)}
                options={CLASS_ORDER.map((k) => ({ value: k, label: CLASS_LABEL[k] }))} />
              <Button size="sm" disabled={c.busy === r.account} onClick={async () => {
                await c.remove(r.account);
                toast(`أُزيل تصنيف ${r.account} — سيُسأل عنه في الرفع القادم`, { kind: 'ok', undo: () => void c.change(r.account, r.kind, r.name) });
              }}>{c.busy === r.account ? '…' : 'إزالة'}</Button>
            </li>
          ))}
        </ul>
      )}
    </Island>
  );
}

/** P-345/346 — مزوّد متوافق مع OpenAI. المفتاح يعود من الخادم مقنّعاً «•••». */
function AiCard() {
  usePrefs();
  const a = useAiSettings();
  useNoteToast(a.note);
  const d = a.draft;
  return (
    <Island span={6} i={4} title="مساعد قراءة الملفات (ذكاء اصطناعي)">
      {!d ? (a.loadError ? <Callout tone="bad">{a.loadError}</Callout> : <p className="cap">جارٍ التحميل…</p>) : (
        <>
          <Row label="تفعيل المساعد" help="يُستعمل فقط حين يفشل القارئ العادي في فهم ملف — والتطبيق يعمل كاملاً بدونه">
            <Switch on={d.enabled} label="تفعيل المساعد" onChange={() => a.set({ enabled: !d.enabled })} />
          </Row>
          <div className="fgrid">
            <label className="fld"><span className="cap">المزوّد</span>
              <input value={d.provider} placeholder="OpenAI / DeepSeek / Groq / Ollama…" onChange={(e) => a.set({ provider: e.target.value })} /></label>
            <label className="fld"><span className="cap">النموذج</span>
              <input dir="ltr" value={d.model} placeholder="gpt-4o-mini" onChange={(e) => a.set({ model: e.target.value })} /></label>
            <label className="fld"><span className="cap">عنوان الخدمة (baseUrl)</span>
              <input dir="ltr" value={d.baseUrl} placeholder="https://api.openai.com/v1" onChange={(e) => a.set({ baseUrl: e.target.value })} /></label>
            <label className="fld"><span className="cap">مفتاح API</span>
              <input dir="ltr" type="password" autoComplete="off"
                placeholder={a.keyMasked ? 'محفوظ — اتركه فارغاً للإبقاء عليه' : 'فارغ لمزود محلي'}
                value={d.apiKey === '•••' ? '' : d.apiKey}
                onChange={(e) => a.set({ apiKey: e.target.value || (a.keyMasked ? '•••' : '') })} /></label>
            <label className="fld"><span className="cap">حد الرموز (maxTokens)</span>
              <input dir="ltr" type="number" min={100} value={d.maxTokens} onChange={(e) => a.set({ maxTokens: Number(e.target.value) || 0 })} /></label>
          </div>
          <p className="note">البيانات تُرسل للمزوّد المختار فقط عند التفعيل. الذكاء يقرأ ويكتب نصاً فقط — كل رقم يأتي من محرك الحساب المختبَر.</p>
          <div className="rowacts">
            <Button kind="primary" size="sm" disabled={a.busy !== null || (d.maxTokens > 0 && d.maxTokens < 100)} onClick={() => void a.save()}>{a.busy === 'save' ? 'جارٍ الحفظ…' : 'حفظ'}</Button>
            <Button size="sm" disabled={a.busy !== null} onClick={() => void a.test()}>{a.busy === 'test' ? 'جارٍ الاختبار…' : 'اختبار الاتصال'}</Button>
          </div>
          {a.layouts.length > 0 && (
            <>
              <h3 className="slbl mt">أنماط الملفات المتعلَّمة</h3>
              <p className="cap">حين يتعرّف المساعد على شكل ملف مرة، يحفظ قاعدة استخراج محلية — أي ملف لاحق بنفس الشكل يُقرأ بلا اتصال بالنموذج.</p>
              <ul className="assume">
                {a.layouts.map((l) => (
                  <li key={l.id}>
                    <span>{l.sampleName || l.sampleAccount || l.sourceKind}{l.lastUsedAt && <span className="cap"> · آخر استخدام {dateTxt(l.lastUsedAt)}</span>}</span>
                    <b>استُخدم <Num value={l.hitCount} int /> {l.hitCount === 1 ? 'مرة' : 'مرات'}{l.approxTokensSaved > 0 && <> · وفّر ~<Num value={l.approxTokensSaved} int /> رمز</>}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Island>
  );
}

/** P-341 — ملف بيانات واحد (نسخة متّسقة). الاستيراد يأخذ «قبل الاستيراد» ثم يعيد التشغيل. */
function TransferBlock() {
  const t = useDataTransfer();
  useNoteToast(t.note);
  const app = inApp();
  return (
    <>
      <p className="cap mt">كل بياناتك في ملف واحد: صدِّره هنا (يُؤخذ كنسخة متّسقة أولاً)، انقله للجهاز الآخر، واستورده من نفس الشاشة. الاستيراد يحفظ نسخة «قبل الاستيراد» تلقائياً ثم يعيد تشغيل التطبيق.</p>
      <div className="rowacts">
        <Button size="sm" kind="primary" disabled={!app || t.busy !== null} onClick={() => void t.exportData()}>{t.busy === 'export' ? 'جارٍ التصدير…' : 'تصدير نسخة من البيانات'}</Button>
        <Button size="sm" disabled={!app || t.busy !== null} onClick={() => void t.importData()}>{t.busy === 'import' ? '…' : 'استيراد ملف بيانات'}</Button>
      </div>
      {t.note?.ok && <Callout tone="ok">{t.note.text}</Callout>}
      {!app && <Callout>{NOT_IN_APP}</Callout>}
    </>
  );
}

/** P-350 — فحص يدوي؛ كل حالة كما هي بما فيها نص الخطأ الفعلي. */
function UpdatesCard({ version, onWhatsNew }: { version?: string; onWhatsNew?: () => void }) {
  const u = useUpdates();
  const app = inApp();
  const s = u.status;
  return (
    <Island span={6} i={6} title="التحديثات">
      <Row label="الإصدار الحالي"><b className="num">{version ?? '—'}</b></Row>
      <div aria-live="polite">
        {s?.state === 'checking' && <p className="cap"><span className="spin" aria-hidden="true" /> جارٍ الفحص…</p>}
        {s?.state === 'unavailable-dev' && <Callout>فحص التحديثات غير متاح في وضع التطوير — يعمل فقط في النسخة المُثبَّتة.</Callout>}
        {s?.state === 'up-to-date' && <Callout tone="ok">أنت على أحدث إصدار (<span className="num">{s.version}</span>)</Callout>}
        {s?.state === 'available' && <Callout>يتوفر إصدار جديد (<span className="num">{s.version}</span>) — جارٍ التنزيل…</Callout>}
        {s?.state === 'downloading' && <Callout>يتوفر إصدار جديد — جارٍ التنزيل… <Num value={s.percent} int />٪</Callout>}
        {s?.state === 'downloaded' && (
          <Callout tone="ok">تم تنزيل الإصدار (<span className="num">{s.version}</span>) — نسخة احتياطية «قبل التحديث» أُخذت. أعد التشغيل للتثبيت.
            <div className="rowacts"><Button kind="primary" size="sm" onClick={() => void u.install()}>إعادة التشغيل والتثبيت الآن</Button></div>
          </Callout>
        )}
        {s?.state === 'error' && <Callout tone="bad">تعذّر التحقق من التحديثات<div className="cap ltr">{s.message}</div></Callout>}
      </div>
      <p className="cap">التطبيق يتحدّث بصمت في الخلفية ويعرض «ما الجديد» عند أول فتح بعد كل تحديث.</p>
      <div className="rowacts">
        <Button size="sm" disabled={!app || u.busy} onClick={() => void u.check()}>{u.busy ? 'جارٍ الفحص…' : 'تحقق من التحديثات'}</Button>
        {onWhatsNew && <Button size="sm" onClick={onWhatsNew}>ما الجديد في هذا الإصدار</Button>}
      </div>
      {!app && <Callout>{NOT_IN_APP}</Callout>}
    </Island>
  );
}

/**
 * P-348 — تصفير البيانات. ثلاثة حواجز: الأعداد الحقيقية لكل جدول، كتابة العبارة التي
 * يرسلها الخادم (الكتابة تُجبر على القراءة)، وقائمة صريحة بما يبقى. الخادم يأخذ نسخة
 * «قبل التصفير» ويُلغي العملية إن فشلت؛ اسمها يُعرض بعد النجاح.
 */
function DangerZone() {
  usePrefs();
  const w = useWipe();
  return (
    <Island i={8} className="dz" title="منطقة الخطر">
      <Row label="تصفير جميع البيانات"
        help="يمحو كل ما رُفع وأُدخل — الموردون والمقاولون والفواتير والدفعات والضمانات والتحصيلات والموازنة — ويُبقي إعداداتك. بعد نسخة احتياطية تلقائية.">
        <Button size="sm" kind="danger" disabled={w.busy} onClick={() => void w.open()}>تصفير البيانات…</Button>
      </Row>
      {w.err && !w.preview && <Callout tone="bad">{w.err}</Callout>}
      {w.done && (
        <Callout tone="ok">تم التصفير — حُذف <Num value={w.done.totalDeleted} int /> سجلاً.
          {w.done.backup && <> النسخة الاحتياطية: <b className="ltr">{w.done.backup}</b></>}
          <div className="cap">يُعاد تحميل التطبيق…</div>
        </Callout>
      )}
      {w.preview && (
        <Modal open onClose={w.close} title="تصفير جميع البيانات" size="md"
          actions={w.preview.isEmpty ? [{ label: 'إغلاق' }] : [
            { label: 'إلغاء', disabled: w.busy },
            { label: w.busy ? 'جارٍ التصفير…' : 'تصفير نهائي', kind: 'danger', disabled: !w.ready || w.busy, onClick: async () => { await w.run(); } },
          ]}>
          <div className="sec-data">
            {w.preview.isEmpty ? <p>لا توجد بيانات لحذفها — التطبيق فارغ أصلاً.</p> : (
              <>
                <Callout tone="bad">سيُحذف <b className="num"><Num value={w.preview.totalRows} int /></b> سجلاً نهائياً. لا يمكن التراجع عن هذا إلا باستعادة النسخة الاحتياطية.</Callout>
                <ul className="wipe">
                  {w.preview.wipes.filter((r) => r.count > 0).map((r) => <li key={r.table}><Num value={r.count} int /> {r.label}</li>)}
                </ul>
                <p className="slbl">يبقى كما هو:</p>
                <ul className="wipe cap">
                  {w.preview.keeps.map((r) => <li key={r.table}>{r.label}</li>)}
                  <li>كل النسخ الاحتياطية السابقة</li>
                </ul>
                <label className="fld"><span className="cap">للمتابعة اكتب «<b>{w.preview.confirmPhrase}</b>»</span>
                  <input autoFocus autoComplete="off" aria-label="تأكيد التصفير" value={w.phrase} placeholder={w.preview.confirmPhrase}
                    onChange={(e) => w.setPhrase(e.target.value)} /></label>
                {w.err && <Callout tone="bad">{w.err}</Callout>}
                {w.ready && <p className="cap"><Pill tone="danger">جاهز</Pill> اضغط «تصفير نهائي» للتنفيذ.</p>}
              </>
            )}
          </div>
        </Modal>
      )}
    </Island>
  );
}
