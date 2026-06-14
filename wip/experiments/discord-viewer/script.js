const API_BASE_URL = "https://discord-messages-api-rosie-stuffs.rosestuffs.org";
const STORAGE_KEY_API_KEY = "discord_api_key";
const APP_NAME = "discord-viewer";

let API_KEY = localStorage.getItem(STORAGE_KEY_API_KEY);
let authManager = null;

// Application State
const state = {
    servers: [],
    currentServerId: null,
    channels: [],
    currentChannelId: null,
    messages: [],
    oldestMessageId: null,
    newestMessageId: null,    // newest loaded msg; used for forward-pagination
    hasMoreMessages: true,    // older messages may exist (paginate up)
    hasNewerMessages: false,  // newer messages may exist (paginate down)
    searchQuery: "",
    isLoading: false,
    isJumpedView: false,      // true when viewing a window centered on a past message
    viewSequence: 0           // bumped on every full-replace; lets in-flight load-more bail
};

// DOM Elements
const serverListEl = document.getElementById("serverList");
const channelListEl = document.getElementById("channelList");
const messageListEl = document.getElementById("messageList");
const messagesWrapperEl = document.getElementById("messagesWrapper");
const serverNameEl = document.getElementById("serverName");
const channelNameEl = document.getElementById("channelName");
const channelTopicEl = document.getElementById("channelTopic");
const apiKeyModal = document.getElementById("apiKeyModal");
const apiKeyForm = document.getElementById("apiKeyForm");
const inputApiKey = document.getElementById("inputApiKey");
const apiKeyError = document.getElementById("apiKeyError");
const apiKeyButton = document.getElementById("apiKeyButton");
const messageSearchInput = document.getElementById("messageSearch");
const statsButton = document.getElementById("statsButton");
const statsPanel = document.getElementById("statsPanel");
const statsContent = document.getElementById("statsContent");
const closeStatsBtn = document.querySelector(".close-stats");
const membersButton = document.getElementById("membersButton");
const membersPanel = document.getElementById("membersPanel");
const membersContent = document.getElementById("membersContent");
const memberCountEl = document.getElementById("memberCount");
const closeMembersBtn = document.querySelector(".close-members");

// Auth Elements
const userStatusEl = document.getElementById("userStatus");
const loginButton = document.getElementById("loginButton");
const registerButton = document.getElementById("registerButton");
const logoutButton = document.getElementById("logoutButton");
const localSyncButton = document.getElementById("localSyncButton");
const settingsButton = document.getElementById("settingsButton");

// --- Initialization ---

document.addEventListener("DOMContentLoaded", () => {
    // Initialize AuthManager (uses the global auth.js script)
    initializeAuth();
    
    if (!API_KEY) {
        showApiKeyModal();
    } else {
        initApp();
    }

    // Event Listeners
    apiKeyForm.addEventListener("submit", handleApiKeySubmit);
    apiKeyButton.addEventListener("click", showApiKeyModal);
    
    // Search
    let searchDebounce;
    messageSearchInput.addEventListener("input", (e) => {
        clearTimeout(searchDebounce);
        searchDebounce = setTimeout(() => {
            handleSearch(e.target.value);
        }, 500);
    });

    // Stats
    statsButton.addEventListener("click", toggleStatsPanel);
    closeStatsBtn.addEventListener("click", toggleStatsPanel);

    // Members panel toggle (persisted to localStorage)
    if (membersButton) membersButton.addEventListener("click", toggleMembersPanel);
    if (closeMembersBtn) closeMembersBtn.addEventListener("click", () => setMembersPanelOpen(false));
    if (localStorage.getItem('discord_members_panel') === 'open') {
        setMembersPanelOpen(true);
    }
    
    const refreshBtn = document.getElementById("refreshButton");
    if (refreshBtn) {
        refreshBtn.addEventListener("click", () => {
             refreshBtn.classList.add("spinning"); // Add a CSS class for rotation
             handleRefresh();
             setTimeout(() => refreshBtn.classList.remove("spinning"), 1000);
        });
    }
    
    // Settings button
    if (settingsButton) {
        settingsButton.addEventListener("click", () => {
            openModal("settingsModal");
        });
    }
    
    // Modal close handlers
    setupModalCloseHandlers();

    // Infinite scroll
    messagesWrapperEl.addEventListener('scroll', handleInfiniteScroll);

    // Reply preview click → jump to message
    messagesWrapperEl.addEventListener('click', (e) => {
        const reply = e.target.closest('.reply-preview');
        if (!reply || !reply.dataset.jumpTo) return;
        jumpToMessage(reply.dataset.jumpTo);
    });

    // Detect user-initiated scroll/key input so post-jump re-centerings can
    // bail out and stop yanking the user back to the target message.
    messagesWrapperEl.addEventListener('wheel', _markUserInteracted, { passive: true });
    messagesWrapperEl.addEventListener('touchmove', _markUserInteracted, { passive: true });
    window.addEventListener('keydown', (e) => {
        // Page Up/Down, arrows, space, home/end — anything that can scroll.
        const scrollKeys = new Set([
            'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ',
        ]);
        if (scrollKeys.has(e.key)) _markUserInteracted();
    });

    // Jump-to-Present banner (visible only while viewing a past window)
    const jumpToPresentBtn = document.getElementById('jumpToPresentBtn');
    if (jumpToPresentBtn) {
        jumpToPresentBtn.addEventListener('click', jumpToPresent);
    }

    // Theme picker (settings modal)
    const themeSelect = document.getElementById('theme-select');
    if (themeSelect) {
        themeSelect.value = localStorage.getItem('discord_theme') || 'dark';
        themeSelect.addEventListener('change', (e) => {
            const theme = e.target.value;
            document.documentElement.dataset.theme = theme;
            localStorage.setItem('discord_theme', theme);
        });
    }
});

// Broken custom-emoji image → text fallback (deleted/inaccessible emoji)
document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.classList && t.classList.contains('custom-emoji')) {
        const fallback = document.createElement('span');
        fallback.className = 'mention mention-unknown';
        fallback.textContent = t.alt || ':emoji:';
        t.replaceWith(fallback);
    }
}, true);

// --- Auth Manager Integration ---

function initializeAuth() {
    // Check if AuthManager is loaded (from /auth.js)
    if (typeof AuthManager !== 'undefined') {
        authManager = new AuthManager(APP_NAME, 'wip');
        
        // Listen for auth events
        window.addEventListener('auth:login', handleAuthLogin);
        window.addEventListener('auth:logout', handleAuthLogout);
        window.addEventListener('auth:session-restored', handleSessionRestored);
        window.addEventListener('auth:no-session', handleNoSession);
        
        // Initialize session
        authManager.initialize();
    } else {
        console.warn('AuthManager not loaded. Auth features disabled.');
        updateUIForGuest();
    }
    
    // Set up button handlers regardless
    if (loginButton) loginButton.addEventListener("click", () => openModal("loginModal"));
    if (registerButton) registerButton.addEventListener("click", () => openModal("registerModal"));
    if (logoutButton) logoutButton.addEventListener("click", handleLogout);
    
    // Form handlers
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    const changePasswordForm = document.getElementById("changePasswordForm");
    
    if (loginForm) loginForm.addEventListener("submit", handleLoginSubmit);
    if (registerForm) registerForm.addEventListener("submit", handleRegisterSubmit);
    if (changePasswordForm) changePasswordForm.addEventListener("submit", handleChangePasswordSubmit);
    
    // Change password button in settings
    const changePasswordButton = document.getElementById("changePasswordButton");
    if (changePasswordButton) {
        changePasswordButton.addEventListener("click", () => {
            closeModal("settingsModal");
            openModal("changePasswordModal");
        });
    }
    
    // Local sync button
    if (localSyncButton) {
        localSyncButton.addEventListener("click", () => openModal("syncModal"));
    }
    
    // Export/Import handlers
    const exportDataBtn = document.getElementById("exportData");
    const importDataInput = document.getElementById("importData");
    
    if (exportDataBtn) exportDataBtn.addEventListener("click", exportAllData);
    if (importDataInput) importDataInput.addEventListener("change", importData);
    
    // Sync choice buttons
    const useLocalDataBtn = document.getElementById("useLocalDataBtn");
    const useServerDataBtn = document.getElementById("useServerDataBtn");
    
    if (useLocalDataBtn) useLocalDataBtn.addEventListener("click", () => resolveSync("local"));
    if (useServerDataBtn) useServerDataBtn.addEventListener("click", () => resolveSync("server"));
}

function handleAuthLogin(event) {
    const user = event.detail.user;
    updateUIForLoggedIn(user);
    syncDataAfterLogin();
}

function handleAuthLogout() {
    updateUIForGuest();
}

function handleSessionRestored(event) {
    const user = event.detail.user;
    updateUIForLoggedIn(user);
}

function handleNoSession() {
    updateUIForGuest();
}

function updateUIForLoggedIn(user) {
    if (userStatusEl) userStatusEl.textContent = user.username || 'Logged In';
    if (loginButton) loginButton.style.display = 'none';
    if (registerButton) registerButton.style.display = 'none';
    if (logoutButton) logoutButton.style.display = 'block';
    
    // Show change password in settings
    const changePasswordButton = document.getElementById("changePasswordButton");
    if (changePasswordButton) changePasswordButton.style.display = 'block';
}

function updateUIForGuest() {
    if (userStatusEl) userStatusEl.textContent = 'Guest';
    if (loginButton) loginButton.style.display = 'block';
    if (registerButton) registerButton.style.display = 'block';
    if (logoutButton) logoutButton.style.display = 'none';
    
    // Hide change password in settings
    const changePasswordButton = document.getElementById("changePasswordButton");
    if (changePasswordButton) changePasswordButton.style.display = 'none';
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("loginUsername").value;
    const password = document.getElementById("loginPassword").value;
    const errorEl = document.getElementById("loginError");
    
    try {
        await authManager.login(username, password);
        closeModal("loginModal");
        errorEl.textContent = "";
    } catch (err) {
        errorEl.textContent = err.message || "Login failed";
    }
}

async function handleRegisterSubmit(e) {
    e.preventDefault();
    const username = document.getElementById("registerUsername").value;
    const password = document.getElementById("registerPassword").value;
    const confirmPassword = document.getElementById("registerConfirmPassword").value;
    const errorEl = document.getElementById("registerError");
    
    if (password !== confirmPassword) {
        errorEl.textContent = "Passwords do not match";
        return;
    }
    
    try {
        await authManager.register(username, password);
        closeModal("registerModal");
        errorEl.textContent = "";
        // Auto login after register
        await authManager.login(username, password);
    } catch (err) {
        errorEl.textContent = err.message || "Registration failed";
    }
}

async function handleChangePasswordSubmit(e) {
    e.preventDefault();
    const currentPassword = document.getElementById("currentPassword").value;
    const newPassword = document.getElementById("newPassword").value;
    const confirmNewPassword = document.getElementById("confirmNewPassword").value;
    const errorEl = document.getElementById("changePasswordError");
    const successEl = document.getElementById("changePasswordSuccess");
    
    errorEl.textContent = "";
    successEl.textContent = "";
    
    if (newPassword !== confirmNewPassword) {
        errorEl.textContent = "New passwords do not match";
        return;
    }
    
    try {
        await authManager.changePassword(currentPassword, newPassword);
        successEl.textContent = "Password changed successfully!";
        document.getElementById("changePasswordForm").reset();
    } catch (err) {
        errorEl.textContent = err.message || "Failed to change password";
    }
}

async function handleLogout() {
    if (authManager) {
        await authManager.logout();
    }
}

// --- Data Sync ---

async function syncDataAfterLogin() {
    if (!authManager || !authManager.isLoggedIn()) return;
    
    try {
        const serverData = await authManager.fetchWithAuth(authManager.endpoints.data);
        const serverJson = await serverData.json();
        
        // Get local data
        const localData = getLocalData();
        
        // Check if we need to sync
        if (serverJson.apiKey && serverJson.apiKey !== API_KEY) {
            // Server has different data
            if (localData.apiKey && localData.apiKey !== serverJson.apiKey) {
                // Conflict - show choice modal
                showSyncChoiceModal(localData, serverJson);
            } else {
                // Server has data, we don't (or it's the same)
                applyServerData(serverJson);
            }
        }
    } catch (err) {
        console.log("Sync check completed (no server data or error):", err.message);
    }
}

function getLocalData() {
    return {
        apiKey: localStorage.getItem(STORAGE_KEY_API_KEY),
        lastUpdated: localStorage.getItem("discord_viewer_last_updated") || new Date().toISOString()
    };
}

function showSyncChoiceModal(localData, serverData) {
    document.getElementById("localLastUpdate").textContent = localData.lastUpdated || 'N/A';
    document.getElementById("localEntryCount").textContent = localData.apiKey ? '1 API Key' : '0';
    document.getElementById("serverLastUpdate").textContent = serverData.lastUpdated || 'N/A';
    document.getElementById("serverEntryCount").textContent = serverData.apiKey ? '1 API Key' : '0';
    
    window._syncLocalData = localData;
    window._syncServerData = serverData;
    
    openModal("syncChoiceModal");
}

async function resolveSync(choice) {
    closeModal("syncChoiceModal");
    
    if (choice === "local") {
        // Upload local data to server
        await uploadDataToServer(window._syncLocalData);
    } else {
        // Use server data
        applyServerData(window._syncServerData);
    }
    
    delete window._syncLocalData;
    delete window._syncServerData;
}

function applyServerData(serverData) {
    if (serverData.apiKey) {
        localStorage.setItem(STORAGE_KEY_API_KEY, serverData.apiKey);
        API_KEY = serverData.apiKey;
        initApp();
    }
}

async function uploadDataToServer(localData) {
    if (!authManager || !authManager.isLoggedIn()) return;
    
    try {
        await authManager.fetchWithAuth(authManager.endpoints.data, {
            method: 'POST',
            body: JSON.stringify({
                apiKey: localData.apiKey,
                lastUpdated: new Date().toISOString()
            })
        });
    } catch (err) {
        console.error("Failed to upload data:", err);
    }
}

// --- Export/Import ---

function exportAllData() {
    const data = {
        apiKey: API_KEY,
        exportedAt: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `discord-viewer-backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    const statusEl = document.getElementById("syncStatus");
    if (statusEl) statusEl.textContent = "Data exported successfully!";
}

function importData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (data.apiKey) {
                localStorage.setItem(STORAGE_KEY_API_KEY, data.apiKey);
                API_KEY = data.apiKey;
                initApp();
                
                const statusEl = document.getElementById("syncStatus");
                if (statusEl) statusEl.textContent = "Data imported successfully!";
            }
        } catch (err) {
            const statusEl = document.getElementById("syncStatus");
            if (statusEl) statusEl.textContent = "Error: Invalid file format";
        }
    };
    reader.readAsText(file);
}

// --- Modal Helpers ---

function setupModalCloseHandlers() {
    // Close buttons with data-modal-id attribute
    document.querySelectorAll('[data-modal-id]').forEach(btn => {
        btn.addEventListener('click', () => {
            const modalId = btn.dataset.modalId;
            closeModal(modalId);
        });
    });
    
    // Click outside to close
    document.querySelectorAll('.modal, .auth-modal, .sync-modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });
    });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'flex';
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.style.display = 'none';
}

// --- API Key Handling ---

function showApiKeyModal() {
    openModal("apiKeyModal");
    if (API_KEY) inputApiKey.value = API_KEY;
    inputApiKey.focus();
}

function handleApiKeySubmit(e) {
    e.preventDefault();
    const key = inputApiKey.value.trim();
    if (key.length < 5) {
        apiKeyError.textContent = "Invalid API Key";
        return;
    }
    
    API_KEY = key;
    localStorage.setItem(STORAGE_KEY_API_KEY, API_KEY);
    localStorage.setItem("discord_viewer_last_updated", new Date().toISOString());
    closeModal("apiKeyModal");
    apiKeyError.textContent = "";
    initApp();
    
    // Sync to server if logged in
    if (authManager && authManager.isLoggedIn()) {
        uploadDataToServer({ apiKey: API_KEY });
    }
}

async function initApp() {
    renderLoadingServer();
    try {
        await fetchServers();
        renderServers();
        
        // Restore state
        const lastServerId = localStorage.getItem('lastServerId');
        if (lastServerId && state.servers.find(s => s.id == lastServerId)) {
            await selectServer(lastServerId);
            
            const lastChannelId = localStorage.getItem('lastChannelId');
            if (lastChannelId && state.channels.find(c => c.id == lastChannelId)) {
                await selectChannel(lastChannelId);
            }
        }
        
    } catch (error) {
        console.error("Failed to init app:", error);
        if (error.status === 401) {
            apiKeyError.textContent = "Authentication failed. Invalid Key.";
            showApiKeyModal();
        } else {
            messageListEl.innerHTML = `<div class="empty-state">Failed to load servers. Check your API key and try again.</div>`;
        }
    }
}

// --- API Helpers ---

async function apiCall(endpoint, params = {}) {
    const url = new URL(`${API_BASE_URL}${endpoint}`);
    Object.keys(params).forEach(key => params[key] && url.searchParams.append(key, params[key]));

    const response = await fetch(url, {
        headers: {
            "Authorization": `Bearer ${API_KEY}`,
            "Content-Type": "application/json"
        }
    });

    if (!response.ok) {
        const err = new Error(`API Error: ${response.statusText}`);
        err.status = response.status;
        throw err;
    }

    return await response.json();
}

// --- Servers ---

async function fetchServers() {
    const data = await apiCall("/api/servers");
    state.servers = data.servers || [];
}

function renderLoadingServer() {
    serverListEl.innerHTML = '<div class="server-item placeholder"></div>';
}

function renderServers() {
    serverListEl.innerHTML = "";
    
    if (state.servers.length === 0) {
        serverListEl.innerHTML = '<div class="server-item" title="No servers">?</div>';
        return;
    }
    
    state.servers.forEach(server => {
        const el = document.createElement("div");
        el.className = "server-item";
        el.title = server.name;
        el.dataset.id = server.id;
        
        // Make acronym from server name
        const words = server.name.match(/\b(\w)/g) || [server.name.charAt(0)];
        const acronym = words.join('').slice(0, 3).toUpperCase();
        el.textContent = acronym;
        
        el.addEventListener("click", () => selectServer(server.id));
        serverListEl.appendChild(el);
    });
}

async function selectServer(serverId) {
    state.currentServerId = serverId;
    state.currentChannelId = null;
    
    // UI Update
    document.querySelectorAll(".server-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id == serverId);
    });

    localStorage.setItem('lastServerId', serverId);
    
    const server = state.servers.find(s => s.id == serverId);
    if (server) serverNameEl.textContent = server.name;
    
    // Fetch Channels
    channelListEl.innerHTML = '<div style="padding:10px; color:#aaa;">Loading...</div>';
    try {
        await fetchChannels(serverId);
        renderChannels();
    } catch (e) {
        channelListEl.innerHTML = `<div style="padding:10px; color:#f44;">Failed to load channels: ${e.message}</div>`;
    }

    // Members panel — fetch in the background; render if panel is open.
    loadServerMembers(serverId).catch(e => console.warn('member load failed:', e));

    // Auto-select last viewed channel for this server
    const lastChannelId = localStorage.getItem(`lastChannel_${serverId}`);
    if (lastChannelId && state.channels.some(c => c.id == lastChannelId)) {
        selectChannel(lastChannelId);
    }
}

// --- Channels ---

async function fetchChannels(serverId) {
    const data = await apiCall(`/api/servers/${serverId}/channels`);
    // Keep the API order; renderChannels does the layout pass.
    state.channels = (data.channels || []);
}

function _isThreadType(t) {
    if (!t) return false;
    const s = String(t).toLowerCase();
    return s.includes('thread');
}

function _channelIcon(channel) {
    if (_isThreadType(channel.type)) return '↳';
    if (channel.type === 'voice') return '🔊';
    if (channel.type === 'forum') return '📋';
    if (channel.type === 'announcement' || channel.type === 'news') return '📢';
    return '#';
}

function _appendCategorySection(name, children, threadsByParent, idSuffix) {
    // Returns true if anything was rendered.
    if (children.length === 0) return false;

    const catEl = document.createElement('div');
    catEl.className = 'channel-category';
    catEl.innerHTML = `<span class="category-arrow">▼</span> ${escapeHtml(name)}`;
    catEl.dataset.categoryId = idSuffix;

    const container = document.createElement('div');
    container.className = 'category-children';
    container.id = `category-${idSuffix}`;
    for (const ch of children) {
        container.appendChild(createChannelElement(ch));
        const tids = (threadsByParent && threadsByParent.get(String(ch.id))) || [];
        for (const t of tids) container.appendChild(createChannelElement(t));
    }

    catEl.addEventListener('click', () => {
        const collapsed = catEl.classList.toggle('category-collapsed');
        container.hidden = collapsed;
    });

    channelListEl.appendChild(catEl);
    channelListEl.appendChild(container);
    return true;
}

function renderChannels() {
    channelListEl.innerHTML = "";
    if (!state.channels || state.channels.length === 0) {
        channelListEl.innerHTML = '<div style="padding:10px; color:#aaa;">No channels found</div>';
        return;
    }

    const byPos = (a, b) => (a.position || 0) - (b.position || 0);

    const categories = state.channels
        .filter(c => c.type === 'category')
        .slice()
        .sort(byPos);
    const knownCategoryIds = new Set(categories.map(c => String(c.id)));
    const knownTextChannelIds = new Set(
        state.channels
            .filter(c => !_isThreadType(c.type) && c.type !== 'category')
            .map(c => String(c.id))
    );

    // Children = non-category channels grouped by parent_id (string keys to dodge ID precision).
    const childrenByParent = new Map();
    const orphans = [];   // top-level non-category channels with no parent
    const threadsByParent = new Map();

    for (const c of state.channels) {
        if (c.type === 'category') continue;
        if (_isThreadType(c.type)) {
            const key = String(c.parent_id || '');
            if (!key) continue;
            if (!threadsByParent.has(key)) threadsByParent.set(key, []);
            threadsByParent.get(key).push(c);
            continue;
        }
        if (c.parent_id) {
            const key = String(c.parent_id);
            if (!childrenByParent.has(key)) childrenByParent.set(key, []);
            childrenByParent.get(key).push(c);
        } else {
            orphans.push(c);
        }
    }
    childrenByParent.forEach(arr => arr.sort(byPos));
    threadsByParent.forEach(arr => arr.sort(byPos));
    orphans.sort(byPos);

    // Top-level units = orphans + categories, interleaved by position.
    const topLevel = [
        ...orphans.map(o => ({kind: 'channel', node: o, position: o.position || 0})),
        ...categories.map(c => ({kind: 'category', node: c, position: c.position || 0})),
    ].sort((a, b) => a.position - b.position);

    for (const unit of topLevel) {
        if (unit.kind === 'channel') {
            channelListEl.appendChild(createChannelElement(unit.node));
            // Top-level channels can also have threads under them.
            const tids = threadsByParent.get(String(unit.node.id)) || [];
            for (const t of tids) channelListEl.appendChild(createChannelElement(t));
        } else {
            const kids = childrenByParent.get(String(unit.node.id)) || [];
            _appendCategorySection(unit.node.name, kids, threadsByParent, String(unit.node.id));
        }
    }

    // ----- "Other" / orphaned section at the bottom -----
    // Channels whose parent_id doesn't resolve to a known category (deleted /
    // never-cached parent) and threads whose parent text channel is missing —
    // collect them so they don't disappear.
    const otherChannels = [];
    childrenByParent.forEach((arr, parentKey) => {
        if (!knownCategoryIds.has(parentKey)) otherChannels.push(...arr);
    });
    const orphanedThreads = [];
    threadsByParent.forEach((arr, parentKey) => {
        if (!knownTextChannelIds.has(parentKey)) orphanedThreads.push(...arr);
    });
    const leftovers = otherChannels.concat(orphanedThreads).sort(byPos);
    if (leftovers.length > 0) {
        _appendCategorySection('Other / Old', leftovers, null, '__other__');
    }
}

function createChannelElement(channel) {
    const el = document.createElement("div");
    el.className = "channel-item";
    if (_isThreadType(channel.type)) el.classList.add('channel-thread');
    el.dataset.id = channel.id;
    el.dataset.type = channel.type || '';
    el.innerHTML = `<span class="channel-hash">${_channelIcon(channel)}</span> ${escapeHtml(channel.name)}`;
    el.addEventListener("click", () => selectChannel(channel.id));
    return el;
}


function selectChannel(channelId) {
    state.currentChannelId = channelId;
    state.oldestMessageId = null;
    state.hasMoreMessages = true;
    
    // Remember last channel for this server
    if (state.currentServerId) {
        localStorage.setItem(`lastChannel_${state.currentServerId}`, channelId);
    }
    localStorage.setItem('lastChannelId', channelId);
    
    // UI Update
    document.querySelectorAll(".channel-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id == channelId);
    });
    
    const channel = state.channels.find(c => c.id == channelId);
    if (channel) {
        channelNameEl.textContent = channel.name;
        channelTopicEl.textContent = ""; 
    }
    
    // Fetch Messages
    loadMessages(channelId);
}

// --- Messages ---

// --- Messages ---

async function loadMessages(channelId, append = false) {
    if (!append) {
        messageListEl.innerHTML = '<div class="empty-state">Loading messages...</div>';
        state.oldestMessageId = null;
        state.newestMessageId = null;
        state.hasMoreMessages = true;
        state.hasNewerMessages = false;   // fresh load = at live tail
        state.messages = [];
        state.viewSequence++;             // invalidates any in-flight load-more
        // Fresh load = back to the live tail. Hide the jump-to-present banner.
        setJumpedView(false);
    }
    state.isLoading = true;
    
    try {
        const params = { limit: 50 };
        if (append && state.oldestMessageId) {
            params.before = state.oldestMessageId;
        }
        
        const data = await apiCall(`/api/channels/${channelId}/messages`, params);
        const newMessages = data.messages || [];
        
        // Track if there are more messages to load
        state.hasMoreMessages = newMessages.length >= 50;
        
        // Sort by ID to get chronological order (newest last)
        const sortedNewMessages = newMessages.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        
        if (append) {
            // Prepend older messages
            state.messages = [...sortedNewMessages, ...state.messages];
            renderMessageBatch(sortedNewMessages, 'prepend');
        } else {
            // New load
            state.messages = sortedNewMessages;
            renderMessageBatch(sortedNewMessages, 'replace');
        }
        
        // Track oldest + newest for bidirectional pagination.
        if (state.messages.length > 0) {
            state.oldestMessageId = state.messages[0].id;
            state.newestMessageId = state.messages[state.messages.length - 1].id;
        }
        
        if (!append) {
            // Re-stick to bottom while async content (avatars/attachments/embeds)
            // loads and pushes the latest message off-screen. The actual snap is
            // done by both this immediate call and the ResizeObserver below.
            startStickyBottom();
            scrollToBottom();
            requestAnimationFrame(() => scrollToBottom());
        }

        // Fetch metadata for new messages
        enrichMessages(sortedNewMessages);
        
    } catch (e) {
        if (!append) {
            messageListEl.innerHTML = `<div class="empty-state error">Failed to load messages: ${escapeHtml(e.message)}</div>`;
        }
        console.error("Load messages error:", e);
    } finally {
        state.isLoading = false;
    }
}

async function loadMoreMessages() {
    if (!state.currentChannelId || state.isLoading || !state.hasMoreMessages) return;
    if (state.suppressLoadMore) return;

    // Snapshot the view sequence; any full-replace (channel switch, jump) bumps
    // it, and we'll bail out below if we've fallen behind.
    const mySeq = state.viewSequence;
    const myChannel = state.currentChannelId;

    state.isLoading = true;
    let fetched = [];
    try {
        const params = { limit: 50 };
        if (state.oldestMessageId) params.before = state.oldestMessageId;
        const data = await apiCall(`/api/channels/${myChannel}/messages`, params);
        fetched = data.messages || [];
    } catch (e) {
        console.error('Load more failed:', e);
        state.isLoading = false;
        return;
    }

    // The view changed under us (jump, channel switch, etc.) — drop the result.
    if (mySeq !== state.viewSequence || myChannel !== state.currentChannelId) {
        state.isLoading = false;
        return;
    }

    state.hasMoreMessages = fetched.length >= 50;
    if (fetched.length === 0) {
        state.isLoading = false;
        return;
    }

    const sortedNew = fetched.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // Sample anchor + its visual offset right before insertion.
    const anchorEl = findTopVisibleMessage();
    const anchorOffsetBefore = anchorEl
        ? anchorEl.getBoundingClientRect().top - messagesWrapperEl.getBoundingClientRect().top
        : 0;

    // Insert.
    state.messages = [...sortedNew, ...state.messages];
    renderMessageBatch(sortedNew, 'prepend');
    if (state.messages.length > 0) {
        state.oldestMessageId = state.messages[0].id;
    }

    // Restore: shift scrollTop so anchor's visual offset matches what it was.
    if (anchorEl && anchorEl.isConnected) {
        const anchorOffsetAfter =
            anchorEl.getBoundingClientRect().top - messagesWrapperEl.getBoundingClientRect().top;
        messagesWrapperEl.scrollTop += anchorOffsetAfter - anchorOffsetBefore;
    }

    state.isLoading = false;
    enrichMessages(sortedNew);
}

function findTopVisibleMessage() {
    const wrapperTop = messagesWrapperEl.getBoundingClientRect().top;
    const items = messageListEl.querySelectorAll('.message-item');
    for (const el of items) {
        const r = el.getBoundingClientRect();
        if (r.bottom > wrapperTop) {
            return el;
        }
    }
    return null;
}

async function loadNewerMessages() {
    // Forward pagination: load the chronologically-next chunk after newestMessageId.
    if (!state.currentChannelId || state.isLoading || !state.hasNewerMessages) return;
    if (state.suppressLoadMore) return;
    if (!state.newestMessageId) return;

    const mySeq = state.viewSequence;
    const myChannel = state.currentChannelId;

    state.isLoading = true;
    let fetched = [];
    try {
        const data = await apiCall(`/api/channels/${myChannel}/messages`, {
            after: state.newestMessageId,
            limit: 50,
        });
        fetched = data.messages || [];
    } catch (e) {
        console.error('Load newer failed:', e);
        state.isLoading = false;
        return;
    }

    if (mySeq !== state.viewSequence || myChannel !== state.currentChannelId) {
        state.isLoading = false;
        return;
    }

    if (fetched.length < 50) {
        // Fewer than a full page = we've caught up to the live tail.
        state.hasNewerMessages = false;
        setJumpedView(false);
    }
    if (fetched.length === 0) {
        state.isLoading = false;
        return;
    }

    const sortedNew = fetched.sort((a, b) => String(a.id).localeCompare(String(b.id)));

    // Append at the bottom; no scroll adjustment needed — content is being added
    // below the user's current view, so their scroll position stays put.
    state.messages = [...state.messages, ...sortedNew];
    renderMessageBatch(sortedNew, 'append');
    state.newestMessageId = state.messages[state.messages.length - 1].id;

    state.isLoading = false;
    enrichMessages(sortedNew);
}

function centerMessageInView(target) {
    const wrapperRect = messagesWrapperEl.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const wrapperCenter = wrapperRect.top + wrapperRect.height / 2;
    const targetCenter = targetRect.top + targetRect.height / 2;
    messagesWrapperEl.scrollTop += targetCenter - wrapperCenter;
}

function setJumpedView(isJumped) {
    state.isJumpedView = isJumped;
    const btn = document.getElementById('jumpToPresentBtn');
    if (btn) btn.hidden = !isJumped;
}

async function jumpToPresent() {
    if (!state.currentChannelId) return;
    setJumpedView(false);
    await loadMessages(state.currentChannelId);
    // loadMessages already scrolls to bottom on a fresh (non-append) load.
}

// User-interaction tracking for the post-jump re-centerings: if the user
// scrolls, touches, or hits a key, we must NOT yank them back to the target.
let _userInteractedSinceJump = false;
function _markUserInteracted() { _userInteractedSinceJump = true; }

async function jumpToMessage(targetId) {
    if (!targetId) return;
    // The user is leaving the live tail; don't keep snapping them back.
    stopStickyBottom();
    // Bump immediately so any in-flight loadMoreMessages bails out before it
    // can prepend stale content above our about-to-be-rendered window. We also
    // suppress new load-mores until we've finished centering.
    state.viewSequence++;
    state.suppressLoadMore = true;
    _userInteractedSinceJump = false;

    // Always fetch the around-window. Even if the target happens to already be
    // in the DOM (because the user scrolled to it), we want the linear context
    // BELOW it to be the messages that came AFTER it — not whatever else was
    // previously loaded.
    if (state.currentChannelId) {
        try {
            const data = await apiCall(`/api/channels/${state.currentChannelId}/messages`, {
                around: targetId,
                limit: 50,
            });
            const fetched = (data.messages || []).sort(
                (a, b) => String(a.id).localeCompare(String(b.id))
            );
            // Replace the current view with this window so the target is in view.
            state.messages = fetched;
            renderMessageBatch(fetched, 'replace');
            if (fetched.length > 0) {
                state.oldestMessageId = fetched[0].id;
                state.newestMessageId = fetched[fetched.length - 1].id;
                state.hasMoreMessages = true;     // older still exist
                state.hasNewerMessages = true;    // newer still exist (we jumped to past)
            }
            // We're now showing a window in the past — surface the "Jump to Present" affordance.
            setJumpedView(true);
            enrichMessages(fetched);
        } catch (e) {
            console.error('Failed to fetch around target message:', e);
            state.suppressLoadMore = false;
            return;
        }
    }
    const target = messageListEl.querySelector(`[data-message-id="${CSS.escape(String(targetId))}"]`);
    if (!target) {
        state.suppressLoadMore = false;
        return;
    }

    // Manual centering — more reliable than scrollIntoView, especially under
    // a column-flex container. Re-run after a tick so any sync layout changes
    // from `renderMessageBatch` settle, and again later as embeds load.
    // BUT — only re-center if the user hasn't started scrolling. Otherwise
    // we'd yank them back to the target every time they try to scroll past it.
    centerMessageInView(target);
    requestAnimationFrame(() => {
        if (!_userInteractedSinceJump) centerMessageInView(target);
    });
    setTimeout(() => {
        if (!_userInteractedSinceJump && target.isConnected) centerMessageInView(target);
    }, 400);

    // Release the load-more lock once layout has settled; if user scrolls up
    // from here, the next loadMoreMessages run will paginate older messages.
    setTimeout(() => { state.suppressLoadMore = false; }, 1200);

    target.classList.add('message-flash');
    setTimeout(() => target.classList.remove('message-flash'), 1500);
}

let scrollDebounce = null;
const LOAD_MORE_THRESHOLD = 800; // px from edge — fire earlier so loading lands while user still has buffer
let _lastScrollTop = 0;
function handleInfiniteScroll() {
    const st = messagesWrapperEl.scrollTop;
    // If user is intentionally scrolling up, stop fighting them with stickyBottom.
    if (st < _lastScrollTop - 4) {
        stopStickyBottom();
    }
    _lastScrollTop = st;

    if (state.isLoading || state.suppressLoadMore) return;
    if (scrollDebounce) return;

    const distFromBottom =
        messagesWrapperEl.scrollHeight - st - messagesWrapperEl.clientHeight;

    if (st < LOAD_MORE_THRESHOLD && state.hasMoreMessages) {
        scrollDebounce = setTimeout(() => { scrollDebounce = null; }, 100);
        loadMoreMessages();
    } else if (distFromBottom < LOAD_MORE_THRESHOLD && state.hasNewerMessages) {
        scrollDebounce = setTimeout(() => { scrollDebounce = null; }, 100);
        loadNewerMessages();
    }
}

function renderMessageBatch(messages, mode = 'replace') {
    if (mode === 'replace') {
        messageListEl.innerHTML = "";
    }
    
    if (messages.length === 0 && mode === 'replace') {
        messageListEl.innerHTML = '<div class="empty-state">No messages found here.</div>';
        return;
    }
    
    // Create DocumentFragment for performance
    const fragment = document.createDocumentFragment();
    
    messages.forEach(msg => {
        const el = createMessageElement(msg);
        fragment.appendChild(el);
    });
    
    if (mode === 'prepend') {
        messageListEl.insertBefore(fragment, messageListEl.firstChild);
    } else {
        messageListEl.appendChild(fragment);
    }
}

function renderReplyPreview(replyTo) {
    if (!replyTo) return '';
    if (replyTo.missing) {
        return `<div class="reply-preview reply-missing">
            <span class="reply-connector"></span>
            <span class="reply-content"><em>Original message unavailable</em></span>
        </div>`;
    }
    const author = escapeHtml(replyTo.display_name || replyTo.username || 'Unknown');
    const avatarSrc = replyTo.avatar_url ? escapeHtml(replyTo.avatar_url) : '';
    const avatarHtml = avatarSrc
        ? `<img class="reply-avatar" src="${avatarSrc}" alt="" onerror="this.style.display='none'">`
        : `<span class="reply-avatar reply-avatar-placeholder"></span>`;
    let contentHtml;
    if (replyTo.is_deleted) {
        contentHtml = `<span class="reply-content"><span class="deleted-tag">[DELETED]</span> <em>${escapeHtml(replyTo.content || '')}</em></span>`;
    } else {
        contentHtml = `<span class="reply-content">${formatContent(replyTo.content || '', replyTo.mentions || {}, false)}</span>`;
    }
    return `<div class="reply-preview" data-jump-to="${escapeHtml(String(replyTo.id))}" title="Click to jump to message">
        <span class="reply-connector"></span>
        ${avatarHtml}
        <span class="reply-author">@${author}</span>
        ${contentHtml}
    </div>`;
}

function createMessageElement(msg) {
    const el = document.createElement("div");
    el.className = "message-item";
    el.dataset.messageId = msg.id;

    if (msg.is_deleted) {
        el.classList.add("message-deleted");
    }
    if (msg.reply_to) {
        el.classList.add("message-with-reply");
    }

    const date = new Date(msg.created_at || msg.timestamp || Date.now());
    const formattedDate = date.toLocaleString();

    // Avatar
    const avatarUrl = msg.avatar_url;
    let avatarHtml;
    if (avatarUrl) {
        avatarHtml = `<div class="message-avatar"><img src="${avatarUrl}" alt="avatar" onerror="this.style.display='none'"></div>`;
    } else {
        const idNum = parseInt(String(msg.user_id || msg.author_id || '0').slice(-8)) || 0;
        const avatarColor = "#" + ((idNum * 1234567) % 0xFFFFFF).toString(16).padStart(6, '0');
        avatarHtml = `<div class="message-avatar" style="background-color: ${avatarColor}"></div>`;
    }

    // Author
    const authorName = msg.display_name || msg.username || msg.author_name || 'Unknown';

    // Indicators
    const editedIndicator = msg.is_edited ?
        `<span class="message-edited" onclick="toggleEditHistory('${msg.id}')" title="Click to view edit history">(edited)</span>` : '';

    // Attachments
    const attachmentsHtml = renderAttachments(msg.attachments || []);
    const hasAttachments = (msg.attachments || []).length > 0;
    const mentions = msg.mentions || {};

    // Reply preview (rendered above the message body, Discord-style).
    const replyPreviewHtml = renderReplyPreview(msg.reply_to);

    // Content logic
    let contentHtml;
    if (msg.is_deleted) {
        const deletedText = msg.content ? formatContent(msg.content, mentions, hasAttachments) : '<em>[Message data unavailable]</em>';
        contentHtml = `<div class="deleted-content-wrapper">
            <span class="deleted-tag">[DELETED]</span>
            <span class="deleted-text">${deletedText}</span>
        </div>`;
    } else {
        contentHtml = formatContent(msg.content, mentions, hasAttachments);
    }

    el.innerHTML = `
        ${replyPreviewHtml}
        ${avatarHtml}
        <div class="message-content-wrapper">
            <div class="message-header">
                <span class="message-author">${escapeHtml(authorName)}</span>
                <span class="message-timestamp">${formattedDate}</span>
                ${editedIndicator}
            </div>
            <div class="message-body">${contentHtml}</div>
            <div class="message-embeds" id="embeds-${msg.id}"></div>
            ${attachmentsHtml}
            <div class="edit-history-container" id="edit-history-${msg.id}" style="display:none;"></div>
        </div>
    `;
    return el;
}

function renderAttachments(attachments) {
    if (!attachments || attachments.length === 0) return '';
    
    const items = attachments.map(att => {
        const contentType = att.content_type || '';
        const filename = att.filename || 'attachment';
        const messageId = att.message_id;
        
        // Use local API endpoint if local_path exists (Discord URLs expire)
        let url;
        if (att.local_path && messageId) {
            // Extract just the filename from local_path for the API call
            const localFilename = att.local_path.split('/').pop();
            url = `${API_BASE_URL}/api/attachments/${messageId}/${encodeURIComponent(localFilename)}?token=${encodeURIComponent(API_KEY)}`;
        } else {
            url = att.url; // Fallback to Discord URL (may be expired)
        }
        
        if (contentType.startsWith('image/')) {
            return `<div class="attachment-image"><img src="${url}" alt="${escapeHtml(filename)}" loading="lazy" onclick="window.open('${url}', '_blank')" onerror="this.parentElement.innerHTML='<span class=\\'attachment-error\\'>Image unavailable</span>'"></div>`;
        } else if (contentType.startsWith('video/')) {
            return `<div class="attachment-video"><video src="${url}" controls preload="metadata"></video></div>`;
        } else {
            const sizeKb = att.size_bytes ? Math.round(att.size_bytes / 1024) : '?';
            return `<div class="attachment-file"><a href="${url}" target="_blank" rel="noopener">📎 ${escapeHtml(filename)} (${sizeKb} KB)</a></div>`;
        }
    });
    
    return `<div class="message-attachments">${items.join('')}</div>`;
}

async function toggleEditHistory(messageId) {
    const container = document.getElementById(`edit-history-${messageId}`);
    if (!container) return;
    
    if (container.style.display === 'none') {
        container.innerHTML = '<em>Loading edit history...</em>';
        container.style.display = 'block';
        
        try {
            const data = await apiCall(`/api/messages/${messageId}/edits`);
            const history = data.edit_history || [];
            
            if (history.length === 0) {
                container.innerHTML = '<em>No edit history available</em>';
            } else {
                const historyHtml = history.map((edit) => {
                    const editDate = new Date(edit.edited_at).toLocaleString();
                    const oldContent = edit.content || edit.old_content || '[Content unavailable]';
                    const editMentions = edit.mentions || data.current_mentions || {};
                    return `<div class="edit-entry">
                        <span class="edit-timestamp">${editDate}</span>
                        <div class="edit-old-content">${formatContent(oldContent, editMentions, false)}</div>
                    </div>`;
                }).join('');
                container.innerHTML = `<div class="edit-history"><strong>Edit History:</strong>${historyHtml}</div>`;
            }
        } catch (e) {
            container.innerHTML = `<em>Failed to load edit history</em>`;
        }
    } else {
        container.style.display = 'none';
    }
}

function intToHexColor(n) {
    if (!n) return null;
    return '#' + n.toString(16).padStart(6, '0');
}

function emojiUrl(id, animated) {
    return `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`;
}

// Combined tokenizer: user/role/channel mentions, custom emoji, URLs.
// Group layout:
//   1: mention prefix (@, @!, @&, #)   2: mention id
//   3: 'a' if animated else ''         4: emoji name      5: emoji id
//   6: URL
const CONTENT_TOKEN_RE = /<(@!?|@&|#)(\d{15,21})>|<(a?):([A-Za-z0-9_~]+):(\d{15,21})>|(https?:\/\/[^\s<]+)/g;

function renderUserPill(id, mentions) {
    const u = mentions && mentions.users && mentions.users[id];
    if (!u || u.unknown) {
        return `<span class="mention mention-unknown" data-id="${id}">@unknown-user</span>`;
    }
    const display = escapeHtml(u.display_name || u.username || 'user');
    const title = escapeHtml(u.username || '');
    return `<span class="mention mention-user" data-user-id="${id}" title="${title}">@${display}</span>`;
}

function renderRolePill(id, mentions) {
    const r = mentions && mentions.roles && mentions.roles[id];
    if (!r || r.unknown) {
        return `<span class="mention mention-unknown" data-id="${id}">@unknown-role</span>`;
    }
    const name = escapeHtml(r.name || 'role');
    const hex = intToHexColor(r.color);
    if (hex) {
        // Inline color + tinted background derived from the role color.
        const safeHex = hex.replace(/[^#0-9a-fA-F]/g, '');
        return `<span class="mention mention-role" style="color:${safeHex};background-color:${safeHex}26" data-role-id="${id}">@${name}</span>`;
    }
    return `<span class="mention mention-role" data-role-id="${id}">@${name}</span>`;
}

function renderChannelPill(id, mentions) {
    const c = mentions && mentions.channels && mentions.channels[id];
    if (!c || c.unknown) {
        return `<span class="mention mention-unknown" data-id="${id}">#unknown-channel</span>`;
    }
    const name = escapeHtml(c.name || 'channel');
    return `<span class="mention mention-channel" data-channel-id="${id}">#${name}</span>`;
}

function renderCustomEmoji(animatedFlag, name, id) {
    // Trust the inline syntax for animated; ignore mentions.emojis[id].animated.
    const animated = animatedFlag === 'a';
    const safeName = escapeHtml(name || 'emoji');
    return `<img class="custom-emoji" src="${emojiUrl(id, animated)}" alt=":${safeName}:" title=":${safeName}:" loading="lazy">`;
}

function formatContent(content, mentions = {}, hasAttachments = false) {
    if (!content) {
        return hasAttachments ? '' : '<em>(No content)</em>';
    }

    let out = '';
    let lastIndex = 0;
    CONTENT_TOKEN_RE.lastIndex = 0;
    let m;
    while ((m = CONTENT_TOKEN_RE.exec(content)) !== null) {
        // Plain text before this token: escape & convert newlines.
        if (m.index > lastIndex) {
            out += escapeHtml(content.slice(lastIndex, m.index)).replace(/\n/g, '<br>');
        }
        if (m[1] !== undefined) {
            // Mention: prefix is @, @!, @&, or #
            const prefix = m[1];
            const id = m[2];
            if (prefix === '@' || prefix === '@!') {
                out += renderUserPill(id, mentions);
            } else if (prefix === '@&') {
                out += renderRolePill(id, mentions);
            } else if (prefix === '#') {
                out += renderChannelPill(id, mentions);
            } else {
                out += escapeHtml(m[0]);
            }
        } else if (m[5] !== undefined) {
            // Custom emoji
            out += renderCustomEmoji(m[3], m[4], m[5]);
        } else if (m[6] !== undefined) {
            // URL
            const safe = escapeHtml(m[6]);
            out += `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
        }
        lastIndex = m.index + m[0].length;
    }
    if (lastIndex < content.length) {
        out += escapeHtml(content.slice(lastIndex)).replace(/\n/g, '<br>');
    }
    return out;
}

async function enrichMessages(messages) {
    // Find messages with HTTP links
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    
    console.log(`Enriching ${messages.length} messages...`); // Debug
    
    for (const msg of messages) {
        if (!msg.content) continue;
        
        const matches = msg.content.match(urlRegex);
        if (!matches) continue;
        
        const uniqueUrls = [...new Set(matches)];
        
        for (const url of uniqueUrls) {
            // Check if we should embed this URL (YouTube, Tenor, etc)
            if (url.includes('youtube.com') || url.includes('youtu.be') || url.includes('tenor.com')) {
                console.log(`Found embeddable URL: ${url}`); // Debug
                try {
                    // Wait a tick to ensure DOM is ready if called immediately after render
                    await new Promise(r => setTimeout(r, 0));
                    
                    const embedContainer = document.getElementById(`embeds-${msg.id}`);
                    if (!embedContainer) {
                        console.warn(`Embed container not found for message ${msg.id}`);
                        continue;
                    }

                    // Fetch metadata from our backend proxy
                    const res = await apiCall(`/api/metadata`, { url });
                    console.log(`Metadata for ${url}:`, res); // Debug
                    
                    if (res && !res.error && res.type !== 'link') {
                        const embedHtml = renderEmbed(res);
                        // Avoid duplicates
                        if (embedHtml && !embedContainer.innerHTML.includes(res.url)) {
                            embedContainer.innerHTML += embedHtml;
                            
                            // Hide the URL link in message content since embed is showing
                            const messageEl = document.querySelector(`[data-message-id="${msg.id}"]`);
                            if (messageEl) {
                                const links = messageEl.querySelectorAll('.message-body a');
                                links.forEach(link => {
                                    if (link.href === url || link.textContent === url) {
                                        link.style.display = 'none';
                                    }
                                });
                            }
                        }
                    } else if (res && res.error) {
                        console.error(`Embed API error for ${url}:`, res.error);
                    }
                } catch (e) {
                    console.error(`Failed to enrich URL ${url}:`, e);
                }
            }
        }
    }
}

function renderEmbed(data) {
    if (data.provider === 'YouTube') {
        return renderYoutubeEmbed(data);
    } else if (data.provider === 'Tenor') {
        return `<div class="embed-card embed-gif-container">
            <div class="embed-provider">Tenor</div>
             <a href="${data.url}" target="_blank" class="embed-title">${escapeHtml(data.title)}</a>
            <div class="embed-media">
                <img src="${data.thumbnail_url}" alt="GIF" class="embed-image">
            </div>
        </div>`;
    }
    return '';
}

function renderYoutubeEmbed(data) {
    return `
        <div class="embed-card" style="max-width: 480px;">
            <div class="embed-provider">YouTube</div>
            <a href="${data.url}" target="_blank" class="embed-title">${escapeHtml(data.title)}</a>
            <div class="embed-author">${escapeHtml(data.author)}</div>
            <div class="embed-youtube-container" onclick="window.open('${data.url}', '_blank')">
                <img src="${data.thumbnail_url}" alt="Thumbnail" class="embed-image">
                <div class="youtube-play-overlay"></div>
            </div>
        </div>
    `;
}

function escapeHtml(text) {
    if (!text) return "";
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function scrollToBottom() {
    messagesWrapperEl.scrollTop = messagesWrapperEl.scrollHeight;
}

// "Stick to bottom" mode: on a fresh channel load we want the user to land at
// the latest message. Avatars / attachments / embeds load async and grow the
// message list, which would otherwise push the latest message *below* the
// viewport. While stickyBottom is true (set on every fresh load, cleared as
// soon as the user actively scrolls up), ANY size change snaps to the bottom.
let _stickyBottom = false;
const _stickyResizeObserver = (typeof ResizeObserver !== 'undefined')
    ? new ResizeObserver(() => {
        if (!_stickyBottom) return;
        // Defer one frame so the layout that triggered this observer settles.
        requestAnimationFrame(() => {
            if (!_stickyBottom) return;
            messagesWrapperEl.scrollTop = messagesWrapperEl.scrollHeight;
        });
    })
    : null;
if (_stickyResizeObserver) _stickyResizeObserver.observe(messageListEl);

function startStickyBottom() {
    _stickyBottom = true;
}
function stopStickyBottom() {
    _stickyBottom = false;
}

// --- Search ---

// --- Search ---

async function handleSearch(query) {
    if (query.length < 2) return;
    
    // Clear selection
    // state.currentChannelId = null; 
    // ^ Don't clear immediately, we might search within the channel
    
    messageListEl.innerHTML = '<div class="empty-state">Searching...</div>';
    
    // Determine scope
    const scope = document.getElementById("searchScope")?.value || "global";
    const serverId = (scope === "server" || scope === "channel") ? state.currentServerId : null;
    const channelId = (scope === "channel") ? state.currentChannelId : null;
    
    // Update UI text
    if (scope === "server") {
        channelNameEl.textContent = `Search Server: "${query}"`;
        channelTopicEl.textContent = "Server-wide results";
    } else if (scope === "channel") {
        channelNameEl.textContent = `Search Channel: "${query}"`;
        channelTopicEl.textContent = "Current channel results";
    } else {
        channelNameEl.textContent = `Search All: "${query}"`;
        channelTopicEl.textContent = "Global stats";
    }
    
    try {
        const params = { q: query, limit: 100 };
        if (serverId) params.server_id = serverId;
        if (channelId) params.channel_id = channelId;
        
        // Note: Backend needs to support these params. 
        // Based on my review, backend `searchMessages` accepts `server_ids` (plural) and optional `channel_id`.
        // The API endpoint `/api/search` currently only uses `allowed_server_ids` (all accessible).
        // I need to update the backend to filter by specific server_id if provided.
        // Wait, checking api_server.py... it only used `allowed_server_ids`.
        // I will assume for now I need to send `server_id` and `channel_id` and Backend will filter.
        // Actually, let's filter purely client side? No, that's inefficient.
        // Let's pass the params.
        
        const data = await apiCall("/api/search", params);
        state.messages = data.results || [];
        
        calculateSearchStats(state.messages, query);
        renderMessages();
    } catch (e) {
        messageListEl.innerHTML = `<div class="empty-state error">Search failed: ${escapeHtml(e.message)}</div>`;
    }
}

// --- Refresh ---

function handleRefresh() {
    if (state.currentChannelId) {
        loadMessages(state.currentChannelId);
    } else {
        fetchServers(); // Basic refresh
    }
}

// --- Stats & Features ---

function calculateSearchStats(messages, query) {
    if (!messages.length) {
        updateStatsView({});
        return;
    }

    const wordCounts = {};
    
    messages.forEach(msg => {
        if (!msg.content) return;
        const author = msg.display_name || msg.username || msg.author_name || "Unknown";
        wordCounts[author] = (wordCounts[author] || 0) + 1;
    });
    
    updateStatsView(wordCounts, query);
}

function updateStatsView(counts, query) {
    statsContent.innerHTML = "";
    
    if (!query) {
        statsContent.innerHTML = "<p>Perform a search to see stats.</p>";
        return;
    }

    const title = document.createElement("h3");
    title.style.marginBottom = "10px";
    title.textContent = `Author Usage for "${query}"`;
    statsContent.appendChild(title);
    
    const sortedAuthors = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    
    if (sortedAuthors.length === 0) {
        statsContent.innerHTML += "<p>No matches found.</p>";
        return;
    }
    
    sortedAuthors.forEach(([author, count]) => {
        const item = document.createElement("div");
        item.className = "stat-item";
        item.innerHTML = `
            <div class="stat-label">${escapeHtml(author)}</div>
            <div class="stat-value">${count} matches</div>
        `;
        statsContent.appendChild(item);
    });
}

function toggleStatsPanel() {
    const isHidden = statsPanel.style.display === "none";
    statsPanel.style.display = isHidden ? "flex" : "none";
}


// ============ Members panel ============

state.serverMembers = [];   // last fetched members for the current server

function setMembersPanelOpen(open) {
    if (!membersPanel) return;
    membersPanel.hidden = !open;
    localStorage.setItem('discord_members_panel', open ? 'open' : 'closed');
    if (open) renderMembersPanel();
}

function toggleMembersPanel() {
    setMembersPanelOpen(membersPanel.hidden);
}

async function loadServerMembers(serverId) {
    if (!serverId) {
        state.serverMembers = [];
        return;
    }
    try {
        const data = await apiCall(`/api/servers/${serverId}/members`);
        state.serverMembers = data.members || [];
    } catch (e) {
        console.warn('members fetch failed:', e);
        state.serverMembers = [];
    }
    if (membersPanel && !membersPanel.hidden) renderMembersPanel();
}

function _intToHex(n) {
    if (!n) return null;
    return '#' + Number(n).toString(16).padStart(6, '0');
}

function _topHoistedRole(member) {
    // Return the role with the highest position that is hoisted; null otherwise.
    const hoisted = (member.roles || []).filter(r => r.is_hoist);
    if (hoisted.length === 0) return null;
    return hoisted.slice().sort((a, b) => (b.position || 0) - (a.position || 0))[0];
}

function _highestColoredRole(member) {
    // Used for name colour in the panel — Discord uses the highest role with a colour.
    const coloured = (member.roles || []).filter(r => r.color && r.color !== 0);
    if (coloured.length === 0) return null;
    return coloured.slice().sort((a, b) => (b.position || 0) - (a.position || 0))[0];
}

function renderMembersPanel() {
    if (!membersContent) return;
    const members = state.serverMembers || [];
    memberCountEl.textContent = members.length ? `(${members.length})` : '';
    membersContent.innerHTML = '';
    if (!members.length) {
        membersContent.innerHTML = '<div class="empty-state">No members loaded.</div>';
        return;
    }

    // Group members by their highest hoisted role; otherwise into "Members".
    const groups = new Map();
    for (const m of members) {
        const top = _topHoistedRole(m);
        const key = top ? String(top.id) : '__none__';
        if (!groups.has(key)) {
            groups.set(key, {
                role: top,
                key,
                members: [],
            });
        }
        groups.get(key).members.push(m);
    }

    // Sort groups: hoisted roles by position desc, then "Members" fallback last.
    const groupList = Array.from(groups.values()).sort((a, b) => {
        if (a.role && !b.role) return -1;
        if (!a.role && b.role) return 1;
        if (!a.role && !b.role) return 0;
        return (b.role.position || 0) - (a.role.position || 0);
    });

    const fragment = document.createDocumentFragment();
    for (const group of groupList) {
        const header = document.createElement('div');
        header.className = 'member-group-header';
        const groupName = group.role ? group.role.name : 'Members';
        header.textContent = `${groupName.toUpperCase()} — ${group.members.length}`;
        fragment.appendChild(header);

        const sorted = group.members.slice().sort((a, b) => {
            const an = (a.nickname || a.display_name || a.username || '').toLowerCase();
            const bn = (b.nickname || b.display_name || b.username || '').toLowerCase();
            return an.localeCompare(bn);
        });
        for (const m of sorted) {
            fragment.appendChild(_createMemberRow(m));
        }
    }
    membersContent.appendChild(fragment);
}

function _createMemberRow(member) {
    const el = document.createElement('div');
    el.className = 'member-row';
    el.dataset.userId = member.user_id;

    const colourRole = _highestColoredRole(member);
    const nameColour = colourRole ? _intToHex(colourRole.color) : null;

    const display = escapeHtml(member.nickname || member.display_name || member.username || 'Unknown');
    const avatar = member.avatar_url
        ? `<img class="member-avatar" src="${escapeHtml(member.avatar_url)}" alt="" onerror="this.style.display='none'">`
        : `<span class="member-avatar member-avatar-placeholder"></span>`;

    el.innerHTML = `
        ${avatar}
        <span class="member-name"${nameColour ? ` style="color:${nameColour}"` : ''}>${display}</span>
        ${member.is_bot ? '<span class="member-bot-tag">BOT</span>' : ''}
    `;
    el.addEventListener('click', () => openMemberProfile(member));
    return el;
}

function _formatJoinedAt(iso) {
    if (!iso) return '—';
    try {
        return new Date(iso).toLocaleDateString(undefined, {
            year: 'numeric', month: 'long', day: 'numeric',
        });
    } catch (e) {
        return iso;
    }
}

function openMemberProfile(member) {
    const modal = document.getElementById('memberProfileModal');
    const avatarEl = document.getElementById('memberProfileAvatar');
    const displayEl = document.getElementById('memberProfileDisplay');
    const usernameEl = document.getElementById('memberProfileUsername');
    const joinedEl = document.getElementById('memberProfileJoined');
    const rolesEl = document.getElementById('memberProfileRoles');

    if (member.avatar_url) {
        avatarEl.src = member.avatar_url;
        avatarEl.style.display = '';
    } else {
        avatarEl.removeAttribute('src');
        avatarEl.style.display = 'none';
    }

    const colourRole = _highestColoredRole(member);
    const nameColour = colourRole ? _intToHex(colourRole.color) : null;
    displayEl.textContent = member.nickname || member.display_name || member.username || 'Unknown';
    if (nameColour) {
        displayEl.style.color = nameColour;
    } else {
        displayEl.style.color = '';
    }
    usernameEl.textContent = `@${member.username || 'unknown'}${member.is_bot ? ' • BOT' : ''}`;
    joinedEl.textContent = _formatJoinedAt(member.joined_at);

    rolesEl.innerHTML = '';
    const roles = (member.roles || []).slice().sort(
        (a, b) => (b.position || 0) - (a.position || 0)
    );
    if (roles.length === 0) {
        rolesEl.innerHTML = '<span class="muted-count">No roles</span>';
    } else {
        for (const r of roles) {
            const pill = document.createElement('span');
            pill.className = 'role-pill';
            const hex = _intToHex(r.color);
            if (hex) {
                pill.style.color = hex;
                pill.style.borderColor = hex;
                pill.style.backgroundColor = hex + '22';
            }
            pill.textContent = r.name;
            rolesEl.appendChild(pill);
        }
    }

    modal.style.display = 'flex';
}
