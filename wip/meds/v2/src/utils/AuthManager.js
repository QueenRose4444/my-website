// AuthManager - Complete Global Authentication and Session Management Module
// Adapted for React/ESM

export class AuthManager {
    /**
     * Initializes the AuthManager for a specific application.
     * @param {string} appName - Unique identifier for this app
     * @param {string} environment - Either 'live' or 'wip' (defaults to 'wip')
     */
    constructor(appName, environment = 'wip') {
        if (!appName) {
            throw new Error("AuthManager requires an 'appName' to be provided.");
        }

        this.appName = appName;
        this.environment = environment;

        // --- Environment-specific configurations ---
        const envConfigs = {
            live: {
                backendUrl: 'https://main-backend-live.rosiesite.workers.dev'
            },
            wip: {
                backendUrl: 'https://main-backend-wip.rosiesite.workers.dev'
            }
        };
        
        this.config = envConfigs[this.environment];

        // IMPORTANT: Auth tokens are shared across ALL apps (global login)
        this.authStoragePrefix = `auth_${this.environment}_`;

        // --- API Endpoints ---
        this.endpoints = {
            login: `${this.config.backendUrl}/api/auth/login`,
            register: `${this.config.backendUrl}/api/auth/register`,
            refresh: `${this.config.backendUrl}/api/auth/refresh`,
            logout: `${this.config.backendUrl}/api/auth/logout`,
            changePassword: `${this.config.backendUrl}/api/auth/change-password`,
            data: `${this.config.backendUrl}/api/data/${this.appName}`
        };

        // --- Global State ---
        this.authToken = localStorage.getItem(`${this.authStoragePrefix}authToken`);
        this.refreshToken = localStorage.getItem(`${this.authStoragePrefix}refreshToken`);
        
        // Decode user immediately if token exists
        this.currentUser = this.authToken ? this._decodeJwtPayload(this.authToken) : null;
        
        this.isRefreshingToken = false;
        this.refreshSubscribers = [];

        // --- Cross-Tab Synchronization ---
        window.addEventListener('storage', (event) => {
            if (event.key === `${this.authStoragePrefix}authToken`) {
                this.authToken = event.newValue;
                this.currentUser = this.authToken ? this._decodeJwtPayload(this.authToken) : null;
                this._log("Synced authToken from another tab.");
                
                if (this.currentUser && event.oldValue === null) {
                    window.dispatchEvent(new CustomEvent('auth:session-restored', { detail: { user: this.currentUser } }));
                }
            }
            if (event.key === `${this.authStoragePrefix}refreshToken`) {
                this.refreshToken = event.newValue;
                this._log("Synced refreshToken from another tab.");
            }
            
            if (event.key === `${this.authStoragePrefix}refreshToken` && !event.newValue) {
                this.currentUser = null;
                this.authToken = null;
                this.refreshToken = null;
                window.dispatchEvent(new CustomEvent('auth:logout', { detail: { message: "Logged out from another tab." } }));
            }
        });

        this._log('AuthManager initialized', { appName: this.appName, environment: this.environment });
    }

    _log(...args) {
        if (this.environment === 'wip') {
            console.log('[AUTH_LOG]', ...args);
        }
    }

    _decodeJwtPayload(token) {
        try {
            const base64Url = token.split('.')[1];
            if (!base64Url) return null;
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(
                atob(base64).split('').map(c => 
                    '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
                ).join('')
            );
            return JSON.parse(jsonPayload);
        } catch (e) {
            console.error("Failed to decode JWT:", e);
            return null;
        }
    }

    isTokenExpired(token) {
        if (!token) return true;
        try {
            const payload = this._decodeJwtPayload(token);
            if (!payload || !payload.exp) return true;
            const expiresAt = payload.exp * 1000;
            return Date.now() >= (expiresAt - 60000);
        } catch (e) {
            return true;
        }
    }

    async attemptRefreshToken() {
        this.refreshToken = localStorage.getItem(`${this.authStoragePrefix}refreshToken`);
        
        if (!this.refreshToken) {
            this._log("No refresh token available.");
            return false;
        }

        if (this.isRefreshingToken) {
            this._log("Token refresh already in progress, subscribing to result...");
            return new Promise(resolve => this.refreshSubscribers.push(resolve));
        }

        this._log("Attempting to refresh auth token...");
        this.isRefreshingToken = true;
        let success = false;

        try {
            const response = await fetch(this.endpoints.refresh, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.refreshToken })
            });
            const data = await response.json();
            
            if (!response.ok) throw new Error(data.error || 'Refresh failed');
            
            this.authToken = data.accessToken;
            if (data.refreshToken) {
                this.refreshToken = data.refreshToken;
                localStorage.setItem(`${this.authStoragePrefix}refreshToken`, this.refreshToken);
            }
            
            localStorage.setItem(`${this.authStoragePrefix}authToken`, this.authToken);
            this.currentUser = this._decodeJwtPayload(this.authToken);
            
            this._log("Token refreshed successfully.");
            success = true;
        } catch (error) {
            this._log("Token refresh failed:", error.message);
            await this.logout("Your session has expired. Please log in again.");
            success = false;
        } finally {
            this.isRefreshingToken = false;
            this.refreshSubscribers.forEach(cb => cb(success));
            this.refreshSubscribers = [];
        }
        return success;
    }

    async fetchWithAuth(url, options = {}) {
        if (!this.isLoggedIn()) {
             throw new Error("User is not logged in. Cannot make an authenticated request.");
        }

        if (this.isTokenExpired(this.authToken)) {
            const refreshed = await this.attemptRefreshToken();
            if (!refreshed) {
                throw new Error("Authentication failed; session expired.");
            }
        }

        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json'
        };

        let response = await fetch(url, options);

        if (response.status === 401) {
            this._log("Received 401 Unauthorized. Attempting token refresh and retry...");
            const refreshed = await this.attemptRefreshToken();
            if (refreshed) {
                options.headers['Authorization'] = `Bearer ${this.authToken}`;
                response = await fetch(url, options);
            } else {
                 throw new Error("Authentication failed after retry.");
            }
        }
        return response;
    }

    async login(username, password) {
        this._log(`Attempting login for user: ${username}`);
        const response = await fetch(this.endpoints.login, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Login failed");
        }

        this.authToken = data.accessToken;
        this.refreshToken = data.refreshToken;
        
        localStorage.setItem(`${this.authStoragePrefix}authToken`, this.authToken);
        localStorage.setItem(`${this.authStoragePrefix}refreshToken`, this.refreshToken);

        this.currentUser = this._decodeJwtPayload(this.authToken);
        this._log(`Login successful for ${this.currentUser.username}`);
        
        window.dispatchEvent(new CustomEvent('auth:login', { 
            detail: { user: this.currentUser } 
        }));

        return this.currentUser;
    }

    async register(username, password) {
        this._log(`Attempting registration for user: ${username}`);
        const response = await fetch(this.endpoints.register, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Registration failed");
        }

        window.dispatchEvent(new CustomEvent('auth:register', { 
            detail: { username } 
        }));

        return data;
    }

    async changePassword(currentPassword, newPassword) {
        if (!this.isLoggedIn()) {
            throw new Error("User must be logged in to change password.");
        }

        const response = await this.fetchWithAuth(this.endpoints.changePassword, {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Password change failed");
        }

        window.dispatchEvent(new CustomEvent('auth:password-changed', { 
            detail: { message: data.message } 
        }));

        return data;
    }

    async logout(message = null) {
        this._log("Logging out user.");
        const tokenToInvalidate = this.refreshToken;
        
        if (tokenToInvalidate) {
            fetch(this.endpoints.logout, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: tokenToInvalidate })
            }).catch(err => this._log("Logout API call failed (non-critical).", err));
        }

        const loggedOutUser = this.currentUser;
        this.authToken = null;
        this.refreshToken = null;
        this.currentUser = null;
        
        localStorage.removeItem(`${this.authStoragePrefix}authToken`);
        localStorage.removeItem(`${this.authStoragePrefix}refreshToken`);

        window.dispatchEvent(new CustomEvent('auth:logout', { 
            detail: { lastUser: loggedOutUser, message: message } 
        }));
    }
    
    isLoggedIn() {
        return !!this.refreshToken;
    }

    async initialize() {
        this._log("Initializing session...");
        
        if (this.isLoggedIn()) {
            if (!this.isTokenExpired(this.authToken)) {
                this._log("Existing token is valid. No refresh needed.");
                
                if (!this.currentUser) this.currentUser = this._decodeJwtPayload(this.authToken);
                
                window.dispatchEvent(new CustomEvent('auth:session-restored', { 
                    detail: { user: this.currentUser } 
                }));
                return this.currentUser;
            }

            this._log("Token expired or missing. Refreshing...");
            const refreshed = await this.attemptRefreshToken();
            if (refreshed) {
                this._log("Session restored via refresh.");
                window.dispatchEvent(new CustomEvent('auth:session-restored', { 
                    detail: { user: this.currentUser } 
                }));
                return this.currentUser;
            }
        }
        
        this._log("No active session found.");
        window.dispatchEvent(new CustomEvent('auth:no-session'));
        return null;
    }
}
