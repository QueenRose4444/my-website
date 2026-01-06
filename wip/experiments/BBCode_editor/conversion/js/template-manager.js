/**
 * Template Manager - Handles template CRUD operations and UI
 */
const TemplateManager = (function() {
    let currentTemplateId = null;
    let currentTemplate = null;
    
    // DOM Elements
    const elements = {
        selector: () => document.getElementById('template-selector'),
        newBtn: () => document.getElementById('new-template-btn'),
        importBtn: () => document.getElementById('import-template-btn'),
        exportBtn: () => document.getElementById('export-template-btn'),
        renameBtn: () => document.getElementById('rename-template-btn'),
        deleteBtn: () => document.getElementById('delete-template-btn'),
        emptyNewBtn: () => document.getElementById('empty-new-btn'),
        emptyImportBtn: () => document.getElementById('empty-import-btn'),
        templateModal: () => document.getElementById('template-modal'),
        templateForm: () => document.getElementById('template-form'),
        templateModalTitle: () => document.getElementById('template-modal-title'),
        templateNameInput: () => document.getElementById('template-name-input'),
        fileInput: () => document.getElementById('template-file-input'),
        noTemplateView: () => document.getElementById('no-template-view'),
        editorTabs: () => document.getElementById('editor-tabs'),
        editorContent: () => document.getElementById('editor-content'),
        confirmModal: () => document.getElementById('confirm-modal'),
        confirmMessage: () => document.getElementById('confirm-message'),
        confirmYes: () => document.getElementById('confirm-yes'),
        confirmNo: () => document.getElementById('confirm-no')
    };
    
    let modalMode = 'new'; // 'new' or 'rename'
    let confirmCallback = null;
    
    // Initialize
    function init() {
        bindEvents();
        refreshTemplateList();
    }
    
    // Bind event listeners
    function bindEvents() {
        // Template selector
        elements.selector()?.addEventListener('change', handleTemplateChange);
        
        // New template buttons
        elements.newBtn()?.addEventListener('click', () => openTemplateModal('new'));
        elements.emptyNewBtn()?.addEventListener('click', () => openTemplateModal('new'));
        
        // Import buttons
        elements.importBtn()?.addEventListener('click', triggerImport);
        elements.emptyImportBtn()?.addEventListener('click', triggerImport);
        elements.fileInput()?.addEventListener('change', handleImport);
        
        // Export button
        elements.exportBtn()?.addEventListener('click', handleExport);
        
        // Rename button
        elements.renameBtn()?.addEventListener('click', () => openTemplateModal('rename'));
        
        // Delete button
        elements.deleteBtn()?.addEventListener('click', handleDelete);
        
        // Template modal
        elements.templateForm()?.addEventListener('submit', handleTemplateFormSubmit);
        
        // Modal close buttons
        document.querySelectorAll('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', closeAllModals);
        });
        
        // Confirm modal
        elements.confirmYes()?.addEventListener('click', () => {
            if (confirmCallback) confirmCallback();
            closeAllModals();
        });
        elements.confirmNo()?.addEventListener('click', closeAllModals);
        
        // Close modals on outside click
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeAllModals();
            });
        });
    }
    
    // Refresh template dropdown
    function refreshTemplateList(autoSelectFirst = true) {
        const selector = elements.selector();
        if (!selector) return;
        
        const templates = DataStore.getTemplates();
        const selectedId = currentTemplateId;
        
        selector.innerHTML = templates.length === 0 
            ? '<option value="">-- No Templates --</option>'
            : '<option value="">-- Select Template --</option>';
        
        templates.forEach(t => {
            const option = document.createElement('option');
            option.value = t.id;
            option.textContent = t.name;
            if (t.id === selectedId) option.selected = true;
            selector.appendChild(option);
        });
        
        updateUIState();
        
        // Auto-select first template if none currently loaded and templates exist
        if (autoSelectFirst && !currentTemplateId && templates.length > 0) {
            // Check localStorage for last used template
            const lastUsedId = localStorage.getItem('templateBuilder_lastTemplateId');
            const templateToLoad = lastUsedId && templates.find(t => t.id === lastUsedId)
                ? lastUsedId 
                : templates[0].id;
            
            selector.value = templateToLoad;
            loadTemplate(templateToLoad);
        }
    }
    
    // Handle template selection change
    function handleTemplateChange(e) {
        const templateId = e.target.value;
        if (templateId) {
            loadTemplate(templateId);
        } else {
            unloadTemplate();
        }
    }
    
    // Load a template
    function loadTemplate(templateId) {
        const template = DataStore.getTemplate(templateId);
        if (template) {
            currentTemplateId = templateId;
            currentTemplate = template;
            
            // Remember last used template
            localStorage.setItem('templateBuilder_lastTemplateId', templateId);
            
            updateUIState();
            
            // Dispatch event for other modules
            document.dispatchEvent(new CustomEvent('templateLoaded', { 
                detail: { template, templateId } 
            }));
        }
    }
    
    // Unload current template
    function unloadTemplate() {
        currentTemplateId = null;
        currentTemplate = null;
        updateUIState();
        
        document.dispatchEvent(new CustomEvent('templateUnloaded'));
    }
    
    // Update UI based on current state
    function updateUIState() {
        const hasTemplate = currentTemplateId !== null;
        
        // Toggle buttons
        elements.exportBtn().disabled = !hasTemplate;
        elements.renameBtn().disabled = !hasTemplate;
        elements.deleteBtn().disabled = !hasTemplate;
        
        // Check if currently in Use mode (don't override if user is on Use page)
        const useModeView = document.getElementById('use-mode-view');
        const isInUseMode = useModeView && !useModeView.classList.contains('hidden');
        
        // Toggle views - only change if NOT in Use mode
        if (hasTemplate) {
            elements.noTemplateView()?.classList.add('hidden');
            // Only show editor tabs if not in use mode
            if (!isInUseMode) {
                elements.editorTabs()?.classList.remove('hidden');
                elements.editorContent()?.classList.remove('hidden');
            }
        } else {
            elements.noTemplateView()?.classList.remove('hidden');
            elements.editorTabs()?.classList.add('hidden');
            elements.editorContent()?.classList.add('hidden');
        }
    }
    
    // Open template modal
    function openTemplateModal(mode) {
        modalMode = mode;
        const modal = elements.templateModal();
        const title = elements.templateModalTitle();
        const input = elements.templateNameInput();
        
        if (mode === 'rename' && currentTemplate) {
            title.textContent = 'Rename Template';
            input.value = currentTemplate.name;
        } else {
            title.textContent = 'New Template';
            input.value = '';
        }
        
        modal?.classList.remove('hidden');
        input?.focus();
    }
    
    // Handle template form submit
    function handleTemplateFormSubmit(e) {
        e.preventDefault();
        const name = elements.templateNameInput()?.value.trim();
        
        if (!name) return;
        
        if (modalMode === 'rename' && currentTemplateId) {
            if (DataStore.renameTemplate(currentTemplateId, name)) {
                currentTemplate.name = name;
                refreshTemplateList();
            }
        } else {
            const template = DataStore.createTemplate(name);
            if (template) {
                refreshTemplateList();
                loadTemplate(template.id);
                elements.selector().value = template.id;
            }
        }
        
        closeAllModals();
    }
    
    // Trigger file import
    function triggerImport() {
        elements.fileInput()?.click();
    }
    
    // Handle file import
    function handleImport(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                const template = DataStore.importTemplate(data);
                refreshTemplateList();
                loadTemplate(template.id);
                elements.selector().value = template.id;
            } catch (err) {
                console.error('Import error:', err);
                alert('Failed to import template: ' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = ''; // Reset for re-import
    }
    
    // Handle export
    function handleExport() {
        if (!currentTemplateId) return;
        
        const data = DataStore.exportTemplate(currentTemplateId);
        if (!data) return;
        
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${currentTemplate.name.replace(/[^a-z0-9]/gi, '_')}_template.json`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // Handle delete with confirmation
    function handleDelete() {
        if (!currentTemplateId) return;
        
        showConfirm(
            `Are you sure you want to delete "${currentTemplate.name}"? This cannot be undone.`,
            () => {
                if (DataStore.deleteTemplate(currentTemplateId)) {
                    unloadTemplate();
                    refreshTemplateList();
                }
            }
        );
    }
    
    // Show confirmation dialog
    function showConfirm(message, callback) {
        elements.confirmMessage().textContent = message;
        confirmCallback = callback;
        elements.confirmModal()?.classList.remove('hidden');
    }
    
    // Close all modals
    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
        confirmCallback = null;
    }
    
    // Get current template
    function getCurrentTemplate() {
        return currentTemplate;
    }
    
    // Get current template ID
    function getCurrentTemplateId() {
        return currentTemplateId;
    }
    
    // Save current template
    function saveCurrentTemplate() {
        if (currentTemplate && currentTemplateId) {
            return DataStore.saveTemplate(currentTemplate);
        }
        return false;
    }
    
    // Update template field
    function updateTemplate(path, value) {
        if (!currentTemplate) return false;
        
        // Handle nested paths like 'parser.sampleText'
        const parts = path.split('.');
        let obj = currentTemplate;
        for (let i = 0; i < parts.length - 1; i++) {
            obj = obj[parts[i]];
            if (!obj) return false;
        }
        obj[parts[parts.length - 1]] = value;
        
        return saveCurrentTemplate();
    }
    
    return {
        init,
        refreshTemplateList,
        loadTemplate,
        unloadTemplate,
        getCurrentTemplate,
        getCurrentTemplateId,
        saveCurrentTemplate,
        updateTemplate
    };
})();
