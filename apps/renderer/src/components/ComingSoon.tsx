import { Link } from 'react-router-dom';
import { Card } from '@/components/ui';
import { Icon, type IconName } from '@/components/Icon';

/**
 * صفحة قيد الإنشاء — إطارٌ يقول ما سيفعله المكان، لا مساحة فارغة.
 *
 * A stub that just says "coming soon" teaches the user nothing and makes him wonder
 * whether the page is broken. This one states exactly what the screen will do, what
 * it still needs from him, and where the same information lives today — so an empty
 * page still answers a question instead of raising one.
 */
export interface ComingSoonProps {
  icon: IconName;
  title: string;
  /** جملة واحدة: ما الذي تجيب عنه هذه الشاشة */
  purpose: string;
  /** البنود التي ستحملها الشاشة حين تكتمل */
  planned: string[];
  /** ما نحتاجه من المستخدم قبل البناء — عيّنات ملفات مثلاً */
  needs?: string[];
  /** أين تُرى المعلومة اليوم، إن كان لها موضع */
  seeAlso?: { to: string; label: string };
}

export function ComingSoon({ icon, title, purpose, planned, needs, seeAlso }: ComingSoonProps) {
  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>{title}</h1>
          <p>{purpose}</p>
        </div>
        <span className="pill warn">قيد الإنشاء</span>
      </div>

      <Card>
        <div className="card-body flow">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md12)' }}>
            <span style={{ color: 'var(--gold)' }}><Icon name={icon} size={28} /></span>
            <b>ما ستعرضه هذه الشاشة</b>
          </div>
          <ul style={{ margin: 0, paddingInlineStart: '1.2em', lineHeight: 1.9 }}>
            {planned.map((p) => <li key={p}>{p}</li>)}
          </ul>

          {needs && needs.length > 0 && (
            <div className="callout note">
              <b>ما نحتاجه قبل البناء</b>
              <ul style={{ margin: '6px 0 0', paddingInlineStart: '1.2em', lineHeight: 1.8 }}>
                {needs.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          {seeAlso && (
            <p className="muted">
              حتى ذلك الحين، ما يخصّ هذا الباب من أرقام تجده في{' '}
              <Link to={seeAlso.to}>{seeAlso.label}</Link>.
            </p>
          )}
        </div>
      </Card>
    </>
  );
}
