/* قسم «اليوم» — اليوم · المستحقات القادمة · التقويم
   يغطي وظيفياً: CommandCentre.tsx (لوحة القيادة) · Dashboard.tsx (لوحة اليوم) · Calendar.tsx (التقويم المالي).
   يعتمد حصراً على عقد EGCO.store / EGCO.ui / EGCO.shell. */
(function () {
  'use strict';
  var E = window.EGCO = window.EGCO || {};
  var S = function () { return E.store; };
  var U = function () { return E.ui; };
  var DAY = 864e5;
  var TASK_KEY = 'egco-today-tasks-v1';
  var visited = {};            // العدّ التصاعدي في أول زيارة فقط
  var dueState = { range: '7', project: '', selected: new Set() };
  var calState = null;         // {y,m,mode,weekStart,project}

  /* ───────── أدوات ───────── */
  function esc(s) { return U().esc(s == null ? '' : String(s)); }
  function dg(s) { return U().digits(String(s)); }
  function money(n, cls) { return U().money(Number(n) || 0, cls); }
  function today() { var t = S().TODAY || new Date(2026, 10, 17); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
  function iso(d) { d = new Date(d); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(s) { if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate()); var p = String(s || '').slice(0, 10).split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function daysBetween(a, b) { return Math.round((parse(b) - parse(a)) / DAY); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function sumC(arr, f) { var c = 0; arr.forEach(function (x) { c += Math.round((Number(f(x)) || 0) * 100); }); return c / 100; }
  function list(type) { try { return S().list(type) || []; } catch (e) { return []; } }
  function get(type, id) { try { return S().get(type, id); } catch (e) { return null; } }
  function go(view, params) { E.shell.go(view, params || {}); }
  function safe(fn, dflt) { try { var v = fn(); return v == null ? dflt : v; } catch (e) { return dflt; } }
  function plural(n, one, two, few, many) { n = Math.abs(n); return n === 1 ? one : n === 2 ? two : (n % 100 >= 3 && n % 100 <= 10) ? few : many; }
  function dateTxt(d, o) { return U().dateTxt(d, o); }
  function partyName(r) { if (r.party && typeof r.party === 'object') return r.party.name || ''; return r.party || r.name || ''; }
  function partyId(r) { if (r.party && typeof r.party === 'object') return r.party.id; return r.partyId; }
  function pType(r) { var t = r.partyType || (r.party && r.party.type) || ''; return /contr|مقاول/.test(t) ? 'contractor' : 'supplier'; }

  function loadDone() {
    try { var o = JSON.parse(localStorage.getItem(TASK_KEY) || '{}'); return o && o.day === iso(today()) ? o : { day: iso(today()), done: {} }; }
    catch (e) { return { day: iso(today()), done: {} }; }
  }
  var doneMem = null;
  function doneState() { if (!doneMem) doneMem = loadDone(); return doneMem; }
  function saveDone() { try { localStorage.setItem(TASK_KEY, JSON.stringify(doneMem)); } catch (e) { /* ذاكرة فقط */ } }

  function firstVisit(key) { var f = !visited[key]; visited[key] = true; return f; }
  function animate(root, first) { try { U().animateNumbers(root, first); } catch (e) { /* بلا حركة */ } }
  function counted(n, cls) { return U().counted ? U().counted(n, cls) : money(n, cls); }
  function bindGo(root) {
    root.querySelectorAll('[data-go]').forEach(function (el) {
      var h = function (ev) {
        if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return;
        if (ev.target.closest('button') && ev.target.closest('button') !== el && el.tagName !== 'BUTTON') return;
        ev.preventDefault();
        var p = {}; try { p = JSON.parse(el.getAttribute('data-params') || '{}'); } catch (e) { p = {}; }
        go(el.getAttribute('data-go'), p);
      };
      el.addEventListener('click', h);
      if (el.tagName !== 'BUTTON') el.addEventListener('keydown', h);
    });
  }
  function gp(o) { return esc(JSON.stringify(o || {})); }

  /* ───────── اشتقاقات محلية (من store فقط) ───────── */
  function supplierRows() {
    return list('suppliers').map(function (s) {
      var p = safe(function () { return S().supplierPosition(s.id); }, { open: 0, overdue: 0, due7: 0, oldestDays: 0, invoices: [], aging: {} });
      return { s: s, p: p };
    });
  }
  function contractorRows() {
    return list('contractors').map(function (c) {
      var p = safe(function () { return S().contractorPosition(c.id); }, { balance: 0, owed: 0, overdue: null, claims: [] });
      return { c: c, p: p };
    });
  }
  /* سلسلة المتأخر لـ٨ أسابيع: فواتير استحق موعدها حتى التاريخ ناقص كل الدفعات حتى التاريخ (لكل مورد، ≥٠) */
  function overdueHistory() {
    var sups = list('suppliers'), inv = list('invoices'), pay = list('payments'), def = safe(function () { return S().db.settings.defaultSupplierTerm; }, 60) || 60;
    var term = {}; sups.forEach(function (s) { term[s.id] = s.termDays != null ? s.termDays : def; });
    var pts = [];
    for (var w = 8; w >= 0; w--) {
      var t = addDays(today(), -7 * w), tot = 0;
      sups.forEach(function (s) {
        var due = 0, paid = 0;
        inv.forEach(function (i) { if (i.supplierId === s.id && parse(i.date) <= t && addDays(parse(i.date), term[s.id]) < t) due += Math.round(i.amount * 100); });
        pay.forEach(function (p) { if (p.supplierId === s.id && parse(p.date) <= t) paid += Math.round(p.amount * 100); });
        tot += Math.max(0, due - paid);
      });
      pts.push(tot / 100);
    }
    return pts;
  }
  function projection(days) { return safe(function () { return S().cashProjection(days); }, []); }
  function firstNeg(proj) { for (var i = 0; i < proj.length; i++) if (proj[i].balance < 0) return proj[i]; return null; }

  /* ───────── مهام اليوم (مولَّدة من store) ───────── */
  function buildTasks() {
    var T = [], t0 = today();
    // ١) عجز نقدي متوقع
    var proj = projection(30), neg = firstNeg(proj);
    if (neg) T.push({ id: 'deficit:' + neg.date, sev: 'd', score: 1e12, title: 'عجز نقدي متوقع ' + dateTxt(neg.date),
      sub: 'الرصيد يصبح ' + U().fmt(neg.balance) + ' ر.س — راجع التدفق أو أجّل دفعات', act: 'افتح التدفق', view: 'cash', params: { focus: neg.date } });
    // ٢) موردون متأخرون
    supplierRows().filter(function (r) { return r.p.overdue > 0; }).forEach(function (r) {
      var n = (r.p.invoices || []).filter(function (i) { return i.lateDays > 0 && i.remaining > 0; }).length;
      T.push({ id: 'sup:' + r.s.id, sev: 'd', score: r.p.overdue * (1 + (r.p.oldestDays || 0) / 30),
        title: 'ادفع لـ' + esc(r.s.name) + ' ' + money(r.p.overdue),
        sub: dg(n) + ' ' + plural(n, 'فاتورة متأخرة', 'فاتورتان متأخرتان', 'فواتير متأخرة', 'فاتورة متأخرة') + ' · أقدمها ' + dg(r.p.oldestDays || 0) + ' يوماً',
        act: 'سجّل دفعة', pay: { partyType: 'supplier', partyId: r.s.id, name: r.s.name, amount: r.p.overdue },
        view: 'supplier', params: { id: r.s.id } });
    });
    // ٣) مستخلصات متأخرة (لمن له مدة فقط)
    contractorRows().filter(function (r) { return r.p.overdue != null && r.p.overdue > 0; }).forEach(function (r) {
      var late = (r.p.claims || []).filter(function (c) { return c.lateDays > 0 && c.remaining > 0; });
      var oldest = late.reduce(function (m, c) { return Math.max(m, c.lateDays); }, 0);
      T.push({ id: 'con:' + r.c.id, sev: 'd', score: r.p.overdue * (1 + oldest / 30),
        title: 'مستخلص متأخر — ' + esc(r.c.name) + ' ' + money(r.p.overdue),
        sub: dg(late.length) + ' مستخلص متأخر · أقدمها ' + dg(oldest) + ' يوماً',
        act: 'سجّل دفعة', pay: { partyType: 'contractor', partyId: r.c.id, name: r.c.name, amount: r.p.overdue },
        view: 'contractor', params: { id: r.c.id } });
    });
    // ٤) ضمانات تنتهي ≤٧ أيام
    list('guarantees').filter(function (g) { if (g.returnedAt) return false; var d = daysBetween(t0, g.expiryDate); return d >= 0 && d <= 7; }).forEach(function (g) {
      var c = get('contractors', g.contractorId), d = daysBetween(t0, g.expiryDate);
      T.push({ id: 'gua:' + g.id, sev: 'w', score: g.amount * (8 - d),
        title: 'ضمان ' + esc(g.type || '') + ' ينتهي ' + (d === 0 ? 'اليوم' : 'خلال ' + dg(d) + ' ' + plural(d, 'يوم', 'يومين', 'أيام', 'يوماً')),
        sub: esc(c ? c.name : '') + ' · ' + money(g.amount) + ' · ' + dateTxt(g.expiryDate),
        act: 'افتح الضمان', view: 'guarantees', params: { id: g.id } });
    });
    // ٥) كشوفات قديمة >٦٠ يوماً
    var cov = safe(function () { return S().staleness().coverage; }, []).filter(function (c) { return c.lastImportDays == null || c.lastImportDays > 60; });
    if (cov.length) {
      var names = cov.slice(0, 2).map(function (c) { var s = get('suppliers', c.supplierId); return s ? esc(s.name) : ''; }).filter(Boolean).join('، ');
      T.push({ id: 'stale:' + cov.length, sev: 'w', score: 5e4 * cov.length,
        title: 'جدّد ' + dg(cov.length) + ' ' + plural(cov.length, 'كشف', 'كشفين', 'كشوفات', 'كشفاً') + ' أقدم من ٦٠ يوماً',
        sub: names + (cov.length > 2 ? ' و' + dg(cov.length - 2) + ' غيرهم' : ''), act: 'ارفع كشفاً', view: 'coverage', params: { stale: 60 } });
    }
    // ٦) استيرادات فاشلة
    list('imports').filter(function (i) { return i.status === 'failed'; }).forEach(function (i) {
      T.push({ id: 'imp:' + i.id, sev: 'w', score: 8e4, title: 'فشل استيراد ' + esc(i.file || ''),
        sub: esc(i.error || 'خطأ غير معروف') + ' · ' + esc(U().ago(i.at)), act: 'أعد الرفع', view: 'import', params: { retry: i.id } });
    });
    T.sort(function (a, b) { return b.score - a.score; });
    return T;
  }

  /* ───────── تسجيل دفعة (مورد/مقاول) ───────── */
  function recordPayment(items, opts) {
    // items: [{partyType,partyId,name,amount,doc}]
    opts = opts || {};
    var total = sumC(items, function (x) { return x.amount; });
    return U().confirm({ title: 'تسجيل ' + (items.length > 1 ? dg(items.length) + ' دفعات' : 'دفعة'),
      body: (items.length === 1 ? 'تسجيل دفعة لـ' + esc(items[0].name) + ' بمبلغ ' : 'تسجيل دفعات بإجمالي ') + money(total) +
        ' بتاريخ ' + dateTxt(today()) + '. تُوزَّع على الأقدم أولاً.', confirmLabel: 'سجّل الدفع' }).then(function (ok) {
      if (!ok) return false;
      var created = [];
      items.forEach(function (x) {
        var r;
        if (x.partyType === 'contractor') r = S().create('contractorEntries', { contractorId: x.partyId, date: iso(today()), kind: 'payment', claimNo: null, debit: x.amount, credit: 0, description: 'دفعة — ' + (x.doc || 'من «اليوم»'), projectId: null, importId: null });
        else r = S().create('payments', { supplierId: x.partyId, date: iso(today()), amount: x.amount, doc: x.doc || 'دفعة يدوية', importId: null });
        if (r) created.push({ type: x.partyType === 'contractor' ? 'contractorEntries' : 'payments', id: r.id || r });
      });
      U().toast('سُجّلت ' + (created.length > 1 ? dg(created.length) + ' دفعات' : 'الدفعة') + ' · ' + U().fmt(total) + ' ر.س', { kind: 'ok', undo: function () {
        created.forEach(function (c) { try { S().purge(c.type, c.id); } catch (e) { S().remove(c.type, c.id); } });
      } });
      if (opts.after) opts.after();
      return true;
    });
  }
  function payModal(x) {
    U().modal({ title: 'تسجيل دفعة — ' + esc(x.name), size: 'md',
      body: U().form([
        { name: 'amount', label: 'المبلغ (ر.س)', type: 'money', required: true, value: x.amount, min: 0.01, help: 'المتأخر الحالي ' + U().fmt(x.amount) },
        { name: 'date', label: 'التاريخ', type: 'date', required: true, value: iso(today()) },
        { name: 'doc', label: 'رقم المستند', type: 'text', value: '' }
      ]),
      actions: [{ label: 'إلغاء' }, { label: 'سجّل الدفعة', kind: 'primary', onClick: function (close, root) {
        if (!U().validate(root, { amount: function (v) { return Number(v) > 0; }, date: function (v) { return !!v; } })) return;
        var f = U().readForm(root), amt = Math.round(Number(f.amount) * 100) / 100, r;
        if (x.partyType === 'contractor') r = S().create('contractorEntries', { contractorId: x.partyId, date: f.date, kind: 'payment', claimNo: null, debit: amt, credit: 0, description: 'دفعة ' + (f.doc || ''), projectId: null, importId: null });
        else r = S().create('payments', { supplierId: x.partyId, date: f.date, amount: amt, doc: f.doc || 'دفعة يدوية', importId: null });
        var typ = x.partyType === 'contractor' ? 'contractorEntries' : 'payments', id = r && (r.id || r);
        close(true);
        U().toast('سُجّلت دفعة ' + U().fmt(amt) + ' ر.س لـ' + esc(x.name), { kind: 'ok', undo: function () { try { S().purge(typ, id); } catch (e) { S().remove(typ, id); } } });
      } }]
    });
  }

  /* ───────── تنبيهات جودة البيانات (لافتة واحدة مطوية) ───────── */
  function qualityWarnings(st) {
    var W = [], tt = safe(function () { return S().totals(); }, {});
    var cov = (st.coverage || []);
    var never = cov.filter(function (c) { return c.lastImportDays == null; }).length;
    var stale = cov.filter(function (c) { return c.lastImportDays != null && c.lastImportDays > 60; }).length;
    if (never) W.push({ sev: 'w', t: dg(never) + ' مورداً بلا كشوفات — مديونيتهم غير محسوبة', go: 'coverage' });
    if (stale) W.push({ sev: 'w', t: dg(stale) + ' كشوفاتهم أقدم من ٦٠ يوماً', go: 'coverage' });
    if (tt.withoutTerm) W.push({ sev: 'i', t: dg(tt.withoutTerm) + ' مقاولاً بلا مدة سداد — تأخرهم غير محسوب', go: 'contractors', params: { noTerm: 1 } });
    var failed = list('imports').filter(function (i) { return i.status === 'failed'; }).length;
    if (failed) W.push({ sev: 'd', t: dg(failed) + ' استيراد فشل', go: 'import' });
    if (st.newestInvoiceDays != null && st.newestInvoiceDays > 30) W.push({ sev: 'w', t: 'أحدث فاتورة مسجّلة قبل ' + dg(st.newestInvoiceDays) + ' يوماً', go: 'import' });
    if (!list('receivables').length) W.push({ sev: 'i', t: 'لم تُرفع بيانات التحصيلات — التوقع لا يشمل الوارد', go: 'collections' });
    var bb = safe(function () { return S().db.settings.bankBalance; }, null);
    if (bb == null) W.push({ sev: 'w', t: 'رصيد البنك غير مُدخل', go: 'settings' });
    return W;
  }

  /* ════════════════ عرض «اليوم» ════════════════ */
  function renderToday(root) {
    var first = firstVisit('today');
    var t0 = today(), hr = new Date().getHours();
    var tt = safe(function () { return S().totals(); }, {});
    var st = safe(function () { return S().staleness(); }, {});
    var tasks = buildTasks(), ds = doneState(), left = tasks.filter(function (x) { return !ds.done[x.id]; }).length;
    var sup = supplierRows(), con = contractorRows();
    var bank = safe(function () { return S().db.settings.bankBalance; }, 0) || 0;
    var proj = projection(30), neg = firstNeg(proj);
    var low = proj.reduce(function (m, p) { return Math.min(m, p.balance); }, proj.length ? proj[0].balance : bank);
    var lastImp = list('imports').filter(function (i) { return i.status === 'ok'; }).sort(function (a, b) { return a.at < b.at ? 1 : -1; })[0];
    var W = qualityWarnings(st);
    var greet = hr < 12 ? 'صباح الخير' : 'مساء الخير';
    var nid = st.newestInvoiceDays;
    var fresh = nid == null ? '<span class="fresh old">لا فواتير بعد</span>' : nid <= 3 ? '<span class="fresh ok">البيانات حتى ' + (nid === 0 ? 'اليوم' : dateTxt(addDays(t0, -nid))) + '</span>' :
      '<span class="fresh old" title="أحدث فاتورة مسجّلة">أحدث فاتورة قبل ' + dg(nid) + ' يوماً</span>';

    var overdueSup = sup.filter(function (r) { return r.p.overdue > 0; });
    var oldest = overdueSup.reduce(function (m, r) { return Math.max(m, r.p.oldestDays || 0); }, 0);
    var ovInv = overdueSup.reduce(function (m, r) { return m + (r.p.invoices || []).filter(function (i) { return i.lateDays > 0 && i.remaining > 0; }).length; }, 0);
    var lc = safe(function () { return S().db.lastChange; }, null);
    var lcRecent = lc && lc.at && (Date.now() - new Date(lc.at).getTime()) < 7 * DAY;
    var lcAge = lc && lc.at ? Math.abs(daysBetween(t0, new Date(lc.at))) : 99;
    if (lc && !lcRecent && lcAge <= 7) lcRecent = true; // TODAY ثابت في النموذج
    var ovDelta = lcRecent && lc.before && lc.after ? lc.after.supplierOverdue - lc.before.supplierOverdue : null;

    var aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
    sup.forEach(function (r) { var a = r.p.aging || {}; Object.keys(aging).forEach(function (k) { aging[k] = (Math.round(aging[k] * 100) + Math.round((a[k] || 0) * 100)) / 100; }); });
    var agMax = Math.max(1, aging.d0_30, aging.d31_60, aging.d61_90, aging.d90p);
    var projects = list('projects').slice().sort(function (a, b) { return (b.budgetDelayPct || 0) - (a.budgetDelayPct || 0); });
    var conOver = con.filter(function (r) { return r.p.overdue > 0; });

    var html = '<div class="sec-today">' +
      '<div class="ph"><div><h1>' + greet + '</h1><p class="td-sub">' +
      (left ? '<b>' + dg(left) + '</b> ' + plural(left, 'أمر يحتاجك', 'أمران يحتاجانك', 'أمور تحتاجك', 'أمراً يحتاجك') + ' اليوم' : 'لا شيء ينتظرك اليوم') +
      ' · ' + dateTxt(t0, { weekday: true }) +
      (lastImp ? ' · آخر استيراد ' + esc(U().ago(lastImp.at)) : '') + ' ' + fresh +
      (W.length ? ' <button class="quality td-q" aria-expanded="false" aria-controls="tdQ">⚠ ' + dg(W.length) + ' ' + plural(W.length, 'تنبيه بيانات', 'تنبيها بيانات', 'تنبيهات بيانات', 'تنبيه بيانات') + '</button>' : '') +
      ' <span class="sample">بيانات مثال</span></p>' +
      (W.length ? '<ul class="td-qlist" id="tdQ" hidden>' + W.map(function (w) { return '<li><span class="sev ' + w.sev + '"></span><span>' + w.t + '</span><button class="ih-lnk" data-go="' + w.go + '" data-params="' + gp(w.params) + '">افتح ←</button></li>'; }).join('') + '</ul>' : '') +
      '</div><div class="acts"><button class="btn" data-go="due">المستحقات القادمة</button><button class="btn primary" data-go="import">رفع كشف</button></div></div>' +
      '<div class="grid">' +
      /* المتأخر للموردين */
      '<section class="isl c6 crit click" style="--i:0" data-go="suppliers" data-params="' + gp({ filter: 'overdue' }) + '" tabindex="0" role="link" aria-label="المتأخر للموردين — افتح الموردين">' +
        '<div class="ih"><h2><span class="sev d"></span>المتأخر للموردين</h2><span class="cap">من ' + dg(sup.length) + ' موردين</span></div>' +
        '<div class="hero t-danger chg' + (ovDelta && first ? (ovDelta > 0 ? ' flash-bad' : ' flash-good') : '') + '">' + (first ? counted(tt.supplierOverdue || 0) : money(tt.supplierOverdue || 0)) + '</div>' +
        '<div class="meta">' + (ovDelta ? '<span class="delta ' + (ovDelta > 0 ? 'bad' : 'good') + '"><span class="ar">' + (ovDelta > 0 ? '▲' : '▼') + '</span> ' + U().fmt(Math.abs(ovDelta)) + ' منذ الاستيراد</span>' : '') +
        '<span>' + dg(ovInv) + ' ' + plural(ovInv, 'فاتورة', 'فاتورتان', 'فواتير', 'فاتورة') + ' · ' + dg(overdueSup.length) + ' موردين' + (oldest ? ' · أقدمها ' + dg(oldest) + ' يوماً' : '') + '</span>' +
        '<span>مستحق خلال ٧ أيام ' + money(tt.supplierDue7 || 0) + '</span><span>المديونية المفتوحة ' + money(tt.supplierOpen || 0) + '</span></div>' +
        U().spark(overdueHistory(), 'var(--danger-solid)') +
      '</section>' +
      /* النقد المتاح */
      '<section class="isl c6 click' + (neg ? ' crit' : '') + '" style="--i:1" data-go="cash" tabindex="0" role="link" aria-label="النقد المتاح — افتح التدفق النقدي">' +
        '<div class="ih"><h2>' + (neg ? '<span class="sev d"></span>' : '') + 'النقد المتاح</h2><span class="cap">رصيد البنوك المُدخل</span></div>' +
        '<div class="hero' + (bank < 0 ? ' t-danger' : '') + '">' + (first ? counted(bank) : money(bank)) + '</div>' +
        '<div class="meta"><span class="delta ' + (neg ? 'bad' : 'good') + '"><span class="ar">' + (neg ? '▼' : '▲') + '</span> ' + (neg ? 'يصبح سالباً ' + dateTxt(neg.date) : 'يكفي ٣٠ يوماً') + '</span>' +
        '<span>أدنى رصيد ' + money(low, low < 0 ? 't-danger' : '') + '</span>' + (neg ? '<span>العجز ' + money(Math.abs(neg.balance)) + '</span>' : '') + '</div>' +
        U().spark(proj.filter(function (_, i) { return i % 3 === 0; }).map(function (p) { return p.balance; }), 'var(--chart-1)') +
      '</section>' +
      /* مهام اليوم */
      '<section class="isl c4 td-tasks" style="--i:2"><div class="ih"><h2>مهام اليوم</h2><span class="cap"><span class="num">' + dg(tasks.length - left) + '/' + dg(tasks.length) + '</span></span></div>' +
        (tasks.length ? '<ul class="tasks">' + tasks.slice(0, 8).map(function (x) {
          var d = !!ds.done[x.id];
          return '<li class="' + (d ? 'done' : '') + '" data-task="' + esc(x.id) + '"><button class="chk" aria-label="تمّ" aria-pressed="' + d + '"><svg viewBox="0 0 12 12"><path d="M2 6.5l2.5 2.5L10 3.5"/></svg></button>' +
            '<span class="sev ' + x.sev + '"></span><span class="tt">' + x.title + '<small>' + x.sub + '</small></span>' +
            '<button class="btn sm td-act" data-act="' + esc(x.id) + '">' + esc(x.act) + '</button></li>';
        }).join('') + '</ul>' + (tasks.length > 8 ? '<button class="ih-lnk td-more" data-go="due">+ ' + dg(tasks.length - 8) + ' أخرى في المستحقات ←</button>' : '')
        : '<div class="empty-note">لا مهام — كل الالتزامات ضمن مواعيدها</div>') +
      '</section>' +
      /* الرصيد المتوقع */
      '<section class="isl c8' + (neg ? ' crit' : '') + '" style="--i:3"><div class="ih"><h2>' + (neg ? '<span class="sev d"></span>' : '') + 'الرصيد المتوقع — ٣٠ يوماً</h2><button class="ih-lnk" data-go="cash">التفاصيل ←</button></div>' +
        (proj.length ? '<div class="td-chart">' + safe(function () {
          return U().lineChart({ series: [{ name: 'الرصيد المتوقع', label: 'الرصيد المتوقع', values: proj.map(function (p) { return p.balance; }), points: proj.map(function (p) { return p.balance; }), dates: proj.map(function (p) { return p.date; }), color: 'var(--chart-1)' }],
            height: 220, negArea: true, xLabels: proj.map(function (p, i) { return i % 5 === 0 ? dateTxt(p.date) : ''; }) });
        }, '') + '</div><div class="legend"><span><i style="background:var(--chart-1)"></i>الرصيد المتوقع</span><span><i style="background:var(--danger-solid)"></i>منطقة العجز</span>' +
        (neg ? '<span class="t-danger">⚠ عجز من ' + dateTxt(neg.date) + '</span>' : '') + '</div>'
        : '<div class="empty-note">أدخل رصيد البنك لحساب التوقع</div>') +
      '</section>' +
      /* تأخر الموازنة بالمشروع */
      '<section class="isl c4" style="--i:4"><div class="ih"><h2>تأخر الموازنة بالمشروع</h2><button class="ih-lnk" data-go="budget">الموازنة ←</button></div>' +
        (projects.length ? '<div class="proj">' + projects.slice(0, 6).map(function (p, i) {
          var dl = Number(p.budgetDelayPct) || 0, col = dl > 5 ? 'var(--danger-solid)' : dl > 0 ? 'var(--warn-solid)' : 'var(--ok-solid)';
          return '<div class="prow click" data-go="project" data-params="' + gp({ id: p.id }) + '" tabindex="0" role="link"><span class="td-pn">' + esc(p.name) + '</span><span class="bar"><i style="--i:' + i + ';--w:' + Math.min(1, Math.max(.04, Math.abs(dl) / 18)) + ';background:' + col + '"></i></span>' +
            '<span class="num ' + (dl > 5 ? 't-danger' : dl <= 0 ? 't-ok' : 't-warn') + ' td-pct">' + (dl > 0 ? '+' : dl < 0 ? '−' : '') + dg(Math.abs(dl).toFixed(1)) + '٪</span></div>';
        }).join('') + '</div>' + (projects.filter(function (p) { return (p.budgetDelayPct || 0) <= 0; }).length ? '<p class="disclose">✓ ' + dg(projects.filter(function (p) { return (p.budgetDelayPct || 0) <= 0; }).length) + ' مشاريع ضمن الموازنة</p>' : '')
        : '<div class="empty-note">لا مشاريع بعد</div>') +
      '</section>' +
      /* ماذا تغيّر */
      '<section class="isl c8" style="--i:5"><div class="ih"><h2>ماذا تغيّر</h2><span class="cap">' + (lcRecent ? 'منذ استيراد ' + esc(lc.file || '') + ' · ' + esc(U().ago(lc.at)) : 'لا استيراد خلال ٧ أيام') + '</span></div>' +
        (lcRecent ? changesHtml(lc, first) : '<div class="empty-note">لم يحدث استيراد مؤخراً — <button class="ih-lnk" data-go="import">ارفع كشفاً</button> لترى الفرق هنا.</div>') +
      '</section>' +
      /* المقاولون */
      '<section class="isl c4 click" style="--i:6" data-go="contractors" tabindex="0" role="link"><div class="ih"><h2>المقاولون</h2><span class="cap">' + dg(con.length) + ' مقاولاً</span></div>' +
        '<div class="cap">المديونية المفتوحة للمقاولين</div><div class="kpi">' + (first ? counted(tt.contractorOwed || 0) : money(tt.contractorOwed || 0)) + '</div>' +
        '<div class="td-crow"><span class="cap">متأخر (لمن له مدة · ' + dg(tt.withTerm || 0) + ')</span><span class="' + ((tt.contractorOverdue || 0) > 0 ? 't-danger' : '') + '">' + money(tt.contractorOverdue || 0) + '</span></div>' +
        (conOver.length ? '<div class="cap">' + dg(conOver.length) + ' مقاولين متأخرين — غير مجموع مع رقم الموردين</div>' : '') +
        ((tt.withoutTerm || 0) ? '<p class="disclose"><button class="ih-lnk" data-go="contractors" data-params="' + gp({ noTerm: 1 }) + '">' + dg(tt.withoutTerm) + ' مقاولاً بلا مدة سداد</button> — تأخرهم غير محسوب «—»</p>' : '') +
      '</section>' +
      /* أعمار الديون */
      '<section class="isl c8" style="--i:7"><div class="ih"><h2>أعمار الديون</h2><span class="cap">الموردون · انقر شريحة للتصفية</span></div><div class="td-aging">' +
        [['d0_30', '٠–٣٠ يوماً', 'var(--chart-1)'], ['d31_60', '٣١–٦٠', 'var(--warn-solid)'], ['d61_90', '٦١–٩٠', 'var(--danger-solid)'], ['d90p', 'أكثر من ٩٠', 'var(--danger-solid)']].map(function (b, i) {
          return '<button class="td-ab" data-go="suppliers" data-params="' + gp({ aging: b[0] }) + '"><span class="td-al">' + b[1] + '</span><span class="bar"><i style="--i:' + i + ';--w:' + Math.max(.02, aging[b[0]] / agMax) + ';background:' + b[2] + '"></i></span><span class="num td-av">' + money(aging[b[0]]) + '</span></button>';
        }).join('') +
        '<div class="td-agtot cap">الإجمالي ' + money(sumC(Object.keys(aging), function (k) { return aging[k]; })) + '</div></div>' +
      '</section>' +
      '</div></div>';
    root.innerHTML = html;
    bindGo(root);
    var q = root.querySelector('.td-q');
    if (q) q.addEventListener('click', function (e) { e.stopPropagation(); var l = root.querySelector('#tdQ'); l.hidden = !l.hidden; q.setAttribute('aria-expanded', String(!l.hidden)); });
    root.querySelectorAll('.tasks li').forEach(function (li) {
      var id = li.getAttribute('data-task'), task = tasks.filter(function (x) { return x.id === id; })[0];
      li.querySelector('.chk').addEventListener('click', function () {
        var was = !!ds.done[id];
        if (was) delete ds.done[id]; else ds.done[id] = Date.now();
        saveDone(); E.shell.refresh();
        if (!was) U().toast('أُنجزت المهمة', { kind: 'ok', undo: function () { delete ds.done[id]; saveDone(); E.shell.refresh(); } });
      });
      li.querySelector('.td-act').addEventListener('click', function () {
        if (task.pay) payModal(task.pay); else go(task.view, task.params);
      });
      li.querySelector('.tt').addEventListener('click', function () { go(task.view, task.params); });
    });
    animate(root, first);
  }

  function changesHtml(lc, first) {
    var b = lc.before || {}, a = lc.after || {};
    var nInv = Array.isArray(lc.newInvoices) ? lc.newInvoices.length : (Number(lc.newInvoices) || 0);
    var nAmt = Array.isArray(lc.newInvoices) ? sumC(lc.newInvoices, function (x) { return x.amount; }) : null;
    var nPaid = Array.isArray(lc.paidInvoices) ? lc.paidInvoices.length : (Number(lc.paidInvoices) || 0);
    function card(label, key, badUp) {
      var d = (Math.round((a[key] || 0) * 100) - Math.round((b[key] || 0) * 100)) / 100;
      var bad = badUp ? d > 0 : d < 0, cls = d === 0 ? '' : bad ? 'flash-bad' : 'flash-good';
      return '<div class="chg-card"><div class="cap">' + label + '</div><div class="kpi chg ' + (first ? cls : '') + ' ' + (d > 0 && badUp ? 't-danger' : d < 0 && badUp ? 't-ok' : '') + '">' +
        (d === 0 ? '<span class="num">' + dg('0.00') + '</span>' : '<span class="td-ar">' + (d > 0 ? '▲' : '▼') + '</span>' + (d > 0 ? '+' : '−') + U().fmt(Math.abs(d))) + '</div>' +
        '<div class="cap">كان ' + U().fmt(b[key] || 0) + ' · صار ' + U().fmt(a[key] || 0) + '</div></div>';
    }
    return '<div class="changes">' + card('المتأخر للموردين', 'supplierOverdue', true) + card('المديونية المفتوحة', 'supplierOpen', true) + card('للمقاولين', 'contractorOwed', true) + '</div>' +
      '<div class="changes td-chg2"><div class="chg-card"><div class="cap">فواتير جديدة</div><div class="kpi chg ' + (first && nInv ? 'flash-bad' : '') + '"><span class="num">' + dg(nInv) + '</span></div>' + (nAmt != null ? '<div class="cap">' + money(nAmt) + '</div>' : '') + '</div>' +
      '<div class="chg-card"><div class="cap">سُدّدت</div><div class="kpi t-ok chg ' + (first && nPaid ? 'flash-good' : '') + '"><span class="num">' + dg(nPaid) + '</span></div><div class="cap">' + plural(nPaid, 'فاتورة أُغلقت', 'فاتورتان أُغلقتا', 'فواتير أُغلقت', 'فاتورة أُغلقت') + '</div></div>' +
      '<div class="chg-card"><div class="cap">النقد المتوقع بعد ٣٠ يوماً</div><div class="kpi">' + money((projection(30).slice(-1)[0] || {}).balance || 0) + '</div><div class="cap"><button class="ih-lnk" data-go="cash">التدفق ←</button></div></div></div>';
  }

  /* ════════════════ المستحقات القادمة ════════════════ */
  var RANGES = [['0', 'اليوم'], ['7', '٧ أيام'], ['30', '٣٠ يوماً'], ['all', 'الكل']];
  function dueRows() {
    var days = dueState.range === 'all' ? 36500 : Number(dueState.range);
    var raw = safe(function () { return S().dueList({ days: days }); }, []);
    return raw.map(function (r, i) {
      var pt = pType(r), pid = partyId(r), nm = partyName(r);
      if (pid == null) { var m = list(pt === 'contractor' ? 'contractors' : 'suppliers').filter(function (x) { return x.name === nm; })[0]; pid = m && m.id; }
      var ent = pid != null ? get(pt === 'contractor' ? 'contractors' : 'suppliers', pid) : null;
      var late = typeof r.late === 'number' ? r.late : (r.late ? Math.max(1, daysBetween(r.date, today())) : Math.max(0, daysBetween(r.date, today())));
      return { id: pt + ':' + pid + ':' + r.date + ':' + i, date: r.date, name: nm, partyType: pt, partyId: pid, amount: Number(r.amount) || 0, late: late,
        doc: r.doc || r.no || r.claimNo || '', projectIds: (ent && ent.projectIds) || [], project: (ent && ent.projectIds || []).map(function (p) { var x = get('projects', p); return x ? x.name : ''; }).join('، ') };
    }).filter(function (r) { return !dueState.project || r.projectIds.indexOf(dueState.project) >= 0; });
  }
  function renderDue(root) {
    var first = firstVisit('due');
    var rows = dueRows(), sel = dueState.selected;
    var keys = {}; rows.forEach(function (r) { keys[r.id] = 1; });
    Array.from(sel).forEach(function (k) { if (!keys[k]) sel.delete(k); });
    var tot = sumC(rows, function (r) { return r.amount; }), lateTot = sumC(rows.filter(function (r) { return r.late > 0; }), function (r) { return r.amount; });
    var bank = safe(function () { return S().db.settings.bankBalance; }, 0) || 0;
    var projects = list('projects');
    root.innerHTML = '<div class="sec-today"><div class="ph"><div><h1>المستحقات القادمة</h1><p>الموردون والمقاولون معاً · مرتبة بالأقدم استحقاقاً · حدّد ما ستدفعه لتكوين قائمة دفع <span class="sample">بيانات مثال</span></p></div>' +
      '<div class="acts"><div class="seg" role="group" aria-label="المدى">' + RANGES.map(function (r) { return '<button data-range="' + r[0] + '" aria-pressed="' + (dueState.range === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<select class="td-sel" aria-label="المشروع"><option value="">كل المشاريع</option>' + projects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (dueState.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid">' +
      '<section class="isl c4" style="--i:0"><div class="cap">إجمالي المستحق في المدى</div><div class="kpi">' + (first ? counted(tot) : money(tot)) + '</div><div class="meta"><span>' + dg(rows.length) + ' استحقاق</span></div></section>' +
      '<section class="isl c4' + (lateTot > 0 ? ' crit' : '') + '" style="--i:1"><div class="cap">منها متأخر</div><div class="kpi' + (lateTot > 0 ? ' t-danger' : '') + '">' + (first ? counted(lateTot) : money(lateTot)) + '</div></section>' +
      '<section class="isl c4 click" style="--i:2" data-go="cash" tabindex="0" role="link"><div class="cap">النقد المتاح مقابلها</div><div class="kpi' + (bank - tot < 0 ? ' t-warn' : '') + '">' + money(bank) + '</div><div class="meta"><span>بعد الدفع ' + money(bank - tot, bank - tot < 0 ? 't-warn' : '') + '</span></div></section>' +
      '<section class="isl c12" style="--i:3"><div class="td-tbl"></div></section></div><div class="td-paybar"></div></div>';
    bindGo(root);
    root.querySelectorAll('[data-range]').forEach(function (b) { b.addEventListener('click', function () { dueState.range = b.getAttribute('data-range'); E.shell.refresh(); }); });
    root.querySelector('.td-sel').addEventListener('change', function (e) { dueState.project = e.target.value; E.shell.refresh(); });
    rows.forEach(function (r) { r.status = r.late > 0 ? 'late' : 'soon'; });
    var tbl = U().table({ id: 'today-due', rows: rows, rowKey: 'id', selectable: true, selected: sel, search: true, searchKeys: ['name', 'project', 'doc'], columnMenu: true,
      onSelect: function (s) { if (s && s !== sel) { sel.clear(); s.forEach(function (k) { sel.add(k); }); } paybar(); },
      onRowClick: function (r) { go(r.partyType === 'contractor' ? 'contractor' : 'supplier', { id: r.partyId }); },
      filters: [{ key: 'partyType', label: 'النوع', options: [{ value: 'supplier', label: 'موردون' }, { value: 'contractor', label: 'مقاولون' }] },
                { key: 'status', label: 'الحالة', options: [{ value: 'late', label: 'متأخر' }, { value: 'soon', label: 'مستحق قريباً' }] }],
      columns: [
        { key: 'date', label: 'الاستحقاق', sort: true, render: function (r) { return dateTxt(r.date); } },
        { key: 'name', label: 'الطرف', sort: true, render: function (r) { return '<b>' + esc(r.name) + '</b>' + (r.project ? '<div class="cap">' + esc(r.project) + '</div>' : ''); } },
        { key: 'partyType', label: 'النوع', render: function (r) { return '<span class="pill n">' + (r.partyType === 'contractor' ? 'مقاول' : 'مورد') + '</span>'; } },
        { key: 'doc', label: 'المستند', render: function (r) { return r.doc ? '<span class="num">' + esc(dg(r.doc)) + '</span>' : '<span class="dash">—</span>'; } },
        { key: 'late', label: 'الحالة', sort: true, render: function (r) { return r.late > 0 ? '<span class="pill d">متأخر <span class="num">' + dg(r.late) + '</span> يوماً</span>' : r.late === 0 && daysBetween(today(), r.date) === 0 ? '<span class="pill w">اليوم</span>' : '<span class="pill w">بعد ' + dg(daysBetween(today(), r.date)) + ' يوماً</span>'; } },
        { key: 'amount', label: 'المبلغ', num: true, sort: true, render: function (r) { return money(r.amount, r.late > 0 ? 't-danger' : ''); } },
        { key: '_act', label: '', render: function (r) { return '<button class="btn sm td-paid" data-id="' + esc(r.id) + '">دُفع</button>'; } }
      ],
      total: { label: 'الإجمالي', keys: ['amount'] },
      empty: { title: 'لا مستحقات في هذا المدى', body: 'لا إجراء مطلوب الآن — جرّب مدى أوسع.', cta: 'الكل', onCta: function () { dueState.range = 'all'; E.shell.refresh(); } }
    });
    root.querySelector('.td-tbl').appendChild(tbl);
    tbl.addEventListener('click', function (e) {
      var b = e.target.closest('.td-paid'); if (!b) return;
      e.stopPropagation();
      var r = rows.filter(function (x) { return x.id === b.getAttribute('data-id'); })[0];
      if (r) recordPayment([{ partyType: r.partyType, partyId: r.partyId, name: r.name, amount: r.amount, doc: r.doc }]);
    }, true);
    function paybar() {
      var host = root.querySelector('.td-paybar'), picked = rows.filter(function (r) { return sel.has(r.id); });
      if (!picked.length) { host.innerHTML = ''; return; }
      var s = sumC(picked, function (r) { return r.amount; });
      host.innerHTML = '<div class="paybar" role="region" aria-label="قائمة الدفع"><span>' + dg(picked.length) + ' محدّد</span><span class="big num">' + U().fmt(s) + ' <span class="cur">ر.س</span></span>' +
        '<span class="td-pbn">' + (bank - s < 0 ? 'يتجاوز النقد المتاح بـ' + U().fmt(s - bank) : 'يتبقى ' + U().fmt(bank - s)) + '</span>' +
        '<button class="btn sm td-clear">إلغاء التحديد</button><button class="btn sm td-mark">تسجيل كمدفوع</button><button class="btn primary td-list">قائمة دفع</button></div>';
      host.querySelector('.td-clear').onclick = function () { sel.clear(); E.shell.refresh(); };
      host.querySelector('.td-list').onclick = function () {
        var csv = S().toCSV(picked.map(function (r) { return { date: r.date, party: r.name, type: r.partyType === 'contractor' ? 'مقاول' : 'مورد', doc: r.doc, late: r.late, amount: r.amount.toFixed(2) }; }),
          [{ key: 'date', label: 'الاستحقاق' }, { key: 'party', label: 'الطرف' }, { key: 'type', label: 'النوع' }, { key: 'doc', label: 'المستند' }, { key: 'late', label: 'أيام التأخر' }, { key: 'amount', label: 'المبلغ' }]);
        csv += '\nالإجمالي,,,,,' + s.toFixed(2);
        U().exportDialog({ title: 'قائمة دفع — ' + dg(picked.length) + ' استحقاق · ' + U().fmt(s) + ' ر.س', csv: csv, fileName: 'payment-list-' + iso(today()) + '.csv' });
      };
      host.querySelector('.td-mark').onclick = function () {
        // تجميع حسب الطرف حتى تكون الدفعة واحدة لكل طرف
        var by = {};
        picked.forEach(function (r) { var k = r.partyType + ':' + r.partyId; (by[k] = by[k] || { partyType: r.partyType, partyId: r.partyId, name: r.name, amount: 0 }).amount = (Math.round(by[k].amount * 100) + Math.round(r.amount * 100)) / 100; });
        recordPayment(Object.keys(by).map(function (k) { return by[k]; }), { after: function () { sel.clear(); } });
      };
    }
    paybar();
    animate(root, first);
  }

  /* ════════════════ التقويم ════════════════ */
  var KINDS = {
    invoice: ['فاتورة مورد', 'w'], claim: ['مستخلص', 'w'], receivable: ['تحصيل', 'o'], guarantee: ['انتهاء ضمان', 'i'], import: ['استيراد', 'n']
  };
  function evKind(e) { var k = e.kind || e.type || ''; if (/inv/.test(k)) return 'invoice'; if (/claim|contr/.test(k)) return 'claim'; if (/rec|coll/.test(k)) return 'receivable'; if (/guar/.test(k)) return 'guarantee'; if (/imp/.test(k)) return 'import'; return k || 'invoice'; }
  function evLabel(e) { return e.title || e.label || partyName(e) || e.name || (KINDS[evKind(e)] || [''])[0]; }
  function evSev(e) { if (e.late > 0 || e.late === true || e.overdue || e.sev === 'd') return 'd'; var k = KINDS[evKind(e)]; return e.sev || (k ? k[1] : 'n'); }
  function evLink(e) {
    if (e.link && e.link.view) return e.link;
    var k = evKind(e), id = e.partyId || (e.party && e.party.id);
    if (k === 'invoice') return { view: 'supplier', params: { id: id || e.supplierId } };
    if (k === 'claim') return { view: 'contractor', params: { id: id || e.contractorId } };
    if (k === 'receivable') return { view: 'collections', params: { id: e.id } };
    if (k === 'guarantee') return { view: 'guarantees', params: { id: e.id } };
    if (k === 'import') return { view: 'import', params: { id: e.id } };
    return null;
  }
  function evProjectOk(e) {
    var pf = calState.project; if (!pf) return true;
    if (e.projectId) return e.projectId === pf;
    var k = evKind(e), id = e.partyId || (e.party && e.party.id) || e.supplierId || e.contractorId;
    var ent = id && get(k === 'claim' ? 'contractors' : 'suppliers', id);
    return !!(ent && (ent.projectIds || []).indexOf(pf) >= 0);
  }
  function monthEvents(y, m) {
    var o = safe(function () { return S().calendar(y, m); }, {}) || {}, r = {};
    Object.keys(o).forEach(function (k) { var a = (o[k] || []).filter(evProjectOk); if (a.length) r[k] = a; });
    return r;
  }
  var MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  var WD = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  function weekStartOf(d) { return addDays(d, -d.getDay()); }
  function renderCalendar(root) {
    var first = firstVisit('calendar');
    var t0 = today();
    if (!calState) calState = { y: t0.getFullYear(), m: t0.getMonth(), mode: 'month', weekStart: weekStartOf(t0), project: '' };
    var cs = calState, cells = [], ev = {};
    function merge(y, m) { var o = monthEvents(y, m); Object.keys(o).forEach(function (k) { ev[k] = o[k]; }); }
    if (cs.mode === 'month') {
      var f = new Date(cs.y, cs.m, 1), start = weekStartOf(f);
      merge(cs.y, cs.m);
      for (var i = 0; i < 42; i++) cells.push(addDays(start, i));
      if (cells[35].getMonth() !== cs.m) cells = cells.slice(0, 35);
    } else {
      for (var j = 0; j < 7; j++) cells.push(addDays(cs.weekStart, j));
      merge(cells[0].getFullYear(), cells[0].getMonth());
      if (cells[6].getMonth() !== cells[0].getMonth()) merge(cells[6].getFullYear(), cells[6].getMonth());
    }
    var inRange = cells.filter(function (c) { return cs.mode === 'week' || c.getMonth() === cs.m; });
    var amtOf = function (e) { return evKind(e) === 'import' ? 0 : (Number(e.amount) || 0); };
    var outTot = 0, inTot = 0, cnt = 0;
    inRange.forEach(function (c) { (ev[iso(c)] || []).forEach(function (e) { cnt++; if (evKind(e) === 'receivable') inTot += Math.round(amtOf(e) * 100); else outTot += Math.round(amtOf(e) * 100); }); });
    var titleTxt = cs.mode === 'month' ? MONTHS[cs.m] + ' ' + dg(cs.y) : dateTxt(cells[0]) + ' – ' + dateTxt(cells[6]);
    var projects = list('projects');

    var agenda = inRange.filter(function (c) { return (ev[iso(c)] || []).length; });
    root.innerHTML = '<div class="sec-today"><div class="ph"><div><h1>التقويم المالي</h1><p>' + esc(titleTxt) + ' · إجمالي الاستحقاقات ' + money(outTot / 100) + (inTot ? ' · تحصيلات ' + money(inTot / 100) : '') + ' · ' + dg(cnt) + ' حدث · انقر أي يوم لعرض تفاصيله</p></div>' +
      '<div class="acts"><button class="btn" data-nav="-1" aria-label="السابق">→ ' + (cs.mode === 'month' ? 'الشهر السابق' : 'الأسبوع السابق') + '</button><button class="btn" data-nav="0">اليوم</button><button class="btn" data-nav="1" aria-label="التالي">' + (cs.mode === 'month' ? 'الشهر التالي' : 'الأسبوع التالي') + ' ←</button>' +
      '<div class="seg" role="group" aria-label="العرض"><button data-mode="month" aria-pressed="' + (cs.mode === 'month') + '">شهر</button><button data-mode="week" aria-pressed="' + (cs.mode === 'week') + '">أسبوع</button></div>' +
      '<select class="td-sel" aria-label="المشروع"><option value="">كل المشاريع</option>' + projects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (cs.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="grid"><section class="isl c12" style="--i:0">' +
      '<div class="cal td-cal' + (cs.mode === 'week' ? ' td-week' : '') + '" role="grid" aria-label="' + esc(titleTxt) + '">' + WD.map(function (w) { return '<div class="dh2">' + w + '</div>'; }).join('') +
      cells.map(function (c) {
        var k = iso(c), es = ev[k] || [], late = es.some(function (e) { return evSev(e) === 'd'; });
        var amt = sumC(es, amtOf), show = cs.mode === 'week' ? es : es.slice(0, 3);
        return '<button class="day td-day' + (cs.mode === 'month' && c.getMonth() !== cs.m ? ' out' : '') + (k === iso(t0) ? ' today' : '') + (late ? ' td-late' : '') + '" data-day="' + k + '" aria-label="' + esc(dateTxt(c, { weekday: true })) + ' · ' + dg(es.length) + ' حدث">' +
          '<span class="dn num">' + dg(c.getDate()) + (k === iso(t0) ? ' <span class="cap">اليوم</span>' : '') + '</span>' +
          show.map(function (e) { return '<span class="ev ' + evSev(e) + '">' + esc(evLabel(e)) + (cs.mode === 'week' && amtOf(e) ? ' · ' + U().fmt(amtOf(e)) : '') + '</span>'; }).join('') +
          (es.length > show.length ? '<span class="cap">+' + dg(es.length - show.length) + ' أخرى</span>' : '') +
          (amt ? '<span class="num td-damt' + (late ? ' t-danger' : '') + '">' + U().fmt(amt) + '</span>' : '') + '</button>';
      }).join('') + '</div>' +
      '<ul class="td-agenda">' + (agenda.length ? agenda.map(function (c) {
        var k = iso(c), es = ev[k];
        return '<li><button class="td-agday" data-day="' + k + '"><b>' + esc(dateTxt(c, { weekday: true })) + '</b>' + (k === iso(t0) ? ' <span class="pill w">اليوم</span>' : '') + '</button><ul>' +
          es.map(function (e) { return '<li><span class="sev ' + evSev(e) + '"></span><span>' + esc(evLabel(e)) + '<small class="cap"> · ' + ((KINDS[evKind(e)] || [''])[0]) + '</small></span>' + (amtOf(e) ? money(amtOf(e)) : '') + '</li>'; }).join('') + '</ul></li>';
      }).join('') : '<li class="empty-note">لا استحقاقات في هذه الفترة</li>') + '</ul>' +
      '<div class="legend">' + Object.keys(KINDS).map(function (k) { return '<span><span class="ev ' + KINDS[k][1] + ' td-lg">' + KINDS[k][0] + '</span></span>'; }).join('') + '<span><span class="ev d td-lg">متأخر</span></span></div>' +
      '</section></div></div>';
    root.querySelectorAll('[data-nav]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = Number(b.getAttribute('data-nav'));
        if (n === 0) { cs.y = t0.getFullYear(); cs.m = t0.getMonth(); cs.weekStart = weekStartOf(t0); }
        else if (cs.mode === 'month') { var d = new Date(cs.y, cs.m + n, 1); cs.y = d.getFullYear(); cs.m = d.getMonth(); }
        else { cs.weekStart = addDays(cs.weekStart, 7 * n); cs.y = cs.weekStart.getFullYear(); cs.m = cs.weekStart.getMonth(); }
        E.shell.refresh();
      });
    });
    root.querySelectorAll('[data-mode]').forEach(function (b) {
      b.addEventListener('click', function () {
        cs.mode = b.getAttribute('data-mode');
        if (cs.mode === 'week') { var ref = (cs.y === t0.getFullYear() && cs.m === t0.getMonth()) ? t0 : new Date(cs.y, cs.m, 1); cs.weekStart = weekStartOf(ref); }
        E.shell.refresh();
      });
    });
    root.querySelector('.td-sel').addEventListener('change', function (e) { cs.project = e.target.value; E.shell.refresh(); });
    root.querySelectorAll('[data-day]').forEach(function (b) { b.addEventListener('click', function () { openDay(b.getAttribute('data-day'), ev[b.getAttribute('data-day')] || []); }); });
    animate(root, first);
  }
  function openDay(k, es) {
    var body = es.length ? '<div class="sec-today"><ul class="td-dlist">' + es.map(function (e, i) {
      var l = evLink(e), late = evSev(e) === 'd', k2 = evKind(e);
      return '<li><span class="sev ' + evSev(e) + '"></span><div class="td-dl"><b>' + esc(evLabel(e)) + '</b><div class="cap">' + (KINDS[k2] || [''])[0] +
        (e.doc || e.no || e.claimNo ? ' · رقم <span class="num">' + esc(dg(e.doc || e.no || e.claimNo)) + '</span>' : '') +
        (late ? ' · <span class="pill d">متأخر' + (typeof e.late === 'number' ? ' ' + dg(e.late) + ' يوماً' : '') + '</span>' : '') + '</div></div>' +
        (k2 !== 'import' && e.amount ? money(e.amount, late ? 't-danger' : '') : '') +
        (l ? '<button class="btn sm" data-ev="' + i + '">فتح ←</button>' : '') + '</li>';
    }).join('') + '</ul><p class="disclose">الإجمالي ' + money(sumC(es.filter(function (e) { return evKind(e) !== 'import' && evKind(e) !== 'receivable'; }), function (e) { return e.amount; })) + ' مستحق</p></div>'
      : '<div class="sec-today"><p class="empty-note">لا استحقاقات في هذا اليوم.</p></div>';
    var m = U().modal({ title: 'تفاصيل يوم ' + dateTxt(k, { weekday: true, year: true }), size: 'md', body: body, actions: [{ label: 'إغلاق' }],
      onOpen: function (r) {
        r.querySelectorAll('[data-ev]').forEach(function (b) {
          b.addEventListener('click', function () { var l = evLink(es[Number(b.getAttribute('data-ev'))]); if (m && m.close) m.close(true); else closeAny(r); go(l.view, l.params); });
        });
      } });
    function closeAny(r) { var x = r.closest('[role="dialog"]'); if (x) x.remove(); }
  }

  /* ───────── التسجيل ───────── */
  function boot() {
    if (!E.shell || !E.shell.register) return false;
    E.shell.register('today', { section: 'today', tab: 'اليوم', title: 'اليوم', render: function (c) { renderToday(c); },
      badge: function () { var ds = doneState(); return safe(function () { return buildTasks().filter(function (x) { return !ds.done[x.id]; }).length; }, 0); } });
    E.shell.register('due', { section: 'today', tab: 'المستحقات القادمة', title: 'المستحقات القادمة', render: function (c, p) {
      if (p && p.range) dueState.range = String(p.range);
      renderDue(c);
    }, badge: function () { return safe(function () { return S().dueList({ days: 0 }).length; }, 0); } });
    E.shell.register('calendar', { section: 'today', tab: 'التقويم', title: 'التقويم المالي', render: function (c, p) {
      if (p && p.date) { var d = parse(p.date); calState = calState || {}; calState.y = d.getFullYear(); calState.m = d.getMonth(); calState.mode = calState.mode || 'month'; calState.weekStart = weekStartOf(d); calState.project = calState.project || ''; }
      renderCalendar(c);
    } });
    return true;
  }
  if (!boot()) document.addEventListener('DOMContentLoaded', boot);
})();
