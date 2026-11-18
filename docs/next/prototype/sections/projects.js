/* ═══ قسم «المشاريع» — المشاريع · الموازنة · دمج المشاريع + تفاصيل مشروع ═══
   يغطي وظيفياً: Projects.tsx · ProjectDetail.tsx · Budget.tsx · ProjectAdmin.tsx.
   رحلة «أي مشروع يخسّرني؟»: الحكم يُحسب فقط عند وجود قيمة العقد — لا رقم مخترع. */
(function () {
  'use strict';
  const S = () => window.EGCO.store;
  const U = () => window.EGCO.ui;
  const G = (v, p) => window.EGCO.shell.go(v, p);

  /* ─── أدوات ─── */
  const esc = s => U().esc(s == null ? '' : String(s));
  const C = n => Math.round((+n || 0) * 100);               // هللات
  const sumBy = (arr, f) => arr.reduce((a, x) => a + C(f(x)), 0) / 100;
  const money = (n, cls) => U().money(n, cls || '');
  const D = s => U().digits(String(s));
  const pct = n => D((Math.round(n * 10) / 10).toFixed(1)) + '٪';
  const L = t => { try { return S().list(t) || []; } catch (e) { return []; } };
  const LA = t => { try { return S().list(t, { withDeleted: true }) || []; } catch (e) { return []; } };
  const parseNum = v => {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d))
      .replace(/[٬,\s]/g, '').replace('٫', '.').replace('−', '-');
    return s === '' ? NaN : +s;
  };
  /* تطبيع الاسم: يتجاهل «ال» في أول كل كلمة والهمزات والتاء المربوطة والمسافات */
  const normName = s => String(s || '').trim().replace(/\s+/g, ' ').split(' ')
    .map(w => w.replace(/^ال(?=..)/, '')).join(' ')
    .replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/[ً-ْ]/g, '');
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const monthTxt = m => { const [y, mm] = String(m).split('-'); return (MONTHS[(+mm) - 1] || m) + ' ' + D(y); };
  const todayMonth = () => { const t = S().TODAY || new Date(2026, 10, 17); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0'); };
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };
  const mem = { get(k, d) { try { const v = localStorage.getItem('egco-proj-' + k); return v == null ? d : v; } catch (e) { return d; } },
                set(k, v) { try { localStorage.setItem('egco-proj-' + k, v); } catch (e) { /* ذاكرة فقط */ } } };
  const st = { mode: mem.get('mode', 'cards'), sort: mem.get('sort', 'risk'), budgetId: null, mergeFrom: '', mergeInto: '' };

  const STATUS_TXT = { active: 'نشط', paused: 'متوقف', finished: 'منتهٍ', disputed: 'متنازع' };
  const RCV_TXT = { pending: 'قيد الاعتماد', approved: 'معتمد', collected: 'محصّل' };
  const COST_KINDS = { opening: 1, claim: 1, invoice: 1 };

  /* ─── الموازنة: أشهر المشروع + التراكمي + التعارضات ─── */
  function budgetOf(pid) {
    const rows = L('budgetMonths').filter(b => b.projectId === pid)
      .sort((a, b) => String(a.month).localeCompare(String(b.month)));
    const byMonth = {};
    rows.forEach(r => { (byMonth[r.month] = byMonth[r.month] || []).push(r); });
    const conflicts = Object.keys(byMonth).filter(m => byMonth[m].length > 1);
    let cp = 0, ca = 0;
    const months = rows.map(r => {
      cp += C(r.planned); ca += C(r.actual);
      return { ...r, cumPlanned: cp / 100, cumActual: ca / 100, variance: (C(r.actual) - C(r.planned)) / 100,
               cumVariance: (ca - cp) / 100, conflict: byMonth[r.month].length > 1 };
    });
    const tm = todayMonth();
    const past = months.filter(m => m.month <= tm);
    const last = past[past.length - 1] || null;
    let delay = null;
    if (last && last.cumPlanned > 0) delay = Math.max(-100, ((last.cumPlanned - last.cumActual) / last.cumPlanned) * 100);
    const totalPlanned = sumBy(rows, r => r.planned), totalActual = sumBy(rows, r => r.actual);
    return { months, conflicts, byMonth, delay, last, totalPlanned, totalActual };
  }

  /* ─── موقف المشروع: كل رقم مشتق من صفوفه ─── */
  function metrics(p) {
    const pid = p.id;
    const invoices = L('invoices').filter(i => i.projectId === pid);
    const entries = L('contractorEntries').filter(e => e.projectId === pid);
    const suppliers = L('suppliers').filter(s => (s.projectIds || []).includes(pid) || invoices.some(i => i.supplierId === s.id));
    const contractors = L('contractors').filter(c => (c.projectIds || []).includes(pid) || entries.some(e => e.contractorId === c.id));
    const supRows = suppliers.map(s => {
      let pos = null; try { pos = S().supplierPosition(s.id); } catch (e) { /* */ }
      const inv = ((pos && pos.invoices) || []).filter(i => i.projectId === pid);
      const open = sumBy(inv, i => i.remaining), overdue = sumBy(inv.filter(i => i.lateDays > 0), i => i.remaining);
      const oldest = inv.filter(i => i.lateDays > 0).reduce((a, i) => Math.max(a, i.lateDays), 0);
      return { id: s.id, name: s.name, account: s.account, termDays: s.termDays, open, overdue, oldest,
               invCount: invoices.filter(i => i.supplierId === s.id).length,
               billed: sumBy(invoices.filter(i => i.supplierId === s.id), i => i.amount) };
    });
    const conRows = contractors.map(c => {
      const es = entries.filter(e => e.contractorId === c.id);
      const balance = (es.reduce((a, e) => a + C(e.debit) - C(e.credit), 0)) / 100; // سالب = نحن ندين
      const cost = sumBy(es.filter(e => COST_KINDS[e.kind]), e => e.credit);
      return { id: c.id, name: c.name, code: c.code, status: c.status, termDays: c.termDays, balance, cost,
               owed: balance < 0 ? -balance : 0, toUs: balance > 0 ? balance : 0 };
    });
    const rcv = L('receivables').filter(r => r.projectId === pid);
    const guarantees = L('guarantees').filter(g => g.projectId === pid);
    const bud = budgetOf(pid);
    const supplierOpen = sumBy(supRows, r => r.open), supplierOverdue = sumBy(supRows, r => r.overdue);
    const contractorOwed = sumBy(conRows, r => r.owed), contractorToUs = sumBy(conRows, r => r.toUs);
    const supplierCost = sumBy(invoices, i => i.amount), contractorCost = sumBy(conRows, r => r.cost);
    const cost = (C(supplierCost) + C(contractorCost)) / 100;
    const billed = sumBy(rcv, r => r.amount);
    const collected = sumBy(rcv.filter(r => r.status === 'collected'), r => r.amount);
    const receivableOpen = (C(billed) - C(collected)) / 100;
    const delayPct = bud.delay != null ? bud.delay : (p.budgetDelayPct != null && p.budgetDelayPct !== '' ? +p.budgetDelayPct : null);
    const cv = +p.contractValue > 0 ? +p.contractValue : null;
    let verdict = null;
    if (cv != null) {
      const margin = (C(cv) - C(cost)) / 100;
      const used = cost / cv;
      verdict = { margin, marginPct: (margin / cv) * 100, used: used * 100,
                  kind: margin < 0 ? 'loss' : used >= 0.9 ? 'watch' : 'gain' };
    }
    const risk = (verdict ? (verdict.kind === 'loss' ? 1e12 + -verdict.margin : verdict.kind === 'watch' ? 1e11 : 0) : 5e10)
      + supplierOverdue * 2 + contractorOwed + Math.max(0, delayPct || 0) * 1e5;
    return { p, name: p.name, contractValue: cv, invoices, entries, supRows, conRows, rcv, guarantees, bud, supplierOpen, supplierOverdue,
             contractorOwed, contractorToUs, supplierCost, contractorCost, cost, billed, collected, receivableOpen,
             delayPct, cv, verdict, risk };
  }

  function verdictPill(m) {
    if (!m.verdict) return '<span class="pill n">لا حكم — قيمة العقد غير مُدخلة</span>';
    const v = m.verdict;
    if (v.kind === 'loss') return `<span class="pill w sp-loss">يخسر · ${money(-v.margin)}</span>`;
    if (v.kind === 'watch') return `<span class="pill w">يكسب بهامش ضيق · ${pct(v.marginPct)}</span>`;
    return `<span class="pill o">يكسب · هامش ${pct(v.marginPct)}</span>`;
  }
  const delayTxt = d => d == null ? '<span class="dash">لا موازنة</span>'
    : d > 0 ? `<span class="t-warn">${pct(d)} متأخر عن المخطط</span>` : `<span class="t-ok">${pct(-d)} متقدّم/مطابق</span>`;
  const conBal = b => b === 0 ? '<span class="dash">—</span>'
    : `${money(Math.abs(b))} <small class="sp-word">${b < 0 ? 'نحن ندين له' : 'لنا عليه'}</small>`;

  /* ─── روابط مشتركة ─── */
  function linkedCounts(pid) {
    return {
      suppliers: L('suppliers').filter(s => (s.projectIds || []).includes(pid)).length,
      contractors: L('contractors').filter(c => (c.projectIds || []).includes(pid)).length,
      invoices: L('invoices').filter(x => x.projectId === pid).length,
      entries: L('contractorEntries').filter(x => x.projectId === pid).length,
      receivables: L('receivables').filter(x => x.projectId === pid).length,
      guarantees: L('guarantees').filter(x => x.projectId === pid).length,
      budgetMonths: L('budgetMonths').filter(x => x.projectId === pid).length,
    };
  }
  const LINK_TXT = { suppliers: 'مورد', contractors: 'مقاول', invoices: 'فاتورة', entries: 'حركة مقاول',
                     receivables: 'مستحق لنا', guarantees: 'ضمان', budgetMonths: 'شهر موازنة' };

  /* ─── نموذج إضافة/تعديل مشروع ─── */
  function projectForm(existing) {
    const body = `<div class="sec-projects">${U().form([
      { name: 'name', label: 'اسم المشروع', type: 'text', required: true, value: existing ? existing.name : '' },
      { name: 'contractValue', label: 'قيمة العقد مع المالك (ر.س)', type: 'money', value: existing && existing.contractValue ? existing.contractValue : '',
        help: 'تُستعمل لحساب «يكسب/يخسر». اتركها فارغة إن لم تعرفها — لن نخمّن رقماً.' },
    ])}<p class="sp-err" role="alert" hidden></p></div>`;
    U().modal({
      title: existing ? 'تعديل المشروع — ' + esc(existing.name) : 'مشروع جديد', body, size: 'md',
      actions: [
        { label: 'إلغاء', onClick: close => close() },
        { label: existing ? 'حفظ' : 'إضافة', kind: 'primary', onClick: (close, root) => {
          const f = U().readForm(root) || {};
          const name = String(f.name || '').trim().replace(/\s+/g, ' ');
          const cvRaw = f.contractValue;
          const cv = cvRaw === '' || cvRaw == null ? null : parseNum(cvRaw);
          const err = root.querySelector('.sp-err');
          const fail = (field, msg) => {
            err.textContent = msg; err.hidden = false;
            const el = root.querySelector(`[name="${field}"]`);
            if (el) { el.classList.remove('m-shake'); void el.offsetWidth; el.classList.add('m-shake'); el.focus(); }
          };
          if (!name) return fail('name', 'اكتب اسم المشروع.');
          const dup = L('projects').find(x => (!existing || x.id !== existing.id) && normName(x.name) === normName(name));
          if (dup) return fail('name', `يوجد مشروع «${dup.name}» بنفس الاسم بعد تجاهل «ال» — استعمله أو ادمجهما من تبويب «دمج المشاريع».`);
          if (cv != null && (!isFinite(cv) || cv < 0)) return fail('contractValue', 'قيمة العقد يجب أن تكون رقماً موجباً.');
          if (existing) {
            const before = { name: existing.name, contractValue: existing.contractValue == null ? null : existing.contractValue };
            S().update('projects', existing.id, { name, contractValue: cv });
            close();
            U().toast('حُفظ المشروع «' + name + '»', { kind: 'ok', undo: () => S().update('projects', existing.id, before) });
          } else {
            const p = S().create('projects', { name, contractValue: cv, budgetDelayPct: null });
            close();
            U().toast('أُضيف المشروع «' + name + '»', { kind: 'ok', undo: () => p && S().remove('projects', p.id) });
          }
        } },
      ],
    });
  }

  async function deleteProject(p) {
    const lc = linkedCounts(p.id);
    const parts = Object.keys(lc).filter(k => lc[k] > 0).map(k => `${D(lc[k])} ${LINK_TXT[k]}`);
    if (parts.length) {
      U().modal({
        title: 'لا يمكن حذف «' + esc(p.name) + '»', size: 'md',
        body: `<div class="sec-projects"><p>المشروع مرتبط بـ: <b>${parts.join(' · ')}</b>.</p>
          <p class="cap">الحذف سيترك هذه البيانات بلا مشروع ويكسر أرقام المديونية. إن كان هذا المشروع
          اسماً مكرّراً لمشروع آخر فادمجه فيه — تنتقل كل الروابط ولا يضيع شيء.</p></div>`,
        actions: [{ label: 'إغلاق', onClick: c => c() },
                  { label: 'اذهب إلى الدمج', kind: 'primary', onClick: c => { c(); st.mergeFrom = p.id; G('merge'); } }],
      });
      return;
    }
    const ok = await U().confirm({ title: 'حذف المشروع «' + esc(p.name) + '»؟', body: 'يُنقل إلى سلة المحذوفات ويمكن استرجاعه.', danger: true, confirmLabel: 'حذف' });
    if (!ok) return;
    S().remove('projects', p.id);
    U().toast('حُذف المشروع «' + p.name + '»', { kind: 'ok', undo: () => S().restore('projects', p.id) });
  }

  /* ─── أدوات العرض ─── */
  const kpi = (label, inner, i, extra = '', cls = 'c3') =>
    `<section class="isl ${cls} ${extra}" style="--i:${i}"><div class="cap">${label}</div><div class="kpi sp-kpi">${inner}</div></section>`;
  const cnt = (n, cls) => U().counted ? U().counted(n, cls) : money(n, cls);
  function animate(root) { try { U().animateNumbers && U().animateNumbers(root); } catch (e) { /* */ } }

  /* ═════════ عرض: المشاريع ═════════ */
  function renderProjects(el) {
    const ms = L('projects').map(metrics);
    const sorters = {
      risk: (a, b) => b.risk - a.risk,
      name: (a, b) => String(a.p.name).localeCompare(String(b.p.name), 'ar'),
      margin: (a, b) => (a.verdict ? a.verdict.margin : Infinity) - (b.verdict ? b.verdict.margin : Infinity),
      open: (a, b) => (b.supplierOpen + b.contractorOwed) - (a.supplierOpen + a.contractorOwed),
    };
    ms.sort(sorters[st.sort] || sorters.risk);
    const losing = ms.filter(m => m.verdict && m.verdict.kind === 'loss');
    const noValue = ms.filter(m => !m.verdict);
    const tSup = sumBy(ms, m => m.supplierOpen), tSupOver = sumBy(ms, m => m.supplierOverdue), tCon = sumBy(ms, m => m.contractorOwed);
    const tRcv = sumBy(ms, m => m.receivableOpen);

    el.innerHTML = `<div class="sec-projects">
      <header class="ph"><div><h1>المشاريع</h1><p>أي مشروع يكسب وأيها يخسر — من قيمة العقد مقابل التكاليف المسجّلة</p></div>
        <div class="acts">
          <div class="seg" role="group" aria-label="طريقة العرض">
            <button type="button" data-mode="cards" aria-pressed="${st.mode === 'cards'}">بطاقات</button>
            <button type="button" data-mode="table" aria-pressed="${st.mode === 'table'}">جدول</button></div>
          <label class="sp-sort"><span class="cap">ترتيب</span>
            <select data-sort aria-label="ترتيب المشاريع">
              ${[['risk', 'الأخطر أولاً'], ['margin', 'الأقل هامشاً'], ['open', 'الأعلى التزاماً'], ['name', 'الاسم']]
                .map(([k, t]) => `<option value="${k}" ${st.sort === k ? 'selected' : ''}>${t}</option>`).join('')}
            </select></label>
          <button class="btn primary" type="button" data-add>+ مشروع جديد</button>
        </div></header>
      <div class="grid">
        ${kpi('مشاريع تخسر', `<span class="${losing.length ? 't-warn' : 't-ok'}">${D(losing.length)}</span><span class="cap"> من ${D(ms.length - noValue.length)} لها قيمة عقد</span>`, 0, losing.length ? 'click sp-go-loss' : '')}
        ${kpi('مديونية الموردين المفتوحة', cnt(tSup), 1, '', 'c3')}
        ${kpi('مستحق للمقاولين', cnt(tCon), 2)}
        ${kpi('مستحق لنا من الملاك', cnt(tRcv), 3)}
        <p class="c12 disclose" style="--i:4">المتأخر عن موعده لدى الموردين: ${tSupOver > 0 ? `<b class="t-danger">${money(tSupOver)}</b>` : '<span class="dash">لا شيء</span>'}.
          الحكم «يكسب/يخسر» = قيمة العقد − (فواتير الموردين + مستخلصات المقاولين المسجّلة على المشروع). لا نحسبه لمشروع بلا قيمة عقد.</p>
        ${noValue.length ? `<section class="isl c12 sp-callout" style="--i:5"><div class="sp-callout-row">
          <div><b>${D(noValue.length)} ${noValue.length === 1 ? 'مشروع بلا' : 'مشاريع بلا'} قيمة عقد</b>
          <div class="cap">${noValue.map(m => esc(m.p.name)).join('، ')} — لا يمكن معرفة إن كانت تكسب أو تخسر.</div></div>
          <button class="btn sm" type="button" data-edit="${esc(noValue[0].p.id)}">أدخل قيمة العقد</button></div></section>` : ''}
        <div class="c12 sp-body"></div>
      </div></div>`;

    const body = el.querySelector('.sp-body');
    if (!ms.length) {
      body.innerHTML = U().emptyState({ title: 'لا مشاريع بعد', body: 'أضف مشروعاً أو استورد كشفاً يحمل اسم مشروع.', cta: 'مشروع جديد' });
      const b = body.querySelector('button'); if (b) b.addEventListener('click', () => projectForm(null));
    } else if (st.mode === 'table') {
      const wrap = document.createElement('section'); wrap.className = 'isl'; wrap.style.setProperty('--i', 6);
      wrap.appendChild(U().table({
        id: 'projects-list', rows: ms, rowKey: m => m.p.id, search: true, searchKeys: ['name'], columnMenu: true,
        onRowClick: m => G('project', { id: m.p.id }),
        columns: [
          { key: 'name', label: 'المشروع', sort: true, render: m => `<b>${esc(m.p.name)}</b>` },
          { key: 'verdict', label: 'الحكم', render: m => verdictPill(m) },
          { key: 'contractValue', label: 'قيمة العقد', num: true, sort: true, render: m => m.cv != null ? money(m.cv) : '<button class="btn sm" type="button" data-edit="' + esc(m.p.id) + '">أدخل قيمة العقد</button>' },
          { key: 'cost', label: 'التكاليف المسجّلة', num: true, sort: true, render: m => money(m.cost) },
          { key: 'collected', label: 'المحصّل', num: true, sort: true, render: m => money(m.collected) },
          { key: 'receivableOpen', label: 'مستحق لنا', num: true, sort: true, render: m => money(m.receivableOpen) },
          { key: 'supplierOpen', label: 'موردون — مفتوح', num: true, sort: true, render: m => money(m.supplierOpen, m.supplierOverdue > 0 ? 't-danger' : '') },
          { key: 'contractorOwed', label: 'مستحق للمقاولين', num: true, sort: true, render: m => money(m.contractorOwed) },
          { key: 'delayPct', label: 'تأخر الموازنة', sort: true, render: m => delayTxt(m.delayPct) },
        ],
        total: { label: 'الإجمالي', keys: ['cost', 'collected', 'receivableOpen', 'supplierOpen', 'contractorOwed'] },
      }));
      body.appendChild(wrap);
    } else {
      body.innerHTML = `<div class="sp-cards">${ms.map((m, i) => card(m, i)).join('')}</div>`;
    }

    el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { st.mode = b.dataset.mode; mem.set('mode', st.mode); renderProjects(el); }));
    el.querySelector('[data-sort]').addEventListener('change', e => { st.sort = e.target.value; mem.set('sort', st.sort); renderProjects(el); });
    el.querySelector('[data-add]').addEventListener('click', () => projectForm(null));
    const gl = el.querySelector('.sp-go-loss');
    if (gl) gl.addEventListener('click', () => { st.sort = 'margin'; mem.set('sort', 'margin'); renderProjects(el); });
    const root = el.querySelector('.sec-projects');
    root.addEventListener('keydown', e => {
      const c = e.target.closest && e.target.closest('article[data-open]');
      if (c && e.target === c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); G('project', { id: c.dataset.open }); }
    });
    root.addEventListener('click', e => {
      const t = e.target.closest('[data-edit],[data-del],[data-open]');
      if (!t || !root.contains(t)) return;
      e.stopPropagation();
      const id = t.dataset.edit || t.dataset.del || t.dataset.open;
      const p = S().get('projects', id); if (!p) return;
      if (t.dataset.edit) projectForm(p); else if (t.dataset.del) deleteProject(p); else G('project', { id });
    }, true);
    animate(el);
  }

  function card(m, i) {
    const v = m.verdict;
    const fill = v ? Math.min(100, v.used) : 0;
    return `<article class="isl click sp-card ${v && v.kind === 'loss' ? 'sp-card-loss' : ''}" style="--i:${i + 6}" data-open="${esc(m.p.id)}" tabindex="0" role="link" aria-label="فتح مشروع ${esc(m.p.name)}">
      <div class="ih"><h2>${esc(m.p.name)}</h2>${verdictPill(m)}</div>
      ${v ? `<div class="sp-usage"><div class="cap">التكاليف ${money(m.cost)} من عقد ${money(m.cv)}</div>
        <div class="bar" role="img" aria-label="استُهلك ${pct(v.used)} من قيمة العقد"><i class="${v.kind === 'loss' ? 'sp-bar-loss' : v.kind === 'watch' ? 'sp-bar-watch' : 'sp-bar-ok'}" style="width:${fill}%;--i:${i}"></i></div></div>`
        : `<div class="sp-cta"><span class="cap">التكاليف المسجّلة ${money(m.cost)} — بلا قيمة عقد لا نعرف الهامش.</span>
           <button class="btn sm primary" type="button" data-edit="${esc(m.p.id)}">أدخل قيمة العقد</button></div>`}
      <dl class="sp-dl">
        <div><dt>المحصّل / مستحق لنا</dt><dd>${money(m.collected)} <small>/</small> ${money(m.receivableOpen)}</dd></div>
        <div><dt>موردون — مفتوح</dt><dd>${money(m.supplierOpen)}${m.supplierOverdue > 0 ? ` <small class="t-danger">متأخر ${money(m.supplierOverdue, 't-danger')}</small>` : ''}</dd></div>
        <div><dt>مستحق للمقاولين</dt><dd>${money(m.contractorOwed)}</dd></div>
        <div><dt>تأخر الموازنة</dt><dd>${delayTxt(m.delayPct)}</dd></div>
      </dl>
      <div class="sp-card-acts"><button class="btn sm" type="button" data-edit="${esc(m.p.id)}">تعديل</button>
        <button class="btn sm" type="button" data-del="${esc(m.p.id)}">حذف</button></div>
    </article>`;
  }

  /* ═════════ عرض: تفاصيل مشروع ═════════ */
  function renderDetail(el, params) {
    const p = params && params.id ? S().get('projects', params.id) : null;
    if (!p || p.deletedAt) {
      el.innerHTML = `<div class="sec-projects"><header class="ph"><div><button class="crumb" type="button" data-back>‹ المشاريع</button><h1>المشروع غير موجود</h1>
        <p>ربما حُذف أو دُمج في مشروع آخر.</p></div></header></div>`;
      el.querySelector('[data-back]').addEventListener('click', () => G('projects'));
      return;
    }
    const m = metrics(p);
    const v = m.verdict;
    const imports = projectImports(m);
    el.innerHTML = `<div class="sec-projects">
      <header class="ph"><div><button class="crumb" type="button" data-back>‹ المشاريع</button>
        <h1>${esc(p.name)} ${verdictPill(m)}</h1>
        <p>${D(m.supRows.length)} مورداً · ${D(m.conRows.length)} مقاولاً · ${D(m.invoices.length)} فاتورة</p></div>
        <div class="acts"><button class="btn" type="button" data-budget>الموازنة</button>
          <button class="btn" type="button" data-merge>دمج في مشروع آخر</button>
          <button class="btn primary" type="button" data-edit>تعديل</button></div></header>
      <div class="grid">
        <section class="isl c12 sp-verdict ${v && v.kind === 'loss' ? 'sp-verdict-loss' : ''}" style="--i:0">
          ${v ? `<div class="sum">
              <div><div class="cap">${v.kind === 'loss' ? 'المشروع يخسر' : 'الهامش حتى الآن'}</div>
                <div class="hero">${cnt(Math.abs(v.margin), v.kind === 'loss' ? 't-warn' : 't-ok')}</div>
                <span class="dirn cap">${v.kind === 'loss' ? 'تجاوزت التكاليف قيمة العقد بهذا المبلغ' : 'متبقٍ من قيمة العقد بعد التكاليف المسجّلة'} · ${pct(Math.abs(v.marginPct))}</span></div>
              <div><div class="cap">قيمة العقد</div><div class="kpi">${money(m.cv)}</div></div>
              <div><div class="cap">فواتير الموردين</div><div class="kpi">${money(m.supplierCost)}</div></div>
              <div><div class="cap">مستخلصات المقاولين</div><div class="kpi">${money(m.contractorCost)}</div></div>
              <div><div class="cap">المحصّل من المالك</div><div class="kpi">${money(m.collected)}</div><span class="cap">من ${money(m.billed)} مفوتر</span></div>
            </div>
            <p class="disclose">الهامش = قيمة العقد − التكاليف المسجّلة فقط (لا يشمل تكاليف لم تُستورد بعد). استُهلك ${pct(v.used)} من العقد${m.delayPct != null ? ` بينما تأخر الموازنة ${pct(m.delayPct)}` : ''}.</p>`
          : `<div class="sp-callout-row"><div><b>لا نعرف إن كان هذا المشروع يكسب أو يخسر</b>
              <div class="cap">التكاليف المسجّلة ${money(m.cost)} — ينقصنا قيمة العقد مع المالك لحساب الهامش. لن نخمّنها.</div></div>
              <button class="btn primary" type="button" data-edit>أدخل قيمة العقد</button></div>`}
        </section>
        ${kpi('موردون — المديونية المفتوحة', cnt(m.supplierOpen), 1)}
        ${kpi('منها متأخر', m.supplierOverdue > 0 ? cnt(m.supplierOverdue, 't-danger') : '<span class="dash">—</span>', 2, m.supplierOverdue > 0 ? 'crit' : '')}
        ${kpi('مستحق للمقاولين', cnt(m.contractorOwed), 3)}
        ${kpi('تأخر الموازنة', m.delayPct == null ? '<span class="dash">—</span>' : `<span class="${m.delayPct > 0 ? 't-warn' : 't-ok'}">${pct(Math.abs(m.delayPct))}</span>`, 4)}
        <section class="isl c6" style="--i:5"><div class="ih"><h2>الموردون</h2></div><div class="sp-t-sup"></div></section>
        <section class="isl c6" style="--i:6"><div class="ih"><h2>المقاولون</h2></div><div class="sp-t-con"></div></section>
        <section class="isl c6" style="--i:7"><div class="ih"><h2>المستحق لنا من المالك</h2></div><div class="sp-t-rcv"></div></section>
        <section class="isl c6" style="--i:8"><div class="ih"><h2>الضمانات</h2></div><div class="sp-t-gua"></div></section>
        <section class="isl c8" style="--i:9"><div class="ih"><h2>الموازنة — التراكمي المخطط والفعلي</h2><button class="lnk" type="button" data-budget>إدارة الموازنة</button></div>
          ${budgetChart(m.bud)}</section>
        <section class="isl c4" style="--i:10"><div class="ih"><h2>ملفات استيراد مسّت المشروع</h2></div>
          ${imports.length ? `<ol class="sp-tl">${imports.map(im => `<li><span class="sev ${im.status === 'failed' ? 'w' : 'i'}"></span>
            <div class="tt">${esc(im.file)}<small>${esc(U().dateTxt(im.at, { year: true }))} · ${im.status === 'failed' ? 'فشل' : `${D(im.n)} حركة لهذا المشروع`}</small></div></li>`).join('')}</ol>`
            : '<p class="empty-note">لم يمسّ أي استيراد هذا المشروع بعد.</p>'}
        </section>
      </div></div>`;

    const tbl = (sel, opts) => el.querySelector(sel).appendChild(U().table(opts));
    tbl('.sp-t-sup', {
      id: 'proj-sup', rows: m.supRows, rowKey: r => r.id, onRowClick: r => G('supplier', { id: r.id }),
      empty: { title: 'لا موردين لهذا المشروع' },
      columns: [{ key: 'name', label: 'المورد', sort: true, render: r => esc(r.name) },
                { key: 'account', label: 'الحساب', render: r => `<span class="num">${esc(r.account)}</span>` },
                { key: 'open', label: 'مفتوح', num: true, sort: true, render: r => r.open ? money(r.open) : '<span class="dash">—</span>' },
                { key: 'overdue', label: 'متأخر', num: true, sort: true, render: r => r.overdue ? money(r.overdue, 't-danger') : '<span class="dash">—</span>' }],
      total: { label: 'الإجمالي', keys: ['open', 'overdue'] },
    });
    tbl('.sp-t-con', {
      id: 'proj-con', rows: m.conRows, rowKey: r => r.id, onRowClick: r => G('contractor', { id: r.id }),
      empty: { title: 'لا مقاولين لهذا المشروع' },
      columns: [{ key: 'name', label: 'المقاول', sort: true, render: r => esc(r.name) },
                { key: 'status', label: 'الحالة', render: r => `<span class="pill n">${STATUS_TXT[r.status] || '—'}</span>` },
                { key: 'balance', label: 'الرصيد على المشروع', num: true, sort: true, render: r => conBal(r.balance) },
                { key: 'owed', label: 'مستحق له', num: true, sort: true, render: r => r.owed ? money(r.owed) : '<span class="dash">—</span>' }],
      total: { label: 'الإجمالي', keys: ['owed'] },
    });
    tbl('.sp-t-rcv', {
      id: 'proj-rcv', rows: m.rcv, rowKey: r => r.id, empty: { title: 'لا مستحقات مسجّلة من المالك' },
      columns: [{ key: 'docNo', label: 'المستند', render: r => esc(r.docNo) },
                { key: 'amount', label: 'المبلغ', num: true, sort: true, render: r => money(r.amount) },
                { key: 'dueDate', label: 'الاستحقاق', sort: true, render: r => esc(U().dateTxt(r.dueDate, { year: true })) },
                { key: 'status', label: 'الحالة', render: r => `<span class="pill ${r.status === 'collected' ? 'o' : 'n'}">${RCV_TXT[r.status] || esc(r.status)}</span>` }],
      total: { label: 'الإجمالي', keys: ['amount'] },
    });
    const conName = id => { const c = S().get('contractors', id); return c ? c.name : '—'; };
    const T = S().TODAY || new Date(2026, 10, 17);
    tbl('.sp-t-gua', {
      id: 'proj-gua', rows: m.guarantees, rowKey: r => r.id, empty: { title: 'لا ضمانات لهذا المشروع' },
      onRowClick: r => r.contractorId && G('contractor', { id: r.contractorId }),
      columns: [{ key: 'contractorId', label: 'المقاول', render: r => esc(conName(r.contractorId)) },
                { key: 'type', label: 'النوع', render: r => esc(r.type) },
                { key: 'amount', label: 'المبلغ', num: true, sort: true, render: r => money(r.amount) },
                { key: 'expiryDate', label: 'الانتهاء', sort: true, render: r => {
                  if (r.returnedAt) return '<span class="pill o">مُعاد</span>';
                  const days = Math.round((new Date(r.expiryDate) - T) / 864e5);
                  return `${esc(U().dateTxt(r.expiryDate, { year: true }))} ${days < 0 ? '<span class="pill d">منتهٍ</span>' : days <= 30 ? `<span class="pill w">${D(days)} يوماً</span>` : ''}`; } }],
      total: { label: 'الإجمالي', keys: ['amount'] },
    });
    el.querySelector('[data-back]').addEventListener('click', () => G('projects'));
    el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => projectForm(p)));
    el.querySelectorAll('[data-budget]').forEach(b => b.addEventListener('click', () => { st.budgetId = p.id; G('budget', { id: p.id }); }));
    el.querySelector('[data-merge]').addEventListener('click', () => { st.mergeFrom = p.id; st.mergeInto = ''; G('merge'); });
    animate(el);
  }

  function projectImports(m) {
    const supIds = new Set(m.supRows.map(r => r.id)), conIds = new Set(m.conRows.map(r => r.id));
    const counts = {};
    m.invoices.concat(m.entries).forEach(x => { if (x.importId) counts[x.importId] = (counts[x.importId] || 0) + 1; });
    return L('imports').filter(im => counts[im.id] || supIds.has(im.partyId) || conIds.has(im.partyId) || im.partyId === m.p.id)
      .map(im => ({ ...im, n: counts[im.id] || 0 })).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 12);
  }

  /* ─── رسم التراكمي (SVG خاص، الخط يُرسم بحركة) ─── */
  function budgetChart(bud) {
    const ms = bud.months.filter((m, i, a) => !m.conflict || a.findIndex(x => x.month === m.month) === i);
    if (!ms.length) return '<p class="empty-note">لا أشهر موازنة لهذا المشروع.</p>';
    const W = 640, H = 240, P = { t: 16, r: 16, b: 28, l: 64 };
    const max = Math.max(1, ...ms.map(m => Math.max(m.cumPlanned, m.cumActual)));
    const n = ms.length;
    const x = i => n === 1 ? (W / 2) : W - P.r - (i * (W - P.l - P.r) / (n - 1)); // الزمن من اليمين لليسار
    const y = v => P.t + (1 - v / max) * (H - P.t - P.b);
    const path = k => ms.map((m, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(m[k]).toFixed(1)).join(' ');
    const ticks = [0, .25, .5, .75, 1].map(f => {
      const val = max * f;
      return `<line x1="${P.l}" x2="${W - P.r}" y1="${y(val)}" y2="${y(val)}" class="sp-grid"/><text x="${P.l - 8}" y="${y(val) + 4}" class="sp-axis" text-anchor="end">${D(fmtShort(val))}</text>`;
    }).join('');
    const xl = ms.map((m, i) => (n <= 8 || i % Math.ceil(n / 8) === 0) ? `<text x="${x(i)}" y="${H - 8}" class="sp-axis" text-anchor="middle">${esc(MONTHS[+m.month.slice(5) - 1] || m.month)}</text>` : '').join('');
    const dots = ms.map((m, i) => `<circle cx="${x(i)}" cy="${y(m.cumActual)}" r="3" class="sp-dot"><title>${esc(monthTxt(m.month))}: فعلي ${U().fmt(m.cumActual)} · مخطط ${U().fmt(m.cumPlanned)}</title></circle>`).join('');
    return `<svg class="chart sp-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="التراكمي المخطط مقابل الفعلي">
      ${ticks}${xl}
      <path d="${path('cumPlanned')}" class="sp-line sp-planned" pathLength="1"/>
      <path d="${path('cumActual')}" class="sp-line sp-actual" pathLength="1"/>${dots}</svg>
      <div class="meta"><span><i class="sp-key sp-key-p"></i>المخطط التراكمي</span><span><i class="sp-key sp-key-a"></i>الفعلي التراكمي</span></div>`;
  }
  const fmtShort = v => v >= 1e6 ? (v / 1e6).toFixed(1) + ' م' : v >= 1e3 ? Math.round(v / 1e3) + ' ألف' : String(Math.round(v));

  /* ═════════ عرض: الموازنة ═════════ */
  function renderBudget(el, params) {
    const projects = L('projects').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    if (params && params.id) st.budgetId = params.id;
    if (!projects.find(p => p.id === st.budgetId)) {
      const withB = projects.find(p => L('budgetMonths').some(b => b.projectId === p.id));
      st.budgetId = (withB || projects[0] || {}).id || null;
    }
    const p = st.budgetId ? S().get('projects', st.budgetId) : null;
    if (!p) {
      el.innerHTML = `<div class="sec-projects"><header class="ph"><div><h1>الموازنة التقديرية</h1></div></header><div class="grid"><div class="c12 sp-empty"></div></div></div>`;
      el.querySelector('.sp-empty').innerHTML = U().emptyState({ title: 'لا مشاريع', body: 'أضف مشروعاً أولاً من تبويب «المشاريع».' });
      return;
    }
    const bud = budgetOf(p.id);
    const last = bud.last;
    el.innerHTML = `<div class="sec-projects">
      <header class="ph"><div><h1>الموازنة التقديرية</h1><p>المخطط مقابل الفعلي شهرياً وتراكمياً</p></div>
        <div class="acts">
          <label class="sp-sort"><span class="cap">المشروع</span><select data-proj aria-label="اختر المشروع">
            ${projects.map(x => `<option value="${esc(x.id)}" ${x.id === p.id ? 'selected' : ''}>${esc(x.name)}${L('budgetMonths').some(b => b.projectId === x.id) ? '' : ' (بلا موازنة)'}</option>`).join('')}
          </select></label>
          <button class="btn" type="button" data-export>تصدير</button>
          <button class="btn primary" type="button" data-addm>+ إضافة شهر</button></div></header>
      <div class="grid">
        ${bud.conflicts.length ? `<section class="isl c12 crit sp-callout" style="--i:0"><div class="sp-callout-row"><div>
          <b>تعارض: ${D(bud.conflicts.length)} ${bud.conflicts.length === 1 ? 'شهر له' : 'أشهر لها'} أكثر من إدخال</b>
          <div class="cap">${bud.conflicts.map(monthTxt).join('، ')} — لن نجمعهما بصمت؛ اختر الإدخال المعتمد.</div></div>
          <button class="btn sm primary" type="button" data-resolve="${esc(bud.conflicts[0])}">حلّ التعارض</button></div></section>` : ''}
        ${kpi('تأخر الموازنة', bud.delay == null ? '<span class="dash">—</span>' : `<span class="${bud.delay > 0 ? 't-warn' : 't-ok'}">${pct(Math.abs(bud.delay))}</span><span class="cap"> ${bud.delay > 0 ? 'متأخر' : 'متقدّم/مطابق'}</span>`, 1, 'sp-delay')}
        ${kpi('المخطط التراكمي حتى ' + (last ? monthTxt(last.month) : '—'), last ? cnt(last.cumPlanned) : '<span class="dash">—</span>', 2)}
        ${kpi('الفعلي التراكمي', last ? cnt(last.cumActual) : '<span class="dash">—</span>', 3)}
        ${kpi('الانحراف التراكمي', last ? money(last.cumVariance, last.cumVariance < 0 ? 't-warn' : 't-ok') : '<span class="dash">—</span>', 4)}
        <section class="isl c12" style="--i:5"><div class="ih"><h2>${esc(p.name)} — التراكمي</h2>
          ${p.contractValue ? `<span class="cap">قيمة العقد ${money(p.contractValue)}</span>` : ''}</div>${budgetChart(bud)}</section>
        <section class="isl c12" style="--i:6"><div class="ih"><h2>الأشهر</h2><span class="cap">${D(bud.months.length)} إدخالاً</span></div>
          ${bud.months.length ? `<div class="tbl-wrap"><table class="sp-mtbl"><thead><tr>
            <th>الشهر</th><th class="n">المخطط</th><th class="n">الفعلي</th><th class="n">انحراف الشهر</th>
            <th class="n">المخطط التراكمي</th><th class="n">الفعلي التراكمي</th><th class="n">الانحراف التراكمي</th><th>المستند</th><th></th></tr></thead>
            <tbody>${bud.months.map(r => `<tr class="${r.conflict ? 'sp-conf' : ''}">
              <td>${esc(monthTxt(r.month))} ${r.conflict ? '<span class="pill w">تعارض</span>' : ''}</td>
              <td class="n">${money(r.planned)}</td><td class="n">${money(r.actual)}</td>
              <td class="n">${money(r.variance, r.variance < 0 ? 't-warn' : '')}</td>
              <td class="n">${money(r.cumPlanned)}</td><td class="n">${money(r.cumActual)}</td>
              <td class="n">${money(r.cumVariance, r.cumVariance < 0 ? 't-warn' : '')}</td>
              <td>${r.docNo ? esc(r.docNo) : '<span class="dash">—</span>'}</td>
              <td class="sp-rowacts"><button class="btn sm" type="button" data-editm="${esc(r.id)}">تعديل</button>
                <button class="btn sm" type="button" data-delm="${esc(r.id)}" aria-label="حذف ${esc(monthTxt(r.month))}">حذف</button></td></tr>`).join('')}</tbody>
            <tfoot><tr><td>الإجمالي</td><td class="n">${money(bud.totalPlanned)}</td><td class="n">${money(bud.totalActual)}</td>
              <td class="n">${money((C(bud.totalActual) - C(bud.totalPlanned)) / 100)}</td><td colspan="5"></td></tr></tfoot></table></div>`
            : `<div class="sp-empty-m"></div>`}
        </section>
        <section class="isl c12" style="--i:7"><div class="ih"><h2>ملاحظات الموازنة</h2></div>
          <textarea class="sp-notes" rows="3" aria-label="ملاحظات الموازنة" placeholder="ملاحظات لهذا المشروع — تُحفظ عند مغادرة الحقل">${esc(p.budgetNotes || '')}</textarea></section>
      </div></div>`;

    const em = el.querySelector('.sp-empty-m');
    if (em) { em.innerHTML = U().emptyState({ title: 'لا أشهر بعد', body: 'أضف شهراً يدوياً أو استورد ملف موازنة.', cta: 'إضافة شهر' });
              const b = em.querySelector('button'); if (b) b.addEventListener('click', () => monthForm(p, null)); }
    el.querySelector('[data-proj]').addEventListener('change', e => { st.budgetId = e.target.value; G('budget', { id: st.budgetId }); });
    el.querySelector('[data-addm]').addEventListener('click', () => monthForm(p, null));
    el.querySelector('[data-export]').addEventListener('click', () => exportBudget(p, bud));
    const rs = el.querySelector('[data-resolve]'); if (rs) rs.addEventListener('click', () => resolveConflict(p, rs.dataset.resolve));
    el.querySelectorAll('[data-editm]').forEach(b => b.addEventListener('click', () => monthForm(p, S().get('budgetMonths', b.dataset.editm))));
    el.querySelectorAll('[data-delm]').forEach(b => b.addEventListener('click', () => deleteMonth(b.dataset.delm)));
    const nt = el.querySelector('.sp-notes');
    nt.addEventListener('change', () => { S().update('projects', p.id, { budgetNotes: nt.value }); U().toast('حُفظت الملاحظات', { kind: 'ok' }); });
    animate(el);
  }

  function monthForm(p, existing) {
    const body = `<div class="sec-projects">${U().form([
      { name: 'month', label: 'الشهر (سنة-شهر)', type: 'text', required: true, value: existing ? existing.month : todayMonth(), help: 'مثال: 2026-11' },
      { name: 'planned', label: 'المخطط للشهر (ر.س)', type: 'money', required: true, value: existing ? existing.planned : '' },
      { name: 'actual', label: 'الفعلي للشهر (ر.س)', type: 'money', required: true, value: existing ? existing.actual : '' },
      { name: 'docNo', label: 'المستند (اختياري)', type: 'text', value: existing ? existing.docNo || '' : '' },
    ])}<p class="sp-err" role="alert" hidden></p></div>`;
    U().modal({
      title: (existing ? 'تعديل شهر — ' : 'إضافة شهر — ') + esc(p.name), body,
      actions: [{ label: 'إلغاء', onClick: c => c() }, { label: 'حفظ', kind: 'primary', onClick: async (close, root) => {
        const f = U().readForm(root) || {};
        const err = root.querySelector('.sp-err');
        const fail = (field, msg) => { err.textContent = msg; err.hidden = false;
          const e2 = root.querySelector(`[name="${field}"]`); if (e2) { e2.classList.remove('m-shake'); void e2.offsetWidth; e2.classList.add('m-shake'); e2.focus(); } };
        const month = String(f.month || '').trim().replace(/[٠-٩]/g, d => '٠١٢٣٤٥٦٧٨٩'.indexOf(d)).replace(/\//g, '-');
        const mm = month.match(/^(\d{4})-(\d{1,2})$/);
        if (!mm || +mm[2] < 1 || +mm[2] > 12) return fail('month', 'اكتب الشهر بالصيغة سنة-شهر، مثل 2026-11.');
        const mo = mm[1] + '-' + mm[2].padStart(2, '0');
        const planned = parseNum(f.planned), actual = parseNum(f.actual);
        if (!isFinite(planned) || planned < 0) return fail('planned', 'المخطط يجب أن يكون رقماً موجباً.');
        if (!isFinite(actual) || actual < 0) return fail('actual', 'الفعلي يجب أن يكون رقماً موجباً.');
        const data = { projectId: p.id, month: mo, planned, actual, docNo: String(f.docNo || '').trim() };
        const clash = L('budgetMonths').filter(b => b.projectId === p.id && b.month === mo && (!existing || b.id !== existing.id));
        if (clash.length) {
          const c0 = clash[0];
          const ok = await U().confirm({ title: 'تعارض: ' + esc(monthTxt(mo)) + ' مُدخل مسبقاً',
            body: `القيمة الحالية: مخطط ${U().fmt(c0.planned)} · فعلي ${U().fmt(c0.actual)}${c0.docNo ? ' (' + esc(c0.docNo) + ')' : ''}.<br>القيمة الجديدة: مخطط ${U().fmt(planned)} · فعلي ${U().fmt(actual)}.<br>هل تعتمد الجديدة وتستبدل الحالية؟ لن نجمعهما.`,
            confirmLabel: 'اعتمد الجديدة' });
          if (!ok) return;
          const prev = clash.map(c => ({ ...c }));
          clash.forEach(c => S().remove('budgetMonths', c.id));
          let created = null;
          const before = existing ? { ...existing } : null;
          if (existing) S().update('budgetMonths', existing.id, data); else created = S().create('budgetMonths', data);
          close();
          U().toast('اعتُمدت القيمة الجديدة لـ' + monthTxt(mo), { kind: 'ok', undo: () => {
            prev.forEach(c => S().restore('budgetMonths', c.id));
            if (created) S().remove('budgetMonths', created.id);
            if (before) S().update('budgetMonths', before.id, { month: before.month, planned: before.planned, actual: before.actual, docNo: before.docNo });
          } });
          return;
        }
        if (existing) {
          const before = { month: existing.month, planned: existing.planned, actual: existing.actual, docNo: existing.docNo };
          S().update('budgetMonths', existing.id, data); close();
          U().toast('حُفظ ' + monthTxt(mo), { kind: 'ok', undo: () => S().update('budgetMonths', existing.id, before) });
        } else {
          const c = S().create('budgetMonths', data); close();
          U().toast('أُضيف ' + monthTxt(mo), { kind: 'ok', undo: () => c && S().remove('budgetMonths', c.id) });
        }
      } }],
    });
  }

  async function deleteMonth(id) {
    const r = S().get('budgetMonths', id); if (!r) return;
    const ok = await U().confirm({ title: 'حذف ' + esc(monthTxt(r.month)) + '؟', danger: true, confirmLabel: 'حذف',
      body: 'سيُعاد حساب تراكمي الأشهر التالية بافتراض غيابه. يُنقل إلى سلة المحذوفات.' });
    if (!ok) return;
    S().remove('budgetMonths', id);
    U().toast('حُذف ' + monthTxt(r.month), { kind: 'ok', undo: () => S().restore('budgetMonths', id) });
  }

  function resolveConflict(p, month) {
    const rows = L('budgetMonths').filter(b => b.projectId === p.id && b.month === month);
    U().modal({
      title: 'تعارض بين مصدرين — ' + esc(monthTxt(month)), size: 'md',
      body: `<div class="sec-projects"><p>لهذا الشهر ${D(rows.length)} إدخالات. اختر الإدخال المعتمد؛ الباقي يُنقل إلى سلة المحذوفات.</p>
        <div class="sp-choices" role="radiogroup">${rows.map((r, i) => `<label class="sp-choice"><input type="radio" name="keep" value="${esc(r.id)}" ${i === 0 ? 'checked' : ''}>
          <span>مخطط ${money(r.planned)} · فعلي ${money(r.actual)} <small class="cap">${r.docNo ? esc(r.docNo) : 'بلا مستند'}</small></span></label>`).join('')}</div></div>`,
      actions: [{ label: 'إلغاء', onClick: c => c() }, { label: 'اعتمد المحدد', kind: 'primary', onClick: (close, root) => {
        const keep = (root.querySelector('input[name="keep"]:checked') || {}).value;
        const drop = rows.filter(r => r.id !== keep);
        drop.forEach(r => S().remove('budgetMonths', r.id));
        close();
        U().toast('حُلّ التعارض — حُذف ' + D(drop.length) + ' إدخال', { kind: 'ok', undo: () => drop.forEach(r => S().restore('budgetMonths', r.id)) });
      } }],
    });
  }

  function exportBudget(p, bud) {
    const rows = bud.months.map(r => ({ project: p.name, month: r.month, planned: (+r.planned).toFixed(2),
      actual: (+r.actual).toFixed(2), variance: r.variance.toFixed(2), cumPlanned: r.cumPlanned.toFixed(2),
      cumActual: r.cumActual.toFixed(2), cumVariance: r.cumVariance.toFixed(2), docNo: r.docNo || '' }));
    const columns = [{ key: 'project', label: 'المشروع' }, { key: 'month', label: 'الشهر' }, { key: 'planned', label: 'المخطط' },
      { key: 'actual', label: 'الفعلي' }, { key: 'variance', label: 'انحراف الشهر' }, { key: 'cumPlanned', label: 'المخطط التراكمي' },
      { key: 'cumActual', label: 'الفعلي التراكمي' }, { key: 'cumVariance', label: 'الانحراف التراكمي' }, { key: 'docNo', label: 'المستند' }];
    U().exportDialog({ title: 'تصدير موازنة ' + p.name, csv: S().toCSV(rows, columns), fileName: 'موازنة-' + p.name + '.csv' });
  }

  /* ═════════ عرض: دمج المشاريع ═════════ */
  const MERGE_TYPES = ['invoices', 'contractorEntries', 'receivables', 'guarantees', 'budgetMonths'];
  function impact(fromId, intoId) {
    const r = {};
    MERGE_TYPES.forEach(t => { r[t] = L(t).filter(x => x.projectId === fromId); });
    const sup = L('suppliers').filter(s => (s.projectIds || []).includes(fromId));
    const con = L('contractors').filter(c => (c.projectIds || []).includes(fromId));
    const intoMonths = new Set(L('budgetMonths').filter(b => b.projectId === intoId).map(b => b.month));
    return {
      invoices: r.invoices.length, invoiceAmt: sumBy(r.invoices, x => x.amount),
      entries: r.contractorEntries.length, entryAmt: sumBy(r.contractorEntries, x => (+x.credit || 0) + (+x.debit || 0)),
      receivables: r.receivables.length, rcvAmt: sumBy(r.receivables, x => x.amount),
      guarantees: r.guarantees.length, guaAmt: sumBy(r.guarantees, x => x.amount),
      budgetMonths: r.budgetMonths.length, monthClash: r.budgetMonths.filter(b => intoMonths.has(b.month)).length,
      suppliers: sup.length, contractors: con.length,
      total: r.invoices.length + r.contractorEntries.length + r.receivables.length + r.guarantees.length + r.budgetMonths.length + sup.length + con.length,
    };
  }
  function impactHtml(from, into) {
    const im = impact(from.id, into.id);
    const li = (n, t, amt) => n ? `<li><b class="num">${D(n)}</b> ${t}${amt != null ? ' · ' + money(amt) : ''}</li>` : '';
    return `<div class="sp-impact"><p>«${esc(from.name)}» ← «${esc(into.name)}» — سينتقل ${D(im.total)} سجلاً، ويختفي «${esc(from.name)}»:</p>
      <ul>${li(im.invoices, 'فاتورة مورد', im.invoiceAmt)}${li(im.entries, 'حركة مقاول', im.entryAmt)}${li(im.receivables, 'مستحق من المالك', im.rcvAmt)}
        ${li(im.guarantees, 'ضمان', im.guaAmt)}${li(im.budgetMonths, 'شهر موازنة')}${li(im.suppliers, 'مورد مرتبط')}${li(im.contractors, 'مقاول مرتبط')}</ul>
      ${im.total === 0 ? '<p class="cap">لا سجلات مرتبطة — سيُحذف الاسم المكرّر فقط.</p>' : ''}
      ${im.monthClash ? `<p class="t-warn">${D(im.monthClash)} شهر موازنة موجود في المشروعين — سيظهر «تعارض» في الموازنة لتختار بنفسك؛ لا جمع صامت.</p>` : ''}
      ${from.contractValue && into.contractValue ? `<p class="cap">لكليهما قيمة عقد؛ تبقى قيمة «${esc(into.name)}» (${money(into.contractValue)}).</p>` : ''}</div>`;
  }

  /* التراجع: «عكس مخزَّن» دقيق بدل استعادة نسخة كاملة — يلقط قبل الدمج كل سجل يمسّ المشروعين
     ثم يعيده كما كان، فلا يُمحى أي تعديل آخر حدث بعد الدمج (استعادة نسخة احتياطية تمحوه). */
  function snapshot(fromId, intoId) {
    const touch = x => x.projectId === fromId || x.projectId === intoId || x.id === fromId || x.id === intoId
      || (x.projectIds || []).includes(fromId) || (x.projectIds || []).includes(intoId);
    const snap = {};
    ['projects', 'suppliers', 'contractors'].concat(MERGE_TYPES).forEach(t => {
      snap[t] = LA(t).filter(touch).map(x => JSON.parse(JSON.stringify(x)));
    });
    return snap;
  }
  function undoMerge(snap, fromId, intoId) {
    const touch = x => x.projectId === fromId || x.projectId === intoId || x.id === fromId || x.id === intoId
      || (x.projectIds || []).includes(fromId) || (x.projectIds || []).includes(intoId);
    Object.keys(snap).forEach(t => {
      const ids = new Set(snap[t].map(x => x.id));
      snap[t].forEach(orig => {
        const cur = S().get(t, orig.id);
        const { id, deletedAt, ...fields } = orig;
        if (!cur) { S().create(t, orig); return; }
        if (orig.deletedAt == null && cur.deletedAt) S().restore(t, id);
        S().update(t, id, fields);
      });
      // سجلات أنشأها الدمج نفسه (لم تكن موجودة قبله)
      L(t).filter(x => !ids.has(x.id) && touch(x) && t !== 'suppliers' && t !== 'contractors').forEach(x => S().remove(t, x.id));
    });
  }
  async function doMerge(fromId, intoId) {
    const from = S().get('projects', fromId), into = S().get('projects', intoId);
    if (!from || !into || fromId === intoId) return;
    const ok = await U().confirm({ title: 'دمج «' + esc(from.name) + '» في «' + esc(into.name) + '»؟', confirmLabel: 'دمج', danger: true,
      body: impactHtml(from, into) + '<p class="cap">يمكنك التراجع فوراً من الإشعار.</p>' });
    if (!ok) return;
    const snap = snapshot(fromId, intoId);
    const im = impact(fromId, intoId);
    try { S().mergeProjects(fromId, intoId); }
    catch (e) { U().toast('تعذّر الدمج: ' + (e && e.message || e), { kind: 'error' }); return; }
    st.mergeFrom = ''; st.mergeInto = '';
    U().toast(`دُمج «${from.name}» في «${into.name}» — انتقل ${D(im.total)} سجلاً`, { kind: 'ok', undo: () => {
      undoMerge(snap, fromId, intoId); U().toast('أُلغي الدمج وعاد «' + from.name + '»', { kind: 'info' });
    } });
  }

  function suggestions() {
    let raw = [];
    try { raw = typeof S().projectMergeSuggestions === 'function' ? (S().projectMergeSuggestions() || []) : null; } catch (e) { raw = null; }
    const live = new Map(L('projects').map(p => [p.id, p]));
    const toIds = it => {
      if (Array.isArray(it)) return it.map(x => x && x.id || x);
      if (!it) return [];
      if (it.ids || it.projectIds) return it.ids || it.projectIds;
      const arr = it.projects || it.variants || it.items;
      if (arr) return arr.map(x => x && x.id || x);
      return [it.fromId || it.from && (it.from.id || it.from) || it.a, it.intoId || it.into && (it.into.id || it.into) || it.b];
    };
    let groups = raw ? raw.map(toIds).map(ids => ids.filter(id => live.has(id))).filter(g => g.length > 1) : null;
    if (!groups) { // احتياط إن لم يوفّر المخزن الدالة
      const by = {};
      live.forEach(p => { (by[normName(p.name)] = by[normName(p.name)] || []).push(p.id); });
      groups = Object.values(by).filter(g => g.length > 1);
    }
    return groups.map(g => g.map(id => live.get(id)));
  }

  function renderMerge(el) {
    const projects = L('projects').sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));
    const groups = suggestions();
    const opt = sel => '<option value="">اختر مشروعاً</option>' + projects.map(p => `<option value="${esc(p.id)}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const from = st.mergeFrom && S().get('projects', st.mergeFrom), into = st.mergeInto && S().get('projects', st.mergeInto);
    el.innerHTML = `<div class="sec-projects">
      <header class="ph"><div><h1>دمج المشاريع</h1><p>نفس المشروع قد يظهر باسمين إن أُدخل من وحدتين مختلفتين — ادمجهما بعد أن ترى الأثر فعلياً</p></div></header>
      <div class="grid">
        <section class="isl c12" style="--i:0"><div class="ih"><h2>مشاريع تبدو مكرّرة</h2><span class="cap">نفس الاسم بعد تجاهل «ال» والهمزات</span></div>
          ${groups.length ? `<div class="sp-sugs">${groups.map((g, gi) => `<div class="sp-sug">
            <b>${g.map(p => '«' + esc(p.name) + '»').join(' / ')}</b>
            ${g.length === 2 ? `<div class="cap">${esc(g[0].name)}: ${D(impact(g[0].id, g[1].id).total)} سجلاً · ${esc(g[1].name)}: ${D(impact(g[1].id, g[0].id).total)} سجلاً</div>` : ''}
            <div class="sp-sug-acts">${g.map(a => g.filter(b => b !== a).map(b =>
              `<button class="btn sm" type="button" data-pick="${esc(a.id)}|${esc(b.id)}">دمج «${esc(a.name)}» في «${esc(b.name)}»</button>`).join('')).join('')}</div></div>`).join('')}</div>`
            : '<p class="empty-note">لا أسماء مكرّرة ظاهرة. يمكنك الدمج يدوياً أدناه.</p>'}
        </section>
        <section class="isl c12" style="--i:1"><div class="ih"><h2>دمج يدوي</h2></div>
          <div class="sp-mrow">
            <label><span class="cap">المصدر (سيختفي)</span><select data-from>${opt(st.mergeFrom)}</select></label>
            <span class="sp-arrow" aria-hidden="true">←</span>
            <label><span class="cap">الهدف (سيبقى)</span><select data-into>${opt(st.mergeInto)}</select></label>
          </div>
          <div class="sp-preview">${from && into && from.id !== into.id ? impactHtml(from, into) + `<button class="btn primary" type="button" data-run>تنفيذ الدمج — «${esc(from.name)}» ← «${esc(into.name)}»</button>`
            : from && into ? '<p class="t-warn">اختر مشروعين مختلفين.</p>' : '<p class="cap">اختر المصدر والهدف لمعاينة الأثر قبل الدمج.</p>'}</div>
        </section>
      </div></div>`;
    el.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => {
      const [a, c] = b.dataset.pick.split('|'); st.mergeFrom = a; st.mergeInto = c; renderMerge(el);
      const pv = el.querySelector('.sp-preview'); if (pv && pv.scrollIntoView) pv.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'center' });
    }));
    el.querySelector('[data-from]').addEventListener('change', e => { st.mergeFrom = e.target.value; renderMerge(el); });
    el.querySelector('[data-into]').addEventListener('change', e => { st.mergeInto = e.target.value; renderMerge(el); });
    const run = el.querySelector('[data-run]'); if (run) run.addEventListener('click', () => doMerge(st.mergeFrom, st.mergeInto));
  }

  /* ─── التسجيل ─── */
  function reg() {
    const sh = window.EGCO && window.EGCO.shell;
    if (!sh || !sh.register) return;
    const losingCount = () => { try { return L('projects').map(metrics).filter(m => m.verdict && m.verdict.kind === 'loss').length; } catch (e) { return 0; } };
    sh.register('projects', { section: 'projects', tab: 'المشاريع', title: 'المشاريع', render: renderProjects, badge: losingCount });
    sh.register('budget', { section: 'projects', tab: 'الموازنة', title: 'الموازنة', render: renderBudget,
      badge: () => { try { return L('projects').filter(p => budgetOf(p.id).conflicts.length).length; } catch (e) { return 0; } } });
    sh.register('merge', { section: 'projects', tab: 'دمج المشاريع', title: 'دمج المشاريع', render: renderMerge,
      badge: () => { try { return suggestions().length; } catch (e) { return 0; } } });
    sh.register('project', { section: 'projects', tab: null, title: 'مشروع', render: renderDetail });
  }
  reg();
})();
