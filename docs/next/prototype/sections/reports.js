/* قسم «التقارير» — تقرير المدير العام · عرض تقديمي · التصدير
 * يقابل Report.tsx و Present.tsx و ExportMenu.tsx و PrintableList.tsx.
 * كل رقم من EGCO.store؛ لا window.print ولا تنزيل مباشر (محجوبان في Artifact) — كل تصدير يمرّ بـ ui.exportDialog. */
(function () {
  'use strict';
  var E = window.EGCO = window.EGCO || {};
  var PREF_KEY = 'egco-proto-v2-reports';
  var COMPANY = 'شركة إعمار الخليج المصرية للمقاولات';

  /* ───────── أدوات عامة ───────── */
  function S() { return E.store; }
  function U() { return E.ui; }
  function safe(fn, d) { try { var v = fn(); return v === undefined ? d : v; } catch (e) { return d; } }
  function esc(s) { return U().esc(s == null ? '' : String(s)); }
  function dg(s) { return safe(function () { return U().digits(String(s)); }, String(s)); }
  function fmt(n) { return safe(function () { return U().fmt(n || 0); }, (n || 0).toFixed(2)); }
  function money(n, cls) { return safe(function () { return U().money(n || 0, cls); }, '<span class="num">' + fmt(n) + '</span>'); }
  function int(n) { return safe(function () { return U().int(n); }, String(n)); }
  function dtxt(d, o) { return safe(function () { return U().dateTxt(d, o || { year: true }); }, String(d)); }
  function list(t) { return safe(function () { return S().list(t) || []; }, []); }
  function get(t, id) { return safe(function () { return S().get(t, id); }, null); }
  function cents(n) { return Math.round((+n || 0) * 100); }
  function sum(arr, f) { var c = 0; arr.forEach(function (x) { c += cents(typeof f === 'function' ? f(x) : x[f]); }); return c / 100; }
  function today() { return safe(function () { return new Date(S().TODAY); }, new Date(2026, 10, 17)); }
  function iso(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function daysBetween(a, b) { return Math.round((new Date(b) - new Date(a)) / 864e5); }
  function projName(id) { var p = get('projects', id); return p ? p.name : '—'; }
  function balWord(b) { return b < 0 ? 'نحن ندين' : b > 0 ? 'يدينون لنا' : 'متوازن'; }
  function toast(t, k) { safe(function () { U().toast(t, { kind: k || 'ok' }); }); }
  function prefersReduced() { return safe(function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; }, false); }

  /* التفضيلات (لا API في store لحفظ ملاحظة التقرير — مفتاح localStorage خاص بالقسم + ذاكرة) */
  var memPrefs = null;
  function prefs() {
    if (memPrefs) return memPrefs;
    var p = null;
    try { p = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); } catch (e) { p = null; }
    memPrefs = Object.assign({
      scope: 'all', issue: iso(today()), note: '',
      sections: { summary: true, aging: true, overdue: true, contractors: true, budget: true, cash: true, collections: true, disclosure: true },
      notes: false
    }, p || {});
    return memPrefs;
  }
  function savePrefs() { try { localStorage.setItem(PREF_KEY, JSON.stringify(memPrefs)); } catch (e) { /* ذاكرة فقط */ } }

  var SECTIONS = [
    ['summary', 'الملخص'], ['aging', 'أعمار الديون'], ['overdue', 'أعلى المتأخرات'], ['contractors', 'المقاولون'],
    ['budget', 'الموازنة'], ['cash', 'التدفق النقدي'], ['collections', 'التحصيلات'], ['disclosure', 'ملاحظات الإفصاح']
  ];

  /* ───────── الاشتقاقات (نطاق: كل المشاريع أو مشروع) ───────── */
  function supplierRows(pid) {
    return list('suppliers').map(function (s) {
      var pos = safe(function () { return S().supplierPosition(s.id); }, null) || { invoices: [] };
      var inv = (pos.invoices || []).filter(function (i) { return (+i.remaining || 0) > 0 && (!pid || i.projectId === pid); });
      var r = { id: s.id, kind: 'supplier', name: s.name, account: s.account, termDays: s.termDays, open: 0, overdue: 0, oldest: 0,
        b0: 0, b1: 0, b2: 0, b3: 0, b4: 0, invoices: inv };
      var c = { open: 0, overdue: 0, b0: 0, b1: 0, b2: 0, b3: 0, b4: 0 };
      inv.forEach(function (i) {
        var rem = cents(i.remaining), late = +i.lateDays || 0;
        c.open += rem;
        if (late > 0) { c.overdue += rem; r.oldest = Math.max(r.oldest, late); }
        if (late <= 0) c.b0 += rem; else if (late <= 30) c.b1 += rem; else if (late <= 60) c.b2 += rem; else if (late <= 90) c.b3 += rem; else c.b4 += rem;
      });
      Object.keys(c).forEach(function (k) { r[k] = c[k] / 100; });
      return r;
    }).filter(function (r) { return !pid || r.invoices.length || list('suppliers').some(function (s) { return s.id === r.id && (s.projectIds || []).indexOf(pid) >= 0; }); });
  }
  function contractorRows(pid) {
    return list('contractors').filter(function (c) { return !pid || (c.projectIds || []).indexOf(pid) >= 0; }).map(function (c) {
      var pos = safe(function () { return S().contractorPosition(c.id); }, null) || {};
      var ents = list('contractorEntries').filter(function (e) { return e.contractorId === c.id; });
      var last = ents.reduce(function (m, e) { return e.date > m ? e.date : m; }, '');
      return { id: c.id, kind: 'contractor', name: c.name, code: c.code, status: c.status, termDays: c.termDays, retentionRate: c.retentionRate,
        projectIds: c.projectIds || [], balance: +pos.balance || 0, owed: +pos.owed || 0,
        overdue: pos.overdue == null ? null : +pos.overdue, dueSoon: pos.dueSoon == null ? null : +pos.dueSoon,
        oldest: (pos.claims || []).reduce(function (m, x) { return (+x.remaining > 0 && x.lateDays > m) ? x.lateDays : m; }, 0),
        entries: ents, lastDate: last,
        opening: sum(ents.filter(function (e) { return e.kind === 'opening'; }), function (e) { return (+e.debit || 0) - (+e.credit || 0); }),
        activity: sum(ents.filter(function (e) { return e.kind !== 'opening'; }), function (e) { return (+e.debit || 0) - (+e.credit || 0); }),
        ledger: sum(ents, function (e) { return (+e.debit || 0) - (+e.credit || 0); }),
        claimsTotal: sum(ents.filter(function (e) { return e.kind === 'claim' || e.kind === 'invoice'; }), 'credit'),
        paidTotal: sum(ents.filter(function (e) { return e.kind === 'payment'; }), 'debit'),
        retention: sum(ents.filter(function (e) { return e.kind === 'retention'; }), function (e) { return (+e.debit || 0) + (+e.credit || 0); }) };
    });
  }
  /* المديونية المفتوحة للموردين قبل ٣٠ يوماً — لحساب Δ عن الشهر الماضي (فواتير ≤ التاريخ − دفعات ≤ التاريخ) */
  function supplierOpenAt(dateIso, pid) {
    var c = 0;
    list('suppliers').forEach(function (s) {
      var inv = list('invoices').filter(function (i) { return i.supplierId === s.id && i.date <= dateIso && (!pid || i.projectId === pid); });
      var pay = pid ? 0 : sum(list('payments').filter(function (p) { return p.supplierId === s.id && p.date <= dateIso; }), 'amount');
      var bal = sum(inv, 'amount') - pay;
      if (pid) {
        /* الدفعات غير منسوبة لمشروع: نوزّعها FIFO على الفواتير كلها ثم نأخذ حصة المشروع */
        var all = list('invoices').filter(function (i) { return i.supplierId === s.id && i.date <= dateIso; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
        var paid = cents(sum(list('payments').filter(function (p) { return p.supplierId === s.id && p.date <= dateIso; }), 'amount'));
        bal = 0;
        all.forEach(function (i) { var a = cents(i.amount), used = Math.min(a, paid); paid -= used; if (i.projectId === pid) bal += (a - used) / 100; });
      }
      c += Math.max(0, cents(bal));
    });
    return c / 100;
  }
  function budgetRows(pid) {
    return list('projects').filter(function (p) { return !pid || p.id === pid; }).map(function (p) {
      var ms = list('budgetMonths').filter(function (m) { return m.projectId === p.id; });
      var planned = sum(ms, 'planned'), actual = sum(ms, 'actual');
      return { id: p.id, name: p.name, contractValue: +p.contractValue || 0, planned: planned, actual: actual,
        variance: (cents(actual) - cents(planned)) / 100, pct: planned ? (actual - planned) / planned * 100 : null,
        delay: p.budgetDelayPct == null ? null : +p.budgetDelayPct, months: ms.length };
    });
  }
  function receivableRows(pid) {
    var t = iso(today());
    return list('receivables').filter(function (r) { return !pid || r.projectId === pid; }).map(function (r) {
      return Object.assign({}, r, { late: r.status !== 'collected' && r.dueDate < t ? daysBetween(r.dueDate, t) : 0 });
    });
  }
  function cash30() {
    var pts = safe(function () { return S().cashProjection(30) || []; }, []);
    var low = null, neg = null;
    pts.forEach(function (p) { if (low == null || p.balance < low.balance) low = p; if (!neg && p.balance < 0) neg = p; });
    var bank = safe(function () { return +S().db.settings.bankBalance || 0; }, 0);
    return { pts: pts, low: low, neg: neg, bank: bank, end: pts.length ? pts[pts.length - 1] : null,
      out: sum(pts, 'out'), inn: sum(pts, 'in') };
  }

  function compute(scope) {
    var pid = scope && scope !== 'all' ? scope : null;
    var T = today(), tIso = iso(T);
    var sup = supplierRows(pid), con = contractorRows(pid), bud = budgetRows(pid), rec = receivableRows(pid);
    var supOpen = sum(sup, 'open'), supOver = sum(sup, 'overdue');
    var conOwed = sum(con, 'owed');
    var conOver = sum(con.filter(function (c) { return c.overdue != null; }), 'overdue');
    var noTerm = con.filter(function (c) { return c.termDays == null; });
    var recOpen = rec.filter(function (r) { return r.status !== 'collected'; });
    var recLate = recOpen.filter(function (r) { return r.late > 0; });
    var monthStart = tIso.slice(0, 7);
    var collectedMonth = rec.filter(function (r) { return r.status === 'collected' && String(r.collectedAt || '').slice(0, 7) === monthStart; });
    var prevOpen = supplierOpenAt(iso(addDays(T, -30)), pid);
    var aging = [
      ['لم يستحق بعد', sum(sup, 'b0'), false], ['١–٣٠ يوماً', sum(sup, 'b1'), true], ['٣١–٦٠ يوماً', sum(sup, 'b2'), true],
      ['٦١–٩٠ يوماً', sum(sup, 'b3'), true], ['أكثر من ٩٠ يوماً', sum(sup, 'b4'), true]
    ];
    var overdueList = sup.filter(function (s) { return s.overdue > 0; }).map(function (s) { return { name: s.name, type: 'مورد', amount: s.overdue, days: s.oldest, view: 'supplier', id: s.id }; })
      .concat(con.filter(function (c) { return c.overdue > 0; }).map(function (c) { return { name: c.name, type: 'مقاول', amount: c.overdue, days: c.oldest, view: 'contractor', id: c.id }; }))
      .sort(function (a, b) { return b.amount - a.amount; });
    var guar = list('guarantees').filter(function (g) { return !g.returnedAt && (!pid || g.projectId === pid); })
      .map(function (g) { return Object.assign({}, g, { left: daysBetween(tIso, g.expiryDate) }); });
    var cash = cash30();
    var risk = bud.filter(function (b) { return (b.pct != null && b.pct > 5) || (b.delay != null && b.delay > 5); })
      .sort(function (a, b) { return Math.max(b.pct || 0, b.delay || 0) - Math.max(a.pct || 0, a.delay || 0); });
    return { pid: pid, scopeLabel: pid ? 'مشروع ' + projName(pid) : 'كل المشاريع', T: T, sup: sup, con: con, bud: bud, rec: rec,
      supOpen: supOpen, supOver: supOver, conOwed: conOwed, conOver: conOver, noTerm: noTerm, prevOpen: prevOpen,
      totalOpen: (cents(supOpen) + cents(conOwed)) / 100, totalOver: (cents(supOver) + cents(conOver)) / 100,
      recOpen: recOpen, recLate: recLate, recOpenSum: sum(recOpen, 'amount'), recLateSum: sum(recLate, 'amount'),
      collectedMonth: collectedMonth, aging: aging, agingTotal: sum(aging, function (a) { return a[1]; }),
      overdueList: overdueList, guar: guar, cash: cash, risk: risk,
      stale: safe(function () { return S().staleness(); }, null) };
  }

  function decisions(d) {
    var out = [];
    if (d.cash.neg) out.push({ sev: 'd', t: 'عجز نقدي متوقع في ' + dtxt(d.cash.neg.date, { weekday: true }), b: 'الرصيد يصبح ' + fmt(d.cash.neg.balance) + ' ر.س — يلزم تأجيل دفعات أو تسريع تحصيل.' });
    if (d.overdueList[0]) out.push({ sev: 'd', t: 'سداد المتأخر الأكبر: ' + d.overdueList[0].name, b: fmt(d.overdueList[0].amount) + ' ر.س متأخرة منذ ' + dg(d.overdueList[0].days) + ' يوماً.' });
    d.guar.filter(function (g) { return g.left <= 30; }).slice(0, 2).forEach(function (g) {
      var c = get('contractors', g.contractorId);
      out.push({ sev: g.left <= 7 ? 'd' : 'w', t: 'ضمان ' + (g.type || '') + ' ينتهي ' + (g.left < 0 ? 'منذ ' + dg(-g.left) + ' يوماً' : 'خلال ' + dg(g.left) + ' يوماً'), b: (c ? c.name : '—') + ' · ' + fmt(g.amount) + ' ر.س — تمديد أو استرداد.' });
    });
    if (d.recLate.length) out.push({ sev: 'w', t: 'متابعة تحصيلات متأخرة (' + dg(d.recLate.length) + ')', b: 'بقيمة ' + fmt(d.recLateSum) + ' ر.س لدى الجهات المالكة.' });
    d.con.filter(function (c) { return c.status === 'disputed'; }).forEach(function (c) { out.push({ sev: 'w', t: 'نزاع مع المقاول ' + c.name, b: 'الرصيد ' + fmt(Math.abs(c.balance)) + ' ر.س ' + balWord(c.balance) + ' — يحتاج قراراً.' }); });
    if (d.noTerm.length) out.push({ sev: 'i', t: 'تحديد مدة سداد لـ' + dg(d.noTerm.length) + ' مقاول', b: 'بلا مدة لا يُحسب تأخرهم — الأرقام أعلاه لا تشملهم.' });
    if (d.risk[0]) out.push({ sev: 'w', t: 'مراجعة موازنة ' + d.risk[0].name, b: 'تجاوز ' + (d.risk[0].pct != null ? dg(d.risk[0].pct.toFixed(1)) + '٪' : '—') + ' عن المخطط.' });
    return out;
  }

  /* ───────── أجزاء HTML مشتركة ───────── */
  function deltaHtml(now, prev) {
    var diff = (cents(now) - cents(prev)) / 100;
    if (!prev && !now) return '';
    var pct = prev ? diff / prev * 100 : null;
    var cls = diff > 0 ? 'bad' : diff < 0 ? 'good' : '';
    return '<span class="delta ' + cls + '">' + (diff > 0 ? '▲' : diff < 0 ? '▼' : '＝') + ' <span class="num">' + fmt(Math.abs(diff)) + '</span>' +
      (pct != null ? ' (' + dg(Math.abs(pct).toFixed(1)) + '٪)' : '') + ' عن الشهر الماضي</span>';
  }
  function agingBars(d) {
    var max = Math.max.apply(null, d.aging.map(function (a) { return a[1]; }).concat([1]));
    return '<div class="rp-bars">' + d.aging.map(function (a, i) {
      return '<div class="rp-bar"><span>' + a[0] + '</span><div class="rp-track"><i class="' + (a[2] ? 'late' : '') + '" style="--w:' + (a[1] / max).toFixed(4) + ';--i:' + i + '"></i></div>' + money(a[1], a[2] && a[1] ? 't-danger' : '') + '</div>';
    }).join('') + '</div>';
  }
  function cashSvg(pts, h) {
    if (!pts.length) return '<p class="rp-muted">لا توجد بيانات توقع.</p>';
    h = h || 90; var w = 600;
    var vals = pts.map(function (p) { return +p.balance || 0; });
    var mx = Math.max.apply(null, vals.concat([0])), mn = Math.min.apply(null, vals.concat([0]));
    var rng = mx - mn || 1;
    var x = function (i) { return w - i * (w / Math.max(1, pts.length - 1)); }; /* RTL: اليوم يميناً */
    var y = function (v) { return 6 + (mx - v) / rng * (h - 12); };
    var line = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    return '<svg class="rp-cash" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" role="img" aria-label="الرصيد المتوقع ٣٠ يوماً">' +
      '<line class="z" x1="0" x2="' + w + '" y1="' + y(0).toFixed(1) + '" y2="' + y(0).toFixed(1) + '"/>' +
      (mn < 0 ? '<rect class="neg" x="0" y="' + y(0).toFixed(1) + '" width="' + w + '" height="' + (h - y(0)).toFixed(1) + '"/>' : '') +
      '<path class="l" d="' + line + '" vector-effect="non-scaling-stroke"/></svg>';
  }
  function tbl(head, rows, foot) {
    return '<div class="tbl-wrap rp-tw"><table><thead><tr>' + head.map(function (h) { return '<th' + (h[1] ? ' class="n"' : '') + '>' + h[0] + '</th>'; }).join('') +
      '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + head.length + '" class="rp-muted">لا بنود.</td></tr>') + '</tbody>' +
      (foot ? '<tfoot><tr>' + foot + '</tr></tfoot>' : '') + '</table></div>';
  }

  /* ───────── ١ · تقرير المدير العام ───────── */
  function renderReport(root) {
    var P = prefs();
    if (P.scope !== 'all' && !get('projects', P.scope)) P.scope = 'all';
    var d = compute(P.scope);
    var on = P.sections;
    var projOpts = list('projects').map(function (p) { return '<option value="' + esc(p.id) + '"' + (P.scope === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    var n = 0; function sec(t, sub) { n++; return '<div class="rp-sec"><span class="rp-no">' + dg(n) + '</span><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</div>'; }

    var body = '';
    if (on.summary) {
      body += sec('الملخص التنفيذي', 'الوضع في ' + dtxt(d.T)) +
        '<div class="rp-kpis">' +
        '<div><span>المديونية المفتوحة (موردون + مقاولون)</span><b>' + money(d.totalOpen) + '</b><em>' + deltaHtml(d.supOpen, d.prevOpen) + ' <small>(موردون)</small></em></div>' +
        '<div><span>المتأخر</span><b>' + money(d.totalOver, d.totalOver ? 't-danger' : '') + '</b><em>' + dg(d.overdueList.length) + ' جهة</em></div>' +
        '<div><span>أدنى رصيد خلال ٣٠ يوماً</span><b>' + (d.cash.low ? money(d.cash.low.balance, d.cash.low.balance < 0 ? 't-danger' : 't-ok') : '<span class="dash">—</span>') + '</b><em>' + (d.cash.low ? dtxt(d.cash.low.date) : '') + '</em></div>' +
        '<div><span>تحصيلات مفتوحة</span><b>' + money(d.recOpenSum, 't-ok') + '</b><em>' + dg(d.recOpen.length) + ' مستند</em></div>' +
        '<div><span>مستحق للمقاولين</span><b>' + money(d.conOwed) + '</b><em>' + dg(d.noTerm.length) + ' بلا مدة — تأخرهم غير محسوب</em></div>' +
        '</div>';
    }
    if (on.aging) body += sec('أعمار الديون', 'مديونية الموردين المفتوحة موزعةً حسب الأيام منذ الاستحقاق') + agingBars(d) +
      '<p class="rp-cap">الإجمالي ' + money(d.agingTotal) + ' — يطابق مجموع الفئات.</p>';
    if (on.overdue) body += sec('أعلى المتأخرات', 'أكبر خمس جهات تأخراً بالمبلغ') +
      tbl([['الجهة'], ['النوع'], ['أقدم تأخر', 1], ['المتأخر', 1]], d.overdueList.slice(0, 5).map(function (o) {
        return '<tr><td>' + esc(o.name) + '</td><td>' + o.type + '</td><td class="n">' + dg(o.days) + ' يوماً</td><td class="n">' + money(o.amount, 't-danger') + '</td></tr>';
      }), d.overdueList.length ? '<td colspan="3">مجموع الخمسة</td><td class="n">' + money(sum(d.overdueList.slice(0, 5), 'amount')) + '</td>' : '');
    if (on.contractors) {
      var cs = d.con.slice().sort(function (a, b) { return a.balance - b.balance; }).slice(0, 6);
      body += sec('المقاولون', 'السالب = نحن ندين لهم') +
        tbl([['المقاول'], ['الحالة'], ['الرصيد', 1], ['المتأخر', 1]], cs.map(function (c) {
          return '<tr><td>' + esc(c.name) + '</td><td>' + ({ active: 'نشط', paused: 'متوقف', finished: 'منتهٍ', disputed: 'نزاع' }[c.status] || '—') + '</td><td class="n">' + money(Math.abs(c.balance)) + ' <small>' + balWord(c.balance) + '</small></td><td class="n">' +
            (c.overdue == null ? '<span class="dash" title="لا مدة سداد محددة">— بلا مدة</span>' : money(c.overdue, c.overdue ? 't-danger' : '')) + '</td></tr>';
        }), '<td colspan="2">كل المقاولين في النطاق (' + dg(d.con.length) + ')</td><td class="n">' + money(Math.abs(sum(d.con, 'balance'))) + ' <small>' + balWord(sum(d.con, 'balance')) + '</small></td><td class="n">' + money(d.conOver) + '</td>');
    }
    if (on.budget) body += sec('الموازنة', 'المخطط مقابل الفعلي') +
      tbl([['المشروع'], ['المخطط', 1], ['الفعلي', 1], ['الفرق', 1]], d.bud.map(function (b) {
        return '<tr><td>' + esc(b.name) + '</td><td class="n">' + money(b.planned) + '</td><td class="n">' + money(b.actual) + '</td><td class="n">' +
          (b.pct == null ? '<span class="dash">—</span>' : '<span class="num ' + (b.pct > 5 ? 't-warn' : '') + '">' + dg((b.pct > 0 ? '+' : b.pct < 0 ? '−' : '') + Math.abs(b.pct).toFixed(1)) + '٪</span>') + '</td></tr>';
      }), '<td>الإجمالي</td><td class="n">' + money(sum(d.bud, 'planned')) + '</td><td class="n">' + money(sum(d.bud, 'actual')) + '</td><td class="n">' + money(sum(d.bud, 'variance')) + '</td>');
    if (on.cash) body += sec('التدفق النقدي', 'الرصيد المتوقع ٣٠ يوماً — يبدأ من رصيد البنك') + cashSvg(d.cash.pts) +
      '<div class="rp-row3"><div>رصيد البنك اليوم<b>' + money(d.cash.bank) + '</b></div><div>خارج ٣٠ يوماً<b>' + money(d.cash.out) + '</b></div><div>داخل ٣٠ يوماً<b>' + money(d.cash.inn, 't-ok') + '</b></div></div>' +
      (d.cash.neg ? '<p class="rp-alert">عجز متوقع في ' + dtxt(d.cash.neg.date, { weekday: true }) + ': ' + money(d.cash.neg.balance, 't-danger') + '</p>' : '');
    if (on.collections) body += sec('التحصيلات', 'ما لنا عند الجهات المالكة') +
      tbl([['الجهة'], ['المستند'], ['الاستحقاق'], ['المبلغ', 1]], d.recOpen.slice().sort(function (a, b) { return a.dueDate < b.dueDate ? -1 : 1; }).slice(0, 6).map(function (r) {
        return '<tr><td>' + esc(r.from) + '</td><td>' + esc(r.docNo) + '</td><td>' + dtxt(r.dueDate) + (r.late ? ' <span class="pill d">متأخر ' + dg(r.late) + ' يوماً</span>' : '') + '</td><td class="n">' + money(r.amount, 't-ok') + '</td></tr>';
      }), '<td colspan="3">كل المفتوح (' + dg(d.recOpen.length) + ') · حُصّل هذا الشهر ' + fmt(sum(d.collectedMonth, 'amount')) + '</td><td class="n">' + money(d.recOpenSum) + '</td>');
    if (on.disclosure) {
      var disc = [];
      if (d.noTerm.length) disc.push(dg(d.noTerm.length) + ' مقاول بلا مدة سداد (' + d.noTerm.slice(0, 3).map(function (c) { return esc(c.name); }).join('، ') + (d.noTerm.length > 3 ? '…' : '') + ') — المتأخر لا يشملهم.');
      if (d.pid) disc.push('في نطاق المشروع: رصيد المقاول يُعرض كاملاً (المقاول قد يعمل في أكثر من مشروع)، والفرق عن الشهر الماضي يوزّع الدفعات FIFO.');
      if (d.stale && d.stale.newestInvoiceDays != null) disc.push('أحدث فاتورة مستوردة عمرها ' + dg(d.stale.newestInvoiceDays) + ' يوماً.');
      disc.push('الفرق عن الشهر الماضي = المديونية المفتوحة للموردين اليوم مقابل ' + dtxt(addDays(d.T, -30)) + '، محسوبة من الفواتير والدفعات المؤرخة حتى ذلك اليوم.');
      disc.push('المحذوفات في سلة المهملات مستبعدة. كل إجمالي يُحسب من صفوفه.');
      body += sec('ملاحظات الإفصاح') + '<ul class="rp-disc">' + disc.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul>';
    }

    root.innerHTML =
      '<div class="ph"><div><h1>تقرير المدير العام</h1><p>صفحة A4 من بيانات اللوحة الحالية — ' + esc(d.scopeLabel) + ' <span class="sample">بيانات مثال</span></p></div>' +
      '<div class="acts"><button class="btn" data-a="present">عرض تقديمي</button><button class="btn" data-a="copy">نسخ كنص</button><button class="btn primary" data-a="export">تصدير</button></div></div>' +
      '<div class="rp-layout">' +
      '<aside class="isl rp-ctrl" style="--i:0"><div class="ih"><h2>إعداد التقرير</h2></div>' +
      '<label class="rp-f"><span>النطاق</span><select data-k="scope"><option value="all">كل المشاريع</option>' + projOpts + '</select></label>' +
      '<label class="rp-f"><span>تاريخ الإصدار</span><input type="date" data-k="issue" value="' + esc(P.issue) + '"></label>' +
      '<p class="rp-cap">الأرقام محسوبة حتى ' + dtxt(d.T) + ' (تاريخ بيانات النموذج)؛ تاريخ الإصدار يظهر في الترويسة فقط.</p>' +
      '<div class="rp-f"><span>الأقسام</span><div class="rp-toggles">' + SECTIONS.map(function (s) {
        return '<button class="chip" aria-pressed="' + (on[s[0]] ? 'true' : 'false') + '" data-sec="' + s[0] + '">' + s[1] + '</button>';
      }).join('') + '</div></div>' +
      '<label class="rp-f"><span>ملاحظة تنفيذية <small class="rp-saved" aria-live="polite"></small></span><textarea data-k="note" rows="5" placeholder="تظهر أعلى التقرير — تُحفظ تلقائياً">' + esc(P.note) + '</textarea></label>' +
      '</aside>' +
      '<div class="rp-paper-wrap"><article class="rp-paper" aria-label="معاينة صفحة A4">' +
      '<header class="rp-head"><div class="rp-logo">EG</div><div><b>' + COMPANY + '</b><span>الإدارة المالية · تقرير المدير العام</span></div>' +
      '<dl><dt>تاريخ الإصدار</dt><dd>' + dtxt(P.issue || d.T) + '</dd><dt>النطاق</dt><dd>' + esc(d.scopeLabel) + '</dd></dl></header>' +
      '<h3>الموقف المالي — ' + dtxt(d.T) + '</h3><p class="rp-sub">جميع الأرقام بالريال السعودي</p>' +
      (P.note.trim() ? '<blockquote class="rp-note">' + esc(P.note).replace(/\n/g, '<br>') + '</blockquote>' : '') +
      (body || '<p class="rp-muted">اختر قسماً واحداً على الأقل.</p>') +
      '<footer class="rp-stamp">أُعدّ آلياً من لوحة إعمار الخليج · كل رقم قابل للتتبّع إلى كشفه</footer>' +
      '</article></div></div>';

    root.querySelector('[data-k="scope"]').addEventListener('change', function (e) { P.scope = e.target.value; savePrefs(); renderReport(root); });
    root.querySelector('[data-k="issue"]').addEventListener('change', function (e) { P.issue = e.target.value || iso(today()); savePrefs(); renderReport(root); });
    var ta = root.querySelector('[data-k="note"]'), tmr;
    ta.addEventListener('input', function () {
      P.note = ta.value; clearTimeout(tmr);
      tmr = setTimeout(function () {
        savePrefs();
        var st = root.querySelector('.rp-saved'); if (st) st.textContent = '· حُفظت';
        var bq = root.querySelector('.rp-note'), paper = root.querySelector('.rp-paper h3 + .rp-sub');
        if (P.note.trim()) {
          if (!bq) { bq = document.createElement('blockquote'); bq.className = 'rp-note'; paper.after(bq); }
          bq.innerHTML = esc(P.note).replace(/\n/g, '<br>');
        } else if (bq) bq.remove();
      }, 300);
    });
    root.querySelectorAll('[data-sec]').forEach(function (b) {
      b.addEventListener('click', function () { var k = b.getAttribute('data-sec'); on[k] = !on[k]; savePrefs(); renderReport(root); var nb = root.querySelector('[data-sec="' + k + '"]'); if (nb) nb.focus(); });
    });
    root.querySelector('[data-a="copy"]').addEventListener('click', function () { copyText(reportText(d, P)).then(function (ok) { toast(ok ? 'نُسخ التقرير نصاً' : 'تعذّر النسخ — حدّد النص يدوياً', ok ? 'ok' : 'error'); }); });
    root.querySelector('[data-a="export"]').addEventListener('click', function () { exportReport(d, P, root); });
    root.querySelector('[data-a="present"]').addEventListener('click', function () { startPresent(0); });
  }

  function reportText(d, P) {
    var L = [], on = P.sections;
    L.push(COMPANY + ' — تقرير المدير العام');
    L.push('النطاق: ' + d.scopeLabel + ' · الإصدار: ' + P.issue + ' · البيانات حتى: ' + iso(d.T));
    if (P.note.trim()) { L.push(''); L.push('ملاحظة تنفيذية:'); L.push(P.note.trim()); }
    if (on.summary) {
      L.push('', '■ الملخص');
      L.push('المديونية المفتوحة: ' + fmt(d.totalOpen) + ' ر.س (موردون ' + fmt(d.supOpen) + ' · مقاولون ' + fmt(d.conOwed) + ')');
      L.push('الفرق عن الشهر الماضي (موردون): ' + fmt(d.supOpen - d.prevOpen));
      L.push('المتأخر: ' + fmt(d.totalOver) + ' ر.س');
      if (d.cash.low) L.push('أدنى رصيد ٣٠ يوماً: ' + fmt(d.cash.low.balance) + ' في ' + d.cash.low.date);
      L.push('تحصيلات مفتوحة: ' + fmt(d.recOpenSum) + ' ر.س');
    }
    if (on.aging) { L.push('', '■ أعمار الديون'); d.aging.forEach(function (a) { L.push(a[0] + ': ' + fmt(a[1])); }); }
    if (on.overdue) { L.push('', '■ أعلى المتأخرات'); d.overdueList.slice(0, 5).forEach(function (o, i) { L.push((i + 1) + '. ' + o.name + ' (' + o.type + ') — ' + fmt(o.amount) + ' · ' + o.days + ' يوماً'); }); }
    if (on.contractors) { L.push('', '■ المقاولون'); d.con.forEach(function (c) { L.push(c.name + ': ' + fmt(Math.abs(c.balance)) + ' ' + balWord(c.balance) + (c.overdue == null ? ' · المتأخر: — بلا مدة' : ' · المتأخر: ' + fmt(c.overdue))); }); }
    if (on.budget) { L.push('', '■ الموازنة'); d.bud.forEach(function (b) { L.push(b.name + ': مخطط ' + fmt(b.planned) + ' · فعلي ' + fmt(b.actual) + (b.pct == null ? '' : ' · ' + b.pct.toFixed(1) + '٪')); }); }
    if (on.cash) { L.push('', '■ التدفق النقدي'); L.push('رصيد البنك: ' + fmt(d.cash.bank) + ' · خارج: ' + fmt(d.cash.out) + ' · داخل: ' + fmt(d.cash.inn)); if (d.cash.neg) L.push('عجز متوقع في ' + d.cash.neg.date + ': ' + fmt(d.cash.neg.balance)); }
    if (on.collections) { L.push('', '■ التحصيلات'); d.recOpen.forEach(function (r) { L.push(r.from + ' ' + r.docNo + ' — ' + fmt(r.amount) + ' · ' + r.dueDate + (r.late ? ' (متأخر ' + r.late + ' يوماً)' : '')); }); }
    if (on.disclosure && d.noTerm.length) { L.push('', '■ إفصاح'); L.push(d.noTerm.length + ' مقاول بلا مدة سداد — تأخرهم غير محسوب.'); }
    return L.join('\n');
  }

  function reportTablesCSV(d) {
    var rows = [];
    function add(section, item, a, b, c) { rows.push({ section: section, item: item, a: a, b: b, c: c }); }
    add('الملخص', 'المديونية المفتوحة', d.totalOpen.toFixed(2), '', '');
    add('الملخص', 'المتأخر', d.totalOver.toFixed(2), '', '');
    add('الملخص', 'المفتوح قبل ٣٠ يوماً (موردون)', d.prevOpen.toFixed(2), '', '');
    d.aging.forEach(function (a) { add('أعمار الديون', a[0], a[1].toFixed(2), '', ''); });
    d.overdueList.slice(0, 5).forEach(function (o) { add('أعلى المتأخرات', o.name, o.amount.toFixed(2), o.type, o.days); });
    d.con.forEach(function (c) { add('المقاولون', c.name, c.balance.toFixed(2), balWord(c.balance), c.overdue == null ? '— بلا مدة' : c.overdue.toFixed(2)); });
    d.bud.forEach(function (b) { add('الموازنة', b.name, b.planned.toFixed(2), b.actual.toFixed(2), b.pct == null ? '' : b.pct.toFixed(1)); });
    d.cash.pts.forEach(function (p) { add('التدفق النقدي', p.date, (+p.balance).toFixed(2), (+p.in || 0).toFixed(2), (+p.out || 0).toFixed(2)); });
    d.recOpen.forEach(function (r) { add('التحصيلات', r.from + ' ' + r.docNo, (+r.amount).toFixed(2), r.dueDate, r.late || ''); });
    return toCSV(rows, [{ key: 'section', label: 'القسم' }, { key: 'item', label: 'البند' }, { key: 'a', label: 'القيمة' }, { key: 'b', label: 'إضافي ١' }, { key: 'c', label: 'إضافي ٢' }]);
  }

  function exportReport(d, P, root) {
    var h = U().modal({
      title: 'تصدير تقرير المدير العام', size: 'md',
      body: '<div class="sec-reports"><p class="rp-cap">الطباعة والتنزيل المباشر محجوبان داخل هذه الصفحة المنشورة. اختر صيغة: تُعرض للنسخ، مع محاولة تنزيل قد لا تنجح.</p>' +
        '<div class="rp-pick"><button class="isl click" data-f="csv"><b>جداول التقرير — CSV</b><span class="cap">يُفتح في Excel · كل الأقسام</span></button>' +
        '<button class="isl click" data-f="html"><b>صفحة التقرير — HTML</b><span class="cap">تُفتح في المتصفح وتُطبع منه PDF</span></button>' +
        '<button class="isl click" data-f="txt"><b>نص عادي</b><span class="cap">للصق في بريد أو واتساب</span></button></div></div>',
      actions: [{ label: 'إغلاق', onClick: function (close) { close(); } }],
      onOpen: function (mroot) {
        mroot.querySelectorAll('[data-f]').forEach(function (b) {
          b.addEventListener('click', function () {
            var f = b.getAttribute('data-f');
            var closeTop = function () { if (h && h.close) h.close(); };
            if (f === 'csv') { closeTop(); U().exportDialog({ title: 'جداول تقرير المدير العام', csv: reportTablesCSV(d), fileName: 'تقرير-المدير-العام-' + iso(d.T) + '.csv' }); }
            else if (f === 'html') { closeTop(); textExport('صفحة التقرير — HTML', reportHTML(root), 'تقرير-المدير-العام-' + iso(d.T) + '.html', 'text/html'); }
            else { closeTop(); textExport('التقرير نصاً', reportText(d, P), 'تقرير-المدير-العام-' + iso(d.T) + '.txt', 'text/plain'); }
          });
        });
      }
    });
  }

  function reportHTML(root) {
    var paper = root.querySelector('.rp-paper');
    var css = 'body{font-family:Cairo,Tahoma,sans-serif;direction:rtl;color:#211D16;background:#fff;margin:24px auto;max-width:820px;font-size:13px;line-height:20px}' +
      'table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border-bottom:1px solid #EFEAE2;padding:6px 8px;text-align:right}th{background:#FAF8F4;color:#706B5F;font-weight:500}td.n,th.n{text-align:left}' +
      '.num{direction:ltr;unicode-bidi:isolate;font-variant-numeric:tabular-nums}.cur{font-size:.7em;color:#706B5F;margin-inline-start:3px}.t-danger{color:#B3261E}.t-ok{color:#1F6B35}.t-warn{color:#8A5300}' +
      '.rp-kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rp-kpis>div{border:1px solid #E7E1D6;border-radius:8px;padding:8px}.rp-kpis b{display:block;font-size:17px}.rp-kpis em,.rp-kpis span{font-style:normal;font-size:11px;color:#706B5F;display:block}' +
      '.rp-sec{margin:18px 0 6px;font-weight:700;border-bottom:2px solid #D9943C;padding-bottom:4px}.rp-sec small{font-weight:400;color:#706B5F;margin-inline-start:8px}.rp-no{margin-inline-end:6px;color:#8F5E1D}' +
      '.rp-bar{display:grid;grid-template-columns:110px 1fr 140px;gap:8px;align-items:center}.rp-track{height:8px;background:#EDE8DF;border-radius:4px;overflow:hidden}.rp-track i{display:block;height:100%;background:#D9943C;width:calc(var(--w)*100%)}.rp-track i.late{background:#D93A2F}' +
      '.rp-cash{width:100%;height:90px}.rp-cash .l{fill:none;stroke:#D9943C;stroke-width:2}.rp-cash .z{stroke:#706B5F;stroke-dasharray:2 3}.rp-cash .neg{fill:#FBEAE8}' +
      '.rp-head{display:flex;gap:12px;align-items:center;border-bottom:1px solid #E7E1D6;padding-bottom:12px}.rp-head span{display:block;color:#706B5F}.rp-head dl{margin-inline-start:auto;display:grid;grid-template-columns:auto auto;gap:0 8px}.rp-head dt{color:#706B5F}.rp-head dd{margin:0}' +
      '.rp-logo{width:36px;height:36px;border-radius:9px;background:#D9943C;display:grid;place-items:center;font-weight:700}.rp-note{border-inline-start:3px solid #D9943C;background:#FAF8F4;margin:12px 0;padding:8px 12px}' +
      '.rp-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.rp-row3 b{display:block}.pill{font-size:11px;color:#B3261E}.rp-stamp{margin-top:24px;color:#706B5F;font-size:11px}.rp-sub,.rp-cap,.rp-muted{color:#706B5F}';
    return '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>تقرير المدير العام</title><style>' + css + '</style></head><body>' + (paper ? paper.innerHTML : '') + '</body></html>';
  }

  /* تصدير نصي (HTML/TXT) — exportDialog مخصّص لـCSV، فنعرض النص بنافذة ui.modal مع نسخ ومحاولة Blob */
  function textExport(title, text, fileName, mime) {
    U().modal({
      title: title, size: 'lg',
      body: '<div class="sec-reports"><p class="rp-cap">التنزيل قد لا يعمل داخل الصفحة المنشورة — إن لم يبدأ، انسخ المحتوى والصقه في ملف باسم <b>' + esc(fileName) + '</b>.</p>' +
        '<textarea class="rp-code" readonly rows="14" aria-label="المحتوى">' + esc(text) + '</textarea></div>',
      actions: [
        { label: 'محاولة التنزيل', onClick: function () { var ok = tryDownload(text, fileName, mime); toast(ok ? 'طُلب التنزيل — إن لم يظهر الملف فاستعمل «نسخ»' : 'التنزيل محجوب هنا — استعمل «نسخ»', 'info'); } },
        { label: 'نسخ', kind: 'primary', onClick: function (close, r) { copyText(text, r && r.querySelector('.rp-code')).then(function (ok) { toast(ok ? 'نُسخ المحتوى' : 'حُدّد النص — اضغط ⌘/Ctrl+C', ok ? 'ok' : 'info'); }); } }
      ]
    });
  }
  function tryDownload(text, name, mime) {
    try {
      var url = URL.createObjectURL(new Blob(['﻿' + text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
      var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      return true;
    } catch (e) { return false; }
  }
  function copyText(text, selectEl) {
    function fallback() {
      try {
        var t = selectEl || document.createElement('textarea');
        if (!selectEl) { t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0'; document.body.appendChild(t); }
        t.focus(); t.select();
        var ok = document.execCommand && document.execCommand('copy');
        if (!selectEl) t.remove();
        return !!ok;
      } catch (e) { return false; }
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallback(); });
    } catch (e) { /* */ }
    return Promise.resolve(fallback());
  }
  function toCSV(rows, cols) {
    var viaStore = safe(function () { return S().toCSV(rows, cols); }, null);
    if (typeof viaStore === 'string') return viaStore;
    var q = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    return [cols.map(function (c) { return q(c.label); }).join(',')].concat(rows.map(function (r) { return cols.map(function (c) { return q(r[c.key]); }).join(','); })).join('\n');
  }

  /* ───────── ٢ · العرض التقديمي ───────── */
  function buildSlides(d) {
    var dec = decisions(d), S2 = [];
    S2.push({ title: COMPANY, sub: 'الإدارة المالية', cls: 'title',
      body: '<div class="rp-s-hero"><b>الموقف المالي</b><span>' + esc(d.scopeLabel) + ' · ' + dtxt(d.T, { year: true, weekday: true }) + '</span></div>',
      note: 'افتتاح: نعرض الوضع حتى اليوم، كل رقم من الكشوف المستوردة ويمكن تتبعه.' });
    S2.push({ title: 'الأرقام الرئيسية', sub: d.scopeLabel,
      body: '<div class="rp-s-kpis">' +
        '<div><span>المديونية المفتوحة</span><b>' + money(d.totalOpen) + '</b>' + deltaHtml(d.supOpen, d.prevOpen) + '</div>' +
        '<div class="' + (d.totalOver ? 'crit' : '') + '"><span>المتأخر</span><b>' + money(d.totalOver, d.totalOver ? 't-danger' : '') + '</b><small>' + dg(d.overdueList.length) + ' جهة</small></div>' +
        '<div><span>أدنى رصيد ٣٠ يوماً</span><b>' + (d.cash.low ? money(d.cash.low.balance, d.cash.low.balance < 0 ? 't-danger' : 't-ok') : '—') + '</b><small>' + (d.cash.low ? dtxt(d.cash.low.date) : '') + '</small></div>' +
        '<div><span>تحصيلات مفتوحة</span><b>' + money(d.recOpenSum, 't-ok') + '</b><small>' + dg(d.recLate.length) + ' متأخرة</small></div></div>',
      note: 'المديونية ' + fmt(d.totalOpen) + '، منها متأخر ' + fmt(d.totalOver) + '. الفرق عن الشهر الماضي للموردين ' + fmt(d.supOpen - d.prevOpen) + '.' });
    S2.push({ title: 'أعمار الديون', sub: 'مديونية الموردين حسب الأيام منذ الاستحقاق', body: agingBars(d),
      note: 'ما فوق ٩٠ يوماً: ' + fmt(d.aging[4][1]) + ' — هذا الأخطر على العلاقة مع الموردين.' });
    S2.push({ title: 'أعلى المتأخرات', sub: 'أكبر خمس جهات',
      body: tbl([['الجهة'], ['النوع'], ['أقدم تأخر', 1], ['المتأخر', 1]], d.overdueList.slice(0, 5).map(function (o) {
        return '<tr><td>' + esc(o.name) + '</td><td>' + o.type + '</td><td class="n">' + dg(o.days) + ' يوماً</td><td class="n">' + money(o.amount, 't-danger') + '</td></tr>'; })),
      note: d.overdueList[0] ? 'الأكبر ' + d.overdueList[0].name + ' بـ' + fmt(d.overdueList[0].amount) + '.' : 'لا متأخرات.' });
    S2.push({ title: 'مشاريع تحت المراقبة', sub: 'تجاوز الموازنة أو تأخرها أكثر من ٥٪',
      body: d.risk.length ? '<div class="rp-s-risk">' + d.risk.slice(0, 4).map(function (b) {
        return '<div><b>' + esc(b.name) + '</b><span>تجاوز الموازنة ' + (b.pct == null ? '—' : '<span class="num t-warn">' + dg(b.pct.toFixed(1)) + '٪</span>') + '</span><span>تأخر الموازنة ' + (b.delay == null ? '—' : '<span class="num">' + dg(b.delay.toFixed(2)) + '٪</span>') + '</span><span>الفرق ' + money(b.variance) + '</span></div>';
      }).join('') + '</div>' : '<p class="rp-s-empty">لا مشروع يتجاوز العتبة.</p>',
      note: 'المعيار: الفعلي أعلى من المخطط بأكثر من ٥٪ أو نسبة تأخر الموازنة > ٥٪.' });
    S2.push({ title: 'النقد خلال ٣٠ يوماً', sub: 'يبدأ من رصيد البنك ' + fmt(d.cash.bank),
      body: cashSvg(d.cash.pts, 160) + '<div class="rp-row3"><div>خارج<b>' + money(d.cash.out) + '</b></div><div>داخل<b>' + money(d.cash.inn, 't-ok') + '</b></div><div>نهاية الفترة<b>' + (d.cash.end ? money(d.cash.end.balance, d.cash.end.balance < 0 ? 't-danger' : '') : '—') + '</b></div></div>' +
        (d.cash.neg ? '<p class="rp-alert">عجز متوقع في ' + dtxt(d.cash.neg.date, { weekday: true }) + '</p>' : ''),
      note: d.cash.neg ? 'تنبيه: الرصيد يصبح سالباً في ' + d.cash.neg.date + '.' : 'لا عجز متوقع خلال ٣٠ يوماً.' });
    S2.push({ title: 'قرارات مطلوبة', sub: 'من أعلى أثراً إلى أقل',
      body: dec.length ? '<ol class="rp-s-dec">' + dec.slice(0, 6).map(function (x) { return '<li><i class="sev ' + x.sev + '"></i><div><b>' + esc(x.t) + '</b><span>' + esc(x.b) + '</span></div></li>'; }).join('') + '</ol>' : '<p class="rp-s-empty">لا قرارات معلّقة.</p>',
      note: 'اطلب قراراً واضحاً لكل بند، مع مسؤول وموعد.' });
    return S2;
  }

  var pres = null;
  function startPresent(start) {
    if (pres) return;
    var d = compute(prefs().scope), slides = buildSlides(d), P = prefs();
    var el = document.createElement('div');
    el.className = 'sec-reports rp-present' + (P.notes ? ' notes' : '');
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'عرض تقديمي');
    el.innerHTML = '<div class="rp-pbar"><button class="btn sm" data-p="close">إغلاق (Esc)</button><button class="btn sm" data-p="notes" aria-pressed="' + (P.notes ? 'true' : 'false') + '">ملاحظات المتحدث (N)</button>' +
      '<button class="btn sm" data-p="fs">ملء الشاشة (F)</button><span class="rp-grow"></span><span class="rp-count" aria-live="polite"></span>' +
      '<button class="btn sm" data-p="prev">السابق</button><button class="btn sm" data-p="next">التالي</button></div>' +
      '<div class="rp-stage">' + slides.map(function (s, i) {
        return '<section class="rp-slide ' + (s.cls || '') + '" data-i="' + i + '" aria-hidden="true"><header><h1>' + esc(s.title) + '</h1>' + (s.sub ? '<p>' + esc(s.sub) + '</p>' : '') + '</header>' +
          '<div class="rp-sbody">' + s.body + '</div><footer><span>' + COMPANY + '</span><span class="num">' + dg((i + 1) + ' / ' + slides.length) + '</span></footer></section>';
      }).join('') + '</div>' +
      '<div class="rp-snote" aria-live="polite"></div>' +
      '<div class="rp-dots" role="tablist">' + slides.map(function (s, i) { return '<button role="tab" aria-label="شريحة ' + (i + 1) + ': ' + esc(s.title) + '" data-dot="' + i + '"></button>'; }).join('') + '</div>';
    document.body.appendChild(el);
    var prevFocus = document.activeElement;
    var idx = Math.max(0, Math.min(slides.length - 1, start || 0));
    function show(n, dir) {
      idx = Math.max(0, Math.min(slides.length - 1, n));
      el.querySelectorAll('.rp-slide').forEach(function (s, i) {
        s.classList.toggle('on', i === idx); s.classList.toggle('before', i < idx); s.classList.toggle('after', i > idx);
        s.setAttribute('aria-hidden', i === idx ? 'false' : 'true');
      });
      el.querySelectorAll('[data-dot]').forEach(function (b, i) { b.setAttribute('aria-selected', i === idx ? 'true' : 'false'); });
      el.querySelector('.rp-count').textContent = dg((idx + 1) + ' / ' + slides.length);
      el.querySelector('.rp-snote').textContent = slides[idx].note || '';
      el.querySelector('[data-p="prev"]').disabled = idx === 0;
      el.querySelector('[data-p="next"]').disabled = idx === slides.length - 1;
      void dir;
    }
    function toggleNotes() { P.notes = !P.notes; savePrefs(); el.classList.toggle('notes', P.notes); el.querySelector('[data-p="notes"]').setAttribute('aria-pressed', P.notes ? 'true' : 'false'); }
    function fs() {
      var fsEl = document.fullscreenElement || document.webkitFullscreenElement;
      try {
        if (fsEl) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
        var req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) throw new Error('no-fs');
        var p = req.call(el);
        if (p && p.catch) p.catch(function () { toast('ملء الشاشة غير مسموح هنا — العرض يملأ النافذة بدلاً منه', 'info'); });
      } catch (e) { toast('ملء الشاشة غير مسموح هنا — العرض يملأ النافذة بدلاً منه', 'info'); }
    }
    function close() {
      document.removeEventListener('keydown', onKey, true);
      try { if (document.fullscreenElement) document.exitFullscreen(); } catch (e) { /* */ }
      el.classList.add('out');
      setTimeout(function () { el.remove(); }, prefersReduced() ? 0 : 200);
      document.documentElement.classList.remove('rp-presenting');
      pres = null;
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* */ }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        /* Esc داخل ملء الشاشة يخرج منه المتصفح؛ خارجه يغلق العرض */
        if (document.fullscreenElement) return;
        e.preventDefault(); e.stopPropagation(); close(); return;
      }
      var k = e.key;
      /* RTL: الأيسر يتقدّم، الأيمن يرجع — يطابق Present.tsx */
      if (k === 'ArrowLeft' || k === 'PageDown' || k === ' ' || k === 'Spacebar') { e.preventDefault(); e.stopPropagation(); show(idx + 1, 1); }
      else if (k === 'ArrowRight' || k === 'PageUp') { e.preventDefault(); e.stopPropagation(); show(idx - 1, -1); }
      else if (k === 'Home') { e.preventDefault(); show(0); }
      else if (k === 'End') { e.preventDefault(); show(slides.length - 1); }
      else if (k === 'n' || k === 'N' || k === 'ى') { e.preventDefault(); toggleNotes(); }
      else if (k === 'f' || k === 'F' || k === 'ب') { e.preventDefault(); fs(); }
      else if (k === 'Tab') {
        var f = el.querySelectorAll('button:not([disabled])'); if (!f.length) return;
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener('keydown', onKey, true);
    el.addEventListener('click', function (e) {
      var b = e.target.closest('[data-p],[data-dot]'); if (!b) return;
      var a = b.getAttribute('data-p');
      if (b.hasAttribute('data-dot')) show(+b.getAttribute('data-dot'));
      else if (a === 'close') close(); else if (a === 'prev') show(idx - 1); else if (a === 'next') show(idx + 1);
      else if (a === 'notes') toggleNotes(); else if (a === 'fs') fs();
    });
    /* نقر على الشريحة نفسها يتقدّم (كالعرض التقليدي) */
    el.querySelector('.rp-stage').addEventListener('click', function (e) { if (!e.target.closest('a,button,table')) show(idx + 1); });
    document.documentElement.classList.add('rp-presenting');
    pres = { close: close };
    show(idx);
    el.querySelector('[data-p="next"]').focus();
    fs();
  }

  function renderPresent(root) {
    var P = prefs();
    if (P.scope !== 'all' && !get('projects', P.scope)) P.scope = 'all';
    var d = compute(P.scope), slides = buildSlides(d);
    var projOpts = list('projects').map(function (p) { return '<option value="' + esc(p.id) + '"' + (P.scope === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('');
    root.innerHTML = '<div class="ph"><div><h1>عرض تقديمي</h1><p>' + dg(slides.length) + ' شرائح من نفس بيانات التقرير — لا يمكن أن تختلف عما تعرضه الشاشات <span class="sample">بيانات مثال</span></p></div>' +
      '<div class="acts"><label class="rp-inline">النطاق <select data-k="scope"><option value="all">كل المشاريع</option>' + projOpts + '</select></label>' +
      '<button class="btn" data-a="notes" aria-pressed="' + (P.notes ? 'true' : 'false') + '">ملاحظات المتحدث: ' + (P.notes ? 'ظاهرة' : 'مخفية') + '</button>' +
      '<button class="btn primary" data-a="start">ابدأ العرض</button></div></div>' +
      '<p class="rp-help">← / مسافة: التالي · →: السابق · N: الملاحظات · F: ملء الشاشة · Esc: إغلاق. إن منع المتصفح ملء الشاشة يملأ العرض النافذة.</p>' +
      '<div class="grid">' + slides.map(function (s, i) {
        return '<button class="isl c4 click rp-thumb" style="--i:' + i + '" data-start="' + i + '" aria-label="ابدأ من الشريحة ' + (i + 1) + '">' +
          '<span class="rp-tn num">' + dg(i + 1) + '</span><b>' + esc(s.title) + '</b><span class="cap">' + esc(s.sub || '') + '</span>' +
          (P.notes && s.note ? '<span class="rp-tnote">' + esc(s.note) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    root.querySelector('[data-k="scope"]').addEventListener('change', function (e) { P.scope = e.target.value; savePrefs(); renderPresent(root); });
    root.querySelector('[data-a="start"]').addEventListener('click', function () { startPresent(0); });
    root.querySelector('[data-a="notes"]').addEventListener('click', function () { P.notes = !P.notes; savePrefs(); renderPresent(root); });
    root.querySelectorAll('[data-start]').forEach(function (b) { b.addEventListener('click', function () { startPresent(+b.getAttribute('data-start')); }); });
  }

  /* ───────── ٣ · التصدير ───────── */
  var CON_FORMATS = [
    ['قوائم', [['full', 'تحليل المقاولين'], ['creditors', 'لهم علينا فقط'], ['debtors', 'لنا عليهم فقط'], ['by_status', 'التوزيع بالحالة'], ['missing_statement', 'بلا كشف مرفوع — قائمة عمل']]],
    ['بالمشروع', [['project_totals', 'إجماليات المشاريع — نظرة القرار'], ['by_project_creditors', 'بالمشروع ← الدائنون تحته'], ['by_project_debtors', 'بالمشروع ← المدينون تحته'], ['single_project', 'مشروع واحد…']]],
    ['تقارير تدقيق', [['reported_vs_derived', 'المبلَّغ مقابل المشتقّ'], ['balanced_dormant', 'المتساوية والخاملة'], ['opening_vs_activity', 'الافتتاحي مقابل نشاط الحركة']]],
    ['تقرير شامل', [['full_report', 'التقرير الكامل (كل الأوراق في ملف واحد)']]]
  ];
  var STATUS_AR = { active: 'نشط', paused: 'متوقف', finished: 'منتهٍ', disputed: 'نزاع' };
  function conRow(c) {
    return { name: c.name, code: c.code, status: STATUS_AR[c.status] || '—', projects: c.projectIds.map(projName).join(' / '),
      claims: c.claimsTotal.toFixed(2), paid: c.paidTotal.toFixed(2), balance: c.balance.toFixed(2), direction: balWord(c.balance),
      owed: c.owed.toFixed(2), overdue: c.overdue == null ? '— بلا مدة' : c.overdue.toFixed(2), term: c.termDays == null ? '—' : c.termDays,
      retention: c.retention.toFixed(2), last: c.lastDate || '—', entries: c.entries.length,
      opening: c.opening.toFixed(2), activity: c.activity.toFixed(2), ledger: c.ledger.toFixed(2), diff: ((cents(c.ledger) - cents(c.balance)) / 100).toFixed(2) };
  }
  var CON_COLS = [['name', 'المقاول'], ['code', 'الحساب'], ['status', 'الحالة'], ['projects', 'المشاريع'], ['claims', 'المستخلصات'], ['paid', 'المسدد'],
    ['balance', 'الرصيد'], ['direction', 'الاتجاه'], ['overdue', 'المتأخر'], ['term', 'مدة السداد'], ['retention', 'المحتجز'], ['last', 'آخر حركة']];
  function contractorsExport(fmtKey, pid) {
    var all = contractorRows(null), T = iso(today());
    var cols = CON_COLS, rows, extra = '';
    var by = function (filter) {
      var out = [];
      list('projects').forEach(function (p) {
        var cs = all.filter(function (c) { return c.projectIds.indexOf(p.id) >= 0 && filter(c); });
        if (!cs.length) return;
        cs.forEach(function (c) { out.push(Object.assign({ project: p.name }, conRow(c))); });
        out.push({ project: p.name, name: 'إجمالي ' + p.name, balance: sum(cs, 'balance').toFixed(2), direction: balWord(sum(cs, 'balance')) });
      });
      return out;
    };
    switch (fmtKey) {
      case 'creditors': rows = all.filter(function (c) { return c.balance < 0; }).map(conRow); break;
      case 'debtors': rows = all.filter(function (c) { return c.balance > 0; }).map(conRow); break;
      case 'by_status': rows = all.slice().sort(function (a, b) { return (a.status || '').localeCompare(b.status || ''); }).map(conRow); cols = [['status', 'الحالة']].concat(CON_COLS.filter(function (c) { return c[0] !== 'status'; })); break;
      case 'missing_statement': rows = all.filter(function (c) { return !c.entries.some(function (e) { return e.importId; }); }).map(conRow); extra = 'مقاولون بلا أي كشف مستورد — قائمة عمل للمحاسب.'; break;
      case 'project_totals':
        rows = list('projects').map(function (p) {
          var cs = all.filter(function (c) { return c.projectIds.indexOf(p.id) >= 0; });
          return { name: p.name, count: cs.length, creditors: sum(cs.filter(function (c) { return c.balance < 0; }), 'balance').toFixed(2), debtors: sum(cs.filter(function (c) { return c.balance > 0; }), 'balance').toFixed(2), balance: sum(cs, 'balance').toFixed(2), direction: balWord(sum(cs, 'balance')) };
        });
        cols = [['name', 'المشروع'], ['count', 'عدد المقاولين'], ['creditors', 'لهم علينا'], ['debtors', 'لنا عليهم'], ['balance', 'الصافي'], ['direction', 'الاتجاه']];
        extra = 'المقاول المشترك بين مشروعين يُحسب رصيده الكامل في كليهما.'; break;
      case 'by_project_creditors': rows = by(function (c) { return c.balance < 0; }); cols = [['project', 'المشروع']].concat(CON_COLS); break;
      case 'by_project_debtors': rows = by(function (c) { return c.balance > 0; }); cols = [['project', 'المشروع']].concat(CON_COLS); break;
      case 'single_project': rows = all.filter(function (c) { return c.projectIds.indexOf(pid) >= 0; }).map(conRow); extra = 'مشروع: ' + projName(pid); break;
      case 'reported_vs_derived': rows = all.map(conRow); cols = [['name', 'المقاول'], ['code', 'الحساب'], ['ledger', 'مجموع القيود (مدين − دائن)'], ['balance', 'الرصيد المشتق'], ['diff', 'الفرق']];
        extra = 'لا يحفظ النموذج رصيداً «مبلَّغاً» منفصلاً من الكشف؛ المقارنة هنا بين مجموع القيود المسجّلة والرصيد المشتق — أي فرق ≠ ٠ يستحق المراجعة.'; break;
      case 'balanced_dormant': rows = all.filter(function (c) { return Math.abs(c.balance) < 0.005 || !c.lastDate || daysBetween(c.lastDate, T) > 90; }).map(function (c) { var r = conRow(c); r.why = Math.abs(c.balance) < 0.005 ? 'متساوٍ' : 'خامل > ٩٠ يوماً'; return r; });
        cols = [['name', 'المقاول'], ['code', 'الحساب'], ['why', 'السبب'], ['balance', 'الرصيد'], ['last', 'آخر حركة']]; break;
      case 'opening_vs_activity': rows = all.map(conRow); cols = [['name', 'المقاول'], ['code', 'الحساب'], ['opening', 'الافتتاحي'], ['activity', 'نشاط الحركة'], ['ledger', 'الختامي']]; break;
      case 'full_report':
        rows = [];
        CON_FORMATS.forEach(function (g) { g[1].forEach(function (f) {
          if (f[0] === 'full_report' || f[0] === 'single_project') return;
          var sub = contractorsExport(f[0]);
          sub.rows.forEach(function (r) { var o = { sheet: f[1] }; sub.cols.forEach(function (c, i) { o['c' + i] = (c[1] + ': ') + (r[c[0]] == null ? '' : r[c[0]]); }); rows.push(o); });
        }); });
        cols = [['sheet', 'الورقة']].concat([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(function (i) { return ['c' + i, 'عمود ' + (i + 1)]; }));
        extra = 'CSV لا يدعم أوراقاً متعددة — كل ورقة صفوف مُعلَّمة بعمود «الورقة».'; break;
      default: rows = all.map(conRow);
    }
    return { rows: rows, cols: cols, note: extra };
  }

  function ledgerRunning(entries, sign) {
    var run = 0;
    return entries.map(function (e) { run += sign(e); return Object.assign({}, e, { run: (run / 100).toFixed(2), runDir: balWord(run) }); });
  }

  var CATALOG = [
    { key: 'pay', title: 'قائمة الدفع', desc: 'ما يجب دفعه مرتباً بالتاريخ — موردون ومقاولون', fields: [{ name: 'days', label: 'الأفق', type: 'select', value: '14', options: [['7', '٧ أيام'], ['14', '١٤ يوماً'], ['30', '٣٠ يوماً'], ['60', '٦٠ يوماً']] }, { name: 'who', label: 'الجهات', type: 'select', value: 'all', options: [['all', 'الكل'], ['supplier', 'الموردون'], ['contractor', 'المقاولون']] }, { name: 'late', label: 'المتأخر', type: 'select', value: 'incl', options: [['incl', 'ضمّن المتأخر'], ['only', 'المتأخر فقط'], ['excl', 'استبعد المتأخر']] }],
      cols: [['date', 'التاريخ'], ['party', 'الجهة'], ['type', 'النوع'], ['amount', 'المبلغ'], ['late', 'أيام التأخر']],
      build: function (f) {
        var rows = safe(function () { return S().dueList({ days: +f.days }) || []; }, []);
        return rows.filter(function (r) { return (f.who === 'all' || r.partyType === f.who) && (f.late === 'incl' || (f.late === 'only' ? r.late > 0 : !(r.late > 0))); })
          .map(function (r) { return { date: r.date, party: r.party, type: r.partyType === 'contractor' ? 'مقاول' : r.partyType === 'supplier' ? 'مورد' : (r.partyType || ''), amount: (+r.amount).toFixed(2), late: r.late > 0 ? r.late : '' }; });
      } },
    { key: 'sup', title: 'كشف مورد', desc: 'الفواتير والدفعات بالرصيد الجاري', fields: function () { return [{ name: 'id', label: 'المورد', type: 'select', required: true, options: list('suppliers').map(function (s) { return [s.id, s.name + ' · ' + s.account]; }) }, { name: 'open', label: 'المحتوى', type: 'select', value: 'all', options: [['all', 'كل الحركات'], ['open', 'الفواتير المفتوحة فقط']] }]; },
      cols: [['date', 'التاريخ'], ['kind', 'النوع'], ['doc', 'المستند'], ['due', 'الاستحقاق'], ['credit', 'دائن (فاتورة)'], ['debit', 'مدين (دفعة)'], ['remaining', 'المتبقي'], ['late', 'أيام التأخر'], ['run', 'الرصيد الجاري']],
      build: function (f) {
        var pos = safe(function () { return S().supplierPosition(f.id); }, null) || { invoices: [] };
        var byId = {}; (pos.invoices || []).forEach(function (i) { byId[i.id] = i; });
        if (f.open === 'open') return (pos.invoices || []).filter(function (i) { return +i.remaining > 0; }).map(function (i) { return { date: i.date, kind: 'فاتورة', doc: i.no, due: i.dueDate, credit: (+i.amount).toFixed(2), remaining: (+i.remaining).toFixed(2), late: i.lateDays > 0 ? i.lateDays : '' }; });
        var ents = list('invoices').filter(function (i) { return i.supplierId === f.id; }).map(function (i) { return { date: i.date, kind: 'فاتورة', doc: i.no, credit: +i.amount, debit: 0, id: i.id }; })
          .concat(list('payments').filter(function (p) { return p.supplierId === f.id; }).map(function (p) { return { date: p.date, kind: 'دفعة', doc: p.doc, credit: 0, debit: +p.amount }; }))
          .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        var run = 0;
        return ents.map(function (e) {
          run += cents(e.credit) - cents(e.debit); var inv = e.id ? byId[e.id] : null;
          return { date: e.date, kind: e.kind, doc: e.doc, due: inv ? inv.dueDate : '', credit: e.credit ? e.credit.toFixed(2) : '', debit: e.debit ? e.debit.toFixed(2) : '', remaining: inv ? (+inv.remaining).toFixed(2) : '', late: inv && inv.lateDays > 0 && inv.remaining > 0 ? inv.lateDays : '', run: (run / 100).toFixed(2) + (run > 0 ? ' نحن ندين' : '') };
        });
      }, fileName: function (f) { var s = get('suppliers', f.id); return 'كشف-' + (s ? s.name : 'مورد'); } },
    { key: 'con', title: 'كشف مقاول', desc: 'كل القيود بالرصيد الجاري — السالب نحن ندين', fields: function () { return [{ name: 'id', label: 'المقاول', type: 'select', required: true, options: list('contractors').map(function (c) { return [c.id, c.name + ' · ' + c.code]; }) }, { name: 'project', label: 'المشروع', type: 'select', value: '', options: [['', 'كل المشاريع']].concat(list('projects').map(function (p) { return [p.id, p.name]; })) }]; },
      cols: [['date', 'التاريخ'], ['kind', 'النوع'], ['claimNo', 'رقم المستخلص'], ['description', 'البيان'], ['project', 'المشروع'], ['debit', 'مدين'], ['credit', 'دائن'], ['run', 'الرصيد'], ['runDir', 'الاتجاه']],
      build: function (f) {
        var K = { opening: 'افتتاحي', claim: 'مستخلص', payment: 'دفعة', retention: 'محتجز', deduction: 'خصم', invoice: 'فاتورة', other: 'أخرى' };
        var ents = list('contractorEntries').filter(function (e) { return e.contractorId === f.id && (!f.project || e.projectId === f.project); }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
        return ledgerRunning(ents, function (e) { return cents(e.debit) - cents(e.credit); }).map(function (e) {
          return { date: e.date, kind: K[e.kind] || e.kind, claimNo: e.claimNo || '', description: e.description || '', project: e.projectId ? projName(e.projectId) : '', debit: e.debit ? (+e.debit).toFixed(2) : '', credit: e.credit ? (+e.credit).toFixed(2) : '', run: e.run, runDir: e.runDir };
        });
      }, fileName: function (f) { var c = get('contractors', f.id); return 'كشف-' + (c ? c.name : 'مقاول'); } },
    { key: 'aging', title: 'أعمار الديون', desc: 'لكل مورد: لم يستحق · ١–٣٠ · ٣١–٦٠ · ٦١–٩٠ · +٩٠', fields: function () { return [{ name: 'project', label: 'النطاق', type: 'select', value: '', options: [['', 'كل المشاريع']].concat(list('projects').map(function (p) { return [p.id, p.name]; })) }, { name: 'only', label: 'الموردون', type: 'select', value: 'open', options: [['open', 'من لهم مديونية فقط'], ['all', 'الكل']] }]; },
      cols: [['name', 'المورد'], ['account', 'الحساب'], ['b0', 'لم يستحق'], ['b1', '١–٣٠'], ['b2', '٣١–٦٠'], ['b3', '٦١–٩٠'], ['b4', 'أكثر من ٩٠'], ['open', 'المفتوح'], ['overdue', 'المتأخر'], ['oldest', 'أقدم تأخر']],
      build: function (f) {
        var r = supplierRows(f.project || null).filter(function (s) { return f.only === 'all' || s.open > 0; });
        var out = r.map(function (s) { return { name: s.name, account: s.account, b0: s.b0.toFixed(2), b1: s.b1.toFixed(2), b2: s.b2.toFixed(2), b3: s.b3.toFixed(2), b4: s.b4.toFixed(2), open: s.open.toFixed(2), overdue: s.overdue.toFixed(2), oldest: s.oldest || '' }; });
        out.push({ name: 'الإجمالي', b0: sum(r, 'b0').toFixed(2), b1: sum(r, 'b1').toFixed(2), b2: sum(r, 'b2').toFixed(2), b3: sum(r, 'b3').toFixed(2), b4: sum(r, 'b4').toFixed(2), open: sum(r, 'open').toFixed(2), overdue: sum(r, 'overdue').toFixed(2) });
        return out;
      } },
    { key: 'contractors', title: 'المقاولون', desc: '١٣ صيغة: قوائم · بالمشروع · تدقيق · شامل', special: 'contractors' },
    { key: 'budget', title: 'الموازنة', desc: 'المخطط مقابل الفعلي شهرياً أو بالمشروع', fields: function () { return [{ name: 'project', label: 'المشروع', type: 'select', value: '', options: [['', 'كل المشاريع']].concat(list('projects').map(function (p) { return [p.id, p.name]; })) }, { name: 'level', label: 'المستوى', type: 'select', value: 'month', options: [['month', 'شهري'], ['project', 'إجمالي المشروع']] }]; },
      cols: [['project', 'المشروع'], ['month', 'الشهر'], ['planned', 'المخطط'], ['actual', 'الفعلي'], ['variance', 'الفرق'], ['pct', 'الفرق ٪'], ['docNo', 'المستند']],
      build: function (f) {
        if (f.level === 'project') return budgetRows(f.project || null).map(function (b) { return { project: b.name, month: dg(b.months) + ' شهر', planned: b.planned.toFixed(2), actual: b.actual.toFixed(2), variance: b.variance.toFixed(2), pct: b.pct == null ? '' : b.pct.toFixed(2) }; });
        return list('budgetMonths').filter(function (m) { return !f.project || m.projectId === f.project; }).sort(function (a, b) { return (a.projectId + a.month) < (b.projectId + b.month) ? -1 : 1; })
          .map(function (m) { var v = (cents(m.actual) - cents(m.planned)) / 100; return { project: projName(m.projectId), month: m.month, planned: (+m.planned).toFixed(2), actual: (+m.actual).toFixed(2), variance: v.toFixed(2), pct: m.planned ? (v / m.planned * 100).toFixed(2) : '', docNo: m.docNo || '' }; });
      } },
    { key: 'rec', title: 'التحصيلات', desc: 'المستحق لنا من الجهات المالكة', fields: function () { return [{ name: 'status', label: 'الحالة', type: 'select', value: 'open', options: [['open', 'غير المحصّل'], ['pending', 'قيد الاعتماد'], ['approved', 'معتمد'], ['collected', 'محصّل'], ['all', 'الكل']] }, { name: 'project', label: 'المشروع', type: 'select', value: '', options: [['', 'كل المشاريع']].concat(list('projects').map(function (p) { return [p.id, p.name]; })) }]; },
      cols: [['project', 'المشروع'], ['from', 'الجهة'], ['docNo', 'المستند'], ['dueDate', 'الاستحقاق'], ['status', 'الحالة'], ['late', 'أيام التأخر'], ['amount', 'المبلغ'], ['collectedAt', 'تاريخ التحصيل']],
      build: function (f) {
        var st = { pending: 'قيد الاعتماد', approved: 'معتمد', collected: 'محصّل' };
        return receivableRows(f.project || null).filter(function (r) { return f.status === 'all' || (f.status === 'open' ? r.status !== 'collected' : r.status === f.status); })
          .map(function (r) { return { project: projName(r.projectId), from: r.from, docNo: r.docNo, dueDate: r.dueDate, status: st[r.status] || r.status, late: r.late || '', amount: (+r.amount).toFixed(2), collectedAt: r.collectedAt ? String(r.collectedAt).slice(0, 10) : '' }; });
      } },
    { key: 'imports', title: 'سجل الاستيراد', desc: 'كل ملف رُفع: ما أُضيف وما طابق مسبقاً', fields: [{ name: 'status', label: 'الحالة', type: 'select', value: 'all', options: [['all', 'الكل'], ['ok', 'ناجح'], ['failed', 'فاشل']] }],
      cols: [['at', 'التاريخ'], ['file', 'الملف'], ['kind', 'النوع'], ['party', 'الطرف'], ['added', 'مضاف'], ['matched', 'مطابق مسبقاً'], ['status', 'الحالة'], ['error', 'الخطأ']],
      build: function (f) {
        return list('imports').filter(function (i) { return f.status === 'all' || i.status === f.status; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; }).map(function (i) {
          var p = i.partyId ? (get(i.partyType === 'contractor' ? 'contractors' : 'suppliers', i.partyId) || {}).name : '';
          return { at: String(i.at || '').replace('T', ' ').slice(0, 16), file: i.file, kind: i.kind, party: p || '—', added: i.added, matched: i.matched, status: i.status === 'ok' ? 'ناجح' : 'فاشل', error: i.error || '' };
        });
      } }
  ];

  function fieldsHtml(fields) {
    return fields.map(function (f) {
      return '<label class="rp-f"><span>' + esc(f.label) + '</span><select name="' + f.name + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (String(f.value) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></label>';
    }).join('');
  }
  function readSel(root) { var o = {}; root.querySelectorAll('select[name]').forEach(function (s) { o[s.name] = s.value; }); return o; }

  function openExport(item) {
    var fields = typeof item.fields === 'function' ? item.fields() : (item.fields || []);
    var isCon = item.special === 'contractors';
    if (isCon) fields = [{ name: 'format', label: 'الصيغة', type: 'select', value: 'full', options: [] }, { name: 'project', label: 'المشروع (لـ«مشروع واحد»)', type: 'select', value: '', options: list('projects').map(function (p) { return [p.id, p.name]; }) }];
    if (fields.some(function (f) { return f.required && !f.options.length; })) {
      toast('لا توجد سجلات لهذا التصدير بعد', 'info'); return;
    }
    var fh = isCon ? '<label class="rp-f"><span>الصيغة</span><select name="format">' + CON_FORMATS.map(function (g) {
      return '<optgroup label="' + g[0] + '">' + g[1].map(function (o) { return '<option value="' + o[0] + '">' + o[1] + '</option>'; }).join('') + '</optgroup>'; }).join('') + '</select></label>' + fieldsHtml([fields[1]]) : fieldsHtml(fields);
    function current(root) {
      var f = readSel(root);
      if (isCon) { var r = contractorsExport(f.format, f.project); return { f: f, rows: r.rows, cols: r.cols, note: r.note }; }
      return { f: f, rows: item.build(f), cols: item.cols, note: '' };
    }
    var colState = {};
    U().modal({
      title: 'تصدير — ' + item.title, size: 'md',
      body: '<div class="sec-reports rp-xcfg"><div class="rp-xf">' + fh + '</div><div class="rp-f"><span>الأعمدة</span><div class="rp-cols"></div></div>' +
        '<p class="rp-xcount cap" aria-live="polite"></p><p class="rp-xnote cap"></p></div>',
      actions: [{ label: 'إلغاء', onClick: function (close) { close(); } },
        { label: 'متابعة إلى الملف', kind: 'primary', onClick: function (close, root) {
          var c = current(root), cols = c.cols.filter(function (x) { return colState[x[0]] !== false; });
          if (!cols.length) { toast('اختر عموداً واحداً على الأقل', 'error'); return; }
          var csv = toCSV(c.rows, cols.map(function (x) { return { key: x[0], label: x[1] }; }));
          var name = (item.fileName ? item.fileName(c.f) : item.title) + (isCon ? '-' + c.f.format : '') + '-' + iso(today()) + '.csv';
          close();
          setTimeout(function () { U().exportDialog({ title: item.title, csv: csv, fileName: name.replace(/\s+/g, '-') }); }, 0);
        } }],
      onOpen: function (root) {
        function upd() {
          var c = current(root);
          var host = root.querySelector('.rp-cols');
          host.innerHTML = c.cols.map(function (x) { return '<button type="button" class="chip" data-col="' + x[0] + '" aria-pressed="' + (colState[x[0]] === false ? 'false' : 'true') + '">' + esc(x[1]) + '</button>'; }).join('');
          root.querySelector('.rp-xcount').textContent = 'سيُصدَّر ' + dg(c.rows.length) + ' صفاً × ' + dg(c.cols.filter(function (x) { return colState[x[0]] !== false; }).length) + ' عموداً';
          root.querySelector('.rp-xnote').textContent = c.note || '';
          var pj = root.querySelector('select[name="project"]');
          if (isCon && pj) pj.closest('.rp-f').hidden = c.f.format !== 'single_project';
        }
        /* إعدادات التصدير ليست «تعديلات غير محفوظة» — نوقف انتشار الحدث كي لا يطلق حارس ui.modal */
        var cfg = root.querySelector('.rp-xcfg');
        ['input', 'change'].forEach(function (t) { cfg.addEventListener(t, function (e) { e.stopPropagation(); if (t === 'change' && e.target.matches('select')) upd(); }); });
        root.addEventListener('click', function (e) {
          var b = e.target.closest('[data-col]'); if (!b) return;
          var k = b.getAttribute('data-col'); colState[k] = colState[k] === false; upd();
          var nb = root.querySelector('[data-col="' + k + '"]'); if (nb) nb.focus();
        });
        upd();
      }
    });
  }

  function renderExports(root) {
    var counts = {
      pay: safe(function () { return (S().dueList({ days: 14 }) || []).length; }, 0), sup: list('suppliers').length, con: list('contractors').length,
      aging: supplierRows(null).filter(function (s) { return s.open > 0; }).length, contractors: list('contractors').length,
      budget: list('budgetMonths').length, rec: list('receivables').filter(function (r) { return r.status !== 'collected'; }).length, imports: list('imports').length
    };
    var unit = { pay: 'استحقاق خلال ١٤ يوماً', sup: 'مورد', con: 'مقاول', aging: 'مورد بمديونية', contractors: 'مقاول', budget: 'شهر موازنة', rec: 'تحصيل مفتوح', imports: 'ملف' };
    root.innerHTML = '<div class="ph"><div><h1>التصدير</h1><p>كل ما يُرسل للمحاسب أو المدير في مكان واحد — CSV يُفتح في Excel <span class="sample">بيانات مثال</span></p></div></div>' +
      '<p class="rp-help">التنزيل المباشر محجوب داخل الصفحة المنشورة: كل تصدير يُعرض جدولاً مع «نسخ» ومحاولة تنزيل قد لا تنجح.</p>' +
      '<div class="grid">' + CATALOG.map(function (it, i) {
        return '<button class="isl c4 click rp-xcard" style="--i:' + i + '" data-x="' + it.key + '"><div class="ih"><h2>' + it.title + '</h2><span class="pill n">CSV</span></div>' +
          '<span class="rp-xdesc">' + it.desc + '</span><span class="meta"><span class="num">' + dg(int(counts[it.key] || 0)) + '</span> ' + unit[it.key] + '</span></button>';
      }).join('') +
      '<button class="isl c4 click rp-xcard" style="--i:' + CATALOG.length + '" data-x="gm"><div class="ih"><h2>تقرير المدير العام</h2><span class="pill n">CSV · HTML · نص</span></div><span class="rp-xdesc">صفحة A4 بالأقسام المختارة</span><span class="meta">من تبويب التقرير</span></button>' +
      '</div>';
    root.querySelectorAll('[data-x]').forEach(function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-x');
        if (k === 'gm') { E.shell.go('report'); return; }
        var it = CATALOG.filter(function (x) { return x.key === k; })[0];
        if (it) openExport(it);
      });
    });
  }

  /* ───────── التسجيل ───────── */
  function wrap(fn) {
    return function (container, params) {
      var root = document.createElement('div');
      root.className = 'sec-reports';
      container.innerHTML = '';
      container.appendChild(root);
      try { fn(root, params || {}); }
      catch (e) { root.innerHTML = '<div class="isl"><b>تعذّر رسم هذا العرض</b><p class="cap">' + esc(e && e.message) + '</p></div>'; if (window.console) console.error(e); }
    };
  }
  function register() {
    if (!E.shell || !E.shell.register) return false;
    E.shell.register('report', { section: 'reports', tab: 'تقرير المدير العام', title: 'تقرير المدير العام', render: wrap(renderReport) });
    E.shell.register('present', { section: 'reports', tab: 'عرض تقديمي', title: 'عرض تقديمي', render: wrap(renderPresent) });
    E.shell.register('exports', { section: 'reports', tab: 'التصدير', title: 'التصدير', render: wrap(renderExports) });
    return true;
  }
  if (!register()) document.addEventListener('DOMContentLoaded', register, { once: true });

  E.reports = { startPresent: startPresent, compute: compute, _t: { buildSlides: buildSlides, contractorsExport: contractorsExport, catalog: CATALOG, reportText: reportText, reportTablesCSV: reportTablesCSV } };
})();
