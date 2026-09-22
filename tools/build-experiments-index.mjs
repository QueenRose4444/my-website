#!/usr/bin/env node
// Build experiments/experiments.html from the experiment pages themselves.
//
// The list used to be maintained by hand, which is why the page shipped with a
// commented-out <section> template for "add the next one here" — and why three of its
// preview images pointed at files that do not exist. A page you forget to add is
// invisible; a page you delete leaves a dead card. Neither is detectable by looking.
//
// So: every directory under experiments/ with an HTML entry point is listed, unless it
// opts out. The data lives WITH the page, in its own <head>, because that is the one
// place nobody editing the page can miss:
//
//     <meta name="experiment" content="hidden">          <!-- keep it off the index -->
//     <meta name="experiment-name" content="...">        <!-- else <title> -->
//     <meta name="experiment-blurb" content="...">       <!-- else <meta description> -->
//     <meta name="experiment-order" content="10">        <!-- else alphabetical by name -->
//
// A directory with no HTML file is skipped silently — that covers med-board, which is
// gitignored and exists only on the dev host.
//
// PREVIEW IMAGES: /images/experiments/<dir>.png is used only if the file actually
// exists. If it does not, the card gets a CSS placeholder rather than an <img> to
// nowhere. That matters more than it sounds: a missing path on this site returns the
// home page with HTTP 200, so a broken preview delivers 4 KB of HTML into an <img> and
// fails silently in a way no status check would ever catch.
//
// Run it after adding, renaming or removing an experiment:
//     node tools/build-experiments-index.mjs
//     node tools/build-experiments-index.mjs --check    # CI-style: fail if stale
//
// It runs per branch, over whatever that branch actually contains, so master and wip
// each get an index of their own pages.

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPERIMENTS = join(ROOT, 'experiments');
const OUT = join(EXPERIMENTS, 'experiments.html');
const IMAGES = join(ROOT, 'images', 'experiments');

// An attribute's value is ENCODED in the source — a name containing "&" is stored as
// "&amp;". Decode on the way in, or escaping it again on the way out gives "&amp;amp;".
const decode = s => String(s ?? '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&amp;/g, '&');   // &amp; LAST, or "&amp;lt;" would decode twice

const meta = (html, name) => {
  // attribute order varies across these pages, so match either way round
  const a = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']*)["']`, 'i').exec(html);
  const b = new RegExp(`<meta\\s+content=["']([^"']*)["']\\s+name=["']${name}["']`, 'i').exec(html);
  const v = (a || b)?.[1];
  return v != null ? (decode(v).trim() || null) : null;
};

const titleOf = html => {
  const t = decode(/<title>([^<]*)<\/title>/i.exec(html)?.[1] ?? '').trim();
  if (!t) return null;
  // strip the site suffix the templates add — it is noise on a card
  return t.replace(/\s*[-|·]\s*(My Site|RoseStuffs)\s*$/i, '').trim() || null;
};

const esc = s => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Prefer index.html; that is the entry point the build renames everything else TO. */
function entryPoint(dir) {
  const full = join(EXPERIMENTS, dir);
  if (!statSync(full).isDirectory()) return null;
  const files = readdirSync(full).filter(f => f.toLowerCase().endsWith('.html'));
  if (!files.length) return null;
  return files.includes('index.html') ? 'index.html' : files.sort()[0];
}

/** Initials for the placeholder — "steam_update_checker" -> "SU". */
const initials = name => name.split(/[\s_\-]+/).filter(Boolean).slice(0, 2)
  .map(w => w[0].toUpperCase()).join('') || '?';

/**
 * Paths git actually tracks under experiments/.
 *
 * A page that is untracked or gitignored will NEVER be served by Pages, which deploys
 * from the repository — so listing it would publish a link to a 404. Worse than a 404
 * here: a missing path answers 200 with the home page, so the card would look like it
 * worked and quietly take people somewhere wrong.
 *
 * Two things this catches, both of which were sitting in the tree when it was written:
 * the gitignored med-board (deliberately kept off Pages), and a work-in-progress
 * experiment nobody had committed yet.
 *
 * Returns null outside a git checkout, in which case nothing is filtered — a
 * non-repository has no opinion about what is publishable.
 */
function trackedPaths() {
  try {
    const out = execFileSync('git', ['ls-files', '--', 'experiments'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const set = new Set(out.split('\n').filter(Boolean).map(p => p.replace(/\\/g, '/')));
    return set.size ? set : null;
  } catch {
    return null;   // not a git checkout, or git is unavailable
  }
}

function collect() {
  const out = [], skipped = [], noBlurb = [];
  const tracked = trackedPaths();
  for (const dir of readdirSync(EXPERIMENTS).sort()) {
    const full = join(EXPERIMENTS, dir);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    const entry = entryPoint(dir);
    if (!entry) { skipped.push(`${dir} (no html entry point)`); continue; }
    if (tracked && !tracked.has(`experiments/${dir}/${entry}`)) {
      skipped.push(`${dir} (not tracked by git — Pages would never serve it)`);
      continue;
    }

    const html = readFileSync(join(full, entry), 'utf8');
    if ((meta(html, 'experiment') || '').toLowerCase() === 'hidden') {
      skipped.push(`${dir} (opted out)`);
      continue;
    }

    const name = meta(html, 'experiment-name') || titleOf(html) || dir;
    const blurb = meta(html, 'experiment-blurb') || meta(html, 'description') || '';
    if (!blurb) noBlurb.push(dir);
    const orderRaw = meta(html, 'experiment-order');
    const order = orderRaw != null && orderRaw !== '' ? Number(orderRaw) : null;

    const png = join(IMAGES, `${dir}.png`);
    const altPng = join(IMAGES, `${dir.replace(/_/g, '-')}.png`);
    const image = existsSync(png) ? `/images/experiments/${dir}.png`
      : existsSync(altPng) ? `/images/experiments/${dir.replace(/_/g, '-')}.png`
        : null;

    out.push({ dir, name, blurb, order, image });
  }
  // explicit order first, then everything else by name
  out.sort((a, b) => {
    if (a.order != null && b.order != null) return a.order - b.order;
    if (a.order != null) return -1;
    if (b.order != null) return 1;
    return a.name.localeCompare(b.name);
  });
  return { out, skipped, noBlurb };
}

function card(e) {
  const media = e.image
    ? `<div class="experiment-image">
                    <img src="${esc(e.image)}" alt="${esc(e.name)} preview" loading="lazy">
                </div>`
    : `<div class="experiment-image is-placeholder" aria-hidden="true">
                    <span>${esc(initials(e.name))}</span>
                </div>`;
  return `        <section class="experiment">
            <a href="${esc(e.dir)}" class="experiment-link">
                ${media}
                <div class="experiment-info">
                    <h2>${esc(e.name)}</h2>
                    ${e.blurb ? `<p>${esc(e.blurb)}</p>` : ''}
                </div>
            </a>
        </section>`;
}

function render(entries, existing) {
  // Keep everything outside <main> exactly as it is — nav, head, footer are the
  // template's business, not this script's. Only the card list is generated.
  const open = existing.indexOf('<main class="experiments-content">');
  const close = existing.indexOf('</main>', open);
  if (open < 0 || close < 0) throw new Error('could not find <main class="experiments-content"> … </main>');

  const body = [
    '<main class="experiments-content">',
    '        <h1>My Experiments</h1>',
    '',
    '        <!-- GENERATED by tools/build-experiments-index.mjs — do not edit these cards by hand.',
    '             Each one comes from the experiment page\'s own <head>. To change a card, edit that',
    '             page; to keep a page off this list, add <meta name="experiment" content="hidden">. -->',
    '',
    entries.map(card).join('\n\n'),
    '    ',
  ].join('\n');

  return existing.slice(0, open) + body + existing.slice(close);
}

/**
 * Stamp experiments.css with a hash of its own contents.
 *
 * Without this the page asks for a bare `experiments.css`, and Cloudflare caches per
 * FULL URL — so a CSS change stays invisible for up to an hour while every check you
 * run against `experiments.css?something` returns the new file and looks fine. That is
 * not hypothetical: it cost a debugging session on this very stylesheet, and the tell
 * was that the browser's own CSSOM was missing a rule `curl` could see.
 *
 * A content hash rather than a date, so the URL changes when the file does and not
 * otherwise — no churn in the diff when nothing was restyled.
 */
function stampCss(html) {
  const css = join(EXPERIMENTS, 'experiments.css');
  if (!existsSync(css)) return html;
  const v = createHash('sha256').update(readFileSync(css)).digest('hex').slice(0, 8);
  return html.replace(/href="experiments\.css(?:\?v=[0-9a-f]+)?"/,
    `href="experiments.css?v=${v}"`);
}

const { out, skipped, noBlurb } = collect();
const existing = readFileSync(OUT, 'utf8');
const next = stampCss(render(out, existing));

if (process.argv.includes('--check')) {
  const stale = next.replace(/\r\n/g, '\n') !== existing.replace(/\r\n/g, '\n');
  console.log(stale ? 'STALE — run without --check to regenerate' : 'up to date');
  process.exit(stale ? 1 : 0);
}

writeFileSync(OUT, next, 'utf8');
console.log(`experiments.html: ${out.length} card(s)`);
for (const e of out) {
  console.log(`   ${e.name.padEnd(28)} ${e.dir.padEnd(22)} ${e.image ? 'image' : 'placeholder'}`);
}
if (skipped.length) console.log('\nskipped:\n   ' + skipped.join('\n   '));
if (noBlurb.length) {
  console.log('\nno blurb (add <meta name="experiment-blurb" content="..."> to the page):');
  console.log('   ' + noBlurb.join('\n   '));
}
