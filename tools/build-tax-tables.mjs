#!/usr/bin/env node
/* build-tax-tables.mjs — pull Australian tax figures from the ATO's own data and
 * write them into payday as a committed file.
 * ---------------------------------------------------------------------------
 *   node tools/build-tax-tables.mjs            # rebuild from the live ATO CDN
 *   node tools/build-tax-tables.mjs --check    # report only, write nothing
 *
 * WHY THIS EXISTS (D-39). The ATO's own tax-withheld calculator is an Angular app
 * that fetches its coefficients from a public CDN as plain JSON, served with
 * `Access-Control-Allow-Origin: *`. Same numbers, from the people who set them,
 * under CC BY. That is a far better source than transcribing a third party's
 * minified bundle.
 *
 * ⚠ BUT IT IS AN UNDOCUMENTED INTERNAL ENDPOINT. No docs, no stability promise. So
 * it is a BUILD-TIME source, not a runtime dependency: this script runs once, the
 * output is committed, and payday never calls the ATO. Re-run it each July.
 *
 * ⚠⚠ THE TRAP THAT MAKES THIS SCRIPT NECESSARY — read before trusting the output.
 *
 * Rows are date-effective (DT_EFFECT / DT_END), and a group the ATO has not yet
 * updated for the new year carries `DT_END = 9999-12-31`. So the obvious filter —
 * "rows where DT_EFFECT <= target <= DT_END" — SILENTLY RETURNS LAST YEAR'S NUMBERS
 * and looks entirely correct.
 *
 * Medicare Levy Surcharge is doing exactly this today: the newest rows in the JSON
 * are effective 2025-07-01 with an open end date, giving the 2025-26 thresholds
 * ($101k/$118k/$158k) when the published 2026-27 ones are $105k/$123k/$164k.
 *
 * So: every group reports the DT_EFFECT it actually matched, anything older than the
 * target year is flagged LOUDLY, and known-stale groups are overridden from the ATO's
 * HTML pages with the URL recorded beside the numbers. Do not remove the warnings.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'wip', 'experiments', 'payday', 'js', 'tax-tables.js');
// ⚠ OUTSIDE the frontend tree. The two source files are 1.2 MB of ATO data and a
// build input, not site content — cached under tools/ they were queued for upload
// to the web server on the next `web-sync push`.
const CACHE = join(tmpdir(), 'payday-ato-cache');
try { mkdirSync(CACHE, { recursive: true }); } catch { /* fine if it exists */ }
const CHECK_ONLY = process.argv.includes('--check');

/** The financial year to build. Change this in July, then re-run. */
const FY_START = '2026-07-01';
const FY_LABEL = '2026-27';

const BASE = 'https://onlineservices.ato.gov.au/cdn/static-data/codes-tables/';

/* ── fetch ─────────────────────────────────────────────────────────────────── */

async function table(name) {
  const cached = join(CACHE, name + '.json');
  if (existsSync(cached) && process.argv.includes('--cached')) {
    return JSON.parse(readFileSync(cached, 'utf8'));
  }
  const res = await fetch(BASE + name + '.json');
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = await res.text();
  try { writeFileSync(cached, body); } catch { /* cache is a convenience, not required */ }
  console.log(`  fetched ${name}  ${body.length.toLocaleString()} bytes  ` +
              `last-modified ${res.headers.get('last-modified')}`);
  return JSON.parse(body);
}

/** Turn the {columns, rows} shape into objects, and keep only rows live on `at`. */
function effective(t, at) {
  const idx = Object.fromEntries(t.columns.map((c, i) => [c.name, i]));
  return t.rows
    .filter((r) => r[idx.DT_EFFECT] <= at && (!r[idx.DT_END] || r[idx.DT_END] >= at))
    .map((r) => Object.fromEntries(t.columns.map((c, i) => [c.name, r[i]])));
}

const warnings = [];

/**
 * ⚠ WHY A DATE CHECK IS NOT ENOUGH.
 *
 * A row whose DT_EFFECT predates the target year means one of TWO things, and the
 * data cannot tell you which:
 *
 *   (a) the ATO edited the row IN PLACE for the new year and left the old effective
 *       date on it — the numbers are current. Resident brackets and LITO do this:
 *       DT_EFFECT says 2020-07-01, the figures are the 2026-27 ones.
 *   (b) the ATO has not touched the group yet, and DT_END = 9999-12-31 makes last
 *       year's numbers pass an "effective now" filter. MLS does this.
 *
 * So each group carries a VERIFIED note: the date a human last checked it against
 * the ATO's own HTML page, and the URL they checked. A date warning alone would cry
 * wolf three times out of five and get ignored — which is exactly how the real one
 * would slip through.
 */
const VERIFIED = {
  'Resident income tax brackets': {
    on: '2026-08-30', matches: true,
    url: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
    note: '15c band 18,201-45,000; 4,020+30c; 31,020+37c; 51,370+45c — row edited in place, date not bumped',
  },
  'Low income tax offset': {
    on: '2026-08-30', matches: true,
    url: 'https://www.ato.gov.au/individuals-and-families/income-deductions-offsets-and-records/tax-offsets/low-income-tax-offset',
    note: '700 to 37,500; -5c to 45,000; 325 -1.5c to 66,667 — row edited in place',
  },
  'Medicare levy + shade-in': {
    on: '2026-08-30', matches: true,
    url: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy/medicare-levy-reduction/medicare-levy-reduction-for-low-income-earners',
    note: 'singles 28,011 / 35,013 — current',
  },
  'Medicare levy surcharge, single': {
    on: '2026-08-30', matches: false,
    url: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates',
    note: 'CDN gives 101k/118k/158k; published 2026-27 is 105k/123k/164k — OVERRIDDEN in `manual`',
  },
  'Medicare levy surcharge, family': {
    on: '2026-08-30', matches: false,
    url: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates',
    note: 'CDN gives 202k/236k/316k; published 2026-27 is 210k/246k/328k — OVERRIDDEN in `manual`',
  },
};

function group(rows, pick, label) {
  const got = rows.filter(pick);
  if (!got.length) throw new Error(`no rows for ${label}`);
  const eff = got[0].DT_EFFECT;
  const v = VERIFIED[label];
  if (eff < FY_START) {
    if (!v) {
      warnings.push(`${label}: rows are effective ${eff}, not ${FY_START}, and NOBODY HAS ` +
                    `CHECKED THIS GROUP. Compare it against the ATO's HTML page and add an ` +
                    `entry to VERIFIED, with an override under \`manual\` if it differs.`);
    } else if (!v.matches) {
      warnings.push(`${label}: CDN rows are out of date (${v.note}). Checked ${v.on}. ` +
                    `The override under \`manual\` is what payday actually uses — ` +
                    `re-check it against ${v.url} each July.`);
    }
  }
  return { effectiveFrom: eff, verified: v || null, rows: got };
}

const num = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`not a number: ${v}`);
  return n;
};

/* Money as integer cents everywhere, matching the rest of payday. Rates stay as
 * decimals — they are ratios, not amounts, and rounding them would be wrong. */
const cents = (v) => Math.round(num(v) * 100);

/* ── build ─────────────────────────────────────────────────────────────────── */

console.log(`Building ${FY_LABEL} tax tables from the ATO CDN…`);
const gen = await table('TC9GENTAC');
const rte = await table('TC2TAXRTE');

const G = effective(gen, FY_START);
const R = effective(rte, FY_START);

/* Schedule 1 — PAYG withholding coefficients. `y = ax − b` on weekly earnings.
 * Scale 2 is the ordinary case: Australian resident, TFN given, tax-free threshold
 * claimed. Schedule 8 is the same but with a study loan. */
const coeff = (cat, label) => {
  const g = group(G, (r) => r.NM_CALCN_CATEGORY === cat, label);
  return {
    effectiveFrom: g.effectiveFrom,
    verified: g.verified,
    // Weekly earnings bands. `max` is exclusive; the last band's is a sentinel.
    bands: g.rows
      .map((r) => ({ maxWeekly: num(r.AM_MAX_INCOME), a: num(r.PC_TAX_RATE_A), b: num(r.PC_TAX_RATE_B) }))
      .sort((x, y) => x.maxWeekly - y.maxWeekly),
  };
};

/* Annual brackets from TC2TAXRTE. AM_OFFSET is the fixed amount at the bracket
 * floor, PC_TAX_RATE the marginal rate above AM_THRESHOLD. */
const brackets = (grp, label) => {
  const g = group(R, (r) => r.IN_GRP === grp, label);
  return {
    effectiveFrom: g.effectiveFrom,
    verified: g.verified,
    bands: g.rows
      .map((r) => ({
        maxCents: cents(r.AM_INC_MAX),
        baseCents: cents(r.AM_OFFSET),
        rate: num(r.PC_TAX_RATE),
        overCents: cents(r.AM_THRESHOLD),
      }))
      .sort((x, y) => x.maxCents - y.maxCents),
  };
};

const tables = {
  fy: FY_LABEL,
  effectiveFrom: FY_START,
  effectiveTo: '2027-06-30',
  builtAt: new Date().toISOString().slice(0, 10),

  withholding: {
    scale2: coeff('SCHEDULE1_SCALE2_PAYGWHT', 'Schedule 1 scale 2 (resident, TFN, threshold claimed)'),
    scale2Stsl: coeff('SCHEDULE8_SCALE2_STSLDEBT', 'Schedule 8 scale 2 (as scale 2, plus study loan)'),
    scale1: coeff('SCHEDULE1_SCALE1_PAYGWHT', 'Schedule 1 scale 1 (threshold NOT claimed)'),
  },

  annual: {
    resident: brackets('2', 'Resident income tax brackets'),
    lito: brackets('8', 'Low income tax offset'),
    medicare: brackets('14', 'Medicare levy + shade-in'),
    help: brackets('19', 'HELP/STSL repayment (marginal from 2025-26)'),
    mlsSingle: brackets('10', 'Medicare levy surcharge, single'),
    mlsFamily: brackets('11', 'Medicare levy surcharge, family'),
  },

  /* ⚠ NOT IN THE CDN JSON, or in it but stale. Every entry names its source page,
   * because these are the ones a future reader will most want to re-check. */
  manual: {
    medicareRate: {
      value: 0.02,
      source: 'https://www.ato.gov.au/tax-rates-and-codes/tax-rates-australian-residents',
    },
    // Legislated by Treasury Laws Amendment (Tax Reform No. 1) Act 2026. Applies to
    // the 2026-27 return — i.e. this year. It is the reason a deduction tracker is
    // not the product it looks like: for most people the honest answer is now
    // "claim the standard $1,000 and stop".
    standardDeductionCents: {
      value: 100000,
      source: 'https://www.ato.gov.au/about-ato/new-legislation/in-detail/individuals/standard-deduction-for-work-related-expenses',
    },
    superGuaranteeRate: {
      value: 0.12,
      source: 'https://www.ato.gov.au/tax-rates-and-codes/key-superannuation-rates-and-thresholds/super-guarantee',
    },
    // ⚠ OVERRIDES THE CDN. See the header: the JSON's newest MLS rows are effective
    // 2025-07-01 with DT_END 9999-12-31, so they pass an "effective now" filter while
    // being last year's thresholds. These are the published 2026-27 figures.
    mlsSingleOverride: {
      value: [
        { maxCents: 10500000, rate: 0 },
        { maxCents: 12300000, rate: 0.01 },
        { maxCents: 16400000, rate: 0.0125 },
        { maxCents: Number.MAX_SAFE_INTEGER, rate: 0.015 },
      ],
      source: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates',
    },
    // Same problem, same fix. Plus: the family threshold rises by $1,500 for each
    // MLS dependent child AFTER the first.
    mlsFamilyOverride: {
      value: [
        { maxCents: 21000000, rate: 0 },
        { maxCents: 24600000, rate: 0.01 },
        { maxCents: 32800000, rate: 0.0125 },
        { maxCents: Number.MAX_SAFE_INTEGER, rate: 0.015 },
      ],
      perExtraChildCents: 150000,
      source: 'https://www.ato.gov.au/individuals-and-families/medicare-and-private-health-insurance/medicare-levy-surcharge/medicare-levy-surcharge-income-thresholds-and-rates',
    },
  },
};

/* ── report ────────────────────────────────────────────────────────────────── */

console.log('\nWhat each group actually matched:');
const report = (name, o) => {
  const stale = o.effectiveFrom < FY_START;
  const v = o.verified;
  const tag = !stale ? '' : !v ? '   <-- UNCHECKED' : v.matches ? '   (older date, verified current)' : '   <-- STALE, overridden';
  console.log(`  ${name.padEnd(28)} effective ${o.effectiveFrom}  ${(o.bands || o.rows).length} rows${tag}`);
};
Object.entries(tables.withholding).forEach(([k, v]) => report('withholding.' + k, v));
Object.entries(tables.annual).forEach(([k, v]) => report('annual.' + k, v));

if (warnings.length) {
  console.log('\n' + '='.repeat(76));
  console.log('WARNINGS — the ATO has not published these for ' + FY_LABEL + ':');
  warnings.forEach((w) => console.log('  * ' + w));
  console.log('Check the HTML pages and add an override under `manual` if the figures differ.');
  console.log('='.repeat(76));
}

if (CHECK_ONLY) { console.log('\n--check: nothing written.'); process.exit(warnings.length ? 1 : 0); }

const banner = `/* tax-tables.js — GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Built ${tables.builtAt} by tools/build-tax-tables.mjs from the ATO's published
 * data. Australian financial year ${FY_LABEL} (${FY_START} to ${tables.effectiveTo}).
 *
 * Source: https://onlineservices.ato.gov.au/cdn/static-data/codes-tables/
 *   TC9GENTAC.json (Schedule 1 and 8 withholding coefficients)
 *   TC2TAXRTE.json (annual brackets, offsets, Medicare, HELP)
 * Licensed CC BY 4.0 by the Australian Taxation Office. payday is not endorsed by
 * or affiliated with the ATO.
 *
 * To rebuild in July:  node tools/build-tax-tables.mjs
 * ⚠ Read that script's header first — a group the ATO has not yet updated returns
 * LAST YEAR'S numbers with an open end date, and looks perfectly current.
 */
`;

writeFileSync(OUT, banner + 'window.TaxTables = ' + JSON.stringify(tables, null, 2) + ';\n');
console.log(`\nWrote ${OUT}`);
console.log(`${Object.keys(tables.withholding).length} withholding scales, ` +
            `${Object.keys(tables.annual).length} annual tables, ` +
            `${Object.keys(tables.manual).length} manual entries.`);
