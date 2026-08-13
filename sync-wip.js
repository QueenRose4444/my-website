// sync-wip.js — shared browser data-sync module (WIP).
//
// This is the meds v2 sync engine, generalised. It is not a new design.
//
// wip/meds/js/store.js already solved the hard parts and has been carrying them in
// production on the app Rose uses daily:
//
//   • a canonical fingerprint of state for conflict detection, with VIEW STATE
//     DELIBERATELY EXCLUDED — changing a chart's date range on your phone must never
//     look like a data conflict on your PC
//   • a sync routine returning 'in-sync' | 'downloaded' | 'uploaded' | 'conflict' | 'none'
//   • the server copy parked in _pendingServerState on conflict, never applied silently
//   • three resolutions, including a union-and-dedupe merge that loses nothing
//   • a dirty flag plus a debounce so typing does not hammer the backend
//
// What this module adds is the one thing a client-side check cannot do: close the
// race where two devices both read, both decide there is no conflict, and both
// write. The worker now versions every app_data row, a save carries the version it
// was based on, and a stale save comes back 409 with the current state. See
// backend/cloudflare-workers/main-backend-wip/sync-wip.js.
//
// The app-specific parts — what counts as data vs view state, and how to merge two
// copies — are supplied by the page. Defaults exist for simple pages; meds passes
// its own and therefore behaves exactly as it does today.
//
// NOTE: the notes app does NOT use this. It has its own backend and CRDT merging,
// which resolves concurrent edits without ever asking a human.

(function (global) {
  'use strict';

  /* ─────────────────────────────── defaults ─────────────────────────────── */

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
   * @param {(s:any)=>string}    [options.canonical]  conflict fingerprint
   * @param {(s:any)=>boolean}   [options.hasData]
   * @param {(theirs:any, mine:any)=>any} [options.merge]  union both sides; omit to
   *        hide the "merge both" option. Where a page can merge, merge is the
   *        recommended default — it is the only resolution that loses nothing.
   * @param {(s:any)=>string}    [options.summary]    one-line description per side
   * @param {string[]}           [options.ignoreKeys] keys the default canonical drops
   * @param {number}             [options.debounceMs] default 1200
   * @param {(status:string)=>void} [options.onStatus]
   * @param {(info:object)=>Promise<'mine'|'theirs'|'merge'>} [options.onConflict]
   *        Return which side wins. Omit to use the built-in prompt.
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

    var ignore = this.ignoreKeys;
    this.canonical = options.canonical || function (s) {
      return s == null ? null : stableStringify(s, ignore);
    };

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
  }

  function readJson(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* quota */ }
  }

  SyncClient.prototype._setStatus = function (status) {
    this.syncStatus = status;
    if (this.onStatus) { try { this.onStatus(status); } catch (e) { console.error(e); } }
  };

  SyncClient.prototype._setVersion = function (version) {
    this.version = Number(version) || 0;
    try { localStorage.setItem(this._versionKey, String(this.version)); } catch (e) { /* quota */ }
  };

  SyncClient.prototype.isLoggedIn = function () { return !!(this.auth && this.auth.isLoggedIn()); };

  /** The parked server copy while a conflict is open (meds calls this _pendingServerState). */
  Object.defineProperty(SyncClient.prototype, 'pendingServerState', {
    get: function () { return this._pendingServerState; },
  });

  /* ─────────────────────────────── reading ─────────────────────────────── */

  /**
   * Returns null when the server has no usable copy, the string 'error' when we
   * could not find out, or {state, version}.
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

      var raw;
      if (body && typeof body === 'object' && typeof body.version === 'number' && 'data' in body) {
        this.versioned = true;
        this._setVersion(body.version);
        raw = body.data;
      } else {
        // An older worker (or main-backend-live) that returns the blob bare.
        this.versioned = false;
        raw = body;
      }

      if (raw == null || !this.accept(raw)) return null;
      return { state: this.normalize(raw), version: this.version };
    } catch (e) {
      console.error('[SYNC_WIP] server fetch failed:', e);
      return 'error';
    }
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
   * the server has moved on and the difference is a real one.
   */
  SyncClient.prototype.saveToServer = async function (attempt) {
    attempt = attempt || 0;
    if (!this.isLoggedIn() || !this._dirty) return false;
    if (attempt > 2) { this._setStatus('error'); return false; }

    this._dirty = false;
    this._setStatus('syncing');

    var state = this.getState();
    try {
      // The first save of a session may not know the current version. Ask, rather
      // than guessing 0 and eating a pointless 409.
      if (this.versioned !== false && this.version === 0 && attempt === 0) {
        var probe = await this.fetchFromServer();
        if (probe === 'error') throw new Error('could not read current version');
      }

      var res;
      if (this.versioned === false) {
        // Legacy worker: no version column to check against. Last write wins, as
        // before — the client-side canonical check is the only protection there.
        res = await this.auth.fetchWithAuth(this.endpoint, {
          method: 'POST',
          body: JSON.stringify(state),
        });
      } else {
        res = await this.auth.fetchWithAuth(this.endpoint, {
          method: 'PUT',
          body: JSON.stringify({ data: state, baseVersion: this.version }),
        });
      }

      if (res.status === 409) {
        var conflict = await res.json();
        return this._handleStaleWrite(conflict, state, attempt);
      }

      if (!res.ok) {
        var errBody = null;
        try { errBody = await res.json(); } catch (e) { /* no body */ }
        throw new Error((errBody && errBody.error) || ('save failed with ' + res.status));
      }

      var okBody = null;
      try { okBody = await res.json(); } catch (e) { okBody = null; }
      if (okBody && typeof okBody.version === 'number') this._setVersion(okBody.version);

      this._setStatus('synced');
      return true;
    } catch (e) {
      console.error('[SYNC_WIP] server save failed:', e);
      this._dirty = true;          // keep the change pending; the next edit retries
      this._setStatus('error');
      return false;
    }
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

    var theirs = null;
    if (conflict.data != null && this.accept(conflict.data)) {
      theirs = this.normalize(conflict.data);
    }

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
    this._dirty = true;             // still unsaved until the conflict is resolved
    this._setStatus('conflict');
    await this._raiseConflict();
    return 'conflict';
  };

  /* ─────────────────────────────── the sync routine ─────────────────────────────── */

  /**
   * Called after login / session restore.
   * @returns {'in-sync'|'downloaded'|'uploaded'|'conflict'|'none'}
   *
   * Same decision table as the meds store, unchanged.
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
      this._setStatus('synced');
      return 'downloaded';
    }

    if (serverHas && localHas) {
      if (this.canonical(mine) !== this.canonical(server.state)) {
        this._pendingServerState = server.state;
        this._pendingServerVersion = server.version;
        this._setStatus('conflict');
        await this._raiseConflict();
        return 'conflict';
      }
      this._setStatus('synced');
      return 'in-sync';
    }

    return 'none';
  };

  /* ─────────────────────────────── conflict resolution ───────────────────────────────
   *
   * Three outcomes, exactly as meds has today:
   *   'mine'   — keep this device, push it over the account copy
   *   'theirs' — take the account copy
   *   'merge'  — union both, dedupe by content key (only where the page can merge)
   *
   * Merge is the recommended default wherever it is available, because it is the
   * only one of the three that cannot lose a record. For append-mostly data — a
   * dose log, a weight history — that matters more than picking a winner.
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
    this._pendingServerState = null;

    if (useServer && pending) {
      this.setState(pending);
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
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
