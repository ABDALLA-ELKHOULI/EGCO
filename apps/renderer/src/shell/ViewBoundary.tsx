/**
 * حاجز أخطاء العرض — خطأ في شاشة لا يُفرغ التطبيق؛ يُصفَّر عند تغيّر المسار.
 * الشكل من prototype/shell.js (errorState).
 */
import { Component, type ReactNode } from 'react';
import { EmptyState } from '@/ui/primitives';

interface P { resetKey: string; title?: string; children: ReactNode }
interface S { err: Error | null; key: string }

export class ViewBoundary extends Component<P, S> {
  state: S = { err: null, key: this.props.resetKey };
  static getDerivedStateFromError(err: Error) { return { err }; }
  static getDerivedStateFromProps(p: P, s: S): Partial<S> | null {
    return p.resetKey !== s.key ? { err: null, key: p.resetKey } : null;
  }
  componentDidCatch(err: Error) { console.error('[shell] render', err); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <>
        <div className="ph"><div><h1>{this.props.title || ''}</h1><p>حدث خطأ أثناء عرض هذه الصفحة</p></div></div>
        <div className="grid"><section className="isl c12">
          <EmptyState icon="alert" title="تعذّر عرض الصفحة"
            body={<>البيانات سليمة ولم يتغيّر شيء. التفاصيل التقنية: <code dir="ltr">{String(this.state.err.message || this.state.err)}</code></>}
            cta="إعادة المحاولة" onCta={() => this.setState({ err: null })} />
          <p className="disclose"><button type="button" className="btn sm" onClick={() => location.reload()}>إعادة تحميل التطبيق</button></p>
        </section></div>
      </>
    );
  }
}
