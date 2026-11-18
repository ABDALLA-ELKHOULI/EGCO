/* ═══ قسم «النقد» — التدفق النقدي + التحصيلات ═══
   يملكه وكيل «النقد». يعتمد على EGCO.store / EGCO.ui / EGCO.shell حسب CONTRACT.md.
   محرّك الإسقاط محلي (لا يكفي cashProjection(days) لأنه لا يقبل فلتر الأطراف/المشروع ولا السيناريو)،
   لكنه يبني على supplierPosition / contractorPosition / receivables من المتجر — نفس مصدر الحقيقة. */
(function () {
  'use strict';
  var E = window.EGCO = window.EGCO || {};
  var S = function () { return E.store; };
  var U = function () { return E.ui; };
  var DAY = 864e5;
  var PREF_KEY = 'egco-cash-prefs';
  var SCN_KEY = 'egco-cash-scenario';

  /* ─── أدوات عامة ─── */
  function esc(s) { return U() && U().esc ? U().esc(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dg(x) { return U() && U().digits ? U().digits(String(x)) : String(x); }
  function fmt(n) { return U() && U().fmt ? U().fmt(n) : (Math.round(n * 100) / 100).toFixed(2); }
  function money(n, cls) { return U() && U().money ? U().money(n, cls) : '<span class="num ' + (cls || '') + '">' + fmt(n) + '</span>'; }
  function dtxt(d, o) { return U() && U().dateTxt ? U().dateTxt(d, o) : String(d); }
  function c2(n) { return Math.round((+n || 0) * 100); }           /* هللات */
  function h2(n) { return n / 100; }
  function today() { var s = S(); return s && s.TODAY ? new Date(s.TODAY) : new Date(2026, 10, 17); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parse(isoStr) { if (!isoStr) return null; var p = String(isoStr).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function off(isoStr) { var d = parse(isoStr); return d ? Math.round((d - today()) / DAY) : null; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function dOf(i) { return addDays(today(), i); }
  function list(t) { try { return (S().list(t) || []).filter(function (x) { return !x.deletedAt; }); } catch (e) { return []; } }
  function get(t, id) { try { return S().get(t, id); } catch (e) { return null; } }
  function projName(id) { var p = id && get('projects', id); return p ? p.name : '—'; }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ذاكرة فقط */ } }
  function toast(t, o) { if (U() && U().toast) U().toast(t, o || {}); }
  function settings() { var s = S(); return (s && s.db && s.db.settings) || {}; }
  function hasBalance() { var b = settings().bankBalance; return b !== null && b !== undefined && b !== '' && !isNaN(+b); }
  function animate(root, first) { if (U() && U().animateNumbers) try { U().animateNumbers(root, first); } catch (e) { } }
  function counted(n, cls) { return U() && U().counted ? U().counted(n, cls) : money(n, cls); }
  /* المستمعات على الحاوية تُلغى عند كل رسم — shell قد يعيد استخدام نفس الحاوية */
  function fresh(el) { if (el._cashAC) el._cashAC.abort(); el._cashAC = typeof AbortController !== 'undefined' ? new AbortController() : null; }
  function L(el, type, fn, o) { var opt = Object.assign({}, o || {}); if (el._cashAC) opt.signal = el._cashAC.signal; el.addEventListener(type, fn, opt); }
  function signWord(n) { return n < 0 ? ' <span class="sec-cash-sw t-danger">عجز</span>' : ''; }

  /* لا توجد دالة إعدادات في العقد — نجرّب الأسماء المحتملة ثم نكتب مباشرة ونطلق change */
  function setSettings(patch) {
    var s = S();
    if (s.setSettings) return s.setSettings(patch);
    if (s.updateSettings) return s.updateSettings(patch);
    if (s.saveSettings) return s.saveSettings(patch);
    s.db.settings = Object.assign({}, s.db.settings || {}, patch);
    if (s.save) s.save(); else if (s.persist) s.persist();
    if (s.emit) s.emit('change', { type: 'settings' });
    else if (s.trigger) s.trigger('change');
    else if (E.shell && E.shell.refresh) E.shell.refresh();
    if (s.checkAlerts) try { s.checkAlerts(); } catch (e) { }
  }

  /* ─── حالة العرض (تبقى عبر refresh) ─── */
  var prefs = Object.assign({ range: 30, parties: 'both', project: '', bucket: 7, kpiView: 0, assumeTerm: false }, lsGet(PREF_KEY, {}));
  function savePrefs() { lsSet(PREF_KEY, { range: prefs.range, parties: prefs.parties, project: prefs.project, bucket: prefs.bucket, kpiView: prefs.kpiView, assumeTerm: prefs.assumeTerm }); }
  var saved = lsGet(SCN_KEY, null);
  var V = {
    scenario: saved ? saved.tweaks || [] : [],   /* [{id,kind:'delay',key,days,label}|{id,kind:'inflow',date,amount,label}] */
    scenarioSaved: !!saved,
    scenarioOpen: false,
    pinned: null,        /* يوم مثبّت بالنقر على المخطط */
    expanded: {},        /* صفوف الفترات المفتوحة */
    first: true,
    setup: 1,
    collFilter: null
  };
  function scnDirty() { return V.scenario.length > 0 && !V.scenarioSaved; }

  /* ═══ محرك الأحداث ═══ */
  function events(opt) {
    opt = opt || prefs;
    var s = S(), t0 = iso(today()), out = [], inn = [], undated = [], undatedIn = [], lateIn = [];
    var proj = opt.project || '';
    if (opt.parties !== 'contractors' && s.supplierPosition) {
      list('suppliers').forEach(function (sup) {
        var pos; try { pos = s.supplierPosition(sup.id); } catch (e) { return; }
        (pos && pos.invoices || []).forEach(function (inv) {
          if (!(inv.remaining > 0.004)) return;
          if (proj && inv.projectId !== proj) return;
          out.push({ key: 'inv:' + inv.id, dir: 'out', partyType: 'supplier', partyId: sup.id, party: sup.name, doc: inv.no ? 'فاتورة ' + inv.no : 'فاتورة', date: inv.dueDate, origDate: inv.dueDate, amount: inv.remaining, projectId: inv.projectId, late: inv.dueDate < t0 });
        });
      });
    }
    if (opt.parties !== 'suppliers' && s.contractorPosition) {
      list('contractors').forEach(function (c) {
        var pos; try { pos = s.contractorPosition(c.id); } catch (e) { return; }
        if (!pos) return;
        var sum = 0;
        (pos.claims || []).forEach(function (cl) {
          if (!(cl.remaining > 0.004)) return;
          if (proj && cl.projectId && cl.projectId !== proj) return;
          sum += c2(cl.remaining);
          var due = cl.dueDate || null, assumed = false;
          if (!due && opt.assumeTerm && cl.date) { due = iso(addDays(parse(cl.date), 30)); assumed = true; }
          var ev = { key: 'cl:' + (cl.id || c.id + ':' + cl.claimNo), dir: 'out', partyType: 'contractor', partyId: c.id, party: c.name, doc: cl.claimNo ? 'مستخلص ' + cl.claimNo : 'مستخلص', date: due, origDate: due, amount: cl.remaining, projectId: cl.projectId, assumed: assumed };
          if (!due) undated.push(ev); else { ev.late = due < t0; out.push(ev); }
        });
        var resid = c2(pos.owed) - sum;
        if (!proj && resid > 100) {
          var ev2 = { key: 'cr:' + c.id, dir: 'out', partyType: 'contractor', partyId: c.id, party: c.name, doc: 'رصيد بلا مستخلص مؤرخ', date: null, amount: h2(resid), projectId: null };
          if (opt.assumeTerm) { ev2.date = ev2.origDate = iso(dOf(30)); ev2.assumed = true; out.push(ev2); } else undated.push(ev2);
        }
      });
    }
    list('receivables').forEach(function (r) {
      if (r.status === 'collected') return;
      if (proj && r.projectId !== proj) return;
      var ev = { key: 'rcv:' + r.id, dir: 'in', partyType: 'receivable', partyId: r.id, party: r.from || '—', doc: r.docNo || '', date: r.dueDate, origDate: r.dueDate, amount: +r.amount || 0, projectId: r.projectId, status: r.status };
      if (!r.dueDate) undatedIn.push(ev);
      else if (r.dueDate < t0) { ev.late = true; lateIn.push(ev); }
      else inn.push(ev);
    });
    return { out: out, inn: inn, undated: undated, undatedIn: undatedIn, lateIn: lateIn };
  }

  /* يطبّق السيناريو ويبني السلسلة اليومية */
  function project(days, ev, tweaks, extra) {
    extra = extra || {};
    var start = c2(settings().bankBalance), n = days + 1;
    var series = []; for (var i = 0; i < n; i++) series.push({ i: i, date: iso(dOf(i)), inC: 0, outC: 0, items: [] });
    var beyondOut = 0, beyondIn = 0;
    var delays = {}; (tweaks || []).forEach(function (t) { if (t.kind === 'delay') delays[t.key] = (delays[t.key] || 0) + (+t.days || 0); });
    function place(e, dir) {
      var o = off(e.date);
      if (o == null) return;
      if (o < 0) o = 0;   /* المتأخر الخارج يُفترض سداده اليوم */
      if (delays[e.key]) { o += delays[e.key]; e = Object.assign({}, e, { shifted: delays[e.key], date: iso(dOf(o)) }); }
      if (o > days) { if (dir === 'out') beyondOut += c2(e.amount); else beyondIn += c2(e.amount); return; }
      var b = series[o]; if (dir === 'out') b.outC += c2(e.amount); else b.inC += c2(e.amount);
      b.items.push(e);
    }
    ev.out.forEach(function (e) { if (!extra.skipLateOut || !e.late) place(e, 'out'); });
    ev.inn.forEach(function (e) { place(e, 'in'); });
    if (extra.lateInToday) ev.lateIn.forEach(function (e) { place(Object.assign({}, e, { date: iso(today()) }), 'in'); });
    (tweaks || []).forEach(function (t) {
      if (t.kind === 'inflow') place({ key: 'scn:' + t.id, dir: 'in', partyType: 'scenario', party: t.label || 'تحصيل افتراضي', doc: 'سيناريو', date: t.date, amount: +t.amount, scenario: true }, 'in');
    });
    var bal = start, min = Infinity, minIdx = 0, firstNeg = -1, totIn = 0, totOut = 0;
    series.forEach(function (b) {
      bal += b.inC - b.outC; totIn += b.inC; totOut += b.outC;
      b.balC = bal; b.balance = h2(bal); b.in = h2(b.inC); b.out = h2(b.outC);
      if (bal < min) { min = bal; minIdx = b.i; }
      if (bal < 0 && firstNeg < 0) firstNeg = b.i;
    });
    return { series: series, start: h2(start), end: h2(bal), min: h2(min), minIdx: minIdx, firstNeg: firstNeg, totIn: h2(totIn), totOut: h2(totOut), beyondOut: h2(beyondOut), beyondIn: h2(beyondIn) };
  }

  function buckets(P, size) {
    var out = [];
    for (var s = 0; s < P.series.length; s += size) {
      var e = Math.min(s + size - 1, P.series.length - 1), b = { idx: out.length, from: s, to: e, inC: 0, outC: 0, ins: [], outs: [], endBal: P.series[e].balance };
      for (var i = s; i <= e; i++) {
        var d = P.series[i]; b.inC += d.inC; b.outC += d.outC;
        d.items.forEach(function (it) { (it.dir === 'in' ? b.ins : b.outs).push(it); });
      }
      b.in = h2(b.inC); b.out = h2(b.outC); out.push(b);
    }
    return out;
  }
  function sumOf(rows) { return h2(rows.reduce(function (a, r) { return a + c2(r.amount); }, 0)); }
  function rangeLabel(d) { return d === 365 ? '١٢ شهراً' : dg(d) + ' يوماً'; }

  /* ═══ نافذة «من أين جاء هذا الرقم؟» ═══ */
  function typeLabel(r) { return r.partyType === 'supplier' ? 'مورد' : r.partyType === 'contractor' ? 'مقاول' : r.partyType === 'scenario' ? 'سيناريو' : 'تحصيل'; }
  function breakdown(title, rule, rows, opts) {
    opts = opts || {};
    rows = rows.slice().sort(function (a, b) { return String(a.date || '9999').localeCompare(String(b.date || '9999')); });
    var total = opts.total != null ? opts.total : sumOf(rows);
    var body = '<div class="sec-cash"><p class="sec-cash-rule">' + rule + '</p>' +
      (rows.length ? '<div class="tbl-wrap sec-cash-bdwrap"><table class="sec-cash-bd"><thead><tr><th>التاريخ</th><th>الجهة</th><th>النوع</th><th>المستند</th><th>المشروع</th><th class="n">المبلغ</th></tr></thead><tbody>' +
        rows.map(function (r, i) {
          var late = r.late ? ' <span class="pill d">متأخر</span>' : r.assumed ? ' <span class="pill n">تاريخ مفترض</span>' : r.shifted ? ' <span class="pill w">مؤجَّل ' + dg(r.shifted) + ' يوماً</span>' : '';
          return '<tr class="go" data-bd="' + i + '"><td>' + (r.date ? esc(dtxt(r.date)) : '<span class="dash">بلا تاريخ</span>') + late + '</td><td><b>' + esc(r.party) + '</b></td><td>' + typeLabel(r) + '</td><td>' + esc(r.doc || '—') + '</td><td>' + esc(projName(r.projectId)) + '</td><td class="n">' + money(r.amount, r.dir === 'in' ? 't-ok' : '') + '</td></tr>';
        }).join('') + '</tbody><tfoot><tr><td colspan="5">المجموع (' + dg(rows.length) + ' بنداً) — يساوي الرقم المعروض</td><td class="n">' + money(total) + '</td></tr></tfoot></table></div>'
        : '<div class="sec-cash-empty">لا صفوف تكوّن هذا الرقم — قيمته صفر فعلاً لا لغياب البيانات.</div>') + '</div>';
    if (!U() || !U().modal) return;
    var m = U().modal({
      title: 'من أين جاء هذا الرقم؟ — ' + title, body: body, size: 'lg',
      actions: [
        rows.length && U().exportDialog ? { label: 'تصدير CSV', onClick: function () { exportRows(title, rows); } } : null,
        { label: 'إغلاق', kind: 'primary', onClick: function (close) { close(true); } }
      ].filter(Boolean),
      onOpen: function (root) {
        root.addEventListener('click', function (e) {
          var tr = e.target.closest('tr[data-bd]'); if (!tr) return;
          var r = rows[+tr.dataset.bd]; if (!r || !E.shell) return;
          m && m.close && m.close(true);
          if (r.partyType === 'supplier') E.shell.go('supplier', { id: r.partyId });
          else if (r.partyType === 'contractor') E.shell.go('contractor', { id: r.partyId });
          else if (r.partyType === 'receivable') E.shell.go('collections', { id: r.partyId });
        });
      }
    });
  }
  function exportRows(title, rows) {
    var cols = [{ key: 'date', label: 'التاريخ' }, { key: 'party', label: 'الجهة' }, { key: 'type', label: 'النوع' }, { key: 'doc', label: 'المستند' }, { key: 'project', label: 'المشروع' }, { key: 'amount', label: 'المبلغ' }];
    var data = rows.map(function (r) { return { date: r.date || '', party: r.party, type: typeLabel(r), doc: r.doc || '', project: projName(r.projectId), amount: (+r.amount).toFixed(2) }; });
    var csv = S().toCSV ? S().toCSV(data, cols) : cols.map(function (c) { return c.label; }).join(',') + '\n' + data.map(function (d) { return cols.map(function (c) { return '"' + String(d[c.key]).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
    U().exportDialog({ title: title, csv: csv, fileName: 'cash-' + title.replace(/\s+/g, '-') + '.csv' });
  }

  /* ═══ نقاط الشرح ⓘ ═══ */
  var EXPLAIN = {
    end: { t: 'الرصيد في نهاية الأفق', m: 'كم سيبقى في البنك في آخر يوم من المدى المختار لو سارت الاستحقاقات والتحصيلات كما هي مسجّلة.', f: 'الرصيد البنكي اليوم + الداخل المتوقع − الخارج المتوقع', s: 'الرصيد البنكي من الإعدادات، الخارج من فواتير الموردين ومستخلصات المقاولين غير المسددة، الداخل من التحصيلات غير المحصّلة.' },
    in: { t: 'الداخل المتوقع', m: 'تحصيلات من المالك لم تُحصَّل بعد ولها تاريخ استحقاق داخل الأفق.', f: 'مجموع مبالغ التحصيلات المفتوحة ذات الاستحقاق من اليوم حتى نهاية الأفق', s: 'شاشة التحصيلات. المتأخر منها لا يدخل هنا (انظر بطاقة «المتأخر»).' },
    out: { t: 'الخارج المتوقع', m: 'ما يجب دفعه للموردين والمقاولين داخل الأفق، ومعه المتأخر الآن مفترضاً سداده اليوم.', f: 'المتبقي من كل فاتورة/مستخلص (بعد توزيع الدفعات FIFO) بتاريخ استحقاقه = تاريخه + مدة السداد', s: 'كشوف الموردين (211) ودفاتر المقاولين (212). المقاول بلا مدة سداد لا يُعرف تاريخ استحقاقه فلا يدخل إلا إن فعّلت «افترض ٣٠ يوماً».' },
    net: { t: 'صافي الفترة', m: 'الفرق بين ما يدخل وما يخرج خلال الأفق.', f: 'الداخل المتوقع − الخارج المتوقع', s: 'محسوب من البطاقتين المجاورتين.' },
    min: { t: 'أدنى رصيد', m: 'أقل نقطة يصلها الرصيد خلال الأفق — هذا ما يحدد هل تحتاج تمويلاً، لا الرصيد في النهاية.', f: 'أصغر قيمة في سلسلة الرصيد اليومية', s: 'المنحنى أعلاه. انقر الرقم للانتقال إلى يومه.' },
    today: { t: 'الرصيد البنكي اليوم', m: 'نقطة البداية التي يُبنى عليها الإسقاط كله. أدخلته أنت يدوياً.', f: 'قيمة مُدخلة', s: 'الإعدادات ← الرصيد البنكي (يُعدَّل من رابط «تعديل الرصيد»).' },
    lateOut: { t: 'الخارج المتأخر', m: 'ما فات تاريخ استحقاقه ولم يُدفع بعد للموردين والمقاولين.', f: 'مجموع المتبقي من البنود التي تاريخ استحقاقها قبل اليوم', s: 'نفس مصدر الخارج المتوقع.' },
    lateIn: { t: 'الداخل المتأخر', m: 'تحصيلات فات استحقاقها ولم تُحصَّل — لا تدخل المنحنى الأساسي لأن موعدها مجهول.', f: 'مجموع التحصيلات المفتوحة ذات الاستحقاق قبل اليوم', s: 'شاشة التحصيلات.' },
    minNoLate: { t: 'أدنى رصيد لو أُجِّل المتأخر الخارج', m: 'لو لم تدفع أي متأخر اليوم، ما أدنى رصيد يصل إليه النقد؟', f: 'الإسقاط نفسه بلا البنود المتأخرة الخارجة', s: 'إعادة حساب المنحنى.' },
    minLateIn: { t: 'أدنى رصيد لو حُصِّل المتأخر الداخل اليوم', m: 'لو دخل كل تحصيل متأخر اليوم، ما أدنى رصيد؟', f: 'الإسقاط مع إضافة الداخل المتأخر في يوم اليوم', s: 'إعادة حساب المنحنى.' },
    exp: { t: 'المتوقع لهذا الأفق', m: 'الداخل المنتظر من اليوم حتى نهاية الأفق.', f: 'مثل «الداخل المتوقع»', s: 'شاشة التحصيلات.' },
    act: { t: 'المحصّل فعلياً', m: 'ما حُصِّل فعلاً خلال مدة مماثلة منتهية اليوم — للمقارنة بالمتوقع.', f: 'مجموع التحصيلات ذات حالة «محصّل» وتاريخ تحصيلها خلال آخر N يوماً', s: 'شاشة التحصيلات (تاريخ التحصيل).' },
    gap: { t: 'الفجوة', m: 'هل وتيرة التحصيل الماضية تكفي لما تتوقعه؟ سالب = تتوقع أكثر مما اعتدت تحصيله.', f: 'المحصّل فعلياً − المتوقع', s: 'البطاقتان المجاورتان.' },
    rOpen: { t: 'مستحق لنا', m: 'كل ما لم يُحصَّل بعد من المالك (قيد الاعتماد + معتمد).', f: 'مجموع مبالغ التحصيلات غير المحصّلة', s: 'جدول التحصيلات أدناه.' },
    rLate: { t: 'متأخر التحصيل', m: 'تحصيلات فات تاريخ استحقاقها.', f: 'مجموع غير المحصّل ذي الاستحقاق قبل اليوم', s: 'جدول التحصيلات.' },
    r30: { t: 'خلال ٣٠ يوماً', m: 'ما يُنتظر تحصيله في الشهر القادم — يغذّي المنحنى مباشرة.', f: 'مجموع غير المحصّل ذي الاستحقاق من اليوم حتى +٣٠', s: 'جدول التحصيلات.' },
    rMonth: { t: 'محصّل هذا الشهر', m: 'ما دخل فعلاً منذ بداية الشهر الجاري.', f: 'مجموع المحصّل بتاريخ تحصيل في الشهر الجاري', s: 'جدول التحصيلات (تاريخ التحصيل).' }
  };
  function dot(k, subst) {
    return '<button type="button" class="sec-cash-ex" data-ex="' + k + '"' + (subst != null ? ' data-sub="' + esc(subst) + '"' : '') + ' aria-label="اشرح هذا الرقم">ⓘ</button>';
  }
  function openExplain(k, sub) {
    var d = EXPLAIN[k]; if (!d || !U() || !U().modal) return;
    U().modal({
      title: d.t, size: 'md',
      body: '<div class="sec-cash sec-cash-exb"><section><b>ماذا يعني</b><p>' + d.m + '</p></section><section><b>كيف حُسب</b><p>' + d.f + '</p>' + (sub ? '<p class="num sec-cash-subst">' + esc(sub) + '</p>' : '') + '</section><section><b>مصدر البيانات</b><p>' + d.s + '</p></section></div>',
      actions: [{ label: 'فهمت', kind: 'primary', onClick: function (c) { c(true); } }]
    });
  }

  /* ═══ جزيرة الإعداد — بدل الأصفار الخضراء ═══ */
  function setupHTML() {
    var rc = list('receivables').filter(function (r) { return r.status !== 'collected'; }).length;
    var step = V.setup;
    return '<section class="isl c12 sec-cash-setup" style="--i:0">' +
      '<div class="sec-cash-steps" aria-label="خطوات الإعداد"><span class="' + (step === 1 ? 'on' : 'done') + '">١ · الرصيد البنكي</span><i></i><span class="' + (step === 2 ? 'on' : '') + '">٢ · التحصيلات المتوقعة</span></div>' +
      (step === 1 ?
        '<h2>كم في البنك اليوم؟</h2><p class="sec-cash-lead">لا نعرض توقّعاً قبل أن نعرف نقطة البداية — صفر أخضر هنا كان سيوحي بالأمان وهو مجرد غياب بيانات.</p>' +
        '<form class="sec-cash-setf" data-form="balance"><label><span class="cap">الرصيد البنكي اليوم (ر.س)</span><input name="bal" inputmode="decimal" dir="ltr" placeholder="0.00" autocomplete="off" required></label>' +
        '<button class="btn primary" type="submit">احفظ وتابع</button></form><p class="cap">يُحفظ ويُستخدم في كل زيارة. تعدّله لاحقاً من رابط «تعديل الرصيد».</p>'
        :
        '<h2>هل تنتظر تحصيلات من المالك؟</h2><p class="sec-cash-lead">' + (rc ? 'لديك ' + dg(rc) + ' تحصيلاً مسجّلاً — ستدخل المنحنى تلقائياً. أضف غيرها أو تابع.' : 'لا توجد تحصيلات مسجّلة — بدونها يكون الداخل صفراً، وهذا ليس تقديراً.') + '</p>' +
        '<form class="sec-cash-setf" data-form="quickrcv"><label><span class="cap">الجهة</span><input name="from" placeholder="مستخلص المالك — …" autocomplete="off"></label><label><span class="cap">المبلغ</span><input name="amount" inputmode="decimal" dir="ltr" placeholder="0.00" autocomplete="off"></label><label><span class="cap">تاريخ الاستحقاق</span><input name="due" type="date" value="' + iso(dOf(14)) + '"></label><button class="btn" type="submit">أضف</button></form>' +
        '<div class="sec-cash-setacts"><button class="btn primary" data-act="setup-done">' + (rc ? 'اعرض التدفق' : 'تخطَّ — اعرض بلا تحصيلات') + '</button></div>') +
      '</section>';
  }

  /* ═══ المخطط ═══ */
  var W = 1000, H = 300, PL = 12, PR = 78, PT = 16, PB = 64, BAR = 30;
  function chart(P, base) {
    var pts = P.series.map(function (d) { return d.balance; });
    var all = pts.concat(base ? base.series.map(function (d) { return d.balance; }) : []).concat([0, P.start]);
    var max = Math.max.apply(null, all), min = Math.min.apply(null, all);
    var pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1; max += pad; min -= (min < 0 ? pad : 0);
    var n = pts.length - 1 || 1, iw = W - PR - PL, ih = H - PT - PB;
    var X = function (i) { return PL + (i / n) * iw; };
    var Y = function (v) { return PT + (max - v) / (max - min) * ih; };
    var path = function (arr) { return arr.map(function (v, i) { return (i ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); }).join(' '); };
    var line = path(pts);
    var len = Math.round(pts.reduce(function (a, v, i) { return i ? a + Math.hypot(X(i) - X(i - 1), Y(v) - Y(pts[i - 1])) : 0; }, 0)) + 4;
    var area = line + ' L' + X(n).toFixed(1) + ' ' + Y(0).toFixed(1) + ' L' + X(0).toFixed(1) + ' ' + Y(0).toFixed(1) + 'Z';
    var ticks = [max, (max + min) / 2, 0, min].filter(function (v, i, a) { return a.indexOf(v) === i && (v === 0 || Math.abs(Y(v) - Y(0)) > 14); });
    var scale = Math.max(Math.abs(max), Math.abs(min)) >= 1e6 ? [1e6, ' م'] : [1e3, ' ألف'];
    var step = n <= 31 ? 7 : n <= 91 ? 14 : 61;
    var xl = []; for (var i = 0; i <= n; i += step) xl.push(i);
    /* أعمدة داخل/خارج أسبوعية أسفل المخطط */
    var bk = buckets(P, n > 100 ? 30 : 7), bmax = Math.max.apply(null, bk.map(function (b) { return Math.max(b.in, b.out); }).concat([1]));
    var bw = Math.max(2, (iw / bk.length) / 2 - 2), by = H - 22;
    var bars = bk.map(function (b) {
      var x = X(b.from + (b.to - b.from) / 2), hi = b.in / bmax * BAR, ho = b.out / bmax * BAR;
      return '<rect class="bi" x="' + (x - bw - 1).toFixed(1) + '" y="' + (by - hi).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + hi.toFixed(1) + '" style="--i:' + b.idx + '"/>' +
        '<rect class="bo" x="' + (x + 1).toFixed(1) + '" y="' + (by - ho).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + ho.toFixed(1) + '" style="--i:' + b.idx + '"/>';
    }).join('');
    var firstNeg = P.firstNeg;
    var svg = '<svg class="chart sec-cash-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" role="img" aria-label="الرصيد المتوقع خلال ' + rangeLabel(n) + '">' +
      '<defs><clipPath id="sec-cash-below"><rect x="0" y="' + Y(0).toFixed(1) + '" width="' + W + '" height="' + (H).toFixed(1) + '"/></clipPath></defs>' +
      '<g class="grid">' + ticks.map(function (v) { return '<line x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '"/><text x="' + (W - PR + 8) + '" y="' + (Y(v) + 4).toFixed(1) + '">' + dg((v / scale[0]).toFixed(v === 0 ? 0 : 1)) + (v === 0 ? '' : scale[1]) + '</text>'; }).join('') + '</g>' +
      '<path class="sec-cash-negarea" d="' + area + '" clip-path="url(#sec-cash-below)"/>' +
      '<line class="zero" x1="' + PL + '" x2="' + (W - PR) + '" y1="' + Y(0).toFixed(1) + '" y2="' + Y(0).toFixed(1) + '"/>' +
      (base ? '<path class="sec-cash-base" d="' + path(base.series.map(function (d) { return d.balance; })) + '"/>' : '') +
      '<path class="ln draw" d="' + line + '" style="--len:' + len + '"/>' +
      '<g class="sec-cash-bars">' + bars + '</g>' +
      xl.map(function (i) { return '<text x="' + X(i).toFixed(1) + '" y="' + (H - 4) + '" text-anchor="middle">' + esc(dtxt(iso(dOf(i)))) + '</text>'; }).join('') +
      (firstNeg >= 0 ? '<circle class="cur-dot sec-cash-negdot" cx="' + X(firstNeg).toFixed(1) + '" cy="' + Y(pts[firstNeg]).toFixed(1) + '" r="5"/>' : '') +
      '<line class="sec-cash-guide" x1="0" x2="0" y1="' + PT + '" y2="' + (H - PB + 6) + '" style="opacity:0"/>' +
      '<circle class="sec-cash-hdot" r="5" cx="0" cy="0" style="opacity:0"/>' +
      '<circle class="sec-cash-pdot" r="6" cx="0" cy="0" style="opacity:0"/>' +
      '</svg>';
    return { svg: svg, X: X, Y: Y, n: n, pts: pts };
  }

  /* ═══ رسم «التدفق النقدي» ═══ */
  function renderCash(el) {
    fresh(el); el.classList.add('sec-cash');
    var first = V.first; V.first = false;
    var head = '<div class="ph"><div><h1>التدفق النقدي</h1><p>هل يكفي النقد؟ الرصيد المتوقع من رصيد البنك والاستحقاقات والتحصيلات المسجّلة</p></div>';
    if (!hasBalance() || V.setup === 2) {
      el.innerHTML = head + '</div><div class="grid">' + setupHTML() + '</div>';
      bindSetup(el);
      var inp = el.querySelector('input[name="bal"]'); if (inp && !first) { } else if (inp) setTimeout(function () { try { inp.focus(); } catch (e) { } }, 50);
      return;
    }
    var projects = list('projects');
    var ev = events(prefs);
    var P = project(prefs.range, ev, V.scenario);
    var B = V.scenario.length ? project(prefs.range, ev, []) : null;
    var bsize = prefs.range === 365 ? Math.max(prefs.bucket, 30) : prefs.bucket;
    var BK = buckets(P, bsize);
    var ch = chart(P, B);
    var lateOut = ev.out.filter(function (e) { return e.late; });
    var undatedSum = sumOf(ev.undated);
    var noRcv = list('receivables').length === 0;
    var neg = P.firstNeg >= 0;
    var s = settings();

    var acts = '<div class="acts"><div class="seg" role="group" aria-label="المدى">' +
      [[30, '٣٠ يوماً'], [90, '٩٠'], [365, '١٢ شهراً']].map(function (r) { return '<button data-range="' + r[0] + '" aria-pressed="' + (prefs.range === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<button class="btn' + (V.scenarioOpen || V.scenario.length ? ' primary' : '') + '" data-act="scn-toggle" aria-expanded="' + V.scenarioOpen + '">سيناريو +' + (V.scenario.length ? ' <span class="sec-cash-badge">' + dg(V.scenario.length) + '</span>' : '') + '</button></div></div>';

    var filters = '<div class="sec-cash-filters"><div class="seg" role="group" aria-label="الأطراف">' +
      [['both', 'كلاهما'], ['suppliers', 'موردون'], ['contractors', 'مقاولون']].map(function (r) { return '<button data-parties="' + r[0] + '" aria-pressed="' + (prefs.parties === r[0]) + '">' + r[1] + '</button>'; }).join('') + '</div>' +
      '<label class="sec-cash-sel"><span class="cap">المشروع</span><select data-f="project"><option value="">كل المشاريع</option>' + projects.map(function (p) { return '<option value="' + esc(p.id) + '"' + (prefs.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<label class="sec-cash-sel"><span class="cap">طول الفترة</span><select data-f="bucket">' + [[7, 'أسبوع'], [14, 'أسبوعان'], [30, 'شهر']].map(function (b) { return '<option value="' + b[0] + '"' + (bsize === b[0] ? ' selected' : '') + (prefs.range === 365 && b[0] < 30 ? ' disabled' : '') + '>' + b[1] + '</option>'; }).join('') + '</select></label></div>';

    var callouts = '';
    if (noRcv) callouts += '<div class="sec-cash-call w"><span>لا توجد تحصيلات مسجّلة — <b>الداخل صفر ليس تقديراً</b>، بل غياب بيانات.</span><button class="btn sm" data-act="go-coll">أضف تحصيلاً</button></div>';
    if (prefs.parties !== 'suppliers' && undatedSum > 0) callouts += '<div class="sec-cash-call w"><span>مستحق مقاولين بلا تاريخ استحقاق ' + money(undatedSum) + ' — <b>غير داخل في المنحنى</b> لأن المقاول بلا مدة سداد (' + dg(ev.undated.length) + ' بنداً).</span><button class="btn sm" data-act="bd-undated">عرض البنود</button><button class="btn sm" data-act="assume">افترض ٣٠ يوماً من تاريخ المستخلص</button></div>';
    if (prefs.assumeTerm && ev.out.some(function (e) { return e.assumed; })) callouts += '<div class="sec-cash-call i"><span>بنود مقاولين بتاريخ <b>مفترض</b> (+٣٠ يوماً) داخل المنحنى.</span><button class="btn sm" data-act="assume">ألغِ الافتراض</button></div>';
    if (prefs.project && prefs.parties !== 'suppliers') callouts += '<div class="sec-cash-call i"><span>فلتر المشروع يطبَّق على مستخلصات المقاولين المؤرّخة بمشروعها؛ الأرصدة غير المرتبطة بمشروع تُستبعد.</span></div>';
    if (V.scenario.length) callouts += '<div class="sec-cash-call s"><span><b>' + (V.scenarioSaved ? 'سيناريو محفوظ مطبَّق' : 'سيناريو مؤقت') + '</b> — المنحنى المتقطع هو الأصل. الفرق في النهاية: ' + money(P.end - B.end, P.end - B.end < 0 ? 't-danger' : 't-ok') + '</span>' + (V.scenarioSaved ? '' : '<button class="btn sm primary" data-act="scn-save">احفظ</button>') + '<button class="btn sm" data-act="scn-clear">تجاهل السيناريو</button></div>';

    var hero = '<section class="isl c12 sec-cash-heroisl ' + (neg ? 'crit' : '') + '" style="--i:0">' +
      '<div class="ih"><h2>الرصيد بعد ' + rangeLabel(prefs.range) + ' ' + dot('end', fmt(P.start) + ' + ' + fmt(P.totIn) + ' − ' + fmt(P.totOut) + ' = ' + fmt(P.end)) + '</h2>' +
      (neg ? '<button class="pill d sec-cash-pillbtn" data-act="jump" data-day="' + P.firstNeg + '">عجز من ' + esc(dtxt(iso(dOf(P.firstNeg)), { weekday: true })) + '</button>' : '<span class="pill o">لا عجز في هذا الأفق</span>') + '</div>' +
      '<div class="hero ' + (P.end < 0 ? 't-danger' : '') + '">' + counted(P.end) + signWord(P.end) + '</div>' +
      '<div class="meta"><span>أدنى رصيد ' + money(P.min, P.min < 0 ? 't-danger' : '') + ' في ' + esc(dtxt(iso(dOf(P.minIdx)))) + '</span><span>البنك اليوم ' + money(P.start) + ' <button class="sec-cash-lnk" data-act="edit-bal">تعديل الرصيد</button></span>' + (s.bankBalanceAt ? '<span class="cap">أُدخل ' + esc(U() && U().ago ? U().ago(s.bankBalanceAt) : '') + '</span>' : '') + '</div>' +
      '<div class="sec-cash-chartwrap" tabindex="0" role="group" aria-label="المخطط — الأسهم للتنقل وEnter للتثبيت">' + ch.svg + '<div class="sec-cash-tip" role="status" aria-live="polite" hidden></div></div>' +
      '<div class="legend"><span><i style="background:var(--chart-1)"></i>الرصيد المتوقع</span>' + (B ? '<span><i class="sec-cash-lg-base"></i>بلا سيناريو</span>' : '') + '<span><i style="background:var(--chart-3)"></i>داخل</span><span><i style="background:var(--chart-4)"></i>خارج</span><span><i style="background:var(--danger-bg)"></i>تحت الصفر</span></div>' +
      '</section>';

    var scn = V.scenarioOpen ? scenarioHTML(ev) : '';
    var car = carouselHTML(P, ev, lateOut);
    var tables = '<section class="isl c6" style="--i:3"><div class="ih"><h2>الداخل المتوقع</h2><button class="sec-cash-lnk" data-act="bd-in">' + money(P.totIn, 't-ok') + '</button></div>' + bucketTable(BK, 'in') + '</section>' +
      '<section class="isl c6" style="--i:4"><div class="ih"><h2>الخارج المتوقع</h2><button class="sec-cash-lnk" data-act="bd-out">' + money(P.totOut) + '</button></div>' + bucketTable(BK, 'out') + '</section>';
    var foot = '<section class="isl c12 sec-cash-recon" style="--i:5"><div class="ih"><h2>مطابقة الخارج مع المديونية المفتوحة</h2></div>' + reconHTML(P, ev) + '</section>';

    el.innerHTML = head + acts + filters + (callouts ? '<div class="sec-cash-calls">' + callouts + '</div>' : '') + '<div class="grid">' + hero + scn + car + tables + foot + '</div>';
    bindCash(el, P, ev, BK, ch, B);
    animate(el, first);
  }

  function carouselHTML(P, ev, lateOut) {
    var lateIn = ev.lateIn, days = prefs.range;
    var noLate = project(days, ev, V.scenario, { skipLateOut: true });
    var withIn = project(days, ev, V.scenario, { lateInToday: true });
    var actual = list('receivables').filter(function (r) { var o = r.status === 'collected' && r.collectedAt ? off(r.collectedAt) : null; return o != null && o <= 0 && o > -days && (!prefs.project || r.projectId === prefs.project); });
    var actSum = h2(actual.reduce(function (a, r) { return a + c2(r.amount); }, 0));
    var gap = actSum - P.totIn;
    function k(lbl, ex, val, cls, act, sub, hint) {
      return '<div class="sec-cash-k"><div class="cap">' + lbl + ' ' + dot(ex, sub) + '</div><button class="sec-cash-kv kpi ' + (cls || '') + '" data-act="' + act + '" title="من أين جاء هذا الرقم؟">' + money(val) + signWord(val) + '</button>' + (hint ? '<div class="cap">' + hint + '</div>' : '') + '</div>';
    }
    var ag = [[1, 30], [31, 60], [61, 90], [91, null]].map(function (r) {
      var f = function (e) { var d = -off(e.date); return d >= r[0] && (r[1] == null || d <= r[1]); };
      var o = lateOut.filter(f), i = lateIn.filter(f);
      return { lbl: r[1] ? dg(r[0]) + '–' + dg(r[1]) + ' يوماً' : 'أكثر من ' + dg(90) + ' يوماً', o: o, i: i };
    }).filter(function (a) { return a.o.length || a.i.length; });
    V._aging = ag; V._actual = actual;
    var views = [
      { t: 'الحالي', h: '<div class="sec-cash-krow">' + k('الداخل المتوقع', 'in', P.totIn, 't-ok', 'bd-in', fmt(P.totIn)) + k('الخارج المتوقع', 'out', P.totOut, '', 'bd-out', fmt(P.totOut), lateOut.length ? 'يشمل متأخراً ' + money(sumOf(lateOut)) : '') + k('صافي الفترة', 'net', P.totIn - P.totOut, P.totIn - P.totOut < 0 ? 't-danger' : '', 'bd-net', fmt(P.totIn) + ' − ' + fmt(P.totOut)) + k('أدنى رصيد', 'min', P.min, P.min < 0 ? 't-danger' : '', 'jump-min', null, 'في ' + esc(dtxt(iso(dOf(P.minIdx)))) + ' — انقر للانتقال') + '</div>' },
      { t: 'المتأخر', h: '<div class="sec-cash-krow">' + k('الخارج المتأخر', 'lateOut', sumOf(lateOut), lateOut.length ? 't-danger' : '', 'bd-lateout', fmt(sumOf(lateOut)), dg(lateOut.length) + ' بنداً') + k('الداخل المتأخر', 'lateIn', sumOf(lateIn), '', 'bd-latein', fmt(sumOf(lateIn)), dg(lateIn.length) + ' بنداً') + k('أدنى رصيد لو أُجِّل المتأخر', 'minNoLate', noLate.min, noLate.min < 0 ? 't-danger' : '', 'bd-lateout') + k('أدنى رصيد لو حُصِّل المتأخر اليوم', 'minLateIn', withIn.min, withIn.min < 0 ? 't-danger' : '', 'bd-latein') + '</div>' +
        (ag.length ? '<div class="tbl-wrap sec-cash-agewrap"><table class="sec-cash-age"><thead><tr><th>عمر التأخر</th><th class="n">الخارج المتأخر</th><th class="n">الداخل المتأخر</th></tr></thead><tbody>' + ag.map(function (a, i) { return '<tr><td>' + a.lbl + '</td><td class="n"><button class="sec-cash-lnk" data-act="bd-age" data-age="' + i + '" data-dir="o">' + money(sumOf(a.o), 't-danger') + ' <span class="cap">(' + dg(a.o.length) + ')</span></button></td><td class="n"><button class="sec-cash-lnk" data-act="bd-age" data-age="' + i + '" data-dir="i">' + money(sumOf(a.i)) + ' <span class="cap">(' + dg(a.i.length) + ')</span></button></td></tr>'; }).join('') + '</tbody></table></div>' : '<p class="cap">لا متأخرات في هذا الاختيار.</p>') },
      { t: 'المتوقع مقابل الفعلي', h: '<div class="sec-cash-krow">' + k('المتوقع لهذا الأفق', 'exp', P.totIn, 't-ok', 'bd-in', fmt(P.totIn)) + k('المحصّل فعلياً آخر ' + rangeLabel(days), 'act', actSum, 't-ok', 'bd-actual', fmt(actSum)) + k('الفجوة', 'gap', gap, gap < 0 ? 't-warn' : 't-ok', 'bd-gap', fmt(actSum) + ' − ' + fmt(P.totIn)) + '</div><p class="cap">«المتوقع» تحصيلات لم تحدث بعد داخل الأفق، و«المحصّل» حدث فعلاً خلال مدة مماثلة انتهت اليوم — مجموعتان مختلفتان؛ الفجوة تعرض الفرق صراحةً.</p>' }
    ];
    var a = Math.max(0, Math.min(views.length - 1, prefs.kpiView | 0));
    return '<section class="isl c12 sec-cash-car" style="--i:1" role="region" aria-roledescription="carousel" aria-label="بطاقات ملخّص التدفق النقدي" tabindex="0">' +
      '<div class="ih"><h2 aria-live="polite">' + views[a].t + '</h2><div class="sec-cash-nav"><button class="btn sm" data-act="car-prev" aria-label="السابق">›</button><div class="sec-cash-dots">' + views.map(function (v, i) { return '<button data-car="' + i + '" aria-label="' + v.t + '" aria-current="' + (i === a) + '"></button>'; }).join('') + '</div><button class="btn sm" data-act="car-next" aria-label="التالي">‹</button></div></div>' +
      '<div class="sec-cash-vp"><div class="sec-cash-track" style="transform:translateX(' + (a * 100) + '%)">' + views.map(function (v, i) { return '<div class="sec-cash-slide" aria-hidden="' + (i !== a) + '"' + (i !== a ? ' inert' : '') + '>' + v.h + '</div>'; }).join('') + '</div></div></section>';
  }

  function bucketTable(BK, dir) {
    var rows = BK.filter(function (b) { return dir === 'in' ? b.ins.length : b.outs.length; });
    if (!rows.length) return '<div class="sec-cash-empty">' + (dir === 'in' ? 'لا تحصيلات مستحقة في هذا الأفق.' : 'لا مدفوعات مستحقة في هذا الأفق.') + '</div>';
    var tot = 0;
    var body = rows.map(function (b) {
      var items = dir === 'in' ? b.ins : b.outs, amt = dir === 'in' ? b.in : b.out, key = dir + b.idx, open = !!V.expanded[key];
      tot += c2(amt);
      var tr = '<tr class="go sec-cash-brow" data-bk="' + b.idx + '" data-from="' + b.from + '" data-to="' + b.to + '" data-exp="' + key + '" aria-expanded="' + open + '"><td><span class="sec-cash-car2">' + (open ? '▾' : '◂') + '</span> ' + esc(dtxt(iso(dOf(b.from)))) + (b.to > b.from ? ' – ' + esc(dtxt(iso(dOf(b.to)))) : '') + '</td><td class="n">' + dg(items.length) + '</td><td class="n"><button class="sec-cash-lnk" data-act="bd-bucket" data-bk="' + b.idx + '" data-dir="' + dir + '">' + money(amt, dir === 'in' ? 't-ok' : '') + '</button></td></tr>';
      if (open) tr += items.slice().sort(function (x, y) { return String(x.date).localeCompare(String(y.date)); }).map(function (it) {
        return '<tr class="sec-cash-item" data-day="' + Math.max(0, off(it.date)) + '" data-bk="' + b.idx + '"><td><span class="cap">' + esc(dtxt(it.date)) + '</span> ' + esc(it.party) + (it.late ? ' <span class="pill d">متأخر</span>' : '') + (it.shifted ? ' <span class="pill w">+' + dg(it.shifted) + ' يوماً</span>' : '') + (it.scenario ? ' <span class="pill n">سيناريو</span>' : '') + (it.assumed ? ' <span class="pill n">مفترض</span>' : '') + '<div class="cap">' + esc(it.doc || '') + ' · ' + esc(projName(it.projectId)) + '</div></td><td class="n">' + (dir === 'out' ? '<button class="btn sm" data-act="delay" data-key="' + esc(it.key) + '" data-label="' + esc(it.party + ' — ' + (it.doc || '')) + '">أجِّل</button>' : '') + '</td><td class="n">' + money(it.amount, dir === 'in' ? 't-ok' : '') + '</td></tr>';
      }).join('');
      return tr;
    }).join('');
    return '<div class="tbl-wrap"><table class="sec-cash-bt"><thead><tr><th>الفترة</th><th class="n">بنود</th><th class="n">المبلغ</th></tr></thead><tbody>' + body + '</tbody><tfoot><tr><td colspan="2">الإجمالي</td><td class="n">' + money(h2(tot)) + '</td></tr></tfoot></table></div>';
  }

  function reconHTML(P, ev) {
    var lateO = sumOf(ev.out.filter(function (e) { return e.late; }));
    var sched = h2(c2(P.totOut) - c2(lateO));
    var und = sumOf(ev.undated);
    var openDebt = h2(c2(sched) + c2(lateO) + c2(P.beyondOut) + c2(und));
    function term(sign, lbl, v, act) { return '<span class="sec-cash-term">' + (sign ? '<b class="sec-cash-op">' + sign + '</b>' : '') + '<span class="cap">' + lbl + '</span>' + (act ? '<button class="sec-cash-lnk" data-act="' + act + '">' + money(v) + '</button>' : money(v)) + '</span>'; }
    return '<div class="sec-cash-terms">' + term('', 'المجدول داخل الأفق', sched, 'bd-sched') + term('+', 'متأخر الآن', lateO, 'bd-lateout') + term('+', 'بعد نهاية الأفق', P.beyondOut, 'bd-beyond') + term('+', 'بلا تواريخ', und, 'bd-undated') + term('=', 'المديونية المفتوحة', openDebt) + '</div>' +
      '<p class="disclose">كل بند من المديونية المفتوحة يظهر في مكان واحد فقط من هذه الأربعة — المجموع يُطابق رقم المديونية في «الأطراف»' + (V.scenario.length ? ' (بعد تأجيلات السيناريو)' : '') + '.</p>';
  }

  function scenarioHTML(ev) {
    var outs = ev.out.slice().sort(function (a, b) { return String(a.date).localeCompare(String(b.date)); });
    return '<section class="isl c12 sec-cash-scn" style="--i:2"><div class="ih"><h2>سيناريو «ماذا لو؟»</h2><span class="cap">مؤقت — لا يغيّر بياناتك ما لم تحفظ</span></div>' +
      '<div class="sec-cash-scngrid"><form data-form="delay" class="sec-cash-scnf"><b>أجِّل دفعة</b><label><span class="cap">البند</span><select name="key" required><option value="">اختر…</option>' +
      outs.map(function (e) { return '<option value="' + esc(e.key) + '">' + esc(dtxt(e.date)) + ' · ' + esc(e.party) + ' · ' + esc(e.doc || '') + ' · ' + fmt(e.amount) + '</option>'; }).join('') +
      '</select></label><label><span class="cap">بعدد أيام</span><input name="days" type="number" min="1" max="365" value="14" dir="ltr"></label><button class="btn" type="submit">طبِّق</button></form>' +
      '<form data-form="inflow" class="sec-cash-scnf"><b>أضف تحصيلاً متوقعاً</b><label><span class="cap">الوصف</span><input name="label" placeholder="دفعة مقدّمة…" autocomplete="off"></label><label><span class="cap">المبلغ</span><input name="amount" inputmode="decimal" dir="ltr" placeholder="0.00" required autocomplete="off"></label><label><span class="cap">التاريخ</span><input name="date" type="date" value="' + iso(dOf(10)) + '" required></label><button class="btn" type="submit">طبِّق</button></form></div>' +
      (V.scenario.length ? '<ul class="sec-cash-tweaks">' + V.scenario.map(function (t) { return '<li><span>' + (t.kind === 'delay' ? 'تأجيل <b>' + esc(t.label) + '</b> ' + dg(t.days) + ' يوماً' : 'تحصيل <b>' + esc(t.label || 'افتراضي') + '</b> ' + money(+t.amount, 't-ok') + ' في ' + esc(dtxt(t.date))) + '</span><span>' + (t.kind === 'inflow' ? '<button class="btn sm" data-act="scn-commit" data-id="' + t.id + '">أضِفه للتحصيلات</button>' : '') + '<button class="btn sm" data-act="scn-del" data-id="' + t.id + '" aria-label="أزل">×</button></span></li>'; }).join('') + '</ul>' : '<p class="cap">أضف تعديلاً وسيتحدّث المنحنى فوراً مع إظهار الأصل متقطعاً للمقارنة. يمكنك أيضاً الضغط «أجِّل» على أي بند في جدول الخارج.</p>') +
      '</section>';
  }

  /* ─── التفاعل ─── */
  function rerender() { if (E.shell && E.shell.refresh) E.shell.refresh(); }
  function moneyIn(v) { var n = parseFloat(String(v || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[,\s٬]/g, '').replace('٫', '.').replace('−', '-')); return isNaN(n) ? null : Math.round(n * 100) / 100; }
  function shake(inp) { if (!inp) return; inp.classList.remove('m-shake', 'sec-cash-shake'); void inp.offsetWidth; inp.classList.add('m-shake', 'sec-cash-shake'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); }

  function bindSetup(el) {
    L(el, 'submit', function (e) {
      var f = e.target; e.preventDefault();
      if (f.dataset.form === 'balance') {
        var v = moneyIn(f.bal.value); if (v == null) return shake(f.bal);
        V.setup = 2; setSettings({ bankBalance: v, bankBalanceAt: new Date().toISOString() });
        toast('حُفظ الرصيد البنكي', { kind: 'ok' }); rerender();
      } else if (f.dataset.form === 'quickrcv') {
        var a = moneyIn(f.amount.value); if (!f.from.value.trim()) return shake(f.from); if (!(a > 0)) return shake(f.amount); if (!f.due.value) return shake(f.due);
        var r = S().create('receivables', { projectId: prefs.project || null, from: f.from.value.trim(), docNo: '', amount: a, dueDate: f.due.value, status: 'pending', collectedAt: null });
        toast('أُضيف التحصيل', { kind: 'ok', undo: function () { S().remove('receivables', r && r.id); } });
        rerender();
      }
    });
    L(el, 'click', function (e) { var b = e.target.closest('[data-act="setup-done"]'); if (b) { V.setup = 0; rerender(); } });
  }

  function bindCash(el, P, ev, BK, ch, B) {
    var wrap = el.querySelector('.sec-cash-chartwrap'), svg = wrap.querySelector('svg'), tip = wrap.querySelector('.sec-cash-tip');
    var guide = svg.querySelector('.sec-cash-guide'), hdot = svg.querySelector('.sec-cash-hdot'), pdot = svg.querySelector('.sec-cash-pdot');
    var hover = null;
    function idxAt(clientX) { var r = svg.getBoundingClientRect(); var x = (clientX - r.left) / r.width * W; return Math.max(0, Math.min(ch.n, Math.round((x - PL) / (W - PR - PL) * ch.n))); }
    function mark(i, cls) {
      el.querySelectorAll('.' + cls).forEach(function (r) { r.classList.remove(cls); });
      if (i == null) return;
      el.querySelectorAll('tr.sec-cash-brow,tr.sec-cash-item').forEach(function (r) {
        var hit = r.classList.contains('sec-cash-item') ? +r.dataset.day === i : (i >= +r.dataset.from && i <= +r.dataset.to);
        if (hit) r.classList.add(cls);
      });
    }
    function show(i) {
      hover = i; var d = P.series[i], x = ch.X(i), y = ch.Y(d.balance);
      guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.style.opacity = 1;
      hdot.setAttribute('cx', x); hdot.setAttribute('cy', y); hdot.style.opacity = 1;
      var items = d.items.slice(0, 5);
      tip.innerHTML = '<b>' + esc(dtxt(d.date, { weekday: true })) + '</b><div>الرصيد ' + money(d.balance, d.balance < 0 ? 't-danger' : '') + signWord(d.balance) + '</div>' +
        (B ? '<div class="cap">بلا سيناريو ' + money(B.series[i].balance) + '</div>' : '') +
        (d.items.length ? '<ul>' + items.map(function (it) { return '<li><span>' + esc(it.party) + '</span>' + money(it.dir === 'in' ? it.amount : -it.amount, it.dir === 'in' ? 't-ok' : '') + '</li>'; }).join('') + (d.items.length > 5 ? '<li class="cap">و' + dg(d.items.length - 5) + ' بنود أخرى</li>' : '') + '</ul>' : '<div class="cap">لا حركة في هذا اليوم</div>') +
        '<div class="cap">انقر لتمييز صفوفه</div>';
      tip.hidden = false;
      var r = svg.getBoundingClientRect(), px = (x / W) * r.width, w = tip.offsetWidth || 220;
      var left = px + 14; if (left + w > r.width) left = px - w - 14; if (left < 0) left = 0;
      tip.style.transform = 'translate(' + Math.round(left) + 'px,' + Math.round((y / H) * r.height * 0.4) + 'px)';
      mark(i, 'sec-cash-hl');
    }
    function hide() { hover = null; tip.hidden = true; guide.style.opacity = 0; hdot.style.opacity = 0; mark(null, 'sec-cash-hl'); }
    function pin(i, scroll) {
      V.pinned = i;
      if (i == null) { pdot.style.opacity = 0; mark(null, 'sec-cash-pin'); return; }
      var d = P.series[i];
      pdot.setAttribute('cx', ch.X(i)); pdot.setAttribute('cy', ch.Y(d.balance)); pdot.style.opacity = 1;
      /* افتح الفترة المطابقة حتى تظهر البنود */
      var b = BK.find(function (x) { return i >= x.from && i <= x.to; });
      if (b && (b.ins.length || b.outs.length) && !(V.expanded['in' + b.idx] || V.expanded['out' + b.idx])) {
        if (b.ins.length) V.expanded['in' + b.idx] = true; if (b.outs.length) V.expanded['out' + b.idx] = true;
        rerender(); return;
      }
      mark(i, 'sec-cash-pin');
      if (scroll) { var r = el.querySelector('.sec-cash-pin'); if (r && r.scrollIntoView) r.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); }
    }
    wrap.addEventListener('pointermove', function (e) { show(idxAt(e.clientX)); });
    wrap.addEventListener('pointerleave', hide);
    wrap.addEventListener('click', function (e) { var i = idxAt(e.clientX); V.pendingScroll = true; pin(V.pinned === i ? null : i, true); });
    wrap.addEventListener('keydown', function (e) {
      var i = hover == null ? (V.pinned != null ? V.pinned : 0) : hover;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); var step = e.shiftKey ? 7 : 1; i += (e.key === 'ArrowRight' ? -step : step); i = Math.max(0, Math.min(ch.n, i)); show(i); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); V.pendingScroll = true; pin(i, true); }
      else if (e.key === 'Escape') { hide(); pin(null); }
    });
    wrap.addEventListener('blur', hide);
    if (V.pinned != null && V.pinned <= ch.n) { pin(V.pinned, false); if (V.pendingScroll) { V.pendingScroll = false; var r0 = el.querySelector('.sec-cash-pin'); if (r0) r0.scrollIntoView({ block: 'center' }); } }

    /* تمرير المؤشر على صف فترة يبرز النقطة في المخطط */
    L(el, 'pointerover', function (e) {
      var tr = e.target.closest('tr.sec-cash-item'); if (!tr) return;
      var i = +tr.dataset.day; if (!isNaN(i) && i <= ch.n) { hdot.setAttribute('cx', ch.X(i)); hdot.setAttribute('cy', ch.Y(P.series[i].balance)); hdot.style.opacity = 1; }
    });

    /* الكاروسيل */
    var car = el.querySelector('.sec-cash-car');
    function goCar(i) { prefs.kpiView = (i + 3) % 3; savePrefs(); var t = car.querySelector('.sec-cash-track'); t.style.transform = 'translateX(' + (prefs.kpiView * 100) + '%)'; car.querySelectorAll('.sec-cash-slide').forEach(function (s, k) { s.setAttribute('aria-hidden', k !== prefs.kpiView); if (k !== prefs.kpiView) s.setAttribute('inert', ''); else s.removeAttribute('inert'); }); car.querySelectorAll('[data-car]').forEach(function (d, k) { d.setAttribute('aria-current', k === prefs.kpiView); }); car.querySelector('.ih h2').textContent = ['الحالي', 'المتأخر', 'المتوقع مقابل الفعلي'][prefs.kpiView]; }
    car.addEventListener('keydown', function (e) { if (e.target.closest('.sec-cash-slide')) return; if (e.key === 'ArrowLeft') { e.preventDefault(); goCar(prefs.kpiView + 1); } else if (e.key === 'ArrowRight') { e.preventDefault(); goCar(prefs.kpiView - 1); } });
    var tx = null;
    car.addEventListener('touchstart', function (e) { tx = e.touches[0] && e.touches[0].clientX; }, { passive: true });
    car.addEventListener('touchend', function (e) { if (tx == null) return; var dx = (e.changedTouches[0] ? e.changedTouches[0].clientX : tx) - tx; tx = null; if (Math.abs(dx) > 40) goCar(prefs.kpiView + (dx > 0 ? 1 : -1)); });

    /* النقرات */
    L(el, 'click', function (e) {
      var t = e.target.closest('[data-act],[data-range],[data-parties],[data-car],[data-ex],tr[data-exp]');
      if (!t || !el.contains(t)) return;
      if (t.dataset.ex) { e.stopPropagation(); return openExplain(t.dataset.ex, t.dataset.sub); }
      if (t.dataset.range) { prefs.range = +t.dataset.range; V.pinned = null; V.expanded = {}; savePrefs(); return rerender(); }
      if (t.dataset.parties) { prefs.parties = t.dataset.parties; savePrefs(); return rerender(); }
      if (t.dataset.car != null && t.hasAttribute('data-car')) return goCar(+t.dataset.car);
      var a = t.dataset.act;
      if (!a && t.dataset.exp) { V.expanded[t.dataset.exp] = !V.expanded[t.dataset.exp]; return rerender(); }
      e.stopPropagation();
      var outsAll = function () { return P.series.reduce(function (a2, d) { return a2.concat(d.items.filter(function (x) { return x.dir === 'out'; })); }, []); };
      var insAll = function () { return P.series.reduce(function (a2, d) { return a2.concat(d.items.filter(function (x) { return x.dir === 'in'; })); }, []); };
      switch (a) {
        case 'car-prev': return goCar(prefs.kpiView - 1);
        case 'car-next': return goCar(prefs.kpiView + 1);
        case 'scn-toggle': V.scenarioOpen = !V.scenarioOpen; return rerender();
        case 'go-coll': return E.shell.go('collections', { add: 1 });
        case 'assume': prefs.assumeTerm = !prefs.assumeTerm; savePrefs(); return rerender();
        case 'edit-bal': return editBalance();
        case 'jump': case 'jump-min': {
          var day = a === 'jump' ? +t.dataset.day : P.minIdx; V.pendingScroll = true; pin(day, true);
          var hw = el.querySelector('.sec-cash-chartwrap'); if (hw && hw.scrollIntoView && a === 'jump') hw.scrollIntoView({ block: 'center' });
          return;
        }
        case 'bd-in': return breakdown('الداخل المتوقع', 'تحصيلات غير محصّلة باستحقاق من اليوم حتى ' + esc(dtxt(iso(dOf(prefs.range)))) + (V.scenario.length ? ' — مع إضافات السيناريو' : '') + '.', insAll());
        case 'bd-out': return breakdown('الخارج المتوقع', 'المتبقي من فواتير الموردين ومستخلصات المقاولين المستحقة داخل الأفق، والمتأخر منها مفترضاً سداده اليوم.', outsAll());
        case 'bd-net': return breakdown('صافي الفترة', 'الداخل (موجب) والخارج داخل الأفق؛ الصافي = الداخل − الخارج.', insAll().concat(outsAll().map(function (x) { return Object.assign({}, x, { amount: -x.amount }); })));
        case 'bd-lateout': return breakdown('الخارج المتأخر', 'بنود فات تاريخ استحقاقها قبل ' + esc(dtxt(iso(today()))) + ' ولم تُسدَّد.', ev.out.filter(function (x) { return x.late; }));
        case 'bd-latein': return breakdown('الداخل المتأخر', 'تحصيلات فات استحقاقها ولم تُحصَّل — خارج المنحنى الأساسي.', ev.lateIn);
        case 'bd-undated': return breakdown('بلا تواريخ', 'مستحق للمقاولين لا يُعرف تاريخ استحقاقه (المقاول بلا مدة سداد أو رصيد بلا مستخلص).', ev.undated);
        case 'bd-beyond': return breakdown('بعد نهاية الأفق', 'بنود يقع استحقاقها بعد ' + esc(dtxt(iso(dOf(prefs.range)))) + '.', ev.out.filter(function (x) { var o = off(x.date); return o != null && o > prefs.range; }));
        case 'bd-sched': return breakdown('المجدول داخل الأفق', 'بنود غير متأخرة يقع استحقاقها داخل الأفق.', outsAll().filter(function (x) { return !x.late; }));
        case 'bd-actual': return breakdown('المحصّل فعلياً', 'تحصيلات بتاريخ تحصيل خلال آخر ' + rangeLabel(prefs.range) + '.', V._actual.map(function (r) { return { dir: 'in', partyType: 'receivable', partyId: r.id, party: r.from, doc: r.docNo, date: r.collectedAt, amount: +r.amount, projectId: r.projectId }; }));
        case 'bd-gap': return breakdown('الفجوة', 'المحصّل فعلياً (موجب) ناقص المتوقع (سالب).', V._actual.map(function (r) { return { dir: 'in', partyType: 'receivable', partyId: r.id, party: r.from, doc: r.docNo, date: r.collectedAt, amount: +r.amount, projectId: r.projectId }; }).concat(insAll().map(function (x) { return Object.assign({}, x, { amount: -x.amount }); })));
        case 'bd-age': { var g = V._aging[+t.dataset.age]; return breakdown('متأخر ' + g.lbl, 'بنود متأخرة ضمن هذا العمر.', t.dataset.dir === 'o' ? g.o : g.i); }
        case 'bd-bucket': { var b = BK[+t.dataset.bk]; var inn = t.dataset.dir === 'in'; return breakdown((inn ? 'داخل ' : 'خارج ') + dtxt(iso(dOf(b.from))) + ' – ' + dtxt(iso(dOf(b.to))), 'بنود هذه الفترة.', inn ? b.ins : b.outs); }
        case 'delay': { V.scenarioOpen = true; V.scenario.push({ id: 's' + Date.now(), kind: 'delay', key: t.dataset.key, days: 14, label: t.dataset.label }); V.scenarioSaved = false; toast('أُجِّل البند ١٤ يوماً في السيناريو', { kind: 'info', undo: function () { V.scenario.pop(); rerender(); } }); return rerender(); }
        case 'scn-del': V.scenario = V.scenario.filter(function (x) { return x.id !== t.dataset.id; }); if (V.scenarioSaved) lsSet(SCN_KEY, V.scenario.length ? { tweaks: V.scenario } : null); if (!V.scenario.length) { V.scenarioSaved = false; try { localStorage.removeItem(SCN_KEY); } catch (er) { } } return rerender();
        case 'scn-clear': { var prev = V.scenario, ps = V.scenarioSaved; V.scenario = []; V.scenarioSaved = false; try { localStorage.removeItem(SCN_KEY); } catch (er) { } toast('أُلغي السيناريو', { kind: 'info', undo: function () { V.scenario = prev; V.scenarioSaved = ps; if (ps) lsSet(SCN_KEY, { tweaks: prev }); rerender(); } }); return rerender(); }
        case 'scn-save': lsSet(SCN_KEY, { tweaks: V.scenario }); V.scenarioSaved = true; toast('حُفظ السيناريو — يبقى مطبّقاً حتى تلغيه', { kind: 'ok' }); return rerender();
        case 'scn-commit': {
          var tw = V.scenario.find(function (x) { return x.id === t.dataset.id; }); if (!tw) return;
          var rec = S().create('receivables', { projectId: prefs.project || null, from: tw.label || 'تحصيل متوقع', docNo: '', amount: +tw.amount, dueDate: tw.date, status: 'pending', collectedAt: null });
          V.scenario = V.scenario.filter(function (x) { return x !== tw; }); if (V.scenarioSaved) lsSet(SCN_KEY, V.scenario.length ? { tweaks: V.scenario } : null);
          toast('أُضيف إلى التحصيلات', { kind: 'ok', undo: function () { S().remove('receivables', rec && rec.id); } }); return rerender();
        }
      }
    });
    L(el, 'change', function (e) {
      var f = e.target.dataset && e.target.dataset.f;
      if (f === 'project') { prefs.project = e.target.value; savePrefs(); rerender(); }
      if (f === 'bucket') { prefs.bucket = +e.target.value; V.expanded = {}; savePrefs(); rerender(); }
    });
    L(el, 'submit', function (e) {
      var fm = e.target; e.preventDefault();
      if (fm.dataset.form === 'delay') {
        if (!fm.key.value) return shake(fm.key); var dd = parseInt(fm.days.value, 10); if (!(dd > 0)) return shake(fm.days);
        V.scenario.push({ id: 's' + Date.now(), kind: 'delay', key: fm.key.value, days: dd, label: fm.key.options[fm.key.selectedIndex].text.split(' · ').slice(1, 3).join(' — ') });
      } else if (fm.dataset.form === 'inflow') {
        var am = moneyIn(fm.amount.value); if (!(am > 0)) return shake(fm.amount); if (!fm.date.value) return shake(fm.date);
        V.scenario.push({ id: 's' + Date.now(), kind: 'inflow', label: fm.label.value.trim(), amount: am, date: fm.date.value });
      } else return;
      V.scenarioSaved = false; rerender();
    });
  }

  function editBalance() {
    var cur = settings().bankBalance;
    U().modal({
      title: 'الرصيد البنكي اليوم', size: 'md',
      body: '<div class="sec-cash">' + (U().form ? U().form([{ name: 'bal', label: 'الرصيد (ر.س)', type: 'money', value: cur, required: true, help: 'نقطة بداية كل الإسقاطات. يمكن أن يكون سالباً (سحب على المكشوف).' }]) : '<label>الرصيد <input name="bal" value="' + esc(cur) + '"></label>') + '</div>',
      actions: [
        { label: 'إلغاء', onClick: function (c) { c(true); } },
        {
          label: 'حفظ', kind: 'primary', onClick: function (close, root) {
            var inp = root.querySelector('[name="bal"]'), v = moneyIn(inp && inp.value);
            if (v == null) return shake(inp);
            var prev = cur, prevAt = settings().bankBalanceAt;
            setSettings({ bankBalance: v, bankBalanceAt: new Date().toISOString() }); close(true);
            toast('حُدّث الرصيد البنكي', { kind: 'ok', undo: function () { setSettings({ bankBalance: prev, bankBalanceAt: prevAt }); } });
          }
        }
      ]
    });
  }

  /* ═══ التحصيلات ═══ */
  function rcvState(r) {
    if (r.status === 'collected') return 'collected';
    if (r.dueDate && r.dueDate < iso(today())) return 'late';
    return r.status === 'approved' ? 'approved' : 'pending';
  }
  var ST_LBL = { late: 'متأخر', pending: 'قيد الاعتماد', approved: 'معتمد', collected: 'محصّل' };
  function rcvForm(r) {
    r = r || {};
    var projects = list('projects');
    var fields = [
      { name: 'from', label: 'الجهة (المالك)', type: 'text', required: true, value: r.from || '' },
      { name: 'docNo', label: 'رقم المستخلص/المستند', type: 'text', value: r.docNo || '' },
      { name: 'projectId', label: 'المشروع', type: 'select', options: [{ value: '', label: '—' }].concat(projects.map(function (p) { return { value: p.id, label: p.name }; })), value: r.projectId || '' },
      { name: 'amount', label: 'المبلغ', type: 'money', required: true, value: r.amount != null ? r.amount : '' },
      { name: 'dueDate', label: 'تاريخ الاستحقاق', type: 'date', value: r.dueDate || '', help: 'بلا تاريخ لن يدخل منحنى التدفق النقدي.' },
      { name: 'status', label: 'الحالة', type: 'select', options: [{ value: 'pending', label: 'قيد الاعتماد' }, { value: 'approved', label: 'معتمد' }, { value: 'collected', label: 'محصّل' }], value: r.status || 'pending' },
      { name: 'collectedAt', label: 'تاريخ التحصيل', type: 'date', value: r.collectedAt || '', help: 'مطلوب إن كانت الحالة «محصّل».' }
    ];
    return U().form(fields);
  }
  function readRcv(root) {
    var o = U().readForm ? U().readForm(root) : {};
    ['from', 'docNo', 'projectId', 'amount', 'dueDate', 'status', 'collectedAt'].forEach(function (k) { if (o[k] === undefined) { var i = root.querySelector('[name="' + k + '"]'); if (i) o[k] = i.value; } });
    var amt = typeof o.amount === 'number' ? o.amount : moneyIn(o.amount);
    var q = function (n) { return root.querySelector('[name="' + n + '"]'); };
    if (!String(o.from || '').trim()) { shake(q('from')); return null; }
    if (!(amt > 0)) { shake(q('amount')); return null; }
    if (o.status === 'collected' && !o.collectedAt) { shake(q('collectedAt')); return null; }
    return { from: String(o.from).trim(), docNo: String(o.docNo || '').trim(), projectId: o.projectId || null, amount: amt, dueDate: o.dueDate || null, status: o.status || 'pending', collectedAt: o.status === 'collected' ? o.collectedAt : null };
  }
  function editRcv(r) {
    U().modal({
      title: r ? 'تعديل تحصيل' : 'إضافة تحصيل', size: 'md', body: '<div class="sec-cash">' + rcvForm(r) + '</div>',
      actions: [
        { label: 'إلغاء', onClick: function (c) { c(true); } },
        {
          label: r ? 'حفظ' : 'أضف', kind: 'primary', onClick: function (close, root) {
            var v = readRcv(root); if (!v) return;
            if (r) {
              var before = {}; Object.keys(v).forEach(function (k) { before[k] = r[k]; });
              S().update('receivables', r.id, v); close(true);
              toast('حُفظ التعديل', { kind: 'ok', undo: function () { S().update('receivables', r.id, before); } });
            } else {
              var n = S().create('receivables', v); close(true);
              toast('أُضيف التحصيل — يدخل التدفق النقدي فوراً', { kind: 'ok', undo: function () { S().remove('receivables', n && n.id); } });
            }
          }
        }
      ]
    });
  }
  function collect(r) {
    U().modal({
      title: 'تسجيل تحصيل — ' + (r.from || ''), size: 'md',
      body: '<div class="sec-cash"><p>' + esc(r.from) + ' · ' + money(+r.amount, 't-ok') + '</p>' + U().form([{ name: 'collectedAt', label: 'تاريخ التحصيل', type: 'date', value: iso(today()), required: true }]) + '</div>',
      actions: [
        { label: 'إلغاء', onClick: function (c) { c(true); } },
        {
          label: 'سجّل التحصيل', kind: 'primary', onClick: function (close, root) {
            var i = root.querySelector('[name="collectedAt"]'); if (!i || !i.value) return shake(i);
            var prev = { status: r.status, collectedAt: r.collectedAt || null };
            S().update('receivables', r.id, { status: 'collected', collectedAt: i.value }); close(true);
            toast('سُجّل التحصيل', { kind: 'ok', undo: function () { S().update('receivables', r.id, prev); } });
          }
        }
      ]
    });
  }
  function delRcv(r) {
    S().remove('receivables', r.id);
    toast('حُذف التحصيل', { kind: 'info', undo: function () { S().restore('receivables', r.id); } });
  }

  function renderCollections(el, params) {
    fresh(el); el.classList.add('sec-cash');
    var first = V.first; V.first = false;
    var t0 = iso(today()), t30 = iso(dOf(30)), mStart = t0.slice(0, 7);
    var all = list('receivables');
    var open = all.filter(function (r) { return r.status !== 'collected'; });
    var late = open.filter(function (r) { return r.dueDate && r.dueDate < t0; });
    var in30 = open.filter(function (r) { return r.dueDate && r.dueDate >= t0 && r.dueDate <= t30; });
    var month = all.filter(function (r) { return r.status === 'collected' && r.collectedAt && r.collectedAt.slice(0, 7) === mStart; });
    var undated = open.filter(function (r) { return !r.dueDate; });
    var asRows = function (rs, dateKey) { return rs.map(function (r) { return { dir: 'in', partyType: 'receivable', partyId: r.id, party: r.from, doc: r.docNo, date: r[dateKey || 'dueDate'], amount: +r.amount, projectId: r.projectId, late: rcvState(r) === 'late' }; }); };
    function k(i, lbl, ex, rs, cls, act, extra) {
      var v = sumOf(asRows(rs));
      return '<section class="isl c3 click ' + (cls === 't-danger' && v > 0 ? 'crit' : '') + '" style="--i:' + i + '" tabindex="0" role="button" data-act="' + act + '"><div class="cap">' + lbl + ' ' + dot(ex, rs.map(function (r) { return fmt(+r.amount); }).slice(0, 6).join(' + ') + (rs.length > 6 ? ' + …' : '') + ' = ' + fmt(v)) + '</div><div class="kpi ' + (v > 0 ? cls : '') + '">' + counted(v) + '</div><div class="meta">' + dg(rs.length) + ' بنداً' + (extra || '') + '</div></section>';
    }
    el.innerHTML = '<div class="ph"><div><h1>التحصيلات</h1><p>ما يستحق لنا من المالك — كل تحصيل مؤرّخ يدخل التدفق النقدي مباشرة</p></div><div class="acts"><button class="btn" data-act="export">تصدير</button><button class="btn primary" data-act="add">إضافة تحصيل</button></div></div>' +
      (undated.length ? '<div class="sec-cash-calls"><div class="sec-cash-call w"><span>' + dg(undated.length) + ' تحصيلاً بلا تاريخ استحقاق (' + money(sumOf(asRows(undated))) + ') — لا يدخل التدفق النقدي.</span></div></div>' : '') +
      '<div class="grid">' + k(0, 'مستحق لنا', 'rOpen', open, '', 'k-open') + k(1, 'متأخر', 'rLate', late, 't-danger', 'k-late') + k(2, 'خلال ٣٠ يوماً', 'r30', in30, 't-warn', 'k-30') + k(3, 'محصّل هذا الشهر', 'rMonth', month, 't-ok', 'k-month') +
      '<section class="isl c12" style="--i:4"><div class="sec-cash-tbl"></div></section></div>';

    var rows = all.slice().sort(function (a, b) { return String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')); }).map(function (r) {
      var st = rcvState(r);
      return Object.assign({}, r, { _st: st, _stl: ST_LBL[st], _proj: projName(r.projectId), amount: +r.amount });
    });
    var host = el.querySelector('.sec-cash-tbl');
    var cols = [
      { key: 'from', label: 'الجهة', sort: true, render: function (r) { return '<b>' + esc(r.from) + '</b>'; } },
      { key: 'docNo', label: 'المستند', sort: true, render: function (r) { return r.docNo ? esc(r.docNo) : '<span class="dash">—</span>'; } },
      { key: '_proj', label: 'المشروع', sort: true, render: function (r) { return esc(r._proj); } },
      { key: 'dueDate', label: 'الاستحقاق', sort: true, render: function (r) { return r.dueDate ? esc(dtxt(r.dueDate)) : '<span class="dash" title="لا يدخل توقع التدفق">بلا تاريخ</span>'; } },
      { key: '_stl', label: 'الحالة', sort: true, render: function (r) {
        if (r._st === 'late') return '<span class="pill d">متأخر <span class="num">' + dg(-off(r.dueDate)) + '</span> يوماً</span>';
        if (r._st === 'collected') return '<span class="pill o">محصّل ' + (r.collectedAt ? esc(dtxt(r.collectedAt)) : '') + '</span>';
        return '<span class="pill ' + (r._st === 'approved' ? 'w' : 'n') + '">' + r._stl + '</span>';
      } },
      { key: 'amount', label: 'المبلغ', num: true, sort: true, render: function (r) { return money(r.amount, r._st === 'collected' ? '' : 't-ok'); } },
      { key: '_a', label: '', render: function (r) { return '<span class="sec-cash-ra">' + (r._st !== 'collected' ? '<button class="btn sm" data-ra="collect" data-id="' + esc(r.id) + '">تحصيل</button>' : '<button class="btn sm" data-ra="uncollect" data-id="' + esc(r.id) + '">إلغاء التحصيل</button>') + '<button class="btn sm" data-ra="edit" data-id="' + esc(r.id) + '" aria-label="تعديل">تعديل</button><button class="btn sm sec-cash-del" data-ra="del" data-id="' + esc(r.id) + '" aria-label="حذف">حذف</button></span>'; } }
    ];
    var filters = [{ key: '_stl', label: 'الحالة', options: ['متأخر', 'قيد الاعتماد', 'معتمد', 'محصّل'] }, { key: '_proj', label: 'المشروع', options: Array.from(new Set(rows.map(function (r) { return r._proj; }))) }];
    if (U().table) {
      host.appendChild(U().table({
        id: 'cash-collections', columns: cols, rows: rows, rowKey: 'id', search: true, searchKeys: ['from', 'docNo', '_proj'], filters: filters,
        total: { label: 'الإجمالي', keys: ['amount'] }, columnMenu: true,
        onRowClick: function (r) { editRcv(get('receivables', r.id)); },
        empty: { title: 'لا توجد تحصيلات بعد', body: 'أضف مستخلصات المالك المنتظرة حتى يظهر الداخل في التدفق النقدي — بدونها يكون صفراً لا تقديراً.', cta: 'إضافة تحصيل', onCta: function () { editRcv(null); } }
      }));
    } else {
      host.innerHTML = '<div class="tbl-wrap"><table><thead><tr>' + cols.map(function (c) { return '<th' + (c.num ? ' class="n"' : '') + '>' + c.label + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.map(function (r) { return '<tr>' + cols.map(function (c) { return '<td' + (c.num ? ' class="n"' : '') + '>' + c.render(r) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table></div>';
    }
    /* تطبيق شريحة حالة إن جئنا من KPI */
    L(el, 'click', function (e) {
      var b = e.target.closest('[data-ra]');
      if (b) {
        e.stopPropagation(); var r = get('receivables', b.dataset.id); if (!r) return;
        if (b.dataset.ra === 'collect') return collect(r);
        if (b.dataset.ra === 'uncollect') { var prev = { status: 'collected', collectedAt: r.collectedAt }; S().update('receivables', r.id, { status: 'approved', collectedAt: null }); return toast('أُلغي التحصيل', { kind: 'info', undo: function () { S().update('receivables', r.id, prev); } }); }
        if (b.dataset.ra === 'edit') return editRcv(r);
        if (b.dataset.ra === 'del') return delRcv(r);
      }
      var ex = e.target.closest('[data-ex]'); if (ex) { e.stopPropagation(); return openExplain(ex.dataset.ex, ex.dataset.sub); }
      var a = e.target.closest('[data-act]'); if (!a) return;
      switch (a.dataset.act) {
        case 'add': return editRcv(null);
        case 'export': {
          var cs = [{ key: 'from', label: 'الجهة' }, { key: 'docNo', label: 'المستند' }, { key: '_proj', label: 'المشروع' }, { key: 'dueDate', label: 'الاستحقاق' }, { key: '_stl', label: 'الحالة' }, { key: 'collectedAt', label: 'تاريخ التحصيل' }, { key: 'amount', label: 'المبلغ' }];
          var csv = S().toCSV ? S().toCSV(rows, cs) : '';
          return U().exportDialog && U().exportDialog({ title: 'التحصيلات', csv: csv, fileName: 'collections.csv' });
        }
        case 'k-open': return breakdown('مستحق لنا', 'كل التحصيلات غير المحصّلة (قيد الاعتماد + معتمد، متأخرة أو لا).', asRows(open));
        case 'k-late': return breakdown('متأخر التحصيل', 'غير محصّل وتاريخ استحقاقه قبل اليوم.', asRows(late));
        case 'k-30': return breakdown('خلال ٣٠ يوماً', 'غير محصّل باستحقاق من اليوم حتى ' + esc(dtxt(t30)) + '.', asRows(in30));
        case 'k-month': return breakdown('محصّل هذا الشهر', 'تاريخ التحصيل داخل الشهر الجاري.', asRows(month, 'collectedAt'));
      }
    });
    L(el, 'keydown', function (e) { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('section[data-act]')) { e.preventDefault(); e.target.click(); } });
    if (params && params.add) { params.add = 0; setTimeout(function () { editRcv(null); }, 30); }
    if (params && params.id) { var r = get('receivables', params.id); params.id = null; if (r) setTimeout(function () { editRcv(r); }, 30); }
    animate(el, first);
  }

  /* ═══ التسجيل ═══ */
  function register() {
    if (!E.shell || !E.shell.register) return false;
    E.shell.register('cash', {
      section: 'cash', tab: 'التدفق النقدي', title: 'التدفق النقدي',
      render: function (c, p) { renderCash(c, p || {}); },
      badge: function () { try { if (!hasBalance()) return 0; return project(30, events(Object.assign({}, prefs, { project: '', parties: 'both' })), []).firstNeg >= 0 ? 1 : 0; } catch (e) { return 0; } }
    });
    E.shell.register('collections', {
      section: 'cash', tab: 'التحصيلات', title: 'التحصيلات',
      render: function (c, p) { renderCollections(c, p || {}); },
      badge: function () { var t0 = iso(today()); return list('receivables').filter(function (r) { return r.status !== 'collected' && r.dueDate && r.dueDate < t0; }).length; }
    });
    return true;
  }
  /* عند تبديل العرض نعيد تشغيل حركة الدخول */
  if (!register()) document.addEventListener('DOMContentLoaded', register);
  E.cash = { events: events, project: project, _V: V, _prefs: prefs };
})();
