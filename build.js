// build.js — the Cloudflare Pages build.
//
// Copies the site into public/ and renames page files to index.html, as it always
// has. It also makes the parts that differ between the live and wip sites from the
// branch being built, so the same page files can sit on both branches and promoting
// one needs no hand edits:
//
//   master  (rosestuffs.org)      indexable; sitemap.xml served; and a GUARD that
//                                 fails the build — so nothing deploys and live keeps
//                                 its previous version — if anything published would
//                                 name a person, a private host or an internal
//                                 tracking id, load a wip module, or noindex a page.
//   any other branch              noindex on every response, no sitemap, and the same
//                                 guard as warnings only.
//
// Which environment a page talks to is decided in the browser, from its address (see
// SiteEnv in the auth module), not here.
//
// Cloudflare sets CF_PAGES_BRANCH on every Pages build. To see what a live build
// would do from here:   CF_PAGES_BRANCH=master node build.js
const fs = require('fs');
const path = require('path');

const OUT = 'public';
const BRANCH = process.env.CF_PAGES_BRANCH || '';
const IS_LIVE = BRANCH === 'master';

if (process.env.CF_PAGES && !BRANCH) {
    console.error('build: CF_PAGES is set but CF_PAGES_BRANCH is not. Refusing to guess which site this is.');
    process.exit(1);
}

// ── copy ────────────────────────────────────────────────────────────────────────
// Never published: the build itself, dev tooling, notes, and dotfiles at any depth.
const SKIP_TOP = new Set([OUT, 'node_modules', 'build.js', 'build.js.bkup.js', 'package.json',
    'package-lock.json', 'tools', 'readme.md', 'README.md']);

function copyRecursive(src, dest) {
    if (fs.statSync(src).isDirectory()) {
        fs.mkdirSync(dest, { recursive: true });
        for (const child of fs.readdirSync(src)) {
            if (child.startsWith('.')) continue;
            copyRecursive(path.join(src, child), path.join(dest, child));
        }
    } else {
        fs.copyFileSync(src, dest);
    }
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const item of fs.readdirSync('.')) {
    if (item.startsWith('.') || SKIP_TOP.has(item)) continue;
    copyRecursive(item, path.join(OUT, item));
}

// Rename every page file to index.html (so /meds/meds.html is served at /meds/).
function renameHtmlFiles(dir) {
    for (const file of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            renameHtmlFiles(fullPath);
        } else if (file.endsWith('.html') && file !== 'index.html' && file !== 'templates.html'
            && file !== 'google964648a23408580a.html') {
            const newPath = path.join(dir, 'index.html');
            fs.renameSync(fullPath, newPath);
            console.log(`Renamed: ${fullPath} -> ${newPath}`);
        }
    }
}
renameHtmlFiles(OUT);

// ── the branch-specific parts ───────────────────────────────────────────────────
if (BRANCH) fs.writeFileSync(path.join(OUT, '_branch.txt'), BRANCH + '\n');

if (!IS_LIVE) {
    // Never indexed, whatever a page says. The header goes INSIDE the existing `/*`
    // rule: Cloudflare keeps one rule per identical pattern, so a second `/*` block
    // silently replaces the first — which is exactly how the first version of this
    // lost the noindex.
    const headersPath = path.join(OUT, '_headers');
    const existing = fs.existsSync(headersPath) ? fs.readFileSync(headersPath, 'utf8').replace(/\r\n/g, '\n') : '';
    if (!/X-Robots-Tag:\s*noindex/i.test(existing)) {
        const lines = existing.split('\n');
        const at = lines.findIndex(l => l.trim() === '/*');
        const header = '  X-Robots-Tag: noindex, nofollow';
        if (at === -1) lines.unshift('/*', header, '');
        else lines.splice(at + 1, 0, header);
        fs.writeFileSync(headersPath, lines.join('\n'));
    }
    const written = fs.readFileSync(headersPath, 'utf8');
    if ((written.match(/^\/\*\s*$/gm) || []).length !== 1 || !/X-Robots-Tag:\s*noindex/.test(written)) {
        console.error('build: _headers must end up with exactly one /* rule carrying the noindex.');
        process.exit(1);
    }
    // A sitemap is an invitation to index. Only the live site sends one.
    fs.rmSync(path.join(OUT, 'sitemap.xml'), { force: true });
}

// ── the guard ───────────────────────────────────────────────────────────────────
// The site's repository is public and so is everything it serves. On master a hit
// fails the build; elsewhere it is listed so it can be cleaned before a promotion.
//
// The words that identify people and private machines are deliberately NOT written
// here — this file is public too. They come from the GUARD_PRIVATE_TERMS build
// variable (comma-separated; set in the Pages project), or, for a local run, from a
// `.guard-terms` file one level ABOVE the site folder, so it can never be published.
const TEXT = /\.(html?|js|mjs|css|json|txt|xml|svg|md|webmanifest)$/i;

function privateTerms() {
    let raw = process.env.GUARD_PRIVATE_TERMS || '';
    const local = path.join(__dirname, '..', '.guard-terms');
    if (!raw && fs.existsSync(local)) raw = fs.readFileSync(local, 'utf8').replace(/\n/g, ',');
    return raw.split(',').map(s => s.trim()).filter(s => s && !s.startsWith('#'));
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERMS = privateTerms();

const RULES = [
    { what: 'loads a wip module', re: /\/(auth|sync)-wip\.js/, files: /\.html?$/i },
    { what: 'noindexes a page', re: /<meta[^>]+name=["']robots["'][^>]+noindex/i, files: /\.html?$/i },
    // A whole address standing on its own (in a URL, a string, after a space) — not
    // four numbers that happen to sit together inside an SVG drawing path.
    { what: 'names a private network address',
        re: /(?:^|[\s"'`(=@]|\/\/)(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?=$|[\s"'`:/),;])/ },
    { what: 'carries an internal tracking id', re: /\b[TDI]-\d{2,3}[a-c]?\b/ },
];
if (TERMS.length) {
    RULES.push({ what: 'names a person or a private machine',
        // Case-sensitive on purpose: a capitalised name is a person, "rose-coloured" is not.
        re: new RegExp('\\b(' + TERMS.map(escapeRe).join('|') + ')\\b') });
} else {
    console.log('\nwarning: no private terms configured (GUARD_PRIVATE_TERMS), so names and private ' +
        'hostnames were NOT checked.');
}

const hits = new Map(RULES.map(r => [r, []]));
function scan(dir) {
    for (const file of fs.readdirSync(dir)) {
        const full = path.join(dir, file);
        if (fs.statSync(full).isDirectory()) { scan(full); continue; }
        if (!TEXT.test(file) || file === '_headers') continue;
        const lines = fs.readFileSync(full, 'utf8').split('\n');
        for (const rule of RULES) {
            if (rule.files && !rule.files.test(file)) continue;
            lines.forEach((line, i) => {
                const m = line.match(rule.re);
                if (m) hits.get(rule).push(`${path.relative(OUT, full)}:${i + 1}  ${m[0]}`);
            });
        }
    }
}
scan(OUT);

let total = 0;
for (const [rule, list] of hits) {
    if (!list.length) continue;
    total += list.length;
    console.log(`\n${IS_LIVE ? 'BLOCKED' : 'warning'}: ${list.length} place(s) ${rule.what}`);
    list.slice(0, 15).forEach(h => console.log('  ' + h));
    if (list.length > 15) console.log(`  … and ${list.length - 15} more`);
}

if (total && IS_LIVE) {
    console.error(`\nbuild: refusing to publish the live site — ${total} problem(s) above. Nothing was deployed.`);
    process.exit(1);
}
console.log(`\nBuild complete (${BRANCH || 'no branch set'}${total ? `, ${total} warning(s)` : ''}).`);
