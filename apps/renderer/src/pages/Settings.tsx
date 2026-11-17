import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, AiSettings, BackupInfo, ImportClassification, LearnedLayout,
         ResetPreview, ResetResult } from '@/lib/api';
import { Card, ErrorState, Pill, State } from '@/components/ui';
import type { UpdateStatus } from '@/types/global';
import { Modal } from '@/components/Modal';
import { WhatsNewModal } from '@/components/WhatsNewModal';
import { WHATS_NEW } from '@/lib/whatsNew';

export function Settings() {
  const [info, setInfo] = useState<{ version: string; platform: string; dataDir: string } | null>(null);
  const [health, setHealth] = useState<{ status: string; db: string; version: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');
  const [showWhatsNew, setShowWhatsNew] = useState(false);

  useEffect(() => {
    api.health().then(setHealth);
    window.egco?.info().then(setInfo);
  }, []);

  // الاختيار يُحفظ محلياً — كان يضيع مع كل إعادة تشغيل فيعود التطبيق نهارياً بلا سبب.
  // The choice is persisted; it used to reset to light on every reload.
  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('egco-theme', next); } catch { /* وضع خاص */ }
    setTheme(next);
  }

  if (!health) return <State>جارٍ التحميل…</State>;

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>الإعدادات</h1>
          <p>البيانات محفوظة على هذا الجهاز فقط — لا يوجد اتصال بأي خادم خارجي</p>
        </div>
      </div>

      <div className="stack">
        <Card title="البيانات">
          <div className="card-body">
            <Row label="مكان قاعدة البيانات" value={health.db} />
            <Row label="مجلد التطبيق" value={info?.dataDir ?? '—'} />
            <Row label="نظام التشغيل" value={info?.platform ?? 'متصفح'} />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => window.egco?.revealDataDir()}
                      disabled={!window.egco}>فتح المجلد</button>
            </div>
          </div>
        </Card>

        <BackupCard />

        <Card title="النقل إلى جهاز آخر">
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
              كل بياناتك في ملف واحد. صدّره هنا (يُؤخذ كنسخة متّسقة أولاً)، وانقله للجهاز
              الآخر، واستورده من نفس الشاشة — لا حاجة للبحث عن الملفات في النظام، ولا
              إنترنت ولا حساب. الاستيراد يحفظ نسخة «قبل الاستيراد» تلقائياً.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <button className="btn primary" disabled={!window.egco || busy}
                      onClick={async () => {
                        setBusy(true); setMsg(null);
                        const r = await window.egco!.exportData();
                        setBusy(false);
                        if (r.canceled) return;
                        setMsg(r.ok
                          ? { ok: true, text: `تم التصدير إلى: ${r.path}` }
                          : { ok: false, text: r.error ?? 'تعذّر التصدير' });
                      }}>
                تصدير نسخة من البيانات
              </button>
              <button className="btn" disabled={!window.egco || busy}
                      onClick={async () => {
                        setBusy(true); setMsg(null);
                        const r = await window.egco!.importData();
                        setBusy(false);
                        if (r.canceled) return;
                        // النجاح يعيد تشغيل التطبيق، فلا رسالة نجاح تُرى
                        if (!r.ok) setMsg({ ok: false, text: r.error ?? 'تعذّر الاستيراد' });
                      }}>
                استيراد ملف بيانات
              </button>
            </div>
            {msg && (
              <div className={'callout ' + (msg.ok ? 'ok' : 'bad')} style={{ marginTop: 12 }}>
                {msg.text}
              </div>
            )}
            {!window.egco && (
              <div className="callout note" style={{ marginTop: 12 }}>
                متاح داخل التطبيق فقط (وليس في المتصفح).
              </div>
            )}
          </div>
        </Card>

        <Card title="الافتراضات">
          <div className="card-body">
            <Row label="مدة السداد عند غياب القيمة" value="كاش — استحقاق فوري" />
            <Row label="طريقة توزيع الدفعات" value="الأقدم أولاً (FIFO)" />
            <Row label="نافذة التنبيه" value="٧ أيام" />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={toggleTheme}>
                {theme === 'dark' ? 'الوضع النهاري' : 'الوضع الليلي'}
              </button>
            </div>
          </div>
        </Card>

        <Card title="المحذوفات وإدارة المشاريع">
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
              حذف مورد أو مقاول أو استيراد لا يمحو شيئاً فعلياً — يبقى في السلّة
              قابلاً للاسترجاع مع فواتيره وحركاته، حتى تحذفه نهائياً بنفسك.
              ومن نفس المكان: دمج مشروعين ظهرا باسمين مختلفين لنفس الموقع.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
              <Link className="btn" to="/settings/trash">المحذوفات</Link>
              <Link className="btn" to="/settings/projects">المشاريع والدمج</Link>
            </div>
          </div>
        </Card>

        <AiCard />

        <ClassificationsCard />

        <ResetCard />

        <Card title="عن التطبيق">
          <div className="card-body">
            <Row label="إصدار التطبيق" value={info?.version ?? '—'} />
            <Row label="إصدار الخدمة" value={health.version} />
            <Row label="الاتصال بالشبكة" value="لا يوجد — يعمل دون إنترنت" cls="ok" />
            {WHATS_NEW.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => setShowWhatsNew(true)}>
                  ما الجديد في هذا الإصدار
                </button>
              </div>
            )}
          </div>
        </Card>

        {showWhatsNew && WHATS_NEW.length > 0 && (
          <WhatsNewModal
            tours={[WHATS_NEW[WHATS_NEW.length - 1]]}
            onClose={() => setShowWhatsNew(false)}
          />
        )}

        <UpdateCard currentVersion={info?.version} />
      </div>
    </>
  );
}

const BACKUP_KIND_LABEL: Record<string, string> = {
  daily: 'يومية', manual: 'يدوية', 'before-update': 'قبل التحديث',
  'before-import': 'قبل الاستيراد', 'before-restore': 'قبل الاستعادة', legacy: 'قديمة',
};

function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} م.ب`;
  return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
}

/** «قبل ٣ ساعات» / «قبل يومين» — لسطر حالة آخر نسخة يومية. */
function fmtAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return 'قبل أقل من ساعة';
  if (h < 24) return `قبل ${h} ${h === 1 ? 'ساعة' : h === 2 ? 'ساعتين' : h <= 10 ? 'ساعات' : 'ساعة'}`;
  const d = Math.floor(h / 24);
  return `قبل ${d} ${d === 1 ? 'يوم' : d === 2 ? 'يومين' : d <= 10 ? 'أيام' : 'يوماً'}`;
}

/**
 * م-٤٥ — شبكة أمان البيانات. قبلها كانت النسخة الوحيدة المجدولة `before-update-*`
 * عند تنزيل تحديث، والتصدير ينسخ قاعدة حيّة. هنا: قائمة كل النسخ (بما فيها ما
 * يكتبه Electron)، نسخة يدوية متّسقة، استعادة عبر IPC (تأخذ نسخة قبلها ثم تعيد
 * التشغيل)، ومجلد خارجي (iCloud/Drive) تُنسخ إليه كل نسخة. النسخة اليومية تُطلب
 * عند فتح هذه الشاشة: الخادم يأخذها فقط إن مضى يوم على آخر واحدة.
 */
function BackupCard() {
  const [items, setItems] = useState<BackupInfo[] | null>(null);
  const [lastDaily, setLastDaily] = useState<BackupInfo | null>(null);
  const [externalDir, setExternalDir] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function load() {
    setErr(null);
    api.backups().then((r) => {
      setItems(r.items);
      setLastDaily(r.items.find((b) => b.kind === 'daily') ?? null);
    }).catch((e) => setErr(e instanceof ApiError ? e.message : 'تعذّر تحميل النسخ'));
    api.backupSettings().then((r) => setExternalDir(r.externalDir)).catch(() => undefined);
  }

  useEffect(() => {
    // اليومية أولاً ثم القائمة — حتى تظهر النسخة التي أُخذت للتو في الجدول
    api.backupDailyIfDue()
      .then((r) => { if (r.taken && r.backup?.warning) setNote({ ok: false, text: r.backup.warning }); })
      .catch(() => undefined)
      .finally(load);
  }, []);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key); setNote(null);
    try { await fn(); } catch (e) {
      setNote({ ok: false, text: e instanceof ApiError ? e.message : String(e) });
    } finally { setBusy(null); }
  }

  const backupNow = () => run('now', async () => {
    const r = await api.createBackup();
    setNote(r.backup.warning
      ? { ok: false, text: `أُخذت النسخة محلياً، لكن: ${r.backup.warning}` }
      : { ok: true, text: `أُخذت نسخة: ${r.backup.name} (${fmtSize(r.backup.size_bytes)})` });
    load();
  });

  const restore = (b: BackupInfo) => run(`restore:${b.name}`, async () => {
    const r = await window.egco!.restoreBackup(b.name);
    if (r.canceled) return;
    // النجاح يعيد تشغيل التطبيق، فلا رسالة نجاح تُرى
    if (!r.ok) setNote({ ok: false, text: r.error ?? 'تعذّرت الاستعادة' });
  });

  const remove = (b: BackupInfo) => run(`del:${b.name}`, async () => {
    if (!window.confirm(`حذف النسخة ${b.name} نهائياً؟`)) return;
    await api.deleteBackup(b.name);
    load();
  });

  const pickExternal = () => run('ext', async () => {
    const dir = await window.egco!.pickExternalBackupDir();
    if (!dir) return;
    const r = await api.saveBackupSettings(dir);
    setExternalDir(r.externalDir);
    setNote({ ok: true, text: 'ستُنسخ كل نسخة قادمة إلى المجلد الخارجي أيضاً' });
  });

  const clearExternal = () => run('ext', async () => {
    const r = await api.saveBackupSettings(null);
    setExternalDir(r.externalDir);
  });

  const inApp = !!window.egco;

  return (
    <Card title="النسخ الاحتياطي"
          sub="نسخة يومية تلقائية عند أول فتح للتطبيق كل يوم، ونسخ قبل كل تحديث واستيراد واستعادة">
      <div className="card-body">
        <div className="row-gap-md mb-section">
          <button className="btn primary" disabled={busy !== null} onClick={backupNow}>
            {busy === 'now' ? 'جارٍ أخذ النسخة…' : 'نسخة الآن'}
          </button>
          <button className="btn" disabled={!inApp} onClick={() => window.egco?.revealBackupsDir()}>
            فتح المجلد
          </button>
          <span className="field-inline">
            {lastDaily
              ? <>آخر نسخة يومية: {fmtAgo(lastDaily.created_at)}</>
              : 'لم تُؤخذ نسخة يومية بعد'}
          </span>
        </div>

        <div className="field mb-section">
          <span className="text-label">مجلد خارجي (iCloud / Google Drive / قرص خارجي) — اختياري</span>
          <div className="row-gap-sm">
            <input dir="ltr" readOnly value={externalDir ?? ''} placeholder="غير مضبوط — النسخ على هذا الجهاز فقط" />
            <button className="btn" disabled={!inApp || busy !== null} onClick={pickExternal}>اختيار…</button>
            {externalDir && (
              <button className="btn" disabled={busy !== null} onClick={clearExternal}>إزالة</button>
            )}
          </div>
        </div>

        {note && (
          <div className={'callout callout-tight ' + (note.ok ? 'ok' : 'bad')}>{note.text}</div>
        )}
        {err && <ErrorState message={err} onRetry={load} />}
        {items === null && !err && <State>جارٍ التحميل…</State>}
        {items && items.length === 0 && (
          <div className="text-note">لا توجد نسخ بعد — اضغط «نسخة الآن».</div>
        )}
        {items && items.length > 0 && (
          <table>
            <thead>
              <tr><th>التاريخ</th><th>النوع</th><th className="num">الحجم</th><th></th></tr>
            </thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.name}>
                  <td title={b.name}>
                    {new Date(b.created_at).toLocaleString('ar-SA', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td><Pill kind={b.kind === 'daily' || b.kind === 'manual' ? 'ok' : ''}>
                    {BACKUP_KIND_LABEL[b.kind] ?? b.kind}
                  </Pill></td>
                  <td className="num">{fmtSize(b.size_bytes)}</td>
                  <td>
                    <div className="row-gap-sm">
                      <button className="btn sm" disabled={!inApp || busy !== null}
                              onClick={() => restore(b)}>
                        {busy === `restore:${b.name}` ? '…' : 'استعادة'}
                      </button>
                      <button className="btn sm" disabled={busy !== null} onClick={() => remove(b)}>
                        {busy === `del:${b.name}` ? '…' : 'حذف'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!inApp && (
          <div className="callout note mt-section">الاستعادة وفتح المجلد متاحان داخل التطبيق فقط (وليس في المتصفح).</div>
        )}
      </div>
    </Card>
  );
}

/**
 * فحص تحديث يدوي وصريح — قبل هذا كان الفحص التلقائي عند الإقلاع يبتلع أي خطأ بصمت
 * («لا إنترنت يعني ببساطة لا تحديث اليوم»)، فلا طريقة للمستخدم ليعرف أنه على إصدار
 * قديم. هنا كل نتيجة حقيقية تظهر كما هي — بما فيها نص الخطأ الفعلي عند الفشل.
 */
function UpdateCard({ currentVersion }: { currentVersion?: string }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // يلتقط أي حدث يصل لاحقاً (تنزيل جارٍ، اكتمل، إلخ) حتى بعد انتهاء checkForUpdates.
    // `?.` يحمي فقط الوصول إلى egco نفسه — إن وُجد egco بلا onUpdateStatus (بيئة
    // اختبار خارج Electron الحقيقي) يبقى الاستدعاء يرفع "is not a function".
    if (typeof window.egco?.onUpdateStatus !== 'function') return undefined;
    return window.egco.onUpdateStatus((s) => { setStatus(s); setBusy(false); });
  }, []);

  async function check() {
    setBusy(true); setStatus(null);
    const s = await window.egco!.checkForUpdates();
    // إن كانت النتيجة نهائية فورية (dev/خطأ) اعرضها؛ غير ذلك ننتظر onUpdateStatus.
    if (s.state !== 'checking') { setStatus(s); setBusy(false); }
  }

  function renderStatus() {
    if (!status) return null;
    switch (status.state) {
      case 'checking':
        return <div className="callout" style={{ marginTop: 12 }}>جارٍ الفحص…</div>;
      case 'unavailable-dev':
        return (
          <div className="callout note" style={{ marginTop: 12 }}>
            فحص التحديثات غير متاح في وضع التطوير — يعمل فقط في النسخة المُثبَّتة.
          </div>
        );
      case 'up-to-date':
        return (
          <div className="callout ok" style={{ marginTop: 12 }}>
            أنت على أحدث إصدار ({status.version})
          </div>
        );
      case 'available':
        return (
          <div className="callout" style={{ marginTop: 12 }}>
            يتوفر إصدار جديد ({status.version}) — جارٍ التنزيل…
          </div>
        );
      case 'downloading':
        return (
          <div className="callout" style={{ marginTop: 12 }}>
            يتوفر إصدار جديد — جارٍ التنزيل… {status.percent}٪
          </div>
        );
      case 'downloaded':
        return (
          <div className="callout ok" style={{ marginTop: 12 }}>
            <div>تم تنزيل الإصدار ({status.version}) — أعد التشغيل للتثبيت</div>
            <div style={{ marginTop: 8 }}>
              <button className="btn primary sm" onClick={() => window.egco!.installUpdate()}>
                إعادة التشغيل والتثبيت الآن
              </button>
            </div>
          </div>
        );
      case 'error':
        return (
          <div className="callout bad" style={{ marginTop: 12 }}>
            <div>تعذّر التحقق من التحديثات</div>
            <div className="ltr" style={{ fontSize: 12, marginTop: 4, opacity: 0.85 }}>
              {status.message}
            </div>
          </div>
        );
      default:
        return null;
    }
  }

  return (
    <Card title="التحديثات">
      <div className="card-body">
        <Row label="الإصدار الحالي" value={currentVersion ?? '—'} />
        <div style={{ marginTop: 12 }}>
          <button className="btn" disabled={!window.egco || busy} onClick={check}>
            {busy ? 'جارٍ الفحص…' : 'تحقق من التحديثات'}
          </button>
        </div>
        {renderStatus()}
        {!window.egco && (
          <div className="callout note" style={{ marginTop: 12 }}>
            متاح داخل التطبيق فقط (وليس في المتصفح).
          </div>
        )}
      </div>
    </Card>
  );
}

function AiCard() {
  const [s, setS] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    api.aiSettings().then(setS).catch((e) =>
      setNote({ ok: false, text: e instanceof ApiError ? e.message : 'تعذّر تحميل الإعدادات' }));
  }, []);

  if (!s) {
    return (
      <Card title="مساعد قراءة الملفات (ذكاء اصطناعي)">
        <div className="card-body">
          {note ? <div className="callout bad">{note.text}</div> : <State>جارٍ التحميل…</State>}
        </div>
      </Card>
    );
  }

  const set = (patch: Partial<AiSettings>) => setS({ ...s, ...patch });

  async function save() {
    setBusy(true); setNote(null);
    try {
      const saved = await api.saveAiSettings(s!);
      setS(saved);
      setNote({ ok: true, text: 'تم حفظ الإعدادات' });
    } catch (e) {
      setNote({ ok: false, text: e instanceof ApiError ? e.message : 'تعذّر الحفظ' });
    }
    setBusy(false);
  }

  async function testConn() {
    setBusy(true); setNote(null);
    try {
      await api.saveAiSettings(s!);           // اختبر ما يراه المستخدم على الشاشة
      const r = await api.aiTest();
      setNote({ ok: r.ok, text: r.message });
    } catch (e) {
      setNote({ ok: false, text: e instanceof ApiError ? e.message : 'تعذّر الاختبار' });
    }
    setBusy(false);
  }

  const masked = s.apiKey === '•••';

  return (
    <Card title="مساعد قراءة الملفات (ذكاء اصطناعي)">
      <div className="card-body">
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          عندما يفشل التعرف التلقائي على ملف كشف أو موازنة، يمكن لمساعد ذكاء اصطناعي
          استخراج السطور. أدخل بيانات مزود سحابي متوافق مع OpenAI —
          مثل OpenAI أو DeepSeek أو Groq — أو أي خدمة أخرى تختارها
          (يمكن أيضاً استخدام Ollama محلياً بوضع عنوانه).
          البيانات تُرسل للمزود المختار فقط عند التفعيل — والتطبيق يعمل كاملاً بدونه.
        </p>

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
          <input type="checkbox" checked={s.enabled}
                 onChange={(e) => set({ enabled: e.target.checked })} />
          <span>تفعيل المساعد</span>
        </label>

        <div className="field-grid">
          <Field label="المزود">
            <input value={s.provider} placeholder="OpenAI / DeepSeek / Groq …"
                   onChange={(e) => set({ provider: e.target.value })} />
          </Field>
          <Field label="عنوان الخدمة (baseUrl)">
            <input dir="ltr" value={s.baseUrl} placeholder="https://api.openai.com/v1"
                   onChange={(e) => set({ baseUrl: e.target.value })} />
          </Field>
          <Field label="مفتاح API">
            <input dir="ltr" type="password"
                   placeholder={masked ? 'محفوظ — اتركه كما هو للإبقاء عليه' : 'فارغ لمزود محلي'}
                   value={masked ? '' : s.apiKey}
                   onChange={(e) => set({ apiKey: e.target.value })} />
          </Field>
          <Field label="النموذج">
            <input dir="ltr" value={s.model} placeholder="gpt-4o-mini"
                   onChange={(e) => set({ model: e.target.value })} />
          </Field>
          <Field label="حد الرموز (maxTokens)">
            <input dir="ltr" type="number" min={100} value={s.maxTokens}
                   onChange={(e) => set({ maxTokens: Number(e.target.value) || 0 })} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button className="btn primary" disabled={busy} onClick={save}>حفظ</button>
          <button className="btn" disabled={busy} onClick={testConn}>اختبار الاتصال</button>
        </div>

        {note && (
          <div className={'callout ' + (note.ok ? 'ok' : 'bad')} style={{ marginTop: 12 }}>
            {note.text}
          </div>
        )}

        <LearnedLayoutsSection />
      </div>
    </Card>
  );
}

/** أنماط تخطيط الملفات التي «تعلّمها» التطبيق — للقراءة فقط، بلا تعديل في v1.
 * كل ملف كشف لاحق بنفس الشكل (نظام محاسبي واحد، بيانات مختلفة) يُستخرج محلياً
 * بلا أي استدعاء للنموذج — هنا يظهر للمستخدم كم مرة تكرر ذلك وكم رمز وُفِّر تقريباً. */
function LearnedLayoutsSection() {
  const [items, setItems] = useState<LearnedLayout[] | null>(null);

  useEffect(() => {
    api.aiLearnedLayouts().then((r) => setItems(r.items)).catch(() => setItems([]));
  }, []);

  if (!items || items.length === 0) return null;

  return (
    <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <h4 style={{ margin: '0 0 8px' }}>أنماط الملفات المتعلَّمة</h4>
      <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
        عندما يتعرّف المساعد على شكل ملف مرة، يحفظ قاعدة استخراج محلية له — أي ملف
        لاحق بنفس الشكل يُستخرج مباشرة بلا أي اتصال بالنموذج.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {items.map((it) => (
          <div key={it.id} className="callout" style={{ fontSize: 13 }}>
            <strong>{it.sampleName || it.sampleAccount || it.sourceKind}</strong>
            {' — '}
            استُخدم {it.hitCount} {it.hitCount === 1 ? 'مرة' : 'مرات'}
            {it.approxTokensSaved > 0 && <>، وفّر ~{it.approxTokensSaved} رمز</>}
            {it.lastUsedAt && (
              <span style={{ color: 'var(--muted)' }}>
                {' '}— آخر استخدام {new Date(it.lastUsedAt).toLocaleDateString('ar-SA')}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const CLASSIFY_KIND_LABEL: Record<string, string> = {
  supplier: 'مورد', contractor: 'مقاول', guarantee: 'ضمان', ignore: 'تجاهل',
};

/** تصنيفات الحسابات المحفوظة يدوياً — حسابات برقم بادئة غير 211/212/216 قرر
 * المستخدم تصنيفها مرة واحدة عبر نافذة «تصنيف…» في شاشة الرفع. */
function ClassificationsCard() {
  const [rows, setRows] = useState<ImportClassification[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyAccount, setBusyAccount] = useState<string | null>(null);

  function load() {
    setErr(null);
    api.importClassifications().then((r) => setRows(r.rows))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'تعذّر تحميل التصنيفات'));
  }

  useEffect(() => { load(); }, []);

  async function remove(account: string) {
    setBusyAccount(account);
    try {
      await api.deleteImportClassification(account);
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAccount(null);
    }
  }

  return (
    <Card title="تصنيفات الحسابات" sub="حسابات برقم بادئة غير معروفة صنّفتها يدوياً من شاشة الرفع">
      <div className="card-body">
        {err && <ErrorState message={err} onRetry={load} />}
        {rows === null && !err && <State>جارٍ التحميل…</State>}
        {rows && rows.length === 0 && (
          <div className="muted" style={{ fontSize: 13 }}>لا توجد تصنيفات محفوظة بعد.</div>
        )}
        {rows && rows.length > 0 && (
          <table>
            <thead>
              <tr><th>الحساب</th><th>الاسم</th><th>التصنيف</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.account}>
                  <td className="ltr">{r.account}</td>
                  <td>{r.name || '—'}</td>
                  <td><Pill kind={r.kind === 'ignore' ? '' : 'ok'}>{CLASSIFY_KIND_LABEL[r.kind] ?? r.kind}</Pill></td>
                  <td>
                    <button className="btn sm" disabled={busyAccount === r.account}
                      onClick={() => remove(r.account)}>
                      {busyAccount === r.account ? '…' : 'حذف'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Card>
  );
}

/**
 * تصفير البيانات — يمحو كل ما رُفع وأُدخل ويُبقي الإعدادات.
 *
 * ثلاث حواجز متعمَّدة قبل التنفيذ: الأعداد الحقيقية لما سيُحذف (موافقة على رقم
 * تراه أصدق من موافقة على وصف)، كتابة كلمة «تصفير» بدل نقرة (الكتابة تُجبر على
 * القراءة، والنقر لا)، وقائمة صريحة بما سيبقى حتى لا يظن المستخدم أنه سيفقد
 * مفتاح الذكاء وإعداداته معها.
 *
 * النسخة الاحتياطية يأخذها الخادم قبل المحو ويُلغي العملية إن فشلت — تُذكر هنا
 * باسمها بعد النجاح، فالطمأنينة أن تجدها لا أن يُقال لك إنها أُخذت.
 */
function ResetCard() {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ResetPreview | null>(null);
  const [phrase, setPhrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<ResetResult | null>(null);

  async function openDialog() {
    setErr(null); setDone(null); setPhrase('');
    try {
      setPreview(await api.resetPreview());
      setOpen(true);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  }

  async function run() {
    if (!preview) return;
    setBusy(true); setErr(null);
    try {
      const r = await api.resetAll(phrase.trim());
      setDone(r);
      setOpen(false);
      // الشاشات الأخرى تقرأ عند التحميل — إعادة التحميل أبسط من إبطال كل ذاكرة
      // مؤقتة في التطبيق، وهي متوقَّعة تماماً بعد فعلٍ بهذا الحجم.
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = preview !== null && phrase.trim() === preview.confirmPhrase;

  return (
    <Card title="تصفير البيانات">
      <div className="card-body">
        <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
          يمحو كل ما رُفع وأُدخل — الموردون والمقاولون والفواتير والدفعات
          والضمانات والتحصيلات والموازنة — ويُبقي إعداداتك كما هي. يُستعمل حين
          تبدأ من جديد ببيانات نظيفة. <b>لا يمكن التراجع عنه</b>، لكن التطبيق
          يأخذ نسخة احتياطية قبله تلقائياً.
        </p>

        {done && (
          <div className="callout ok" style={{ marginBottom: 12 }}>
            تم التصفير — حُذف {done.totalDeleted.toLocaleString('ar-EG')} سجلاً.
            {done.backup && <> النسخة الاحتياطية: <b>{done.backup}</b></>}
            <div style={{ fontSize: 12, marginTop: 4 }}>يُعاد تحميل التطبيق…</div>
          </div>
        )}
        {err && !open && <div className="callout bad" style={{ marginBottom: 12 }}>{err}</div>}

        <button className="btn danger" onClick={openDialog} disabled={busy}>
          تصفير جميع البيانات…
        </button>
      </div>

      {open && preview && (
        <Modal title="تصفير جميع البيانات" onClose={() => !busy && setOpen(false)}>
          {preview.isEmpty ? (
            <p>لا توجد بيانات لحذفها — التطبيق فارغ أصلاً.</p>
          ) : (
            <>
              <div className="callout bad">
                سيُحذف <b>{preview.totalRows.toLocaleString('ar-EG')}</b> سجلاً نهائياً.
                لا يمكن التراجع عن هذا الإجراء.
              </div>

              <table style={{ marginTop: 12 }}>
                <thead><tr><th>سيُحذف</th><th className="ltr">العدد</th></tr></thead>
                <tbody>
                  {preview.wipes.filter((r) => r.count > 0).map((r) => (
                    <tr key={r.table}>
                      <td>{r.label}</td>
                      <td className="ltr num">{r.count.toLocaleString('ar-EG')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <p style={{ fontSize: 13, marginTop: 14, marginBottom: 4 }}><b>يبقى كما هو:</b></p>
              <ul style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
                {preview.keeps.map((r) => <li key={r.table}>{r.label}</li>)}
                <li>كل النسخ الاحتياطية السابقة</li>
              </ul>

              <p style={{ fontSize: 13, marginBottom: 6 }}>
                للمتابعة اكتب «<b>{preview.confirmPhrase}</b>» في الحقل أدناه:
              </p>
              <input
                autoFocus
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder={preview.confirmPhrase}
                style={{ width: '100%' }}
                aria-label="تأكيد التصفير"
              />

              {err && <div className="callout bad" style={{ marginTop: 10 }}>{err}</div>}

              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                <button className="btn danger" onClick={run} disabled={!ready || busy}>
                  {busy ? 'جارٍ التصفير…' : 'تصفير نهائي'}
                </button>
                <button className="btn" onClick={() => setOpen(false)} disabled={busy}>
                  إلغاء
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
    </Card>
  );
}


function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="age-row">
      <span className="muted">{label}</span>
      <span className={cls} style={{ fontSize: 12, direction: 'ltr' }}>{value}</span>
    </div>
  );
}
