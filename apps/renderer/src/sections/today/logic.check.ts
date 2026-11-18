/**
 * فحوص المنطق الصافي — تُشغَّل بلا مُشغّل اختبارات:
 *   node apps/renderer/src/sections/today/logic.check.ts
 * (Node ≥ 22.6 يُسقط أنواع TS تلقائياً.) تفشل بخروج غير صفري عند أول خطأ.
 */
import {
  sumHalalas, supplierOverdue, contractorOverdue, buildTasks, mergeDue, dueTotals, groupByParty,
  changeSummary, ageingBuckets, gridCells, weekStartOf, iso, calendarEvents, periodTotals, loadDone, toggleDone,
  paymentListCsv, qualityWarnings, firstDeficit,
} from './logic.ts';
import type { PayTodayRow, ClaimDueRow } from './logic.ts';

let n = 0;
function eq(a: unknown, b: unknown, msg: string) {
  n++;
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error('✗ ' + msg + '\n  got ' + A + '\n  exp ' + B);
}

const T = '2026-11-17';
eq(sumHalalas([{ v: 0.1 }, { v: 0.2 }], (r) => r.v), 0.3, 'halalas sum');

const pt: PayTodayRow[] = [
  { account: '211001', supplier: 'أ', project: 'م1', invoice: '10', dueDate: '2026-11-01', daysToDue: -16, amount: 100.1, overdue: true },
  { account: '211001', supplier: 'أ', project: 'م1', invoice: '11', dueDate: '2026-11-10', daysToDue: -7, amount: 0.2, overdue: true },
  { account: '211002', supplier: 'ب', project: 'م2', invoice: '12', dueDate: '2026-11-20', daysToDue: 3, amount: 50, overdue: false },
];
const so = supplierOverdue(pt);
eq(so, [{ partyType: 'supplier', key: '211001', name: 'أ', overdue: 100.3, count: 2, oldestDays: 16 }], 'supplier overdue agg');

const cl: ClaimDueRow[] = [
  { type: 'contractor_claim', date: '2026-10-01', code: '212005', name: 'ج', claimNo: '3', doc: '', project: 'م1', claimDate: '2026-09-01', amount: 1000, daysLate: 47, overdue: true },
  { type: 'contractor_claim', date: '2026-12-30', code: '212006', name: 'د', claimNo: null, doc: 'D9', project: 'م2', claimDate: '2026-11-01', amount: 7, daysLate: 0, overdue: false },
];
eq(contractorOverdue(cl).map((c) => [c.key, c.overdue, c.oldestDays]), [['212005', 1000, 47]], 'contractor overdue agg');

const tasks = buildTasks({ today: T, suppliers: so, contractors: contractorOverdue(cl), guarantees: [
  { id: 'g1', contractorCode: '212005', contractorName: 'ج', project: 'م1', amount: 500, releaseDue: '2026-11-20', releasedOn: null },
  { id: 'g2', contractorCode: '212005', contractorName: 'ج', project: 'م1', amount: 500, releaseDue: '2026-12-20', releasedOn: null },
], deficit: { from: '2026-12-01', amount: -9 }, staleCount: 0, withoutDataCount: 0, needsTermCount: 2 });
eq(tasks.map((t) => t.id), ['deficit:2026-12-01', 'term:2', 'con:212005', 'gua:g1', 'sup:211001'], 'task order');
eq(tasks[0].sev, 'w', 'deficit is not red (not time-overdue)');
eq(tasks.filter((t) => t.sev === 'd').map((t) => t.id), ['con:212005', 'sup:211001'], 'red only for overdue');

const d7 = mergeDue(T, pt, cl, '7');
eq(d7.map((r) => r.key), ['212005', '211001', '211001', '211002'], 'due merge order + horizon');
eq(dueTotals(d7), { total: 1150.3, late: 1100.3, count: 4 }, 'due totals');
eq(mergeDue(T, pt, cl, 'all').length, 5, 'all range');
eq(mergeDue(T, pt, cl, '0').length, 3, 'today range keeps overdue');
eq(groupByParty(d7.filter((r) => r.key === '211001')), [{ partyType: 'supplier', key: '211001', name: 'أ', amount: 100.3, docs: ['10', '11'] }], 'group by party');
eq(paymentListCsv(d7.slice(0, 1)).split('\n').length, 3, 'csv lines');

const ch = changeSummary({ supplierOverdue: 10.1, supplierOpen: 5, contractorOwed: 1 }, { supplierOverdue: 10.3, supplierOpen: 4, contractorOwed: 1 });
eq(ch.map((c) => [c.delta, c.tone]), [[0.2, 'bad'], [-1, 'good'], [0, 'flat']], 'change summary');

eq(ageingBuckets({ current: 1, d1_30: 4 }).map((b) => b.share), [0.25, 1, 0, 0, 0], 'ageing shares');

eq(iso(weekStartOf(new Date(2026, 10, 17))), '2026-11-14', 'week starts Saturday');
const g = gridCells('month', 2026, 10, new Date(), 6);
eq([iso(g[0]), g.length], ['2026-10-31', 35], 'month grid');
const ev = calendarEvents([{ date: '2026-11-17', amount: 10, count: 2, overdue: false }], cl, [], undefined);
eq(periodTotals(g, ev, (d) => d.getMonth() === 10), { due: 10, guarantees: 0, count: 2 }, 'period totals');

const ds = toggleDone(loadDone('{"day":"2026-11-16","done":{"x":1}}', T), 'a', 5);
eq(ds, { day: T, done: { a: 5 } }, 'done resets daily');
eq(toggleDone(ds, 'a', 6).done, {}, 'toggle off');

eq(qualityWarnings({ withoutData: 0, stale: 0, needsTerm: 0, contractorsWithoutTerm: 0, contractorsWithoutStatement: 0, hasReceivables: true, bankBalanceKnown: true }), [], 'no warnings');
eq(firstDeficit([{ label: 'a', from: '1', to: '2', balance: 5, deficit: false }, { label: 'b', from: '3', to: '4', balance: -1, deficit: true }])?.from, '3', 'first deficit');

console.log('✓ ' + n + ' فحصاً نجح');
