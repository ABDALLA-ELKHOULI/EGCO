/* أرخبيل EGCO — ui.js
 * تنسيق، حركة، مخططات، toast، نوافذ، نماذج، الجدول، KPI، التصدير.
 * اصطلاح: كل نص يُمرَّر هنا يُعامل كـHTML — النص القادم من المستخدم يمرّ بـui.esc عند المستدعي.
 */
(function () {
  'use strict';
  const EGCO = window.EGCO = window.EGCO || {};
  const store = () => EGCO.store;
  const doc = document;

  /* ═══ تنسيق ═══ */
  const AR = '٠١٢٣٤٥٦٧٨٩';
  const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const isArab = () => { try { return store().db.settings.digits === 'arab'; } catch (e) { return false; } };
  function digits(s) {
    s = String(s == null ? '' : s);
    return isArab() ? s.replace(/[0-9]/g, c => AR[c]).replace(/,/g, '٬').replace(/\./g, '٫') : s;
  }
  /* digits على نص HTML: يحوّل الأرقام خارج الوسوم فقط */
  function digitsHTML(html) { return isArab() ? String(html).replace(/>([^<]*)</g, (m, t) => '>' + digits(t) + '<').replace(/^([^<]*)/, (m, t) => digits(t)) : String(html); }
  function fmt(n) {
    if (n == null || n === '' || !isFinite(n)) return '—';
    const v = Math.round(Number(n) * 100) / 100;
    return digits((v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  }
  function int(n) { if (n == null || !isFinite(n)) return '—'; const v = Math.round(Number(n)); return digits((v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-US')); }
  function compact(n) {
    if (n == null || !isFinite(n)) return '—';
    const a = Math.abs(n), s = n < 0 ? '−' : '';
    if (a >= 1e6) return digits(s + (a / 1e6).toFixed(a >= 1e7 ? 1 : 2)) + ' م';
    if (a >= 1e3) return digits(s + (a / 1e3).toFixed(0)) + ' ألف';
    return digits(s + a.toFixed(0));
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function money(n, cls) {
    if (n == null || !isFinite(n)) return `<span class="dash ${cls || ''}">—</span>`;
    return `<span class="num ${cls || ''}">${fmt(n)}<span class="cur">ر.س</span></span>`;
  }
  function toDate(x) {
    if (x instanceof Date) return x;
    if (typeof x === 'number') return new Date(x);
    const s = String(x || '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
    if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split('-').map(Number); return new Date(y, m - 1, 1); }
    const d = new Date(s); return isNaN(d) ? null : d;
  }
  function dateTxt(x, opts) {
    opts = opts || {};
    const d = toDate(x); if (!d) return '—';
    if (/^\d{4}-\d{2}$/.test(String(x))) return MONTHS[d.getMonth()] + ' ' + digits(d.getFullYear());
    return (opts.weekday ? DAYS[d.getDay()] + ' ' : '') + digits(d.getDate()) + ' ' + MONTHS[d.getMonth()] + (opts.year ? ' ' + digits(d.getFullYear()) : '');
  }
  function ago(x) {
    const t = toDate(x); if (!t) return '';
    const m = Math.round((Date.now() - t.getTime()) / 6e4);
    if (m < 1) return 'الآن';
    if (m < 60) return 'قبل ' + digits(m) + ' د';
    if (m < 1440) return 'قبل ' + digits(Math.round(m / 60)) + ' س';
    if (m < 2880) return 'أمس';
    return 'قبل ' + digits(Math.round(m / 1440)) + ' يوماً';
  }

  /* ═══ حركة ═══ */
  const reduced = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countUp(el, to, from, kind) {
    const f = kind === 'int' ? int : fmt;
    from = from == null ? 0 : +from;
    if (!el.firstChild || el.firstChild.nodeType !== 3) el.insertBefore(doc.createTextNode(''), el.firstChild);
    const node = el.firstChild;
    if (reduced() || from === to) { node.nodeValue = f(to); return; }
    const ease = t => 1 - Math.pow(1 - t, 3);
    const t0 = performance.now(), dur = 700;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur);
      node.nodeValue = f(from + (to - from) * ease(t));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function animateNumbers(root, first) {
    if (!root) return;
    root.querySelectorAll('[data-count]').forEach(el => {
      const to = +el.dataset.count, hasFrom = el.dataset.from != null;
      if (first || hasFrom) countUp(el, to, first && !hasFrom ? 0 : +el.dataset.from, el.dataset.int != null ? 'int' : 'money');
    });
  }
  function counted(n, cls, from) {
    if (n == null || !isFinite(n)) return `<span class="dash ${cls || ''}">—</span>`;
    return `<span class="num ${cls || ''}" data-count="${n}"${from != null ? ` data-from="${from}"` : ''}>${fmt(n)}<span class="cur">ر.س</span></span>`;
  }
  function countedInt(n, cls, from) {
    if (n == null || !isFinite(n)) return `<span class="dash ${cls || ''}">—</span>`;
    return `<span class="num ${cls || ''}" data-int data-count="${n}"${from != null ? ` data-from="${from}"` : ''}>${int(n)}</span>`;
  }

  /* ═══ مخططات ═══ */
  function spark(points, color) {
    points = (points || []).map(Number).filter(isFinite);
    if (points.length < 2) return '';
    color = color || 'var(--chart-1)';
    const w = 300, h = 56, max = Math.max(...points), min = Math.min(...points);
    // الأحدث على اليسار؟ لا — الزمن يقرأ يميناً→يساراً في RTL: الأقدم يميناً
    const xy = points.map((p, i) => [w - (i / (points.length - 1)) * w, h - 6 - ((p - min) / (max - min || 1)) * (h - 12)]);
    const line = xy.map((q, i) => (i ? 'L' : 'M') + q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join(' ');
    const len = Math.round(xy.reduce((a, q, i) => i ? a + Math.hypot(q[0] - xy[i - 1][0], q[1] - xy[i - 1][1]) : 0, 0)) + 2;
    const last = xy[xy.length - 1];
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">` +
      `<path class="a" d="${line} L${last[0].toFixed(1)} ${h} L${w} ${h}Z" style="fill:${color}"/>` +
      `<path class="l" d="${line}" style="stroke:${color};--len:${len}"/>` +
      `<circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="3.5" style="fill:${color}"/></svg>`;
  }
  const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
  function lineChart(o) {
    o = o || {};
    const series = (o.series || []).map((s, i) => ({ name: s.name || s.label || '', values: (s.values || s.points || []).map(v => v == null ? null : +v), color: s.color || CHART_COLORS[i % 4], dashed: !!s.dashed }));
    const n = Math.max(0, ...series.map(s => s.values.length));
    if (!n) return `<div class="empty-note">لا بيانات للرسم</div>`;
    const W = 1000, H = o.height || 280, pl = 16, pr = 84, pt = 16, pb = 32;
    const all = series.flatMap(s => s.values.filter(v => v != null));
    let max = Math.max(...all), min = Math.min(...all);
    if (o.negArea !== false || o.zero !== false) { max = Math.max(max, 0); min = Math.min(min, 0); }
    const pad = (max - min) * 0.08 || Math.abs(max) * 0.1 || 1;
    max += pad; if (min < 0) min -= pad;
    const X = i => pl + (n === 1 ? 0.5 : i / (n - 1)) * (W - pr - pl);
    const Y = v => pt + (max - v) / (max - min || 1) * (H - pt - pb);
    const yLab = v => { const a = Math.abs(v); const s = v < 0 ? '−' : ''; return a >= 1e6 ? digits(s + (a / 1e6).toFixed(1)) + ' م' : a >= 1e3 ? digits(s + Math.round(a / 1e3)) + ' ألف' : digits(s + Math.round(a)); };
    const ticks = [max - pad, (max + min) / 2, 0, min < 0 ? min + pad : null].filter((v, i, a) => v != null && a.indexOf(v) === i);
    const dates = o.dates || [];
    const labelAt = i => o.xLabels && o.xLabels[i] != null ? esc(o.xLabels[i]) : dates[i] != null ? dateTxt(dates[i]) : digits(i + 1);
    const tickIdx = []; const want = Math.min(n, o.xTicks || 6);
    for (let k = 0; k < want; k++) tickIdx.push(Math.round(k * (n - 1) / Math.max(1, want - 1)));
    let out = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(o.label || series.map(s => s.name).join('، '))}" style="height:${H}px">`;
    out += `<g class="grid">${ticks.map(v => `<line x1="${pl}" x2="${W - pr}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${W - pr + 8}" y="${(Y(v) + 4).toFixed(1)}">${yLab(v)}</text>`).join('')}</g>`;
    const s0 = series[0];
    if (o.negArea !== false && s0) {
      let neg = '';
      s0.values.forEach((v, i) => { if (v != null && v < 0) { const a = X(Math.max(0, i - .5)), b = X(Math.min(n - 1, i + .5)); neg += `M${a.toFixed(1)} ${Y(0).toFixed(1)}L${b.toFixed(1)} ${Y(0).toFixed(1)}L${b.toFixed(1)} ${Y(v).toFixed(1)}L${a.toFixed(1)} ${Y(v).toFixed(1)}Z`; } });
      if (neg) out += `<path class="neg" d="${neg}" opacity=".9"/>`;
    }
    if (min < 0) out += `<line class="zero" x1="${pl}" x2="${W - pr}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>`;
    series.forEach(s => {
      let d = '', pen = false, len = 0, prev = null;
      s.values.forEach((v, i) => {
        if (v == null) { pen = false; return; }
        const x = X(i), y = Y(v);
        d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
        if (pen && prev) len += Math.hypot(x - prev[0], y - prev[1]);
        prev = [x, y]; pen = true;
      });
      out += `<path class="${s.dashed ? 'fc' : 'ln draw'}" d="${d}" style="stroke:${s.color};--len:${Math.round(len) + 4}"/>`;
    });
    tickIdx.forEach(i => { out += `<text x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${labelAt(i)}</text>`; });
    if (s0) {
      const fn = s0.values.findIndex(v => v != null && v < 0);
      if (fn >= 0) out += `<circle class="cur-dot" cx="${X(fn).toFixed(1)}" cy="${Y(s0.values[fn]).toFixed(1)}" r="5"/>`;
      s0.values.forEach((v, i) => { if (v == null) return; out += `<circle class="hit" cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="9"><title>${labelAt(i)} · ${series.map(s => s.name + ' ' + fmt(s.values[i])).join(' · ')}</title></circle>`; });
    }
    return out + '</svg>';
  }

  /* ═══ سجل الأفعال (لربط دوال بـHTML نصي) ═══ */
  const acts = new Map(); let actN = 0;
  function action(fn) {
    const id = 'a' + (++actN); acts.set(id, fn);
    if (acts.size > 3000) { let k = 0; for (const key of acts.keys()) { acts.delete(key); if (++k > 1500) break; } }
    return id;
  }
  doc.addEventListener('click', e => {
    const t = e.target.closest && e.target.closest('[data-ui-act]');
    if (!t) return;
    const fn = acts.get(t.dataset.uiAct);
    if (fn) { e.preventDefault(); e.stopPropagation(); try { fn(e, t); } catch (err) { console.error(err); toast('تعذّر تنفيذ الإجراء: ' + esc(err.message || err), { kind: 'error' }); } }
  });
  doc.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-ui-act]:not(button):not(a)')) { e.preventDefault(); e.target.click(); }
  });

  /* ═══ Toast ═══ */
  let toastsEl = null;
  function toastHost() {
    if (toastsEl && doc.body.contains(toastsEl)) return toastsEl;
    toastsEl = doc.getElementById('toasts');
    if (!toastsEl) { toastsEl = doc.createElement('div'); toastsEl.className = 'toasts'; toastsEl.id = 'toasts'; toastsEl.setAttribute('aria-live', 'polite'); doc.body.appendChild(toastsEl); }
    return toastsEl;
  }
  function restack() { [...toastHost().children].forEach((t, i) => { if (t.classList.contains('out')) return; t.style.transform = i ? `translateY(${-8 * i}px) scale(${1 - .04 * i})` : ''; t.style.opacity = i > 2 ? 0 : i ? (i === 1 ? .9 : .75) : 1; t.style.zIndex = 10 - i; t.style.pointerEvents = i ? 'none' : ''; }); }
  function toast(text, opts) {
    opts = opts || {};
    const host = toastHost();
    const el = doc.createElement('div'); el.className = 'toast' + (opts.kind === 'info' ? ' info' : opts.kind === 'error' ? ' error' : ''); el.lang = 'ar';
    el.setAttribute('role', opts.kind === 'error' ? 'alert' : 'status');
    const ms = opts.duration || (opts.undo ? 6000 : 4000);
    el.innerHTML = `<span class="tx">${digitsHTML(text)}</span>${opts.undo ? '<button class="undo">تراجع</button>' : ''}<span class="timer" style="animation-duration:${ms}ms"></span>`;
    host.prepend(el); restack();
    let left = ms, t0 = Date.now(), timer = setTimeout(kill, ms), dead = false;
    el.addEventListener('mouseenter', () => { clearTimeout(timer); left -= Date.now() - t0; });
    el.addEventListener('mouseleave', () => { t0 = Date.now(); timer = setTimeout(kill, Math.max(800, left)); });
    if (opts.undo) el.querySelector('.undo').onclick = () => { try { opts.undo(); } finally { kill(); } };
    function kill() { if (dead) return; dead = true; clearTimeout(timer); el.classList.add('out'); setTimeout(() => { el.remove(); restack(); }, 200); }
    return { close: kill };
  }

  /* ═══ النوافذ ═══ */
  const modalStack = [];
  let scrollLocks = 0;
  const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
  function lockScroll(on) {
    scrollLocks = Math.max(0, scrollLocks + (on ? 1 : -1));
    doc.documentElement.style.overflow = scrollLocks ? 'hidden' : '';
  }
  function modal(o) {
    o = o || {};
    const prevFocus = doc.activeElement;
    const scrim = doc.createElement('div'); scrim.className = 'm-scrim'; scrim.lang = 'ar';
    const dlg = doc.createElement('div'); dlg.className = 'm-dlg m-' + (o.size || 'md');
    const tid = 'mt' + (++actN);
    dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', tid);
    dlg.innerHTML = `<div class="m-head"><h2 id="${tid}">${o.title || ''}</h2><button class="m-x" type="button" aria-label="إغلاق"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div><div class="m-body"></div>` +
      ((o.actions || []).length ? `<div class="m-foot"></div>` : '');
    const bodyEl = dlg.querySelector('.m-body');
    if (o.body instanceof Node) bodyEl.appendChild(o.body); else bodyEl.innerHTML = o.body || '';
    let dirty = false, closed = false, guardEl = null;
    const markDirty = e => { if (e.target && e.target.closest && e.target.closest('[data-no-dirty]')) return; dirty = true; };
    dlg.addEventListener('input', markDirty); dlg.addEventListener('change', markDirty);
    const api = { root: dlg, close, setDirty: v => { dirty = !!v; }, get dirty() { return dirty; } };
    if ((o.actions || []).length) {
      const foot = dlg.querySelector('.m-foot');
      o.actions.forEach(a => {
        const b = doc.createElement('button'); b.type = 'button';
        b.className = 'btn' + (a.kind === 'primary' ? ' primary' : a.kind === 'danger' ? ' danger' : a.kind === 'ghost' ? ' ghost' : '');
        b.innerHTML = a.label;
        b.onclick = async () => {
          if (!a.onClick) { close(); return; }
          try { b.disabled = true; await a.onClick(close, dlg, api); } catch (err) { console.error(err); toast(esc(err.message || String(err)), { kind: 'error' }); } finally { b.disabled = false; }
        };
        foot.appendChild(b);
      });
    }
    function askGuard() {
      if (guardEl) return;
      guardEl = doc.createElement('div'); guardEl.className = 'm-guard'; guardEl.setAttribute('role', 'alertdialog');
      guardEl.innerHTML = `<div class="m-guard-card"><b>تجاهل التغييرات غير المحفوظة؟</b><p>ستُفقد التعديلات التي أدخلتها في هذه النافذة.</p><div class="m-guard-acts"><button type="button" class="btn" data-g="stay">متابعة التحرير</button><button type="button" class="btn danger" data-g="drop">تجاهل التغييرات</button></div></div>`;
      dlg.appendChild(guardEl);
      guardEl.querySelector('[data-g="stay"]').onclick = closeGuard;
      guardEl.querySelector('[data-g="drop"]').onclick = () => { closeGuard(); close(true); };
      guardEl.querySelector('[data-g="stay"]').focus();
    }
    function closeGuard() { if (guardEl) { guardEl.remove(); guardEl = null; } }
    function close(force) {
      if (closed) return true;
      if (force !== true && dirty) { askGuard(); return false; }
      closed = true;
      const i = modalStack.indexOf(api); if (i >= 0) modalStack.splice(i, 1);
      scrim.classList.add('out'); dlg.classList.add('out');
      setTimeout(() => scrim.remove(), reduced() ? 0 : 200);
      lockScroll(false);
      if (o.onClose) try { o.onClose(); } catch (e) { console.error(e); }
      if (prevFocus && prevFocus.focus && doc.body.contains(prevFocus)) prevFocus.focus();
      return true;
    }
    api._key = e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (guardEl) closeGuard(); else close(); return; }
      if (e.key === 'Tab') {
        const scope = guardEl || dlg;
        const f = [...scope.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null || x === doc.activeElement);
        if (!f.length) { e.preventDefault(); return; }
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (doc.activeElement === first || !scope.contains(doc.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && (doc.activeElement === last || !scope.contains(doc.activeElement))) { e.preventDefault(); first.focus(); }
      }
    };
    dlg.querySelector('.m-x').onclick = () => close();
    scrim.addEventListener('mousedown', e => { if (e.target === scrim) close(); });
    scrim.appendChild(dlg); doc.body.appendChild(scrim);
    modalStack.push(api); lockScroll(true);
    if (o.onOpen) try { o.onOpen(dlg, api); } catch (e) { console.error(e); }
    animateNumbers(dlg, true);
    const firstField = dlg.querySelector('.m-body input:not([type=hidden]):not([type=checkbox]),.m-body select,.m-body textarea') || dlg.querySelector('.m-foot .btn.primary') || dlg.querySelector('.m-x');
    setTimeout(() => firstField && firstField.focus({ preventScroll: true }), 30);
    return api;
  }
  doc.addEventListener('keydown', e => { const top = modalStack[modalStack.length - 1]; if (top) top._key(e); }, true);
  function confirmDlg(o) {
    o = o || {};
    return new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v); } };
      modal({
        title: o.title || 'تأكيد', body: `<p class="m-text">${o.body || ''}</p>`, size: 'sm',
        actions: [
          { label: o.cancelLabel || 'إلغاء', onClick: close => { fin(false); close(true); } },
          { label: o.confirmLabel || 'تأكيد', kind: o.danger ? 'danger' : 'primary', onClick: close => { fin(true); close(true); } },
        ],
        onClose: () => fin(false),
      });
    });
  }
  const isModalOpen = () => modalStack.length > 0;

  /* ═══ النماذج ═══ */
  const optList = opts => (opts || []).map(o => typeof o === 'object' && o !== null ? { value: o.value, label: o.label != null ? o.label : o.value } : { value: o, label: o });
  function form(fields) {
    return `<div class="f-grid">${(fields || []).map(f => {
      const id = 'f' + (++actN), name = esc(f.name);
      const req = f.required ? ' data-required="1"' : '';
      const v = f.value == null ? '' : f.value;
      const common = `id="${id}" name="${name}"${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}${f.readonly ? ' readonly' : ''}${f.disabled ? ' disabled' : ''}${req}${f.min != null ? ` data-min="${f.min}"` : ''}${f.max != null ? ` data-max="${f.max}"` : ''}`;
      let ctl;
      switch (f.type) {
        case 'select': ctl = `<select ${common}>${f.placeholder || !f.required ? `<option value="">${esc(f.placeholder || '—')}</option>` : ''}${optList(f.options).map(o => `<option value="${esc(o.value)}"${String(o.value) === String(v) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`; break;
        case 'textarea': ctl = `<textarea ${common} rows="${f.rows || 3}">${esc(v)}</textarea>`; break;
        case 'money': ctl = `<span class="f-money"><input ${common} type="text" inputmode="decimal" dir="ltr" data-kind="money" value="${v === '' ? '' : esc(v)}" autocomplete="off"><span class="cur">ر.س</span></span>`; break;
        case 'number': ctl = `<input ${common} type="number" dir="ltr" data-kind="number" value="${esc(v)}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}${f.step ? ` step="${f.step}"` : ''}>`; break;
        case 'date': ctl = `<input ${common} type="date" dir="ltr" value="${esc(v)}">`; break;
        case 'month': ctl = `<input ${common} type="month" dir="ltr" value="${esc(v)}" placeholder="YYYY-MM" pattern="\\d{4}-\\d{2}">`; break;
        case 'checkbox': ctl = `<label class="f-check"><input ${common} type="checkbox" data-kind="bool"${v ? ' checked' : ''}><span>${esc(f.checkLabel || '')}</span></label>`; break;
        case 'multiselect': {
          const vals = (Array.isArray(v) ? v : []).map(String);
          ctl = `<div class="f-multi" role="group" id="${id}" data-multi="${name}"${req}>${optList(f.options).map(o => `<label class="f-opt"><input type="checkbox" value="${esc(o.value)}"${vals.includes(String(o.value)) ? ' checked' : ''}><span>${esc(o.label)}</span></label>`).join('') || '<span class="cap">لا خيارات</span>'}</div>`;
          break;
        }
        default: ctl = `<input ${common} type="${f.type === 'tel' || f.type === 'email' ? f.type : 'text'}" value="${esc(v)}"${f.dir ? ` dir="${f.dir}"` : ''} autocomplete="off">`;
      }
      const tag = f.type === 'multiselect' || f.type === 'checkbox' ? 'div' : 'label';
      return `<${tag} class="fld${f.full || f.type === 'textarea' || f.type === 'multiselect' ? ' full' : ''}" data-field="${name}"${tag === 'label' ? ` for="${id}"` : ''}><span class="fl">${esc(f.label || '')}${f.required ? ' <i class="req" aria-hidden="true">*</i>' : ''}</span>${ctl}${f.help ? `<small class="fh">${f.help}</small>` : ''}<small class="fe" aria-live="polite"></small></${tag}>`;
    }).join('')}</div>`;
  }
  const parseNum = v => { const n = store() ? store().util.parseNum(v) : parseFloat(v); return n; };
  function fieldValue(root, name) {
    const multi = root.querySelector(`[data-multi="${CSS.escape(name)}"]`);
    if (multi) return [...multi.querySelectorAll('input:checked')].map(i => i.value);
    const el = root.querySelector(`[name="${CSS.escape(name)}"]`);
    if (!el) return undefined;
    if (el.dataset.kind === 'bool') return el.checked;
    const raw = el.value;
    if (el.dataset.kind === 'money' || el.dataset.kind === 'number') { if (String(raw).trim() === '') return null; const n = parseNum(raw); return isFinite(n) ? n : NaN; }
    return typeof raw === 'string' ? raw.trim() : raw;
  }
  function readForm(root) {
    const out = {};
    root.querySelectorAll('[data-multi]').forEach(m => out[m.dataset.multi] = fieldValue(root, m.dataset.multi));
    root.querySelectorAll('[name]').forEach(el => { if (!(el.name in out)) out[el.name] = fieldValue(root, el.name); });
    return out;
  }
  function shake(el) { if (!el) return; el.classList.remove('m-shake'); void el.offsetWidth; el.classList.add('m-shake'); }
  function setError(root, name, msg) {
    const fld = root.querySelector(`[data-field="${CSS.escape(name)}"]`);
    if (!fld) return;
    fld.classList.toggle('invalid', !!msg);
    const fe = fld.querySelector('.fe'); if (fe) fe.textContent = msg || '';
    if (msg) shake(fld);
  }
  function validate(root, rules) {
    rules = rules || {};
    const all = readForm(root);
    const names = new Set(Object.keys(rules));
    root.querySelectorAll('[data-required],[data-min],[data-max],[data-kind="money"],[data-kind="number"]').forEach(el => names.add(el.name || el.dataset.multi));
    let firstBad = null;
    names.forEach(name => {
      if (!name) return;
      const el = root.querySelector(`[name="${CSS.escape(name)}"]`) || root.querySelector(`[data-multi="${CSS.escape(name)}"]`);
      let r = rules[name] || {};
      if (typeof r === 'function') r = { custom: r };
      const v = all[name];
      const required = r.required || (el && el.dataset.required);
      const min = r.min != null ? r.min : el && el.dataset.min != null ? +el.dataset.min : null;
      const max = r.max != null ? r.max : el && el.dataset.max != null ? +el.dataset.max : null;
      let msg = null;
      const empty = v == null || v === '' || (Array.isArray(v) && !v.length);
      if (required && empty) msg = 'هذا الحقل مطلوب';
      else if (!empty && typeof v === 'number' && isNaN(v)) msg = 'أدخل رقماً صحيحاً';
      else if (!empty && typeof v === 'number' && min != null && v < min) msg = 'الحد الأدنى ' + fmtPlainNum(min);
      else if (!empty && typeof v === 'number' && max != null && v > max) msg = 'الحد الأعلى ' + fmtPlainNum(max);
      else if (!empty && r.pattern && !r.pattern.test(String(v))) msg = r.message || 'صيغة غير صحيحة';
      if (!msg && r.custom) { const m = r.custom(v, all); if (m && m !== true) msg = m; }
      setError(root, name, msg);
      if (msg && !firstBad) firstBad = el;
    });
    if (firstBad && firstBad.focus) firstBad.focus();
    return !firstBad;
  }
  const fmtPlainNum = n => digits(Number(n).toLocaleString('en-US'));

  /* ═══ حالات فارغة / هيكل ═══ */
  const ICONS = {
    inbox: '<path d="M3 13l3-8h12l3 8v6H3z"/><path d="M3 13h5l1 3h6l1-3h5"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
    file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>',
    trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    cloud: '<path d="M7 18a5 5 0 1 1 1-9.9A6 6 0 0 1 19.5 10 4 4 0 0 1 18 18z"/>',
    bell: '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4"/>',
    alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17v.5"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  };
  function iconSvg(name, size) { const p = ICONS[name]; return p ? `<svg viewBox="0 0 24 24" width="${size || 48}" height="${size || 48}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>` : ''; }
  function emptyState(o) {
    o = o || {};
    const icon = o.icon == null ? iconSvg('inbox') : ICONS[o.icon] ? iconSvg(o.icon) : o.icon;
    return `<div class="ui-empty">${icon ? `<div class="ue-ic">${icon}</div>` : ''}<b>${o.title || 'لا شيء هنا بعد'}</b>${o.body ? `<p>${o.body}</p>` : ''}${o.cta ? `<button type="button" class="btn primary" data-ui-act="${action(() => o.onCta && o.onCta())}">${o.cta}</button>` : ''}</div>`;
  }
  function skeleton(rows) { rows = rows || 4; let s = '<div class="ui-skel" aria-busy="true" aria-label="جارٍ التحميل">'; for (let i = 0; i < rows; i++) s += `<i style="width:${92 - (i * 17) % 40}%"></i>`; return s + '</div>'; }

  /* ═══ KPI ═══ */
  const TONE = { danger: 't-danger', ok: 't-ok', warn: 't-warn' };
  const TONE_COLOR = { danger: 'var(--danger-solid)', ok: 'var(--ok-solid)', warn: 'var(--warn-solid)' };
  function kpi(o) {
    o = o || {};
    const isMoney = o.money !== false;
    const click = o.onClick ? ` data-ui-act="${action(o.onClick)}" role="button" tabindex="0"` : '';
    const val = o.value == null ? `<span class="dash">—</span>` : isMoney ? counted(o.value, '', o.from) : countedInt(o.value, '', o.from);
    return `<section class="isl ${o.cls || 'c3'} ui-kpi${o.crit ? ' crit' : ''}${o.onClick ? ' click' : ''}"${o.i != null ? ` style="--i:${o.i}"` : ''}${click}>` +
      `<div class="ih"><h2>${o.crit ? '<span class="sev d" aria-hidden="true"></span>' : ''}${o.label || ''}</h2>${o.badge ? `<span class="pill ${o.badgeTone || 'n'}">${o.badge}</span>` : ''}</div>` +
      `<div class="${o.size === 'hero' ? 'hero' : 'kpi'} ${TONE[o.tone] || ''}">${val}</div>` +
      (o.hint ? `<div class="meta">${o.hint}</div>` : '') +
      (o.spark && o.spark.length > 1 ? spark(o.spark, TONE_COLOR[o.tone] || 'var(--chart-1)') : '') +
      `</section>`;
  }

  /* ═══ الجدول ═══ */
  const tableState = {};
  const LSK = 'egco-proto-v2:ui';
  function uiPrefs() { try { return JSON.parse(localStorage.getItem(LSK) || '{}'); } catch (e) { return {}; } }
  function setUiPref(k, v) { try { const p = uiPrefs(); p[k] = v; localStorage.setItem(LSK, JSON.stringify(p)); } catch (e) { /* ذاكرة فقط */ } }
  const normQ = s => store() ? store().util.normAr(s) : String(s || '').toLowerCase();
  const PAGE = 100;
  function table(o) {
    o = o || {};
    const cols = (o.columns || []).map(c => Object.assign({ sort: true }, c));
    const id = o.id || null;
    const st = id ? (tableState[id] = tableState[id] || { sort: o.sort || null, q: '', filters: {}, hidden: new Set((uiPrefs()['cols:' + id] || cols.filter(c => c.hidden).map(c => c.key))), limit: PAGE, sel: new Set() })
      : { sort: o.sort || null, q: '', filters: {}, hidden: new Set(cols.filter(c => c.hidden).map(c => c.key)), limit: PAGE, sel: new Set() };
    const keyOf = typeof o.rowKey === 'function' ? o.rowKey : (r => r[o.rowKey || 'id']);
    const selected = o.selected instanceof Set ? o.selected : st.sel;
    let rows = o.rows || [];
    const root = doc.createElement('div');
    root.className = 'ui-tbl' + (o.density === 'compact' ? ' compact' : '');
    const hasBar = o.search !== false || (o.filters || []).length || o.columnMenu !== false || o.toolbar;
    root.innerHTML = (hasBar ? `<div class="ut-bar">${o.search !== false ? `<label class="ut-search"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4-4"/></svg><input type="search" placeholder="${esc(o.searchPlaceholder || 'بحث…')}" aria-label="بحث في الجدول" data-no-dirty></label>` : ''}<div class="ut-tools">${o.toolbar || ''}${o.columnMenu !== false ? `<button type="button" class="btn sm ut-colbtn" aria-haspopup="true" aria-expanded="false"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5h16M4 12h16M4 19h16"/></svg>الأعمدة</button>` : ''}</div></div><div class="ut-chips"></div>` : '') +
      `<div class="tbl-wrap"><table><thead></thead><tbody></tbody><tfoot></tfoot></table></div><div class="ut-foot"></div><div class="ut-selhost"></div>`;
    const qEl = root.querySelector('.ut-search input');
    if (qEl) { qEl.value = st.q; qEl.addEventListener('input', () => { st.q = qEl.value; st.limit = PAGE; render(); }); }
    const visCols = () => cols.filter(c => !st.hidden.has(c.key));
    const valOf = (c, r) => c.sortValue ? c.sortValue(r) : c.value ? c.value(r) : r[c.key];
    const searchKeys = o.searchKeys || cols.map(c => c.key);
    const searchText = r => normQ(searchKeys.map(k => { const c = cols.find(x => x.key === k); const v = c && c.searchValue ? c.searchValue(r) : r[k]; return v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v); }).join(' '));
    const fopts = f => optList(f.options).map((op, i) => Object.assign(op, { test: (f.options[i] && f.options[i].test) || null }));
    const matchFilter = (f, op, r) => op.test ? op.test(r) : (f.test ? f.test(r, op.value) : (Array.isArray(r[f.key]) ? r[f.key].includes(op.value) : r[f.key] === op.value || String(r[f.key]) === String(op.value)));
    function filtered(skipFilterKey) {
      const q = normQ(st.q);
      return rows.filter(r => {
        if (q && !searchText(r).includes(q)) return false;
        for (const f of o.filters || []) {
          if (f.key === skipFilterKey) continue;
          const v = st.filters[f.key]; if (v == null) continue;
          const op = fopts(f).find(x => String(x.value) === String(v)); if (op && !matchFilter(f, op, r)) return false;
        }
        return true;
      });
    }
    function sorted(list) {
      if (!st.sort) return list;
      const c = cols.find(x => x.key === st.sort.key); if (!c) return list;
      const dir = st.sort.dir === 'asc' ? 1 : -1;
      return list.slice().sort((a, b) => {
        const va = valOf(c, a), vb = valOf(c, b);
        if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), 'ar', { numeric: true }) * dir;
      });
    }
    function cell(c, r) {
      if (c.render) return c.render(r);
      const v = r[c.key];
      if (v == null || v === '') return '<span class="dash">—</span>';
      if (c.money) return money(v);
      if (c.num && typeof v === 'number') return `<span class="num">${Number.isInteger(v) && !c.decimals ? int(v) : fmt(v)}</span>`;
      if (c.date) return esc(dateTxt(v, { year: c.year }));
      return digits(esc(v));
    }
    function renderChips() {
      const host = root.querySelector('.ut-chips'); if (!host) return;
      if (!(o.filters || []).length) { host.hidden = true; return; }
      host.innerHTML = (o.filters || []).map(f => {
        const base = filtered(f.key);
        return `<div class="filters ut-fgroup" role="group" aria-label="${esc(f.label || '')}">${f.label ? `<span class="cap ut-flabel">${esc(f.label)}</span>` : ''}<button type="button" class="chip" data-fk="${esc(f.key)}" data-fv="" aria-pressed="${st.filters[f.key] == null}">الكل <span class="num cap">${int(base.length)}</span></button>` +
          fopts(f).map(op => `<button type="button" class="chip" data-fk="${esc(f.key)}" data-fv="${esc(op.value)}" aria-pressed="${st.filters[f.key] != null && String(st.filters[f.key]) === String(op.value)}">${esc(op.label)} <span class="num cap">${int(base.filter(r => matchFilter(f, op, r)).length)}</span></button>`).join('') + '</div>';
      }).join('');
    }
    function renderHead() {
      const th = root.querySelector('thead');
      const list = filtered();
      const allSel = o.selectable && list.length && list.every(r => selected.has(keyOf(r)));
      th.innerHTML = '<tr>' + (o.selectable ? `<th class="selc"><button type="button" class="sel" role="checkbox" aria-checked="${allSel ? 'true' : 'false'}" aria-label="تحديد الكل" data-selall></button></th>` : '') +
        visCols().map(c => {
          const s = st.sort && st.sort.key === c.key ? st.sort.dir : null;
          const lab = c.sort !== false ? `<button type="button" class="ut-sort" data-sort="${esc(c.key)}">${c.label || ''}<span class="ut-arr" aria-hidden="true">${s === 'asc' ? '↑' : s === 'desc' ? '↓' : ''}</span></button>` : (c.label || '');
          return `<th class="${c.num || c.money ? 'n' : ''}"${c.width ? ` style="width:${c.width}${typeof c.width === 'number' ? 'px' : ''}"` : ''}${s ? ` aria-sort="${s === 'asc' ? 'ascending' : 'descending'}"` : ''}>${lab}</th>`;
        }).join('') + '</tr>';
    }
    function renderBody() {
      const tb = root.querySelector('tbody'), tf = root.querySelector('tfoot'), foot = root.querySelector('.ut-foot'), wrap = root.querySelector('.tbl-wrap');
      const list = sorted(filtered());
      const vc = visCols();
      const span = vc.length + (o.selectable ? 1 : 0);
      if (!rows.length) {
        wrap.hidden = true;
        foot.innerHTML = emptyState(o.empty || { icon: 'inbox', title: 'لا توجد سجلات', body: '' });
        return;
      }
      wrap.hidden = false;
      if (!list.length) {
        tb.innerHTML = `<tr class="ut-none"><td colspan="${span}">${emptyState({ icon: 'search', title: 'لا نتائج مطابقة', body: 'جرّب كلمة أخرى أو أزل التصفية', cta: 'مسح البحث والتصفية', onCta: () => { st.q = ''; st.filters = {}; if (qEl) qEl.value = ''; render(); } })}</td></tr>`;
      } else {
        const shown = list.slice(0, st.limit);
        tb.innerHTML = shown.map(r => {
          const k = keyOf(r), sel = selected.has(k);
          const cls = [o.onRowClick ? 'go' : '', sel ? 'picked' : '', o.rowClass ? o.rowClass(r) : ''].filter(Boolean).join(' ');
          return `<tr data-k="${esc(k)}"${cls ? ` class="${cls}"` : ''}${o.onRowClick || o.selectable ? ' tabindex="0"' : ''}>` +
            (o.selectable ? `<td class="selc"><button type="button" class="sel" role="checkbox" aria-checked="${sel}" aria-label="تحديد الصف" data-sel tabindex="-1"></button></td>` : '') +
            vc.map(c => `<td class="${c.num || c.money ? 'n' : ''}${c.cls ? ' ' + c.cls : ''}">${cell(c, r)}</td>`).join('') + '</tr>';
        }).join('');
      }
      // صف الإجمالي — من الصفوف المصفّاة كلها (لا المعروضة فقط)
      if (o.total && list.length) {
        const keys = o.total.keys || [];
        const sums = {}; keys.forEach(k => { const c = cols.find(x => x.key === k); sums[k] = list.reduce((a, r) => { const v = c && c.totalValue ? c.totalValue(r) : r[k]; return a + (isFinite(v) && v != null ? Math.round(v * 100) : 0); }, 0) / 100; });
        let labelPlaced = false;
        const cells = vc.map(c => {
          if (keys.includes(c.key)) return `<td class="n">${c.money || o.total.money !== false ? money(sums[c.key]) : `<span class="num">${fmt(sums[c.key])}</span>`}</td>`;
          if (!labelPlaced) { labelPlaced = true; return `<td>${o.total.label || 'الإجمالي'} <span class="cap">(${int(list.length)})</span></td>`; }
          return '<td></td>';
        });
        tf.innerHTML = `<tr>${o.selectable ? '<td></td>' : ''}${cells.join('')}</tr>`;
      } else tf.innerHTML = '';
      foot.innerHTML = list.length > st.limit ? `<div class="ut-more"><button type="button" class="btn sm" data-more>عرض المزيد · <span class="num">${int(list.length - st.limit)}</span> متبقٍ</button></div>` : '';
    }
    function sumKey() { return (o.selectionBar && o.selectionBar.sumKey) || (o.total && o.total.keys && o.total.keys[0]) || (cols.find(c => c.money || c.num) || {}).key; }
    function renderSel() {
      const host = root.querySelector('.ut-selhost');
      if (!o.selectable || !selected.size) { host.innerHTML = ''; return; }
      const chosen = rows.filter(r => selected.has(keyOf(r)));
      const k = sumKey();
      const sb = o.selectionBar || {};
      const sumV = k ? chosen.reduce((a, r) => { const v = sb.sumValue ? sb.sumValue(r) : r[k]; return a + (isFinite(v) && v != null ? Math.round(v * 100) : 0); }, 0) / 100 : null;
      const acts = (sb.actions || []).map((a, i) => `<button type="button" class="btn ${a.kind === 'primary' || (!a.kind && i === 0) ? 'primary ' : ''}sm" data-selact="${i}">${a.label}</button>`).join('');
      host.innerHTML = `<div class="paybar ut-selbar" role="region" aria-label="التحديد"><span>${sb.label || 'المحدد'} · <span class="num">${int(chosen.length)}</span></span>${sumV != null ? `<span class="big num">${fmt(sumV)}<span class="cur" style="color:rgba(244,235,221,.6)">ر.س</span></span>` : ''}${sb.hint ? `<span class="st-dim">${sb.hint}</span>` : ''}<span class="ut-selacts">${acts}<button type="button" class="btn sm ut-clear" data-selclear>إلغاء التحديد</button></span></div>`;
    }
    function render() { renderChips(); renderHead(); renderBody(); renderSel(); animateNumbers(root, false); }
    function emitSel() { if (o.onSelect) try { o.onSelect(selected, rows.filter(r => selected.has(keyOf(r)))); } catch (e) { console.error(e); } }
    function toggle(k) { if (selected.has(k)) selected.delete(k); else selected.add(k); }
    function rowOf(tr) { const k = tr.dataset.k; return rows.find(r => String(keyOf(r)) === k); }
    root.addEventListener('click', e => {
      const t = e.target;
      const chip = t.closest('[data-fk]');
      if (chip) { const v = chip.dataset.fv; st.filters[chip.dataset.fk] = v === '' ? null : v; st.limit = PAGE; render(); return; }
      const sb = t.closest('[data-sort]');
      if (sb) {
        const key = sb.dataset.sort; const c = cols.find(x => x.key === key);
        const first = c && (c.num || c.money) ? 'desc' : 'asc', second = first === 'desc' ? 'asc' : 'desc';
        if (!st.sort || st.sort.key !== key) st.sort = { key, dir: first };
        else if (st.sort.dir === first) st.sort = { key, dir: second };
        else st.sort = o.sort || null;
        render(); const nb = root.querySelector(`[data-sort="${CSS.escape(key)}"]`); if (nb) nb.focus(); return;
      }
      if (t.closest('[data-selall]')) {
        const list = filtered(); const all = list.length && list.every(r => selected.has(keyOf(r)));
        list.forEach(r => all ? selected.delete(keyOf(r)) : selected.add(keyOf(r)));
        render(); emitSel(); return;
      }
      if (t.closest('[data-sel]')) { const tr = t.closest('tr'); toggle(rowOf(tr) ? keyOf(rowOf(tr)) : tr.dataset.k); render(); emitSel(); const n = root.querySelector(`tr[data-k="${CSS.escape(tr.dataset.k)}"]`); if (n) n.focus(); return; }
      if (t.closest('[data-selclear]')) { selected.clear(); render(); emitSel(); return; }
      const sa = t.closest('[data-selact]');
      if (sa) { const a = o.selectionBar.actions[+sa.dataset.selact]; const chosen = rows.filter(r => selected.has(keyOf(r))); if (a && a.onClick) a.onClick(chosen, () => { selected.clear(); render(); emitSel(); }, selected); return; }
      if (t.closest('[data-more]')) { st.limit += PAGE * 2; render(); return; }
      if (t.closest('.ut-colbtn')) { openColMenu(t.closest('.ut-colbtn')); return; }
      const tr = t.closest('tbody tr[data-k]');
      if (tr && !t.closest('a,button,input,select,textarea,label,[data-ui-act]')) {
        const r = rowOf(tr); if (!r) return;
        if (o.onRowClick) o.onRowClick(r, e);
        else if (o.selectable) { toggle(keyOf(r)); render(); emitSel(); }
      }
    });
    root.addEventListener('keydown', e => {
      const tr = e.target.closest && e.target.closest('tbody tr[data-k]');
      if (!tr || e.target !== tr) return;
      if (e.key === 'Enter' || (e.key === ' ' && !o.selectable)) { e.preventDefault(); const r = rowOf(tr); if (r && o.onRowClick) o.onRowClick(r, e); }
      else if (e.key === ' ' && o.selectable) { e.preventDefault(); const r = rowOf(tr); if (r) { toggle(keyOf(r)); render(); emitSel(); const n = root.querySelector(`tr[data-k="${CSS.escape(tr.dataset.k)}"]`); if (n) n.focus(); } }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const n = e.key === 'ArrowDown' ? tr.nextElementSibling : tr.previousElementSibling; if (n && n.matches('[data-k]')) n.focus(); }
    });
    function openColMenu(btn) {
      const old = root.querySelector('.ut-pop'); if (old) { old.remove(); btn.setAttribute('aria-expanded', 'false'); return; }
      const pop = doc.createElement('div'); pop.className = 'ut-pop'; pop.setAttribute('role', 'menu');
      pop.innerHTML = `<div class="cap" style="padding:4px 8px 6px">إظهار الأعمدة</div>` + cols.map(c => `<label class="ut-popi"><input type="checkbox" data-no-dirty data-col="${esc(c.key)}"${st.hidden.has(c.key) ? '' : ' checked'}${c.required ? ' disabled' : ''}><span>${c.label || c.key}</span></label>`).join('');
      btn.parentElement.appendChild(pop); btn.setAttribute('aria-expanded', 'true');
      pop.addEventListener('change', e => {
        const k = e.target.dataset.col; if (!k) return;
        if (e.target.checked) st.hidden.delete(k); else { if (visCols().length <= 1) { e.target.checked = true; return; } st.hidden.add(k); }
        if (id) setUiPref('cols:' + id, [...st.hidden]);
        renderHead(); renderBody();
      });
      const first = pop.querySelector('input:not([disabled])'); if (first) first.focus();
      const closeOn = ev => { if (!pop.contains(ev.target) && ev.target !== btn && !btn.contains(ev.target)) { pop.remove(); btn.setAttribute('aria-expanded', 'false'); doc.removeEventListener('mousedown', closeOn, true); } };
      doc.addEventListener('mousedown', closeOn, true);
      pop.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); pop.remove(); btn.setAttribute('aria-expanded', 'false'); btn.focus(); } });
    }
    root.setRows = r => { rows = r || []; render(); };
    root.refresh = render;
    root.getFiltered = () => sorted(filtered());
    root.getSelected = () => rows.filter(r => selected.has(keyOf(r)));
    root.clearSelection = () => { selected.clear(); render(); emitSel(); };
    root.state = st;
    render();
    return root;
  }

  /* ═══ التصدير ═══ */
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    return Promise.resolve(fallbackCopy(text));
  }
  function fallbackCopy(text) {
    const ta = doc.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;inset:0 auto auto 0;opacity:0';
    doc.body.appendChild(ta); ta.select();
    let ok = false; try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove(); return ok;
  }
  function exportDialog(o) {
    o = o || {};
    const csv = String(o.csv || '');
    const fileName = o.fileName || 'تصدير.csv';
    const grid = store() ? store().parseCSV(csv) : csv.split(/\r?\n/).map(l => l.split(','));
    const head = grid[0] || [], body = grid.slice(1);
    const shown = body.slice(0, 200);
    const html = `<div class="ex-meta"><span class="pill n">${esc(fileName)}</span><span class="cap"><span class="num">${int(body.length)}</span> صف · <span class="num">${int(head.length)}</span> عمود</span></div>
      <div class="ex-prev tbl-wrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${shown.map(r => `<tr>${head.map((_, i) => `<td>${esc(r[i] == null ? '' : r[i])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
      ${body.length > shown.length ? `<p class="cap">تُعرض أول <span class="num">${int(shown.length)}</span> صفاً — النسخ والتنزيل يشملان الكل.</p>` : ''}
      <p class="disclose ex-note">التنزيل قد يكون محجوباً داخل صفحة المعاينة هذه. إن لم يبدأ، استخدم «نسخ» ثم الصق في Excel — الأعمدة مفصولة بفواصل وتُقرأ مباشرة.</p>
      <textarea class="ex-raw" readonly data-no-dirty aria-label="نص CSV">${esc(csv)}</textarea>`;
    return modal({
      title: o.title || 'تصدير', body: html, size: 'lg',
      actions: [
        { label: 'إغلاق', onClick: close => close(true) },
        {
          label: 'تنزيل', onClick: (close, root) => {
            let ok = false;
            try {
              const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
              const url = URL.createObjectURL(blob); const a = doc.createElement('a'); a.href = url; a.download = fileName; doc.body.appendChild(a); a.click(); a.remove();
              setTimeout(() => URL.revokeObjectURL(url), 4000); ok = true;
            } catch (e) { ok = false; }
            const n = root.querySelector('.ex-note');
            if (n) n.innerHTML = ok ? 'طُلب التنزيل من المتصفح. إن لم يظهر الملف فالتنزيل محجوب هنا — استخدم «نسخ».' : 'التنزيل محجوب في هذه الصفحة — استخدم «نسخ» ثم الصق في Excel.';
          },
        },
        {
          label: 'نسخ', kind: 'primary', onClick: (close, root) => copyText(csv).then(ok => {
            if (ok) toast('نُسخ الملف — الصقه في Excel أو أي محرر', { kind: 'ok' });
            else { const ta = root.querySelector('.ex-raw'); ta.classList.add('show'); ta.focus(); ta.select(); toast('حدّدنا النص — اضغط ⌘C / Ctrl+C للنسخ', { kind: 'info' }); }
          }),
        },
      ],
    });
  }

  EGCO.ui = {
    fmt, int, compact, digits, digitsHTML, money, dateTxt, ago, esc, toDate,
    countUp, animateNumbers, counted, countedInt, spark, lineChart,
    toast, modal, confirm: confirmDlg, isModalOpen,
    form, readForm, validate, setError,
    table, kpi, exportDialog, emptyState, skeleton, iconSvg,
    action, copyText, uiPrefs, setUiPref, reduced, MONTHS, DAYS,
  };
})();
