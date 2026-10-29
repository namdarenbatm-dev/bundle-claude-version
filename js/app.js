/* Techno Bundle v10 — UI layer. All business rules live in core.js. */
(function () {
  'use strict';

  var C = window.TechnoCore;
  var SPLASH_MS = 5000;
  var PAGE = 200; // rows rendered at once; all bundles are still generated, published and exported
  // Storage is namespaced by the deployment path so two apps on one origin (user.github.io/a/, /b/) never share data.
  var SCOPE = (function () { try { return location.pathname.replace(/[^\/]*$/, ''); } catch (e) { return '/'; } })();
  var KEY = 'technoBundle10:' + SCOPE + ':';

  /* ---------- storage (always wrapped: it can throw or come back empty) ---------- */
  var store = {
    get: function (k) { try { var v = localStorage.getItem(KEY + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(KEY + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(KEY + k); } catch (e) { /* ignore */ } },
    clear: function () {
      try {
        Object.keys(localStorage).forEach(function (k) { if (k.indexOf(KEY) === 0) localStorage.removeItem(k); });
      } catch (e) { /* ignore */ }
    }
  };

  var $ = function (id) { return document.getElementById(id); };
  var fmt = C.formatNumber;
  var toman = C.formatToman;

  var ICON_UP = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var ICON_DOWN = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  var PRIO_LABEL = {
    posQty: ['تعداد کارتخوان نو', 'بیشتر بهتر است'],
    posPrice: ['قیمت هر کارتخوان', 'کمتر بهتر است'],
    driverQty: ['تعداد محصول محرک', 'کمتر بهتر است'],
    total: ['مبلغ کل باندل', 'کمتر بهتر است'],
    remaining: ['بودجه باقی‌مانده', 'بیشتر بهتر است']
  };

  function driverName(type) { return type === 'used' ? 'کارتخوان دست‌دوم' : 'کش‌لس'; }

  /* ---------- state ---------- */
  var state = {
    raw: {},
    priorities: C.DEFAULT_PRIORITIES.slice(),
    published: {},
    brokerBudget: '',
    offer: null,       // decoded offer imported from a link
    offerEnc: null,
    tab: 'admin',
    limit: PAGE
  };
  var view = { settings: null, errors: [], bundles: [] };

  function defaultRaw() {
    var r = { driverType: C.DEFAULT_SETTINGS.driverType };
    C.FIELDS.forEach(function (f) { r[f] = fmt(C.DEFAULT_SETTINGS[f]); });
    return r;
  }

  function loadState() {
    state.raw = defaultRaw();
    var saved = store.get('settings');
    if (saved && typeof saved === 'object') {
      C.FIELDS.forEach(function (f) { if (typeof saved[f] === 'string' && saved[f].length < 24) state.raw[f] = saved[f]; });
      if (saved.driverType === 'used' || saved.driverType === 'cashless') state.raw.driverType = saved.driverType;
    }
    state.priorities = C.sanitizePriorities(store.get('priorities'));
    var pub = store.get('published');
    state.published = {};
    if (pub && typeof pub === 'object') {
      Object.keys(pub).forEach(function (k) { if (pub[k] === true && /^\d+x\d+@\d+@\d+$/.test(k)) state.published[k] = true; });
    }
    var bb = store.get('brokerBudget');
    state.brokerBudget = typeof bb === 'string' ? bb.slice(0, 24) : '';
    var enc = store.get('offer');
    if (typeof enc === 'string') applyOffer(enc, true);
    var tab = store.get('tab');
    state.tab = tab === 'broker' ? 'broker' : 'admin';
    if (state.offer) state.tab = 'broker';
  }

  function applyOffer(enc, quiet) {
    var d = C.decodeOffer(enc);
    if (!d.ok) { if (!quiet) toast(d.error); return false; }
    state.offer = d;
    state.offerEnc = enc;
    store.set('offer', enc);
    document.body.classList.add('broker-mode');
    return true;
  }

  function persistSettings() { store.set('settings', state.raw); }

  /* ---------- derived data ---------- */
  function pubKey(b) { return b.id + '@' + b.posPrice + '@' + b.driverPrice; }
  function isPublished(b) { return state.published[pubKey(b)] === true; }

  function compute() {
    var parsed = C.parseSettings(state.raw);
    var errs = parsed.errors.slice();
    view.settings = null;
    view.bundles = [];
    if (!errs.length) {
      errs = C.validateSettings(parsed.values);
      if (!errs.length) {
        view.settings = parsed.values;
        view.bundles = C.rankBundles(C.generateBundles(parsed.values), state.priorities);
      }
    }
    view.errors = errs;
  }

  /* ---------- toast / dialogs ---------- */
  var toastTimer;
  function toast(msg, action) {
    var el = $('toast');
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = msg;
    el.appendChild(span);
    if (action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.addEventListener('click', function () { el.hidden = true; action.run(); });
      el.appendChild(b);
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, action ? 12000 : 3500);
  }

  function openDialog(d) { if (typeof d.showModal === 'function') d.showModal(); else d.setAttribute('open', ''); }
  function closeDialog(d) { if (typeof d.close === 'function') d.close(); else d.removeAttribute('open'); }

  function confirmAction(title, message, okLabel) {
    var d = $('confirmDialog');
    if (typeof d.showModal !== 'function') return Promise.resolve(window.confirm(title + '\n' + message));
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    $('confirmOk').textContent = okLabel || 'تأیید';
    return new Promise(function (resolve) {
      function done() { d.removeEventListener('close', done); resolve(d.returnValue === 'ok'); }
      d.returnValue = 'cancel';
      d.addEventListener('close', done);
      d.showModal();
    });
  }

  /* ---------- settings form ---------- */
  var GROUPS = [
    { title: 'کارتخوان نو', fields: ['posBase', 'posFloor', 'marketing'], units: { posBase: 'تومان', posFloor: 'تومان', marketing: 'تومان' } },
    { title: 'محصول محرک', select: true, fields: ['driverCost', 'driverPrice', 'driverProfit'], units: { driverCost: 'تومان', driverPrice: 'تومان', driverProfit: 'تومان' } },
    { title: 'محدودیت‌ها', fields: ['maxPos', 'maxDriver', 'maxUpgrade'], units: { maxPos: 'عدد', maxDriver: 'عدد', maxUpgrade: 'تومان' } }
  ];

  function renderSettingsForm() {
    var html = '';
    GROUPS.forEach(function (g, gi) {
      html += '<div class="group" role="group" aria-labelledby="grp-' + gi + '"><h3 id="grp-' + gi + '">' + g.title + '</h3>';
      if (g.select) {
        html += '<div class="field"><label for="f-driverType">نوع محصول محرک</label>' +
          '<select id="f-driverType" name="driverType">' +
          '<option value="cashless">کش‌لس</option><option value="used">کارتخوان دست‌دوم</option></select></div>';
      }
      g.fields.forEach(function (f) {
        html += '<div class="field" id="field-' + f + '"><label for="f-' + f + '">' + C.FIELD_LABELS[f] + '</label>' +
          '<div class="input-wrap"><input id="f-' + f + '" name="' + f + '" type="text" inputmode="numeric" dir="rtl" autocomplete="off" aria-describedby="e-' + f + '">' +
          '<span class="unit">' + g.units[f] + '</span></div><div class="err" id="e-' + f + '"></div></div>';
      });
      html += '</div>';
    });
    $('settingsForm').innerHTML = html;
    syncFormFromState();
  }

  function syncFormFromState() {
    C.FIELDS.forEach(function (f) { $('f-' + f).value = state.raw[f]; });
    $('f-driverType').value = state.raw.driverType;
  }

  function showFieldErrors() {
    C.FIELDS.forEach(function (f) {
      $('e-' + f).textContent = '';
      $('field-' + f).classList.remove('has-error');
      $('f-' + f).removeAttribute('aria-invalid');
    });
    view.errors.forEach(function (e) {
      if (!$('e-' + e.field)) return;
      var box = $('e-' + e.field);
      box.textContent = box.textContent ? box.textContent + ' ' + e.message : e.message;
      $('field-' + e.field).classList.add('has-error');
      $('f-' + e.field).setAttribute('aria-invalid', 'true');
    });
    var top = $('settingsErrors');
    if (view.errors.length) {
      top.hidden = false;
      top.textContent = 'تنظیمات نامعتبر است؛ تا اصلاح آن، باندلی ساخته نمی‌شود (' + fmt(view.errors.length) + ' مورد).';
    } else top.hidden = true;
  }

  function renderDerived() {
    var s = view.settings;
    var el = $('derived');
    if (!s) { el.innerHTML = '<div><dt>سهم هر محصول محرک</dt><dd>—</dd></div>'; return; }
    el.innerHTML =
      '<div><dt>سهم هر ' + driverName(s.driverType) + ' (قیمت − بها − سود ثابت)</dt><dd>' + toman(C.driverContribution(s)) + '</dd></div>' +
      '<div><dt>حداکثر تخفیف هر کارتخوان (پایه − کف)</dt><dd>' + toman(s.posBase - s.posFloor) + '</dd></div>';
  }

  /* ---------- priorities ---------- */
  function renderPriorities() {
    var html = '';
    state.priorities.forEach(function (k, i) {
      html += '<li><span class="n">' + fmt(i + 1) + '</span><span>' + PRIO_LABEL[k][0] + ' <span class="dir">· ' + PRIO_LABEL[k][1] + '</span></span>' +
        '<button type="button" class="icon-btn" data-move="-1" data-i="' + i + '" aria-label="بالاتر بردن ' + PRIO_LABEL[k][0] + '"' + (i === 0 ? ' disabled' : '') + '>' + ICON_UP + '</button>' +
        '<button type="button" class="icon-btn" data-move="1" data-i="' + i + '" aria-label="پایین‌تر بردن ' + PRIO_LABEL[k][0] + '"' + (i === state.priorities.length - 1 ? ' disabled' : '') + '>' + ICON_DOWN + '</button></li>';
    });
    $('prioList').innerHTML = html;
  }

  /* ---------- bundle table ---------- */
  function renderTable() {
    var s = view.settings;
    var rows = view.bundles;
    $('thDriver').textContent = s ? driverName(s.driverType) : 'محصول محرک';
    var html = '';
    var shown = rows.slice(0, state.limit);
    shown.forEach(function (b, i) {
      var pub = isPublished(b);
      html += '<tr data-id="' + b.id + '"' + (pub ? ' class="is-published"' : '') + '>' +
        '<td>' + fmt(i + 1) + '</td>' +
        '<td>' + fmt(b.posQty) + '</td><td>' + fmt(b.driverQty) + '</td>' +
        '<td class="num">' + toman(b.posPrice) + (b.atFloor ? '<span class="cap">کف</span>' : '') + '</td>' +
        '<td class="num">' + toman(b.discountPerPos) + '</td>' +
        '<td class="num">' + toman(b.total) + '</td>' +
        '<td class="num">' + toman(b.remaining) + '</td>' +
        '<td><div class="status-cell">' +
        '<button type="button" class="switch" role="switch" aria-checked="' + pub + '" data-act="toggle" aria-label="انتشار باندل ' + fmt(b.posQty) + ' به ' + fmt(b.driverQty) + '">' + (pub ? 'منتشر شده' : 'منتشر نشده') + '</button>' +
        '<span class="print-only">' + (pub ? 'منتشر شده' : 'منتشر نشده') + '</span>' +
        '<button type="button" class="btn btn-sm" data-act="details">جزئیات</button></div></td></tr>';
    });
    $('bundleRows').innerHTML = html;

    var pubCount = rows.filter(isPublished).length;
    $('tblSummary').textContent = s ? fmt(rows.length) + ' باندل معتبر · ' + fmt(pubCount) + ' منتشر شده' +
      (shown.length < rows.length ? ' · ' + fmt(shown.length) + ' مورد اول نمایش داده می‌شود' : '') : '';
    var more = $('moreBtn');
    if (shown.length < rows.length) {
      more.hidden = false;
      more.textContent = 'نمایش ' + fmt(Math.min(PAGE, rows.length - shown.length)) + ' مورد بعدی (از ' + fmt(rows.length - shown.length) + ' مورد باقی‌مانده)';
    } else more.hidden = true;
    var empty = $('emptyState');
    if (!s) { empty.hidden = false; empty.textContent = 'ابتدا خطاهای تنظیمات را اصلاح کنید تا باندل‌ها ساخته شوند.'; }
    else if (!rows.length) { empty.hidden = false; empty.textContent = 'با این تنظیمات هیچ باندل معتبری وجود ندارد. بودجه بازاریابی را کمتر یا سهم محصول محرک را بیشتر کنید.'; }
    else empty.hidden = true;

    var valid = {};
    rows.forEach(function (b) { valid[pubKey(b)] = true; });
    var stale = Object.keys(state.published).filter(function (k) { return !valid[k]; }).length;
    var note = $('staleNote');
    if (s && stale) {
      note.hidden = false;
      note.textContent = fmt(stale) + ' باندل که قبلاً منتشر شده بود، با قیمت‌های فعلی تطابق ندارد و منتشر محسوب نمی‌شود. اگر مقدارها را به حالت قبل برگردانید دوباره فعال می‌شود.';
    } else note.hidden = true;

    ['pubAllBtn', 'unpubAllBtn', 'csvBtn', 'shareBtn'].forEach(function (id) { $(id).disabled = !rows.length; });
  }

  function findBundle(id) { return view.bundles.filter(function (b) { return b.id === id; })[0]; }

  /* ---------- details modal ---------- */
  function row(label, value, hint, cls) {
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + label + (hint ? '<small>' + hint + '</small>' : '') + '</td><td>' + value + '</td></tr>';
  }

  function openDetails(id) {
    var b = findBundle(id), s = view.settings;
    if (!b || !s) return;
    var dn = driverName(s.driverType);
    $('detailsTitle').textContent = fmt(b.posQty) + ' کارتخوان نو + ' + fmt(b.driverQty) + ' ' + dn;

    var span = s.posBase;
    var pricePct = Math.max(0, Math.min(100, (b.posPrice / span) * 100));
    var floorPct = Math.max(0, Math.min(100, (s.posFloor / span) * 100));

    var html =
      '<div class="ladder" aria-hidden="true"><div class="ladder-track"><div class="ladder-fill" style="width:' + pricePct.toFixed(2) + '%"></div>' +
      '<div class="ladder-floor" style="inset-inline-start:calc(' + floorPct.toFixed(2) + '% - 1px)"></div></div>' +
      '<div class="ladder-legend"><span>قیمت در باندل: ' + toman(b.posPrice) + '</span><span>کف رقابتی: ' + toman(s.posFloor) + '</span><span>قیمت پایه: ' + toman(s.posBase) + '</span></div></div>' +
      '<table class="detail-table"><tbody>' +
      row('سهم هر ' + dn, toman(b.contribution), 'قیمت فروش ' + toman(s.driverPrice) + ' − بها ' + toman(s.driverCost) + ' − سود ثابت ' + toman(s.driverProfit)) +
      row('سهم کل محصول محرک', toman(b.driverContributionTotal), fmt(b.driverQty) + ' × ' + toman(b.contribution)) +
      row('ذخیره بازاریابی (تخصیص جداگانه)', toman(b.reserve), fmt(b.posQty) + ' × ' + toman(s.marketing) + ' — تخفیف مستقیم نیست و از قیمت باندل کم نمی‌شود') +
      row('بودجه تخفیف خالص کارتخوان', toman(b.budget), 'سهم کل − ذخیره بازاریابی') +
      row('تخفیف هر کارتخوان', toman(b.discountPerPos), b.atFloor ? 'به کف رقابتی رسیده؛ مابقی بودجه باقی می‌ماند' : 'گرد‌شده به پایین تا عدد صحیح') +
      row('تخفیف کل کارتخوان', toman(b.totalDiscount)) +
      row('بودجه باقی‌مانده', toman(b.remaining)) +
      row('قیمت هر کارتخوان در باندل', toman(b.posPrice), 'قیمت پایه ' + toman(s.posBase) + ' − تخفیف هر کارتخوان') +
      row('جمع کارتخوان‌ها', toman(b.posSubtotal), fmt(b.posQty) + ' × ' + toman(b.posPrice)) +
      row('جمع ' + dn, toman(b.driverSubtotal), fmt(b.driverQty) + ' × ' + toman(b.driverPrice)) +
      row('مبلغ کل باندل', toman(b.total), '', 'sum') +
      '</tbody></table>' +
      '<ul class="checks">' +
      '<li>قیمت کارتخوان (' + toman(b.posPrice) + ') کمتر از کف رقابتی نیست.</li>' +
      '<li>تخفیف کل از بودجه تخفیف خالص بیشتر نیست.</li>' +
      '<li>تعداد کارتخوان (' + fmt(b.posQty) + ') از تعداد ' + dn + ' (' + fmt(b.driverQty) + ') بیشتر است.</li>' +
      '<li>ذخیره بازاریابی یک‌بار و جدا از تخفیف کسر شده است.</li></ul>';
    $('detailsBody').innerHTML = html;
    openDialog($('detailsDialog'));
  }

  /* ---------- broker view ---------- */
  function brokerSource() {
    if (state.offer) {
      return { bundles: state.offer.bundles, cap: state.offer.offer.cap, type: state.offer.offer.t, base: state.offer.offer.pb, fromOffer: true };
    }
    if (view.settings) {
      return { bundles: view.bundles.filter(isPublished), cap: view.settings.maxUpgrade, type: view.settings.driverType, base: view.settings.posBase, fromOffer: false };
    }
    return { bundles: [], cap: 0, type: 'cashless', base: 0, fromOffer: false };
  }

  function offerCard(kind, b, src, extra) {
    var dn = driverName(src.type);
    var saving = src.base > b.posPrice ? src.base - b.posPrice : 0;
    var tag = kind === 'main' ? 'پیشنهاد اصلی' : (extra && extra.fallback ? 'نزدیک‌ترین گزینه' : 'ارتقای پیشنهادی');
    var h = '<article class="offer ' + kind + '"><span class="tag">' + tag + '</span>' +
      '<h3>' + fmt(b.posQty) + ' کارتخوان نو + ' + fmt(b.driverQty) + ' ' + dn + '</h3><dl class="lines">' +
      '<div><dt>قیمت هر کارتخوان</dt><dd>' + (saving ? '<del>' + toman(src.base) + '</del>' : '') + toman(b.posPrice) + '</dd></div>' +
      '<div><dt>قیمت هر ' + dn + '</dt><dd>' + toman(b.driverPrice) + '</dd></div>' +
      '<div><dt>جمع کارتخوان‌ها</dt><dd>' + toman(b.posSubtotal) + '</dd></div>' +
      '<div><dt>جمع ' + dn + '</dt><dd>' + toman(b.driverSubtotal) + '</dd></div></dl>';
    if (saving) h += '<p class="keep">صرفه‌جویی هر کارتخوان نسبت به قیمت پایه: ' + toman(saving) + '</p>';
    h += '<div class="total"><span>مبلغ کل باندل</span><strong>' + toman(b.total) + '</strong></div>';
    if (extra && extra.keep !== undefined) h += '<p class="keep">از بودجه شما ' + toman(extra.keep) + ' باقی می‌ماند.</p>';
    if (extra && extra.pay) {
      h += '<p class="delta">پرداخت اضافه نسبت به بودجه شما: ' + toman(extra.pay) + '</p>';
      if (extra.overMain) h += '<p class="muted">اختلاف با پیشنهاد اصلی: ' + toman(extra.overMain) + '</p>';
    }
    return h + '</article>';
  }

  function issuedText() {
    var o = state.offer && state.offer.offer;
    if (!o || o.i === undefined) return '';
    try { return ' · تاریخ صدور پیشنهاد: ' + new Intl.DateTimeFormat('fa-IR', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(o.i * 86400000)); }
    catch (e) { return ''; }
  }

  function renderBroker() {
    var src = brokerSource();
    var out = $('brokerResult');
    var hint = $('brokerHint');
    $('offerClear').hidden = !state.offer;
    var budget = C.parseAmount(state.brokerBudget);

    if (!src.bundles.length) {
      hint.textContent = '';
      out.innerHTML = '<p class="empty">هنوز باندلی منتشر نشده است. مدیر باید دست‌کم یک باندل را منتشر کند.</p>';
      return;
    }
    if (!state.brokerBudget.trim()) {
      hint.textContent = 'مبلغی را که برای این خرید در نظر دارید وارد کنید؛ بهترین باندل خودکار انتخاب می‌شود.';
      out.innerHTML = '';
      return;
    }
    if (Number.isNaN(budget)) {
      hint.textContent = 'بودجه باید یک عدد صحیح باشد.';
      out.innerHTML = '';
      return;
    }
    hint.textContent = 'بودجه: ' + toman(budget) + ' · سقف پرداخت اضافه برای ارتقا: ' + toman(src.cap) + issuedText();
    var r = C.recommend(src.bundles, budget, src.cap, state.priorities);
    var html = '';
    if (r.main) html += offerCard('main', r.main, src, { keep: budget - r.main.total });
    if (r.upgrade) html += offerCard('upgrade', r.upgrade, src, { pay: r.additionalPayment, overMain: r.extraOverMain, fallback: !r.main });
    if (!r.main && !r.upgrade) {
      var min = src.bundles.reduce(function (m, b) { return b.total < m ? b.total : m; }, Infinity);
      html = '<p class="empty">با این بودجه باندلی در دسترس نیست. کمترین مبلغ باندل منتشرشده ' + toman(min) + ' است.</p>';
    }
    out.innerHTML = html;
  }

  /* ---------- nav ---------- */
  function renderNav() {
    var t = state.tab;
    ['admin', 'broker'].forEach(function (n) {
      var tab = $('tab-' + n);
      tab.setAttribute('aria-selected', String(n === t));
      tab.tabIndex = n === t ? 0 : -1;
      $('view-' + n).hidden = n !== t;
    });
  }

  // Big configurations (hundreds of bundles) are re-rendered after a short pause instead of on every keystroke.
  var updateTimer;
  function scheduleUpdate() {
    clearTimeout(updateTimer);
    if (view.bundles.length <= 500) { updateAll(); return; }
    updateTimer = setTimeout(updateAll, 250);
  }

  function updateAll() {
    clearTimeout(updateTimer);
    state.limit = PAGE;
    compute();
    showFieldErrors();
    renderDerived();
    renderPriorities();
    renderTable();
    renderBroker();
  }

  /* ---------- actions ---------- */
  function setPublished(list, on) {
    list.forEach(function (b) { if (on) state.published[pubKey(b)] = true; else delete state.published[pubKey(b)]; });
    store.set('published', state.published);
    renderTable();
    renderBroker();
  }

  function download(name, text, type) {
    var blob = new Blob([text], { type: type });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  }

  function printAll() {
    var prev = state.limit;
    state.limit = Infinity; // the printout must contain every bundle, not only the first page
    renderTable();
    try { window.print(); } finally { state.limit = prev; renderTable(); }
  }

  function exportCSV() {
    var map = {};
    view.bundles.forEach(function (b) { if (isPublished(b)) map[b.id] = true; });
    var d = new Date();
    var stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    download('techno-bundle-v10-' + stamp + '.csv', C.toCSV(view.bundles, map), 'text/csv;charset=utf-8');
    toast('فایل CSV آماده شد.');
  }

  function shareLink() {
    var pub = view.bundles.filter(isPublished);
    if (!view.settings || !pub.length) { toast('ابتدا دست‌کم یک باندل را منتشر کنید.'); return; }
    var enc = C.encodeOffer(C.buildOffer(view.settings, pub, Date.now()));
    var base = location.href.split('#')[0].split('?')[0];
    var link = base + '#offer=' + enc;
    $('shareText').value = link;
    var info = 'این لینک فقط ' + fmt(pub.length) + ' باندل منتشرشده، قیمت‌ها، سقف ارتقا و تاریخ صدور را دارد. بهای تمام‌شده، سود، کف رقابتی و بودجه بازاریابی در آن نیست.';
    if (link.length > 8000) info += ' هشدار: لینک بسیار بلند است (' + fmt(link.length) + ' نویسه) و ممکن است در پیام‌رسان‌ها بریده شود؛ تعداد باندل‌های منتشرشده را کمتر کنید.';
    $('shareInfo').textContent = info;
    openDialog($('shareDialog'));
  }

  function copyShare() {
    var ta = $('shareText');
    var text = ta.value;
    function fallback() { ta.focus(); ta.select(); try { document.execCommand('copy'); toast('لینک کپی شد.'); } catch (e) { toast('لینک را دستی کپی کنید.'); } }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { toast('لینک کپی شد.'); }, fallback);
    } else fallback();
  }

  function resetDefaults() {
    confirmAction('بازنشانی به پیش‌فرض', 'تنظیمات و ترتیب اولویت‌ها به حالت پیش‌فرض برمی‌گردد. وضعیت انتشار تغییر نمی‌کند.', 'بازنشانی').then(function (ok) {
      if (!ok) return;
      state.raw = defaultRaw();
      state.priorities = C.DEFAULT_PRIORITIES.slice();
      persistSettings();
      store.set('priorities', state.priorities);
      syncFormFromState();
      updateAll();
      toast('به تنظیمات پیش‌فرض برگشت.');
    });
  }

  function clearData() {
    confirmAction('پاک‌کردن همه داده‌ها', 'تنظیمات، اولویت‌ها، وضعیت انتشار، بودجه کارگزار و پیشنهاد ذخیره‌شده از این دستگاه حذف می‌شود. این کار قابل بازگشت نیست.', 'پاک کن').then(function (ok) {
      if (!ok) return;
      store.clear();
      state.raw = defaultRaw();
      state.priorities = C.DEFAULT_PRIORITIES.slice();
      state.published = {};
      state.brokerBudget = '';
      state.offer = null; state.offerEnc = null;
      document.body.classList.remove('broker-mode');
      $('brokerBudget').value = '';
      state.tab = 'admin';
      syncFormFromState();
      renderNav();
      updateAll();
      toast('همه داده‌ها پاک شد.');
    });
  }

  function clearOffer() {
    confirmAction('حذف پیشنهاد ذخیره‌شده', 'پیشنهاد دریافتی از این دستگاه حذف می‌شود و برنامه به حالت مدیر برمی‌گردد.', 'حذف').then(function (ok) {
      if (!ok) return;
      state.offer = null; state.offerEnc = null;
      store.del('offer');
      document.body.classList.remove('broker-mode');
      state.tab = 'admin';
      store.set('tab', state.tab);
      renderNav();
      renderBroker();
    });
  }

  function handleHash() {
    var m = /^#offer=([A-Za-z0-9_-]+)$/.exec(location.hash);
    if (!m) return;
    if (applyOffer(m[1], false)) {
      state.tab = 'broker';
      renderNav();
      renderBroker();
      toast('پیشنهاد مدیر دریافت شد.');
    }
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* ignore */ }
  }

  /* ---------- events ---------- */
  function bind() {
    $('settingsForm').addEventListener('input', function (e) {
      var t = e.target;
      if (t.name === 'driverType') state.raw.driverType = t.value === 'used' ? 'used' : 'cashless';
      else if (C.FIELDS.indexOf(t.name) !== -1) state.raw[t.name] = t.value;
      else return;
      persistSettings();
      scheduleUpdate();
    });
    $('settingsForm').addEventListener('focusout', function (e) {
      var t = e.target;
      if (C.FIELDS.indexOf(t.name) === -1) return;
      var n = C.parseAmount(t.value);
      if (!Number.isNaN(n)) { t.value = fmt(n); state.raw[t.name] = t.value; persistSettings(); }
    });
    $('settingsForm').addEventListener('submit', function (e) { e.preventDefault(); });

    $('prioList').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-move]');
      if (!btn || btn.disabled) return;
      var i = +btn.getAttribute('data-i');
      state.priorities = C.movePriority(state.priorities, i, +btn.getAttribute('data-move'));
      store.set('priorities', state.priorities);
      compute();
      renderPriorities();
      renderTable();
      renderBroker();
      var again = $('prioList').querySelector('button[data-i="' + (i + (+btn.getAttribute('data-move'))) + '"][data-move="' + btn.getAttribute('data-move') + '"]');
      if (again && !again.disabled) again.focus();
    });

    $('bundleRows').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-act]');
      if (!btn) return;
      var id = btn.closest('tr').getAttribute('data-id');
      var b = findBundle(id);
      if (!b) return;
      if (btn.getAttribute('data-act') === 'details') openDetails(id);
      else setPublished([b], !isPublished(b));
    });

    $('pubAllBtn').addEventListener('click', function () { setPublished(view.bundles, true); toast('همه باندل‌ها منتشر شد.'); });
    $('unpubAllBtn').addEventListener('click', function () {
      state.published = {}; // also drops entries that no longer match current prices
      store.set('published', state.published);
      renderTable();
      renderBroker();
      toast('انتشار همه باندل‌ها لغو شد.');
    });
    $('moreBtn').addEventListener('click', function () { state.limit += PAGE; renderTable(); });
    $('csvBtn').addEventListener('click', exportCSV);
    $('printBtn').addEventListener('click', printAll);
    $('brokerPrint').addEventListener('click', function () { window.print(); });
    $('shareBtn').addEventListener('click', shareLink);
    $('shareCopy').addEventListener('click', copyShare);
    $('resetBtn').addEventListener('click', resetDefaults);
    $('clearBtn').addEventListener('click', clearData);
    $('offerClear').addEventListener('click', clearOffer);

    $('brokerBudget').addEventListener('input', function (e) {
      state.brokerBudget = e.target.value;
      store.set('brokerBudget', state.brokerBudget);
      renderBroker();
    });
    $('brokerBudget').addEventListener('focusout', function (e) {
      var n = C.parseAmount(e.target.value);
      if (!Number.isNaN(n)) { e.target.value = fmt(n); state.brokerBudget = e.target.value; store.set('brokerBudget', state.brokerBudget); }
    });

    document.querySelectorAll('[data-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        state.tab = b.getAttribute('data-tab');
        store.set('tab', state.tab);
        renderNav();
        renderBroker();
      });
    });
    document.querySelector('.tabs').addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      state.tab = state.tab === 'admin' ? 'broker' : 'admin';
      store.set('tab', state.tab);
      renderNav();
      renderBroker();
      $('tab-' + state.tab).focus();
    });

    document.querySelectorAll('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) closeDialog(d); });
    });
    document.querySelectorAll('[data-close]').forEach(function (b) {
      b.addEventListener('click', function () { closeDialog(b.closest('dialog')); });
    });

    window.addEventListener('hashchange', handleHash);
    window.addEventListener('online', netState);
    window.addEventListener('offline', netState);
  }

  function netState() { $('net').hidden = navigator.onLine !== false; }

  /* ---------- PWA ---------- */
  function setupPWA() {
    var deferred = null;
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      $('installBtn').hidden = false;
    });
    $('installBtn').addEventListener('click', function () {
      if (!deferred) return;
      deferred.prompt();
      deferred.userChoice.then(function () { deferred = null; $('installBtn').hidden = true; });
    });
    window.addEventListener('appinstalled', function () { $('installBtn').hidden = true; });

    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    var updateRequested = false;
    // Reload only after the user accepted an update. On the very first install the worker calls
    // clients.claim(), which also fires "controllerchange" — reloading then would restart the splash.
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!updateRequested) return;
      updateRequested = false;
      location.reload();
    });
    navigator.serviceWorker.register('./sw.js').then(function (reg) {
      function offerUpdate(worker) {
        function run() { updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); }
        $('updateBtn').hidden = false;           // stays visible until the user updates
        $('updateBtn').onclick = run;
        toast('نسخه جدید برنامه آماده است.', { label: 'به‌روزرسانی', run: run });
      }
      if (reg.waiting && navigator.serviceWorker.controller) offerUpdate(reg.waiting);
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) offerUpdate(w);
        });
      });
    }).catch(function () { /* offline support is optional */ });
  }

  /* ---------- splash ---------- */
  function runSplash() {
    var s = $('splash');
    var FADE_MS = 350; // fade-out is inside the 5 s total
    setTimeout(function () { s.classList.add('is-leaving'); }, SPLASH_MS - FADE_MS);
    setTimeout(function () {
      s.hidden = true;
      document.body.classList.remove('is-splash');
    }, SPLASH_MS);
  }

  /* ---------- boot ---------- */
  function init() {
    runSplash();
    loadState();
    renderSettingsForm();
    $('brokerBudget').value = state.brokerBudget;
    bind();
    renderNav();
    updateAll();
    netState();
    handleHash();
    setupPWA();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
