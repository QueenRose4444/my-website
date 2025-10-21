// site_notifier.js - Handles login and managing site monitors via the backend API.

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
const APP_NAME = 'site_notifier';
const ENVIRONMENT = 'wip'; // 'live' or 'wip'

const envConfigs = {
    live: {
        storagePrefix: `${APP_NAME}_live_`,
        loginBackendUrl: 'https://main-backend-live.rosiesite.workers.dev',
        notifierBackendUrl: 'https://disc_notifier.rosestuffs.org'
    },
    wip: {
        storagePrefix: `${APP_NAME}_wip_`,
        loginBackendUrl: 'https://main-backend-wip.rosiesite.workers.dev',
        notifierBackendUrl: 'https://disc_notifier.rosestuffs.org'
    }
};

const activeConfig = envConfigs[ENVIRONMENT];

/*************************************
 * CONSTANTS
 *************************************/
const storagePrefix = activeConfig.storagePrefix;
const LOGIN_BACKEND_URL = activeConfig.loginBackendUrl;
const NOTIFIER_BACKEND_URL = activeConfig.notifierBackendUrl;

// Auth endpoints
const LOGIN_ENDPOINT = `${LOGIN_BACKEND_URL}/api/auth/login`;
const REGISTER_ENDPOINT = `${LOGIN_BACKEND_URL}/api/auth/register`;
const REFRESH_ENDPOINT = `${LOGIN_BACKEND_URL}/api/auth/refresh`;
const LOGOUT_ENDPOINT = `${LOGIN_BACKEND_URL}/api/auth/logout`;
const CHANGE_PASSWORD_ENDPOINT = `${LOGIN_BACKEND_URL}/api/auth/change-password`;
const USER_DATA_ENDPOINT = `${LOGIN_BACKEND_URL}/api/data/${APP_NAME}`; 

// Notifier endpoints
const MONITORS_ENDPOINT = `${NOTIFIER_BACKEND_URL}/api/monitors`;

/*************************************
 * Global State
 *************************************/
let monitoredSites = [];
let discordUsers = [];
let countdownIntervals = {};
let autoRefreshInterval = null;
let pendingCookieFile = null; // Stores the cookie file for new monitors

// --- Auth State ---
let currentUser = null;
let authToken = localStorage.getItem(`${storagePrefix}authToken`);
let refreshToken = localStorage.getItem(`${storagePrefix}refreshToken`);
let isRefreshingToken = false;
let refreshSubscribers = [];

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
 * Auth & Generic Backend Logic
 ************************************/
function decodeJwtPayload(token) {
    try {
        const base64Url = token.split('.')[1];
        if (!base64Url) return null;
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) { 
        console.error("Failed to decode JWT:", e); 
        return null; 
    }
}

function isTokenExpired(token) {
    if (!token) return true;
    const payload = decodeJwtPayload(token);
    return payload ? Date.now() >= payload.exp * 1000 : true;
}

async function attemptRefreshToken() {
    if (!refreshToken) return false;
    if (isRefreshingToken) return new Promise(resolve => refreshSubscribers.push(resolve));
    isRefreshingToken = true;
    let success = false;
    try {
        const response = await fetch(REFRESH_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Refresh failed');
        authToken = data.accessToken;
        localStorage.setItem(`${storagePrefix}authToken`, authToken);
        currentUser = decodeJwtPayload(authToken);
        success = true;
    } catch (error) {
        await logoutUser("Your session could not be refreshed. This can happen if you log out elsewhere. Please log in again.");
        success = false;
    } finally {
        isRefreshingToken = false;
        refreshSubscribers.forEach(cb => cb(success));
        refreshSubscribers = [];
    }
    return success;
}

async function fetchWithAuth(url, options = {}) {
    if (!authToken || isTokenExpired(authToken)) {
        const refreshed = await attemptRefreshToken();
        if (!refreshed) throw new Error("Authentication failed; session expired.");
    }
    options.headers = { ...options.headers, 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' };
    let response = await fetch(url, options);
    if (response.status === 401) {
        const refreshed = await attemptRefreshToken();
        if (refreshed) {
            options.headers['Authorization'] = `Bearer ${authToken}`;
            response = await fetch(url, options);
        } else { throw new Error("Authentication failed after retry."); }
    }
    return response;
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

    if (!currentUser) {
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
 * Discord User Management (User Data Sync)
 ********************************/
async function fetchUserData() {
    if (!currentUser) return;
    try {
        const response = await fetchWithAuth(USER_DATA_ENDPOINT);
        if (!response.ok) {
            if (response.status === 404) {
                console.log("No user data on server yet.");
                discordUsers = [];
                return; 
            }
            throw new Error('Failed to fetch user data');
        }
        const data = await response.json();
        discordUsers = data.discordUsers || [];
    } catch (error) {
        console.error("Error fetching user data:", error);
    } finally {
        renderDiscordUsers();
    }
}

async function saveUserData() {
    if (!currentUser) return;
    try {
        await fetchWithAuth(USER_DATA_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify({ discordUsers: discordUsers })
        });
    } catch (error) {
        console.error("Failed to save user data to server:", error);
        alert("Could not save Discord user list to your account. Please try again.");
    }
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
    if (!currentUser) return;
    try {
        const userIdField = currentUser.sub || currentUser.userId;
        const response = await fetchWithAuth(`${MONITORS_ENDPOINT}?userId=${userIdField}`);
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
    const userIdField = currentUser?.sub || currentUser?.userId;
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
        const response = await fetchWithAuth(MONITORS_ENDPOINT, { method: 'POST', body: JSON.stringify(newMonitor) });
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
        const response = await fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}`, { method: 'PUT', body: JSON.stringify(updatedData) });
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
        const response = await fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}/resume`, { method: 'POST' });
        if (!response.ok) throw new Error((await response.json()).error);
        await fetchMonitors();
    } catch (error) {
        alert("Could not resume the monitor: " + error.message);
    }
}

async function handleDeleteMonitor(monitorId) {
    if (confirm("Are you sure you want to delete this monitor?")) {
        try {
            const response = await fetchWithAuth(`${MONITORS_ENDPOINT}/${monitorId}`, { method: 'DELETE' });
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
    if (!elements.loginButton) return;
    const isLoggedIn = !!refreshToken;
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
        const response = await fetch(LOGIN_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        
        authToken = data.accessToken;
        refreshToken = data.refreshToken;
        localStorage.setItem(`${storagePrefix}authToken`, authToken);
        localStorage.setItem(`${storagePrefix}refreshToken`, refreshToken);
        currentUser = decodeJwtPayload(authToken);
        
        elements.loginModal.style.display = 'none';
        updateUIForLoginState();
        await fetchUserData();
        await fetchMonitors();
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
        const response = await fetch(REGISTER_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        alert("Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginForm.elements.loginUsername.value = username;
    } catch (error) {
        elements.registerError.textContent = error.message;
    }
}

async function logoutUser(logoutMessage = null) {
    const tokenToInvalidate = refreshToken;
    authToken = null; refreshToken = null; currentUser = null;
    monitoredSites = []; discordUsers = [];
    localStorage.removeItem(`${storagePrefix}authToken`);
    localStorage.removeItem(`${storagePrefix}refreshToken`);
    if (logoutMessage) alert(logoutMessage);
    if (tokenToInvalidate) {
        try {
            await fetch(LOGOUT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokenToInvalidate }) });
        } catch (error) { console.warn("Backend logout failed:", error); }
    }
    updateUIForLoginState();
    updateDisplay();
    renderDiscordUsers();
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
    elements.logoutButton.addEventListener('click', () => logoutUser());
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    elements.settingsButton.addEventListener("click", () => {
        if (elements.changePasswordButton) elements.changePasswordButton.style.display = authToken ? 'inline-block' : 'none';
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
 * Initial Page Load
 **********************/
document.addEventListener("DOMContentLoaded", async () => {
    setupEventListeners();
    authToken = localStorage.getItem(`${storagePrefix}authToken`);
    refreshToken = localStorage.getItem(`${storagePrefix}refreshToken`);

    if (refreshToken) {
        if (isTokenExpired(authToken)) {
            await attemptRefreshToken();
        } else {
            currentUser = decodeJwtPayload(authToken);
        }
        if (currentUser) {
            await fetchUserData();
            await fetchMonitors();
        }
    } else {
        renderDiscordUsers();
    }
    
    updateUIForLoginState();
    updateDisplay();
});