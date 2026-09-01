// site_notifier.js - Handles login and managing site monitors via the backend API.
// UPDATED: Now uses the global AuthManagerWip for cross-tab login syncing.

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
const APP_NAME = 'site_notifier';
const ENVIRONMENT = 'wip'; // 'live' or 'wip'

const envConfigs = {
    live: {
        notifierBackendUrl: 'https://disc_notifier.rosestuffs.org'
    },
    wip: {
        notifierBackendUrl: 'https://disc_notifier.rosestuffs.org'
    }
};

const activeConfig = envConfigs[ENVIRONMENT];

/*************************************
 * CONSTANTS
 *************************************/
const NOTIFIER_BACKEND_URL = activeConfig.notifierBackendUrl;

// Notifier endpoints
const MONITORS_ENDPOINT = `${NOTIFIER_BACKEND_URL}/api/monitors`;

/*************************************
 * Global State
 *************************************/
// monitoredSites belong to the notifier's OWN backend (its own database, its own
// endpoints above) and are never touched by account sync. discordUsers are this
// account's saved Discord recipients — a small list, so they live in the shared
// save-file tier: localStorage here, /api/data/<APP_NAME> on the account.
let monitoredSites = [];
let discordUsers = [];
let countdownIntervals = {};
let autoRefreshInterval = null;
let pendingCookieFile = null; // Stores the cookie file for new monitors

// The environment is in the prefix so wip and live can never collide.
const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;
const DISCORD_USERS_KEY = `${STORAGE_PREFIX}discordUsers`;

// --- Auth State (via AuthManagerWip) ---
let authManager = null; // Will be initialized in DOMContentLoaded

// --- Account sync (via /sync-wip.js) --- created in DOMContentLoaded, see initSync()
let syncClient = null;

// What the sync engine treats as items. /sync-wip.js knows nothing about Discord
// users — it is told which field is a collection and how to identify an entry.
// The Discord snowflake IS the identity, and the page already refuses duplicates.
// There is no clock on a recipient, so `timestamp` is omitted.
const SYNC_COLLECTIONS = [
    { name: 'discordUsers', identity: (u) => u.id },
];

const COLLECTION_LABELS = {
    discordUsers: 'Discord recipients',
};

/***********************
 * DOM Element References
 ***********************/
function getElements() {
    return {
        // Auth & Sync elements
        settingsButton: document.getElementById("settingsButton"),
        localSyncButton: document.getElementById("localSyncButton"),
        settingsModal: document.getElementById("settingsModal"),
        loginModal: document.getElementById("loginModal"),
        registerModal: document.getElementById("registerModal"),
        changePasswordModal: document.getElementById("changePasswordModal"),
        syncModal: document.getElementById("syncModal"),
        loginButton: document.getElementById("loginButton"),
        registerButton: document.getElementById("registerButton"),
        logoutButton: document.getElementById("logoutButton"),
        userStatus: document.getElementById("userStatus"),
        loginForm: document.getElementById("loginForm"),
        registerForm: document.getElementById("registerForm"),
        loginError: document.getElementById("loginError"),
        registerError: document.getElementById("registerError"),
        changePasswordButton: document.getElementById("changePasswordButton"),
        exportDataButton: document.getElementById("exportData"),
        
        // App-specific elements
        addMonitorForm: document.getElementById('addMonitorForm'),
        monitorUrlInput: document.getElementById('monitorUrl'),
        pathTypeSelect: document.getElementById('pathType'),
        monitorPathInput: document.getElementById('monitorPath'),
        monitorMessageInput: document.getElementById('monitorMessage'),
        monitorFrequencySelect: document.getElementById('monitorFrequencySelect'),
        customFrequencyGroup: document.getElementById('customFrequencyGroup'),
        customMonitorFrequencyInput: document.getElementById('customMonitorFrequency'),
        discordUserIdSelect: document.getElementById('discordUserIdSelect'),
        loadImagesCheckbox: document.getElementById('loadImagesCheckbox'),
        addMonitorError: document.getElementById('addMonitorError'),
        monitorsList: document.getElementById('monitorsList'),

        // Cookie elements (add form)
        cookieDropZone: document.getElementById('cookieDropZone'),
        cookieFileInput: document.getElementById('cookieFileInput'),
        cookieFileName: document.getElementById('cookieFileName'),

        // Edit Modal Elements
        editModal: document.getElementById('editModal'),
        editMonitorForm: document.getElementById('editMonitorForm'),
        editMonitorIdInput: document.getElementById('editMonitorId'),
        editMonitorUrlInput: document.getElementById('editMonitorUrl'),
        editMonitorMessageInput: document.getElementById('editMonitorMessage'),
        editMonitorFrequencyInput: document.getElementById('editMonitorFrequency'),
        editLoadImagesCheckbox: document.getElementById('editLoadImagesCheckbox'),
        editMonitorError: document.getElementById('editMonitorError'),

        // Cookie Modal Elements
        cookiesModal: document.getElementById('cookiesModal'),
        cookieModalMonitorId: document.getElementById('cookieModalMonitorId'),
        cookieModalUrl: document.getElementById('cookieModalUrl'),
        cookieStatus: document.getElementById('cookieStatus'),
        cookieModalDropZone: document.getElementById('cookieModalDropZone'),
        cookieModalFileInput: document.getElementById('cookieModalFileInput'),
        cookieModalFileName: document.getElementById('cookieModalFileName'),
        deleteCookiesBtn: document.getElementById('deleteCookiesBtn'),
        cookieModalError: document.getElementById('cookieModalError'),

        // Discord User Modal Elements
        discordUsersModal: document.getElementById('discordUsersModal'),
        manageDiscordUsersBtn: document.getElementById('manageDiscordUsersBtn'),
        discordUsersList: document.getElementById('discordUsersList'),
        addDiscordUserForm: document.getElementById('addDiscordUserForm'),
        discordUserLabelInput: document.getElementById('discordUserLabel'),
        discordUserIdInput: document.getElementById('discordUserId'),
        discordUserError: document.getElementById('discordUserError'),
    };
}

/************************************
 * Auth Wrapper (uses global AuthManagerWip)
 ************************************/
// Helper to access AuthManagerWip's fetchWithAuth for authenticated requests
async function fetchWithAuth(url, options = {}) {
    if (!authManager) throw new Error("AuthManagerWip not initialized");
    return authManager.fetchWithAuth(url, options);
}

/*******************************
 * Cookie Upload Handlers
 *******************************/
function setupCookieDropZone(dropZone, fileInput, fileNameDisplay, onFileSelected) {
    // Click to browse
    dropZone.addEventListener('click', () => fileInput.click());
    
    // Drag and drop handlers
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });
    
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            if (file.name.endsWith('.txt')) {
                fileInput.files = files;
                onFileSelected(file);
            } else {
                alert('Please upload a .txt file');
            }
        }
    });
    
    // File input change handler
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            onFileSelected(file);
        }
    });
}

function displayCookieFileName(fileNameDisplay, fileName) {
    fileNameDisplay.textContent = `Selected: ${fileName}`;
}

function clearCookieFileName(fileNameDisplay) {
    fileNameDisplay.textContent = '';
}

async function uploadCookieFile(monitorId, file) {
    const formData = new FormData();
    formData.append('file', file);
    
    try {
        const response = await fetch(`${MONITORS_ENDPOINT}/${monitorId}/cookies`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${authToken}`
            },
            body: formData
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to upload cookies');
        }
        
        return true;
    } catch (error) {
        console.error('Cookie upload error:', error);
        throw error;
    }
}

async function deleteCookieFile(monitorId) {
    try {
        const response = await fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}/cookies`, {
            method: 'DELETE'
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete cookies');
        }
        
        return true;
    } catch (error) {
        console.error('Cookie deletion error:', error);
        throw error;
    }
}

/*******************************
 * Update & Display Functions
 *******************************/
function formatCountdown(nextRunTime) {
    if (!nextRunTime) return 'Paused';
    
    const now = new Date();
    const next = new Date(nextRunTime);
    const diff = next - now;
    
    if (diff <= 0) return 'Checking...';
    
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    let parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    
    return parts.length > 0 ? parts.join(' ') : '< 1m';
}

function startCountdown(siteId, nextRunTime) {
    if (countdownIntervals[siteId]) clearInterval(countdownIntervals[siteId]);
    
    const update = () => {
        const el = document.getElementById(`countdown-${siteId}`);
        if (el) el.textContent = formatCountdown(nextRunTime);
    };
    
    update();
    countdownIntervals[siteId] = setInterval(update, 60000);
}

function clearAllCountdowns() {
    Object.values(countdownIntervals).forEach(clearInterval);
    countdownIntervals = {};
}

function updateDisplay() {
    const elements = getElements();
    elements.monitorsList.innerHTML = '';
    clearAllCountdowns();

    // Pre-existing bug, fixed 2026-08-14: this read a bare `currentUser` that is
    // declared nowhere at module scope, so updateDisplay() threw a ReferenceError
    // on every page load and the monitor list never rendered. The rest of the file
    // already reads it off the auth manager.
    if (!authManager || !authManager.currentUser) {
        elements.monitorsList.innerHTML = `<p class="empty-state">Please log in to see your monitors.</p>`;
        return;
    }
    if (monitoredSites.length === 0) {
        elements.monitorsList.innerHTML = `<p class="empty-state">You are not monitoring any sites yet. Add one using the form.</p>`;
        return;
    }

    monitoredSites.forEach(site => {
        const card = document.createElement('div');
        const isChangePaused = site.paused && site.pausedReason === 'Change detected';
        card.className = 'monitor-card' + (site.paused ? ' paused' : '') + (isChangePaused ? ' change-detected' : '');
        
        let displayValue = (site.lastKnownValue || "[No value stored yet]").replace(/</g, "&lt;");
        const truncatedValue = displayValue.length > 200 ? displayValue.substring(0, 200) + '...' : displayValue;

        const cookieBadge = site.hasCookies ? '<span class="cookie-badge">🍪 Cookies</span>' : '';
        const statusBadge = site.paused 
            ? `<span class="status-badge paused">⏸ PAUSED - ${site.pausedReason || 'Manual pause'}</span>`
            : `<span class="status-badge active">✓ Active</span>`;
        
        const nextCheckDisplay = site.paused 
            ? '<p><strong>Next Check:</strong> Paused</p>'
            : `<p><strong>Next Check:</strong> <span id="countdown-${site.id}">${formatCountdown(site.nextRunTime)}</span></p>`;

        const discordUser = discordUsers.find(u => u.id === site.discordUserId);
        const loadImagesDisplay = site.loadImages ? 'Yes' : 'No';

        const actionButtons = site.paused
            ? `<button class="resume-btn" data-id="${site.id}">Continue</button>
               <button class="cookies-btn" data-id="${site.id}">Cookies</button>
               <button class="delete-btn" data-id="${site.id}">Delete</button>`
            : `<button class="edit-btn" data-id="${site.id}">Edit</button>
               <button class="cookies-btn" data-id="${site.id}">Cookies</button>
               <button class="delete-btn" data-id="${site.id}">Delete</button>`;

        card.innerHTML = `
            <div class="monitor-card-details">
                ${statusBadge}${cookieBadge}
                <a href="${site.url}" target="_blank" class="url-link">${site.url.replace(/^(https?:\/\/)?(www\.)?/, '')}</a>
                <p><strong>Message:</strong> ${site.message}</p>
                <p><strong>Notify:</strong> ${discordUser ? discordUser.label : (site.discordUserId || 'Not set')}</p>
                <p><strong>Path:</strong> ${site.path}</p>
                <p><strong>Frequency:</strong> Every ~${site.frequency} minutes</p>
                <p><strong>Load Images:</strong> ${loadImagesDisplay}</p>
                ${nextCheckDisplay}
                <div class="current-value">
                    <strong>Current Value: </strong><span class="value-text">${truncatedValue}</span>
                </div>
            </div>
            <div class="monitor-card-actions">${actionButtons}</div>`;
        elements.monitorsList.appendChild(card);
        
        if (!site.paused && site.nextRunTime) startCountdown(site.id, site.nextRunTime);
    });
}

/********************************
 * Discord User Management (account sync via /sync-wip.js)
 ********************************
 * This used to POST the whole list to the unversioned data endpoint — last write
 * wins, silently, so a recipient added on one device disappeared the next time
 * the other device saved. The shared module owns the transport, the debounce, the
 * server-assigned version numbers and the merge now; this page only describes its
 * own data, and a save ships what CHANGED rather than the whole list.
 */

/** This browser's copy. The page works fully logged out, exactly like the others. */
function loadLocalUserData() {
    try {
        const stored = JSON.parse(localStorage.getItem(DISCORD_USERS_KEY) || '[]');
        discordUsers = Array.isArray(stored) ? stored.filter((u) => u && u.id) : [];
    } catch (error) {
        console.error("Error loading local Discord users:", error);
        discordUsers = [];
    }
}

function saveLocalUserData() {
    try {
        localStorage.setItem(DISCORD_USERS_KEY, JSON.stringify(discordUsers));
    } catch (error) {
        console.error("Error saving local Discord users:", error);
    }
}

function initSync() {
    if (!authManager || typeof SyncWip === 'undefined') return;
    syncClient = new SyncWip.SyncClient({
        auth: authManager,
        appName: APP_NAME,

        getState: () => ({ discordUsers }),
        setState: (s) => {
            discordUsers = (s && s.discordUsers) || [];
            saveLocalUserData();
            renderDiscordUsers();
        },

        // "Is this blob one of ours?" — guards against another app's data.
        accept: (raw) => !!raw && typeof raw === 'object' && Array.isArray(raw.discordUsers),

        normalize: (raw) => ({
            discordUsers: (raw && Array.isArray(raw.discordUsers) ? raw.discordUsers : [])
                .filter((u) => u && u.id)
                .map((u) => ({ id: String(u.id), label: u.label || String(u.id) })),
        }),

        hasData: (s) => !!s && (s.discordUsers || []).length > 0,

        // The operation log. This is the line that turns "both devices changed"
        // from the user's problem into the engine's problem.
        collections: SYNC_COLLECTIONS,
        collectionLabels: COLLECTION_LABELS,

        // Every recipient is real data — there is no view state on this page to
        // exclude, so the fingerprint is simply the list.
        canonical: (s) => {
            if (!s) return null;
            return JSON.stringify((s.discordUsers || [])
                .map((u) => [u.id, u.label || ''].join('|'))
                .sort());
        },

        // Union both copies, dropping duplicates by id. Only reached on the no-base
        // fallback path (a first sync, cleared storage), and it cannot lose an entry.
        merge: (theirs, mine) => {
            const byId = new Map((theirs.discordUsers || []).map((u) => [u.id, u]));
            (mine.discordUsers || []).forEach((u) => byId.set(u.id, u));   // mine wins ties
            return { discordUsers: Array.from(byId.values()) };
        },

        onStatus: (status) => console.log('[SYNC]', status),

        // Both devices changed something? Not a question for the user: their
        // changes are applied, mine go on top, and the page says what happened.
        // Ignoring the notice is confirming it — the action already happened, so a
        // dismissal must never undo it.
        onMerged: (info) => {
            renderDiscordUsers();
            const n = info.changesFromOtherDevice;
            let msg = info.message || `Merged ${n} change${n === 1 ? '' : 's'} from your other device`;
            if (info.stats && info.stats.myEditWon) msg += ` — ${info.stats.myEditWon} kept from this device`;
            if (info.awaitingDecision) msg += ` — ${info.awaitingDecision} need a decision`;

            if (!info.revertable) {
                if (info.direction !== 'upload') msg += " — can't be undone on this device";
                showSyncNotice(msg, []);
                return;
            }
            showSyncNotice(msg, [
                { label: 'Revert', act: () => info.revert() },
                { label: 'OK', act: () => info.confirm(), primary: true },
            ], () => info.confirm());   // dismissing IS confirming
        },

        // The ONE thing sync will not decide by itself: a recipient removed on one
        // device and renamed on the other. Asked per entry, AFTER the rest of the
        // merge is already saved. Cancelling KEEPS the entry — a dismissal must
        // never destroy.
        onItemConflict: (info) => {
            const answers = {};
            (info.collisions || []).forEach((c) => {
                const item = c.after || c.before;
                const name = item ? (item.label || item.id) : c.id;
                const where = c.deletedOnThisDevice
                    ? 'You removed this here; your other device edited it'
                    : 'Removed on your other device; you edited it here';
                if (confirm(`Remove "${name}"? (${where}.) Cancel keeps it.`)) answers[c.key] = 'delete';
            });
            return Object.keys(answers).length ? answers : null;
        },
    });
}

/** After login / session restore. The decision table lives in /sync-wip.js. */
async function fetchUserData() {
    if (!syncClient || !authManager || !authManager.isLoggedIn()) {
        renderDiscordUsers();
        return;
    }
    try {
        await syncClient.performSync();
    } catch (error) {
        console.error("Error syncing Discord users:", error);
    } finally {
        renderDiscordUsers();
    }
}

/**
 * An ordinary edit — one recipient added or removed. It travels as that one
 * operation, so it can never empty the other device's list.
 */
async function saveUserData() {
    saveLocalUserData();
    if (!syncClient || !authManager || !authManager.isLoggedIn()) return;
    try {
        await syncClient.flush();
    } catch (error) {
        console.error("Failed to save Discord recipients to your account:", error);
        alert("Could not save Discord user list to your account. Please try again.");
    }
}

/**
 * The silent-merge notice. Not a dialog — it reports something that has ALREADY
 * happened, so nothing waits on it and the timeout confirms rather than cancels.
 *
 * It floats over the page rather than using the sync panel's #syncStatus line,
 * because that line lives inside a modal that is closed almost all of the time —
 * a notice nobody can see is not a notice.
 */
function showSyncNotice(message, actions, onDismiss) {
    const box = document.createElement('div');
    box.style.cssText = 'position:fixed;bottom:20px;right:20px;max-width:420px;z-index:3000;'
        + 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;'
        + 'background:#333;color:#fff;padding:12px 20px;border-radius:4px;'
        + 'border-left:4px solid #17a2b8;box-shadow:0 4px 12px rgba(0,0,0,0.3);';

    let settled = false;
    const settle = (fn) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        box.remove();
        if (fn) fn();
    };

    const text = document.createElement('span');
    text.textContent = message;
    box.appendChild(text);

    (actions || []).forEach((a) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = a.label;
        btn.style.cssText = 'background:transparent;color:inherit;border:1px solid currentColor;'
            + 'border-radius:4px;padding:4px 10px;cursor:pointer;font:inherit;';
        if (a.primary) btn.style.fontWeight = '600';
        btn.addEventListener('click', () => settle(a.act));
        box.appendChild(btn);
    });

    document.body.appendChild(box);
    const timer = setTimeout(() => settle(onDismiss), 9000);
}

function renderDiscordUsers() {
    const { discordUsersList, discordUserIdSelect } = getElements();
    discordUsersList.innerHTML = '';
    discordUserIdSelect.innerHTML = '<option value="">-- Select a User --</option>';

    if (discordUsers.length === 0) {
        discordUsersList.innerHTML = '<p class="empty-state-small">No users added yet.</p>';
    } else {
        discordUsers.forEach(user => {
            const item = document.createElement('div');
            item.className = 'discord-user-item';
            item.innerHTML = `<p>${user.label} <span>(${user.id})</span></p><button class="delete-btn" data-id="${user.id}">X</button>`;
            discordUsersList.appendChild(item);

            const option = document.createElement('option');
            option.value = user.id;
            option.textContent = user.label;
            discordUserIdSelect.appendChild(option);
        });
    }
}

async function handleAddDiscordUser(e) {
    e.preventDefault();
    const { discordUserLabelInput, discordUserIdInput, discordUserError } = getElements();
    const label = discordUserLabelInput.value.trim();
    const id = discordUserIdInput.value.trim();

    if (!label || !id) {
        discordUserError.textContent = "Label and ID are required.";
        return;
    }
    if (discordUsers.some(u => u.id === id)) {
        discordUserError.textContent = "This User ID already exists.";
        return;
    }

    discordUsers.push({ label, id });
    renderDiscordUsers();
    await saveUserData();
    e.target.reset();
    discordUserError.textContent = "";
}

async function handleDeleteDiscordUser(id) {
    discordUsers = discordUsers.filter(u => u.id !== id);
    renderDiscordUsers();
    await saveUserData();
}


/********************************
 * App-Specific Actions
 ********************************/

async function fetchMonitors(isAutoRefresh = false) {
    if (!authManager || !authManager.isLoggedIn()) return;
    try {
        const userIdField = authManager.currentUser.sub || authManager.currentUser.userId;
        const response = await authManager.fetchWithAuth(`${MONITORS_ENDPOINT}?userId=${userIdField}`);
        if (!response.ok) throw new Error('Failed to fetch monitors');
        
        const newMonitors = await response.json();
        if (JSON.stringify(monitoredSites) !== JSON.stringify(newMonitors)) {
            monitoredSites = newMonitors;
            updateDisplay();
        }
    } catch (error) {
        if (!isAutoRefresh) {
            console.error("Error fetching monitors:", error);
            alert("Could not load your monitors from the server.");
        } else {
             console.warn("Auto-refresh failed silently:", error);
        }
    }
}

async function handleAddMonitor(event) {
    event.preventDefault();
    const elements = getElements();
    elements.addMonitorError.textContent = '';
    const userIdField = authManager?.currentUser?.sub || authManager?.currentUser?.userId;
    if (!userIdField) {
        elements.addMonitorError.textContent = 'Please log in first.';
        return;
    }

    let frequency = elements.monitorFrequencySelect.value;
    if (frequency === 'custom') {
        frequency = elements.customMonitorFrequencyInput.value;
    }

    const newMonitor = {
        userId: userIdField,
        url: elements.monitorUrlInput.value.trim(),
        pathType: elements.pathTypeSelect.value,
        path: elements.monitorPathInput.value.trim(),
        message: elements.monitorMessageInput.value.trim(),
        frequency: parseInt(frequency, 10),
        discordUserId: elements.discordUserIdSelect.value,
        loadImages: elements.loadImagesCheckbox.checked
    };

    try {
        const response = await authManager.fetchWithAuth(MONITORS_ENDPOINT, { method: 'POST', body: JSON.stringify(newMonitor) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Failed to add monitor');
        
        // Upload cookie file if one was selected
        if (pendingCookieFile) {
            try {
                await uploadCookieFile(data.id, pendingCookieFile);
                console.log('Cookie file uploaded successfully');
            } catch (cookieError) {
                console.error('Failed to upload cookies:', cookieError);
                alert('Monitor added, but cookie upload failed: ' + cookieError.message);
            }
            pendingCookieFile = null;
            clearCookieFileName(elements.cookieFileName);
        }
        
        elements.addMonitorForm.reset();
        elements.customFrequencyGroup.style.display = 'none';
        await fetchMonitors();
    } catch (error) {
        elements.addMonitorError.textContent = error.message;
    }
}

function openEditModal(monitorId) {
    const elements = getElements();
    const site = monitoredSites.find(s => s.id === monitorId);
    if (!site) return;

    elements.editMonitorIdInput.value = site.id;
    elements.editMonitorUrlInput.value = site.url;
    elements.editMonitorMessageInput.value = site.message;
    elements.editMonitorFrequencyInput.value = site.frequency;
    elements.editLoadImagesCheckbox.checked = site.loadImages || false;
    elements.editMonitorError.textContent = '';
    elements.editModal.style.display = 'block';
}

async function handleUpdateMonitor(event) {
    event.preventDefault();
    const elements = getElements();
    const monitorId = elements.editMonitorIdInput.value;
    
    const updatedData = {
        message: elements.editMonitorMessageInput.value.trim(),
        frequency: parseInt(elements.editMonitorFrequencyInput.value, 10),
        loadImages: elements.editLoadImagesCheckbox.checked
    };

    try {
        const response = await authManager.fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}`, { method: 'PUT', body: JSON.stringify(updatedData) });
        const errorData = await response.json();
        if (!response.ok) throw new Error(errorData.error || 'Failed to update monitor');

        elements.editModal.style.display = 'none';
        await fetchMonitors();
    } catch (error) {
        elements.editMonitorError.textContent = error.message;
    }
}

function openCookiesModal(monitorId) {
    const elements = getElements();
    const site = monitoredSites.find(s => s.id === monitorId);
    if (!site) return;

    elements.cookieModalMonitorId.value = monitorId;
    elements.cookieModalUrl.textContent = site.url;
    clearCookieFileName(elements.cookieModalFileName);
    elements.cookieModalError.textContent = '';
    
    // Update cookie status
    if (site.hasCookies) {
        elements.cookieStatus.textContent = '🍪 Cookies are currently uploaded for this monitor';
        elements.cookieStatus.className = 'cookie-status has-cookies';
        elements.deleteCookiesBtn.style.display = 'inline-block';
    } else {
        elements.cookieStatus.textContent = 'No cookies uploaded for this monitor';
        elements.cookieStatus.className = 'cookie-status no-cookies';
        elements.deleteCookiesBtn.style.display = 'none';
    }
    
    elements.cookiesModal.style.display = 'block';
}

async function handleUploadCookiesFromModal(file) {
    const elements = getElements();
    const monitorId = elements.cookieModalMonitorId.value;
    
    try {
        await uploadCookieFile(monitorId, file);
        elements.cookieModalError.textContent = '';
        alert('Cookies uploaded successfully!');
        await fetchMonitors();
        openCookiesModal(monitorId); // Refresh the modal
    } catch (error) {
        elements.cookieModalError.textContent = 'Failed to upload cookies: ' + error.message;
    }
}

async function handleDeleteCookies() {
    const elements = getElements();
    const monitorId = elements.cookieModalMonitorId.value;
    
    if (!confirm('Are you sure you want to delete the cookies for this monitor?')) {
        return;
    }
    
    try {
        await deleteCookieFile(monitorId);
        elements.cookieModalError.textContent = '';
        alert('Cookies deleted successfully!');
        await fetchMonitors();
        openCookiesModal(monitorId); // Refresh the modal
    } catch (error) {
        elements.cookieModalError.textContent = 'Failed to delete cookies: ' + error.message;
    }
}

async function handleResumeMonitor(monitorId) {
    try {
        const response = await authManager.fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}/resume`, { method: 'POST' });
        if (!response.ok) throw new Error((await response.json()).error);
        await fetchMonitors();
    } catch (error) {
        alert("Could not resume the monitor: " + error.message);
    }
}

async function handleDeleteMonitor(monitorId) {
    if (confirm("Are you sure you want to delete this monitor?")) {
        try {
            const response = await authManager.fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}`, { method: 'DELETE' });
            if (!response.ok) throw new Error((await response.json()).error);
            await fetchMonitors();
        } catch (error) {
            alert("Could not delete the monitor: " + error.message);
        }
    }
}

/********************************
 * Authentication UI & Actions
 ********************************/
function updateUIForLoginState() {
    const elements = getElements();
    if (!elements.loginButton || !authManager) return;
    const isLoggedIn = authManager.isLoggedIn();
    const currentUser = authManager.currentUser;
    
    elements.loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.registerButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    elements.userStatus.textContent = isLoggedIn ? `Logged in: ${currentUser?.username || 'User'}` : 'Not logged in';
    elements.userStatus.style.color = isLoggedIn ? '#4bc0c0' : '#ccc';
    if(elements.changePasswordButton) elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';

    if (isLoggedIn && !autoRefreshInterval) {
        autoRefreshInterval = setInterval(() => fetchMonitors(true), 15000);
    } else if (!isLoggedIn && autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const elements = getElements();
    elements.loginError.textContent = '';
    const username = elements.loginForm.elements.loginUsername.value.trim();
    const password = elements.loginForm.elements.loginPassword.value;
    try {
        await authManager.login(username, password);
        elements.loginModal.style.display = 'none';
        elements.loginForm.reset();
        // Auth events will trigger UI update via listeners
    } catch (error) {
        elements.loginError.textContent = error.message;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const elements = getElements();
    elements.registerError.textContent = '';
    const username = elements.registerForm.elements.registerUsername.value.trim();
    const password = elements.registerForm.elements.registerPassword.value;
    const confirmPassword = elements.registerForm.elements.registerConfirmPassword.value;

    if (password !== confirmPassword) {
        elements.registerError.textContent = 'Passwords do not match.';
        return;
    }
    try {
        await authManager.register(username, password);
        alert("Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginForm.elements.loginUsername.value = username;
    } catch (error) {
        elements.registerError.textContent = error.message;
    }
}

async function handleLogout(logoutMessage = null) {
    // Monitors belong to the notifier backend and are gone without a session.
    // The recipient list is this browser's own copy, so it is RELOADED rather
    // than blanked: blanking it would look to the next sync like "every
    // recipient was deleted here" and take the account's list with it.
    monitoredSites = [];
    loadLocalUserData();
    if (logoutMessage) alert(logoutMessage);
    await authManager.logout();
    // Auth events will trigger UI update via listeners
}

/********************************
 * Local File Sync Logic (for backup)
 ********************************/
function exportDataToFile() {
    const dataToExport = { monitoredSites };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
}

/********************************
 * Event Listeners Setup
 ********************************/
function setupEventListeners() {
    const elements = getElements();
    if (!elements.loginButton) return;

    // Auth listeners
    elements.loginButton.addEventListener('click', () => elements.loginModal.style.display = 'block');
    elements.registerButton.addEventListener('click', () => elements.registerModal.style.display = 'block');
    elements.logoutButton.addEventListener('click', () => handleLogout());
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    elements.settingsButton.addEventListener("click", () => {
        if (elements.changePasswordButton) elements.changePasswordButton.style.display = authManager?.isLoggedIn() ? 'inline-block' : 'none';
        elements.settingsModal.style.display = "block";
    });
    if (elements.changePasswordButton) elements.changePasswordButton.addEventListener('click', () => elements.changePasswordModal.style.display = 'block');
    
    // Local Sync listeners
    elements.localSyncButton.addEventListener('click', () => elements.syncModal.style.display = 'block');
    elements.exportDataButton.addEventListener('click', exportDataToFile);
    
    // Close modals
    document.body.addEventListener('click', e => {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal) return;
        const isCloseControl = e.target.matches('.close-modal, .close-auth-modal, .close-sync-modal, .close-modal-button');
        if (isCloseControl || e.target === modal) {
            modal.style.display = 'none';
        }
    });

    // App-specific listeners
    elements.addMonitorForm.addEventListener('submit', handleAddMonitor);
    elements.editMonitorForm.addEventListener('submit', handleUpdateMonitor);
    elements.monitorFrequencySelect.addEventListener('change', e => {
        elements.customFrequencyGroup.style.display = e.target.value === 'custom' ? 'block' : 'none';
    });

    // Cookie upload setup (add form)
    setupCookieDropZone(
        elements.cookieDropZone,
        elements.cookieFileInput,
        elements.cookieFileName,
        (file) => {
            pendingCookieFile = file;
            displayCookieFileName(elements.cookieFileName, file.name);
        }
    );

    // Cookie upload setup (modal)
    setupCookieDropZone(
        elements.cookieModalDropZone,
        elements.cookieModalFileInput,
        elements.cookieModalFileName,
        (file) => {
            displayCookieFileName(elements.cookieModalFileName, file.name);
            handleUploadCookiesFromModal(file);
        }
    );

    // Delete cookies button
    elements.deleteCookiesBtn.addEventListener('click', handleDeleteCookies);

    // Discord User Management Listeners
    elements.manageDiscordUsersBtn.addEventListener('click', () => elements.discordUsersModal.style.display = 'block');
    elements.addDiscordUserForm.addEventListener('submit', handleAddDiscordUser);
    elements.discordUsersList.addEventListener('click', e => {
        if (e.target.classList.contains('delete-btn')) {
            const id = e.target.getAttribute('data-id');
            handleDeleteDiscordUser(id);
        }
    });

    // Monitor list button handlers
    elements.monitorsList.addEventListener('click', event => {
        const target = event.target;
        const monitorId = target.getAttribute('data-id');
        if (!monitorId) return;

        if (target.classList.contains('delete-btn')) handleDeleteMonitor(monitorId);
        else if (target.classList.contains('edit-btn')) openEditModal(monitorId);
        else if (target.classList.contains('resume-btn')) handleResumeMonitor(monitorId);
        else if (target.classList.contains('cookies-btn')) openCookiesModal(monitorId);
    });
}

/**********************
 * Auth Event Listeners (for cross-tab sync)
 **********************/
function setupAuthEventListeners() {
    // Listen for login events (from this tab or other tabs)
    window.addEventListener('auth:login', async (e) => {
        console.log('[AUTH_EVENT] Login detected:', e.detail?.user?.username);
        updateUIForLoginState();
        await fetchUserData();
        await fetchMonitors();
    });

    // Listen for session restoration (page load with existing session)
    window.addEventListener('auth:session-restored', async (e) => {
        console.log('[AUTH_EVENT] Session restored:', e.detail?.user?.username);
        updateUIForLoginState();
        await fetchUserData();
        await fetchMonitors();
    });

    // Listen for logout events (from this tab or other tabs)
    window.addEventListener('auth:logout', (e) => {
        console.log('[AUTH_EVENT] Logout detected:', e.detail?.message);
        monitoredSites = [];
        // Reload this browser's copy rather than blanking it — see handleLogout().
        loadLocalUserData();
        updateUIForLoginState();
        updateDisplay();
        renderDiscordUsers();
    });

    // Listen for no session on page load
    window.addEventListener('auth:no-session', () => {
        console.log('[AUTH_EVENT] No active session');
        updateUIForLoginState();
        renderDiscordUsers();
    });
}

/**********************
 * Initial Page Load
 **********************/
document.addEventListener("DOMContentLoaded", async () => {
    // Initialize AuthManagerWip
    if (typeof AuthManagerWip !== 'undefined') {
        authManager = new AuthManagerWip(APP_NAME, ENVIRONMENT);
    } else {
        console.error("AuthManagerWip not loaded! Make sure auth-wip.js is included before this script.");
        return;
    }

    // Local copy first — the page works fully logged out — then the sync client,
    // which needs both auth and the data model.
    loadLocalUserData();
    initSync();

    setupEventListeners();
    setupAuthEventListeners();

    // Initialize auth session - AuthManagerWip will dispatch appropriate events
    await authManager.initialize();
    
    // Initial display update (in case no events fire)
    updateDisplay();
});