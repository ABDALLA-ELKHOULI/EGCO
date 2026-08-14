import { ReactNode, useEffect, useState } from 'react';
import { api, ApiError, AiSettings, ImportClassification, LearnedLayout } from '@/lib/api';
import { Card, ErrorState, Pill, State } from '@/components/ui';

export function Settings() {
  const [info, setInfo] = useState<any>(null);
  const [health, setHealth] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [theme, setTheme] = useState(document.documentElement.dataset.theme ?? 'light');

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

        <Card title="النقل إلى جهاز آخر">
          <div className="card-body">
            <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 0 }}>
              كل بياناتك في ملف واحد. صدّره هنا، وانقله للجهاز الآخر، واستورده من نفس
              الشاشة — لا حاجة للبحث عن الملفات في النظام، ولا إنترنت ولا حساب.
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

        <AiCard />

        <ClassificationsCard />

        <Card title="عن التطبيق">
          <div className="card-body">
            <Row label="إصدار الخدمة" value={health.version} />
            <Row label="الاتصال بالشبكة" value="لا يوجد — يعمل دون إنترنت" cls="ok" />
          </div>
        </Card>
      </div>
    </>
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
    } catch (e: any) {
      setErr(e?.message ?? String(e));
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
