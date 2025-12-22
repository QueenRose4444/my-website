// bbcode_editor.js - Combined application logic with sync, auth, and collapsible modules.
// UPDATED: Now uses the global AuthManager for cross-tab login syncing.

/*************************************
 * APPLICATION & ENVIRONMENT CONFIGURATION
 *************************************/
const APP_NAME = 'bbcode_editor';
const ENVIRONMENT = 'live';

const LOGGING_ENABLED = ENVIRONMENT === 'wip';
const STORAGE_PREFIX = `${APP_NAME}_${ENVIRONMENT}_`;
function syncLog(...args) { if (LOGGING_ENABLED) console.log('[SYNC_LOG]', ...args); }

/*************************************
 * Global State
 *************************************/
let state = {
    games: [],
    activeGameIndex: 0,
    presets: [],
    settings: {
        cleanUrlColor: '#00aa00',
        crackedUrlColor: '#00babd',
        useSameUrlColor: false,
        sectionTitleColor: '#ee11d5',
        patchNotesMode: 'multiple',
        patchNotesTitle: '',
        showVersionLabel: true, // Top Game Version
        showPatchNotesVersionLabel: true, // Patch Notes Version (New separate toggle)
    },
    template: '',
};

let templates = {};

// --- Auth State (via AuthManager) ---
let authManager = null; // Will be initialized in DOMContentLoaded

/***********************
 * DOM Elements
 ***********************/
function getElements() {
    return {
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

        // Collapsible Controls
        expandAllBtn: document.getElementById('expand-all-btn'),
        collapseAllBtn: document.getElementById('collapse-all-btn'),

        mainGroupContainer: document.getElementById('main-group-container'),
        customGroupsContainer: document.getElementById('custom-groups-container'),
        addCustomGroupBtn: document.getElementById('add-custom-group-btn'),
        presetSelector: document.getElementById('preset-selector'),
        loadPresetBtn: document.getElementById('load-preset-btn'),
        savePresetBtn: document.getElementById('save-preset-btn'),

        crackTogglesContainer: document.getElementById('crack-toggles-container'),
        updatesContainer: document.getElementById('updates-container'),
        addUpdateBtn: document.getElementById('add-update-btn'),

        patchNotesOptionsContainer: document.getElementById('patchnotes-options'),
        patchNotesUrlContainer: document.getElementById('patchnotes-url-container'),
        patchNotesTitleInput: document.getElementById('patchnotes-title-input'),
        patchNotesModeToggle: document.getElementById('patchnotes-mode-toggle'),
        patchNotesVersionToggle: document.getElementById('patchnotes-version-toggle'),

        cleanUrlColorInput: document.getElementById('clean-url-color'),
        crackedUrlColorInput: document.getElementById('cracked-url-color'),
        useSameUrlColorCheckbox: document.getElementById('use-same-url-color'),
        sectionTitleColorInput: document.getElementById('section-title-color'),

        templateEditor: document.getElementById('template-editor'),
        resetTemplateBtn: document.getElementById('reset-template-btn'),
        previewTabBtn: document.getElementById('preview-tab-btn'),
        codeTabBtn: document.getElementById('code-tab-btn'),
        previewPane: document.getElementById('preview-pane'),
        codePane: document.getElementById('code-pane'),
        outputCode: document.getElementById('output-code'),
        copyBtnTop: document.getElementById('copy-btn-top'),
        copyBtnBottom: document.getElementById('copy-btn-bottom'),
        downloadBtn: document.getElementById('download-btn'),

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
 * Data Loading & Templates
 ************************************/
async function loadTemplates() {
    const defaultTemplate = `<!--IF:gameVersion--><!--IF:showVersionLabel-->Version: <!--/IF:showVersionLabel-->{gameVersion}

<!--/IF:gameVersion--><!--IF:customGroups-->{mainGroupTitle}
<!--/IF:customGroups-->[color={sectionTitleColor}]Clean Steam Files:[/color]
<!--LOOP:cleanFiles-->[url={file.cleanUrl}][color={cleanUrlColor}][b]{gameTitle} [{file.platform}] [Branch: {file.branch}] (Clean Steam Files)[/b][/color][/url]
[size=85][color=white][b] [{file.platform}] [{file.branch}] Version:[/b] [i]{file.shortDate} [Build {file.buildId}][/i][/color][/size]

<!--/LOOP:cleanFiles--><!--IF:crackedExists-->[color={sectionTitleColor}]Cracked:[/color]
<!--LOOP:crackedFiles-->[url={file.crackedUrl}][color={crackedUrlColor}][b]{gameTitle} [{file.platform}] [Branch: {file.branch}] ({file.crackType})[/b][/color][/url]
[size=85][color=white][b] [{file.platform}] [{file.branch}] Version:[/b] [i]{file.shortDate} [Build {file.buildId}][/i][/color][/size]

<!--/LOOP:crackedFiles--><!--/IF:crackedExists--><!--LOOP:customGroups-->[spoiler="{group.title}"][color={sectionTitleColor}]Clean Steam Files:[/color]
<!--LOOP:groupCleanFiles-->[url={file.cleanUrl}][color={cleanUrlColor}][b]{gameTitle} [{file.platform}] [Branch: {file.branch}] (Clean Steam Files)[/b][/color][/url]
[size=85][color=white][b] [{file.platform}] [{file.branch}] Version:[/b] [i]{file.shortDate} [Build {file.buildId}][/i][/color][/size]

<!--/LOOP:groupCleanFiles--><!--IF:crackedExists-->[color={sectionTitleColor}]Cracked:[/color]
<!--LOOP:groupCrackedFiles-->[url={file.crackedUrl}][color={crackedUrlColor}][b]{gameTitle} [{file.platform}] [Branch: {file.branch}] ({file.crackType})[/b][/color][/url]
[size=85][color=white][b] [{file.platform}] [{file.branch}] Version:[/b] [i]{file.shortDate} [Build {file.buildId}][/i][/color][/size]

<!--/LOOP:groupCrackedFiles--><!--/IF:crackedExists--><!--IF:group.footer-->[size=85]{group.footer}[/size]
<!--/IF:group.footer-->[/spoiler]
<!--/LOOP:customGroups--><!--LOOP:updates-->[spoiler="{update.title}"]<!--LOOP:sections-->[color={sectionTitleColor}]{section.miniTitle}[/color]
<!--LOOP:sectionLinks-->[url={link.url}][color={crackedUrlColor}][b]{link.name}[/b][/color][/url]
<!--/LOOP:sectionLinks-->

<!--/LOOP:sections-->[/spoiler]
<!--/LOOP:updates-->[color={sectionTitleColor}]Patch notes:[/color]
<!--LOOP:patchNotes-->[size=88][color=white][b] <!--IF:patchNotesTitle-->{patchNotesTitle} <!--/IF:patchNotesTitle--><!--IF:showPatchNotesVersionLabel-->Version:<!--/IF:showPatchNotesVersionLabel-->[/b] [i]{file.fullDate} [Build {file.buildId}][/i][/color][/size]
[url={file.patchNoteUrl}]{file.patchNoteUrl}[/url]
<!--/LOOP:patchNotes-->`;

    templates.multiple = defaultTemplate;
    templates.single = defaultTemplate;

    try {
        const response = await fetch('templates.html');
        if (response.ok) {
            const text = await response.text();
            const parser = new DOMParser();
            const doc = parser.parseFromString(text, 'text/html');
            const loaded = doc.getElementById('multi-url-group-template-with-updates')?.innerHTML;
            if (loaded) {
                templates.multiple = loaded;
                templates.single = loaded;
            }
        }
    } catch (e) { console.warn("Using internal default template."); }
}

function migrateGameData(game) {
    if (game.urlGroups && (!game.customGroups || game.customGroups.length === 0)) {
        game.customGroups = game.urlGroups.map(ug => ({ title: ug.title || 'Proton Drive Links', footer: '', files: ug.files || [] }));
    }
    if (!game.customGroups) game.customGroups = [];

    // NEW: Migrate Updates to Section-based structure
    if (!game.updates) game.updates = [];
    else {
        game.updates = game.updates.map(u => {
            // If it has 'links' (old array) and no 'sections', convert it
            if (u.links && !u.sections) {
                // Convert old links array to sections
                // Old: { links: [{provider: 'PD', url: '...'}], fileName: 'Common' }
                // New: { sections: [ { miniTitle: 'PD', links: [{name: 'Common', url: '...'}] } ] }
                const newSections = u.links.map(l => ({
                    miniTitle: l.provider || 'Download',
                    links: [{ name: u.fileName || 'Update File', url: l.url }]
                }));
                u.sections = newSections;
                delete u.links;
                delete u.fileName;
            }
            // Ensure structure
            if (!u.sections) u.sections = [];
            u.sections.forEach(s => {
                if (!s.miniTitle) s.miniTitle = 'Provider';
                if (!s.links) s.links = [];
                s.links.forEach(l => {
                    if (!l.name) l.name = 'Part 1';
                    if (!l.url) l.url = '';
                });
            });
            return u;
        });
    }

    const ensureFileProps = (files) => {
        if (!files) return [];
        return files.map(f => {
            if (f.cleanUrl === undefined) f.cleanUrl = '';
            if (f.crackedUrl === undefined) f.crackedUrl = '';
            if (f.includeCracked === undefined) f.includeCracked = true;
            if (f.crackType === undefined) f.crackType = 'Cracked: Detanup01 Goldberg Fork';
            return f;
        });
    };
    game.files = ensureFileProps(game.files);
    game.customGroups.forEach(grp => { grp.files = ensureFileProps(grp.files); });
    if (game.mainGroupTitle === undefined) game.mainGroupTitle = 'Proton Drive Links';
    if (game.patchNotesTitle === undefined) game.patchNotesTitle = '';
    return game;
}

function loadLocalData() {
    // Default both toggles to TRUE
    const defaultSettings = { cleanUrlColor: '#00aa00', crackedUrlColor: '#00babd', useSameUrlColor: false, sectionTitleColor: '#ee11d5', patchNotesMode: 'multiple', showVersionLabel: true, showPatchNotesVersionLabel: true };
    try {
        const storedData = localStorage.getItem(`${STORAGE_PREFIX}appData`);
        if (storedData) {
            const parsedData = JSON.parse(storedData);
            if (parsedData.games) parsedData.games = parsedData.games.map(migrateGameData);
            state = { ...state, ...parsedData, settings: { ...defaultSettings, ...(parsedData.settings || {}) }, presets: parsedData.presets || [] };
        } else { state.settings = defaultSettings; }
    } catch (e) { state = { games: [], activeGameIndex: 0, presets: [], settings: defaultSettings, template: '' }; }
}

function saveLocalData() { 
    try { localStorage.setItem(`${STORAGE_PREFIX}appData`, JSON.stringify(state)); } catch (e) { console.error("Error saving local data:", e); } 
}
function saveData() { saveLocalData(); if (authManager && authManager.isLoggedIn()) saveBackendData(); }

/************************************
 * Auth Wrapper (uses global AuthManager)
 ************************************/
async function fetchWithAuth(url, options = {}) {
    if (!authManager) throw new Error("AuthManager not initialized");
    return authManager.fetchWithAuth(url, options);
}
async function fetchBackendData() { 
    if (!authManager || !authManager.isLoggedIn()) return null; 
    try { return await (await authManager.fetchWithAuth(authManager.endpoints.data, { method: 'GET' })).json(); } catch { return null; } 
}
async function saveBackendData() { 
    if (!authManager || !authManager.isLoggedIn()) return false; 
    try { await authManager.fetchWithAuth(authManager.endpoints.data, { method: 'POST', body: JSON.stringify(state) }); return true; } catch { return false; } 
}

/*******************************
 * PARSERS
 *******************************/
const sanitizeGameTitle = (title) => title.replace(/&/g, 'and').replace(/[^\w\s-]/gi, '').trim();

const parseBBCodeInput = (text) => {
    const versionMatch = text.match(/Version:\s+(.*?)\n/i);
    const gameVersion = versionMatch ? versionMatch[1].trim() : '';

    const patchNotesSplit = text.split(/\[color=.*?\]Patch notes:\[\/color\]/i);
    let mainBody = patchNotesSplit[0];
    let patchNotesBody = patchNotesSplit.length > 1 ? patchNotesSplit[1] : '';

    const pnMatch = patchNotesBody.match(/\[size=88\]\[color=white\]\[b\]\s*(.*?)\s*\[/);
    const patchNotesTitle = pnMatch && !pnMatch[1].includes('Version') ? pnMatch[1].trim() : '';

    const updates = [];
    const updateRegex = /\[spoiler="(Update.*?)"\](.*?)\[\/spoiler\]/gs;

    // NEW PARSER for Nested Sections
    mainBody = mainBody.replace(updateRegex, (match, title, content) => {
        const sections = [];
        // Regex to split content by Mini Titles: [color=...]Mini Title[/color]
        // We iterate through the content finding these headers
        const sectionRegex = /\[color=[^\]]*?\](.*?)\[\/color\]/g;
        let splitIndices = [];
        let m;
        while ((m = sectionRegex.exec(content)) !== null) {
            splitIndices.push({ index: m.index, title: m[1], length: m[0].length });
        }

        if (splitIndices.length === 0) {
            // Fallback for old format or plain lists: treat whole thing as one section
            const links = [];
            const linkBlockRegex = /\[url=([^\]]*?)\](?:.*?)\[b\](.*?)\[\/b\]/gs;
            let lm;
            while ((lm = linkBlockRegex.exec(content)) !== null) {
                links.push({ name: lm[2], url: lm[1] });
            }
            if (links.length > 0) sections.push({ miniTitle: 'Links', links });
        } else {
            for (let i = 0; i < splitIndices.length; i++) {
                const current = splitIndices[i];
                const next = splitIndices[i + 1];
                // Content for this section starts after the header, ends at start of next header (or end of string)
                const startIdx = current.index + current.length;
                const endIdx = next ? next.index : content.length;
                const sectionContent = content.substring(startIdx, endIdx);

                const links = [];
                const linkBlockRegex = /\[url=([^\]]*?)\](?:.*?)\[b\](.*?)\[\/b\]/gs;
                let lm;
                while ((lm = linkBlockRegex.exec(sectionContent)) !== null) {
                    links.push({ name: lm[2], url: lm[1] });
                }
                sections.push({ miniTitle: current.title, links });
            }
        }

        updates.push({ title: title, sections: sections });
        return '';
    });

    const customGroups = [];
    const spoilerRegex = /\[spoiler="(.*?)"\](.*?)\[\/spoiler\]/gs;

    const extractFilesFromBlock = (block) => {
        const fileMap = new Map();
        const urlLineRegex = /\[url=([^\]]*?)\]\[color=.*?\]\[b\](.*?) \[(.*?)\] \[Branch: (.*?)\] \((.*?)\)\[\/b\]\[\/color\]\[\/url\]/g;
        const dateRegex = /\[size=85\].*?Version:\[\/b\] \[i\](.*?) \[Build (.*?)\]\[\/i\]/;

        let match;
        while ((match = urlLineRegex.exec(block)) !== null) {
            const [fullLine, url, title, platform, branch, typeRaw] = match;
            const key = `${platform}_${branch}`;

            const remainder = block.substring(match.index + fullLine.length);
            const dateMatch = remainder.match(dateRegex);

            let fullDate = '', shortDate = '', buildId = '';
            if (dateMatch && dateMatch.index < 50) {
                fullDate = dateMatch[1];
                shortDate = fullDate.split(' - ')[0];
                buildId = dateMatch[2];
            }

            let fileObj = fileMap.get(key);
            if (!fileObj) {
                fileObj = {
                    gameTitle: title, platform, branch, fullDate, shortDate, buildId,
                    cleanUrl: '', crackedUrl: '', includeCracked: false, crackType: 'Cracked: Detanup01 Goldberg Fork',
                    patchNoteUrl: `https://steamdb.info/patchnotes/${buildId}/`
                };
                fileMap.set(key, fileObj);
            }

            if (typeRaw.includes('Clean Steam Files')) {
                fileObj.cleanUrl = url;
            } else if (typeRaw.includes('Cracked')) {
                fileObj.crackedUrl = url;
                fileObj.includeCracked = true;
                fileObj.crackType = typeRaw.replace('(', '').replace(')', '');
            }

            if (buildId && !fileObj.buildId) {
                fileObj.fullDate = fullDate;
                fileObj.shortDate = shortDate;
                fileObj.buildId = buildId;
            }
        }
        return Array.from(fileMap.values());
    };

    mainBody = mainBody.replace(spoilerRegex, (match, title, content) => {
        const files = extractFilesFromBlock(content);
        const footerMatch = content.match(/\[size=85\](.*?)\[\/size\]\s*$/);
        const footer = footerMatch ? footerMatch[1] : '';
        customGroups.push({ title, files, footer });
        return '';
    });

    let mainGroupTitle = 'Proton Drive Links';
    const mainTitleMatch = mainBody.match(/^\s*\[size=85\](.*?)\[\/size\]/);
    if (mainTitleMatch) mainGroupTitle = mainTitleMatch[1];

    const mainFiles = extractFilesFromBlock(mainBody);

    if (mainFiles.length === 0 && customGroups.length === 0) return null;

    const gameTitle = mainFiles.length > 0 ? mainFiles[0].gameTitle : (customGroups[0]?.files[0]?.gameTitle || 'Imported Game');

    return {
        gameTitle: sanitizeGameTitle(gameTitle),
        originalTitle: gameTitle,
        files: mainFiles,
        customGroups,
        updates,
        mainGroupTitle,
        patchNotesTitle,
        gameVersion
    };
};

const handleFiles = (files) => {
    if (files.length === 0) return;
    let combinedText = '';
    let filesRead = 0;

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            // Priority 1: Handle JSON Backup Files immediately
            if (file.name.endsWith('.json')) {
                try {
                    const data = JSON.parse(e.target.result);
                    if (data.games) {
                        state.games = data.games.map(migrateGameData);
                        if (data.settings) state.settings = { ...state.settings, ...data.settings };
                        if (data.presets) state.presets = data.presets;

                        state.activeGameIndex = 0;
                        saveData();
                        updateDisplay();
                        alert(`Successfully imported backup: ${file.name}`);
                    }
                } catch (err) {
                    console.error("JSON Import Error", err);
                    alert("Failed to parse JSON file.");
                }
                return;
            }

            // Priority 2: Accumulate Text Files
            combinedText += e.target.result + '\n\n';
            filesRead++;

            // Only process once all text files are read
            if (filesRead === Array.from(files).filter(f => !f.name.endsWith('.json')).length) {
                parseInputText(combinedText);
            }
        };
        reader.readAsText(file);
    });
};

const parseInputText = (text) => {
    // --- REGEX DEFINITION (Raw Import Format) ---
    // Matches: [url=][color=white][b]Title [Platform] [Branch: Branch] (Clean Steam Files)[/b] ...
    const rawBlockRegex = /\[url=.*?\](?:\[color=.*?\])?\[b\](?<gameName>.+?) \[(?<platform>Win\d+|Linux\d+|Mac)\] \[Branch: (?<branch>[^\]]+)\] \(Clean Steam Files\)\[\/b\][\s\S]*?Version:\[\/b\]\s*\[i\](?<fullDate>.+?)\s*\[Build\s(?<buildId>\d+)\]\[\/i\]/g;

    // --- DETECTION LOGIC ---
    // 1. Does this look like Raw Data? (Contains "Depots & Manifests" OR known raw patterns)
    // We check this FIRST to prevent the app from thinking the Depot spoilers are Link Groups.
    // But we must be careful not to flag BBCode files as Raw Data just because they share keywords.
    const isRawData = text.includes('Depots & Manifests');

    // Reset regex index after test
    rawBlockRegex.lastIndex = 0;

    // 2. BBCODE EDITOR MODE
    // Priority: If it looks like BBCode (has [spoiler= and Branch:), treat as such.
    // The previous check (isRawData) was too aggressive for mixed content.
    if (text.includes('[spoiler=') && text.includes('Branch:')) {
        const bbGame = parseBBCodeInput(text);
        if (bbGame) {
            const existIdx = state.games.findIndex(g => g.gameTitle === bbGame.gameTitle);
            if (existIdx !== -1) {
                // Determine if we need to confirm
                // For a drag-and-drop, it might be annoying to confirm every time if it's just an update.
                // However, safe is better.
                // Let's assume if we are parsing BBCode input, it's an intentional update.
                // Merging data:
                const existing = state.games[existIdx];
                // Update specific fields from the dropped data
                state.games[existIdx] = {
                    ...existing,
                    ...bbGame,
                    files: bbGame.files, // Replace files (usually what is desired on re-import)
                    updates: bbGame.updates && bbGame.updates.length > 0 ? bbGame.updates : existing.updates, // Keep existing updates if new one has none? Or overwrite? 
                    // Request says: "update all relavent fields ... including the ones in the extra link areas"
                    // So we should overwrite if present.
                    customGroups: bbGame.customGroups && bbGame.customGroups.length > 0 ? bbGame.customGroups : existing.customGroups
                };
            } else {
                state.games.push(bbGame);
            }
            finishImport(bbGame.gameTitle);
            return;
        }
    }

    // 3. RAW FILE IMPORT MODE (Smart Update)
    const gamesMap = new Map(state.games.map(game => [game.gameTitle, game]));
    const gamesToUpdate = new Map();

    let match;
    let matchCount = 0;

    // Run the regex loop on the text
    while ((match = rawBlockRegex.exec(text)) !== null) {
        matchCount++;
        const { gameName, platform, branch, fullDate, buildId } = match.groups;
        const sanitizedTitle = sanitizeGameTitle(gameName);

        let currentGame;

        // Get existing game or create new
        if (gamesToUpdate.has(sanitizedTitle)) {
            currentGame = gamesToUpdate.get(sanitizedTitle);
        } else {
            const existingGame = gamesMap.get(sanitizedTitle);
            if (existingGame) {
                currentGame = JSON.parse(JSON.stringify(existingGame));
                currentGame = migrateGameData(currentGame);
            } else {
                currentGame = {
                    gameTitle: sanitizedTitle,
                    originalTitle: gameName,
                    files: [],
                    customGroups: [], // Raw import does NOT create custom groups from spoilers
                    updates: [],
                    mainGroupTitle: 'Proton Drive Links',
                    patchNotesTitle: '',
                    gameVersion: ''
                };
            }
            gamesToUpdate.set(sanitizedTitle, currentGame);
        }

        currentGame.originalTitle = gameName;

        // Clean Date/Build info
        const cleanFullDate = fullDate.trim();
        const shortDate = cleanFullDate.split(' - ')[0];

        // Find existing file
        const existingFileIndex = currentGame.files.findIndex(f => f.platform === platform && f.branch === branch);

        if (existingFileIndex !== -1) {
            // --- UPDATE EXISTING ---
            const existingFile = currentGame.files[existingFileIndex];

            // Check for version change
            if (existingFile.buildId !== buildId) {
                existingFile.buildId = buildId;
                existingFile.fullDate = cleanFullDate;
                existingFile.shortDate = shortDate;
                existingFile.patchNoteUrl = `https://steamdb.info/patchnotes/${buildId}/`;
                // Flag for review in UI
                existingFile.cleanUrlNeedsUpdate = true;
            } else {
                existingFile.fullDate = cleanFullDate;
                existingFile.shortDate = shortDate;
            }
        } else {
            // --- NEW FILE ---
            const newFile = {
                platform,
                branch,
                fullDate: cleanFullDate,
                shortDate,
                buildId,
                patchNoteUrl: `https://steamdb.info/patchnotes/${buildId}/`,
                cleanUrl: '',
                crackedUrl: '',
                includeCracked: true,
                crackType: 'Cracked: Detanup01 Goldberg Fork',
                cleanUrlNeedsUpdate: true
            };
            currentGame.files.push(newFile);

            // Add new file slot to existing custom groups
            if (currentGame.customGroups) {
                currentGame.customGroups.forEach(grp => {
                    grp.files.push({ ...newFile, cleanUrl: '', crackedUrl: '' });
                });
            }
        }
    }

    if (matchCount === 0 && text.trim().length > 0) {
        console.warn("No valid game data found.");
    }

    // Save updates
    for (const [title, game] of gamesToUpdate.entries()) {
        // Sort Files: Win > Linux > Mac
        const sorter = (a, b) => {
            const getOrder = (p) => {
                if (p.startsWith('Win')) return 1;
                if (p.startsWith('Linux')) return 2;
                if (p.startsWith('Mac')) return 3;
                return 4;
            };
            return getOrder(a.platform) - getOrder(b.platform);
        };

        game.files.sort(sorter);
        if (game.customGroups) game.customGroups.forEach(g => g.files.sort(sorter));

        gamesMap.set(title, game);
    }

    if (gamesToUpdate.size > 0) {
        state.games = Array.from(gamesMap.values()).sort((a, b) => a.gameTitle.localeCompare(b.gameTitle));
        const firstUpdatedTitle = gamesToUpdate.keys().next().value;
        finishImport(firstUpdatedTitle);
    }
};

// Helper to finish up the UI actions
const finishImport = (targetTitle) => {
    let newIdx = 0;
    if (targetTitle) {
        const idx = state.games.findIndex(g => g.gameTitle === targetTitle);
        if (idx !== -1) newIdx = idx;
    }
    state.activeGameIndex = newIdx;
    localStorage.setItem(`${STORAGE_PREFIX}activeGameIndex`, state.activeGameIndex);
    getElements().customizationPanel.classList.remove('hidden');
    updateGameList(); // Refresh the dropdown list in case new game added
    renderGameView(); // Show the game
    saveData();
};

// --- RENDER ENGINE ---
const renderOutput = () => {
    const { outputCode, previewPane, copyBtnTop, copyBtnBottom, downloadBtn } = getElements();
    if (state.games.length === 0) {
        outputCode.value = ''; previewPane.innerHTML = '<p class="text-gray-500">No data.</p>';
        [copyBtnTop, copyBtnBottom, downloadBtn].forEach(b => b.disabled = true);
        return;
    }

    const activeGame = state.games[state.activeGameIndex];
    if (!activeGame) return;

    let template = state.template;

    // Replace Top Level SHOW_VERSION_LABEL
    template = template.replace(/<!--IF:showVersionLabel-->([\s\S]*?)<!--\/IF:showVersionLabel-->/g, state.settings.showVersionLabel ? '$1' : '');

    template = template.replace(/<!--IF:gameVersion-->([\s\S]*?)<!--\/IF:gameVersion-->/g, activeGame.gameVersion ? '$1' : '');
    template = template.replace(/<!--IF:crackedExists-->([\s\S]*?)<!--\/IF:crackedExists-->/g, activeGame.files.some(f => f.includeCracked) ? '$1' : '');
    template = template.replace(/<!--IF:customGroups-->([\s\S]*?)<!--\/IF:customGroups-->/g, activeGame.customGroups && activeGame.customGroups.length > 0 ? '$1' : '');

    const processLoops = (tmpl, context) => {
        return tmpl.replace(/<!--LOOP:(\w+)-->([\s\S]*?)<!--\/LOOP:\1-->/g, (match, loopKey, loopContent) => {
            let items = [];
            if (loopKey === 'cleanFiles') items = context.files;
            else if (loopKey === 'crackedFiles') items = context.files.filter(f => f.includeCracked);
            else if (loopKey === 'patchNotes') items = state.settings.patchNotesMode === 'single' ? context.files.slice(0, 1) : context.files;
            else if (loopKey === 'customGroups') items = context.customGroups || [];
            else if (loopKey === 'groupCleanFiles') items = context.files;
            else if (loopKey === 'groupCrackedFiles') items = context.files.filter(f => f.includeCracked);

            // NEW LOOPS FOR UPDATES
            else if (loopKey === 'updates') items = context.updates || [];
            else if (loopKey === 'sections') items = context.sections || []; // Sections inside Updates
            else if (loopKey === 'sectionLinks') items = context.links || []; // Links inside Sections

            if (!items || items.length === 0) return '';

            return items.map(item => {
                let itemData = {
                    file: item,
                    group: item,
                    update: item,
                    section: item,
                    link: item,
                    ...item,
                    // Inject patch mode flags for the template
                    isMultiPatch: state.settings.patchNotesMode !== 'single',
                    isSinglePatch: state.settings.patchNotesMode === 'single',
                    showVersionLabel: state.settings.showVersionLabel,
                    showPatchNotesVersionLabel: state.settings.showPatchNotesVersionLabel // Separate toggle
                };
                itemData.gameTitle = activeGame.originalTitle;
                itemData.mainGroupTitle = activeGame.mainGroupTitle || 'Proton Drive Links';
                itemData.cleanUrlColor = state.settings.cleanUrlColor;
                itemData.crackedUrlColor = state.settings.useSameUrlColor ? state.settings.cleanUrlColor : state.settings.crackedUrlColor;
                itemData.sectionTitleColor = state.settings.sectionTitleColor;
                itemData.patchNotesTitle = activeGame.patchNotesTitle;

                let processedContent = loopContent.replace(/<!--IF:([\w.]+)-->([\s\S]*?)<!--\/IF:\1-->/g, (m, k, c) => {
                    // Check boolean flags injected above
                    if (k === 'isMultiPatch' && itemData.isMultiPatch) return c;
                    if (k === 'isSinglePatch' && itemData.isSinglePatch) return c;
                    if (k === 'showVersionLabel' && itemData.showVersionLabel) return c;
                    if (k === 'showPatchNotesVersionLabel' && itemData.showPatchNotesVersionLabel) return c; // Handle new separate toggle

                    if (k === 'crackedExists' && itemData.files && itemData.files.some(f => f.includeCracked)) return c;
                    if (k === 'group.footer' && item.footer) return c;
                    if (k === 'patchNotesTitle' && activeGame.patchNotesTitle) return c;
                    return '';
                });

                processedContent = processLoops(processedContent, item);
                return applyTemplate(processedContent, itemData);
            }).join('\n');
        });
    };

    let processed = processLoops(template, activeGame);
    processed = applyTemplate(processed, {
        sectionTitleColor: state.settings.sectionTitleColor,
        gameVersion: activeGame.gameVersion,
        mainGroupTitle: activeGame.mainGroupTitle || 'Proton Drive Links'
    });
    processed = processed.replace(/^\s*[\r\n]/gm, "\n").replace(/\n\n\n+/g, "\n\n").trim();

    outputCode.value = processed;
    renderPreview(processed);
    [copyBtnTop, copyBtnBottom, downloadBtn].forEach(b => b.disabled = false);
};

const applyTemplate = (template, data) => template.replace(/\{([\w.]+)\}/g, (m, k) => {
    let v = data; for (const key of k.split('.')) { if (v && typeof v === 'object' && key in v) v = v[key]; else return m; }
    return (v !== undefined && v !== null) ? v : '';
});

const renderPreview = (bbcode) => {
    let html = bbcode
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\[url=([^\]]*)\](.*?)\[\/url\]/gs, (m, u, t) => `<a href="${u}" class="postlink" target="_blank">${t}</a>`)
        .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" class="postlink" target="_blank">$2</a>')
        .replace(/\[spoiler="?(.*?)"?\](.*?)\[\/spoiler\]/gs, '<div style="margin:5px 0;border:1px solid #444;padding:5px;background:#222;"><div style="font-weight:bold;color:#fff;">$1</div><div style="margin-top:5px;">$2</div></div>')
        .replace(/\n/g, '<br>').replace(/\[b\](.*?)\[\/b\]/gs, '<b>$1</b>').replace(/\[i\](.*?)\[\/i\]/gs, '<i>$1</i>')
        .replace(/\[color=(.*?)\](.*?)\[\/color\]/gs, '<span style="color:$1;">$2</span>')
        .replace(/\[size=(.*?)\](.*?)\[\/size\]/gs, '<span style="font-size:$1%;">$2</span>');
    getElements().previewPane.innerHTML = `<div class="postbody">${html}</div>`;
};

const handleCopyClick = async (button) => {
    const { outputCode } = getElements(); if (!outputCode.value) return;
    try { await navigator.clipboard.writeText(outputCode.value); button.textContent = 'Copied!'; }
    catch { outputCode.select(); document.execCommand('copy'); button.textContent = 'Copied!'; }
    setTimeout(() => button.textContent = 'Copy Code', 2000);
};

/*******************************
 * UI
 *******************************/
// SEPARATE LIST UPDATE FROM VIEW RENDER
const updateGameList = () => {
    const { gameSelector } = getElements();
    // Save current selection if possible, though state.activeGameIndex is the truth
    const currentOpts = gameSelector.options.length;
    
    // Valid check: If length matches and titles match, skip rebuild to prevent UI flicker/focus loss?
    // Actually, simple rebuild is fine as long as we don't do it ON change event.
    gameSelector.innerHTML = '';
    state.games.forEach((g, i) => { 
        const o = document.createElement('option'); 
        o.value = i; 
        o.textContent = g.gameTitle; 
        if (i === state.activeGameIndex) o.selected = true; 
        gameSelector.appendChild(o); 
    });
};

const renderGameView = () => {
    updateUIForActiveGame();
};

const updateDisplay = () => { updateGameList(); renderGameView(); };

const createPlatformInputs = (files, parentIndex, type = 'main') => {
    let html = '';
    files.forEach((file, fIndex) => {
        const id = type === 'group' ? `data-group-index="${parentIndex}" data-file-index="${fIndex}"` : `data-file-index="${fIndex}"`;
        const warn = file.cleanUrlNeedsUpdate ? '<span class="text-yellow-400 font-bold"> (!)</span>' : '';
        html += `<div class="mb-3 pb-2 border-b border-gray-700 last:border-0">
            <label class="block text-xs font-medium text-gray-400 mb-1">${file.platform} - ${file.branch}${warn}</label>
            <input type="text" ${id} data-prop="cleanUrl" value="${file.cleanUrl || ''}" class="w-full p-1 bg-gray-900 border border-gray-600 rounded-md text-sm focus:border-blue-500">
            <div class="${file.includeCracked ? 'mt-2' : 'hidden'}">
                 <label class="block text-xs font-medium text-gray-500 mb-1">Cracked URL</label>
                 <input type="text" ${id} data-prop="crackedUrl" value="${file.crackedUrl || ''}" class="w-full p-1 bg-gray-900 border border-gray-600 rounded-md text-sm text-gray-300">
            </div>
        </div>`;
    });
    return html;
};

const updateUIForActiveGame = () => {
    const els = getElements();
    if (state.games.length === 0) { els.customizationPanel.classList.add('hidden'); renderOutput(); return; }
    els.customizationPanel.classList.remove('hidden');

    const g = state.games[state.activeGameIndex]; if (!g) return;

    // Added Toggle for "Show Version Label"
    els.gameVersionContainer.innerHTML = `
        <div class="flex justify-between items-end mb-1">
            <label class="block text-sm font-medium text-gray-300">Optional Game Version</label>
            <div class="flex items-center">
                <input type="checkbox" id="show-version-label" data-setting="showVersionLabel" ${state.settings.showVersionLabel !== false ? 'checked' : ''} class="h-3 w-3 rounded border-gray-600 text-blue-600 focus:ring-blue-500">
                <label for="show-version-label" class="ml-2 text-xs text-gray-400 select-none cursor-pointer">Show "Version:"</label>
            </div>
        </div>
        <input type="text" id="game-version-input" value="${g.gameVersion || ''}" class="w-full p-2 bg-gray-900 border border-gray-700 rounded-md text-sm">
    `;

    els.mainGroupContainer.innerHTML = `
        <div class="mb-3">
            <label class="block text-xs font-medium text-gray-400 mb-1">Group Title (Visible if other groups exist)</label>
            <div class="flex gap-2">
                <input type="text" data-prop="mainGroupTitle" value="${g.mainGroupTitle || ''}" class="w-full p-1 bg-gray-900 border border-gray-600 rounded text-sm placeholder-gray-600" placeholder="Default: Proton Drive Links">
                <button onclick="window.resetMainTitle()" class="text-xs text-gray-400 hover:text-white whitespace-nowrap">Reset Default</button>
            </div>
        </div>
        ${createPlatformInputs(g.files, null, 'main')}
    `;

    els.customGroupsContainer.innerHTML = '';
    if (!g.customGroups) g.customGroups = [];
    g.customGroups.forEach((grp, i) => {
        const d = document.createElement('div'); d.className = 'p-3 bg-gray-700/30 rounded border border-gray-600 mb-3';
        d.innerHTML = `<div class="flex justify-between items-center mb-3"><input type="text" data-group-index="${i}" data-prop="title" value="${grp.title || ''}" placeholder="Group Title" class="bg-transparent border-b border-gray-500 text-blue-300 text-sm font-bold w-2/3 focus:outline-none"><button class="text-red-400 hover:text-red-200 text-xs font-bold" onclick="removeCustomGroup(${i})">Remove Group</button></div>${createPlatformInputs(grp.files, i, 'group')}<div class="mt-2 pt-2 border-t border-gray-600"><label class="text-xs text-gray-400">Footer Message</label><input type="text" data-group-index="${i}" data-prop="footer" value="${grp.footer || ''}" class="w-full mt-1 p-1 bg-gray-900 border-gray-600 text-sm rounded"></div>`;
        els.customGroupsContainer.appendChild(d);
    });

    els.presetSelector.innerHTML = '<option value="">Select Saved Preset...</option>';
    state.presets.forEach((p, i) => { els.presetSelector.innerHTML += `<option value="${i}">${p.title}</option>`; });

    els.crackTogglesContainer.innerHTML = '';
    g.files.forEach((f, i) => {
        const isCustom = !f.crackType.includes('Detanup01');
        const d = document.createElement('div'); d.className = 'p-2 bg-gray-700/30 rounded mb-2 border border-gray-600';

        // Added Copy Button logic below
        d.innerHTML = `
        <div class="flex justify-between items-center">
            <span class="text-xs font-bold text-gray-300">${f.platform}</span>
            <div class="flex items-center">
                <button id="copy-crack-btn-${i}" onclick="window.copyCrackFileName(${i})" class="mr-2 text-gray-400 hover:text-blue-400" title="Copy Release Name">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                </button>
                <label class="text-xs mr-2 text-gray-400">Include Cracked</label>
                <input type="checkbox" data-file-index="${i}" data-prop="includeCracked" ${f.includeCracked ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300">
            </div>
        </div>
        ${f.includeCracked ? `<div class="mt-2 space-y-2"><select data-file-index="${i}" data-prop="crackType" class="w-full text-xs bg-gray-900 border-gray-600 rounded p-1"><option value="Cracked: Detanup01 Goldberg Fork" ${f.crackType.includes('Fork') && !f.crackType.includes('Steamless') ? 'selected' : ''}>Detanup01 Goldberg Fork</option><option value="Cracked: Detanup01 Goldberg Fork + Steamless" ${f.crackType.includes('Steamless') ? 'selected' : ''}>Detanup01 Goldberg Fork + Steamless</option><option value="custom" ${isCustom ? 'selected' : ''}>Custom</option></select><input type="text" data-file-index="${i}" data-prop="customCrackType" value="${f.crackType}" class="w-full text-xs bg-gray-900 border-gray-600 rounded p-1 ${isCustom ? '' : 'hidden'}"></div>` : ''}`;
        els.crackTogglesContainer.appendChild(d);
    });

    // --- UPDATES SECTION REDESIGN ---
    els.updatesContainer.innerHTML = '';
    if (!g.updates) g.updates = [];
    g.updates.forEach((u, ui) => {
        let sectionsHtml = '';
        if (!u.sections) u.sections = [{ miniTitle: 'Proton Drive', links: [{ name: 'Update v1.0', url: '' }] }];

        u.sections.forEach((s, si) => {
            let linksHtml = '';
            s.links.forEach((l, li) => {
                linksHtml += `
                <div class="flex gap-2 mt-1 items-center">
                     <input type="text" data-update-index="${ui}" data-section-index="${si}" data-link-index="${li}" data-prop="linkName" value="${l.name || ''}" class="w-1/3 text-xs bg-gray-900 border-gray-600 rounded p-1" placeholder="Name (e.g., Windows)">
                     <input type="text" data-update-index="${ui}" data-section-index="${si}" data-link-index="${li}" data-prop="linkUrl" value="${l.url || ''}" class="w-2/3 text-xs bg-gray-900 border-gray-600 rounded p-1" placeholder="URL">
                     <button class="text-red-400 font-bold ml-1 hover:text-red-200" onclick="window.removeSectionLink(${ui}, ${si}, ${li})">x</button>
                </div>`;
            });

            sectionsHtml += `
            <div class="mt-3 pl-2 border-l-2 border-gray-600">
                <div class="flex justify-between items-center mb-1">
                    <input type="text" data-update-index="${ui}" data-section-index="${si}" data-prop="miniTitle" value="${s.miniTitle || ''}" class="bg-transparent border-b border-gray-600 text-gray-300 text-xs font-bold focus:outline-none w-1/2" placeholder="Mini Title (e.g. Proton Drive)">
                    <button class="text-xs text-red-400 hover:text-red-200" onclick="window.removeUpdateSection(${ui}, ${si})">Remove Provider</button>
                </div>
                ${linksHtml}
                <button class="text-xs text-blue-400 mt-1 hover:text-blue-300" onclick="window.addSectionLink(${ui}, ${si})">+ Add Link</button>
            </div>`;
        });

        const d = document.createElement('div'); d.className = 'p-3 bg-gray-700/30 rounded border border-gray-600 mb-3';
        d.innerHTML = `
        <div class="flex justify-between mb-2">
            <input type="text" data-update-index="${ui}" data-prop="title" value="${u.title || ''}" class="bg-transparent border-b border-gray-500 text-green-400 text-sm font-bold focus:outline-none w-3/4" placeholder="Update Title (e.g. Update v1 to v2)">
            <button class="text-red-400 text-xs hover:text-red-200" onclick="window.removeUpdate(${ui})">Remove Update</button>
        </div>
        ${sectionsHtml}
        <div class="mt-2 pt-2 border-t border-gray-700">
             <button class="text-xs text-green-400 font-bold hover:text-green-300" onclick="window.addUpdateSection(${ui})">+ Add Provider (Mini Title)</button>
        </div>`;
        els.updatesContainer.appendChild(d);
    });

    // Inject the checkbox for Patch Notes Version Toggle explicitly in JS 
    // because we want to update the innerHTML of the container completely to include it.
    els.patchNotesOptionsContainer.innerHTML = `
        <div class="flex justify-between items-center">
            <label class="text-xs text-gray-400 font-bold">Mini Title (e.g., Hotfix Patch!)</label>
            <input type="text" id="patchnotes-title-input" data-setting="patchNotesTitle" value="${g.patchNotesTitle || ''}" class="bg-gray-800 border border-gray-600 text-xs p-1 rounded w-1/2">
        </div>
        <div class="flex items-center gap-4 mt-2">
             <div class="flex items-center gap-2">
                <input type="checkbox" id="patchnotes-mode-toggle" data-setting="patchNotesMode" ${state.settings.patchNotesMode === 'single' ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <label for="patchnotes-mode-toggle" class="text-xs text-gray-300">Single Patch Note Link (Merged)</label>
            </div>
            <div class="flex items-center gap-2">
                <input type="checkbox" id="show-patchnotes-version-label" data-setting="showPatchNotesVersionLabel" ${state.settings.showPatchNotesVersionLabel !== false ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                <label for="show-patchnotes-version-label" class="text-xs text-gray-300">Show "Version:"</label>
            </div>
        </div>
        <div id="patchnotes-url-container" class="mt-2"></div>
    `;

    // Re-acquire the container after injecting HTML to populate URLs
    const urlContainer = document.getElementById('patchnotes-url-container');

    if (state.settings.patchNotesMode === 'single' && g.files.length > 0) {
        urlContainer.innerHTML = `<input type="text" data-file-index="0" data-prop="patchNoteUrl" value="${g.files[0].patchNoteUrl || ''}" class="w-full bg-gray-900 border-gray-600 rounded p-1 text-sm">`;
    } else {
        g.files.forEach((f, i) => { urlContainer.innerHTML += `<div class="mb-1"><label class="text-xs text-gray-400">${f.platform}</label><input type="text" data-file-index="${i}" data-prop="patchNoteUrl" value="${f.patchNoteUrl || ''}" class="w-full bg-gray-900 border-gray-600 rounded p-1 text-sm"></div>`; });
    }

    els.cleanUrlColorInput.value = state.settings.cleanUrlColor;
    els.crackedUrlColorInput.value = state.settings.crackedUrlColor;
    els.sectionTitleColorInput.value = state.settings.sectionTitleColor;
    els.useSameUrlColorCheckbox.checked = state.settings.useSameUrlColor;
    els.templateEditor.value = state.template;
    renderOutput();
};



// Global Actions
window.resetMainTitle = () => { state.games[state.activeGameIndex].mainGroupTitle = 'Proton Drive Links'; updateUIForActiveGame(); saveData(); };
window.addCustomGroup = () => { const g = state.games[state.activeGameIndex]; const f = g.files.map(x => ({ platform: x.platform, branch: x.branch, cleanUrl: '', crackedUrl: '', shortDate: x.shortDate, buildId: x.buildId, includeCracked: x.includeCracked, crackType: x.crackType })); g.customGroups.push({ title: 'New Group', files: f, footer: '' }); updateUIForActiveGame(); saveData(); };
window.removeCustomGroup = (i) => { if (confirm('Delete group?')) { state.games[state.activeGameIndex].customGroups.splice(i, 1); updateUIForActiveGame(); saveData(); } };
window.loadPreset = () => { const idx = getElements().presetSelector.value; if (idx === '') return; const p = state.presets[idx], g = state.games[state.activeGameIndex], f = g.files.map(x => ({ platform: x.platform, branch: x.branch, cleanUrl: '', crackedUrl: '', shortDate: x.shortDate, buildId: x.buildId, includeCracked: x.includeCracked, crackType: x.crackType })); g.customGroups.push({ title: p.title, footer: p.footer, files: f }); updateUIForActiveGame(); saveData(); };
window.savePreset = () => { const t = prompt("Name:"); if (!t) return; const f = prompt("Footer:"); state.presets.push({ title: t, footer: f || '' }); updateUIForActiveGame(); saveData(); };

// UPDATED ACTIONS FOR NEW STRUCTURE
window.addUpdate = () => {
    state.games[state.activeGameIndex].updates.push({
        title: 'Update X to Y',
        sections: [{ miniTitle: 'Proton Drive', links: [{ name: 'Update File', url: '' }] }]
    });
    updateUIForActiveGame(); saveData();
};
window.removeUpdate = (i) => { if (confirm('Delete update?')) { state.games[state.activeGameIndex].updates.splice(i, 1); updateUIForActiveGame(); saveData(); } };

window.addUpdateSection = (uIndex) => {
    state.games[state.activeGameIndex].updates[uIndex].sections.push({ miniTitle: 'New Provider', links: [{ name: 'File Name', url: '' }] });
    updateUIForActiveGame(); saveData();
};
window.removeUpdateSection = (uIndex, sIndex) => {
    if (confirm('Remove this provider section?')) {
        state.games[state.activeGameIndex].updates[uIndex].sections.splice(sIndex, 1);
        updateUIForActiveGame(); saveData();
    }
};
window.addSectionLink = (uIndex, sIndex) => {
    state.games[state.activeGameIndex].updates[uIndex].sections[sIndex].links.push({ name: 'Part X', url: '' });
    updateUIForActiveGame(); saveData();
};
window.removeSectionLink = (uIndex, sIndex, lIndex) => {
    state.games[state.activeGameIndex].updates[uIndex].sections[sIndex].links.splice(lIndex, 1);
    updateUIForActiveGame(); saveData();
};

// COPY CRACK FUNCTION
window.copyCrackFileName = (fileIndex) => {
    const game = state.games[state.activeGameIndex];
    const file = game.files[fileIndex];
    // Convert Title Space to Dots
    const title = game.originalTitle.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '.');
    const platform = file.platform.toLowerCase();

    // Clean up Crack Type (e.g. "Cracked: Detanup01..." -> "Cracked-Detanup01...")
    let crack = file.crackType;
    if (crack.startsWith('Cracked: ')) {
        crack = crack.replace('Cracked: ', 'Cracked-');
    }
    crack = crack.replace(/\s+/g, '.');

    // OLD: const str = `${title}.${platform}.Build.${file.buildId}.${crack}`;
    // NEW: Game.Build.Platform.Crack
    const str = `${title}.Build.${file.buildId}.${platform}.${crack}`;

    navigator.clipboard.writeText(str).then(() => {
        const btn = document.getElementById(`copy-crack-btn-${fileIndex}`);
        if (btn) {
            const originalHTML = btn.innerHTML;
            // Simple Checkmark
            btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
            setTimeout(() => btn.innerHTML = originalHTML, 1500);
        }
    });
};

function setupEventListeners() {
    const els = getElements();
    els.dropZone.addEventListener('click', () => els.fileInput.click());
    els.dropZone.addEventListener('dragover', (e) => { e.preventDefault(); els.dropZone.classList.add('dragover'); });
    els.dropZone.addEventListener('dragleave', () => els.dropZone.classList.remove('dragover'));
    els.dropZone.addEventListener('drop', (e) => { e.preventDefault(); els.dropZone.classList.remove('dragover'); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); });
    els.fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    els.processTextBtn.addEventListener('click', () => { if (els.textInput.value.trim()) parseInputText(els.textInput.value); });
    els.gameSelector.addEventListener('change', (e) => { 
        state.activeGameIndex = parseInt(e.target.value, 10); 
        localStorage.setItem(`${STORAGE_PREFIX}activeGameIndex`, state.activeGameIndex); 
        // IMPORTANT: Do NOT call updateGameList() here, or it rebuilds the dropdown you are interacting with.
        renderGameView(); 
    });

    els.addCustomGroupBtn.addEventListener('click', window.addCustomGroup);
    els.loadPresetBtn.addEventListener('click', window.loadPreset);
    els.savePresetBtn.addEventListener('click', window.savePreset);
    els.addUpdateBtn.addEventListener('click', window.addUpdate);

    // Collapsible Logic
    document.querySelectorAll('.toggle-header').forEach(header => {
        header.addEventListener('click', () => {
            const content = header.nextElementSibling;
            const icon = header.querySelector('.chevron-icon');
            content.classList.toggle('hidden');
            // Standard chevron is Down (V). Rotate 180 for Up (^).
            // If hidden is active (closed), we want it pointing Down (V) -> rotate-0
            // If hidden is inactive (open), we want it pointing Up (^) -> rotate-180
            // Initial HTML state: content block (open), icon no-rotate (down? wait). 
            // Let's fix logic: Open = Chevron Up (rotate-180). Closed = Chevron Down (rotate-0).
            // In HTML I put rotate-0 (down). So default "open" looks like "closed" icon.
            // Let's swap toggle logic:

            if (content.classList.contains('hidden')) {
                // Closed
                icon.classList.remove('rotate-180');
            } else {
                // Open
                icon.classList.add('rotate-180');
            }
        });
    });

    // Global Expand/Collapse
    if (els.expandAllBtn) {
        els.expandAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.toggle-header').forEach(h => {
                const c = h.nextElementSibling;
                const i = h.querySelector('.chevron-icon');
                c.classList.remove('hidden');
                i.classList.add('rotate-180');
            });
        });
    }

    if (els.collapseAllBtn) {
        els.collapseAllBtn.addEventListener('click', () => {
            document.querySelectorAll('.toggle-header').forEach(h => {
                const c = h.nextElementSibling;
                const i = h.querySelector('.chevron-icon');
                c.classList.add('hidden');
                i.classList.remove('rotate-180');
            });
        });
    }

    els.customizationPanel.addEventListener('input', (e) => {
        const t = e.target;
        const game = state.games[state.activeGameIndex];
        if (!game) return;

        if (t.dataset.setting === 'patchNotesTitle') { game.patchNotesTitle = t.value; saveData(); renderOutput(); return; }

        const set = t.dataset.setting;
        if (set) {
            if (set === 'patchNotesMode') { state.settings.patchNotesMode = t.checked ? 'single' : 'multiple'; updateUIForActiveGame(); }
            else if (set === 'showVersionLabel') { state.settings.showVersionLabel = t.checked; updateUIForActiveGame(); } // Handle Top Version Label Toggle
            else if (set === 'showPatchNotesVersionLabel') { state.settings.showPatchNotesVersionLabel = t.checked; updateUIForActiveGame(); } // Handle Patch Notes Version Label Toggle
            else state.settings[set] = t.value;
            saveData(); renderOutput(); return;
        }

        if (t.id === 'game-version-input') game.gameVersion = t.value;

        const f = t.dataset.fileIndex, g = t.dataset.groupIndex, u = t.dataset.updateIndex, s = t.dataset.sectionIndex, l = t.dataset.linkIndex, p = t.dataset.prop;

        if (p) {
            if (g !== undefined && f !== undefined) game.customGroups[g].files[f][p] = t.value;
            else if (g !== undefined) game.customGroups[g][p] = t.value;

            // UPDATE LOGIC FOR NEW STRUCTURE
            else if (u !== undefined && s !== undefined && l !== undefined) {
                if (p === 'linkName') game.updates[u].sections[s].links[l].name = t.value;
                else if (p === 'linkUrl') game.updates[u].sections[s].links[l].url = t.value;
            }
            else if (u !== undefined && s !== undefined && p === 'miniTitle') game.updates[u].sections[s].miniTitle = t.value;
            else if (u !== undefined && p === 'title') game.updates[u].title = t.value;

            else if (p === 'mainGroupTitle') game.mainGroupTitle = t.value;
            else if (f !== undefined) {
                const file = game.files[f];
                // MODIFIED LOGIC: Propagate crack changes to custom groups
                if (p === 'includeCracked') {
                    file.includeCracked = t.checked;
                    if (game.customGroups) {
                        game.customGroups.forEach(grp => {
                            if (grp.files[f]) grp.files[f].includeCracked = t.checked;
                        });
                    }
                    updateUIForActiveGame();
                }
                else if (p === 'crackType') {
                    const val = t.value;
                    if (val === 'custom') {
                        t.closest('div').querySelector('[data-prop="customCrackType"]').classList.remove('hidden');
                    } else {
                        t.closest('div').querySelector('[data-prop="customCrackType"]').classList.add('hidden');
                        file.crackType = val;
                        if (game.customGroups) {
                            game.customGroups.forEach(grp => {
                                if (grp.files[f]) grp.files[f].crackType = val;
                            });
                        }
                    }
                }
                else if (p === 'customCrackType') {
                    file.crackType = t.value;
                    if (game.customGroups) {
                        game.customGroups.forEach(grp => {
                            if (grp.files[f]) grp.files[f].crackType = t.value;
                        });
                    }
                }
                else if (p === 'cleanUrl') { file.cleanUrl = t.value; file.cleanUrlNeedsUpdate = false; }
                else file[p] = t.value;
            }
        }
        if (t.type === 'color' || t.id === 'use-same-url-color') {
            if (t.id === 'use-same-url-color') { state.settings.useSameUrlColor = t.checked; updateUIForActiveGame(); }
            if (t.id === 'clean-url-color') state.settings.cleanUrlColor = t.value;
            if (t.id === 'cracked-url-color') state.settings.crackedUrlColor = t.value;
            if (t.id === 'section-title-color') state.settings.sectionTitleColor = t.value;
        }
        renderOutput(); saveData();
    });

    els.simpleModeBtn.addEventListener('click', () => { els.simpleModeBtn.classList.add('active'); els.advancedModeBtn.classList.remove('active'); els.simpleModeControls.classList.remove('hidden'); els.advancedModeControls.classList.add('hidden'); });
    els.advancedModeBtn.addEventListener('click', () => { els.advancedModeBtn.classList.add('active'); els.simpleModeBtn.classList.remove('active'); els.advancedModeControls.classList.remove('hidden'); els.simpleModeControls.classList.add('hidden'); });
    els.previewTabBtn.addEventListener('click', () => { els.previewTabBtn.classList.add('active'); els.codeTabBtn.classList.remove('active'); els.previewPane.classList.remove('hidden'); els.codePane.classList.add('hidden'); });
    els.codeTabBtn.addEventListener('click', () => { els.codeTabBtn.classList.add('active'); els.previewTabBtn.classList.remove('active'); els.codePane.classList.remove('hidden'); els.previewPane.classList.add('hidden'); });
    els.copyBtnTop.addEventListener('click', () => handleCopyClick(els.copyBtnTop));
    els.copyBtnBottom.addEventListener('click', () => handleCopyClick(els.copyBtnBottom));
    els.downloadBtn.addEventListener('click', () => { const blob = new Blob([els.outputCode.value], { type: 'text/plain' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${state.games[state.activeGameIndex].gameTitle}.txt`; a.click(); });
    els.templateEditor.addEventListener('input', (e) => { state.template = e.target.value; renderOutput(); saveData(); });
    els.resetTemplateBtn.addEventListener('click', () => { state.template = templates.multiple; els.templateEditor.value = state.template; renderOutput(); saveData(); });

    // Auth Logic
    els.loginButton.addEventListener('click', () => els.loginModal.style.display = 'block');
    els.registerButton.addEventListener('click', () => els.registerModal.style.display = 'block');
    els.logoutButton.addEventListener('click', () => handleLogout());
    els.localSyncButton.addEventListener('click', () => els.syncModal.style.display = 'block');
    els.settingsButton.addEventListener('click', () => els.settingsModal.style.display = 'block');
    els.loginForm.addEventListener('submit', handleLogin);
    els.registerForm.addEventListener('submit', handleRegister);
    els.exportDataButton.addEventListener('click', exportDataToFile);
    els.importDataInput.addEventListener('change', importDataFromFile);
    els.importOldDataButton.addEventListener('click', () => {
        const old = localStorage.getItem('gameInfoFormatterCache');
        if (old && confirm('Import old data?')) {
            try {
                const p = JSON.parse(old);
                if (p.games) {
                    state.games = p.games.map(migrateGameData);
                    saveData(); updateDisplay();
                    alert("Legacy data imported successfully.");
                }
            } catch (e) { alert("Error importing legacy data."); }
        } else if (!old) alert("No old data found.");
    });
    if (els.changePasswordButton) els.changePasswordButton.addEventListener('click', () => els.changePasswordModal.style.display = 'block');
    if (els.changePasswordForm) els.changePasswordForm.addEventListener('submit', handleChangePassword);
    document.body.addEventListener('click', (e) => { if (e.target.matches('.close-modal, .close-auth-modal, .close-sync-modal')) e.target.closest('div[id$="Modal"]').style.display = 'none'; });
}

function importDataFromFile(e) {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = async (ev) => {
        try {
            const data = JSON.parse(ev.target.result);
            if (data.games) {
                data.games = data.games.map(migrateGameData);
                if (confirm("Overwrite current data?")) {
                    state = data; saveLocalData(); updateDisplay();
                    if (authManager?.isLoggedIn() && confirm("Save to server?")) await saveBackendData();
                }
            } else alert("Invalid file.");
        } catch (err) { alert("Import failed."); }
    };
    r.readAsText(f);
}

/**********************
 * Auth UI & Handlers
 **********************/
function updateUIForLoginState() {
    const els = getElements(); if (!els.loginButton || !authManager) return;
    const loggedIn = authManager.isLoggedIn();
    const currentUser = authManager.currentUser;
    els.loginButton.style.display = loggedIn ? 'none' : 'inline-block';
    els.registerButton.style.display = loggedIn ? 'none' : 'inline-block';
    els.logoutButton.style.display = loggedIn ? 'inline-block' : 'none';
    els.userStatus.textContent = loggedIn ? `Logged in: ${currentUser?.username || 'User'}` : 'Not logged in';
    els.userStatus.style.color = loggedIn ? '#4bc0c0' : '#ccc';
    if (els.changePasswordButton) els.changePasswordButton.style.display = loggedIn ? 'inline-block' : 'none';
}

async function handleLogin(e) {
    e.preventDefault(); const els = getElements(); els.loginError.textContent = '';
    try {
        await authManager.login(els.loginForm.loginUsername.value, els.loginForm.loginPassword.value);
        els.loginModal.style.display = 'none';
        els.loginForm.reset();
        // Auth events will trigger sync via listeners
    } catch (err) { els.loginError.textContent = err.message; }
}

async function handleRegister(e) {
    e.preventDefault(); const els = getElements(); els.registerError.textContent = '';
    if (els.registerForm.registerPassword.value !== els.registerForm.registerConfirmPassword.value) { els.registerError.textContent = 'Mismatch'; return; }
    try {
        await authManager.register(els.registerForm.registerUsername.value, els.registerForm.registerPassword.value);
        alert("Registered."); els.registerModal.style.display = 'none'; els.loginModal.style.display = 'block';
    } catch (err) { els.registerError.textContent = err.message; }
}

async function handleLogout(msg) {
    if (msg) alert(msg);
    await authManager.logout();
    // Auth events will trigger UI update via listeners
}

async function handleChangePassword(e) {
    e.preventDefault(); const els = getElements(); els.changePasswordError.textContent = '';
    if (els.changePasswordForm.newPassword.value !== els.changePasswordForm.confirmNewPassword.value) { els.changePasswordError.textContent = 'Mismatch'; return; }
    try {
        await authManager.changePassword(els.changePasswordForm.currentPassword.value, els.changePasswordForm.newPassword.value);
        alert("Changed."); await handleLogout();
    } catch (err) { els.changePasswordError.textContent = err.message; }
}

function exportDataToFile() {
    const b = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = `${APP_NAME}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
}

function importOldLocalData() { const o = localStorage.getItem('gameInfoFormatterCache'); if (o && confirm('Import old?')) { state.games = JSON.parse(o).games.map(migrateGameData); saveData(); updateDisplay(); } }

async function syncOnLoad() { const d = await fetchBackendData(); if (d) { state = d; state.games = state.games.map(migrateGameData); saveLocalData(); updateDisplay(); } }

/**********************
 * Auth Event Listeners (for cross-tab sync)
 **********************/
function setupAuthEventListeners() {
    // Listen for login events (from this tab or other tabs)
    window.addEventListener('auth:login', async (e) => {
        console.log('[AUTH_EVENT] Login detected:', e.detail?.user?.username);
        updateUIForLoginState();
        await syncOnLoad();
    });

    // Listen for session restoration (page load with existing session)
    window.addEventListener('auth:session-restored', async (e) => {
        console.log('[AUTH_EVENT] Session restored:', e.detail?.user?.username);
        updateUIForLoginState();
        await syncOnLoad();
    });

    // Listen for logout events (from this tab or other tabs)
    window.addEventListener('auth:logout', (e) => {
        console.log('[AUTH_EVENT] Logout detected:', e.detail?.message);
        loadLocalData();
        updateUIForLoginState();
        updateDisplay();
    });

    // Listen for no session on page load
    window.addEventListener('auth:no-session', () => {
        console.log('[AUTH_EVENT] No active session');
        updateUIForLoginState();
    });
}

/**********************
 * Initial Page Load
 **********************/
document.addEventListener("DOMContentLoaded", async () => {
    // Initialize AuthManager
    if (typeof AuthManager !== 'undefined') {
        authManager = new AuthManager(APP_NAME, ENVIRONMENT);
    } else {
        console.error("AuthManager not loaded! Make sure auth.js is included before this script.");
        return;
    }

    await loadTemplates();
    loadLocalData();
    setupEventListeners();
    setupAuthEventListeners();

    if (!state.template) state.template = templates.multiple;
    const savedIndex = localStorage.getItem(`${STORAGE_PREFIX}activeGameIndex`);
    if (savedIndex !== null && state.games.length > savedIndex) state.activeGameIndex = parseInt(savedIndex);

    // Initialize auth session - AuthManager will dispatch appropriate events
    await authManager.initialize();
    
    updateDisplay();
});