/**
 * قالب «قيد الإنشاء» (P-241) — حالة فارغة صادقة: لا أرقام، لا جداول وهمية. ما ستعرضه الشاشة،
 * ما نحتاجه من المستخدم قبل البناء، وأين يجد المعلومة اليوم.
 */
import { useNavigate } from 'react-router-dom';
import { Button, Grid, Island, PageHeader, Pill, type IconName, Icon } from '@/ui';
import '../cash.css';

export function ComingSoon({ icon, title, purpose, planned, needs, seeAlso }: {
  icon: IconName; title: string; purpose: string; planned: string[]; needs: string[]; seeAlso: { to: string; label: string };
}) {
  const nav = useNavigate();
  return (
    <div className="sec-cash">
      <PageHeader title={title} sub={purpose} actions={<Pill tone="warn">قيد الإنشاء</Pill>} />
      <Grid>
        <Island span={8} title={<><Icon name={icon} size={20} /> ما ستعرضه هذه الشاشة</>}>
          <ul className="sec-cash-list">{planned.map((p) => <li key={p}>{p}</li>)}</ul>
          <p className="disclose">لا أرقام هنا عمداً — الشاشة لا تعرض شيئاً قبل أن تُبنى على بيانات حقيقية.</p>
        </Island>
        <Island span={4} title="ما نحتاجه قبل البناء">
          <ul className="sec-cash-list">{needs.map((n) => <li key={n}>{n}</li>)}</ul>
          <p className="cap">حتى ذلك الحين، ما يخصّ هذا الباب تجده في:</p>
          <Button onClick={() => nav(seeAlso.to)}>{seeAlso.label}</Button>
        </Island>
      </Grid>
    </div>
  );
}
