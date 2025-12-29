/**
 * Main Application Controller
 */
const App = (function() {
    
    const APP_NAME = 'template_builder';
    const ENVIRONMENT = 'wip';
    
    // DOM Elements
    const elements = {
        editModeBtn: () => document.getElementById('edit-mode-btn'),
        useModeBtn: () => document.getElementById('use-mode-btn'),
        editorTabs: () => document.getElementById('editor-tabs'),
        editorContent: () => document.getElementById('editor-content'),
        useModeView: () => document.getElementById('use-mode-view'),
        useLayout: () => document.getElementById('use-layout'),
        tabBtns: () => document.querySelectorAll('.tab-btn'),
        tabPanels: () => document.querySelectorAll('.tab-panel'),
        // Auth elements
        userStatus: () => document.getElementById('userStatus'),
        loginButton: () => document.getElementById('loginButton'),
        registerButton: () => document.getElementById('registerButton'),
        logoutButton: () => document.getElementById('logoutButton'),
        localSyncButton: () => document.getElementById('localSyncButton'),
        settingsButton: () => document.getElementById('settingsButton'),
        // Modals
        syncModal: () => document.getElementById('syncModal'),
        settingsModal: () => document.getElementById('settingsModal'),
        loginModal: () => document.getElementById('loginModal'),
        registerModal: () => document.getElementById('registerModal'),
        // Sync
        exportDataBtn: () => document.getElementById('exportData'),
        importDataInput: () => document.getElementById('importData'),
        syncStatus: () => document.getElementById('syncStatus'),
        // Data tab elements
        primaryKeySelect: () => document.getElementById('primary-key-select'),
        mergeRulesList: () => document.getElementById('merge-rules-list'),
        dataEntriesList: () => document.getElementById('data-entries-list'),
        clearDataBtn: () => document.getElementById('clear-data-btn')
    };
    
    let currentMode = 'edit';
    let authManager = null;
    
    // Initialize application
    function init() {
        console.log(`[${APP_NAME}] Initializing...`);
        
        // Initialize all modules
        TemplateManager.init();
        ParserEngine.init();
        VariableRegistry.init();
        OutputEngine.init();
        ModuleSystem.init();
        LogicEditor.init();
        LayoutManager.init();
        UseMode.init();
        
        // Bind main events
        bindEvents();
        
        // Initialize auth if available
        initAuth();
        
        console.log(`[${APP_NAME}] Initialized`);
    }
    
    // Bind events
    function bindEvents() {
        // Mode toggle
        elements.editModeBtn()?.addEventListener('click', () => setMode('edit'));
        elements.useModeBtn()?.addEventListener('click', () => setMode('use'));
        
        // Editor tabs
        elements.tabBtns().forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.dataset.tab));
        });
        
        // Template events
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
        
        // Module value changes
        document.addEventListener('moduleValueChanged', handleModuleValueChange);
        
        // Top bar buttons
        elements.localSyncButton()?.addEventListener('click', () => {
            elements.syncModal()?.classList.remove('hidden');
        });
        
        elements.settingsButton()?.addEventListener('click', () => {
            elements.settingsModal()?.classList.remove('hidden');
        });
        
        // Sync modal
        elements.exportDataBtn()?.addEventListener('click', handleExportAllData);
        elements.importDataInput()?.addEventListener('change', handleImportAllData);
        
        // Data tab
        elements.primaryKeySelect()?.addEventListener('change', handlePrimaryKeyChange);
        elements.clearDataBtn()?.addEventListener('click', handleClearData);
        
        // Auth buttons
        elements.loginButton()?.addEventListener('click', () => {
            elements.loginModal()?.classList.remove('hidden');
        });
        
        elements.registerButton()?.addEventListener('click', () => {
            elements.registerModal()?.classList.remove('hidden');
        });
        
        elements.logoutButton()?.addEventListener('click', handleLogout);
        
        // Auth forms
        document.getElementById('loginForm')?.addEventListener('submit', handleLogin);
        document.getElementById('registerForm')?.addEventListener('submit', handleRegister);
    }
    
    // Initialize auth
    function initAuth() {
        if (typeof AuthManager !== 'undefined') {
            authManager = new AuthManager(`${APP_NAME}_${ENVIRONMENT}`);
            authManager.onStateChange = updateAuthUI;
            updateAuthUI();
        } else {
            // No auth, show logged out state
            elements.userStatus().textContent = 'Local Mode';
            elements.loginButton().style.display = 'none';
            elements.registerButton().style.display = 'none';
        }
    }
    
    // Update auth UI
    function updateAuthUI() {
        if (!authManager) return;
        
        const user = authManager.getUser();
        if (user) {
            elements.userStatus().textContent = `Logged in as ${user.username}`;
            elements.userStatus().style.color = '#22c55e';
            elements.loginButton().style.display = 'none';
            elements.registerButton().style.display = 'none';
            elements.logoutButton().style.display = 'inline-block';
        } else {
            elements.userStatus().textContent = 'Not logged in';
            elements.userStatus().style.color = '#ef4444';
            elements.loginButton().style.display = 'inline-block';
            elements.registerButton().style.display = 'inline-block';
            elements.logoutButton().style.display = 'none';
        }
    }
    
    // Auth handlers
    async function handleLogin(e) {
        e.preventDefault();
        if (!authManager) return;
        
        const username = document.getElementById('loginUsername').value;
        const password = document.getElementById('loginPassword').value;
        const errorEl = document.getElementById('loginError');
        
        try {
            await authManager.login(username, password);
            elements.loginModal()?.classList.add('hidden');
            errorEl.textContent = '';
        } catch (err) {
            errorEl.textContent = err.message || 'Login failed';
        }
    }
    
    async function handleRegister(e) {
        e.preventDefault();
        if (!authManager) return;
        
        const username = document.getElementById('registerUsername').value;
        const password = document.getElementById('registerPassword').value;
        const confirm = document.getElementById('registerConfirmPassword').value;
        const errorEl = document.getElementById('registerError');
        
        if (password !== confirm) {
            errorEl.textContent = 'Passwords do not match';
            return;
        }
        
        try {
            await authManager.register(username, password);
            elements.registerModal()?.classList.add('hidden');
            errorEl.textContent = '';
        } catch (err) {
            errorEl.textContent = err.message || 'Registration failed';
        }
    }
    
    function handleLogout() {
        if (authManager) {
            authManager.logout();
        }
    }
    
    // Set mode (edit/use)
    function setMode(mode) {
        currentMode = mode;
        
        elements.editModeBtn()?.classList.toggle('active', mode === 'edit');
        elements.useModeBtn()?.classList.toggle('active', mode === 'use');
        
        if (mode === 'edit') {
            elements.editorTabs()?.classList.remove('hidden');
            elements.editorContent()?.classList.remove('hidden');
            elements.useModeView()?.classList.add('hidden');
        } else {
            elements.editorTabs()?.classList.add('hidden');
            elements.editorContent()?.classList.add('hidden');
            elements.useModeView()?.classList.remove('hidden');
            renderUseMode();
        }
    }
    
    // Switch editor tab
    function switchTab(tabName) {
        elements.tabBtns().forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });
        
        elements.tabPanels().forEach(panel => {
            panel.classList.toggle('active', panel.id === `tab-${tabName}`);
            panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`);
        });
        
        // Notify other modules that tab changed (for refreshing variable picker, etc.)
        document.dispatchEvent(new CustomEvent('tabChanged', { detail: { tab: tabName } }));
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        
        // Update data tab
        updateDataTab(template);
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        // Clear data tab
        elements.primaryKeySelect().innerHTML = '<option value="">-- Select Primary Key --</option>';
        elements.mergeRulesList().innerHTML = '<p class="empty-message">Add fields first to configure merge rules.</p>';
        elements.dataEntriesList().innerHTML = '<p class="empty-message">No data entries yet.</p>';
    }
    
    // Update data tab
    function updateDataTab(template) {
        const fields = template.parser?.fields || [];
        const mergeConfig = template.mergeConfig || { primaryKey: '', rules: [] };
        
        // Primary key select
        const select = elements.primaryKeySelect();
        select.innerHTML = '<option value="">-- Select Primary Key --</option>';
        fields.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = `${f.label} (${f.id})`;
            if (f.id === mergeConfig.primaryKey) option.selected = true;
            select.appendChild(option);
        });
        
        // Merge rules
        const rulesContainer = elements.mergeRulesList();
        if (fields.length === 0) {
            rulesContainer.innerHTML = '<p class="empty-message">Add fields first to configure merge rules.</p>';
        } else {
            rulesContainer.innerHTML = fields.map(f => {
                const rule = mergeConfig.rules.find(r => r.field === f.id);
                const action = rule?.action || 'replace';
                
                return `
                    <div class="merge-rule-item">
                        <span class="merge-rule-field">{${f.id}}</span>
                        <div class="merge-rule-action">
                            <select data-field="${f.id}">
                                <option value="replace" ${action === 'replace' ? 'selected' : ''}>Replace</option>
                                <option value="keep" ${action === 'keep' ? 'selected' : ''}>Keep Original</option>
                                <option value="merge-arrays" ${action === 'merge-arrays' ? 'selected' : ''}>Merge Arrays</option>
                                <option value="append" ${action === 'append' ? 'selected' : ''}>Append</option>
                            </select>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Bind change events
            rulesContainer.querySelectorAll('select').forEach(sel => {
                sel.addEventListener('change', (e) => {
                    handleMergeRuleChange(e.target.dataset.field, e.target.value);
                });
            });
        }
        
        // Data entries
        updateDataEntries(template);
    }
    
    // Update data entries list
    function updateDataEntries(template) {
        const templateId = TemplateManager.getCurrentTemplateId();
        if (!templateId) return;
        
        const data = DataStore.getTemplateData(templateId);
        const entries = data.entries || [];
        const primaryKey = template.mergeConfig?.primaryKey;
        
        const container = elements.dataEntriesList();
        if (entries.length === 0) {
            container.innerHTML = '<p class="empty-message">No data entries yet. Use the template to import data.</p>';
        } else {
            container.innerHTML = entries.map(entry => {
                const keyValue = primaryKey ? entry[primaryKey] : entry._id;
                const preview = Object.entries(entry)
                    .filter(([k]) => k !== '_id' && k !== primaryKey)
                    .slice(0, 3)
                    .map(([k, v]) => `${k}: ${String(v).substring(0, 20)}`)
                    .join(', ');
                
                return `
                    <div class="data-entry-item" data-entry-id="${entry._id}">
                        <div>
                            <div class="data-entry-key">${escapeHtml(keyValue)}</div>
                            <div class="data-entry-preview">${escapeHtml(preview)}</div>
                        </div>
                        <div class="data-entry-actions">
                            <button class="btn btn-sm btn-secondary entry-edit" title="Edit">✏️</button>
                            <button class="btn btn-sm btn-danger entry-delete" title="Delete">🗑️</button>
                        </div>
                    </div>
                `;
            }).join('');
            
            // Bind events
            container.querySelectorAll('.entry-delete').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const id = e.target.closest('.data-entry-item').dataset.entryId;
                    if (confirm('Delete this entry?')) {
                        DataStore.deleteEntry(templateId, id);
                        updateDataEntries(template);
                    }
                });
            });
        }
    }
    
    // Handle primary key change
    function handlePrimaryKeyChange(e) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        template.mergeConfig.primaryKey = e.target.value;
        TemplateManager.saveCurrentTemplate();
    }
    
    // Handle merge rule change
    function handleMergeRuleChange(field, action) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const rules = template.mergeConfig.rules || [];
        const existing = rules.find(r => r.field === field);
        
        if (existing) {
            existing.action = action;
        } else {
            rules.push({ field, action });
        }
        
        template.mergeConfig.rules = rules;
        TemplateManager.saveCurrentTemplate();
    }
    
    // Handle clear data
    function handleClearData() {
        const templateId = TemplateManager.getCurrentTemplateId();
        if (!templateId) return;
        
        if (confirm('Clear all data for this template? This cannot be undone.')) {
            DataStore.clearTemplateData(templateId);
            updateDataEntries(TemplateManager.getCurrentTemplate());
        }
    }
    
    // Handle module value change (in use mode)
    function handleModuleValueChange(e) {
        const { field, value } = e.detail;
        if (!field) return;
        
        // Update context and re-render output
        OutputEngine.updatePreview();
    }
    
    // Render use mode
    function renderUseMode() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const layout = LayoutManager.getLayoutForUseMode(template);
        const container = elements.useLayout();
        if (!container) return;
        
        container.className = `use-layout ${layout.columns === 3 ? 'three-columns' : 'two-columns'}`;
        
        // Get current data context
        const templateId = TemplateManager.getCurrentTemplateId();
        const data = templateId ? DataStore.getTemplateData(templateId) : { entries: [] };
        const context = data.entries.length > 0 ? data.entries[0] : {};
        
        // Render zones
        let html = '';
        
        ['left', 'center', 'right'].forEach(zoneName => {
            if (zoneName === 'center' && layout.columns === 2) return;
            
            const modules = layout.zones[zoneName] || [];
            html += `<div class="use-zone" data-zone="${zoneName}"></div>`;
        });
        
        container.innerHTML = html;
        
        // Render modules into zones
        ['left', 'center', 'right'].forEach(zoneName => {
            if (zoneName === 'center' && layout.columns === 2) return;
            
            const zoneEl = container.querySelector(`[data-zone="${zoneName}"]`);
            const modules = layout.zones[zoneName] || [];
            ModuleSystem.renderForUseMode(modules, zoneEl, context);
        });
    }
    
    // Export all data
    function handleExportAllData() {
        const data = DataStore.exportAll();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `template_builder_backup_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
        
        elements.syncStatus().textContent = 'Data exported successfully!';
        elements.syncStatus().className = 'sync-status success';
    }
    
    // Import all data
    function handleImportAllData(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                const count = DataStore.importAll(data);
                
                elements.syncStatus().textContent = `Imported ${count} template(s) successfully!`;
                elements.syncStatus().className = 'sync-status success';
                
                TemplateManager.refreshTemplateList();
            } catch (err) {
                elements.syncStatus().textContent = 'Import failed: ' + err.message;
                elements.syncStatus().className = 'sync-status error';
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }
    
    // Utility
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    // Start app when DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
    
    return {
        setMode,
        switchTab
    };
})();
