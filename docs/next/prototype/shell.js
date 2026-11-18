/* أرخبيل EGCO — shell.js
 * الهيكل: الشريط الجانبي، الموجّه، التبويبات، جزيرة الحالة (S0–S4)، درج الإشعارات، لوحة الأوامر ⌘K،
 * لوحة «جرّب»، الوضع والأرقام، التحديث التلقائي عند تغيّر البيانات.
 */
(function () {
  'use strict';
  const EGCO = window.EGCO = window.EGCO || {};
  const doc = document;
  const store = () => EGCO.store;
  const ui = () => EGCO.ui;
  const esc = s => (EGCO.ui ? EGCO.ui.esc(s) : String(s == null ? '' : s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'));

  const SECTIONS = [
    { key: 'today', label: 'اليوم', group: 'العمل اليومي', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
    { key: 'parties', label: 'الأطراف', icon: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>' },
    { key: 'projects', label: 'المشاريع', icon: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>' },
    { key: 'cash', label: 'النقد', icon: '<path d="M3 17l5-5 4 4 8-8M15 8h5v5"/>' },
    { key: 'reports', label: 'التقارير', icon: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 13h6M9 17h4"/>' },
    { key: 'data', label: 'البيانات', group: 'النظام', icon: '<ellipse cx="12" cy="5.5" rx="8" ry="2.5"/><path d="M4 5.5v13c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-13M4 12c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5"/>' },
  ];
  const SEC_KEYS = SECTIONS.map(s => s.key);
  const secOf = k => SECTIONS.find(s => s.key === k);

  const views = {};
  const order = [];
  const lastTab = {};
  const visited = new Set();
  let cur = { view: null, params: {} };
  let started = false;
  let el = {};

  /* ═══ التسجيل ═══ */
  function register(key, def) {
    try {
      if (!key || !def || typeof def.render !== 'function') { console.warn('[shell] تسجيل غير صالح:', key); return false; }
      if (!SEC_KEYS.includes(def.section)) console.warn('[shell] قسم غير معروف للعرض', key, def.section);
      views[key] = Object.assign({ key, tab: null, title: '' }, def);
      if (!order.includes(key)) order.push(key);
      if (started) {
        renderTabs();
        if (cur.missing && (cur.view === key || cur.view === def.section)) go(cur.view, cur.params, { replace: true });
      }
      return true;
    } catch (e) { console.error('[shell] register', key, e); return false; }
  }
  function defaultViewOf(sec) {
    if (lastTab[sec] && views[lastTab[sec]]) return lastTab[sec];
    return order.find(k => views[k].section === sec && views[k].tab) || order.find(k => views[k].section === sec) || null;
  }

  /* ═══ الموجّه ═══ */
  let suppressHash = false;
  const SS = 'egco-proto-v2:route';
  function saveRoute() { try { sessionStorage.setItem(SS, JSON.stringify(cur.missing ? { view: cur.view, params: cur.params } : { view: cur.view, params: cur.params })); } catch (e) { /* لا شيء */ } }
  function readRoute() { try { return JSON.parse(sessionStorage.getItem(SS) || 'null'); } catch (e) { return null; } }
  function go(view, params, opts) {
    opts = opts || {};
    params = params || {};
    if (!view) view = 'today';
    // اسم قسم بلا عرض بالاسم نفسه → التبويب الأخير/الأول فيه
    if (!views[view] && SEC_KEYS.includes(view)) { const d = defaultViewOf(view); if (d) view = d; }
    const def = views[view];
    const prev = cur.view;
    cur = { view, params, missing: !def, section: def ? def.section : (SEC_KEYS.includes(view) ? view : guessSection(view)) };
    if (def && def.tab) lastTab[def.section] = view;
    if (decodeURIComponent(location.hash.slice(1)) !== view) {
      try {
        if (opts.replace) history.replaceState(null, '', '#' + view);
        else { suppressHash = true; location.hash = view; }
      } catch (e) { suppressHash = false; }
    }
    saveRoute();
    if (palOpen) closePalette();
    const first = !visited.has(view);
    visited.add(view);
    renderView(first ? 'first' : (prev === view && !opts.anim ? 'refresh' : 'revisit'), opts.keepScroll || prev === view);
    if (!opts.keepScroll && prev !== view) window.scrollTo(0, 0);
  }
  const DETAIL_GUESS = { supplier: 'parties', contractor: 'parties', project: 'projects', due: 'today', calendar: 'today', suppliers: 'parties', contractors: 'parties', guarantees: 'parties', budget: 'projects', merge: 'projects', collections: 'cash', report: 'reports', exports: 'reports', present: 'reports', import: 'data', coverage: 'data', backups: 'data', trash: 'data', settings: 'data' };
  function guessSection(view) { return DETAIL_GUESS[view] || 'today'; }
  function onHash() {
    if (suppressHash) { suppressHash = false; return; }
    const v = decodeURIComponent(location.hash.slice(1)).split('?')[0];
    if (!v || v === cur.view) return;
    const saved = readRoute();
    go(v, saved && saved.view === v ? saved.params : {}, { replace: true });
  }
  function current() { return { view: cur.view, params: cur.params, section: cur.section }; }

  /* ═══ رسم العرض ═══ */
  function captureFocus() {
    const a = doc.activeElement;
    if (!a || !el.view.contains(a) || a === el.view) return null;
    const sel = a.id ? '#' + CSS.escape(a.id) : a.name ? `[name="${CSS.escape(a.name)}"]` : a.getAttribute('aria-label') ? `[aria-label="${CSS.escape(a.getAttribute('aria-label'))}"]` : null;
    let pos = null; try { pos = [a.selectionStart, a.selectionEnd]; } catch (e) { pos = null; }
    return sel ? { sel, pos } : null;
  }
  function restoreFocus(f) {
    if (!f) return;
    const n = el.view.querySelector(f.sel); if (!n) return;
    n.focus({ preventScroll: true });
    if (f.pos && f.pos[0] != null) try { n.setSelectionRange(f.pos[0], f.pos[1]); } catch (e) { /* لا شيء */ }
  }
  function renderView(mode, keepScroll) {
    const def = views[cur.view];
    const sec = cur.section;
    setNav(sec);
    renderTabs();
    const y = window.scrollY;
    const focus = mode === 'refresh' ? captureFocus() : null;
    const host = el.view;
    host.className = 'view sec-' + sec;
    host.innerHTML = '';
    if (!def) {
      host.innerHTML = missingState(sec, cur.view);
    } else {
      try {
        def.render(host, cur.params || {});
      } catch (e) {
        console.error('[shell] render', cur.view, e);
        host.innerHTML = errorState(def, e);
      }
    }
    const items = host.querySelectorAll('.isl,.ph');
    if (mode === 'refresh') items.forEach(x => { x.style.animation = 'none'; });
    else if (mode === 'revisit') items.forEach(x => { x.style.animationDuration = '120ms'; x.style.animationDelay = '0ms'; });
    if (ui()) ui().animateNumbers(host, mode === 'first');
    doc.title = (def && def.title ? def.title + ' · ' : '') + 'أرخبيل EGCO';
    if (mode === 'refresh' || keepScroll) window.scrollTo(0, y);
    restoreFocus(focus);
  }
  function missingState(sec, view) {
    const s = secOf(sec) || { label: '' };
    return `<div class="ph"><div><h1>${esc(s.label)}</h1><p>هذا الجزء غير متاح في هذه النسخة</p></div></div><div class="grid"><section class="isl c12">${ui() ? ui().emptyState({ icon: 'file', title: 'لم يُحمَّل هذا العرض', body: 'تعذّر تحميل ملف القسم «' + esc(view || sec) + '». بقية التطبيق يعمل كالمعتاد — جرّب قسماً آخر من الشريط.' }) : ''}</section></div>`;
  }
  function errorState(def, e) {
    return `<div class="ph"><div><h1>${esc(def.title || '')}</h1><p>حدث خطأ أثناء عرض هذه الصفحة</p></div></div><div class="grid"><section class="isl c12">${ui().emptyState({ icon: 'alert', title: 'تعذّر عرض الصفحة', body: 'البيانات سليمة ولم يتغيّر شيء. التفاصيل التقنية: <code dir="ltr">' + esc(e && e.message || e) + '</code>', cta: 'إعادة المحاولة', onCta: () => refresh() })}</section></div>`;
  }
  let refreshQueued = false;
  function refresh() { if (!started) return; renderView('refresh', true); refreshBase(); }
  function scheduleRefresh() {
    if (refreshQueued) return; refreshQueued = true;
    (window.requestAnimationFrame || setTimeout)(() => { refreshQueued = false; const def = views[cur.view]; if (def && def.autoRefresh === false) { renderTabs(); refreshBase(); return; } refresh(); });
  }

  /* ═══ التبويبات والشريط ═══ */
  function badgeOf(k) { try { const n = views[k].badge ? +views[k].badge() : 0; return isFinite(n) && n > 0 ? n : 0; } catch (e) { return 0; } }
  function renderTabs() {
    if (!el.tabs) return;
    const sec = cur.section;
    const tabs = order.filter(k => views[k].section === sec && views[k].tab);
    if (tabs.length < 2) { el.tabs.innerHTML = ''; el.tabs.hidden = true; return; }
    el.tabs.hidden = false;
    const def = views[cur.view];
    const active = def && def.tab ? cur.view : (def && def.parentTab) || lastTab[sec] || tabs[0];
    const D = ui() ? ui().digits : String;
    el.tabs.innerHTML = tabs.map(k => { const b = badgeOf(k); return `<button role="tab" type="button" aria-selected="${k === active}" tabindex="${k === active ? 0 : -1}" data-tab="${esc(k)}">${esc(views[k].tab)}${b ? `<span class="cnt2">${D(b)}</span>` : ''}</button>`; }).join('');
  }
  function setNav(sec) {
    el.nav.querySelectorAll('button[data-sec]').forEach(b => b.setAttribute('aria-current', b.dataset.sec === sec ? 'page' : 'false'));
    moveIndicator();
  }
  function moveIndicator() {
    const a = el.nav && el.nav.querySelector('button[aria-current="page"]');
    if (a && el.ind) el.ind.style.transform = `translateY(${a.offsetTop + (a.offsetHeight - 20) / 2}px)`;
  }

  /* ═══ جزيرة الحالة ═══ */
  const isl = { base: 's0', active: null, timer: null };
  function setIsland(s) {
    if (!el.status) return;
    el.status.dataset.s = s;
    el.status.querySelectorAll('.face').forEach(f => f.classList.toggle('on', f.dataset.f === s));
    el.status.setAttribute('aria-live', s === 's4' ? 'assertive' : 'polite');
  }
  function release(s) { if (!s || isl.active === s) { clearTimeout(isl.timer); isl.active = null; setIsland(isl.base); } }
  const RANK = { s4: 4, s2: 3, s3: 2 };
  function claim(s, ms) {
    if (store().db.settings.island === false && s !== 's4') return false;
    if (isl.active && isl.active !== s && RANK[isl.active] > RANK[s]) return false;
    clearTimeout(isl.timer); isl.active = s; setIsland(s);
    if (ms) isl.timer = setTimeout(() => release(s), ms);
    return true;
  }
  const islandApi = {
    event(kind, data) {
      data = data || {};
      const D = ui().digits;
      if (kind === 'import') {
        const pct = Math.max(0, Math.min(100, Math.round(data.pct || 0)));
        if (data.file) el.impTxt.textContent = 'استيراد — ' + data.file;
        el.impPct.textContent = D(pct) + '%';
        el.impBar.style.transform = `scaleX(${pct / 100})`;
        if (!claim('s2')) return;
        if (data.done || pct >= 100) { clearTimeout(isl.timer); isl.timer = setTimeout(() => release('s2'), 700); }
      } else if (kind === 'backup') {
        if (data.phase === 'done') {
          if (isl.active !== 's3' && !claim('s3')) return;
          el.bkIcon.className = 'st-check'; el.bkIcon.textContent = '✓';
          el.bkTxt.textContent = 'تم الحفظ' + (data.sizeKb ? ' — ' + D(data.sizeKb >= 1024 ? (data.sizeKb / 1024).toFixed(1) + ' م.ب' : Math.round(data.sizeKb) + ' ك.ب') : '');
          clearTimeout(isl.timer); isl.timer = setTimeout(() => release('s3'), 1600);
        } else {
          el.bkIcon.className = 'st-ring'; el.bkIcon.textContent = ''; el.bkTxt.textContent = 'نسخ احتياطي…';
          claim('s3', 8000);
        }
      } else if (kind === 'deficit') {
        el.s4d.textContent = D(data.detail || '');
        claim('s4', data.ms || 6000);
      } else if (kind === 'idle') release();
    },
    get state() { return isl.active || isl.base; },
  };
  let lastUnread = -1;
  function refreshBase() {
    if (!started) return;
    const D = ui().digits;
    const n = store().unreadCount();
    isl.base = n ? 's1' : 's0';
    if (el.stCount.textContent !== D(n) || lastUnread !== n) {
      el.stCount.textContent = D(n);
      if (lastUnread >= 0 && n > lastUnread) { el.stCount.classList.remove('pop'); void el.stCount.offsetWidth; el.stCount.classList.add('pop'); }
    }
    lastUnread = n;
    el.navCount.textContent = D(n); el.navCount.hidden = !n;
    el.status.setAttribute('aria-label', (n ? D(n) + ' إشعارات غير مقروءة' : 'لا تنبيهات') + ' — انقر لفتح الإشعارات');
    if (!isl.active) setIsland(isl.base);
    const dt = ui().dateTxt(store().TODAY, { weekday: true });
    el.status.querySelectorAll('[data-date]').forEach(x => { x.textContent = dt; });
    renderFoot();
    renderDemoLabels();
  }
  function renderFoot() {
    const b = store().list('backups').slice().sort((a, c) => a.at < c.at ? 1 : -1)[0];
    el.foot.innerHTML = `<span class="dot${store().persistent ? '' : ' warn'}"></span><span class="sf-t">${b ? 'آخر نسخة احتياطية ' + esc(ui().ago(b.at)) : 'لا نسخ احتياطية بعد'}${store().persistent ? '' : ' · <b>في الذاكرة فقط</b>'}</span>`;
  }

  /* ═══ درج الإشعارات ═══ */
  let drawerOpen = false, dTab = 'unread';
  function openDrawer() {
    if (drawerOpen) return closeDrawer();
    drawerOpen = true;
    el.status.classList.add('paused');
    const scrim = doc.createElement('div'); scrim.className = 'scrim'; scrim.id = 'scrim'; scrim.onclick = closeDrawer;
    const dr = doc.createElement('aside'); dr.className = 'drawer'; dr.id = 'drawer'; dr.setAttribute('role', 'dialog'); dr.setAttribute('aria-modal', 'true'); dr.setAttribute('aria-label', 'الإشعارات'); dr.lang = 'ar';
    doc.body.append(scrim, dr);
    renderDrawer();
    const f = dr.querySelector('[data-dtab][aria-pressed="true"]') || dr.querySelector('button'); if (f) f.focus();
  }
  function closeDrawer() {
    if (!drawerOpen) return; drawerOpen = false;
    el.status.classList.remove('paused');
    const s = doc.getElementById('scrim'), d = doc.getElementById('drawer');
    if (s) s.classList.add('out'); if (d) d.classList.add('out');
    setTimeout(() => { if (s) s.remove(); if (d) d.remove(); }, ui().reduced() ? 0 : 240);
    el.status.focus();
  }
  function dayGroup(at) {
    const d = new Date(at), t = new Date();
    const key = x => x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate();
    if (key(d) === key(t)) return 'اليوم';
    const y = new Date(t); y.setDate(t.getDate() - 1);
    if (key(d) === key(y)) return 'أمس';
    return ui().dateTxt(d, { weekday: true });
  }
  function renderDrawer() {
    const dr = doc.getElementById('drawer'); if (!dr) return;
    const D = ui().digits;
    const all = store().list('notes').filter(n => !n.archived).sort((a, b) => a.at < b.at ? 1 : -1);
    const unread = all.filter(n => !n.read);
    const listN = dTab === 'unread' ? unread : all;
    const groups = [];
    listN.forEach(n => { const g = dayGroup(n.at); let grp = groups.find(x => x.g === g); if (!grp) groups.push(grp = { g, items: [] }); grp.items.push(n); });
    const ICON = { d: '!', w: '△', o: '✓', i: 'i' };
    dr.innerHTML = `<div class="dh"><h2>الإشعارات</h2><div class="dh-acts">${unread.length ? '<button type="button" class="lnk" data-readall>تعليم الكل كمقروء</button>' : ''}<button type="button" class="m-x" data-dclose aria-label="إغلاق"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div></div>
      <div class="dtabs"><div class="seg" role="group" aria-label="عرض"><button type="button" aria-pressed="${dTab === 'unread'}" data-dtab="unread">غير مقروء (${D(unread.length)})</button><button type="button" aria-pressed="${dTab === 'all'}" data-dtab="all">الكل</button></div></div>
      <div class="dlist">${listN.length ? groups.map(gr => `<div class="grp">${esc(gr.g)}</div>` + gr.items.map((n, i) => `<div class="note ${n.read ? 'read' : ''}" data-note="${esc(n.id)}" style="animation-delay:${Math.min(i, 8) * 40}ms" tabindex="0" role="button" aria-label="${esc(n.title)}"><span class="ud"></span><span class="ic ${esc(n.sev)}">${ICON[n.sev] || 'i'}</span><div class="bd"><div class="nt">${D(esc(n.title))}</div><div class="nd">${D(esc(n.detail))}</div></div><div class="n-side"><span class="tm">${esc(ui().ago(n.at))}</span><button type="button" class="n-arch" data-arch="${esc(n.id)}" aria-label="أرشفة" title="أرشفة"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h16v3H4zM6 10v9h12v-9M10 14h4"/></svg></button></div></div>`).join('')).join('')
        : `<div class="dempty">${ui().iconSvg('bell', 56)}<p>${dTab === 'unread' ? 'لا شيء يحتاج انتباهك' : 'لا إشعارات'}</p></div>`}</div>`;
    dr.onclick = e => {
      const t = e.target;
      if (t.closest('[data-dclose]')) return closeDrawer();
      if (t.closest('[data-readall]')) { store().markAllRead(); renderDrawer(); return; }
      const tb = t.closest('[data-dtab]'); if (tb) { dTab = tb.dataset.dtab; renderDrawer(); const n = doc.querySelector(`[data-dtab="${dTab}"]`); if (n) n.focus(); return; }
      const ar = t.closest('[data-arch]'); if (ar) { const id = ar.dataset.arch; store().update('notes', id, { archived: true, read: true }); renderDrawer(); ui().toast('أُرشف الإشعار', { undo: () => store().update('notes', id, { archived: false }) }); return; }
      const nt = t.closest('[data-note]'); if (nt) openNote(nt.dataset.note);
    };
    dr.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-note]')) { e.preventDefault(); openNote(e.target.dataset.note); } };
  }
  function openNote(id) {
    const n = store().get('notes', id); if (!n) return;
    if (!n.read) store().update('notes', id, { read: true });
    if (n.link && n.link.view) { closeDrawer(); go(n.link.view, n.link.params || {}); }
    else renderDrawer();
  }

  /* ═══ لوحة الأوامر ⌘K ═══ */
  let palOpen = false, palEl = null, palItems = [], palIdx = 0;
  function palSource() {
    const S = store(), out = [];
    order.forEach(k => { const v = views[k]; if (v.tab) out.push({ group: 'الصفحات', label: v.tab, sub: (secOf(v.section) || {}).label || '', run: () => go(k) }); });
    S.list('suppliers').forEach(s => out.push({ group: 'الموردون', label: s.name, sub: s.account, run: () => go(views.supplier ? 'supplier' : 'suppliers', { id: s.id }) }));
    S.list('contractors').forEach(c => out.push({ group: 'المقاولون', label: c.name, sub: c.code, run: () => go(views.contractor ? 'contractor' : 'contractors', { id: c.id }) }));
    S.list('projects').forEach(p => out.push({ group: 'المشاريع', label: p.name, sub: 'مشروع', run: () => go(views.project ? 'project' : 'projects', { id: p.id }) }));
    out.push({ group: 'إجراءات', label: 'استيراد كشف مثال', sub: 'CSV', run: demoImport });
    out.push({ group: 'إجراءات', label: 'نسخة احتياطية الآن', sub: '', run: () => S.backup('manual') });
    out.push({ group: 'إجراءات', label: 'فتح الإشعارات', sub: '⌘.', run: () => openDrawer() });
    out.push({ group: 'إجراءات', label: 'تبديل الوضع (فاتح/داكن)', sub: '', run: cycleTheme });
    out.push({ group: 'إجراءات', label: 'تبديل الأرقام 123 / ١٢٣', sub: '', run: toggleDigits });
    return out;
  }
  function openPalette() {
    if (palOpen) return closePalette();
    if (ui().isModalOpen()) return;
    if (drawerOpen) closeDrawer();
    palOpen = true;
    palEl = doc.createElement('div'); palEl.className = 'pal-scrim'; palEl.lang = 'ar';
    palEl.innerHTML = `<div class="pal" role="dialog" aria-modal="true" aria-label="بحث شامل"><div class="pal-in"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input type="text" placeholder="ابحث عن مورد، مقاول، مشروع، صفحة…" aria-label="بحث" role="combobox" aria-expanded="true" aria-controls="palList" autocomplete="off"><kbd>Esc</kbd></div><div class="pal-list" id="palList" role="listbox"></div></div>`;
    doc.body.appendChild(palEl);
    const inp = palEl.querySelector('input');
    const src = palSource();
    const draw = () => {
      const q = store().util.normAr(inp.value);
      palItems = (q ? src.filter(x => store().util.normAr(x.label + ' ' + x.sub + ' ' + x.group).includes(q)) : src.filter(x => x.group === 'الصفحات' || x.group === 'إجراءات')).slice(0, 40);
      palIdx = Math.min(palIdx, Math.max(0, palItems.length - 1));
      let g = null;
      palEl.querySelector('.pal-list').innerHTML = palItems.length ? palItems.map((x, i) => (x.group !== g ? `<div class="pal-g">${esc(g = x.group)}</div>` : '') + `<div class="pal-i" role="option" id="pal${i}" data-i="${i}" aria-selected="${i === palIdx}"><span>${esc(x.label)}</span><span class="cap num">${esc(x.sub)}</span></div>`).join('') : `<div class="pal-none">لا نتائج لـ«${esc(inp.value)}»</div>`;
      inp.setAttribute('aria-activedescendant', palItems.length ? 'pal' + palIdx : '');
      const a = palEl.querySelector('.pal-i[aria-selected="true"]'); if (a) a.scrollIntoView({ block: 'nearest' });
    };
    inp.addEventListener('input', () => { palIdx = 0; draw(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); draw(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); draw(); }
      else if (e.key === 'Enter') { e.preventDefault(); runPal(palIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
      else if (e.key === 'Tab') e.preventDefault();
    });
    palEl.addEventListener('mousedown', e => { if (e.target === palEl) closePalette(); });
    palEl.addEventListener('click', e => { const it = e.target.closest('[data-i]'); if (it) runPal(+it.dataset.i); });
    palEl.addEventListener('mousemove', e => { const it = e.target.closest('[data-i]'); if (it && +it.dataset.i !== palIdx) { palIdx = +it.dataset.i; palEl.querySelectorAll('.pal-i').forEach(x => x.setAttribute('aria-selected', x.dataset.i == palIdx)); } });
    draw(); inp.focus();
  }
  function runPal(i) { const it = palItems[i]; closePalette(); if (it) try { it.run(); } catch (e) { console.error(e); } }
  function closePalette() { if (!palOpen) return; palOpen = false; if (palEl) palEl.remove(); palEl = null; }

  /* ═══ الوضع والأرقام ═══ */
  function applyTheme() {
    const t = store().db.settings.theme;
    if (t === 'light' || t === 'dark') doc.documentElement.dataset.theme = t; else delete doc.documentElement.dataset.theme;
  }
  function cycleTheme() {
    const t = store().db.settings.theme;
    store().setSettings({ theme: t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system' });
  }
  function toggleDigits() { store().setSettings({ digits: store().db.settings.digits === 'arab' ? 'latin' : 'arab' }); }

  /* ═══ لوحة «جرّب» ═══ */
  function demoImport() {
    const S = store();
    S.importCSV(S.sampleCSV(), { fileName: 'كشف مثال — البناء الحديث.csv' }).then(r => {
      if (r.status === 'failed') ui().toast('فشل الاستيراد: ' + esc(r.error || ''), { kind: 'error' });
      else if (r.diff && r.diff.added === 0) ui().toast('الملف مستورد سابقاً — كل الصفوف «مطابقة مسبقاً» ولم يتكرر شيء', { kind: 'info' });
      else ui().toast('استُورد الكشف: ' + ui().int(r.diff.added) + ' حركة جديدة', { undo: () => S.revertImport(r.importId) });
    }).catch(e => ui().toast(esc(e.message || e), { kind: 'info' }));
  }
  function hasDeficit() { return store().cashProjection(30).some(p => p.balance < 0); }
  function demoDeficit() {
    const S = store(), st = S.db.settings;
    if (hasDeficit()) {
      const prev = st.demoPrevBalance;
      if (prev != null) { S.setSettings({ bankBalance: prev, demoPrevBalance: null }); ui().toast('أُلغي العجز — عاد الرصيد إلى ' + ui().fmt(prev) + ' ر.س'); }
      else { const low = Math.min(...S.cashProjection(30).map(p => p.balance)); S.setSettings({ bankBalance: Math.ceil((st.bankBalance - low + 250000) / 1000) * 1000 }); ui().toast('رُفع الرصيد لإزالة العجز'); }
      return;
    }
    const low = Math.min(...S.cashProjection(30).map(p => p.balance));
    const next = Math.floor((st.bankBalance - (low + 420000)) / 1000) * 1000;
    S.setSettings({ bankBalance: next, demoPrevBalance: st.bankBalance });
  }
  function renderDemoLabels() {
    if (!el.demo) return;
    const st = store().db.settings;
    const dg = el.demo.querySelector('[data-demo="digits"]'); if (dg) { dg.textContent = 'الأرقام: ' + (st.digits === 'arab' ? '١٢٣' : '123'); dg.setAttribute('aria-pressed', st.digits === 'arab'); }
    const th = el.demo.querySelector('[data-demo="theme"]'); if (th) th.textContent = 'الوضع: ' + ({ system: 'تلقائي', light: 'فاتح', dark: 'داكن' }[st.theme] || 'تلقائي');
    const df = el.demo.querySelector('[data-demo="deficit"]'); if (df) df.textContent = hasDeficit() ? 'إلغاء العجز' : 'عجز نقدي';
  }
  function setDemoCollapsed(c) {
    el.demo.classList.toggle('collapsed', c);
    el.demo.querySelector('.demo-tg').setAttribute('aria-expanded', String(!c));
    ui().setUiPref('demoCollapsed', c);
  }
  function setSideCollapsed(c) {
    el.app.classList.toggle('collapsed', c);
    doc.documentElement.style.setProperty('--side-w', c ? '72px' : '248px');
    el.sideTg.setAttribute('aria-label', c ? 'توسيع الشريط' : 'طي الشريط');
    el.sideTg.setAttribute('aria-expanded', String(!c));
    ui().setUiPref('sideCollapsed', c);
    setTimeout(moveIndicator, 260);
  }

  /* ═══ البناء ═══ */
  function build() {
    let host = doc.getElementById('egco-root');
    if (!host) { host = doc.createElement('div'); host.id = 'egco-root'; doc.body.appendChild(host); }
    const navBtns = SECTIONS.map(s => (s.group ? `<div class="sec">${s.group}</div>` : '') +
      `<button type="button" data-sec="${s.key}" aria-current="false" title="${s.label}"><svg viewBox="0 0 24 24" aria-hidden="true">${s.icon}</svg><span class="lbl">${s.label}</span>${s.key === 'today' ? '<span class="cnt" id="navCount" hidden>0</span>' : ''}</button>`).join('');
    host.innerHTML = `<div class="app" id="app" lang="ar" dir="rtl">
  <aside class="side" aria-label="التنقل">
    <div class="brand"><img class="logo-full" src="assets/logo-reverse.png" alt="إعمار الخليج للمقاولات — EGCO" width="148"><img class="logo-mark" src="assets/logo-mark.png" alt="EGCO" height="32"></div>
    <nav class="nav" id="nav"><span class="indicator" id="indicator" aria-hidden="true"></span>${navBtns}</nav>
    <div class="side-foot"><div id="sideFoot"></div><button type="button" class="side-tg" id="sideTg" aria-expanded="true" aria-label="طي الشريط"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 6l-6 6 6 6M20 4v16"/></svg></button></div>
  </aside>
  <main id="main">
    <div class="island-dock">
      <button type="button" class="status" id="status" data-s="s0" aria-live="polite" aria-label="الحالة — انقر لفتح الإشعارات">
        <div class="face" data-f="s0"><img class="st-logo" src="assets/logo-mark.png" alt="" aria-hidden="true"><span class="pdot ok"></span><span class="st-date" data-date></span><span class="st-sep"></span><span class="st-dim">لا تنبيهات</span></div>
        <div class="face" data-f="s1"><img class="st-logo" src="assets/logo-mark.png" alt="" aria-hidden="true"><span class="pdot bad"></span><span class="st-date" data-date></span><span class="st-count" id="stCount">0</span></div>
        <div class="face" data-f="s2" style="align-items:flex-start;padding-top:9px"><div class="f-row"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#E3B071" stroke-width="1.8"><path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/></svg><span id="impTxt" class="st-trunc">استيراد</span><span class="num st-dim" id="impPct" style="margin-inline-start:auto">0%</span></div><span class="st-prog"><i id="impBar"></i></span></div>
        <div class="face" data-f="s3"><span id="bkIcon" class="st-ring"></span><span id="bkTxt">نسخ احتياطي…</span></div>
        <div class="face s4" data-f="s4" style="align-items:flex-start;padding-top:14px"><div style="flex:1;min-width:0"><div class="f-row"><span class="pdot bad"></span><span class="t">عجز نقدي متوقع</span><span class="ghost" id="s4go">عرض</span></div><div class="d" id="s4d"></div></div></div>
      </button>
    </div>
    <div class="tabs" id="tabs" role="tablist" aria-label="صفحات القسم" hidden></div>
    <div id="view" class="view"></div>
  </main>
</div>
<div class="toasts" id="toasts" aria-live="polite"></div>
<div class="demo" id="demo" lang="ar" dir="rtl" aria-label="لوحة التجربة">
  <button type="button" class="demo-tg" aria-expanded="true" aria-controls="demoBody"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg>جرّب</button>
  <div class="demo-body" id="demoBody">
    <button type="button" class="btn sm" data-demo="import">استيراد CSV مثال</button>
    <button type="button" class="btn sm" data-demo="backup">نسخة احتياطية</button>
    <button type="button" class="btn sm" data-demo="deficit">عجز نقدي</button>
    <span class="sp"></span>
    <button type="button" class="btn sm" data-demo="digits" aria-pressed="false">الأرقام: 123</button>
    <button type="button" class="btn sm" data-demo="theme">الوضع</button>
    <button type="button" class="btn sm" data-demo="palette" title="⌘K / Ctrl+K">بحث ⌘K</button>
    <span class="sp"></span>
    <button type="button" class="btn sm" data-demo="reset">إعادة ضبط البيانات</button>
  </div>
</div>`;
    const $ = id => doc.getElementById(id);
    el = { app: $('app'), nav: $('nav'), ind: $('indicator'), tabs: $('tabs'), view: $('view'), status: $('status'), stCount: $('stCount'), navCount: $('navCount'),
      impTxt: $('impTxt'), impPct: $('impPct'), impBar: $('impBar'), bkIcon: $('bkIcon'), bkTxt: $('bkTxt'), s4d: $('s4d'), foot: $('sideFoot'), demo: $('demo'), sideTg: $('sideTg') };
  }
  function bind() {
    el.nav.addEventListener('click', e => {
      const b = e.target.closest('button[data-sec]'); if (!b) return;
      const sec = b.dataset.sec;
      go(defaultViewOf(sec) || sec, {});
    });
    el.tabs.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab, {}); });
    el.tabs.addEventListener('keydown', e => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const all = [...el.tabs.querySelectorAll('[data-tab]')]; let i = all.indexOf(b);
      i = e.key === 'Home' ? 0 : e.key === 'End' ? all.length - 1 : (i + (e.key === 'ArrowLeft' ? 1 : -1) + all.length) % all.length;
      go(all[i].dataset.tab, {}); const n = el.tabs.querySelector(`[data-tab="${CSS.escape(all[i].dataset.tab)}"]`); if (n) n.focus();
    });
    el.status.addEventListener('click', e => {
      if (e.target.closest('#s4go')) { release('s4'); go('cash'); return; }
      openDrawer();
    });
    el.sideTg.addEventListener('click', () => setSideCollapsed(!el.app.classList.contains('collapsed')));
    el.demo.addEventListener('click', e => {
      if (e.target.closest('.demo-tg')) { setDemoCollapsed(!el.demo.classList.contains('collapsed')); return; }
      const b = e.target.closest('[data-demo]'); if (!b) return;
      const k = b.dataset.demo, S = store();
      if (k === 'import') demoImport();
      else if (k === 'backup') S.backup('manual');
      else if (k === 'deficit') demoDeficit();
      else if (k === 'digits') toggleDigits();
      else if (k === 'theme') cycleTheme();
      else if (k === 'palette') openPalette();
      else if (k === 'reset') ui().confirm({ title: 'إعادة ضبط البيانات؟', body: 'تُستبدل كل البيانات الحالية ببيانات المثال الأصلية. تُحذف التعديلات والاستيرادات والنسخ الاحتياطية التي أنشأتها.', danger: true, confirmLabel: 'إعادة الضبط' }).then(ok => {
        if (!ok) return; S.reset(); visited.clear(); lastUnread = -1; release(); go('today', {}); ui().toast('أُعيدت بيانات المثال');
      });
    });
    doc.addEventListener('keydown', e => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); openPalette(); return; }
      if (mod && e.key === '.') { e.preventDefault(); if (!ui().isModalOpen()) openDrawer(); return; }
      if (e.key === 'Escape' && !e.defaultPrevented && !ui().isModalOpen()) { if (palOpen) { e.preventDefault(); closePalette(); } else if (drawerOpen) { e.preventDefault(); closeDrawer(); } }
      if (e.key === 'Tab' && drawerOpen && !ui().isModalOpen()) {
        const dr = doc.getElementById('drawer'); if (!dr) return;
        const f = [...dr.querySelectorAll('button,[tabindex="0"]')]; if (!f.length) return;
        if (e.shiftKey && (doc.activeElement === f[0] || !dr.contains(doc.activeElement))) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (doc.activeElement === f[f.length - 1] || !dr.contains(doc.activeElement))) { e.preventDefault(); f[0].focus(); }
      }
    });
    window.addEventListener('hashchange', onHash);
    window.addEventListener('resize', moveIndicator);
    const S = store();
    S.on('change', info => {
      if (info && (info.type === 'settings' || info.type === '*')) applyTheme();
      if (info && info.type === '*' && info.op === 'reset') { visited.clear(); lastUnread = -1; release(); }
      scheduleRefresh();
      if (drawerOpen) renderDrawer();
    });
    S.on('note', n => {
      refreshBase();
      if (drawerOpen) renderDrawer();
      if (!n) return;
      if (n.kind === 'deficit') islandApi.event('deficit', { detail: n.detail });
      if (S.db.settings.osNotifications && !n.read && 'Notification' in window && Notification.permission === 'granted') try { new Notification(n.title, { body: n.detail, lang: 'ar', dir: 'rtl' }); } catch (e) { /* لا شيء */ }
    });
    S.on('import:progress', d => islandApi.event('import', d));
    S.on('import:done', d => islandApi.event('import', { pct: 100, done: true, file: d && d.file }));
    S.on('backup:start', () => islandApi.event('backup', { phase: 'start' }));
    S.on('backup:done', d => islandApi.event('backup', { phase: 'done', sizeKb: d && d.sizeKb }));
    if (window.matchMedia) {
      const mq = matchMedia('(prefers-color-scheme: dark)');
      const h = () => { if (store().db.settings.theme === 'system') scheduleRefresh(); };
      if (mq.addEventListener) mq.addEventListener('change', h);
    }
  }
  function start() {
    if (started) return;
    if (!store() || !ui()) {
      const r = doc.getElementById('egco-root');
      if (r) r.innerHTML = '<div style="padding:48px;font-family:sans-serif;direction:rtl">تعذّر تحميل ملفات التطبيق الأساسية. أعد تحميل الصفحة.</div>';
      return;
    }
    build();
    started = true;
    applyTheme();
    const prefs = ui().uiPrefs();
    if (prefs.sideCollapsed) setSideCollapsed(true); else doc.documentElement.style.setProperty('--side-w', '248px');
    if (prefs.demoCollapsed) setDemoCollapsed(true);
    bind();
    try { store().dailyIfDue(); } catch (e) { console.error(e); }
    try { store().checkAlerts(); } catch (e) { console.error(e); }
    refreshBase();
    const hv = decodeURIComponent(location.hash.slice(1)).split('?')[0];
    const saved = readRoute();
    const target = hv && (views[hv] || SEC_KEYS.includes(hv) || DETAIL_GUESS[hv]) ? hv : (defaultViewOf('today') || 'today');
    go(target, saved && saved.view === target ? saved.params : {}, { replace: true });
    setTimeout(moveIndicator, 50);
    if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(moveIndicator);
  }

  EGCO.shell = {
    register, go, current, refresh, start,
    island: islandApi,
    openDrawer, closeDrawer, openPalette,
    views, sections: SECTIONS,
  };
})();
