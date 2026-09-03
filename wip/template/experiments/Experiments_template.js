// Experiments_template.js — the shared auth + sync layer, wired to a page that keeps
// its state in ordinary variables rather than one object.
//
// Copy this folder, change APP_NAME and the data model, then rewrite the functions
// marked CUSTOMISE. The sync block is the part to read before changing: what you
// declare there decides whether two devices merge cleanly or delete each other's
// entries.

/*************************************
 * APPLICATION CONFIGURATION
 *************************************/
// MUST be unique per app. It is the key this app's data is stored under, both on the
// server (/api/data/<APP_NAME>) and in localStorage.
const APP_NAME = 'experiments-template';

// 'live' or 'wip'. Picks which backend AuthManagerWip talks to AND namespaces every
// local key, so a wip page can never scribble over live data.
const ENVIRONMENT = 'wip';

const LOGGING_ENABLED = ENVIRONMENT === 'wip';
function syncLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[EXP_LOG]', ...args);
    }
}

/*************************************
 * APPLICATION DATA MODEL
 *************************************
 * Notes carry a stable `id` and an `updatedAt`. Both are required for sync to ship
 * CHANGES rather than the whole blob — no id, no operations.
 *
 * Times are epoch milliseconds, NOT Date objects. State travels through JSON
 * (localStorage, the wire, sync's own fingerprints) and a Date silently becomes a
 * string on the way, so two copies of the same note can stop comparing equal. Store
 * a number; format it at render time.
 *************************************/
let userNotes = [];        // [{id, title, body, createdAt, updatedAt}]
let appPreferences = {};

const defaultPreferences = {
    autoTag: '',        // data
    sortBy: 'newest',   // view state: synced, but never a conflict
    theme: 'dark',      // per device
    fontSize: 'medium', // per device
};

// Preferences that belong to THIS DEVICE. They generate no sync operation and none
// is ever applied to them, so changing the theme on your phone is not news for your
// PC. Each device keeps its own copy in the device blob below.
const DEVICE_PREFS = ['theme', 'fontSize'];

// The above PLUS preferences that do sync but must never register as a data change.
// Only this second list is used by getCanonicalString().
const VIEW_ONLY_PREFS = DEVICE_PREFS.concat(['sortBy']);

// Storage keys (the environment is in the prefix so wip and live never collide).
const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;
const DEVICE_STORAGE_KEY = `${STORAGE_PREFIX}device`;

// What the sync engine treats as items. /sync-wip.js knows nothing about notes — it
// is told which fields are collections, how to identify an item, and (where one
// exists) which clock the item carries.
//
//   identity(item)  REQUIRED for an array collection. A missing identity, or two
//                   items claiming the same one, makes the collection unkeyable and
//                   the engine falls back to whole-state saves — correct, just coarse.
//   timestamp(item) optional; orders operations within a push so the stored log reads
//                   as history. Omit it where the data has no clock.
//   kind: 'map'     a key/value section (preferences, a profile) rather than a list.
//   ignore          map keys this device keeps to itself.
const SYNC_COLLECTIONS = [
    { name: 'userNotes', identity: (n) => n.id, timestamp: (n) => n.updatedAt },
    { name: 'appPreferences', kind: 'map', ignore: DEVICE_PREFS },
];

// Wire name -> what a person is shown, used in the sentences sync writes for itself
// ("2 notes added"). Only needed where the two differ.
const COLLECTION_LABELS = {
    userNotes: 'notes',
    appPreferences: 'preferences',
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

        // Inputs
        loginUsername: document.getElementById("loginUsername"),
        loginPassword: document.getElementById("loginPassword"),
        registerUsername: document.getElementById("registerUsername"),
        registerPassword: document.getElementById("registerPassword"),
        registerConfirmPassword: document.getElementById("registerConfirmPassword"),
        currentPassword: document.getElementById("currentPassword"),
        newPassword: document.getElementById("newPassword"),
        confirmNewPassword: document.getElementById("confirmNewPassword"),

        // Status/Errors
        loginError: document.getElementById("loginError"),
        registerError: document.getElementById("registerError"),
        changePasswordError: document.getElementById("changePasswordError"),
        changePasswordSuccess: document.getElementById("changePasswordSuccess"),
        syncStatus: document.getElementById("syncStatus"),

        // Settings/Sync actions
        changePasswordButton: document.getElementById("changePasswordButton"),
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

        // Sync Choice Modal elements
        localLastUpdate: document.getElementById("localLastUpdate"),
        localEntryCount: document.getElementById("localEntryCount"),
        serverLastUpdate: document.getElementById("serverLastUpdate"),
        serverEntryCount: document.getElementById("serverEntryCount"),
        useLocalDataBtn: document.getElementById("useLocalDataBtn"),
        useServerDataBtn: document.getElementById("useServerDataBtn"),
    };
}

/************************************
 * LOCAL DATA MANAGEMENT
 ************************************/

/**
 * Fill in anything a stored or server copy predates, and put this device's own
 * preferences back on top. Every copy of the state passes through here — local load,
 * server download, imported file — so one place decides what a valid state looks like.
 */
function normalizeState(raw) {
    const notes = (raw && Array.isArray(raw.userNotes) ? raw.userNotes : [])
        .filter((n) => n && n.id)
        .map((n) => Object.assign({}, n, {
            // Tolerate older copies that stored ISO strings.
            createdAt: Number(new Date(n.createdAt || 0)) || 0,
            updatedAt: Number(new Date(n.updatedAt || n.createdAt || 0)) || 0,
        }));

    const prefs = Object.assign({}, defaultPreferences, (raw && raw.appPreferences) || {});
    // Device-only preferences never come from synced data: reset them, then overlay
    // whatever THIS device last used.
    DEVICE_PREFS.forEach((k) => { prefs[k] = defaultPreferences[k]; });
    try {
        const dev = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) || 'null');
        if (dev) DEVICE_PREFS.forEach((k) => { if (dev[k] != null) prefs[k] = dev[k]; });
    } catch (e) { /* a corrupt device blob is not worth failing over */ }

    return { userNotes: notes, appPreferences: prefs };
}

function loadLocalData() {
    syncLog("Loading local data...");
    let raw = null;
    try {
        raw = {
            userNotes: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}userNotes`) || "[]"),
            appPreferences: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}appPreferences`) || "{}"),
        };
    } catch (e) {
        console.error("Error loading local data:", e);
    }
    const state = normalizeState(raw);
    userNotes = state.userNotes;
    appPreferences = state.appPreferences;
}

function saveLocalData() {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}userNotes`, JSON.stringify(userNotes));
        localStorage.setItem(`${STORAGE_PREFIX}appPreferences`, JSON.stringify(appPreferences));
        // Device preferences live in their own blob so a phone and a PC do not fight
        // over view state through account sync.
        const dev = {};
        DEVICE_PREFS.forEach((k) => { dev[k] = appPreferences[k]; });
        localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify(dev));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}

/** Change the data, persist it, and let sync ship the difference. */
function updateData(mutate) {
    mutate();
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

        // This page keeps its state in two variables, so the adapter joins them into
        // one object for the server and splits it again on the way back.
        getState: () => ({ userNotes, appPreferences }),
        setState: (s) => {
            userNotes = s.userNotes;
            appPreferences = s.appPreferences;
            saveLocalData();
            updateDisplay();
        },

        // "Is this blob one of ours?" — guards against another app's data.
        accept: (raw) => !!raw && typeof raw === 'object'
            && ('userNotes' in raw || 'appPreferences' in raw),

        normalize: (raw) => normalizeState(raw),

        hasData: (s) => !!s && (s.userNotes || []).length > 0,

        // The operation log. This is the line that turns conflicts from the user's
        // problem into the engine's problem — see SYNC_COLLECTIONS above.
        collections: SYNC_COLLECTIONS,
        collectionLabels: COLLECTION_LABELS,

        // This page has no top-level field belonging to a single device. If it gains
        // one (which note is open, a scroll position), list it in `ignoreKeys` so it
        // neither travels nor forces an unnecessary whole-state save.

        // CUSTOMISE: the conflict fingerprint. Anything left OUT still syncs, it just
        // never asks the user about it — that is where view state belongs, so changing
        // a sort order or a chart range on your phone can never pop a prompt on your PC.
        canonical: (s) => getCanonicalString(s),

        // CUSTOMISE: union both copies, dropping duplicates. Only reached on the
        // no-base fallback path (a first sync, cleared storage), but where a page can
        // do this "merge both" is the resolution to recommend — it cannot lose a note.
        merge: (theirs, mine) => {
            const byId = new Map((theirs.userNotes || []).map((n) => [n.id, n]));
            (mine.userNotes || []).forEach((n) => byId.set(n.id, n));   // mine wins ties
            return {
                userNotes: Array.from(byId.values()),
                appPreferences: Object.assign({}, theirs.appPreferences, mine.appPreferences),
            };
        },

        onStatus: (status) => syncLog('sync status:', status),

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

        // The ONE thing sync will not decide by itself: a note deleted on one device
        // and edited on the other. Raised per note, AFTER the rest of the merge has
        // already been saved, so nothing is waiting on the answer.
        //
        // Answer with {[collision.key]: 'delete'} for the notes to remove. Anything
        // not named — a dismissal, a closed tab, a page with no UI for this — KEEPS
        // the note. A dismissal must never destroy.
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
 * View and appearance preferences are deliberately EXCLUDED — see VIEW_ONLY_PREFS.
 * They still sync; they just never make two copies count as different.
 */
function getCanonicalString(dataSet) {
    if (!dataSet) return null;

    const notes = (dataSet.userNotes || [])
        .map((n) => [n.id, n.title || '', n.body || ''].join('|'))
        .sort();

    const prefs = Object.keys(defaultPreferences)
        .filter((k) => VIEW_ONLY_PREFS.indexOf(k) === -1)
        .sort()
        .map((k) => {
            const v = (dataSet.appPreferences || {})[k];
            return k + '=' + JSON.stringify(v != null ? v : null);
        });

    return JSON.stringify({ notes, prefs });
}

/** CUSTOMISE: a one-line human description of a copy, for the conflict modal. */
function generateDataSummary(dataSet) {
    if (!dataSet) return { lastUpdate: null, entryCount: '0 notes' };
    const notes = dataSet.userNotes || [];
    const newest = notes.reduce((max, n) => Math.max(max, n.updatedAt || 0), 0);
    return {
        lastUpdate: newest ? new Date(newest) : null,
        entryCount: `${notes.length} note${notes.length === 1 ? '' : 's'}`,
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
    if (collection === 'userNotes') return item.title || item.body || `note ${item.id}`;
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

/** Calls back with 'mine', 'theirs' or 'merge'. */
function showSyncChoiceModal(localSummary, serverSummary, resolve) {
    const elements = getElements();
    const formatDate = (d) => (d ? d.toLocaleString() : 'No entries');

    elements.localLastUpdate.textContent = formatDate(localSummary.lastUpdate);
    elements.localEntryCount.textContent = localSummary.entryCount;
    elements.serverLastUpdate.textContent = formatDate(serverSummary.lastUpdate);
    elements.serverEntryCount.textContent = serverSummary.entryCount;

    // Clear old listeners by cloning.
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
    if (!authManager.isLoggedIn()) return 'none';
    const result = await syncClient.performSync();
    syncLog("Sync result:", result);
    updateDisplay();
    return result;
}


/*******************************
 * UI Update
 *******************************/
function updateDisplay() {
    // Render your experiment here.
    syncLog("UI updated. Notes:", userNotes.length);
}

function updateUIForLoginState() {
    const elements = getElements();
    if (!elements.loginButton) return;

    const isLoggedIn = authManager.isLoggedIn();
    const user = authManager.currentUser;

    elements.loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.registerButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';

    // The username is a DISPLAY LABEL only — changeable, and it may collide. The
    // identity is the UUID: authManager.userUuid() (the token's `sub`).
    elements.userStatus.textContent = isLoggedIn ? `Logged in: ${user?.username}` : 'Not logged in (Local)';
    elements.userStatus.style.color = isLoggedIn ? '#4bc0c0' : '#ccc';

    if (elements.changePasswordButton) {
        elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    }
}


/********************************
 * Helper Functions (File IO)
 ********************************/
function showSyncStatus(message, type = "info") {
    const el = getElements().syncStatus;
    if (el) {
        el.textContent = message;
        el.className = `sync-status-${type}`;
        setTimeout(() => { el.textContent = ''; el.className = ''; }, 5000);
    }
}

function exportDataToFile() {
    const dataToExport = { userNotes, appPreferences };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
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
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.userNotes)) {
                throw new Error("Invalid file format");
            }

            const incoming = normalizeState(parsed);

            // Say what it costs BEFORE doing it. diffSummary counts what the change
            // would add, remove and alter without applying anything — "this will
            // delete 84 notes" is the sentence that prevents the accident.
            const specs = SyncWip.normaliseCollections(SYNC_COLLECTIONS);
            const summary = SyncWip.diffSummary({ userNotes, appPreferences }, incoming, specs);
            const warning = summary.totals.removed
                ? `This will DELETE ${summary.totals.removed} entr${summary.totals.removed === 1 ? 'y' : 'ies'} not in the file. `
                : '';
            if (!confirm(`${warning}Import ${summary.totals.added} new and keep ${summary.totals.identical + summary.totals.changed}. Proceed?`)) return;

            userNotes = incoming.userNotes;
            appPreferences = incoming.appPreferences;
            saveLocalData();
            updateDisplay();
            showSyncStatus("Import successful!", "success");

            if (authManager.isLoggedIn()) {
                await syncClient.replaceAll({ userNotes, appPreferences }, {
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


/********************************
 * Event Listeners & Auth Hooks
 ********************************/
function setupEventListeners() {
    const elements = getElements();
    if (!elements.loginButton) return;

    // Button clicks
    elements.loginButton.addEventListener('click', () => elements.loginModal.style.display = 'block');
    elements.registerButton.addEventListener('click', () => elements.registerModal.style.display = 'block');
    elements.logoutButton.addEventListener('click', () => authManager.logout());

    // Auth forms. The password is never sent: auth-wip.js derives an authSecret from
    // it in this browser and sends that. It needs crypto.subtle, so the error you get
    // over plain http:// is about the page's URL, not the password.
    elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.loginError.textContent = '';
        try {
            await authManager.login(elements.loginUsername.value.trim(), elements.loginPassword.value);
            // 'auth:login' triggers the UI update and the sync
        } catch (err) {
            elements.loginError.textContent = err.message;
        }
    });

    elements.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.registerError.textContent = '';
        const user = elements.registerUsername.value.trim();
        const pass = elements.registerPassword.value;

        if (pass !== elements.registerConfirmPassword.value) {
            elements.registerError.textContent = 'Passwords do not match.';
            return;
        }

        try {
            // register(username, password, {email}) — email is optional, and an
            // account WITHOUT one has no recovery path. Show result.recoveryWarning at
            // signup rather than letting that be discovered after a forgotten password.
            const result = await authManager.register(user, pass);
            alert(result.recoveryWarning || "Registration successful! Please log in.");
            elements.registerModal.style.display = 'none';
            elements.loginModal.style.display = 'block';
            elements.loginUsername.value = user;
        } catch (err) {
            elements.registerError.textContent = err.message;
        }
    });

    // Password Change
    if (elements.changePasswordForm) {
        elements.changePasswordForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            elements.changePasswordError.textContent = '';
            elements.changePasswordSuccess.textContent = '';

            if (elements.newPassword.value !== elements.confirmNewPassword.value) {
                elements.changePasswordError.textContent = "New passwords do not match.";
                return;
            }
            try {
                await authManager.changePassword(elements.currentPassword.value, elements.newPassword.value);
                // 'auth:password-changed' handles cleanup
            } catch (err) {
                elements.changePasswordError.textContent = err.message;
            }
        });
    }

    // Modal Toggles
    elements.settingsButton.addEventListener("click", () => {
        if (elements.changePasswordButton) {
            elements.changePasswordButton.style.display = authManager.isLoggedIn() ? 'inline-block' : 'none';
        }
        elements.settingsModal.style.display = "block";
    });

    if (elements.changePasswordButton) {
        elements.changePasswordButton.addEventListener('click', () => elements.changePasswordModal.style.display = 'block');
    }

    // Sync
    elements.localSyncButton.addEventListener('click', () => elements.syncModal.style.display = 'block');
    elements.exportDataButton.addEventListener('click', exportDataToFile);
    elements.importDataInput.addEventListener('change', importDataFromFile);

    // Close Modals. The two sync modals are excluded: both answer a promise, and a
    // backdrop click would leave that promise unresolved.
    document.body.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal || modal.id === 'syncChoiceModal' || modal.id === 'itemConflictModal') return;
        const isClose = e.target.matches('.close-modal, .close-auth-modal, .close-sync-modal, .close-modal-button, .close-auth-modal-button, .close-sync-modal-button');
        if (isClose || e.target === modal) modal.style.display = 'none';
    });
}

// --- AUTHMANAGER EVENT HOOKS ---
window.addEventListener('auth:login', async () => {
    syncLog("Event: Login");
    getElements().loginModal.style.display = 'none';
    updateUIForLoginState();
    await performDataSync();
});

window.addEventListener('auth:logout', () => {
    syncLog("Event: Logout");
    updateUIForLoginState();
    updateDisplay(); // clear sensitive data from the UI if needed
});

window.addEventListener('auth:session-restored', async () => {
    syncLog("Event: Session Restored");
    updateUIForLoginState();
    await performDataSync();
});

window.addEventListener('auth:password-changed', (e) => {
    getElements().changePasswordSuccess.textContent = e.detail.message;
    setTimeout(() => authManager.logout("Password changed. Please log in again."), 2000);
});


/**********************
 * Initial Page Load
 **********************/
document.addEventListener("DOMContentLoaded", async () => {
    loadLocalData();     // the page works fully logged out
    initSync();          // shared sync client (needs auth + the data model)
    setupEventListeners();

    // Restores a session if there is one, which fires auth:session-restored and runs
    // the first sync.
    await authManager.initialize();

    updateUIForLoginState();
    updateDisplay();
});
