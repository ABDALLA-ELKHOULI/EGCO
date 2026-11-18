/** الهيكل — العقد في docs/next/FRONTEND-CONTRACT.md §٥. */
export { island, useIsland } from './islandStore';
export type { IslandState, IslandSnap } from './islandStore';
export { openNotifications, closeNotifications } from './NotificationDrawer';
export { openPalette, closePalette, backupNow } from './CommandPalette';
export { notifications as notify, useNotifications } from '@/data/notifications';
export { SECTIONS } from './sections';
export { Shell } from './Shell';
export { useGo, pathOf, findView } from '@/app/routes';
