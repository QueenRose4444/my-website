/* money.js — integer-cents money, and the manual-ordering maths.
 * ---------------------------------------------------------------------------
 * Two small things that are easy to get wrong and expensive to fix later.
 */
(function () {
  'use strict';

  /* ── Money ───────────────────────────────────────────────────────────────
   * EVERY amount in payday is an INTEGER NUMBER OF CENTS. Never a float.
   *
   *   0.1 + 0.2 !== 0.3
   *
   * and this page sums dozens of prices. A float error is invisible until a
   * total is off by a cent and nobody can explain it. Rejected alternatives:
   * decimal strings (correct, but needs a library for every read and sum, for
   * no benefit at this size) and floats (silently wrong).
   */
  var Money = {
    /**
     * Parse human input to cents. Accepts "12", "12.5", "$1,299.00", "1299".
     * Returns null for anything it cannot read — NEVER 0, because "0" and
     * "banana" must not look the same to the caller.
     */
    parse: function (input) {
      if (input == null) return null;
      if (typeof input === 'number') {
        return Number.isFinite(input) ? Math.round(input * 100) : null;
      }
      var cleaned = String(input).trim().replace(/[$\s,]/g, '');
      if (cleaned === '') return null;
      if (!/^-?\d*\.?\d*$/.test(cleaned)) return null;
      var n = Number(cleaned);
      if (!Number.isFinite(n)) return null;
      // Round at the boundary, once. 19.995 * 100 is 1999.4999... in binary.
      return Math.round(n * 100);
    },

    /** Cents -> "$1,299.00". `cents` of null renders as an em dash, not "$0.00". */
    format: function (cents, opts) {
      opts = opts || {};
      if (cents == null) return opts.blank || '—';
      var neg = cents < 0;
      var abs = Math.abs(Math.round(cents));
      var dollars = Math.floor(abs / 100);
      var rest = String(abs % 100).padStart(2, '0');
      var grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      var body = (opts.noCents && rest === '00') ? grouped : grouped + '.' + rest;
      return (neg ? '-$' : '$') + body;
    },

    /** Cents -> "1299.00", for an <input type="number"> or a form value. */
    toInput: function (cents) {
      if (cents == null) return '';
      return (cents / 100).toFixed(2);
    },
  };

  /* ── Manual ordering ─────────────────────────────────────────────────────
   * Positions are RATIONALS (posNum/posDen), not floats.
   *
   * Dropping between two neighbours takes the MEDIANT — (a.num + b.num) /
   * (a.den + b.den) — which always lands strictly between them and stays exact
   * in integers. Repeated float halving loses precision after roughly 50
   * insertions at the same point; the mediant does not.
   *
   * Denominators still grow, so `needsRenormalise` watches for it and
   * `renormalise` flattens everything back to 1,2,3… That is rare, is one batch
   * write, and is invisible to the user.
   *
   * Rejected: a linked list (`afterId`). Elegant, but one broken link silently
   * orphans the tail, and reading the order becomes a traversal instead of a sort.
   */
  var MAX_DEN = 1e6;

  var Order = {
    value: function (item) { return item.posNum / (item.posDen || 1); },

    compare: function (a, b) { return Order.value(a) - Order.value(b); },

    sorted: function (items) { return items.slice().sort(Order.compare); },

    /** Position for an item dropped between `before` and `after` (either may be null). */
    between: function (before, after) {
      if (!before && !after) return { posNum: 1, posDen: 1 };
      if (!before) return { posNum: after.posNum, posDen: (after.posDen || 1) + 1 };
      if (!after) return { posNum: before.posNum + (before.posDen || 1), posDen: before.posDen || 1 };
      return {
        posNum: before.posNum + after.posNum,
        posDen: (before.posDen || 1) + (after.posDen || 1),
      };
    },

    /** Position for a brand-new item appended to the end. */
    end: function (items) {
      if (!items.length) return { posNum: 1, posDen: 1 };
      var last = Order.sorted(items)[items.length - 1];
      return { posNum: Math.floor(Order.value(last)) + 1, posDen: 1 };
    },

    needsRenormalise: function (items) {
      return items.some(function (i) { return (i.posDen || 1) > MAX_DEN; });
    },

    /** Flatten to 1,2,3… preserving current order. Mutates and returns `items`. */
    renormalise: function (items) {
      Order.sorted(items).forEach(function (item, idx) {
        item.posNum = idx + 1;
        item.posDen = 1;
      });
      return items;
    },
  };

  window.Money = Money;
  window.Order = Order;
})();
