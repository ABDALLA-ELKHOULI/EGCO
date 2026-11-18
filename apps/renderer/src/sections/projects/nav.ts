/* تنقّل القسم — مسارات العقد §١ حرفياً. useGo من F حين يصدر يحلّ محل هذا. */
import { useNavigate } from 'react-router-dom';

export const paths = {
  list: '/projects',
  project: (name: string) => `/projects/${encodeURIComponent(name)}`,
  budget: (project?: string) => '/projects/budget' + (project ? `?project=${encodeURIComponent(project)}` : ''),
  admin: (from?: string) => '/projects/admin' + (from ? `?from=${encodeURIComponent(from)}` : ''),
  supplier: (account: string) => `/parties/suppliers/${encodeURIComponent(account)}`,
  contractor: (code: string) => `/parties/contractors/${encodeURIComponent(code)}`,
  imports: '/data/import',
};

export function useNav() {
  const nav = useNavigate();
  return (to: string) => nav(to);
}
