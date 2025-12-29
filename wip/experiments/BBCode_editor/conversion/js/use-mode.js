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
        downloadBBCodeBtn: () => document.getElementById('download-bbcode-btn')
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
    
    // Process uploaded files
    function processFiles(files) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        files.forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                parseAndMergeInput(text);
            };
            reader.readAsText(file);
        });
    }
    
    // Process pasted/typed input
    function processInput() {
        const text = elements.textInput()?.value;
        if (text && text.trim()) {
            parseAndMergeInput(text);
            elements.textInput().value = '';
        }
    }
    
    // Parse input using template's parser
    function parseAndMergeInput(text) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template || !template.parser) return;
        
        // Use ParserEngine to extract values
        const parsed = ParserEngine.parseInput(text, template.parser);
        
        if (parsed) {
            // Merge with current data
            Object.assign(currentData, parsed);
            
            // Save data entry
            saveCurrentDataEntry();
            
            // Update UI
            renderModules();
            updateOutput();
        }
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
    
    // Render use mode
    function renderUseMode() {
        renderModules();
        updateOutput();
    }
    
    // Render modules based on template
    function renderModules() {

        
        // Try to find the container, or find/create it in the left zone
        let container = elements.modulesContainer();
        
        if (!container) {
            // The App.js renderUseMode replaces use-layout content, so look for left zone instead
            const leftZone = document.querySelector('.use-zone[data-zone="left"]') || 
                            document.querySelector('#use-layout .use-column.use-inputs');
            
            if (leftZone) {
                // Check if there's already a modules panel inside
                container = leftZone.querySelector('#use-modules-container');
                
                if (!container) {
                    // Create a modules panel inside the left zone
                    const modulesPanel = document.createElement('div');
                    modulesPanel.className = 'use-panel modules-panel';
                    modulesPanel.innerHTML = `
                        <div class="panel-header"><h3>⚙️ Edit Data</h3></div>
                        <div class="panel-body">
                            <div id="use-modules-container"></div>
                        </div>
                    `;
                    leftZone.appendChild(modulesPanel);
                    container = modulesPanel.querySelector('#use-modules-container');

                }
            }
        }
        

        if (!container) {

            return;
        }
        
        const template = TemplateManager.getCurrentTemplate();

        if (!template) {
            container.innerHTML = '<p class="empty-message">No template loaded.</p>';
            return;
        }
        
        // Get modules from template or auto-generate from parser fields + output variables
        let inputModules = template.modules?.filter(m => m.zone === 'left' || !m.zone) || [];

        
        // If no modules configured, auto-generate from parser fields and output template variables
        if (inputModules.length === 0) {
            inputModules = generateAutoModules(template);

        }
        
        if (inputModules.length === 0) {
            container.innerHTML = '<p class="empty-message">No input fields defined. Add fields in Parser Setup or modules in Template Designer.</p>';
            return;
        }
        
        const html = inputModules.map(mod => renderModule(mod)).join('');

        container.innerHTML = html;

        
        // Bind input events
        container.querySelectorAll('input, textarea, select').forEach(input => {
            input.addEventListener('input', handleModuleInput);
            input.addEventListener('change', handleModuleInput);
        });
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
    
    // Render single module
    function renderModule(mod) {
        const value = currentData[mod.linkedField] || mod.defaultValue || '';
        const typeDef = ModuleSystem.MODULE_TYPES[mod.type];
        
        switch (mod.type) {
            case 'text-input':
            case 'url-input':
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="${mod.type === 'url-input' ? 'url' : 'text'}" 
                               data-field="${mod.linkedField}" 
                               value="${escapeHtml(value)}" />
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
                
            default:
                return `
                    <div class="rendered-module" data-module-id="${mod.id}">
                        <label>${escapeHtml(mod.label)}</label>
                        <input type="text" data-field="${mod.linkedField}" value="${escapeHtml(value)}" />
                    </div>
                `;
        }
    }
    
    // Handle module input change
    function handleModuleInput(e) {
        const field = e.target.dataset.field;
        if (!field) return;
        
        let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        currentData[field] = value;
        
        updateOutput();
    }
    
    // Update output preview
    function updateOutput() {
        const template = TemplateManager.getCurrentTemplate();
        
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
        
        // Generate BBCode using OutputEngine
        const bbcode = OutputEngine.generateOutput(template.output.template, currentData);

        
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
    
    return {
        init,
        switchMode,
        copyField
    };
})();
