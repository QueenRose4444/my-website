// ================================================
// store.js — app state, localStorage persistence,
// backend sync (AuthManagerWip), v1 migration, import/export
// ================================================
(function () {
    'use strict';
    const D = window.MedData;

    const APP_NAME = 'med-tracker-v2';
    const V1_APP_NAME = 'med-tracker';
    // 'live' on the public site, 'wip' everywhere else — decided by the host, so this
    // file needs no edit when it is promoted.
    const ENVIRONMENT = (window.SiteEnv && window.SiteEnv.current()) || 'wip';
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
        'medRange', 'medProjection', 'medLevelScope', 'medSubstances', 'medYDensity', 'medYFit', 'medShowDots', 'medChartHeight', 'weightRange', 'historyPageSize',
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

    // What the sync-conflict dialog never lists as a difference. Each of these
    // changes whenever something the person did changes, and says nothing more:
    // a dose's `timestamp` is its date and time again, `notifKey` is which reminder
    // it answered. (DEVICE_KEYS are hidden already — they are the settings
    // collection's `ignore` list.)
    const CONFLICT_HIDDEN = ['shots.timestamp', 'shots.notifKey', 'weights.timestamp', 'pains.timestamp']
        .concat(VIEW_ONLY_SETTINGS.map(k => 'settings.' + k));

    // What the sync engine treats as items. /sync-wip.js knows nothing about doses —
    // it is told which fields are collections, how to identify an item, and (where
    // it exists) which clock the item carries. Everything here is keyed by `id`,
    // which every dose, weight, med and container has had since v2.
    //
    // Not listed: `version` (a constant) and `activeMedId` (per device — normalize()
    // resets it from the device blob anyway). Neither generates an operation.
    //
    // ADDING A COLLECTION MEANS SIX EDITS, and five of them fail silently.
    //   1. emptyState()        a new install has the field at all
    //   2. normalize()         a state loaded from anywhere older gets the field
    //   3. SYNC_COLLECTIONS    this list — no `identity` and normaliseCollections
    //                          DROPS it with only a console.warn, which degrades the
    //                          client to shipping whole snapshots instead of ops
    //   4. COLLECTION_LABELS   or the import preview names it by its wire name
    //   5. canonical()         no longer a risk — it now covers every field — but it
    //                          is still the place an exclusion would go
    //   6. mergeIn()           or an import silently drops the collection entirely
    //
    // Note the two keying schemes that are easy to conflate: sync identity is `id`,
    // while import/merge dedupe is CONTENT-based (see mergeIn). A collection needs a
    // sensible answer for both.
    const SYNC_COLLECTIONS = [
        { name: 'meds', identity: m => m.id },
        { name: 'trashedMeds', identity: m => m.id },
        { name: 'shots', identity: x => x.id, timestamp: x => x.timestamp },
        { name: 'weights', identity: x => x.id, timestamp: x => x.timestamp },
        // Pain entries and DVPRS daily check-ins, told apart by `kind`. One
        // collection for both, so pain tracking costs one registration, not two.
        { name: 'pains', identity: x => x.id, timestamp: x => x.timestamp },
        { name: 'pens', identity: p => p.id },
        // The ONLY user-owned substance data — the curated table is code and is
        // deliberately not synced. All six registration edits below are done;
        // five of them fail silently if they are not.
        { name: 'substances', identity: x => x.id },
        // A map, not a list: it is keyed by substance id and a user only ever has
        // a handful. Six registration edits again — the recipe is at the top of this
        // block and five of the six still fail silently.
        { name: 'substanceLimits', kind: 'map' },
        { name: 'settings', kind: 'map', ignore: DEVICE_KEYS },
        { name: 'user', kind: 'map' },
    ];

    // Collection names are wire identifiers; these are what a person is shown.
    // Used by the import preview and by anything else that has to name a
    // collection out loud.
    const COLLECTION_LABELS = {
        shots: 'doses',
        weights: 'weights',
        pains: 'pain entries',
        meds: 'medications',
        trashedMeds: 'archived medications',
        pens: 'supply',
        substances: 'substances',
        substanceLimits: 'dose limits',
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
        // Off for someone tracking only weight or pain: the meds parts of every page go,
        // the data stays exactly as it is.
        medsTrackingEnabled: true,
        // Pain tracking is opt-in: off means no Log row, no history tab, no prompts.
        painTrackingEnabled: false,
        painScale: 'nrs',             // 'nrs' | 'dvprs'
        painQuickFields: [],          // pain details shown up front instead of under "More detail"
        // How meds are ordered wherever one is picked: 'smart' | 'most' | 'time' | 'az' | 'custom'
        medPickerOrder: 'smart',
        medCustomOrder: [],
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
        // Which SUBSTANCES are drawn, as opposed to which products. A
        // non-empty list puts the chart in substance mode; clearing it returns to
        // products. Per-device, because it is a view preference like every other
        // control on that chart.
        medSubstances: [],
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

    // ---------- provenance ----------
    // Which fields can ever arrive from somewhere other than the user. `_prov`
    // holds one of 'curated' | 'pbs' | 'user' per field.
    //
    // 🔴 AN UNMARKED FIELD MEANS 'user', AND THAT IS NOT A BUG TO FIX.
    // Everything that exists today was either typed by a person or copied from a
    // preset at creation time, and there is no record of which. Provenance cannot
    // be retrofitted accurately — that is precisely why it is recorded from the
    // start rather than later. Do not "improve" this by back-filling a
    // guess: a field wrongly marked `curated` is one the preset reconciliation will
    // silently overwrite.
    const PROVENANCE_FIELDS = [
        'halfLife', 'timeToPeak', 'doses', 'frequency', 'unit',
        'penCapacity', 'pensPerPackage', 'missedDose', 'titration',
        'splitDose', 'clicksPerDose', 'ingredients',
    ];

    /** Provenance of one field. Unrecorded means the user owns it. */
    function provOf(med, field) {
        return (med && med._prov && med._prov[field]) || 'user';
    }

    // Stored meds are snapshots of the preset at creation time. When presets
    // gain new data (missed-dose guidance, titration, split-dose info…) fill
    // in anything the stored copy is missing — never overwrite user values.
    function upgradeMedFromPreset(m) {
        if (!m) return m;
        // Matching on the NAME is the fragile half: a med created before `presetId`
        // existed has only its name to go on, and the preset "Vyvanse / Elvanse" was
        // renamed to "Vyvanse". `aka` carries the old spelling so that rename does not silently
        // orphan anyone's med — which would look like losing its schedule and its
        // missed-dose guidance for no visible reason.
        const nm = String(m.name || '').toLowerCase();
        const preset = D.MED_PRESETS.find(p =>
            p.presetId === m.presetId
            || p.name.toLowerCase() === nm
            || (p.aka || []).some(a => a.toLowerCase() === nm));
        if (!preset) return m;
        const merged = Object.assign({}, m);
        if (!merged.presetId) merged.presetId = preset.presetId;
        const prov = Object.assign({}, merged._prov);
        const fromPreset = (k) => {
            if (PROVENANCE_FIELDS.indexOf(k) !== -1) prov[k] = 'curated';
        };
        ['missedDose', 'titration', 'splitDose', 'clicksPerDose', 'timeToPeak', 'generic', 'type', 'pensPerPackage', 'category', 'release', 'bioavailability'].forEach(k => {
            if (merged[k] == null && preset[k] != null) { merged[k] = preset[k]; fromPreset(k); }
        });

        // Link the product to its substances. This is the whole migration —
        // `upgradeMedFromPreset` already runs on every load, so every preset-derived
        // med lights up on next launch with no migration step and no version bump.
        // A hand-made med gets nothing until the user links it, which
        // is correct: inventing an ingredient list would invent a curve.
        // An EXPLICIT 'user' mark with no list is the user choosing "not linked" in
        // the editor; that answer stands. Only an unrecorded provenance (every med
        // from before ingredients existed) is filled in from the preset.
        const unlinkedByUser = !!(merged._prov && merged._prov.ingredients === 'user');
        if (!merged.ingredients && !unlinkedByUser) {
            // A preset may carry its own list — the pain products do, because a
            // multi-ingredient tablet cannot be expressed by the presetId map, which
            // is one-substance-per-product by construction. Its own list wins.
            const own = preset.ingredients;
            const ing = own || (window.Substances && window.Substances.ingredientsForPreset(preset.presetId));
            if (ing) { merged.ingredients = JSON.parse(JSON.stringify(ing)); fromPreset('ingredients'); }
        }
        if (Object.keys(prov).length) merged._prov = prov;

        // A field the user never touched, whose curated value has since
        // been corrected, is updated here and now — silently, because there is nothing
        // to ask: it was our number, it was wrong, and it is ours to fix. Anything the
        // USER owns is left exactly as it is and surfaces as a question instead.
        if (merged._prov && window.MedData.presetDiff) {
            const diff = window.MedData.presetDiff(merged);
            for (const row of diff.auto) merged[row.key] = row.theirs;
        }
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
            pains: [],
            pens: [],
            substances: [],
            substanceLimits: {},
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

        // The sync engine lives in /sync-wip.js so every page gets it. Everything meds-specific — what
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
                hasData: (s) => !!(s && ((s.shots || []).length || (s.weights || []).length || (s.meds || []).length || (s.pains || []).length)),
                // union both sides, dedupe by content key — mergeIn mutates state
                merge: (theirs) => { self.mergeIn(theirs); return self.state; },
                // ...so the conflict dialog's preview merges into its own copy instead.
                previewMerge: (theirs, mine) => { self.mergeIn(theirs, mine); return mine; },
                // What the conflict dialog calls things: "Vyvanse 30 mg · 20/09/2026
                // 8:00 AM", not an id and a number.
                fieldLabels: self.conflictLabels(),
                hiddenFields: CONFLICT_HIDDEN,
                debounceMs: 1200,
                onStatus: (status) => { self.syncStatus = status; self.emit('sync'); },

                // Doses, weights, meds and supply are items with ids, so the sync
                // engine can ship what CHANGED rather than the whole blob — and a
                // deletion travels as a deletion instead of being un-done by the
                // next union merge.
                collections: SYNC_COLLECTIONS,
                // So the sync engine's own sentences say "1 dose", not "1 entry".
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

                // The shared "two versions" dialog from /sync-wip.js — the same one
                // every other page shows, fed the labels above. It is raised from
                // here rather than from the performSync caller, because a conflict
                // can arrive two ways: from a sync after login, OR from a background
                // save that the server refused as stale. The second one has no
                // caller to notice it. The sync client applies the choice returned.
                onConflict: () => self.askAboutConflict(),
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

        /**
         * Where a med field came from. Unrecorded means the user owns it.
         * @param {Med} med
         * @param {string} field
         * @returns {'curated'|'pbs'|'user'}
         */
        provOf(med, field) { return provOf(med, field); },

        /** The fields provenance is tracked for. */
        PROVENANCE_FIELDS,

        normalize(s) {
            const base = emptyState();
            const out = Object.assign(base, s || {});
            out.settings = Object.assign({}, DEFAULT_SETTINGS, (s && s.settings) || {});
            out.meds = (out.meds || []).filter(Boolean).map(upgradeMedFromPreset);
            out.trashedMeds = (out.trashedMeds || []).map(upgradeMedFromPreset);
            out.shots = (out.shots || []).filter(x => x && x.timestamp);
            out.weights = (out.weights || []).filter(x => x && x.timestamp && !isNaN(parseFloat(x.kg)));
            // A pain entry needs a score on a known scale; a check-in needs its kind.
            out.pains = (Array.isArray(out.pains) ? out.pains : []).filter(x => x && x.id && x.timestamp
                && (x.kind === 'checkin' || (Number(x.score) >= 0 && Number(x.score) <= 10
                    && (x.scale === 'nrs' || x.scale === 'dvprs'))));
            out.pens = out.pens || [];

            // TYPES, checked once here, because every renderer trusts them. Whatever
            // arrives from storage, a sync or an imported file passes through this, and a
            // "dose" that is a string of HTML would otherwise be written straight into
            // the doses table. Copies, so the caller's object is never changed.
            const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
            const ymdRe = /^\d{4}-\d{2}-\d{2}$/, hmRe = /^\d{1,2}:\d{2}$/;
            const when = (x) => {
                x.timestamp = num(x.timestamp);
                if (!x.timestamp) return false;
                const dt = new Date(x.timestamp);
                if (!ymdRe.test(x.date)) x.date = D.ymd(dt);
                if (!hmRe.test(x.time)) x.time = D.hm(dt);
                return true;
            };
            const http = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());
            out.shots = out.shots.map(x => Object.assign({}, x)).filter(x => {
                if (!when(x)) return false;
                // A bad dose is neutralised, never dropped: dropping a record here would
                // make the next sync send its deletion, and delete a real dose upstream.
                x.dose = num(x.dose);
                if (x.location != null && typeof x.location !== 'string') x.location = String(x.location);
                return true;
            });
            out.weights = out.weights.map(x => Object.assign({}, x)).filter(x => when(x) && (x.kg = num(x.kg)) !== null);
            out.pens = (Array.isArray(out.pens) ? out.pens : []).filter(p => p && p.id).map(p => Object.assign({}, p, {
                dose: num(p.dose), capacity: num(p.capacity) || 0, used: num(p.used) || 0,
            }));
            out.pains = out.pains.map(x => Object.assign({}, x)).filter(x => when(x));
            const cleanMed = (m) => {
                const c = Object.assign({}, m);
                c.name = String(c.name == null ? '' : c.name);
                c.doses = Array.isArray(c.doses) ? c.doses.map(num).filter(v => v !== null) : [];
                ['halfLife', 'timeToPeak', 'penCapacity', 'pensPerPackage', 'graphStep', 'remindAt', 'preferredNextDose', 'bioavailability']
                    .forEach(k => { if (k in c) c[k] = num(c[k]); });
                // null frequency is PRN, so only a present, non-null value is coerced
                if (c.frequency != null) c.frequency = num(c.frequency);
                if (typeof c.color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(c.color)) c.color = '#5fc8c8';
                if (c.missedDose && typeof c.missedDose === 'object') {
                    c.missedDose = Object.assign({}, c.missedDose);
                    if (!http(c.missedDose.sourceUrl)) delete c.missedDose.sourceUrl;
                }
                return c;
            };
            out.meds = out.meds.map(cleanMed);
            out.trashedMeds = out.trashedMeds.map(cleanMed);

            // A user substance that collides with a curated id is DROPPED rather
            // than allowed to shadow it: the curated record is cited and shared, and a
            // silent local override of it would make two people's charts disagree with
            // no way to see why. The editor refuses to create one; this is the guard
            // for data arriving from an import or an older build.
            out.substanceLimits = (out.substanceLimits && typeof out.substanceLimits === 'object'
                && !Array.isArray(out.substanceLimits)) ? out.substanceLimits : {};
            out.substances = (out.substances || []).filter(x =>
                x && x.id && !(window.Substances && window.Substances.isCurated(x.id)))
                .map(x => {
                    const c = Object.assign({}, x);
                    if (c.source && !http(c.source.url)) delete c.source;
                    // Only the curated table carries citations, so an imported substance
                    // can never arrive looking like one that does.
                    c.verified = false;
                    return c;
                });
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

        /**
         * Ask to be told when a PRN med may be taken again.
         *
         * Stored on the MED rather than in a separate collection: it is a new FIELD,
         * so no sync registration is needed, and putting it on the med means
         * the reminder follows the user to their other device for free.
         *
         * @param {string} medId
         * @param {number|null} at  ms since epoch, or null to cancel
         */
        remindWhenAllowed(medId, at) {
            this.update(s => {
                const m = s.meds.find(x => x.id === medId);
                if (!m) return;
                if (at > Date.now()) m.remindAt = at; else delete m.remindAt;
            });
        },

        /**
         * Raise, lower or clear this user's own limit for one ingredient.
         *
         * Per INGREDIENT and not per product, because the ceiling is on the ingredient
         * — that is the whole insight behind the substance model, and a paracetamol limit has to apply
         * to every product containing it or it is not a limit at all.
         *
         * @param {string} substanceId
         * @param {{maxPer24h?:number, minGapH?:number, reason?:string}|null} limits
         */
        setSubstanceLimit(substanceId, limits) {
            if (!substanceId) return;
            this.update(s => {
                s.substanceLimits = s.substanceLimits || {};
                if (!limits || (!(limits.maxPer24h > 0) && !(limits.minGapH > 0))) {
                    delete s.substanceLimits[substanceId];
                    return;
                }
                s.substanceLimits[substanceId] = {
                    ...(limits.maxPer24h > 0 ? { maxPer24h: limits.maxPer24h } : {}),
                    ...(limits.minGapH > 0 ? { minGapH: limits.minGapH } : {}),
                    reason: String(limits.reason || '').slice(0, 300),
                    setAt: Date.now(),
                };
            });
        },

        /** The limits in force for a substance, user override included. */
        limitsFor(substanceId) {
            return window.Substances.limitsFor(substanceId, this.state.substanceLimits);
        },

        // ---------- reconciliation with corrected presets ----------

        /**
         * Meds whose preset now disagrees with them about something the USER owns.
         * @returns {Array<{med:Med, rows:Array}>}
         */
        pendingReconciliations() {
            return this.state.meds
                .map(med => ({ med, rows: D.presetDiff(med).ask }))
                .filter(x => x.rows.length);
        },

        /**
         * Answer one field of one med.
         *
         * `take` accepts the curated value and marks the field `curated`, so any FUTURE
         * correction is applied silently — the user has said this field is ours.
         * Declining records the exact value that was declined, so the question is not
         * asked again until the curated figure changes to something else. Neither
         * branch ever guesses.
         *
         * @param {string} medId
         * @param {string} field
         * @param {boolean} take  true = use the updated value, false = keep mine
         */
        resolvePresetField(medId, field, take) {
            this.update(s => {
                const m = s.meds.find(x => x.id === medId);
                if (!m) return;
                const row = D.presetDiff(m).ask.find(r => r.key === field);
                if (!row) return;
                if (take) {
                    m[field] = row.theirs;
                    m._prov = Object.assign({}, m._prov, { [field]: 'curated' });
                    if (m._declined) delete m._declined[field];
                } else {
                    m._declined = Object.assign({}, m._declined, { [field]: row.theirs });
                    m._prov = Object.assign({}, m._prov, { [field]: 'user' });
                }
            });
        },

        // ---------- user-defined substances ----------

        /** Curated substances plus this user's own. @returns {object[]} */
        allSubstances() {
            const curated = (window.Substances && window.Substances.SUBSTANCES) || [];
            return curated.concat(this.state.substances || []);
        },

        /**
         * Create or update a user substance.
         *
         * Refuses to shadow a curated id. The curated records are cited and shared by
         * everyone; a local override of one would make two people's charts disagree
         * about the same drug with nothing on screen to explain it. A user who wants
         * different numbers makes their OWN substance under their own id.
         *
         * @param {object} sub
         * @returns {string|null} the id, or null if refused
         */
        saveSubstance(sub) {
            if (!sub || !sub.name) return null;
            const slug = String(sub.id || sub.name).toLowerCase()
                .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
            if (!slug) return null;
            const S = window.Substances;
            if (S && S.isCurated(slug) && !sub.id) return null;
            const rec = Object.assign({}, sub, { id: slug, custom: true, verified: false });
            this.update(s => {
                s.substances = s.substances || [];
                const i = s.substances.findIndex(x => x.id === slug);
                if (i >= 0) s.substances[i] = rec; else s.substances.push(rec);
            });
            return slug;
        },

        /**
         * Delete a user substance. Refuses while any med still names it, because a med
         * pointing at nothing silently loses its curve with no message — the same
         * class of quiet failure as a missing sync registration.
         * @returns {{ok:boolean, usedBy?:string[]}}
         */
        deleteSubstance(id) {
            const usedBy = this.state.meds.concat(this.state.trashedMeds || [])
                .filter(m => (m.ingredients || []).some(i => i.substanceId === id))
                .map(m => m.name);
            if (usedBy.length) return { ok: false, usedBy };
            this.update(s => {
                s.substances = (s.substances || []).filter(x => x.id !== id);
            });
            return { ok: true };
        },

        /**
         * Point a med at a substance, or unlink it.
         * Marked `user` provenance so preset reconciliation never silently replaces it
         * with a curated guess.
         */
        linkMedSubstance(medId, substanceId, mgPerDoseUnit, salt) {
            this.update(s => {
                const m = s.meds.find(x => x.id === medId);
                if (!m) return;
                if (!substanceId) {
                    delete m.ingredients;
                    // Unlinking IS the answer to "the preset says it contains X".
                    // Without recording it, reconciliation would ask again on the very next
                    // render about a choice the user just made in this editor.
                    const S2 = window.Substances;
                    const theirs = (m.presetId && S2) ? S2.ingredientsForPreset(m.presetId) : null;
                    if (theirs) m._declined = Object.assign({}, m._declined, { ingredients: theirs });
                } else {
                    m.ingredients = [{
                        substanceId,
                        mgPerDoseUnit: mgPerDoseUnit > 0 ? mgPerDoseUnit : 1,
                        salt: salt || undefined,
                    }];
                }
                m._prov = Object.assign({}, m._prov, { ingredients: 'user' });
            });
        },

        // mutate state, persist, schedule server save, re-render
        update(fn, opts) {
            fn(this.state);
            this.saveLocal();
            if (!opts || !opts.skipServer) this.scheduleServerSave();
            if (!opts || !opts.silent) this.emit('change');
        },

        // ---------- derived helpers ----------

        /**
         * Meds still being taken. This — not `state.meds` — is what anything about the
         * FUTURE should iterate: next dose, overdue, supply warnings, the switcher.
         *
         * A stopped med deliberately stays in `state.meds` rather than moving to
         * `trashedMeds`, so everything about the PAST keeps working untouched: its doses,
         * its chart curve and its decay tail are all still there, because every one of
         * those reads `doseLog` and `meds` directly. That is the whole point — a
         * trashed med must not make the tail vanish mid-curve.
         * @returns {Med[]}
         */
        activeMeds() {
            return this.state.meds.filter(m => !m.stoppedAt);
        },

        /** Meds kept for their history but no longer being taken. @returns {Med[]} */
        stoppedMeds() {
            return this.state.meds.filter(m => m.stoppedAt)
                .sort((a, b) => b.stoppedAt - a.stoppedAt);
        },

        // the med whose next dose comes soonest (overdue counts as soonest)
        nextDueMed() {
            // A med with no prediction yet still has to be selectable, so it sorts last rather than
            // being unreachable. `Infinity - 1` IS Infinity, so the old comparison against an
            // Infinity seed was never true for those meds and they could never be picked.
            // Stopped meds are skipped outright — they have no next dose by definition.
            let best = null, bestTs = Infinity;
            for (const med of this.activeMeds()) {
                const nd = D.predictNextDose(med, this.medDoses(med.id), this.state.settings);
                const ts = nd ? new Date(nd.date).getTime() : Number.MAX_SAFE_INTEGER;
                if (best === null || ts < bestTs) { best = med; bestTs = ts; }
            }
            return best;
        },

        activeMed() {
            const s = this.state;
            // A stopped med stays selectable once chosen — you have to be able to open one
            // to read its history, or to restart it. It is only excluded from being picked
            // AUTOMATICALLY below.
            let m = s.meds.find(x => x.id === s.activeMedId);
            if (!m) {
                const live = this.activeMeds();
                m = this.nextDueMed() || live[0] || s.meds[0];
                if (m) s.activeMedId = m.id;
            }
            return m || null;
        },
        medDoses(medId) {
            return this.state.shots.filter(s => s.medId === medId).sort((a, b) => b.timestamp - a.timestamp);
        },
        medContainers(medId) {
            return D.recomputeContainerState(this.state.pens.filter(p => p.medId === medId), this.state.shots);
        },
        sortedWeights() {
            return this.state.weights.slice().sort((a, b) => a.timestamp - b.timestamp);
        },
        hasData() {
            const s = this.state;
            return s.shots.length > 0 || s.weights.length > 0 || s.meds.length > 0;
        },

        // ---------- mutations ----------
        // Every change that DELETES something, or that has to keep two collections
        // consistent, lives here rather than in whichever click handler happens to
        // trigger it.
        //
        // "Deleting a container must unassign its doses" is a rule about the data, not
        // about a button — and if it lived in one event handler, a
        // second way to delete a container would have left `penId` pointing at nothing,
        // silently, with the dose still on the chart.
        //
        // Each returns what the caller needs in order to say what happened, so nothing
        // has to re-query the state it just changed. Confirmation prompts stay with the
        // caller: these do the thing, they do not ask whether to.

        /** @returns {boolean} false if there was no such dose. */
        deleteDose(id) {
            if (!this.state.shots.some(x => x.id === id)) return false;
            this.update(s => { s.shots = s.shots.filter(x => x.id !== id); });
            return true;
        },

        /**
         * Add a pain entry or check-in, or replace the one with the same id.
         * @returns {object} the entry as stored
         */
        savePain(entry) {
            const e = Object.assign({}, entry);
            if (!e.id) e.id = 'pain_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7);
            if (!e.timestamp) e.timestamp = Date.now();
            const dt = new Date(e.timestamp);
            e.date = D.ymd(dt);
            e.time = String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0');
            this.update(s => {
                s.pains = s.pains || [];
                const i = s.pains.findIndex(x => x.id === e.id);
                if (i >= 0) s.pains[i] = e; else s.pains.push(e);
            });
            return e;
        },

        /** @returns {boolean} false if there was no such entry. */
        deletePain(id) {
            if (!(this.state.pains || []).some(x => x.id === id)) return false;
            this.update(s => { s.pains = s.pains.filter(x => x.id !== id); });
            return true;
        },

        /** @returns {boolean} false if there was no such entry. */
        deleteWeight(id) {
            if (!this.state.weights.some(x => x.id === id)) return false;
            this.update(s => { s.weights = s.weights.filter(x => x.id !== id); });
            return true;
        },

        /**
         * Delete one supply container. Its doses stay logged and become unassigned —
         * a dose that happened still happened.
         * @returns {{unassigned:number}|null} null if there was no such container.
         */
        deleteContainer(penId) {
            if (!this.state.pens.some(p => p.id === penId)) return null;
            const unassigned = this.state.shots.filter(x => x.penId === penId).length;
            this.update(s => {
                s.pens = s.pens.filter(p => p.id !== penId);
                s.shots.forEach(x => { if (x.penId === penId) x.penId = null; });
            });
            return { unassigned };
        },

        /**
         * Throw away one med's whole supply history, keeping its doses.
         * @returns {{containers:number, unassigned:number}}
         */
        clearSupplyFor(medId) {
            const ids = new Set(this.state.pens.filter(p => p.medId === medId).map(p => p.id));
            const unassigned = this.state.shots.filter(x => ids.has(x.penId)).length;
            if (!ids.size) return { containers: 0, unassigned: 0 };
            this.update(s => {
                s.pens = s.pens.filter(p => p.medId !== medId);
                s.shots.forEach(x => { if (ids.has(x.penId)) x.penId = null; });
            });
            return { containers: ids.size, unassigned };
        },

        /**
         * Remove every estimated dose and the estimated containers that back them.
         * Real doses and real containers are untouched.
         * @returns {{doseLog:number, containers:number}}
         */
        clearEstimated() {
            // An estimated pack is one the history estimator made: the `estimated` flag,
            // or (packs made before the flag existed) its generated id AND its note.
            // Never the note alone — that is free text, and a pack someone typed
            // "estimated" into is theirs. A pack that also holds a real dose is kept
            // either way: deleting it would strand that dose's supply.
            const isEst = p => p.estimated === true
                || (String(p.id).indexOf('container-inf-') === 0 && p.note === 'estimated');
            const realIn = new Set(this.state.shots.filter(x => !x.estimated && x.penId).map(x => x.penId));
            const estPenIds = new Set(this.state.pens.filter(p => isEst(p) && !realIn.has(p.id)).map(p => p.id));
            const doseLog = this.state.shots.filter(x => x.estimated).length;
            if (!doseLog && !estPenIds.size) return { doseLog: 0, containers: 0 };
            this.update(s => {
                s.shots = s.shots.filter(x => !x.estimated);
                s.pens = s.pens.filter(p => !estPenIds.has(p.id));
            });
            return { doseLog, containers: estPenIds.size };
        },

        /**
         * Reconstruct containers for doses that have none, so supply tracking can start
         * from a history that predates it. Additive: nothing is deleted.
         * @returns {{containers:number, assigned:number}}
         */
        buildContainersFromDoses(med) {
            const orphans = this.state.shots.filter(x => x.medId === med.id && !x.penId);
            if (!orphans.length) return { containers: 0, assigned: 0 };
            const { containers, assignment } = D.inferContainersFromDoses(orphans, med);
            this.update(s => {
                s.shots.forEach(x => { if (assignment[x.id]) x.penId = assignment[x.id]; });
                s.pens = s.pens.concat(containers);
            });
            return { containers: containers.length, assigned: Object.keys(assignment).length };
        },

        /**
         * Which container a new dose draws from, chosen the way the log form's "Auto"
         * does, and marked opened on `date` if it was not yet. Call inside update().
         * One rule for every way a dose arrives: a path that skipped it would mean
         * a reminder-driven routine never used up any supply at all.
         *
         * @param {object} s  the state being updated
         * @param {Med} med
         * @param {number} dose
         * @param {string} date  YYYY-MM-DD
         * @returns {string}  a container id, or '' for "not from supply"
         */
        pickContainer(s, med, dose, date) {
            const sug = D.suggestContainerForDose(
                D.recomputeContainerState(s.pens.filter(p => p.medId === med.id), s.shots), med, dose);
            if (!sug.container) return '';
            const p = s.pens.find(x => x.id === sug.container.id);
            if (p && !p.openedDate) p.openedDate = date;
            return sug.container.id;
        },

        /**
         * Log a dose that the user confirmed on a NOTIFICATION, not in the app.
         *
         * Separate from the normal log path for two reasons. The timestamp is the moment
         * the dose was DUE, not the moment the app happened to open — a reminder tapped
         * at 22:30 and drained at 08:00 the next morning must not land at 08:00. And it
         * is idempotent on `notifKey`: a notification button is easy to double-tap on a
         * phone, and the queue can be drained by two tabs at once.
         *
         * @param {{medId:string, dose:number, at:number, notifKey?:string}} intent
         * @returns {boolean} false if it was rejected or already logged
         */
        logDoseFromNotification(intent) {
            if (!intent || !intent.medId || !(intent.dose > 0)) return false;
            const med = this.state.meds.find(m => m.id === intent.medId);
            if (!med) return false;
            const at = Number(intent.at);
            if (!Number.isFinite(at) || at <= 0) return false;

            const key = intent.notifKey || null;
            if (key && this.state.shots.some(s => s.notifKey === key)) return false;
            // Belt and braces for a re-queued intent with no key: the same med at the
            // same minute is the same dose.
            const minute = Math.floor(at / 60000);
            if (this.state.shots.some(s => s.medId === intent.medId
                && Math.floor(s.timestamp / 60000) === minute)) return false;
            // A dose already logged by hand near the time this one was due IS this dose:
            // somebody who logs it in the app and later taps Taken on the stale reminder
            // took one dose, not two. Near = half the dosing interval, at most 3 hours
            // (30 minutes for an as-needed med, which has no interval to halve).
            const freqDays = D.freqOf(med);
            const nearMs = Number.isFinite(freqDays)
                ? Math.min(freqDays * 86400000 / 2, 3 * 3600000) : 30 * 60000;
            // Only doses logged by hand count here: two different notifications are two
            // different slots by construction (the key carries the slot's time).
            if (this.state.shots.some(s => s.medId === intent.medId && !s.notifKey
                && Math.abs(s.timestamp - at) < nearMs)) return false;

            const dt = new Date(at);
            const date = D.ymd(dt);
            this.update(s => {
                s.shots.push({
                    id: `shot_${at}_${Math.random().toString(36).slice(2, 8)}`,
                    medId: intent.medId,
                    dose: intent.dose,
                    timestamp: at,
                    date,
                    time: String(dt.getHours()).padStart(2, '0') + ':' + String(dt.getMinutes()).padStart(2, '0'),
                    location: null,
                    penId: this.pickContainer(s, med, intent.dose, date) || null,
                    // NOT `estimated` — the user confirmed this one by tapping it.
                    notifKey: key,
                });
                const m = s.meds.find(x => x.id === intent.medId);
                if (m && m.preferredNextDose != null) m.preferredNextDose = null;
            });
            return true;
        },

        /**
         * Stop taking a med, without archiving it.
         *
         * This is NOT trash. The med stays in `state.meds`, so its doses, its chart curve
         * and its decay tail all carry on being drawn — stopping a med is the exact moment
         * that tail becomes the interesting part, and trashing it would cut the curve off
         * mid-decay.
         *
         * Only one field is written. A new *field* needs no sync registration —
         * `canonical()` covers whole objects — which is why this is a field
         * and not the new collection it might first look like it wants to be.
         *
         * @param {string} medId
         * @param {number} [when] ms since epoch; defaults to now. Passed in by the UI when
         *   the user says they stopped earlier, so the tail starts from the right place.
         * @returns {boolean} false if there was no such med, or it was already stopped.
         */
        stopMed(medId, when) {
            const med = this.state.meds.find(m => m.id === medId);
            if (!med || med.stoppedAt) return false;
            const at = Number.isFinite(when) ? when : Date.now();
            this.update(s => {
                const target = s.meds.find(m => m.id === medId);
                if (target) target.stoppedAt = at;
                // Don't leave the dashboard reporting a "next dose" for something stopped —
                // but only move if there is somewhere live to move to. With no active meds
                // left, staying put beats showing an empty app.
                if (s.activeMedId === medId) {
                    const live = s.meds.find(m => m.id !== medId && !m.stoppedAt);
                    if (live) s.activeMedId = live.id;
                }
            });
            return true;
        },

        /**
         * Start taking a stopped med again. Clearing one field is the whole operation —
         * nothing moved, so nothing has to move back.
         * @returns {boolean} false if there was no such med, or it was not stopped.
         */
        resumeMed(medId) {
            const med = this.state.meds.find(m => m.id === medId);
            if (!med || !med.stoppedAt) return false;
            this.update(s => {
                const target = s.meds.find(m => m.id === medId);
                if (target) delete target.stoppedAt;
            });
            return true;
        },

        /**
         * Move a med to trash. Nothing is deleted — doses, supply and the med itself are
         * all kept, which is what makes this reversible and `deleteMedForever` not.
         *
         * For "I stopped taking this", prefer `stopMed` — trashing drops the med out of the
         * active list and takes its decay tail off the chart with it.
         * @returns {boolean} false if there was no such active med.
         */
        trashMed(medId) {
            if (!this.state.meds.some(m => m.id === medId)) return false;
            this.update(s => {
                const med = s.meds.find(m => m.id === medId);
                s.meds = s.meds.filter(m => m.id !== medId);
                s.trashedMeds.unshift(Object.assign({}, med, { trashedAt: Date.now() }));
                // Never leave the app pointing at a med that is no longer in the list.
                if (s.activeMedId === medId) s.activeMedId = s.meds[0] ? s.meds[0].id : null;
            });
            return true;
        },

        /** @returns {boolean} false if it was not in the trash. */
        restoreMed(medId) {
            if (!(this.state.trashedMeds || []).some(m => m.id === medId)) return false;
            this.update(s => {
                const i = s.trashedMeds.findIndex(m => m.id === medId);
                if (i < 0) return;
                const med = s.trashedMeds.splice(i, 1)[0];
                delete med.trashedAt;
                s.meds.push(med);
                if (!s.activeMedId) s.activeMedId = med.id;
            });
            return true;
        },

        /**
         * Delete a trashed med and everything that referred to it. The one operation
         * here with no way back.
         * @returns {{doseLog:number, containers:number}|null} null if it was not in the trash.
         */
        deleteMedForever(medId) {
            if (!(this.state.trashedMeds || []).some(m => m.id === medId)) return null;
            const doseLog = this.state.shots.filter(x => x.medId === medId).length;
            const containers = this.state.pens.filter(p => p.medId === medId).length;
            this.update(s => {
                s.trashedMeds = s.trashedMeds.filter(m => m.id !== medId);
                s.shots = s.shots.filter(x => x.medId !== medId);
                s.pens = s.pens.filter(p => p.medId !== medId);
            });
            return { doseLog, containers };
        },

        /**
         * Wipe one med's history and supply, keeping the med. The WIP-only test button
         * behind two confirmations — it exists so backfill and import can be re-tested
         * without deleting the med and losing its settings.
         * @returns {{doseLog:number, containers:number}|null} null if there is no such med.
         */
        wipeMedHistory(medId) {
            if (!this.state.meds.some(m => m.id === medId)) return null;
            const doseLog = this.state.shots.filter(x => x.medId === medId).length;
            const containers = this.state.pens.filter(p => p.medId === medId).length;
            this.update(s => {
                s.shots = s.shots.filter(x => x.medId !== medId);
                s.pens = s.pens.filter(p => p.medId !== medId);
                const med = s.meds.find(x => x.id === medId);
                if (med) med.preferredNextDose = null;
            });
            return { doseLog, containers };
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

        // the server copy parked while a conflict is open (the conflict labels read this)
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

        // Safe for app.js to call after performSync returns 'conflict': by then the
        // question has usually been asked and answered, and this does nothing. If a
        // conflict is still parked, it asks — once; the sync client guards that.
        showConflictModal() {
            if (this._conflictModalOpen || !this.sync || !this._pendingServerState) return;
            this.sync._raiseConflict();
        },

        // The shared dialog, at most once at a time. Resolves with 'mine' |
        // 'theirs' | 'merge', which the sync client then applies.
        askAboutConflict() {
            if (!this.sync || this._conflictModalOpen) return undefined;
            this._conflictModalOpen = true;
            return this.sync.promptConflict().then((choice) => {
                this._conflictModalOpen = false;
                if (choice === 'merge' && window.UI && window.UI.toast) window.UI.toast('Merged both copies');
                return choice;
            }, (e) => {
                this._conflictModalOpen = false;
                throw e;
            });
        },

        // Names for the conflict dialog. Each is looked up when the dialog opens,
        // in BOTH copies — a dose on one side may belong to a med only that side has.
        conflictLabels() {
            const self = this;
            const set = () => self.state.settings || DEFAULT_SETTINGS;
            const both = (name) => (self.state[name] || []).concat(
                (self._pendingServerState && self._pendingServerState[name]) || []);
            const med = (id) => both('meds').concat(both('trashedMeds')).find(m => m && m.id === id);
            const medName = (id) => { const m = med(id); return m ? m.name : 'A removed medication'; };
            const amount = (medId, n) => { const m = med(medId); return D.fmtDoseUnit(n, m ? m.unit : ''); };
            const when = (ts) => D.fmtDate(ts, set()) + ' ' + D.fmtTime(ts, set());
            const weight = (kg) => D.fmtWeight(kg, set().weightUnit, true);
            const day = (ymd) => D.fmtDate(ymd + 'T12:00', set());
            const clock = (hm) => D.fmtTimeStr(hm, set());
            const penName = (p) => (p.note || 'Container') + ' · ' + medName(p.medId)
                + (p.dose != null ? ' ' + amount(p.medId, p.dose) : '');
            const subName = (id) => {
                const S = window.Substances;
                const sub = S && S.substanceById ? S.substanceById(id, both('substances')) : null;
                return sub && sub.name ? sub.name : null;
            };
            return {
                shots: { label: 'Doses', item: x => medName(x.medId) + ' ' + amount(x.medId, x.dose) + ' · ' + when(x.timestamp) },
                'shots.medId': { label: 'Medication', values: medName },
                'shots.date': { label: 'Date', values: day },
                'shots.time': { label: 'Time', values: clock },
                'shots.location': 'Injection site',
                'shots.penId': { label: 'Container', values: (id) => { const p = both('pens').find(x => x && x.id === id); return p ? penName(p) : null; } },
                'shots.estimated': { label: 'Estimated', values: { true: 'Yes', false: 'No' } },
                'shots.note': 'Note',
                weights: { label: 'Weights', item: w => weight(w.kg) + ' · ' + when(w.timestamp) },
                pains: { label: 'Pain entries', item: p => (p.kind === 'checkin' ? 'Daily pain check-in'
                    : 'Pain ' + p.score + '/10' + (p.areas && p.areas.length && window.Pain
                        ? ' · ' + p.areas.map(window.Pain.areaLabel).join(', ') : '')) + ' · ' + when(p.timestamp) },
                'pains.score': 'Pain score',
                'pains.areas': 'Where',
                'pains.note': 'Note',
                'weights.kg': { label: 'Weight', values: weight },
                'weights.date': { label: 'Date', values: day },
                'weights.time': { label: 'Time', values: clock },
                meds: { label: 'Medications', item: m => m.name },
                trashedMeds: { label: 'Archived medications', item: m => m.name },
                pens: { label: 'Supply', item: penName },
                substances: { label: 'Your substances', item: x => x.name },
                substanceLimits: { label: 'Dose limits', key: subName },
                settings: 'Settings',
                'settings.timeFormat': { label: 'Time format', values: { '12hr': '12-hour', '24hr': '24-hour' } },
                'settings.goalKg': { label: 'Goal weight', values: weight },
                'settings.startKg': { label: 'Starting weight', values: weight },
                'settings.userHeight': 'Height',
                'settings.showBmi': 'Show BMI',
                user: 'Profile',
            };
        },

        // canonical string for conflict detection.
        //
        // EVERY field counts, because hand-enumerating them makes anything not on
        // the list invisible — a missed field like `penId` or `estimated`, and every
        // future field, would go unnoticed with nothing to warn you. Two states that
        // differ in any recorded way differ here.
        //
        // What is deliberately excluded is listed below and nowhere else:
        //   VIEW_ONLY_SETTINGS  flipping a graph range on your phone must never
        //                       raise the conflict prompt on your PC. They still
        //                       sync; they just never ask a question.
        //   activeMedId         which med you are looking at, per device.
        //   version             a schema constant, not something a user changed.
        //
        // Note the exclusion is by key NAME AT ANY DEPTH — `stableStringify` does not
        // distinguish `settings.theme` from a `theme` field on a med. Nothing has one
        // today; if something gains one, it will be invisible here.
        canonical(s) {
            if (!s) return null;
            return SyncWip.stableStringify(
                s, VIEW_ONLY_SETTINGS.concat(['activeMedId', 'version']));
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
                const doseLog = JSON.parse(localStorage.getItem(V1_PREFIX + 'shotHistory') || '[]');
                const weights = JSON.parse(localStorage.getItem(V1_PREFIX + 'weightHistory') || '[]');
                const settings = JSON.parse(localStorage.getItem(V1_PREFIX + 'userSettings') || '{}');
                if (doseLog.length || weights.length) return { shotHistory: doseLog, weightHistory: weights, userSettings: settings };
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
        // into v2 entities. Returns {meds, doseLog, weights, containers, settings, user}.
        convertV1(payload) {
            const out = emptyState();
            const vs = payload.userSettings || {};

            // meds: create from preset by name found in doseLog
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
                    id: 'entry-v1-' + ts + '-' + i,
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

            // v1 containers live inside userSettings.pens
            (vs.pens || []).forEach(p => {
                const med = ensureMed(p.medication);
                out.pens.push({
                    id: p.id,
                    medId: med.id,
                    dose: parseFloat(p.dose),
                    capacity: p.dosesTotal || 4,
                    used: 0, // recomputed from doseLog
                    openedDate: p.dateStarted ? D.ymd(new Date(p.dateStarted)) : null,
                    exhaustedDate: null,
                    note: '',
                });
            });

            // infer containers for orphan doseLog
            out.meds.forEach(med => {
                const orphans = out.shots.filter(s => s.medId === med.id && !s.penId);
                if (!orphans.length) return;
                const { containers, assignment } = D.inferContainersFromDoses(orphans, med);
                out.shots.forEach(s => { if (assignment[s.id]) s.penId = assignment[s.id]; });
                out.pens = out.pens.concat(containers);
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
        //
        // An entry both copies have — the same `id` — is kept as THIS copy has it,
        // edits included. Matching on content alone kept both versions of an edited
        // dose, as two entries with one id.
        mergeIn(incoming, target) {
            const s = target || this.state;
            const shotIds = new Set(s.shots.map(x => x.id));
            const wIds = new Set(s.weights.map(x => x.id));
            const shotKeys = new Set(s.shots.map(x => x.timestamp + '|' + x.dose + '|' + x.medId));
            const wKeys = new Set(s.weights.map(x => x.timestamp + '|' + x.kg));
            const medIds = new Set(s.meds.map(m => m.id));
            incoming.meds.forEach(m => { if (!medIds.has(m.id)) s.meds.push(m); });
            // trashed meds ride along too — their kept doses need a med to belong to
            const trashIds = new Set((s.trashedMeds || []).map(m => m.id));
            (incoming.trashedMeds || []).forEach(m => {
                if (!medIds.has(m.id) && !trashIds.has(m.id)) (s.trashedMeds = s.trashedMeds || []).push(m);
            });
            incoming.shots.forEach(x => {
                if (!(x.id != null && shotIds.has(x.id)) && !shotKeys.has(x.timestamp + '|' + x.dose + '|' + x.medId)) s.shots.push(x);
            });
            incoming.weights.forEach(x => {
                if (!(x.id != null && wIds.has(x.id)) && !wKeys.has(x.timestamp + '|' + x.kg)) s.weights.push(x);
            });
            // Pain entries: same id is this copy's version; otherwise the same moment,
            // kind and score is the same entry arriving twice.
            s.pains = s.pains || [];
            const painIds = new Set(s.pains.map(x => x.id));
            const painKeys = new Set(s.pains.map(x => x.timestamp + '|' + x.kind + '|' + x.score));
            (incoming.pains || []).forEach(x => {
                if (!x || painIds.has(x.id) || painKeys.has(x.timestamp + '|' + x.kind + '|' + x.score)) return;
                s.pains.push(x);
            });
            const penIds = new Set(s.pens.map(p => p.id));
            incoming.pens.forEach(p => { if (!penIds.has(p.id)) s.pens.push(p); });
            Object.keys(incoming.substanceLimits || {}).forEach(k => {
                s.substanceLimits = s.substanceLimits || {};
                // Theirs only where this copy has no opinion — a limit somebody set
                // deliberately is not something an import gets to change.
                if (!(k in s.substanceLimits)) s.substanceLimits[k] = incoming.substanceLimits[k];
            });
            const subIds = new Set((s.substances || []).map(x => x.id));
            (incoming.substances || []).forEach(x => {
                if (x && x.id && !subIds.has(x.id)) (s.substances = s.substances || []).push(x);
            });
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
