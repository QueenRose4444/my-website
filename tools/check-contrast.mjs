#!/usr/bin/env node
/* check-contrast.mjs — enforce the token palette's contrast, by measurement.
 *
 * The web port of film-manager's contrast_report()
 * (crates/fm-app/src/theme.rs:184-214, unit-tested at 771-782). Porting the
 * CHECK matters more than porting the hex values: the hexes are a snapshot,
 * this is what keeps them honest as they change.
 *
 *   node tools/check-contrast.mjs            # check tokens.css
 *   node tools/check-contrast.mjs --verbose  # show passing rows too
 *
 * Exits non-zero if anything fails. No dependencies.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKENS = join(HERE, '..', 'shared', 'tokens.css');
const VERBOSE = process.argv.includes('--verbose');

/* ── colour maths ────────────────────────────────────────────────────────── */

const srgbToLinear = (c) =>
  c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);

function parseColor(str) {
  const s = String(str).trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((h) => parseInt(h + h, 16));
    return { r, g, b, a: 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(s);
  if (m) {
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  }
  return null;
}

/** Flatten a translucent colour over an opaque background. */
function composite(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

function luminance({ r, g, b }) {
  const [R, G, B] = [r, g, b].map((v) => srgbToLinear(v / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/** WCAG 2.x contrast ratio. Translucent foregrounds are flattened over bg. */
/**
 * Flatten `accent` at `alpha` over `bg` into an opaque colour string — i.e. what
 * --accent-soft actually looks like once painted. Needed because accent text most
 * often sits on that tint rather than on the panel.
 */
function flatten(accentStr, alpha, bgStr) {
  const a = parseColor(accentStr), b = parseColor(bgStr);
  if (!a || !b) return null;
  const mix = (x, y) => Math.round(x * alpha + y * (1 - alpha));
  return `rgb(${mix(a.r, b.r)}, ${mix(a.g, b.g)}, ${mix(a.b, b.b)})`;
}

function contrast(fgRaw, bgRaw) {
  const bg = parseColor(bgRaw);
  let fg = parseColor(fgRaw);
  if (!fg || !bg) return null;
  fg = composite(fg, bg);
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── parse tokens.css ────────────────────────────────────────────────────── */

function block(css, selector) {
  const i = css.indexOf(selector);
  if (i === -1) return null;
  const open = css.indexOf('{', i);
  let depth = 0;
  for (let j = open; j < css.length; j++) {
    if (css[j] === '{') depth++;
    else if (css[j] === '}' && --depth === 0) return css.slice(open + 1, j);
  }
  return null;
}

function declarations(body) {
  const out = {};
  if (!body) return out;
  /* ⚠ STRIP COMMENTS FIRST. A prose comment mentioning a token by name —
   * "--accent-text, not --accent: an amount is TEXT" — matches the declaration
   * regex and silently overwrites the real value with the rest of the sentence.
   * The symptom is a contrast of "n/a" rather than an error, which sends you
   * looking at the palette instead of at the parser. */
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of clean.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

/** Resolve one level of var(--x) indirection. */
function resolve(tokens) {
  const out = { ...tokens };
  for (const [k, v] of Object.entries(out)) {
    const m = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v);
    if (m && out[m[1]]) out[k] = out[m[1]];
  }
  return out;
}

const css = readFileSync(TOKENS, 'utf8');
const dark = resolve(declarations(block(css, ':root {')));

/* Light is an OVERRIDE LAYER, not a complete set — the cascade means it
 * inherits everything :root declared and only replaces what it restates. The
 * checker must model that, or tokens like --money-projected (declared once on
 * :root as var(--ink-dim)) read as missing in light and produce a phantom
 * failure. Merge first, then resolve, so var() indirection picks up the
 * light values. */
const lightOverrides = declarations(block(css, ':root[data-theme="light"]'));
const light = resolve({ ...declarations(block(css, ':root {')), ...lightOverrides });

/* The system-preference block must match the explicit one. They are written
 * twice by necessity and drift silently — which is exactly the kind of bug that
 * only shows up on someone else's machine. */
/* For the drift check, compare what each light block LITERALLY DECLARES —
 * unmerged and unresolved. Comparing the merged/resolved sets would report every
 * token inherited from :root as "missing" from one side, which is an artifact of
 * the comparison rather than real drift. */
const mq = block(css, '@media (prefers-color-scheme: light)');
const mqOverrides = declarations(block(mq ?? '', ':root:not([data-theme="dark"])'));

/* ── the requirements ────────────────────────────────────────────────────── */

// [foreground, background, minimum, label]
const PAIRS = [
  ['--ink',        '--ground',  4.5, 'body text on page'],
  ['--ink',        '--surface', 4.5, 'body text on panel'],
  ['--ink-dim',    '--surface', 4.5, 'secondary text'],
  ['--ink-dim',    '--ground',  4.5, 'secondary text on page'],
  ['--ink-faint',  '--surface', 3.0, 'placeholder/disabled'],
  ['--accent-ink', '--accent',  4.5, 'label on accent fill'],

  /* ⚠ --accent-text is TEXT, so it wants 4.5:1, not the 3.0 a UI component gets.
   * These three exist because splitting --accent into a fill and a text variant only
   * helps if something checks the text variant — otherwise the next person "tidies"
   * them back into one token and the light theme quietly becomes unreadable again. */
  ['--accent-text', '--ground',  4.5, 'accent as text on the page'],
  ['--accent-text', '--surface', 4.5, 'accent as text on a panel'],
  /* --safe is split the same way --accent is: a donut slice (fill) and the colour of
   * every incoming amount (text). The fill is exempt in light mode alongside the
   * accent; the TEXT variant is not, and is checked on both surfaces. */
  ['--safe-text',  '--ground',  4.5, 'incoming amount on the page'],
  ['--safe-text',  '--surface', 4.5, 'incoming amount on a panel'],
  ['--warn',       '--ground',  3.0, 'warn as UI component'],
  ['--danger',     '--ground',  3.0, 'danger as UI component'],
  /* The focus ring is only ever measured against --ground and --surface, and
   * that is sufficient BECAUSE tokens.css draws a 2px separator of --ground in
   * the outline-offset gap. Without that separator a ring on an accent-filled
   * button would sit on the accent, where no single ring colour can reach 3:1
   * against all five presets AND the page background — measured: 1.02-1.36.
   * The separator is load-bearing, not decoration. Do not remove it. */
  ['--focus-ring', '--ground',  3.0, 'focus ring on page'],
  ['--focus-ring', '--surface', 3.0, 'focus ring on panel'],

  /* --line is decorative (dividers) and exempt. --line-strong bounds a control
   * and therefore carries meaning, so it must hold 3:1. */
  ['--line-strong', '--surface', 3.0, 'input/control border'],
  ['--line-strong', '--ground',  3.0, 'control border on page'],
  ['--money-projected', '--surface', 4.5, 'projected figures are real text'],
];

/* Accent presets. Each must work in its own theme against that theme's ground,
 * and must carry a label colour that reads on it. */
/* WARNING: READ FROM theme.js, DO NOT COPY. This file used to keep its own
 * transcription of the preset table, which went stale the moment theme.js changed —
 * the checker then cheerfully verified colours nothing was using. One source,
 * parsed. If this regex ever stops matching, the run FAILS rather than silently
 * checking zero presets. */
const PRESETS = (() => {
  const js = readFileSync(join(HERE, '..', 'shared', 'theme.js'), 'utf8');
  const m = /var PRESETS = \{([\s\S]*?)\};/.exec(js);
  if (!m) return null;
  const out = {};
  for (const row of m[1].matchAll(/(\w+)\s*:\s*\{([^}]*)\}/g)) {
    const entry = {};
    for (const kv of row[2].matchAll(/(\w+)\s*:\s*'(#[0-9a-fA-F]{6})'/g)) entry[kv[1]] = kv[2];
    out[row[1]] = entry;
  }
  return Object.keys(out).length ? out : null;
})();

/* ── run ─────────────────────────────────────────────────────────────────── */

let failures = 0;
/* Pairs we knowingly do not enforce. Printed at the end with their real numbers:
 * an exemption nobody can see is indistinguishable from a bug. */
const exempt = [];
function ratioOf(fg, bg, tokens) {
  const c = contrast(tokens[fg], tokens[bg]);
  return c === null ? null : c;
}
let checks = 0;

const fmt = (n) => (n === null ? '  n/a' : n.toFixed(2).padStart(5));

function check(label, fg, bg, min, tokens) {
  const fgv = tokens[fg] ?? fg;
  const bgv = tokens[bg] ?? bg;
  const ratio = contrast(fgv, bgv);
  checks++;
  const ok = ratio !== null && ratio >= min;
  if (!ok) failures++;
  if (!ok || VERBOSE) {
    console.log(
      `  ${ok ? 'pass' : 'FAIL'}  ${fmt(ratio)} (need ${min.toFixed(1)})  ` +
      `${fg} on ${bg}  — ${label}`
    );
  }
  return ratio;
}

function runTheme(name, tokens) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);
  if (!Object.keys(tokens).length) {
    console.log('  FAIL  could not parse any tokens for this theme');
    failures++;
    return;
  }
  for (const [fg, bg, min, label] of PAIRS) check(label, fg, bg, min, tokens);

  // Every preset accent, against this theme's surfaces.
  if (!PRESETS) {
    console.log('  FAIL  could not read PRESETS out of theme.js — 0 presets checked');
    failures++;
    return;
  }
  const mode = name.startsWith('dark') ? 'dark' : 'light';
  for (const [preset, hexes] of Object.entries(PRESETS)) {
    const accent = hexes[mode];
    const accentText = hexes[mode + 'Text'] || accent;
    const t = { ...tokens, '--accent': accent, '--accent-text': accentText };
    /* ⚠ --accent vs the page is NOT asserted — see the FILL EXEMPTION in tokens.css
     * (D-42). It is reported below so the cost stays visible, but it does not fail
     * the run. Everything the user has to READ still has to pass. */
    exempt.push([preset, mode, ratioOf('--accent', '--ground', t), ratioOf('--accent', '--surface', t)]);
    check(`preset "${preset}" label`, '--accent-ink', '--accent', 4.5, t);
    check(`preset "${preset}" as text`, '--accent-text', '--ground', 4.5, t);

    /* ⚠ THE HARDEST CASE, and the one that decided the derivation.
     *
     * Accent text is most often drawn on a PILL of --accent-soft (a 14% tint of the
     * accent over the panel), not on the panel itself. In the light theme that tint
     * is PALER than the ground, so a value that clears 4.5:1 on the ground can still
     * fail here — by 0.07 for rose, when this was first modelled. Deriving against
     * the pill instead makes every other surface pass for free. */
    const solid = flatten(accent, 0.14, t['--surface']);
    if (solid) {
      check(`preset "${preset}" as text on its own tint`,
            '--accent-text', '--accent-soft-solid', 4.5, { ...t, '--accent-soft-solid': solid });
    }
  }
}

console.log('check-contrast — measuring tokens.css against WCAG 2.2 AA');

runTheme('dark (default)', dark);
runTheme('light (explicit)', light);

console.log(`\n── light: explicit vs system-preference block ${'─'.repeat(20)}`);
if (!Object.keys(mqOverrides).length) {
  console.log('  FAIL  the prefers-color-scheme block is missing or unparsed');
  failures++;
} else {
  let drift = 0;
  const keys = new Set([...Object.keys(lightOverrides), ...Object.keys(mqOverrides)]);
  for (const k of keys) {
    const a = lightOverrides[k];
    const b = mqOverrides[k];
    if (a !== b) {
      console.log(`  FAIL  ${k}: explicit "${a ?? '(absent)'}" vs system "${b ?? '(absent)'}"`);
      drift++;
    }
  }
  failures += drift;
  checks += keys.size;
  if (!drift) {
    console.log(`  pass  both light blocks declare the same ${keys.size} overrides`);
  }
}

/* WARNING: print the exemption every run, with its real numbers. An exemption
 * nobody can see is indistinguishable from a bug -- and the point of recording it is
 * that the next person inherits the DECISION, not just the result. */
if (exempt.length) {
  console.log('\n-- fill exemption (D-42) -- reported, NOT enforced ------------------');
  console.log('  --accent is a FILL. Vivid beats compliant here, by an explicit call.');
  console.log('  Everything the user has to READ (--accent-text, --accent-ink) still passes.');
  const fmtR = (x) => (x === null ? '  n/a' : x.toFixed(2).padStart(5));
  for (const [preset, mode, g, sf] of exempt) {
    const okAnyway = g !== null && g >= 3.0 && sf !== null && sf >= 3.0 ? '  (would pass anyway)' : '';
    console.log('  ' + (preset + ' / ' + mode).padEnd(16) + ' vs ground ' + fmtR(g) + '  vs panel ' + fmtR(sf) + okAnyway);
  }
}

console.log(
  `\n${failures ? 'FAILED' : 'OK'} — ${checks - failures}/${checks} checks passed` +
  (failures ? `, ${failures} failure${failures === 1 ? '' : 's'}` : '')
);
if (!failures && !VERBOSE) console.log('(run with --verbose to see every row)');

process.exit(failures ? 1 : 0);
