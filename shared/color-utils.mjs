/* color-utils.mjs — colour maths shared by the accent picker and the checker.
 * ---------------------------------------------------------------------------
 * ESM, no dependencies, works unchanged in the browser and in Node. It is
 * deliberately separate from theme.js: theme.js must be a synchronous classic
 * script (a module would be deferred and cause a flash), and none of this is
 * needed on the fast path.
 *
 * ONE implementation, used by both the runtime picker and tools/check-contrast.mjs.
 * Two copies would drift, and the whole point of the checker is that the thing
 * it validates is the thing that ships.
 *
 * OKLab/OKLCH conversions after Björn Ottosson (2020).
 */

/* ── sRGB ────────────────────────────────────────────────────────────────── */

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function toHex({ r, g, b }) {
  const h = (v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`.toUpperCase();
}

/* ── OKLab / OKLCH ───────────────────────────────────────────────────────── */

export function rgbToOklab({ r, g, b }) {
  const R = toLinear(r / 255), G = toLinear(g / 255), B = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  };
}

export function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return {
    r: clamp01(toGamma( 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)) * 255,
    g: clamp01(toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)) * 255,
    b: clamp01(toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)) * 255,
  };
}

export function rgbToOklch(rgb) {
  const { L, a, b } = rgbToOklab(rgb);
  return { L, C: Math.hypot(a, b), h: (Math.atan2(b, a) * 180) / Math.PI };
}

export function oklchToRgb({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return oklabToRgb({ L, a: C * Math.cos(rad), b: C * Math.sin(rad) });
}

/* ── contrast ────────────────────────────────────────────────────────────── */

export function luminance({ r, g, b }) {
  return 0.2126 * toLinear(r / 255) + 0.7152 * toLinear(g / 255) + 0.0722 * toLinear(b / 255);
}

/** WCAG 2.x contrast ratio between two opaque colours. */
export function contrast(fg, bg) {
  const a = luminance(typeof fg === 'string' ? parseHex(fg) : fg);
  const b = luminance(typeof bg === 'string' ? parseHex(bg) : bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Flatten a translucent colour over an opaque background before measuring. */
export function composite(fg, bg, alpha) {
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

/** Whichever of near-black / near-white reads better on `bg`. */
export function inkFor(bg, dark = '#16131A', light = '#FFFFFF') {
  return contrast(dark, bg) >= contrast(light, bg) ? dark : light;
}

/* ── the derivation ──────────────────────────────────────────────────────── */

/**
 * Take the hue and chroma the user picked and find a LIGHTNESS that actually
 * works on this theme's background.
 *
 * The problem this solves: a colour input lets someone choose #3A0A12, which is
 * a perfectly reasonable pink and completely illegible on a near-black page.
 * Rejecting it is unhelpful ("no" with no path forward); accepting it produces
 * an unreadable UI. So: keep their hue, move the lightness.
 *
 * Search direction depends on the theme — on a dark ground we need a LIGHTER
 * accent, on a light ground a DARKER one. Chroma is reduced only if hue and
 * lightness alone cannot reach the target, which happens near the gamut edge
 * for saturated blues and violets.
 *
 * @returns {{hex, ink, ratio, adjusted, L, C, h}}
 */
export function deriveAccent(
  input, ground,
  { minRatio = 3.0, preferRatio = 4.5, minInkRatio = 4.5 } = {}
) {
  const rgb = typeof input === 'string' ? parseHex(input) : input;
  if (!rgb) return null;
  const bg = typeof ground === 'string' ? parseHex(ground) : ground;

  const { L: L0, C: C0, h } = rgbToOklch(rgb);
  const bgLum = luminance(bg);
  const wantLighter = bgLum < 0.18;          // dark ground → go lighter

  const ok = (c, target) => {
    const r = contrast(c, bg);
    const ink = inkFor(c);
    return r >= target && contrast(ink, c) >= minInkRatio
      ? { hex: toHex(c), ink, ratio: r } : null;
  };

  // Already fine? Keep exactly what was asked for — never "improve" a colour
  // that already works. The user picked it.
  const asIs = ok(oklchToRgb({ L: L0, C: C0, h }), minRatio);
  if (asIs) return { ...asIs, adjusted: false, L: L0, C: C0, h };

  /* Two passes. The first aims for `preferRatio`, the second settles for
   * `minRatio`. Without this the walk stops at the FIRST lightness that clears
   * the bar — i.e. the least readable colour that is technically legal, landing
   * every derived accent at exactly 3.0x. Aiming higher first gives a
   * comfortable result and only accepts a marginal one when the hue leaves no
   * choice. */
  for (const target of [preferRatio, minRatio]) {
    for (const C of [C0, C0 * 0.85, C0 * 0.7, C0 * 0.55, C0 * 0.4]) {
      for (let i = 0; i <= 100; i++) {
        const L = wantLighter ? L0 + (1 - L0) * (i / 100) : L0 * (1 - i / 100);
        const cand = ok(oklchToRgb({ L, C, h }), target);
        if (cand) return { ...cand, adjusted: true, L, C, h };
      }
    }
  }

  // Nothing in this hue works — fall back to the ink colour rather than lying.
  const fallback = parseHex(inkFor(bg));
  return {
    hex: toHex(fallback), ink: inkFor(fallback), ratio: contrast(fallback, bg),
    adjusted: true, failed: true, L: L0, C: C0, h,
  };
}

/**
 * Measure the usable lightness band for a given background, by sampling hues
 * all the way round the wheel. This is how the L bands quoted in
 * plans/01-design-system.md get MEASURED rather than guessed.
 */
export function measureLightnessBand(ground, { C = 0.12, minRatio = 3.0, step = 15 } = {}) {
  const bg = typeof ground === 'string' ? parseHex(ground) : ground;
  let lo = 1, hi = 0, worstHue = null, worstSpan = Infinity;

  for (let h = 0; h < 360; h += step) {
    let first = null, last = null;
    for (let i = 0; i <= 200; i++) {
      const L = i / 200;
      if (contrast(oklchToRgb({ L, C, h }), bg) >= minRatio) {
        if (first === null) first = L;
        last = L;
      }
    }
    if (first === null) { worstHue = h; worstSpan = 0; continue; }
    lo = Math.min(lo, first); hi = Math.max(hi, last);
    if (last - first < worstSpan) { worstSpan = last - first; worstHue = h; }
  }
  return { widest: [lo, hi], narrowestSpan: worstSpan, narrowestHue: worstHue, C };
}
