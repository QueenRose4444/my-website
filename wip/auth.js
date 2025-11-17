// auth.js - Complete Global Authentication and Session Management Module
// This provides a shared login system across all apps on the site.
// Each app uses the same user account, but has separate data storage.

/**
 * AuthManager - Handles authentication and data sync for web applications
 * 
 * Features:
 * - Global user accounts (one login works across all apps)
 * - Automatic token refresh for persistent sessions
 * - Per-app data isolation on the backend
 * - Generic data fetch/save methods
 * - Custom event system for UI updates
 */
class AuthManager {
    /**
     * Initializes the AuthManager for a specific application.
     * @param {string} appName - Unique identifier for this app (e.g., 'med-tracker', 'bbcode-editor')
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
        // This allows users to stay logged in when navigating between apps
        this.authStoragePrefix = `auth_${this.environment}_`;

        // --- API Endpoints ---
        this.endpoints = {
            login: `${this.config.backendUrl}/api/auth/login`,
            register: `${this.config.backendUrl}/api/auth/register`,
            refresh: `${this.config.backendUrl}/api/auth/refresh`,
            logout: `${this.config.backendUrl}/api/auth/logout`,
            changePassword: `${this.config.backendUrl}/api/auth/change-password`,
            // Data endpoint is app-specific to keep data isolated
            data: `${this.config.backendUrl}/api/data/${this.appName}`
        };

        // --- Global State ---
        this.currentUser = null;
        this.authToken = localStorage.getItem(`${this.authStoragePrefix}authToken`);
        this.refreshToken = localStorage.getItem(`${this.authStoragePrefix}refreshToken`);
        
        this.isRefreshingToken = false;
        this.refreshSubscribers = [];

        this._log('AuthManager initialized', { appName: this.appName, environment: this.environment });
    }

    /**
     * Internal logging utility (only logs in 'wip' environment)
     */
    _log(...args) {
        if (this.environment === 'wip') {
            console.log('[AUTH_LOG]', ...args);
        }
    }

    /**
     * Decodes a JWT payload to extract user information.
     * @param {string} token - The JWT
     * @returns {object|null} The decoded payload or null if decoding fails
     */
    _decodeJwtPayload(token) {
        try {
            const base64Url = token.split('.')[1];
            if (!base64Url) throw new Error("Invalid JWT structure");
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

    /**
     * Checks if a JWT is expired or close to expiring.
     * @param {string} token - The JWT
     * @returns {boolean} True if the token is expired
     */
    isTokenExpired(token) {
        if (!token) return true;
        try {
            const payload = this._decodeJwtPayload(token);
            const expiresAt = payload.exp * 1000;
            // Consider expired if within 10 seconds of expiry
            return Date.now() >= (expiresAt - 10000);
        } catch (e) {
            return true;
        }
    }

    /**
     * Attempts to get a new auth token using the refresh token.
     * This is the core of session persistence across page loads.
     * @returns {Promise<boolean>} True if the token was successfully refreshed
     */
    async attemptRefreshToken() {
        if (!this.refreshToken) {
            this._log("No refresh token available.");
            return false;
        }

        // If a refresh is already in progress, wait for its result
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
            localStorage.setItem(`${this.authStoragePrefix}authToken`, this.authToken);
            this.currentUser = this._decodeJwtPayload(this.authToken);
            this._log("Token refreshed successfully. User:", this.currentUser.username);
            success = true;
        } catch (error) {
            this._log("Token refresh failed:", error.message);
            // If refresh fails, the session is invalid. Log the user out.
            await this.logout("Your session has expired. Please log in again.");
            success = false;
        } finally {
            this.isRefreshingToken = false;
            // Notify all subscribers of the result
            this.refreshSubscribers.forEach(cb => cb(success));
            this.refreshSubscribers = [];
        }
        return success;
    }

    /**
     * A wrapper for the native `fetch` API that automatically handles authentication.
     * It adds the Authorization header and attempts to refresh the token if needed.
     * @param {string} url - The URL to fetch
     * @param {object} options - Standard `fetch` options
     * @returns {Promise<Response>} The `fetch` Response object
     */
    async fetchWithAuth(url, options = {}) {
        if (!this.isLoggedIn()) {
             throw new Error("User is not logged in. Cannot make an authenticated request.");
        }

        // Check if token needs refreshing before the request
        if (this.isTokenExpired(this.authToken)) {
            const refreshed = await this.attemptRefreshToken();
            if (!refreshed) {
                throw new Error("Authentication failed; session expired.");
            }
        }

        // Set auth headers
        options.headers = {
            ...options.headers,
            'Authorization': `Bearer ${this.authToken}`,
            'Content-Type': 'application/json'
        };

        let response = await fetch(url, options);

        // If the request fails with a 401, try to refresh and retry once
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

    /**
     * Logs a user in.
     * @param {string} username - The user's username
     * @param {string} password - The user's password
     * @returns {Promise<object>} The user object from the decoded token
     */
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
        
        // Dispatch a custom event to notify the application of the login
        window.dispatchEvent(new CustomEvent('auth:login', { 
            detail: { user: this.currentUser } 
        }));

        return this.currentUser;
    }

    /**
     * Registers a new user account.
     * @param {string} username - Desired username
     * @param {string} password - Desired password
     * @returns {Promise<object>} Success message from server
     */
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

        this._log(`Registration successful for ${username}`);
        
        // Dispatch event for registration success
        window.dispatchEvent(new CustomEvent('auth:register', { 
            detail: { username } 
        }));

        return data;
    }

    /**
     * Changes the current user's password.
     * NOTE: This will log the user out after success, requiring re-login.
     * @param {string} currentPassword - The user's current password
     * @param {string} newPassword - The desired new password
     * @returns {Promise<object>} Success message from server
     */
    async changePassword(currentPassword, newPassword) {
        if (!this.isLoggedIn()) {
            throw new Error("User must be logged in to change password.");
        }

        this._log("Attempting password change...");
        const response = await this.fetchWithAuth(this.endpoints.changePassword, {
            method: 'POST',
            body: JSON.stringify({ currentPassword, newPassword })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Password change failed");
        }

        this._log("Password changed successfully.");
        
        // Dispatch event for password change
        window.dispatchEvent(new CustomEvent('auth:password-changed', { 
            detail: { message: data.message } 
        }));

        return data;
    }

    /**
     * Logs the user out, clears local session data, and notifies the backend.
     * @param {string|null} [message=null] - Optional message (e.g., reason for logout)
     */
    async logout(message = null) {
        this._log("Logging out user.");
        const tokenToInvalidate = this.refreshToken;
        
        if (tokenToInvalidate) {
            // Notify the backend that this refresh token is being invalidated
            // This is "fire and forget" - we don't block logout if it fails
            fetch(this.endpoints.logout, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: tokenToInvalidate })
            }).catch(err => this._log("Logout API call failed, but proceeding with client-side logout.", err));
        }

        // Clear local state and storage
        const loggedOutUser = this.currentUser;
        this.authToken = null;
        this.refreshToken = null;
        this.currentUser = null;
        localStorage.removeItem(`${this.authStoragePrefix}authToken`);
        localStorage.removeItem(`${this.authStoragePrefix}refreshToken`);

        // Dispatch a custom event to notify the application
        window.dispatchEvent(new CustomEvent('auth:logout', { 
            detail: { lastUser: loggedOutUser, message: message } 
        }));
        this._log("User has been logged out.");
    }
    
    /**
     * Checks if the user is currently considered logged in.
     * @returns {boolean} True if user has a valid refresh token
     */
    isLoggedIn() {
        return !!this.refreshToken;
    }

    /**
     * Initializes the auth state on page load.
     * Checks for an existing session and refreshes it if found.
     * This should be called once when the page loads.
     * @returns {Promise<object|null>} The user object if a session is restored, otherwise null
     */
    async initialize() {
        this._log("Initializing session...");
        
        if (this.isLoggedIn()) {
            // Try to refresh the token to ensure it's valid
            const refreshed = await this.attemptRefreshToken();
            if (refreshed) {
                this._log("Session restored successfully for", this.currentUser.username);
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