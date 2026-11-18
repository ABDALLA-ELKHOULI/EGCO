/**
 * نقطة التنقل الوحيدة للقسم — كي يتغيّر مصدر `useGo` في سطر واحد إن نقله F.
 * أسماء العروض: مفاتيح العقد (`parties.supplier`…) أو أسماؤها المستعارة (`supplier`…).
 */
export { useGo } from '@/shell';

/** خريطة أسماء النموذج (prototype) إلى مفاتيح العقد ومعاملاتها. */
export function target(view: string, params: Record<string, string> = {}): [string, Record<string, string>] {
  switch (view) {
    case 'supplier': return ['parties.supplier', { account: params.id ?? params.account ?? '' }];
    case 'contractor': return ['parties.contractor', { code: params.id ?? params.code ?? '' }];
    case 'suppliers': return ['parties.suppliers', params];
    case 'contractors': return ['parties.contractors', params];
    case 'guarantees': return ['parties.guarantees', params];
    case 'project': return ['projects.project', { project: params.id ?? params.project ?? '' }];
    case 'budget': return ['projects.budget', params];
    case 'cash': return ['cash.flow', params];
    case 'collections': return ['cash.revenues', params];
    case 'import': return ['data.import', params];
    case 'coverage': return ['data.coverage', params];
    case 'settings': return ['data.settings', params];
    case 'due': return ['today.due', params];
    case 'calendar': return ['today.calendar', params];
    default: return [view, params];
  }
}
