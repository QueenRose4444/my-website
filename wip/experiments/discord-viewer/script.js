const API_BASE_URL = "https://discord-messages-api-rosie-stuffs.rosestuffs.org";
let API_KEY = localStorage.getItem("discord_api_key");

// Application State
const state = {
    servers: [],
    currentServerId: null,
    channels: [],
    currentChannelId: null,
    messages: [],
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

// --- Initialization ---

document.addEventListener("DOMContentLoaded", () => {
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
});

function showApiKeyModal() {
    apiKeyModal.style.display = "flex";
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
    localStorage.setItem("discord_api_key", API_KEY);
    apiKeyModal.style.display = "none";
    apiKeyError.textContent = "";
    initApp();
}

async function initApp() {
    renderLoadingServer();
    try {
        await fetchServers();
        renderServers();
        // If we have servers, select the first one? Or wait for user.
        // Let's wait for user to select.
    } catch (error) {
        console.error("Failed to init app:", error);
        if (error.status === 401) {
            apiKeyError.textContent = "Authentication failed. Invalid Key.";
            showApiKeyModal();
        } else {
            alert("Failed to load servers. Check console/network.");
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
    
    // Add "Home" or "Direct Messages" placeholder if we had them, 
    // but for now just the server list.
    
    state.servers.forEach(server => {
        const el = document.createElement("div");
        el.className = "server-item";
        el.title = server.name;
        el.dataset.id = server.id;
        
        // If icon exists, use it (Discord icons are usually at specific CDN URLs)
        // Since we don't have the CDN logic here, we'll try to make an acronym
        const acronym = server.name.match(/\b(\w)/g).join('').slice(0, 3).toUpperCase();
        el.textContent = acronym;
        
        // If the API provided an icon URL (it doesn't currently seem to return full CDN url, just ID maybe?)
        // The current API schema for Server is likely just {id, name}. 
        // We'll stick to acronyms for now.
        
        el.addEventListener("click", () => selectServer(server.id));
        serverListEl.appendChild(el);
    });
}

async function selectServer(serverId) {
    state.currentServerId = serverId;
    state.currentChannelId = null; // Reset channel
    
    // UI Update
    document.querySelectorAll(".server-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id == serverId);
    });
    
    const server = state.servers.find(s => s.id == serverId);
    if (server) serverNameEl.textContent = server.name;
    
    // Fetch Channels
    channelListEl.innerHTML = '<div style="padding:10px; color:#aaa;">Loading...</div>';
    await fetchChannels(serverId);
    renderChannels();
}

// --- Channels ---

async function fetchChannels(serverId) {
    const data = await apiCall(`/api/servers/${serverId}/channels`);
    // Sort channels? Usually by position. API might not return position. 
    // Fallback sort by name or ID.
    state.channels = (data.channels || []).sort((a, b) => a.name.localeCompare(b.name));
}

function renderChannels() {
    channelListEl.innerHTML = "";
    
    state.channels.forEach(channel => {
        const el = document.createElement("div");
        el.className = "channel-item";
        el.dataset.id = channel.id;
        el.innerHTML = `<span class="channel-hash">#</span> ${channel.name}`;
        
        el.addEventListener("click", () => selectChannel(channel.id));
        channelListEl.appendChild(el);
    });
}

function selectChannel(channelId) {
    state.currentChannelId = channelId;
    
    // UI Update
    document.querySelectorAll(".channel-item").forEach(el => {
        el.classList.toggle("active", el.dataset.id == channelId);
    });
    
    const channel = state.channels.find(c => c.id == channelId);
    if (channel) {
        channelNameEl.textContent = channel.name;
        // Topic isn't in the basic list response usually, but we can clear it or set if we had it
        channelTopicEl.textContent = ""; 
    }
    
    // Fetch Messages
    loadMessages(channelId);
}

// --- Messages ---

async function loadMessages(channelId) {
    messageListEl.innerHTML = '<div class="empty-state">Loading messages...</div>';
    state.isLoading = true;
    
    try {
        const data = await apiCall(`/api/channels/${channelId}/messages`, { limit: 50 });
        state.messages = (data.messages || []).reverse(); // API returns newest first usually, we want oldest at top for chat?
        // Actually, if we use column-reverse, we want newest first (state.messages[0] is newest).
        // Let's standard render: Top = Oldest. 
        // API get_messages usually returns standard Query order (Oldest -> Newest) or Newest -> Oldest? 
        // DB usually returns insert order. Let's assume we need to sort by ID/Timestamp.
        state.messages.sort((a, b) => a.id - b.id);
        
        renderMessages();
        scrollToBottom();
    } catch (e) {
        messageListEl.innerHTML = `<div class="empty-state error">Failed to load messages: ${e.message}</div>`;
    } finally {
        state.isLoading = false;
    }
}

function renderMessages() {
    messageListEl.innerHTML = "";
    
    if (state.messages.length === 0) {
        messageListEl.innerHTML = '<div class="empty-state">No messages found here.</div>';
        return;
    }
    
    let lastAuthorId = null;
    let currentGroup = null;
    
    state.messages.forEach(msg => {
        // Grouping logic could go here (compact mode), but let's stick to simple first
        const el = createMessageElement(msg);
        messageListEl.appendChild(el);
    });
}

function createMessageElement(msg) {
    const el = document.createElement("div");
    el.className = "message-item";
    
    const date = new Date(msg.timestamp || Date.now()); // Fallback
    const formattedDate = date.toLocaleString();
    
    // Avatar (random color based on ID?)
    const avatarColor = "#" + ((msg.author_id * 1234567) % 0xFFFFFF).toString(16).padStart(6, '0');
    
    el.innerHTML = `
        <div class="message-avatar" style="background-color: ${avatarColor}">
            <!-- Img placeholder -->
        </div>
        <div class="message-content-wrapper">
            <div class="message-header">
                <span class="message-author">${escapeHtml(msg.author_name || 'Unknown')}</span>
                <span class="message-timestamp">${formattedDate}</span>
            </div>
            <div class="message-body">${formatContent(msg.content)}</div>
        </div>
    `;
    return el;
}

function formatContent(content) {
    if (!content) return "<em>(No content)</em>";
    // Basic formatting: URLs to links, newlines to <br>
    let escaped = escapeHtml(content);
    
    // Grid/Newline replacement
    escaped = escaped.replace(/\n/g, '<br>');
    
    // Link replacement (Simple regex)
    escaped = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    
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
    
    // If we are in a channel, maybe restrict? 
    // API search is global (all accessible servers).
    // Let's reset view to show "Search Results"
    
    state.currentChannelId = null;
    document.querySelectorAll(".channel-item").forEach(el => el.classList.remove("active"));
    channelNameEl.textContent = `Search: "${query}"`;
    channelTopicEl.textContent = "Global Search Results";
    
    messageListEl.innerHTML = '<div class="empty-state">Searching...</div>';
    
    try {
        const data = await apiCall("/api/search", { q: query, limit: 100 });
        state.messages = data.results || [];
        
        // Calculate Word Frequency stats for this result set
        calculateSearchStats(state.messages, query);
        
        renderMessages();
    } catch (e) {
        messageListEl.innerHTML = `<div class="empty-state error">Search failed: ${e.message}</div>`;
    }
}

// --- Stats & Features ---

function calculateSearchStats(messages, query) {
    if (!messages.length) {
        updateStatsView({});
        return;
    }

    const wordCounts = {};
    const lowerQuery = query.toLowerCase();
    
    messages.forEach(msg => {
        if (!msg.content) return;
        
        // A simple approach: Count how many times the query itself appears? 
        // User asked: "how often a word/phase/ect was said by all users... like 'hi' was said 452 times"
        // So we count occurrences of the `query` term in these messages? 
        // Or if the query is a specific word, we count authors?
        
        // Let's list top authors in this search result
        const author = msg.author_name || "Unknown";
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
    
    // Auto show panel if hidden? Maybe not, could be annoying.
    // statsPanel.style.display = "flex";
}

function toggleStatsPanel() {
    const isHidden = statsPanel.style.display === "none";
    statsPanel.style.display = isHidden ? "flex" : "none";
}
