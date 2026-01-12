const API_BASE_URL = "https://discord-messages-api-rosie-stuffs.rosestuffs.org";
const STORAGE_KEY_API_KEY = "discord_api_key";
const APP_NAME = "discord-viewer";

let API_KEY = localStorage.getItem(STORAGE_KEY_API_KEY);
let authManager = null;

// Application State
// Application State
const state = {
    servers: [],
    currentServerId: null,
    channels: [],
    currentChannelId: null,
    messages: [],
    oldestMessageId: null,
    hasMoreMessages: true,
    searchQuery: "",
    isLoading: false,
    autoRefreshInterval: null
};

// ...

// --- Initialization ---

document.addEventListener("DOMContentLoaded", () => {
    // Initialize AuthManager
    initializeAuth();
    
    if (!API_KEY) {
        showApiKeyModal();
    } else {
        initApp();
    }

    // ... (rest of listeners)
    
    // Auto Refresh Button
    const refreshBtn = document.createElement('button');
    refreshBtn.id = 'manualRefreshBtn';
    refreshBtn.innerHTML = '↻';
    refreshBtn.title = 'Refresh Messages';
    refreshBtn.className = 'action-button';
    refreshBtn.style.cssText = "background:none; border:none; color:var(--interactive-normal); cursor:pointer; font-size:18px; margin-left:10px;";
    refreshBtn.onclick = () => loadMessages(state.currentChannelId, false); // Manual refresh
    
    const headerTools = document.querySelector('.header-tools');
    if (headerTools) {
       headerTools.insertBefore(refreshBtn, headerTools.firstChild);
    }
    
    // Start auto-refresh poller
    startAutoRefresh();
});

function startAutoRefresh() {
    if (state.autoRefreshInterval) clearInterval(state.autoRefreshInterval);
    state.autoRefreshInterval = setInterval(() => {
        if (state.currentChannelId && !state.isLoading && document.visibilityState === 'visible') {
            // Check for new messages invisibly? Or just reload newly?
            // For now, let's just fetch the *latest* messages and see if the ID is greater than our newest.
            // But full reload is safer for edits/deletes.
            // Actually, let's only do it if the user is at the bottom.
            if (messagesWrapperEl.scrollTop + messagesWrapperEl.clientHeight >= messageListEl.scrollHeight - 100) {
                 checkForNewMessages();
            }
        }
    }, 5000); // Check every 5 seconds
}

async function checkForNewMessages() {
   // Implementation to append only new messages
   // For now, we can just re-fetch the latest page and merge?
   // Or better, just fetch messages AFTER our newest known ID.
   if (!state.messages.length) return;
   
   const newestId = state.messages[state.messages.length - 1].id;
   try {
       const data = await apiCall(`/api/channels/${state.currentChannelId}/messages`, { after: newestId, limit: 50 });
       if (data.messages && data.messages.length > 0) {
           const newMsgs = data.messages.sort((a, b) => String(a.id).localeCompare(String(b.id)));
           state.messages = [...state.messages, ...newMsgs];
           renderMessageBatch(newMsgs, 'append');
           enrichMessages(newMsgs);
           scrollToBottom(); // Stick to bottom
       }
   } catch(e) {
       // Silent fail on auto-refresh
   }
}

// ...

async function initApp() {
    renderLoadingServer();
    try {
        await fetchServers();
        renderServers();
        
        // Restore State
        restoreNavigationState();
        
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

function restoreNavigationState() {
    const savedServerId = localStorage.getItem('last_server_id');
    const savedChannelId = localStorage.getItem('last_channel_id');
    
    // Validate they exist in our list
    if (savedServerId && state.servers.find(s => s.id == savedServerId)) {
        selectServer(savedServerId).then(() => {
            if (savedChannelId && state.channels.find(c => c.id == savedChannelId)) {
                selectChannel(savedChannelId);
            }
        });
    }
}

// ...

// Update selectServer/selectChannel to save state
async function selectServer(serverId) {
    state.currentServerId = serverId;
    localStorage.setItem('last_server_id', serverId);
    // ... existing logic ...
    state.currentChannelId = null;
    
    // UI Update
    document.querySelectorAll(".server-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id == serverId);
    });
    
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
}

function selectChannel(channelId) {
    state.currentChannelId = channelId;
    localStorage.setItem('last_channel_id', channelId);
    // ... existing logic ...
    
    state.oldestMessageId = null;
    state.hasMoreMessages = true;
    
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

// ...

function createMessageElement(msg) {
    const el = document.createElement("div");
    el.className = "message-item";
    el.dataset.messageId = msg.id;
    
    // Deleted message styling
    if (msg.is_deleted) {
        el.classList.add("message-deleted-dimmed"); // Use a new class for visual dimming
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
        `<button class="edit-history-btn" onclick="toggleEditHistory('${msg.id}')" title="View edit history">History</button>` : '';
    
    const deletedIndicator = msg.is_deleted ? 
        '<span class="message-deleted-badge" title="This message was deleted">[DELETED]</span>' : '';
    
    // Attachments
    const attachmentsHtml = renderAttachments(msg.attachments || []);
    const hasAttachments = (msg.attachments || []).length > 0;
    
    // Content - Show content even if deleted!
    const contentText = msg.content || '';
    const contentHtml = formatContent(contentText, hasAttachments);
    
    // Force show something if empty and deleted
    const finalContentHtml = (!contentText && msg.is_deleted) ? 
        '<em class="deleted-content-placeholder">[Content Unavailable]</em>' : contentHtml;
    
    el.innerHTML = `
        ${avatarHtml}
        <div class="message-content-wrapper">
            <div class="message-header">
                <span class="message-author">${escapeHtml(authorName)}</span>
                <span class="message-timestamp">${formattedDate}</span>
                ${deletedIndicator}
                ${editedIndicator}
            </div>
            <div class="message-body">${finalContentHtml}</div>
            <div class="message-embeds" id="embeds-${msg.id}"></div>
            ${attachmentsHtml}
            <div class="edit-history-container" id="edit-history-${msg.id}" style="display:none;"></div>
        </div>
    `;
    return el;
}

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
    
    // Auto-select last viewed channel for this server
    const lastChannelId = localStorage.getItem(`lastChannel_${serverId}`);
    if (lastChannelId && state.channels.some(c => c.id == lastChannelId)) {
        selectChannel(lastChannelId);
    }
}

// --- Channels ---

async function fetchChannels(serverId) {
    const data = await apiCall(`/api/servers/${serverId}/channels`);
    // Sort by position (from API) which already considers parent_id ordering
    state.channels = (data.channels || []).sort((a, b) => {
        // First sort by parent_id (null first)
        if (a.parent_id === null && b.parent_id !== null) return -1;
        if (a.parent_id !== null && b.parent_id === null) return 1;
        if (a.parent_id !== b.parent_id) return String(a.parent_id).localeCompare(String(b.parent_id));
        // Then by position
        return (a.position || 0) - (b.position || 0);
    });
}

function renderChannels() {
    channelListEl.innerHTML = "";
    
    if (state.channels.length === 0) {
        channelListEl.innerHTML = '<div style="padding:10px; color:#aaa;">No channels found</div>';
        return;
    }
    
    // Group channels by parent (category)
    const categories = new Map();
    const uncategorized = [];
    
    state.channels.forEach(channel => {
        if (channel.type === 'category') {
            if (!categories.has(channel.id)) {
                categories.set(channel.id, { name: channel.name, channels: [] });
            }
        } else if (channel.parent_id) {
            if (!categories.has(channel.parent_id)) {
                categories.set(channel.parent_id, { name: 'Unknown Category', channels: [] });
            }
            categories.get(channel.parent_id).channels.push(channel);
        } else {
            uncategorized.push(channel);
        }
    });
    
    // Render uncategorized channels first
    uncategorized.forEach(channel => {
        channelListEl.appendChild(createChannelElement(channel));
    });
    
    // Render categories with their channels
    categories.forEach((cat, catId) => {
        if (cat.channels.length > 0) {
            // Category header
            const catEl = document.createElement('div');
            catEl.className = 'channel-category';
            catEl.innerHTML = `<span class="category-arrow">▼</span> ${escapeHtml(cat.name)}`;
            catEl.onclick = () => toggleCategory(catId);
            channelListEl.appendChild(catEl);
            
            // Category channels container
            const containerEl = document.createElement('div');
            containerEl.id = `category-${catId}`;
            cat.channels.forEach(channel => {
                containerEl.appendChild(createChannelElement(channel));
            });
            channelListEl.appendChild(containerEl);
        }
    });
}

function createChannelElement(channel) {
    const el = document.createElement("div");
    el.className = "channel-item";
    el.dataset.id = channel.id;
    el.innerHTML = `<span class="channel-hash">#</span> ${escapeHtml(channel.name)}`;
    el.addEventListener("click", () => selectChannel(channel.id));
    return el;
}

function toggleCategory(catId) {
    const container = document.getElementById(`category-${catId}`);
    if (container) {
        container.style.display = container.style.display === 'none' ? 'block' : 'none';
    }
}

function selectChannel(channelId) {
    state.currentChannelId = channelId;
    state.oldestMessageId = null;
    state.hasMoreMessages = true;
    
    // Remember last channel for this server
    if (state.currentServerId) {
        localStorage.setItem(`lastChannel_${state.currentServerId}`, channelId);
    }
    
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
        state.hasMoreMessages = true;
        state.messages = [];
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
        
        // Track oldest message for pagination (it's the first one in our local list)
        if (state.messages.length > 0) {
            state.oldestMessageId = state.messages[0].id;
        }
        
        if (!append) scrollToBottom();
        
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
    
    const oldHeight = messageListEl.scrollHeight;
    const oldScrollTop = messagesWrapperEl.scrollTop;
    
    await loadMessages(state.currentChannelId, true);
    
    // Adjust scroll position to maintain visual continuity
    const newHeight = messageListEl.scrollHeight;
    const heightDiff = newHeight - oldHeight;
    messagesWrapperEl.scrollTop = oldScrollTop + heightDiff;
}

let scrollDebounce = null;
function handleInfiniteScroll() {
    if (messagesWrapperEl.scrollTop < 200 && !state.isLoading && state.hasMoreMessages) {
        if (scrollDebounce) return;
        scrollDebounce = setTimeout(() => {
            scrollDebounce = null;
        }, 100); // Reduced debounce for smoother feel
        loadMoreMessages();
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

function createMessageElement(msg) {
    const el = document.createElement("div");
    el.className = "message-item";
    el.dataset.messageId = msg.id;
    
    // Deleted message styling
    if (msg.is_deleted) {
        el.classList.add("message-deleted");
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
    
    const deletedIndicator = msg.is_deleted ? 
        '<span class="message-deleted-badge">[DELETED]</span>' : '';
    
    // Attachments
    const attachmentsHtml = renderAttachments(msg.attachments || []);
    const hasAttachments = (msg.attachments || []).length > 0;
    
    // Content - logic simplified
    const contentHtml = msg.is_deleted ? 
        '<em class="deleted-content">[Message was deleted]</em>' : 
        formatContent(msg.content, hasAttachments);
    
    el.innerHTML = `
        ${avatarHtml}
        <div class="message-content-wrapper">
            <div class="message-header">
                <span class="message-author">${escapeHtml(authorName)}</span>
                ${deletedIndicator}
                <span class="message-timestamp">${formattedDate}</span>
                ${editedIndicator}
            </div>
            <div class="message-body">${contentHtml}</div>
            <div class="message-embeds" id="embeds-${msg.id}"></div> <!-- Container for async embeds -->
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
                const historyHtml = history.map((edit, i) => {
                    const editDate = new Date(edit.edited_at).toLocaleString();
                    return `<div class="edit-entry">
                        <span class="edit-timestamp">${editDate}</span>
                        <div class="edit-old-content">${escapeHtml(edit.old_content)}</div>
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

function formatContent(content, hasAttachments = false) {
    if (!content) {
        // Don't show "No content" if there are attachments
        return hasAttachments ? '' : '<em>(No content)</em>';
    }
    let escaped = escapeHtml(content);
    
    // Newlines to <br>
    escaped = escaped.replace(/\n/g, '<br>');
    
    // Linkify URLs (simple regex, just makes them clickable)
    // We do NOT generate embeds here anymore, that's handled by enrichMessages
    escaped = escaped.replace(
        /(https?:\/\/[^\s<]+)/gi,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    return escaped;
}

async function enrichMessages(messages) {
    // Find messages with HTTP links
    const urlRegex = /(https?:\/\/[^\s<]+)/gi;
    
    for (const msg of messages) {
        if (!msg.content) continue;
        
        const matches = msg.content.match(urlRegex);
        if (!matches) continue;
        
        // Only embed the first link for now to avoid clutter (like Discord usually does priority)
        // Or loop through all unique URLs
        const uniqueUrls = [...new Set(matches)];
        
        for (const url of uniqueUrls) {
            // Check if we should embed this URL (YouTube, Tenor, etc)
            // Implementation detail: The backend decides if it supports OEmbed for this URL
            const lowerUrl = url.toLowerCase();
            if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be') || lowerUrl.includes('tenor.com')) {
                try {
                    const embedContainer = document.getElementById(`embeds-${msg.id}`);
                    if (!embedContainer) continue;

                    // Fetch metadata from our backend proxy
                    const res = await apiCall(`/api/metadata`, { url });
                    
                    if (res && !res.error) {
                        const embedHtml = renderEmbed(res);
                        embedContainer.innerHTML += embedHtml;
                    } else {
                        console.warn(`Metadata fetch failed for ${url}:`, res ? res.error : 'Unknown error');
                    }
                } catch (e) {
                    console.log(`Failed to enrich URL ${url}:`, e);
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

// --- Search ---

async function handleSearch(query) {
    if (query.length < 2) return;
    
    state.currentChannelId = null;
    document.querySelectorAll(".channel-item").forEach(el => el.classList.remove("active"));
    channelNameEl.textContent = `Search: "${query}"`;
    channelTopicEl.textContent = "Global Search Results";
    
    messageListEl.innerHTML = '<div class="empty-state">Searching...</div>';
    
    try {
        const data = await apiCall("/api/search", { q: query, limit: 100 });
        state.messages = data.results || [];
        
        calculateSearchStats(state.messages, query);
        renderMessages();
    } catch (e) {
        messageListEl.innerHTML = `<div class="empty-state error">Search failed: ${escapeHtml(e.message)}</div>`;
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
