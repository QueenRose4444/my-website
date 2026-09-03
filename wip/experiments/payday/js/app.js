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
const APP_NAME = 'payday';

// 'live' or 'wip'. Picks which backend AuthManagerWip talks to AND namespaces every
// local key, so a wip page can never scribble over live data.
const ENVIRONMENT = 'wip';

const LOGGING_ENABLED = ENVIRONMENT === 'wip';
function syncLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[PAYDAY]', ...args);
    }
}

/*************************************
 * APPLICATION DATA MODEL
 *************************************
 * Every item carries a stable `id` and an `updatedAt`. Both are required for sync
 * to ship CHANGES rather than the whole blob — no id, no operations.
 *
 * MONEY IS INTEGER CENTS. Never a float. `0.1 + 0.2 !== 0.3`, and this page sums
 * dozens of prices; a float error stays invisible until a total is off by a cent
 * and nobody can explain it. Every money field ends `Cents` so the unit cannot be
 * forgotten. Convert only at display.
 *
 * Times are epoch milliseconds, NOT Date objects — state travels through JSON and a
 * Date silently becomes a string on the way, so two copies stop comparing equal.
 * DATES (a purchase date, a pay date) are plain 'YYYY-MM-DD' strings instead,
 * because cadence arithmetic must happen in local civil time.
 *************************************/
let wishlist = [];      // [{id, name, url, priceCents, ..., posNum, posDen, updatedAt}]
let categories = [];    // [{id, name}]
let income = [];        // [{id, label, netPerPayCents, cadence, anchorDate, active}]
let recurring = [];     // [{id, name, amountCents, cadence, anchorDate, essential, endsOn, history}]
// Imported statement rows, ALREADY SANITISED — see statements.js.
// The raw description never reaches this array: only a canonical merchant name and a
// one-way hash of the original line, which exists solely to spot re-imports.
let transactions = [];  // [{id, date, amountCents, merchant, categoryId, batchId, dedupe, updatedAt}]
let batches = [];       // [{id, at, source, format, count, from, to}] — so an import is undoable
let settings = {};

const defaultSettings = {
    // data
    currency: 'AUD',
    // What is in the account right now. The projection starts from this; without
    // it every date is measured from zero and reads as pessimistic.
    startBalanceCents: 0,
    spendLog: [],           // [{at, amountCents, why}] — unplanned spends, for the record
    // Per-user random salt for the transaction dedupe hash. Synced, because
    // the same transaction must hash identically on every device. Without a salt a
    // rainbow table over common merchant strings would reverse every hash, which
    // would defeat the point of not storing the raw description.
    dedupeSalt: '',
    // view state: synced, but must never count as a data change
    sortBy: 'manual',
    // per device
    view: 'cards',      // 'cards' | 'table'
    lastView: 'overview',   // which of the three tabs was open
};

// Settings that belong to THIS DEVICE. They generate no sync operation and none is
// ever applied to them, so switching to table view on your phone is not news for
// your PC.
const DEVICE_PREFS = ['view', 'lastView'];

// The above PLUS settings that do sync but must never register as a data change.
// Only this second list is used by getCanonicalString().
const VIEW_ONLY_PREFS = DEVICE_PREFS.concat(['sortBy']);

// Storage keys (the environment is in the prefix so wip and live never collide).
const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;
const DEVICE_STORAGE_KEY = `${STORAGE_PREFIX}device`;

// What the sync engine treats as items. Declaring these is what turns saves into
// add/edit/delete OPERATIONS instead of whole-blob overwrites — without them you
// lose per-item merge, the containment catch-up and the bulk-delete guards.
const SYNC_COLLECTIONS = [
    { name: 'wishlist', identity: (i) => i.id, timestamp: (i) => i.updatedAt },
    { name: 'categories', identity: (c) => c.id },
    { name: 'income', identity: (i) => i.id, timestamp: (i) => i.updatedAt },
    { name: 'recurring', identity: (r) => r.id, timestamp: (r) => r.updatedAt },
    // Transactions are append-mostly and can run to thousands of rows. Declaring them
    // as a collection is what keeps a save shipping the new batch rather than the
    // whole ledger every time.
    { name: 'transactions', identity: (t) => t.id, timestamp: (t) => t.updatedAt },
    { name: 'batches', identity: (b) => b.id },
    { name: 'settings', kind: 'map', ignore: DEVICE_PREFS },
];

const COLLECTION_LABELS = {
    wishlist: 'items',
    categories: 'categories',
    income: 'income sources',
    recurring: 'subscriptions',
    transactions: 'transactions',
    batches: 'imports',
    settings: 'settings',
};

/*************************************
 * STATUSES
 *************************************/
const STATUSES = [
    { id: 'wanted',  label: 'Wanted' },
    { id: 'saving',  label: 'Saving for' },
    { id: 'ordered', label: 'Ordered' },
    { id: 'bought',  label: 'Bought' },
    // `parked` exists so an item can be kept and costed WITHOUT blocking the queue.
    // Without it the only way to stop something blocking is to delete it.
    { id: 'parked',  label: 'Parked' },
    { id: 'dropped', label: 'Dropped' },
];

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
    const cats = (raw && Array.isArray(raw.categories) ? raw.categories : [])
        .filter((c) => c && c.id)
        .map((c) => ({ id: c.id, name: String(c.name || 'Untitled') }));

    let items = (raw && Array.isArray(raw.wishlist) ? raw.wishlist : [])
        .filter((i) => i && i.id)
        .map((i) => ({
            id: i.id,
            name: String(i.name || ''),
            url: i.url || '',
            imageUrl: i.imageUrl || '',
            // Money is integer cents. Coerce defensively: a copy written by an older
            // build, or hand-edited, must not put a float into the ledger.
            priceCents: Math.round(Number(i.priceCents) || 0),
            targetPriceCents: i.targetPriceCents == null ? null : Math.round(Number(i.targetPriceCents) || 0),
            usedPriceCents: i.usedPriceCents == null ? null : Math.round(Number(i.usedPriceCents) || 0),
            cur: i.cur || 'AUD',
            priceSource: i.priceSource || 'manual',
            priceCheckedAt: Number(i.priceCheckedAt) || null,
            categoryId: i.categoryId || null,
            status: STATUSES.some((st) => st.id === i.status) ? i.status : 'wanted',
            workUsePct: Math.max(0, Math.min(100, Math.round(Number(i.workUsePct) || 0))),
            notes: i.notes || '',
            why: i.why || '',
            dependsOn: Array.isArray(i.dependsOn) ? i.dependsOn.filter((d) => d !== i.id) : [],
            allocatedCents: Math.round(Number(i.allocatedCents) || 0),
            // Manual order as a RATIONAL, not a float — see Money.js. Anything without
            // a position goes to the end rather than silently to the front.
            posNum: Number.isFinite(Number(i.posNum)) ? Number(i.posNum) : null,
            posDen: Number(i.posDen) > 0 ? Number(i.posDen) : 1,
            createdAt: Number(new Date(i.createdAt || 0)) || 0,
            updatedAt: Number(new Date(i.updatedAt || i.createdAt || 0)) || 0,
        }));

    // Backfill any missing positions at the end, preserving existing order.
    let nextPos = items.reduce((m, i) => Math.max(m, i.posNum == null ? 0 : i.posNum / i.posDen), 0);
    items.forEach((i) => { if (i.posNum == null) { i.posNum = ++nextPos; i.posDen = 1; } });

    const CADENCES = ['weekly', 'fortnightly', 'four_weekly', 'monthly', 'quarterly', 'annual'];
    const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);

    const inc = (raw && Array.isArray(raw.income) ? raw.income : [])
        .filter((i) => i && i.id)
        .map((i) => ({
            id: i.id,
            label: String(i.label || 'Pay'),
            // NET, not gross. Tax is handled last, so the
            // timeline must work from the take-home figure the user types. When the
            // tax module lands it OFFERS to derive this from gross; it never requires it.
            netPerPayCents: Math.round(Number(i.netPerPayCents) || 0),
            cadence: CADENCES.indexOf(i.cadence) >= 0 ? i.cadence : 'fortnightly',
            anchorDate: isDate(i.anchorDate) ? i.anchorDate : null,
            active: i.active !== false,
            updatedAt: Number(i.updatedAt) || 0,
        }))
        .filter((i) => i.anchorDate);

    const rec = (raw && Array.isArray(raw.recurring) ? raw.recurring : [])
        .filter((r) => r && r.id)
        .map((r) => ({
            id: r.id,
            name: String(r.name || 'Cost'),
            amountCents: Math.round(Number(r.amountCents) || 0),
            cadence: CADENCES.indexOf(r.cadence) >= 0 ? r.cadence : 'monthly',
            anchorDate: isDate(r.anchorDate) ? r.anchorDate : null,
            categoryId: r.categoryId || null,
            essential: !!r.essential,
            // A what-if cost is NOT taken out of the money. It exists only so payday
            // can show what adding it WOULD do — see the What-if panel.
            whatIf: !!r.whatIf,
            workUsePct: Math.max(0, Math.min(100, Math.round(Number(r.workUsePct) || 0))),
            endsOn: isDate(r.endsOn) ? r.endsOn : null,
            history: Array.isArray(r.history) ? r.history.filter((h) => h && isDate(h.fromDate)) : [],
            active: r.active !== false,
            updatedAt: Number(r.updatedAt) || 0,
        }))
        .filter((r) => r.anchorDate);

    // Statement rows. Anything without a valid date or a finite amount is dropped
    // rather than repaired — a transaction with a guessed date is worse than none at
    // all, because it silently moves money into the wrong month.
    const txns = (raw && Array.isArray(raw.transactions) ? raw.transactions : [])
        .filter((t) => t && t.id && isDate(t.date) && Number.isFinite(Number(t.amountCents)))
        .map((t) => ({
            id: t.id,
            date: t.date,
            // Negative is money out, positive is money in. The sign convention is
            // normalised at import so nothing downstream needs to know which bank
            // the file came from.
            amountCents: Math.round(Number(t.amountCents)),
            merchant: String(t.merchant || 'Unknown'),
            categoryId: t.categoryId || null,
            batchId: t.batchId || null,
            // A hash of the ORIGINAL line. Not reversible, never displayed.
            dedupe: String(t.dedupe || ''),
            note: t.note || '',
            updatedAt: Number(t.updatedAt) || 0,
        }));

    const bats = (raw && Array.isArray(raw.batches) ? raw.batches : [])
        .filter((b) => b && b.id)
        .map((b) => ({
            id: b.id,
            at: Number(b.at) || 0,
            source: String(b.source || 'file'),
            format: String(b.format || 'csv'),
            count: Math.max(0, Math.round(Number(b.count) || 0)),
            from: isDate(b.from) ? b.from : null,
            to: isDate(b.to) ? b.to : null,
        }));

    const st = Object.assign({}, defaultSettings, (raw && raw.settings) || {});
    DEVICE_PREFS.forEach((k) => { st[k] = defaultSettings[k]; });
    try {
        const dev = JSON.parse(localStorage.getItem(DEVICE_STORAGE_KEY) || 'null');
        if (dev) DEVICE_PREFS.forEach((k) => { if (dev[k] != null) st[k] = dev[k]; });
    } catch (e) { /* a corrupt device blob is not worth failing over */ }

    return { wishlist: items, categories: cats, income: inc, recurring: rec,
             transactions: txns, batches: bats, settings: st };
}

function loadLocalData() {
    syncLog("Loading local data...");
    let raw = null;
    try {
        raw = {
            wishlist: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}wishlist`) || "[]"),
            categories: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}categories`) || "[]"),
            income: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}income`) || "[]"),
            recurring: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}recurring`) || "[]"),
            transactions: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}transactions`) || "[]"),
            batches: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}batches`) || "[]"),
            settings: JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}settings`) || "{}"),
        };
    } catch (e) {
        console.error("Error loading local data:", e);
    }
    const state = normalizeState(raw);
    wishlist = state.wishlist;
    categories = state.categories;
    income = state.income;
    recurring = state.recurring;
    transactions = state.transactions;
    batches = state.batches;
    settings = state.settings;
}

function saveLocalData() {
    try {
        localStorage.setItem(`${STORAGE_PREFIX}wishlist`, JSON.stringify(wishlist));
        localStorage.setItem(`${STORAGE_PREFIX}categories`, JSON.stringify(categories));
        localStorage.setItem(`${STORAGE_PREFIX}income`, JSON.stringify(income));
        localStorage.setItem(`${STORAGE_PREFIX}recurring`, JSON.stringify(recurring));
        localStorage.setItem(`${STORAGE_PREFIX}transactions`, JSON.stringify(transactions));
        localStorage.setItem(`${STORAGE_PREFIX}batches`, JSON.stringify(batches));
        localStorage.setItem(`${STORAGE_PREFIX}settings`, JSON.stringify(settings));
        const dev = {};
        DEVICE_PREFS.forEach((k) => { dev[k] = settings[k]; });
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
        getState: () => ({ wishlist, categories, income, recurring, transactions, batches, settings }),
        setState: (s) => {
            wishlist = s.wishlist;
            categories = s.categories;
            income = s.income;
            recurring = s.recurring;
            transactions = s.transactions;
            batches = s.batches;
            settings = s.settings;
            saveLocalData();
            updateDisplay();
        },

        // "Is this blob one of ours?" — guards against another app's data.
        accept: (raw) => !!raw && typeof raw === 'object'
            && ('wishlist' in raw || 'categories' in raw),

        normalize: (raw) => normalizeState(raw),

        hasData: (s) => !!s && ((s.wishlist || []).length > 0 || (s.categories || []).length > 0),

        // The operation log. This is the line that turns conflicts from the user's
        // problem into the engine's problem — see SYNC_COLLECTIONS above.
        collections: SYNC_COLLECTIONS,
        collectionLabels: COLLECTION_LABELS,

        // This page has no top-level field belonging to a single device. If it gains
        // one (which item is open, a scroll position), list it in `ignoreKeys` so it
        // neither travels nor forces an unnecessary whole-state save.

        // CUSTOMISE: the conflict fingerprint. Anything left OUT still syncs, it just
        // never asks the user about it — that is where view state belongs, so changing
        // a sort order or a chart range on your phone can never pop a prompt on your PC.
        canonical: (s) => getCanonicalString(s),

        // CUSTOMISE: union both copies, dropping duplicates. Only reached on the
        // no-base fallback path (a first sync, cleared storage), but where a page can
        // do this "merge both" is the resolution to recommend — it cannot lose an item.
        merge: (theirs, mine) => {
            const byId = new Map((theirs.wishlist || []).map((i) => [i.id, i]));
            (mine.wishlist || []).forEach((i) => byId.set(i.id, i));   // mine wins ties
            const catById = new Map((theirs.categories || []).map((c) => [c.id, c]));
            (mine.categories || []).forEach((c) => catById.set(c.id, c));
            return {
                wishlist: Array.from(byId.values()),
                categories: Array.from(catById.values()),
                settings: Object.assign({}, theirs.settings, mine.settings),
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

        // The ONE thing sync will not decide by itself: an item deleted on one device
        // and edited on the other. Raised per item, AFTER the rest of the merge has
        // already been saved, so nothing is waiting on the answer.
        //
        // Answer with {[collision.key]: 'delete'} for the items to remove. Anything
        // not named — a dismissal, a closed tab, a page with no UI for this — KEEPS
        // the item. A dismissal must never destroy.
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

    // Position is deliberately EXCLUDED. Reordering is a real change that syncs, but
    // it must not make two copies read as a data conflict — otherwise every drag
    // raises a prompt.
    const items = (dataSet.wishlist || [])
        .map((i) => [i.id, i.name || '', i.priceCents || 0, i.status || '', i.categoryId || ''].join('|'))
        .sort();

    const cats = (dataSet.categories || []).map((c) => `${c.id}|${c.name}`).sort();

    const st = Object.keys(defaultSettings)
        .filter((k) => VIEW_ONLY_PREFS.indexOf(k) === -1)
        .sort()
        .map((k) => {
            const v = (dataSet.settings || {})[k];
            return k + '=' + JSON.stringify(v != null ? v : null);
        });

    return JSON.stringify({ items, cats, st });
}

/** CUSTOMISE: a one-line human description of a copy, for the conflict modal. */
function generateDataSummary(dataSet) {
    if (!dataSet) return { lastUpdate: null, entryCount: '0 items' };
    const items = dataSet.wishlist || [];
    const newest = items.reduce((max, i) => Math.max(max, i.updatedAt || 0), 0);
    const total = items.reduce((sum, i) => sum + (i.priceCents || 0), 0);
    return {
        lastUpdate: newest ? new Date(newest) : null,
        entryCount: `${items.length} item${items.length === 1 ? '' : 's'}, ${Money.format(total)}`,
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
    if (collection === 'wishlist') return item.name || `item ${item.id}`;
    if (collection === 'categories') return item.name || `category ${item.id}`;
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
    // Wishlist owns its own rendering; app.js owns auth, sync and the modals.
    if (window.Wishlist) window.Wishlist.render();
    if (window.Budget) window.Budget.render();
    if (window.Views) window.Views.render();
    if (window.Spending) window.Spending.render();
    syncLog("UI updated. Items:", wishlist.length);
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
    // A token, not a hex. The template's hard-coded #4bc0c0/#ccc survive a theme
    // change and go muddy against the light background.
    elements.userStatus.classList.toggle('is-live', isLoggedIn);

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
    const dataToExport = { wishlist, categories, income, recurring, settings };
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
            if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.wishlist)) {
                throw new Error("Invalid file format");
            }

            const incoming = normalizeState(parsed);

            // Say what it costs BEFORE doing it. diffSummary counts what the change
            // would add, remove and alter without applying anything — "this will
            // delete 84 notes" is the sentence that prevents the accident.
            const specs = SyncWip.normaliseCollections(SYNC_COLLECTIONS);
            const summary = SyncWip.diffSummary({ wishlist, categories, income, recurring, settings }, incoming, specs);
            const warning = summary.totals.removed
                ? `This will DELETE ${summary.totals.removed} entr${summary.totals.removed === 1 ? 'y' : 'ies'} not in the file. `
                : '';
            const proceed = await UI.confirm({
                title: 'Import this file?',
                body: `${warning}It adds ${summary.totals.added} new and keeps ${summary.totals.identical + summary.totals.changed}.`,
                okLabel: 'Import', danger: !!warning,
            });
            if (!proceed) return;

            wishlist = incoming.wishlist;
            categories = incoming.categories;
            income = incoming.income;
            recurring = incoming.recurring;
            settings = incoming.settings;
            saveLocalData();
            updateDisplay();
            showSyncStatus("Import successful!", "success");

            if (authManager.isLoggedIn()) {
                await syncClient.replaceAll({ wishlist, categories, income, recurring, settings }, {
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
                await UI.confirm({
                    title: 'Account created',
                    body: result.recoveryWarning || 'You can log in now.',
                    okLabel: 'Got it', cancelLabel: '',
                });
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
