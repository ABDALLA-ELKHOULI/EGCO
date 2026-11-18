import { useEffect, useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { redactRoute, redactText } from '@/lib/redact';
import { recentErrors } from '@/lib/diagnostics';

/**
 * «الدعم» — يكتب المستخدم المشكلة فتصل بلاغاً مرقّماً، ويُشحن الإصلاح بتحديث يذكره.
 *
 * البلاغ يُنشر على مستودع عام، فكل ما يخرج يُموَّه ويُعرض قبل الإرسال كما سيُرسل
 * حرفياً — النص بعد التمويه، واللقطة بعد التمويش. لا شيء يغادر الجهاز لم يره المستخدم.
 */
export function SupportModal({ screenshot, onClose }: {
  /** لقطة أُخذت قبل فتح النافذة (وإلا ظهرت النافذة نفسها في اللقطة) — مموَّهة سلفاً */
  screenshot: string | null;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [withShot, setWithShot] = useState(Boolean(screenshot));
  const [diag, setDiag] = useState<Record<string, unknown>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ state: string; issueNumber?: number; message?: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const screen = redactRoute(window.location.hash || '#/');
  const redacted = useMemo(() => redactText(text), [text]);
  const canSend = Boolean(window.egco?.supportSubmit);

  useEffect(() => {
    window.egco?.supportDiagnostics?.().then(setDiag).catch(() => setDiag({}));
  }, []);

  async function send() {
    if (!window.egco?.supportSubmit) return;
    setBusy(true); setErr(null);
    try {
      const errors = recentErrors();
      const r = await window.egco.supportSubmit({
        description: redacted,
        screen,
        diagnostics: {
          ...diag,
          'آخر أخطاء الواجهة': errors.length
            ? errors.map((e) => `${e.at} ${redactText(e.message)}`).join(' ؛ ')
            : '—',
          'عرض النافذة': `${window.innerWidth}×${window.innerHeight}`,
        },
        screenshotJpegBase64: withShot && screenshot ? screenshot : undefined,
      });
      setResult(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal title="الدعم" onClose={onClose}>
        {result.state === 'sent' ? (
          <div className="callout ok">
            وصل البلاغ — رقمه <b>#{result.issueNumber}</b>. سيُذكر هذا الرقم في التحديث الذي يُصلحه.
          </div>
        ) : (
          <div className="callout note">{result.message}</div>
        )}
        <div style={{ marginTop: 16 }}><button className="btn" onClick={onClose}>إغلاق</button></div>
      </Modal>
    );
  }

  return (
    <Modal title="الدعم — الإبلاغ عن مشكلة" onClose={() => !busy && onClose()}>
      {!canSend && (
        <div className="callout note" style={{ marginBottom: 12 }}>
          الإبلاغ متاح في التطبيق المثبَّت فقط، لا في نسخة التطوير.
        </div>
      )}
      <p style={{ fontSize: 13, marginTop: 0 }}>
        اكتب ما حدث: ماذا كنت تفعل، وماذا توقّعت، وماذا ظهر بدلاً منه.
      </p>
      <textarea
        autoFocus rows={5} value={text} onChange={(e) => setText(e.target.value)}
        placeholder="مثال: رفعت كشف المقاولين فظهرت رسالة «تعذّرت القراءة» عند الحساب…"
        style={{ width: '100%' }} aria-label="وصف المشكلة"
      />

      {screenshot && (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, fontSize: 13 }}>
          <input type="checkbox" checked={withShot} onChange={(e) => setWithShot(e.target.checked)} />
          إرفاق لقطة من الشاشة الحالية — المبالغ والأسماء مموَّهة
        </label>
      )}
      {screenshot && withShot && (
        <img src={'data:image/jpeg;base64,' + screenshot} alt="اللقطة كما ستُرسل"
             style={{ width: '100%', marginTop: 8, border: '1px solid var(--hair)',
                      borderRadius: 'var(--radius-control)' }} />
      )}

      <details style={{ marginTop: 12, fontSize: 12 }}>
        <summary>ما الذي سيُرسل بالضبط؟</summary>
        <p className="muted" style={{ marginBottom: 4 }}>
          البلاغ يُنشر علناً، فتُخفى المبالغ وأرقام الحسابات (تبقى أول ثلاثة أرقام: نوع الحساب).
        </p>
        <pre style={{ whiteSpace: 'pre-wrap', background: 'var(--surface-2)', padding: 8,
                      borderRadius: 'var(--radius-control)' }}>
{redacted || '(بلا وصف)'}{'\n\n'}الشاشة: {screen}{'\n'}
{Object.entries(diag).map(([k, v]) => `${k}: ${String(v)}`).join('\n')}
        </pre>
      </details>

      {err && <div className="callout bad" style={{ marginTop: 10 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button className="btn primary" onClick={send}
                disabled={busy || !canSend || (!text.trim() && !withShot)}>
          {busy ? 'جارٍ الإرسال…' : 'إرسال البلاغ'}
        </button>
        <button className="btn" onClick={onClose} disabled={busy}>إلغاء</button>
      </div>
    </Modal>
  );
}

/**
 * يأخذ اللقطة **قبل** فتح النافذة، مع تمويه المبالغ والأسماء أثناءها فقط.
 * التمويه بفئة على <body> (tokens.css: .support-redact) تُزال فور انتهاء اللقطة.
 */
export async function captureRedacted(): Promise<string | null> {
  if (!window.egco?.supportCapture) return null;
  document.body.classList.add('support-redact');
  try {
    // إطاران — ليرسم المتصفح التمويه قبل أن تُلتقط الصورة
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return await window.egco.supportCapture();
  } catch {
    return null;
  } finally {
    document.body.classList.remove('support-redact');
  }
}
