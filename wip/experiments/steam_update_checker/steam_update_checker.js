// ==========================================
// (✿^‿^) CONFIGURATION
// ==========================================
const CONFIG = {
    API_BASE_URL: "https://rosie_steam_game_tracker_backend.rosestuffs.org", 
    DISCORD_CLIENT_ID: "1436121447884918925", 
    REDIRECT_URI: window.location.origin + window.location.pathname,
    APP_NAME: 'steam-tracker-auth-v1' 
};

// ==========================================
// (o^▽^o) GLOBAL STATE
// ==========================================
let currentView = 'tracked';
let currentTop100Type = 'ccu'; 
let discordCreds = null; 
let authManager = null;
let activeGameId = null;
let activeGameName = ''; // Name of the game in the currently open modal (for site search)
let activeModalTab = 'info';
let gamesCache = []; 
let trackedGamesMap = {}; 
let domainRulesCache = null;
let lastSearchQuery = ''; // Track last search query

// User Preferences (Default Values)
let userPreferences = {
    defaultPage: 'tracked',
    sidebarPC: 'open',
    sidebarMobile: 'closed',
    mobilePadding: 50,
    // NEW: Store sorts per view type
    sorts: {
        tracked: 'updated',    // Default for tracked: Alphabetical
        all: 'popular'      // Default for catalog: Popularity
    },
    // NEW: Reusable "find this game on my site" search template.
    // url contains the {GameName} placeholder; spaceMode controls how spaces are encoded.
    searchTemplate: {
        url: '',
        name: '',          // optional friendly label for the button (falls back to hostname)
        spaceMode: 'plus'  // 'plus' (+) | 'percent' (%20) | 'raw' (literal space)
    },
    // NEW: query-param names to strip from custom links when saved (e.g. phpBB's "hilit").
    stripParams: []
};

// Pagination State
let currentPage = 0;
let isFetching = false;

// ==========================================
// 🔒 SECURITY UTILITIES
// ==========================================
/**
 * Escapes HTML entities to prevent XSS attacks.
 * Converts <, >, &, ", and ' to their HTML entity equivalents.
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==========================================
// (★ω★) INITIALIZATION
// ==========================================
document.addEventListener("DOMContentLoaded", async () => {
    
    // 1. Load Local Preferences immediately
    loadLocalPreferences();

    // 2. Detect device type and apply padding
    handleResize();
    window.addEventListener('resize', handleResize);

    // 3. Setup AuthManager
    if (typeof AuthManager !== 'undefined') {
        try {
            authManager = new AuthManager(CONFIG.APP_NAME, 'wip');
            
            window.addEventListener('auth:login', (e) => {
                updateWebAuthUI();
                closeModal('webLoginModal');
                performSync('download'); 
            });

            window.addEventListener('auth:logout', (e) => {
                updateWebAuthUI();
            });

            window.addEventListener('auth:session-restored', (e) => {
                updateWebAuthUI();
                performSync('download');
            });

            window.addEventListener('auth:no-session', () => {
                updateWebAuthUI();
                applySidebarState(); 
            });

            authManager.initialize();

        } catch (e) { console.warn("AuthManager failed to setup:", e); }
    }

    // 4. Check for Discord OAuth Callback
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
        await handleDiscordCallback(code);
    } else {
        loadLocalCreds();
    }

    // 5. UI Setup
    updateDiscordUI();
    applySidebarState();
    
    // Initial Sort Setup happens in switchView/load

    // If we have creds, load data.
    if (discordCreds) {
        // Initialize sort dropdown from saved preferences BEFORE loading games
        const sortSelect = document.getElementById('sortSelect');
        if (sortSelect && userPreferences.sorts && userPreferences.sorts['tracked']) {
            sortSelect.value = userPreferences.sorts['tracked'];
        }
        loadTrackedGames();
    } else {
        setTimeout(() => {
             if(userPreferences.defaultPage && userPreferences.defaultPage !== 'tracked') {
                 switchView(userPreferences.defaultPage);
             } else {
                 if(!discordCreds) switchView('all');
             }
        }, 500);
    }

    setupEventListeners();
    setupModalClickOutside();
});

// ==========================================
// PREFERENCES & LOCAL STORAGE
// ==========================================

function loadLocalPreferences() {
    const storedPrefs = localStorage.getItem('steam_tracker_user_prefs');
    if (storedPrefs) {
        try {
            const parsed = JSON.parse(storedPrefs);
            // Merge deeply to preserve nested 'sorts' object if missing in stored
            userPreferences = {
                ...userPreferences,
                ...parsed,
                sorts: { ...userPreferences.sorts, ...(parsed.sorts || {}) },
                searchTemplate: { ...userPreferences.searchTemplate, ...(parsed.searchTemplate || {}) }
            };
        } catch (e) { console.error("Error loading prefs", e); }
    }
}

function savePreferencesLocalOrSync() {
    localStorage.setItem('steam_tracker_user_prefs', JSON.stringify(userPreferences));
    if(authManager && authManager.isLoggedIn()) {
        performSync('upload');
    }
}

// ==========================================
// MOBILE & RESIZE LOGIC
// ==========================================
function isMobile() {
    return window.innerWidth <= 768;
}

function handleResize() {
    const sidebar = document.getElementById('sidebar');
    if(sidebar) {
        if(isMobile()) {
            const padding = userPreferences.mobilePadding || 0;
            sidebar.style.setProperty('--mobile-padding', `${padding}px`);
        } else {
            sidebar.style.removeProperty('--mobile-padding');
        }
    }
}

function applySidebarState() {
    const sidebar = document.getElementById('sidebar');
    const localState = localStorage.getItem('steam_tracker_sidebar_state');
    const mobile = isMobile();

    let shouldBeCollapsed = false;

    if (localState !== null) {
        shouldBeCollapsed = localState === 'collapsed';
    } else {
        const prefState = mobile ? userPreferences.sidebarMobile : userPreferences.sidebarPC;
        shouldBeCollapsed = prefState === 'closed';
    }

    if (shouldBeCollapsed) {
        sidebar.classList.add('collapsed');
    } else {
        sidebar.classList.remove('collapsed');
    }
}

// ==========================================
// (ﾉ´ヮ`)ﾉ*: ･ﾟ AUTHENTICATION & SYNC
// ==========================================
function loginDiscord() {
    const authUrl = `https://discord.com/api/oauth2/authorize?client_id=${CONFIG.DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(CONFIG.REDIRECT_URI)}&response_type=code&scope=identify`;
    window.location.href = authUrl;
}

async function handleDiscordCallback(code) {
    window.history.replaceState({}, document.title, window.location.pathname);
    try {
        showToast("Verifying Discord Login...", "info");
        const response = await fetch(`${CONFIG.API_BASE_URL}/auth/discord`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code, redirect_uri: CONFIG.REDIRECT_URI })
        });
        
        if (!response.ok) throw new Error("Login verification failed.");
        
        const data = await response.json();
        discordCreds = data;
        localStorage.setItem('steam_tracker_creds', JSON.stringify(discordCreds));
        
        showToast(`Connected as ${discordCreds.username}`, "success");
        await performSync('upload'); 
        
        updateDiscordUI();
        loadTrackedGames();
    } catch (e) {
        console.error(e);
        showToast(e.message, "error");
    }
}

function logoutDiscord() {
    if(confirm("Unlink this device from Steam Tracker?")) {
        localStorage.removeItem('steam_tracker_creds');
        discordCreds = null;
        location.reload();
    }
}

function loadLocalCreds() {
    const stored = localStorage.getItem('steam_tracker_creds');
    if (stored) discordCreds = JSON.parse(stored);
}

async function regenerateToken() {
    if (!discordCreds) {
        showToast("Please login first", "error");
        return;
    }
    
    if (!confirm("Are you sure you want to regenerate your security token?\n\nThis will:\n• Invalidate your current token immediately\n• Log you out on all other devices/browsers\n• Require re-login on this device\n\nOnly do this if you suspect your token has been compromised.")) {
        return;
    }
    
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/auth/regenerate-token/${discordCreds.user_id}`, {
            method: 'POST',
            headers: { 'x-tracker-token': discordCreds.tracker_token }
        });
        
        if (!res.ok) {
            throw new Error("Failed to regenerate token");
        }
        
        const data = await res.json();
        
        // Update stored credentials with new token
        discordCreds.tracker_token = data.tracker_token;
        localStorage.setItem('steam_tracker_creds', JSON.stringify(discordCreds));
        
        showToast("Token regenerated successfully! Your old token is now invalid.", "success");
        
    } catch (e) {
        console.error("Token regeneration error:", e);
        showToast("Failed to regenerate token. Try again later.", "error");
    }
}

async function performSync(action = 'download') {
    if (!authManager || !authManager.isLoggedIn()) return;
    const endpoint = authManager.endpoints.data;

    try {
        if (action === 'upload') {
            const payload = {
                steam_creds: discordCreds,
                ui_preferences: userPreferences,
                last_updated: Date.now()
            };
            
            await authManager.fetchWithAuth(endpoint, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            console.log("Synced data (upload):", payload);

        } else if (action === 'download') {
            const res = await authManager.fetchWithAuth(endpoint);
            if (res.ok) {
                const cloudData = await res.json();
                
                if (cloudData && cloudData.steam_creds) {
                    const localStr = JSON.stringify(discordCreds);
                    const cloudStr = JSON.stringify(cloudData.steam_creds);
                    if (!discordCreds || localStr !== cloudStr) {
                        discordCreds = cloudData.steam_creds;
                        localStorage.setItem('steam_tracker_creds', JSON.stringify(discordCreds));
                        updateDiscordUI();
                        loadTrackedGames();
                        showToast("Restored tracker account", "info");
                    }
                }

                if (cloudData && cloudData.ui_preferences) {
                    // Deep merge sorts to ensure we don't lose keys
                    const remoteSorts = cloudData.ui_preferences.sorts || {};
                    userPreferences = {
                        ...userPreferences,
                        ...cloudData.ui_preferences,
                        sorts: { ...userPreferences.sorts, ...remoteSorts },
                        searchTemplate: { ...userPreferences.searchTemplate, ...(cloudData.ui_preferences.searchTemplate || {}) }
                    };
                    
                    localStorage.setItem('steam_tracker_user_prefs', JSON.stringify(userPreferences));

                    updateSettingsModalUI();
                    handleResize(); 
                    applySidebarState(); 
                    
                    // Re-apply sort for current view immediately after sync
                    const sortSelect = document.getElementById('sortSelect');
                    if (sortSelect && userPreferences.sorts && userPreferences.sorts[currentView]) {
                        sortSelect.value = userPreferences.sorts[currentView];
                        if (currentView === 'tracked' || currentView === 'all') {
                            applySortAndRender();
                        }
                    }

                    if(currentView === 'tracked' && userPreferences.defaultPage !== 'tracked') {
                        switchView(userPreferences.defaultPage);
                    }
                }
            }
        }
    } catch (e) { console.error("[Sync] Error:", e); }
}

function showLoginPrompt() { document.getElementById('authOverlay').style.display = 'flex'; }
function closeLoginPrompt() { document.getElementById('authOverlay').style.display = 'none'; }


// ==========================================
// INTERFACE SETTINGS HANDLERS
// ==========================================

function switchSettingsTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tab-btn[onclick="switchSettingsTab('${tab}')"]`).classList.add('active');

    document.getElementById('settingsTabInterface').style.display = tab === 'interface' ? 'block' : 'none';
    document.getElementById('settingsTabRules').style.display = tab === 'rules' ? 'block' : 'none';
    document.getElementById('settingsTabNotifications').style.display = tab === 'notifications' ? 'block' : 'none';
    document.getElementById('settingsTabSecurity').style.display = tab === 'security' ? 'block' : 'none';

    // Load data if switching to specific tabs
    if (tab === 'notifications' && discordCreds) {
        loadNotificationSettings();
    }
    
    // Handle security tab login state
    if (tab === 'security') {
        document.getElementById('securityActions').style.display = discordCreds ? 'block' : 'none';
        document.getElementById('securityNotLoggedIn').style.display = discordCreds ? 'none' : 'block';
    }
}

function updateSettingsModalUI() {
    if(document.getElementById('prefDefaultPage')) document.getElementById('prefDefaultPage').value = userPreferences.defaultPage;
    if(document.getElementById('prefSidebarPC')) document.getElementById('prefSidebarPC').value = userPreferences.sidebarPC;
    if(document.getElementById('prefSidebarMobile')) document.getElementById('prefSidebarMobile').value = userPreferences.sidebarMobile;
    if(document.getElementById('prefMobilePadding')) document.getElementById('prefMobilePadding').value = userPreferences.mobilePadding;
    updateSearchTemplateSettingsUI();
    updateStripParamsSettingsUI();
}

function saveInterfacePreferences() {
    userPreferences.defaultPage = document.getElementById('prefDefaultPage').value;
    userPreferences.sidebarPC = document.getElementById('prefSidebarPC').value;
    userPreferences.sidebarMobile = document.getElementById('prefSidebarMobile').value;
    userPreferences.mobilePadding = parseInt(document.getElementById('prefMobilePadding').value) || 0;

    handleResize();
    savePreferencesLocalOrSync();
    
    if(!authManager || !authManager.isLoggedIn()) {
        showToast("Settings saved locally (Login to sync)", "info");
    }
}


// ==========================================
// (nice to meet you) DATA FETCHING
// ==========================================

async function loadTrackedGames() {
    const grid = document.getElementById('gameGrid');
    document.getElementById('loadMoreContainer').style.display = 'none'; 
    
    if (!discordCreds) {
        if (currentView === 'tracked') {
            grid.innerHTML = `<div class="empty-state"><i class="fab fa-discord"></i><p>Login to see tracked games.</p></div>`;
        }
        return;
    }

    if (currentView === 'tracked') {
        grid.innerHTML = '<div style="padding:20px; text-align:center; grid-column: 1/-1;">Loading...</div>';
    }
    
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/games/user/${discordCreds.user_id}`, {
            headers: { 'x-tracker-token': discordCreds.tracker_token }
        });
        const games = await res.json();
        
        trackedGamesMap = {};
        games.forEach(g => { trackedGamesMap[g.app_id] = g; });

        if (currentView === 'tracked') {
            gamesCache = games.map(g => ({
                ...g, is_catalog: false,
                image: g.image || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.app_id}/header.jpg`
            }));
            applySortAndRender();
        }
    } catch (e) {
        if (currentView === 'tracked') grid.innerHTML = '<div class="empty-state">Failed to load games. API Offline?</div>';
    }
}

async function loadTop100(type) {
    if (type) currentTop100Type = type;
    
    document.getElementById('btn-rank-ccu').className = currentTop100Type === 'ccu' ? 'btn btn-primary' : 'btn btn-dark';
    document.getElementById('btn-rank-daily').className = currentTop100Type === 'daily' ? 'btn btn-primary' : 'btn btn-dark';

    const grid = document.getElementById('gameGrid');
    document.getElementById('loadMoreContainer').style.display = 'none'; 
    grid.innerHTML = '<div style="padding:20px; text-align:center; grid-column: 1/-1;">Fetching Top 100...</div>';

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/games/top100?type=${currentTop100Type}`);
        const games = await res.json();

        gamesCache = games.map(g => ({
            app_id: g.app_id,
            name: g.name,
            image: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.app_id}/header.jpg`,
            is_catalog: true,
            ccu: g.ccu,
            rank: g.rank,
            last_modified: g.last_modified // approx "last update" fallback for untracked games
        }));

        renderGames(gamesCache, false);
        
    } catch (e) {
        grid.innerHTML = '<div class="empty-state">Failed to load Top 100.</div>';
    }
}

async function loadAllGames(query = "", append = false) {
    if (isFetching) return;
    isFetching = true;

    const grid = document.getElementById('gameGrid');
    const loadMoreBtn = document.getElementById('loadMoreContainer');
    
    // Sort is pulled from dropdown, which is set in switchView
    const sortMode = document.getElementById('sortSelect').value;

    if (!append) {
        grid.innerHTML = '<div style="padding:20px; text-align:center; grid-column: 1/-1;">Fetching Catalog...</div>';
        loadMoreBtn.style.display = 'none';
        currentPage = 0; 
    } else {
        currentPage++; 
    }
    
    try {
        // We use encodeURIComponent to safely send search terms like "Golf & Friends"
        const res = await fetch(`${CONFIG.API_BASE_URL}/games/all?query=${encodeURIComponent(query)}&sort=${sortMode}&page=${currentPage}`);
        const data = await res.json();
        
        const newGames = data.results.map(g => ({
            app_id: g.app_id,
            name: g.name,
            image: g.header_image_url || `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.app_id}/header.jpg`,
            is_catalog: true,
            ccu: g.ccu,
            last_modified: g.last_modified // approx "last update" fallback for untracked games
        }));
        
        if (!append) {
            gamesCache = newGames;
            renderGames(gamesCache, false);
        } else {
            gamesCache = [...gamesCache, ...newGames];
            renderGames(newGames, false);
        }

        if (newGames.length >= 50) loadMoreBtn.style.display = 'block';
        else loadMoreBtn.style.display = 'none';
        
    } catch (e) {
        if (!append) grid.innerHTML = '<div class="empty-state">Search failed.</div>';
    } finally {
        isFetching = false;
    }
}

function loadMoreGames() {
    const query = document.getElementById('searchInput').value;
    loadAllGames(query, true);
}

function handleSort() { 
    // 1. Get the new value
    const val = document.getElementById('sortSelect').value;
    
    // 2. Save specifically for this view
    if (!userPreferences.sorts) userPreferences.sorts = {};
    userPreferences.sorts[currentView] = val;
    
    // 3. Persist
    savePreferencesLocalOrSync(); 

    // 4. Refresh Data
    if (currentView === 'tracked') {
        applySortAndRender(); 
    } else if (currentView === 'all') {
        // Re-fetch catalog with new sort
        const query = document.getElementById('searchInput').value;
        loadAllGames(query, false); 
    }
}

function applySortAndRender() {
    const sortMethod = document.getElementById('sortSelect').value;
    let sorted = [...gamesCache];
    
    // NOTE: This client-side sort is only for 'tracked' view now.
    // 'all' view sorts on server-side via API.
    sorted.sort((a, b) => {
        if (sortMethod === 'name') return a.name.localeCompare(b.name);
        else if (sortMethod === 'added') {
            if (!a.added_at) return 1; if (!b.added_at) return -1;
            return new Date(b.added_at) - new Date(a.added_at);
        } else if (sortMethod === 'updated') {
            const timeA = a.last_update_time || 0; const timeB = b.last_update_time || 0;
            return timeB - timeA;
        } else if (sortMethod === 'popular') {
            const ccuA = a.ccu || 0; const ccuB = b.ccu || 0;
            return ccuB - ccuA;
        }
        return 0;
    });
    renderGames(sorted, currentView === 'tracked');
}

function renderGames(games, isTrackedView) {
    const grid = document.getElementById('gameGrid');
    
    // Don't wipe grid if appending (handled in loadAllGames but good safety)
    if (!grid.innerHTML.includes('game-card') && games.length === 0) {
        // Check if we're in tracked view with a search query
        if (isTrackedView && lastSearchQuery) {
            const safeQuery = escapeHtml(lastSearchQuery);
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No tracked games match "${safeQuery}"</p>
                    <button class="btn btn-primary" onclick="searchInAllGames('${safeQuery.replace(/'/g, "\\'")}')"> 
                        <i class="fas fa-globe"></i> Search in All Games
                    </button>
                </div>`;
        } else {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-ghost"></i>No games found.</div>';
        }
        return;
    } else if (games.length === 0 && !grid.innerHTML) {
         if (isTrackedView && lastSearchQuery) {
            const safeQuery = escapeHtml(lastSearchQuery);
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No tracked games match "${safeQuery}"</p>
                    <button class="btn btn-primary" onclick="searchInAllGames('${safeQuery.replace(/'/g, "\\'")}')"> 
                        <i class="fas fa-globe"></i> Search in All Games
                    </button>
                </div>`;
         } else {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-ghost"></i>No games found.</div>';
         }
         return;
    }
    
    // Clear grid if NOT appending logic (handled by caller passing fresh array)
    // If caller passed full array, we wipe.
    // For 'all' view we rely on loadAllGames managing the cache/append.
    if(isTrackedView || currentPage === 0) {
        grid.innerHTML = '';
    }

    if (games.length === 0) {
        if (isTrackedView && lastSearchQuery) {
            const safeQuery = escapeHtml(lastSearchQuery);
            grid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-search"></i>
                    <p>No tracked games match "${safeQuery}"</p>
                    <button class="btn btn-primary" onclick="searchInAllGames('${safeQuery.replace(/'/g, "\\'")}')"> 
                        <i class="fas fa-globe"></i> Search in All Games
                    </button>
                </div>`;
        } else {
            grid.innerHTML = '<div class="empty-state"><i class="fas fa-ghost"></i>No games found.</div>';
        }
        return;
    }

    games.forEach(game => {
        const card = document.createElement('div');
        card.className = 'game-card';
        
        const isTracked = trackedGamesMap[game.app_id];
        
        let actionBtn = '';
        if (isTrackedView || isTracked) {
            actionBtn = `<button id="btn-${game.app_id}" class="action-btn btn-danger" style="opacity:1;" onclick="untrackGame(event, '${game.app_id}')"><i class="fas fa-trash"></i></button>`;
        } else {
            actionBtn = `<button id="btn-${game.app_id}" class="action-btn btn-success" style="background:#28a745;" onclick="trackGame(event, '${game.app_id}')"><i class="fas fa-plus"></i></button>`;
        }
        
        let metaInfo = '';
        
        if (currentView === 'top100') {
            const rankDisplay = `<span style="color:#4bc0c0; font-weight:bold; font-size:1.1em;">#${game.rank}</span>`;
            const ccuDisplay = game.ccu ? `<span><i class="fas fa-user" style="margin-right:5px; color:#aaa;"></i>${game.ccu.toLocaleString()}</span>` : '';
            metaInfo = `<div style="display:flex; justify-content:space-between; width:100%; align-items:center;">${rankDisplay} ${ccuDisplay}</div>`;
        } else if (currentView === 'all') {
             const ccuDisplay = game.ccu ? `<i class="fas fa-user"></i> ${game.ccu.toLocaleString()}` : `ID: ${game.app_id}`;
             metaInfo = `<span>${ccuDisplay}</span>`;
        } else {
             let buildInfo = game.build_id ? `Build: ${game.build_id}` : `ID: ${game.app_id}`;
             if (game.build_id) buildInfo += ` <span class="update-badge">Active</span>`;
             const ccuInfo = game.ccu ? `<span style="margin-left:10px; color:#aaa;"><i class="fas fa-user" style="font-size:0.8em;"></i> ${game.ccu.toLocaleString()}</span>` : '';
             metaInfo = `<div style="display:flex; justify-content:space-between; width:100%;"><span>${buildInfo}</span>${ccuInfo}</div>`;
        }

        card.innerHTML = `
            <div style="position:relative;" onclick="openGameModal('${game.app_id}')">
                <img src="${game.image}" class="game-image" data-appid="${game.app_id}" onerror="handleImgError(this)">
                ${actionBtn}
            </div>
            <div class="game-info" onclick="openGameModal('${game.app_id}')">
                <div class="game-title">${game.name}</div>
                <div class="game-meta">${metaInfo}</div>
            </div>
        `;
        grid.appendChild(card);
    });
}

function updateDiscordUI() {
    if (discordCreds) {
        document.getElementById('discordConnectBtn').style.display = 'none';
        document.getElementById('discordUserInfo').style.display = 'block';
        document.getElementById('discordName').textContent = discordCreds.username;
        
        // Use actual Discord avatar if available, otherwise use default
        const avatarUrl = discordCreds.avatar 
            ? `https://cdn.discordapp.com/avatars/${discordCreds.user_id}/${discordCreds.avatar}.png`
            : `https://cdn.discordapp.com/embed/avatars/${parseInt(discordCreds.user_id) % 5}.png`;
        document.getElementById('discordAvatar').src = avatarUrl;
    } else {
        document.getElementById('discordConnectBtn').style.display = 'block';
        document.getElementById('discordUserInfo').style.display = 'none';
    }
}

function updateWebAuthUI() {
    const btnLogin = document.getElementById('webLoginBtn');
    const btnLogout = document.getElementById('webLogoutBtn');
    const userStatus = document.getElementById('webUserStatus');
    
    if (authManager && authManager.isLoggedIn()) {
        if(btnLogin) btnLogin.style.display = 'none';
        if(btnLogout) btnLogout.style.display = 'inline-block';
        if(userStatus) userStatus.textContent = authManager.currentUser.username;
    } else {
        if(btnLogin) btnLogin.style.display = 'inline-block';
        if(btnLogout) btnLogout.style.display = 'none';
        if(userStatus) userStatus.textContent = "Guest";
    }
}

// ==========================================
// (⇀‸↼‶) SETTINGS & RULES LOGIC
// ==========================================

async function getDomainRules() {
    if (domainRulesCache) return domainRulesCache;
    if (!discordCreds) return [];
    
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/rules`, {
            headers: { 'x-tracker-token': discordCreds.tracker_token }
        });
        const data = await res.json();
        domainRulesCache = data.rules || [];
        return domainRulesCache;
    } catch (e) {
        console.error("Failed to fetch rules", e);
        return [];
    }
}

async function applyUrlRules(baseUrl) {
    if (!baseUrl) return "";
    const rules = await getDomainRules();
    let finalUrl = stripUrlParams(baseUrl); // remove unwanted params (e.g. ?hilit=) first

    rules.forEach(rule => {
        if (baseUrl.includes(rule.domain)) {
             const separator = finalUrl.includes('?') ? '&' : '?';
             let cleanParams = rule.params;
             if (cleanParams.startsWith('?') || cleanParams.startsWith('&')) {
                 cleanParams = cleanParams.substring(1);
             }
             finalUrl += separator + cleanParams;
        }
    });
    return finalUrl;
}

// ==========================================
// QUICK SITE SEARCH TEMPLATE
// Lets the user pre-set their community/site search URL (with a {GameName}
// placeholder) so each game gets a one-click "Find on <site>" button.
// ==========================================

/** Encode a game name for a URL value, honouring how the target site treats spaces. */
function encodeGameName(name, spaceMode) {
    let enc = encodeURIComponent((name || '').trim());
    if (spaceMode === 'plus') enc = enc.replace(/%20/g, '+');       // forums / x-www-form-urlencoded
    else if (spaceMode === 'raw') enc = enc.replace(/%20/g, ' ');   // literal space (rare)
    return enc; // 'percent' (or anything else) keeps %20
}

/** Build the final search URL for a game name, or null if no valid template is set. */
function buildSearchUrl(gameName) {
    const tmpl = userPreferences.searchTemplate;
    if (!tmpl || !tmpl.url || !tmpl.url.includes('{GameName}') || !gameName) return null;
    return tmpl.url.replace(/\{GameName\}/g, encodeGameName(gameName, tmpl.spaceMode));
}

/** True when a usable search template is configured. */
function hasSearchTemplate() {
    const tmpl = userPreferences.searchTemplate;
    return !!(tmpl && tmpl.url && tmpl.url.includes('{GameName}'));
}

/** Friendly label for the search button: custom name, else hostname, else "Site". */
function getSearchSiteLabel() {
    const tmpl = userPreferences.searchTemplate || {};
    if (tmpl.name && tmpl.name.trim()) return tmpl.name.trim();
    try { return new URL(tmpl.url).hostname.replace(/^www\./, ''); } catch (e) { return 'Site'; }
}

/** Resolve the name of a game by app id, preferring the currently-open modal. */
function getGameNameById(appId) {
    if (activeGameName) return activeGameName;
    if (trackedGamesMap[appId] && trackedGamesMap[appId].name) return trackedGamesMap[appId].name;
    const g = gamesCache.find(x => String(x.app_id) === String(appId));
    return g ? g.name : '';
}

/** Open the user's site search for a game in a new tab; optionally swap modal to the Links tab. */
window.openSiteSearch = function(appId, swapToLinks) {
    const url = buildSearchUrl(getGameNameById(appId));
    if (!url) {
        showToast("Set up a site search template in Settings first", "info");
        openGlobalSettings();
        switchSettingsTab('rules');
        return;
    }
    window.open(url, '_blank', 'noopener');
    if (swapToLinks) switchModalTab('settings');
};

function updateSearchTemplateSettingsUI() {
    const t = userPreferences.searchTemplate || {};
    const u = document.getElementById('searchTemplateUrl');
    const n = document.getElementById('searchTemplateName');
    const s = document.getElementById('searchTemplateSpace');
    if (u) u.value = t.url || '';
    if (n) n.value = t.name || '';
    if (s) s.value = t.spaceMode || 'plus';
    updateSearchTemplatePreview();
}

function updateSearchTemplatePreview() {
    const el = document.getElementById('searchTemplatePreview');
    if (!el) return;
    const url = (document.getElementById('searchTemplateUrl').value || '').trim();
    const mode = document.getElementById('searchTemplateSpace').value || 'plus';
    if (!url) { el.innerHTML = ''; return; }
    if (!url.includes('{GameName}')) {
        el.innerHTML = '<span style="color:#ffb86b;">⚠ Add <code>{GameName}</code> where the game name should go.</span>';
        return;
    }
    const sample = 'Super Battle Golf';
    const built = url.replace(/\{GameName\}/g, encodeGameName(sample, mode));
    el.innerHTML = `Preview (<strong>${sample}</strong>):<br><span style="color:#4bc0c0;">${escapeHtml(built)}</span>`;
}

function saveSearchTemplate() {
    const url = (document.getElementById('searchTemplateUrl').value || '').trim();
    const name = (document.getElementById('searchTemplateName').value || '').trim();
    const mode = document.getElementById('searchTemplateSpace').value || 'plus';
    if (url && !url.includes('{GameName}')) {
        showToast("Template must include {GameName}", "error");
        return;
    }
    userPreferences.searchTemplate = { url, name, spaceMode: mode };
    savePreferencesLocalOrSync();
    showToast(url ? "Search template saved!" : "Search template cleared", "success");
    updateSearchTemplatePreview();
}

function clearSearchTemplate() {
    userPreferences.searchTemplate = { url: '', name: '', spaceMode: 'plus' };
    updateSearchTemplateSettingsUI();
    savePreferencesLocalOrSync();
    showToast("Search template cleared", "info");
}

// ==========================================
// LINK CLEANUP — strip unwanted query params (e.g. phpBB ?hilit=...)
// Surgical: leaves kept params byte-for-byte (no re-encoding surprises).
// ==========================================
function stripUrlParams(rawUrl) {
    const keys = (userPreferences.stripParams || []).map(k => String(k).trim().toLowerCase()).filter(Boolean);
    if (!rawUrl || !keys.length) return rawUrl;

    const hashIdx = rawUrl.indexOf('#');
    const hash = hashIdx >= 0 ? rawUrl.slice(hashIdx) : '';
    const main = hashIdx >= 0 ? rawUrl.slice(0, hashIdx) : rawUrl;

    const qIdx = main.indexOf('?');
    if (qIdx < 0) return rawUrl; // no query string to clean

    const base = main.slice(0, qIdx);
    const kept = main.slice(qIdx + 1).split('&').filter(pair => {
        if (!pair) return false;
        const name = pair.split('=')[0];
        return !keys.includes(name.toLowerCase());
    });
    return base + (kept.length ? '?' + kept.join('&') : '') + hash;
}

function updateStripParamsSettingsUI() {
    const el = document.getElementById('stripParamsInput');
    if (el) el.value = (userPreferences.stripParams || []).join(', ');
    updateStripParamsPreview();
}

function updateStripParamsPreview() {
    const el = document.getElementById('stripParamsPreview');
    if (!el) return;
    const raw = document.getElementById('stripParamsInput').value || '';
    const keys = raw.split(',').map(k => k.trim()).filter(Boolean);
    if (!keys.length) { el.innerHTML = ''; return; }
    // Preview against the user's own example so the effect is obvious.
    const sample = '/viewtopic.php?f=10&t=81125&hilit=Trailmakers';
    const saved = userPreferences.stripParams;
    userPreferences.stripParams = keys;            // temporarily apply for preview
    const cleaned = stripUrlParams(sample);
    userPreferences.stripParams = saved;
    el.innerHTML = `Example:<br><span style="color:#888;">${escapeHtml(sample)}</span><br>&rarr; <span style="color:#4bc0c0;">${escapeHtml(cleaned)}</span>`;
}

function saveStripParams() {
    const raw = document.getElementById('stripParamsInput').value || '';
    userPreferences.stripParams = raw.split(',').map(k => k.trim()).filter(Boolean);
    savePreferencesLocalOrSync();
    showToast(userPreferences.stripParams.length ? "Link cleanup rules saved!" : "Link cleanup cleared", "success");
    updateStripParamsPreview();
}

async function openGlobalSettings() {
    document.getElementById('globalSettingsModal').style.display = 'flex';
    updateSettingsModalUI();
    
    // Only load online settings if logged in
    if(discordCreds) {
        loadDomainRules(); 
        // We do NOT auto-load notifications here to save API calls
        // They load when the specific tab is clicked
    }
}

async function loadDomainRules() {
    const list = document.getElementById('domainRulesList');
    list.innerHTML = '<div style="text-align:center; color:#666;">Loading rules...</div>';
    
    domainRulesCache = null; 
    const rules = await getDomainRules();

    list.innerHTML = '';
    if (rules.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:#666; padding:10px;">No rules defined. Add one above!</div>';
        return;
    }
    rules.forEach(rule => {
        const div = document.createElement('div');
        div.className = 'checkbox-row';
        div.innerHTML = `
            <div style="flex:1;">
                <div style="color:#4bc0c0; font-weight:bold;">${rule.domain}</div>
                <div style="color:#888; font-size:0.9em;">Appends: <code>${rule.params}</code></div>
            </div>
            <button class="btn btn-danger" style="padding: 5px 10px;" onclick="deleteDomainRule('${rule.domain}')"><i class="fas fa-trash"></i></button>
        `;
        list.appendChild(div);
    });
}

async function addDomainRule() {
    if (!discordCreds) return showLoginPrompt();
    const domain = document.getElementById('ruleDomain').value.trim();
    const params = document.getElementById('ruleParams').value.trim();
    if(!domain || !params) return alert("Please fill in both fields.");
    try {
        await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/rules`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token },
            body: JSON.stringify({ domain, params })
        });
        document.getElementById('ruleDomain').value = '';
        document.getElementById('ruleParams').value = '';
        showToast("Rule added!", "success");
        loadDomainRules(); 
    } catch(e) { showToast("Failed to add rule", "error"); }
}

async function deleteDomainRule(domain) {
    if(!confirm(`Delete rule for ${domain}?`)) return;
    try {
        await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/rules`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token },
            body: JSON.stringify({ domain, params: "" })
        });
        showToast("Rule deleted", "info");
        loadDomainRules(); 
    } catch(e) { showToast("Failed to delete", "error"); }
}

// ==========================================
// NEW: SERVER NOTIFICATION SETTINGS (GLOBAL)
// ==========================================

async function loadNotificationSettings() {
    const list = document.getElementById('guildSettingsList');
    if (!discordCreds) {
        list.innerHTML = `<div style="text-align:center; padding:20px;">
            <p>Login required to change settings.</p>
            <button class="btn btn-discord" onclick="showLoginPrompt()">Login</button>
        </div>`;
        return;
    }
    
    list.innerHTML = '<div style="text-align:center; color:#666;">Loading server preferences...</div>';

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/settings`, {
            headers: { 'x-tracker-token': discordCreds.tracker_token }
        });
        const data = await res.json();
        
        if(data.settings.length === 0) {
            list.innerHTML = '<div style="font-size:0.9em; color:#888; padding:10px;">No mutual servers found (or no data yet).</div>';
        } else {
            // 1. Determine if DMs are effectively enabled (if ANY server has dm=true)
            const isDmOn = data.settings.some(s => s.notify_dm);
            
            let html = `
                <!-- GLOBAL DM TOGGLE -->
                <div class="checkbox-row" style="border-bottom: 2px solid #333; margin-bottom: 20px; padding-bottom: 15px;">
                    <div style="flex:1;">
                        <span style="font-weight:bold; color:#fff; font-size:1.1em;">Direct Messages</span>
                        <div style="font-size:0.8em; color:#888;">Receive updates via DM (Global)</div>
                    </div>
                    <label class="switch">
                        <input type="checkbox" ${isDmOn ? 'checked' : ''} onchange="updateGlobalDm(this)">
                        <span class="slider"></span>
                    </label>
                </div>
                
                <h4 style="color:#4bc0c0; margin-bottom:10px;">Server Channels</h4>
            `;

            // 2. List Servers with ONLY the server toggle
            data.settings.forEach(setting => {
                const displayName = setting.guild_name || `Server ${setting.guild_id}`;
                
                html += `
                    <div class="checkbox-row">
                        <div style="flex:1;">
                            <span style="font-weight:bold; color:#ccc; font-size:1em;">${displayName}</span>
                            <div style="font-size:0.8em; color:#666;">ID: ${setting.guild_id}</div>
                        </div>
                        
                        <label class="switch">
                            <input type="checkbox" data-guild="${setting.guild_id}" 
                                ${setting.notify_server ? 'checked' : ''} 
                                onchange="updateGuildSettings('${setting.guild_id}')">
                            <span class="slider"></span>
                        </label>
                    </div>
                `;
            });
            
            list.innerHTML = html;
        }
    } catch(e) {
        console.error(e);
        list.innerHTML = '<div style="color:#ff6b6b; text-align:center;">Failed to load settings.</div>';
    }
}

window.updateGlobalDm = async (checkbox) => {
    try {
        await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/settings/dm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token },
            body: JSON.stringify({ notify_dm: checkbox.checked })
        });
        showToast(`DMs ${checkbox.checked ? 'Enabled' : 'Disabled'}`, "success");
    } catch(e) { 
        showToast("Update failed", "error"); 
        checkbox.checked = !checkbox.checked; // Revert UI
    }
};

window.updateGuildSettings = async (guildId) => {
    // Only looking for the server toggle now, as DM is global
    const serverInput = document.querySelector(`input[data-guild="${guildId}"]`);
    if(!serverInput) return;
    
    // We send current DM state (preserved) + new Server state
    // To preserve DM state correctly without querying DOM for the global switch every time, 
    // we can just send the global state, or rely on backend to handle partials?
    // The current endpoint expects both. Let's grab global state.
    const globalDmInput = document.querySelector('input[onchange="updateGlobalDm(this)"]');
    const dmState = globalDmInput ? globalDmInput.checked : false;

    try {
        await fetch(`${CONFIG.API_BASE_URL}/user/${discordCreds.user_id}/settings/${guildId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token },
            body: JSON.stringify({ notify_dm: dmState, notify_server: serverInput.checked })
        });
        showToast("Server settings updated", "success");
    } catch(e) { showToast("Update failed", "error"); }
};


// ==========================================
// MODAL & GAME DETAILS
// ==========================================
async function openGameModal(appId) {
    activeGameId = appId;
    // Seed the name from caches so site-search works before info finishes loading.
    activeGameName = (trackedGamesMap[appId] && trackedGamesMap[appId].name)
        || (gamesCache.find(g => String(g.app_id) === String(appId)) || {}).name
        || '';
    const modal = document.getElementById('gameModal');
    modal.style.display = 'flex';
    
    updateModalTrackButton(appId);

    const tabs = modal.querySelector('.modal-tabs');
    if(tabs) tabs.innerHTML = `
        <button class="tab-btn active" onclick="switchModalTab('info')">Game Info</button>
        <button class="tab-btn" onclick="switchModalTab('settings')">Links</button>
    `;
    switchModalTab('info');
}

function updateModalTrackButton(appId) {
    const btn = document.getElementById('modalTrackBtn');
    if (!btn) return;
    
    if (trackedGamesMap[appId]) {
        btn.innerHTML = '<i class="fas fa-trash"></i> Untrack';
        btn.className = 'modal-header-btn-left btn-danger';
        btn.onclick = () => toggleTrackFromModal(appId, 'untrack');
    } else {
        btn.innerHTML = '<i class="fas fa-plus"></i> Track';
        btn.className = 'modal-header-btn-left btn-success';
        btn.onclick = () => toggleTrackFromModal(appId, 'track');
    }
}

async function toggleTrackFromModal(appId, action) {
    if (action === 'track') {
        await trackGame(null, appId);
    } else {
        await untrackGame(null, appId);
    }
    updateModalTrackButton(appId);
}

async function switchModalTab(tab) {
    activeModalTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.tab-btn[onclick="switchModalTab('${tab}')"]`);
    if(activeBtn) activeBtn.classList.add('active');
    
    const body = document.getElementById('modalBody');
    body.innerHTML = '<div style="text-align:center; padding:20px;">Loading...</div>';
    if (tab === 'info') await renderModalInfo(activeGameId, body);
    if (tab === 'settings') await renderModalSettings(activeGameId, body);
}

async function renderModalInfo(appId, container) {
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/games/info/${appId}`);
        const info = await res.json();
        if (info && info.name) activeGameName = info.name;

        const trackedData = trackedGamesMap[appId];
        let customLinkBtn = '';

        // "Find on <site>" jumps to the user's pre-set search and swaps to the Links tab to paste.
        // Hidden once a custom link exists — no need to search again (still available on the Links tab).
        const hasCustomLink = !!(trackedData && trackedData.custom_link);
        let siteSearchBtn = '';
        if (hasSearchTemplate() && !hasCustomLink) {
            siteSearchBtn = `<button class="btn btn-dark" style="flex:1; text-align:center; border:1px solid #f1c40f; color:#f1c40f;" onclick="openSiteSearch('${appId}', true)"><i class="fas fa-search"></i> Find on ${escapeHtml(getSearchSiteLabel())}</button>`;
        }

        // Last Update: prefer the precise tracked build time; for untracked games fall back to
        // the catalog's approximate last_modified (already cached from the All Games / Top 100 list).
        const cachedCatalog = gamesCache.find(g => String(g.app_id) === String(appId));
        let lastUpdateHtml = 'Unknown';
        if (info.last_update) {
            lastUpdateHtml = new Date(info.last_update * 1000).toLocaleString();
        } else if (cachedCatalog && cachedCatalog.last_modified) {
            lastUpdateHtml = new Date(cachedCatalog.last_modified * 1000).toLocaleString() +
                ' <span style="color:#777; cursor:help;" title="Approximate — from Steam store metadata. Exact patch times are tracked only for games you follow.">(approx)</span>';
        }
        
        if (trackedData && trackedData.custom_link) {
            const processedLink = await applyUrlRules(trackedData.custom_link);
            let label = "Your Link";
            try { label = new URL(trackedData.custom_link).hostname; } catch(e) {}
            customLinkBtn = `<a href="${processedLink}" target="_blank" class="btn btn-dark" style="flex:1; text-align:center; border:1px solid #4bc0c0; color:#4bc0c0;"><i class="fas fa-link"></i> ${label}</a>`;
        }

        container.innerHTML = `
            <div style="display:flex; gap:20px; flex-wrap:wrap;">
                <img src="${info.header_image}" style="width:100%; border-radius:8px; margin-bottom:15px; max-height:250px; object-fit:contain; background:#1a1a1a;">
                <div style="flex: 1; min-width: 250px;">
                    <h2 style="color:#4bc0c0; margin-bottom: 10px;">${info.name}</h2>
                    <p style="margin-bottom: 15px; font-size:0.9em; color:#ccc;">${info.short_description || "No description available."}</p>
                    <div style="background: #1a1a1a; padding: 15px; border-radius: 6px; font-size:0.9em; color:#888;">
                        <p><strong>App ID:</strong> ${appId}</p>
                        <p><strong>Build ID:</strong> ${info.build_id || 'Unknown'}</p>
                        <p><strong>Last Update:</strong> ${lastUpdateHtml}</p>
                    </div>
                    <div style="display:flex; gap:10px; margin-top:20px; flex-wrap:wrap;">
                        <a href="https://store.steampowered.com/app/${appId}" target="_blank" class="btn btn-primary" style="flex:1; text-align:center;">Store</a>
                        <a href="https://steamdb.info/app/${appId}/patchnotes/" target="_blank" class="btn btn-dark" style="flex:1; text-align:center;">SteamDB</a>
                        ${siteSearchBtn}
                        ${customLinkBtn}
                    </div>
                </div>
            </div>
        `;
    } catch(e) { container.innerHTML = '<p style="text-align:center; color:#ff6b6b;">Failed to load info.</p>'; }
}

async function renderModalSettings(appId, container) {
    if (!discordCreds) {
        container.innerHTML = `<div style="text-align:center; padding:20px;">
            <p>Login required to change settings.</p>
            <button class="btn btn-discord" onclick="showLoginPrompt()">Login</button>
        </div>`;
        return;
    }

    let currentLink = "";
    let gameName = "Game Settings"; 

    if (trackedGamesMap[appId]) {
        currentLink = trackedGamesMap[appId].custom_link || "";
        gameName = trackedGamesMap[appId].name;
    } else {
        const gameInCache = gamesCache.find(g => String(g.app_id) === String(appId));
        if (gameInCache) {
            gameName = gameInCache.name;
        }
    }
    if (gameName && gameName !== "Game Settings") activeGameName = gameName;

    // Quick-search helper: either a one-click search button, or a tip to set the template up.
    let searchHelper = '';
    if (hasSearchTemplate()) {
        searchHelper = `<button class="btn btn-dark" style="width:100%; margin-bottom:12px; border:1px solid #f1c40f; color:#f1c40f;" onclick="openSiteSearch('${appId}', false)">
                <i class="fas fa-search"></i> Search ${escapeHtml(getSearchSiteLabel())} for this game
            </button>`;
    } else {
        searchHelper = `<p style="font-size:0.8em; color:#888; margin-bottom:12px;">
                💡 Tip: set a <a href="#" onclick="openGlobalSettings(); switchSettingsTab('rules'); return false;" style="color:#4bc0c0;">site search template</a> to find links in one click.
            </p>`;
    }

    // UPDATED: Removed the "Server Notification Settings" block from here.
    // It's now in the Global Settings -> Notifications tab.

    container.innerHTML = `
        <div style="text-align:center; margin-bottom: 20px;">
            <h2 style="color:#4bc0c0; margin:0;">${escapeHtml(gameName)}</h2>
            <div style="font-size:0.8em; color:#666;">App ID: ${appId}</div>
        </div>

        <div class="settings-group">
            <div class="settings-header">Custom 3rd Party Link</div>
            <p style="font-size:0.8em; color:#888; margin-bottom:10px;">
                Add a custom link for this game (e.g. <code>games.com/gta5</code>).<br>
                Global Domain Rules will apply to this link automatically.
            </p>
            ${searchHelper}
            <div style="display:flex; gap:10px;">
                <input type="text" id="customLinkInput" value="${escapeHtml(currentLink)}" placeholder="https://..." class="search-input" style="padding:8px; border-radius:4px;">
                <button class="btn btn-primary" onclick="saveCustomLink('${appId}')">Save</button>
            </div>
        </div>
        
        <div style="text-align:center; margin-top:30px; border-top:1px solid #333; padding-top:20px;">
            <p style="color:#888; font-size:0.9em;">
                Looking for notification settings?<br>
                They are now in the global <strong>Settings > Notifications</strong> menu.
            </p>
        </div>
    `;
}

async function saveCustomLink(appId) {
    const input = document.getElementById('customLinkInput');
    const link = stripUrlParams(input.value.trim()); // auto-clean unwanted params on save
    if (input.value.trim() !== link) input.value = link; // reflect the cleaned URL back to the user
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/games/user/${discordCreds.user_id}/${appId}/link`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token },
            body: JSON.stringify({ custom_link: link })
        });
        if(res.ok) {
            showToast("Link saved!", "success");
            if(trackedGamesMap[appId]) {
                trackedGamesMap[appId].custom_link = link;
            } else {
                loadTrackedGames(); 
            }
        } else throw new Error();
    } catch(e) { showToast("Failed to save link", "error"); }
}

// ==========================================
// EVENT HANDLERS & HELPERS
// ==========================================

// NEW: Helper function to search within tracked games locally
function searchTrackedGames(query) {
    if (!query) {
        lastSearchQuery = '';
        applySortAndRender();
        return;
    }
    
    lastSearchQuery = query;
    const lowerQuery = query.toLowerCase();
    
    // Filter tracked games by name
    const filtered = gamesCache.filter(game => 
        game.name.toLowerCase().includes(lowerQuery)
    );
    
    renderGames(filtered, true);
}

// NEW: Function to switch to All Games and search
window.searchInAllGames = (query) => {
    document.getElementById('searchInput').value = query;
    switchView('all');
    // The loadAllGames will be triggered by switchView
};

let searchTimeout = null;
async function handleSearch(e) {
    const query = document.getElementById('searchInput').value.trim();
    
    // Clear search if empty
    if (query === '') {
        lastSearchQuery = '';
        if (searchTimeout) clearTimeout(searchTimeout);
        
        // Reload current view with no search
        if (currentView === 'tracked') {
            loadTrackedGames();
        } else if (currentView === 'all') {
            loadAllGames('', false);
        }
        return;
    }
    
    // Check for Steam URL (quick track feature)
    if (query.includes('store.steampowered.com')) {
        await trackGame(null, null, query);
        document.getElementById('searchInput').value = '';
        lastSearchQuery = '';
        return;
    }
    
    // Debounce search
    if (searchTimeout) clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        if (currentView === 'tracked') {
            // Search within tracked games locally
            searchTrackedGames(query);
        } else if (currentView === 'all') {
            // Search catalog via API
            loadAllGames(query, false);
        } else {
            // If on Top 100, switch to All Games view
            switchView('all');
            // loadAllGames will be called by switchView, need to ensure query is used
            setTimeout(() => loadAllGames(query, false), 100);
        }
    }, 300);
}

// NEW: Handle Enter key press
function setupSearchKeyHandler() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
        searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const query = searchInput.value.trim();
                
                if (query === '') {
                    lastSearchQuery = '';
                    if (currentView === 'tracked') {
                        loadTrackedGames();
                    } else if (currentView === 'all') {
                        loadAllGames('', false);
                    }
                } else if (query.includes('store.steampowered.com')) {
                    trackGame(null, null, query);
                    searchInput.value = '';
                    lastSearchQuery = '';
                } else {
                    // Trigger immediate search
                    if (currentView === 'tracked') {
                        searchTrackedGames(query);
                    } else if (currentView === 'all') {
                        loadAllGames(query, false);
                    } else {
                        switchView('all');
                        setTimeout(() => loadAllGames(query, false), 100);
                    }
                }
            }
        });
    }
}

async function trackGame(e, appId, urlOverride = null) {
    if(e) e.stopPropagation();
    
    if(!discordCreds) {
        showToast("Please login to track games.", "info");
        showLoginPrompt();
        return;
    }

    const url = urlOverride || `https://store.steampowered.com/app/${appId}/`;
    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/track`, {
            method: 'POST', headers: {'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token},
            body: JSON.stringify({ user_id: discordCreds.user_id, steam_url: url })
        });
        const data = await res.json();
        if(data.status === 'success' || data.status === 'already_tracked') {
            showToast(`Tracking ${data.game}`, "success");
            
            // INSTANT UI UPDATE (Toggle Button)
            if (appId) {
                trackedGamesMap[appId] = { app_id: appId, name: data.game }; // Add to local map
                const btn = document.getElementById(`btn-${appId}`);
                if (btn) {
                    btn.className = 'action-btn btn-danger';
                    btn.style.background = ''; // Remove inline green override if any
                    btn.innerHTML = '<i class="fas fa-trash"></i>';
                    btn.onclick = (ev) => untrackGame(ev, appId);
                }
            } else {
                // Was a URL paste, just reload
                loadTrackedGames();
            }

        } else alert("Error tracking game");
    } catch(err) { alert("API Error"); }
}

async function untrackGame(e, appId) {
    if(e) e.stopPropagation();
    if(!discordCreds) return;
    
    if(!confirm("Stop tracking?")) return;

    try {
        const res = await fetch(`${CONFIG.API_BASE_URL}/untrack`, {
            method: 'POST', headers: {'Content-Type': 'application/json', 'x-tracker-token': discordCreds.tracker_token},
            body: JSON.stringify({ user_id: discordCreds.user_id, steam_url: `https://store.steampowered.com/app/${appId}/` })
        });
        if(res.ok) { 
            showToast("Game removed", "info"); 
            delete trackedGamesMap[appId]; 
            
            // INSTANT UI UPDATE
            if(currentView === 'tracked') {
                // If in tracked view, remove the card
                const btn = document.getElementById(`btn-${appId}`);
                if(btn) {
                    const card = btn.closest('.game-card');
                    if(card) card.remove();
                }
            } else {
                // If in catalog view, toggle button back to green
                const btn = document.getElementById(`btn-${appId}`);
                if(btn) {
                    btn.className = 'action-btn btn-success';
                    btn.style.background = '#28a745';
                    btn.innerHTML = '<i class="fas fa-plus"></i>';
                    btn.onclick = (ev) => trackGame(ev, appId);
                }
            }
        }
    } catch(err) { alert("Error removing game"); }
}

function setupModalClickOutside() {
    window.onclick = function(event) {
        if (event.target.classList.contains('modal') || event.target.classList.contains('auth-overlay')) {
            event.target.style.display = "none";
        }
    }
}

window.closeModal = (id) => document.getElementById(id).style.display = 'none';

// UPDATED: Save sidebar state to localStorage whenever toggled
window.toggleSidebar = () => {
    const sidebar = document.getElementById('sidebar');
    sidebar.classList.toggle('collapsed');
    
    // Save state locally as per "Last State" requirement
    const state = sidebar.classList.contains('collapsed') ? 'collapsed' : 'expanded';
    localStorage.setItem('steam_tracker_sidebar_state', state);
};

// Updated switchView with sort persistence and search handling
window.switchView = (view) => {
    currentView = view;
    const btnAll = document.getElementById('btn-all');
    const btnTop100 = document.getElementById('btn-top100');
    const btnTracked = document.getElementById('btn-tracked');
    const sortSelect = document.getElementById('sortSelect');
    const top100Controls = document.getElementById('top100Controls');
    const sortControlContainer = document.getElementById('sortControlContainer');
    const loadMoreBtn = document.getElementById('loadMoreContainer');
    const searchInput = document.getElementById('searchInput');
    
    if(btnAll) btnAll.className = view === 'all' ? 'active' : '';
    if(btnTop100) btnTop100.className = view === 'top100' ? 'active' : '';
    if(btnTracked) btnTracked.className = view === 'tracked' ? 'active' : '';

    // NEW: Restore sort for this view if applicable
    if (view === 'tracked' || view === 'all') {
        if (sortSelect && userPreferences.sorts && userPreferences.sorts[view]) {
            sortSelect.value = userPreferences.sorts[view];
        }
    }

    if (view === 'tracked') {
        document.getElementById('viewTitle').textContent = 'Your Tracked Games';
        top100Controls.style.display = 'none';
        sortControlContainer.style.display = 'block';
        loadMoreBtn.style.display = 'none';
        
        // Check if there's an active search
        const query = searchInput ? searchInput.value.trim() : '';
        if (query) {
            searchTrackedGames(query);
        } else {
            loadTrackedGames();
        }
    } else if (view === 'top100') {
         document.getElementById('viewTitle').textContent = 'Top 100 Games';
         top100Controls.style.display = 'block'; // SHOW TOGGLES
         sortControlContainer.style.display = 'none'; // HIDE SORT (Fixed Order)
         loadMoreBtn.style.display = 'none';
         loadTop100('ccu'); // Default to Concurrent
    } else {
         document.getElementById('viewTitle').textContent = 'Steam Catalog';
         top100Controls.style.display = 'none';
         sortControlContainer.style.display = 'block';
         
         // Check if there's an active search
         const query = searchInput ? searchInput.value.trim() : '';
         loadAllGames(query, false); 
    }
};

window.loadTop100 = loadTop100;
window.loginDiscord = loginDiscord;
window.logoutDiscord = logoutDiscord;
window.handleSearch = handleSearch;
window.trackGame = trackGame;
window.untrackGame = untrackGame;
window.openGameModal = openGameModal;
window.switchModalTab = switchModalTab;
window.saveCustomLink = saveCustomLink; 
window.handleSort = handleSort;
window.openGlobalSettings = openGlobalSettings;
window.addDomainRule = addDomainRule;
window.deleteDomainRule = deleteDomainRule;
window.showLoginPrompt = showLoginPrompt;
window.closeLoginPrompt = closeLoginPrompt;
window.toggleTrackFromModal = toggleTrackFromModal;
window.loadMoreGames = loadMoreGames;
// New Exports
window.switchSettingsTab = switchSettingsTab;
window.saveInterfacePreferences = saveInterfacePreferences;
window.regenerateToken = regenerateToken;
window.saveSearchTemplate = saveSearchTemplate;
window.clearSearchTemplate = clearSearchTemplate;
window.updateSearchTemplatePreview = updateSearchTemplatePreview;
window.saveStripParams = saveStripParams;
window.updateStripParamsPreview = updateStripParamsPreview;

/**
 * Cascading image fallback for game cards.
 * Tries: header.jpg -> capsule_616x353.jpg -> Steam Store API header_image -> placeholder
 */
async function handleImgError(img) {
    const appId = img.dataset.appid;
    if (!appId) {
        img.onerror = null;
        img.src = 'https://placehold.co/600x400?text=No+Image';
        return;
    }

    // Stage 1: Try capsule image on CDN
    if (!img.dataset.triedCapsule) {
        img.dataset.triedCapsule = 'true';
        img.src = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/capsule_616x353.jpg`;
        return;
    }

    // Stage 2: Fetch real header_image from Steam Store API
    if (!img.dataset.triedApi) {
        img.dataset.triedApi = 'true';
        try {
            const res = await fetch(`${CONFIG.API_BASE_URL}/games/info/${appId}`);
            if (res.ok) {
                const info = await res.json();
                if (info.header_image) {
                    img.src = info.header_image;
                    return;
                }
            }
        } catch(e) {
            console.warn(`Failed to fetch image for app ${appId}`, e);
        }
    }

    // Stage 3: Give up, use placeholder
    img.onerror = null;
    img.src = 'https://placehold.co/600x400?text=No+Image';
}
window.handleImgError = handleImgError;

function showToast(msg, type) {
    const colors = {
        success: '#28a745',  // Green
        error: '#dc3545',    // Red
        info: '#17a2b8'      // Blue
    };
    const color = colors[type] || colors.info;
    const toast = document.createElement('div');
    toast.style.cssText = `position: fixed; bottom: 20px; right: 20px; background: #333; color: white; padding: 12px 20px; border-radius: 4px; border-left: 4px solid ${color}; box-shadow: 0 4px 12px rgba(0,0,0,0.3); z-index: 3000; animation: slideIn 0.3s ease;`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
}

function setupEventListeners() {
    const loginBtn = document.getElementById('webLoginBtn');
    const logoutBtn = document.getElementById('webLogoutBtn');
    const loginForm = document.getElementById('webLoginForm');
    if (loginBtn) loginBtn.onclick = () => document.getElementById('webLoginModal').style.display = 'flex';
    if (loginForm) loginForm.onsubmit = async (e) => {
        e.preventDefault();
        if(authManager) {
            try {
                await authManager.login(document.getElementById('webUsername').value, document.getElementById('webPassword').value);
            } catch(err) { alert("Login failed: " + err.message); }
        }
    };
    if (logoutBtn) logoutBtn.onclick = () => { if(authManager) authManager.logout(); };
    
    // Setup Enter key handler for search
    setupSearchKeyHandler();
}