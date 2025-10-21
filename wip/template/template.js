// template.js - Handles login, data sync (local & backend) with Multi-Session Refresh Tokens

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
// -- SET YOUR APPLICATION NAME HERE --
// This MUST be unique for each application to keep data separate.
const APP_NAME = 'template'; // e.g., 'note-app', 'game-scores', etc.

// SET THE ENVIRONMENT HERE: 'live' or 'wip'
const ENVIRONMENT = 'wip'; // 'live' or 'wip'

// --- Configuration settings for each environment ---
const envConfigs = {
    live: {
        storagePrefix: `${APP_NAME}_live_`,
        backendUrl: 'https://main-backend-live.rosiesite.workers.dev'
    },
    wip: {
        storagePrefix: `${APP_NAME}_wip_`,
        backendUrl: 'https://main-backend-wip.rosiesite.workers.dev'
    }
};

// --- Active configuration based on the environment set above ---
const activeConfig = envConfigs[ENVIRONMENT];


/*************************************
 * LOGGING CONFIGURATION
 *************************************/
const LOGGING_ENABLED = ENVIRONMENT === 'wip';

function syncLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[SYNC_LOG]', ...args);
    }
}


/*************************************
 * CONSTANTS
 *************************************/
const storagePrefix = activeConfig.storagePrefix;
const BACKEND_URL = activeConfig.backendUrl;
const LOGIN_ENDPOINT = `${BACKEND_URL}/api/auth/login`;
const REGISTER_ENDPOINT = `${BACKEND_URL}/api/auth/register`;
const REFRESH_ENDPOINT = `${BACKEND_URL}/api/auth/refresh`;
const LOGOUT_ENDPOINT = `${BACKEND_URL}/api/auth/logout`;
const USER_DATA_ENDPOINT = `${BACKEND_URL}/api/data/${APP_NAME}`;
const CHANGE_PASSWORD_ENDPOINT = `${BACKEND_URL}/api/auth/change-password`;


/*************************************
 * Global State & Settings
 *************************************/
// CUSTOMIZE YOUR APP'S DATA MODEL HERE
// This is what will be saved locally and synced to the server.
let userNotes = []; // Example: an array of note objects
let appPreferences = {}; // Example: an object for user preferences

// Default settings if none are loaded from local storage or server
const defaultPreferences = {
    theme: "dark",
    fontSize: "medium",
};

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
        settingsButton: document.getElementById("settingsButton"),
        localSyncButton: document.getElementById("localSyncButton"),
        settingsModal: document.getElementById("settingsModal"),
        loginModal: document.getElementById("loginModal"),
        registerModal: document.getElementById("registerModal"),
        changePasswordModal: document.getElementById("changePasswordModal"),
        syncModal: document.getElementById("syncModal"),
        syncChoiceModal: document.getElementById("syncChoiceModal"),
        loginButton: document.getElementById("loginButton"),
        registerButton: document.getElementById("registerButton"),
        logoutButton: document.getElementById("logoutButton"),
        userStatus: document.getElementById("userStatus"),
        loginForm: document.getElementById("loginForm"),
        registerForm: document.getElementById("registerForm"),
        loginUsernameInput: document.getElementById("loginUsername"),
        loginPasswordInput: document.getElementById("loginPassword"),
        loginError: document.getElementById("loginError"),
        registerUsernameInput: document.getElementById("registerUsername"),
        registerPasswordInput: document.getElementById("registerPassword"),
        registerConfirmPasswordInput: document.getElementById("registerConfirmPassword"),
        registerError: document.getElementById("registerError"),
        changePasswordButton: document.getElementById("changePasswordButton"),
        changePasswordForm: document.getElementById("changePasswordForm"),
        currentPasswordInput: document.getElementById("currentPassword"),
        newPasswordInput: document.getElementById("newPassword"),
        confirmNewPasswordInput: document.getElementById("confirmNewPassword"),
        changePasswordError: document.getElementById("changePasswordError"),
        changePasswordSuccess: document.getElementById("changePasswordSuccess"),
        exportDataButton: document.getElementById("exportData"),
        importDataInput: document.getElementById("importData"),
        syncStatus: document.getElementById("syncStatus"),
    };
}

/************************************
 * Data Loading / Saving Logic
 ************************************/
function loadLocalData() {
    syncLog("Loading all data from localStorage...");
    try {
        // CUSTOMIZE: Load your app's data from local storage
        const storedNotes = JSON.parse(localStorage.getItem(`${storagePrefix}userNotes`) || "[]");
        userNotes = storedNotes.map(note => ({ ...note, createdAt: new Date(note.createdAt) }));

        const storedPrefs = JSON.parse(localStorage.getItem(`${storagePrefix}appPreferences`) || "{}");
        appPreferences = { ...defaultPreferences, ...storedPrefs };

    } catch (e) {
        console.error("Error loading local data:", e);
        userNotes = [];
        appPreferences = { ...defaultPreferences };
    }
}

function saveLocalData() {
    syncLog("Saving all data to localStorage...");
    try {
        // CUSTOMIZE: Save your app's data to local storage
        localStorage.setItem(`${storagePrefix}userNotes`, JSON.stringify(userNotes));
        localStorage.setItem(`${storagePrefix}appPreferences`, JSON.stringify(appPreferences));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}


/************************************
 * Auth & Backend Data Logic
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
    if (isRefreshingToken) {
        return new Promise(resolve => refreshSubscribers.push(resolve));
    }
    isRefreshingToken = true;
    let success = false;
    try {
        const response = await fetch(REFRESH_ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Refresh failed');
        authToken = data.accessToken;
        localStorage.setItem(`${storagePrefix}authToken`, authToken);
        currentUser = decodeJwtPayload(authToken);
        success = true;
    } catch (error) {
        await logoutUser("Your session has expired. Please log in again.");
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
        } else {
             throw new Error("Authentication failed after retry.");
        }
    }
    return response;
}

async function fetchBackendData() {
    if (!authToken && !refreshToken) return null;
    try {
        const response = await fetchWithAuth(USER_DATA_ENDPOINT, { method: 'GET' });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to fetch');
        const data = await response.json();

        // CUSTOMIZE: Parse your app's data from the server response
        data.userNotes = (data.userNotes || []).map(note => ({ ...note, createdAt: new Date(note.createdAt) }));
        data.appPreferences = { ...defaultPreferences, ...(data.appPreferences || {}) };
        
        return data;
    } catch (error) {
        console.error("Failed to fetch backend data:", error);
        return null;
    }
}

async function saveBackendData() {
    if (!currentUser || !authToken) return false;
    
    // CUSTOMIZE: This is the object that gets sent to the server.
    const dataToSave = {
        userNotes,
        appPreferences
    };

    syncLog("Saving data to backend:", dataToSave);
    try {
        const response = await fetchWithAuth(USER_DATA_ENDPOINT, {
            method: 'POST',
            body: JSON.stringify(dataToSave)
        });
        if (!response.ok) throw new Error((await response.json()).error || 'Failed to save');
        syncLog("Backend save successful.");
        return true;
    } catch (error) {
        console.error("Failed to save backend data:", error);
        alert(`Failed to save data to server: ${error.message}`);
        return false;
    }
}

function saveData() {
    saveLocalData();
    if (currentUser && authToken) {
        saveBackendData();
    }
    updateDisplay();
}

/************************************
 * Date/Time Formatting
 ************************************/
function formatDate(date) {
    if (!(date instanceof Date) || isNaN(date)) return "N/A";
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const y = date.getFullYear();
    return `${d}/${m}/${y}`;
}

function formatTime(date) {
    if (!(date instanceof Date) || isNaN(date)) return "N/A";
    return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/*******************************
 * Update & Display Functions
 *******************************/
function updateDisplay() {
    // CUSTOMIZE: This function should refresh your app's UI with the current data.
    console.log("updateDisplay called. App state refreshed.");
    console.log("Current notes:", userNotes);
    console.log("Current preferences:", appPreferences);
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
    elements.userStatus.textContent = isLoggedIn ? `Logged in: ${currentUser?.username || 'User'}` : 'Not logged in (Local)';
    elements.userStatus.style.color = isLoggedIn ? '#4bc0c0' : '#ccc';
    if(elements.changePasswordButton) elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';
}

function getCanonicalString(dataSet) {
    if (!dataSet) return null;
    const dataCopy = JSON.parse(JSON.stringify(dataSet));

    // CUSTOMIZE: Create a comparable string of your app's data for accurate diffing.
    const processedNotes = (dataCopy.userNotes || []).map(n => ({ ...n, createdAt: new Date(n.createdAt).getTime() })).sort((a, b) => a.createdAt - b.createdAt);
    const preferencesToCompare = { ...defaultPreferences, ...(dataCopy.appPreferences || {}) };
    
    const finalObject = {
        appPreferences: preferencesToCompare,
        userNotes: processedNotes,
    };
    return JSON.stringify(finalObject);
}

function generateDataSummary(dataSet) {
    if (!dataSet) return { lastUpdate: 'N/A', entryCount: '0 entries' };
    
    // CUSTOMIZE: Generate a human-readable summary for the sync choice modal.
    const noteCount = dataSet.userNotes?.length || 0;
    const allEntries = [...(dataSet.userNotes || [])]
        .map(e => new Date(e.createdAt))
        .sort((a,b) => b - a);
    
    const lastUpdate = allEntries.length > 0 ? allEntries[0] : null;

    return {
        lastUpdate: lastUpdate,
        entryCount: `${noteCount} notes`,
    };
}

function showSyncChoiceModal(localSummary, serverSummary, serverData) {
    const modal = document.getElementById('syncChoiceModal');
    if (!modal) return;

    document.getElementById('localLastUpdate').textContent = localSummary.lastUpdate ? `${formatDate(localSummary.lastUpdate)} ${formatTime(localSummary.lastUpdate)}` : 'No entries';
    document.getElementById('localEntryCount').textContent = localSummary.entryCount;

    document.getElementById('serverLastUpdate').textContent = serverSummary.lastUpdate ? `${formatDate(serverSummary.lastUpdate)} ${formatTime(serverSummary.lastUpdate)}` : 'No entries';
    document.getElementById('serverEntryCount').textContent = serverSummary.entryCount;

    const useLocalBtn = document.getElementById('useLocalDataBtn');
    const useServerBtn = document.getElementById('useServerDataBtn');

    const uploadHandler = async () => {
        syncLog("User chose to USE LOCAL data. Uploading to server...");
        await saveBackendData();
        modal.style.display = 'none';
    };

    const downloadHandler = () => {
        syncLog("User chose to USE SERVER data. Overwriting local data...");
        // CUSTOMIZE: Overwrite local state with your app's server data
        userNotes = serverData.userNotes;
        appPreferences = serverData.appPreferences;
        saveLocalData();
        updateDisplay();
        modal.style.display = 'none';
    };
    
    useLocalBtn.replaceWith(useLocalBtn.cloneNode(true));
    useServerBtn.replaceWith(useServerBtn.cloneNode(true));
    
    document.getElementById('useLocalDataBtn').addEventListener('click', uploadHandler);
    document.getElementById('useServerDataBtn').addEventListener('click', downloadHandler);

    modal.style.display = 'block';
}

async function handleLogin(event) {
    event.preventDefault();
    const elements = getElements();
    elements.loginError.textContent = '';
    const username = elements.loginUsernameInput.value.trim();
    const password = elements.loginPasswordInput.value;
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
        
        syncLog('Login successful. Starting data sync check.');
        const serverData = await fetchBackendData();
        const localData = { userNotes, appPreferences }; // CUSTOMIZE
        
        const hasLocalData = (localData.userNotes?.length || 0) > 0; // CUSTOMIZE
        const hasServerData = serverData && ((serverData.userNotes?.length || 0) > 0); // CUSTOMIZE
        
        if (hasLocalData && !hasServerData) {
            syncLog("Local data exists, but no server data. Prompting to upload.");
            if (confirm("No data found on server. Upload your local data to this account?")) {
                await saveBackendData();
            }
        } else if (hasServerData) {
            const localString = getCanonicalString(localData);
            const serverString = getCanonicalString(serverData);
            
            if (localString !== serverString) {
                syncLog('Data mismatch DETECTED. Showing sync choice modal.');
                const localSummary = generateDataSummary(localData);
                const serverSummary = generateDataSummary(serverData);
                showSyncChoiceModal(localSummary, serverSummary, serverData);
            } else {
                syncLog('Data is IN SYNC. No action needed.');
                // CUSTOMIZE
                userNotes = serverData.userNotes;
                appPreferences = serverData.appPreferences;
            }
        } else if (hasServerData && !hasLocalData) {
             syncLog("No local data, but server data exists. Downloading server data.");
             // CUSTOMIZE
             userNotes = serverData.userNotes;
             appPreferences = serverData.appPreferences;
        } else {
            syncLog("No data locally or on the server. Nothing to sync.");
        }

        saveLocalData();
        updateUIForLoginState();
        updateDisplay();
        
    } catch (error) {
        elements.loginError.textContent = error.message;
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const elements = getElements();
    elements.registerError.textContent = '';
    const username = elements.registerUsernameInput.value.trim();
    const password = elements.registerPasswordInput.value;
    if (password !== elements.registerConfirmPasswordInput.value) {
        elements.registerError.textContent = 'Passwords do not match.'; return;
    }
    try {
        const response = await fetch(REGISTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        alert("Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginUsernameInput.value = username;
    } catch (error) {
        elements.registerError.textContent = error.message;
    }
}

async function logoutUser(logoutMessage = null) {
    const tokenToInvalidate = refreshToken;
    authToken = null; refreshToken = null; currentUser = null;
    localStorage.removeItem(`${storagePrefix}authToken`);
    localStorage.removeItem(`${storagePrefix}refreshToken`);
    if (logoutMessage) alert(logoutMessage);
    if (tokenToInvalidate) {
        try {
            await fetch(LOGOUT_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: tokenToInvalidate }) });
        } catch (error) { console.warn("Backend logout failed:", error); }
    }
    loadLocalData();
    updateUIForLoginState();
    updateDisplay();
}

async function handleChangePassword(event) {
    event.preventDefault();
    const elements = getElements();
    elements.changePasswordError.textContent = '';
    elements.changePasswordSuccess.textContent = '';
    const currentPassword = elements.currentPasswordInput.value;
    const newPassword = elements.newPasswordInput.value;
    if (newPassword !== elements.confirmNewPasswordInput.value) {
        elements.changePasswordError.textContent = 'New passwords do not match.';
        return;
    }
    try {
        const response = await fetchWithAuth(CHANGE_PASSWORD_ENDPOINT, { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        elements.changePasswordSuccess.textContent = data.message;
        setTimeout(() => logoutUser("Password changed. Please log in again."), 3000);
    } catch (error) {
        elements.changePasswordError.textContent = `Error: ${error.message}`;
    }
}

/********************************
 * Local File Sync Logic
 ********************************/
function showSyncStatus(message, type = "info") {
    const el = document.getElementById("syncStatus");
    if(el) { el.textContent = message; el.className = `sync-status-${type}`; setTimeout(() => {el.textContent=''; el.className='';}, 5000); }
}

function exportDataToFile() {
    // CUSTOMIZE
    const dataToExport = { 
        userNotes, 
        appPreferences
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: "application/json" });
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
                // CUSTOMIZE: Check for your app's data properties.
                if (data.appPreferences) {
                    userNotes = data.userNotes || [];
                    appPreferences = { ...defaultPreferences, ...data.appPreferences };
                } else {
                    throw new Error("Invalid file format");
                }
                saveLocalData();
                updateDisplay();
                showSyncStatus("Import successful!", "success");
                if(currentUser && confirm("Save imported data to your account? This will overwrite your current server data.")) {
                     await saveBackendData();
                }
            }
        } catch (error) {
            showSyncStatus(`Import failed: ${error.message}`, "error");
        }
    };
    reader.readAsText(file);
}

/********************************
 * Event Listeners Setup
 ********************************/
function setupEventListeners() {
    const elements = getElements();
    if (!elements.loginButton) return;

    elements.loginButton.addEventListener('click', () => elements.loginModal.style.display = 'block');
    elements.registerButton.addEventListener('click', () => elements.registerModal.style.display = 'block');
    elements.logoutButton.addEventListener('click', () => logoutUser());
    elements.loginForm.addEventListener('submit', handleLogin);
    elements.registerForm.addEventListener('submit', handleRegister);
    
    elements.settingsButton.addEventListener("click", () => {
        if (elements.changePasswordButton) {
            elements.changePasswordButton.style.display = authToken ? 'inline-block' : 'none';
        }
        elements.settingsModal.style.display = "block";
    });

    if (elements.changePasswordButton) {
        elements.changePasswordButton.addEventListener('click', () => elements.changePasswordModal.style.display = 'block');
    }
    if (elements.changePasswordForm) {
        elements.changePasswordForm.addEventListener('submit', handleChangePassword);
    }
    
    elements.localSyncButton.addEventListener('click', () => elements.syncModal.style.display = 'block');
    elements.exportDataButton.addEventListener('click', exportDataToFile);
    elements.importDataInput.addEventListener('change', importDataFromFile);

    document.body.addEventListener('click', function(e) {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal || modal.id === 'syncChoiceModal') return;
        
        const isCloseControl = e.target.matches('.close-modal, .close-auth-modal, .close-sync-modal, .close-modal-button, .close-auth-modal-button, .close-sync-modal-button');
        
        if (isCloseControl || e.target === modal) {
            modal.style.display = 'none';
        }
    });
}

/**********************
 * Initial Page Load
 **********************/
async function syncOnLoad() {
    if (!refreshToken) return;

    syncLog("Performing automatic sync on page load...");
    try {
        const serverData = await fetchBackendData();
        if (!serverData) {
            syncLog("Could not fetch server data for sync. Using existing local data.");
            return;
        }
        
        // CUSTOMIZE
        userNotes = serverData.userNotes;
        appPreferences = serverData.appPreferences;

        syncLog("Sync successful. Local data has been overwritten from server.");
        saveLocalData();
        updateDisplay();

    } catch (error) {
        console.error("An error occurred during automatic sync-on-load:", error);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    loadLocalData();
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
            await syncOnLoad();
        }
    }
    
    updateUIForLoginState();
    updateDisplay();
});
