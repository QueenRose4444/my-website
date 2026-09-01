/* MOVED to /shared/theme.js on 2026-09-01.
 *
 * Not a shim. theme.js has to run SYNCHRONOUSLY before first paint, and nothing
 * that can be done from here would preserve that — loading the real file from
 * inside this one would defer it and reintroduce the flash of the wrong theme.
 *
 * So this fails loudly instead. web-sync cannot delete a remote file, and a stale
 * theme.js that half-worked would be far worse than one that says what is wrong.
 */
console.error(
  '[RoseTheme] /theme.js has moved to /shared/theme.js. This page is loading the ' +
  'old path and has NO theme handling. Update the <script src> in its <head>.'
);
