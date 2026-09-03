/* statements.js — reading a bank statement file, and stripping it of you.
 * ---------------------------------------------------------------------------
 * ⚠ NOTHING IN THIS FILE TOUCHES THE DOM OR THE NETWORK. It takes text in and gives
 * plain objects back, so it can be tested on its own — which matters, because a
 * parser that is wrong by one column silently mis-files a year of spending.
 *
 * This is absolute: statement files are parsed ENTIRELY IN THE BROWSER and never
 * uploaded, and no bank credential is ever collected. See research/02-bank-data.md —
 * CDR accreditation is built for companies, the cheapest aggregator floor is about
 * $250/month, and screen-scraping voids the user's ePayments Code protections.
 *
 * ⚠ AND THE PART THAT MATTERS MOST: there is no
 * client-side encryption, so identifying detail is REMOVED HERE instead. A raw line
 *
 *     03/09/2026,-87.30,"WOOLWORTHS 4521 NEW FARM QLD AUS",1043.22,"REF 8891042"
 *
 * carries a store number and a suburb. A year of those is a map of where you go —
 * and by extension your habits, your health, your routine. The amount is not the
 * sensitive part; the location is. Everything but date, amount and a canonical
 * merchant name is dropped before a single row is stored.
 *
 * No npm dependencies: this page loads plain <script> files with no build step, so
 * the three parsers are written here rather than pulled from ofx-js/qif-ts.
 */
(function () {
  'use strict';

  /* ── format detection ────────────────────────────────────────────────────
   * By CONTENT, not by extension. Banks hand out .txt that is really OFX, and
   * .qif that is really CSV, and a wrong guess produces zero rows with no
   * explanation. */

  function detect(text) {
    var head = text.slice(0, 4000);
    if (/<OFX>|<STMTTRN>|OFXHEADER/i.test(head)) return 'ofx';
    // QIF's type header, or its record terminator on a line of its own.
    if (/^\s*!Type:/im.test(head) || /^\^\s*$/m.test(head) && /^[DTPMLC]/m.test(head)) return 'qif';
    return 'csv';
  }

  /* ── OFX ─────────────────────────────────────────────────────────────────
   * The preferred format. It is an actual standard, it parses deterministically,
   * and it carries FITID — a bank-assigned unique id that makes deduplication
   * reliable rather than heuristic.
   *
   * Real-world OFX is SGML, not XML: closing tags are frequently absent. A proper
   * XML parser fails on most bank output, so this reads tag/value pairs directly. */

  function parseOFX(text) {
    var rows = [];
    var warnings = [];
    var blocks = text.match(/<STMTTRN>[\s\S]*?(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi) || [];
    if (!blocks.length) return { rows: rows, warnings: ['No transactions found in this OFX file.'] };

    blocks.forEach(function (b) {
      var v = function (tag) {
        var m = new RegExp('<' + tag + '>([^<\\r\\n]*)', 'i').exec(b);
        return m ? m[1].trim() : '';
      };
      var raw = v('NAME') || v('MEMO') || v('PAYEE');
      var memo = v('MEMO');
      if (memo && memo !== raw) raw = raw + ' ' + memo;
      var amt = parseAmount(v('TRNAMT'));
      var date = ofxDate(v('DTPOSTED'));
      if (amt == null || !date) { warnings.push('Skipped a transaction with no usable date or amount.'); return; }
      rows.push({ date: date, amountCents: amt, raw: raw, fitid: v('FITID') || null });
    });
    return { rows: rows, warnings: warnings };
  }

  /** OFX dates are YYYYMMDD, optionally followed by a time and a [-5:EST] zone. */
  function ofxDate(s) {
    var m = /^(\d{4})(\d{2})(\d{2})/.exec(String(s || '').trim());
    if (!m) return null;
    return validDate(+m[1], +m[2], +m[3]);
  }

  /* ── QIF ─────────────────────────────────────────────────────────────────
   * A standard, but with no transaction id and a looser date format, so its rows
   * fall back to the hashed-description dedupe. */

  function parseQIF(text) {
    var rows = [];
    var warnings = [];
    var cur = null;
    var lines = text.split(/\r?\n/);

    lines.forEach(function (line) {
      line = line.replace(/\s+$/, '');
      if (!line) return;
      if (line[0] === '!') return;                    // !Type:Bank etc
      if (line[0] === '^') {                          // end of record
        if (cur && cur.date && cur.amountCents != null) rows.push(cur);
        else if (cur) warnings.push('Skipped a QIF record with no usable date or amount.');
        cur = null;
        return;
      }
      if (!cur) cur = { date: null, amountCents: null, raw: '', fitid: null };
      var code = line[0], val = line.slice(1).trim();
      if (code === 'D') cur.date = qifDate(val);
      else if (code === 'T' || code === 'U') { if (cur.amountCents == null) cur.amountCents = parseAmount(val); }
      else if (code === 'P') cur.raw = val + (cur.raw ? ' ' + cur.raw : '');
      else if (code === 'M') cur.raw = (cur.raw ? cur.raw + ' ' : '') + val;
    });
    if (cur && cur.date && cur.amountCents != null) rows.push(cur);
    return { rows: rows, warnings: warnings };
  }

  /* QIF dates are a mess: 3/ 9'26, 03/09/2026, 9/3/26. The apostrophe means a
   * 2000s year. Ordering is the same ambiguity as CSV and is resolved by the
   * caller from the whole sample, never guessed per row. */
  function qifDate(s) {
    var m = /^\s*(\d{1,2})[\/\-\s]+(\d{1,2})[\/\-\s'"]+(\d{2,4})/.exec(String(s || ''));
    if (!m) return null;
    return { a: +m[1], b: +m[2], y: fullYear(+m[3]) };   // order decided later
  }

  /* ── CSV ─────────────────────────────────────────────────────────────────
   * Not a standard. Every bank differs in column order, date format and sign
   * convention — some use one signed amount, some separate debit/credit columns. */

  /** RFC-4180-ish: honours quotes, doubled quotes inside them, and embedded newlines. */
  function parseCSV(text, delimiter) {
    var d = delimiter || sniffDelimiter(text);
    var rows = [], row = [], field = '', inQuotes = false;
    // A BOM survives every naive split and turns the first header into "﻿Date".
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
        continue;
      }
      if (c === '"') { inQuotes = true; continue; }
      if (c === d) { row.push(field); field = ''; continue; }
      if (c === '\r') continue;
      if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
      field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }

    rows = rows.filter(function (r) { return r.some(function (x) { return String(x).trim() !== ''; }); });
    return { rows: rows.map(function (r) { return r.map(function (x) { return String(x).trim(); }); }), delimiter: d };
  }

  /**
   * Does this cell LOOK like a money literal? Strict on purpose — used only to
   * classify columns, never to read a value.
   * Accepts: 1234  1,234.56  $1,234.56  -87.30  +87.30  (87.30)  87.30 CR
   * Rejects: WOOLWORTHS 4521 NEW FARM QLD  ·  NETFLIX.COM 1234 SYDNEY  ·  03/09/2026
   */
  function isMoneyLike(v) {
    var t = String(v == null ? '' : v).trim();
    if (!t) return false;
    return /^\(?\s*[-+]?\s*\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?\s*(CR|DR)?\s*\)?$/i.test(t);
  }

  function sniffDelimiter(text) {
    var sample = text.split(/\r?\n/).slice(0, 5).join('\n');
    var best = ',', bestN = -1;
    [',', ';', '\t', '|'].forEach(function (d) {
      var n = sample.split(d).length;
      if (n > bestN) { bestN = n; best = d; }
    });
    return best;
  }

  /* ── column mapping ──────────────────────────────────────────────────────
   * Auto-detect for the first guess; the user can override anything, and the
   * mapping is remembered per bank so it is a one-time cost. */

  var HEAD = {
    date: /^(date|transaction date|posting date|value date|processed date|effective date)$/i,
    amount: /^(amount|value|transaction amount|amount \(aud\)|amt)$/i,
    debit: /^(debit|debit amount|withdrawal|withdrawals|money out|paid out|dr)$/i,
    credit: /^(credit|credit amount|deposit|deposits|money in|paid in|cr)$/i,
    desc: /^(description|narrative|details|transaction details|payee|merchant|reference|memo|particulars)$/i,
    balance: /^(balance|running balance|closing balance|bal)$/i,
  };

  /**
   * Work out which column is which. Header names first; failing those, infer from
   * the content of the rows.
   *
   * Returns `dateOrder: null` when the sample is genuinely ambiguous — the caller
   * MUST ask. Guessing American on an Australian statement silently mangles the
   * first twelve days of every month, and the damage is invisible.
   */
  function guessMapping(rows) {
    var out = { hasHeader: false, date: -1, amount: -1, debit: -1, credit: -1, desc: -1,
                balance: -1, dateOrder: null, negateAmount: false };
    if (!rows.length) return out;

    var first = rows[0];
    var named = first.filter(function (h) {
      return Object.keys(HEAD).some(function (k) { return HEAD[k].test(h); });
    }).length;
    out.hasHeader = named >= 2;

    if (out.hasHeader) {
      first.forEach(function (h, i) {
        if (out.date < 0 && HEAD.date.test(h)) out.date = i;
        else if (out.amount < 0 && HEAD.amount.test(h)) out.amount = i;
        else if (out.debit < 0 && HEAD.debit.test(h)) out.debit = i;
        else if (out.credit < 0 && HEAD.credit.test(h)) out.credit = i;
        else if (out.desc < 0 && HEAD.desc.test(h)) out.desc = i;
        else if (out.balance < 0 && HEAD.balance.test(h)) out.balance = i;
      });
    }

    var body = out.hasHeader ? rows.slice(1) : rows;
    var sample = body.slice(0, 200);
    var cols = Math.max.apply(null, rows.map(function (r) { return r.length; }));

    // Content-based fallback: a column parsing as dates in >90% of rows is the date
    // column; one parsing as signed decimals is a money column; the widest text
    // column is the description.
    function ratio(idx, test) {
      var n = 0, seen = 0;
      sample.forEach(function (r) {
        var v = (r[idx] || '').trim();
        if (!v) return;
        seen++; if (test(v)) n++;
      });
      return seen ? n / seen : 0;
    }
    for (var i = 0; i < cols; i++) {
      if (out.date < 0 && ratio(i, function (v) { return !!looseDate(v); }) > 0.9) { out.date = i; continue; }
    }
    // ⚠ Detect money columns with isMoneyLike(), NOT parseAmount(). parseAmount is
    // deliberately forgiving because it reads a value the user has already told us is
    // money; asked to CLASSIFY a column it says yes to "WOOLWORTHS 4521 NEW FARM QLD"
    // (which reduces to 4521) and the description gets mapped as the amount.
    if (out.amount < 0 && out.debit < 0) {
      var moneyCols = [];
      for (var j = 0; j < cols; j++) {
        if (j === out.date || j === out.balance) continue;
        if (ratio(j, isMoneyLike) > 0.9) moneyCols.push(j);
      }
      if (moneyCols.length === 1) {
        out.amount = moneyCols[0];
      } else if (moneyCols.length > 1) {
        // Several money columns and no header to tell them apart: the transaction
        // column is the one that goes negative; a running balance rarely does.
        // Leftmost breaks a tie, and the preview lets the user correct it either way.
        var scored = moneyCols.map(function (c) {
          return { col: c, neg: ratio(c, function (v) { var n = parseAmount(v); return n != null && n < 0; }) };
        }).sort(function (a, b) { return b.neg - a.neg || a.col - b.col; });
        out.amount = scored[0].col;
        // Whatever is left is almost certainly the running balance. Naming it keeps
        // it out of the description heuristic — and it is dropped either way (§7).
        if (out.balance < 0 && scored.length > 1) out.balance = scored[1].col;
      }
    }
    if (out.desc < 0) {
      var bestLen = 0;
      for (var k = 0; k < cols; k++) {
        if (k === out.date || k === out.amount || k === out.debit || k === out.credit || k === out.balance) continue;
        var avg = sample.reduce(function (a, r) { return a + String(r[k] || '').length; }, 0) / (sample.length || 1);
        if (avg > bestLen) { bestLen = avg; out.desc = k; }
      }
    }

    // Sign convention. With a single amount column that is almost entirely positive
    // beside a description that plainly contains spending, the file states amounts
    // as magnitudes and everything must be negated.
    if (out.amount >= 0 && out.debit < 0) {
      var neg = 0, pos = 0;
      sample.forEach(function (r) {
        var c = parseAmount(r[out.amount]);
        if (c == null) return;
        if (c < 0) neg++; else if (c > 0) pos++;
      });
      out.negateAmount = neg === 0 && pos > 3;
    }

    out.dateOrder = detectDateOrder(sample, out.date);
    return out;
  }

  /**
   * DD/MM vs MM/DD, decided across the WHOLE sample.
   * Returns 'dmy', 'mdy', 'ymd', or null when nothing in the file distinguishes them.
   * ⚠ null means ASK. It does not mean pick one.
   */
  function detectDateOrder(sample, dateCol) {
    if (dateCol < 0) return null;
    var firstOver12 = false, secondOver12 = false, sawIso = false, sawAny = false, sawNamedMonth = false;
    sample.forEach(function (r) {
      var p = looseDate(r[dateCol]);
      if (!p) return;
      sawAny = true;
      if (p.iso) sawIso = true;
      if (p.named) sawNamedMonth = true;
      if (p.a > 12) firstOver12 = true;
      if (p.b > 12) secondOver12 = true;
    });
    if (!sawAny) return null;
    if (sawIso) return 'ymd';
    if (sawNamedMonth) return 'named';
    if (firstOver12 && !secondOver12) return 'dmy';
    if (secondOver12 && !firstOver12) return 'mdy';
    return null;    // genuinely ambiguous — every day of the sample is 12 or under
  }

  var MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

  /** Pull the three numbers out of a date without deciding what they mean. */
  function looseDate(s) {
    s = String(s || '').trim();
    if (!s) return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
    if (m) return { a: +m[2], b: +m[3], y: +m[1], iso: true };
    // 12 Sep 2026 / 12-Sep-26 / Sep 12 2026
    m = /^(\d{1,2})[\-\s\/]([A-Za-z]{3,})[\-\s\/](\d{2,4})/.exec(s);
    if (m) {
      var mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
      if (mi >= 0) return { a: +m[1], b: mi + 1, y: fullYear(+m[3]), named: true, day: +m[1], month: mi + 1 };
    }
    m = /^([A-Za-z]{3,})[\-\s\/](\d{1,2})[,\-\s\/]+(\d{2,4})/.exec(s);
    if (m) {
      var mj = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
      if (mj >= 0) return { a: +m[2], b: mj + 1, y: fullYear(+m[3]), named: true, day: +m[2], month: mj + 1 };
    }
    m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.exec(s);
    if (m) return { a: +m[1], b: +m[2], y: fullYear(+m[3]) };
    return null;
  }

  /* A two-digit year is this century unless that would put it in the future by more
   * than a year — a statement is history, not a forecast. */
  function fullYear(y) {
    if (y >= 1000) return y;
    var now = new Date().getFullYear();
    var candidate = 2000 + y;
    return candidate > now + 1 ? 1900 + y : candidate;
  }

  function validDate(y, m, d) {
    if (!(y > 1900 && y < 2200) || !(m >= 1 && m <= 12) || !(d >= 1)) return null;
    var last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (d > last) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }

  /** Resolve a loose date with a decided order. Returns 'YYYY-MM-DD' or null. */
  function resolveDate(p, order) {
    if (!p) return null;
    if (p.iso) return validDate(p.y, p.a, p.b);
    if (p.named) return validDate(p.y, p.month, p.day);
    return order === 'mdy' ? validDate(p.y, p.a, p.b) : validDate(p.y, p.b, p.a);
  }

  /** "$1,299.00", "1299.00 CR", "(87.30)", "-87.30" → integer cents, or null. */
  function parseAmount(v) {
    if (v == null) return null;
    var s = String(v).trim();
    if (!s) return null;
    var neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (/\bDR\b|\bDEBIT\b/i.test(s)) neg = true;
    var creditMarked = /\bCR\b|\bCREDIT\b/i.test(s);
    s = s.replace(/[A-Za-z$\s,]/g, '').replace(/^\+/, '');
    if (s === '' || s === '-' || s === '.') return null;
    if (!/^-?\d*\.?\d*$/.test(s)) return null;
    var n = Number(s);
    if (!Number.isFinite(n)) return null;
    if (n < 0) neg = true;
    var cents = Math.round(Math.abs(n) * 100);
    if (creditMarked) neg = false;
    return neg ? -cents : cents;
  }

  /* ── building rows from a CSV + mapping ──────────────────────────────── */

  function buildFromCSV(parsed, map) {
    var body = map.hasHeader ? parsed.rows.slice(1) : parsed.rows;
    var rows = [], warnings = [], skipped = 0;

    body.forEach(function (r) {
      var date = resolveDate(looseDate(r[map.date]), map.dateOrder);
      var cents = null;
      if (map.debit >= 0 || map.credit >= 0) {
        // Two-column shape: debit is money out, credit is money in. A row has one
        // or the other, never both.
        var dr = map.debit >= 0 ? parseAmount(r[map.debit]) : null;
        var cr = map.credit >= 0 ? parseAmount(r[map.credit]) : null;
        if (dr != null && dr !== 0) cents = -Math.abs(dr);
        else if (cr != null && cr !== 0) cents = Math.abs(cr);
      } else if (map.amount >= 0) {
        cents = parseAmount(r[map.amount]);
        if (cents != null && map.negateAmount) cents = -Math.abs(cents);
      }
      if (!date || cents == null) { skipped++; return; }
      rows.push({ date: date, amountCents: cents, raw: map.desc >= 0 ? (r[map.desc] || '') : '', fitid: null });
    });
    if (skipped) warnings.push(skipped + ' row' + (skipped === 1 ? '' : 's') + ' had no readable date or amount and were left out.');
    return { rows: rows, warnings: warnings };
  }

  /* ── sanitisation — this module's most important job ───────────────────── */

  /* Canonical names. Their real value is not tidiness: collapsing WOOLWORTHS 4521,
   * WOOLWORTHS METRO 8832 and WOOLWORTHS ONLINE to one entry is what makes
   * categorisation and subscription matching work at all. */
  var KNOWN = [
    [/\bwoolworths?\b|\bwoolies\b/i, 'Woolworths'], [/\bcoles express\b/i, 'Coles Express'],
    [/\bcoles\b/i, 'Coles'], [/\baldi\b/i, 'Aldi'], [/\biga\b/i, 'IGA'],
    [/\bbunnings\b/i, 'Bunnings'], [/\bkmart\b/i, 'Kmart'], [/\bbig ?w\b/i, 'Big W'],
    [/\btarget\b/i, 'Target'], [/\bofficeworks\b/i, 'Officeworks'],
    [/\bjb ?hi[- ]?fi\b/i, 'JB Hi-Fi'], [/\bharvey norman\b/i, 'Harvey Norman'],
    [/\bchemist warehouse\b/i, 'Chemist Warehouse'], [/\bpriceline\b/i, 'Priceline'],
    [/\bdan murphy/i, "Dan Murphy's"], [/\bbws\b/i, 'BWS'],
    [/\bnetflix\b/i, 'Netflix'], [/\bspotify\b/i, 'Spotify'], [/\bdisney\b/i, 'Disney+'],
    [/\bbinge\b/i, 'Binge'], [/\bstan\b/i, 'Stan'], [/\bkayo\b/i, 'Kayo'],
    [/\byoutube(premium)?\b/i, 'YouTube'], [/\bprime video\b|\bamazon prime\b/i, 'Amazon Prime'],
    [/\bamazon\b|\bamzn\b/i, 'Amazon'], [/\bebay\b/i, 'eBay'], [/\bkogan\b/i, 'Kogan'],
    [/\bapple\.com\b|\bapple ?(pay|store|services)?\b/i, 'Apple'],
    [/\bgoogle\b|\bgoog\b/i, 'Google'], [/\bmicrosoft\b|\bmsft\b/i, 'Microsoft'],
    [/\banthropic\b|\bclaude\b/i, 'Anthropic'], [/\bopenai\b/i, 'OpenAI'],
    [/\bsteam(games|powered)?\b|\bvalve\b/i, 'Steam'], [/\bepic ?games\b/i, 'Epic Games'],
    [/\bplaystation\b|\bsony ?interactive\b/i, 'PlayStation'], [/\bxbox\b/i, 'Xbox'],
    [/\bnintendo\b/i, 'Nintendo'], [/\bumart\b/i, 'Umart'], [/\bpccasegear\b|\bpc case gear\b/i, 'PC Case Gear'],
    [/\bscorptec\b/i, 'Scorptec'], [/\bmwave\b/i, 'Mwave'],
    [/\buber ?eats\b/i, 'Uber Eats'], [/\buber\b/i, 'Uber'], [/\bdoordash\b/i, 'DoorDash'],
    [/\bmenulog\b/i, 'Menulog'], [/\bdidi\b/i, 'DiDi'],
    [/\bmcdonald|\bmcdonalds\b|\bmacca/i, "McDonald's"], [/\bkfc\b/i, 'KFC'],
    [/\bdomino/i, "Domino's"], [/\bsubway\b/i, 'Subway'], [/\bhungry jack/i, "Hungry Jack's"],
    [/\bguzman\b/i, 'Guzman y Gomez'], [/\bgrill.?d\b/i, "Grill'd"],
    [/\b7[- ]?eleven\b/i, '7-Eleven'], [/\bampol\b/i, 'Ampol'], [/\bcaltex\b/i, 'Caltex'],
    [/\bbp\b/i, 'BP'], [/\bshell\b/i, 'Shell'], [/\bunited petroleum\b/i, 'United'],
    [/\btelstra\b/i, 'Telstra'], [/\boptus\b/i, 'Optus'], [/\bvodafone\b/i, 'Vodafone'],
    [/\bbelong\b/i, 'Belong'], [/\baussie ?broadband\b/i, 'Aussie Broadband'],
    [/\bagl\b/i, 'AGL'], [/\borigin energy\b/i, 'Origin Energy'], [/\benergy ?australia\b/i, 'EnergyAustralia'],
    [/\btranslink\b|\bgo card\b/i, 'Translink'], [/\bopal\b/i, 'Opal'],
    [/\bmyki\b/i, 'Myki'], [/\bqantas\b/i, 'Qantas'], [/\bjetstar\b/i, 'Jetstar'],
    [/\bvirgin australia\b/i, 'Virgin Australia'], [/\bairbnb\b/i, 'Airbnb'],
    [/\bpaypal\b/i, 'PayPal'], [/\bafterpay\b/i, 'Afterpay'], [/\bzip ?(pay|co)\b/i, 'Zip'],
  ];

  /* A person-to-person transfer names a real third party who never consented to
   * being in this database. Their name is not kept. */
  var TRANSFER = /^(tfr|transfer|osko|payid|pay id|direct credit|direct debit|internal transfer|to acct|from acct|deposit online|withdrawal)\b/i;
  var STATES = /\b(nsw|vic|qld|sa|wa|tas|nt|act)\b/gi;

  /* How the transaction happened, not who it was with. Always leading noise. */
  var TYPE_PREFIX = /^(eftpos( purchase| debit)?|visa (purchase|debit)|mastercard( purchase)?|debit card( purchase)?|card purchase|pos( purchase| debit)?|purchase|payment( to)?|atm|cash out|contactless|tap( and go)?|online purchase|int(ernet)? banking)\s+/i;

  /**
   * Reduce a raw statement line to a merchant name, and report what was removed.
   *
   * `confidence`:
   *   'known'        — matched the canonical list; safe
   *   'reduced'      — cleaned to something plausible
   *   'transfer'     — a transfer; the counterparty is deliberately not kept
   *   'unrecognised' — could not be reduced confidently. ⚠ These MUST be shown to
   *                    the user rather than stored as-is, or a string the sanitiser
   *                    failed to parse gets kept and the whole mechanism is defeated.
   */
  function sanitise(raw, amountCents) {
    var original = String(raw == null ? '' : raw);
    var s = original.trim();
    var dropped = [];
    if (!s) return { merchant: 'Unknown', confidence: 'unrecognised', dropped: dropped };

    for (var i = 0; i < KNOWN.length; i++) {
      if (KNOWN[i][0].test(s)) {
        if (/\d{3,}/.test(s)) dropped.push('store or reference number');
        if (STATES.test(s)) { dropped.push('suburb and state'); STATES.lastIndex = 0; }
        return { merchant: KNOWN[i][1], confidence: 'known', dropped: dropped };
      }
    }

    if (TRANSFER.test(s)) {
      // Direction, not identity. A DIRECT CREDIT names the user's employer, which is
      // exactly the kind of detail this module exists to drop — but collapsing pay
      // and outgoing transfers into one bucket makes the Spending view useless. The
      // sign says which it was without naming anybody.
      var incoming = typeof amountCents === 'number' ? amountCents > 0 : /credit|salary|payroll|refund/i.test(s);
      return {
        merchant: incoming ? 'Money in' : 'Transfer',
        confidence: 'transfer',
        dropped: [incoming ? 'who paid you' : 'the other party’s name'],
      };
    }

    var before = s;
    s = s
      .replace(/\b(value date|effective date)\s*:?\s*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}/gi, '')
      .replace(/\bcard\s*(x{2,}|\*{2,})?\d{3,}\b/gi, '')     // card 1234 / card xx1234
      .replace(/\breceipt\s*\d+\b/gi, '')
      .replace(/\bref(erence)?\s*[:#]?\s*\w*\d\w*\b/gi, '')
      .replace(/\b\d{4,}\b/g, '')                            // store numbers, refs
      .replace(/\baus?\b/gi, '')
      .replace(/\bpty\.?\s*l(imi)?t?d\.?\b|\bp\/l\b/gi, '')
      .replace(STATES, '')
      .replace(/[*#|]+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/^[\s\-,.]+|[\s\-,.]+$/g, '');

    if (/\d{4,}/.test(before)) dropped.push('store or reference number');
    if (STATES.test(before)) { dropped.push('suburb and state'); STATES.lastIndex = 0; }

    for (var p = 0; p < 3 && TYPE_PREFIX.test(s); p++) s = s.replace(TYPE_PREFIX, '');

    var words = s.split(/\s+/).filter(Boolean);
    if (!words.length) return { merchant: 'Unknown', confidence: 'unrecognised', dropped: dropped };

    /* ⚠ THE SUBURB PROBLEM. An Australian card description puts the LOCATION LAST:
     *
     *     EFTPOS PURCHASE 4417 SOME CAFE NEW FARM QLD
     *                          └─ merchant ─┘ └ suburb ┘
     *
     * Stripping digits, the state and AUS still leaves "Some Cafe New Farm", and the
     * suburb is exactly the part that must not be kept — a year of them is a map of
     * where you go. There is no way to tell a two-word suburb from a two-word shop
     * name without a locality list, so past two words this DOES NOT GUESS: it keeps
     * the leading words, drops the rest, and marks the row 'unrecognised' so the
     * preview asks the user to name it (plan §7.2). Truncating is the safe error;
     * keeping the tail is not.
     */
    var trimmedLocation = false;
    if (words.length > 2) { words = words.slice(0, 2); trimmedLocation = true; }

    var merchant = titleCase(words.join(' ')).trim();
    if (trimmedLocation) dropped.push('anything after the first two words (probably a suburb)');

    // One short token, or something still mostly punctuation, was not really parsed.
    var weak = merchant.length < 3 || /^\W+$/.test(merchant);
    return {
      merchant: merchant || 'Unknown',
      // Anything not on the canonical list is shown to the user for confirmation.
      // Storing a string the sanitiser failed to parse would defeat the mechanism.
      confidence: (weak || trimmedLocation) ? 'unrecognised' : 'reduced',
      dropped: dropped,
    };
  }

  function titleCase(s) {
    return s.toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); })
      .replace(/\b(Pty|Ltd|Au|Aus)\b/g, '');
  }

  /* ── deduplication ───────────────────────────────────────────────────────
   * Users re-import overlapping ranges. That is the NORMAL flow, not an edge case.
   *
   * Identity, in order of preference:
   *   1. FITID where OFX provides one — bank-assigned, stable, authoritative.
   *   2. Otherwise a salted hash of date + amount + normalised description.
   *
   * ⚠ The salt is per user and lives in synced settings. Without it, a rainbow
   * table over the few thousand common Australian merchant strings would reverse
   * every hash instantly, which would defeat the point of not storing the raw text. */

  function normaliseForKey(s) {
    return String(s || '').toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .replace(/\b\d{3,}\b/g, '')      // NETFLIX.COM 1234 and NETFLIX.COM 5678 are one merchant
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** SHA-256 where the browser allows it, and a clearly-labelled fallback where not. */
  async function hash(input) {
    if (typeof crypto !== 'undefined' && crypto.subtle && crypto.subtle.digest) {
      var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(buf)).slice(0, 12)
        .map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }
    // crypto.subtle exists only in a secure context, so a LAN test over plain http
    // lands here. Weaker, and only ever used for local dedupe.
    return 'w' + fnv1a(input) + fnv1a(input.split('').reverse().join(''));
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }

  async function dedupeKey(salt, row) {
    if (row.fitid) return 'f:' + await hash(salt + '|fitid|' + row.fitid);
    return 'h:' + await hash(salt + '|' + row.date + '|' + row.amountCents + '|' + normaliseForKey(row.raw));
  }

  window.Statements = {
    detect: detect,
    parseOFX: parseOFX,
    parseQIF: parseQIF,
    parseCSV: parseCSV,
    guessMapping: guessMapping,
    buildFromCSV: buildFromCSV,
    resolveDate: resolveDate,
    looseDate: looseDate,
    parseAmount: parseAmount,
    isMoneyLike: isMoneyLike,
    detectDateOrder: detectDateOrder,
    sanitise: sanitise,
    dedupeKey: dedupeKey,
    normaliseForKey: normaliseForKey,
  };
})();
