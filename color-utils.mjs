/* MOVED to /shared/color-utils.mjs on 2026-09-01.
 *
 * Re-exported rather than tombstoned, because this one is a plain module with no
 * timing constraints — an old import keeps working and gets the real thing.
 * Still update the path: web-sync cannot delete the remote copy, so this file
 * only disappears once nothing references it.
 */
console.warn('[color-utils] /color-utils.mjs has moved to /shared/color-utils.mjs');
export * from '/shared/color-utils.mjs';
