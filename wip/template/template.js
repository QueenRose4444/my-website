// template.js - Complete example showing auth and sync patterns

/*************************************
 * APPLICATION CONFIGURATION
 *************************************/
const APP_NAME = 'template-app';  // CHANGE THIS for each new app
const ENVIRONMENT = 'wip';         // 'live' or 'wip'

// Logging helper
const LOGGING_ENABLED = ENVIRONMENT === 'wip';
function appLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[APP_LOG]', ...args);
    }
}

/*************************************
 * APPLICATION DATA MODEL
 *************************************/
// Define your app's data structure here
// This is what gets saved locally and synced to the server
const DEFAULT_DATA = {
    // Example: Simple counter and list
    counter: 0,
    items: [],
    settings: {
        exampleSetting: 'default'
    }
};

let appData = JSON.parse(JSON.stringify(DEFAULT_DATA));

// Storage key for local data (includes environment)
const LOCAL_STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_data`;

/*************************************
 * AUTHENTICATION SETUP
 *************************************/
const authManager = new AuthManagerWip(APP_NAME, ENVIRONMENT);
// the shared sync client is created once the data model exists (see initSync)

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
function loadLocalData() {
    appLog("Loading local data from localStorage...");
    try {
        const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            // Merge with defaults to handle schema changes
            appData = { ...appData, ...parsed };
            appLog("Local data loaded:", appData);
        }
    } catch (e) {
        console.error("Error loading local data:", e);
    }
}

function saveLocalData() {
    appLog("Saving local data to localStorage...");
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(appData));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}

/************************************
 * SERVER DATA SYNC  (via /sync-wip.js)
 ************************************
 * The shared module owns the transport, the debounce, the version check and the
 * three-way conflict resolution. This page only says what its data looks like:
 * how to read/write it, what counts as a real difference, and how two copies
 * merge. Copy this block into a new page and change those four functions.
 ************************************/

let syncClient = null;

function initSync() {
    syncClient = new SyncWip.SyncClient({
        auth: authManager,
        appName: APP_NAME,

        getState: () => appData,
        setState: (s) => { appData = s; saveLocalData(); updateDisplay(); },

        // "Is this blob one of ours?" — guards against another app's data.
        accept: (raw) => !!raw && typeof raw === 'object' && 'items' in raw,

        // Fill in defaults the server copy predates.
        normalize: (raw) => Object.assign({}, DEFAULT_DATA, raw, {
            settings: Object.assign({}, DEFAULT_DATA.settings, raw.settings || {}),
        }),

        hasData: (s) => !!s && ((s.items && s.items.length > 0) || s.counter > 0),

        // CUSTOMISE: the conflict fingerprint. Anything left OUT of this string
        // still syncs, it just never asks the user about it — that is where
        // view/appearance preferences belong, so flipping a setting on your phone
        // does not pop a conflict prompt on your PC.
        canonical: (s) => getCanonicalString(s),

        // CUSTOMISE: union both copies, dropping duplicates. Where a page can do
        // this, "merge both" is the resolution to recommend — it is the only one
        // that cannot lose a record.
        merge: (theirs, mine) => {
            const seen = new Set((mine.items || []).map(x => JSON.stringify(x)));
            const items = (mine.items || []).concat(
                (theirs.items || []).filter(x => !seen.has(JSON.stringify(x))));
            return Object.assign({}, theirs, mine, {
                items: items,
                counter: Math.max(mine.counter || 0, theirs.counter || 0),
            });
        },

        onStatus: (status) => appLog('sync status:', status),

        // This page has its own comparison modal, so use it instead of the
        // built-in prompt. Resolve with 'mine' | 'theirs' | 'merge'.
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
    if (out === 'error' || out === null) return null;
    return out.state;
}

async function saveBackendData() {
    return syncClient.flush();
}

/** Queue a save; repeated calls collapse into one request. */
function scheduleBackendSave() {
    syncClient.scheduleSave();
}

/************************************
 * DATA COMPARISON & SYNC LOGIC
 ************************************/
/**
 * Creates a canonical string representation of data for comparison.
 * Customize this based on your app's data structure.
 *
 * Leave view/appearance state OUT — see the note on `canonical` above.
 */
function getCanonicalString(data) {
    if (!data) return null;
    const items = (data.items || []).map(x => JSON.stringify(x)).sort();
    return JSON.stringify({ items: items, counter: data.counter || 0, settings: data.settings || {} });
}

/**
 * Generates a human-readable summary of the data.
 * Customize this based on what's meaningful for your app.
 */
function generateDataSummary(data) {
    if (!data) {
        return { lastUpdate: 'N/A', summary: 'No data' };
    }
    const itemCount = data.items ? data.items.length : 0;
    const counter = data.counter || 0;
    return {
        lastUpdate: 'N/A', // Add timestamp to your data model if needed
        summary: `Counter: ${counter}, Items: ${itemCount}`,
    };
}

/**
 * Shows the sync choice modal when local and server data differ.
 * Calls back with 'mine', 'theirs' or 'merge'.
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

    document.getElementById('useLocalDataBtn').addEventListener('click', () => finish('mine'));
    document.getElementById('useServerDataBtn').addEventListener('click', () => finish('theirs'));

    // "Merge both" is added dynamically so the template's HTML does not have to
    // change; move it into the markup if you want it styled with the others.
    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.id = 'mergeDataBtn';
    mergeBtn.textContent = 'Merge both (recommended)';
    mergeBtn.addEventListener('click', () => finish('merge'));
    const existing = document.getElementById('mergeDataBtn');
    if (existing) existing.remove();
    document.getElementById('useServerDataBtn').insertAdjacentElement('afterend', mergeBtn);

    elements.syncChoiceModal.style.display = 'block';
}

/**
 * Main sync logic — runs after login / session restore.
 * Returns 'in-sync' | 'downloaded' | 'uploaded' | 'conflict' | 'none'.
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
    appLog("Updating UI...");
    // Update your app-specific UI here
    // Example: Display counter and items
    console.log("Current app data:", appData);
}

/************************************
 * AUTH EVENT HANDLERS
 ************************************/
// Listen for auth events from AuthManagerWip
window.addEventListener('auth:login', async (e) => {
    appLog("Login event received:", e.detail.user);
    updateUIForLoginState();
    getElements().loginModal.style.display = 'none';
    
    // Perform data sync after login
    await performDataSync();
});

window.addEventListener('auth:logout', (e) => {
    appLog("Logout event received:", e.detail);
    if (e.detail.message) {
        alert(e.detail.message);
    }
    updateUIForLoginState();
    updateDisplay();
});

window.addEventListener('auth:session-restored', async (e) => {
    appLog("Session restored:", e.detail.user);
    updateUIForLoginState();
    
    // Auto-sync when session is restored
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
    
    // Log out after password change
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

    const username = elements.loginUsername.value.trim();
    const password = elements.loginPassword.value;

    try {
        await authManager.login(username, password);
        // The auth:login event will handle the rest
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
        await authManager.register(username, password);
        
        alert("Registration successful! Please log in.");
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

    const currentPassword = elements.currentPassword.value;
    const newPassword = elements.newPassword.value;

    if (newPassword !== elements.confirmNewPassword.value) {
        elements.changePasswordError.textContent = 'New passwords do not match.';
        return;
    }

    try {
        await authManager.changePassword(currentPassword, newPassword);
        // The auth:password-changed event will handle the rest
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
        setTimeout(() => {
            el.textContent = '';
            el.className = '';
        }, 5000);
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

function importDataFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            
            if (confirm("Import will overwrite current data in this browser. Proceed?")) {
                // Validate data structure (customize based on your app)
                if (typeof data !== 'object') {
                    throw new Error("Invalid file format");
                }

                appData = data;
                saveLocalData();
                updateDisplay();
                showSyncStatus("Import successful!", "success");

                if (authManager.isLoggedIn() && 
                    confirm("Save imported data to your account? This will overwrite your server data.")) {
                    await saveBackendData();
                }
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

    // Auth button handlers
    elements.loginButton.addEventListener('click', () => {
        elements.loginModal.style.display = 'block';
    });

    elements.registerButton.addEventListener('click', () => {
        elements.registerModal.style.display = 'block';
    });

    elements.logoutButton.addEventListener('click', () => {
        authManager.logout();
    });

    // Form submissions
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    
    if (elements.changePasswordForm) {
        elements.changePasswordForm.addEventListener('submit', handleChangePassword);
    }

    // Settings and sync
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

    // Modal close handlers
    document.body.addEventListener('click', function(e) {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal || modal.id === 'syncChoiceModal') return;

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

    // 1. Load local data first
    loadLocalData();

    // 1b. Create the shared sync client (needs auth + the data model)
    initSync();

    // 2. Set up event listeners
    setupEventListeners();

    // 3. Initialize authentication (will restore session if available)
    await authManager.initialize();

    // 4. Update UI based on final state
    updateUIForLoginState();
    updateDisplay();

    appLog("Application initialized.");
});