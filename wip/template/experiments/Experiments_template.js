// Experiments_template.js - Updated to use AuthManager

/*************************************
 * APPLICATION CONFIGURATION
 *************************************/
// -- SET YOUR APPLICATION NAME HERE --
// This MUST be unique for each application to keep data separate.
const APP_NAME = 'experiments-template'; 

// SET THE ENVIRONMENT HERE: 'live' or 'wip'
const ENVIRONMENT = 'wip'; 

// Logging helper
const LOGGING_ENABLED = ENVIRONMENT === 'wip';
function syncLog(...args) {
    if (LOGGING_ENABLED) {
        console.log('[EXP_LOG]', ...args);
    }
}

/*************************************
 * APPLICATION DATA MODEL
 *************************************/
// Define your app's data structure here
// This is what gets saved locally and synced to the server
let userNotes = []; // Example data
let appPreferences = {}; // Example data

// Default settings
const defaultPreferences = {
    theme: "dark",
    fontSize: "medium",
};

// Storage key prefix (includes environment to prevent clashes)
const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;


/*************************************
 * AUTHENTICATION SETUP
 *************************************/
// Initialize the global AuthManager
const authManager = new AuthManager(APP_NAME, ENVIRONMENT);


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
function loadLocalData() {
    syncLog("Loading local data...");
    try {
        const storedNotes = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}userNotes`) || "[]");
        userNotes = storedNotes.map(note => ({ ...note, createdAt: new Date(note.createdAt) }));

        const storedPrefs = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}appPreferences`) || "{}");
        appPreferences = { ...defaultPreferences, ...storedPrefs };
    } catch (e) {
        console.error("Error loading local data:", e);
        userNotes = [];
        appPreferences = { ...defaultPreferences };
    }
}

function saveLocalData() {
    syncLog("Saving local data...");
    try {
        localStorage.setItem(`${STORAGE_PREFIX}userNotes`, JSON.stringify(userNotes));
        localStorage.setItem(`${STORAGE_PREFIX}appPreferences`, JSON.stringify(appPreferences));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}


/************************************
 * SERVER DATA SYNC
 ************************************/
async function fetchBackendData() {
    if (!authManager.isLoggedIn()) {
        syncLog("Not logged in, skipping fetch.");
        return null;
    }

    try {
        const response = await authManager.fetchWithAuth(authManager.endpoints.data, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch data');
        }

        const data = await response.json();
        
        // Process dates coming from server
        data.userNotes = (data.userNotes || []).map(note => ({ ...note, createdAt: new Date(note.createdAt) }));
        data.appPreferences = { ...defaultPreferences, ...(data.appPreferences || {}) };
        
        return data;
    } catch (error) {
        console.error("Failed to fetch backend data:", error);
        return null;
    }
}

async function saveBackendData() {
    if (!authManager.isLoggedIn()) return false;
    
    const dataToSave = {
        userNotes,
        appPreferences
    };

    try {
        const response = await authManager.fetchWithAuth(authManager.endpoints.data, {
            method: 'POST',
            body: JSON.stringify(dataToSave)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save');
        }

        syncLog("Backend save successful.");
        return true;
    } catch (error) {
        console.error("Failed to save backend data:", error);
        alert(`Failed to save data to server: ${error.message}`);
        return false;
    }
}

/************************************
 * DATA COMPARISON & SYNC LOGIC
 ************************************/
function getCanonicalString(dataSet) {
    if (!dataSet) return null;
    const dataCopy = JSON.parse(JSON.stringify(dataSet));

    // CUSTOMIZE: Ensure arrays are sorted and data is consistent for string comparison
    const processedNotes = (dataCopy.userNotes || [])
        .map(n => ({ ...n, createdAt: new Date(n.createdAt).getTime() }))
        .sort((a, b) => a.createdAt - b.createdAt);
        
    const preferencesToCompare = { ...defaultPreferences, ...(dataCopy.appPreferences || {}) };
    
    const finalObject = {
        appPreferences: preferencesToCompare,
        userNotes: processedNotes,
    };
    return JSON.stringify(finalObject);
}

function generateDataSummary(dataSet) {
    if (!dataSet) return { lastUpdate: 'N/A', entryCount: '0 entries' };
    
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
    const elements = getElements();
    
    // Format dates for display
    const formatDate = (d) => d ? d.toLocaleString() : 'N/A';

    elements.localLastUpdate.textContent = localSummary.lastUpdate ? formatDate(localSummary.lastUpdate) : 'No entries';
    elements.localEntryCount.textContent = localSummary.entryCount;

    elements.serverLastUpdate.textContent = serverSummary.lastUpdate ? formatDate(serverSummary.lastUpdate) : 'No entries';
    elements.serverEntryCount.textContent = serverSummary.entryCount;

    // Define handlers
    const uploadHandler = async () => {
        syncLog("User chose LOCAL data.");
        await saveBackendData();
        elements.syncChoiceModal.style.display = 'none';
    };

    const downloadHandler = () => {
        syncLog("User chose SERVER data.");
        userNotes = serverData.userNotes;
        appPreferences = serverData.appPreferences;
        saveLocalData();
        updateDisplay();
        elements.syncChoiceModal.style.display = 'none';
    };
    
    // Clear old listeners by cloning
    const newUploadBtn = elements.useLocalDataBtn.cloneNode(true);
    const newDownloadBtn = elements.useServerDataBtn.cloneNode(true);
    elements.useLocalDataBtn.replaceWith(newUploadBtn);
    elements.useServerDataBtn.replaceWith(newDownloadBtn);
    
    newUploadBtn.addEventListener('click', uploadHandler);
    newDownloadBtn.addEventListener('click', downloadHandler);

    elements.syncChoiceModal.style.display = 'block';
}

async function performDataSync() {
    if (!authManager.isLoggedIn()) return;

    syncLog("Checking for data sync...");
    const serverData = await fetchBackendData();
    const localData = { userNotes, appPreferences };

    const hasLocalData = (localData.userNotes?.length || 0) > 0;
    const hasServerData = serverData && ((serverData.userNotes?.length || 0) > 0);

    if (hasLocalData && !hasServerData) {
        if (confirm("No data found on server. Upload your local data?")) {
            await saveBackendData();
        }
    } else if (hasServerData) {
        const localString = getCanonicalString(localData);
        const serverString = getCanonicalString(serverData);

        if (localString !== serverString) {
            syncLog("Data mismatch. Prompting user.");
            const localSummary = generateDataSummary(localData);
            const serverSummary = generateDataSummary(serverData);
            showSyncChoiceModal(localSummary, serverSummary, serverData);
        } else {
            syncLog("Data is synced.");
            userNotes = serverData.userNotes;
            appPreferences = serverData.appPreferences;
            saveLocalData();
            updateDisplay();
        }
    } else if (hasServerData && !hasLocalData) {
        syncLog("Downloading server data...");
        userNotes = serverData.userNotes;
        appPreferences = serverData.appPreferences;
        saveLocalData();
        updateDisplay();
    }
}


/*******************************
 * UI Update
 *******************************/
function updateDisplay() {
    console.log("UI Updated. Notes:", userNotes);
    // Add your UI rendering logic here
}

function updateUIForLoginState() {
    const elements = getElements();
    if (!elements.loginButton) return;

    const isLoggedIn = authManager.isLoggedIn();
    const user = authManager.currentUser;

    elements.loginButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.registerButton.style.display = isLoggedIn ? 'none' : 'inline-block';
    elements.logoutButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    
    elements.userStatus.textContent = isLoggedIn ? `Logged in: ${user?.username}` : 'Not logged in (Local)';
    elements.userStatus.style.color = isLoggedIn ? '#4bc0c0' : '#ccc';
    
    if(elements.changePasswordButton) {
        elements.changePasswordButton.style.display = isLoggedIn ? 'inline-block' : 'none';
    }
}


/********************************
 * Helper Functions (File IO)
 ********************************/
function showSyncStatus(message, type = "info") {
    const el = getElements().syncStatus;
    if(el) { 
        el.textContent = message; 
        el.className = `sync-status-${type}`; 
        setTimeout(() => {el.textContent=''; el.className='';}, 5000); 
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

function importDataFromFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (confirm("Import will overwrite current local data. Proceed?")) {
                if (data.appPreferences) {
                    userNotes = data.userNotes || [];
                    appPreferences = { ...defaultPreferences, ...data.appPreferences };
                    saveLocalData();
                    updateDisplay();
                    showSyncStatus("Import successful!", "success");
                    
                    if(authManager.isLoggedIn() && confirm("Upload imported data to server?")) {
                         await saveBackendData();
                    }
                } else {
                    throw new Error("Invalid file format");
                }
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
    
    // Auth Forms using AuthManager
    elements.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.loginError.textContent = '';
        try {
            await authManager.login(elements.loginUsername.value.trim(), elements.loginPassword.value);
            // 'auth:login' event will trigger the UI update and sync
        } catch (err) {
            elements.loginError.textContent = err.message;
        }
    });

    elements.registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        elements.registerError.textContent = '';
        const user = elements.registerUsername.value.trim();
        const pass = elements.registerPassword.value;
        const confirm = elements.registerConfirmPassword.value;
        
        if (pass !== confirm) {
            elements.registerError.textContent = 'Passwords do not match.';
            return;
        }

        try {
            await authManager.register(user, pass);
            alert("Registration successful! Please log in.");
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
            const cur = elements.currentPassword.value;
            const newP = elements.newPassword.value;
            const conf = elements.confirmNewPassword.value;

            if (newP !== conf) {
                elements.changePasswordError.textContent = "New passwords do not match.";
                return;
            }
            try {
                await authManager.changePassword(cur, newP);
                // 'auth:password-changed' event will handle cleanup
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

    // Close Modals
    document.body.addEventListener('click', (e) => {
        const modal = e.target.closest('.modal, .auth-modal, .sync-modal');
        if (!modal || modal.id === 'syncChoiceModal') return;
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
    updateDisplay(); // clear sensitive data from UI if needed
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
    loadLocalData();
    setupEventListeners();
    
    // AuthManager handles the initialization of tokens and user state
    await authManager.initialize();
    
    updateUIForLoginState();
    updateDisplay();
});