/* theme.js — apply the stored theme before first paint.
 * ---------------------------------------------------------------------------
 * ⚠ THIS FILE MUST BE A BLOCKING SCRIPT IN <head>, BEFORE ANY STYLESHEET:
 *
 *     <script src="/theme.js?v=20260830a"></script>
 *     <link rel="stylesheet" href="/shared/tokens.css?v=20260901c">
 *
 * NOT `defer`, NOT `type="module"`, NOT at the end of <body>. All three defer
 * execution until after first paint, which is exactly the flash of wrong theme
 * this file exists to prevent. It is deliberately tiny for the same reason.
 *
 * It does the FAST PATH only: read the stored preference, set an attribute,
 * write a custom accent if there is one. Anything heavier — deriving a
 * contrast-safe accent from an arbitrary hue — lives in color-utils.mjs and
 * runs in the settings UI, which can afford to load late.
 *
 * Theme choice is PER DEVICE, not synced. A phone in bed and a desktop at noon
 * want different answers, and syncing it would make one of them wrong.
 */
(function () {
  'use strict';

  var THEME_KEY = 'rosestuffs_theme';   // 'dark' | 'light' | 'system'
  var ACCENT_KEY = 'rosestuffs_accent'; // preset name, or a JSON custom accent

  /* Presets. Each carries BOTH themes, because a hue that works on #16131A
   * cannot work on #FAF7FB — #E79BB4 on white is 1.9:1. The lightness must
   * change even though the hue does not. Values verified by
   * tools/check-contrast.mjs; do not edit one without re-running it. */
  /* ⚠ `dark` and `light` are the SAME hex on purpose — the accent is a FILL, and a
   * fill does not need to change between themes. What changes is `lightText`: the
   * same hue darkened just enough to be legible when the accent is drawn as TEXT.
   *
   * Both are computed by color-utils' deriveAccent and verified by
   * tools/check-contrast.mjs. Do not edit one without re-running it.
   *
   *   light      THE SAME HEX AS DARK. A fill is a fill; it does not need to change
   *              between themes, and darkening it is what made the light theme look
   *              dull. See the FILL EXEMPTION note in tokens.css — this is a
   *              deliberate, recorded trade-off, not an oversight.
   *   lightText  derived at 4.5:1 against an --accent-soft pill over white, the
   *              palest surface accent text ever lands on. ⚠ This one is NOT
   *              exempt from anything and must keep passing. */
  var PRESETS = {
    rose:   { dark: '#E79BB4', light: '#E79BB4', darkText: '#E79BB4', lightText: '#A05A73' },
    violet: { dark: '#A78BFA', light: '#A78BFA', darkText: '#A78BFA', lightText: '#795BC5' },
    teal:   { dark: '#5FC8C8', light: '#5FC8C8', darkText: '#5FC8C8', lightText: '#007B7C' },
    amber:  { dark: '#F0B955', light: '#F0B955', darkText: '#F0B955', lightText: '#996600' },
    green:  { dark: '#6FCF97', light: '#6FCF97', darkText: '#6FCF97', lightText: '#11804D' }
  };

  function read(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  /* Which theme is actually in effect right now — resolving 'system'. */
  function effective(stored) {
    if (stored === 'dark' || stored === 'light') return stored;
    try {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    } catch (e) { return 'dark'; }
  }

  function applyAccent(accent, mode, root, text) {
    if (!accent) return;

    var set = accent;
    if (typeof accent === 'string' && PRESETS[accent]) {
      set = PRESETS[accent][mode];
      text = PRESETS[accent][mode + 'Text'];
    }
    if (typeof set !== 'string' || !/^#[0-9a-f]{6}$/i.test(set)) return;

    root.style.setProperty('--accent', set);
    // The text variant is separate because it is a different job (see tokens.css).
    // Falling back to the fill is deliberate: a caller that has not supplied one is
    // no worse off than before, and the checker catches it.
    root.style.setProperty('--accent-text', /^#[0-9a-f]{6}$/i.test(text || '') ? text : set);

    /* Derived variants must move with the accent or a custom colour ends up
     * with rose-pink borders. `color-mix` handles the soft/line tints without
     * needing to parse the hex here; --accent-ink is written by the settings UI
     * (which has the contrast maths) and stored alongside the accent. */
    root.style.setProperty('--accent-soft', 'color-mix(in srgb, ' + set + ' 14%, transparent)');
    root.style.setProperty('--accent-line', 'color-mix(in srgb, ' + set + ' 42%, transparent)');
  }

  var root = document.documentElement;
  var storedTheme = read(THEME_KEY);
  var mode = effective(storedTheme);

  /* Only stamp the attribute for an EXPLICIT choice. Leaving it absent for
   * 'system' is what lets the prefers-color-scheme block in tokens.css do its
   * job — stamping data-theme="dark" here would defeat it. */
  if (storedTheme === 'dark' || storedTheme === 'light') {
    root.setAttribute('data-theme', storedTheme);
  } else {
    root.removeAttribute('data-theme');
  }

  var storedAccent = read(ACCENT_KEY);
  if (storedAccent) {
    var accent = storedAccent;
    var ink = null;
    var customText = null;
    if (storedAccent.charAt(0) === '{') {
      try {
        // { dark, light, darkInk, lightInk, darkText, lightText }
        var parsed = JSON.parse(storedAccent);
        accent = parsed[mode];
        ink = parsed[mode + 'Ink'];
        customText = parsed[mode + 'Text'];
      } catch (e) { accent = null; }
    }
    applyAccent(accent, mode, root, customText);
    if (ink && /^#[0-9a-f]{6}$/i.test(ink)) root.style.setProperty('--accent-ink', ink);
  }

  /* Follow the OS live while the preference is 'system'. Without this, a device
   * that flips to dark at sunset keeps the old palette until a reload. */
  try {
    var mq = window.matchMedia('(prefers-color-scheme: light)');
    var onChange = function () {
      if (read(THEME_KEY) === 'dark' || read(THEME_KEY) === 'light') return;
      var m = effective(null);
      var a = read(ACCENT_KEY);
      if (!a) return;
      if (a.charAt(0) === '{') {
        try {
          var p = JSON.parse(a);
          applyAccent(p[m], m, root);
          if (p[m + 'Ink']) root.style.setProperty('--accent-ink', p[m + 'Ink']);
        } catch (e) { /* ignore */ }
      } else {
        applyAccent(a, m, root);
        root.style.removeProperty('--accent-ink');   // preset inks come from tokens.css
      }
    };
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else if (mq.addListener) mq.addListener(onChange);
  } catch (e) { /* matchMedia unavailable — the static choice still applied */ }

  /* Minimal API for a settings UI. Deliberately small: anything that needs to
   * DERIVE a colour uses color-utils.mjs instead. */
  window.RoseTheme = {
    PRESETS: PRESETS,
    get: function () { return read(THEME_KEY) || 'system'; },
    getAccent: function () { return read(ACCENT_KEY) || 'rose'; },
    effective: function () { return effective(read(THEME_KEY)); },

    set: function (theme) {
      try { window.localStorage.setItem(THEME_KEY, theme); } catch (e) {}
      if (theme === 'dark' || theme === 'light') root.setAttribute('data-theme', theme);
      else root.removeAttribute('data-theme');
      this.setAccent(read(ACCENT_KEY) || 'rose');
      window.dispatchEvent(new CustomEvent('theme:changed', {
        detail: { theme: theme, effective: effective(theme) }
      }));
    },

    /** accent: a preset name, or {dark,light,darkInk,lightInk} from the picker. */
    setAccent: function (accent) {
      var value = typeof accent === 'string' ? accent : JSON.stringify(accent);
      try { window.localStorage.setItem(ACCENT_KEY, value); } catch (e) {}
      var m = effective(read(THEME_KEY));
      if (typeof accent === 'string') {
        applyAccent(accent, m, root);
        root.style.removeProperty('--accent-ink');
      } else {
        applyAccent(accent[m], m, root);
        if (accent[m + 'Ink']) root.style.setProperty('--accent-ink', accent[m + 'Ink']);
      }
      window.dispatchEvent(new CustomEvent('theme:accent-changed', { detail: { accent: accent } }));
    }
  };
})();
