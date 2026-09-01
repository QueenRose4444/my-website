// sync-wip.js — shared browser data-sync module (WIP).
//
// This started as the meds v2 sync engine, generalised. What it adds on top of that
// is an OPERATION LOG, which is what finally makes two devices behave.
//
// ── the bug this exists to kill ──────────────────────────────────────────────
// The old check was two-way: `if (local !== server) → ask the user`. That treats
// "I am merely behind" as a conflict. A real case: a device last updated on 18 July
// (82 doses, 94 weights) met an account copy from 2 August (82 doses, 95 weights).
// The device had changed nothing since 18 July. It should have downloaded and said
// nothing. It showed a conflict dialog instead.
//
// So there are now two independent questions, and they are answered separately:
//
//   Did I change?    Diff my state against the BASE — my own state as of the last
//                    successful sync — not a dirty flag. A flag can be wrong after a
//                    failed save or a closed tab; a snapshot comparison corrects
//                    itself.
//   Did they change? Compare the server's `version` integer with the version the
//                    base came from. No content diffing.
//
//   I changed  Server changed  Action
//   ---------  --------------  ------
//   no         no              nothing
//   no         yes             apply their operations, silently
//   yes        no              push my operations, silently
//   yes        yes             rebase mine on top of theirs and push — still silent,
//                              with a count reported afterwards ("merged 3 changes
//                              from your other device")
//
// ── the sync with no base at all ─────────────────────────────────────────────
// All of the above needs a base. The FIRST sync on a device has none, and that is
// exactly where a prompt is least welcome. A second real case: both devices had
// imported a backup, so neither had a base, and the fallback asked
//
//     This device : 1165 doses, 92 weights
//     Your account: 1166 doses, 95 weights
//
// The device's entries were a strict subset of the account's — it was behind, and
// nothing had diverged. So before falling back, CONTAINMENT is checked: if every
// entry on one side is present and identical on the other, the side that is behind
// catches up silently and is simply told what moved. Anything else — a shared id
// holding different content, a collection that will not key, a genuine divergence
// — falls through to the prompt untouched. See `containment` below.
//
// ── putting an automatic change back ─────────────────────────────────────────
// A change nobody asked for is revertable. Before a catch-up or a silent merge,
// the state it replaces is stashed (UNDO_LIMIT of them), the notice offers Revert
// as well as Confirm, and the list survives the notice so settings can offer it
// later. Reverting publishes OLDER data, so it travels as a marked wholesale
// replacement — never as per-item deletions.
//
// ── the model ────────────────────────────────────────────────────────────────
// Each server version records WHAT CHANGED and, periodically, the FULL STATE after:
//
//     { version, snapshot, snapshotVersion, ops: [ {v,type,coll,id,item?,at,dev} ] }
//
// Current state = snapshot with ops replayed in version order. Deletion is not a
// special case — it is `type:'del'` like any other operation, and because it is
// stored and shipped it reaches a device that never saw the item, survives cleared
// browser storage, and cannot be "un-deleted" by a union merge.
//
// VERSION NUMBERS ARE SERVER-ASSIGNED. Two devices holding v1 will both try to make
// v2; the UPDATE carries `AND version = ?`, so SQLite picks the winner. The loser
// gets a 409 carrying the operations it is missing, applies them, rebases its own on
// top, and retries. Nobody is asked to pick a side.
//
// COMPACTION IS THE CLIENT'S JOB. The client already holds the fully applied state,
// so when the log grows past OP_LOG_COMPACT_THRESHOLD it pushes a fresh snapshot and
// the server truncates the log (into an archive). The worker never replays anything.
//
// ── what the page supplies ───────────────────────────────────────────────────
// This module does not know what a dose is. A page declares its collections —
// `identity(item)`, optionally `timestamp(item)` — and everything else is generic.
// A page that declares none keeps exactly the old behaviour: whole-state saves, and
// a conflict prompt when both sides differ.
//
// ── what is NOT an operation ─────────────────────────────────────────────────
// Two things deliberately never travel as per-item operations, because a `del` is
// applied by every other device in silence and that is only acceptable for a
// change somebody made one entry at a time:
//
//   a WHOLESALE REPLACEMENT  (replaceAll — an import over the top, a reset) goes
//       up as a snapshot with a marker, so the other devices are asked instead of
//       emptied. Getting this wrong is how two devices, each importing a different
//       backup, deleted each other's medication history.
//   a BULK DELETION          (the guard below) — incoming deletions past a
//       threshold are held back and raised as a question that defaults to keeping.
//
// NOTE: the notes app does NOT use this. It has its own backend and CRDT merging,
// which resolves concurrent edits without ever asking a human.

(function (global) {
  'use strict';

  /**
   * Live operations the server may hold before the client replaces them with a
   * fresh snapshot. Chosen low deliberately: the snapshot is the expensive thing to
   * ship, and a device that has been away only ever needs `snapshot + ops`, so a
   * short log keeps a cold start cheap. 200 operations is weeks of a medication log
   * and still a small row.
   */
  var OP_LOG_COMPACT_THRESHOLD = 200;

  /** Format tag on the locally stored base. A bump invalidates old bases safely. */
  var BASE_FORMAT = 1;

  /* ─────────────────── the bulk-delete sanity threshold ───────────────────
   *
   * One sync that removes most of a collection is not an ordinary edit. It is a
   * restore from an old backup, a half-finished import, a device whose base went
   * wrong — or, occasionally, somebody genuinely clearing out a year of records.
   * Only the last of those should go through without a word.
   *
   * So: a single sync may quietly remove up to `max(BULK_DELETE_MIN_ITEMS,
   * BULK_DELETE_FRACTION × collection size)` entries from one collection. Past
   * that, the deletions are WITHHELD and raised the same way a delete-vs-edit
   * collision is, and the default — dismissal, no UI, a closed tab — is to KEEP
   * the entries and push them back so the other device gets them too.
   *
   * The two halves matter separately:
   *   the fraction   scales with the data, so a large log is protected in
   *                  proportion rather than by an absolute number that stops
   *                  meaning anything once there are thousands of entries;
   *   the minimum    stops the fraction from making ordinary use noisy. Deleting
   *                  3 of 8 doses is 37% and must never prompt. Below 80 entries
   *                  the minimum is what applies, and under 20 entries a
   *                  collection cannot trigger this at all.
   *
   * Both numbers are guesses that should be argued with, not laws. They are here,
   * named, in one place, so that argument is a one-line change.
   */
  var BULK_DELETE_FRACTION = 0.25;
  var BULK_DELETE_MIN_ITEMS = 20;

  /* ───────────────────── how far back an automatic change can be undone ─────────────────────
   *
   * Anything this module does to a device's data WITHOUT being asked — a silent
   * catch-up, a silent merge — stashes the state it replaced first, so the person
   * can put it back. Three is deliberate:
   *
   *   it is a stack, not a history. The question a person actually asks is "what
   *   did that last sync just do to my data?", and that is answered by the newest
   *   entry or two. Ten would be a filing cabinet nobody opens.
   *   it is a whole copy of the state EACH. For meds that is a few hundred KB, so
   *   three is comfortable inside localStorage and thirty would not be.
   *
   * A stash that will not store (quota) is not an error: the action still happens,
   * it is simply reported as not revertable. Never fail a sync over an undo copy.
   */
  var UNDO_LIMIT = 3;

  /** Format tag on the stashed states. A bump invalidates old stashes safely. */
  var UNDO_FORMAT = 1;

  /** The most entries one sync may remove from a collection without asking. */
  function bulkDeleteThreshold(collectionSize) {
    var n = (typeof collectionSize === 'number' && isFinite(collectionSize) && collectionSize > 0)
      ? collectionSize : 0;
    return Math.max(BULK_DELETE_MIN_ITEMS, Math.ceil(n * BULK_DELETE_FRACTION));
  }

  /* ─────────────────────────────── helpers ─────────────────────────────── */

  /** Deterministic JSON: object keys sorted at every depth. */
  function stableStringify(value, ignoreKeys) {
    var seen = new WeakSet();
    function walk(v) {
      if (v === null || typeof v !== 'object') return v;
      if (seen.has(v)) return '[circular]';
      seen.add(v);
      if (Array.isArray(v)) return v.map(walk);
      var out = {};
      Object.keys(v).sort().forEach(function (k) {
        if (ignoreKeys && ignoreKeys.indexOf(k) !== -1) return;
        out[k] = walk(v[k]);
      });
      return out;
    }
    try { return JSON.stringify(walk(value)); } catch (e) { return null; }
  }

  function defaultHasData(state) {
    if (!state || typeof state !== 'object') return false;
    return Object.keys(state).some(function (k) {
      var v = state[k];
      if (v == null) return false;
      if (Array.isArray(v)) return v.length > 0;
      if (typeof v === 'object') return Object.keys(v).length > 0;
      if (typeof v === 'string') return v.length > 0;
      return true;
    });
  }

  /** Deep copy through JSON. Returns null if the value will not round-trip. */
  function cloneState(value) {
    if (value == null) return value;
    try { return JSON.parse(JSON.stringify(value)); } catch (e) { return null; }
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  function isSafeInt(n) {
    return typeof n === 'number' && isFinite(n) && Math.floor(n) === n;
  }

  /**
   * A replacement marker off the wire. It is only ever a LABEL on a stored state —
   * nothing is applied from it — so the worst a malformed one can do is make the
   * page say nothing, never make it delete something.
   */
  function readReplaceMarker(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    if (!isSafeInt(raw.v) || raw.v <= 0) return null;
    return {
      v: raw.v,
      at: isSafeInt(raw.at) ? raw.at : null,
      dev: typeof raw.dev === 'string' ? raw.dev : null,
      source: typeof raw.source === 'string' ? raw.source : null,
      removed: isSafeInt(raw.removed) && raw.removed >= 0 ? raw.removed : null,
      kept: isSafeInt(raw.kept) && raw.kept >= 0 ? raw.kept : null,
    };
  }

  /* ───────────────────────────── collections ─────────────────────────────
   *
   * A collection is either an ARRAY of items with an identity, or a MAP of keys to
   * values (settings). Anything a page does not declare is carried by snapshots
   * only — it never generates an operation and is never touched by one.
   */

  function normaliseCollections(specs) {
    if (!Array.isArray(specs)) return [];
    var out = [];
    specs.forEach(function (spec) {
      if (!spec || typeof spec.name !== 'string' || !spec.name) return;
      var kind = spec.kind === 'map' ? 'map' : 'array';
      if (kind === 'array' && typeof spec.identity !== 'function') {
        console.warn('[SYNC_WIP] collection "' + spec.name + '" needs identity(item); ignoring it');
        return;
      }
      out.push({
        name: spec.name,
        kind: kind,
        identity: spec.identity || null,
        timestamp: typeof spec.timestamp === 'function' ? spec.timestamp : null,
        equal: typeof spec.equal === 'function' ? spec.equal : null,
        // Map keys that are this device's business only (theme, chart ranges…).
        // They neither produce operations nor accept them.
        ignore: Array.isArray(spec.ignore) ? spec.ignore.slice() : [],
      });
    });
    return out;
  }

  function identityOf(spec, item) {
    if (item == null) return null;
    var id;
    try { id = spec.identity(item); } catch (e) { return null; }
    if (id == null || id === '') return null;
    return String(id);
  }

  function sameItem(spec, a, b) {
    if (spec.equal) {
      try { return !!spec.equal(a, b); } catch (e) { /* fall through */ }
    }
    return stableStringify(a) === stableStringify(b);
  }

  /**
   * Index an array by identity.
   * Returns null when the collection cannot be keyed — a missing identity, or two
   * items claiming the same one. That is not a crash and not a guess: the caller
   * falls back to sending the whole state, which is always correct.
   */
  function indexByIdentity(spec, arr) {
    var map = Object.create(null);
    var order = [];
    for (var i = 0; i < arr.length; i++) {
      var id = identityOf(spec, arr[i]);
      if (id === null) return null;
      if (map[id] !== undefined) return null;
      map[id] = arr[i];
      order.push(id);
    }
    return { map: map, order: order };
  }

  /**
   * The operations that turn `base` into `mine`.
   * Returns null when the difference cannot be expressed as operations, which the
   * caller must treat as "send a snapshot instead".
   */
  function diffOps(base, mine, specs, meta) {
    if (!base || typeof base !== 'object' || !mine || typeof mine !== 'object') return null;
    var at = (meta && isSafeInt(meta.at)) ? meta.at : Date.now();
    var dev = (meta && meta.dev) || undefined;
    var ops = [];

    function push(type, coll, id, item) {
      var op = { type: type, coll: coll, id: id, at: at };
      if (type !== 'del') op.item = item;
      if (dev) op.dev = dev;
      ops.push(op);
    }

    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      if (spec.kind === 'map') {
        if (!diffMap(spec, base[spec.name], mine[spec.name], push)) return null;
      } else if (!diffArray(spec, base[spec.name], mine[spec.name], push)) return null;
    }

    // Anything the page did NOT declare cannot be described by an operation. If such
    // a field has changed, this is not an op push — it is a whole-state save. An op
    // push must carry the entire difference or it is not honest.
    if (!restUnchanged(base, mine, specs, (meta && meta.ignoreKeys) || [])) return null;

    return ops;
  }

  function restUnchanged(base, mine, specs, ignoreKeys) {
    var covered = Object.create(null);
    specs.forEach(function (s) { covered[s.name] = true; });
    ignoreKeys.forEach(function (k) { covered[k] = true; });

    var keys = Object.keys(base).concat(Object.keys(mine));
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (covered[k]) continue;
      covered[k] = true;   // only look at each key once
      if (stableStringify(base[k]) !== stableStringify(mine[k])) return false;
    }
    return true;
  }

  function diffArray(spec, baseRaw, mineRaw, push) {
    if (baseRaw != null && !Array.isArray(baseRaw)) return false;
    if (mineRaw != null && !Array.isArray(mineRaw)) return false;
    var baseIx = indexByIdentity(spec, baseRaw || []);
    var mineIx = indexByIdentity(spec, mineRaw || []);
    if (!baseIx || !mineIx) return false;

    // Within one push, order changes by the item's own clock where the page gives
    // one, so the stored log reads as history rather than as array order.
    var ids = mineIx.order.slice();
    if (spec.timestamp) {
      ids.sort(function (a, b) {
        var ta = Number(spec.timestamp(mineIx.map[a]));
        var tb = Number(spec.timestamp(mineIx.map[b]));
        if (!isFinite(ta) || !isFinite(tb) || ta === tb) return 0;
        return ta - tb;
      });
    }

    ids.forEach(function (id) {
      var item = mineIx.map[id];
      if (baseIx.map[id] === undefined) push('add', spec.name, id, item);
      else if (!sameItem(spec, baseIx.map[id], item)) push('edit', spec.name, id, item);
    });
    baseIx.order.forEach(function (id) {
      if (mineIx.map[id] === undefined) push('del', spec.name, id, null);
    });
    return true;
  }

  function diffMap(spec, baseRaw, mineRaw, push) {
    if (baseRaw != null && (typeof baseRaw !== 'object' || Array.isArray(baseRaw))) return false;
    if (mineRaw != null && (typeof mineRaw !== 'object' || Array.isArray(mineRaw))) return false;
    var b = baseRaw || {};
    var m = mineRaw || {};
    Object.keys(m).sort().forEach(function (k) {
      if (spec.ignore.indexOf(k) !== -1) return;
      if (!(k in b)) push('add', spec.name, k, m[k]);
      else if (stableStringify(b[k]) !== stableStringify(m[k])) push('edit', spec.name, k, m[k]);
    });
    Object.keys(b).sort().forEach(function (k) {
      if (spec.ignore.indexOf(k) !== -1) return;
      if (!(k in m)) push('del', spec.name, k, null);
    });
    return true;
  }

  /** Whatever a state holds in that collection under that id, or null. */
  function itemIn(specsByName, source, coll, id) {
    var spec = specsByName[coll];
    if (!spec || !source) return null;
    var key = String(id);
    if (spec.kind === 'map') {
      var obj = source[spec.name];
      return (obj && typeof obj === 'object' && key in obj) ? obj[key] : null;
    }
    var arr = source[spec.name];
    if (!Array.isArray(arr)) return null;
    for (var j = 0; j < arr.length; j++) {
      if (identityOf(spec, arr[j]) === key) return arr[j];
    }
    return null;
  }

  /** How many entries a state holds in one collection. */
  function collectionSize(state, spec) {
    if (!state || !spec) return 0;
    var v = state[spec.name];
    if (spec.kind === 'map') {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return 0;
      return Object.keys(v).filter(function (k) { return spec.ignore.indexOf(k) === -1; }).length;
    }
    return Array.isArray(v) ? v.length : 0;
  }

  /**
   * What turning `from` into `to` WOULD do, per declared collection:
   * added / removed / changed / identical. Nothing is applied and nothing is
   * stored — this exists so a destructive action can be shown before it happens,
   * which is the whole point of an import preview.
   *
   * A collection that will not key (a missing or duplicated identity) is reported
   * as wholly replaced and flagged `unkeyable`. That overstates the damage rather
   * than understating it, which is the only safe direction for this number.
   */
  function diffSummary(from, to, specs) {
    var a = (from && typeof from === 'object') ? from : {};
    var b = (to && typeof to === 'object') ? to : {};
    var out = {
      collections: [],
      byName: Object.create(null),
      totals: { added: 0, removed: 0, changed: 0, identical: 0 },
    };

    (specs || []).forEach(function (spec) {
      var row = {
        name: spec.name, kind: spec.kind,
        added: 0, removed: 0, changed: 0, identical: 0,
        before: 0, after: 0,
        unkeyable: false,
        removedSample: [],
      };

      if (spec.kind === 'map') {
        var mb = (a[spec.name] && typeof a[spec.name] === 'object' && !Array.isArray(a[spec.name])) ? a[spec.name] : {};
        var mt = (b[spec.name] && typeof b[spec.name] === 'object' && !Array.isArray(b[spec.name])) ? b[spec.name] : {};
        Object.keys(mt).forEach(function (k) {
          if (spec.ignore.indexOf(k) !== -1) return;
          if (!(k in mb)) row.added += 1;
          else if (stableStringify(mb[k]) !== stableStringify(mt[k])) row.changed += 1;
          else row.identical += 1;
        });
        Object.keys(mb).forEach(function (k) {
          if (spec.ignore.indexOf(k) !== -1) return;
          if (!(k in mt)) { row.removed += 1; if (row.removedSample.length < 5) row.removedSample.push(mb[k]); }
        });
        row.before = collectionSize(a, spec);
        row.after = collectionSize(b, spec);
      } else {
        var arrA = Array.isArray(a[spec.name]) ? a[spec.name] : [];
        var arrB = Array.isArray(b[spec.name]) ? b[spec.name] : [];
        row.before = arrA.length;
        row.after = arrB.length;
        var ixA = indexByIdentity(spec, arrA);
        var ixB = indexByIdentity(spec, arrB);
        if (!ixA || !ixB) {
          row.unkeyable = true;
          row.removed = arrA.length;
          row.added = arrB.length;
          row.removedSample = arrA.slice(0, 5);
        } else {
          ixB.order.forEach(function (id) {
            if (ixA.map[id] === undefined) row.added += 1;
            else if (!sameItem(spec, ixA.map[id], ixB.map[id])) row.changed += 1;
            else row.identical += 1;
          });
          ixA.order.forEach(function (id) {
            if (ixB.map[id] === undefined) {
              row.removed += 1;
              if (row.removedSample.length < 5) row.removedSample.push(ixA.map[id]);
            }
          });
        }
      }

      out.collections.push(row);
      out.byName[spec.name] = row;
      out.totals.added += row.added;
      out.totals.removed += row.removed;
      out.totals.changed += row.changed;
      out.totals.identical += row.identical;
    });

    return out;
  }

  /* ─────────────────── containment: the question that needs no base ───────────────────
   *
   * Everything above needs a BASE — this device's state as of its last sync. On the
   * FIRST sync of a device there is none, and the fallback below asks the user to
   * compare two columns of numbers:
   *
   *     This device : 1165 doses, 92 weights
   *     Your account: 1166 doses, 95 weights
   *
   * That question did not need asking. Every entry on the device was also on the
   * account copy, byte for byte. The device was merely behind; nothing diverged, so
   * there was nothing to decide.
   *
   * So before falling back to the prompt, ask something that needs no base: is one
   * side's data WHOLLY CONTAINED in the other's?
   *
   *   local ⊆ server   this device is behind        → download, silently
   *   server ⊆ local   the account copy is behind   → upload, silently
   *   neither          they genuinely diverged      → the prompt, unchanged
   *
   * CONTAINMENT IS BY CONTENT, NOT BY ID. Two entries can share an id and hold
   * different things. That is a divergence, and it falls through to the prompt:
   * "contained" means every entry is present AND identical, never merely that the
   * ids all appear.
   *
   * Both directions are purely ADDITIVE — the side that is behind only ever gains
   * entries, and nothing is removed anywhere. That is why this path needs no
   * bulk-delete guard and cannot lose data. What it cannot know, having no base, is
   * WHY an entry is missing on one side: because it is new over there, or because
   * somebody deleted it here and never pushed. Nothing without a base can know
   * that, and re-adding is the non-destructive reading of it — the same one the
   * union merge below has always taken, just without stopping to ask.
   */

  /**
   * Is one side contained in the other?
   *
   * Returns {direction:'behind'|'ahead'|'equal', collections, toLocal, toServer},
   * or NULL for "cannot say" — no collections, a collection that will not key, a
   * shared id whose content differs, an undeclared field that differs, or a real
   * divergence. Every null lands on the existing prompt, which is always correct.
   */
  function containment(mine, theirs, specs, ignoreKeys) {
    if (!specs || !specs.length) return null;                       // never guess
    if (!mine || typeof mine !== 'object' || Array.isArray(mine)) return null;
    if (!theirs || typeof theirs !== 'object' || Array.isArray(theirs)) return null;

    var onlyMine = 0, onlyTheirs = 0;
    var rows = [];

    for (var i = 0; i < specs.length; i++) {
      var spec = specs[i];
      var r = spec.kind === 'map'
        ? containedMap(spec, mine[spec.name], theirs[spec.name])
        : containedArray(spec, mine[spec.name], theirs[spec.name]);
      if (!r) return null;
      onlyMine += r.onlyMine;
      onlyTheirs += r.onlyTheirs;
      rows.push({ name: spec.name, kind: spec.kind, toLocal: r.onlyTheirs, toServer: r.onlyMine });
    }

    // A field the page never declared cannot be reasoned about entry by entry, so
    // a difference in one is not a containment — it is two states that disagree.
    if (!restUnchanged(mine, theirs, specs, ignoreKeys || [])) return null;

    if (onlyMine && onlyTheirs) return null;                        // genuinely diverged
    return {
      direction: onlyTheirs ? 'behind' : (onlyMine ? 'ahead' : 'equal'),
      collections: rows,
      toLocal: onlyTheirs,
      toServer: onlyMine,
    };
  }

  function containedArray(spec, mineRaw, theirsRaw) {
    if (mineRaw != null && !Array.isArray(mineRaw)) return null;
    if (theirsRaw != null && !Array.isArray(theirsRaw)) return null;
    var a = indexByIdentity(spec, mineRaw || []);
    var b = indexByIdentity(spec, theirsRaw || []);
    if (!a || !b) return null;              // will not key: no containment check at all
    var onlyMine = 0, onlyTheirs = 0;
    for (var i = 0; i < a.order.length; i++) {
      var id = a.order[i];
      var theirItem = b.map[id];
      if (theirItem === undefined) onlyMine += 1;
      else if (!sameItem(spec, a.map[id], theirItem)) return null;  // same id, different content
    }
    for (var j = 0; j < b.order.length; j++) {
      if (a.map[b.order[j]] === undefined) onlyTheirs += 1;
    }
    return { onlyMine: onlyMine, onlyTheirs: onlyTheirs };
  }

  /**
   * A MAP collection (settings, user profile) is contained on exactly the same
   * terms as an array: a subset BY KEY whose shared keys are identical. A shared
   * key holding two different values is a divergence like any other, and goes to
   * the prompt. Keys the page marked device-local are skipped entirely — they
   * never travel, so they can neither contain nor diverge.
   */
  function containedMap(spec, mineRaw, theirsRaw) {
    if (mineRaw != null && (typeof mineRaw !== 'object' || Array.isArray(mineRaw))) return null;
    if (theirsRaw != null && (typeof theirsRaw !== 'object' || Array.isArray(theirsRaw))) return null;
    var m = mineRaw || {};
    var t = theirsRaw || {};
    var onlyMine = 0, onlyTheirs = 0;
    var keys = Object.keys(m);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (spec.ignore.indexOf(k) !== -1) continue;
      if (!(k in t)) { onlyMine += 1; continue; }
      if (stableStringify(m[k]) !== stableStringify(t[k])) return null;
    }
    var theirKeys = Object.keys(t);
    for (var j = 0; j < theirKeys.length; j++) {
      var tk = theirKeys[j];
      if (spec.ignore.indexOf(tk) !== -1) continue;
      if (!(tk in m)) onlyTheirs += 1;
    }
    return { onlyMine: onlyMine, onlyTheirs: onlyTheirs };
  }

  /* ─────────────────── naming a collection out loud ─────────────────── */

  /**
   * "doses", not "shots". A page hands over its own labels (meds has had a
   * COLLECTION_LABELS map for the import preview since before this existed); the
   * wire name is the fallback, never a guess at a nicer one.
   *
   * "1 dose" from "doses" is the only cleverness here, and it is deliberately
   * shallow: strip a plural -s, and -es only where the stem could not have ended
   * in one (boxes, dishes, churches). "doses" and "sizes" are therefore dose + s,
   * which is right far more often in this kind of data than bus + es. A page with
   * an irregular plural passes {one, other} and none of this runs.
   */
  function singularise(word) {
    if (/(xes|ches|shes)$/.test(word)) return word.slice(0, -2);
    if (/[^aeiou]ies$/.test(word)) return word.slice(0, -3) + 'y';
    if (/ss$/.test(word)) return word;
    if (/s$/.test(word)) return word.slice(0, -1);
    return word;
  }

  /** "1 dose, 2 weights and 3 medications" */
  function joinParts(parts) {
    if (!parts.length) return '';
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }

  /** Apply one operation in place. Returns false when it was ignored. */
  function applyOp(state, op, specsByName) {
    if (!state || !op) return false;
    var spec = specsByName[op.coll];
    if (!spec) return false;                    // a collection this page does not know
    var id = String(op.id);

    if (spec.kind === 'map') {
      if (spec.ignore.indexOf(id) !== -1) return false;   // device-local key
      var obj = state[spec.name];
      if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) { obj = {}; state[spec.name] = obj; }
      if (op.type === 'del') delete obj[id];
      else obj[id] = op.item;
      return true;
    }

    if (!Array.isArray(state[spec.name])) state[spec.name] = [];
    var arr = state[spec.name];
    var idx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (identityOf(spec, arr[i]) === id) { idx = i; break; }
    }
    if (op.type === 'del') {
      if (idx >= 0) arr.splice(idx, 1);
      return true;
    }
    // An edit for something that is not here behaves as an add. Dropping it would
    // discard a change the server has already accepted.
    if (idx >= 0) arr[idx] = op.item;
    else arr.push(op.item);
    return true;
  }

  /** Replay operations onto a state, in place. */
  function applyOps(state, ops, specs) {
    var byName = Object.create(null);
    (specs || []).forEach(function (s) { byName[s.name] = s; });
    (ops || []).forEach(function (op) { applyOp(state, op, byName); });
    return state;
  }

  /* ─────────────────────────────── SyncClient ─────────────────────────────── */

  /**
   * @param {object} options
   * @param {object} options.auth        AuthManagerWip (or the old AuthManager)
   * @param {string} [options.appName]   defaults to auth.appName
   *
   * State adapter — supply BOTH to let the page keep owning its state (meds does),
   * or neither to let this module hold it:
   * @param {() => any}    [options.getState]
   * @param {(s:any)=>void}[options.setState]
   *
   * App-specific behaviour:
   * @param {(raw:any)=>any}     [options.normalize]  server blob → usable state
   * @param {(raw:any)=>boolean} [options.accept]     "is this blob mine?"
   * @param {(s:any)=>string}    [options.canonical]  fingerprint, used only where
   *        there is no base to diff against
   * @param {(s:any)=>boolean}   [options.hasData]
   * @param {string[]} [options.ignoreKeys] top-level keys that are this device's
   *        business and not synced data. They are dropped by the default canonical
   *        AND excluded from the check that an operation push carries the whole
   *        difference (see restUnchanged).
   * @param {(theirs:any, mine:any)=>any} [options.merge]  union both sides. Only
   *        reached on the no-base fallback path; with collections declared, the
   *        operation log merges properly and this is not used.
   * @param {(s:any)=>string}    [options.summary]    one-line description per side
   * @param {number}             [options.debounceMs] default 1200
   * @param {(status:string)=>void} [options.onStatus]
   * @param {(info:object)=>Promise<'mine'|'theirs'|'merge'>} [options.onConflict]
   *        Only used without collections. Omit to use the built-in prompt.
   *
   * The operation log — declare these and conflicts stop being the user's problem:
   * @param {Array<{name:string, kind?:'array'|'map', identity?:(item:any)=>string,
   *                timestamp?:(item:any)=>number, equal?:(a,b)=>boolean,
   *                ignore?:string[]}>} [options.collections]
   * @param {Record<string, string|{one:string,other:string}>} [options.collectionLabels]
   *        What to call a collection out loud — {shots:'doses'}. Only used for the
   *        sentences this module writes; the wire name is the fallback.
   * @param {(info:object)=>void} [options.onMerged]  "merged N changes from your
   *        other device". info carries the counts and both pre-merge copies, so a
   *        page can still offer keep-mine / keep-theirs afterwards.
   *
   *        It is also the channel for the CATCH-UP NOTICE — info.kind ===
   *        'catch-up' — which reports a silent containment sync: a sentence in
   *        info.message, and confirm()/revert() actions. Nothing waits on it, and
   *        ignoring it is confirming it.
   *
   * @param {(info:{collisions:object[], client:SyncClient}) =>
   *          Promise<Record<string,'delete'|'keep'>|null|undefined>} [options.onItemConflict]
   *        The ONE question this module asks: one side deleted an entry, the other
   *        edited it. Raised per item, after the rest of the merge has been saved.
   *        Each collision carries {key, coll, id, before, after, deletedOnThisDevice,
   *        deletedAt, deletedBy, editedAt, editedBy} — the entry as it was, the edit
   *        that was made, and which device did which — so a page can render a real
   *        question instead of "something was deleted somewhere".
   *
   *        Answer with {[key]: 'delete'} for the entries to remove. Anything not
   *        named, a null answer, a rejected promise, or no handler at all means KEEP.
   *        A dismissal must never destroy.
   */
  function SyncClient(options) {
    if (!options || !options.auth) throw new Error('SyncClient requires an auth manager');
    this.auth = options.auth;
    this.appName = options.appName || options.auth.appName;
    if (!this.appName) throw new Error('SyncClient requires an appName');

    this.endpoint = (this.auth.endpoints && this.auth.endpoints.dataFor)
      ? this.auth.endpoints.dataFor(this.appName)
      : (this.auth.config.backendUrl + '/api/data/' + encodeURIComponent(this.appName));

    var environment = this.auth.environment || 'wip';
    this._versionKey = 'syncwip_' + environment + '_' + this.appName + '_version';
    this._stateKey = 'syncwip_' + environment + '_' + this.appName + '_state';
    this._baseKey = 'syncwip_' + environment + '_' + this.appName + '_base';
    this._resolvedKey = 'syncwip_' + environment + '_' + this.appName + '_resolved';
    this._undoKey = 'syncwip_' + environment + '_' + this.appName + '_undo';
    this._deviceKey = 'syncwip_' + environment + '_device';

    // State adapter. Without one, this module owns the state and persists it locally.
    this._ownsState = !(options.getState && options.setState);
    if (this._ownsState) {
      var self = this;
      this._state = readJson(this._stateKey, null);
      this.getState = function () { return self._state; };
      this.setState = function (s) {
        self._state = s;
        writeJson(self._stateKey, s);
      };
    } else {
      this.getState = options.getState;
      this.setState = options.setState;
    }

    this.normalize = options.normalize || function (raw) { return raw; };
    this.accept = options.accept || function (raw) { return !!raw && typeof raw === 'object'; };
    this.hasData = options.hasData || defaultHasData;
    this.merge = options.merge || null;
    this.summary = options.summary || null;
    this.ignoreKeys = options.ignoreKeys || [];
    this.debounceMs = typeof options.debounceMs === 'number' ? options.debounceMs : 1200;
    this.onStatus = options.onStatus || null;
    this.onConflict = options.onConflict || null;
    this.onMerged = options.onMerged || null;
    this.onItemConflict = options.onItemConflict || null;
    /** Collisions raised but not yet answered, so a page can re-open its own UI. */
    this._pendingItemConflicts = [];

    /**
     * Wire name → what a person is called it. `{shots:'doses'}`, or
     * `{shots:{one:'dose', other:'doses'}}` where the plural is irregular. Used by
     * the catch-up notice; anything unlisted is named by its collection name.
     */
    this.collectionLabels = (options.collectionLabels && typeof options.collectionLabels === 'object')
      ? options.collectionLabels : null;

    this.collections = normaliseCollections(options.collections);
    this._specsByName = Object.create(null);
    var byName = this._specsByName;
    this.collections.forEach(function (s) { byName[s.name] = s; });

    var ignore = this.ignoreKeys;
    this.canonical = options.canonical || function (s) {
      return s == null ? null : stableStringify(s, ignore);
    };

    this.deviceId = options.deviceId || this._loadDeviceId();

    /** 'local' | 'syncing' | 'synced' | 'error' | 'conflict' */
    this.syncStatus = 'local';
    this.version = Number(localStorage.getItem(this._versionKey)) || 0;
    /** null until we have seen a response; true once the worker answers with {data,version}. */
    this.versioned = null;

    this._dirty = false;
    this._saveTimer = null;
    this._pendingServerState = null;
    this._pendingServerVersion = 0;
    this._resolving = false;
    /** Set by replaceAll(): the next save is a whole-state replacement, not edits. */
    this._replaceMarker = null;
    /** Another device replaced everything; what that costs THIS device. */
    this._pendingReplaceNotice = null;
  }

  SyncClient.prototype._loadDeviceId = function () {
    var id = null;
    try { id = localStorage.getItem(this._deviceKey); } catch (e) { /* private mode */ }
    if (!id) {
      id = 'd' + Math.random().toString(36).slice(2, 10);
      try { localStorage.setItem(this._deviceKey, id); } catch (e) { /* fine, it is only a label */ }
    }
    return id;
  };

  SyncClient.prototype._setStatus = function (status) {
    this.syncStatus = status;
    if (this.onStatus) { try { this.onStatus(status); } catch (e) { console.error(e); } }
  };

  SyncClient.prototype._setVersion = function (version) {
    this.version = Number(version) || 0;
    try { localStorage.setItem(this._versionKey, String(this.version)); } catch (e) { /* quota */ }
  };

  SyncClient.prototype.isLoggedIn = function () { return !!(this.auth && this.auth.isLoggedIn()); };

  /** Operations are only possible for a page that declared what its items are. */
  SyncClient.prototype._opsEnabled = function () {
    return this.collections.length > 0 && this.versioned !== false && !this._opsUnsupported;
  };

  /** The parked server copy while a conflict is open (meds calls this _pendingServerState). */
  Object.defineProperty(SyncClient.prototype, 'pendingServerState', {
    get: function () { return this._pendingServerState; },
  });

  /** Delete-vs-edit collisions raised but not yet answered. */
  Object.defineProperty(SyncClient.prototype, 'pendingItemConflicts', {
    get: function () { return (this._pendingItemConflicts || []).slice(); },
  });

  /**
   * Set when the parked server copy is there because ANOTHER device replaced all
   * of its data from a backup, rather than because the two copies drifted apart.
   * `{marker, summary, missing}` — the marker the replacing device wrote, the
   * full per-collection diff, and how many entries this device holds that the
   * replacement does not. A page reads this to ask the right question.
   */
  Object.defineProperty(SyncClient.prototype, 'pendingReplaceNotice', {
    get: function () { return this._pendingReplaceNotice; },
  });

  /* ─────────────────────────────── the base ───────────────────────────────
   *
   * My own state as of the last successful sync, plus the server version it came
   * from. It answers "did I change?" and it is what operations are diffed against.
   *
   * Anything unreadable — corrupt JSON, a format from an older client, a partial
   * write — reads as "no base", and no-base means fall back to whole-state saves.
   * A wrong base could push a wrong delete; there is no version of this worth
   * guessing at.
   */

  SyncClient.prototype._readBase = function () {
    var rec = readJson(this._baseKey, null);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return null;
    if (rec.fmt !== BASE_FORMAT) return null;
    if (!isSafeInt(rec.version) || rec.version < 0) return null;
    if (!rec.state || typeof rec.state !== 'object') return null;
    return rec;
  };

  SyncClient.prototype._writeBase = function (state, version) {
    // Only a page with collections can do anything with a base, and it costs a
    // second copy of the state in localStorage. No collections, no base.
    if (!this.collections.length) return false;
    var snapshot = cloneState(state);
    if (snapshot == null || typeof snapshot !== 'object') { this._clearBase(); return false; }
    var ok = writeJson(this._baseKey, {
      fmt: BASE_FORMAT, version: Number(version) || 0, at: Date.now(), state: snapshot,
    });
    // A base that failed to store (quota) must not be left as a stale one — the
    // next diff would be against the wrong ancestor.
    if (!ok) this._clearBase();
    return ok;
  };

  SyncClient.prototype._clearBase = function () {
    try { localStorage.removeItem(this._baseKey); } catch (e) { /* nothing else to do */ }
  };

  /**
   * Has this device EVER completed a sync — as opposed to holding a base it can
   * still read?
   *
   * The difference matters to exactly one caller: the containment check. A base
   * that is corrupt, or written by an older format, is unusable — but it is still
   * evidence that this device once agreed with the account copy, which makes
   * "the server is missing entries I have" as likely to mean "I am stale about a
   * deletion" as "the server is behind". That case keeps the prompt, exactly as it
   * does today. Containment is for a device with no history at all: a first sync,
   * cleared storage, a backup imported before signing in.
   *
   * Unreadable storage answers TRUE — if we cannot tell, we do not optimise.
   */
  SyncClient.prototype._hasBaseRecord = function () {
    try { return localStorage.getItem(this._baseKey) != null; } catch (e) { return true; }
  };

  /* ─────────────────────────────── reading ─────────────────────────────── */

  /**
   * Returns null when the server has no usable copy, the string 'error' when we
   * could not find out, or {state, version, snapshotVersion, ops, snapshot}.
   *
   * null and 'error' MUST stay distinct. Treating a failed fetch as "empty" is what
   * makes a sync overwrite the account copy with stale local data — the exact bug
   * the meds store calls out in its own comment.
   */
  SyncClient.prototype.fetchFromServer = async function () {
    if (!this.isLoggedIn()) return null;
    try {
      var res = await this.auth.fetchWithAuth(this.endpoint, { method: 'GET' });
      if (!res.ok) throw new Error('fetch failed with ' + res.status);
      var body = await res.json();

      var raw, ops = [], snapshotVersion = 0, replace = null;
      if (body && typeof body === 'object' && typeof body.version === 'number' && 'data' in body) {
        this.versioned = true;
        this._setVersion(body.version);
        raw = body.data;
        ops = Array.isArray(body.ops) ? body.ops : [];
        snapshotVersion = isSafeInt(body.snapshotVersion) ? body.snapshotVersion : body.version;
        replace = readReplaceMarker(body.replace);
      } else {
        // An older worker (or main-backend-live) that returns the blob bare.
        this.versioned = false;
        raw = body;
        snapshotVersion = 0;
      }

      if (raw == null || !this.accept(raw)) return null;
      return {
        state: this.normalize(this._materialise(raw, ops)),
        snapshot: raw,
        ops: ops,
        snapshotVersion: snapshotVersion,
        replace: replace,
        version: this.version,
      };
    } catch (e) {
      console.error('[SYNC_WIP] server fetch failed:', e);
      return 'error';
    }
  };

  /** snapshot + ops → the state the server is actually holding. */
  SyncClient.prototype._materialise = function (snapshot, ops) {
    if (!ops || !ops.length) return snapshot;
    if (!this.collections.length) {
      // Operations exist but this page cannot interpret them. The snapshot is still
      // real data, just older; say so rather than silently serving a stale copy.
      console.warn('[SYNC_WIP] ' + ops.length + ' operations could not be applied: no collections declared');
      return snapshot;
    }
    var copy = cloneState(snapshot);
    if (copy == null || typeof copy !== 'object') return snapshot;
    return applyOps(copy, ops, this.collections);
  };

  /* ─────────────────────────────── writing ─────────────────────────────── */

  SyncClient.prototype.markDirty = function () { this.scheduleSave(); };

  SyncClient.prototype.scheduleSave = function () {
    if (!this.isLoggedIn()) return;
    this._dirty = true;
    clearTimeout(this._saveTimer);
    var self = this;
    this._saveTimer = setTimeout(function () { self.saveToServer(); }, this.debounceMs);
  };

  /** Immediate write. Use after destructive operations (reset, import-replace). */
  SyncClient.prototype.flush = async function () {
    if (!this.isLoggedIn()) return false;
    clearTimeout(this._saveTimer);
    this._dirty = true;
    return this.saveToServer();
  };

  /**
   * Save. Returns true on success, false on failure, and the string 'conflict' when
   * the server has moved on and the difference cannot be reconciled without asking.
   */
  SyncClient.prototype.saveToServer = async function (attempt) {
    attempt = attempt || 0;
    if (!this.isLoggedIn() || !this._dirty) return false;
    if (attempt > 2) { this._setStatus('error'); return false; }

    this._dirty = false;
    this._setStatus('syncing');

    // Freeze what we are sending. The user can keep typing during the round trip;
    // whatever they do next is a change against THIS, and the base has to agree
    // with the bytes that actually went up.
    var sending = cloneState(this.getState());
    if (sending === null) sending = this.getState();

    try {
      // The first save of a session may not know the current version. Ask, rather
      // than guessing 0 and eating a pointless 409.
      if (this.versioned !== false && this.version === 0 && attempt === 0) {
        var probe = await this.fetchFromServer();
        if (probe === 'error') throw new Error('could not read current version');
      }

      // A WHOLESALE REPLACEMENT IS NOT AN EDIT. Diffing it against the base would
      // turn "use this backup instead" into one `del` per entry the backup does
      // not contain — and a `del` is applied by every other device without a word.
      // That is how two devices each destroyed the other's medication history.
      // It goes up as a snapshot carrying a marker instead, which lands on the
      // other device as a question rather than as a thousand silent deletions.
      if (this._replaceMarker) return await this._pushSnapshot(sending, attempt);

      var ops = this._pendingOps(sending);
      if (ops) {
        if (ops.length === 0) {
          // Nothing that syncs actually changed — a view-state edit, or a save that
          // raced an identical one. Writing would only churn the version.
          this._setStatus('synced');
          return true;
        }
        return await this._pushOps(ops, sending, attempt);
      }
      return await this._pushSnapshot(sending, attempt);
    } catch (e) {
      console.error('[SYNC_WIP] server save failed:', e);
      this._dirty = true;          // keep the change pending; the next edit retries
      this._setStatus('error');
      return false;
    }
  };

  /**
   * The operations that would bring the server up to `state`, or null when we
   * cannot express it — no base, a base from a different version than the one we
   * believe the server is at, or a collection that will not key. Null means "send
   * the whole state", which is always correct and never deletes anything.
   */
  SyncClient.prototype._pendingOps = function (state) {
    if (!this._opsEnabled()) return null;
    var base = this._readBase();
    if (!base || base.version !== this.version || this.version === 0) return null;
    return diffOps(base.state, state, this.collections, { dev: this.deviceId, ignoreKeys: this.ignoreKeys });
  };

  SyncClient.prototype._pushOps = async function (ops, sending, attempt) {
    var res = await this.auth.fetchWithAuth(this.endpoint, {
      method: 'PUT',
      body: JSON.stringify({ ops: ops, baseVersion: this.version }),
    });

    if (res.status === 409) {
      var conflict = await res.json();
      return this._rebaseOnServer(conflict, ops, sending, attempt);
    }
    if (res.status === 413) {
      // The log outgrew the row, or the push was too big. A snapshot replaces both.
      return this._pushSnapshot(sending, attempt + 1);
    }
    if (res.status >= 400 && res.status < 500) {
      // A worker that does not understand an operation push — this file deployed
      // ahead of the backend. Send the whole state and stop trying for this
      // session; a save must never be lost over a deploy order.
      console.warn('[SYNC_WIP] operation push refused (' + res.status + '); falling back to whole-state saves');
      this._opsUnsupported = true;
      return this._pushSnapshot(sending, attempt);
    }
    if (!res.ok) {
      var errBody = null;
      try { errBody = await res.json(); } catch (e) { /* no body */ }
      throw new Error((errBody && errBody.error) || ('save failed with ' + res.status));
    }

    var body = await res.json();
    this._setVersion(body.version);
    this._writeBase(sending, body.version);
    this._setStatus('synced');

    if (isSafeInt(body.ops) && body.ops > OP_LOG_COMPACT_THRESHOLD) await this._compact(sending);
    return true;
  };

  SyncClient.prototype._pushSnapshot = async function (sending, attempt) {
    var res;
    if (this.versioned === false) {
      // Legacy worker: no version column to check against. Last write wins, as
      // before — the client-side canonical check is the only protection there.
      res = await this.auth.fetchWithAuth(this.endpoint, {
        method: 'POST',
        body: JSON.stringify(sending),
      });
    } else {
      var payload = { data: sending, baseVersion: this.version };
      // The marker rides with the snapshot so the OTHER devices can tell a
      // replacement apart from an ordinary whole-state save. It survives a 409
      // and the retry that follows, and is only dropped once the replacement has
      // actually landed — or been abandoned in favour of the account copy.
      if (this._replaceMarker) payload.replace = this._replaceMarker;
      res = await this.auth.fetchWithAuth(this.endpoint, {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    }

    if (res.status === 409) {
      var conflict = await res.json();
      return this._handleStaleWrite(conflict, sending, attempt);
    }

    if (!res.ok) {
      var errBody = null;
      try { errBody = await res.json(); } catch (e) { /* no body */ }
      throw new Error((errBody && errBody.error) || ('save failed with ' + res.status));
    }

    var okBody = null;
    try { okBody = await res.json(); } catch (e) { okBody = null; }
    if (okBody && typeof okBody.version === 'number') {
      this._setVersion(okBody.version);
      this._writeBase(sending, okBody.version);
    } else {
      // A worker that does not report a version leaves us unable to say what the
      // base is; better none than a wrong one.
      this._clearBase();
    }

    this._replaceMarker = null;   // it landed; from here on these are ordinary edits
    this._setStatus('synced');
    return true;
  };

  /**
   * Replace the live log with a fresh snapshot. The client can do this because it
   * already holds the fully applied state; the worker only stores what it is given.
   * The version does NOT move — the state is identical, only its representation
   * changes — so no other device sees a spurious update.
   */
  SyncClient.prototype._compact = async function (state) {
    try {
      var res = await this.auth.fetchWithAuth(this.endpoint, {
        method: 'PUT',
        body: JSON.stringify({ data: state, baseVersion: this.version, compact: true }),
      });
      if (!res.ok) return false;          // someone wrote first; compaction can wait
      var body = await res.json();
      if (body && typeof body.version === 'number') {
        this._setVersion(body.version);
        this._writeBase(state, body.version);
      }
      return true;
    } catch (e) {
      console.warn('[SYNC_WIP] compaction skipped:', e);
      return false;
    }
  };

  /* ───────────────────────────── rebasing ─────────────────────────────
   *
   * Their operations, then mine on top. Deterministic, and stated outright:
   *
   *   different items              no interaction, just apply
   *   we both edited the same item I am rebasing onto theirs, so MINE APPLIES LAST
   *   we both added the same id    keep one — mine — never two
   *   we both deleted it           gone, nothing to argue about
   *
   *   one side deleted it, the other edited it   ASK — see below
   *
   * ── the one thing this module will not decide ──────────────────────────────
   * A deletion meeting an edit is the only collision where neither answer is
   * obviously right. For a medication log a missing dose record matters more than
   * a stray one — but a deliberate deletion is meant to stick, so either default
   * is a guess. It is raised through onItemConflict, PER ITEM, and:
   *
   *   • the merge does not wait for the answer. Everything else applies and is
   *     pushed immediately; only the disputed entries are outstanding.
   *   • until answered, THE ENTRY IS KEPT — including in the direction where this
   *     device is the one that deleted it. Dismissing the prompt, closing the tab,
   *     a page with no UI for it: all land on the same non-destructive outcome.
   *   • the answer is recorded against the operation version that caused the
   *     collision, so the same one is never raised twice. A NEW deletion of the
   *     same entry is a new operation, and is a new question.
   */

  function collisionKey(op) {
    return op.coll + '\u0000' + op.id + '\u0000' + op.v;
  }

  SyncClient.prototype._rebaseOps = function (state, theirOps, myOps, baseState) {
    var self = this;
    var byName = this._specsByName;
    var mineByKey = Object.create(null);
    (myOps || []).forEach(function (op) { mineByKey[op.coll + '\u0000' + op.id] = op; });

    var resolved = this._readResolved();
    var collisions = [];
    var counted = Object.create(null);
    var stats = {
      applied: 0,
      awaitingDecision: 0,
      theirDeleteBeatMyEdit: 0,
      myDeleteBeatTheirEdit: 0,
      keptOverDelete: 0,
      myEditWon: 0,
      sameIdAddedBothSides: 0,
    };

    function countOnce(key, field) {
      if (counted[key]) return;
      counted[key] = true;
      stats[field] += 1;
    }

    for (var i = 0; i < theirOps.length; i++) {
      var op = theirOps[i];
      var key = op.coll + '\u0000' + op.id;
      var id = String(op.id);
      var mineOp = mineByKey[key];
      var ck;

      if (!mineOp) {
        if (applyOp(state, op, byName)) stats.applied += 1;
        continue;
      }

      if (op.type === 'del') {
        if (mineOp.type === 'del') { continue; }   // both of us deleted it

        // THEY DELETED WHAT I CHANGED.
        ck = collisionKey(op);
        if (resolved[ck] === 'delete') {
          applyOp(state, op, byName);
          countOnce(key, 'theirDeleteBeatMyEdit');
        } else if (resolved[ck] === 'keep') {
          countOnce(key, 'keptOverDelete');
        } else {
          collisions.push({
            key: ck,
            coll: op.coll,
            id: id,
            before: itemIn(byName, baseState, op.coll, id),
            after: itemIn(byName, state, op.coll, id),
            deletedOnThisDevice: false,
            deletedAt: op.at || null,
            deletedBy: op.dev || null,
            editedAt: mineOp.at || null,
            editedBy: self.deviceId,
            wasAdded: mineOp.type === 'add',
          });
          countOnce(key, 'awaitingDecision');
        }
        continue;   // the entry stays until somebody says otherwise
      }

      if (mineOp.type === 'del') {
        // I DELETED WHAT THEY CHANGED. The same collision, the other way round.
        ck = collisionKey(op);
        if (resolved[ck] === 'delete') {
          countOnce(key, 'myDeleteBeatTheirEdit');
          continue;                        // stays deleted, as already decided
        }
        applyOp(state, op, byName);        // restore it: never destroy while undecided
        if (resolved[ck] === 'keep') {
          countOnce(key, 'keptOverDelete');
        } else {
          collisions.push({
            key: ck,
            coll: op.coll,
            id: id,
            before: itemIn(byName, baseState, op.coll, id),
            after: op.item != null ? op.item : itemIn(byName, state, op.coll, id),
            deletedOnThisDevice: true,
            deletedAt: mineOp.at || null,
            deletedBy: self.deviceId,
            editedAt: op.at || null,
            editedBy: op.dev || null,
            wasAdded: op.type === 'add',
          });
          countOnce(key, 'awaitingDecision');
        }
        continue;
      }

      // Both of us touched it. Mine is applied last, so theirs is skipped.
      if (mineOp.type === 'add' && op.type === 'add') countOnce(key, 'sameIdAddedBothSides');
      else countOnce(key, 'myEditWon');
    }
    return { stats: stats, collisions: collisions };
  };

  /* ───────────────────── the bulk-delete guard ─────────────────────
   *
   * Everything above decides between two changes to the SAME entry. This decides
   * something else: whether an incoming batch of deletions is plausible at all.
   *
   * A bulk change is not always an import. Somebody can select a year of doses and
   * delete them by hand, and that has to keep working. So this does not care where
   * the deletions came from — only how many of a collection one sync takes out.
   * Past the threshold they are held back, the entries stay, and the question is
   * asked through the same channel a collision uses. An unanswered question keeps
   * the data and pushes it back, so the other device gets it again too.
   */

  SyncClient.prototype._screenBulkDeletes = function (theirOps, baseState) {
    // Only what the batch actually removes. An entry deleted and then put back
    // inside the same batch is not a deletion, and counting it as one would make
    // the guard fire at a third device over a net change of nothing — including
    // the batch this guard itself produces when somebody answers "keep".
    var lastByKey = Object.create(null);
    (theirOps || []).forEach(function (op) {
      if (op) lastByKey[withheldKey(op)] = op;
    });

    var byColl = Object.create(null);
    (theirOps || []).forEach(function (op) {
      if (!op || op.type !== 'del') return;
      if (lastByKey[withheldKey(op)] !== op) return;   // superseded later in the batch
      (byColl[op.coll] = byColl[op.coll] || []).push(op);
    });

    var withheld = Object.create(null);
    var notices = [];
    var held = 0;
    var names = Object.keys(byColl);
    if (!names.length) return { withheld: withheld, notices: notices, held: 0 };

    var resolved = this._readResolved();
    var byName = this._specsByName;
    var self = this;

    names.forEach(function (coll) {
      var spec = byName[coll];
      if (!spec) return;                       // a collection this page does not know
      var dels = byColl[coll];
      var total = collectionSize(baseState, spec);
      if (dels.length <= bulkDeleteThreshold(total)) return;   // ordinary housekeeping

      // Keyed by the last operation version in the batch, exactly as a collision
      // is: answered once, and a NEW bulk deletion later is a new question.
      var key = 'bulk' + '\u0000' + coll + '\u0000' + (dels[dels.length - 1].v || 0);
      if (resolved[key] === 'delete') return;  // already agreed to; let them through

      dels.forEach(function (op) { withheld[withheldKey(op)] = true; });
      held += dels.length;
      if (resolved[key] === 'keep') return;    // already refused; do not ask again

      var last = dels[dels.length - 1];
      notices.push({
        key: key,
        kind: 'bulk-delete',
        coll: coll,
        ids: dels.map(function (op) { return String(op.id); }),
        count: dels.length,
        total: total,
        threshold: bulkDeleteThreshold(total),
        deletedOnThisDevice: false,
        deletedAt: last.at || null,
        deletedBy: last.dev || null,
        sample: dels.slice(0, 5).map(function (op) {
          return itemIn(byName, baseState, op.coll, op.id);
        }),
      });
    });

    return { withheld: withheld, notices: notices, held: held };
  };

  /** One place builds the held-back key, so the two readers cannot drift apart. */
  function withheldKey(op) { return op.coll + '\u0000' + String(op.id); }
  function isWithheld(withheld, op) { return !!withheld[withheldKey(op)]; }

  /** The incoming operations minus the deletions the guard is holding back. */
  function withoutWithheld(ops, withheld) {
    return ops.filter(function (op) {
      return !(op.type === 'del' && withheld[withheldKey(op)]);
    });
  }

  /* ─────────────────── decisions already taken ───────────────────
   * Keyed by the operation version that caused the collision, so an answer is
   * remembered exactly once and a later deletion of the same entry still asks.
   */

  var MAX_RESOLVED = 200;

  SyncClient.prototype._readResolved = function () {
    var rec = readJson(this._resolvedKey, null);
    var out = Object.create(null);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return out;
    Object.keys(rec).forEach(function (k) {
      var v = rec[k];
      if (v && (v.choice === 'keep' || v.choice === 'delete')) out[k] = v.choice;
    });
    return out;
  };

  SyncClient.prototype._recordResolved = function (key, choice) {
    var rec = readJson(this._resolvedKey, null);
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) rec = {};
    rec[key] = { choice: choice, at: Date.now() };

    var keys = Object.keys(rec);
    if (keys.length > MAX_RESOLVED) {
      // Oldest first. A decision that far back has long since been carried by the
      // log itself; this map exists only to stop a repeat prompt.
      keys.sort(function (a, b) { return (rec[a].at || 0) - (rec[b].at || 0); });
      keys.slice(0, keys.length - MAX_RESOLVED).forEach(function (k) { delete rec[k]; });
    }
    writeJson(this._resolvedKey, rec);
  };

  /**
   * Ask about the disputed entries — AFTER the rest of the merge has been pushed,
   * with nothing in the sync path waiting on the answer.
   *
   * Returns a promise so a page (and the tests) can tell when the questions have
   * been answered. performSync does not await it.
   */
  SyncClient.prototype._raiseCollisions = function (collisions) {
    var self = this;
    if (!collisions || !collisions.length) return Promise.resolve();
    this._pendingItemConflicts = (this._pendingItemConflicts || []).concat(collisions);

    this._collisionPromise = (async function () {
      var answers = null;
      if (self.onItemConflict) {
        try {
          answers = await self.onItemConflict({ collisions: collisions.slice(), client: self });
        } catch (e) {
          // A prompt that fails is a prompt that was not answered: keep everything.
          console.error('[SYNC_WIP] item conflict prompt failed:', e);
          answers = null;
        }
      }

      var doomed = [];
      var done = Object.create(null);
      collisions.forEach(function (c) {
        var choice = (answers && answers[c.key] === 'delete') ? 'delete' : 'keep';
        self._recordResolved(c.key, choice);
        done[c.key] = true;
        if (choice === 'delete') doomed.push(c);
      });
      self._pendingItemConflicts = (self._pendingItemConflicts || [])
        .filter(function (c) { return !done[c.key]; });

      if (!doomed.length) return;

      var live = self.getState();
      doomed.forEach(function (c) {
        // A delete-vs-edit collision is one entry; a bulk-delete notice is a batch
        // of them under one question. Both end here, applied only once said so.
        var ids = Array.isArray(c.ids) ? c.ids : [c.id];
        ids.forEach(function (id) {
          applyOp(live, { type: 'del', coll: c.coll, id: id }, self._specsByName);
        });
      });
      self.setState(live);
      self._dirty = true;
      await self.saveToServer();
    })();

    return this._collisionPromise;
  };

  /** A 409 from an operation push: take theirs, rebase mine on top, push again. */
  SyncClient.prototype._rebaseOnServer = async function (conflict, myOps, sending, attempt) {
    var base = this._readBase();
    var usable = base
      && !conflict.needSnapshot
      && Array.isArray(conflict.missingOps)
      && isSafeInt(conflict.version)
      && isSafeInt(conflict.snapshotVersion)
      && base.version >= conflict.snapshotVersion
      && base.version < conflict.version;

    if (!usable) {
      // Their log no longer reaches back to my base (compaction), or the answer was
      // not one I can replay. Fall back to comparing whole states.
      this._setVersion(conflict.version);
      return this._handleStaleWrite(conflict, sending, attempt);
    }

    var theirOps = conflict.missingOps.filter(function (op) { return op.v > base.version; });
    var theirState = this._conflictState(conflict);

    // Deletions big enough to be an accident are held back before anything is
    // applied. The base still takes them all — that IS what the server holds — so
    // the entries kept here go back up as adds on the push below.
    var screen = this._screenBulkDeletes(theirOps, base.state);

    // My live state, with their changes folded in.
    var mine = this.getState();
    var premerge = cloneState(mine);
    var rebase = this._rebaseOps(mine, withoutWithheld(theirOps, screen.withheld), myOps, base.state);
    rebase.stats.bulkDeletesHeld = screen.held;
    rebase.stats.awaitingDecision += screen.notices.length;

    var newBase = applyOps(cloneState(base.state), theirOps, this.collections);
    // The save was the user's; folding in the other device's changes was not. What
    // this device looked like before that fold-in is stashed, so it can be put back.
    var message = this._describeChange(premerge, mine, 'Merged changes from your other device');
    var actionId = this._stashBefore(premerge, { kind: 'merge', message: message, version: conflict.version });
    this._setVersion(conflict.version);
    this._writeBase(newBase, conflict.version);
    this.setState(mine);

    this._dirty = true;
    var ok = await this.saveToServer(attempt + 1);
    this._reportMerge(rebase.stats, theirOps.length, theirState, sending,
      { actionId: actionId, kind: 'merge', message: message });
    // Everything else is already saved. Only the disputed entries are outstanding,
    // and nothing here waits for the answer.
    this._raiseCollisions(rebase.collisions.concat(screen.notices));
    return ok;
  };

  /** The other side's full state, out of a 409 body. */
  SyncClient.prototype._conflictState = function (conflict) {
    if (conflict.data == null || !this.accept(conflict.data)) return null;
    return this.normalize(this._materialise(conflict.data, Array.isArray(conflict.ops) ? conflict.ops : []));
  };

  /**
   * A 409 does not always mean a conflict a human should see.
   *
   * If the server's copy is canonically identical to ours — the same data, differing
   * only in view/appearance state — this just means the other device wrote first.
   * Adopt its version and write again. Only a real difference reaches the user.
   *
   * Without this, flipping a chart range on the phone would pop a conflict modal on
   * the PC, which is exactly the behaviour the meds store's view-state exclusion was
   * written to prevent.
   */
  SyncClient.prototype._handleStaleWrite = async function (conflict, myState, attempt) {
    this._setVersion(conflict.version);

    var theirs = this._conflictState(conflict);

    if (theirs === null) {
      // Server has nothing usable; ours is the only real copy.
      this._dirty = true;
      return this.saveToServer(attempt + 1);
    }

    if (this.canonical(myState) === this.canonical(theirs)) {
      this._dirty = true;
      return this.saveToServer(attempt + 1);
    }

    this._pendingServerState = theirs;
    this._pendingServerVersion = Number(conflict.version) || 0;
    this._noteReplace(readReplaceMarker(conflict.replace), theirs);
    this._dirty = true;             // still unsaved until the conflict is resolved
    this._setStatus('conflict');
    await this._raiseConflict();
    return 'conflict';
  };

  /**
   * Work out whether the parked server copy is there because another device
   * REPLACED everything, and what that would cost this device. Nothing is applied
   * from a marker; it only decides which question the page asks.
   */
  SyncClient.prototype._noteReplace = function (marker, theirs) {
    this._pendingReplaceNotice = null;
    if (!marker || theirs == null) return;
    if (marker.dev && marker.dev === this.deviceId) return;   // this device did it
    var base = this._readBase();
    if (base && marker.v <= base.version) return;             // already accounted for

    var summary = this.collections.length
      ? diffSummary(this.getState(), theirs, this.collections)
      : null;
    this._pendingReplaceNotice = {
      marker: marker,
      summary: summary,
      // How many entries THIS device holds that the replacement does not. This is
      // the number that matters, and the one nobody was shown.
      missing: summary ? summary.totals.removed : null,
    };
  };

  /* ─────────────────────────────── the sync routine ─────────────────────────────── */

  /**
   * Called after login / session restore.
   * @returns {'in-sync'|'downloaded'|'uploaded'|'merged'|'conflict'|'none'}
   */
  SyncClient.prototype.performSync = async function () {
    if (!this.isLoggedIn()) return 'none';

    var server = await this.fetchFromServer();
    if (server === 'error') {
      // Could not read the account copy — do NOT upload over it. Keep working
      // locally; the next edit or login retries.
      this._setStatus('error');
      return 'none';
    }

    var mine = this.getState();
    var localHas = this.hasData(mine);
    var serverHas = !!(server && this.hasData(server.state));

    if (!serverHas && localHas) {
      this._dirty = true;
      await this.saveToServer();
      return 'uploaded';
    }

    if (serverHas && !localHas) {
      this.setState(server.state);
      this._writeBase(server.state, server.version);
      this._setStatus('synced');
      return 'downloaded';
    }

    if (serverHas && localHas) {
      var resolved = await this._reconcile(server, mine);
      if (resolved) return resolved;

      // No usable base — a first sync, cleared storage, or a page without
      // collections. Fall back to the two-way comparison this module started with.
      if (this.canonical(mine) === this.canonical(server.state)) {
        this._writeBase(mine, server.version);
        this._setStatus('synced');
        return 'in-sync';
      }

      // Before asking: is one side simply contained in the other? That needs no
      // base, so it answers precisely the sync where the prompt is least welcome —
      // the first one on a device. Anything it cannot answer falls straight
      // through to the prompt below, unchanged.
      var caughtUp = await this._catchUpByContainment(server, mine);
      if (caughtUp) return caughtUp;

      this._pendingServerState = server.state;
      this._pendingServerVersion = server.version;
      this._noteReplace(server.replace, server.state);
      this._setStatus('conflict');
      await this._raiseConflict();
      return 'conflict';
    }

    return 'none';
  };

  /**
   * The three-way resolution. Returns null when there is no base to reason from,
   * which leaves the caller on the old two-way path.
   */
  SyncClient.prototype._reconcile = async function (server, mine) {
    if (!this._opsEnabled()) return null;

    var base = this._readBase();
    if (!base) return null;
    // Their log has to still reach back to my base, or I cannot replay it.
    if (base.version < server.snapshotVersion || base.version > server.version) return null;

    // ANOTHER DEVICE REPLACED EVERYTHING. That is not a change to reconcile — it
    // is a statement that a whole different copy of the data is now the account
    // copy. Hand it to the conflict path so the person is told what it costs,
    // rather than adopting it and finding out later.
    if (server.replace && server.replace.v > base.version
        && server.replace.dev !== this.deviceId) return null;

    var myOps = diffOps(base.state, mine, this.collections, { dev: this.deviceId, ignoreKeys: this.ignoreKeys });
    if (!myOps) return null;

    var iChanged = myOps.length > 0;
    var theyChanged = server.version !== base.version;   // integers, no content diffing
    var theirOps = (server.ops || []).filter(function (op) { return op.v > base.version; });

    if (!iChanged && !theyChanged) {
      this._setStatus('synced');
      return 'in-sync';
    }

    if (!iChanged) {
      // I am merely behind. THIS is the case that used to raise a dialog.
      var down = this._screenBulkDeletes(theirOps, base.state);
      if (!down.held) {
        // Silent, but not unrecorded: the person did not ask for this, so what it
        // replaced is stashed and it can be put back from the settings list.
        this._stashBefore(mine, {
          kind: 'catch-up',
          message: this._describeChange(mine, server.state, 'Caught up from your account'),
          version: server.version,
        });
        this.setState(server.state);
        this._writeBase(server.state, server.version);
        this._setVersion(server.version);
        this._setStatus('synced');
        return 'downloaded';
      }

      // Behind, but what I am behind BY is most of a collection being deleted.
      // Take their copy and put the held entries back into it, then publish that:
      // keeping them here while the account copy has lost them would leave a third
      // device with neither answer.
      var keptPre = cloneState(mine);
      var kept = cloneState(server.state);
      var byName = this._specsByName;
      theirOps.forEach(function (op) {
        if (op.type !== 'del' || !isWithheld(down.withheld, op)) return;
        var item = itemIn(byName, base.state, op.coll, op.id);
        // Nothing to put back means the base never held it either: let it go.
        if (item != null) applyOp(kept, { type: 'add', coll: op.coll, id: op.id, item: item }, byName);
      });
      var keptMessage = this._describeChange(keptPre, kept, 'Caught up from your account');
      var keptAction = this._stashBefore(keptPre, { kind: 'catch-up', message: keptMessage, version: server.version });
      this._writeBase(server.state, server.version);
      this._setVersion(server.version);
      this.setState(kept);
      this._dirty = true;
      await this.saveToServer();
      this._reportMerge(
        { applied: theirOps.length - down.held, overridden: 0, awaitingDecision: down.notices.length,
          bulkDeletesHeld: down.held, theirDeleteBeatMyEdit: 0, myDeleteBeatTheirEdit: 0,
          keptOverDelete: 0, myEditWon: 0, sameIdAddedBothSides: 0 },
        theirOps.length, server.state, mine,
        { actionId: keptAction, kind: 'catch-up', message: keptMessage },
      );
      this._raiseCollisions(down.notices);
      return 'merged';
    }

    if (!theyChanged) {
      this._dirty = true;
      await this.saveToServer();
      return 'uploaded';
    }

    // Both sides moved. Rebase mine onto theirs and publish — no dialog, because
    // for everything except a deletion meeting an edit the log has the answer.
    var premerge = cloneState(mine);
    var screen = this._screenBulkDeletes(theirOps, base.state);
    var rebase = this._rebaseOps(mine, withoutWithheld(theirOps, screen.withheld), myOps, base.state);
    rebase.stats.bulkDeletesHeld = screen.held;
    rebase.stats.awaitingDecision += screen.notices.length;
    var newBase = applyOps(cloneState(base.state), theirOps, this.collections);
    // Their changes were folded into this device without anybody being asked, so
    // the copy that existed before the merge is stashed and can be put back.
    var mergeMessage = this._describeChange(premerge, mine, 'Merged changes from your other device');
    var mergeAction = this._stashBefore(premerge, { kind: 'merge', message: mergeMessage, version: server.version });
    this._writeBase(newBase, server.version);
    this._setVersion(server.version);
    this.setState(mine);

    this._dirty = true;
    await this.saveToServer();
    this._reportMerge(rebase.stats, theirOps.length, server.state, premerge,
      { actionId: mergeAction, kind: 'merge', message: mergeMessage });
    // The merge is saved. Disputed entries are asked about afterwards, and the
    // caller is not kept waiting for the answer.
    this._raiseCollisions(rebase.collisions.concat(screen.notices));
    return 'merged';
  };

  /* ─────────────────────── the containment catch-up ───────────────────────
   *
   * Only ever converts a PROMPT into a silent, additive action. It runs nowhere
   * near the three-way logic above: with a base, that logic already answers
   * better, and two paths competing over the same sync is how a resolution policy
   * gets holes in it.
   *
   * Returns 'downloaded' | 'uploaded' | 'in-sync' | 'conflict', or null for "I
   * cannot say" — which leaves the caller on the prompt it was already heading to.
   */
  SyncClient.prototype._catchUpByContainment = async function (server, mine) {
    // 1. A page that declared nothing has no identities to compare. Never guess.
    if (!this.collections.length) return null;
    // 2. Only where there is NO base at all (see _hasBaseRecord).
    if (this._hasBaseRecord()) return null;
    // 3. Another device REPLACED everything. A replacement is a statement about
    //    the whole state, and this module's answer to one has always been to ask.
    //    Silently adopting it — or silently publishing over it — would be a new
    //    resolution policy, which this is explicitly not.
    if (server.replace && server.replace.dev !== this.deviceId) return null;

    var found = containment(mine, server.state, this.collections, this.ignoreKeys);
    if (!found) return null;

    if (found.direction === 'equal') {
      // The declared data matches on both sides; only something excluded from it
      // differs. There is nothing to move and nothing to ask.
      this._writeBase(mine, server.version);
      this._setStatus('synced');
      return 'in-sync';
    }

    if (found.direction === 'behind') {
      // LOCAL ⊆ SERVER. This device is behind and nothing here is at risk: every
      // entry it holds is already on the server, identical.
      var pre = cloneState(mine);
      var message = this._catchUpMessage('download', found);
      var actionId = this._stashBefore(pre, { kind: 'catch-up', message: message, version: server.version });
      this.setState(server.state);
      this._writeBase(server.state, server.version);
      this._setVersion(server.version);
      this._setStatus('synced');
      this._reportCatchUp('download', found, message, server.state, pre, actionId);
      return 'downloaded';
    }

    // SERVER ⊆ LOCAL. The account copy is behind; publishing this device's state
    // adds what it is missing and removes nothing. Nothing changes HERE, so there
    // is nothing to stash and nothing to revert.
    this._dirty = true;
    var saved = await this.saveToServer();
    if (saved === 'conflict') return 'conflict';
    if (saved === true) {
      this._reportCatchUp('upload', found, this._catchUpMessage('upload', found), server.state, mine, null);
    }
    return 'uploaded';
  };

  /** What a collection is called out loud, singular or plural to suit the count. */
  SyncClient.prototype._collectionLabel = function (name, count) {
    var label = this.collectionLabels ? this.collectionLabels[name] : null;
    if (label && typeof label === 'object') {
      return count === 1 ? (label.one || label.other || name) : (label.other || name);
    }
    if (typeof label !== 'string' || !label) label = name;
    return count === 1 ? singularise(label) : label;
  };

  /**
   * "Caught up from your account — 2 doses added, 1 weight changed."
   * The same sentence for a change this module worked out itself rather than by
   * containment, so the recent-actions list reads consistently whichever path
   * produced the entry.
   */
  SyncClient.prototype._describeChange = function (from, to, lead) {
    if (!this.collections.length) return lead + '.';
    var self = this;
    var summary = diffSummary(from, to, this.collections);
    var clauses = [];
    ['added', 'removed', 'changed'].forEach(function (verb) {
      var parts = [];
      summary.collections.forEach(function (row) {
        if (row[verb] > 0) parts.push(row[verb] + ' ' + self._collectionLabel(row.name, row[verb]));
      });
      if (parts.length) clauses.push(joinParts(parts) + ' ' + verb);
    });
    return lead + (clauses.length ? ' — ' + clauses.join(', ') : '') + '.';
  };

  /** "Caught up from your account — 1 dose and 3 weights added." */
  SyncClient.prototype._catchUpMessage = function (direction, found) {
    var self = this;
    var parts = [];
    found.collections.forEach(function (row) {
      var n = direction === 'download' ? row.toLocal : row.toServer;
      if (n > 0) parts.push(n + ' ' + self._collectionLabel(row.name, n));
    });
    var phrase = parts.length ? joinParts(parts) + ' added' : 'nothing to move';
    return (direction === 'download' ? 'Caught up from your account — ' : 'Updated your account — ')
      + phrase + '.';
  };

  /**
   * Say what was decided. The client asked for this over a fully silent version,
   * and it is a NOTICE, not a question: nothing waits on it, and ignoring it is
   * the same as confirming it. Revert is offered here and, because a dismissed
   * notice is not a recovery path, from the recent-actions list as well.
   */
  SyncClient.prototype._reportCatchUp = function (direction, found, message, theirs, pre, actionId) {
    var self = this;
    var moved = direction === 'download' ? found.toLocal : found.toServer;
    var info = {
      kind: 'catch-up',
      direction: direction,
      message: message,
      collections: found.collections.map(function (row) {
        var n = direction === 'download' ? row.toLocal : row.toServer;
        return { name: row.name, label: self._collectionLabel(row.name, n), count: n };
      }).filter(function (row) { return row.count > 0; }),
      // The fields a page's existing onMerged handler already reads.
      changesFromOtherDevice: direction === 'download' ? moved : 0,
      applied: direction === 'download' ? moved : 0,
      sent: direction === 'upload' ? moved : 0,
      overridden: 0,
      awaitingDecision: 0,
      stats: {
        applied: direction === 'download' ? moved : 0,
        awaitingDecision: 0, theirDeleteBeatMyEdit: 0, myDeleteBeatTheirEdit: 0,
        keptOverDelete: 0, myEditWon: 0, sameIdAddedBothSides: 0, bulkDeletesHeld: 0,
        containment: direction,
      },
      theirs: theirs,
      mine: pre,
      client: this,
    };
    addRevertActions(this, info, actionId, direction === 'upload'
      ? 'nothing on this device changed'
      : 'this device could not store a copy to go back to');
    if (this.onMerged) {
      try { this.onMerged(info); } catch (e) { console.error(e); }
    } else {
      console.info('[SYNC_WIP] ' + message);
    }
  };

  /* ─────────────────────── revert: the stash and its stack ───────────────────────
   *
   * An automatic change is one the person did not ask for: a catch-up, a silent
   * merge. Before one of those touches the data, the state it is about to replace
   * is stashed, and the change becomes revertable — from the notice while it is on
   * screen, and from the recent-actions list long after it is gone.
   *
   * A change the person DID ask for is not stashed. An import already showed a
   * preview and asked; an edit is the person typing. Filling the stack with those
   * would push the automatic ones — the only ones nobody chose — off the end.
   */

  function addRevertActions(client, info, actionId, whyNot) {
    info.actionId = actionId || null;
    info.revertable = !!actionId;
    info.notRevertableBecause = actionId ? null : whyNot;
    // Dismissing IS confirming. The action already happened; a dismissal, a closed
    // tab or a page with no UI for this must never undo it.
    info.confirm = function () { return true; };
    info.revert = function () {
      return actionId ? client.revertAction(actionId) : Promise.resolve(false);
    };
  }

  SyncClient.prototype._readUndo = function () {
    var rec = readJson(this._undoKey, null);
    if (!rec || rec.fmt !== UNDO_FORMAT || !Array.isArray(rec.actions)) return [];
    return rec.actions.filter(function (a) {
      return a && typeof a.id === 'string' && a.state && typeof a.state === 'object';
    });
  };

  SyncClient.prototype._writeUndo = function (actions) {
    return writeJson(this._undoKey, { fmt: UNDO_FORMAT, actions: actions });
  };

  /**
   * Stash the state an automatic change is about to replace. Returns the action id,
   * or NULL when it could not be stored — in which case the caller carries on
   * regardless and the change is simply reported as not revertable. A sync must
   * never fail over its own undo copy.
   */
  SyncClient.prototype._stashBefore = function (preState, meta) {
    var snapshot = cloneState(preState);
    if (snapshot == null || typeof snapshot !== 'object') return null;
    var id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    var actions = this._readUndo();
    actions.unshift({
      id: id,
      at: Date.now(),
      kind: (meta && meta.kind) || 'sync',
      message: (meta && meta.message) || 'A sync changed this device',
      version: (meta && isSafeInt(meta.version)) ? meta.version : this.version,
      state: snapshot,
    });
    if (actions.length > UNDO_LIMIT) actions.length = UNDO_LIMIT;      // newest first
    // A failed write leaves whatever was stored before intact, so older actions
    // stay revertable; only this one is not.
    if (!this._writeUndo(actions)) return null;
    return id;
  };

  /**
   * What can still be put back, newest first. Without the stashed states — a page
   * only needs to name them and offer the button.
   */
  SyncClient.prototype.recentActions = function () {
    return this._readUndo().map(function (a) {
      return { id: a.id, at: a.at, kind: a.kind, message: a.message, version: a.version, revertable: true };
    });
  };

  /**
   * PUT THIS DEVICE BACK to where it was before an automatic change.
   *
   * Reverting means publishing OLDER data over the account copy, which would undo
   * whatever the other device did in between. That is a wholesale replacement, not
   * an edit, so it travels the same way an import-replace does: as a marked
   * snapshot, never as per-item deletions. The other device is TOLD ("this device
   * went back to an earlier copy — N entries here are not in it") and keeps
   * everything it has until it answers. A revert cannot delete anything on another
   * device without somebody agreeing to it.
   *
   * Reverting also drops the stashed actions NEWER than this one: they describe
   * states that no longer happened.
   */
  SyncClient.prototype.revertAction = async function (id) {
    var actions = this._readUndo();
    var ix = -1;
    for (var i = 0; i < actions.length; i++) {
      if (actions[i].id === id) { ix = i; break; }
    }
    if (ix === -1) return false;                       // already used, or aged out

    var restored = cloneState(actions[ix].state);
    if (restored == null) return false;

    var summary = this.collections.length
      ? diffSummary(this.getState(), restored, this.collections)
      : null;
    this._writeUndo(actions.slice(ix + 1));

    var ok = await this.replaceAll(restored, {
      source: 'revert',
      removed: summary ? summary.totals.removed : 0,
      kept: summary ? (summary.totals.identical + summary.totals.changed) : 0,
    });
    // replaceAll answers false when there is no account to publish to. The device
    // itself has still been put back, which is what was asked for.
    return !!ok || !this.isLoggedIn();
  };

  /**
   * "Merged 3 changes from your other device." Not a dialog: nothing is waiting on
   * the user. Both pre-merge copies ride along so a page can still offer keep-mine
   * or keep-theirs afterwards.
   */
  SyncClient.prototype._reportMerge = function (stats, theirOpCount, theirState, myState, extra) {
    var overridden = stats.theirDeleteBeatMyEdit + stats.myDeleteBeatTheirEdit
      + stats.keptOverDelete + stats.myEditWon + stats.sameIdAddedBothSides;
    if (!theirOpCount && !overridden && !stats.awaitingDecision) return;   // nothing worth saying
    var info = {
      changesFromOtherDevice: theirOpCount,
      applied: stats.applied,
      overridden: overridden,
      awaitingDecision: stats.awaitingDecision,
      stats: stats,
      theirs: theirState,
      mine: myState,
      client: this,
    };
    // A merge is an automatic change too, so it carries the same confirm / revert
    // the catch-up notice does when its pre-merge state was stashed.
    //
    // Every caller today stashes first and passes the id, so a missing id means the
    // stash genuinely failed (quota). A caller that never attempted one must NOT
    // inherit that explanation — telling someone their browser is out of space when
    // nothing was ever written is worse than saying nothing. `stashed: false` says
    // so honestly.
    addRevertActions(this, info, extra && extra.actionId,
      extra && extra.stashed === false
        ? 'this kind of change is not recorded for undo'
        : 'this device could not store a copy to go back to');
    if (extra && extra.message) { info.kind = extra.kind || 'merge'; info.message = extra.message; }
    if (this.onMerged) {
      try { this.onMerged(info); } catch (e) { console.error(e); }
    } else {
      console.info('[SYNC_WIP] merged ' + theirOpCount + ' change(s) from another device', stats);
    }
  };

  /** Replace everything with `state` and publish it. Backs keep-mine / keep-theirs. */
  SyncClient.prototype.replaceState = async function (state) {
    if (state == null) return false;
    this.setState(state);
    this._dirty = true;
    return this.saveToServer();
  };

  /**
   * WHOLESALE REPLACEMENT — an import over the top, or a reset. Not an edit.
   *
   * The difference matters because of what the other devices see. An edit ships as
   * operations, and a `del` operation is applied by every other device without
   * asking. Diffing a replacement against the base produces one `del` for every
   * entry the new state does not contain, so "I restored my backup" arrives on the
   * other device as a thousand deletions it carries out in silence. Two devices
   * importing different backups then wipe each other, which is exactly what
   * happened: neither backup was a superset, so each import destroyed what was
   * only in the other.
   *
   * So a replacement goes up as a SNAPSHOT carrying a marker. A snapshot moves the
   * whole state to a new version with no log to replay, which already forces every
   * other device onto the conflict path rather than the silent-apply path; the
   * marker is what lets that device say WHY, and how much it stands to lose,
   * instead of showing a generic "these two copies differ".
   *
   * @param {any} state       the state to publish, whole
   * @param {object} [meta]   {source:'import'|'reset'|…, removed, kept}
   */
  SyncClient.prototype.replaceAll = async function (state, meta) {
    if (state == null) return false;
    this.setState(state);
    this._replaceMarker = {
      at: Date.now(),
      dev: this.deviceId,
      source: (meta && typeof meta.source === 'string') ? meta.source.slice(0, 32) : 'replace',
      removed: (meta && isSafeInt(meta.removed) && meta.removed >= 0) ? meta.removed : 0,
      kept: (meta && isSafeInt(meta.kept) && meta.kept >= 0) ? meta.kept : 0,
    };
    if (!this.isLoggedIn()) return false;   // local-only; nothing to mark on a server
    clearTimeout(this._saveTimer);
    this._dirty = true;
    return this.saveToServer();
  };

  /* ─────────────────────────────── conflict resolution ───────────────────────────────
   *
   * Only reachable without collections, or when there is no base to reason from.
   * Three outcomes, exactly as meds has had them:
   *   'mine'   — keep this device, push it over the account copy
   *   'theirs' — take the account copy
   *   'merge'  — union both, dedupe by content key (only where the page can merge)
   */

  SyncClient.prototype._raiseConflict = async function () {
    if (this._resolving) return;
    this._resolving = true;
    try {
      var choice;
      if (this.onConflict) {
        // The page has its own modal (meds does). It may resolve by itself and
        // return nothing — in that case we do not second-guess it.
        choice = await this.onConflict({
          mine: this.getState(),
          theirs: this._pendingServerState,
          theirVersion: this._pendingServerVersion,
          canMerge: !!this.merge,
          client: this,
        });
      } else {
        choice = await this.promptConflict();
      }
      if (choice === 'mine') await this.resolveConflict(false);
      else if (choice === 'theirs') await this.resolveConflict(true);
      else if (choice === 'merge') await this.resolveConflictMerge();
    } finally {
      this._resolving = false;
    }
  };

  /** @param {boolean} useServer true = keep the account copy, false = keep this device */
  SyncClient.prototype.resolveConflict = async function (useServer) {
    var pending = this._pendingServerState;
    var pendingVersion = this._pendingServerVersion;
    this._pendingServerState = null;
    this._pendingReplaceNotice = null;

    if (useServer && pending) {
      // Taking the account copy abandons whatever replacement this device was
      // holding; it must not be published later as though it were still wanted.
      this._replaceMarker = null;
      this.setState(pending);
      this._writeBase(pending, pendingVersion || this.version);
      this._dirty = false;
      this._setStatus('synced');
      return true;
    }

    this._dirty = true;
    return this.saveToServer();
  };

  /** Keep BOTH sides. Requires a merge function from the page. */
  SyncClient.prototype.resolveConflictMerge = async function () {
    var pending = this._pendingServerState;
    this._pendingServerState = null;
    this._pendingReplaceNotice = null;
    // Keeping both sides is the opposite of replacing one with the other.
    this._replaceMarker = null;
    if (!pending) return false;
    if (!this.merge) {
      console.warn('[SYNC_WIP] no merge function configured; keeping this device');
      this._dirty = true;
      return this.saveToServer();
    }

    var merged = this.merge(pending, this.getState());
    // A merge function that mutates the page's own state in place (meds' mergeIn
    // does) may return nothing; in that case the store has already been updated.
    if (merged !== undefined && merged !== null) this.setState(merged);

    this._dirty = true;
    return this.saveToServer();
  };

  /* ─────────────────────────────── built-in prompt ───────────────────────────────
   * For pages without their own modal. Self-contained: no page CSS required, and it
   * inherits the page's colours through currentColor / color-scheme so it does not
   * look pasted in. */

  SyncClient.prototype.promptConflict = function () {
    var self = this;
    var mine = this.getState();
    var theirs = this._pendingServerState;

    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.setAttribute('role', 'dialog');
      wrap.setAttribute('aria-modal', 'true');
      wrap.setAttribute('aria-label', 'Data sync conflict');
      wrap.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:flex', 'align-items:center', 'justify-content:center',
        'background:rgba(0,0,0,.6)', 'padding:16px',
        'font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif',
      ].join(';');

      var card = document.createElement('div');
      card.style.cssText = [
        'max-width:640px', 'width:100%', 'max-height:86vh', 'overflow:auto',
        'background:Canvas', 'color:CanvasText', 'color-scheme:light dark',
        'border-radius:12px', 'padding:20px',
        'box-shadow:0 12px 40px rgba(0,0,0,.45)',
      ].join(';');

      var mineSummary = self.summary ? self.summary(mine) : describe(mine);
      var theirsSummary = self.summary ? self.summary(theirs) : describe(theirs);

      var title = document.createElement('h2');
      title.textContent = 'Data sync conflict';
      title.style.cssText = 'margin:0 0 6px;font-size:18px';

      var sub = document.createElement('p');
      sub.textContent = self.merge
        ? 'This device and your account have both changed. Merge keeps everything from both.'
        : 'This device and your account have both changed. Choose which copy to keep.';
      sub.style.cssText = 'margin:0 0 14px;opacity:.8';

      var grid = document.createElement('div');
      grid.style.cssText = 'display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));margin-bottom:14px';
      grid.appendChild(column('This device', mineSummary));
      grid.appendChild(column('Your account', theirsSummary));

      var both = document.createElement('details');
      both.style.cssText = 'margin-bottom:14px';
      var bothSummaryEl = document.createElement('summary');
      bothSummaryEl.textContent = 'Show both in full';
      bothSummaryEl.style.cssText = 'cursor:pointer;opacity:.85';
      var pre = document.createElement('pre');
      pre.style.cssText = 'max-height:240px;overflow:auto;font-size:12px;white-space:pre-wrap;word-break:break-word;opacity:.85';
      pre.textContent =
        '── this device ──\n' + safeJson(mine) + '\n\n── your account ──\n' + safeJson(theirs);
      both.appendChild(bothSummaryEl);
      both.appendChild(pre);

      var foot = document.createElement('div');
      foot.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end';

      function button(label, value, primary) {
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.style.cssText = [
          'padding:8px 14px', 'border-radius:8px', 'cursor:pointer',
          'border:1px solid currentColor',
          primary ? 'background:currentColor;filter:none' : 'background:transparent',
          'color:inherit', 'font:inherit',
        ].join(';');
        if (primary) {
          b.style.background = 'rgba(127,127,127,.25)';
          b.style.fontWeight = '600';
        }
        b.addEventListener('click', function () { close(value); });
        return b;
      }

      foot.appendChild(button('Keep this device', 'mine', !self.merge));
      foot.appendChild(button('Keep account copy', 'theirs', false));
      if (self.merge) foot.appendChild(button('Merge both', 'merge', true));

      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(grid);
      card.appendChild(both);
      card.appendChild(foot);
      wrap.appendChild(card);
      document.body.appendChild(wrap);

      // No backdrop-close and no Escape: dismissing this without choosing would
      // leave the save pending and the two copies silently divergent.
      var firstButton = foot.querySelector('button');
      if (firstButton) firstButton.focus();

      function close(value) {
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
        resolve(value);
      }

      function column(heading, text) {
        var col = document.createElement('div');
        col.style.cssText = 'border:1px solid rgba(127,127,127,.4);border-radius:8px;padding:10px';
        var h = document.createElement('h3');
        h.textContent = heading;
        h.style.cssText = 'margin:0 0 6px;font-size:14px';
        var p = document.createElement('p');
        p.textContent = text;
        p.style.cssText = 'margin:0;opacity:.85';
        col.appendChild(h);
        col.appendChild(p);
        return col;
      }
    });
  };

  function describe(state) {
    if (state == null || typeof state !== 'object') return 'No data';
    var parts = [];
    Object.keys(state).forEach(function (k) {
      var v = state[k];
      if (Array.isArray(v) && v.length) parts.push(v.length + ' ' + k);
    });
    return parts.length ? parts.join(', ') : Object.keys(state).length + ' fields';
  }

  function safeJson(value) {
    try { return JSON.stringify(value, null, 2); } catch (e) { return String(value); }
  }

  global.SyncWip = {
    SyncClient: SyncClient,
    stableStringify: stableStringify,
    defaultHasData: defaultHasData,
    // Exported for tests and for a page that wants to reason about a log itself.
    diffOps: diffOps,
    applyOps: applyOps,
    normaliseCollections: normaliseCollections,
    // What a change WOULD do, counted and not applied. An import preview is built
    // on this: added / removed / changed / identical, per collection.
    diffSummary: diffSummary,
    // Is one side wholly contained in the other? The no-base catch-up is built on
    // this: 'behind' | 'ahead' | 'equal', or null for "cannot say".
    containment: containment,
    OP_LOG_COMPACT_THRESHOLD: OP_LOG_COMPACT_THRESHOLD,
    UNDO_LIMIT: UNDO_LIMIT,
    BULK_DELETE_FRACTION: BULK_DELETE_FRACTION,
    BULK_DELETE_MIN_ITEMS: BULK_DELETE_MIN_ITEMS,
    bulkDeleteThreshold: bulkDeleteThreshold,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
