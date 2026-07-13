// ================================================
// app.js — boot, routing, theme, global actions, auth wiring
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, $, escapeHtml, confirmModal, toast } = window.UI;

    const ACCENTS = {
        teal: { color: '#5fc8c8', soft: 'rgba(95,200,200,0.14)', line: 'rgba(95,200,200,0.35)', ink: '#0c2226' },
        violet: { color: '#a78bfa', soft: 'rgba(167,139,250,0.16)', line: 'rgba(167,139,250,0.35)', ink: '#ffffff' },
        amber: { color: '#f0b955', soft: 'rgba(240,185,85,0.14)', line: 'rgba(240,185,85,0.35)', ink: '#241a0a' },
        green: { color: '#6fcf97', soft: 'rgba(111,207,151,0.14)', line: 'rgba(111,207,151,0.35)', ink: '#0c2418' },
        rose: { color: '#f48fb1', soft: 'rgba(244,143,177,0.15)', line: 'rgba(244,143,177,0.35)', ink: '#2b0f1a' },
    };

    const App = {
        page: 'dashboard',

        applyTheme() {
            const set = window.Store.state.settings;
            const html = document.documentElement;
            html.dataset.theme = set.theme || 'dark';
            html.dataset.ts = set.textScale || 'lg'; // mobile text zoom level
            const a = ACCENTS[set.accent] || ACCENTS.teal;
            html.style.setProperty('--accent', a.color);
            html.style.setProperty('--accent-soft', a.soft);
            html.style.setProperty('--accent-line', a.line);
            html.style.setProperty('--accent-ink', set.theme === 'light' ? '#ffffff' : a.ink);
        },

        setPage(page) {
            this.page = page;
            window.Views.local.pickingNextDose = false;
            this.render();
            window.scrollTo({ top: 0 });
        },

        render() {
            // nav active states
            document.querySelectorAll('[data-page]').forEach(b =>
                b.classList.toggle('active', b.dataset.page === this.page));
            const main = $('#appMain');
            const V = window.Views;
            if (this.page === 'history') V.renderHistory(main);
            else if (this.page === 'calendar') V.renderCalendar(main);
            else if (this.page === 'meds') V.renderMeds(main);
            else V.renderDashboard(main);
            this.renderTopbarAuth();
            this.renderSyncDot();
        },

        renderTopbarAuth() {
            const S = window.Store;
            const loggedIn = S.isLoggedIn();
            const status = $('#userStatus');
            if (status) {
                status.textContent = loggedIn ? `Logged in: ${S.auth.currentUser ? S.auth.currentUser.username : 'user'}` : 'Local only';
                status.classList.toggle('logged-in', loggedIn);
            }
            const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
            show('loginButton', !loggedIn);
            show('registerButton', !loggedIn);
            show('logoutButton', loggedIn);
        },

        renderSyncDot() {
            const S = window.Store;
            const el = $('#syncDot');
            if (!el) return;
            const st = S.isLoggedIn() ? S.syncStatus : 'local';
            el.className = 'sync-dot ' + st;
            el.title = { local: 'Not signed in — local only', syncing: 'Syncing…', synced: 'Synced to your account', error: 'Sync error — will retry' }[st] || '';
            el.innerHTML = st === 'local' ? Icons.cloudOff : Icons.cloud;
        },
    };

    // ------------------------------------------------
    // Global delegated actions (from rendered views)
    // ------------------------------------------------
    function bindActions() {
        const S = () => window.Store;
        const V = window.Views;
        const M = window.Modals;

        document.body.addEventListener('click', async e => {
            const el = e.target.closest('[data-action]');
            if (!el) return;
            const act = el.dataset.action;
            const id = el.dataset.id;

            switch (act) {
                case 'select-med':
                case 'select-med-page':
                    V.local.historyAllMeds = false;
                    V.local.historyPage = 0;
                    S().update(s => { s.activeMedId = id; s.settings.dashAll = false; });
                    break;
                case 'history-all':
                    V.local.historyAllMeds = true;
                    V.local.historyPage = 0;
                    App.render();
                    break;
                case 'history-page':
                    V.local.historyPage = Math.max(0, (V.local.historyPage || 0) + Number(el.dataset.dir));
                    App.render();
                    break;
                case 'dash-all':
                    S().update(s => { s.settings.dashAll = true; });
                    break;
                case 'log-shot-for':
                    S().update(s => { s.activeMedId = id; }, { silent: true });
                    M.logShot();
                    break;
                case 'add-med': M.addMed(); break;
                case 'add-pens': M.addPens(); break;
                case 'add-pens-for': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (med) M.addPens(med);
                    break;
                }
                case 'dismiss-banner':
                    V.local.bannerDismissed = true;
                    App.render();
                    break;
                case 'log-shot': M.logShot(); break;
                case 'log-weight': M.logWeight(); break;
                case 'toggle-next-dose-pick':
                    V.local.pickingNextDose = !V.local.pickingNextDose;
                    App.render();
                    break;
                case 'set-next-dose': {
                    const dose = parseFloat(el.dataset.dose);
                    V.local.pickingNextDose = false;
                    S().update(s => {
                        const m = s.meds.find(x => x.id === s.activeMedId);
                        if (m) m.preferredNextDose = dose;
                    });
                    break;
                }
                case 'weight-range':
                    S().update(s => { s.settings.weightRange = el.dataset.range; });
                    break;
                case 'med-range':
                    S().update(s => { s.settings.medRange = el.dataset.range; });
                    break;
                case 'med-scope':
                    S().update(s => { s.settings.medLevelScope = id; });
                    break;
                case 'med-height':
                    S().update(s => { s.settings.medChartHeight = el.dataset.val; });
                    break;
                case 'med-yfit':
                    S().update(s => { s.settings.medYFit = !s.settings.medYFit; });
                    break;
                case 'med-dots':
                    S().update(s => { s.settings.medShowDots = s.settings.medShowDots === false; });
                    break;
                case 'med-ydensity':
                    S().update(s => {
                        s.settings.medYDensity = el.dataset.val;
                        // picking a density preset clears any exact step on the shown med
                        const scope = s.settings.medLevelScope;
                        const single = s.meds.length === 1 ? s.meds[0]
                            : (scope && scope !== 'all' ? s.meds.find(m => m.id === scope) : null);
                        if (single) single.graphStep = null;
                    });
                    break;
                case 'cal-day':
                    M.logShot(null, { date: el.dataset.date });
                    break;
                case 'goto-calendar':
                    App.setPage('calendar');
                    break;
                case 'cal-prev': case 'cal-next': case 'cal-today': {
                    const now = new Date();
                    const cur = V.local.calMonth || { y: now.getFullYear(), m: now.getMonth() };
                    if (act === 'cal-today') V.local.calMonth = null;
                    else if (act === 'cal-prev') V.local.calMonth = cur.m === 0 ? { y: cur.y - 1, m: 11 } : { y: cur.y, m: cur.m - 1 };
                    else V.local.calMonth = cur.m === 11 ? { y: cur.y + 1, m: 0 } : { y: cur.y, m: cur.m + 1 };
                    App.render();
                    break;
                }
                case 'history-tab':
                    V.local.historyTab = el.dataset.tab;
                    V.local.historyPage = 0;
                    App.render();
                    break;
                case 'edit-shot': {
                    const shot = S().state.shots.find(x => x.id === id);
                    if (shot) M.logShot(shot);
                    break;
                }
                case 'delete-shot': {
                    if (await confirmModal('Delete this dose?', { danger: true, yesLabel: 'Delete' }))
                        S().update(s => { s.shots = s.shots.filter(x => x.id !== id); });
                    break;
                }
                case 'edit-weight': {
                    const w = S().state.weights.find(x => x.id === id);
                    if (w) M.logWeight(w);
                    break;
                }
                case 'delete-weight': {
                    if (await confirmModal('Delete this weight entry?', { danger: true, yesLabel: 'Delete' }))
                        S().update(s => { s.weights = s.weights.filter(x => x.id !== id); });
                    break;
                }
                case 'edit-pen':
                    M.editPen(id);
                    break;
                case 'clear-pens': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (!med) break;
                    const n = S().state.pens.filter(p => p.medId === id).length;
                    if (!n) break;
                    if (await confirmModal(`Clear ${med.name}'s entire supply history — all ${n} ${D.containerPlural(med, n)}? Logged doses stay, they just lose their ${D.containerName(med)} assignment. Use this to start supply tracking over after a mistake.`, { danger: true, yesLabel: 'Clear supply' })) {
                        S().update(s => {
                            const ids = new Set(s.pens.filter(p => p.medId === id).map(p => p.id));
                            s.pens = s.pens.filter(p => p.medId !== id);
                            s.shots.forEach(x => { if (ids.has(x.penId)) x.penId = null; });
                        });
                        if (S().flushToServer) S().flushToServer();
                        toast(`${med.name}: supply history cleared`);
                    }
                    break;
                }
                case 'delete-pen': {
                    const pen = S().state.pens.find(p => p.id === id);
                    const penMed = pen && S().state.meds.find(m => m.id === pen.medId);
                    const cn = penMed ? D.containerName(penMed) : 'container';
                    if (await confirmModal(`Delete this ${cn}? Doses assigned to it stay logged but become unassigned.`, { danger: true, yesLabel: `Delete ${cn}` }))
                        S().update(s => {
                            s.pens = s.pens.filter(p => p.id !== id);
                            s.shots.forEach(x => { if (x.penId === id) x.penId = null; });
                        });
                    break;
                }
                case 'clear-estimated': {
                    const count = S().state.shots.filter(x => x.estimated).length;
                    if (await confirmModal(`Remove all ${count} estimated doses (and their estimated supply)?`, { danger: true, yesLabel: 'Remove estimated' }))
                        S().update(s => {
                            const estPenIds = new Set(s.pens.filter(p => p.note === 'estimated').map(p => p.id));
                            s.shots = s.shots.filter(x => !x.estimated);
                            s.pens = s.pens.filter(p => !estPenIds.has(p.id));
                        });
                    break;
                }
                case 'toggle-pens':
                    V.local.expandedMedId = V.local.expandedMedId === id ? null : id;
                    App.render();
                    break;
                case 'toggle-pen-group': {
                    const key = el.dataset.key;
                    const cur = V.local.penGroups[key] != null
                        ? V.local.penGroups[key] : el.dataset.open === 'true';
                    V.local.penGroups[key] = !cur;
                    App.render();
                    break;
                }
                case 'infer-pens': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (!med) break;
                    const orphans = S().state.shots.filter(x => x.medId === id && !x.penId);
                    if (!orphans.length) break;
                    const icn = D.containerName(med);
                    const unitWord = med.type === 'pill' ? 'tablet' : 'dose';
                    if (await confirmModal(`Build ${icn} history from ${orphans.length} dose${orphans.length === 1 ? '' : 's'} without an assigned ${icn}? Each ${icn} holds ${med.penCapacity} ${unitWord}${med.penCapacity === 1 ? '' : 's'}.`, { yesLabel: `Build ${D.containerPlural(med, 2)}` }))
                        S().update(s => {
                            const { pens, assignment } = D.inferPensFromShots(orphans, med);
                            s.shots.forEach(x => { if (assignment[x.id]) x.penId = assignment[x.id]; });
                            s.pens = s.pens.concat(pens);
                        });
                    break;
                }
                case 'backfill-med': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (med) M.backfill(med);
                    break;
                }
                case 'dev-clear-med': {
                    // WIP-only test helper (button never renders on the live build):
                    // wipe one med's history + supply to re-test backfill/import
                    const med = S().state.meds.find(m => m.id === id);
                    if (!med) break;
                    const nShots = S().state.shots.filter(x => x.medId === id).length;
                    const nPens = S().state.pens.filter(p => p.medId === id).length;
                    if (!(await confirmModal(`DEV: wipe ${med.name}'s ${nShots} logged dose${nShots === 1 ? '' : 's'} and ${nPens} supply item${nPens === 1 ? '' : 's'}? The med itself stays. Your server copy updates too.`, { danger: true, yesLabel: 'Wipe history + supply' }))) break;
                    if (!(await confirmModal(`Really sure? ${med.name}'s history is deleted permanently — this is the WIP test button, not for real data.`, { danger: true, yesLabel: 'Yes, wipe it' }))) break;
                    S().update(s => {
                        s.shots = s.shots.filter(x => x.medId !== id);
                        s.pens = s.pens.filter(p => p.medId !== id);
                        const m2 = s.meds.find(x => x.id === id);
                        if (m2) m2.preferredNextDose = null;
                    });
                    if (S().flushToServer) S().flushToServer();
                    toast(`${med.name}: history + supply cleared (dev)`);
                    break;
                }
                case 'edit-med': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (med) M.addMed(med);
                    break;
                }
                case 'trash-med': {
                    const med = S().state.meds.find(m => m.id === id);
                    if (!med) break;
                    if (await confirmModal(`Move ${med.name} to trash? Its history is kept and it can be restored.`, { yesLabel: 'Move to trash' }))
                        S().update(s => {
                            s.meds = s.meds.filter(m => m.id !== id);
                            s.trashedMeds.unshift(Object.assign({}, med, { trashedAt: Date.now() }));
                            if (s.activeMedId === id) s.activeMedId = s.meds[0] ? s.meds[0].id : null;
                        });
                    break;
                }
                case 'restore-med':
                    S().update(s => {
                        const i = s.trashedMeds.findIndex(m => m.id === id);
                        if (i >= 0) {
                            const med = s.trashedMeds.splice(i, 1)[0];
                            delete med.trashedAt;
                            s.meds.push(med);
                            if (!s.activeMedId) s.activeMedId = med.id;
                        }
                    });
                    break;
                case 'delete-med-forever': {
                    const med = S().state.trashedMeds.find(m => m.id === id);
                    if (!med) break;
                    const n = S().state.shots.filter(x => x.medId === id).length;
                    if (await confirmModal(`Permanently delete ${med.name} and its ${n} logged dose${n === 1 ? '' : 's'}? This cannot be undone.`, { danger: true, yesLabel: 'Delete forever' }))
                        S().update(s => {
                            s.trashedMeds = s.trashedMeds.filter(m => m.id !== id);
                            s.shots = s.shots.filter(x => x.medId !== id);
                            s.pens = s.pens.filter(p => p.medId !== id);
                        });
                    break;
                }
            }
        });

        // exact y-axis step box on the med-level chart
        document.body.addEventListener('change', e => {
            const inp = e.target.closest('[data-ystep]');
            if (!inp) return;
            const v = parseFloat(inp.value);
            S().update(s => {
                const med = s.meds.find(m => m.id === inp.dataset.id);
                if (med) med.graphStep = (!isNaN(v) && v > 0) ? v : null;
            });
        });

        // page nav
        document.querySelectorAll('[data-page]').forEach(b =>
            b.addEventListener('click', () => App.setPage(b.dataset.page)));

        // topbar buttons
        const wire = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
        wire('loginButton', () => window.Modals.authModal('login'));
        wire('registerButton', () => window.Modals.authModal('register'));
        wire('logoutButton', () => window.Store.auth.logout());
        wire('settingsBtn', () => window.Modals.settingsDrawer());
        wire('settingsBtnMobile', () => window.Modals.settingsDrawer());
        wire('navLog', () => window.Modals.logSheet());
        wire('themeBtn', () => {
            window.Store.update(s => { s.settings.theme = s.settings.theme === 'dark' ? 'light' : 'dark'; });
            App.applyTheme();
        });
    }

    // ------------------------------------------------
    // Auth events
    // ------------------------------------------------
    async function handleAuthed() {
        const result = await window.Store.performSync();
        if (result === 'conflict') window.Modals.syncConflict();
        else if (result === 'uploaded') toast('Local data uploaded to your account');
        else if (result === 'downloaded') toast('Account data loaded');
        App.render();
        // a login from inside the setup wizard closes it once data arrives
        if (window.Onboarding && window.Onboarding.notifySynced) window.Onboarding.notifySynced(result);
        return result;
    }

    window.addEventListener('auth:login', () => { handleAuthed(); });
    window.addEventListener('auth:logout', e => {
        if (e.detail && e.detail.message) toast(e.detail.message);
        window.Store.syncStatus = 'local';
        App.render();
    });
    window.addEventListener('auth:password-changed', () => {
        setTimeout(() => window.Store.auth.logout('Password changed. Please log in again.'), 1500);
    });

    // ------------------------------------------------
    // Boot
    // ------------------------------------------------
    document.addEventListener('DOMContentLoaded', async () => {
        window.Store.init();
        window.Store.onChange(what => {
            if (what === 'sync') App.renderSyncDot();
            else App.render();
        });
        App.applyTheme();
        bindActions();
        // every repo link in static HTML follows the one URL in data.js
        document.querySelectorAll('[data-repo-link]').forEach(a => { a.href = D.REPO_URL; });
        App.render();

        if (window.Store.auth.isLoggedIn()) {
            // wait for the session + server data before deciding on onboarding
            let synced = false;
            const onRestore = async () => {
                if (synced) return;
                synced = true;
                await handleAuthed();
                offerOnboardingIfEmpty();
            };
            window.addEventListener('auth:session-restored', onRestore, { once: true });
            window.addEventListener('auth:no-session', () => offerOnboardingIfEmpty(), { once: true });
            await window.Store.auth.initialize();
            // fallback if no event fired
            setTimeout(() => { if (!synced) offerOnboardingIfEmpty(); }, 4000);
        } else {
            await window.Store.auth.initialize();
            offerOnboardingIfEmpty();
        }
    });

    async function offerOnboardingIfEmpty() {
        if (window.Onboarding.maybeStart()) return;
        // has data or already onboarded — nothing to do
    }

    // flush pending server writes when leaving the page
    window.addEventListener('beforeunload', () => {
        const S = window.Store;
        if (S._serverDirty && S.isLoggedIn()) {
            try {
                navigator.sendBeacon && S.auth.authToken &&
                    fetch(S.auth.endpoints.data, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${S.auth.authToken}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify(S.state),
                        keepalive: true,
                    });
            } catch (e) { /* best effort */ }
        }
    });

    window.App = App;
})();
