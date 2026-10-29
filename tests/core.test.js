'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const S = Object.assign({}, C.DEFAULT_SETTINGS);
const plain = (str) => str.replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0);

test('acceptance scenario: 5 POS + 2 driver', () => {
  const b = C.evaluateBundle(S, 5, 2);
  assert.equal(b.valid, true, b.errors.join('|'));
  assert.equal(b.contribution, 15000000);
  assert.equal(b.reserve, 5000000);
  assert.equal(b.budget, 25000000);
  assert.equal(b.posPrice, 15000000);
  assert.equal(b.total, 159000000);
  assert.equal(b.discountPerPos, 5000000);
  assert.equal(b.totalDiscount, 25000000);
  assert.equal(b.remaining, 0);
});

test('reserve is separate: discount + reserve never exceeds driver contribution', () => {
  for (const b of C.generateBundles(S)) {
    assert.ok(b.totalDiscount + b.reserve <= b.driverContributionTotal, b.id);
    assert.ok(b.totalDiscount <= b.budget, b.id);
    assert.equal(b.total, b.posQty * b.posPrice + b.driverQty * S.driverPrice, b.id);
  }
});

test('price never below competitive floor, never above base', () => {
  for (const b of C.generateBundles(S)) {
    assert.ok(b.posPrice >= S.posFloor, b.id);
    assert.ok(b.posPrice <= S.posBase, b.id);
  }
});

test('P must be strictly greater than D, D >= 1', () => {
  assert.equal(C.evaluateBundle(S, 2, 2).valid, false);
  assert.equal(C.evaluateBundle(S, 3, 5).valid, false);
  assert.equal(C.evaluateBundle(S, 5, 0).valid, false);
  assert.equal(C.evaluateBundle(S, 2, 1).valid, true);
});

test('quantities need not be multiples of five', () => {
  const b = C.evaluateBundle(S, 7, 3);
  assert.equal(b.valid, true);
  assert.ok(C.generateBundles(S).some((x) => x.posQty === 7 && x.driverQty === 3));
});

test('generateBundles covers every valid (P, D) within limits and nothing else', () => {
  const list = C.generateBundles(S);
  let expected = 0;
  for (let p = 2; p <= S.maxPos; p++) expected += Math.min(S.maxDriver, p - 1);
  assert.equal(list.length, expected);
  const ids = new Set(list.map((b) => b.id));
  assert.equal(ids.size, list.length);
  assert.ok(list.every((b) => b.posQty > b.driverQty && b.driverQty >= 1 && b.posQty <= S.maxPos && b.driverQty <= S.maxDriver));
});

test('underfunded bundle is rejected (marketing reserve exceeds contribution)', () => {
  const s = Object.assign({}, S, { marketing: 10000000 }); // reserve for 5 POS = 50M > 2*15M
  const b = C.evaluateBundle(s, 5, 2);
  assert.equal(b.valid, false);
  assert.ok(b.budget < 0);
  assert.ok(!C.generateBundles(s).some((x) => x.id === '5x2'));
});

test('negative driver contribution is an invalid configuration', () => {
  const s = Object.assign({}, S, { driverPrice: 26000000 });
  assert.ok(C.validateSettings(s).some((e) => e.field === 'driverPrice'));
  assert.deepEqual(C.generateBundles(s), []);
});

test('floor above base is invalid', () => {
  const s = Object.assign({}, S, { posFloor: 21000000 });
  assert.ok(C.validateSettings(s).some((e) => e.field === 'posFloor'));
});

test('large budget is capped at floor and surplus stays as remaining budget', () => {
  const b = C.evaluateBundle(S, 3, 2); // budget = 30M - 3M = 27M, max discount 3*5M = 15M
  assert.equal(b.posPrice, S.posFloor);
  assert.equal(b.atFloor, true);
  assert.equal(b.remaining, 27000000 - 15000000);
});

test('small budget gives partial discount with integer rounding down', () => {
  const s = Object.assign({}, S, { driverProfit: 12000000 }); // contribution 5M
  const b = C.evaluateBundle(s, 7, 1); // budget = 5M - 7M < 0 -> invalid
  assert.equal(b.valid, false);
  const s2 = Object.assign({}, S, { driverProfit: 2000000, marketing: 0, maxPos: 10 });
  const c = C.evaluateBundle(s2, 7, 1); // budget = 15M, 15M/7 = 2142857.14 -> 2142857
  assert.equal(c.valid, true);
  assert.equal(c.discountPerPos, 2142857);
  assert.equal(c.totalDiscount, 14999999);
  assert.equal(c.remaining, 1);
  assert.equal(c.posPrice, 20000000 - 2142857);
});

test('zero marketing and zero budget gives base price (valid, no discount)', () => {
  const s = Object.assign({}, S, { driverProfit: 17000000, marketing: 0 }); // contribution 0
  const b = C.evaluateBundle(s, 3, 1);
  assert.equal(b.valid, true);
  assert.equal(b.posPrice, S.posBase);
});

test('quantities beyond configured maximums are rejected', () => {
  assert.equal(C.evaluateBundle(S, 11, 2).valid, false);
  assert.equal(C.evaluateBundle(S, 9, 6).valid, false);
});

test('non-integer quantities are rejected', () => {
  assert.equal(C.evaluateBundle(S, 5.5, 2).valid, false);
  assert.equal(C.evaluateBundle(S, 5, NaN).valid, false);
});

test('parseAmount: Persian digits, separators and bad input', () => {
  assert.equal(C.parseAmount('۲۰,۰۰۰,۰۰۰'), 20000000);
  assert.equal(C.parseAmount('20٬000٬000'), 20000000);
  assert.equal(C.parseAmount(' 15 000 000 '), 15000000);
  assert.ok(Number.isNaN(C.parseAmount('')));
  assert.ok(Number.isNaN(C.parseAmount('12.5')));
  assert.ok(Number.isNaN(C.parseAmount('-5')));
  assert.ok(Number.isNaN(C.parseAmount('abc')));
  assert.ok(Number.isNaN(C.parseAmount('99999999999999999999')));
});

test('formatToman: thousand separators, Persian digits, toman label', () => {
  assert.equal(C.formatToman(159000000), '۱۵۹,۰۰۰,۰۰۰ تومان');
  assert.equal(plain(C.formatNumber(1234567)), '1,234,567');
  assert.equal(plain(C.formatNumber(0)), '0');
});

test('default ranking order: more POS, lower POS price, fewer drivers, lower total, higher remaining', () => {
  assert.deepEqual(C.DEFAULT_PRIORITIES, ['posQty', 'posPrice', 'driverQty', 'total', 'remaining']);
  const ranked = C.rankBundles(C.generateBundles(S), C.DEFAULT_PRIORITIES);
  assert.equal(ranked[0].posQty, S.maxPos);
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1], b = ranked[i];
    if (a.posQty === b.posQty) {
      assert.ok(a.posPrice <= b.posPrice);
      if (a.posPrice === b.posPrice) assert.ok(a.driverQty <= b.driverQty);
    } else assert.ok(a.posQty > b.posQty);
  }
});

test('reordering priorities changes the ranking', () => {
  const p = C.movePriority(C.DEFAULT_PRIORITIES, 3, -3); // total to first
  assert.equal(p[0], 'total');
  const ranked = C.rankBundles(C.generateBundles(S), p);
  assert.ok(ranked[0].total <= ranked[1].total);
  assert.deepEqual(C.movePriority(C.DEFAULT_PRIORITIES, 0, -1), C.DEFAULT_PRIORITIES); // clamp
  assert.deepEqual(C.movePriority(C.DEFAULT_PRIORITIES, 4, 1), C.DEFAULT_PRIORITIES);
  assert.deepEqual(C.sanitizePriorities(['total', 'bogus', 'total']).slice(0, 1), ['total']);
  assert.equal(C.sanitizePriorities(['total']).length, 5);
});

test('broker: main = highest POS qty then lowest price within budget; upgrade respects cap', () => {
  const all = C.generateBundles(S);
  const budget = 159000000;
  const r = C.recommend(all, budget, S.maxUpgrade, C.DEFAULT_PRIORITIES);
  assert.ok(r.main.total <= budget);
  assert.ok(all.filter((b) => b.total <= budget).every((b) => b.posQty <= r.main.posQty));
  if (r.upgrade) {
    assert.ok(r.upgrade.total > budget);
    assert.ok(r.upgrade.total - budget <= S.maxUpgrade);
    assert.ok(r.upgrade.posQty > r.main.posQty || (r.upgrade.posQty === r.main.posQty && r.upgrade.posPrice < r.main.posPrice));
    assert.equal(r.additionalPayment, r.upgrade.total - budget);
  }
});

test('broker: upgrade never exceeds cap, even with cap = 0', () => {
  const all = C.generateBundles(S);
  for (let budget = 40000000; budget <= 600000000; budget += 7000000) {
    for (const cap of [0, 1000000, 10000000]) {
      const r = C.recommend(all, budget, cap, C.DEFAULT_PRIORITIES);
      if (r.upgrade) assert.ok(r.upgrade.total - budget <= cap && r.upgrade.total > budget);
      if (cap === 0) assert.equal(r.upgrade, null);
    }
  }
});

test('broker: only published bundles are considered; empty and unaffordable cases', () => {
  const all = C.generateBundles(S);
  assert.equal(C.recommend([], 1e9, 0, C.DEFAULT_PRIORITIES).status, 'no-published');
  const only = all.filter((b) => b.id === '5x2');
  const r = C.recommend(only, 200000000, 0, C.DEFAULT_PRIORITIES);
  assert.equal(r.main.id, '5x2');
  assert.equal(r.upgrade, null);
  const low = C.recommend(only, 1000000, 10000000, C.DEFAULT_PRIORITIES);
  assert.equal(low.main, null);
  assert.equal(low.status, 'none-affordable');
  assert.equal(C.recommend(only, NaN, 0, C.DEFAULT_PRIORITIES).status, 'invalid-budget');
});

test('broker: picks exactly one upgrade at most', () => {
  const r = C.recommend(C.generateBundles(S), 100000000, 50000000, C.DEFAULT_PRIORITIES);
  assert.ok(r.upgrade === null || typeof r.upgrade === 'object');
  assert.ok(!Array.isArray(r.upgrade));
});

test('CSV: BOM, header, ascii integers, one row per bundle', () => {
  const list = C.rankBundles(C.generateBundles(S), C.DEFAULT_PRIORITIES);
  const csv = C.toCSV(list, { [list[0].id]: true });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, list.length + 1);
  assert.ok(lines[1].includes('منتشر شده'));
  assert.ok(lines[2].includes('منتشر نشده'));
  assert.ok(/,\d+$/.test(lines[1]));
});

test('offer round-trip contains no cost/profit data and recomputes totals', () => {
  const pub = C.generateBundles(S).filter((b) => b.id === '5x2' || b.id === '6x2');
  const offer = C.buildOffer(S, pub, Date.UTC(2026, 9, 29, 12));
  assert.deepEqual(Object.keys(offer).sort(), ['b', 'cap', 'dp', 'i', 'pb', 't', 'v']);
  assert.equal(offer.i, Math.floor(Date.UTC(2026, 9, 29) / 86400000)); // issue day
  assert.ok(!('posFloor' in offer) && !('driverCost' in offer) && !('driverProfit' in offer) && !('marketing' in offer));
  const dec = C.decodeOffer(C.encodeOffer(offer));
  assert.equal(dec.ok, true);
  assert.equal(dec.bundles.find((b) => b.id === '5x2').total, 159000000);
  assert.equal(dec.offer.cap, S.maxUpgrade);
  assert.equal(dec.offer.i, offer.i);
  // offers without a date (older links) stay valid; a malformed date is rejected
  const noDate = Object.assign({}, offer); delete noDate.i;
  assert.equal(C.decodeOffer(C.encodeOffer(noDate)).ok, true);
  assert.equal(C.decodeOffer(C.encodeOffer(Object.assign({}, offer, { i: -1 }))).ok, false);
  assert.equal(C.decodeOffer(C.encodeOffer(Object.assign({}, offer, { i: 1.5 }))).ok, false);
});

test('broker: a same-count "upgrade" must not demand more driver units than the main bundle', () => {
  const all = C.generateBundles(S);
  const only = all.filter((b) => b.id === '10x1' || b.id === '10x2');
  const x1 = only.find((b) => b.id === '10x1'), x2 = only.find((b) => b.id === '10x2');
  assert.ok(x2.posPrice < x1.posPrice && x2.total > x1.total && x2.driverQty > x1.driverQty);
  const r = C.recommend(only, x1.total + 1000, 50000000, C.DEFAULT_PRIORITIES);
  assert.equal(r.main.id, '10x1');
  assert.equal(r.upgrade, null);
  // but more POS units with the same driver count is still a valid upgrade
  const pair = all.filter((b) => b.id === '5x2' || b.id === '6x2');
  const r2 = C.recommend(pair, 159000000, 100000000, C.DEFAULT_PRIORITIES);
  assert.equal(r2.main.id, '5x2');
  assert.equal(r2.upgrade.id, '6x2');
});

test('offer decoding rejects garbage and malformed rows', () => {
  assert.equal(C.decodeOffer('%%%').ok, false);
  assert.equal(C.decodeOffer(C.encodeOffer({ v: 9 })).ok, false);
  assert.equal(C.decodeOffer(C.encodeOffer({ v: 10, t: 'cashless', pb: 1, dp: 1, cap: 0, b: [[2, 2, 1]] })).ok, false);
  assert.equal(C.decodeOffer(C.encodeOffer({ v: 10, t: 'x', pb: 1, dp: 1, cap: 0, b: [] })).ok, false);
  assert.equal(C.decodeOffer(C.encodeOffer({ v: 10, t: 'used', pb: 10, dp: 5, cap: 0, b: [[3, 1, 11]] })).ok, false);
});

test('parseSettings reports non-integer fields', () => {
  const r = C.parseSettings(Object.assign({}, S, { posBase: '12.5', maxPos: 'x' }));
  assert.deepEqual(r.errors.map((e) => e.field).sort(), ['maxPos', 'posBase']);
  const ok = C.parseSettings({ driverType: 'used', posBase: '۲۰,۰۰۰,۰۰۰', posFloor: '15000000', marketing: '1000000', driverCost: '25000000', driverPrice: '42000000', driverProfit: '2000000', maxPos: '10', maxDriver: '5', maxUpgrade: '10000000' });
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.values.posBase, 20000000);
  assert.equal(ok.values.driverType, 'used');
});

test('settings bounds: quantity and money limits', () => {
  assert.ok(C.validateSettings(Object.assign({}, S, { maxPos: 1 })).some((e) => e.field === 'maxPos'));
  assert.ok(C.validateSettings(Object.assign({}, S, { maxDriver: 0 })).some((e) => e.field === 'maxDriver'));
  assert.ok(C.validateSettings(Object.assign({}, S, { maxPos: 101 })).some((e) => e.field === 'maxPos'));
  assert.ok(C.validateSettings(Object.assign({}, S, { posBase: C.MAX_MONEY + 1 })).length > 0);
  assert.equal(C.validateSettings(S).length, 0);
});

test('no floating point in results (all integers)', () => {
  for (const b of C.generateBundles(S)) {
    for (const k of ['contribution', 'reserve', 'budget', 'discountPerPos', 'totalDiscount', 'remaining', 'posPrice', 'total']) {
      assert.ok(Number.isSafeInteger(b[k]), b.id + ' ' + k);
    }
  }
});
