// template.js — the complete auth + sync example.
//
// Copy this folder for a new page, then change APP_NAME, the data model, and the
// handful of functions marked CUSTOMISE. Everything else works as it stands.
//
// The sync section is the part worth reading before you change it. What you declare
// there is what decides whether two devices merge cleanly or quietly delete each
// other's entries — it is configuration, not boilerplate.

/*************************************
 * APPLICATION CONFIGURATION
 *************************************/
// MUST be unique per app. It is the key this app's data is stored under, both on the
// server (/api/data/<APP_NAME>) and in localStorage.
const APP_NAME = 'template-app';

// 'live' or 'wip'. Picks which backend AuthManagerWip talks to AND namespaces every
// local key, so a wip page can never scribble over live data.
const ENVIRONMENT = 'wip';

const LOGGING_ENABLED = ENVIRONMENT === 'wip';
function appLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[APP_LOG]', ...args);
    }
}

/*************************************
 * APPLICATION DATA MODEL
 *************************************
 * Three kinds of field, and the difference matters to sync:
 *
 *   real data     items, and the settings that are choices about the data. A
 *                 difference here is worth reconciling.
 *   view state    sort order, chart ranges, which tab is open. It syncs, but it must
 *                 never look like a data conflict — see VIEW_ONLY_SETTINGS.
 *   per device    theme, text size, anything a phone and a PC should disagree about.
 *                 It never leaves this browser at all — see DEVICE_KEYS.
 *************************************/

const DEFAULT_SETTINGS = {
    listName: 'My list',   // data
    sortBy: 'created',     // view state: synced, never a conflict
    theme: 'dark',         // per device
    fontSize: 'medium',    // per device
};

// Settings that belong to THIS DEVICE. They generate no sync operation and none is
// ever applied to them, so changing the theme on your phone is not news for your PC.
// Each device keeps its own copy in DEVICE_STORAGE_KEY.
const DEVICE_KEYS = ['theme', 'fontSize'];

// The above PLUS the settings that do sync but must never register as a data change.
// Only this second list is used by canonical(); DEVICE_KEYS is used by the sync
// engine itself.
const VIEW_ONLY_SETTINGS = DEVICE_KEYS.concat(['sortBy']);

const DEFAULT_DATA = {
    version: 1,
    // Every item carries a stable `id` and an `updatedAt`. Both are required for the
    // sync engine to ship CHANGES rather than the whole blob — no id, no operations.
    // Store times as epoch milliseconds, not Date objects: state travels through
    // JSON (localStorage, the wire, the sync engine's own fingerprints), and a Date
    // silently becomes a string on the way. Format at render time instead.
    items: [],             // {id, text, done, createdAt, updatedAt}
    settings: Object.assign({}, DEFAULT_SETTINGS),
    activeItemId: null,    // which item this browser has open — per device
};

let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));

const LOCAL_STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_data`;
const DEVICE_STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_device`;

// What the sync engine treats as items. /sync-wip.js knows nothing about this app —
// it is told which fields are collections, how to identify an item, and (where one
// exists) which clock the item carries.
//
//   identity(item)  REQUIRED for an array collection. Two items sharing an identity,
//                   or one missing it, makes the collection unkeyable and the engine
//                   falls back to whole-state saves — correct, just coarse.
//   timestamp(item) optional; only orders operations within a push so the stored log
//                   reads as history. Omit it where the data has no clock.
//   kind: 'map'     a key/value section (settings, a profile) rather than a list.
//   ignore          map keys this device keeps to itself.
//
// Not listed here: `version` (a constant) and `activeItemId` (per device, see
// ignoreKeys below). Neither generates an operation.
const SYNC_COLLECTIONS = [
    { name: 'items', identity: (it) => it.id, timestamp: (it) => it.updatedAt },
    { name: 'settings', kind: 'map', ignore: DEVICE_KEYS },
];

// Wire name -> what a person is shown, used in the sentences sync writes for itself
// ("2 entries added"). Only needed where the two differ — meds calls its `shots`
// collection "doses". Anything unlisted is named by its collection name.
const COLLECTION_LABELS = {
    items: 'entries',
};

/*************************************
 * AUTHENTICATION SETUP
 *************************************/
// One login covers every app on the site; APP_NAME only scopes the DATA.
//
// NOTE: signing in needs crypto.subtle, which browsers only expose in a secure
// context. Serve this page over https:// (or localhost); over plain http:// the
// sign-in throws by design rather than deriving something weaker.
const authManager = new AuthManagerWip(APP_NAME, ENVIRONMENT);

// The sync client is created once the data model exists — see initSync().
let syncClient = null;

/*************************************
 * DOM ELEMENT REFERENCES
 *************************************/
function getElements() {
    return {
        // Auth UI
        userStatus: document.getElementById("userStatus"),
        loginButton: document.getElementById("loginButton"),
        logoutButton: document.getElementById("logoutButton"),
        registerButton: document.getElementById("registerButton"),
        settingsButton: document.getElementById("settingsButton"),
        localSyncButton: document.getElementById("localSyncButton"),

        // Modals
        loginModal: document.getElementById("loginModal"),
        registerModal: document.getElementById("registerModal"),
        changePasswordModal: document.getElementById("changePasswordModal"),
        settingsModal: document.getElementById("settingsModal"),
        syncModal: document.getElementById("syncModal"),
        syncChoiceModal: document.getElementById("syncChoiceModal"),
        itemConflictModal: document.getElementById("itemConflictModal"),

        // Forms
        loginForm: document.getElementById("loginForm"),
        registerForm: document.getElementById("registerForm"),
        changePasswordForm: document.getElementById("changePasswordForm"),

        // Form inputs
        loginUsername: document.getElementById("loginUsername"),
        loginPassword: document.getElementById("loginPassword"),
        registerUsername: document.getElementById("registerUsername"),
        registerPassword: document.getElementById("registerPassword"),
        registerConfirmPassword: document.getElementById("registerConfirmPassword"),
        currentPassword: document.getElementById("currentPassword"),
        newPassword: document.getElementById("newPassword"),
        confirmNewPassword: document.getElementById("confirmNewPassword"),

        // Error/status messages
        loginError: document.getElementById("loginError"),
        registerError: document.getElementById("registerError"),
        changePasswordError: document.getElementById("changePasswordError"),
        changePasswordSuccess: document.getElementById("changePasswordSuccess"),
        syncStatus: document.getElementById("syncStatus"),

        // Change password button
        changePasswordButton: document.getElementById("changePasswordButton"),

        // Sync UI
        exportDataButton: document.getElementById("exportData"),
        importDataInput: document.getElementById("importData"),

        // Silent-merge notice (onMerged)
        syncNotice: document.getElementById("syncNotice"),
        syncNoticeText: document.getElementById("syncNoticeText"),
        syncNoticeActions: document.getElementById("syncNoticeActions"),

        // Delete-vs-edit prompt (onItemConflict)
        itemConflictList: document.getElementById("itemConflictList"),
        itemConflictApply: document.getElementById("itemConflictApply"),
        itemConflictKeepAll: document.getElementById("itemConflictKeepAll"),

        // Sync choice modal elements
        useLocalDataBtn: document.getElementById("useLocalDataBtn"),
        useServerDataBtn: document.getElementById("useServerDataBtn"),
        localLastUpdate: document.getElementById("localLastUpdate"),
        localSummary: document.getElementById("localSummary"),
        serverLastUpdate: document.getElementById("serverLastUpdate"),
        serverSummary: document.getElementById("serverSummary"),
    };
}

/************************************
 * LOCAL DATA MANAGEMENT
 ************************************/

/**
 * Fill in anything a stored or server copy predates, and put this device's own
 * preferences back on top. Every copy of the state passes through here — local load,
 * server download, imported file — so there is one place that decides what a valid
 * state looks like.
 */
function normalizeData(raw) {
    const out = Object.assign({}, DEFAULT_DATA, raw || {});
    out.items = (raw && Array.isArray(raw.items) ? raw.items : []).filter((it) => it && it.id);
    out.settings = Object.assign({}, DEFAULT_SETTINGS, (raw && raw.settings) || {});

    // Device-only settings never come from synced data: reset them to the defaults,
    // then overlay whatever THIS device last used.
    DEVICE_KEYS.forEach((k) => { out.settings[k] = DEFAULT_SETTINGS[k]; });
    try {
        const dev = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) || 'null');
        if (dev && dev.settings) {
            DEVICE_KEYS.forEach((k) => {
                if (dev.settings[k] != null) out.settings[k] = dev.settings[k];
            });
        }
        if (dev && dev.activeItemId && out.items.some((it) => it.id === dev.activeItemId)) {
            out.activeItemId = dev.activeItemId;
        } else {
            out.activeItemId = null;
        }
    } catch (e) { /* a corrupt device blob is not worth failing over */ }

    return out;
}

function loadLocalData() {
    appLog("Loading local data from localStorage...");
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        appData = normalizeData(stored ? JSON.parse(stored) : null);
        return;
    } catch (e) {
        console.error("Error loading local data:", e);
    }
    appData = normalizeData(null);
}

function saveLocalData() {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appData));
        // Device preferences live in their own blob so a phone and a PC do not fight
        // over view state through account sync.
        const dev = { activeItemId: appData.activeItemId, settings: {} };
        DEVICE_KEYS.forEach((k) => { dev.settings[k] = appData.settings[k]; });
        localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(dev));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}

/** Change the data, persist it, and let sync ship the difference. */
function updateData(mutate) {
    mutate(appData);
    saveLocalData();
    if (syncClient) syncClient.scheduleSave();   // debounced; repeated calls collapse
    updateDisplay();
}

/************************************
 * SERVER DATA SYNC  (via /sync-wip.js)
 ************************************
 * The shared module owns the transport, the debounce, the server-assigned version
 * numbers and the merge. This page only describes its own data.
 *
 * Because SYNC_COLLECTIONS is declared, a save ships what CHANGED — added, edited,
 * deleted — instead of the whole blob. Being behind stops being a conflict, a
 * deletion is no longer undone by the next merge, and "both devices changed" is
 * answered from the operation log rather than by stopping to ask the user.
 ************************************/

function initSync() {
    syncClient = new SyncWip.SyncClient({
        auth: authManager,
        appName: APP_NAME,

        getState: () => appData,
        setState: (s) => { appData = s; saveLocalData(); updateDisplay(); },

        // "Is this blob one of ours?" — guards against another app's data.
        accept: (raw) => !!raw && typeof raw === 'object' && Array.isArray(raw.items),

        normalize: (raw) => normalizeData(raw),

        hasData: (s) => !!s && (s.items || []).length > 0,

        // The operation log. This is the line that turns conflicts from the user's
        // problem into the engine's problem — see SYNC_COLLECTIONS above.
        collections: SYNC_COLLECTIONS,
        collectionLabels: COLLECTION_LABELS,

        // Top-level fields that are this device's business, not synced data. They are
        // dropped from the fingerprint and excluded from the check that an operation
        // push carries the whole difference. Anything else outside SYNC_COLLECTIONS
        // that changes forces an honest whole-state save rather than being left behind.
        ignoreKeys: ['activeItemId'],

        // CUSTOMISE: the conflict fingerprint. Anything left OUT still syncs, it just
        // never asks the user about it — that is where view state belongs, so changing
        // a sort order or a chart range on your phone can never pop a prompt on your PC.
        canonical: (s) => getCanonicalString(s),

        // CUSTOMISE: union both copies, dropping duplicates. Only reached on the
        // no-base fallback path (a first sync, cleared storage), but where a page can
        // do this "merge both" is the resolution to recommend — it cannot lose a record.
        merge: (theirs, mine) => {
            const byId = new Map((theirs.items || []).map((it) => [it.id, it]));
            (mine.items || []).forEach((it) => byId.set(it.id, it));   // mine wins ties
            return Object.assign({}, theirs, mine, { items: Array.from(byId.values()) });
        },

        onStatus: (status) => appLog('sync status:', status),

        // Both devices changed something? That is no longer a question for the user:
        // their changes are applied, mine go on top, and the app just says what
        // happened. A CATCH-UP (info.kind === 'catch-up') arrives the same way — sync
        // worked out that one side was simply behind and moved the data without asking.
        //
        // It is a NOTICE, not a question. Nothing waits on it, and ignoring it is
        // confirming it: the action already happened, so a dismissal must never undo
        // it. Revert stays reachable afterwards via syncClient.recentActions(), because
        // a notice you have already dismissed is not a recovery path.
        onMerged: (info) => {
            updateDisplay();
            const n = info.changesFromOtherDevice;
            let msg = info.message || `Merged ${n} change${n === 1 ? '' : 's'} from your other device`;
            if (info.stats && info.stats.myEditWon) msg += ` — ${info.stats.myEditWon} kept from this device`;
            if (info.awaitingDecision) msg += ` — ${info.awaitingDecision} need a decision`;

            if (!info.revertable) {
                // Say plainly when it cannot be undone rather than offering a button
                // that does nothing. An upload changed nothing here, so there is
                // nothing to say about undoing it.
                if (info.direction !== 'upload') msg += " — can't be undone on this device";
                showSyncNotice(msg, []);
                return;
            }

            showSyncNotice(msg, [
                { label: 'Revert', act: () => info.revert() },
                { label: 'OK', act: () => info.confirm(), primary: true },
            ], () => info.confirm());   // dismissing IS confirming
        },

        // The ONE thing sync will not decide by itself: an entry deleted on one device
        // and edited on the other. Raised per entry, AFTER the rest of the merge has
        // already been saved, so nothing is waiting on the answer.
        //
        // Answer with {[collision.key]: 'delete'} for the entries to remove. Anything
        // not named — a dismissal, a closed tab, a page with no UI for this — KEEPS
        // the entry. A dismissal must never destroy.
        onItemConflict: (info) => showItemConflictModal(info.collisions),

        // The old two-way prompt. Now only reached when there is no base to reason
        // from: a first sync, cleared storage, or another device replacing everything.
        // Resolve with 'mine' | 'theirs' | 'merge'.
        onConflict: (info) => new Promise((resolve) => {
            showSyncChoiceModal(
                generateDataSummary(info.mine),
                generateDataSummary(info.theirs),
                resolve
            );
        }),
    });
}

async function fetchBackendData() {
    const out = await syncClient.fetchFromServer();
    if (out === 'error' || out === null) return null;   // 'error' is NOT 'empty'
    return out.state;
}

/** Immediate write, for a change that must not sit in the debounce. */
async function saveBackendData() {
    return syncClient.flush();
}

/************************************
 * DATA COMPARISON & SYNC LOGIC
 ************************************/

/**
 * CUSTOMISE: a canonical string for conflict detection.
 *
 * View and appearance state is deliberately EXCLUDED — see VIEW_ONLY_SETTINGS. Those
 * still sync; they just never make two copies count as different.
 */
function getCanonicalString(data) {
    if (!data) return null;
    const items = (data.items || [])
        .map((it) => [it.id, it.text || '', it.done ? 1 : 0].join('|'))
        .sort();
    const settings = Object.keys(DEFAULT_SETTINGS)
        .filter((k) => VIEW_ONLY_SETTINGS.indexOf(k) === -1)
        .sort()
        .map((k) => {
            const v = (data.settings || {})[k];
            return k + '=' + JSON.stringify(v != null ? v : null);
        });
    return JSON.stringify({ items, settings });
}

/** CUSTOMISE: a one-line human description of a copy, for the conflict modal. */
function generateDataSummary(data) {
    if (!data) return { lastUpdate: 'N/A', summary: 'No data' };
    const items = data.items || [];
    const newest = items.reduce((max, it) => Math.max(max, it.updatedAt || 0), 0);
    return {
        lastUpdate: newest ? new Date(newest).toLocaleString() : 'N/A',
        summary: `${items.length} entr${items.length === 1 ? 'y' : 'ies'}`,
    };
}

/**
 * The silent-merge notice. Not a dialog — it reports something that has already
 * happened. `onDismiss` runs when it closes without a button being pressed.
 */
function showSyncNotice(message, actions, onDismiss) {
    const elements = getElements();
    if (!elements.syncNotice) return;

    let settled = false;
    const settle = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(elements.syncNotice._timer);
        elements.syncNotice.style.display = 'none';
        if (fn) fn();
    };

    elements.syncNoticeText.textContent = message;
    elements.syncNoticeActions.innerHTML = '';
    (actions || []).forEach((a) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = a.label;
        if (a.primary) btn.style.fontWeight = '600';
        btn.addEventListener('click', () => settle(a.act));
        elements.syncNoticeActions.appendChild(btn);
    });

    elements.syncNotice.style.display = 'flex';
    elements.syncNotice._timer = setTimeout(() => settle(onDismiss), 9000);
}

/** CUSTOMISE: how one of your items is named in the delete-vs-edit prompt. */
function describeItem(collection, item) {
    if (item == null) return '(no longer on this device)';
    if (collection === 'items') return item.text || `entry ${item.id}`;
    return JSON.stringify(item);
}

/**
 * The delete-vs-edit prompt. Deliberately opt-IN to deleting: nothing is removed
 * unless it is ticked, and closing the modal keeps everything.
 *
 * Resolves with {[key]: 'delete'} — or null, which means keep them all.
 */
function showItemConflictModal(collisions) {
    const elements = getElements();
    if (!elements.itemConflictModal) return Promise.resolve(null);

    elements.itemConflictList.innerHTML = '';
    collisions.forEach((c, i) => {
        const row = document.createElement('label');
        row.className = 'input-group';
        row.style.display = 'block';

        const box = document.createElement('input');
        box.type = 'checkbox';
        // The answer is keyed by c.key, which is an internal string holding NUL
        // separators — keep it in JS and put only the row number in the DOM.
        box.dataset.index = String(i);

        const text = document.createElement('span');
        const where = c.deletedOnThisDevice
            ? 'You deleted this here; your other device edited it'
            : 'Deleted on your other device; you edited it here';
        text.textContent = ` Delete "${describeItem(c.coll, c.after || c.before)}"? (${where}.)`;

        row.appendChild(box);
        row.appendChild(text);
        elements.itemConflictList.appendChild(row);
    });

    elements.itemConflictModal.style.display = 'block';

    return new Promise((resolve) => {
        const finish = (answers) => {
            elements.itemConflictModal.style.display = 'none';
            resolve(answers);
        };

        // Replace the buttons to drop listeners from a previous round.
        const apply = elements.itemConflictApply.cloneNode(true);
        const keepAll = elements.itemConflictKeepAll.cloneNode(true);
        elements.itemConflictApply.replaceWith(apply);
        elements.itemConflictKeepAll.replaceWith(keepAll);

        apply.addEventListener('click', () => {
            const answers = {};
            elements.itemConflictList
                .querySelectorAll('input[type="checkbox"]:checked')
                .forEach((box) => {
                    const c = collisions[Number(box.dataset.index)];
                    if (c) answers[c.key] = 'delete';
                });
            finish(answers);
        });
        keepAll.addEventListener('click', () => finish(null));
    });
}

/**
 * Shows the two-way choice modal. Calls back with 'mine', 'theirs' or 'merge'.
 */
function showSyncChoiceModal(localSummary, serverSummary, resolve) {
    const elements = getElements();

    elements.localLastUpdate.textContent = localSummary.lastUpdate;
    elements.localSummary.textContent = localSummary.summary;
    elements.serverLastUpdate.textContent = serverSummary.lastUpdate;
    elements.serverSummary.textContent = serverSummary.summary;

    // Replace buttons to drop any listeners from a previous conflict.
    const newUploadBtn = elements.useLocalDataBtn.cloneNode(true);
    const newDownloadBtn = elements.useServerDataBtn.cloneNode(true);
    elements.useLocalDataBtn.replaceWith(newUploadBtn);
    elements.useServerDataBtn.replaceWith(newDownloadBtn);

    const finish = (choice) => {
        elements.syncChoiceModal.style.display = 'none';
        resolve(choice);
    };

    newUploadBtn.addEventListener('click', () => finish('mine'));
    newDownloadBtn.addEventListener('click', () => finish('theirs'));

    // "Merge both" is added dynamically so the template's HTML does not have to
    // change; move it into the markup if you want it styled with the others.
    const existing = document.getElementById('mergeDataBtn');
    if (existing) existing.remove();
    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.id = 'mergeDataBtn';
    mergeBtn.textContent = 'Merge both (recommended)';
    mergeBtn.addEventListener('click', () => finish('merge'));
    newDownloadBtn.insertAdjacentElement('afterend', mergeBtn);

    elements.syncChoiceModal.style.display = 'block';
}

/**
 * Runs after login / session restore.
 * Returns 'in-sync' | 'downloaded' | 'uploaded' | 'merged' | 'conflict' | 'none'.
 */
async function performDataSync() {
    if (!authManager.isLoggedIn()) {
        appLog("Not logged in, skipping sync.");
        return 'none';
    }
    const result = await syncClient.performSync();
    appLog("Sync result:", result);
    updateDisplay();
    return result;
}

/************************************
 * UI UPDATE FUNCTIONS
 ************************************/
function updateUIForLoginState() {
    const elements = getElements();
    const isLoggedIn = authManager.isLoggedIn();

    elements.loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.registerButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';

    if (isLoggedIn && authManager.currentUser) {
        // The username is a DISPLAY LABEL only — changeable, and it may collide.
        // The identity is the UUID: authManager.userUuid() (the token's `sub`).
        elements.userStatus.textContent = `Logged in: ${authManager.currentUser.username}`;
        elements.userStatus.style.color = '#4bc0c0';
    } else {
        elements.userStatus.textContent = 'Not logged in (Local)';
        elements.userStatus.style.color = '#ccc';
    }

    if (elements.changePasswordButton) {
        elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    }
}

function updateDisplay() {
    // Render your app here.
    appLog("Updating UI. Entries:", (appData.items || []).length);
}

/************************************
 * AUTH EVENT HANDLERS
 ************************************/
window.addEventListener('auth:login', async (e) => {
    appLog("Login event received:", e.detail.user);
    updateUIForLoginState();
    getElements().loginModal.style.display = 'none';
    await performDataSync();
});

window.addEventListener('auth:logout', (e) => {
    appLog("Logout event received:", e.detail);
    if (e.detail.message) alert(e.detail.message);
    updateUIForLoginState();
    updateDisplay();
});

window.addEventListener('auth:session-restored', async (e) => {
    appLog("Session restored:", e.detail.user);
    updateUIForLoginState();
    await performDataSync();
});

window.addEventListener('auth:no-session', () => {
    appLog("No session found.");
    updateUIForLoginState();
});

window.addEventListener('auth:register', (e) => {
    appLog("Registration successful:", e.detail.username);
});

window.addEventListener('auth:password-changed', async (e) => {
    appLog("Password changed:", e.detail.message);
    getElements().changePasswordSuccess.textContent = e.detail.message;
    setTimeout(() => {
        authManager.logout("Password changed. Please log in again.");
    }, 2000);
});

/************************************
 * FORM HANDLERS
 ************************************/
async function handleLogin(event) {
    event.preventDefault();
    const elements = getElements();
    elements.loginError.textContent = '';

    try {
        // The password is never sent: auth-wip.js derives an authSecret from it in
        // this browser and sends that. It needs crypto.subtle, so the error you get
        // over plain http:// is about the page's URL, not the password.
        await authManager.login(elements.loginUsername.value.trim(), elements.loginPassword.value);
        // The auth:login event handles the rest.
    } catch (error) {
        elements.loginError.textContent = error.message;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const elements = getElements();
    elements.registerError.textContent = '';

    const username = elements.registerUsername.value.trim();
    const password = elements.registerPassword.value;

    if (password !== elements.registerConfirmPassword.value) {
        elements.registerError.textContent = 'Passwords do not match.';
        return;
    }

    try {
        // register(username, password, {email}) — email is optional, and an account
        // WITHOUT one has no recovery path. Show result.recoveryWarning at signup
        // rather than letting that be discovered after a forgotten password.
        const result = await authManager.register(username, password);
        alert(result.recoveryWarning || "Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginUsername.value = username;
        elements.loginPassword.focus();
    } catch (error) {
        elements.registerError.textContent = error.message;
    }
}

async function handleChangePassword(event) {
    event.preventDefault();
    const elements = getElements();
    elements.changePasswordError.textContent = '';
    elements.changePasswordSuccess.textContent = '';

    if (elements.newPassword.value !== elements.confirmNewPassword.value) {
        elements.changePasswordError.textContent = 'New passwords do not match.';
        return;
    }

    try {
        await authManager.changePassword(elements.currentPassword.value, elements.newPassword.value);
        // The auth:password-changed event handles the rest.
    } catch (error) {
        elements.changePasswordError.textContent = error.message;
    }
}

/************************************
 * LOCAL FILE SYNC
 ************************************/
function showSyncStatus(message, type = "info") {
    const el = getElements().syncStatus;
    if (el) {
        el.textContent = message;
        el.className = `sync-status-${type}`;
        setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
    }
}

function exportDataToFile() {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showSyncStatus("Data exported!", "success");
}

/**
 * Importing over the top is a WHOLESALE REPLACEMENT, not an edit — and the difference
 * is not cosmetic. Diffing a replacement against the last synced state turns it into
 * one deletion per entry the backup does not contain, and every other device applies
 * a deletion without asking. Two devices importing two different backups then delete
 * each other's data; that has already happened here, to real data.
 *
 * So it goes up through replaceAll(), which publishes a marked snapshot: the other
 * device is ASKED rather than emptied. Use flush() for an ordinary edit; use
 * replaceAll() for an import-over-the-top or a reset.
 */
function importDataFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const parsed = JSON.parse(e.target.result);
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) {
                throw new Error("Invalid file format");
            }

            const incoming = normalizeData(parsed);

            // Say what it costs BEFORE doing it. diffSummary counts what the change
            // would add, remove and alter without applying anything — "this will
            // delete 84 entries" is the sentence that prevents the accident.
            const specs = SyncWip.normaliseCollections(SYNC_COLLECTIONS);
            const summary = SyncWip.diffSummary(appData, incoming, specs);
            const warning = summary.totals.removed
                ? `This will DELETE ${summary.totals.removed} entr${summary.totals.removed === 1 ? 'y' : 'ies'} not in the file. `
                : '';
            if (!confirm(`${warning}Import ${summary.totals.added} new and keep ${summary.totals.identical + summary.totals.changed}. Proceed?`)) return;

            appData = incoming;
            saveLocalData();
            updateDisplay();
            showSyncStatus("Import successful!", "success");

            if (authManager.isLoggedIn()) {
                await syncClient.replaceAll(appData, {
                    source: 'import',
                    removed: summary.totals.removed,
                    kept: summary.totals.identical + summary.totals.changed,
                });
            }
        } catch (error) {
            showSyncStatus(`Import failed: ${error.message}`, "error");
        }
    };
    reader.readAsText(file);
}

/************************************
 * EVENT LISTENERS SETUP
 ************************************/
function setupEventListeners() {
    const elements = getElements();

    elements.loginButton.addEventListener('click', () => {
        elements.loginModal.style.display = 'block';
    });

    elements.registerButton.addEventListener('click', () => {
        elements.registerModal.style.display = 'block';
    });

    elements.logoutButton.addEventListener('click', () => {
        authManager.logout();
    });

    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);

    if (elements.changePasswordForm) {
        elements.changePasswordForm.addEventListener('submit', handleChangePassword);
    }

    elements.settingsButton.addEventListener('click', () => {
        elements.settingsModal.style.display = 'block';
    });

    if (elements.changePasswordButton) {
        elements.changePasswordButton.addEventListener('click', () => {
            elements.changePasswordModal.style.display = 'block';
        });
    }

    elements.localSyncButton.addEventListener('click', () => {
        elements.syncModal.style.display = 'block';
    });

    elements.exportDataButton.addEventListener('click', exportDataToFile);
    elements.importDataInput.addEventListener('change', importDataFromFile);

    // Modal close handlers. The two sync modals are excluded: both answer a promise,
    // and a backdrop click would leave that promise unresolved.
    document.body.addEventListener('click', function (e) {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal || modal.id === 'syncChoiceModal' || modal.id === 'itemConflictModal') return;

        const isCloseControl = e.target.matches(
            '.close-modal, .close-auth-modal, .close-sync-modal, ' +
            '.close-modal-button, .close-auth-modal-button, .close-sync-modal-button'
        );

        if (isCloseControl || e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

/************************************
 * INITIALIZATION
 ************************************/
document.addEventListener("DOMContentLoaded", async () => {
    appLog("Application starting...");

    // 1. Load local data first — the page works fully logged out.
    loadLocalData();

    // 2. Create the sync client (needs auth + the data model).
    initSync();

    // 3. Wire up the UI.
    setupEventListeners();

    // 4. Restore a session if there is one. This fires auth:session-restored, which
    //    runs the first sync.
    await authManager.initialize();

    updateUIForLoginState();
    updateDisplay();

    appLog("Application initialized.");
});
