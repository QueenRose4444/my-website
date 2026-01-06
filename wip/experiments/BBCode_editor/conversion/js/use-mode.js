/**
 * Use Mode - Handles the actual template usage for data input and output
 */
const UseMode = (function() {
    
    // DOM Elements
    const elements = {
        // Mode toggle
        editModeBtn: () => document.getElementById('edit-mode-btn'),
        useModeBtn: () => document.getElementById('use-mode-btn'),
        editorTabs: () => document.getElementById('editor-tabs'),
        editorContent: () => document.getElementById('editor-content'),
        useModeView: () => document.getElementById('use-mode-view'),
        
        // Data selector
        dataEntrySelector: () => document.getElementById('data-entry-selector'),
        newDataEntryBtn: () => document.getElementById('new-data-entry-btn'),
        
        // Input
        fileDropZone: () => document.getElementById('use-file-drop-zone'),
        fileInput: () => document.getElementById('use-file-input'),
        textInput: () => document.getElementById('use-text-input'),
        processInputBtn: () => document.getElementById('process-input-btn'),
        
        // Modules
        modulesContainer: () => document.getElementById('use-modules-container'),
        
        // Output
        previewTab: () => document.getElementById('preview-tab'),
        codeTab: () => document.getElementById('code-tab'),
        outputPreview: () => document.getElementById('use-output-preview'),
        outputCode: () => document.getElementById('use-output-code'),
        copyBBCodeBtn: () => document.getElementById('copy-bbcode-btn'),
        downloadBBCodeBtn: () => document.getElementById('download-bbcode-btn'),
        // Batch
        batchModeHighlight: () => document.getElementById('batch-mode-indicator')
    };
    
    let isUseMode = false;
    let currentData = {}; // Current data entry values
    
    // Initialize
    function init() {
        bindEvents();
        
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
    }
    
    // Bind events
    function bindEvents() {
        // Mode toggle
        elements.editModeBtn()?.addEventListener('click', () => switchMode(false));
        elements.useModeBtn()?.addEventListener('click', () => switchMode(true));
        
        // File drop
        const dropZone = elements.fileDropZone();
        if (dropZone) {
            dropZone.addEventListener('click', () => elements.fileInput()?.click());
            dropZone.addEventListener('dragover', handleDragOver);
            dropZone.addEventListener('dragleave', handleDragLeave);
            dropZone.addEventListener('drop', handleFileDrop);
        }
        
        elements.fileInput()?.addEventListener('change', handleFileSelect);
        
        // Process input
        elements.processInputBtn()?.addEventListener('click', processInput);
        
        // Data selector
        elements.dataEntrySelector()?.addEventListener('change', handleDataEntryChange);
        elements.newDataEntryBtn()?.addEventListener('click', createNewDataEntry);
        
        // Output tabs
        elements.previewTab()?.addEventListener('click', () => showOutputTab('preview'));
        elements.codeTab()?.addEventListener('click', () => showOutputTab('code'));
        
        // Copy/Download
        elements.copyBBCodeBtn()?.addEventListener('click', copyBBCode);
        elements.downloadBBCodeBtn()?.addEventListener('click', downloadBBCode);
        
        // Import Raw Data Modal
        document.getElementById('import-raw-btn')?.addEventListener('click', openImportModal);
        document.getElementById('do-import-btn')?.addEventListener('click', handleImportSubmit);
        
        // Import modal file drop zone
        const importDropZone = document.getElementById('import-file-drop-zone');
        if (importDropZone) {
            importDropZone.addEventListener('click', () => document.getElementById('import-modal-file-input')?.click());
            importDropZone.addEventListener('dragover', handleDragOver);
            importDropZone.addEventListener('dragleave', handleDragLeave);
            importDropZone.addEventListener('drop', handleImportFileDrop);
        }
        document.getElementById('import-modal-file-input')?.addEventListener('change', handleImportFileSelect);
    }
    
    // Switch between Edit and Use mode
    function switchMode(useMode) {
        isUseMode = useMode;
        
        // Update buttons
        elements.editModeBtn()?.classList.toggle('active', !useMode);
        elements.useModeBtn()?.classList.toggle('active', useMode);
        
        // Toggle views
        elements.editorTabs()?.classList.toggle('hidden', useMode);
        elements.editorContent()?.classList.toggle('hidden', useMode);
        elements.useModeView()?.classList.toggle('hidden', !useMode);
        
        if (useMode) {
            renderUseMode();
        }
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        loadDataEntriesForTemplate(template);
        if (isUseMode) {
            renderUseMode();
        }
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        currentData = {};
        clearDataSelector();
        if (isUseMode) {
            switchMode(false);
        }
    }
    
    // Load data entries for template
    function loadDataEntriesForTemplate(template) {
        const selector = elements.dataEntrySelector();
        if (!selector) return;
        
        const entries = DataStore.getDataEntries(template.id) || [];
        const primaryKey = template.dataConfig?.primaryKey || 'id';
        
        selector.innerHTML = '<option value="">-- Create New --</option>';
        entries.forEach(entry => {
            const option = document.createElement('option');
            option.value = entry.id;
            option.textContent = entry[primaryKey] || entry.id;
            selector.appendChild(option);
        });
    }
    
    // Handle data entry selection change
    function handleDataEntryChange(e) {
        const entryId = e.target.value;
        if (entryId) {
            loadDataEntry(entryId);
        } else {
            currentData = {};
            renderModules();
            updateOutput();
        }
    }
    
    // Load specific data entry
    function loadDataEntry(entryId) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const entry = DataStore.getDataEntry(template.id, entryId);
        if (entry) {
            currentData = { ...entry };
            renderModules();
            updateOutput();
        }
    }
    
    // Create new data entry
    function createNewDataEntry() {
        currentData = {};
        elements.dataEntrySelector().value = '';
        renderModules();
        updateOutput();
    }
    
    // Clear data selector
    function clearDataSelector() {
        const selector = elements.dataEntrySelector();
        if (selector) {
            selector.innerHTML = '<option value="">-- No Data --</option>';
        }
    }
    
    // Drag handlers for file drop
    function handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }
    
    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }
    
    function handleFileDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.txt'));
        if (files.length > 0) {
            processFiles(files);
        }
    }
    
    function handleFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            processFiles(files);
        }
    }
    
    // Process uploaded files - combines all files before parsing
    function processFiles(files) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        let combinedText = '';
        let filesRead = 0;
        const totalFiles = files.length;
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                combinedText += e.target.result + '\n\n';
                filesRead++;
                
                // Process after all files are read
                if (filesRead === totalFiles) {
                    parseAndMergeMultipleEntries(combinedText);
                }
            };
            reader.readAsText(file);
        });
    }
    
    // Process pasted/typed input
    function processInput() {
        const text = elements.textInput()?.value;
        if (text && text.trim()) {
            parseAndMergeMultipleEntries(text);
            elements.textInput().value = '';
        }
    }
    
    // Parse input using template's parser (single entry - legacy)
    function parseAndMergeInput(text) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template || !template.parser) return;
        
        const parsed = ParserEngine.parseInput(text, template);
        
        if (parsed) {
            Object.assign(currentData, parsed);
            saveCurrentDataEntry();
            renderModules();
            updateOutput();
        }
    }
    
    /**
     * MULTI-ENTRY PARSING
     * Parses text with multiple game/platform entries, groups by primary key
     */
    function parseAndMergeMultipleEntries(text) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template || !template.parser) {
            console.log('parseAndMergeMultipleEntries: No template or parser');
            return;
        }
        
        // Use new multi-entry parser
        const entries = ParserEngine.parseMultipleEntries(text, template);
        
        if (!entries || entries.length === 0) {
            console.log('parseAndMergeMultipleEntries: No entries parsed');
            showImportStatus('No entries could be parsed. Check your parser configuration.', 'error');
            return;
        }
        
        console.log(`parseAndMergeMultipleEntries: Parsed ${entries.length} entries`, entries);
        
        // Save each entry to data store
        entries.forEach(entry => {
            // Merge with existing entry if it exists
            const existingEntry = DataStore.getDataEntry(template.id, entry.id);
            if (existingEntry) {
                // Merge platforms (update existing, add new)
                const mergedEntry = mergeEntryPlatforms(existingEntry, entry);
                DataStore.saveDataEntry(template.id, mergedEntry);
            } else {
                DataStore.saveDataEntry(template.id, entry);
            }
        });
        
        // Refresh dropdown
        loadDataEntriesForTemplate(template);
        
        // Select first imported entry
        if (entries.length > 0) {
            loadDataEntry(entries[0].id);
            elements.dataEntrySelector().value = entries[0].id;
        }
        
        // Show success
        const platformCount = entries.reduce((sum, e) => sum + (e.platforms?.length || 1), 0);
        showImportStatus(`Imported ${entries.length} game(s) with ${platformCount} platform(s) total.`, 'success');
        
        // Close import modal if open
        closeImportModal();
    }
    
    /**
     * Merge platforms from new entry into existing entry
     */
    function mergeEntryPlatforms(existing, incoming) {
        const merged = { ...existing };
        
        if (!merged.platforms) merged.platforms = [];
        if (!incoming.platforms) return merged;
        
        incoming.platforms.forEach(newPlatform => {
            const existingIdx = merged.platforms.findIndex(p => 
                p.platform === newPlatform.platform && p.branch === newPlatform.branch
            );
            
            if (existingIdx !== -1) {
                // Update existing platform
                merged.platforms[existingIdx] = {
                    ...merged.platforms[existingIdx],
                    ...newPlatform
                };
            } else {
                // Add new platform
                merged.platforms.push(newPlatform);
            }
        });
        
        // Sort platforms: Win > Linux > Mac
        merged.platforms.sort((a, b) => {
            const order = { 'Win': 0, 'Linux': 1, 'Mac': 2 };
            const getOrder = (p) => {
                if (!p.platform) return 99;
                if (p.platform.includes('Win')) return order.Win;
                if (p.platform.includes('Linux')) return order.Linux;
                if (p.platform.includes('Mac')) return order.Mac;
                return 99;
            };
            return getOrder(a) - getOrder(b);
        });
        
        return merged;
    }
    
    // Save current data entry
    function saveCurrentDataEntry() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const primaryKey = template.dataConfig?.primaryKey;
        if (primaryKey && currentData[primaryKey]) {
            DataStore.saveDataEntry(template.id, currentData);
            loadDataEntriesForTemplate(template);
        }
    }
    
    // ======== IMPORT MODAL FUNCTIONS ========
    
    function openImportModal() {
        const modal = document.getElementById('import-raw-modal');
        if (modal) {
            modal.classList.remove('hidden');
            document.getElementById('import-raw-textarea').value = '';
            document.getElementById('import-status').innerHTML = '';
        }
    }
    
    function closeImportModal() {
        const modal = document.getElementById('import-raw-modal');
        if (modal) {
            modal.classList.add('hidden');
        }
    }
    
    function handleImportFileDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        const files = Array.from(e.dataTransfer.files).filter(f => f.name.endsWith('.txt'));
        if (files.length > 0) {
            processImportFiles(files);
        }
    }
    
    function handleImportFileSelect(e) {
        const files = Array.from(e.target.files);
        if (files.length > 0) {
            processImportFiles(files);
        }
    }
    
    function processImportFiles(files) {
        let combinedText = '';
        let filesRead = 0;
        const totalFiles = files.length;
        
        showImportStatus(`Reading ${totalFiles} file(s)...`, 'info');
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                combinedText += e.target.result + '\n\n';
                filesRead++;
                
                if (filesRead === totalFiles) {
                    // Put combined text in textarea for preview
                    document.getElementById('import-raw-textarea').value = combinedText;
                    showImportStatus(`Read ${totalFiles} file(s). Click "Import & Parse" to process.`, 'success');
                }
            };
            reader.readAsText(file);
        });
    }
    
    function handleImportSubmit() {
        const text = document.getElementById('import-raw-textarea')?.value;
        if (!text || !text.trim()) {
            showImportStatus('Please paste or drop some data first.', 'error');
            return;
        }
        
        parseAndMergeMultipleEntries(text);
    }
    
    function showImportStatus(message, type = 'info') {
        const statusEl = document.getElementById('import-status');
        if (statusEl) {
            statusEl.className = `import-status ${type}`;
            statusEl.innerHTML = message;
        }
    }
    
    // Render use mode
    function renderUseMode() {
        renderModules();
        updateOutput();
    }
    
    // Render modules based on template
    function renderModules() {
        // Try to find the container
        let container = elements.modulesContainer();
        
        if (!container) {
            // Check for use-layout panels
            const useLayout = document.getElementById('use-layout');
            if (useLayout) {
                // Find or create the modules container in the left column
                const leftColumn = useLayout.querySelector('.use-column.use-inputs') || useLayout.querySelector('[data-zone="left"]');
                if (leftColumn) {
                    container = leftColumn.querySelector('#use-modules-container');
                    if (!container) {
                        container = document.createElement('div');
                        container.id = 'use-modules-container';
                        leftColumn.appendChild(container);
                    }
                }
            }
        }
        
        if (!container) {
            console.log('UseMode: No container found for modules');
            return;
        }
        
        const template = TemplateManager.getCurrentTemplate();
        if (!template) {
            container.innerHTML = '<p class="empty-message">No template loaded.</p>';
            return;
        }
        
        // Get modules from template or auto-generate
        let inputModules = template.modules?.filter(m => m.zone === 'left' || !m.zone) || [];
        
        if (inputModules.length === 0) {
            inputModules = generateAutoModules(template);
        }
        
        if (inputModules.length === 0) {
            container.innerHTML = '<p class="empty-message">No input fields defined. Add fields in Parser Setup or modules in Template Designer.</p>';
            return;
        }
        
        // Group modules by section
        const sections = groupModulesIntoSections(inputModules, template);
        
        // Build HTML with collapsible sections
        let html = `
            <div class="collapse-controls">
                <button type="button" onclick="UseMode.expandAllSections()">Expand All</button>
                <span class="separator">|</span>
                <button type="button" onclick="UseMode.collapseAllSections()">Collapse All</button>
            </div>
            <div class="use-modules-sections">
        `;
        
        sections.forEach((section, index) => {
            const isCollapsed = section.collapsed ? ' collapsed' : '';
            html += `
                <div class="collapsible-section${isCollapsed}" data-section="${section.id}">
                    <div class="section-header" onclick="UseMode.toggleSection('${section.id}')">
                        <h3>${escapeHtml(section.title)}</h3>
                        <svg class="chevron-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </div>
                    <div class="section-content">
                        ${section.modules.map(mod => renderModule(mod)).join('')}
                    </div>
                </div>
            `;
        });
        
        html += '</div>';
        container.innerHTML = html;
        
        // Bind input events
        container.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('input', handleModuleInput);
            input.addEventListener('change', handleModuleInput);
        });
        
        // Note: Clone group add/remove buttons use onclick handlers in the HTML
        // to avoid double-binding and duplicate add issues.
    }
    
    // Group modules into logical sections
    function groupModulesIntoSections(modules, template) {
        const sections = [];
        
        // Define section order and which module types go in each
        const sectionDefs = [
            { id: 'data-import', title: '1. Add Game Data', types: ['file-drop', 'raw-text-input'], collapsed: false },
            { id: 'main-urls', title: 'Main URLs (SteamDB)', types: [], fieldPatterns: ['cleanUrl', 'crackedUrl', 'mainGroup'], collapsed: false },
            { id: 'custom-groups', title: 'Additional URL Groups', types: ['clone-group'], fieldPatterns: ['customGroups', 'urlGroups'], collapsed: false },
            { id: 'crack-settings', title: 'Crack Settings', types: ['toggle', 'dropdown'], fieldPatterns: ['includeCracked', 'crackType'], collapsed: false },
            { id: 'file-sizes', title: 'File Sizes', types: [], fieldPatterns: ['FileSize', 'fileSize', 'Size'], collapsed: false },
            { id: 'updates', title: 'Update Files', types: ['clone-group'], fieldPatterns: ['updates', 'update'], collapsed: false },
            { id: 'patch-notes', title: 'Patch Notes', types: [], fieldPatterns: ['patchNote', 'PatchNote'], collapsed: false },
            { id: 'colors', title: 'Colors', types: ['color-picker'], collapsed: false },
            { id: 'settings', title: 'Other Settings', types: [], collapsed: false }
        ];
        
        // Track which modules have been assigned
        const assigned = new Set();
        
        // Assign modules to sections based on rules
        sectionDefs.forEach(def => {
            const sectionModules = [];
            
            modules.forEach(mod => {
                if (assigned.has(mod.id)) return;
                
                // Check by type
                if (def.types.includes(mod.type)) {
                    sectionModules.push(mod);
                    assigned.add(mod.id);
                    return;
                }
                
                // Check by field pattern
                if (def.fieldPatterns) {
                    const fieldName = mod.linkedField || mod.id;
                    for (const pattern of def.fieldPatterns) {
                        if (fieldName.toLowerCase().includes(pattern.toLowerCase())) {
                            sectionModules.push(mod);
                            assigned.add(mod.id);
                            return;
                        }
                    }
                }
            });
            
            if (sectionModules.length > 0) {
                sections.push({
                    id: def.id,
                    title: def.title,
                    modules: sectionModules,
                    collapsed: def.collapsed
                });
            }
        });
        
        // Put remaining modules in "Other Settings"
        const remaining = modules.filter(m => !assigned.has(m.id));
        if (remaining.length > 0) {
            // Find or create the settings section
            let settingsSection = sections.find(s => s.id === 'settings');
            if (settingsSection) {
                settingsSection.modules.push(...remaining);
            } else {
                sections.push({
                    id: 'settings',
                    title: 'Other Settings',
                    modules: remaining,
                    collapsed: false
                });
            }
        }
        
        return sections.filter(s => s.modules.length > 0);
    }
    
    // Toggle section collapse state
    function toggleSection(sectionId) {
        const section = document.querySelector(`.collapsible-section[data-section="${sectionId}"]`);
        if (section) {
            section.classList.toggle('collapsed');
        }
    }
    
    // Expand all sections
    function expandAllSections() {
        document.querySelectorAll('.collapsible-section').forEach(s => s.classList.remove('collapsed'));
    }
    
    // Collapse all sections
    function collapseAllSections() {
        document.querySelectorAll('.collapsible-section').forEach(s => s.classList.add('collapsed'));
    }
    
    // Auto-generate modules from parser fields and output template variables
    function generateAutoModules(template) {
        const modules = [];
        const existingFields = new Set();
        
        // Try multiple sources for parser fields (most specific to most general)
        let parserFields = [];
        
        // 1. Try ParserEngine.getActiveVariant if available
        try {
            const activeVariant = ParserEngine.getActiveVariant(template);
            if (activeVariant?.fields?.length > 0) {
                parserFields = activeVariant.fields;
            }
        } catch (e) {
            console.log('UseMode: getActiveVariant failed', e);
        }
        
        // 2. Fallback: Get from first variant
        if (parserFields.length === 0 && template?.parser?.variants?.length > 0) {
            const firstVariant = template.parser.variants[0];
            if (firstVariant?.fields?.length > 0) {
                parserFields = firstVariant.fields;
            }
        }
        
        // 3. Fallback: Legacy parser.fields
        if (parserFields.length === 0 && template?.parser?.fields?.length > 0) {
            parserFields = template.parser.fields;
        }
        
        console.log('UseMode: Found parser fields:', parserFields.length, parserFields);
        
        // Add modules for each parser field
        parserFields.forEach(field => {
            if (existingFields.has(field.id)) return;
            existingFields.add(field.id);
            
            // Determine type based on field name
            let type = 'text-input';
            if (field.id.toLowerCase().includes('url')) {
                type = 'url-input';
            } else if (field.id.toLowerCase().includes('color')) {
                type = 'color-picker';
            }
            
            modules.push({
                id: `auto_${field.id}`,
                type: type,
                label: field.label || prettifyFieldName(field.id),
                linkedField: field.id,
                defaultValue: '',
                isAuto: true
            });
        });
        
        // Also extract variables from output template that aren't in parser fields
        const outputTemplate = template.output?.template || '';
        const variableMatches = outputTemplate.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
        
        for (const match of variableMatches) {
            const varName = match[1];
            if (existingFields.has(varName)) continue;
            existingFields.add(varName);
            
            // Determine type based on name
            let type = 'text-input';
            if (varName.toLowerCase().includes('url')) {
                type = 'url-input';
            } else if (varName.toLowerCase().includes('color')) {
                type = 'color-picker';
            }
            
            modules.push({
                id: `auto_${varName}`,
                type: type,
                label: prettifyFieldName(varName),
                linkedField: varName,
                defaultValue: '',
                isAuto: true
            });
        }
        
        console.log('UseMode: Generated auto-modules:', modules.length, modules);
        return modules;
    }
    
    // Prettify field name (camelCase to Title Case)
    function prettifyFieldName(name) {
        return name
            .replace(/([A-Z])/g, ' $1')
            .replace(/_/g, ' ')
            .replace(/^./, str => str.toUpperCase())
            .trim();
    }
    
    /**
     * Render optional copy button for a module
     * Returns HTML for copy button if module has copyButton option enabled
     */
    function renderCopyButton(mod, currentValue) {
        const copyConfig = mod.options?.copyButton;
        if (!copyConfig?.enabled) return '';
        
        // Preview what will be copied (replace variables with current data)
        let previewText = copyConfig.pattern || '';
        previewText = previewText.replace(/\{([^}]+)\}/g, (match, varName) => {
            const parts = varName.split('.');
            let value = currentData;
            for (const part of parts) {
                if (value === undefined || value === null) break;
                value = value[part];
            }
            return value !== undefined && value !== null ? String(value) : match;
        });
        
        return `
            <div class="copy-button-container">
                <div class="copy-preview" title="Will copy: ${escapeHtml(previewText)}">
                    ${escapeHtml(previewText.length > 50 ? previewText.substring(0, 47) + '...' : previewText)}
                </div>
                <button type="button" class="btn btn-sm copy-pattern-btn" 
                        data-pattern="${escapeHtml(copyConfig.pattern)}"
                        onclick="UseMode.copyFromPattern(this)">
                    ${copyConfig.label || '📋 Copy'}
                </button>
            </div>
        `;
    }
    
    // Render single module
    function renderModule(mod) {
        const value = currentData[mod.linkedField] || mod.defaultValue || '';
        const typeDef = ModuleSystem.MODULE_TYPES[mod.type];
        const copyButtonHtml = renderCopyButton(mod, value);
        
        switch (mod.type) {
            case 'text-input':
            case 'url-input':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="${mod.type === 'url-input' ? 'url' : 'text'}" 
                               data-field="${mod.linkedField}" 
                               value="${escapeHtml(value)}" />
                        ${copyButtonHtml}
                    </div>
                `;
                
            case 'textarea':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <textarea data-field="${mod.linkedField}">${escapeHtml(value)}</textarea>
                    </div>
                `;
                
            case 'color-picker':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="color" data-field="${mod.linkedField}" value="${value || '#00aa00'}" />
                    </div>
                `;
                
            case 'number-input':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="number" data-field="${mod.linkedField}" value="${value}" />
                    </div>
                `;
                
            case 'toggle':
                const checked = value === true || value === 'true';
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <div class="toggle-container">
                            <input type="checkbox" data-field="${mod.linkedField}" ${checked ? 'checked' : ''} />
                        </div>
                    </div>
                `;
                
            case 'dropdown':
                const options = mod.options?.choices || [];
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <select data-field="${mod.linkedField}">
                            ${options.map(opt => `
                                <option value="${escapeHtml(opt)}" ${value === opt ? 'selected' : ''}>
                                    ${escapeHtml(opt)}
                                </option>
                            `).join('')}
                        </select>
                    </div>
                `;
                
            case 'copy-button':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <button class="copy-btn" onclick="UseMode.copyField('${mod.linkedField}')">
                            📋 ${escapeHtml(mod.label)}
                        </button>
                    </div>
                `;
            
            // Image URL with preview
            case 'image-url':
                const imgUrl = value;
                return `
                    <div class="rendered-module image-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="url" 
                               data-field="${mod.linkedField}" 
                               value="${escapeHtml(value)}"
                               placeholder="Enter image URL..." />
                        ${imgUrl ? `
                            <div class="image-preview">
                                <img src="${escapeHtml(imgUrl)}" alt="Preview" onerror="this.style.display='none'" />
                            </div>
                        ` : ''}
                    </div>
                `;
            
            // Static label (read-only boilerplate text)
            case 'static-label':
                return `
                    <div class="rendered-module static-label" data-module-id="${mod.id}">
                        <div class="static-text">${escapeHtml(mod.label)}</div>
                    </div>
                `;
            
            // Clone Group - Dynamic list of items
            case 'clone-group':
            case 'repeater':
                return renderCloneGroup(mod);
            
            // File Drop Zone - for importing raw data files
            case 'file-drop':
                return `
                    <div class="rendered-module file-drop-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <div class="file-drop-zone use-mode-drop" 
                             ondragover="event.preventDefault(); this.classList.add('drag-over');"
                             ondragleave="this.classList.remove('drag-over');"
                             ondrop="UseMode.handleFileDropInModule(event, '${mod.id}');">
                            <p>📂 Drop files here or click to browse</p>
                            <input type="file" multiple 
                                   onchange="UseMode.handleFileSelectInModule(event, '${mod.id}');"
                                   style="display:none;" />
                        </div>
                    </div>
                `;
            
            // Raw Text Input - for pasting raw data
            case 'raw-text-input':
                return `
                    <div class="rendered-module raw-text-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <textarea class="raw-input-area" 
                                  placeholder="Paste raw data here..."
                                  data-module-id="${mod.id}"></textarea>
                        <button class="btn btn-primary btn-sm" 
                                onclick="UseMode.processRawTextInput('${mod.id}')">
                            📥 Process Data
                        </button>
                    </div>
                `;
                
            default:
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="text" data-field="${mod.linkedField}" value="${escapeHtml(value)}" />
                    </div>
                `;
        }
    }
    
    // Render Clone Group (dynamic list of items)
    function renderCloneGroup(mod) {
        const fieldName = mod.linkedField || mod.id;
        const items = currentData[fieldName] || [];
        
        // Get child field definitions from module options
        const childFields = mod.options?.childFields || [
            { id: 'value', label: 'Value', type: 'text-input' }
        ];
        
        const itemsHtml = items.map((item, index) => `
            <div class="clone-item" data-index="${index}">
                <div class="clone-item-header">
                    <span class="item-number">#${index + 1}</span>
                    <button type="button" class="remove-item-btn" 
                            onclick="UseMode.removeCloneItem('${fieldName}', ${index})">✕</button>
                </div>
                <div class="clone-item-fields">
                    ${childFields.map(child => {
                        const childValue = typeof item === 'object' ? (item[child.id] || '') : item;
                        const inputType = child.type === 'url-input' ? 'url' : 'text';
                        return `
                            <div class="clone-field">
                                <label>${escapeHtml(child.label)}</label>
                                <input type="${inputType}" 
                                       data-array="${fieldName}"
                                       data-index="${index}"
                                       data-child="${child.id}"
                                       value="${escapeHtml(childValue)}" />
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        `).join('');
        
        return `
            <div class="rendered-module clone-group-module" data-module-id="${mod.id}">
                <div class="clone-group-header">
                    <label>${escapeHtml(mod.label)}</label>
                    <button type="button" class="add-item-btn" 
                            onclick="UseMode.addCloneItem('${fieldName}')">+ Add</button>
                </div>
                <div class="clone-items" data-field="${fieldName}">
                    ${itemsHtml || '<p class="empty-message">No items yet. Click "+ Add" to create one.</p>'}
                </div>
            </div>
        `;
    }
    
    // Get current collapse states of all sections
    function getCollapseStates() {
        const states = {};
        document.querySelectorAll('.collapsible-section').forEach(section => {
            const sectionId = section.dataset.section;
            if (sectionId) {
                states[sectionId] = section.classList.contains('collapsed');
            }
        });
        return states;
    }
    
    // Restore collapse states after re-render
    function restoreCollapseStates(states) {
        Object.entries(states).forEach(([sectionId, isCollapsed]) => {
            const section = document.querySelector(`.collapsible-section[data-section="${sectionId}"]`);
            if (section) {
                section.classList.toggle('collapsed', isCollapsed);
            }
        });
    }
    
    // Add item to clone group
    function addCloneItem(fieldName) {
        if (!currentData[fieldName]) {
            currentData[fieldName] = [];
        }
        
        // Add empty item (will be object if multiple child fields, string if single)
        const template = TemplateManager.getCurrentTemplate();
        const mod = template?.modules?.find(m => m.linkedField === fieldName || m.id === fieldName);
        const childFields = mod?.options?.childFields || [{ id: 'value' }];
        
        if (childFields.length === 1 && childFields[0].id === 'value') {
            currentData[fieldName].push('');
        } else {
            const newItem = {};
            childFields.forEach(f => newItem[f.id] = '');
            currentData[fieldName].push(newItem);
        }
        
        saveCurrentDataEntry(); // Save changes
        
        // Preserve collapse states, re-render, then restore
        const collapseStates = getCollapseStates();
        renderModules();
        restoreCollapseStates(collapseStates);
        
        updateOutput();
    }
    
    // Remove item from clone group
    function removeCloneItem(fieldName, index) {
        if (currentData[fieldName] && Array.isArray(currentData[fieldName])) {
            currentData[fieldName].splice(index, 1);
            saveCurrentDataEntry(); // Save changes
            
            // Preserve collapse states, re-render, then restore
            const collapseStates = getCollapseStates();
            renderModules();
            restoreCollapseStates(collapseStates);
            
            updateOutput();
        }
    }
    
    // Handle module input change
    function handleModuleInput(e) {
        const field = e.target.dataset.field;
        const arrayField = e.target.dataset.array;
        
        // Handle array item input (clone group)
        if (arrayField) {
            const index = parseInt(e.target.dataset.index, 10);
            const childId = e.target.dataset.child;
            const value = e.target.value;
            
            if (!currentData[arrayField]) {
                currentData[arrayField] = [];
            }
            
            // Ensure array has enough items
            while (currentData[arrayField].length <= index) {
                currentData[arrayField].push('');
            }
            
            // Set value (object child if has childId, else direct value)
            if (childId && childId !== 'value') {
                if (typeof currentData[arrayField][index] !== 'object') {
                    currentData[arrayField][index] = {};
                }
                currentData[arrayField][index][childId] = value;
            } else {
                currentData[arrayField][index] = value;
            }
            
            saveCurrentDataEntry(); // Save changes
            updateOutput();
            return;
        }
        
        // Handle normal field input
        if (!field) return;
        
        let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        currentData[field] = value;
        
        saveCurrentDataEntry(); // Save changes
        updateOutput();
    }
    
    /**
     * Apply computed fields defined in template.dataConfig.computedFields
     * Each computed field has: { id, compute } where compute is a JS expression
     * The expression has access to 'item' (the current data object)
     */
    function applyComputedFields(data, template) {
        const computedFields = template.dataConfig?.computedFields || [];
        if (computedFields.length === 0) return;
        
        // Process computed fields on main data
        computedFields.forEach(cf => {
            if (!cf.id || !cf.compute) return;
            try {
                // Create function that evaluates the compute expression
                // Use eval-like approach but safer with Function constructor
                const fn = new Function('item', `return ${cf.compute};`);
                data[cf.id] = fn(data);
            } catch (e) {
                console.warn(`Computed field ${cf.id} error:`, e);
            }
        });
        
        // Also process for nested platform arrays if they exist
        if (data.platforms && Array.isArray(data.platforms)) {
            data.platforms.forEach(platform => {
                computedFields.forEach(cf => {
                    if (!cf.id || !cf.compute) return;
                    try {
                        const fn = new Function('item', `return ${cf.compute};`);
                        platform[cf.id] = fn(platform);
                    } catch (e) {
                        console.warn(`Computed field ${cf.id} (platform) error:`, e);
                    }
                });
            });
        }
    }
    
    /**
     * Copy from pattern - replaces {variables} with current data values
     * Used by copy buttons on modules with copyButton option
     */
    function copyFromPattern(btn) {
        const pattern = btn.dataset.pattern;
        if (!pattern) return;
        
        let text = pattern;
        
        // Replace all {variable} placeholders with current data values
        text = text.replace(/\{([^}]+)\}/g, (match, varName) => {
            // Support dot notation like {platform.name}
            const parts = varName.split('.');
            let value = currentData;
            for (const part of parts) {
                if (value === undefined || value === null) break;
                value = value[part];
            }
            return value !== undefined && value !== null ? String(value) : match;
        });
        
        navigator.clipboard.writeText(text).then(() => {
            // Visual feedback
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 1500);
        }).catch(err => {
            console.error('Copy failed:', err);
            alert('Copy failed. Please try again.');
        });
    }
    
    // Update output preview
    function updateOutput() {
        const template = TemplateManager.getCurrentTemplate();
        
        // Apply computed fields to current data before output
        if (template) {
            applyComputedFields(currentData, template);
        }
        
        // Try to find output elements, or create them in right zone
        let outputPreview = elements.outputPreview();
        let outputCode = elements.outputCode();
        
        if (!outputPreview || !outputCode) {
            // Look for right zone or create output panel
            const rightZone = document.querySelector('.use-zone[data-zone="right"]') || 
                             document.querySelector('#use-layout .use-column.use-output');
            
            if (rightZone && !outputPreview) {
                // Check if output panel already exists
                outputPreview = rightZone.querySelector('#use-output-preview');
                outputCode = rightZone.querySelector('#use-output-code');
                
                if (!outputPreview) {
                    // Create output panel
                    const outputPanel = document.createElement('div');
                    outputPanel.className = 'use-panel output-panel full-height';
                    outputPanel.innerHTML = `
                        <div class="panel-header">
                            <h3>📤 Output</h3>
                            <div class="output-tabs">
                                <button id="preview-tab" class="tab-btn active">Preview</button>
                                <button id="code-tab" class="tab-btn">BBCode</button>
                            </div>
                        </div>
                        <div class="panel-body preview-body">
                            <div class="batch-controls">
                                <label class="checkbox-label" title="Generate output for ALL data entries at once">
                                    <input type="checkbox" id="batch-mode-toggle">
                                    <span>Batch Mode (All Entries)</span>
                                </label>
                                <div id="batch-mode-indicator" class="batch-indicator hidden">Multiple entries selected</div>
                            </div>
                            <div id="use-output-preview" class="output-preview">
                                <p class="empty-message">Output will appear here...</p>
                            </div>
                            <textarea id="use-output-code" class="full-textarea code-output hidden" readonly></textarea>
                        </div>
                        <div class="panel-footer">
                            <button id="copy-bbcode-btn" class="btn btn-success full-width" disabled>
                                📋 Copy BBCode
                            </button>
                            <button id="download-bbcode-btn" class="btn btn-secondary full-width" disabled>
                                💾 Download .txt
                            </button>
                        </div>
                    `;
                    rightZone.appendChild(outputPanel);
                    outputPreview = outputPanel.querySelector('#use-output-preview');
                    outputCode = outputPanel.querySelector('#use-output-code');
                    
                    // Bind tab events
                    const previewTab = outputPanel.querySelector('#preview-tab');
                    const codeTab = outputPanel.querySelector('#code-tab');
                    previewTab?.addEventListener('click', () => showOutputTab('preview'));
                    codeTab?.addEventListener('click', () => showOutputTab('code'));
                    
                    // Bind batch toggle
                    const batchToggle = outputPanel.querySelector('#batch-mode-toggle');
                    batchToggle?.addEventListener('change', (e) => {
                        UseMode.toggleBatchMode(e.target.checked);
                    });
                    
                    // Bind copy button
                    const copyBtn = outputPanel.querySelector('#copy-bbcode-btn');
                    copyBtn?.addEventListener('click', copyBBCode);
                    

                }
            }
        }
        
        if (!template || !template.output?.template) {
            if (outputPreview) outputPreview.innerHTML = '<p class="empty-message">No output template configured.</p>';
            return;
        }
        
        // Check for batch mode
        const isBatch = document.getElementById('batch-mode-toggle')?.checked;
        let bbcode = '';
        
        if (isBatch) {
            const templateId = TemplateManager.getCurrentTemplateId();
            const allData = DataStore.getTemplateData(templateId);
            bbcode = OutputEngine.generateBatchOutput(template, allData.entries || []);
        } else {
            // Generate BBCode using OutputEngine
            bbcode = OutputEngine.generateOutput(template.output.template, currentData);
        }

        
        // Store for copy (with null safety)
        if (outputCode) outputCode.value = bbcode;
        
        // Render preview (with null safety)
        if (outputPreview) {
            const html = OutputEngine.renderBBCodeToHTML(bbcode);
            outputPreview.innerHTML = html || '<p class="empty-message">No output yet...</p>';
        }
        
        // Enable buttons (with null safety)
        const hasOutput = bbcode && bbcode.trim().length > 0;
        const copyBtn = elements.copyBBCodeBtn();
        const downloadBtn = elements.downloadBBCodeBtn();
        if (copyBtn) copyBtn.disabled = !hasOutput;
        if (downloadBtn) downloadBtn.disabled = !hasOutput;
    }
    
    // Show output tab (preview or code)
    function showOutputTab(tab) {
        const previewActive = tab === 'preview';
        
        elements.previewTab()?.classList.toggle('active', previewActive);
        elements.codeTab()?.classList.toggle('active', !previewActive);
        
        elements.outputPreview()?.classList.toggle('hidden', !previewActive);
        elements.outputCode()?.classList.toggle('hidden', previewActive);
    }
    
    // Copy BBCode to clipboard
    function copyBBCode() {
        const code = elements.outputCode()?.value;
        if (code) {
            navigator.clipboard.writeText(code).then(() => {
                const btn = elements.copyBBCodeBtn();
                const originalText = btn.innerHTML;
                btn.innerHTML = '✓ Copied!';
                setTimeout(() => btn.innerHTML = originalText, 2000);
            });
        }
    }
    
    // Download BBCode as txt file
    function downloadBBCode() {
        const code = elements.outputCode()?.value;
        if (!code) return;
        
        const template = TemplateManager.getCurrentTemplate();
        const primaryKey = template?.dataConfig?.primaryKey;
        const filename = currentData[primaryKey] || template?.name || 'output';
        
        const blob = new Blob([code], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename.replace(/[^a-z0-9]/gi, '_')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    // Copy specific field value
    function copyField(fieldId) {
        const value = currentData[fieldId];
        if (value) {
            navigator.clipboard.writeText(value);
        }
    }
    
    // Utility
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }
    
    // ======== FILE DROP MODULE HANDLERS ========
    
    // Handle file drop in a file-drop module
    function handleFileDropInModule(e, moduleId) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            processFilesForImport(files);
        }
    }
    
    // Handle file select in a file-drop module
    function handleFileSelectInModule(e, moduleId) {
        const files = e.target?.files;
        if (files && files.length > 0) {
            processFilesForImport(files);
        }
        e.target.value = ''; // Reset for re-select
    }
    
    // Process files for import (shared logic)
    function processFilesForImport(files) {
        let combinedText = '';
        let filesRead = 0;
        const fileList = Array.from(files);
        
        fileList.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                combinedText += e.target.result + '\n\n';
                filesRead++;
                
                if (filesRead === fileList.length) {
                    parseAndMergeMultipleEntries(combinedText);
                }
            };
            reader.readAsText(file);
        });
    }
    
    // Process raw text input from a raw-text-input module
    function processRawTextInput(moduleId) {
        const textarea = document.querySelector(`.raw-input-area[data-module-id="${moduleId}"]`);
        if (!textarea) return;
        
        const text = textarea.value.trim();
        if (!text) {
            alert('Please paste some data first.');
            return;
        }
        
        parseAndMergeMultipleEntries(text);
    }
    
    return {
        init,
        switchMode,
        toggleBatchMode: (enabled) => {
            const indicator = document.getElementById('batch-mode-indicator');
            if (indicator) {
                indicator.classList.toggle('hidden', !enabled);
            }
            updateOutput(); // Re-render logic
        },
        removeCloneItem,
        addCloneItem,
        copyField: (fieldId) => {
             const val = currentData[fieldId];
             if(val) navigator.clipboard.writeText(val);
        },
        copyFromPattern,
        // File drop module exports
        handleFileDropInModule,
        handleFileSelectInModule,
        processRawTextInput,
        // Section toggle exports
        toggleSection,
        expandAllSections,
        collapseAllSections
    };
})();
