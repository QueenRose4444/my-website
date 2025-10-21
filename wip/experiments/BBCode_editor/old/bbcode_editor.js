// bbcode_editor.js - Combined application logic with sync and auth functionality.

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
// -- SET YOUR APPLICATION NAME HERE --
// This MUST be unique for each application to keep data separate.
const APP_NAME = 'bbcode_editor'; // bbcode editor site data

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
// This is the main data model for the BBCode Editor application.
// It will be saved locally and synced to the server.
let state = {
    games: [],
    activeGameIndex: 0,
    settings: {
        titleColor: '#00ff00',
    },
    template: '', // Will be loaded from the DOM on init
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
// This function gets all DOM elements used by both the app and the sync system.
function getElements() {
    return {
        // App elements
        dropZone: document.getElementById('file-drop-zone'),
        fileInput: document.getElementById('file-input'),
        textInput: document.getElementById('text-input'),
        processTextBtn: document.getElementById('process-text-btn'),
        customizationPanel: document.getElementById('customization-panel'),
        gameSelector: document.getElementById('game-selector'),
        gameVersionContainer: document.getElementById('game-version-container'),
        simpleModeBtn: document.getElementById('simple-mode-btn'),
        advancedModeBtn: document.getElementById('advanced-mode-btn'),
        simpleModeControls: document.getElementById('simple-mode-controls'),
        advancedModeControls: document.getElementById('advanced-mode-controls'),
        templateEditor: document.getElementById('template-editor'),
        resetTemplateBtn: document.getElementById('reset-template-btn'),
        titleColorInput: document.getElementById('title-color'),
        urlInputsContainer: document.getElementById('url-inputs'),
        crackedOptionsContainer: document.getElementById('cracked-options'),
        patchNotesOptionsContainer: document.getElementById('patchnotes-options'),
        previewTabBtn: document.getElementById('preview-tab-btn'),
        codeTabBtn: document.getElementById('code-tab-btn'),
        previewPane: document.getElementById('preview-pane'),
        codePane: document.getElementById('code-pane'),
        outputCode: document.getElementById('output-code'),
        copyBtnTop: document.getElementById('copy-btn-top'),
        copyBtnBottom: document.getElementById('copy-btn-bottom'),
        downloadBtn: document.getElementById('download-btn'),

        // Auth/Sync elements
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
        loginError: document.getElementById("loginError"),
        registerError: document.getElementById("registerError"),
        changePasswordButton: document.getElementById("changePasswordButton"),
        changePasswordForm: document.getElementById("changePasswordForm"),
        changePasswordError: document.getElementById("changePasswordError"),
        changePasswordSuccess: document.getElementById("changePasswordSuccess"),
        exportDataButton: document.getElementById("exportData"),
        importDataInput: document.getElementById("importData"),
        importOldDataButton: document.getElementById("importOldData"),
        syncStatus: document.getElementById("syncStatus"),
    };
}

/************************************
 * Data Loading / Saving Logic
 ************************************/
function loadLocalData() {
    syncLog("Loading app data from localStorage...");
    try {
        const storedData = localStorage.getItem(`${storagePrefix}appData`);
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            // Merge loaded data with defaults to prevent errors if structure changes
            state = { ...state, ...parsedData };
        }
    } catch (e) {
        console.error("Error loading local data:", e);
        // Reset to default state on error
        state = { games: [], activeGameIndex: 0, settings: { titleColor: '#00ff00' }, template: '' };
    }
    // Always ensure the template is loaded from the DOM after any local data is loaded.
    state.template = state.template || document.getElementById('default-bbcode-template').innerHTML;
}

function saveLocalData() {
    syncLog("Saving app data to localStorage...");
    try {
        localStorage.setItem(`${storagePrefix}appData`, JSON.stringify(state));
    } catch (e) {
        console.error("Error saving local data:", e);
    }
}

// This function is called by event listeners to save data everywhere.
function saveData() {
    saveLocalData();
    if (currentUser && authToken) {
        saveBackendData();
    }
    // No need to call updateDisplay here, as it's usually called after the action that triggered saveData.
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
        // The server should return the complete 'state' object.
        return data;
    } catch (error) {
        console.error("Failed to fetch backend data:", error);
        return null;
    }
}

async function saveBackendData() {
    if (!currentUser || !authToken) return false;
    
    // The entire 'state' object is sent to the server.
    const dataToSave = state;

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
 * BBCode App Core Functions
 *******************************/
const sanitizeGameTitle = (title) => {
    return title.replace(/&/g, 'and').replace(/[^\w\s-]/gi, '').trim();
};

const parseInputText = (text) => {
    const parsedGames = {};
    
    const gameBlocks = text.split(/(?=\[url=)/).filter(block => block.trim().length > 10);
    const blockRegex = /\[b\](?<gameName>.+?)\s\[(?<platform>Win\d+|Linux\d+|Mac)\]\s\[Branch:\s(?<branch>[^\]]+)\].*?Version:\[\/b\]\s\[i\](?<fullDate>.+?UTC\s\[Build\s(?<buildId>\d+)\])/s;

    for (const block of gameBlocks) {
        const match = block.match(blockRegex);
        if (!match) continue;

        const { gameName, platform, branch, fullDate, buildId } = match.groups;
        const sanitizedTitle = sanitizeGameTitle(gameName);

        if (!parsedGames[sanitizedTitle]) {
            parsedGames[sanitizedTitle] = {
                gameTitle: sanitizedTitle,
                originalTitle: gameName,
                files: [],
                gameVersion: ''
            };
        }
        
        const shortDate = fullDate.split(' - ')[0];

        const existingFile = parsedGames[sanitizedTitle].files.find(f => f.platform === platform && f.branch === branch);
        if (!existingFile) {
            parsedGames[sanitizedTitle].files.push({
                platform,
                branch,
                fullDate,
                shortDate,
                buildId,
                cleanUrl: '',
                crackedUrl: '',
                patchNoteUrl: `https://steamdb.info/patchnotes/${buildId}/`,
                includeCracked: true,
                crackType: 'Cracked: Goldberg'
            });
        }
    }
    
    for (const key in parsedGames) {
        if (Object.hasOwnProperty.call(parsedGames, key)) {
            const game = parsedGames[key];
            game.files.sort((a, b) => {
                const getOrder = (platform) => {
                    if (platform.startsWith('Win')) return 1;
                    if (platform.startsWith('Linux')) return 2;
                    if (platform.startsWith('Mac')) return 3;
                    return 4;
                };
                return getOrder(a.platform) - getOrder(b.platform);
            });
        }
    }

    state.games = Object.values(parsedGames);
    if(state.games.length > 0) {
        state.activeGameIndex = 0;
        getElements().customizationPanel.classList.remove('hidden');
    } else {
        console.warn("Could not find any valid game data in the input.");
    }
    updateDisplay(); // This will update the UI
    saveData(); // This will save to local and backend
};

const handleFiles = (files) => {
    let combinedText = '';
    let filesRead = 0;
    if (files.length === 0) return;

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            combinedText += e.target.result + '\n\n';
            filesRead++;
            if (filesRead === files.length) {
                parseInputText(combinedText);
            }
        };
        reader.readAsText(file);
    });
};

const renderOutput = () => {
    const { outputCode, previewPane, copyBtnTop, copyBtnBottom, downloadBtn } = getElements();
     if (state.games.length === 0) {
         outputCode.value = '';
         previewPane.innerHTML = '<p class="text-gray-500">No data to display.</p>';
         [copyBtnTop, copyBtnBottom, downloadBtn].forEach(btn => btn.disabled = true);
         return;
     }
    
    const activeGame = state.games[state.activeGameIndex];
    if (!activeGame) return;

    let processedTemplate = state.template;

    const gameVersionExists = activeGame.gameVersion && activeGame.gameVersion.trim() !== '';
    const versionIfRegex = /<!--IF:gameVersion-->([\s\S]*?)<!--\/IF:gameVersion-->/s;
    processedTemplate = processedTemplate.replace(versionIfRegex, (match, innerContent) => {
        return gameVersionExists ? applyTemplate(innerContent, { gameVersion: activeGame.gameVersion }) : '';
    });

    const crackedExists = activeGame.files.some(f => f.includeCracked);
    const ifRegex = /<!--IF:crackedExists-->([\s\S]*?)<!--\/IF:crackedExists-->/s;
    processedTemplate = processedTemplate.replace(ifRegex, crackedExists ? '$1' : '');

    const loopRegex = /<!--LOOP:(\w+)-->([\s\S]*?)<!--\/LOOP:\1-->/gs;
    processedTemplate = processedTemplate.replace(loopRegex, (match, loopType, loopContent) => {
        let items;
        if (loopType === 'cleanFiles' || loopType === 'patchNotes') items = activeGame.files;
        else if (loopType === 'crackedFiles') items = activeGame.files.filter(f => f.includeCracked);
        else return '';

        if (!items || items.length === 0) return '';

        const trimmedLoopContent = loopContent.trim();
        return items.map(file => {
            const templateData = { 
                file: file, 
                gameTitle: activeGame.originalTitle, 
                titleColor: state.settings.titleColor 
            };
            return applyTemplate(trimmedLoopContent, templateData);
        }).join('\n\n');
    });

    const finalOutput = processedTemplate.trim();
    outputCode.value = finalOutput;
    renderPreview(finalOutput);
    [copyBtnTop, copyBtnBottom, downloadBtn].forEach(btn => btn.disabled = false);
};

const applyTemplate = (template, data) => {
    return template.replace(/\{([\w.]+)\}/g, (match, key) => {
        const keys = key.split('.');
        let value = data;
        for (const k of keys) {
            if (value && typeof value === 'object' && k in value) {
                value = value[k];
            } else { return match; }
        }
        return value !== undefined ? value : match;
    });
};

const renderPreview = (bbcode) => {
    let html = bbcode
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\[url=([^\]]*)\](.*?)\[\/url\]/gs, (match, url, text) => {
            const hrefAttr = url ? `href="${url}"` : '';
            return `<a ${hrefAttr} class="postlink" target="_blank" rel="nofollow">${text}</a>`;
        })
        .replace(/(?<!href=")(?<!\[url=])(https?:\/\/[^\s<\]\[]+)/g, '<a href="$1" class="postlink" target="_blank" rel="nofollow">$1</a>')
        .replace(/\n/g, '<br>')
        .replace(/\[b\](.*?)\[\/b\]/gs, '<span style="font-weight: bold;">$1</span>')
        .replace(/\[i\](.*?)\[\/i\]/gs, '<span style="font-style: italic;">$1</span>')
        .replace(/\[color=(.*?)\](.*?)\[\/color\]/gs, '<span style="color: $1;">$2</span>')
        .replace(/\[size=(.*?)\](.*?)\[\/size\]/gs, '<span style="font-size: $1%; line-height: normal;">$2</span>');
    
    getElements().previewPane.innerHTML = `<div class="postbody">${html}</div>`;
};

const handleCopyClick = async (button) => {
    const { outputCode } = getElements();
    if (!outputCode.value) return;
    const originalText = button.textContent;
    try {
        await navigator.clipboard.writeText(outputCode.value);
        button.textContent = 'Copied!';
    } catch (err) {
        console.warn('Clipboard API failed, falling back to execCommand.', err);
        outputCode.select();
        outputCode.setSelectionRange(0, 99999);
        if (document.execCommand('copy')) {
            button.textContent = 'Copied!';
        } else {
            button.textContent = 'Copy Failed';
        }
        window.getSelection().removeAllRanges();
    } finally {
        setTimeout(() => { button.textContent = originalText; }, 2000);
    }
};

/*******************************
 * Update & Display Functions
 *******************************/
// This is the main UI update function for the BBCode app.
// It's called by the sync system's updateDisplay.
const updateGameSelector = () => {
    const { gameSelector } = getElements();
    gameSelector.innerHTML = '';
    state.games.forEach((game, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = game.gameTitle;
        if (index === state.activeGameIndex) {
            option.selected = true;
        }
        gameSelector.appendChild(option);
    });
};

const updateUIForActiveGame = () => {
    const { 
        customizationPanel, gameVersionContainer, titleColorInput, 
        urlInputsContainer, crackedOptionsContainer, patchNotesOptionsContainer,
        templateEditor
    } = getElements();

    if (state.games.length === 0) {
        customizationPanel.classList.add('hidden');
        renderOutput(); // Clear output panes
        return;
    } else {
        customizationPanel.classList.remove('hidden');
    }

    const activeGame = state.games[state.activeGameIndex];
    if (!activeGame) return;

    gameVersionContainer.innerHTML = `
        <label for="game-version-input" class="block text-sm font-medium text-gray-300">Optional Game Version (e.g., 1.1.1.G)</label>
        <input type="text" id="game-version-input" value="${activeGame.gameVersion || ''}" class="w-full mt-1 p-2 bg-gray-900 border border-gray-700 rounded-md text-sm">
    `;

    titleColorInput.value = state.settings.titleColor;
    
    urlInputsContainer.innerHTML = '';
    crackedOptionsContainer.innerHTML = '';
    patchNotesOptionsContainer.innerHTML = '';

    activeGame.files.forEach((file, index) => {
        const urlGroup = document.createElement('div');
        urlGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
        urlGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
            <label class="block text-xs font-medium text-gray-400">Clean File URL</label>
            <input type="text" data-file-index="${index}" data-prop="cleanUrl" value="${file.cleanUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
            <div id="cracked-url-container-${index}" class="${file.includeCracked ? '' : 'hidden'}">
                <label class="block text-xs font-medium text-gray-400 mt-2">Cracked File URL</label>
                <input type="text" data-file-index="${index}" data-prop="crackedUrl" value="${file.crackedUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
            </div>`;
        urlInputsContainer.appendChild(urlGroup);

        const crackGroup = document.createElement('div');
        crackGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
        crackGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
             <div class="flex items-center justify-between">
                <label class="text-sm text-gray-300">Include Cracked Version</label>
                <input type="checkbox" data-file-index="${index}" data-prop="includeCracked" ${file.includeCracked ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
             </div>
             <div id="crack-type-container-${index}" class="${file.includeCracked ? '' : 'hidden'} mt-2">
                <label class="block text-xs font-medium text-gray-400">Crack Type</label>
                <select data-file-index="${index}" data-prop="crackType" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
                    <option value="Cracked: Goldberg" ${file.crackType === 'Cracked: Goldberg' ? 'selected' : ''}>Goldberg</option>
                    <option value="Cracked: Goldberg + Steamless" ${file.crackType === 'Cracked: Goldberg + Steamless' ? 'selected' : ''}>Goldberg + Steamless</option>
                    <option value="custom">Custom</option>
                </select>
                <input type="text" data-file-index="${index}" data-prop="customCrackType" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm ${file.crackType.startsWith('Cracked:') ? 'hidden' : ''}" placeholder="Enter custom crack name" value="${!file.crackType.startsWith('Cracked:') ? file.crackType : ''}">
             </div>`;
        crackedOptionsContainer.appendChild(crackGroup);

        const patchNotesGroup = document.createElement('div');
        patchNotesGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
        patchNotesGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
            <label class="block text-xs font-medium text-gray-400">Patch Notes URL</label>
            <input type="text" data-file-index="${index}" data-prop="patchNoteUrl" value="${file.patchNoteUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">`;
        patchNotesOptionsContainer.appendChild(patchNotesGroup);
    });

    templateEditor.value = state.template;
    renderOutput();
};

// This function is the single entry point for refreshing the app's UI.
function updateDisplay() {
    syncLog("updateDisplay called. App state will be refreshed.");
    updateGameSelector();
    updateUIForActiveGame();
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
    // Deep copy to avoid modifying original data
    const dataCopy = JSON.parse(JSON.stringify(dataSet));
    // Sort games and files within games to ensure consistent string representation
    if (dataCopy.games) {
        dataCopy.games.forEach(game => {
            if (game.files) {
                game.files.sort((a, b) => (a.platform + a.branch).localeCompare(b.platform + b.branch));
            }
        });
        dataCopy.games.sort((a, b) => a.gameTitle.localeCompare(b.gameTitle));
    }
    return JSON.stringify(dataCopy);
}

function generateDataSummary(dataSet) {
    if (!dataSet || !dataSet.games) return { lastUpdate: 'N/A', entryCount: '0 games' };
    
    const gameCount = dataSet.games.length;
    // For this app, a simple count is a good summary.
    // A "last updated" timestamp isn't stored per-game, so we'll omit it.
    return {
        lastUpdate: null, // No reliable timestamp available
        entryCount: `${gameCount} game(s)`,
    };
}

function showSyncChoiceModal(localSummary, serverSummary, serverData) {
    const modal = document.getElementById('syncChoiceModal');
    if (!modal) return;

    document.getElementById('localLastUpdate').textContent = 'N/A';
    document.getElementById('localEntryCount').textContent = localSummary.entryCount;

    document.getElementById('serverLastUpdate').textContent = 'N/A';
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
        state = serverData; // Overwrite local state with server data
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
    const username = elements.loginForm.loginUsername.value.trim();
    const password = elements.loginForm.loginPassword.value;
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
        const localData = state;
        
        const hasLocalData = (localData.games?.length || 0) > 0;
        const hasServerData = serverData && ((serverData.games?.length || 0) > 0);
        
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
                state = serverData;
            }
        } else if (hasServerData && !hasLocalData) {
             syncLog("No local data, but server data exists. Downloading server data.");
             state = serverData;
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
    const username = elements.registerForm.registerUsername.value.trim();
    const password = elements.registerForm.registerPassword.value;
    if (password !== elements.registerForm.registerConfirmPassword.value) {
        elements.registerError.textContent = 'Passwords do not match.'; return;
    }
    try {
        const response = await fetch(REGISTER_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error);
        alert("Registration successful! Please log in.");
        elements.registerModal.style.display = 'none';
        elements.loginModal.style.display = 'block';
        elements.loginForm.loginUsername.value = username;
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
    const currentPassword = elements.changePasswordForm.currentPassword.value;
    const newPassword = elements.changePasswordForm.newPassword.value;
    if (newPassword !== elements.changePasswordForm.confirmNewPassword.value) {
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
    const dataToExport = state;
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
                // Basic check to see if the data structure is likely correct
                if (data.games !== undefined && data.settings !== undefined) {
                    state = data;
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

// --- NEW: Function to import data from the old cache key ---
function importOldLocalData() {
    const oldCacheKey = 'gameInfoFormatterCache';
    const oldData = localStorage.getItem(oldCacheKey);

    if (!oldData) {
        showSyncStatus("No old data found to import.", "error");
        return;
    }

    if (!confirm("This will import data from the previous version of this tool. It may overwrite some of your current data. Continue?")) {
        return;
    }

    try {
        const parsedOldData = JSON.parse(oldData);
        if (parsedOldData.games) {
            // Merge old data into the current state
            state.games = parsedOldData.games;
            state.activeGameIndex = parsedOldData.activeGameIndex || 0;
            
            saveData(); // Save the newly merged data
            updateDisplay(); // Refresh the UI
            showSyncStatus("Successfully imported old data!", "success");
        } else {
            throw new Error("Old data is in an invalid format.");
        }
    } catch (error) {
        showSyncStatus(`Failed to import old data: ${error.message}`, "error");
    }
}

/********************************
 * Event Listeners Setup
 ********************************/
function setupEventListeners() {
    const elements = getElements();
    if (!elements.loginButton) return;

    // --- App Listeners ---
    elements.dropZone.addEventListener('click', () => elements.fileInput.click());
    elements.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); elements.dropZone.classList.add('dragover'); });
    elements.dropZone.addEventListener('dragleave', () => elements.dropZone.classList.remove('dragover'));
    elements.dropZone.addEventListener('drop', (e) => { e.preventDefault(); elements.dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    elements.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    elements.processTextBtn.addEventListener('click', () => { if (elements.textInput.value.trim()) { parseInputText(elements.textInput.value); } });
    elements.gameSelector.addEventListener('change', (e) => { state.activeGameIndex = parseInt(e.target.value, 10); updateUIForActiveGame(); });
    elements.simpleModeBtn.addEventListener('click', () => {
        elements.simpleModeBtn.classList.add('active'); elements.advancedModeBtn.classList.remove('active');
        elements.simpleModeControls.classList.remove('hidden'); elements.advancedModeControls.classList.add('hidden');
    });
    elements.advancedModeBtn.addEventListener('click', () => {
        elements.advancedModeBtn.classList.add('active'); elements.simpleModeBtn.classList.remove('active');
        elements.advancedModeControls.classList.remove('hidden'); elements.simpleModeControls.classList.add('hidden');
    });
    elements.previewTabBtn.addEventListener('click', () => {
        elements.previewTabBtn.classList.add('active'); elements.codeTabBtn.classList.remove('active');
        elements.previewPane.classList.remove('hidden'); elements.codePane.classList.add('hidden');
    });
    elements.codeTabBtn.addEventListener('click', () => {
        elements.codeTabBtn.classList.add('active'); elements.previewTabBtn.classList.remove('active');
        elements.codePane.classList.remove('hidden'); elements.previewPane.classList.add('hidden');
    });
    elements.titleColorInput.addEventListener('input', (e) => { state.settings.titleColor = e.target.value; renderOutput(); });
    elements.customizationPanel.addEventListener('input', (e) => {
        const target = e.target;
        const activeGame = state.games[state.activeGameIndex];
        if (!activeGame) return;

        if (target.id === 'game-version-input') {
            activeGame.gameVersion = target.value;
        }

        const fileIndex = target.dataset.fileIndex;
        if (fileIndex !== undefined) {
            const file = activeGame.files[fileIndex];
            const prop = target.dataset.prop;

            if (prop === 'includeCracked') {
                file.includeCracked = target.checked;
                updateUIForActiveGame();
            } else if (prop === 'crackType') {
                const customInput = target.closest('.p-3').querySelector('[data-prop="customCrackType"]');
                if (target.value === 'custom') {
                    customInput.classList.remove('hidden');
                    file.crackType = customInput.value || 'Custom';
                } else {
                    customInput.classList.add('hidden');
                    file.crackType = target.value;
                }
            } else if (prop === 'customCrackType') {
                 file.crackType = target.value || 'Custom';
            } else if (prop === 'patchNoteUrl') {
                file.patchNoteUrl = target.value;
                const buildIdMatch = target.value.match(/\/(\d+)\/?$/);
                if (buildIdMatch && buildIdMatch[1]) {
                    file.buildId = buildIdMatch[1];
                }
            } else if (prop) {
                file[prop] = target.value;
            }
        }
        renderOutput();
        saveData();
    });
    elements.templateEditor.addEventListener('input', (e) => { state.template = e.target.value; renderOutput(); saveData(); });
    elements.resetTemplateBtn.addEventListener('click', () => {
        state.template = document.getElementById('default-bbcode-template').innerHTML;
        elements.templateEditor.value = state.template;
        renderOutput();
        saveData();
    });
    elements.copyBtnTop.addEventListener('click', () => handleCopyClick(elements.copyBtnTop));
    elements.copyBtnBottom.addEventListener('click', () => handleCopyClick(elements.copyBtnBottom));
    elements.downloadBtn.addEventListener('click', () => {
        if (state.games.length === 0 || !elements.outputCode.value) return;
        const activeGame = state.games[state.activeGameIndex];
        const blob = new Blob([elements.outputCode.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeGame.gameTitle}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // --- Auth/Sync Listeners ---
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
    elements.importOldDataButton.addEventListener('click', importOldLocalData);

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
        
        state = serverData; // Overwrite local state with server data

        syncLog("Sync successful. Local data has been overwritten from server.");
        saveLocalData();
        updateDisplay();

    } catch (error) {
        console.error("An error occurred during automatic sync-on-load:", error);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Load any local data first
    loadLocalData();
    
    // 2. Set up all event listeners
    setupEventListeners();
    
    // 3. Handle authentication state
    authToken = localStorage.getItem(`${storagePrefix}authToken`);
    refreshToken = localStorage.getItem(`${storagePrefix}refreshToken`);

    if (refreshToken) {
        if (isTokenExpired(authToken)) {
            await attemptRefreshToken();
        } else {
            currentUser = decodeJwtPayload(authToken);
        }
        
        // 4. If logged in, perform initial data sync from server
        if (currentUser) {
            await syncOnLoad();
        }
    }
    
    // 5. Update UI based on final state (auth and data)
    updateUIForLoginState();
    updateDisplay();
});
