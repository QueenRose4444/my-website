// template.js - Example usage of the AuthManager module.

document.addEventListener("DOMContentLoaded", () => {
    // --- CONFIGURATION ---
    // Each application using the AuthManager must have a unique name.
    const APP_NAME = 'template-app';
    const ENVIRONMENT = 'wip'; // 'wip' or 'live'

    // --- INITIALIZATION ---
    // Instantiate the AuthManager. This class comes from the included `auth.js`.
    const authManager = new AuthManager(APP_NAME, ENVIRONMENT);

    // --- DOM ELEMENT REFERENCES ---
    const elements = {
        userStatus: document.getElementById("userStatus"),
        loginButton: document.getElementById("loginButton"),
        logoutButton: document.getElementById("logoutButton"),
        registerButton: document.getElementById("registerButton"),
        testApiButton: document.getElementById("testApiButton"),
        loginModal: document.getElementById("loginModal"),
        registerModal: document.getElementById("registerModal"),
        loginForm: document.getElementById("loginForm"),
        registerForm: document.getElementById("registerForm"),
        loginUsernameInput: document.getElementById("loginUsername"),
        loginPasswordInput: document.getElementById("loginPassword"),
        loginError: document.getElementById("loginError"),
        registerUsernameInput: document.getElementById("registerUsername"),
        registerPasswordInput: document.getElementById("registerPassword"),
        registerConfirmPasswordInput: document.getElementById("registerConfirmPassword"),
        registerError: document.getElementById("registerError"),
        apiResponse: document.getElementById("apiResponse"),
        apiResponseContent: document.getElementById("apiResponseContent"),
    };

    // --- UI UPDATE LOGIC ---

    /**
     * Updates the visibility of buttons and user status text based on login state.
     */
    function updateUIForLoginState() {
        const isLoggedIn = authManager.isLoggedIn();
        const user = authManager.currentUser;

        if (isLoggedIn && user) {
            elements.userStatus.textContent = `Logged in: ${user.username}`;
            elements.userStatus.style.color = '#4bc0c0';
            elements.loginButton.style.display = 'none';
            elements.registerButton.style.display = 'none';
            elements.logoutButton.style.display = 'inline-block';
            elements.testApiButton.style.display = 'inline-block';
        } else {
            elements.userStatus.textContent = 'Not logged in (Local)';
            elements.userStatus.style.color = '#ccc';
            elements.loginButton.style.display = 'inline-block';
            elements.registerButton.style.display = 'inline-block';
            elements.logoutButton.style.display = 'none';
            elements.testApiButton.style.display = 'none';
        }
    }

    // --- AUTH EVENT LISTENERS ---
    // The AuthManager dispatches custom events. We listen for them to keep the UI in sync.

    window.addEventListener('auth:login', (e) => {
        console.log("Event received: auth:login", e.detail.user);
        updateUIForLoginState();
        elements.loginModal.style.display = 'none';
    });

    window.addEventListener('auth:logout', (e) => {
        console.log("Event received: auth:logout", e.detail.message);
        if (e.detail.message) {
            alert(e.detail.message);
        }
        updateUIForLoginState();
    });

    window.addEventListener('auth:session-restored', (e) => {
        console.log("Event received: auth:session-restored", e.detail.user);
        updateUIForLoginState();
    });
    
    window.addEventListener('auth:no-session', () => {
        console.log("Event received: auth:no-session");
        updateUIForLoginState();
    });


    // --- FORM AND BUTTON EVENT HANDLERS ---

    // Show Login Modal
    elements.loginButton.addEventListener('click', () => {
        elements.loginModal.style.display = 'block';
    });
    
    // Show Register Modal
    elements.registerButton.addEventListener('click', () => {
        elements.registerModal.style.display = 'block';
    });

    // Handle Logout
    elements.logoutButton.addEventListener('click', () => {
        authManager.logout();
    });

    // Handle Login Form Submission
    elements.loginForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        elements.loginError.textContent = '';
        const username = elements.loginUsernameInput.value.trim();
        const password = elements.loginPasswordInput.value;

        try {
            await authManager.login(username, password);
            // The 'auth:login' event will handle the rest.
        } catch (error) {
            elements.loginError.textContent = error.message;
        }
    });

    // Handle Register Form Submission (Note: AuthManager doesn't have a register method, so we do it manually)
    elements.registerForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        elements.registerError.textContent = '';
        const username = elements.registerUsernameInput.value.trim();
        const password = elements.registerPasswordInput.value;

        if (password !== elements.registerConfirmPasswordInput.value) {
            elements.registerError.textContent = 'Passwords do not match.';
            return;
        }

        try {
            const response = await fetch(authManager.endpoints.register, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error);
            
            alert("Registration successful! Please log in.");
            elements.registerModal.style.display = 'none';
            elements.loginModal.style.display = 'block';
            elements.loginUsernameInput.value = username;
            elements.loginPasswordInput.focus();

        } catch (error) {
            elements.registerError.textContent = error.message;
        }
    });

    // Handle Test API button click
    elements.testApiButton.addEventListener('click', async () => {
        elements.apiResponse.style.display = 'block';
        elements.apiResponseContent.textContent = 'Fetching data...';

        try {
            // Use the AuthManager's fetch wrapper to make an authenticated request
            const response = await authManager.fetchWithAuth(authManager.endpoints.data);
            
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            elements.apiResponseContent.textContent = JSON.stringify(data, null, 2);

        } catch (error) {
            elements.apiResponseContent.textContent = `Error: ${error.message}`;
        }
    });

    // Generic modal close logic
    document.body.addEventListener('click', function(e) {
        const modal = e.target.closest('.auth-modal');
        if (!modal) return;
        
        const isCloseControl = e.target.matches('.close-auth-modal, .close-auth-modal-button');
        
        if (isCloseControl || e.target === modal) {
            modal.style.display = 'none';
        }
    });


    // --- KICK-OFF ---
    // Initialize the authentication manager on page load to check for an existing session.
    authManager.initialize();
});