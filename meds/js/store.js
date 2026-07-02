// ================================================
// store.js — app state, localStorage persistence,
// backend sync (AuthManager), v1 migration, import/export
// ================================================
(function () {
    'use strict';
    const D = window.MedData;

    const APP_NAME = 'med-tracker-v2';
    const V1_APP_NAME = 'med-tracker';
    const ENVIRONMENT = 'live'; // 'live' or 'wip'
    const STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_state`;
    const V1_PREFIX = `${V1_APP_NAME}_${ENVIRONMENT}_`;

    const LOGGING = ENVIRONMENT === 'wip';
    const log = (...a) => { if (LOGGING) console.log('[STORE]', ...a); };

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
        medChartHeight: 'm',
        weightRange: 'm',
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
        ['missedDose', 'titration', 'splitDose', 'clicksPerDose', 'timeToPeak', 'generic', 'type', 'pensPerPackage'].forEach(k => {
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
        auth: null,           // AuthManager, set in init
        listeners: [],
        _saveTimer: null,
        _serverDirty: false,
        syncStatus: 'local',  // 'local' | 'syncing' | 'synced' | 'error'

        init() {
            this.auth = new AuthManager(APP_NAME, ENVIRONMENT);
            this.loadLocal();
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
            this.state = emptyState();
        },

        saveLocal() {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)); }
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
            if (!out.activeMedId && out.meds[0]) out.activeMedId = out.meds[0].id;
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
        activeMed() {
            return this.state.meds.find(m => m.id === this.state.activeMedId) || this.state.meds[0] || null;
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

        scheduleServerSave() {
            if (!this.isLoggedIn()) return;
            this._serverDirty = true;
            clearTimeout(this._saveTimer);
            this._saveTimer = setTimeout(() => this.saveToServer(), 1200);
        },

        // immediate write — used after destructive ops (reset / import-replace)
        // so a quick reload can't resurrect the old server copy
        async flushToServer() {
            if (!this.isLoggedIn()) return false;
            clearTimeout(this._saveTimer);
            this._serverDirty = true;
            return this.saveToServer();
        },

        async saveToServer() {
            if (!this.isLoggedIn() || !this._serverDirty) return false;
            this._serverDirty = false;
            this.syncStatus = 'syncing'; this.emit('sync');
            try {
                const res = await this.auth.fetchWithAuth(this.auth.endpoints.data, {
                    method: 'POST',
                    body: JSON.stringify(this.state),
                });
                if (!res.ok) throw new Error((await res.json()).error || 'save failed');
                this.syncStatus = 'synced'; this.emit('sync');
                log('Server save OK');
                return true;
            } catch (e) {
                console.error('Server save failed:', e);
                this.syncStatus = 'error'; this.emit('sync');
                this._serverDirty = true;
                return false;
            }
        },

        async fetchFromServer() {
            if (!this.isLoggedIn()) return null;
            try {
                const res = await this.auth.fetchWithAuth(this.auth.endpoints.data, { method: 'GET' });
                if (!res.ok) throw new Error((await res.json()).error || 'fetch failed');
                const data = await res.json();
                // empty blob from backend looks like {shotHistory:[],weightHistory:[],settings:{}}
                if (!data || data.version !== 2) return null;
                return this.normalize(data);
            } catch (e) {
                console.error('Server fetch failed:', e);
                return null;
            }
        },

        // canonical string for conflict detection
        canonical(s) {
            if (!s) return null;
            const shots = (s.shots || []).map(x => [x.timestamp, x.medId, x.dose, x.location || ''].join('|')).sort();
            const weights = (s.weights || []).map(x => [x.timestamp, Math.round(x.kg * 10) / 10].join('|')).sort();
            const pens = (s.pens || []).map(x => [x.id, x.dose, x.capacity].join('|')).sort();
            const meds = (s.meds || []).map(x => [x.id, x.name, (x.doses || []).join(','), x.frequency, x.halfLife, x.preferredNextDose != null ? x.preferredNextDose : ''].join('|')).sort();
            const set = Object.keys(DEFAULT_SETTINGS).sort().map(k => {
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
        async performSync() {
            if (!this.isLoggedIn()) return 'none';
            const server = await this.fetchFromServer();
            const localHas = this.hasData();
            const serverHas = server && (server.shots.length || server.weights.length || server.meds.length);

            if (!serverHas && localHas) {
                this._serverDirty = true;
                await this.saveToServer();
                return 'uploaded';
            }
            if (serverHas && !localHas) {
                this.state = server;
                this.saveLocal();
                this.emit('change');
                this.syncStatus = 'synced'; this.emit('sync');
                return 'downloaded';
            }
            if (serverHas && localHas) {
                if (this.canonical(this.state) !== this.canonical(server)) {
                    this._pendingServerState = server;
                    return 'conflict';
                }
                this.syncStatus = 'synced'; this.emit('sync');
                return 'in-sync';
            }
            return 'none';
        },

        resolveConflict(useServer) {
            if (useServer && this._pendingServerState) {
                this.state = this._pendingServerState;
                this.saveLocal();
                this.syncStatus = 'synced';
                this.emit('change');
            } else {
                this._serverDirty = true;
                this.saveToServer();
            }
            this._pendingServerState = null;
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
                const data = await res.json();
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
        mergeIn(incoming) {
            const s = this.state;
            const shotKeys = new Set(s.shots.map(x => x.timestamp + '|' + x.dose + '|' + x.medId));
            const wKeys = new Set(s.weights.map(x => x.timestamp + '|' + x.kg));
            const medIds = new Set(s.meds.map(m => m.id));
            incoming.meds.forEach(m => { if (!medIds.has(m.id)) s.meds.push(m); });
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

        importBackup(parsed, mode) {
            // mode: 'merge' | 'replace'
            const incoming = parsed.kind === 'v2' ? parsed.state : this.convertV1(parsed.payload);
            if (mode === 'replace') {
                incoming.settings.onboardedAt = incoming.settings.onboardedAt || Date.now();
                this.state = incoming;
            } else {
                this.mergeIn(incoming);
            }
            this.saveLocal();
            this.emit('change');
            this.flushToServer();
        },

        resetAll() {
            this.state = emptyState();
            this.saveLocal();
            this.emit('change');
            this.flushToServer();
        },
    };

    window.Store = Store;
    window.MED_ENVIRONMENT = ENVIRONMENT;
})();
