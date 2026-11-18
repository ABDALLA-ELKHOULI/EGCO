/* قسم «البيانات» — رفع الملفات · تغطية الكشوفات · النسخ الاحتياطي · المحذوفات · الإعدادات
   يكتب إلى العقد فقط (EGCO.store / EGCO.ui / EGCO.shell). كل نص من المستخدم يمرّ بـ esc. */
(function () {
  'use strict';
  var E = window.EGCO || (window.EGCO = {});
  var VERSION = '0.13.0';
  var AI_KEY = 'egco-proto-ai';

  /* ───────── أدوات عامة ───────── */
  function S() { return E.store; }
  function U() { return E.ui; }
  function esc(s) { return U() && U().esc ? U().esc(s == null ? '' : String(s)) : String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function dg(x) { return U() && U().digits ? U().digits(String(x)) : String(x); }
  function int(n) { return U() && U().int ? U().int(n) : dg(Math.round(n || 0)); }
  function fmt(n) { return U() && U().fmt ? U().fmt(n) : dg((+n || 0).toFixed(2)); }
  function money(n, cls) { return U() && U().money ? U().money(n, cls) : '<span class="num ' + (cls || '') + '">' + fmt(n) + '</span>'; }
  function dateTxt(d, o) { try { return U().dateTxt(d, o); } catch (e) { return esc(String(d || '').slice(0, 10)); } }
  function ago(iso) { try { return U().ago(iso); } catch (e) { return dateTxt(iso); } }
  function toast(t, o) { if (U() && U().toast) U().toast(t, o || {}); }
  function confirmBox(o) { return U() && U().confirm ? U().confirm(o) : Promise.resolve(false); }
  function modal(o) { return U().modal(o); }
  function list(type, withDeleted) { try { return S().list(type, { withDeleted: !!withDeleted }) || []; } catch (e) { return []; } }
  function get(type, id) { try { return S().get(type, id); } catch (e) { return null; } }
  function settings() { var db = S() && S().db; return (db && db.settings) || {}; }
  function today() { return (S() && S().TODAY) || new Date(2026, 10, 17); }
  function daysSince(d) { if (!d) return null; var t = new Date(String(d).length <= 10 ? d + 'T00:00:00' : d); if (isNaN(t)) return null; return Math.max(0, Math.floor((today() - t) / 864e5)); }
  function go(view, params) { if (E.shell && E.shell.go) E.shell.go(view, params || {}); }
  function refresh() { if (E.shell && E.shell.refresh) E.shell.refresh(); }
  function cents(n) { return Math.round((+n || 0) * 100); }
  function sumC(arr, f) { var c = 0; arr.forEach(function (x) { c += cents(f(x)); }); return c / 100; }

  /* حفظ إعداد — العقد لا يعرّف دالة للإعدادات؛ نجرّب ما قد يوفّره core ثم نكتب إلى db مباشرة */
  function setSetting(patch) {
    var s = S();
    if (typeof s.setSettings === 'function') return s.setSettings(patch);
    if (typeof s.updateSettings === 'function') return s.updateSettings(patch);
    if (typeof s.setSetting === 'function') { Object.keys(patch).forEach(function (k) { s.setSetting(k, patch[k]); }); return; }
    s.db.settings = Object.assign({}, s.db.settings || {}, patch);
    persist();
  }
  function persist() {
    var s = S(), done = false;
    ['save', 'persist', 'commit'].forEach(function (f) { if (!done && typeof s[f] === 'function') { try { s[f](); done = true; } catch (e) { } } });
    if (!done) { try { localStorage.setItem('egco-proto-v2', JSON.stringify(s.db)); } catch (e) { } }
    if (typeof s.emit === 'function') { try { s.emit('change'); return; } catch (e) { } }
    refresh();
  }
  function applyTheme(t) {
    var r = document.documentElement;
    if (t === 'light' || t === 'dark') r.setAttribute('data-theme', t); else r.removeAttribute('data-theme');
  }
  function copyText(text, ta) {
    function fallback() { try { if (ta) { ta.focus(); ta.select(); } var ok = document.execCommand && document.execCommand('copy'); toast(ok ? 'نُسخ النص' : 'حدِّد النص وانسخه يدوياً', { kind: ok ? 'ok' : 'info' }); } catch (e) { toast('حدِّد النص وانسخه يدوياً', { kind: 'info' }); } }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast('نُسخ النص', { kind: 'ok' }); }, fallback); return; } } catch (e) { }
    fallback();
  }
  function aiLoad() { try { return JSON.parse(localStorage.getItem(AI_KEY) || '{}') || {}; } catch (e) { return aiMem; } }
  var aiMem = {};
  function aiSave(v) { aiMem = v; try { localStorage.setItem(AI_KEY, JSON.stringify(v)); } catch (e) { } }

  /* جدول: يستعمل ui.table إن وُجد، وإلا جدولاً بسيطاً */
  function table(opts) {
    if (U() && typeof U().table === 'function') return U().table(opts);
    var w = document.createElement('div'); w.className = 'tbl-wrap';
    if (!opts.rows.length) { w.innerHTML = '<p class="cap sec-data-pad">' + esc((opts.empty && opts.empty.title) || 'لا شيء') + '</p>'; return w; }
    w.innerHTML = '<table><thead><tr>' + opts.columns.map(function (c) { return '<th' + (c.num ? ' class="n"' : '') + '>' + esc(c.label) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      opts.rows.map(function (r) { return '<tr>' + opts.columns.map(function (c) { return '<td' + (c.num ? ' class="n"' : '') + '>' + (c.render ? c.render(r) : esc(r[c.key])) + '</td>'; }).join('') + '</tr>'; }).join('') + '</tbody></table>';
    return w;
  }
  function mount(el, node) { if (!el) return; el.innerHTML = ''; if (typeof node === 'string') el.innerHTML = node; else if (node) el.appendChild(node); }
  function sw(on, act, label) { return '<button type="button" class="sw" role="switch" aria-checked="' + (on ? 'true' : 'false') + '" data-dact="' + act + '" aria-label="' + esc(label) + '"><i></i></button>'; }
  function seg(items, cur, act) { return '<div class="seg" role="group">' + items.map(function (it) { return '<button type="button" aria-pressed="' + (it[0] === cur) + '" data-dact="' + act + '" data-v="' + esc(it[0]) + '">' + esc(it[1]) + '</button>'; }).join('') + '</div>'; }
  function chips(items, cur, act) { return '<div class="filters">' + items.map(function (it) { return '<button type="button" class="chip" aria-pressed="' + (it[0] === cur) + '" data-dact="' + act + '" data-v="' + esc(it[0]) + '">' + it[1] + '</button>'; }).join('') + '</div>'; }
  function ph(title, sub, acts) { return '<div class="ph"><div><h1>' + title + '</h1><p>' + sub + ' <span class="sample">بيانات مثال</span></p></div><div class="acts">' + (acts || '') + '</div></div>'; }
  function partyOf(type, id) {
    if (!id) return null;
    if (type === 'contractor' || type === 'contractors') { var c = get('contractors', id); return c ? { view: 'contractor', id: id, name: c.name, acc: c.code } : null; }
    var s = get('suppliers', id); return s ? { view: 'supplier', id: id, name: s.name, acc: s.account } : null;
  }
  function partyLink(p) { return p ? '<button type="button" class="lnk" data-dact="go" data-view="' + p.view + '" data-id="' + esc(p.id) + '">' + esc(p.name) + '</button>' : '<span class="dash">—</span>'; }

  /* ───────── تحليل CSV (للمعاينة المحلية: تصنيف الحسابات المجهولة + أرصدة قبل/بعد) ───────── */
  var AR_DIG = '٠١٢٣٤٥٦٧٨٩';
  function latinDigits(s) { return String(s == null ? '' : s).replace(/[٠-٩]/g, function (c) { return AR_DIG.indexOf(c); }); }
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    var first = text.split(/\r?\n/)[0] || '', delim = ',';
    if ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length) delim = ';';
    if ((first.match(/\t/g) || []).length > (first.match(new RegExp(delim === ',' ? ',' : ';', 'g')) || []).length) delim = '\t';
    var rows = [], row = [], f = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; continue; }
      if (ch === '"') q = true; else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    rows = rows.filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    return { rows: rows, delim: delim };
  }
  var HEAD = { account: ['account', 'الحساب', 'رقم الحساب', 'حساب'], name: ['name', 'الاسم', 'اسم الحساب'], date: ['date', 'التاريخ'], doc: ['doc', 'المستند', 'رقم المستند'], description: ['description', 'البيان', 'الوصف'], debit: ['debit', 'مدين'], credit: ['credit', 'دائن'] };
  function headerMap(h) {
    var m = {};
    h.forEach(function (c, i) { var k = String(c).trim().toLowerCase(); Object.keys(HEAD).forEach(function (key) { if (m[key] == null && HEAD[key].indexOf(k) >= 0) m[key] = i; }); });
    return m;
  }
  function num(v) { var n = parseFloat(latinDigits(v).replace(/[,\s٬]/g, '').replace('٫', '.')); return isNaN(n) ? 0 : n; }
  function normDate(v) {
    var s = latinDigits(v).trim(), m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
    if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})/))) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
    return s;
  }
  function analyzeRows(text) {
    var p = parseCSV(text); if (!p.rows.length) return { ok: false, rows: [], p: p };
    var m = headerMap(p.rows[0]); if (m.account == null) return { ok: false, rows: [], p: p, m: m };
    var rows = p.rows.slice(1).map(function (r, i) {
      return { line: i + 2, account: latinDigits(r[m.account] || '').trim(), name: (r[m.name] || '').trim(), date: normDate(r[m.date] || ''), doc: (r[m.doc] || '').trim(), description: (r[m.description] || '').trim(), debit: num(r[m.debit]), credit: num(r[m.credit]) };
    });
    return { ok: true, rows: rows, p: p, m: m };
  }
  function prefixOf(acc) { var a = String(acc || ''); return ['211', '212', '216'].filter(function (x) { return a.indexOf(x) === 0; })[0] || null; }
  function classes() { return settings().accountClasses || {}; }
  function unknownAccounts(text) {
    var a = analyzeRows(text); if (!a.ok) return [];
    var cl = classes(), seen = {};
    a.rows.forEach(function (r) { if (!r.account || prefixOf(r.account) || cl[r.account]) return; (seen[r.account] = seen[r.account] || { account: r.account, name: r.name, count: 0 }).count++; });
    return Object.keys(seen).map(function (k) { return seen[k]; });
  }
  /* يطبّق التصنيفات المحفوظة: حساب مجهول صُنِّف 211 يُمرَّر كـ «211» + رقمه (ثابت عبر كل رفع لاحق)؛ «تجاهل» يحذف صفوفه */
  function applyClasses(text, ignore) {
    var a = analyzeRows(text); if (!a.ok) return text;
    var cl = classes(), changed = false, ai = a.m.account, out = [a.p.rows[0]];
    a.p.rows.slice(1).forEach(function (r) {
      var acc = latinDigits(r[ai] || '').trim();
      if (!prefixOf(acc) && ignore && ignore[acc]) { changed = true; return; }
      if (!prefixOf(acc) && cl[acc] && cl[acc] !== 'ignore') { r = r.slice(); r[ai] = cl[acc] + acc; changed = true; }
      else if (cl[acc] === 'ignore') { changed = true; return; }
      out.push(r);
    });
    if (!changed) return text;
    return out.map(function (r) { return r.map(function (c) { c = String(c == null ? '' : c); return /[",;\n\t]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
  }
  function kindOf(rows) {
    var k = {}; rows.forEach(function (r) { var p = prefixOf(r.account); if (p) k[p] = 1; });
    var ks = Object.keys(k);
    if (ks.length > 1) return { key: 'mixed', label: 'كشف مجمّع' };
    return { '211': { key: 'supplier', label: 'كشف حساب مورد' }, '212': { key: 'contractor', label: 'كشف حساب مقاول' }, '216': { key: 'guarantee', label: 'كشف حساب ضمان (216)' } }[ks[0]] || { key: 'unknown', label: 'غير معروف' };
  }
  /* رصيد قبل → بعد لكل طرف، مع تخطّي ما يطابق حركة محفوظة سابقاً */
  function balances(text) {
    var a = analyzeRows(text), out = {}; if (!a.ok) return out;
    var sups = list('suppliers'), cons = list('contractors');
    var invs = list('invoices'), pays = list('payments'), ents = list('contractorEntries');
    a.rows.forEach(function (r) {
      var p = prefixOf(r.account); if (!p) return;
      var o = out[r.account];
      if (!o) {
        o = out[r.account] = { account: r.account, name: r.name, type: p, before: 0, delta: 0, entity: null };
        if (p === '211') { var s = sups.filter(function (x) { return x.account === r.account; })[0]; if (s) { o.entity = s; try { o.before = S().supplierPosition(s.id).open; } catch (e) { } } }
        if (p === '212') { var c = cons.filter(function (x) { return x.code === r.account; })[0]; if (c) { o.entity = c; try { o.before = S().contractorPosition(c.id).balance; } catch (e) { } } }
      }
      var dup = false;
      if (p === '211' && o.entity) {
        if (r.credit) dup = invs.some(function (x) { return x.supplierId === o.entity.id && x.date === r.date && cents(x.amount) === cents(r.credit) && String(x.no || '') === r.doc; });
        else dup = pays.some(function (x) { return x.supplierId === o.entity.id && x.date === r.date && cents(x.amount) === cents(r.debit) && String(x.doc || '') === r.doc; });
      }
      if (p === '212' && o.entity) dup = ents.some(function (x) { return x.contractorId === o.entity.id && x.date === r.date && cents(x.debit) === cents(r.debit) && cents(x.credit) === cents(r.credit); });
      if (dup) return;
      if (p === '211') o.delta = (cents(o.delta) + cents(r.credit) - cents(r.debit)) / 100;
      if (p === '212') o.delta = (cents(o.delta) + cents(r.debit) - cents(r.credit)) / 100;
    });
    return out;
  }
  function errText(e) {
    if (typeof e === 'string') return esc(e);
    var row = e.row != null ? e.row : (e.line != null ? e.line : e.index);
    return (row != null ? 'سطر <span class="num">' + dg(row) + '</span>: ' : '') + esc(e.message || e.msg || e.error || e.reason || JSON.stringify(e));
  }

  /* ───────── حالة الاستيراد (تعيش خارج الرسم لأن العرض يُعاد رسمه عند كل change) ───────── */
  var IMP = { step: 'pick', files: [], prog: null, result: null, hist: { kind: 'all', status: 'all', range: 'all' }, seq: 0 };

  function addFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || []);
    if (!arr.length) return;
    if (IMP.step === 'result' || IMP.step === 'progress') { if (IMP.step === 'progress') { toast('انتظر حتى ينتهي الحفظ الجاري', { kind: 'info' }); return; } IMP.files = []; IMP.result = null; }
    IMP.step = 'preview';
    var pending = 0;
    arr.forEach(function (file) {
      var ext = (file.name.split('.').pop() || '').toLowerCase();
      var f = { id: 'f' + (++IMP.seq), name: file.webkitRelativePath || file.name, size: file.size, ext: ext, status: 'reading', ignore: {} };
      IMP.files.push(f);
      if (['csv', 'txt'].indexOf(ext) < 0) {
        f.status = 'unsupported';
        f.kind = { pdf: 'كشف PDF', xlsx: 'ملف Excel', xls: 'ملف Excel قديم', xlsm: 'ملف Excel' }[ext] || 'صيغة غير معروفة';
        return;
      }
      pending++;
      readText(file, function (text, err) {
        if (err) { f.status = 'error'; f.errors = ['تعذّرت القراءة: ' + err]; } else { f.text = text; analyze(f); }
        pending--; if (!pending) refreshView();
      });
    });
    refreshView();
  }
  function readText(file, cb) {
    try {
      var r = new FileReader();
      r.onload = function () {
        var t = String(r.result || '');
        if ((t.match(/\uFFFD/g) || []).length > 3) { var r2 = new FileReader(); r2.onload = function () { cb(String(r2.result || '')); }; r2.onerror = function () { cb(t); }; try { r2.readAsText(file, 'windows-1256'); } catch (e) { cb(t); } return; }
        cb(t);
      };
      r.onerror = function () { cb(null, 'خطأ قراءة'); };
      r.readAsText(file, 'utf-8');
    } catch (e) { cb(null, e.message); }
  }
  function addSample() {
    var t = ''; try { t = S().sampleCSV(); } catch (e) { toast('تعذّر توليد ملف المثال', { kind: 'error' }); return; }
    if (IMP.step === 'result') { IMP.files = []; IMP.result = null; }
    IMP.step = 'preview';
    var f = { id: 'f' + (++IMP.seq), name: 'كشف-مثال-' + dg(IMP.seq) + '.csv', size: t.length, ext: 'csv', text: t, ignore: {} };
    IMP.files.push(f); analyze(f); refreshView();
  }
  function analyze(f) {
    f.unknown = unknownAccounts(f.text).filter(function (u) { return !f.ignore[u.account]; });
    var a = analyzeRows(f.text);
    f.kind = a.ok ? kindOf(a.rows).label : 'غير معروف';
    if (f.unknown.length) { f.status = 'needs-class'; f.preview = null; return; }
    var text = applyClasses(f.text, f.ignore);
    try { f.preview = S().previewCSV(text); } catch (e) { f.preview = null; f.status = 'error'; f.errors = [e.message || 'تعذّر تحليل الملف']; return; }
    f.text2 = text;
    f.bal = balances(text);
    f.errors = (f.preview && f.preview.errors) || [];
    var parties = (f.preview && f.preview.parties) || [];
    f.added = parties.reduce(function (s, p) { return s + (+p.added || 0); }, 0);
    f.dupes = parties.reduce(function (s, p) { return s + (+p.dupes || 0); }, 0);
    if (!parties.length) { f.status = 'error'; if (!f.errors.length) f.errors = [a.ok ? 'لم نجد صفوفاً صالحة في الملف' : 'لم نتعرّف على أعمدة الملف (نحتاج: الحساب، الاسم، التاريخ، المستند، البيان، مدين، دائن)']; return; }
    f.status = f.added ? 'ready' : 'nothing';
  }
  function reanalyzeAll() { IMP.files.forEach(function (f) { if (f.text && ['needs-class', 'ready', 'nothing', 'error'].indexOf(f.status) >= 0) analyze(f); }); }
  function refreshView() { if (E.shell && E.shell.current && (E.shell.current().view || E.shell.current()) === 'import') refresh(); else refresh(); }

  /* لقطة لحساب «ماذا تغيّر» بدقة: كل فاتورة مفتوحة ومتأخرة قبل/بعد */
  function snapshot() {
    var t = {}; try { t = S().totals(); } catch (e) { }
    var inv = {};
    list('suppliers').forEach(function (s) { try { (S().supplierPosition(s.id).invoices || []).forEach(function (i) { inv[i.id] = { rem: i.remaining, late: i.lateDays > 0, sid: s.id, amount: i.amount }; }); } catch (e) { } });
    return { totals: t, inv: inv };
  }
  function commitAll() {
    var ready = IMP.files.filter(function (f) { return f.status === 'ready'; });
    if (!ready.length) return;
    IMP.step = 'progress'; IMP.prog = { idx: 0, n: ready.length, pct: 0, file: ready[0].name };
    var before = snapshot(), results = [];
    refreshView();
    (function next(i) {
      if (i >= ready.length) { finish(before, results); return; }
      IMP.prog = { idx: i, n: ready.length, pct: 0, file: ready[i].name }; paintProg();
      commitOne(ready[i]).then(function (d) { ready[i].status = d && d.error ? 'failed' : 'done'; ready[i].importId = d && d.importId; if (d && d.error) ready[i].errors = [d.error]; results.push({ f: ready[i], d: d }); next(i + 1); });
    })(0);
  }
  function commitOne(f) {
    return new Promise(function (res) {
      var done = false, t;
      function h(d) { if (done) return; done = true; try { S().off('import:done', h); } catch (e) { } clearTimeout(t); res(d || {}); }
      try { S().on('import:done', h); } catch (e) { }
      t = setTimeout(function () { h({}); }, 15000);
      try { var r = S().commitImport(f.preview, { fileName: f.name }); if (r && typeof r.then === 'function') r.then(function (v) { if (v && v.importId) h(v); }, function (e) { h({ error: (e && e.message) || 'تعذّر الحفظ' }); }); }
      catch (e) { h({ error: e.message || 'تعذّر الحفظ' }); }
    });
  }
  function finish(before, results) {
    var after = snapshot(), b = before.totals || {}, a = after.totals || {};
    var newInv = [], paid = [], newLate = [], touched = {};
    Object.keys(after.inv).forEach(function (id) {
      var x = after.inv[id], y = before.inv[id];
      if (!y) { newInv.push(x); touched[x.sid] = 1; }
      else if (x.late && !y.late) { newLate.push(x); touched[x.sid] = 1; }
    });
    Object.keys(before.inv).forEach(function (id) { var y = before.inv[id], x = after.inv[id]; if (y.rem > 0 && (!x || x.rem <= 0)) { paid.push(y); touched[y.sid] = 1; } else if (x && cents(x.rem) !== cents(y.rem)) touched[y.sid] = 1; });
    var parties = [];
    results.forEach(function (r) { Object.keys(r.f.bal || {}).forEach(function (acc) { var o = r.f.bal[acc]; var ent = o.type === '211' ? list('suppliers').filter(function (s) { return s.account === acc; })[0] : (o.type === '212' ? list('contractors').filter(function (c) { return c.code === acc; })[0] : null); if (ent && !parties.some(function (p) { return p.id === ent.id; })) parties.push({ id: ent.id, view: o.type === '211' ? 'supplier' : 'contractor', name: ent.name, before: o.before, after: o.type === '211' ? S().supplierPosition(ent.id).open : S().contractorPosition(ent.id).balance, type: o.type }); }); });
    IMP.result = {
      files: results.map(function (r) { return { name: r.f.name, ok: r.f.status === 'done', added: r.f.added, dupes: r.f.dupes, errors: r.f.errors }; }),
      before: b, after: a, newInv: newInv, paid: paid, newLate: newLate, parties: parties
    };
    IMP.step = 'result'; IMP.prog = null; refreshView();
  }
  function paintProg() {
    var el = document.querySelector('.sec-data [data-prog]'); if (!el || !IMP.prog) return;
    var p = IMP.prog, overall = Math.round(((p.idx + (p.pct || 0) / 100) / p.n) * 100);
    el.querySelector('i').style.transform = 'scaleX(' + (overall / 100) + ')';
    var t = el.parentNode.querySelector('[data-prog-t]'); if (t) t.innerHTML = 'جارٍ حفظ «' + esc(p.file) + '» · ملف <span class="num">' + dg(p.idx + 1) + '</span> من <span class="num">' + dg(p.n) + '</span> · <span class="num">' + dg(overall) + '%</span>';
  }

  function statusPill(f) {
    return {
      reading: '<span class="pill n">جارٍ القراءة…</span>', 'needs-class': '<span class="pill w">يحتاج تصنيفاً</span>', ready: '<span class="pill o">جاهز للحفظ</span>',
      nothing: '<span class="pill n">مكرر — سبق رفعه</span>', error: '<span class="pill w">تعذّرت القراءة</span>', unsupported: '<span class="pill n">غير مدعوم في النموذج</span>',
      done: '<span class="pill o">حُفظ</span>', failed: '<span class="pill w">تعذّر الحفظ</span>'
    }[f.status] || '';
  }
  function balCell(o) {
    if (!o) return '<span class="dash">—</span>';
    if (o.type === '216') return '<span class="cap">ضمان — يُدار من شاشته</span>';
    var after = (cents(o.before) + cents(o.delta)) / 100;
    var word = function (v) { return o.type === '212' ? (v < 0 ? 'نحن ندين لهم' : (v > 0 ? 'مدين لنا' : '')) : ''; };
    return money(o.before) + ' <span class="cap">' + word(o.before) + '</span> <span class="arr">←</span> <b>' + money(after) + '</b> <span class="cap">' + word(after) + '</span>' +
      (o.delta ? ' <span class="delta-chip ' + (o.delta > 0 ? 'up' : 'down') + '">' + (o.delta > 0 ? '+' : '−') + fmt(Math.abs(o.delta)).replace(/^[−-]/, '') + '</span>' : '');
  }
  function fileCard(f, i) {
    var h = '<article class="fcard" style="--i:' + i + '"><header><div><b class="fname">' + esc(f.name) + '</b><div class="cap">' + esc(f.kind || '') + (f.size ? ' · <span class="num">' + dg(Math.max(1, Math.round(f.size / 1024))) + '</span> ك.ب' : '') + '</div></div><div class="fact">' + statusPill(f) +
      (IMP.step === 'preview' ? '<button type="button" class="btn sm" data-dact="imp-drop" data-id="' + f.id + '" aria-label="إزالة الملف من القائمة">إزالة</button>' : '') + '</div></header>';
    if (f.status === 'unsupported') h += '<p class="note">النموذج يقرأ ملفات CSV فقط. التطبيق الحقيقي يقرأ PDF وExcel (xlsx/xls) ويكتشف نوع الكشف تلقائياً — هنا صدِّر الكشف CSV أو جرّب ملف المثال.</p>';
    if (f.status === 'needs-class') {
      h += '<p class="note">حساب جديد لم نره من قبل — بادئته ليست 211 (مورد) ولا 212 (مقاول) ولا 216 (ضمان). صنّفه مرة واحدة ونتذكّر التصنيف لكل رفع قادم.</p><ul class="cls">' +
        f.unknown.map(function (u) {
          return '<li><div><b>' + esc(u.name || 'بلا اسم') + '</b><div class="cap">حساب <span class="num">' + esc(dg(u.account)) + '</span> · <span class="num">' + dg(u.count) + '</span> حركة</div></div><div class="seg" role="group" aria-label="تصنيف الحساب">' +
            [['211', 'مورد 211'], ['212', 'مقاول 212'], ['216', 'ضمان 216']].map(function (o) { return '<button type="button" aria-pressed="false" data-dact="imp-class" data-acc="' + esc(u.account) + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') +
            '<button type="button" aria-pressed="false" data-dact="imp-ignore" data-fid="' + f.id + '" data-acc="' + esc(u.account) + '">تجاهل</button></div></li>';
        }).join('') + '</ul>';
    }
    if (f.preview && f.preview.parties && f.preview.parties.length) {
      var rows = f.preview.parties.map(function (p) {
        var o = (f.bal || {})[p.account]; var ent = o && o.entity;
        return '<tr><td><b>' + (ent ? partyLink({ view: o.type === '212' ? 'contractor' : 'supplier', id: ent.id, name: ent.name }) : esc(p.name)) + '</b><div class="cap num">' + esc(dg(p.account)) + '</div></td><td>' + (p.isNew ? '<span class="pill w">جديد</span>' : '<span class="pill n">موجود</span>') + '</td><td class="n"><span class="num">' + dg(p.added || 0) + '</span></td><td class="n"><span class="num">' + dg(p.dupes || 0) + '</span></td><td class="n">' + balCell(o) + '</td></tr>';
      }).join('');
      h += '<div class="tbl-wrap"><table><thead><tr><th>الطرف</th><th>الحالة</th><th class="n">يُضاف</th><th class="n">مطابق مسبقاً (يُتخطّى)</th><th class="n">الرصيد قبل ← بعد</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
      h += '<p class="cap sumline">الإجمالي: <span class="num">' + dg(f.added || 0) + '</span> حركة تُضاف · <span class="num">' + dg(f.dupes || 0) + '</span> مطابقة لحركات محفوظة سابقاً لن تُكرَّر</p>';
    }
    if (f.errors && f.errors.length) {
      h += '<details class="errs"' + (f.status === 'error' ? ' open' : '') + '><summary><span class="num">' + dg(f.errors.length) + '</span> ' + (f.status === 'error' ? 'سبب التعذّر' : 'صفوف استُبعدت من الحفظ') + '</summary><ul>' + f.errors.slice(0, 50).map(function (e) { return '<li>' + errText(e) + '</li>'; }).join('') + '</ul></details>';
      if (f.status === 'error') h += '<div class="rowacts"><button type="button" class="btn sm" data-dact="imp-ai" data-id="' + f.id + '">محاولة القراءة بالذكاء الاصطناعي</button></div>';
    }
    return h + '</article>';
  }

  function renderImport(root) {
    var ready = IMP.files.filter(function (f) { return f.status === 'ready'; });
    var html = ph('رفع الملفات', 'كشوف حساب CSV — يُعرض ما سيتغيّر قبل الحفظ، وتؤخذ نسخة احتياطية قبل كل استيراد', '<button type="button" class="btn" data-dact="imp-sample">جرّب بملف مثال</button><button type="button" class="btn primary" data-dact="imp-pick">اختيار ملفات</button>') + '<div class="grid">';
    if (IMP.step !== 'progress') {
      html += '<section class="isl c12" style="--i:0"><div class="drop" data-drop tabindex="0" role="button" aria-label="اسحب الملفات هنا أو اضغط للاختيار"><b>اسحب الملفات هنا أو اضغط للاختيار</b><span class="cap">يمكن تحديد أكثر من ملف أو مجلد كامل · CSV في النموذج (التطبيق الحقيقي: PDF وExcel أيضاً)</span></div>' +
        '<div class="pickrow"><button type="button" class="btn sm" data-dact="imp-folder">اختيار مجلد كامل</button><span class="cap">الأعمدة: الحساب، الاسم، التاريخ، المستند، البيان، مدين، دائن</span></div>' +
        '<input type="file" multiple accept=".csv,.txt,.pdf,.xlsx,.xls" hidden data-in="files"><input type="file" multiple webkitdirectory hidden data-in="folder"></section>';
    }
    if (IMP.step === 'preview' && IMP.files.length) {
      var blocked = IMP.files.filter(function (f) { return f.status === 'needs-class'; }).length;
      html += '<section class="isl c12" style="--i:1"><div class="ih"><h2>المعاينة — لم يُحفظ شيء بعد</h2><span class="cap"><span class="num">' + dg(IMP.files.length) + '</span> ملف</span></div><div class="fcards">' + IMP.files.map(fileCard).join('') + '</div>' +
        '<div class="confirmbar"><div class="cap">' + (blocked ? 'صنّف الحسابات الجديدة أولاً — ' : '') + (ready.length ? 'سيُحفظ <span class="num">' + dg(ready.length) + '</span> ملف · <span class="num">' + dg(ready.reduce(function (s, f) { return s + f.added; }, 0)) + '</span> حركة جديدة · نسخة احتياطية «قبل الاستيراد» تؤخذ تلقائياً' : 'لا شيء جديد للحفظ') + '</div>' +
        '<div class="acts"><button type="button" class="btn" data-dact="imp-clear">مسح الكل</button><button type="button" class="btn primary" data-dact="imp-commit"' + (ready.length ? '' : ' disabled aria-disabled="true"') + '>حفظ</button></div></div></section>';
    }
    if (IMP.step === 'progress' && IMP.prog) {
      html += '<section class="isl c12" style="--i:0"><div class="ih"><h2>جارٍ الحفظ</h2><span class="cap">تابع التقدم في الجزيرة أعلى الشاشة</span></div><div class="pbar" data-prog><i></i></div><p class="cap" data-prog-t></p></section>';
    }
    if (IMP.step === 'result' && IMP.result) html += resultCard(IMP.result);
    html += '<section class="isl c12" style="--i:3"><div class="ih"><h2>سجل الاستيراد</h2><span class="cap">الأحدث أولاً</span></div><div data-hist-f></div><div data-hist></div></section></div>';
    root.innerHTML = html;
    if (IMP.step === 'progress') paintProg();
    renderHistory(root);
    var drop = root.querySelector('[data-drop]');
    if (drop) {
      ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
      ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
      drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer && e.dataTransfer.files); });
      drop.addEventListener('click', function () { var i = root.querySelector('[data-in="files"]'); if (i) i.click(); });
      drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); drop.click(); } });
    }
    root.querySelectorAll('input[type=file]').forEach(function (inp) { inp.addEventListener('change', function () { addFiles(inp.files); inp.value = ''; }); });
  }
  function deltaCard(label, b, a, worseWhenUp, isMoney) {
    var d = (cents(a) - cents(b)) / 100, bad = worseWhenUp ? d > 0 : d < 0;
    return '<div class="chg-card"><div class="cap">' + label + '</div><div class="kpi ' + (d ? 'chg ' + (bad ? 'flash-bad' : 'flash-good') : '') + '">' + (isMoney ? (d ? (d > 0 ? '+' : '−') + fmt(Math.abs(d)).replace(/^[−-]/, '') : '<span class="num">' + fmt(0) + '</span>') : '<span class="num">' + dg(d) + '</span>') + '</div><div class="cap">كان ' + (isMoney ? fmt(b) : dg(b)) + ' ← صار ' + (isMoney ? fmt(a) : dg(a)) + '</div></div>';
  }
  function resultCard(r) {
    var ok = r.files.filter(function (f) { return f.ok; }).length, failed = r.files.length - ok;
    var newAmt = sumC(r.newInv, function (x) { return x.amount; }), paidAmt = sumC(r.paid, function (x) { return x.rem; });
    var h = '<section class="isl c12" style="--i:1"><div class="ih"><h2>ماذا تغيّر</h2><span class="cap">نتيجة الرفع · <span class="num">' + dg(ok) + '</span> ملف حُفظ' + (failed ? ' · <span class="num">' + dg(failed) + '</span> تعذّر' : '') + '</span></div>';
    h += '<div class="changes">' +
      deltaCard('المديونية المفتوحة للموردين', r.before.supplierOpen || 0, r.after.supplierOpen || 0, true, true) +
      deltaCard('المتأخر', r.before.supplierOverdue || 0, r.after.supplierOverdue || 0, true, true) +
      deltaCard('المديونية المفتوحة للمقاولين', r.before.contractorOwed || 0, r.after.contractorOwed || 0, true, true) + '</div>';
    h += '<div class="changes mt">' +
      '<div class="chg-card"><div class="cap">فواتير جديدة</div><div class="kpi"><span class="num">' + dg(r.newInv.length) + '</span></div><div class="cap">' + money(newAmt) + '</div></div>' +
      '<div class="chg-card"><div class="cap">سُدّدت بالكامل</div><div class="kpi t-ok"><span class="num">' + dg(r.paid.length) + '</span></div><div class="cap">' + money(paidAmt) + '</div></div>' +
      '<div class="chg-card"><div class="cap">صار متأخراً</div><div class="kpi ' + (r.newLate.length ? 't-danger' : '') + '"><span class="num">' + dg(r.newLate.length) + '</span></div><div class="cap">بعد احتساب الحركات الجديدة</div></div></div>';
    if (r.parties.length) h += '<div class="affected"><span class="cap">الأطراف المتأثرة:</span> ' + r.parties.map(function (p) { return partyLink(p) + ' <span class="cap">' + fmt(p.before) + ' ← ' + fmt(p.after) + '</span>'; }).join(' · ') + '</div>';
    r.files.forEach(function (f) { if (!f.ok && f.errors && f.errors.length) h += '<p class="note">«' + esc(f.name) + '»: ' + errText(f.errors[0]) + '</p>'; });
    h += '<div class="rowacts"><button type="button" class="btn primary" data-dact="go" data-view="today">افتح اليوم لترى الأثر</button><button type="button" class="btn" data-dact="imp-again">رفع ملفات أخرى</button></div></section>';
    return h;
  }
  var KIND_LBL = { supplier: 'كشف حساب مورد', contractor: 'كشف حساب مقاول', guarantee: 'كشف ضمان (216)', mixed: 'كشف مجمّع', csv: 'كشف CSV' };
  function renderHistory(root) {
    var all = list('imports').slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    var hs = IMP.hist, kinds = {};
    all.forEach(function (r) { kinds[r.kind || r.partyType || 'other'] = 1; });
    var fEl = root.querySelector('[data-hist-f]');
    fEl.innerHTML = '<div class="hfilters">' +
      chips([['all', 'كل الأنواع']].concat(Object.keys(kinds).map(function (k) { return [k, esc(KIND_LBL[k] || k)]; })), hs.kind, 'hist-kind') +
      chips([['all', 'كل الحالات'], ['ok', 'تمّ'], ['failed', 'فشل']], hs.status, 'hist-status') +
      chips([['all', 'كل التواريخ'], ['7', 'آخر ٧ أيام'], ['30', 'آخر ٣٠ يوماً'], ['90', 'آخر ٩٠ يوماً']], hs.range, 'hist-range') + '</div>';
    var rows = all.filter(function (r) {
      if (hs.kind !== 'all' && (r.kind || r.partyType || 'other') !== hs.kind) return false;
      if (hs.status !== 'all' && (r.status || 'ok') !== hs.status) return false;
      if (hs.range !== 'all') { var d = daysSince(r.at); if (d == null || d > +hs.range) return false; }
      return true;
    }).map(function (r) { var p = partyOf(r.partyType, r.partyId); return Object.assign({}, r, { _party: p, partyName: p ? p.name : '', kindLbl: KIND_LBL[r.kind] || r.kind || '' }); });
    var filtered = hs.kind !== 'all' || hs.status !== 'all' || hs.range !== 'all';
    mount(root.querySelector('[data-hist]'), table({
      id: 'data-imports', rowKey: 'id', rows: rows, search: true, searchKeys: ['file', 'partyName', 'kindLbl'],
      columns: [
        { key: 'at', label: 'التاريخ', sort: true, render: function (r) { return dateTxt(r.at) + '<div class="cap">' + esc(ago(r.at)) + '</div>'; } },
        { key: 'file', label: 'الملف', sort: true, render: function (r) { return '<b>' + esc(r.file || 'بلا اسم') + '</b>'; } },
        { key: 'kindLbl', label: 'النوع', sort: true, render: function (r) { return esc(r.kindLbl); } },
        { key: 'partyName', label: 'الطرف المرتبط', sort: true, render: function (r) { return partyLink(r._party); } },
        { key: 'added', label: 'مضاف', num: true, sort: true, render: function (r) { return '<span class="num">' + dg(r.added || 0) + '</span>'; } },
        { key: 'matched', label: 'مطابق مسبقاً', num: true, sort: true, render: function (r) { return '<span class="num">' + dg(r.matched || 0) + '</span>'; } },
        { key: 'status', label: 'الحالة', sort: true, render: function (r) { return r.status === 'failed' ? '<span class="pill d" title="' + esc(r.error || '') + '">فشل</span>' + (r.error ? '<div class="cap">' + esc(r.error) + '</div>' : '') : '<span class="pill o">تمّ</span>'; } },
        { key: '_a', label: '', render: function (r) { return '<button type="button" class="btn sm" data-dact="imp-del" data-id="' + esc(r.id) + '">حذف حركاته</button>'; } }
      ],
      empty: filtered ? { title: 'لا نتائج مطابقة', body: 'لم تطابق التصفية أي ملف مرفوع.', cta: 'مسح التصفية', onCta: function () { IMP.hist = { kind: 'all', status: 'all', range: 'all' }; refresh(); } }
        : { title: 'لا ملفات مرفوعة بعد', body: 'ابدأ برفع كشف حساب ليظهر هنا.', cta: 'جرّب بملف مثال', onCta: addSample }
    }));
  }
  var ROW_TYPES = ['invoices', 'payments', 'contractorEntries', 'guarantees', 'budgetMonths'];
  function deleteImport(id) {
    var imp = get('imports', id); if (!imp) return;
    var rows = []; ROW_TYPES.forEach(function (t) { list(t).forEach(function (r) { if (r.importId === id) rows.push([t, r.id]); }); });
    confirmBox({ title: 'تأكيد حذف ملف مستورد', danger: true, confirmLabel: 'حذف حركات هذا الملف', body: 'ستُنقل <b>' + dg(rows.length) + '</b> حركة جاءت من «' + esc(imp.file || '') + '» إلى المحذوفات مع سجل الاستيراد نفسه. الأرصدة تُحسب من جديد فوراً، وتستطيع الاسترجاع من «المحذوفات» في أي وقت.' }).then(function (ok) {
      if (!ok) return;
      rows.forEach(function (x) { try { S().remove(x[0], x[1]); } catch (e) { } });
      try { S().remove('imports', id); } catch (e) { }
      toast('حُذفت ' + dg(rows.length) + ' حركة — في المحذوفات', { kind: 'ok', undo: function () { try { S().restore('imports', id); } catch (e) { } rows.forEach(function (x) { try { S().restore(x[0], x[1]); } catch (e) { } }); } });
    });
  }
  function aiRescue(f) {
    var ai = aiLoad();
    modal({
      title: 'محاولة القراءة بالذكاء الاصطناعي', size: 'md',
      body: '<div class="sec-data"><p>حين يفشل القارئ العادي في فهم ملف (أعمدة بأسماء غير مألوفة، كشف ممسوح ضوئياً)، يرسل التطبيق الحقيقي الملف إلى مساعد قراءة الملفات المضبوط في الإعدادات ليستخرج الحركات، ثم يعرضها عليك للمعاينة والمطابقة مع الرصيد قبل أي حفظ.</p>' +
        (ai.enabled ? '<p class="note">المساعد مفعّل هنا (' + esc(ai.provider || '—') + ' · ' + esc(ai.model || '—') + ')، لكن <b>النموذج لا يرسل «' + esc(f.name) + '» ولا أي شيء إلى أي جهة</b> — هذه محاكاة فقط.</p>' : '<p class="note">المساعد غير مفعّل. فعّله من الإعدادات ← مساعد قراءة الملفات. حتى بعد تفعيله، النموذج لا يرسل أي ملف إلى أي جهة.</p>') + '</div>',
      actions: [{ label: ai.enabled ? 'حسناً' : 'افتح الإعدادات', kind: 'primary', onClick: function (close) { close(); if (!ai.enabled) go('settings'); } }, { label: 'جرّب ملف المثال بدلاً منه', onClick: function (close) { close(); addSample(); } }]
    });
  }

  /* ───────── تغطية الكشوفات ───────── */
  var COV = { state: 'all', type: 'all' };
  function coverageRows() {
    var st = {}; try { (S().staleness().coverage || []).forEach(function (c) { st[c.supplierId] = c.lastImportDays; }); } catch (e) { }
    var imps = list('imports'), lastImp = {};
    imps.forEach(function (i) { if (i.status === 'failed' || !i.partyId) return; var k = i.partyId, d = daysSince(i.at); if (d != null && (lastImp[k] == null || d < lastImp[k])) lastImp[k] = d; });
    var rows = [];
    list('suppliers').forEach(function (s) {
      var d = st[s.id] != null ? st[s.id] : lastImp[s.id]; var pos = {}; try { pos = S().supplierPosition(s.id); } catch (e) { }
      var last = list('invoices').filter(function (i) { return i.supplierId === s.id; }).map(function (i) { return i.date; }).sort().pop();
      rows.push({ id: s.id, view: 'supplier', type: 'supplier', name: s.name, acc: s.account, days: d == null ? null : d, open: pos.open || 0, last: last, phone: s.phone });
    });
    list('contractors').forEach(function (c) {
      var d = lastImp[c.id]; var pos = {}; try { pos = S().contractorPosition(c.id); } catch (e) { }
      var last = list('contractorEntries').filter(function (x) { return x.contractorId === c.id; }).map(function (x) { return x.date; }).sort().pop();
      if (d == null && last && list('contractorEntries').some(function (x) { return x.contractorId === c.id && x.importId; })) d = daysSince(last);
      rows.push({ id: c.id, view: 'contractor', type: 'contractor', name: c.name, acc: c.code, days: d == null ? null : d, open: pos.owed || 0, last: last });
    });
    rows.forEach(function (r) { r.state = r.days == null ? 'none' : r.days <= 30 ? 'fresh' : r.days <= 60 ? 'near' : 'old'; });
    return rows;
  }
  var COV_LBL = { fresh: ['o', 'حديث'], near: ['w', 'يقترب'], old: ['d', 'قديم'], none: ['n', 'بلا كشف'] };
  function renderCoverage(root) {
    var all = coverageRows(), n = all.length, fresh = all.filter(function (r) { return r.state === 'fresh'; }).length;
    var cnt = function (s) { return all.filter(function (r) { return r.state === s; }).length; };
    var pct = n ? Math.round(fresh / n * 100) : 0;
    root.innerHTML = ph('تغطية الكشوفات', 'حالة آخر كشف مرفوع لكل مورد ومقاول — حتى ' + dateTxt(today())) + '<div class="grid">' +
      '<section class="isl c3" style="--i:0"><div class="cap">نسبة التغطية</div><div class="kpi"><span class="num">' + dg(pct) + '%</span></div><div class="cap">' + dg(fresh) + ' من ' + dg(n) + ' بكشف عمره ≤ ٣٠ يوماً</div><div class="bar"><i style="width:' + pct + '%"></i></div></section>' +
      '<section class="isl c3" style="--i:1"><div class="cap">يقترب (٣١–٦٠ يوماً)</div><div class="kpi t-warn"><span class="num">' + dg(cnt('near')) + '</span></div></section>' +
      '<section class="isl c3" style="--i:2"><div class="cap">قديم (أكثر من ٦٠ يوماً)</div><div class="kpi ' + (cnt('old') ? 't-danger' : '') + '"><span class="num">' + dg(cnt('old')) + '</span></div></section>' +
      '<section class="isl c3" style="--i:3"><div class="cap">بلا كشوفات</div><div class="kpi"><span class="num">' + dg(cnt('none')) + '</span></div><div class="cap">أرصدتهم من إدخال يدوي أو كشف مجمّع</div></section>' +
      '<section class="isl c12" style="--i:4"><div class="hfilters">' +
      chips([['all', 'الكل · ' + dg(n)], ['fresh', 'حديث · ' + dg(fresh)], ['near', 'يقترب · ' + dg(cnt('near'))], ['old', 'قديم · ' + dg(cnt('old'))], ['none', 'بلا كشف · ' + dg(cnt('none'))]], COV.state, 'cov-state') +
      chips([['all', 'موردون ومقاولون'], ['supplier', 'الموردون'], ['contractor', 'المقاولون']], COV.type, 'cov-type') + '</div><div data-cov></div></section></div>';
    var rows = all.filter(function (r) { return (COV.state === 'all' || r.state === COV.state) && (COV.type === 'all' || r.type === COV.type); })
      .sort(function (a, b) { return (b.days == null ? 1e6 : b.days) - (a.days == null ? 1e6 : a.days); });
    mount(root.querySelector('[data-cov]'), table({
      id: 'data-coverage', rowKey: 'id', rows: rows, search: true, searchKeys: ['name', 'acc'],
      columns: [
        { key: 'name', label: 'الطرف', sort: true, render: function (r) { return partyLink(r) + '<div class="cap num">' + esc(dg(r.acc || '')) + ' · ' + (r.type === 'supplier' ? 'مورد' : 'مقاول') + '</div>'; } },
        { key: 'days', label: 'عمر آخر كشف', sort: true, num: true, render: function (r) { return r.days == null ? '<span class="dash">—</span>' : '<span class="num">' + dg(r.days) + '</span> يوماً'; } },
        { key: 'state', label: 'الحالة', sort: true, render: function (r) { var l = COV_LBL[r.state]; return '<span class="pill ' + l[0] + '">' + l[1] + '</span>'; } },
        { key: 'last', label: 'آخر حركة', sort: true, render: function (r) { return r.last ? dateTxt(r.last) : '<span class="dash">—</span>'; } },
        { key: 'open', label: 'المديونية المفتوحة', num: true, sort: true, render: function (r) { return money(r.open); } },
        { key: '_a', label: '', render: function (r) { return r.state === 'fresh' ? '' : '<button type="button" class="btn sm" data-dact="cov-ask" data-id="' + esc(r.id) + '" data-type="' + r.type + '">اطلب كشفاً</button>'; } }
      ],
      total: { label: 'الإجمالي', keys: ['open'] },
      empty: { title: 'لا نتائج مطابقة', body: 'لم يطابق البحث أو التصفية أي طرف.', cta: 'مسح التصفية', onCta: function () { COV.state = 'all'; COV.type = 'all'; refresh(); } }
    }));
  }
  function askStatement(id, type) {
    var r = coverageRows().filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var txt = 'السادة / ' + r.name + '\nالسلام عليكم ورحمة الله وبركاته،\n\nنرجو تزويدنا بكشف حساب محدّث لحسابكم رقم ' + (r.acc || '') + ' لدينا حتى تاريخ ' + today().toISOString().slice(0, 10) + '، ' +
      (r.days == null ? 'إذ لا يوجد لدينا كشف مرفوع لكم حتى الآن' : 'إذ إن آخر كشف لدينا عمره ' + r.days + ' يوماً') + '، وذلك لمطابقة الأرصدة.\n\nويفضَّل أن يكون الكشف بصيغة Excel أو CSV.\n\nمع الشكر،\nالإدارة المالية — EGCO';
    modal({
      title: 'طلب كشف حساب — ' + esc(r.name), size: 'md',
      body: '<div class="sec-data"><p class="cap">انسخ النص وأرسله بالبريد أو واتساب' + (r.phone ? ' (الجوال: <span class="num">' + esc(dg(r.phone)) + '</span>)' : '') + '. النموذج لا يرسل رسائل.</p><textarea class="ta" rows="11" data-ask>' + esc(txt) + '</textarea></div>',
      actions: [{ label: 'نسخ النص', kind: 'primary', onClick: function (close, root) { var ta = root.querySelector('[data-ask]'); copyText(ta.value, ta); } }, { label: 'إغلاق', onClick: function (close) { close(); } }]
    });
  }

  /* ───────── النسخ الاحتياطي ───────── */
  var BK_LBL = { daily: 'يومية تلقائية', manual: 'يدوية', 'before-import': 'قبل الاستيراد', 'before-restore': 'قبل الاستعادة', 'before-reset': 'قبل التصفير' };
  function sizeTxt(kb) { kb = +kb || 0; return kb >= 1024 ? '<span class="num">' + dg((kb / 1024).toFixed(1)) + '</span> م.ب' : '<span class="num">' + dg(Math.max(1, Math.round(kb))) + '</span> ك.ب'; }
  function renderBackups(root) {
    var bs = list('backups').slice().sort(function (a, b) { return String(b.at).localeCompare(String(a.at)); });
    var daily = bs.filter(function (b) { return b.kind === 'daily'; })[0];
    var todayIso = today().toISOString().slice(0, 10);
    var dailyLine = !daily ? 'لم تُؤخذ نسخة يومية بعد' : (String(daily.at).slice(0, 10) === todayIso || daysSince(daily.at) === 0 ? 'آخر نسخة يومية: اليوم · ' + esc(ago(daily.at)) : 'آخر نسخة يومية: ' + dateTxt(daily.at) + ' — ستؤخذ نسخة اليوم عند أول فتح');
    var set = settings();
    root.innerHTML = ph('النسخ الاحتياطي', 'نسخة يومية تلقائية عند أول فتح كل يوم، ونسخ قبل كل استيراد واستعادة', '<button type="button" class="btn primary" data-dact="bk-now">نسخة الآن</button>') + '<div class="grid">' +
      '<section class="isl c8" style="--i:0"><div class="ih"><h2>كل النسخ الاحتياطية السابقة</h2><span class="cap"><span class="pdot ' + (daily ? 'ok' : '') + '"></span> ' + dailyLine + '</span></div><div data-bk></div>' +
      '<p class="disclose">يُحتفظ بآخر ٣٠ نسخة يومية و٢٠ يدوية و١٠ قبل الاستيراد؛ الأقدم يُحذف تلقائياً.</p></section>' +
      '<section class="isl c4" style="--i:1"><div class="ih"><h2>مجلد خارجي — اختياري</h2></div><p class="cap">iCloud أو Google Drive أو قرص خارجي. في التطبيق الحقيقي تُنسخ كل نسخة قادمة إلى هذا المجلد أيضاً فتنجو بياناتك إن تعطّل الجهاز. في النموذج يُحفظ المسار فقط — المتصفح لا يكتب إلى مجلدات جهازك.</p>' +
      '<label class="fld"><span class="cap">المسار</span><input type="text" dir="ltr" data-extdir placeholder="~/Library/Mobile Documents/EGCO" value="' + esc(set.externalBackupDir || '') + '"></label>' +
      '<div class="rowacts"><button type="button" class="btn sm" data-dact="bk-dir">حفظ المسار</button>' + (set.externalBackupDir ? '<button type="button" class="btn sm" data-dact="bk-dir-clear">إزالة</button>' : '') + '</div>' +
      '<p class="cap">' + (set.externalBackupDir ? 'ستُنسخ كل نسخة قادمة إلى المجلد الخارجي أيضاً' : 'غير مضبوط — النسخ على هذا الجهاز فقط') + '</p></section></div>';
    mount(root.querySelector('[data-bk]'), table({
      id: 'data-backups', rowKey: 'id', rows: bs.map(function (b) { return Object.assign({}, b, { kindLbl: BK_LBL[b.kind] || b.kind }); }),
      columns: [
        { key: 'at', label: 'التاريخ', sort: true, render: function (b) { return dateTxt(b.at, { weekday: true }) + ' <span class="cap num">' + esc(dg(String(b.at).slice(11, 16))) + '</span><div class="cap">' + esc(ago(b.at)) + '</div>'; } },
        { key: 'kindLbl', label: 'النوع', sort: true, render: function (b) { return '<span class="pill ' + (b.kind === 'manual' ? 'o' : 'n') + '">' + esc(b.kindLbl) + '</span>'; } },
        { key: 'sizeKb', label: 'الحجم', num: true, sort: true, render: function (b) { return sizeTxt(b.sizeKb); } },
        { key: '_a', label: '', render: function (b) { return '<span class="rowacts tight"><button type="button" class="btn sm" data-dact="bk-restore" data-id="' + esc(b.id) + '">استعادة</button><button type="button" class="btn sm" data-dact="bk-del" data-id="' + esc(b.id) + '">حذف</button></span>'; } }
      ],
      empty: { title: 'لا توجد نسخ بعد', body: 'اضغط «نسخة الآن».', cta: 'نسخة الآن', onCta: function () { doBackup(); } }
    }));
  }
  function doBackup() { try { var r = S().backup('manual'); toast('أُخذت نسخة احتياطية يدوية', { kind: 'ok' }); return r; } catch (e) { toast('تعذّر أخذ النسخة', { kind: 'error' }); } }

  /* ───────── المحذوفات ───────── */
  function supName(id) { var s = get('suppliers', id); return s ? s.name : '—'; }
  function conName(id) { var c = get('contractors', id); return c ? c.name : '—'; }
  function projName(id) { var p = get('projects', id); return p ? p.name : ''; }
  var ENTRY_KIND = { opening: 'رصيد افتتاحي', claim: 'مستخلص', payment: 'دفعة', retention: 'محتجز', deduction: 'خصم', invoice: 'فاتورة', other: 'حركة' };
  var TT = [
    { key: 'suppliers', one: 'مورد', many: 'موردون', desc: function (r) { return '<b>' + esc(r.name) + '</b> <span class="cap num">' + esc(dg(r.account || '')) + '</span>'; }, text: function (r) { return r.name + ' ' + r.account; } },
    { key: 'contractors', one: 'مقاول', many: 'مقاولون', desc: function (r) { return '<b>' + esc(r.name) + '</b> <span class="cap num">' + esc(dg(r.code || '')) + '</span>'; }, text: function (r) { return r.name + ' ' + r.code; } },
    { key: 'projects', one: 'مشروع', many: 'مشاريع', desc: function (r) { return '<b>' + esc(r.name) + '</b>'; }, text: function (r) { return r.name; } },
    { key: 'invoices', one: 'فاتورة', many: 'فواتير', parent: ['suppliers', 'supplierId'], desc: function (r) { return 'فاتورة <span class="num">' + esc(dg(r.no || '')) + '</span> · ' + esc(supName(r.supplierId)) + ' · ' + money(r.amount) + ' <span class="cap">' + dateTxt(r.date) + '</span>'; }, text: function (r) { return 'فاتورة ' + r.no + ' ' + supName(r.supplierId); } },
    { key: 'payments', one: 'دفعة', many: 'دفعات', parent: ['suppliers', 'supplierId'], desc: function (r) { return 'دفعة · ' + esc(supName(r.supplierId)) + ' · ' + money(r.amount) + ' <span class="cap">' + dateTxt(r.date) + '</span>'; }, text: function (r) { return 'دفعة ' + supName(r.supplierId) + ' ' + (r.doc || ''); } },
    { key: 'contractorEntries', one: 'حركة مقاول', many: 'حركات مقاولين', parent: ['contractors', 'contractorId'], desc: function (r) { return esc(ENTRY_KIND[r.kind] || 'حركة') + (r.claimNo ? ' رقم <span class="num">' + esc(dg(r.claimNo)) + '</span>' : '') + ' · ' + esc(conName(r.contractorId)) + ' · ' + money((+r.credit || 0) || (+r.debit || 0)) + ' <span class="cap">' + dateTxt(r.date) + '</span>'; }, text: function (r) { return (ENTRY_KIND[r.kind] || '') + ' ' + conName(r.contractorId) + ' ' + (r.description || ''); } },
    { key: 'guarantees', one: 'ضمان', many: 'ضمانات', parent: ['contractors', 'contractorId'], desc: function (r) { return 'ضمان ' + esc(r.type || '') + ' · ' + esc(conName(r.contractorId)) + ' · ' + money(r.amount); }, text: function (r) { return 'ضمان ' + conName(r.contractorId); } },
    { key: 'receivables', one: 'تحصيل', many: 'تحصيلات', desc: function (r) { return esc(r.from || '') + ' · <span class="num">' + esc(dg(r.docNo || '')) + '</span> · ' + money(r.amount); }, text: function (r) { return (r.from || '') + ' ' + (r.docNo || ''); } },
    { key: 'budgetMonths', one: 'شهر موازنة', many: 'أشهر موازنة', parent: ['projects', 'projectId'], desc: function (r) { return 'موازنة ' + esc(projName(r.projectId)) + ' · <span class="num">' + esc(dg(r.month)) + '</span>'; }, text: function (r) { return 'موازنة ' + projName(r.projectId) + ' ' + r.month; } },
    { key: 'imports', one: 'استيراد', many: 'استيرادات', desc: function (r) { return 'ملف «' + esc(r.file || 'بلا اسم') + '» · <span class="num">' + dg(r.added || 0) + '</span> حركة'; }, text: function (r) { return r.file; } }
  ];
  var TR = { tab: 'all', q: '' };
  function norm(s) { return String(s || '').toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, ''); }
  function trashItems() {
    var out = [];
    TT.forEach(function (t) { list(t.key, true).forEach(function (r) { if (r.deletedAt) out.push({ t: t, r: r }); }); });
    return out.sort(function (a, b) { return String(b.r.deletedAt).localeCompare(String(a.r.deletedAt)); });
  }
  function dependents(t, r) {
    var n = 0, map = { suppliers: [['invoices', 'supplierId'], ['payments', 'supplierId']], contractors: [['contractorEntries', 'contractorId'], ['guarantees', 'contractorId']], imports: ROW_TYPES.map(function (x) { return [x, 'importId']; }) }[t.key];
    (map || []).forEach(function (m) { list(m[0], true).forEach(function (x) { if (x.deletedAt && x[m[1]] === r.id) n++; }); });
    return n;
  }
  function parentDeleted(t, r) { if (!t.parent) return false; var p = get(t.parent[0], r[t.parent[1]]); return !!(p && p.deletedAt); }
  function renderTrash(root) {
    var items = trashItems(), counts = {};
    items.forEach(function (x) { counts[x.t.key] = (counts[x.t.key] || 0) + 1; });
    root.innerHTML = ph('المحذوفات', 'لا شيء يختفي بلا رجعة — كل صف هنا يمكن استرجاعه مع تبعياته، أو حذفه نهائياً بتأكيد صريح',
      items.length ? '<button type="button" class="btn" data-dact="tr-empty">إفراغ السلّة</button>' : '') + '<div class="grid"><section class="isl c12" style="--i:0">' +
      '<div class="tabs trtabs" role="tablist">' + [['all', 'الكل', items.length]].concat(TT.filter(function (t) { return counts[t.key]; }).map(function (t) { return [t.key, t.many, counts[t.key]]; }))
        .map(function (x) { return '<button type="button" role="tab" aria-selected="' + (TR.tab === x[0]) + '" data-dact="tr-tab" data-v="' + x[0] + '">' + x[1] + ' <span class="cnt3 num">' + dg(x[2]) + '</span></button>'; }).join('') + '</div>' +
      '<label class="fld search"><span class="cap">بحث</span><input type="search" data-trq placeholder="اسم، رقم فاتورة، ملف…" value="' + esc(TR.q) + '"></label><div data-tr></div></section></div>';
    if (TR.tab !== 'all' && !counts[TR.tab]) TR.tab = 'all';
    paintTrash(root, items);
    var q = root.querySelector('[data-trq]');
    q.addEventListener('input', function () { TR.q = q.value; paintTrash(root, trashItems()); });
  }
  function paintTrash(root, items) {
    var qq = norm(TR.q);
    var rows = items.filter(function (x) { return (TR.tab === 'all' || x.t.key === TR.tab) && (!qq || norm(x.t.text(x.r)).indexOf(qq) >= 0); });
    var el = root.querySelector('[data-tr]');
    if (!items.length) { el.innerHTML = U().emptyState ? U().emptyState({ title: 'السلّة فارغة', body: 'ما تحذفه من أي شاشة يصل هنا ويبقى قابلاً للاسترجاع.' }) : '<p class="cap">السلّة فارغة</p>'; return; }
    if (!rows.length) { el.innerHTML = '<p class="cap pad">لا نتائج مطابقة للبحث.</p>'; return; }
    el.innerHTML = '<div class="tbl-wrap"><table><thead><tr><th>النوع</th><th>التفاصيل</th><th>تاريخ الحذف</th><th class="n">تبعيات</th><th></th></tr></thead><tbody>' + rows.map(function (x) {
      var dep = dependents(x.t, x.r), blocked = parentDeleted(x.t, x.r);
      return '<tr><td><span class="pill n">' + esc(x.t.one) + '</span></td><td class="wrap">' + x.t.desc(x.r) + (blocked ? '<div class="cap">الطرف الأصلي محذوف — استرجعه أولاً فيعود هذا معه</div>' : '') + '</td><td>' + esc(ago(x.r.deletedAt)) + '</td><td class="n">' + (dep ? '<span class="num">' + dg(dep) + '</span> تعود معه' : '<span class="dash">—</span>') + '</td>' +
        '<td><span class="rowacts tight"><button type="button" class="btn sm" data-dact="tr-restore" data-t="' + x.t.key + '" data-id="' + esc(x.r.id) + '"' + (blocked ? ' disabled aria-disabled="true"' : '') + '>استرجاع</button><button type="button" class="btn sm danger" data-dact="tr-purge" data-t="' + x.t.key + '" data-id="' + esc(x.r.id) + '">حذف نهائي</button></span></td></tr>';
    }).join('') + '</tbody></table></div>';
  }
  function trRestore(type, id) {
    var t = TT.filter(function (x) { return x.key === type; })[0];
    var restoredRows = [];
    try { S().restore(type, id); } catch (e) { toast('تعذّر الاسترجاع', { kind: 'error' }); return; }
    if (type === 'imports') ROW_TYPES.forEach(function (rt) { list(rt, true).forEach(function (r) { if (r.deletedAt && r.importId === id) { try { S().restore(rt, r.id); restoredRows.push([rt, r.id]); } catch (e) { } } }); });
    toast('استُرجع ' + (t ? t.one : 'العنصر') + (restoredRows.length ? ' مع ' + dg(restoredRows.length) + ' حركة' : ''), { kind: 'ok', undo: function () { restoredRows.forEach(function (x) { try { S().remove(x[0], x[1]); } catch (e) { } }); try { S().remove(type, id); } catch (e) { } } });
  }
  function trPurge(type, id) {
    var t = TT.filter(function (x) { return x.key === type; })[0], r = get(type, id) || {};
    var dep = t ? dependents(t, r) : 0;
    confirmBox({ title: 'حذف نهائي — لا رجعة بعده', danger: true, confirmLabel: 'حذف نهائي', body: 'سيُمحى ' + (t ? t.one : 'العنصر') + (dep ? ' و<b>' + dg(dep) + '</b> من تبعياته المحذوفة' : '') + ' نهائياً. <b>لا يمكن التراجع عن هذا</b> ولا استرجاعه من السلّة بعده (يبقى فقط في النسخ الاحتياطية السابقة).' }).then(function (ok) {
      if (!ok) return;
      try { purgeWithDeps(t, r); S().purge(type, id); toast('حُذف نهائياً', { kind: 'ok' }); } catch (e) { toast('تعذّر الحذف النهائي', { kind: 'error' }); }
    });
  }
  function purgeWithDeps(t, r) {
    if (!t) return;
    var map = { suppliers: [['invoices', 'supplierId'], ['payments', 'supplierId']], contractors: [['contractorEntries', 'contractorId'], ['guarantees', 'contractorId']], imports: ROW_TYPES.map(function (x) { return [x, 'importId']; }) }[t.key];
    (map || []).forEach(function (m) { list(m[0], true).forEach(function (x) { if (x.deletedAt && x[m[1]] === r.id) { try { S().purge(m[0], x.id); } catch (e) { } } }); });
  }
  function trEmpty() {
    var items = trashItems();
    confirmBox({ title: 'إفراغ السلّة', danger: true, confirmLabel: 'حذف ' + dg(items.length) + ' نهائياً', body: 'سيُمحى <b>' + dg(items.length) + '</b> عنصراً محذوفاً نهائياً. <b>لا يمكن التراجع عن هذا.</b> نأخذ نسخة احتياطية يدوية قبل الإفراغ احتياطاً.' }).then(function (ok) {
      if (!ok) return;
      try { S().backup('manual'); } catch (e) { }
      var order = ['invoices', 'payments', 'contractorEntries', 'guarantees', 'receivables', 'budgetMonths', 'imports', 'suppliers', 'contractors', 'projects'];
      order.forEach(function (k) { list(k, true).forEach(function (r) { if (r.deletedAt) { try { S().purge(k, r.id); } catch (e) { } } }); });
      toast('أُفرغت السلّة', { kind: 'ok' });
    });
  }

  /* ───────── الإعدادات ───────── */
  var WHATS_NEW = [
    { version: '0.13.0', items: [
      { title: 'زر تصفير البيانات', description: 'إن أردت البدء من جديد ببيانات نظيفة، زرٌّ واحد يمحو كل ما رُفع وأُدخل ويُبقي إعداداتك كما هي. يعرض لك أولاً عدد السجلات التي ستُحذف، ويطلب كتابة كلمة «تصفير» للتأكيد، ويأخذ نسخة احتياطية قبل المحو تلقائياً.', where: 'الإعدادات ← تصفير البيانات' },
      { title: 'نسخة احتياطية تلقائية كل يوم', description: 'يأخذ التطبيق نسخة من بياناتك يومياً دون أن تفعل شيئاً. ومن الإعدادات ترى قائمة النسخ وتستعيد أيّاً منها بنقرة واحدة إن حدث خطأ.', where: 'الإعدادات ← النسخ الاحتياطي' },
      { title: '«متأخر» حقيقي للمقاولين', description: 'حدّد مدة السداد لكل مقاول (مثلاً ٣٠ يوماً) فيظهر ما تجاوزها بالأحمر في قائمة المقاولين واللوحة والتقويم. مقاول بلا مدة لا يُحسب له تأخر — لا نخترع رقماً.', where: 'المقاولون' },
      { title: 'دفعات مقاولين كانت تُعرض خصومات', description: 'بعض الكشوف تكتب «دفعھ» بحرف هاء مختلف، فكانت دفعات حقيقية تُحسب «خصومات» في كشف المقاول. صُحّح التصنيف لما استُورد سابقاً أيضاً — الرصيد لم يتغيّر، تغيّر تفكيكه فقط.', where: 'كشف المقاول' },
      { title: 'اسم واحد للرقم الواحد', description: 'كان نفس المبلغ يظهر باسم مختلف في كل شاشة («إجمالي المديونية»، «المتبقي»، «المستحق») فيبدو كأنه أرقام متعددة. الآن هو «المديونية المفتوحة» في كل مكان.' },
      { title: 'مظهر موحّد في كل الشاشات', description: 'أحجام الخطوط والبطاقات والأزرار والجداول صارت واحدة في كل الصفحات، فلا تتغير الكثافة ولا الشكل حين تنتقل من شاشة إلى أخرى.' }
    ] },
    { version: '0.12.0', items: [
      { title: 'سلّة المحذوفات — لا شيء يضيع بعد اليوم', description: 'حذفتَ مورداً أو مقاولاً أو ملفاً مستورداً بالخطأ؟ كله يبقى في السلّة قابلاً للاسترجاع مع فواتيره وحركاته بضغطة واحدة. ولا يُمحى شيء نهائياً إلا حين تقرّر أنت ذلك من هناك.', where: 'الإعدادات ← المحذوفات' },
      { title: 'صفحة المشاريع تعرض الصورة كاملة', description: 'كل مشروع في سطر واحد: مديونية الموردين، والمستحق للمقاولين، وإجمالي الالتزام، ونسبة تأخر الموازنة. كانت الصفحة تعرض الموردين فقط فيبدو المشروع بلا التزامات وهو يدين لمقاوليه بالملايين.', where: 'المشاريع' },
      { title: 'دمج المشاريع المكرّرة', description: 'حين يصل اسم المشروع بصيغتين («سدن» و«السدن») يقترح التطبيق الدمج عند الرفع، وتستطيع دمج أي مشروعين من الإعدادات بعد معاينة ما سيتأثر — بلا تغيير صامت لبياناتك.', where: 'الإعدادات ← المشاريع والدمج' },
      { title: 'لن تفقد ما كتبتَه بالخطأ', description: 'إغلاق نافذة فيها تعديلات غير محفوظة يسألك أولاً. ومفتاح Tab يبقى داخل النافذة، والصفحة خلفها لا تتحرك.' },
      { title: 'الأحمر يعني «متأخر» فقط', description: 'كان الأحمر يعني «متأخر» عند الموردين و«له علينا» عند المقاولين فيختلط الأمر. الآن الأحمر للتأخر الزمني وحده في كل الشاشات، وقائمة الموردين تُرتَّب بما يجب دفعه فعلاً لا بالمديونية الكلية.', where: 'الموردون · المقاولون' },
      { title: 'سجل الاستيراد أوضح', description: 'بدل رقم «٠» المبهم ترى «مضاف» و«مطابق مسبقاً» منفصلَين، ورابطاً مباشراً لصفحة المورد أو المقاول المتأثر.', where: 'رفع الملفات' }
    ] }
  ];
  function whatsNew() {
    modal({
      title: 'ما الجديد', size: 'lg',
      body: '<div class="sec-data wn">' + WHATS_NEW.map(function (v) {
        return '<section><h3>الإصدار <span class="num">' + dg(v.version) + '</span>' + (v.version === VERSION ? ' <span class="pill o">الحالي</span>' : '') + '</h3><ol>' + v.items.map(function (it) {
          return '<li><b>' + esc(it.title) + '</b><p>' + esc(it.description) + '</p>' + (it.where ? '<span class="pill n">' + esc(it.where) + '</span>' : '') + '</li>';
        }).join('') + '</ol></section>';
      }).join('') + '</div>',
      actions: [{ label: 'فهمت', kind: 'primary', onClick: function (close) { close(); } }]
    });
  }
  var UPD = { state: 'idle', at: null };
  function checkUpdates() {
    if (UPD.state === 'checking') return;
    UPD.state = 'checking'; refresh();
    setTimeout(function () { UPD.state = 'latest'; UPD.at = new Date().toISOString(); refresh(); }, 1400);
  }
  function card(i, cls, title, body) { return '<section class="isl ' + cls + '" style="--i:' + i + '"><div class="ih"><h2>' + title + '</h2></div>' + body + '</section>'; }
  function line(label, ctrl, help) { return '<div class="srow"><div><div class="slbl">' + label + '</div>' + (help ? '<div class="cap">' + help + '</div>' : '') + '</div><div class="sctl">' + ctrl + '</div></div>'; }
  function renderSettings(root) {
    var s = settings(), cl = classes(), ai = aiLoad();
    var clKeys = Object.keys(cl);
    var notifPerm = (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported';
    var html = ph('الإعدادات', 'البيانات محفوظة على هذا الجهاز فقط — لا يوجد اتصال بأي خادم خارجي', '<button type="button" class="btn" data-dact="whatsnew">ما الجديد</button>') + '<div class="grid">';
    html += card(0, 'c6', 'المظهر',
      line('الوضع', seg([['system', 'حسب النظام'], ['light', 'نهاري'], ['dark', 'ليلي']], s.theme || 'system', 'set-theme')) +
      line('الأرقام', seg([['latin', '123'], ['arab', '١٢٣']], s.digits || 'latin', 'set-digits'), 'تُطبَّق على كل الأرقام والتواريخ'));
    html += card(1, 'c6', 'التنبيهات',
      line('إشعارات النظام', sw(!!s.osNotifications, 'set-os', 'إشعارات النظام'), 'تنبيه خارج التطبيق عند متأخر جديد أو عجز متوقع' + (s.osNotifications && notifPerm !== 'granted' ? ' — المتصفح لم يمنح الإذن بعد؛ التنبيهات تبقى في مركز الإشعارات' : '')) +
      line('جزيرة الحالة', sw(s.island !== false, 'set-island', 'جزيرة الحالة'), 'الشريط العائم أعلى الشاشة: الاستيراد والنسخ والعجز'));
    html += card(2, 'c6', 'الافتراضات',
      '<div class="fgrid"><label class="fld"><span class="cap">مدة السداد عند غياب القيمة (يوماً)</span><input type="number" min="0" max="365" data-s="term" value="' + esc(s.defaultSupplierTerm != null ? s.defaultSupplierTerm : 60) + '"></label>' +
      '<label class="fld"><span class="cap">رصيد البنك الحالي (ر.س)</span><input type="number" step="0.01" data-s="bank" value="' + esc(s.bankBalance != null ? s.bankBalance : 0) + '"></label></div>' +
      '<p class="cap">رصيد البنك هو نقطة بداية التدفق النقدي — تعديله يغيّر التوقّع فوراً.</p>' +
      '<ul class="assume"><li><span>طريقة توزيع الدفعات</span><b>الأقدم أولاً (FIFO)</b></li><li><span>كاش</span><b>استحقاق فوري</b></li><li><span>نافذة التنبيه</span><b><span class="num">' + dg(7) + '</span> أيام</b></li></ul>' +
      '<div class="rowacts"><button type="button" class="btn primary sm" data-dact="set-defaults">حفظ</button><button type="button" class="btn sm" data-dact="go" data-view="cash">افتح التدفق النقدي</button></div>');
    html += card(3, 'c6', 'تصنيفات الحسابات', '<p class="cap">حسابات برقم بادئة غير معروفة صنّفتها يدوياً من شاشة الرفع — تُطبَّق تلقائياً في كل رفع قادم.</p>' +
      (clKeys.length ? '<ul class="cls">' + clKeys.map(function (acc) {
        return '<li><div><b class="num">' + esc(dg(acc)) + '</b></div><div class="seg" role="group">' + [['211', 'مورد'], ['212', 'مقاول'], ['216', 'ضمان'], ['ignore', 'تجاهل']].map(function (o) { return '<button type="button" aria-pressed="' + (cl[acc] === o[0]) + '" data-dact="cls-set" data-acc="' + esc(acc) + '" data-v="' + o[0] + '">' + o[1] + '</button>'; }).join('') + '</div><button type="button" class="btn sm" data-dact="cls-del" data-acc="' + esc(acc) + '">إزالة</button></li>';
      }).join('') + '</ul>' : '<p class="empty-note">لا توجد تصنيفات محفوظة بعد.</p>'));
    html += card(4, 'c6', 'مساعد قراءة الملفات (ذكاء اصطناعي)',
      line('تفعيل المساعد', sw(!!ai.enabled, 'ai-toggle', 'تفعيل المساعد'), 'يُستعمل فقط حين يفشل القارئ العادي في فهم ملف') +
      '<div class="fgrid"><label class="fld"><span class="cap">المزوّد</span><select data-ai="provider">' + [['anthropic', 'Anthropic'], ['openai', 'OpenAI'], ['local', 'خادم محلي (Ollama…)']].map(function (o) { return '<option value="' + o[0] + '"' + (ai.provider === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select></label>' +
      '<label class="fld"><span class="cap">النموذج</span><input type="text" dir="ltr" data-ai="model" value="' + esc(ai.model || '') + '" placeholder="claude-…"></label>' +
      '<label class="fld"><span class="cap">عنوان الخدمة (baseUrl)</span><input type="text" dir="ltr" data-ai="baseUrl" value="' + esc(ai.baseUrl || '') + '" placeholder="فارغ لمزود سحابي"></label>' +
      '<label class="fld"><span class="cap">مفتاح API</span><input type="password" dir="ltr" autocomplete="off" data-ai="key" value="" placeholder="' + (ai.key ? 'محفوظ ••••' + esc(String(ai.key).slice(-4)) + ' — اتركه فارغاً للإبقاء عليه' : 'فارغ لمزود محلي') + '"></label></div>' +
      '<p class="note">المفتاح يُحفظ في متصفحك فقط (localStorage) ويظهر مقنّعاً. <b>النموذج لا يرسله ولا أي ملف إلى أي جهة إطلاقاً</b> — زر الاختبار محاكاة.</p>' +
      '<div class="rowacts"><button type="button" class="btn primary sm" data-dact="ai-save">حفظ</button><button type="button" class="btn sm" data-dact="ai-test">اختبار الاتصال</button>' + (ai.key ? '<button type="button" class="btn sm" data-dact="ai-clear">مسح المفتاح</button>' : '') + '</div>');
    html += card(5, 'c6', 'النقل إلى جهاز آخر', '<p class="cap">صدِّر كل بياناتك ملفاً واحداً (JSON) وانقله، ثم استورده على الجهاز الآخر. الاستيراد يستبدل البيانات الحالية بعد أخذ نسخة احتياطية.</p><div class="rowacts"><button type="button" class="btn sm" data-dact="xfer-out">تصدير البيانات</button><button type="button" class="btn sm" data-dact="xfer-in">استيراد ملف بيانات</button></div>');
    var updTxt = { idle: 'لم يُفحص في هذه الجلسة', checking: 'جارٍ الفحص…', latest: 'أنت على أحدث إصدار (' + dg(VERSION) + ') · فُحص ' + (UPD.at ? esc(ago(UPD.at)) : 'الآن') }[UPD.state];
    html += card(6, 'c6', 'التحديثات', line('الإصدار الحالي', '<b class="num">' + dg(VERSION) + '</b>') +
      '<p class="cap" aria-live="polite">' + (UPD.state === 'checking' ? '<span class="spin" aria-hidden="true"></span> ' : '') + updTxt + '</p><p class="cap">التطبيق الحقيقي يتحدّث بصمت في الخلفية ويعرض «ما الجديد» عند أول فتح بعد كل تحديث.</p>' +
      '<div class="rowacts"><button type="button" class="btn sm" data-dact="upd-check"' + (UPD.state === 'checking' ? ' disabled' : '') + '>فحص الآن</button><button type="button" class="btn sm" data-dact="whatsnew">ما الجديد</button></div>');
    html += card(7, 'c6', 'عن التطبيق', '<ul class="assume"><li><span>إصدار التطبيق</span><b class="num">' + dg(VERSION) + '</b></li><li><span>مكان قاعدة البيانات</span><b>هذا المتصفح (نموذج)</b></li><li><span>الاتصال بالشبكة</span><b>لا يوجد — يعمل دون إنترنت</b></li><li><span>اختصارات</span><b dir="ltr">⌘K · ⌘.</b></li></ul>' +
      '<div class="rowacts"><button type="button" class="btn sm" data-dact="go" data-view="trash">المحذوفات</button><button type="button" class="btn sm" data-dact="go" data-view="backups">النسخ الاحتياطي</button><button type="button" class="btn sm" data-dact="go" data-view="merge">المشاريع والدمج</button></div>');
    html += '<section class="isl c12 dz" style="--i:8"><div class="ih"><h2>منطقة الخطر</h2></div>' +
      line('إعادة ضبط بيانات المثال', '<button type="button" class="btn sm danger" data-dact="reset">إعادة الضبط</button>', 'تعيد النموذج إلى بياناته الأولى — يُمحى كل ما أضفته وعدّلته هنا') +
      line('تصفير جميع البيانات', '<button type="button" class="btn sm danger" data-dact="wipe">تصفير البيانات</button>', 'يمحو كل ما رُفع وأُدخل ويُبقي إعداداتك — بعد نسخة احتياطية تلقائية') + '</section></div>';
    root.innerHTML = html;
  }
  function saveDefaults(root) {
    var t = root.querySelector('[data-s="term"]'), b = root.querySelector('[data-s="bank"]');
    var term = parseInt(latinDigits(t.value), 10), bank = num(b.value);
    if (isNaN(term) || term < 0 || term > 365) { t.classList.add('m-shake'); setTimeout(function () { t.classList.remove('m-shake'); }, 400); toast('مدة السداد بين ٠ و٣٦٥ يوماً', { kind: 'error' }); return; }
    var prev = settings().bankBalance;
    setSetting({ defaultSupplierTerm: term, bankBalance: bank });
    toast('تم حفظ الإعدادات — التدفق النقدي يبدأ الآن من ' + fmt(bank), { kind: 'ok', undo: cents(prev) !== cents(bank) ? function () { setSetting({ bankBalance: prev }); } : null });
  }
  function aiSaveFrom(root) {
    var ai = aiLoad(), v = function (k) { return root.querySelector('[data-ai="' + k + '"]').value.trim(); };
    ai.provider = v('provider'); ai.model = v('model'); ai.baseUrl = v('baseUrl');
    if (v('key')) ai.key = v('key');
    aiSave(ai); toast('حُفظت إعدادات المساعد في هذا المتصفح فقط', { kind: 'ok' }); refresh();
  }
  function xferOut() {
    var db = S().db, copy = {}; Object.keys(db).forEach(function (k) { if (k !== 'backups') copy[k] = db[k]; });
    var json = JSON.stringify({ app: 'EGCO', version: VERSION, exportedAt: new Date().toISOString(), data: copy }, null, 1);
    modal({
      title: 'تصدير البيانات', size: 'lg',
      body: '<div class="sec-data"><p class="cap">التنزيل قد يكون محجوباً داخل هذه الصفحة؛ إن لم يبدأ فانسخ النص واحفظه في ملف ‎.json. الحجم ~<span class="num">' + dg(Math.round(json.length / 1024)) + '</span> ك.ب (بلا النسخ الاحتياطية).</p><textarea class="ta mono" rows="12" readonly data-x>' + esc(json) + '</textarea></div>',
      actions: [
        { label: 'نسخ', kind: 'primary', onClick: function (c, r) { var ta = r.querySelector('[data-x]'); copyText(ta.value, ta); } },
        { label: 'محاولة التنزيل', onClick: function () { try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' })); a.download = 'egco-data.json'; document.body.appendChild(a); a.click(); a.remove(); toast('إن لم يبدأ التنزيل فاستعمل «نسخ»', { kind: 'info' }); } catch (e) { toast('التنزيل محجوب هنا — استعمل «نسخ»', { kind: 'info' }); } } },
        { label: 'إغلاق', onClick: function (c) { c(); } }]
    });
  }
  function xferIn() {
    modal({
      title: 'استيراد ملف بيانات', size: 'lg',
      body: '<div class="sec-data"><p class="cap">الصق محتوى ملف ‎.json المصدَّر من EGCO، أو اختر الملف. ستُستبدل البيانات الحالية بالكامل بعد أخذ نسخة احتياطية.</p><input type="file" accept=".json,application/json" data-xf><textarea class="ta mono" rows="10" data-xi placeholder="{ &quot;app&quot;: &quot;EGCO&quot;, … }"></textarea><p class="note" data-xe hidden></p></div>',
      onOpen: function (root) { var f = root.querySelector('[data-xf]'); f.addEventListener('change', function () { var file = f.files && f.files[0]; if (file) readText(file, function (t) { root.querySelector('[data-xi]').value = t || ''; }); }); },
      actions: [{ label: 'استيراد واستبدال', kind: 'primary', onClick: function (close, root) {
        var err = root.querySelector('[data-xe]'), obj;
        try { obj = JSON.parse(root.querySelector('[data-xi]').value); } catch (e) { err.hidden = false; err.textContent = 'النص ليس JSON صالحاً'; return; }
        var data = obj && (obj.data || obj);
        if (!data || !Array.isArray(data.suppliers) || !data.settings) { err.hidden = false; err.textContent = 'هذا ليس ملف بيانات EGCO (لا موردين ولا إعدادات)'; return; }
        try { S().backup('manual'); } catch (e) { }
        var db = S().db; Object.keys(data).forEach(function (k) { if (k !== 'backups') db[k] = data[k]; });
        persist(); close(); toast('استُوردت البيانات — النسخة السابقة في النسخ الاحتياطي', { kind: 'ok' });
      } }, { label: 'إلغاء', onClick: function (c) { c(); } }]
    });
  }
  var WIPE_TYPES = ['invoices', 'payments', 'contractorEntries', 'guarantees', 'receivables', 'budgetMonths', 'imports', 'suppliers', 'contractors', 'projects', 'notes'];
  function wipe() {
    var counts = WIPE_TYPES.map(function (t) { return [t, list(t, true).length]; }), total = counts.reduce(function (s, c) { return s + c[1]; }, 0);
    if (!total) { toast('لا توجد بيانات لحذفها — التطبيق فارغ أصلاً.', { kind: 'info' }); return; }
    var lbl = { invoices: 'فاتورة', payments: 'دفعة', contractorEntries: 'حركة مقاول', guarantees: 'ضمان', receivables: 'تحصيل', budgetMonths: 'شهر موازنة', imports: 'استيراد', suppliers: 'مورد', contractors: 'مقاول', projects: 'مشروع', notes: 'إشعار' };
    modal({
      title: 'تأكيد التصفير', size: 'md',
      body: '<div class="sec-data"><p>سيُمحى <b class="num">' + dg(total) + '</b> سجلاً:</p><ul class="wipe">' + counts.filter(function (c) { return c[1]; }).map(function (c) { return '<li><span class="num">' + dg(c[1]) + '</span> ' + lbl[c[0]] + '</li>'; }).join('') + '</ul>' +
        '<p class="cap">يبقى كما هو: الإعدادات، تصنيفات الحسابات، النسخ الاحتياطية. تؤخذ نسخة احتياطية قبل المحو، لكن المحو نفسه <b>لا يمكن التراجع عنه</b> إلا بالاستعادة.</p><label class="fld"><span class="cap">اكتب «تصفير» للتأكيد</span><input type="text" data-w autocomplete="off"></label></div>',
      actions: [{ label: 'تصفير نهائي', kind: 'danger', onClick: function (close, root) {
        var inp = root.querySelector('[data-w]');
        if (inp.value.trim() !== 'تصفير') { inp.classList.add('m-shake'); setTimeout(function () { inp.classList.remove('m-shake'); }, 400); return; }
        try { S().backup('manual'); } catch (e) { }
        WIPE_TYPES.forEach(function (t) { list(t, true).forEach(function (r) { try { S().purge(t, r.id); } catch (e) { } }); });
        inp.value = ''; close(); IMP.files = []; IMP.result = null; IMP.step = 'pick';
        toast('صُفّرت البيانات — النسخة السابقة في النسخ الاحتياطي', { kind: 'ok' });
      } }, { label: 'إلغاء', onClick: function (c) { c(); } }]
    });
  }

  /* ───────── معالج النقرات (لكل جذر قسم) ───────── */
  function onClick(e, root) {
    var b = e.target.closest('[data-dact]'); if (!b || !root.contains(b) || b.disabled) return;
    var a = b.getAttribute('data-dact'), id = b.getAttribute('data-id'), v = b.getAttribute('data-v');
    switch (a) {
      case 'go': e.stopPropagation(); go(b.getAttribute('data-view'), id ? { id: id } : {}); break;
      case 'imp-pick': var i1 = root.querySelector('[data-in="files"]'); if (i1) i1.click(); break;
      case 'imp-folder': var i2 = root.querySelector('[data-in="folder"]'); if (i2) i2.click(); break;
      case 'imp-sample': addSample(); break;
      case 'imp-clear': IMP.files = []; IMP.step = 'pick'; refresh(); break;
      case 'imp-again': IMP.files = []; IMP.result = null; IMP.step = 'pick'; refresh(); break;
      case 'imp-drop': IMP.files = IMP.files.filter(function (f) { return f.id !== id; }); if (!IMP.files.length) IMP.step = 'pick'; refresh(); break;
      case 'imp-commit': commitAll(); break;
      case 'imp-class': var cl = Object.assign({}, classes()); cl[b.getAttribute('data-acc')] = v; setSetting({ accountClasses: cl }); reanalyzeAll(); toast('صُنّف الحساب ' + dg(b.getAttribute('data-acc')) + ' — سنتذكّره', { kind: 'ok' }); refresh(); break;
      case 'imp-ignore': var f = IMP.files.filter(function (x) { return x.id === b.getAttribute('data-fid'); })[0]; if (f) { f.ignore[b.getAttribute('data-acc')] = 1; analyze(f); refresh(); } break;
      case 'imp-ai': var fa = IMP.files.filter(function (x) { return x.id === id; })[0]; if (fa) aiRescue(fa); break;
      case 'imp-del': e.stopPropagation(); deleteImport(id); break;
      case 'hist-kind': IMP.hist.kind = v; refresh(); break;
      case 'hist-status': IMP.hist.status = v; refresh(); break;
      case 'hist-range': IMP.hist.range = v; refresh(); break;
      case 'cov-state': COV.state = v; refresh(); break;
      case 'cov-type': COV.type = v; refresh(); break;
      case 'cov-ask': e.stopPropagation(); askStatement(id, b.getAttribute('data-type')); break;
      case 'bk-now': doBackup(); break;
      case 'bk-restore': e.stopPropagation(); var bk = get('backups', id) || {};
        confirmBox({ title: 'استعادة نسخة ' + dateTxt(bk.at), confirmLabel: 'استعادة', body: 'ستُستبدل بياناتك الحالية بهذه النسخة (' + esc(BK_LBL[bk.kind] || '') + '، ' + esc(ago(bk.at)) + '). قبل الاستعادة نأخذ تلقائياً نسخة «قبل الاستعادة» من وضعك الحالي، فتستطيع الرجوع إليه إن غيّرت رأيك.' })
          .then(function (ok) { if (!ok) return; try { S().restoreBackup(id); toast('استُعيدت النسخة — وضعك السابق محفوظ كنسخة «قبل الاستعادة»', { kind: 'ok' }); } catch (er) { toast('تعذّرت الاستعادة', { kind: 'error' }); } }); break;
      case 'bk-del': e.stopPropagation(); var bd = get('backups', id) || {};
        confirmBox({ title: 'حذف النسخة الاحتياطية', danger: true, confirmLabel: 'حذف', body: 'ستُحذف نسخة ' + dateTxt(bd.at) + ' (' + esc(BK_LBL[bd.kind] || '') + ') نهائياً. <b>لا يمكن التراجع عن هذا.</b>' })
          .then(function (ok) { if (ok) { try { S().deleteBackup(id); toast('حُذفت النسخة', { kind: 'ok' }); } catch (er) { toast('تعذّر الحذف', { kind: 'error' }); } } }); break;
      case 'bk-dir': var dir = root.querySelector('[data-extdir]').value.trim(); setSetting({ externalBackupDir: dir }); toast(dir ? 'حُفظ المسار' : 'أُزيل المسار', { kind: 'ok' }); break;
      case 'bk-dir-clear': setSetting({ externalBackupDir: '' }); toast('أُزيل المسار', { kind: 'ok' }); break;
      case 'tr-tab': TR.tab = v; refresh(); break;
      case 'tr-restore': trRestore(b.getAttribute('data-t'), id); break;
      case 'tr-purge': trPurge(b.getAttribute('data-t'), id); break;
      case 'tr-empty': trEmpty(); break;
      case 'set-theme': setSetting({ theme: v }); applyTheme(v); break;
      case 'set-digits': setSetting({ digits: v }); break;
      case 'set-os': var on = !settings().osNotifications; setSetting({ osNotifications: on });
        if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') { try { var pr = Notification.requestPermission(); if (pr && pr.then) pr.then(function () { refresh(); }); } catch (er) { } }
        toast(on ? 'فُعّلت إشعارات النظام' : 'أُوقفت إشعارات النظام — تبقى في مركز الإشعارات', { kind: 'ok' }); break;
      case 'set-island': setSetting({ island: settings().island === false }); break;
      case 'set-defaults': saveDefaults(root); break;
      case 'cls-set': var c2 = Object.assign({}, classes()); c2[b.getAttribute('data-acc')] = v; setSetting({ accountClasses: c2 }); break;
      case 'cls-del': var acc = b.getAttribute('data-acc'), c3 = Object.assign({}, classes()), old = c3[acc]; delete c3[acc]; setSetting({ accountClasses: c3 });
        toast('أُزيل تصنيف ' + dg(acc) + ' — سيُسأل عنه في الرفع القادم', { kind: 'ok', undo: function () { var c4 = Object.assign({}, classes()); c4[acc] = old; setSetting({ accountClasses: c4 }); } }); break;
      case 'ai-toggle': var ai = aiLoad(); ai.enabled = !ai.enabled; aiSave(ai); refresh(); break;
      case 'ai-save': aiSaveFrom(root); break;
      case 'ai-clear': var a2 = aiLoad(); delete a2.key; aiSave(a2); toast('مُسح المفتاح من هذا المتصفح', { kind: 'ok' }); refresh(); break;
      case 'ai-test': var a3 = aiLoad(); toast(!a3.enabled ? 'المساعد غير مفعّل' : 'محاكاة: لم يُرسل أي طلب — النموذج لا يتصل بأي خدمة. في التطبيق الحقيقي يُختبر الاتصال بـ' + (a3.provider || 'المزوّد'), { kind: 'info' }); break;
      case 'xfer-out': xferOut(); break;
      case 'xfer-in': xferIn(); break;
      case 'upd-check': checkUpdates(); break;
      case 'whatsnew': whatsNew(); break;
      case 'reset': confirmBox({ title: 'إعادة ضبط بيانات المثال', danger: true, confirmLabel: 'إعادة الضبط', body: 'سيُمحى كل ما أضفته وعدّلته في هذا النموذج (موردون، استيرادات، نسخ، إعدادات) ويعود إلى بيانات المثال الأولى. <b>لا يمكن التراجع عن هذا.</b>' })
        .then(function (ok) { if (!ok) return; IMP.files = []; IMP.result = null; IMP.step = 'pick'; try { S().reset(); applyTheme(settings().theme); toast('أُعيدت بيانات المثال', { kind: 'ok' }); } catch (er) { toast('تعذّرت إعادة الضبط', { kind: 'error' }); } }); break;
      case 'wipe': wipe(); break;
    }
  }

  /* ───────── أحداث المتجر ───────── */
  function bindStore() {
    var s = S(); if (!s || !s.on || bindStore.done) return; bindStore.done = true;
    s.on('import:progress', function (d) { if (IMP.prog && d) { IMP.prog.pct = +d.pct || 0; paintProg(); } });
  }

  /* ───────── التسجيل ───────── */
  function view(fn) {
    return function (container) {
      bindStore();
      var root = document.createElement('div'); root.className = 'sec-data';
      root.addEventListener('click', function (e) { onClick(e, root); });
      container.innerHTML = ''; container.appendChild(root);
      try { fn(root); } catch (err) { root.innerHTML = '<div class="isl"><b>تعذّر عرض الصفحة</b><p class="cap">' + esc(err && err.message) + '</p></div>'; if (window.console) console.error(err); }
    };
  }
  function reg() {
    if (!E.shell || !E.shell.register) return false;
    E.shell.register('import', { section: 'data', tab: 'رفع الملفات', title: 'رفع الملفات', render: view(renderImport), badge: function () { return IMP.files.filter(function (f) { return f.status === 'needs-class'; }).length; } });
    E.shell.register('coverage', { section: 'data', tab: 'تغطية الكشوفات', title: 'تغطية الكشوفات', render: view(renderCoverage) });
    E.shell.register('backups', { section: 'data', tab: 'النسخ الاحتياطي', title: 'النسخ الاحتياطي', render: view(renderBackups) });
    E.shell.register('trash', { section: 'data', tab: 'المحذوفات', title: 'المحذوفات', render: view(renderTrash) });
    E.shell.register('settings', { section: 'data', tab: 'الإعدادات', title: 'الإعدادات', render: view(renderSettings) });
    return true;
  }
  if (!reg()) document.addEventListener('DOMContentLoaded', reg);

  /* واجهة صغيرة لأقسام أخرى (اختيارية): فتح «ما الجديد» */
  E.data = { whatsNew: whatsNew, WHATS_NEW: WHATS_NEW, addSample: addSample };
})();
