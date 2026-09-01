// ================================================
// store.js — app state, localStorage persistence,
// backend sync (AuthManagerWip), v1 migration, import/export
// ================================================
(function () {
    'use strict';
    const D = window.MedData;

    const APP_NAME = 'med-tracker-v2';
    const V1_APP_NAME = 'med-tracker';
    const ENVIRONMENT = 'wip'; // 'live' or 'wip'
    const STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_state`;
    const V1_PREFIX = `${V1_APP_NAME}_${ENVIRONMENT}_`;

    const LOGGING = ENVIRONMENT === 'wip';
    const log = (...a) => { if (LOGGING) console.log('[STORE]', ...a); };

    // settings that belong to THIS DEVICE (phone vs PC want different views);
    // they are excluded from sync-conflict detection and never adopted from
    // the server — each device keeps its own copy in DEVICE_KEY
    const DEVICE_KEY = `${APP_NAME}_${ENVIRONMENT}_device`;
    const DEVICE_KEYS = ['theme', 'accent', 'textScale', 'dashAll', 'chartOrder',
        'showMedLevel', 'showWeight', 'showCalendar', 'showStats',
        'medRange', 'medProjection', 'medLevelScope', 'medYDensity', 'medYFit', 'medShowDots', 'medChartHeight', 'weightRange', 'historyPageSize',
        'pushEnabled']; // push subscriptions are per-browser, so the toggle is too

    // Settings the sync fingerprint ignores. Two lists, deliberately:
    //
    //   DEVICE_KEYS          never leave this device at all — they generate no sync
    //                        operation and none is ever applied to them, so flipping
    //                        a chart range on your phone is not news for your PC.
    //   VIEW_ONLY_SETTINGS   the above plus two that DO sync but must never look
    //                        like a data conflict. They ride along as ordinary
    //                        settings changes, exactly as they always have.
    const VIEW_ONLY_SETTINGS = DEVICE_KEYS.concat(['medLevelRange', 'onboardedAt']);

    // What the sync engine treats as items. /sync-wip.js knows nothing about doses —
    // it is told which fields are collections, how to identify an item, and (where
    // it exists) which clock the item carries. Everything here is keyed by `id`,
    // which every dose, weight, med and pen has had since v2.
    //
    // Not listed: `version` (a constant) and `activeMedId` (per device — normalize()
    // resets it from the device blob anyway). Neither generates an operation.
    const SYNC_COLLECTIONS = [
        { name: 'meds', identity: m => m.id },
        { name: 'trashedMeds', identity: m => m.id },
        { name: 'shots', identity: x => x.id, timestamp: x => x.timestamp },
        { name: 'weights', identity: x => x.id, timestamp: x => x.timestamp },
        { name: 'pens', identity: p => p.id },
        { name: 'settings', kind: 'map', ignore: DEVICE_KEYS },
        { name: 'user', kind: 'map' },
    ];

    // Collection names are wire identifiers; these are what a person is shown.
    // Used by the import preview and by anything else that has to name a
    // collection out loud.
    const COLLECTION_LABELS = {
        shots: 'doses',
        weights: 'weights',
        meds: 'medications',
        trashedMeds: 'archived medications',
        pens: 'supply',
        settings: 'settings',
        user: 'profile',
    };

    const DEFAULT_SETTINGS = {
        dateFormat: 'dd/mm/yyyy',
        timeFormat: '12hr',
        weekStart: 'Monday',
        weightUnit: 'kg',
        heightUnit: 'cm',
        goalKg: null,
        startKg: null,
        userHeight: null,
        showBmi: false,
        weightTrackingEnabled: true,
        shotLocationTrackingEnabled: true,
        shotLocations: D.DEFAULT_LOCATIONS.slice(),
        // appearance / layout
        theme: 'dark',
        accent: 'teal',
        chartOrder: 'level-first',
        showMedLevel: true,
        showWeight: true,
        showCalendar: true,
        showStats: true,
        medLevelRange: 60,
        medRange: 'm',
        medProjection: 'auto',
        medLevelScope: 'all',
        medYDensity: 'auto',
        medYFit: false,     // float the y-axis floor near the lowest level instead of 0
        medShowDots: true,  // dose markers along the bottom of the med chart
        medChartHeight: 'm',
        weightRange: 'm',
        historyPageSize: 20,  // rows per page on the History tables
        pushEnabled: false,   // dose/supply push reminders on THIS device
        supplyAlertDays: 1,   // supply-low push when ≤ this many days of doses left
        textScale: 'md',   // mobile text zoom: md | lg | xl
        dashAll: false,     // dashboard shows the all-meds overview when multiple meds
        onboardedAt: null,
    };

    // Stored meds are snapshots of the preset at creation time. When presets
    // gain new data (missed-dose guidance, titration, split-dose info…) fill
    // in anything the stored copy is missing — never overwrite user values.
    function upgradeMedFromPreset(m) {
        if (!m) return m;
        const preset = D.MED_PRESETS.find(p =>
            p.presetId === m.presetId || p.name.toLowerCase() === String(m.name || '').toLowerCase());
        if (!preset) return m;
        const merged = Object.assign({}, m);
        if (!merged.presetId) merged.presetId = preset.presetId;
        ['missedDose', 'titration', 'splitDose', 'clicksPerDose', 'timeToPeak', 'generic', 'type', 'pensPerPackage', 'category'].forEach(k => {
            if (merged[k] == null && preset[k] != null) merged[k] = preset[k];
        });
        // note + source text aren't user-editable, so always refresh them from
        // the preset (keeps citation links current); the numeric window values
        // stay as the user set them
        if (merged.missedDose && preset.missedDose) {
            merged.missedDose = Object.assign({}, merged.missedDose, {
                note: preset.missedDose.note,
                sourceLabel: preset.missedDose.sourceLabel,
                sourceUrl: preset.missedDose.sourceUrl,
            });
        }
        return merged;
    }

    function emptyState() {
        return {
            version: 2,
            user: { name: '' },
            meds: [],
            trashedMeds: [],
            activeMedId: null,
            shots: [],
            weights: [],
            pens: [],
            settings: Object.assign({}, DEFAULT_SETTINGS),
        };
    }

    // ------------------------------------------------
    // Store
    // ------------------------------------------------
    const Store = {
        state: emptyState(),
        auth: null,           // AuthManagerWip, set in init
        sync: null,           // SyncWip.SyncClient, set in init
        listeners: [],
        syncStatus: 'local',  // 'local' | 'syncing' | 'synced' | 'error' | 'conflict'

        init() {
            this.auth = new AuthManagerWip(APP_NAME, ENVIRONMENT);
            this.loadLocal();
            this.initSync();
        },

        // The sync engine that used to live in this file now lives in
        // /sync-wip.js so every page gets it. Everything meds-specific — what
        // counts as data vs view state, what an item is, how two copies merge —
        // is handed to it here.
        //
        // It ships CHANGES, not the whole blob: what was added, edited or deleted
        // since this device last synced, with the server assigning the version
        // numbers. Being behind is no longer a conflict, a deletion is no longer
        // undone by the next merge, and "both devices changed" no longer stops the
        // user to ask a question the log can already answer.
        initSync() {
            const self = this;
            this.sync = new SyncWip.SyncClient({
                auth: this.auth,
                appName: APP_NAME,
                getState: () => self.state,
                setState: (s) => { self.state = s; self.saveLocal(); self.emit('change'); },
                normalize: (raw) => self.normalize(raw),
                // empty blob from the backend looks like {shotHistory:[],weightHistory:[],settings:{}}
                accept: (raw) => !!raw && raw.version === 2,
                canonical: (s) => self.canonical(s),
                hasData: (s) => !!(s && ((s.shots || []).length || (s.weights || []).length || (s.meds || []).length)),
                // union both sides, dedupe by content key — mergeIn mutates state
                merge: (theirs) => { self.mergeIn(theirs); return self.state; },
                debounceMs: 1200,
                onStatus: (status) => { self.syncStatus = status; self.emit('sync'); },

                // Doses, weights, meds and supply are items with ids, so the sync
                // engine can ship what CHANGED rather than the whole blob — and a
                // deletion travels as a deletion instead of being un-done by the
                // next union merge.
                collections: SYNC_COLLECTIONS,
                // So the sync engine's own sentences say "1 dose", not "1 shot".
                collectionLabels: COLLECTION_LABELS,
                // Which med is on screen belongs to this device (normalize() takes
                // it from the device blob), so it is not a change worth shipping.
                // Anything else outside SYNC_COLLECTIONS that changes — `version`,
                // if the schema is ever bumped — forces a whole-state save rather
                // than being quietly left behind.
                ignoreKeys: ['activeMedId'],

                // The one thing sync will not decide by itself: a dose deleted on
                // one device and edited on the other. Asked per entry, AFTER the
                // rest of the merge has already been saved, and never destructive
                // unless the answer says so — dismissing keeps the entry.
                onItemConflict: (info) => {
                    if (!window.Modals || !window.Modals.syncItemConflicts) return undefined;
                    return window.Modals.syncItemConflicts(info.collisions);
                },

                // Both devices changed something else? That is no longer a question
                // for the user: their changes are applied, mine go on top, and the
                // app just says what happened. The modal below is now only reached
                // when there is no base to reason from (a first sync, cleared
                // storage, or a device away past a compaction).
                //
                // A CATCH-UP (info.kind === 'catch-up') arrives the same way: the
                // sync worked out that this device was simply behind — or that the
                // account copy was — and moved the data without asking. It is
                // announced rather than asked, with the two actions the client
                // wanted: Confirm, and Revert. Ignoring the toast is Confirm; the
                // action already happened and a dismissal must never undo it.
                // Revert stays available afterwards, in Settings → Recent sync
                // actions, because a notice you have already dismissed is not a
                // recovery path.
                onMerged: (info) => {
                    self.emit('change');
                    if (!window.UI || !window.UI.toast) return;
                    const n = info.changesFromOtherDevice;
                    let msg = info.message || `Merged ${n} change${n === 1 ? '' : 's'} from your other device`;
                    if (info.stats.myEditWon) msg += ` · ${info.stats.myEditWon} kept from this device`;
                    if (info.awaitingDecision) {
                        msg += ` · ${info.awaitingDecision} need${info.awaitingDecision === 1 ? 's' : ''} a decision`;
                    }
                    if (!info.revertable) {
                        // Say plainly when it cannot be undone, rather than offering
                        // a button that does nothing. An upload changed nothing on
                        // this device, so there is nothing to say about undoing it.
                        if (info.direction !== 'upload') msg += ' · can\'t be undone on this device';
                        window.UI.toast(msg);
                        return;
                    }
                    window.UI.toast(msg, '', {
                        duration: 9000,
                        actions: [
                            { label: 'Revert', act: () => self.revertSyncAction(info.actionId) },
                            { label: 'OK', act: () => info.confirm(), primary: true },
                        ],
                        onDismiss: () => info.confirm(),
                    });
                },

                // meds has its own conflict modal. It is opened from here rather
                // than from the performSync caller, because a conflict can now
                // arrive two ways: from a sync after login, OR from a background
                // save that the server refused as stale. The second one has no
                // caller to notice it, so the modal has to be raised here or that
                // conflict would sit parked and invisible.
                //
                // The modal resolves by calling Store.resolveConflict /
                // resolveConflictMerge itself, so nothing is returned here.
                onConflict: () => {
                    self.showConflictModal();
                    return undefined;
                },
            });
        },

        onChange(fn) { this.listeners.push(fn); },
        emit(what) { this.listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); },

        // ---------- local persistence ----------
        loadLocal() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (raw) {
                    const parsed = JSON.parse(raw);
                    this.state = this.normalize(parsed);
                    return;
                }
            } catch (e) { console.error('Failed to load local state', e); }
            this.state = this.normalize(emptyState());
        },

        saveLocal() {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
                // device prefs live in their own blob so phone and PC don't
                // fight over view state through account sync
                const dev = { activeMedId: this.state.activeMedId, settings: {} };
                DEVICE_KEYS.forEach(k => { dev.settings[k] = this.state.settings[k]; });
                localStorage.setItem(DEVICE_KEY, JSON.stringify(dev));
            }
            catch (e) { console.error('Failed to save local state', e); }
        },

        normalize(s) {
            const base = emptyState();
            const out = Object.assign(base, s || {});
            out.settings = Object.assign({}, DEFAULT_SETTINGS, (s && s.settings) || {});
            out.meds = (out.meds || []).filter(Boolean).map(upgradeMedFromPreset);
            out.trashedMeds = (out.trashedMeds || []).map(upgradeMedFromPreset);
            out.shots = (out.shots || []).filter(x => x && x.timestamp);
            out.weights = (out.weights || []).filter(x => x && x.timestamp && !isNaN(parseFloat(x.kg)));
            out.pens = out.pens || [];
            // device-specific keys never come from synced data: reset to defaults,
            // then overlay whatever THIS device last used
            DEVICE_KEYS.forEach(k => { out.settings[k] = DEFAULT_SETTINGS[k]; });
            try {
                const dev = JSON.parse(localStorage.getItem(DEVICE_KEY) || 'null');
                if (dev) {
                    DEVICE_KEYS.forEach(k => { if (dev.settings && dev.settings[k] != null) out.settings[k] = dev.settings[k]; });
                    if (dev.activeMedId && out.meds.some(m => m.id === dev.activeMedId)) out.activeMedId = dev.activeMedId;
                    else out.activeMedId = null; // fall through to next-due
                }
            } catch (e) { /* ignore corrupt device blob */ }
            if (!out.activeMedId || !out.meds.some(m => m.id === out.activeMedId)) {
                out.activeMedId = null; // resolved lazily to the next-due med
            }
            return out;
        },

        // mutate state, persist, schedule server save, re-render
        update(fn, opts) {
            fn(this.state);
            this.saveLocal();
            if (!opts || !opts.skipServer) this.scheduleServerSave();
            if (!opts || !opts.silent) this.emit('change');
        },

        // ---------- derived helpers ----------
        // the med whose next dose comes soonest (overdue counts as soonest)
        nextDueMed() {
            let best = null, bestTs = Infinity;
            for (const med of this.state.meds) {
                const nd = D.predictNextDose(med, this.medShots(med.id), this.state.settings);
                const ts = nd ? new Date(nd.date).getTime() : Infinity - 1;
                if (ts < bestTs) { best = med; bestTs = ts; }
            }
            return best;
        },

        activeMed() {
            const s = this.state;
            let m = s.meds.find(x => x.id === s.activeMedId);
            if (!m && s.meds.length) {
                m = this.nextDueMed() || s.meds[0];
                s.activeMedId = m.id;
            }
            return m || null;
        },
        medShots(medId) {
            return this.state.shots.filter(s => s.medId === medId).sort((a, b) => b.timestamp - a.timestamp);
        },
        medPens(medId) {
            return D.recomputePenState(this.state.pens.filter(p => p.medId === medId), this.state.shots);
        },
        sortedWeights() {
            return this.state.weights.slice().sort((a, b) => a.timestamp - b.timestamp);
        },
        hasData() {
            const s = this.state;
            return s.shots.length > 0 || s.weights.length > 0 || s.meds.length > 0;
        },

        // ---------- backend sync ----------
        isLoggedIn() { return this.auth && this.auth.isLoggedIn(); },

        scheduleServerSave() { if (this.sync) this.sync.scheduleSave(); },

        // immediate write, for a change that must not sit in the debounce.
        // NOT for a reset or a replace-import: those go through replaceAllOnServer,
        // because a flush would ship them as one deletion per entry.
        async flushToServer() { return this.sync ? this.sync.flush() : false; },

        async saveToServer() { return this.sync ? this.sync.saveToServer() : false; },

        // null = server has no v2 data; 'error' = we couldn't find out.
        // The two MUST stay distinct: treating a failed fetch as "empty"
        // makes performSync overwrite the account copy with stale local data.
        async fetchFromServer() {
            if (!this.sync) return null;
            const out = await this.sync.fetchFromServer();
            if (out === 'error' || out === null) return out;
            return out.state;
        },

        // the server copy parked while a conflict is open (Modals.syncConflict reads this)
        get _pendingServerState() { return this.sync ? this.sync.pendingServerState : null; },

        // Set when that parked copy is there because ANOTHER device replaced all of
        // its data from a backup. The conflict modal reads it to ask the specific
        // question — "N of your entries are not in it" — instead of the generic one.
        get _pendingReplaceNotice() { return this.sync ? this.sync.pendingReplaceNotice : null; },

        // Human labels for the sync collections, so the modals do not each invent
        // their own names for the same things.
        collectionLabel(name) { return COLLECTION_LABELS[name] || name; },

        // ---------- automatic sync changes, and putting them back ----------
        //
        // Changes NOBODY ASKED FOR — a catch-up from the account copy, a silent
        // merge — stash the state they replaced first. Settings lists them so a
        // revert is still reachable after the toast has gone.
        //
        // Reverting publishes older data over the account copy, so the sync engine
        // sends it as a marked wholesale replacement: the other device is asked
        // rather than emptied. Nothing here can delete another device's data.
        recentSyncActions() {
            if (!this.sync || typeof this.sync.recentActions !== 'function') return [];
            try { return this.sync.recentActions(); } catch (e) { console.error(e); return []; }
        },

        async revertSyncAction(id) {
            if (!id || !this.sync || typeof this.sync.revertAction !== 'function') return false;
            let ok = false;
            try {
                ok = await this.sync.revertAction(id);
            } catch (e) {
                console.error('Failed to revert a sync action', e);
                ok = false;
            }
            this.emit('change');
            if (window.UI && window.UI.toast) {
                window.UI.toast(ok
                    ? 'Put back — your other device will be asked before it changes'
                    : 'That change can no longer be undone', ok ? '' : 'error');
            }
            return ok;
        },

        // Open the conflict modal at most once. Called from the sync client; also
        // safe for app.js to call after performSync returns 'conflict'.
        showConflictModal() {
            if (this._conflictModalOpen) return;
            if (!window.Modals || !window.Modals.syncConflict) return;
            if (!this._pendingServerState) return;
            // Cleared when the user picks a side (see resolveConflict below) —
            // syncConflict() returns as soon as the modal is on screen, so
            // clearing it here would defeat the guard.
            this._conflictModalOpen = true;
            try {
                window.Modals.syncConflict();
            } catch (e) {
                this._conflictModalOpen = false;
                console.error('Failed to open the sync conflict modal', e);
            }
        },

        // canonical string for conflict detection.
        // View/appearance preferences are deliberately EXCLUDED — flipping a
        // graph range on your phone must never trigger the sync-conflict
        // prompt on your PC. They still sync (last device to write wins);
        // only real data differences ask the user to pick a side.
        canonical(s) {
            if (!s) return null;
            const VIEW_ONLY = VIEW_ONLY_SETTINGS;
            const shots = (s.shots || []).map(x => [x.timestamp, x.medId, x.dose, x.location || ''].join('|')).sort();
            const weights = (s.weights || []).map(x => [x.timestamp, Math.round(x.kg * 10) / 10].join('|')).sort();
            const pens = (s.pens || []).map(x => [x.id, x.dose, x.capacity].join('|')).sort();
            const meds = (s.meds || []).map(x => [x.id, x.name, (x.doses || []).join(','), x.frequency, x.halfLife, x.preferredNextDose != null ? x.preferredNextDose : ''].join('|')).sort();
            const set = Object.keys(DEFAULT_SETTINGS).filter(k => !VIEW_ONLY.includes(k)).sort().map(k => {
                const v = (s.settings || {})[k];
                return k + '=' + (Array.isArray(v) ? v.join(',') : JSON.stringify(v != null ? v : null));
            });
            return JSON.stringify({ shots, weights, pens, meds, set, user: (s.user && s.user.name) || '' });
        },

        summary(s) {
            const shots = (s.shots || []).slice().sort((a, b) => b.timestamp - a.timestamp);
            const weights = (s.weights || []).slice().sort((a, b) => b.timestamp - a.timestamp);
            const lastShot = shots[0] || null;
            const lastWeight = weights[0] || null;
            let lastUpdate = null;
            if (lastShot) lastUpdate = lastShot.timestamp;
            if (lastWeight && (!lastUpdate || lastWeight.timestamp > lastUpdate)) lastUpdate = lastWeight.timestamp;
            return { shotCount: shots.length, weightCount: weights.length, lastShot, lastWeight, lastUpdate };
        },

        // After login / session restore. Returns:
        //  'in-sync' | 'downloaded' | 'uploaded' | 'conflict' (caller shows modal) | 'none'
        // The decision table lives in /sync-wip.js now; it is the same one.
        async performSync() {
            if (!this.sync) return 'none';
            return this.sync.performSync();
        },

        resolveConflict(useServer) {
            this._conflictModalOpen = false;
            if (this.sync) this.sync.resolveConflict(useServer);
        },

        // keep BOTH sides: union each section (doses/weights/meds/supply,
        // dedup by content keys via mergeIn), then push the combined copy up
        resolveConflictMerge() {
            this._conflictModalOpen = false;
            if (this.sync) this.sync.resolveConflictMerge();
        },

        // ---------- v1 detection + migration ----------
        detectV1Local() {
            try {
                const shots = JSON.parse(localStorage.getItem(V1_PREFIX + 'shotHistory') || '[]');
                const weights = JSON.parse(localStorage.getItem(V1_PREFIX + 'weightHistory') || '[]');
                const settings = JSON.parse(localStorage.getItem(V1_PREFIX + 'userSettings') || '{}');
                if (shots.length || weights.length) return { shotHistory: shots, weightHistory: weights, userSettings: settings };
            } catch (e) { /* ignore */ }
            return null;
        },

        async detectV1Server() {
            if (!this.isLoggedIn()) return null;
            try {
                const url = `${this.auth.config.backendUrl}/api/data/${V1_APP_NAME}`;
                const res = await this.auth.fetchWithAuth(url, { method: 'GET' });
                if (!res.ok) return null;
                const body = await res.json();
                // the versioned worker answers {data, version}; older ones answer the blob bare
                const data = (body && typeof body.version === 'number' && 'data' in body) ? body.data : body;
                if (!data) return null;
                if ((data.shotHistory && data.shotHistory.length) || (data.weightHistory && data.weightHistory.length)) {
                    return { shotHistory: data.shotHistory || [], weightHistory: data.weightHistory || [], userSettings: data.settings || {} };
                }
            } catch (e) { /* ignore */ }
            return null;
        },

        // Convert a v1-format payload ({shotHistory, weightHistory, userSettings})
        // into v2 entities. Returns {meds, shots, weights, pens, settings, user}.
        convertV1(payload) {
            const out = emptyState();
            const vs = payload.userSettings || {};

            // meds: create from preset by name found in shots
            const medByKey = {};
            const ensureMed = (name) => {
                const key = String(name || 'mounjaro').toLowerCase();
                if (medByKey[key]) return medByKey[key];
                const preset = D.MED_PRESETS.find(p => p.presetId === key || p.name.toLowerCase() === key);
                const id = key.replace(/\s+/g, '-');
                const med = preset
                    ? Object.assign({}, preset, { id })
                    : { id, name: name || 'Unknown', generic: '', type: 'injection', doses: [], frequency: 7, halfLife: 5, timeToPeak: 0, penCapacity: 4, pensPerPackage: 1, unit: 'mg', color: '#5fc8c8' };
                out.meds.push(med);
                medByKey[key] = med;
                return med;
            };

            (payload.shotHistory || []).forEach((s, i) => {
                const ts = new Date(s.dateTime).getTime();
                if (isNaN(ts)) return;
                const med = ensureMed(s.medication);
                const dose = parseFloat(s.dose);
                if (!isNaN(dose) && med.doses.indexOf(dose) === -1) med.doses = med.doses.concat([dose]).sort((a, b) => a - b);
                const dt = new Date(ts);
                out.shots.push({
                    id: 'shot-v1-' + ts + '-' + i,
                    medId: med.id, dose,
                    date: D.ymd(dt), time: D.hm(dt), timestamp: ts,
                    location: s.location || null,
                    penId: s.penId || null,
                });
            });

            (payload.weightHistory || []).forEach((w, i) => {
                const ts = new Date(w.dateTime).getTime();
                const kg = parseFloat(w.weightKg);
                if (isNaN(ts) || isNaN(kg)) return;
                const dt = new Date(ts);
                out.weights.push({ id: 'w-v1-' + ts + '-' + i, date: D.ymd(dt), time: D.hm(dt), timestamp: ts, kg });
            });

            // v1 pens live inside userSettings.pens
            (vs.pens || []).forEach(p => {
                const med = ensureMed(p.medication);
                out.pens.push({
                    id: p.id,
                    medId: med.id,
                    dose: parseFloat(p.dose),
                    capacity: p.dosesTotal || 4,
                    used: 0, // recomputed from shots
                    openedDate: p.dateStarted ? D.ymd(new Date(p.dateStarted)) : null,
                    exhaustedDate: null,
                    note: '',
                });
            });

            // infer pens for orphan shots
            out.meds.forEach(med => {
                const orphans = out.shots.filter(s => s.medId === med.id && !s.penId);
                if (!orphans.length) return;
                const { pens, assignment } = D.inferPensFromShots(orphans, med);
                out.shots.forEach(s => { if (assignment[s.id]) s.penId = assignment[s.id]; });
                out.pens = out.pens.concat(pens);
            });

            // settings
            const set = out.settings;
            if (vs.dateFormat) set.dateFormat = vs.dateFormat;
            if (vs.timeFormat) set.timeFormat = vs.timeFormat;
            if (vs.weekStart) set.weekStart = vs.weekStart;
            if (vs.weightUnit) set.weightUnit = vs.weightUnit === 'lb' ? 'lbs' : vs.weightUnit;
            if (vs.heightUnit) set.heightUnit = vs.heightUnit;
            if (vs.goalWeight != null) set.goalKg = parseFloat(vs.goalWeight);
            if (vs.userHeight != null) set.userHeight = parseFloat(vs.userHeight);
            if (vs.showBmi != null) set.showBmi = !!vs.showBmi;
            if (vs.shotLocationTrackingEnabled != null) set.shotLocationTrackingEnabled = !!vs.shotLocationTrackingEnabled;
            if (Array.isArray(vs.shotLocations) && vs.shotLocations.length) set.shotLocations = vs.shotLocations.slice();
            const firstW = out.weights.slice().sort((a, b) => a.timestamp - b.timestamp)[0];
            set.startKg = firstW ? firstW.kg : null;

            out.activeMedId = out.meds[0] ? out.meds[0].id : null;
            return out;
        },

        // merge another v2-shaped state into current (dedup by timestamp+dose / timestamp+kg)
        //
        // ADDITIVE ONLY. It joins; it never removes. `target` lets a caller merge
        // into a scratch copy — that is how the import preview counts what a merge
        // would do without doing it, using the real merge rather than a description
        // of it that could drift away from the code.
        mergeIn(incoming, target) {
            const s = target || this.state;
            const shotKeys = new Set(s.shots.map(x => x.timestamp + '|' + x.dose + '|' + x.medId));
            const wKeys = new Set(s.weights.map(x => x.timestamp + '|' + x.kg));
            const medIds = new Set(s.meds.map(m => m.id));
            incoming.meds.forEach(m => { if (!medIds.has(m.id)) s.meds.push(m); });
            // trashed meds ride along too — their kept doses need a med to belong to
            const trashIds = new Set((s.trashedMeds || []).map(m => m.id));
            (incoming.trashedMeds || []).forEach(m => {
                if (!medIds.has(m.id) && !trashIds.has(m.id)) (s.trashedMeds = s.trashedMeds || []).push(m);
            });
            incoming.shots.forEach(x => { if (!shotKeys.has(x.timestamp + '|' + x.dose + '|' + x.medId)) s.shots.push(x); });
            incoming.weights.forEach(x => { if (!wKeys.has(x.timestamp + '|' + x.kg)) s.weights.push(x); });
            const penIds = new Set(s.pens.map(p => p.id));
            incoming.pens.forEach(p => { if (!penIds.has(p.id)) s.pens.push(p); });
            if (!s.activeMedId && s.meds[0]) s.activeMedId = s.meds[0].id;
            // adopt imported settings (goal weight, locations, formats…) wherever
            // the user hasn't already customised away from the defaults
            const inc = incoming.settings || {};
            Object.keys(inc).forEach(k => {
                if (!(k in DEFAULT_SETTINGS) || k === 'onboardedAt') return;
                const defV = JSON.stringify(DEFAULT_SETTINGS[k]);
                if (inc[k] != null && JSON.stringify(s.settings[k]) === defV && JSON.stringify(inc[k]) !== defV) {
                    s.settings[k] = inc[k];
                }
            });
            if (!s.user.name && incoming.user && incoming.user.name) s.user.name = incoming.user.name;
        },

        // ---------- import / export ----------
        exportBackup() {
            const s = this.state;
            const medById = {};
            s.meds.concat(s.trashedMeds).forEach(m => { medById[m.id] = m; });
            // v1-compatible top level + full v2 payload for round-trip
            const backup = {
                shotHistory: s.shots.slice().sort((a, b) => b.timestamp - a.timestamp).map(x => {
                    const e = {
                        dateTime: new Date(x.timestamp).toISOString(),
                        medication: (medById[x.medId] ? medById[x.medId].name.toLowerCase() : x.medId),
                        dose: String(x.dose),
                    };
                    if (x.location) e.location = x.location;
                    return e;
                }),
                weightHistory: s.weights.slice().sort((a, b) => a.timestamp - b.timestamp).map(x => ({
                    dateTime: new Date(x.timestamp).toISOString(), weightKg: x.kg,
                })),
                userSettings: {
                    weightUnit: s.settings.weightUnit,
                    goalWeight: s.settings.goalKg,
                    userHeight: s.settings.userHeight,
                    showBmi: s.settings.showBmi,
                    dateFormat: s.settings.dateFormat,
                    timeFormat: s.settings.timeFormat,
                    weekStart: s.settings.weekStart,
                    shotLocations: s.settings.shotLocations,
                    shotLocationTrackingEnabled: s.settings.shotLocationTrackingEnabled,
                    _v2: s, // full fidelity round-trip
                },
            };
            return new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        },

        // Parse any supported backup text → { kind: 'v2'|'v1', state | payload }
        parseBackup(text) {
            const obj = typeof text === 'string' ? JSON.parse(text) : text;
            if (!obj || typeof obj !== 'object') throw new Error('Not a JSON object');
            if (obj.version === 2 && obj.shots) return { kind: 'v2', state: this.normalize(obj) };
            if (obj.userSettings && obj.userSettings._v2) return { kind: 'v2', state: this.normalize(obj.userSettings._v2) };
            if (obj.shotHistory || obj.weightHistory) {
                const settings = obj.userSettings || obj.settings || {};
                return { kind: 'v1', payload: { shotHistory: obj.shotHistory || [], weightHistory: obj.weightHistory || [], userSettings: settings } };
            }
            throw new Error('Unrecognised backup format');
        },

        // What an import WOULD do, per collection, before anything is touched.
        //
        // The client asked for this outright, and the reason is the bug that
        // produced it: a replace-import of a backup that is not a superset deletes
        // everything the backup lacks, and until now nothing said so. "This will
        // delete 1084 entries" is the sentence that would have prevented it.
        //
        // Merge is computed by actually merging into a scratch copy, so the number
        // shown is the number the real merge produces and cannot drift from it.
        //
        // @returns {{mode, kind, incoming, summary, collections, totals}}
        previewImport(parsed, mode) {
            const incoming = parsed.kind === 'v2' ? parsed.state : this.convertV1(parsed.payload);
            const specs = SyncWip.normaliseCollections(SYNC_COLLECTIONS);

            let target;
            if (mode === 'replace') {
                target = incoming;
            } else {
                target = JSON.parse(JSON.stringify(this.state));
                this.mergeIn(incoming, target);
            }

            const summary = SyncWip.diffSummary(this.state, target, specs);
            return {
                mode: mode === 'replace' ? 'replace' : 'merge',
                kind: parsed.kind,
                incoming,
                target,
                summary,
                collections: summary.collections.map(row => Object.assign({
                    label: COLLECTION_LABELS[row.name] || row.name,
                }, row)),
                totals: summary.totals,
            };
        },

        // mode: 'merge' | 'replace'
        //
        // MERGE is additive and travels as ordinary operations, because that is
        // what it is: some entries were added.
        //
        // REPLACE does NOT. Diffing a wholesale replacement against the last synced
        // state turns it into one `del` per entry the backup does not contain, and
        // every other device applies a `del` without asking. Two devices importing
        // two different backups then delete each other's data — which is precisely
        // what happened here, silently, to real medication history. It goes up as a
        // marked whole-state replacement instead, and the other device is asked.
        importBackup(parsed, mode) {
            const replacing = mode === 'replace';
            const preview = this.previewImport(parsed, mode);
            const incoming = preview.incoming;

            if (replacing) {
                incoming.settings.onboardedAt = incoming.settings.onboardedAt || Date.now();
                this.state = incoming;
            } else {
                this.mergeIn(incoming);
            }
            this.saveLocal();
            this.emit('change');

            if (!replacing) return this.flushToServer();
            return this.replaceAllOnServer({
                source: 'import',
                removed: preview.totals.removed,
                kept: preview.totals.identical + preview.totals.changed,
            });
        },

        resetAll() {
            // A reset is the same kind of event as a replace-import: everything
            // goes. Sent as per-item deletes it would empty the other device too,
            // with no way for that device to know why.
            const specs = SyncWip.normaliseCollections(SYNC_COLLECTIONS);
            const gone = SyncWip.diffSummary(this.state, emptyState(), specs).totals.removed;
            this.state = emptyState();
            this.saveLocal();
            this.emit('change');
            return this.replaceAllOnServer({ source: 'reset', removed: gone, kept: 0 });
        },

        // Publish the current state as a whole-state replacement rather than as a
        // set of edits. Falls back to a plain flush on a page with no sync client.
        async replaceAllOnServer(meta) {
            if (!this.sync) return false;
            return this.sync.replaceAll(this.state, meta);
        },
    };

    window.Store = Store;
    window.MED_ENVIRONMENT = ENVIRONMENT;
})();
