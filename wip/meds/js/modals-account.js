// ================================================
// modals-account.js — sign in / register / change password, and the two
//                     sync conflict modals
// ================================================
(function () {
    'use strict';
    const D = window.MedData;
    const { Icons, escapeHtml, openModal, toast } = window.UI;
    const Store = () => window.Store;

    // ------------------------------------------------
    // Auth modals
    // ------------------------------------------------
    function authModal(kind) {
        const isLogin = kind === 'login';
        openModal({
            title: isLogin ? 'Log in' : 'Create account',
            sub: isLogin ? 'Your data syncs to your account automatically.' : 'Free account so your data follows you across devices.',
            bodyHtml: `
                <div class="field"><label>Username</label><input id="authUser" autocomplete="username"></div>
                <div class="field"><label>Password</label><input id="authPass" type="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="4"></div>
                ${isLogin ? '' : '<div class="field"><label>Confirm password</label><input id="authPass2" type="password" minlength="4"></div>'}
                <div class="error-text" id="authErr"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go">${Icons.check} ${isLogin ? 'Log in' : 'Register'}</button>`,
            onMount(modal, close) {
                const err = modal.querySelector('#authErr');
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                const go = async () => {
                    err.textContent = '';
                    const user = modal.querySelector('#authUser').value.trim();
                    const pass = modal.querySelector('#authPass').value;
                    if (!user || !pass) { err.textContent = 'Fill in both fields.'; return; }
                    try {
                        if (isLogin) {
                            await Store().auth.login(user, pass);
                            close();
                        } else {
                            const p2 = modal.querySelector('#authPass2').value;
                            if (pass !== p2) { err.textContent = 'Passwords do not match.'; return; }
                            await Store().auth.register(user, pass);
                            toast('Registered! Logging you in…');
                            await Store().auth.login(user, pass);
                            close();
                        }
                    } catch (e) { err.textContent = e.message; }
                };
                modal.querySelector('[data-act="go"]').addEventListener('click', go);
                modal.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
            },
        });
    }

    function changePasswordModal() {
        openModal({
            title: 'Change password',
            bodyHtml: `
                <div class="field"><label>Current password</label><input id="cpCur" type="password" autocomplete="current-password"></div>
                <div class="field"><label>New password</label><input id="cpNew" type="password" autocomplete="new-password" minlength="4"></div>
                <div class="field"><label>Confirm new password</label><input id="cpNew2" type="password" minlength="4"></div>
                <div class="error-text" id="cpErr"></div>`,
            footHtml: `
                <button class="btn ghost" data-act="cancel">Cancel</button>
                <button class="btn primary" data-act="go">${Icons.check} Update password</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="cancel"]').addEventListener('click', close);
                modal.querySelector('[data-act="go"]').addEventListener('click', async () => {
                    const err = modal.querySelector('#cpErr');
                    err.textContent = '';
                    const cur = modal.querySelector('#cpCur').value;
                    const nw = modal.querySelector('#cpNew').value;
                    if (nw !== modal.querySelector('#cpNew2').value) { err.textContent = 'New passwords do not match.'; return; }
                    try {
                        const data = await Store().auth.changePassword(cur, nw);
                        toast(data.message || 'Password updated');
                        close();
                    } catch (e) { err.textContent = e.message; }
                });
            },
        });
    }

    // ------------------------------------------------
    // Sync conflict modal
    // ------------------------------------------------
    function syncConflict() {
        const S = Store();
        const localSum = S.summary(S.state);
        const serverSum = S.summary(S._pendingServerState || {});
        const set = S.state.settings;

        // A replacement is not a drift. When the account copy is there because
        // another device imported a backup over the top, say so and say what it
        // costs — the generic "these differ" is what let this go unnoticed.
        const notice = S._pendingReplaceNotice;
        const missing = notice ? (notice.missing || 0) : 0;
        const replacedWhen = (notice && notice.marker && notice.marker.at)
            ? `${D.fmtDate(notice.marker.at, set)} ${D.fmtTime(notice.marker.at, set)}` : '';
        const noticeHtml = notice
            ? `<div class="pen-hint warn" style="margin-bottom:12px">${Icons.alert}
                 <div><strong>Your other device replaced all of its data
                 ${notice.marker && notice.marker.source === 'reset' ? 'with a reset' : 'from a backup file'}${replacedWhen ? ' on ' + escapeHtml(replacedWhen) : ''}.</strong>
                 ${missing
                    ? `${missing} ${missing === 1 ? 'entry' : 'entries'} on this device ${missing === 1 ? 'is' : 'are'} not in it. Keeping the account copy deletes ${missing === 1 ? 'it' : 'them'}; merging keeps everything from both.`
                    : 'Nothing on this device is missing from it.'}</div></div>`
            : '';
        const fmtSum = sum => `
            <p><strong>Last update:</strong> ${sum.lastUpdate ? D.fmtDate(sum.lastUpdate, set) + ' ' + D.fmtTime(sum.lastUpdate, set) : 'none'}</p>
            <p><strong>Entries:</strong> ${sum.shotCount} doses, ${sum.weightCount} weights</p>
            <p><strong>Last dose:</strong> ${sum.lastShot ? D.fmtDate(sum.lastShot.timestamp, set) + ' · ' + sum.lastShot.dose : '—'}</p>
            <p><strong>Last weight:</strong> ${sum.lastWeight ? D.fmtDate(sum.lastWeight.timestamp, set) + ' · ' + D.fmtWeight(sum.lastWeight.kg, set.weightUnit, true) : '—'}</p>`;

        openModal({
            title: notice ? 'Your other device replaced everything' : 'Data sync conflict',
            sub: 'Your local data differs from your account. Merge keeps everything from both.',
            noBackdropClose: true,
            noClose: true,
            bodyHtml: `
                ${noticeHtml}
                <div class="conflict-grid">
                    <div class="data-column"><h3>This device</h3>${fmtSum(localSum)}</div>
                    <div class="data-column"><h3>Your account</h3>${fmtSum(serverSum)}</div>
                </div>
                <p class="dim-sm" style="margin-top:10px">Merge combines both copies section by section — doses, weights, meds and supply are joined with duplicates removed. Items deleted on only one side will come back.</p>`,
            footHtml: `
                <button class="btn" data-act="local">${Icons.upload} Keep this device</button>
                <button class="btn${missing ? ' danger' : ''}" data-act="server">${Icons.download} Keep account copy${missing ? ` (deletes ${missing})` : ''}</button>
                <button class="btn primary" data-act="merge">${Icons.refresh} Merge both</button>`,
            onMount(modal, close) {
                modal.querySelector('[data-act="local"]').addEventListener('click', () => { S.resolveConflict(false); close(); });
                modal.querySelector('[data-act="server"]').addEventListener('click', () => { S.resolveConflict(true); close(); });
                modal.querySelector('[data-act="merge"]').addEventListener('click', () => {
                    S.resolveConflictMerge();
                    close();
                    toast('Merged both copies');
                });
            },
        });
    }

    // ------------------------------------------------
    // Deleted here, edited there
    // ------------------------------------------------
    // The one sync question the app asks. Everything else the two devices sort out
    // between themselves; this one is a genuine choice — a dose record that was
    // deleted on one device and corrected on the other.
    //
    // ONE ENTRY AT A TIME. Three collisions are three decisions, because the answer
    // for one dose is not the answer for another. "Apply to the rest" is there for
    // when it is.
    //
    // Closing this — the X, Escape, the backdrop, the tab — keeps everything. The
    // destructive answer is only ever the one that was explicitly clicked.

    function describeSyncEntry(coll, item) {
        const S = Store();
        const set = S.state.settings;
        try {
            if (!item) return 'an entry that is no longer here';
            const when = item.timestamp
                ? `${D.fmtDate(item.timestamp, set)} · ${D.fmtTime(item.timestamp, set)}`
                : '';
            if (coll === 'shots') {
                const med = S.state.meds.concat(S.state.trashedMeds || []).find(m => m.id === item.medId);
                const unit = (med && med.unit) || 'mg';
                const name = med ? med.name : 'dose';
                return `${item.dose}${unit} ${name}${when ? ' — ' + when : ''}`;
            }
            if (coll === 'weights') {
                return `${D.fmtWeight(item.kg, set.weightUnit, true)}${when ? ' — ' + when : ''}`;
            }
            if (coll === 'meds' || coll === 'trashedMeds') return item.name || item.id;
            if (coll === 'pens') return `Supply of ${item.dose ?? '?'} (${item.capacity ?? '?'} doses)`;
            return String(item.id || 'an entry');
        } catch (e) {
            return String((item && item.id) || 'an entry');
        }
    }

    const ENTRY_NOUN = {
        shots: 'dose', weights: 'weight', meds: 'medication',
        trashedMeds: 'medication', pens: 'supply',
    };

    function syncItemConflicts(collisions) {
        return new Promise(resolve => {
            const answers = {};
            let settled = false;
            const done = () => { if (!settled) { settled = true; resolve(answers); } };
            let i = 0;

            function step() {
                if (i >= collisions.length) { done(); return; }
                const c = collisions[i];
                let advancing = false;
                const noun = ENTRY_NOUN[c.coll] || 'entry';
                const remaining = collisions.length - i - 1;
                const deletedWhere = c.deletedOnThisDevice ? 'this device' : 'your other device';
                const editedWhere = c.deletedOnThisDevice ? 'your other device' : 'this device';
                const bulk = c.kind === 'bulk-delete';

                const plural = Store().collectionLabel(c.coll);
                const bulkBody = () => `
                        <p><strong>Your other device deleted ${c.count} of your ${c.total} ${escapeHtml(plural)}</strong>
                           in one go. That can be exactly what was meant — or an old backup, or a mistake.
                           Nothing has been deleted here yet.</p>
                        <div class="conflict-grid">
                            <div class="data-column">
                                <h3>Here now</h3>
                                <p>${c.total} ${escapeHtml(plural)}</p>
                            </div>
                            <div class="data-column">
                                <h3>If you delete</h3>
                                <p>${Math.max(0, c.total - c.count)} ${escapeHtml(plural)}</p>
                            </div>
                        </div>
                        ${(c.sample || []).filter(Boolean).length ? `<p class="dim-sm" style="margin-top:10px">
                            For example: ${(c.sample || []).filter(Boolean).slice(0, 3)
                                .map(x => escapeHtml(describeSyncEntry(c.coll, x))).join(' · ')}
                        </p>` : ''}
                        <p class="dim-sm" style="margin-top:10px">Keeping them is the safe answer — they go back to your other device too, and you can delete them later.</p>`;

                openModal({
                    title: bulk
                        ? `${c.count} ${plural} were deleted on your other device`
                        : `A ${noun} was deleted in one place and changed in another`,
                    sub: collisions.length > 1 ? `${i + 1} of ${collisions.length}` : '',
                    noBackdropClose: true,
                    bodyHtml: bulk ? bulkBody() : `
                        <p>This ${escapeHtml(noun)} was <strong>deleted on ${escapeHtml(deletedWhere)}</strong>
                           and <strong>changed on ${escapeHtml(editedWhere)}</strong>. Only you know which was meant.</p>
                        <div class="conflict-grid">
                            <div class="data-column">
                                <h3>It was</h3>
                                <p>${escapeHtml(describeSyncEntry(c.coll, c.before))}</p>
                            </div>
                            <div class="data-column">
                                <h3>${c.wasAdded ? 'Added as' : 'Changed to'}</h3>
                                <p>${escapeHtml(describeSyncEntry(c.coll, c.after))}</p>
                            </div>
                        </div>
                        <p class="dim-sm" style="margin-top:10px">Keeping it is the safe answer — nothing is lost, and you can delete it later.</p>
                        ${remaining ? `<label class="dim-sm" style="display:flex;gap:8px;align-items:center;margin-top:10px">
                            <input type="checkbox" data-act="all"> Do the same for the other ${remaining}
                        </label>` : ''}`,
                    footHtml: bulk ? `
                        <button class="btn danger-solid" data-act="delete">${Icons.trash || ''} Delete all ${c.count}</button>
                        <button class="btn primary" data-act="keep">${Icons.check || ''} Keep them</button>` : `
                        <button class="btn danger-solid" data-act="delete">${Icons.trash || ''} Delete it</button>
                        <button class="btn primary" data-act="keep">${Icons.check || ''} Keep it</button>`,
                    onMount(modal, close) {
                        const applyAll = () => {
                            const box = modal.querySelector('[data-act="all"]');
                            return !!(box && box.checked);
                        };
                        const answer = (choice) => {
                            const rest = applyAll();
                            answers[c.key] = choice;
                            if (rest) {
                                for (let j = i + 1; j < collisions.length; j++) answers[collisions[j].key] = choice;
                                i = collisions.length;
                            } else {
                                i += 1;
                            }
                            // Moving to the next question also fires onClose, which
                            // must not be read as a dismissal.
                            advancing = true;
                            close();
                            advancing = false;
                            step();
                        };
                        modal.querySelector('[data-act="keep"]').addEventListener('click', () => answer('keep'));
                        modal.querySelector('[data-act="delete"]').addEventListener('click', () => answer('delete'));
                    },
                    // Dismissed. Whatever is left keeps its entry: sync-wip.js treats
                    // an unanswered collision as "keep", and records it so this is
                    // not asked again on every sync.
                    onClose() { if (!advancing) done(); },
                });
            }

            step();
        });
    }

    // Each file adds to the shared namespace rather than replacing it, so app.js can
    // keep one reference and the load order below stops mattering.
    Object.assign(window.Modals = window.Modals || {}, { authModal, changePasswordModal, syncConflict, syncItemConflicts });
})();
