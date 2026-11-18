/* أرخبيل EGCO — store.js
 * مصدر الحقيقة الوحيد: الحالة + الاشتقاقات + الاستيراد + النسخ + الإشعارات.
 * المبالغ في db بالريال (رقم بمنزلتين)؛ كل حساب يتم بالهللات كأعداد صحيحة ثم يُقسم على 100.
 * يعمل في المتصفح وفي node (للاختبار الذاتي) — لا يلمس DOM.
 */
(function (root) {
  'use strict';
  const EGCO = root.EGCO = root.EGCO || {};

  const KEY = 'egco-proto-v2';
  const SCHEMA = 2;
  const DAY = 864e5;
  const TODAY = new Date(2026, 10, 17);

  /* ═══ تواريخ ═══ */
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const TODAY_ISO = iso(TODAY);
  function parseISO(s) {
    if (s instanceof Date) return new Date(s.getFullYear(), s.getMonth(), s.getDate());
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(String(s || ''));
    return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
  }
  const addDays = (s, n) => { const d = parseISO(s); d.setDate(d.getDate() + n); return iso(d); };
  const diffDays = (a, b) => Math.round((parseISO(a) - parseISO(b)) / DAY); // a − b
  const fromToday = s => diffDays(s, TODAY_ISO);                              // موجب = مستقبل
  const nowISO = () => new Date().toISOString();
  const daysSince = at => Math.max(0, Math.floor((Date.now() - Date.parse(at)) / DAY));

  /* ═══ مال ═══ */
  const H = x => Math.round((Number(x) || 0) * 100);
  const R = h => Math.round(h) / 100;
  const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const fmtPlain = n => (n < 0 ? '−' : '') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const dateAr = s => { const d = parseISO(s); return d ? d.getDate() + ' ' + AR_MONTHS[d.getMonth()] : ''; };

  /* ═══ عربي ═══ */
  function normAr(s) {
    return String(s == null ? '' : s)
      .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660))
      .replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6F0))
      .toLowerCase().replace(/\s+/g, ' ').trim();
  }
  /* نفس ترتيب contractors.classify_entry في الخدمة الحقيقية */
  function classify(description) {
    const t = normAr(description);
    if (t.includes('رصيد افتتاح')) return 'opening';
    if (t.includes('مستخلص')) return 'claim';
    if (t.includes('تامين') || t.includes('ضمان')) return 'retention';
    if (t.includes('خصم')) return 'deduction';
    if (t.includes('دفعه') || t.includes('دفعات') || t.includes('سداد')) return 'payment';
    if (t.includes('فاتوره') || t.includes('فتوره') || t.includes('فواتير')) return 'invoice';
    return 'other';
  }
  function claimNoOf(description) {
    const m = /مستخلص\s*رقم\s*(\d+)/.exec(normAr(description));
    return m ? m[1] : null;
  }
  function parseNum(v) {
    if (v == null) return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    let s = String(v).trim();
    if (!s) return 0;
    s = s.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 0x6F0));
    s = s.replace(/٬/g, '').replace(/٫/g, '.').replace(/[−–]/g, '-');
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[^0-9.\-]/g, '');
    const n = parseFloat(s);
    if (!isFinite(n)) return NaN;
    return neg ? -n : n;
  }
  function parseDate(v) {
    if (v == null) return null;
    let s = String(v).trim().replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660));
    if (!s) return null;
    let m;
    const ok = (y, mo, d) => { const dt = new Date(y, mo - 1, d); return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? iso(dt) : null; };
    if ((m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s))) return ok(+m[1], +m[2], +m[3]);
    if ((m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s))) return ok(+m[3], +m[2], +m[1]);
    if ((m = /^(\d{5})(\.\d+)?$/.exec(s))) { const d = new Date(1899, 11, 30); d.setDate(d.getDate() + +m[1]); return iso(d); }
    return null;
  }

  /* ═══ CSV ═══ */
  function parseCSV(text) {
    text = String(text || '').replace(/^\uFEFF/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const cands = [',', ';', '\t', '،'];
    let delim = ',', best = -1;
    cands.forEach(c => { const n = firstLine.split(c).length; if (n > best) { best = n; delim = c; } });
    const rows = []; let row = [], field = '', q = false, i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } q = false; i++; continue; }
        field += ch; i++; continue;
      }
      if (ch === '"' && field === '') { q = true; i++; continue; }
      if (ch === delim) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r') { i++; continue; }
      if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.some(c => String(c).trim() !== ''));
  }
  function toCSV(rows, columns) {
    rows = rows || [];
    if (!columns) columns = rows.length ? Object.keys(rows[0]).map(k => ({ key: k, label: k })) : [];
    columns = columns.map(c => typeof c === 'string' ? { key: c, label: c } : c);
    const cell = v => {
      if (v == null) return '';
      let s = typeof v === 'number' ? String(v) : String(v);
      if (/[",\r\n;،]/.test(s) || /^\s|\s$/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const out = [columns.map(c => cell(c.label != null ? c.label : c.key)).join(',')];
    rows.forEach(r => out.push(columns.map(c => cell(c.value ? c.value(r) : (c.csv ? c.csv(r) : r[c.key]))).join(',')));
    return out.join('\r\n');
  }
  const HEADER_MAP = {
    account: ['account', 'acc', 'الحساب', 'رقم الحساب', 'حساب', 'كود', 'الكود'],
    name: ['name', 'الاسم', 'اسم الحساب', 'اسم', 'الطرف'],
    date: ['date', 'التاريخ', 'تاريخ'],
    doc: ['doc', 'document', 'المستند', 'رقم المستند', 'مستند', 'رقم القيد'],
    description: ['description', 'desc', 'البيان', 'الوصف', 'بيان'],
    debit: ['debit', 'مدين', 'المدين'],
    credit: ['credit', 'دائن', 'الدائن'],
  };

  /* ═══ الأحداث ═══ */
  const handlers = {};
  function on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); return () => off(evt, fn); }
  function off(evt, fn) { const a = handlers[evt]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  function emit(evt, data) {
    (handlers[evt] || []).slice().forEach(fn => { try { fn(data); } catch (e) { (root.console || console).error('[EGCO.store] handler', evt, e); } });
  }

  /* ═══ التخزين ═══ */
  const LS = (() => { try { const s = root.localStorage; if (!s) return null; s.getItem(KEY); return s; } catch (e) { return null; } })();
  const TYPES = ['projects', 'suppliers', 'invoices', 'payments', 'contractors', 'contractorEntries', 'guarantees', 'receivables', 'budgetMonths', 'imports', 'backups', 'notes'];
  const PREFIX = { projects: 'prj', suppliers: 'sup', invoices: 'inv', payments: 'pay', contractors: 'con', contractorEntries: 'ce', guarantees: 'gua', receivables: 'rec', budgetMonths: 'bud', imports: 'imp', backups: 'bak', notes: 'note' };
  const CHILDREN = {
    suppliers: [['invoices', 'supplierId'], ['payments', 'supplierId']],
    contractors: [['contractorEntries', 'contractorId'], ['guarantees', 'contractorId']],
    projects: [['budgetMonths', 'projectId'], ['receivables', 'projectId']],
    imports: [['invoices', 'importId'], ['payments', 'importId'], ['contractorEntries', 'importId']],
  };
  const DEFAULTS = {
    projects: { name: '', contractValue: 0, budgetDelayPct: 0 },
    suppliers: { account: '', name: '', projectIds: [], termDays: null, phone: '', notes: '' },
    invoices: { supplierId: null, no: '', date: TODAY_ISO, amount: 0, projectId: null, importId: null },
    payments: { supplierId: null, date: TODAY_ISO, amount: 0, doc: '', importId: null },
    contractors: { code: '', name: '', projectIds: [], termDays: null, retentionRate: 0, status: 'active', statusNote: '' },
    contractorEntries: { contractorId: null, date: TODAY_ISO, kind: null, claimNo: null, debit: 0, credit: 0, description: '', projectId: null, importId: null, doc: '' },
    guarantees: { contractorId: null, projectId: null, type: '', amount: 0, issueDate: TODAY_ISO, expiryDate: TODAY_ISO, returnedAt: null },
    receivables: { projectId: null, from: '', docNo: '', amount: 0, dueDate: TODAY_ISO, status: 'pending', collectedAt: null },
    budgetMonths: { projectId: null, month: TODAY_ISO.slice(0, 7), planned: 0, actual: 0, docNo: '' },
    imports: { at: null, file: '', kind: '', partyType: null, partyId: null, added: 0, matched: 0, status: 'ok', error: null, snapshotBefore: null },
    backups: { at: null, kind: 'manual', sizeKb: 0, data: null },
    notes: { at: null, sev: 'i', title: '', detail: '', link: null, read: false, archived: false, kind: null },
  };
  const MONEY_FIELDS = ['amount', 'debit', 'credit', 'planned', 'actual', 'contractValue'];

  let db = null;
  let persistent = !!LS;
  const cache = new Map();
  const memo = (k, fn) => { if (cache.has(k)) return cache.get(k); const v = fn(); cache.set(k, v); return v; };

  function save() {
    cache.clear();
    if (!LS) { persistent = false; return false; }
    let json = JSON.stringify(db);
    for (let attempt = 0; attempt < 80; attempt++) {
      try { LS.setItem(KEY, json); persistent = true; return true; } catch (e) {
        // تجاوز الحصة: احذف أقدم نسخة احتياطية (ما عدا آخر نسختين) ثم أعد المحاولة
        const bs = (db.backups || []).slice().sort((a, b) => a.at < b.at ? -1 : 1);
        if (bs.length <= 2) break;
        db.backups = db.backups.filter(b => b.id !== bs[0].id);
        json = JSON.stringify(db);
      }
    }
    persistent = false; return false;
  }
  function load() {
    if (!LS) return null;
    try {
      const raw = LS.getItem(KEY); if (!raw) return null;
      const d = JSON.parse(raw);
      if (!d || d.version !== SCHEMA) return null;
      TYPES.forEach(t => { if (!Array.isArray(d[t])) d[t] = []; });
      d.settings = Object.assign(defaultSettings(), d.settings || {});
      d.alertKeys = d.alertKeys || {};
      return d;
    } catch (e) { return null; }
  }
  function defaultSettings() {
    return { bankBalance: 0, defaultSupplierTerm: 60, osNotifications: false, island: true, digits: 'latin', theme: 'system', externalBackupDir: 'D:\\EGCO\\النسخ' };
  }
  function nextId(type) { db.seq = (db.seq || 1000) + 1; return (PREFIX[type] || type) + '-' + db.seq; }
  function clone(x) { return x == null ? x : JSON.parse(JSON.stringify(x)); }

  /* ═══ الكتابة: كل كتابة تحفظ وتطلق change ثم تفحص التنبيهات ═══ */
  let inAlerts = false;
  function commit(info) {
    save();
    emit('change', info || {});
    if (!inAlerts) checkAlerts();
  }

  function assertType(type) { if (!TYPES.includes(type)) throw new Error('نوع غير معروف: ' + type); }
  function normalizeRecord(type, o) {
    MONEY_FIELDS.forEach(f => { if (f in o && o[f] != null && o[f] !== '') { const n = parseNum(o[f]); o[f] = isFinite(n) ? R(H(n)) : 0; } });
    if (type === 'contractorEntries') {
      if (!o.kind) o.kind = classify(o.description);
      if (o.claimNo == null) o.claimNo = claimNoOf(o.description);
    }
    if ((type === 'suppliers' || type === 'contractors') && o.termDays != null && o.termDays !== '') o.termDays = Math.max(0, Math.round(parseNum(o.termDays)));
    if ((type === 'suppliers' || type === 'contractors') && o.termDays === '') o.termDays = null;
    return o;
  }
  function validate(type, o, id) {
    if (type === 'suppliers') {
      if (!/^211\d+$/.test(String(o.account || ''))) throw new Error('رقم حساب المورد يجب أن يبدأ بـ211');
      if (db.suppliers.some(s => s.account === o.account && s.id !== id && !s.deletedAt)) throw new Error('رقم الحساب مستخدم لمورد آخر');
      if (!String(o.name || '').trim()) throw new Error('اسم المورد مطلوب');
    }
    if (type === 'contractors') {
      if (!/^212\d+$/.test(String(o.code || ''))) throw new Error('كود المقاول يجب أن يبدأ بـ212');
      if (db.contractors.some(s => s.code === o.code && s.id !== id && !s.deletedAt)) throw new Error('الكود مستخدم لمقاول آخر');
      if (!String(o.name || '').trim()) throw new Error('اسم المقاول مطلوب');
    }
    if (type === 'projects' && !String(o.name || '').trim()) throw new Error('اسم المشروع مطلوب');
  }

  function list(type, opts) {
    if (type === 'settings') return [db.settings];
    assertType(type);
    const withDeleted = opts && opts.withDeleted;
    return withDeleted ? db[type].slice() : db[type].filter(x => !x.deletedAt);
  }
  function get(type, id) {
    if (type === 'settings') return db.settings;
    assertType(type);
    return db[type].find(x => x.id === id) || null;
  }
  function create(type, obj) {
    if (type === 'settings') return setSettings(obj);
    assertType(type);
    const o = Object.assign(clone(DEFAULTS[type]) || {}, clone(obj) || {});
    o.id = o.id && !get(type, o.id) ? o.id : nextId(type);
    o.deletedAt = null; o.deletedBy = null;
    if ('at' in DEFAULTS[type] && !o.at) o.at = nowISO();
    normalizeRecord(type, o);
    validate(type, o, o.id);
    if (type === 'notes') db.notes.unshift(o); else db[type].push(o);
    commit({ type, id: o.id, op: 'create' });
    return o;
  }
  function update(type, id, patch) {
    if (type === 'settings') return setSettings(patch);
    assertType(type);
    const o = get(type, id); if (!o) throw new Error('السجل غير موجود');
    const next = normalizeRecord(type, Object.assign({}, o, clone(patch) || {}, { id: o.id }));
    if (patch && 'description' in patch && !('kind' in patch) && type === 'contractorEntries') { next.kind = classify(next.description); next.claimNo = claimNoOf(next.description); }
    validate(type, next, id);
    Object.assign(o, next);
    commit({ type, id, op: 'update' });
    return o;
  }
  function setSettings(patch) {
    patch = patch || {};
    if ('bankBalance' in patch) patch.bankBalance = R(H(parseNum(patch.bankBalance)));
    if ('defaultSupplierTerm' in patch) patch.defaultSupplierTerm = Math.max(0, Math.round(parseNum(patch.defaultSupplierTerm)) || 0);
    Object.assign(db.settings, patch);
    commit({ type: 'settings', id: null, op: 'update', keys: Object.keys(patch) });
    return db.settings;
  }
  function cascade(type, id, fn) {
    (CHILDREN[type] || []).forEach(([ct, fk]) => db[ct].forEach(c => { if (c[fk] === id) fn(ct, c); }));
  }
  function remove(type, id) {
    assertType(type);
    const o = get(type, id); if (!o || o.deletedAt) return o;
    if (type === 'backups') { purge(type, id); return o; }
    const at = nowISO(), tag = type + ':' + id;
    o.deletedAt = at; o.deletedBy = null;
    let n = 0;
    cascade(type, id, (ct, c) => { if (!c.deletedAt) { c.deletedAt = at; c.deletedBy = tag; n++; } });
    commit({ type, id, op: 'remove', children: n });
    return o;
  }
  function restore(type, id) {
    assertType(type);
    const o = get(type, id); if (!o) return null;
    const tag = type + ':' + id;
    o.deletedAt = null; o.deletedBy = null;
    let n = 0;
    cascade(type, id, (ct, c) => { if (c.deletedBy === tag) { c.deletedAt = null; c.deletedBy = null; n++; } });
    if (type === 'projects' && o.mergedInto) delete o.mergedInto;
    commit({ type, id, op: 'restore', children: n });
    return o;
  }
  function purge(type, id) {
    assertType(type);
    const o = get(type, id); if (!o) return false;
    const tag = type + ':' + id;
    (CHILDREN[type] || []).forEach(([ct, fk]) => {
      // نهائي: يحذف التابعين المحذوفين معه، والتابعين المعلّقين عليه إن كان الأب مورداً/مقاولاً (لا أيتام)
      db[ct] = db[ct].filter(c => !(c.deletedBy === tag || (c[fk] === id && (type === 'suppliers' || type === 'contractors'))));
    });
    db[type] = db[type].filter(x => x.id !== id);
    commit({ type, id, op: 'purge' });
    return true;
  }
  /* المحذوفات (العناصر العليا فقط — التابعون يعودون مع آبائهم) */
  const TYPE_LABEL = { projects: 'مشروع', suppliers: 'مورد', invoices: 'فاتورة', payments: 'دفعة', contractors: 'مقاول', contractorEntries: 'حركة مقاول', guarantees: 'ضمان', receivables: 'تحصيل', budgetMonths: 'شهر موازنة', imports: 'استيراد', notes: 'إشعار' };
  function trash() {
    const out = [];
    TYPES.forEach(t => {
      if (t === 'backups') return;
      db[t].forEach(o => {
        if (!o.deletedAt || o.deletedBy) return;
        const tag = t + ':' + o.id; let children = 0, sumH = 0;
        TYPES.forEach(ct => db[ct].forEach(c => { if (c.deletedBy === tag) { children++; sumH += H(c.amount || c.credit || 0); } }));
        out.push({ type: t, typeLabel: TYPE_LABEL[t] || t, id: o.id, name: displayName(t, o), deletedAt: o.deletedAt, children, childrenAmount: R(sumH), mergedInto: o.mergedInto || null });
      });
    });
    return out.sort((a, b) => a.deletedAt < b.deletedAt ? 1 : -1);
  }
  function displayName(t, o) {
    switch (t) {
      case 'projects': case 'suppliers': case 'contractors': return o.name;
      case 'invoices': return 'فاتورة ' + o.no;
      case 'payments': return 'دفعة ' + (o.doc || '') + ' · ' + fmtPlain(o.amount);
      case 'contractorEntries': return o.description || o.kind;
      case 'guarantees': return o.type + ' · ' + fmtPlain(o.amount);
      case 'receivables': return o.from + ' · ' + o.docNo;
      case 'budgetMonths': { const p = get('projects', o.projectId); return (p ? p.name : '') + ' — ' + AR_MONTHS[+o.month.slice(5, 7) - 1] + ' ' + o.month.slice(0, 4); }
      case 'imports': return o.file;
      case 'notes': return o.title;
      default: return o.id;
    }
  }
  const act = type => db[type].filter(x => !x.deletedAt);
  const byDate = (a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.no || a.claimNo || a.doc || '').localeCompare(String(b.no || b.claimNo || b.doc || ''), 'en', { numeric: true });

  /* ═══ الاشتقاقات ═══ */
  function supplierPosition(id) {
    return memo('sp:' + id, () => {
      const s = get('suppliers', id); if (!s) return null;
      const termDays = s.termDays != null ? s.termDays : db.settings.defaultSupplierTerm;
      const invs = act('invoices').filter(i => i.supplierId === id).sort(byDate);
      const pays = act('payments').filter(p => p.supplierId === id).sort(byDate);
      let pool = pays.reduce((a, p) => a + H(p.amount), 0);
      const paidH = pool;
      let total = 0, open = 0, overdue = 0, due7 = 0, due30 = 0, oldest = 0, overdueCount = 0, openCount = 0;
      const aging = { d0_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
      const lateBuckets = { d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 };
      const invoices = invs.map(inv => {
        const amt = H(inv.amount); total += amt;
        const take = Math.min(pool, amt); pool -= take;
        const rem = amt - take;
        const dueDate = inv.dueDate && parseISO(inv.dueDate) ? iso(parseISO(inv.dueDate)) : addDays(inv.date, termDays);
        const daysToDue = fromToday(dueDate);
        const lateDays = rem > 0 && daysToDue < 0 ? -daysToDue : 0;
        if (rem > 0) {
          open += rem; openCount++;
          const age = -fromToday(inv.date);
          aging[age <= 30 ? 'd0_30' : age <= 60 ? 'd31_60' : age <= 90 ? 'd61_90' : 'd90p'] += rem;
          if (lateDays > 0) {
            overdue += rem; overdueCount++; oldest = Math.max(oldest, lateDays);
            lateBuckets[lateDays <= 30 ? 'd1_30' : lateDays <= 60 ? 'd31_60' : lateDays <= 90 ? 'd61_90' : 'd90p'] += rem;
          } else {
            if (daysToDue <= 7) due7 += rem;
            if (daysToDue <= 30) due30 += rem;
          }
        }
        return Object.assign({}, inv, { paid: R(take), remaining: R(rem), dueDate, dueDateOverride: !!inv.dueDate, daysToDue, lateDays, status: rem === 0 ? 'paid' : lateDays > 0 ? 'late' : take > 0 ? 'partial' : 'open' });
      });
      Object.keys(aging).forEach(k => aging[k] = R(aging[k]));
      Object.keys(lateBuckets).forEach(k => lateBuckets[k] = R(lateBuckets[k]));
      return {
        supplier: s, termDays, termIsDefault: s.termDays == null,
        total: R(total), paid: R(paidH), open: R(open), overdue: R(overdue), due7: R(due7), due30: R(due30),
        credit: R(pool), oldestDays: oldest, overdueCount, openCount, invoiceCount: invs.length,
        invoices, payments: pays, aging, lateBuckets,
        lastInvoiceDate: invs.length ? invs[invs.length - 1].date : null,
        lastPaymentDate: pays.length ? pays[pays.length - 1].date : null,
      };
    });
  }

  function contractorPosition(id) {
    return memo('cp:' + id, () => {
      const c = get('contractors', id); if (!c) return null;
      const term = c.termDays == null ? null : c.termDays;
      const entries = act('contractorEntries').filter(e => e.contractorId === id).sort(byDate);
      let debit = 0, credit = 0, claimsH = 0, paymentsH = 0, retentionH = 0, deductionsH = 0, otherD = 0, otherC = 0;
      let run = 0;
      const ledger = entries.map(e => {
        const d = H(e.debit), cr = H(e.credit);
        debit += d; credit += cr; run += d - cr;
        const k = e.kind || 'other';
        if (k === 'claim') { claimsH += cr; otherD += d; }
        else if (k === 'payment') { paymentsH += d; otherC += cr; }
        else if (k === 'retention') retentionH += d - cr;
        else if (k === 'deduction') deductionsH += d - cr;
        else { otherD += d; otherC += cr; }
        return Object.assign({}, e, { running: R(run) });
      });
      const balance = debit - credit;
      // FIFO: الوعاء = كل المدين؛ الالتزامات = كل الدائن بالأقدم؛ يُبلَّغ عن المستخلصات فقط
      let pool = debit;
      const obligations = entries.filter(e => H(e.credit) > 0).slice().sort(byDate);
      const claims = [];
      let overdue = 0, overdueCount = 0, maxLate = 0, dueSoon = 0, due30 = 0;
      obligations.forEach(e => {
        const amt = H(e.credit); const take = Math.min(pool, amt); pool -= take; const rem = amt - take;
        if (e.kind !== 'claim') return;
        const dueDate = term == null ? null : addDays(e.date, term);
        const daysToDue = dueDate ? fromToday(dueDate) : null;
        const lateDays = term == null ? null : (rem > 0 && daysToDue < 0 ? -daysToDue : 0);
        if (term != null && rem > 0) {
          if (lateDays > 0) { overdue += rem; overdueCount++; maxLate = Math.max(maxLate, lateDays); }
          else { if (daysToDue <= 7) dueSoon += rem; if (daysToDue <= 30) due30 += rem; }
        }
        claims.push(Object.assign({}, e, { amount: R(amt), paid: R(take), remaining: R(rem), dueDate, daysToDue, lateDays }));
      });
      return {
        contractor: c, termDays: term,
        balance: R(balance), owed: R(Math.max(0, -balance)), advance: R(Math.max(0, balance)),
        overdue: term == null ? null : R(overdue), overdueCount: term == null ? null : overdueCount, maxLateDays: term == null ? null : maxLate,
        dueSoon: term == null ? null : R(dueSoon), due30: term == null ? null : R(due30),
        noTermReason: term == null ? 'لا توجد مدة سداد مسجّلة لهذا المقاول — لا يُحسب تأخر بلا مدة' : null,
        claims, entries: ledger,
        debitTotal: R(debit), creditTotal: R(credit), claimsTotal: R(claimsH), paymentsTotal: R(paymentsH),
        retentionHeld: R(retentionH), deductionsTotal: R(deductionsH), otherDebits: R(otherD), otherCredits: R(otherC),
        lastEntryDate: entries.length ? entries[entries.length - 1].date : null,
      };
    });
  }

  function totals() {
    return memo('totals', () => {
      let sOpen = 0, sOver = 0, sDue7 = 0, sDue30 = 0, cOwed = 0, cOver = 0, cSoon = 0, withTerm = 0, withoutTerm = 0, wtOwed = 0, wotOwed = 0, ret = 0;
      let overdueSuppliers = 0, overdueContractors = 0;
      act('suppliers').forEach(s => { const p = supplierPosition(s.id); sOpen += H(p.open); sOver += H(p.overdue); sDue7 += H(p.due7); sDue30 += H(p.due30); if (p.overdue > 0) overdueSuppliers++; });
      act('contractors').forEach(c => {
        const p = contractorPosition(c.id);
        cOwed += H(p.owed); ret += H(p.retentionHeld);
        if (p.termDays == null) { withoutTerm++; wotOwed += H(p.owed); }
        else { withTerm++; wtOwed += H(p.owed); cOver += H(p.overdue); cSoon += H(p.dueSoon); if (p.overdue > 0) overdueContractors++; }
      });
      let rOpen = 0, rOver = 0, rCollected = 0;
      act('receivables').forEach(r => {
        if (r.status === 'collected') { rCollected += H(r.amount); return; }
        rOpen += H(r.amount); if (fromToday(r.dueDate) < 0) rOver += H(r.amount);
      });
      let gActive = 0, gExp7 = 0, gExpired = 0;
      act('guarantees').forEach(g => {
        if (g.returnedAt) return; const d = fromToday(g.expiryDate);
        if (d < 0) gExpired++; else { gActive += H(g.amount); if (d <= 7) gExp7++; }
      });
      return {
        supplierOpen: R(sOpen), supplierOverdue: R(sOver), supplierDue7: R(sDue7), supplierDue30: R(sDue30),
        contractorOwed: R(cOwed), contractorOverdue: R(cOver), contractorDueSoon: R(cSoon),
        withTerm, withoutTerm, withTermOwed: R(wtOwed), withoutTermOwed: R(wotOwed),
        receivableOpen: R(rOpen), receivableOverdue: R(rOver), receivableCollected: R(rCollected),
        retentionHeld: R(ret),
        totalOpen: R(sOpen + cOwed), totalOverdue: R(sOver + cOver),
        overdueSuppliers, overdueContractors,
        guaranteesActive: R(gActive), guaranteesExpiring7: gExp7, guaranteesExpired: gExpired,
        bankBalance: db.settings.bankBalance,
      };
    });
  }

  function projectPosition(id) {
    return memo('pp:' + id, () => {
      const p = get('projects', id); if (!p) return null;
      let sOpen = 0, sOver = 0, sDue7 = 0, invTotal = 0, invCount = 0;
      const suppliers = [];
      act('suppliers').forEach(s => {
        const pos = supplierPosition(s.id); let o = 0, ov = 0, t = 0, n = 0;
        pos.invoices.forEach(i => {
          if (i.projectId !== id) return;
          n++; t += H(i.amount); o += H(i.remaining); if (i.lateDays > 0) ov += H(i.remaining);
          else if (i.remaining > 0 && i.daysToDue <= 7) sDue7 += H(i.remaining);
        });
        if (n || (s.projectIds || []).includes(id)) suppliers.push({ supplierId: s.id, name: s.name, open: R(o), overdue: R(ov), invoiced: R(t), invoiceCount: n });
        sOpen += o; sOver += ov; invTotal += t; invCount += n;
      });
      let cOwed = 0, cOver = 0;
      const contractors = [];
      act('contractors').forEach(c => {
        const pos = contractorPosition(c.id);
        let bal = 0, n = 0;
        pos.entries.forEach(e => { if (e.projectId === id) { bal += H(e.debit) - H(e.credit); n++; } });
        let ov = 0;
        if (pos.termDays != null) pos.claims.forEach(cl => { if (cl.projectId === id && cl.lateDays > 0) ov += H(cl.remaining); });
        const owed = Math.max(0, -bal);
        if (n || (c.projectIds || []).includes(id)) contractors.push({ contractorId: c.id, name: c.name, owed: R(owed), overdue: pos.termDays == null ? null : R(ov), termDays: pos.termDays });
        cOwed += owed; cOver += ov;
      });
      let rOpen = 0, rOver = 0, rColl = 0;
      const receivables = act('receivables').filter(r => r.projectId === id);
      receivables.forEach(r => { if (r.status === 'collected') rColl += H(r.amount); else { rOpen += H(r.amount); if (fromToday(r.dueDate) < 0) rOver += H(r.amount); } });
      const months = act('budgetMonths').filter(b => b.projectId === id).sort((a, b) => a.month < b.month ? -1 : 1);
      let cp = 0, ca = 0;
      const bm = months.map(m => { cp += H(m.planned); ca += H(m.actual); return Object.assign({}, m, { cumPlanned: R(cp), cumActual: R(ca), variance: R(H(m.actual) - H(m.planned)) }); });
      const guarantees = act('guarantees').filter(g => g.projectId === id);
      let cCost = 0;
      act('contractorEntries').forEach(e => { if (e.projectId === id && e.kind === 'claim' && get('contractors', e.contractorId) && !get('contractors', e.contractorId).deletedAt) cCost += H(e.credit); });
      const cv = H(p.contractValue);
      return {
        project: p,
        contractValue: R(cv), budgetDelayPct: p.budgetDelayPct,
        supplierCost: R(invTotal), contractorCost: R(cCost),
        receivableBilled: R(rOpen + rColl), receivableCollected: R(rColl),
        margin: cv > 0 ? R(cv - invTotal - cCost) : null,
        marginPct: cv > 0 ? Math.round((cv - invTotal - cCost) / cv * 10000) / 100 : null,
        supplierOpen: R(sOpen), supplierOverdue: R(sOver), supplierDue7: R(sDue7), invoicedTotal: R(invTotal), invoiceCount: invCount,
        contractorOwed: R(cOwed), contractorOverdue: R(cOver),
        owed: R(sOpen + cOwed), overdue: R(sOver + cOver),
        receivableOpen: R(rOpen), receivableOverdue: R(rOver), collected: R(rColl), receivables,
        budget: { months: bm, planned: R(cp), actual: R(ca), variance: R(ca - cp), variancePct: cp ? Math.round((ca - cp) / cp * 10000) / 100 : null },
        guarantees, suppliers, contractors,
      };
    });
  }

  function payableItems() {
    const items = [];
    act('suppliers').forEach(s => {
      supplierPosition(s.id).invoices.forEach(i => {
        if (i.remaining <= 0) return;
        items.push({ date: i.dueDate, party: s.name, partyId: s.id, partyType: 'supplier', doc: i.no, ref: i.no, amount: i.remaining, late: i.lateDays, projectId: i.projectId, sourceId: i.id, link: { view: 'supplier', params: { id: s.id } } });
      });
    });
    act('contractors').forEach(c => {
      const pos = contractorPosition(c.id); if (pos.termDays == null) return;
      pos.claims.forEach(cl => {
        if (cl.remaining <= 0) return;
        const doc = cl.claimNo ? 'مستخلص ' + cl.claimNo : (cl.doc || cl.description);
        items.push({ date: cl.dueDate, party: c.name, partyId: c.id, partyType: 'contractor', doc, ref: doc, amount: cl.remaining, late: cl.lateDays, projectId: cl.projectId, sourceId: cl.id, link: { view: 'contractor', params: { id: c.id } } });
      });
    });
    return items;
  }

  /* الرصيد المتوقع: يبدأ من bankBalance؛ المتأخر يُحتسب مستحقاً اليوم (اليوم ٠)؛ يُضاف المتوقع تحصيله
   * (غير المحصّل، تاريخه اليوم أو بعده). المقاول بلا مدة لا يدخل (لا تاريخ مخترع). */
  function cashProjection(days) {
    days = Math.max(1, Math.min(365, Math.round(days || 30)));
    return memo('cash:' + days, () => {
      const b = [];
      for (let i = 0; i <= days; i++) b.push({ date: addDays(TODAY_ISO, i), inH: 0, outH: 0, items: [] });
      payableItems().forEach(it => {
        const off = Math.max(0, fromToday(it.date)); if (off > days) return;
        b[off].outH += H(it.amount);
        b[off].items.push(Object.assign({ dir: 'out', dueDate: it.date }, it));
      });
      act('receivables').forEach(r => {
        if (r.status === 'collected') return; const off = fromToday(r.dueDate); if (off < 0 || off > days) return;
        const p = get('projects', r.projectId);
        b[off].inH += H(r.amount);
        b[off].items.push({ dir: 'in', party: r.from, partyId: r.id, partyType: 'receivable', doc: r.docNo, ref: r.docNo, amount: r.amount, late: 0, dueDate: r.dueDate, projectId: r.projectId, projectName: p ? p.name : '', status: r.status, link: { view: 'collections', params: { id: r.id } } });
      });
      let bal = H(db.settings.bankBalance);
      return b.map(x => { bal += x.inH - x.outH; return { date: x.date, balance: R(bal), in: R(x.inH), out: R(x.outH), items: x.items }; });
    });
  }

  function dueList(opts) {
    opts = opts || {};
    const days = opts.days == null ? 30 : opts.days;
    const includeOverdue = opts.includeOverdue !== false;
    return payableItems()
      .filter(it => fromToday(it.date) <= days && (includeOverdue || !(it.late > 0)))
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount);
  }

  /* calendar(year, month 1–12) → {'YYYY-MM-DD': [events]} — يشمل الشهر المجاور قبله وبعده لحشو الشبكة */
  function calendar(year, month) {
    const from = iso(new Date(year, month - 2, 1)), to = iso(new Date(year, month + 1, 0));
    const out = {};
    const add = (date, ev) => { if (date < from || date > to) return; (out[date] = out[date] || []).push(ev); };
    payableItems().forEach(it => add(it.date, {
      kind: it.partyType === 'supplier' ? 'invoice' : 'claim',
      title: (it.partyType === 'supplier' ? 'فاتورة ' : '') + it.doc + ' — ' + it.party,
      amount: it.amount, late: it.late > 0, sev: it.late > 0 ? 'd' : 'w',
      partyId: it.partyId, partyType: it.partyType, projectId: it.projectId, link: it.link, doc: it.doc,
    }));
    act('receivables').forEach(r => {
      if (r.status === 'collected') { if (r.collectedAt) add(r.collectedAt, { kind: 'receivable', title: 'تحصيل ' + r.docNo + ' — ' + r.from, amount: r.amount, late: false, sev: 'o', partyId: r.id, partyType: 'receivable', projectId: r.projectId, link: { view: 'collections', params: { id: r.id } } }); return; }
      const late = fromToday(r.dueDate) < 0;
      add(r.dueDate, { kind: 'receivable', title: 'تحصيل متوقع ' + r.docNo + ' — ' + r.from, amount: r.amount, late, sev: late ? 'd' : 'o', partyId: r.id, partyType: 'receivable', projectId: r.projectId, link: { view: 'collections', params: { id: r.id } } });
    });
    act('guarantees').forEach(g => {
      if (g.returnedAt) return; const c = get('contractors', g.contractorId); const late = fromToday(g.expiryDate) < 0;
      add(g.expiryDate, { kind: 'guarantee', title: 'انتهاء ' + g.type + ' — ' + (c ? c.name : ''), amount: g.amount, late, sev: late ? 'd' : 'w', partyId: g.contractorId, partyType: 'contractor', projectId: g.projectId, link: { view: 'guarantees', params: { id: g.id } } });
    });
    act('payments').forEach(p => {
      const s = get('suppliers', p.supplierId); if (!s || s.deletedAt) return;
      add(p.date, { kind: 'payment', title: 'دفعة ' + (p.doc || '') + ' — ' + s.name, amount: p.amount, late: false, sev: 'i', partyId: s.id, partyType: 'supplier', projectId: null, link: { view: 'supplier', params: { id: s.id } } });
    });
    act('imports').forEach(im => {
      if (!im.at) return; const d = iso(new Date(im.at));
      add(d, { kind: 'import', title: 'استيراد ' + im.file, amount: null, late: false, sev: im.status === 'failed' ? 'w' : 'i', partyId: im.partyId, partyType: im.partyType, projectId: null, link: { view: 'import', params: { id: im.id } } });
    });
    return out;
  }

  function staleness() {
    const invs = act('invoices');
    let newest = null; invs.forEach(i => { if (!newest || i.date > newest) newest = i.date; });
    const lastImport = (type, id) => {
      let best = null;
      act('imports').forEach(im => { if (im.status === 'ok' && im.partyType === type && im.partyId === id && (!best || im.at > best.at)) best = im; });
      return best;
    };
    const cov = (type, list) => list.map(x => {
      const im = lastImport(type, x.id); const d = im ? daysSince(im.at) : null;
      return { [type === 'supplier' ? 'supplierId' : 'contractorId']: x.id, name: x.name, lastImportDays: d, lastImportAt: im ? im.at : null, file: im ? im.file : null, stale: d == null || d > 60 };
    });
    return {
      newestInvoiceDays: newest ? -fromToday(newest) : null, newestInvoiceDate: newest,
      coverage: cov('supplier', act('suppliers')),
      contractorCoverage: cov('contractor', act('contractors')),
    };
  }

  /* ═══ الإشعارات ═══ */
  function notify(n) {
    const note = Object.assign(clone(DEFAULTS.notes), n || {}, { id: nextId('notes'), at: nowISO(), deletedAt: null, deletedBy: null });
    if (!['d', 'w', 'o', 'i'].includes(note.sev)) note.sev = 'i';
    db.notes.unshift(note);
    if (db.notes.length > 300) db.notes.length = 300;
    save();
    emit('note', note);
    return note;
  }
  function markAllRead() { let n = 0; db.notes.forEach(x => { if (!x.read) { x.read = true; n++; } }); commit({ type: 'notes', op: 'update', count: n }); return n; }
  function unreadCount() { return db.notes.filter(n => !n.read && !n.archived && !n.deletedAt).length; }

  function checkAlerts() {
    if (inAlerts || !db) return;
    inAlerts = true;
    let changed = false;
    try {
      const keys = db.alertKeys = db.alertKeys || {};
      // ١) عجز نقدي متوقع خلال ٣٠ يوماً
      const proj = cashProjection(30);
      const i = proj.findIndex(p => p.balance < 0);
      if (i >= 0) {
        const low = proj.reduce((m, p) => p.balance < m.balance ? p : m, proj[0]);
        if (!keys.deficit) {
          keys.deficit = proj[i].date; changed = true;
          notify({ kind: 'deficit', sev: 'd', title: 'عجز نقدي متوقع', detail: 'الرصيد يصبح ' + fmtPlain(proj[i].balance) + ' ر.س في ' + dateAr(proj[i].date) + ' · أدنى رصيد ' + fmtPlain(low.balance) + ' ر.س في ' + dateAr(low.date), link: { view: 'cash', params: {} }, data: { date: proj[i].date, balance: proj[i].balance, low: low.balance, lowDate: low.date } });
        }
      } else if (keys.deficit) { delete keys.deficit; changed = true; }
      // ٢) ضمان ينتهي خلال ٧ أيام
      act('guarantees').forEach(g => {
        if (g.returnedAt) return; const d = fromToday(g.expiryDate); const k = 'g7:' + g.id;
        if (d >= 0 && d <= 7 && !keys[k]) {
          keys[k] = 1; changed = true; const c = get('contractors', g.contractorId); const p = get('projects', g.projectId);
          notify({ kind: 'guarantee', sev: 'w', title: d === 0 ? 'ضمان ينتهي اليوم' : 'ضمان ينتهي خلال ' + d + ' أيام', detail: g.type + ' — ' + (c ? c.name : '') + (p ? ' · ' + p.name : '') + ' · ' + dateAr(g.expiryDate), link: { view: 'guarantees', params: { id: g.id } } });
        }
      });
      // ٣) مستخلص صار متأخراً
      act('contractors').forEach(c => {
        const pos = contractorPosition(c.id); if (pos.termDays == null) return;
        pos.claims.forEach(cl => {
          const k = 'cl:' + cl.id;
          if (cl.lateDays > 0 && !keys[k]) {
            keys[k] = 1; changed = true;
            notify({ kind: 'claim', sev: 'd', title: 'مستخلص متأخر ' + cl.lateDays + ' يوماً', detail: c.name + ' · ' + (cl.claimNo ? 'مستخلص ' + cl.claimNo + ' · ' : '') + fmtPlain(cl.remaining) + ' ر.س', link: { view: 'contractor', params: { id: c.id } } });
          }
        });
      });
      if (changed) save();
    } finally { inAlerts = false; }
  }

  /* ═══ النسخ الاحتياطي ═══ */
  const KEEP = { daily: 30, manual: 20, 'before-import': 10, 'before-restore': 10 };
  function snapshot() { const c = Object.assign({}, db); delete c.backups; return clone(c); }
  function byteLen(s) { try { return new TextEncoder().encode(s).length; } catch (e) { return s.length * 2; } }
  function backup(kind) {
    kind = KEEP[kind] ? kind : 'manual';
    const visible = kind === 'manual' || kind === 'daily';
    if (visible) emit('backup:start', { kind });
    const data = snapshot(); const json = JSON.stringify(data);
    const b = { id: nextId('backups'), at: nowISO(), kind, sizeKb: Math.round(byteLen(json) / 1024 * 10) / 10, data, deletedAt: null, deletedBy: null };
    db.backups.unshift(b);
    const same = db.backups.filter(x => x.kind === kind).sort((a, c) => a.at < c.at ? 1 : -1);
    if (same.length > KEEP[kind]) { const drop = new Set(same.slice(KEEP[kind]).map(x => x.id)); db.backups = db.backups.filter(x => !drop.has(x.id)); }
    commit({ type: 'backups', id: b.id, op: 'create', kind });
    if (visible) {
      setTimeout(() => {
        emit('backup:done', { id: b.id, kind, sizeKb: b.sizeKb });
        notify({ kind: 'backup', sev: 'o', read: true, title: kind === 'daily' ? 'اكتملت النسخة الاحتياطية اليومية' : 'اكتملت نسخة احتياطية يدوية', detail: (b.sizeKb >= 1024 ? (b.sizeKb / 1024).toFixed(1) + ' م.ب' : b.sizeKb + ' ك.ب') + ' · محفوظة في المتصفح' + (db.settings.externalBackupDir ? ' (المجلد الخارجي في التطبيق الفعلي)' : ''), link: { view: 'backups', params: {} } });
      }, 1400);
    }
    return b;
  }
  function restoreBackup(id) {
    const b = get('backups', id); if (!b || !b.data) throw new Error('النسخة غير موجودة');
    const keepData = clone(b.data);
    backup('before-restore');
    const keepUi = { theme: db.settings.theme, digits: db.settings.digits, island: db.settings.island };
    const backups = db.backups;
    db = Object.assign({}, keepData, { backups, version: SCHEMA, seq: Math.max(db.seq || 0, keepData.seq || 0) });
    TYPES.forEach(t => { if (!Array.isArray(db[t])) db[t] = []; });
    db.settings = Object.assign(defaultSettings(), keepData.settings || {}, keepUi);
    db.alertKeys = db.alertKeys || {};
    api.db = db;
    commit({ type: '*', op: 'restore', backupId: id });
    notify({ kind: 'backup', sev: 'i', title: 'استُعيدت نسخة احتياطية', detail: 'نسخة ' + new Date(b.at).toLocaleString('en-GB') + ' · أُخذت نسخة «قبل الاستعادة» أولاً', link: { view: 'backups', params: {} } });
    return true;
  }
  function deleteBackup(id) { return purge('backups', id); }
  function dailyIfDue() {
    const last = db.backups.filter(b => b.kind === 'daily').sort((a, b) => a.at < b.at ? 1 : -1)[0];
    if (!last || Date.now() - Date.parse(last.at) > 20 * 36e5) return backup('daily');
    return null;
  }

  /* ═══ الاستيراد ═══ */
  function previewCSV(text) {
    const grid = parseCSV(text);
    const errors = [], rows = [];
    if (!grid.length) return { rows, parties: [], errors: [{ row: 0, line: 0, message: 'الملف فارغ' }], columns: {} };
    const head = grid[0].map(h => normAr(h));
    const col = {};
    Object.keys(HEADER_MAP).forEach(k => {
      const idx = head.findIndex(h => HEADER_MAP[k].some(alias => normAr(alias) === h));
      if (idx >= 0) col[k] = idx;
    });
    const missing = ['account', 'date'].filter(k => col[k] == null);
    if (col.debit == null && col.credit == null) missing.push('debit/credit');
    if (missing.length) return { rows, parties: [], errors: [{ row: 1, line: 1, message: 'أعمدة ناقصة: ' + missing.join('، ') + ' — المتوقع: الحساب، الاسم، التاريخ، المستند، البيان، مدين، دائن' }], columns: col };
    const seen = new Set();
    const supByAcc = {}, conByCode = {};
    db.suppliers.filter(s => !s.deletedAt).forEach(s => supByAcc[s.account] = s);
    db.contractors.filter(s => !s.deletedAt).forEach(s => conByCode[s.code] = s);
    const existingKeys = new Set();
    act('invoices').forEach(i => { const s = get('suppliers', i.supplierId); if (s) existingKeys.add([s.account, i.date, H(i.amount), String(i.no || '').trim()].join('|')); });
    act('payments').forEach(p => { const s = get('suppliers', p.supplierId); if (s) existingKeys.add([s.account, p.date, H(p.amount), String(p.doc || '').trim()].join('|')); });
    act('contractorEntries').forEach(e => { const c = get('contractors', e.contractorId); if (c) existingKeys.add([c.code, e.date, H(e.credit) || H(e.debit), String(e.doc || '').trim()].join('|')); });
    const partyMap = {};
    let ignored = 0;
    for (let r = 1; r < grid.length; r++) {
      const g = grid[r], line = r + 1;
      const v = k => col[k] == null ? '' : String(g[col[k]] == null ? '' : g[col[k]]).trim();
      const account = v('account').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x660)).replace(/\s/g, '');
      const name = v('name'), doc = v('doc'), description = v('description');
      const date = parseDate(v('date'));
      const debit = parseNum(v('debit')), credit = parseNum(v('credit'));
      const err = m => { errors.push({ row: line, line, message: m, raw: g.join(' | ') }); };
      if (!account) { err('الحساب فارغ'); continue; }
      if ((db.settings.accountClasses || {})[account] === 'ignore') { ignored++; continue; }
      if (!date) { err('تاريخ غير صالح: «' + v('date') + '»'); continue; }
      if (!isFinite(debit) || !isFinite(credit)) { err('مبلغ غير صالح'); continue; }
      if (debit < 0 || credit < 0) { err('مبلغ سالب — استخدم عمود المدين/الدائن'); continue; }
      if (!(debit > 0) && !(credit > 0)) { err('لا مبلغ في المدين ولا الدائن'); continue; }
      let partyType;
      const cls = (db.settings.accountClasses || {})[account];
      const prefix = cls || account.slice(0, 3);
      if (prefix === 'ignore') { ignored++; continue; }
      if (prefix === '211') partyType = 'supplier';
      else if (prefix === '212') partyType = 'contractor';
      else if (prefix === '216') partyType = 'guarantee';
      else {
        err('بادئة الحساب «' + account.slice(0, 3) + '» غير معروفة (211 مورد · 212 مقاول · 216 ضمان) — صنّفه من الإعدادات');
        const uk = 'unknown:' + account;
        if (!partyMap[uk]) partyMap[uk] = { account, name: name || account, partyType: null, partyId: null, isNew: true, unknown: true, added: 0, dupes: 0, amount: 0, rows: 0 };
        partyMap[uk].rows++;
        continue;
      }
      const amountH = credit > 0 ? H(credit) : H(debit);
      const key = [account, date, amountH, doc].join('|');
      let dupe = existingKeys.has(key) || seen.has(key);
      seen.add(key);
      let kind, partyId = null, isNew = false, contractorId = null;
      if (partyType === 'supplier') { kind = credit > 0 ? 'invoice' : 'payment'; const s = supByAcc[account]; partyId = s ? s.id : null; isNew = !s; }
      else if (partyType === 'contractor') { kind = classify(description); const c = conByCode[account]; partyId = c ? c.id : null; isNew = !c; }
      else {
        kind = 'guarantee';
        const hay = normAr(name + ' ' + description);
        const c = db.contractors.filter(x => !x.deletedAt).find(x => hay.includes(normAr(x.name)) || normAr(x.name).includes(normAr(name)) && name);
        if (!c) { err('لم يُعرف المقاول لهذا الضمان — اكتب اسم المقاول في عمود الاسم'); continue; }
        contractorId = c.id; partyId = c.id;
        dupe = dupe || act('guarantees').some(x => x.contractorId === c.id && x.issueDate === date && H(x.amount) === amountH);
      }
      const row = { line, account, name, date, doc, description, debit: R(H(debit)), credit: R(H(credit)), amount: R(amountH), partyType, kind, partyId, contractorId, isNew, dupe, claimNo: partyType === 'contractor' ? claimNoOf(description) : null };
      rows.push(row);
      const pk = partyType + ':' + account;
      const p = partyMap[pk] = partyMap[pk] || { account, name: name || account, partyType, partyId, isNew, added: 0, dupes: 0, amount: 0 };
      if (!p.name && name) p.name = name;
      p.rows = (p.rows || 0) + 1;
      if (dupe) p.dupes++; else { p.added++; p.amount = R(H(p.amount) + amountH); }
    }
    return { rows, parties: Object.values(partyMap), errors, ignored, columns: col, added: rows.filter(r => !r.dupe).length, dupes: rows.filter(r => r.dupe).length };
  }

  let importing = false;
  function commitImport(preview, opts) {
    opts = opts || {};
    const fileName = opts.fileName || 'كشف.csv';
    if (importing) return Promise.reject(new Error('استيراد آخر قيد التنفيذ'));
    if (!preview || !Array.isArray(preview.rows)) return Promise.reject(new Error('معاينة غير صالحة'));
    importing = true;
    const delay = opts.fast ? 0 : 160;
    return new Promise(resolve => {
      const steps = [6, 18, 34, 52, 68, 84, 95];
      let si = 0;
      emit('import:progress', { pct: 0, file: fileName });
      const tick = () => {
        if (si < steps.length) { emit('import:progress', { pct: steps[si++], file: fileName }); setTimeout(tick, delay); return; }
        let result;
        try { result = writeImport(preview, fileName); } catch (e) { result = failImport(fileName, e.message || String(e)); }
        emit('import:progress', { pct: 100, file: fileName });
        importing = false;
        emit('import:done', { importId: result.importIds[0] || null, importIds: result.importIds, diff: result.diff, file: fileName, status: result.status });
        resolve(result);
      };
      setTimeout(tick, delay);
    });
  }
  function failImport(fileName, message) {
    const rec = Object.assign(clone(DEFAULTS.imports), { id: nextId('imports'), at: nowISO(), file: fileName, kind: 'unknown', status: 'failed', error: message, deletedAt: null, deletedBy: null });
    db.imports.unshift(rec);
    commit({ type: 'imports', id: rec.id, op: 'create' });
    notify({ kind: 'import', sev: 'w', title: 'فشل استيراد «' + fileName + '»', detail: message, link: { view: 'import', params: { id: rec.id } } });
    return { importId: rec.id, importIds: [rec.id], status: 'failed', diff: null, error: message };
  }
  function writeImport(preview, fileName) {
    const valid = preview.rows.filter(r => !r.dupe);
    if (!preview.rows.length) return failImport(fileName, (preview.errors[0] && preview.errors[0].message) || 'لا صفوف صالحة في الملف');
    const before = totals();
    const openBefore = new Set();
    act('suppliers').forEach(s => supplierPosition(s.id).invoices.forEach(i => { if (i.remaining > 0) openBefore.add(i.id); }));
    const snap = backup('before-import');
    const importIds = [], recByParty = {};
    const at = nowISO();
    const groups = {};
    preview.rows.forEach(r => { const k = r.partyType + ':' + r.account; (groups[k] = groups[k] || []).push(r); });
    let newInvoices = 0, newPayments = 0, newEntries = 0, newGuarantees = 0, newParties = 0;
    Object.keys(groups).forEach(k => {
      const rows = groups[k], r0 = rows[0];
      let partyId = r0.partyId;
      if (r0.partyType === 'supplier' && !partyId) {
        const ex = db.suppliers.find(s => s.account === r0.account && !s.deletedAt);
        if (ex) partyId = ex.id; else {
          const s = Object.assign(clone(DEFAULTS.suppliers), { id: nextId('suppliers'), account: r0.account, name: rows.find(x => x.name) ? rows.find(x => x.name).name : r0.account, notes: 'أُنشئ من استيراد «' + fileName + '»', deletedAt: null, deletedBy: null });
          db.suppliers.push(s); partyId = s.id; newParties++;
        }
      }
      if (r0.partyType === 'contractor' && !partyId) {
        const ex = db.contractors.find(s => s.code === r0.account && !s.deletedAt);
        if (ex) partyId = ex.id; else {
          const c = Object.assign(clone(DEFAULTS.contractors), { id: nextId('contractors'), code: r0.account, name: rows.find(x => x.name) ? rows.find(x => x.name).name : r0.account, statusNote: 'أُنشئ من استيراد — بلا مدة سداد', deletedAt: null, deletedBy: null });
          db.contractors.push(c); partyId = c.id; newParties++;
        }
      }
      const added = rows.filter(r => !r.dupe).length, matched = rows.length - added;
      const rec = Object.assign(clone(DEFAULTS.imports), { id: nextId('imports'), at, file: fileName, kind: r0.partyType, partyType: r0.partyType === 'guarantee' ? 'contractor' : r0.partyType, partyId, added, matched, status: 'ok', error: null, snapshotBefore: snap.id, deletedAt: null, deletedBy: null });
      db.imports.unshift(rec); importIds.push(rec.id); recByParty[k] = rec;
      const party = r0.partyType === 'supplier' ? get('suppliers', partyId) : get('contractors', partyId);
      const projectId = party && party.projectIds && party.projectIds[0] || null;
      rows.forEach(r => {
        if (r.dupe) return;
        const base = { deletedAt: null, deletedBy: null, importId: rec.id };
        if (r.partyType === 'supplier') {
          if (r.kind === 'invoice') { db.invoices.push(Object.assign(clone(DEFAULTS.invoices), base, { id: nextId('invoices'), supplierId: partyId, no: r.doc, date: r.date, amount: r.credit, projectId })); newInvoices++; }
          else { db.payments.push(Object.assign(clone(DEFAULTS.payments), base, { id: nextId('payments'), supplierId: partyId, date: r.date, amount: r.debit, doc: r.doc })); newPayments++; }
        } else if (r.partyType === 'contractor') {
          db.contractorEntries.push(Object.assign(clone(DEFAULTS.contractorEntries), base, { id: nextId('contractorEntries'), contractorId: partyId, date: r.date, kind: r.kind, claimNo: r.claimNo, debit: r.debit, credit: r.credit, description: r.description, projectId, doc: r.doc }));
          newEntries++;
        } else {
          const c = get('contractors', r.contractorId);
          db.guarantees.push(Object.assign(clone(DEFAULTS.guarantees), { id: nextId('guarantees'), contractorId: r.contractorId, projectId: c && c.projectIds[0] || null, type: r.description || 'ضمان', amount: r.amount, issueDate: r.date, expiryDate: addDays(r.date, 365), returnedAt: null, deletedAt: null, deletedBy: null, importId: rec.id }));
          newGuarantees++;
        }
      });
    });
    cache.clear();
    const after = totals();
    const paidInvoices = [];
    act('suppliers').forEach(s => supplierPosition(s.id).invoices.forEach(i => { if (openBefore.has(i.id) && i.remaining === 0) paidInvoices.push(i.id); }));
    const diff = {
      added: valid.length, matched: preview.rows.length - valid.length, errors: preview.errors.length,
      newInvoices, newPayments, newEntries, newGuarantees, newParties, paidInvoices: paidInvoices.length, paidInvoiceIds: paidInvoices,
      before, after,
      overdueDelta: R(H(after.totalOverdue) - H(before.totalOverdue)),
      openDelta: R(H(after.totalOpen) - H(before.totalOpen)),
    };
    db.lastChange = { at, file: fileName, before, after, newInvoices, paidInvoices: paidInvoices.length, importIds, diff: { added: diff.added, matched: diff.matched, overdueDelta: diff.overdueDelta, openDelta: diff.openDelta, newParties } };
    commit({ type: 'imports', op: 'import', importIds });
    notify({ kind: 'import', sev: 'i', title: 'اكتمل استيراد «' + fileName + '»', detail: valid.length + ' حركة جديدة · ' + diff.matched + ' مطابقة مسبقاً' + (newParties ? ' · ' + newParties + ' طرف جديد' : '') + (preview.errors.length ? ' · ' + preview.errors.length + ' صف مرفوض' : ''), link: { view: 'import', params: { id: importIds[0] } } });
    if (diff.overdueDelta > 0) notify({ kind: 'overdue', sev: 'd', title: 'متأخر جديد بعد الاستيراد', detail: 'المتأخر زاد ' + fmtPlain(diff.overdueDelta) + ' ر.س · «' + fileName + '»', link: { view: 'due', params: {} } });
    return { importId: importIds[0] || null, importIds, status: 'ok', diff };
  }
  function importCSV(text, opts) {
    const p = previewCSV(text);
    if (!p.rows.length) { const r = failImport((opts && opts.fileName) || 'كشف.csv', (p.errors[0] && p.errors[0].message) || 'لا صفوف صالحة'); emit('import:done', { importId: r.importIds[0], importIds: r.importIds, diff: null, status: 'failed' }); return Promise.resolve(Object.assign(r, { preview: p })); }
    return commitImport(p, opts).then(r => Object.assign(r, { preview: p }));
  }
  function revertImport(id) { return remove('imports', id); }
  function sampleCSV() {
    const lines = [['الحساب', 'الاسم', 'التاريخ', 'المستند', 'البيان', 'مدين', 'دائن']];
    const s2 = db.suppliers.find(s => s.account === '2110017' && !s.deletedAt);
    const nm = s2 ? s2.name : 'شركة البناء الحديث للخرسانة';
    lines.push(['2110017', nm, '2026-09-20', 'ف-7731', 'فاتورة توريد خرسانة جاهزة, دفعة 3 "C40"', '', '58214.00']);
    lines.push(['2110017', nm, '2026-10-12', 'ف-7768', 'فاتورة توريد خرسانة', '', '40,000.00']);
    lines.push(['2110017', nm, '10/11/2026', 'س-2291', 'سداد دفعة تحت الحساب', '75000', '']);
    const dup = s2 && act('invoices').filter(i => i.supplierId === s2.id).sort(byDate)[0];
    if (dup) lines.push(['2110017', nm, dup.date, dup.no, 'فاتورة (موجودة مسبقاً)', '', String(dup.amount)]);
    const c4 = db.contractors.find(c => c.code === '21201091' && !c.deletedAt);
    lines.push(['21201091', c4 ? c4.name : 'شركة الواجهات الحديثة', '2026-11-12', 'ق-904', 'مستخلص رقم 4 — واجهات السدن', '', '145000.00']);
    lines.push(['2110160', 'مؤسسة البيان للمواد الكهربائية', '2026-08-15', 'ف-118', 'فاتورة مواد كهربائية', '', '23750.50']);
    return toCSV(lines.slice(1).map(r => r), lines[0].map((h, i) => ({ key: i, label: h })));
  }

  /* ═══ الدمج ═══ */
  const projKey = name => normAr(name).split(' ').map(w => w.replace(/^ال(?=..)/, '')).join('').replace(/[^\u0600-\u06FFa-z0-9]/g, '');
  function projectMergeSuggestions() {
    const ps = act('projects');
    const weight = id => ['invoices', 'contractorEntries', 'receivables', 'budgetMonths', 'guarantees'].reduce((a, t) => a + act(t).filter(x => x.projectId === id).length, 0);
    const groups = {};
    ps.forEach(p => { const k = projKey(p.name); (groups[k] = groups[k] || []).push(p); });
    const out = [];
    Object.values(groups).forEach(g => {
      if (g.length < 2) return;
      const sorted = g.slice().sort((a, b) => weight(b.id) - weight(a.id));
      const into = sorted[0];
      sorted.slice(1).forEach(f => {
        const cntT = t => act(t).filter(x => x.projectId === f.id).length;
        const amount = R(act('invoices').filter(x => x.projectId === f.id).reduce((a, x) => a + H(x.amount), 0) + act('contractorEntries').filter(x => x.projectId === f.id).reduce((a, x) => a + H(x.credit), 0));
        out.push({ fromId: f.id, intoId: into.id, fromName: f.name, intoName: into.name, fromCount: weight(f.id), intoCount: weight(into.id),
          moves: { invoices: cntT('invoices'), entries: cntT('contractorEntries'), receivables: cntT('receivables'), guarantees: cntT('guarantees'), budgetMonths: cntT('budgetMonths') },
          amount, reason: 'الاسمان متطابقان بعد حذف «ال» وتوحيد الهمزات' });
      });
    });
    return out;
  }
  function mergeProjects(fromId, intoId) {
    if (fromId === intoId) throw new Error('لا يمكن دمج المشروع في نفسه');
    const from = get('projects', fromId), into = get('projects', intoId);
    if (!from || !into || from.deletedAt || into.deletedAt) throw new Error('مشروع غير موجود');
    const undoSnap = JSON.stringify(snapshot());
    const moved = { invoices: 0, contractorEntries: 0, guarantees: 0, receivables: 0, budgetMonths: 0, suppliers: 0, contractors: 0 };
    ['invoices', 'contractorEntries', 'guarantees', 'receivables'].forEach(t => db[t].forEach(x => { if (x.projectId === fromId) { x.projectId = intoId; moved[t]++; } }));
    db.budgetMonths.forEach(m => {
      if (m.projectId !== fromId || m.deletedAt) return;
      const ex = db.budgetMonths.find(x => x.projectId === intoId && x.month === m.month && !x.deletedAt);
      if (ex) { ex.planned = R(H(ex.planned) + H(m.planned)); ex.actual = R(H(ex.actual) + H(m.actual)); m.deletedAt = nowISO(); m.deletedBy = 'projects:' + fromId; }
      else m.projectId = intoId;
      moved.budgetMonths++;
    });
    ['suppliers', 'contractors'].forEach(t => db[t].forEach(x => {
      if ((x.projectIds || []).includes(fromId)) { x.projectIds = Array.from(new Set(x.projectIds.map(p => p === fromId ? intoId : p))); moved[t]++; }
    }));
    into.contractValue = R(H(into.contractValue) + H(from.contractValue));
    from.deletedAt = nowISO(); from.deletedBy = null; from.mergedInto = intoId;
    commit({ type: 'projects', id: fromId, op: 'merge', intoId });
    const undo = () => {
      const s = JSON.parse(undoSnap); const keep = { backups: db.backups, notes: db.notes, settings: db.settings, alertKeys: db.alertKeys, seq: db.seq };
      db = Object.assign({}, s, keep); api.db = db; commit({ type: 'projects', id: fromId, op: 'unmerge' });
    };
    return { moved, undo, from, into };
  }

  /* ═══ بيانات المثال ═══ */
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function seed() {
    const rnd = rng(20261117);
    const now = Date.now();
    const agoH = h => new Date(now - h * 36e5).toISOString();
    const d = n => addDays(TODAY_ISO, n);
    const X = { deletedAt: null, deletedBy: null };
    db = { version: SCHEMA, seq: 5000, createdAt: nowISO(), settings: defaultSettings(), alertKeys: {}, lastChange: null };
    TYPES.forEach(t => db[t] = []);
    const P = [
      ['prj-1', 'سدايم', 48500000, 15.96], ['prj-2', 'المدينة', 36200000, 8.4], ['prj-3', 'روشن', 22750000, 2.1],
      ['prj-4', 'السدن', 18400000, -1.2], ['prj-5', 'المهندية', 12900000, -3.5], ['prj-6', 'الرسين', 9600000, 0], ['prj-7', 'سدن', 0, 0],
    ];
    P.forEach(([id, name, contractValue, budgetDelayPct]) => db.projects.push(Object.assign({ id, name, contractValue, budgetDelayPct }, X)));

    // [id, account, name, projects, term, n, mode, lag, due7, phone, importId]
    const S = [
      ['sup-1', '2110041', 'مؤسسة الريان للحديد', ['prj-1'], 60, 8, 'late', 3, false, '0551234801', 'imp-3'],
      ['sup-2', '2110017', 'شركة البناء الحديث للخرسانة', ['prj-2', 'prj-1'], 45, 9, 'late', 2, true, '0551234802', 'imp-1'],
      ['sup-3', '2110088', 'مصنع الخليج للبلوك', ['prj-4'], 30, 5, 'clean', 0, true, '0551234803', null],
      ['sup-4', '2110102', 'مؤسسة الأفق للكهرباء', ['prj-3'], 60, 6, 'late', 1, true, '0551234804', 'imp-4'],
      ['sup-5', '2110063', 'شركة النخبة للعزل', ['prj-1'], 90, 4, 'clean', 0, false, '0551234805', null],
      ['sup-6', '2110029', 'مؤسسة الواحة للسباكة', ['prj-5'], 30, 6, 'late', 2, false, '0551234806', null],
      ['sup-7', '2110115', 'شركة المسار لتأجير المعدات', ['prj-2'], 45, 7, 'late', 2, true, '0551234807', 'imp-5'],
      ['sup-8', '2110074', 'مصنع الصفا للدهانات', ['prj-3', 'prj-6'], null, 5, 'clean', 0, true, '0551234808', null],
      ['sup-9', '2110131', 'مؤسسة الرمال للتوريدات العامة', ['prj-6', 'prj-7'], 30, 5, 'late', 1, false, '0551234809', null],
      ['sup-10', '2110146', 'شركة الوادي للأخشاب', ['prj-4'], 45, 5, 'clean', 0, false, '0551234810', null],
    ];
    let invNo = 4100, payNo = 880, idn = 1;
    S.forEach(([id, account, name, projectIds, termDays, n, mode, lag, due7, phone, importId], si) => {
      db.suppliers.push(Object.assign({ id, account, name, projectIds, termDays, phone, notes: '' }, X));
      const term = termDays == null ? 60 : termDays;
      const dates = [];
      for (let i = 0; i < n; i++) dates.push(Math.min(-4, Math.round(-262 + i * (258 / (n - 1)) + (rnd() * 10 - 5))));
      if (due7) dates[n - 1] = -term + 2 + (si % 4);
      dates.sort((a, b) => a - b);
      const invs = dates.map((off, i) => ({
        id: 'inv-' + (idn++), supplierId: id, no: 'ف-' + (invNo += 7 + Math.floor(rnd() * 20)), date: d(off),
        amount: R(H(Math.round((12000 + rnd() * 168000) * 100) / 100)), projectId: projectIds[i % projectIds.length], importId,
      }));
      invs.forEach(v => db.invoices.push(Object.assign(v, X)));
      const dueIdx = invs.filter(v => fromToday(addDays(v.date, term)) < 0).length;
      const k = mode === 'clean' ? dueIdx : Math.max(0, dueIdx - lag);
      let totalH = invs.slice(0, k).reduce((a, v) => a + H(v.amount), 0);
      if (mode === 'late' && k < invs.length) totalH += Math.round(H(invs[k].amount) * 0.4);
      if (totalH <= 0) return;
      const p = n >= 7 ? 3 : 2;
      const lo = fromToday(invs[0].date) + 25, hi = -6;
      let left = totalH;
      for (let j = 0; j < p; j++) {
        const amt = j === p - 1 ? left : Math.round(totalH / p / 100000) * 100000;
        left -= amt;
        db.payments.push(Object.assign({ id: 'pay-' + (idn++), supplierId: id, date: d(Math.round(lo + (j + 1) * (hi - lo) / p)), amount: R(amt), doc: 'س-' + (payNo += 3 + Math.floor(rnd() * 9)), importId }, X));
      }
    });
    // مورد محذوف (في المحذوفات) مع فواتيره
    db.suppliers.push({ id: 'sup-11', account: '2110152', name: 'مؤسسة الندى للتوريدات', projectIds: ['prj-3'], termDays: 30, phone: '', notes: '', deletedAt: agoH(48), deletedBy: null });
    [[-120, 9400], [-96, 11250.5], [-61, 8750], [-33, 8999.5]].forEach(([off, amount], i) => db.invoices.push({ id: 'inv-' + (idn++), supplierId: 'sup-11', no: 'ن-' + (310 + i), date: d(off), amount, projectId: 'prj-3', importId: null, deletedAt: agoH(48), deletedBy: 'suppliers:sup-11' }));

    // المقاولون
    const C = [
      ['con-1', '21201020', 'مؤسسة الصرح للمقاولات — الهيكل', ['prj-1'], 30, 0.10, 'active', ''],
      ['con-2', '21201044', 'شركة الإتقان للتشطيبات', ['prj-2'], 45, 0.05, 'active', ''],
      ['con-3', '21201007', 'مؤسسة النور للأعمال الكهربائية', ['prj-3'], null, 0.05, 'paused', 'متوقف بانتظار اعتماد المخططات'],
      ['con-4', '21201091', 'شركة الواجهات الحديثة', ['prj-4'], 30, 0.10, 'active', ''],
      ['con-5', '21201012', 'مؤسسة الأرض للحفر', ['prj-5'], null, 0.05, 'finished', 'انتهت الأعمال — بانتظار التسوية النهائية'],
      ['con-6', '21201066', 'شركة المتين للعزل المائي', ['prj-1'], 60, 0.10, 'disputed', 'خلاف على كميات المستخلص رقم 2'],
    ];
    C.forEach(([id, code, name, projectIds, termDays, retentionRate, status, statusNote]) => db.contractors.push(Object.assign({ id, code, name, projectIds, termDays, retentionRate, status, statusNote }, X)));
    let ceN = 1, docN = 700;
    const E = (cid, date, description, debit, credit, importId) => {
      const c = db.contractors.find(x => x.id === cid);
      db.contractorEntries.push(Object.assign({ id: 'ce-' + (ceN++), contractorId: cid, date, kind: classify(description), claimNo: claimNoOf(description), debit, credit, description, projectId: c.projectIds[0], importId: importId || null, doc: 'ق-' + (docN += 3) }, X));
    };
    const claimSet = (cid, rate, list, imp) => list.forEach(([no, date, amt, label]) => { E(cid, date, 'مستخلص رقم ' + no + ' — ' + label, 0, amt, imp); E(cid, date, 'تأمين محتجز ' + Math.round(rate * 100) + '% — م' + no, Math.round(amt * rate), 0, imp); });
    E('con-1', '2026-02-20', 'رصيد افتتاحي', 0, 400000, 'imp-2');
    claimSet('con-1', 0.10, [[1, '2026-03-25', 620000, 'أعمال الهيكل'], [2, '2026-05-05', 540000, 'أعمال الهيكل'], [3, '2026-06-20', 710000, 'أعمال الهيكل'], [4, '2026-08-10', 480000, 'أعمال الهيكل'], [5, '2026-09-25', 520000, 'أعمال الهيكل'], [6, '2026-11-05', 390000, 'أعمال الهيكل']], 'imp-2');
    [['2026-04-10', 400000], ['2026-05-20', 500000], ['2026-07-15', 600000], ['2026-09-01', 450000], ['2026-10-20', 300000]].forEach(([dt, a]) => E('con-1', dt, 'دفعة تحت الحساب', a, 0, 'imp-2'));
    claimSet('con-2', 0.05, [[1, '2026-04-15', 300000, 'تشطيبات المدينة'], [2, '2026-06-15', 420000, 'تشطيبات المدينة'], [3, '2026-08-20', 380000, 'تشطيبات المدينة'], [4, '2026-10-28', 260000, 'تشطيبات المدينة']]);
    [['2026-05-30', 285000], ['2026-08-01', 399000], ['2026-10-10', 361000]].forEach(([dt, a]) => E('con-2', dt, 'سداد دفعة', a, 0));
    E('con-3', '2026-02-20', 'رصيد افتتاحي', 0, 120000);
    claimSet('con-3', 0.05, [[1, '2026-04-01', 260000, 'كهرباء روشن'], [2, '2026-07-01', 310000, 'كهرباء روشن'], [3, '2026-10-05', 230000, 'كهرباء روشن']]);
    E('con-3', '2026-05-15', 'دفعة من المستحقات', 200000, 0);
    E('con-3', '2026-07-20', 'فاتورة مواد محملة على المقاول', 8500, 0);
    E('con-3', '2026-08-30', 'دفعة تحت الحساب', 150000, 0);
    claimSet('con-4', 0.10, [[1, '2026-07-01', 250000, 'واجهات السدن'], [2, '2026-09-10', 210000, 'واجهات السدن'], [3, '2026-10-20', 180000, 'واجهات السدن']]);
    E('con-4', '2026-08-15', 'دفعة أولى', 225000, 0);
    E('con-4', '2026-09-30', 'خصم غرامة تأخير توريد', 12000, 0);
    E('con-5', '2026-02-20', 'رصيد افتتاحي', 0, 95600);
    claimSet('con-5', 0.05, [[1, '2026-03-15', 140000, 'حفر المهندية']]);
    E('con-5', '2026-04-30', 'سداد المستخلص الأول', 133000, 0);
    claimSet('con-6', 0.10, [[1, '2026-05-10', 180000, 'عزل سدايم'], [2, '2026-07-20', 240000, 'عزل سدايم']]);
    E('con-6', '2026-07-01', 'دفعة تحت الحساب', 162000, 0);

    // الضمانات
    [['gua-1', 'con-1', 'prj-1', 'ضمان أداء', 520000, '2025-11-22', d(5), null],
     ['gua-2', 'con-2', 'prj-2', 'ضمان محتجزات', 184600, '2026-04-01', d(41), null],
     ['gua-3', 'con-4', 'prj-4', 'ضمان دفعة مقدّمة', 96000, '2026-03-08', d(-9), null],
     ['gua-4', 'con-3', 'prj-3', 'ضمان محتجزات', 61200, '2026-03-25', d(128), null],
     ['gua-5', 'con-6', 'prj-1', 'ضمان ابتدائي', 45000, '2026-02-01', '2026-08-30', '2026-09-05'],
    ].forEach(([id, contractorId, projectId, type, amount, issueDate, expiryDate, returnedAt]) => db.guarantees.push(Object.assign({ id, contractorId, projectId, type, amount, issueDate, expiryDate, returnedAt }, X)));

    // التحصيلات
    [['rec-1', 'prj-1', 'المالك — سدايم', 'م-14', 1240000, d(4), 'approved', null],
     ['rec-2', 'prj-3', 'المالك — روشن', 'دفعة مقدّمة', 610000, d(21), 'approved', null],
     ['rec-3', 'prj-2', 'المالك — المدينة', 'م-9', 875400, d(-18), 'approved', null],
     ['rec-4', 'prj-4', 'المالك — السدن', 'م-3', 322000, d(37), 'pending', null],
     ['rec-5', 'prj-5', 'المالك — المهندية', 'م-6', 455000, d(12), 'pending', null],
     ['rec-6', 'prj-6', 'المالك — الرسين', 'م-2', 298500, d(-30), 'collected', d(-26)],
    ].forEach(([id, projectId, from, docNo, amount, dueDate, status, collectedAt]) => db.receivables.push(Object.assign({ id, projectId, from, docNo, amount, dueDate, status, collectedAt }, X)));

    // الموازنة: ٨ أشهر لمشروعين
    const months = ['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const B = { 'prj-1': [[3.2, 3.0], [3.6, 3.1], [3.6, 2.9], [3.7, 3.2], [3.9, 3.2], [3.6, 2.9], [3.4, 2.9], [3.6, 2.8]], 'prj-2': [[2.1, 2.0], [2.4, 2.3], [2.6, 2.4], [2.5, 2.5], [2.7, 2.4], [2.6, 2.6], [2.4, 2.2], [2.5, 2.3]] };
    let bn = 1;
    Object.keys(B).forEach(pid => B[pid].forEach(([pl, ac], i) => db.budgetMonths.push(Object.assign({ id: 'bud-' + (bn++), projectId: pid, month: months[i], planned: Math.round(pl * 1e6 + rnd() * 40000), actual: Math.round(ac * 1e6 + rnd() * 40000), docNo: 'مو-' + (40 + bn) }, X))));
    db.budgetMonths.push({ id: 'bud-' + (bn++), projectId: 'prj-1', month: '2026-02', planned: 2800000, actual: 2710000, docNo: 'مو-39', deletedAt: agoH(264), deletedBy: null });

    // الاستيرادات السابقة
    const cnt = (sid) => db.invoices.filter(i => i.supplierId === sid).length + db.payments.filter(p => p.supplierId === sid).length;
    [['imp-1', 2, 'كشف البناء الحديث.csv', 'supplier', 'supplier', 'sup-2', 3, cnt('sup-2') - 3, 'ok', null],
     ['imp-2', 26, 'مديونيات المقاولين.csv', 'contractor', 'contractor', 'con-1', 2, db.contractorEntries.filter(e => e.contractorId === 'con-1').length - 2, 'ok', null],
     ['imp-3', 6 * 24, 'كشف الريان.csv', 'supplier', 'supplier', 'sup-1', 1, cnt('sup-1') - 1, 'ok', null],
     ['imp-4', 34 * 24, 'كشف الأفق.csv', 'supplier', 'supplier', 'sup-4', 2, cnt('sup-4') - 2, 'ok', null],
     ['imp-5', 71 * 24, 'كشف المسار.csv', 'supplier', 'supplier', 'sup-7', 4, cnt('sup-7') - 4, 'ok', null],
     ['imp-6', 12 * 24, 'كشف مجهول.csv', 'unknown', null, null, 0, 0, 'failed', 'أعمدة ناقصة: الحساب — المتوقع: الحساب، الاسم، التاريخ، المستند، البيان، مدين، دائن'],
    ].forEach(([id, h, file, kind, partyType, partyId, added, matched, status, error]) => db.imports.push(Object.assign({ id, at: agoH(h), file, kind, partyType, partyId, added, matched, status, error, snapshotBefore: null }, X)));

    // رصيد البنك: موجب طوال ٣٠ يوماً بهامش، فيُظهر زر «عجز نقدي» الحالة S4 حين يخفضه
    db.settings.bankBalance = 0; cache.clear();
    const minNet = Math.min(0, ...cashProjection(30).map(p => p.balance));
    db.settings.bankBalance = Math.ceil((-minNet + 735000) / 1000) * 1000;
    cache.clear();

    // مفاتيح التنبيهات للحالة الابتدائية (حتى لا تتكرر إشعارات البذرة)
    db.alertKeys['g7:gua-1'] = 1;
    db.contractors.forEach(c => { const p = contractorPosition(c.id); if (p.termDays != null) p.claims.forEach(cl => { if (cl.lateDays > 0) db.alertKeys['cl:' + cl.id] = 1; }); });

    // الإشعارات
    const worst = db.suppliers.filter(s => !s.deletedAt).map(s => supplierPosition(s.id)).sort((a, b) => b.overdue - a.overdue)[0];
    const c1 = contractorPosition('con-1'); const lateClaim = c1.claims.filter(c => c.lateDays > 0).sort((a, b) => b.lateDays - a.lateDays)[0];
    const N = (h, o) => db.notes.push(Object.assign({ id: 'note-' + (db.notes.length + 1), at: agoH(h), link: null, read: false, archived: false, kind: null }, o, X));
    N(0.7, { sev: 'd', kind: 'overdue', title: 'متأخر جديد: ' + worst.supplier.name, detail: worst.overdueCount + ' فواتير متأخرة · ' + fmtPlain(worst.overdue) + ' ر.س · أقدمها ' + worst.oldestDays + ' يوماً', link: { view: 'supplier', params: { id: worst.supplier.id } } });
    N(3, { sev: 'w', kind: 'guarantee', title: 'ضمان ينتهي خلال 5 أيام', detail: 'ضمان أداء — مؤسسة الصرح للمقاولات · سدايم · ' + dateAr(d(5)), link: { view: 'guarantees', params: { id: 'gua-1' } } });
    N(5, { sev: 'd', kind: 'claim', title: 'مستخلص متأخر ' + lateClaim.lateDays + ' يوماً', detail: c1.contractor.name + ' · مستخلص ' + lateClaim.claimNo + ' · ' + fmtPlain(lateClaim.remaining) + ' ر.س', link: { view: 'contractor', params: { id: 'con-1' } } });
    N(2, { sev: 'i', kind: 'import', read: true, title: 'اكتمل استيراد «كشف البناء الحديث.csv»', detail: '3 حركات جديدة · مطابقة الباقي', link: { view: 'import', params: { id: 'imp-1' } } });
    N(27, { sev: 'o', kind: 'backup', read: true, title: 'اكتملت النسخة الاحتياطية اليومية', detail: 'محفوظة في المتصفح', link: { view: 'backups', params: {} } });
    N(30, { sev: 'i', kind: 'other', read: true, archived: true, title: 'مرحباً بك في أرخبيل', detail: 'بيانات مثال — كل الأسماء والأرقام وهمية', link: null });

    // النسخ الاحتياطية
    const snap = snapshot(), json = JSON.stringify(snap), kb = Math.round(byteLen(json) / 1024 * 10) / 10;
    [['bak-1', 3, 'daily'], ['bak-2', 26.5, 'before-import'], ['bak-3', 27, 'daily'], ['bak-4', 29, 'manual']]
      .forEach(([id, h, kind]) => db.backups.push({ id, at: agoH(h), kind, sizeKb: kb, data: clone(snap), deletedAt: null, deletedBy: null }));
    db.imports.find(i => i.id === 'imp-2').snapshotBefore = 'bak-2';
    cache.clear();
    return db;
  }

  function reset() {
    seed(); api.db = db; save();
    emit('change', { type: '*', op: 'reset' });
    emit('note', null);
    return db;
  }

  /* ═══ الواجهة ═══ */
  const api = {
    TODAY, TODAY_ISO, KEY, SCHEMA,
    get db() { return db; }, set db(v) { db = v; },
    get persistent() { return persistent; },
    list, get, create, update, remove, restore, purge, trash,
    settings: () => db.settings, setSettings,
    supplierPosition, contractorPosition, totals, projectPosition, cashProjection, dueList, calendar, staleness,
    on, off, emit,
    notify, checkAlerts, markAllRead, unreadCount,
    parseCSV, previewCSV, commitImport, importCSV, revertImport, sampleCSV, toCSV,
    backup, restoreBackup, deleteBackup, dailyIfDue,
    mergeProjects, projectMergeSuggestions,
    reset,
    util: { iso, parseISO, addDays, diffDays, fromToday, daysSince, H, R, normAr, classify, claimNoOf, parseNum, parseDate, fmtPlain, dateAr, displayName, MONTHS: AR_MONTHS },
  };
  EGCO.store = api;

  db = load();
  if (!db) { seed(); save(); }
})(typeof window !== 'undefined' ? window : globalThis);
