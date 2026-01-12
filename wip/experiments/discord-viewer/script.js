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
    hasMoreMessages: true,
    searchQuery: "",
    isLoading: false
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
});

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

async function loadMessages(channelId, append = false) {
    if (!append) {
        messageListEl.innerHTML = '<div class="empty-state">Loading messages...</div>';
        state.oldestMessageId = null;
        state.hasMoreMessages = true;
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
        
        if (append) {
            // Prepend older messages
            state.messages = [...newMessages.reverse(), ...state.messages];
        } else {
            // Sort by ID to get chronological order (newest last)
            state.messages = newMessages.sort((a, b) => String(a.id).localeCompare(String(b.id)));
        }
        
        // Track oldest message for pagination
        if (state.messages.length > 0) {
            state.oldestMessageId = state.messages[0].id;
        }
        
        renderMessages();
        if (!append) scrollToBottom();
    } catch (e) {
        if (!append) {
            messageListEl.innerHTML = `<div class="empty-state error">Failed to load messages: ${escapeHtml(e.message)}</div>`;
        }
    } finally {
        state.isLoading = false;
    }
}

async function loadMoreMessages() {
    if (!state.currentChannelId || state.isLoading || !state.hasMoreMessages) return;
    
    const scrollPos = messagesWrapperEl.scrollTop;
    await loadMessages(state.currentChannelId, true);
    // Restore scroll position after prepending
    messagesWrapperEl.scrollTop = scrollPos + 200;
}

function handleInfiniteScroll() {
    if (messagesWrapperEl.scrollTop < 200 && !state.isLoading && state.hasMoreMessages) {
        loadMoreMessages();
    }
}

function renderMessages() {
    messageListEl.innerHTML = "";
    
    if (state.messages.length === 0) {
        messageListEl.innerHTML = '<div class="empty-state">No messages found here.</div>';
        return;
    }
    
    state.messages.forEach(msg => {
        const el = createMessageElement(msg);
        messageListEl.appendChild(el);
    });
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
    
    // Avatar - use URL if available, otherwise generate color
    const avatarUrl = msg.avatar_url;
    let avatarHtml;
    if (avatarUrl) {
        avatarHtml = `<div class="message-avatar"><img src="${avatarUrl}" alt="avatar" onerror="this.style.display='none'"></div>`;
    } else {
        const idNum = parseInt(String(msg.user_id || msg.author_id || '0').slice(-8)) || 0;
        const avatarColor = "#" + ((idNum * 1234567) % 0xFFFFFF).toString(16).padStart(6, '0');
        avatarHtml = `<div class="message-avatar" style="background-color: ${avatarColor}"></div>`;
    }
    
    // Get author name
    const authorName = msg.display_name || msg.username || msg.author_name || 'Unknown';
    
    // Edited indicator
    const editedIndicator = msg.is_edited ? 
        `<span class="message-edited" onclick="toggleEditHistory('${msg.id}')" title="Click to view edit history">(edited)</span>` : '';
    
    // Deleted indicator
    const deletedIndicator = msg.is_deleted ? 
        '<span class="message-deleted-badge">[DELETED]</span>' : '';
    
    // Attachments
    const attachmentsHtml = renderAttachments(msg.attachments || []);
    
    // Content with embeds
    const contentHtml = msg.is_deleted ? 
        '<em class="deleted-content">[Message was deleted]</em>' : 
        formatContent(msg.content);
    
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
        const url = att.url;
        const filename = att.filename || 'attachment';
        
        if (contentType.startsWith('image/')) {
            return `<div class="attachment-image"><img src="${url}" alt="${escapeHtml(filename)}" loading="lazy" onclick="window.open('${url}', '_blank')"></div>`;
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

function formatContent(content) {
    if (!content) return "<em>(No content)</em>";
    let escaped = escapeHtml(content);
    
    // Newlines to <br>
    escaped = escaped.replace(/\n/g, '<br>');
    
    // YouTube embeds
    escaped = escaped.replace(
        /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/clip\/)([a-zA-Z0-9_-]+)(?:[^\s<]*)?/gi,
        (match, videoId) => {
            return `<div class="embed-youtube"><iframe src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe></div><a href="${match}" target="_blank">${match}</a>`;
        }
    );
    
    // Tenor GIF embeds (show as direct link for now - full embedding would need API)
    escaped = escaped.replace(
        /(https?:\/\/tenor\.com\/[^\s<]+)/gi,
        '<a href="$1" target="_blank" class="tenor-link">🎬 $1</a>'
    );
    
    // Other URLs to links
    escaped = escaped.replace(
        /(https?:\/\/(?!(?:www\.)?(?:youtube\.com|youtu\.be|tenor\.com))[^\s<]+)/gi,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
    
    return escaped;
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
