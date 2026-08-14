import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * حاجز الأخطاء — يمنع خطأً في شاشة واحدة من إفراغ التطبيق كله.
 *
 * React 18 unmounts the ENTIRE tree on an uncaught render error. Without a
 * boundary the finance manager gets a blank white window — sidebar included,
 * no route change, no reload button — and must quit and relaunch the app. One
 * unguarded field in one card should never cost the whole session, so the
 * failure is contained here and reported in Arabic with a way out.
 *
 * `resetKey` (pass the route path) clears the error when the user navigates,
 * so a broken screen does not poison the ones they move to afterwards.
 */
interface Props {
  children: ReactNode;
  /** تغيّرها يمسح الخطأ — مرّر مسار الصفحة الحالي */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // لا خدمة تتبّع خارجية في تطبيق محلي — نطبعه في الطرفية ليُقرأ عند التشخيص.
    console.error('[EGCO] خطأ غير متوقع في الواجهة:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="state" role="alert">
        <div style={{ fontSize: 15, marginBottom: 6 }}>تعذّر عرض هذه الشاشة</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 14 }}>
          حدث خطأ غير متوقع أثناء العرض. بياناتك سليمة ولم يتأثر شيء منها —
          المشكلة في العرض فقط.
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>
            إعادة المحاولة
          </button>
          <button className="btn" onClick={() => window.location.reload()}>
            إعادة تحميل التطبيق
          </button>
        </div>
        <details style={{ marginTop: 16, textAlign: 'start' }}>
          <summary className="muted" style={{ fontSize: 11, cursor: 'pointer' }}>
            التفاصيل التقنية
          </summary>
          <pre className="muted" style={{
            fontSize: 11, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere',
            direction: 'ltr', textAlign: 'left', marginTop: 8,
          }}>
            {error.message}
          </pre>
        </details>
      </div>
    );
  }
}
