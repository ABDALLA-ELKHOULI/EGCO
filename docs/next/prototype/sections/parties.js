/* قسم «الأطراف» — الموردون · المقاولون · الضمانات + كشف المورد وكشف المقاول.
 * يعتمد حصراً على EGCO.store / EGCO.ui / EGCO.shell كما في CONTRACT.md. */
(function () {
  'use strict';
  const E = window.EGCO;
  const S = () => E.store;
  const U = () => E.ui;
  const go = (v, p) => E.shell.go(v, p);
  const DAY = 864e5;

  /* ───────────── أدوات مشتركة ───────────── */
  const esc = (s) => U().esc(s == null ? '' : String(s));
  const money = (n, cls) => U().money(Number(n) || 0, cls);
  const dg = (s) => U().digits(String(s));
  const int = (n) => U().int(n);
  const dt = (d) => (d ? U().dateTxt(d) : '<span class="dash">—</span>');
  const cents = (n) => Math.round((Number(n) || 0) * 100);
  const sumC = (arr, f) => arr.reduce((a, x) => a + cents(f(x)), 0) / 100;
  const pad = (n) => String(n).padStart(2, '0');
  const iso = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const todayIso = () => iso(S().TODAY);
  const toDate = (s) => { if (!s) return null; if (s instanceof Date) return s; const [y, m, d] = String(s).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY);
  const list = (t) => S().list(t) || [];
  const projName = (id) => { const p = id && S().get('projects', id); return p && !p.deletedAt ? p.name : ''; };
  const projects = () => list('projects');
  const num = (v) => { if (v == null || v === '') return NaN; return Number(String(v).replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[,٬\s]/g, '').replace('٫', '.')); };
  const opt = (arr) => arr.map(([value, label]) => ({ value, label }));
  const wrap = (html) => '<div class="sec-parties">' + html + '</div>';
  const SAMPLE = '<span class="sample">بيانات مثال</span>';

  function shake(root, name, msg) {
    const el = root.querySelector('[name="' + name + '"]');
    const box = root.querySelector('.pt-err');
    if (box) { box.textContent = msg; box.hidden = false; }
    if (el) {
      const f = el.closest('label,.field,.f-row') || el;
      f.classList.remove('m-shake'); void f.offsetWidth; f.classList.add('m-shake');
      try { el.focus(); } catch (e) { /* */ }
    }
    return false;
  }
  const errBox = '<div class="pt-err" role="alert" hidden></div>';

  function balanceWord(bal) {
    if (bal < 0) return '<span class="pill w dirn">نحن ندين لهم</span>';
    if (bal > 0) return '<span class="pill n dirn">يدينون لنا</span>';
    return '<span class="pill n dirn">متوازن</span>';
  }

  function copyText(text, root) {
    const done = () => U().toast('نُسخ النص', { kind: 'ok' });
    const fallback = () => {
      const ta = root && root.querySelector('textarea');
      if (ta) { ta.focus(); ta.select(); }
      U().toast('تعذّر النسخ التلقائي — النص محدّد، انسخه بـ⌘/Ctrl+C', { kind: 'info' });
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    } catch (e) { fallback(); }
  }

  /* مشاريع متعددة: قائمة اختيار بمربعات + إضافة مشروع جديد بالاسم */
  function projectPicker(selected) {
    const sel = new Set(selected || []);
    return '<fieldset class="pt-projs"><legend>المشاريع</legend><div class="pt-projlist">' +
      projects().map((p) => '<label class="pt-pchk"><input type="checkbox" name="__proj" value="' + esc(p.id) + '"' + (sel.has(p.id) ? ' checked' : '') + '> ' + esc(p.name) + '</label>').join('') +
      '</div><label class="pt-newp"><span>مشروع جديد (اختياري)</span><input type="text" name="__newproj" placeholder="اسم المشروع…"></label>' +
      '<div class="pt-psug" hidden></div></fieldset>';
  }
  const normAr = (s) => String(s || '').trim().replace(/[إأآٱا]/g, 'ا').replace(/[يیى]/g, 'ي').replace(/[ةه]/g, 'ه').replace(/^ال/, '').replace(/\s+/g, ' ');
  function wireProjectPicker(root) {
    const inp = root.querySelector('[name="__newproj"]');
    const sug = root.querySelector('.pt-psug');
    if (!inp) return;
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      const m = v && projects().find((p) => p.name !== v && normAr(p.name) === normAr(v));
      if (m) {
        sug.hidden = false;
        sug.innerHTML = 'يوجد مشروع قريب: <button type="button" class="btn sm" data-pick="' + esc(m.id) + '">' + esc(m.name) + '</button> — اختره بدل إنشاء توأم';
      } else sug.hidden = true;
    });
    sug.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]'); if (!b) return;
      const cb = root.querySelector('[name="__proj"][value="' + CSS.escape(b.dataset.pick) + '"]');
      if (cb) cb.checked = true;
      inp.value = ''; sug.hidden = true;
    });
  }
  function readProjects(root) {
    const ids = [...root.querySelectorAll('[name="__proj"]:checked')].map((c) => c.value);
    const nv = (root.querySelector('[name="__newproj"]') || {}).value;
    if (nv && nv.trim()) {
      const exist = projects().find((p) => p.name === nv.trim());
      if (exist) { if (!ids.includes(exist.id)) ids.push(exist.id); }
      else { const p = S().create('projects', { name: nv.trim(), contractValue: 0, budgetDelayPct: 0 }); if (p && p.id) ids.push(p.id); }
    }
    return ids;
  }

  /* حذف منطقي + تراجع */
  async function softDelete(type, id, label, body, after) {
    const ok = await U().confirm({ title: 'حذف ' + label, body: body || 'سيُنقل إلى «المحذوفات» ويمكن استرجاعه.', danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    S().remove(type, id);
    U().toast('حُذف ' + label + ' — يمكن استرجاعه من المحذوفات', { kind: 'info', undo: () => { S().restore(type, id); U().toast('استُرجع', { kind: 'ok' }); } });
    if (after) after();
  }

  /* تفويض نقرات أزرار الصفوف قبل وصولها لـonRowClick */
  function delegate(el, handlers) {
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b || !el.contains(b)) return;
      e.stopPropagation(); e.preventDefault();
      const h = handlers[b.dataset.act]; if (h) h(b.dataset.id, b);
    }, true);
  }
  const rowBtns = (id, acts) => '<span class="pt-acts">' + acts.map(([a, label, ic]) =>
    '<button type="button" class="btn sm pt-ib" data-act="' + a + '" data-id="' + esc(id) + '" aria-label="' + label + '" title="' + label + '">' + ic + '</button>').join('') + '</span>';
  const IC = { edit: '✎', del: '🗑', ret: '↩' };

  /* ═════════════ الموردون ═════════════ */
  const supState = { pick: new Set(), project: '', minOpen: '', maxOpen: '', prioOpen: false, budget: '' };

  function supplierRows() {
    return list('suppliers').map((s) => {
      const p = S().supplierPosition(s.id) || {};
      const invs = (p.invoices || []).filter((i) => i.remaining > 0);
      const status = p.overdue > 0 ? 'late' : p.due7 > 0 ? 'soon' : 'ok';
      return {
        ...s, open: p.open || 0, overdue: p.overdue || 0, due7: p.due7 || 0, oldestDays: p.oldestDays || 0,
        invCount: invs.length, status, termKey: s.termDays == null ? 'none' : String(s.termDays),
        projNames: (s.projectIds || []).map(projName).filter(Boolean).join('، '),
      };
    });
  }
  const STATUS_PILL = { late: '<span class="pill d">متأخر</span>', soon: '<span class="pill w">خلال ٧ أيام</span>', ok: '<span class="pill o">منتظم</span>' };

  function renderSuppliers(c) {
    const ui = U(); const t = S().totals();
    let rows = supplierRows();
    if (supState.project) rows = rows.filter((r) => (r.projectIds || []).includes(supState.project));
    const mn = num(supState.minOpen), mx = num(supState.maxOpen);
    if (!isNaN(mn)) rows = rows.filter((r) => r.open >= mn);
    if (!isNaN(mx)) rows = rows.filter((r) => r.open <= mx);
    rows.sort((a, b) => b.overdue - a.overdue || b.open - a.open);
    const all = list('suppliers');
    const invTotal = all.reduce((a, s) => a + ((S().supplierPosition(s.id) || {}).invoices || []).filter((i) => i.remaining > 0).length, 0);
    const lateN = rows.filter((r) => r.overdue > 0).length;
    const terms = [...new Set(all.map((s) => s.termDays))].sort((a, b) => (a == null) - (b == null) || a - b);
    const st = S().staleness ? S().staleness() : null;
    const staleNote = st && t.supplierDue7 === 0 && st.newestInvoiceDays > 14 ? '<div class="cap">٠ — آخر فاتورة قبل ' + dg(st.newestInvoiceDays) + ' يوماً</div>' : '';

    c.innerHTML = wrap(
      '<div class="ph"><div><h1>الموردون</h1><p>' + dg(all.length) + ' مورداً · مرتّبون بالمتأخر ثم بالمديونية المفتوحة ' + SAMPLE + '</p></div>' +
      '<div class="acts"><button class="btn" data-a="prio" aria-expanded="' + supState.prioOpen + '">' + (supState.prioOpen ? 'إخفاء أولويات السداد' : 'أولويات السداد') + '</button>' +
      '<button class="btn" data-a="export">تصدير</button><button class="btn primary" data-a="add">+ مورد</button></div></div>' +
      '<div class="grid">' +
      '<section class="isl c3 click" data-a="kpi-all" tabindex="0" style="--i:0">' + ui.kpi({ label: 'المديونية المفتوحة', value: t.supplierOpen, money: true }) + '</section>' +
      '<section class="isl c3 crit click" data-a="kpi-late" tabindex="0" style="--i:1">' + ui.kpi({ label: 'متأخر', value: t.supplierOverdue, money: true, tone: 'danger', hint: dg(lateN) + ' موردين متأخرين' }) + '</section>' +
      '<section class="isl c3 click" data-a="kpi-soon" tabindex="0" style="--i:2">' + ui.kpi({ label: 'مستحق خلال ٧ أيام', value: t.supplierDue7, money: true, tone: 'warn' }) + staleNote + '</section>' +
      '<section class="isl c3" style="--i:3">' + ui.kpi({ label: 'عدد الفواتير المفتوحة', value: invTotal, money: false }) + '</section>' +
      (supState.prioOpen ? '<section class="isl c12 pt-prio" style="--i:4"></section>' : '') +
      '<section class="isl c12" style="--i:5"><div class="pt-xfil">' +
        '<label><span>المشروع</span><select data-f="project"><option value="">كل المشاريع</option>' + projects().map((p) => '<option value="' + esc(p.id) + '"' + (supState.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
        '<label><span>المديونية من</span><input data-f="minOpen" inputmode="decimal" value="' + esc(supState.minOpen) + '" placeholder="٠"></label>' +
        '<label><span>إلى</span><input data-f="maxOpen" inputmode="decimal" value="' + esc(supState.maxOpen) + '" placeholder="—"></label>' +
        ((supState.project || supState.minOpen || supState.maxOpen) ? '<button class="btn sm" data-a="clearx">مسح الكل</button>' : '') +
      '</div><div class="pt-tbl"></div></section></div><div class="pt-paybar-slot"></div>');

    const root = c.querySelector('.sec-parties');
    const tbl = ui.table({
      id: 'parties-suppliers',
      rows, rowKey: 'id', search: true, searchKeys: ['name', 'account', 'projNames', 'phone'], columnMenu: true,
      selectable: true, selected: supState.pick,
      onSelect: (set) => { supState.pick = new Set(set); paybar(root, rows); },
      onRowClick: (r) => go('supplier', { id: r.id }),
      filters: [
        { key: 'status', label: 'الحالة', options: opt([['late', 'متأخر'], ['soon', 'قريب'], ['ok', 'منتظم']]) },
        { key: 'termKey', label: 'مدة السداد', options: opt(terms.map((x) => [x == null ? 'none' : String(x), x == null ? 'غير محدّدة' : dg(x) + ' يوماً'])) },
      ],
      columns: [
        { key: 'name', label: 'المورد', sort: true, render: (r) => '<b>' + esc(r.name) + '</b><div class="cap"><span class="num">' + dg(esc(r.account)) + '</span></div>' },
        { key: 'projNames', label: 'المشروع', sort: true, render: (r) => r.projNames ? esc(r.projNames) : '<span class="dash">—</span>' },
        { key: 'termDays', label: 'مدة السداد', sort: true, render: (r) => r.termDays == null ? '<span class="pill n">غير محدّدة</span>' : '<span class="num">' + dg(r.termDays) + '</span> يوماً' },
        { key: 'invCount', label: 'الفواتير المفتوحة', num: true, sort: true, render: (r) => '<span class="num">' + int(r.invCount) + '</span>' },
        { key: 'oldestDays', label: 'أقدم متأخر', sort: true, render: (r) => r.overdue > 0 && r.oldestDays ? '<span class="num">' + dg(r.oldestDays) + '</span> يوماً' : '<span class="dash">—</span>' },
        { key: 'status', label: 'الحالة', sort: true, render: (r) => STATUS_PILL[r.status] },
        { key: 'overdue', label: 'متأخر', num: true, sort: true, render: (r) => r.overdue ? money(r.overdue, 't-danger') : '<span class="dash">—</span>' },
        { key: 'open', label: 'المديونية المفتوحة', num: true, sort: true, render: (r) => money(r.open) },
        { key: '_a', label: '', render: (r) => rowBtns(r.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
      ],
      total: { label: 'الإجمالي', keys: ['overdue', 'open'] },
      empty: { title: 'لا موردين مطابقين', body: 'غيّر البحث أو التصفية، أو أضف مورداً.', cta: '+ مورد', onCta: () => supplierForm() },
    });
    root.querySelector('.pt-tbl').appendChild(tbl);
    delegate(root.querySelector('.pt-tbl'), {
      edit: (id) => supplierForm(S().get('suppliers', id)),
      del: (id) => deleteSupplier(id),
    });
    paybar(root, rows);
    if (supState.prioOpen) renderPriorities(root.querySelector('.pt-prio'));

    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      const k = a.dataset.a;
      if (k === 'add') supplierForm();
      else if (k === 'export') exportSuppliers(rows);
      else if (k === 'prio') { supState.prioOpen = !supState.prioOpen; E.shell.refresh(); }
      else if (k === 'clearx') { supState.project = supState.minOpen = supState.maxOpen = ''; E.shell.refresh(); }
      else if (k === 'kpi-late' || k === 'kpi-soon' || k === 'kpi-all') {
        const s = root.querySelector('input[type="search"]'); if (s) s.focus();
      }
    });
    root.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => { supState[el.dataset.f] = el.value; E.shell.refresh(); }));
  }

  function paybar(root, rows) {
    const slot = root.querySelector('.pt-paybar-slot'); if (!slot) return;
    const picked = rows.filter((r) => supState.pick.has(r.id));
    if (!picked.length) { slot.innerHTML = ''; return; }
    const due = sumC(picked, (r) => r.overdue + r.due7);
    const open = sumC(picked, (r) => r.open);
    slot.innerHTML = '<div class="paybar pt-paybar" role="region" aria-label="قائمة الدفع"><div><div class="cap">قائمة الدفع · ' + dg(picked.length) + ' موردين — متأخر + خلال ٧ أيام</div><div class="big">' + money(due) + '</div><div class="cap">من مديونية مفتوحة ' + money(open) + '</div></div>' +
      '<button class="btn sm pt-clear">إلغاء التحديد</button><button class="btn primary pt-exp">تصدير قائمة الدفع</button></div>';
    slot.querySelector('.pt-exp').onclick = () => {
      const data = picked.map((r) => ({ account: r.account, name: r.name, overdue: r.overdue, due7: r.due7, pay: (cents(r.overdue) + cents(r.due7)) / 100, open: r.open }));
      data.push({ account: '', name: 'الإجمالي', overdue: sumC(picked, (r) => r.overdue), due7: sumC(picked, (r) => r.due7), pay: due, open });
      U().exportDialog({ title: 'قائمة الدفع', fileName: 'قائمة-الدفع-' + todayIso() + '.csv',
        csv: S().toCSV(data, [{ key: 'account', label: 'الحساب' }, { key: 'name', label: 'المورد' }, { key: 'overdue', label: 'متأخر' }, { key: 'due7', label: 'خلال ٧ أيام' }, { key: 'pay', label: 'المقترح للدفع' }, { key: 'open', label: 'المديونية المفتوحة' }]) });
    };
    slot.querySelector('.pt-clear').onclick = () => { supState.pick = new Set(); E.shell.refresh(); };
  }

  function exportSuppliers(rows) {
    const STL = { late: 'متأخر', soon: 'خلال ٧ أيام', ok: 'منتظم' };
    U().exportDialog({ title: 'تصدير الموردين', fileName: 'الموردون-' + todayIso() + '.csv',
      csv: S().toCSV(rows.map((r) => ({ ...r, statusTxt: STL[r.status], term: r.termDays == null ? 'غير محدّدة' : r.termDays })), [
        { key: 'account', label: 'الحساب' }, { key: 'name', label: 'المورد' }, { key: 'projNames', label: 'المشاريع' }, { key: 'term', label: 'مدة السداد' },
        { key: 'invCount', label: 'الفواتير المفتوحة' }, { key: 'statusTxt', label: 'الحالة' }, { key: 'overdue', label: 'متأخر' }, { key: 'due7', label: 'خلال ٧ أيام' }, { key: 'open', label: 'المديونية المفتوحة' }]) });
  }

  /* أولويات السداد بلا ذكاء اصطناعي: ميزانية → الأقدم تأخراً أولاً */
  function renderPriorities(box) {
    const items = [];
    list('suppliers').forEach((s) => ((S().supplierPosition(s.id) || {}).invoices || []).forEach((i) => {
      if (i.remaining > 0 && i.lateDays > 0) items.push({ kind: 'مورد', party: s.name, partyId: s.id, view: 'supplier', ref: 'فاتورة ' + (i.no || ''), amount: i.remaining, late: i.lateDays, due: i.dueDate });
    }));
    list('contractors').forEach((k) => { const p = S().contractorPosition(k.id) || {}; if (k.termDays == null) return; (p.claims || []).forEach((cl) => {
      if (cl.remaining > 0 && cl.lateDays > 0) items.push({ kind: 'مقاول', party: k.name, partyId: k.id, view: 'contractor', ref: 'مستخلص ' + (cl.claimNo || ''), amount: cl.remaining, late: cl.lateDays, due: cl.dueDate });
    }); });
    items.sort((a, b) => b.late - a.late || b.amount - a.amount);
    const budget = num(supState.budget);
    let left = isNaN(budget) ? Infinity : cents(budget);
    const plan = items.map((x) => { const c = cents(x.amount); const take = Math.min(c, Math.max(0, left)); left -= take; return { ...x, pay: take / 100 }; });
    const chosen = isNaN(budget) ? plan : plan.filter((x) => x.pay > 0);
    const totalPay = sumC(chosen, (x) => x.pay);
    const noTerm = list('contractors').filter((k) => k.termDays == null).length;
    box.innerHTML = '<div class="ih"><h2>أولويات السداد</h2><span class="cap">الأقدم تأخراً أولاً · بلا تقدير آلي</span></div>' +
      '<div class="pt-xfil"><label><span>المبلغ المتاح للدفع (ر.س)</span><input class="pt-budget" inputmode="decimal" value="' + esc(supState.budget) + '" placeholder="اتركه فارغاً لعرض الكل"></label>' +
      '<button class="btn sm primary pt-run">احسب</button>' + (chosen.length ? '<button class="btn sm pt-pexp">تصدير</button>' : '') + '</div>' +
      (chosen.length ? '<div class="tbl-wrap"><table><thead><tr><th>#</th><th>الطرف</th><th>البند</th><th>الاستحقاق</th><th>التأخر</th><th class="n">المتبقي</th><th class="n">يُدفع</th></tr></thead><tbody>' +
        chosen.map((x, i) => '<tr class="click" data-v="' + x.view + '" data-id="' + esc(x.partyId) + '"><td class="num">' + dg(i + 1) + '</td><td><b>' + esc(x.party) + '</b><div class="cap">' + x.kind + '</div></td><td>' + esc(x.ref) + '</td><td>' + dt(x.due) + '</td><td><span class="pill d"><span class="num">' + dg(x.late) + '</span> يوماً</span></td><td class="n">' + money(x.amount) + '</td><td class="n">' + (x.pay < x.amount ? money(x.pay) + '<div class="cap">جزئي</div>' : money(x.pay)) + '</td></tr>').join('') +
        '</tbody><tfoot><tr><td colspan="6">الإجمالي (' + dg(chosen.length) + ')</td><td class="n">' + money(totalPay) + '</td></tr></tfoot></table></div>'
        : '<p class="disclose">لا بنود متأخرة حالياً.</p>') +
      (noTerm ? '<p class="disclose">' + dg(noTerm) + ' مقاولين بلا مدة سداد خارج هذه القائمة — تأخرهم غير محسوب.</p>' : '');
    const run = () => { supState.budget = box.querySelector('.pt-budget').value; renderPriorities(box); };
    box.querySelector('.pt-run').onclick = run;
    box.querySelector('.pt-budget').addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
    box.querySelectorAll('tr[data-v]').forEach((tr) => tr.onclick = () => go(tr.dataset.v, { id: tr.dataset.id }));
    const ex = box.querySelector('.pt-pexp');
    if (ex) ex.onclick = () => U().exportDialog({ title: 'أولويات السداد', fileName: 'أولويات-السداد-' + todayIso() + '.csv',
      csv: S().toCSV(chosen, [{ key: 'kind', label: 'النوع' }, { key: 'party', label: 'الطرف' }, { key: 'ref', label: 'البند' }, { key: 'due', label: 'الاستحقاق' }, { key: 'late', label: 'أيام التأخر' }, { key: 'amount', label: 'المتبقي' }, { key: 'pay', label: 'يُدفع' }]) });
  }

  function supplierForm(s) {
    const isEdit = !!s;
    const body = wrap(errBox + U().form([
      { name: 'account', label: 'رقم الحساب', type: 'text', required: true, value: s ? s.account : '211', help: 'يبدأ بـ211 ولا يتكرر' },
      { name: 'name', label: 'اسم المورد', type: 'text', required: true, value: s ? s.name : '' },
      { name: 'termDays', label: 'مدة السداد (يوم)', type: 'number', min: 0, max: 365, value: s && s.termDays != null ? s.termDays : (s ? '' : (S().db.settings || {}).defaultSupplierTerm || ''), help: 'تُحسب منها تواريخ الاستحقاق والتأخر' },
      { name: 'phone', label: 'الهاتف', type: 'text', value: s ? s.phone || '' : '' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', value: s ? s.notes || '' : '' },
    ]) + projectPicker(s ? s.projectIds : []));
    U().modal({
      title: isEdit ? 'تعديل مورد' : 'إضافة مورد', body, size: 'md', onOpen: wireProjectPicker,
      actions: [
        { label: 'إلغاء', onClick: (close) => close() },
        { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
          const v = U().readForm(root);
          const account = String(v.account || '').trim().replace(/[٠-٩]/g, (c) => '٠١٢٣٤٥٦٧٨٩'.indexOf(c));
          const name = String(v.name || '').trim();
          if (!/^211\d+$/.test(account)) return shake(root, 'account', 'رقم حساب المورد يجب أن يبدأ بـ211 وأرقاماً فقط');
          if (list('suppliers').some((x) => x.account === account && (!s || x.id !== s.id))) return shake(root, 'account', 'رقم الحساب مستخدم لمورد آخر');
          if (!name) return shake(root, 'name', 'اسم المورد مطلوب');
          const term = v.termDays === '' || v.termDays == null ? null : num(v.termDays);
          if (term != null && (isNaN(term) || term < 0 || term > 365)) return shake(root, 'termDays', 'المدة بين ٠ و٣٦٥ يوماً');
          const obj = { account, name, termDays: term, phone: String(v.phone || '').trim(), notes: String(v.notes || '').trim(), projectIds: readProjects(root) };
          if (isEdit) { S().update('suppliers', s.id, obj); U().toast('حُفظ المورد', { kind: 'ok' }); }
          else { const n = S().create('suppliers', obj); U().toast('أُضيف المورد ' + name, { kind: 'ok' }); close(); if (n && n.id) go('supplier', { id: n.id }); return; }
          close();
        } },
      ],
    });
  }

  function deleteSupplier(id, after) {
    const s = S().get('suppliers', id); if (!s) return;
    const n = list('invoices').filter((i) => i.supplierId === id).length + list('payments').filter((p) => p.supplierId === id).length;
    softDelete('suppliers', id, 'المورد «' + s.name + '»',
      esc(s.name) + ' (' + dg(esc(s.account)) + ')' + (n ? ' ومعه ' + dg(n) + ' حركة (فواتير ودفعات) ستُنقل إلى «المحذوفات» ويمكن استرجاعها معاً.' : ' سيُنقل إلى «المحذوفات».'), after);
  }

  /* ═════════════ كشف المورد ═════════════ */
  const detState = { showPaid: false, bucket: null };
  const BUCKETS = [['d0_30', '١–٣٠ يوماً', 1, 30], ['d31_60', '٣١–٦٠', 31, 60], ['d61_90', '٦١–٩٠', 61, 90], ['d90p', 'أكثر من ٩٠', 91, Infinity]];
  const bucketOf = (late) => { const b = BUCKETS.find((x) => late >= x[2] && late <= x[3]); return b ? b[0] : null; };

  function invStatus(i) {
    if (i.remaining <= 0) return '<span class="pill o">مسددة</span>';
    if (i.lateDays > 0) return '<span class="pill d">متأخرة <span class="num">' + dg(i.lateDays) + '</span> يوماً</span>';
    if (!i.dueDate) return '<span class="pill n">بلا استحقاق</span>';
    const d = daysBetween(S().TODAY, i.dueDate);
    if (d <= 7) return '<span class="pill w">خلال <span class="num">' + dg(d) + '</span> أيام</span>';
    return '<span class="pill n">غير مستحقة بعد</span>';
  }

  function renderSupplier(c, params) {
    const ui = U(); const s = params && params.id && S().get('suppliers', params.id);
    if (!s || s.deletedAt) {
      c.innerHTML = wrap('<div class="ph"><div><button class="crumb" data-a="back">→ الموردون</button><h1>المورد غير موجود</h1><p>ربما حُذف — ابحث عنه في «المحذوفات».</p></div></div>');
      c.querySelector('[data-a="back"]').onclick = () => go('suppliers');
      return;
    }
    const p = S().supplierPosition(s.id) || {};
    const invs = (p.invoices || []).map((i) => ({ ...i, paid: (cents(i.amount) - cents(i.remaining)) / 100, bucket: i.remaining > 0 && i.lateDays > 0 ? bucketOf(i.lateDays) : null, projectName: projName(i.projectId) }));
    const pays = list('payments').filter((x) => x.supplierId === s.id).sort((a, b) => String(b.date).localeCompare(a.date));
    const openInv = invs.filter((i) => i.remaining > 0);
    const aging = {}; BUCKETS.forEach((b) => { aging[b[0]] = sumC(invs.filter((i) => i.bucket === b[0]), (i) => i.remaining); });
    const agingMax = Math.max(1, ...Object.values(aging));
    let shown = detState.showPaid ? invs : openInv;
    if (detState.bucket) shown = shown.filter((i) => i.bucket === detState.bucket);
    const lastPay = pays[0];
    const projs = (s.projectIds || []).filter((id) => projName(id));

    c.innerHTML = wrap(
      '<div class="ph"><div><button class="crumb" data-a="back">→ الموردون</button><h1>' + esc(s.name) + '</h1>' +
      '<p><span class="num">' + dg(esc(s.account)) + '</span> · مدة السداد ' + (s.termDays == null ? '<span class="pill n">غير محدّدة</span>' : '<span class="num">' + dg(s.termDays) + '</span> يوماً') +
      (s.phone ? ' · <span class="num" dir="ltr">' + dg(esc(s.phone)) + '</span>' : '') + ' ' + SAMPLE + '</p></div>' +
      '<div class="acts"><button class="btn sm" data-a="inv">+ مديونية</button><button class="btn sm" data-a="pay">+ دفعة</button>' +
      '<button class="btn sm" data-a="remind"' + (p.overdue > 0 ? '' : ' title="لا فواتير متأخرة — المسودة تطلب مطابقة الرصيد"') + '>صياغة مطالبة</button>' +
      '<button class="btn sm" data-a="stmt">تصدير الكشف</button><button class="btn sm" data-a="edit">تعديل</button><button class="btn sm" data-a="del">حذف</button></div></div>' +
      '<div class="grid">' +
      '<section class="isl c12" style="--i:0"><div class="sum">' +
        '<div><div class="cap">الرصيد</div><div class="kpi">' + ui.counted(-(p.open || 0)) + '</div>' + balanceWord(-(p.open || 0)) + '</div>' +
        '<div><div class="cap">متأخر</div><div class="kpi ' + (p.overdue > 0 ? 't-danger' : '') + '">' + money(p.overdue || 0) + '</div><div class="cap">' + (p.oldestDays && p.overdue ? 'أقدمها ' + dg(p.oldestDays) + ' يوماً' : 'لا متأخر') + '</div></div>' +
        '<div><div class="cap">خلال ٧ أيام</div><div class="kpi t-warn">' + money(p.due7 || 0) + '</div></div>' +
        '<div><div class="cap">فواتير مفتوحة</div><div class="kpi"><span class="num">' + int(openInv.length) + '</span></div><div class="cap">من ' + dg(invs.length) + '</div></div>' +
        '<div><div class="cap">آخر دفعة</div><div class="kpi pt-kdate">' + (lastPay ? dt(lastPay.date) : '<span class="dash">لا دفعات</span>') + '</div>' + (lastPay ? '<div class="cap">' + money(lastPay.amount) + '</div>' : '') + '</div>' +
      '</div></section>' +
      '<section class="isl c8" style="--i:1"><div class="ih"><h2>المتأخر حسب مدة التأخر</h2>' + (detState.bucket ? '<button class="btn sm" data-a="bk-all">عرض الكل</button>' : '<span class="cap">انقر شريحة للتصفية</span>') + '</div>' +
        '<div class="pt-aging">' + BUCKETS.map((b, i) => '<button type="button" class="pt-ag' + (detState.bucket === b[0] ? ' on' : '') + '" data-bk="' + b[0] + '" aria-pressed="' + (detState.bucket === b[0]) + '" style="--i:' + i + '"><span class="cap">' + b[1] + '</span><span class="pt-agbar"><span style="--p:' + (aging[b[0]] / agingMax).toFixed(3) + '"></span></span>' + money(aging[b[0]], aging[b[0]] ? 't-danger' : '') + '</button>').join('') + '</div></section>' +
      '<section class="isl c4" style="--i:2"><div class="ih"><h2>المشاريع</h2></div>' +
        (projs.length ? '<div class="pt-plinks">' + projs.map((id) => '<button class="chip" data-proj="' + esc(id) + '">' + esc(projName(id)) + '</button>').join('') + '</div>' : '<p class="disclose">لا مشاريع مرتبطة — أضفها من «تعديل».</p>') +
        (s.notes ? '<div class="cap pt-notes">' + esc(s.notes) + '</div>' : '') + '</section>' +
      '<section class="isl c12" style="--i:3"><div class="ih"><h2>الفواتير</h2><span class="cap">السداد يُوزَّع بطريقة الأقدم أولاً (FIFO) — كما في كشف الحساب</span></div>' +
        '<div class="pt-xfil"><button class="chip" data-a="paid" aria-pressed="' + detState.showPaid + '">إظهار المسددة</button>' + (detState.bucket ? '<span class="pill d">شريحة: ' + BUCKETS.find((b) => b[0] === detState.bucket)[1] + '</span><button class="btn sm" data-a="bk-all">إلغاء التصفية</button>' : '') + '</div>' +
        '<div class="pt-inv"></div></section>' +
      '<section class="isl c12" style="--i:4"><div class="ih"><h2>الدفعات</h2><span class="cap">' + dg(pays.length) + ' دفعة</span></div><div class="pt-pay"></div></section>' +
      '</div>');
    const root = c.querySelector('.sec-parties');

    root.querySelector('.pt-inv').appendChild(ui.table({
      id: 'parties-sup-inv', rows: shown, rowKey: 'id', search: true, searchKeys: ['no', 'description', 'projectName'], columnMenu: true,
      filters: [{ key: 'projectName', label: 'المشروع', options: opt([...new Set(invs.map((i) => i.projectName).filter(Boolean))].map((x) => [x, x])) }],
      columns: [
        { key: 'no', label: 'الفاتورة', sort: true, render: (i) => '<span class="num">' + dg(esc(i.no || '—')) + '</span>' + (i.description ? '<div class="cap">' + esc(i.description) + '</div>' : '') },
        { key: 'date', label: 'التاريخ', sort: true, render: (i) => dt(i.date) },
        { key: 'dueDate', label: 'الاستحقاق', sort: true, render: (i) => i.dueDate ? dt(i.dueDate) : '<span class="dash" title="مدة السداد غير محدّدة">—</span>' },
        { key: 'projectName', label: 'المشروع', sort: true, render: (i) => i.projectName ? esc(i.projectName) : '<span class="dash">—</span>' },
        { key: 'amount', label: 'المبلغ', num: true, sort: true, render: (i) => money(i.amount) },
        { key: 'paid', label: 'سُدّد', num: true, sort: true, render: (i) => money(i.paid) },
        { key: 'remaining', label: 'المتبقي', num: true, sort: true, render: (i) => i.remaining > 0 ? money(i.remaining, i.lateDays > 0 ? 't-danger' : '') : '<span class="dash">—</span>' },
        { key: 'lateDays', label: 'الحالة', sort: true, render: invStatus },
        { key: '_a', label: '', render: (i) => rowBtns(i.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
      ],
      total: { label: 'الإجمالي', keys: ['amount', 'paid', 'remaining'] },
      empty: { title: detState.showPaid ? 'لا فواتير' : 'لا فواتير مفتوحة', body: 'أضف مديونية يدوياً أو ارفع كشفاً.', cta: '+ مديونية', onCta: () => entryForm(s, 'invoice') },
    }));
    delegate(root.querySelector('.pt-inv'), {
      edit: (id) => entryForm(s, 'invoice', S().get('invoices', id)),
      del: (id) => { const i = S().get('invoices', id); softDelete('invoices', id, 'الفاتورة ' + (i.no || ''), 'هل تريد حذف هذه المديونية بمبلغ ' + money(i.amount) + '؟ يُعاد توزيع الدفعات على الفواتير الباقية.'); },
    });

    const payRows = pays.map((x) => ({ ...x, projectName: '' }));
    root.querySelector('.pt-pay').appendChild(ui.table({
      id: 'parties-sup-pay', rows: payRows, rowKey: 'id', search: true, searchKeys: ['doc', 'description'],
      columns: [
        { key: 'date', label: 'التاريخ', sort: true, render: (x) => dt(x.date) },
        { key: 'doc', label: 'المستند', sort: true, render: (x) => x.doc ? '<span class="num">' + dg(esc(x.doc)) + '</span>' : '<span class="dash">—</span>' },
        { key: 'description', label: 'البيان', render: (x) => x.description ? esc(x.description) : (x.importId ? '<span class="cap">من كشف مرفوع</span>' : '<span class="cap">يدوي</span>') },
        { key: 'amount', label: 'المبلغ', num: true, sort: true, render: (x) => money(x.amount) },
        { key: '_a', label: '', render: (x) => rowBtns(x.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
      ],
      total: { label: 'الإجمالي', keys: ['amount'] },
      empty: { title: 'لا دفعات', body: 'سجّل دفعة لتُوزَّع على الأقدم أولاً.', cta: '+ دفعة', onCta: () => entryForm(s, 'payment') },
    }));
    delegate(root.querySelector('.pt-pay'), {
      edit: (id) => entryForm(s, 'payment', S().get('payments', id)),
      del: (id) => { const x = S().get('payments', id); softDelete('payments', id, 'الدفعة', 'هل تريد حذف هذه الدفعة بمبلغ ' + money(x.amount) + '؟ سيرتفع رصيد المورد بقيمتها.'); },
    });

    root.addEventListener('click', (e) => {
      const pj = e.target.closest('[data-proj]'); if (pj) { go('project', { id: pj.dataset.proj }); return; }
      const bk = e.target.closest('[data-bk]'); if (bk) { detState.bucket = detState.bucket === bk.dataset.bk ? null : bk.dataset.bk; E.shell.refresh(); return; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      ({
        back: () => go('suppliers'), inv: () => entryForm(s, 'invoice'), pay: () => entryForm(s, 'payment'),
        remind: () => remindModal('supplier', s), stmt: () => exportStatement(s), edit: () => supplierForm(s),
        del: () => deleteSupplier(s.id, () => go('suppliers')),
        paid: () => { detState.showPaid = !detState.showPaid; E.shell.refresh(); },
        'bk-all': () => { detState.bucket = null; E.shell.refresh(); },
      }[a.dataset.a] || (() => {}))();
    });
  }

  /* ManualEntryForm — مديونية أو دفعة مع معاينة الرصيد الجديد */
  function entryForm(s, mode, entry) {
    const isInv = mode === 'invoice'; const isEdit = !!entry;
    const open = (S().supplierPosition(s.id) || {}).open || 0;
    const fields = [
      { name: 'amount', label: 'المبلغ', type: 'money', required: true, value: entry ? entry.amount : '' },
      { name: 'date', label: 'التاريخ', type: 'date', required: true, value: entry ? entry.date : todayIso() },
    ];
    if (isInv) {
      fields.push({ name: 'no', label: 'رقم الفاتورة', type: 'text', value: entry ? entry.no || '' : '' });
      fields.push({ name: 'projectId', label: 'المشروع', type: 'select', value: entry ? entry.projectId || '' : (s.projectIds || [])[0] || '', options: [{ value: '', label: '— بلا مشروع —' }].concat(projects().map((p) => ({ value: p.id, label: p.name }))) });
    } else fields.push({ name: 'doc', label: 'رقم المستند', type: 'text', value: entry ? entry.doc || '' : '' });
    fields.push({ name: 'description', label: 'الوصف', type: 'text', value: entry ? entry.description || '' : '' });
    const body = wrap(errBox + U().form(fields) + (isInv ? '<p class="cap">الاستحقاق يُحسب من مدة المورد ' + (s.termDays == null ? '(غير محدّدة — لن يُحسب تأخر)' : '(' + dg(s.termDays) + ' يوماً)') + '</p>' : '') +
      '<div class="pt-preview" aria-live="polite"></div>');
    U().modal({
      title: isInv ? (isEdit ? 'تعديل مديونية' : 'إضافة مديونية') : (isEdit ? 'تعديل دفعة' : 'تسجيل دفعة'), body, size: 'md',
      onOpen: (root) => {
        const pv = root.querySelector('.pt-preview'); const inp = root.querySelector('[name="amount"]');
        const upd = () => {
          const a = num(inp.value); const old = isEdit ? Number(entry.amount) : 0;
          if (isNaN(a) || a <= 0) { pv.innerHTML = '<div class="cap">الرصيد الحالي</div><div class="pt-pvn">' + money(-open) + ' ' + balanceWord(-open) + '</div>'; return; }
          const delta = (cents(a) - cents(old)) / 100;
          const next = isInv ? (cents(open) + cents(delta)) / 100 : (cents(open) - cents(delta)) / 100;
          pv.innerHTML = '<div class="cap">الرصيد بعد ' + (isInv ? 'المديونية' : 'الدفعة') + '</div><div class="pt-pvn">' + money(-open) + ' ← <b>' + money(-next) + '</b> ' + balanceWord(-next) + '</div>' +
            (!isInv && next < 0 ? '<div class="cap">الدفعة أكبر من المديونية المفتوحة بـ' + money(-next) + ' — سيصبح المورد مديناً لنا.</div>' : '');
        };
        inp.addEventListener('input', upd); upd();
      },
      actions: [
        { label: 'إلغاء', onClick: (close) => close() },
        { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
          const v = U().readForm(root); const a = num(v.amount);
          if (isNaN(a) || a <= 0) return shake(root, 'amount', 'أدخل مبلغاً أكبر من صفر');
          if (!v.date) return shake(root, 'date', 'التاريخ مطلوب');
          const obj = { amount: Math.round(a * 100) / 100, date: v.date, description: String(v.description || '').trim() };
          if (isInv) { obj.no = String(v.no || '').trim(); obj.projectId = v.projectId || null; } else obj.doc = String(v.doc || '').trim();
          const type = isInv ? 'invoices' : 'payments';
          if (isEdit) S().update(type, entry.id, obj);
          else S().create(type, { ...obj, supplierId: s.id, importId: null });
          U().toast(isEdit ? 'حُفظ التعديل' : (isInv ? 'أُضيفت المديونية' : 'سُجّلت الدفعة'), { kind: 'ok' });
          close();
        } },
      ],
    });
  }

  function exportStatement(s) {
    const inv = list('invoices').filter((i) => i.supplierId === s.id).map((i) => ({ date: i.date, doc: i.no, desc: 'فاتورة' + (i.description ? ' — ' + i.description : ''), debit: 0, credit: i.amount }));
    const pay = list('payments').filter((p) => p.supplierId === s.id).map((p) => ({ date: p.date, doc: p.doc, desc: 'دفعة' + (p.description ? ' — ' + p.description : ''), debit: p.amount, credit: 0 }));
    let bal = 0;
    const rows = inv.concat(pay).sort((a, b) => String(a.date).localeCompare(b.date) || b.credit - a.credit).map((r) => { bal += cents(r.debit) - cents(r.credit); return { ...r, balance: bal / 100, dir: bal < 0 ? 'نحن ندين لهم' : bal > 0 ? 'يدينون لنا' : 'متوازن' }; });
    U().exportDialog({ title: 'كشف حساب ' + s.name, fileName: 'كشف-' + s.account + '-' + todayIso() + '.csv',
      csv: S().toCSV(rows, [{ key: 'date', label: 'التاريخ' }, { key: 'doc', label: 'المستند' }, { key: 'desc', label: 'البيان' }, { key: 'debit', label: 'مدين' }, { key: 'credit', label: 'دائن' }, { key: 'balance', label: 'الرصيد' }, { key: 'dir', label: 'الاتجاه' }]) });
  }

  /* RemindModal — مسودة نصية قابلة للتعديل والنسخ، لا تُحفظ */
  function remindModal(kind, party) {
    const isSup = kind === 'supplier';
    let items, total, balance;
    if (isSup) {
      const p = S().supplierPosition(party.id) || {};
      items = (p.invoices || []).filter((i) => i.remaining > 0 && i.lateDays > 0).map((i) => ({ ref: 'فاتورة رقم ' + (i.no || '—'), date: i.date, rem: i.remaining, late: i.lateDays }));
      total = p.overdue || 0; balance = -(p.open || 0);
    } else {
      const p = S().contractorPosition(party.id) || {};
      items = party.termDays == null ? [] : (p.claims || []).filter((c) => c.remaining > 0 && c.lateDays > 0).map((c) => ({ ref: 'مستخلص رقم ' + (c.claimNo || '—'), date: c.date, rem: c.remaining, late: c.lateDays }));
      total = p.overdue || 0; balance = p.balance || 0;
    }
    const f = (n) => U().fmt(n);
    const lines = items.map((x) => '• ' + x.ref + ' بتاريخ ' + x.date + ' — المتبقي ' + f(x.rem) + ' ر.س — تجاوز الاستحقاق بـ' + x.late + ' يوماً').join('\n');
    const balTxt = f(Math.abs(balance)) + ' ر.س ' + (balance < 0 ? '(لصالحكم)' : balance > 0 ? '(لصالحنا)' : '');
    const T = [
      () => 'السادة/ ' + party.name + ' المحترمين،\nالسلام عليكم ورحمة الله وبركاته،\n\n' +
        (items.length ? 'نفيدكم بأن البنود التالية تجاوزت مدة السداد ونعمل على جدولة سدادها:\n' + lines + '\n\nإجمالي المتأخر: ' + f(total) + ' ر.س.\n' : 'نرجو التكرم بمطابقة الرصيد بيننا.\n') +
        'الرصيد حسب سجلاتنا: ' + balTxt + ' حتى ' + todayIso() + '.\nنرجو تزويدنا بكشف حسابكم للمطابقة.\n\nوتقبلوا تحياتنا،\nالإدارة المالية',
      () => 'مرحباً ' + party.name + '،\n' + (items.length ? 'لدينا ' + items.length + ' ' + (isSup ? 'فواتير' : 'مستخلصات') + ' متأخرة بإجمالي ' + f(total) + ' ر.س:\n' + lines + '\n' : '') +
        'رصيدكم لدينا ' + balTxt + '. نرجو إرسال كشف حساب محدّث للمطابقة. شكراً.',
    ];
    let vi = 0;
    const m = U().modal({
      title: 'صياغة مطالبة', size: 'md',
      body: wrap('<p class="cap">مسودة قابلة للتعديل — لا تُحفظ ولا تُرسل من هنا. ' + (items.length ? 'تتضمن ' + dg(items.length) + ' بنداً متأخراً.' : (!isSup && party.termDays == null ? 'المقاول بلا مدة سداد — لا يُحسب تأخر.' : 'لا بنود متأخرة.')) + '</p><textarea class="pt-remind" rows="12" aria-label="نص المطالبة">' + esc(T[0]()) + '</textarea>'),
      actions: [
        { label: 'إعادة الصياغة', onClick: (close, root) => { vi = (vi + 1) % T.length; root.querySelector('textarea').value = T[vi](); } },
        { label: 'إغلاق', onClick: (close) => close() },
        { label: 'نسخ', kind: 'primary', onClick: (close, root) => copyText(root.querySelector('textarea').value, root) },
      ],
    });
    return m;
  }

  /* ═════════════ المقاولون ═════════════ */
  const CSTATUS = { active: ['نشط', 'o'], paused: ['متوقف', 'w'], finished: ['منتهٍ', 'n'], disputed: ['نزاع', 'w'] };
  const KIND = { opening: 'رصيد افتتاحي', claim: 'مستخلص', payment: 'دفعة', retention: 'تأمين محتجز', deduction: 'خصم', invoice: 'فاتورة', other: 'أخرى' };
  const KIND_TONE = { claim: 'w', payment: 'o', retention: 'n', deduction: 'n', opening: 'n', invoice: 'n', other: 'n' };
  const KIND_SIDE = { opening: 'credit', claim: 'credit', invoice: 'credit', payment: 'debit', retention: 'debit', deduction: 'debit', other: 'debit' };
  const conState = { view: 'list', dir: '', project: '' };
  const NOTERM = '<span class="dash" title="مدة السداد غير محدّدة — اضبطها في بطاقة المقاول">—</span>';

  function contractorRows() {
    return list('contractors').map((k) => {
      const p = S().contractorPosition(k.id) || {};
      const bal = p.balance || 0;
      return { ...k, balance: bal, owed: p.owed || 0, overdue: k.termDays == null ? null : (p.overdue || 0), overdueSort: k.termDays == null ? -1 : (p.overdue || 0),
        dir: bal < 0 ? 'we' : bal > 0 ? 'they' : 'zero', termKey: k.termDays == null ? 'none' : 'set',
        projNames: (k.projectIds || []).map(projName).filter(Boolean).join('، '),
        lateClaims: (p.claims || []).filter((c) => c.remaining > 0 && c.lateDays > 0).length };
    });
  }

  function renderContractors(c) {
    const ui = U(); const t = S().totals();
    let rows = contractorRows();
    if (conState.dir) rows = rows.filter((r) => r.dir === conState.dir);
    if (conState.project) rows = rows.filter((r) => (r.projectIds || []).includes(conState.project));
    rows.sort((a, b) => b.overdueSort - a.overdueSort || a.balance - b.balance);
    const all = contractorRows();
    const noTerm = all.filter((r) => r.termDays == null);
    c.innerHTML = wrap(
      '<div class="ph"><div><h1>المقاولون</h1><p>' + dg(all.length) + ' مقاولين · مرتّبون بالمتأخر ' + SAMPLE + '</p></div><div class="acts">' +
      '<div class="seg" role="group" aria-label="العرض"><button aria-pressed="' + (conState.view === 'list') + '" data-view="list">القائمة</button><button aria-pressed="' + (conState.view === 'proj') + '" data-view="proj">حسب المشروع</button></div>' +
      (noTerm.length ? '<button class="btn" data-a="bulk">مدة افتراضية…</button>' : '') +
      '<button class="btn" data-a="export">تصدير</button><button class="btn primary" data-a="add">+ مقاول</button></div></div>' +
      '<div class="grid">' +
      '<section class="isl c4" style="--i:0">' + ui.kpi({ label: 'المديونية المفتوحة للمقاولين', value: t.contractorOwed, money: true, hint: 'ما ندين به لهم' }) + '</section>' +
      '<section class="isl c4 crit" style="--i:1">' + ui.kpi({ label: 'متأخر', value: t.contractorOverdue, money: true, tone: 'danger', hint: 'لـ' + dg(t.withTerm) + ' مقاولين لهم مدة سداد' }) + '</section>' +
      '<section class="isl c4" style="--i:2">' + ui.kpi({ label: 'بلا مدة سداد', value: t.withoutTerm, money: false, hint: 'تأخرهم غير محسوب — لا نخترع رقماً' }) + '</section>' +
      '<section class="isl c12" style="--i:3"><div class="pt-xfil">' +
        '<label><span>الاتجاه</span><select data-f="dir"><option value="">الكل</option><option value="we"' + (conState.dir === 'we' ? ' selected' : '') + '>نحن ندين لهم</option><option value="they"' + (conState.dir === 'they' ? ' selected' : '') + '>يدينون لنا</option><option value="zero"' + (conState.dir === 'zero' ? ' selected' : '') + '>متوازن</option></select></label>' +
        '<label><span>المشروع</span><select data-f="project"><option value="">كل المشاريع</option>' + projects().map((p) => '<option value="' + esc(p.id) + '"' + (conState.project === p.id ? ' selected' : '') + '>' + esc(p.name) + '</option>').join('') + '</select></label>' +
      '</div><div class="pt-tbl"></div>' +
      (noTerm.length ? '<p class="disclose">' + dg(noTerm.length) + ' مقاولين بلا مدة سداد — تأخرهم غير محسوب ويظهر «—». اضبط المدة من بطاقة المقاول أو بـ«مدة افتراضية».</p>' : '') +
      '</section></div>');
    const root = c.querySelector('.sec-parties');
    const box = root.querySelector('.pt-tbl');
    if (conState.view === 'proj') box.appendChild(projectGroups(rows));
    else {
      box.appendChild(ui.table({
        id: 'parties-contractors', rows, rowKey: 'id', search: true, searchKeys: ['name', 'code', 'projNames', 'statusNote'], columnMenu: true,
        onRowClick: (r) => go('contractor', { id: r.id }),
        filters: [
          { key: 'status', label: 'الحالة', options: opt(Object.entries(CSTATUS).map(([k, v]) => [k, v[0]])) },
          { key: 'termKey', label: 'مدة السداد', options: opt([['set', 'محدّدة'], ['none', 'غير محدّدة']]) },
        ],
        columns: [
          { key: 'name', label: 'المقاول', sort: true, render: (r) => '<b>' + esc(r.name) + '</b><div class="cap"><span class="num">' + dg(esc(r.code)) + '</span></div>' },
          { key: 'projNames', label: 'المشروع', sort: true, render: (r) => r.projNames ? esc(r.projNames) : '<span class="dash">—</span>' },
          { key: 'status', label: 'الحالة', sort: true, render: (r) => { const s = CSTATUS[r.status] || [r.status, 'n']; return '<span class="pill ' + s[1] + '"' + (r.statusNote ? ' title="' + esc(r.statusNote) + '"' : '') + '>' + esc(s[0]) + '</span>'; } },
          { key: 'termDays', label: 'مدة السداد', sort: true, render: (r) => r.termDays == null ? '<span class="pill n" title="اضبط مدة السداد في بطاقة المقاول">غير محدّدة</span>' : '<span class="num">' + dg(r.termDays) + '</span> يوماً' },
          { key: 'retentionRate', label: 'نسبة التأمين', num: true, sort: true, render: (r) => r.retentionRate ? '<span class="num">' + dg(r.retentionRate) + '</span>٪' : '<span class="dash">—</span>' },
          { key: 'overdueSort', label: 'متأخر', num: true, sort: true, render: (r) => r.overdue == null ? NOTERM : r.overdue > 0 ? money(r.overdue, 't-danger') + '<div class="cap">' + dg(r.lateClaims) + ' مستخلص</div>' : money(0) },
          { key: 'balance', label: 'الرصيد', num: true, sort: true, render: (r) => money(r.balance) + '<div class="cap">' + (r.balance < 0 ? 'نحن ندين لهم' : r.balance > 0 ? 'يدينون لنا' : 'متوازن') + '</div>' },
          { key: '_a', label: '', render: (r) => rowBtns(r.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
        ],
        total: { label: 'الإجمالي', keys: ['balance'] },
        empty: { title: 'لا مقاولين مطابقين', body: 'غيّر التصفية أو أضف مقاولاً.', cta: '+ مقاول', onCta: () => contractorForm() },
      }));
      delegate(box, { edit: (id) => contractorForm(S().get('contractors', id)), del: (id) => deleteContractor(id) });
    }
    root.addEventListener('click', (e) => {
      const v = e.target.closest('[data-view]'); if (v) { conState.view = v.dataset.view; E.shell.refresh(); return; }
      const g = e.target.closest('[data-goc]'); if (g) { go('contractor', { id: g.dataset.goc }); return; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'add') contractorForm();
      else if (a.dataset.a === 'bulk') bulkTerm();
      else if (a.dataset.a === 'export') U().exportDialog({ title: 'تصدير المقاولين', fileName: 'المقاولون-' + todayIso() + '.csv',
        csv: S().toCSV(rows.map((r) => ({ ...r, st: (CSTATUS[r.status] || [r.status])[0], term: r.termDays == null ? 'غير محدّدة' : r.termDays, od: r.overdue == null ? 'غير محسوب' : r.overdue, dirTxt: r.balance < 0 ? 'نحن ندين لهم' : r.balance > 0 ? 'يدينون لنا' : 'متوازن' })), [
          { key: 'code', label: 'الحساب' }, { key: 'name', label: 'المقاول' }, { key: 'projNames', label: 'المشاريع' }, { key: 'st', label: 'الحالة' }, { key: 'term', label: 'مدة السداد' },
          { key: 'od', label: 'متأخر' }, { key: 'balance', label: 'الرصيد' }, { key: 'dirTxt', label: 'الاتجاه' }]) });
    });
    root.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => { conState[el.dataset.f] = el.value; E.shell.refresh(); }));
  }

  function projectGroups(rows) {
    const g = new Map();
    rows.forEach((r) => { const ids = (r.projectIds || []).length ? r.projectIds : ['']; ids.forEach((id) => { if (!g.has(id)) g.set(id, []); g.get(id).push(r); }); });
    const groups = [...g.entries()].map(([id, rs]) => ({ id, name: id ? projName(id) || '—' : 'بلا مشروع', rs, owed: sumC(rs, (r) => Math.max(0, -r.balance)), overdue: sumC(rs, (r) => r.overdue || 0), noTerm: rs.filter((r) => r.overdue == null).length }))
      .sort((a, b) => b.overdue - a.overdue || b.owed - a.owed);
    const el = document.createElement('div'); el.className = 'pt-groups';
    el.innerHTML = '<p class="cap">المقاول متعدد المشاريع يظهر تحت كل مشروع — لذا لا تُجمع المجموعات.</p>' + groups.map((gr) => '<details class="pt-grp"><summary><b>' + esc(gr.name) + '</b><span class="cap">' + dg(gr.rs.length) + ' مقاولين</span>' +
      '<span class="pt-gs">متأخر ' + money(gr.overdue, gr.overdue ? 't-danger' : '') + (gr.noTerm ? ' <span class="cap">(+' + dg(gr.noTerm) + ' غير محسوب)</span>' : '') + '</span><span class="pt-gs">نحن ندين ' + money(gr.owed) + '</span></summary>' +
      '<div class="tbl-wrap"><table><tbody>' + gr.rs.map((r) => '<tr class="click" data-goc="' + esc(r.id) + '"><td>' + esc(r.name) + '</td><td class="n">' + (r.overdue == null ? NOTERM : money(r.overdue, r.overdue ? 't-danger' : '')) + '</td><td class="n">' + money(r.balance) + '</td></tr>').join('') + '</tbody></table></div></details>').join('');
    return el;
  }

  function bulkTerm() {
    const n = list('contractors').filter((k) => k.termDays == null);
    U().modal({
      title: 'مدة سداد افتراضية', size: 'md',
      body: wrap(errBox + '<p>تُطبَّق على ' + dg(n.length) + ' مقاولين بلا مدة فقط — لا تغيّر من ضُبطت مدته.</p>' + U().form([{ name: 'term', label: 'مدة السداد (يوم)', type: 'number', min: 0, max: 365, required: true, value: 30 }])),
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'تطبيق', kind: 'primary', onClick: (close, root) => {
        const v = num(U().readForm(root).term);
        if (isNaN(v) || v < 0 || v > 365 || v % 1) return shake(root, 'term', 'عدد أيام صحيح بين ٠ و٣٦٥');
        n.forEach((k) => S().update('contractors', k.id, { termDays: v }));
        U().toast('ضُبطت المدة لـ' + dg(n.length) + ' مقاولين', { kind: 'ok', undo: () => n.forEach((k) => S().update('contractors', k.id, { termDays: null })) });
        close();
      } }],
    });
  }

  function contractorForm(k) {
    const isEdit = !!k;
    const body = wrap(errBox + U().form([
      { name: 'code', label: 'رقم الحساب', type: 'text', required: true, value: k ? k.code : '212', help: 'يبدأ بـ212 ولا يتكرر' },
      { name: 'name', label: 'اسم المقاول', type: 'text', required: true, value: k ? k.name : '' },
      { name: 'termDays', label: 'مدة السداد (يوم)', type: 'number', min: 0, max: 365, value: k && k.termDays != null ? k.termDays : '', help: 'اختيارية — فارغة تعني «غير محدّدة» فلا يُحسب تأخر' },
      { name: 'retentionRate', label: 'نسبة التأمين المحتجز ٪', type: 'number', min: 0, max: 100, value: k ? k.retentionRate || 0 : 10 },
      { name: 'status', label: 'الحالة', type: 'select', value: k ? k.status : 'active', options: Object.entries(CSTATUS).map(([v, l]) => ({ value: v, label: l[0] })) },
      { name: 'statusNote', label: 'ملاحظة الحالة', type: 'text', value: k ? k.statusNote || '' : '', help: 'مطلوبة عند «نزاع» أو «متوقف»' },
      { name: 'phone', label: 'الهاتف', type: 'text', value: k ? k.phone || '' : '' },
      { name: 'notes', label: 'ملاحظات', type: 'textarea', value: k ? k.notes || '' : '' },
    ]) + projectPicker(k ? k.projectIds : []));
    U().modal({
      title: isEdit ? 'تعديل مقاول' : 'إضافة مقاول', body, size: 'md', onOpen: wireProjectPicker,
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
        const v = U().readForm(root);
        const code = String(v.code || '').trim().replace(/[٠-٩]/g, (ch) => '٠١٢٣٤٥٦٧٨٩'.indexOf(ch));
        if (!/^212\d+$/.test(code)) return shake(root, 'code', 'رقم حساب المقاول يجب أن يبدأ بـ212 وأرقاماً فقط');
        if (list('contractors').some((x) => x.code === code && (!k || x.id !== k.id))) return shake(root, 'code', 'رقم الحساب مستخدم لمقاول آخر');
        const name = String(v.name || '').trim(); if (!name) return shake(root, 'name', 'اسم المقاول مطلوب');
        const term = v.termDays === '' || v.termDays == null ? null : num(v.termDays);
        if (term != null && (isNaN(term) || term < 0 || term > 365 || term % 1)) return shake(root, 'termDays', 'المدة عدد صحيح بين ٠ و٣٦٥، أو اتركها فارغة');
        const rr = v.retentionRate === '' ? 0 : num(v.retentionRate);
        if (isNaN(rr) || rr < 0 || rr > 100) return shake(root, 'retentionRate', 'النسبة بين ٠ و١٠٠');
        const note = String(v.statusNote || '').trim();
        if ((v.status === 'disputed' || v.status === 'paused') && !note) return shake(root, 'statusNote', 'اكتب سبب الحالة');
        const obj = { code, name, termDays: term, retentionRate: rr, status: v.status || 'active', statusNote: note, phone: String(v.phone || '').trim(), notes: String(v.notes || '').trim(), projectIds: readProjects(root) };
        if (isEdit) { S().update('contractors', k.id, obj); U().toast('حُفظ المقاول', { kind: 'ok' }); close(); }
        else { const n = S().create('contractors', obj); U().toast('أُضيف المقاول ' + name, { kind: 'ok' }); close(); if (n && n.id) go('contractor', { id: n.id }); }
      } }],
    });
  }

  function deleteContractor(id, after) {
    const k = S().get('contractors', id); if (!k) return;
    const n = list('contractorEntries').filter((e) => e.contractorId === id).length;
    softDelete('contractors', id, 'المقاول «' + k.name + '»', esc(k.name) + (n ? ' ومعه ' + dg(n) + ' حركة ستُنقل إلى «المحذوفات» ويمكن استرجاعها.' : ' سيُنقل إلى «المحذوفات».'), after);
  }

  /* ═════════════ كشف المقاول ═════════════ */
  const cdState = { kind: '', project: '' };

  function renderContractor(c, params) {
    const ui = U(); const k = params && params.id && S().get('contractors', params.id);
    if (!k || k.deletedAt) {
      c.innerHTML = wrap('<div class="ph"><div><button class="crumb" data-a="back">→ المقاولون</button><h1>المقاول غير موجود</h1><p>ربما حُذف — ابحث عنه في «المحذوفات».</p></div></div>');
      c.querySelector('[data-a="back"]').onclick = () => go('contractors');
      return;
    }
    const p = S().contractorPosition(k.id) || {};
    const ents = list('contractorEntries').filter((e) => e.contractorId === k.id).sort((a, b) => String(a.date).localeCompare(b.date) || (a.kind === 'opening' ? -1 : 0));
    let run = 0;
    const ledger = ents.map((e) => { const prev = run; run += cents(e.debit) - cents(e.credit); return { ...e, kindTxt: KIND[e.kind] || e.kind, projectName: projName(e.projectId), running: run / 100, flip: Math.sign(prev) !== Math.sign(run) && prev !== 0 }; });
    const byKind = (kd, side) => sumC(ents.filter((e) => e.kind === kd), (e) => e[side]);
    const claimsT = byKind('claim', 'credit') + byKind('invoice', 'credit');
    const paidT = byKind('payment', 'debit'), retT = byKind('retention', 'debit'), dedT = byKind('deduction', 'debit'), openT = sumC(ents.filter((e) => e.kind === 'opening'), (e) => cents(e.credit) - cents(e.debit)) ;
    const st = CSTATUS[k.status] || [k.status, 'n'];
    const claims = (p.claims || []).map((cl) => ({ ...cl, projectName: projName(cl.projectId) }));
    const gts = list('guarantees').filter((g) => g.contractorId === k.id);
    // توزيع المستخلصات على المشاريع
    const pm = new Map(); ents.filter((e) => e.kind === 'claim' || e.kind === 'invoice').forEach((e) => pm.set(e.projectId || '', (pm.get(e.projectId || '') || 0) + cents(e.credit)));
    const pTot = [...pm.values()].reduce((a, b) => a + b, 0) || 1;
    const lastE = ents[ents.length - 1];
    let shownLedger = ledger;
    if (cdState.kind) shownLedger = shownLedger.filter((e) => e.kind === cdState.kind);
    if (cdState.project) shownLedger = shownLedger.filter((e) => (e.projectId || '') === cdState.project);

    c.innerHTML = wrap(
      '<div class="ph"><div><button class="crumb" data-a="back">→ المقاولون</button><h1>' + esc(k.name) + '</h1>' +
      '<p><span class="num">' + dg(esc(k.code)) + '</span> · <span class="pill ' + st[1] + '">' + esc(st[0]) + '</span>' + (k.statusNote ? ' <span class="cap">' + esc(k.statusNote) + '</span>' : '') + ' ' + SAMPLE + '</p></div>' +
      '<div class="acts"><button class="btn sm" data-a="entry">+ حركة</button><button class="btn sm" data-a="claim">+ مستخلص</button><button class="btn sm" data-a="gt">+ ضمان</button>' +
      '<button class="btn sm" data-a="status">تغيير الحالة</button><button class="btn sm" data-a="remind">صياغة مطالبة</button><button class="btn sm" data-a="stmt">تصدير الكشف</button>' +
      '<button class="btn sm" data-a="edit">تعديل</button><button class="btn sm" data-a="del">حذف</button></div></div>' +
      '<div class="grid">' +
      '<section class="isl c12" style="--i:0"><div class="sum pt-sum6">' +
        '<div><div class="cap">الرصيد الحالي</div><div class="kpi">' + ui.counted(p.balance || 0) + '</div>' + balanceWord(p.balance || 0) + '</div>' +
        '<div><div class="cap">المستخلصات</div><div class="kpi pt-ks">' + money(claimsT) + '</div>' + (openT ? '<div class="cap">+ رصيد افتتاحي ' + money(openT) + '</div>' : '') + '</div>' +
        '<div><div class="cap">المدفوع</div><div class="kpi pt-ks">' + money(paidT) + '</div></div>' +
        '<div><div class="cap">التأمين المحتجز</div><div class="kpi pt-ks">' + money(retT) + '</div><div class="cap">' + (k.retentionRate ? dg(k.retentionRate) + '٪ من المستخلص' : 'بلا نسبة') + '</div></div>' +
        '<div><div class="cap">الخصومات</div><div class="kpi pt-ks">' + money(dedT) + '</div></div>' +
        '<div><div class="cap">متأخر</div><div class="kpi pt-ks ' + (p.overdue > 0 ? 't-danger' : '') + '">' + (k.termDays == null ? NOTERM : money(p.overdue || 0)) + '</div><div class="cap">' + (k.termDays == null ? 'مدة السداد غير محدّدة — <button class="pt-link" data-a="edit">اضبطها</button>' : 'مدة السداد ' + dg(k.termDays) + ' يوماً') + '</div></div>' +
      '</div>' + (claimsT === 0 && openT !== 0 ? '<p class="disclose">الرصيد من رصيد افتتاحي فقط — لا مستخلصات مسجّلة بعد، فأصفار المستخلصات والمدفوع لا تعني «لا شيء».</p>' : '') +
      (lastE ? '<p class="disclose">آخر حركة ' + dt(lastE.date) + '</p>' : '') + '</section>' +
      '<section class="isl c12" style="--i:1"><div class="ih"><h2>المستخلصات</h2><span class="cap">' + (k.termDays == null ? 'الاستحقاق والتأخر غير محسوبين — المقاول بلا مدة سداد' : 'الاستحقاق = تاريخ المستخلص + ' + dg(k.termDays) + ' يوماً · الأقدم يُسدَّد أولاً') + '</span></div><div class="pt-claims"></div></section>' +
      '<section class="isl c8" style="--i:2"><div class="ih"><h2>الحركات</h2><span class="cap">الرصيد الجاري: سالب = نحن ندين لهم</span></div>' +
        '<div class="pt-xfil"><label><span>المشروع</span><select data-f="project"><option value="">كل المشاريع</option>' + [...pm.keys()].concat(ents.map((e) => e.projectId || '')).filter((v, i, a) => v && a.indexOf(v) === i).map((id) => '<option value="' + esc(id) + '"' + (cdState.project === id ? ' selected' : '') + '>' + esc(projName(id) || '—') + '</option>').join('') + '</select></label>' +
        '<div class="pt-kinds">' + ['', ...Object.keys(KIND)].filter((kd) => !kd || ents.some((e) => e.kind === kd)).map((kd) => '<button class="chip" data-kind="' + kd + '" aria-pressed="' + (cdState.kind === kd) + '">' + (kd ? KIND[kd] : 'الكل') + '</button>').join('') + '</div></div>' +
        '<div class="pt-ledger"></div></section>' +
      '<section class="isl c4" style="--i:3"><div class="ih"><h2>المشاريع</h2><span class="cap">حصة المستخلصات</span></div>' +
        (pm.size ? '<div class="pt-bars">' + [...pm.entries()].sort((a, b) => b[1] - a[1]).map(([id, v], i) => { const pct = Math.round(v / pTot * 100); return '<button class="pt-bar" ' + (id ? 'data-proj="' + esc(id) + '"' : 'disabled') + ' style="--i:' + i + '"><span class="pt-bl">' + esc(id ? projName(id) || '—' : 'بلا مشروع') + '</span><span class="pt-bt"><span style="--p:' + (v / pTot).toFixed(3) + '"></span></span><span class="num">' + dg(pct) + '٪</span></button>'; }).join('') + '</div>' : '<p class="disclose">لا مستخلصات بعد.</p>') +
        '<div class="ih pt-gh"><h2>الضمانات</h2><span class="cap">' + dg(gts.filter((g) => !g.returnedAt).length) + ' سارية</span></div><div class="pt-cg"></div></section>' +
      '</div>');
    const root = c.querySelector('.sec-parties');

    root.querySelector('.pt-claims').appendChild(ui.table({
      id: 'parties-con-claims', rows: claims, rowKey: 'id', search: true, searchKeys: ['claimNo', 'description', 'projectName'],
      columns: [
        { key: 'claimNo', label: 'المستخلص', sort: true, render: (x) => 'رقم <span class="num">' + dg(esc(x.claimNo || '—')) + '</span>' + (x.description ? '<div class="cap">' + esc(x.description) + '</div>' : '') },
        { key: 'date', label: 'التاريخ', sort: true, render: (x) => dt(x.date) },
        { key: 'dueDate', label: 'الاستحقاق', sort: true, render: (x) => x.dueDate ? dt(x.dueDate) : NOTERM },
        { key: 'projectName', label: 'المشروع', render: (x) => x.projectName ? esc(x.projectName) : '<span class="dash">—</span>' },
        { key: 'credit', label: 'المبلغ', num: true, sort: true, render: (x) => money(x.credit) },
        { key: 'remaining', label: 'المتبقي', num: true, sort: true, render: (x) => x.remaining > 0 ? money(x.remaining, x.lateDays > 0 ? 't-danger' : '') : '<span class="pill o">مسدَّد</span>' },
        { key: 'lateDays', label: 'التأخر', sort: true, render: (x) => x.remaining <= 0 ? '' : k.termDays == null ? '<span class="pill n" title="بلا مدة سداد لا يُحسب تأخر">غير محسوب</span>' : x.lateDays > 0 ? '<span class="pill d"><span class="num">' + dg(x.lateDays) + '</span> يوماً</span>' : '<span class="pill n">لم يحن</span>' },
        { key: '_a', label: '', render: (x) => rowBtns(x.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
      ],
      total: { label: 'الإجمالي', keys: ['credit', 'remaining'] },
      empty: { title: 'لا مستخلصات بعد', body: 'أضف مستخلصاً أو ارفع كشف الحساب.', cta: '+ مستخلص', onCta: () => conEntryForm(k, null, 'claim') },
    }));
    const entryActs = { edit: (id) => conEntryForm(k, S().get('contractorEntries', id)), del: (id) => { const e = S().get('contractorEntries', id); softDelete('contractorEntries', id, 'الحركة', 'حذف ' + esc(KIND[e.kind] || '') + ' بمبلغ ' + money(e.debit || e.credit) + ' بتاريخ ' + dt(e.date) + '؟'); } };
    delegate(root.querySelector('.pt-claims'), entryActs);

    root.querySelector('.pt-ledger').appendChild(ui.table({
      id: 'parties-con-ledger', rows: shownLedger, rowKey: 'id', search: true, searchKeys: ['description', 'claimNo', 'kindTxt'], columnMenu: true,
      columns: [
        { key: 'date', label: 'التاريخ', sort: true, render: (e) => dt(e.date) },
        { key: 'kind', label: 'النوع', render: (e) => '<span class="pill ' + (KIND_TONE[e.kind] || 'n') + '">' + esc(e.kindTxt) + '</span>' },
        { key: 'description', label: 'البيان', render: (e) => esc(e.description || '') + (e.claimNo ? ' <span class="cap">مستخلص <span class="num">' + dg(esc(e.claimNo)) + '</span></span>' : '') + (e.projectName ? '<div class="cap">' + esc(e.projectName) + '</div>' : '') },
        { key: 'debit', label: 'مدين', num: true, sort: true, render: (e) => e.debit ? money(e.debit) : '<span class="dash">—</span>' },
        { key: 'credit', label: 'دائن', num: true, sort: true, render: (e) => e.credit ? money(e.credit) : '<span class="dash">—</span>' },
        { key: 'running', label: 'الرصيد', num: true, render: (e) => '<span class="' + (e.flip ? 'pt-flip' : '') + '">' + money(e.running) + '</span>' },
        { key: '_a', label: '', render: (e) => rowBtns(e.id, [['edit', 'تعديل', IC.edit], ['del', 'حذف', IC.del]]) },
      ],
      total: { label: 'الإجمالي', keys: ['debit', 'credit'] },
      empty: { title: 'لا حركات', body: 'أضف حركة يدوية.', cta: '+ حركة', onCta: () => conEntryForm(k) },
    }));
    delegate(root.querySelector('.pt-ledger'), entryActs);

    renderGuaranteeList(root.querySelector('.pt-cg'), gts, true);

    root.addEventListener('click', (e) => {
      const pj = e.target.closest('[data-proj]'); if (pj) { go('project', { id: pj.dataset.proj }); return; }
      const kd = e.target.closest('[data-kind]'); if (kd) { cdState.kind = kd.dataset.kind; E.shell.refresh(); return; }
      const a = e.target.closest('[data-a]'); if (!a) return;
      ({
        back: () => go('contractors'), entry: () => conEntryForm(k), claim: () => conEntryForm(k, null, 'claim'), gt: () => guaranteeForm(null, k.id),
        status: () => statusModal(k), remind: () => remindModal('contractor', k), stmt: () => exportConStatement(k, ledger), edit: () => contractorForm(k),
        del: () => deleteContractor(k.id, () => go('contractors')),
      }[a.dataset.a] || (() => {}))();
    });
    root.querySelectorAll('[data-f]').forEach((el) => el.addEventListener('change', () => { cdState[el.dataset.f] = el.value; E.shell.refresh(); }));
  }

  function exportConStatement(k, ledger) {
    U().exportDialog({ title: 'كشف حساب ' + k.name, fileName: 'كشف-' + k.code + '-' + todayIso() + '.csv',
      csv: S().toCSV(ledger.map((e) => ({ ...e, dir: e.running < 0 ? 'نحن ندين لهم' : e.running > 0 ? 'يدينون لنا' : 'متوازن' })), [
        { key: 'date', label: 'التاريخ' }, { key: 'kindTxt', label: 'النوع' }, { key: 'claimNo', label: 'رقم المستخلص' }, { key: 'description', label: 'البيان' },
        { key: 'debit', label: 'مدين' }, { key: 'credit', label: 'دائن' }, { key: 'running', label: 'الرصيد' }, { key: 'dir', label: 'الاتجاه' }]) });
  }

  function statusModal(k) {
    U().modal({
      title: 'تغيير حالة المقاول', size: 'md',
      body: wrap(errBox + U().form([
        { name: 'status', label: 'الحالة', type: 'select', value: k.status, options: Object.entries(CSTATUS).map(([v, l]) => ({ value: v, label: l[0] })) },
        { name: 'statusNote', label: 'السبب / الملاحظة', type: 'text', value: k.statusNote || '' },
      ])),
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
        const v = U().readForm(root); const note = String(v.statusNote || '').trim();
        if ((v.status === 'disputed' || v.status === 'paused') && !note) return shake(root, 'statusNote', 'اكتب سبب الحالة');
        const prev = { status: k.status, statusNote: k.statusNote };
        S().update('contractors', k.id, { status: v.status, statusNote: note });
        U().toast('صارت الحالة «' + CSTATUS[v.status][0] + '»', { kind: 'ok', undo: () => S().update('contractors', k.id, prev) });
        close();
      } }],
    });
  }

  function conEntryForm(k, e, presetKind) {
    const isEdit = !!e;
    const kind = e ? e.kind : presetKind || 'payment';
    const side = e ? (e.debit ? 'debit' : 'credit') : KIND_SIDE[kind];
    const pOpts = [{ value: '', label: '— بلا مشروع —' }].concat(projects().map((p) => ({ value: p.id, label: p.name })));
    const bal = (S().contractorPosition(k.id) || {}).balance || 0;
    U().modal({
      title: isEdit ? 'تعديل حركة' : (kind === 'claim' ? 'إضافة مستخلص' : 'إضافة حركة'), size: 'md',
      body: wrap(errBox + U().form([
        { name: 'kind', label: 'النوع', type: 'select', value: kind, options: Object.entries(KIND).map(([v, l]) => ({ value: v, label: l })) },
        { name: 'date', label: 'التاريخ', type: 'date', required: true, value: e ? e.date : todayIso() },
        { name: 'side', label: 'الجانب', type: 'select', value: side, options: [{ value: 'credit', label: 'دائن — يزيد ما ندين به' }, { value: 'debit', label: 'مدين — ينقص ما ندين به' }] },
        { name: 'amount', label: 'المبلغ', type: 'money', required: true, value: e ? (e.debit || e.credit) : '' },
        { name: 'claimNo', label: 'رقم المستخلص', type: 'text', value: e ? e.claimNo || '' : '' },
        { name: 'projectId', label: 'المشروع', type: 'select', value: e ? e.projectId || '' : (k.projectIds || [])[0] || '', options: pOpts },
        { name: 'description', label: 'البيان', type: 'text', value: e ? e.description || '' : '' },
      ]) + '<div class="pt-preview" aria-live="polite"></div><div class="pt-retn"></div>'),
      onOpen: (root) => {
        const kS = root.querySelector('[name="kind"]'), sS = root.querySelector('[name="side"]'), aI = root.querySelector('[name="amount"]');
        const cn = root.querySelector('[name="claimNo"]'); const cnBox = cn && (cn.closest('label,.field,.f-row') || cn);
        const pv = root.querySelector('.pt-preview'), rt = root.querySelector('.pt-retn');
        const upd = () => {
          if (cnBox) cnBox.hidden = kS.value !== 'claim' && kS.value !== 'retention';
          const a = num(aI.value);
          const old = isEdit ? cents(e.debit) - cents(e.credit) : 0;
          const d = isNaN(a) || a <= 0 ? 0 : (sS.value === 'debit' ? cents(a) : -cents(a));
          const next = (cents(bal) - old + d) / 100;
          pv.innerHTML = '<div class="cap">الرصيد ' + (d ? 'بعد الحركة' : 'الحالي') + '</div><div class="pt-pvn">' + money(bal) + (d ? ' ← <b>' + money(next) + '</b>' : '') + ' ' + balanceWord(d ? next : bal) + '</div>';
          rt.innerHTML = kS.value === 'claim' && k.retentionRate && !isNaN(a) && a > 0 && !isEdit
            ? '<label class="pt-pchk"><input type="checkbox" name="__ret" checked> أضف قيد تأمين محتجز ' + dg(k.retentionRate) + '٪ = ' + money(Math.round(a * k.retentionRate) / 100) + '</label>' : '';
        };
        kS.addEventListener('change', () => { sS.value = KIND_SIDE[kS.value] || 'debit'; upd(); });
        [sS, aI].forEach((x) => x.addEventListener('input', upd)); sS.addEventListener('change', upd);
        upd();
      },
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
        const v = U().readForm(root); const a = num(v.amount);
        if (!v.date) return shake(root, 'date', 'التاريخ مطلوب');
        if (isNaN(a) || a <= 0) return shake(root, 'amount', 'أدخل مبلغاً أكبر من صفر');
        const amt = Math.round(a * 100) / 100;
        const obj = { kind: v.kind, date: v.date, debit: v.side === 'debit' ? amt : 0, credit: v.side === 'credit' ? amt : 0, claimNo: String(v.claimNo || '').trim(), projectId: v.projectId || null, description: String(v.description || '').trim() || KIND[v.kind] };
        if (isEdit) S().update('contractorEntries', e.id, obj);
        else {
          S().create('contractorEntries', { ...obj, contractorId: k.id, importId: null });
          const rc = root.querySelector('[name="__ret"]');
          if (rc && rc.checked && v.kind === 'claim') S().create('contractorEntries', { contractorId: k.id, kind: 'retention', date: v.date, claimNo: obj.claimNo, debit: Math.round(amt * k.retentionRate) / 100, credit: 0, projectId: obj.projectId, description: 'تأمين محتجز ' + k.retentionRate + '٪ من المستخلص ' + obj.claimNo, importId: null });
        }
        U().toast(isEdit ? 'حُفظ التعديل' : 'أُضيفت الحركة', { kind: 'ok' });
        close();
      } }],
    });
  }

  /* ═════════════ الضمانات ═════════════ */
  const GTYPES = ['ضمان حسن تنفيذ', 'ضمان دفعة مقدمة', 'ضمان ابتدائي', 'ضمان نهائي', 'ضمان أعمال'];
  function gState(g) {
    if (g.returnedAt) return { key: 'returned', pill: '<span class="pill n">مُعاد ' + dt(g.returnedAt) + '</span>', days: null };
    const d = daysBetween(S().TODAY, g.expiryDate);
    if (d < 0) return { key: 'expired', pill: '<span class="pill d">منتهٍ منذ <span class="num">' + dg(-d) + '</span> يوماً</span>', days: d };
    if (d <= 30) return { key: 'soon', pill: '<span class="pill w">ينتهي خلال <span class="num">' + dg(d) + '</span> يوماً</span>', days: d };
    return { key: 'active', pill: '<span class="pill o">ساري</span>', days: d };
  }
  const conName = (id) => { const k = id && S().get('contractors', id); return k ? k.name + (k.deletedAt ? ' (محذوف)' : '') : '—'; };

  function guaranteeRows(arr) {
    return arr.map((g) => { const s = gState(g); return { ...g, stateKey: s.key, statePill: s.pill, daysLeft: s.days, contractorName: conName(g.contractorId), projectName: projName(g.projectId), expirySort: g.returnedAt ? '9999' + g.expiryDate : g.expiryDate }; })
      .sort((a, b) => String(a.expirySort).localeCompare(b.expirySort));
  }
  const gtActs = (g) => rowBtns(g.id, [['edit', 'تعديل', IC.edit]].concat(g.returnedAt ? [['unret', 'إلغاء الإعادة', IC.ret]] : [['ret', 'تسجيل الإعادة', IC.ret]]).concat([['del', 'حذف', IC.del]]));
  const gtHandlers = {
    edit: (id) => guaranteeForm(S().get('guarantees', id)),
    ret: (id) => returnGuarantee(id),
    unret: (id) => { S().update('guarantees', id, { returnedAt: null }); U().toast('أُلغي تسجيل الإعادة', { kind: 'ok', undo: () => S().update('guarantees', id, { returnedAt: todayIso() }) }); },
    del: (id) => { const g = S().get('guarantees', id); softDelete('guarantees', id, 'الضمان', esc(g.type) + ' بمبلغ ' + money(g.amount) + ' — ' + esc(conName(g.contractorId))); },
  };

  function renderGuaranteeList(box, gts, compact) {
    const rows = guaranteeRows(gts);
    if (!rows.length) { box.innerHTML = '<p class="disclose">لا ضمانات مسجّلة.</p>'; return; }
    box.innerHTML = '<ul class="pt-glist">' + rows.map((g) => '<li><div><b>' + esc(g.type) + '</b> ' + g.statePill + '<div class="cap">' + (g.projectName ? esc(g.projectName) + ' · ' : '') + 'ينتهي ' + dt(g.expiryDate) + '</div></div><div class="pt-gr">' + money(g.amount) + gtActs(g) + '</div></li>').join('') + '</ul>';
    delegate(box, gtHandlers);
  }

  function renderGuarantees(c) {
    const ui = U();
    const all = guaranteeRows(list('guarantees'));
    const live = all.filter((g) => !g.returnedAt);
    const soon = live.filter((g) => g.stateKey === 'soon'), exp = live.filter((g) => g.stateKey === 'expired');
    c.innerHTML = wrap(
      '<div class="ph"><div><h1>الضمانات</h1><p>ضمانات المقاولين · مرتّبة بتاريخ الانتهاء ' + SAMPLE + '</p></div><div class="acts"><button class="btn" data-a="export">تصدير</button><button class="btn primary" data-a="add">+ ضمان</button></div></div>' +
      '<div class="grid">' +
      '<section class="isl c3" style="--i:0">' + ui.kpi({ label: 'ضمانات سارية', value: sumC(live, (g) => g.amount), money: true, hint: dg(live.length) + ' ضمانات' }) + '</section>' +
      '<section class="isl c3" style="--i:1">' + ui.kpi({ label: 'تنتهي خلال ٣٠ يوماً', value: sumC(soon, (g) => g.amount), money: true, tone: 'warn', hint: dg(soon.length) + ' ضمانات' }) + '</section>' +
      '<section class="isl c3' + (exp.length ? ' crit' : '') + '" style="--i:2">' + ui.kpi({ label: 'منتهية ولم تُعَد', value: sumC(exp, (g) => g.amount), money: true, tone: exp.length ? 'danger' : undefined, hint: dg(exp.length) + ' ضمانات' }) + '</section>' +
      '<section class="isl c3" style="--i:3">' + ui.kpi({ label: 'التأمين المحتجز', value: S().totals().retentionHeld || 0, money: true, hint: 'من دفاتر المقاولين' }) + '</section>' +
      '<section class="isl c12" style="--i:4"><div class="pt-tbl"></div></section></div>');
    const root = c.querySelector('.sec-parties');
    const box = root.querySelector('.pt-tbl');
    box.appendChild(ui.table({
      id: 'parties-guarantees', rows: all, rowKey: 'id', search: true, searchKeys: ['contractorName', 'type', 'projectName'], columnMenu: true,
      filters: [{ key: 'stateKey', label: 'الحالة', options: opt([['active', 'ساري'], ['soon', 'ينتهي قريباً'], ['expired', 'منتهٍ'], ['returned', 'مُعاد']]) },
        { key: 'type', label: 'النوع', options: opt([...new Set(all.map((g) => g.type))].map((x) => [x, x])) }],
      columns: [
        { key: 'contractorName', label: 'المقاول', sort: true, render: (g) => '<button class="pt-link" data-act="con" data-id="' + esc(g.contractorId) + '">' + esc(g.contractorName) + '</button>' },
        { key: 'type', label: 'النوع', sort: true, render: (g) => esc(g.type) },
        { key: 'projectName', label: 'المشروع', sort: true, render: (g) => g.projectName ? esc(g.projectName) : '<span class="dash">—</span>' },
        { key: 'issueDate', label: 'الإصدار', sort: true, render: (g) => dt(g.issueDate) },
        { key: 'expirySort', label: 'الانتهاء', sort: true, render: (g) => dt(g.expiryDate) },
        { key: 'stateKey', label: 'الحالة', render: (g) => g.statePill },
        { key: 'amount', label: 'المبلغ', num: true, sort: true, render: (g) => money(g.amount) },
        { key: '_a', label: '', render: gtActs },
      ],
      total: { label: 'الإجمالي', keys: ['amount'] },
      empty: { title: 'لا ضمانات', body: 'سجّل ضمان مقاول لتتابع انتهاءه.', cta: '+ ضمان', onCta: () => guaranteeForm() },
    }));
    delegate(box, { ...gtHandlers, con: (id) => go('contractor', { id }) });
    root.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]'); if (!a) return;
      if (a.dataset.a === 'add') guaranteeForm();
      if (a.dataset.a === 'export') U().exportDialog({ title: 'تصدير الضمانات', fileName: 'الضمانات-' + todayIso() + '.csv',
        csv: S().toCSV(all.map((g) => ({ ...g, st: { active: 'ساري', soon: 'ينتهي قريباً', expired: 'منتهٍ', returned: 'مُعاد' }[g.stateKey] })), [
          { key: 'contractorName', label: 'المقاول' }, { key: 'type', label: 'النوع' }, { key: 'projectName', label: 'المشروع' }, { key: 'issueDate', label: 'الإصدار' },
          { key: 'expiryDate', label: 'الانتهاء' }, { key: 'st', label: 'الحالة' }, { key: 'returnedAt', label: 'تاريخ الإعادة' }, { key: 'amount', label: 'المبلغ' }]) });
    });
  }

  function returnGuarantee(id) {
    const g = S().get('guarantees', id);
    U().modal({
      title: 'تسجيل إعادة الضمان', size: 'md',
      body: wrap(errBox + '<p>' + esc(g.type) + ' — ' + esc(conName(g.contractorId)) + ' · ' + money(g.amount) + '</p>' + U().form([{ name: 'returnedAt', label: 'تاريخ الإعادة', type: 'date', required: true, value: todayIso() }])),
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'تسجيل', kind: 'primary', onClick: (close, root) => {
        const v = U().readForm(root); if (!v.returnedAt) return shake(root, 'returnedAt', 'التاريخ مطلوب');
        S().update('guarantees', id, { returnedAt: v.returnedAt });
        U().toast('سُجّلت إعادة الضمان', { kind: 'ok', undo: () => S().update('guarantees', id, { returnedAt: null }) });
        close();
      } }],
    });
  }

  function guaranteeForm(g, presetContractor) {
    const isEdit = !!g;
    const cons = list('contractors');
    const types = GTYPES.includes(g && g.type) || !g ? GTYPES : GTYPES.concat([g.type]);
    U().modal({
      title: isEdit ? 'تعديل ضمان' : 'إضافة ضمان', size: 'md',
      body: wrap(errBox + U().form([
        { name: 'contractorId', label: 'المقاول', type: 'select', required: true, value: g ? g.contractorId : presetContractor || '', options: [{ value: '', label: '— اختر —' }].concat(cons.map((k) => ({ value: k.id, label: k.name + ' · ' + k.code }))) },
        { name: 'type', label: 'النوع', type: 'select', value: g ? g.type : GTYPES[0], options: types.map((t) => ({ value: t, label: t })) },
        { name: 'projectId', label: 'المشروع', type: 'select', value: g ? g.projectId || '' : '', options: [{ value: '', label: '— بلا مشروع —' }].concat(projects().map((p) => ({ value: p.id, label: p.name }))) },
        { name: 'amount', label: 'المبلغ', type: 'money', required: true, value: g ? g.amount : '' },
        { name: 'issueDate', label: 'تاريخ الإصدار', type: 'date', required: true, value: g ? g.issueDate : todayIso() },
        { name: 'expiryDate', label: 'تاريخ الانتهاء', type: 'date', required: true, value: g ? g.expiryDate : '' },
      ])),
      actions: [{ label: 'إلغاء', onClick: (c) => c() }, { label: 'حفظ', kind: 'primary', onClick: (close, root) => {
        const v = U().readForm(root); const a = num(v.amount);
        if (!v.contractorId) return shake(root, 'contractorId', 'اختر المقاول');
        if (isNaN(a) || a <= 0) return shake(root, 'amount', 'أدخل مبلغاً أكبر من صفر');
        if (!v.issueDate) return shake(root, 'issueDate', 'تاريخ الإصدار مطلوب');
        if (!v.expiryDate) return shake(root, 'expiryDate', 'تاريخ الانتهاء مطلوب');
        if (v.expiryDate < v.issueDate) return shake(root, 'expiryDate', 'الانتهاء قبل الإصدار');
        const obj = { contractorId: v.contractorId, type: v.type, projectId: v.projectId || null, amount: Math.round(a * 100) / 100, issueDate: v.issueDate, expiryDate: v.expiryDate };
        if (isEdit) S().update('guarantees', g.id, obj); else S().create('guarantees', { ...obj, returnedAt: null });
        U().toast(isEdit ? 'حُفظ الضمان' : 'أُضيف الضمان', { kind: 'ok' });
        close();
      } }],
    });
  }

  /* ═════════════ التسجيل ═════════════ */
  function safe(fn) {
    return (c, params) => {
      try { fn(c, params); } catch (err) {
        console.error('[parties]', err);
        c.innerHTML = wrap('<div class="ph"><div><h1>تعذّر عرض الصفحة</h1><p>' + esc(err && err.message) + '</p></div></div>');
      }
    };
  }
  function register() {
    const sh = E && E.shell; if (!sh || !sh.register) return;
    sh.register('suppliers', { section: 'parties', tab: 'الموردون', title: 'الموردون', render: safe(renderSuppliers),
      badge: () => { try { return list('suppliers').filter((s) => ((S().supplierPosition(s.id) || {}).overdue || 0) > 0).length; } catch (e) { return 0; } } });
    sh.register('contractors', { section: 'parties', tab: 'المقاولون', title: 'المقاولون', render: safe(renderContractors),
      badge: () => { try { return list('contractors').filter((k) => k.termDays != null && ((S().contractorPosition(k.id) || {}).overdue || 0) > 0).length; } catch (e) { return 0; } } });
    sh.register('guarantees', { section: 'parties', tab: 'الضمانات', title: 'الضمانات', render: safe(renderGuarantees),
      badge: () => { try { return list('guarantees').filter((g) => !g.returnedAt && daysBetween(S().TODAY, g.expiryDate) <= 7).length; } catch (e) { return 0; } } });
    sh.register('supplier', { section: 'parties', tab: null, title: 'كشف مورد', render: safe((c, p) => { if (!p || p.id !== detState.lastId) { detState.bucket = null; detState.lastId = p && p.id; } renderSupplier(c, p); }) });
    sh.register('contractor', { section: 'parties', tab: null, title: 'كشف مقاول', render: safe((c, p) => { if (!p || p.id !== cdState.lastId) { cdState.kind = ''; cdState.project = ''; cdState.lastId = p && p.id; } renderContractor(c, p); }) });
  }
  E.parties = { remindModal, supplierForm, contractorForm, guaranteeForm };
  register();
})();
