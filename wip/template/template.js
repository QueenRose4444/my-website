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
let appData = {
    // Example: Simple counter and list
    counter: 0,
    items: [],
    settings: {
        exampleSetting: 'default'
    }
};

// Storage key for local data (includes environment)
const LOCAL_STORAGE_KEY = `${APP_NAME}_${ENVIRONMENT}_data`;

/*************************************
 * AUTHENTICATION SETUP
 *************************************/
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
 * SERVER DATA SYNC
 ************************************/
async function fetchBackendData() {
    if (!authManager.isLoggedIn()) {
        appLog("Not logged in, cannot fetch backend data.");
        return null;
    }

    try {
        appLog("Fetching data from server...");
        const response = await authManager.fetchWithAuth(authManager.endpoints.data, {
            method: 'GET'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to fetch data');
        }

        const data = await response.json();
        appLog("Backend data fetched:", data);
        return data;
    } catch (error) {
        console.error("Failed to fetch backend data:", error);
        return null;
    }
}

async function saveBackendData() {
    if (!authManager.isLoggedIn()) {
        appLog("Not logged in, cannot save backend data.");
        return false;
    }

    try {
        appLog("Saving data to server...");
        const response = await authManager.fetchWithAuth(authManager.endpoints.data, {
            method: 'POST',
            body: JSON.stringify(appData)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to save data');
        }

        appLog("Backend data saved successfully.");
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
/**
 * Creates a canonical string representation of data for comparison.
 * Customize this based on your app's data structure.
 */
function getCanonicalString(data) {
    if (!data) return null;
    
    // Deep copy to avoid modifying original
    const dataCopy = JSON.parse(JSON.stringify(data));
    
    // Sort arrays if order doesn't matter
    if (dataCopy.items) {
        dataCopy.items.sort();
    }
    
    // Return a consistent JSON string
    return JSON.stringify(dataCopy);
}

/**
 * Generates a human-readable summary of the data.
 * Customize this based on what's meaningful for your app.
 */
function generateDataSummary(data) {
    if (!data) {
        return {
            lastUpdate: 'N/A',
            summary: 'No data'
        };
    }

    // Example: Count items and show counter value
    const itemCount = data.items ? data.items.length : 0;
    const counter = data.counter || 0;

    return {
        lastUpdate: 'N/A', // Add timestamp to your data model if needed
        summary: `Counter: ${counter}, Items: ${itemCount}`
    };
}

/**
 * Shows the sync choice modal when local and server data differ.
 */
function showSyncChoiceModal(localSummary, serverSummary, serverData) {
    const elements = getElements();
    
    // Populate the comparison UI
    elements.localLastUpdate.textContent = localSummary.lastUpdate;
    elements.localSummary.textContent = localSummary.summary;
    elements.serverLastUpdate.textContent = serverSummary.lastUpdate;
    elements.serverSummary.textContent = serverSummary.summary;

    // Set up button handlers (remove old listeners first)
    const uploadHandler = async () => {
        appLog("User chose LOCAL data. Uploading to server...");
        await saveBackendData();
        elements.syncChoiceModal.style.display = 'none';
    };

    const downloadHandler = () => {
        appLog("User chose SERVER data. Overwriting local...");
        appData = serverData;
        saveLocalData();
        updateDisplay();
        elements.syncChoiceModal.style.display = 'none';
    };

    // Replace buttons to remove old event listeners
    const newUploadBtn = elements.useLocalDataBtn.cloneNode(true);
    const newDownloadBtn = elements.useServerDataBtn.cloneNode(true);
    elements.useLocalDataBtn.replaceWith(newUploadBtn);
    elements.useServerDataBtn.replaceWith(newDownloadBtn);

    // Add new listeners
    document.getElementById('useLocalDataBtn').addEventListener('click', uploadHandler);
    document.getElementById('useServerDataBtn').addEventListener('click', downloadHandler);

    // Show the modal
    elements.syncChoiceModal.style.display = 'block';
}

/**
 * Main sync logic - compares local and server data.
 */
async function performDataSync() {
    if (!authManager.isLoggedIn()) {
        appLog("Not logged in, skipping sync.");
        return;
    }

    appLog("Performing data sync check...");
    const serverData = await fetchBackendData();

    const hasLocalData = appData.items.length > 0 || appData.counter > 0;
    const hasServerData = serverData && (serverData.items?.length > 0 || serverData.counter > 0);

    if (hasLocalData && !hasServerData) {
        appLog("Local data exists but server is empty. Prompting upload...");
        if (confirm("No data found on server. Upload your local data to your account?")) {
            await saveBackendData();
        }
    } else if (hasServerData) {
        const localString = getCanonicalString(appData);
        const serverString = getCanonicalString(serverData);

        if (localString !== serverString) {
            appLog("Data mismatch detected. Showing sync choice modal...");
            const localSummary = generateDataSummary(appData);
            const serverSummary = generateDataSummary(serverData);
            showSyncChoiceModal(localSummary, serverSummary, serverData);
        } else {
            appLog("Data is in sync.");
            appData = serverData;
            saveLocalData();
        }
    } else if (hasServerData && !hasLocalData) {
        appLog("Server has data but local is empty. Downloading...");
        appData = serverData;
        saveLocalData();
    } else {
        appLog("No data locally or on server.");
    }

    updateDisplay();
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
// Listen for auth events from AuthManager
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

    // 2. Set up event listeners
    setupEventListeners();

    // 3. Initialize authentication (will restore session if available)
    await authManager.initialize();

    // 4. Update UI based on final state
    updateUIForLoginState();
    updateDisplay();

    appLog("Application initialized.");
});