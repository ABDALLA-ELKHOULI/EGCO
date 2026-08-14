/**
 * أيقونات التنقل — تطابق مجموعة `Icon` في Figma (٢٤×٢٤، سماكة ١٫٨).
 *
 * currentColor everywhere: the icon inherits the nav item's colour, so active,
 * hover and muted states need no icon-specific styling.
 */
export type IconName =
  | 'dashboard' | 'payables' | 'cashflow' | 'projects' | 'reports'
  | 'calendar' | 'suppliers' | 'coverage' | 'upload' | 'settings'
  | 'contractors' | 'budget' | 'guarantee'
  | 'collapse' | 'expand' | 'revenue';

const PATHS: Record<IconName, JSX.Element> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  payables: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="2" />
      <path d="M2 10h20" />
      <path d="M6 15h4" />
    </>
  ),
  cashflow: (
    <>
      <polyline points="22,7 14,15 10,11 2,19" />
      <polyline points="16,7 22,7 22,13" />
    </>
  ),
  projects: (
    <>
      <polygon points="12,2 2,7 12,12 22,7" />
      <polyline points="2,17 12,22 22,17" />
      <polyline points="2,12 12,17 22,12" />
    </>
  ),
  reports: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <path d="M8 13h8M8 17h5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </>
  ),
  suppliers: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),
  coverage: (
    <>
      <path d="M21.2 15.9A10 10 0 1 1 8 2.8" />
      <path d="M22 12A10 10 0 0 0 12 2v10z" />
    </>
  ),
  upload: (
    <>
      <path d="M20.4 18.4A5 5 0 0 0 18 9h-1.3A8 8 0 1 0 3 16.3" />
      <polyline points="16,16 12,12 8,16" />
      <path d="M12 12v9" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  /* خوذة أمان — المقاولون */
  contractors: (
    <>
      <path d="M4 14a8 8 0 0 1 16 0" />
      <path d="M2 14h20v3H2z" />
      <path d="M10 6.5V4h4v2.5" />
      <path d="M12 21a4 4 0 0 0 4-4H8a4 4 0 0 0 4 4z" />
    </>
  ),
  /* درع مفرغ — ضمانات المقاولين */
  guarantee: (
    <>
      <path d="M12 2 4 5v6c0 5 3.4 8.7 8 11 4.6-2.3 8-6 8-11V5z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  /* مستند بداخله أعمدة — الموازنة */
  budget: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14,2 14,8 20,8" />
      <path d="M8 18v-4M12 18v-6M16 18v-3" />
    </>
  ),
  revenue: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v10M8.5 10.5C8.5 9 10 8.2 12 8.2s3.5.8 3.5 2.3-1.5 2-3.5 2-3.5.7-3.5 2.2 1.5 2.3 3.5 2.3 3.5-.8 3.5-2.3" />
    </>
  ),
  collapse: (
    <>
      <polyline points="11,17 6,12 11,7" />
      <polyline points="18,17 13,12 18,7" />
    </>
  ),
  expand: (
    <>
      <polyline points="13,17 18,12 13,7" />
      <polyline points="6,17 11,12 6,7" />
    </>
  ),
};

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flex: '0 0 auto' }}
    >
      {PATHS[name]}
    </svg>
  );
}
