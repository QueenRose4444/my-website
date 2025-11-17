// web page/wip/auth.js - Reusable Authentication and Session Management Module

const ENVIRONMENT = 'wip';

class AuthManager {
    /**
     * Initializes the AuthManager for a specific application.
     * The environment is now controlled by the `ENVIRONMENT` constant at the top of the file.
     * @param {string} appName - A unique name for the application (e.g., 'med-tracker', 'bbcode-editor'). This isolates data on the backend and in local storage.
     */
    constructor(appName) {
        if (!appName) {
            throw new Error("AuthManager requires an 'appName' to be provided.");
        }

        this.appName = appName;
        this.environment = ENVIRONMENT;

        // --- Environment-specific configurations (matches meds.js style) ---
        const envConfigs = {
            live: {
                backendUrl: 'https://main-backend-live.rosiesite.workers.dev'
            },
            wip: {
                backendUrl: 'https://main-backend-wip.rosiesite.workers.dev'
            }
        };
        
        this.config = envConfigs[this.environment];

        // Use a common prefix for auth tokens, independent of appName.
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
        this.currentUser = null;
        this.authToken = localStorage.getItem(`${this.authStoragePrefix}authToken`);
        this.refreshToken = localStorage.getItem(`${this.authStoragePrefix}refreshToken`);
        
        this.isRefreshingToken = false;
        this.refreshSubscribers = [];

        this._log('AuthManager initialized', { appName: this.appName, environment: this.environment });
    }

    /**
     * Internal logging utility.
     */
    _log(...args) {
        if (this.environment === 'wip') {
            console.log('[AUTH_LOG]', ...args);
        }
    }

    /**
     * Decodes a JWT payload to extract user information.
     * @param {string} token - The JWT.
     * @returns {object|null} The decoded payload or null if decoding fails.
     */
    _decodeJwtPayload(token) {
        try {
            const base64Url = token.split('.')[1];
            if (!base64Url) throw new Error("Invalid JWT structure");
            const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
            const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
            return JSON.parse(jsonPayload);
        } catch (e) {
            console.error("Failed to decode JWT:", e);
            return null;
        }
    }

    /**
     * Checks if a JWT is expired or close to expiring.
     * @param {string} token - The JWT.
     * @returns {boolean} True if the token is expired.
     */
    isTokenExpired(token) {
        if (!token) return true;
        try {
            const payload = this._decodeJwtPayload(token);
            const expiresAt = payload.exp * 1000;
            // Consider expired if it's within 10 seconds of expiry
            return Date.now() >= (expiresAt - 10000);
        } catch (e) {
            return true;
        }
    }

    /**
     * Attempts to get a new auth token using the refresh token.
     * This is the core of session persistence.
     * @returns {Promise<boolean>} True if the token was successfully refreshed.
     */
    async attemptRefreshToken() {
        if (!this.refreshToken) {
            this._log("No refresh token available.");
            return false;
        }

        // If a refresh is already in progress, wait for its result.
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
            // Notify all subscribers of the result.
            this.refreshSubscribers.forEach(cb => cb(success));
            this.refreshSubscribers = [];
        }
        return success;
    }

    /**
     * A wrapper for the native `fetch` API that automatically handles authentication.
     * It adds the Authorization header and attempts to refresh the token if it's expired.
     * @param {string} url - The URL to fetch.
     * @param {object} options - Standard `fetch` options.
     * @returns {Promise<Response>} The `fetch` Response object.
     */
    async fetchWithAuth(url, options = {}) {
        if (!this.isLoggedIn()) {
             throw new Error("User is not logged in. Cannot make an authenticated request.");
        }

        // Check if token needs refreshing before the request.
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

        // If the request fails with a 401 (e.g., token was revoked server-side),
        // try one more time to refresh the token.
        if (response.status === 401) {
            this._log("Received 401 Unauthorized. Attempting token refresh and retry...");
            const refreshed = await this.attemptRefreshToken();
            if (refreshed) {
                options.headers['Authorization'] = `Bearer ${this.authToken}`;
                response = await fetch(url, options); // Retry the request
            } else {
                 throw new Error("Authentication failed after retry.");
            }
        }
        return response;
    }

    /**
     * Logs a user in.
     * @param {string} username - The user's username.
     * @param {string} password - The user's password.
     * @returns {Promise<object>} The user object from the decoded token.
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
        window.dispatchEvent(new CustomEvent('auth:login', { detail: { user: this.currentUser } }));

        return this.currentUser;
    }

    /**
     * Logs the user out, clears local session data, and notifies the backend.
     * @param {string|null} [message=null] - An optional message (e.g., reason for logout).
     */
    async logout(message = null) {
        this._log("Logging out user.");
        if (this.refreshToken) {
            // Notify the backend that this refresh token is being invalidated.
            // This is "fire and forget" - we don't block logout if it fails.
            fetch(this.endpoints.logout, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.refreshToken })
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
        window.dispatchEvent(new CustomEvent('auth:logout', { detail: { lastUser: loggedOutUser, message: message } }));
        this._log("User has been logged out.");
    }
    
    /**
     * Checks if the user is currently considered logged in (i.e., has a refresh token).
     * @returns {boolean}
     */
    isLoggedIn() {
        return !!this.refreshToken;
    }

    /**
     * Initializes the auth state on page load.
     * Checks for an existing session and refreshes it if found.
     * @returns {Promise<object|null>} The user object if a session is restored, otherwise null.
     */
    async initialize() {
        this._log("Initializing session...");
        if (this.isLoggedIn()) {
            const refreshed = await this.attemptRefreshToken();
            if (refreshed) {
                this._log("Session restored successfully for", this.currentUser.username);
                window.dispatchEvent(new CustomEvent('auth:session-restored', { detail: { user: this.currentUser } }));
                return this.currentUser;
            }
        }
        this._log("No active session found.");
        window.dispatchEvent(new CustomEvent('auth:no-session'));
        return null;
    }
}
