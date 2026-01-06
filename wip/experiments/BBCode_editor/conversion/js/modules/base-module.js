/**
 * Base Module - Foundation for UI module system
 */
const ModuleSystem = (function() {
    
    // Module type definitions
    const MODULE_TYPES = {
        // Input Modules
        'text-input': { icon: '📝', name: 'Text Input', defaultLabel: 'Text Input', category: 'inputs' },
        'textarea': { icon: '📄', name: 'Text Area', defaultLabel: 'Text Area', category: 'inputs' },
        'color-picker': { icon: '🎨', name: 'Color Picker', defaultLabel: 'Color', category: 'inputs' },
        'dropdown': { icon: '📋', name: 'Dropdown', defaultLabel: 'Select', category: 'inputs' },
        'toggle': { icon: '🔘', name: 'Toggle', defaultLabel: 'Toggle', category: 'inputs' },
        'url-input': { icon: '🔗', name: 'URL Input', defaultLabel: 'URL', category: 'inputs' },
        'image-url': { icon: '🖼️', name: 'Image URL', defaultLabel: 'Image', category: 'inputs', description: 'URL input with image preview' },
        'number-input': { icon: '🔢', name: 'Number Input', defaultLabel: 'Number', category: 'inputs' },
        'file-input': { icon: '📁', name: 'File Input', defaultLabel: 'File Upload', category: 'inputs' },
        // System Modules (auto-added based on zone purpose)
        'file-drop': { icon: '📂', name: 'File Drop Zone', defaultLabel: 'Drop Files', category: 'system' },
        'raw-text-input': { icon: '📑', name: 'Raw Text Input', defaultLabel: 'Paste Text', category: 'system' },
        'output-panel': { icon: '📤', name: 'Output Panel', defaultLabel: 'Output', category: 'system' },
        'live-preview': { icon: '👁️', name: 'Live Preview', defaultLabel: 'Preview', category: 'system' },
        // Controls
        'copy-button': { icon: '📋', name: 'Copy Button', defaultLabel: 'Copy', category: 'controls' },
        'static-label': { icon: '🏷️', name: 'Static Label', defaultLabel: 'Label', category: 'controls', description: 'Read-only text/boilerplate' },
        // Containers
        'group': { icon: '📦', name: 'Group', defaultLabel: 'Section', category: 'containers', isContainer: true },
        'repeater': { icon: '🔄', name: 'Repeater', defaultLabel: 'List', category: 'containers', isContainer: true, isArray: true },
        // Clone/Dynamic Arrays (user-configurable)
        'clone-group': { 
            icon: '📋➕', 
            name: 'Clone Group', 
            defaultLabel: 'Add Item', 
            category: 'dynamic',
            isCloner: true,
            isArray: true,
            description: 'Dynamic list - add/remove items at runtime'
        },
        'nested-list': { 
            icon: '📝📝', 
            name: 'Nested List', 
            defaultLabel: 'Add Nested', 
            category: 'dynamic',
            isCloner: true,
            isNested: true,
            description: 'Creates nested items (like sections with links inside)'
        }
    };
    
    
    // DOM Elements
    const elements = {
        modulePalette: () => document.querySelector('.designer-palette .module-palette'),
        layoutZones: () => document.querySelectorAll('.layout-zone'),
        leftZone: () => document.querySelector('.layout-zone[data-zone="left"] .zone-modules'),
        rightZone: () => document.querySelector('.layout-zone[data-zone="right"] .zone-modules'),
        centerZone: () => document.querySelector('.layout-zone[data-zone="center"] .zone-modules'),
        moduleModal: () => document.getElementById('module-modal'),
        moduleForm: () => document.getElementById('module-form'),
        moduleLabel: () => document.getElementById('module-label'),
        moduleLinkedField: () => document.getElementById('module-linked-field'),
        moduleDefault: () => document.getElementById('module-default'),
        moduleSpecificOptions: () => document.getElementById('module-specific-options'),
        deleteModuleBtn: () => document.getElementById('delete-module-btn'),
        moduleCount: () => document.querySelector('.module-count'),
        configPanel: () => document.getElementById('module-config-panel')
    };
    
    let editingModuleId = null;
    let draggedModuleType = null;  // For palette items
    let draggedInstanceId = null;  // For reordering existing modules
    let draggedToZone = null;
    
    // Initialize
    function init() {
        bindEvents();
        
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
        
        // Re-render on tab change to fix initial interaction
        document.addEventListener('tabChanged', (e) => {
            if (e.detail?.tab === 'designer') {
                const template = TemplateManager?.getCurrentTemplate();
                if (template?.modules) {
                    renderModulesToZones(template.modules);
                }
            }
        });
    }
    
    // Bind events
    function bindEvents() {
        // Palette drag start - use event delegation with closest() for nested elements
        document.addEventListener('dragstart', (e) => {
            const moduleItem = e.target.closest('.module-item');
            const moduleInstance = e.target.closest('.module-instance');
            
            if (moduleItem) {
                // Dragging from palette to add new module
                handleDragStart(e, moduleItem);
            } else if (moduleInstance) {
                // Dragging existing module to reorder
                handleInstanceDragStart(e, moduleInstance);
            }
        });
        
        document.addEventListener('dragend', (e) => {
            const moduleItem = e.target.closest('.module-item');
            const moduleInstance = e.target.closest('.module-instance');
            
            if (moduleItem) {
                handleDragEnd(e, moduleItem);
            } else if (moduleInstance) {
                handleInstanceDragEnd(e, moduleInstance);
            }
        });
        
        // Drop zones - use event delegation
        document.addEventListener('dragover', (e) => {
            const zone = e.target.closest('.layout-zone');
            if (zone && (draggedModuleType || draggedInstanceId)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = draggedInstanceId ? 'move' : 'copy';
                zone.classList.add('drag-over');
                
                // Show drop indicator for reordering
                if (draggedInstanceId) {
                    updateDropIndicator(e, zone);
                }
            }
        });
        
        document.addEventListener('dragleave', (e) => {
            const zone = e.target.closest('.layout-zone');
            if (zone && !zone.contains(e.relatedTarget)) {
                zone.classList.remove('drag-over');
                removeDropIndicator();
            }
        });
        
        document.addEventListener('drop', (e) => {
            const zone = e.target.closest('.layout-zone');
            if (zone) {
                e.preventDefault();
                zone.classList.remove('drag-over');
                removeDropIndicator();
                const zoneName = zone.dataset.zone;
                
                if (draggedModuleType) {
                    // Adding new module from palette
                    console.log('[ModuleSystem] Drop detected:', draggedModuleType, 'into zone:', zoneName);
                    addModule(draggedModuleType, zoneName);
                } else if (draggedInstanceId) {
                    // Reordering existing module
                    console.log('[ModuleSystem] Reorder drop:', draggedInstanceId, 'into zone:', zoneName);
                    moveModule(draggedInstanceId, zoneName, getDropIndex(e, zone));
                }
            }
        });
        
        // Module instance click for config - use event delegation
        document.addEventListener('click', (e) => {
            const instance = e.target.closest('.module-instance');
            if (instance) {
                const moduleId = instance.dataset.moduleId;
                console.log('[ModuleSystem] Module clicked:', moduleId);
                
                if (e.target.closest('.delete-btn')) {
                    console.log('[ModuleSystem] Delete button clicked');
                    deleteModule(moduleId);
                } else {
                    // Config button OR regular click - both select the module
                    console.log('[ModuleSystem] Selecting module for config');
                    selectModule(moduleId);
                }
            }
        });
        
        // Module form
        elements.moduleForm()?.addEventListener('submit', handleModuleFormSubmit);
        elements.deleteModuleBtn()?.addEventListener('click', handleDeleteModule);
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        renderModulesToZones(template.modules || []);
        updateFieldOptions(template.parser?.fields || []);
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        clearAllZones();
        updateModuleCount(0);
    }
    
    // Clear all zones
    function clearAllZones() {
        elements.leftZone() && (elements.leftZone().innerHTML = '');
        elements.rightZone() && (elements.rightZone().innerHTML = '');
        elements.centerZone() && (elements.centerZone().innerHTML = '');
    }
    
    // Select module for config panel
    function selectModule(moduleId) {
        console.log('[ModuleSystem] selectModule called:', moduleId);
        
        // Remove selected class from all
        document.querySelectorAll('.module-instance.selected').forEach(el => {
            el.classList.remove('selected');
        });
        
        // Add selected to this one
        const instance = document.querySelector(`.module-instance[data-module-id="${moduleId}"]`);
        if (instance) {
            instance.classList.add('selected');
            console.log('[ModuleSystem] Module selected, calling showModuleConfig');
            showModuleConfig(moduleId);
        }
    }
    
    // Show module config in side panel
    function showModuleConfig(moduleId) {
        console.log('[ModuleSystem] showModuleConfig called:', moduleId);
        
        // Access TemplateManager directly (same as addModule does)
        const template = TemplateManager.getCurrentTemplate();
        console.log('[ModuleSystem] Template from TemplateManager:', template?.name || 'null');
        if (!template) {
            console.error('[ModuleSystem] No template for config - TemplateManager returned null');
            return;
        }
        
        const module = template.modules?.find(m => m.id === moduleId);
        console.log('[ModuleSystem] Looking for module:', moduleId, 'in', template.modules?.length, 'modules');
        if (!module) {
            console.error('[ModuleSystem] Module not found:', moduleId);
            return;
        }
        
        const configPanel = elements.configPanel();
        console.log('[ModuleSystem] Config panel element:', configPanel);
        if (!configPanel) {
            console.error('[ModuleSystem] Config panel not found!');
            return;
        }
        
        const typeDef = MODULE_TYPES[module.type];
        const fields = template.parser?.fields || [];
        console.log('[ModuleSystem] Rendering config for module:', module.label, 'with', fields.length, 'fields');
        
        // Check if this is a clone-group type - show simplified settings with child fields
        if (module.type === 'clone-group' || module.type === 'repeater') {
            const opts = module.options || {};
            const childFields = opts.childFields || [{ id: 'value', label: 'Value', type: 'text-input' }];
            
            configPanel.innerHTML = `
                <div class="config-module-type">
                    <span class="type-icon">${typeDef?.icon || '❓'}</span>
                    <span class="type-name">${typeDef?.name || 'Unknown'}</span>
                </div>
                <p class="config-description">${typeDef?.description || 'Dynamic list - add/remove items at runtime'}</p>
                
                <div class="config-section">
                    <label>Section Label</label>
                    <input type="text" id="config-label" value="${escapeHtml(module.label || 'Items')}" placeholder="e.g., Mirror Links" />
                </div>
                
                <div class="config-section">
                    <label>Array Variable Name</label>
                    <input type="text" id="config-linked-field" value="${escapeHtml(module.linkedField || opts.targetArray || '')}" placeholder="e.g., mirrors" />
                    <small class="config-hint">Use in LOOP: &lt;!--LOOP:variableName--&gt;</small>
                </div>
                
                <div class="config-section">
                    <label>Child Fields (per item)</label>
                    <div id="child-fields-list" class="child-fields-list">
                        ${childFields.map((f, i) => `
                            <div class="child-field-row" data-index="${i}">
                                <input type="text" class="child-field-id" value="${escapeHtml(f.id)}" placeholder="ID" />
                                <input type="text" class="child-field-label" value="${escapeHtml(f.label)}" placeholder="Label" />
                                <select class="child-field-type">
                                    <option value="text-input" ${f.type === 'text-input' ? 'selected' : ''}>Text</option>
                                    <option value="url-input" ${f.type === 'url-input' || f.type === 'url' ? 'selected' : ''}>URL</option>
                                </select>
                                <button type="button" class="remove-child-btn" onclick="this.parentElement.remove()">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" id="add-child-field-btn" class="btn btn-sm btn-secondary">+ Add Field</button>
                </div>
                
                <div class="config-actions">
                    <button type="button" class="btn btn-primary full-width" id="save-config-btn">Save Changes</button>
                    <button type="button" class="btn btn-danger full-width" id="delete-config-btn">Delete Module</button>
                </div>
            `;
            
            // Bind Add Child Field button
            document.getElementById('add-child-field-btn')?.addEventListener('click', () => {
                const childFieldsList = document.getElementById('child-fields-list');
                const index = childFieldsList.querySelectorAll('.child-field-row').length;
                const newRow = document.createElement('div');
                newRow.className = 'child-field-row';
                newRow.dataset.index = index;
                newRow.innerHTML = `
                    <input type="text" class="child-field-id" value="" placeholder="ID" />
                    <input type="text" class="child-field-label" value="" placeholder="Label" />
                    <select class="child-field-type">
                        <option value="text-input">Text</option>
                        <option value="url-input">URL</option>
                    </select>
                    <button type="button" class="remove-child-btn" onclick="this.parentElement.remove()">✕</button>
                `;
                childFieldsList.appendChild(newRow);
            });
            
            // Bind save
            document.getElementById('save-config-btn')?.addEventListener('click', () => {
                saveModuleConfig(moduleId);
            });
            
            // Bind delete
            document.getElementById('delete-config-btn')?.addEventListener('click', () => {
                deleteModule(moduleId);
            });
            
            return;
        }
        
        // Handle nested-list separately (uses old clone mechanism)
        if (module.type === 'nested-list') {
            // Get arrays from fields (filter to array type fields)
            const arrayFields = fields.filter(f => f.type === 'array' || f.isArray);
            const opts = module.options || {};
            
            configPanel.innerHTML = `
                <div class="config-module-type">
                    <span class="type-icon">${typeDef?.icon || '❓'}</span>
                    <span class="type-name">${typeDef?.name || 'Unknown'}</span>
                </div>
                <p class="config-description">${typeDef?.description || ''}</p>
                
                <div class="config-section">
                    <label>Button Label</label>
                    <input type="text" id="config-button-label" value="${escapeHtml(opts.buttonLabel || module.label || 'Add Item')}" placeholder="+ Add Item" />
                </div>
                
                <div class="config-section">
                    <label>Source Array (copy structure from)</label>
                    <select id="config-source-array">
                        <option value="">-- Select source array --</option>
                        ${arrayFields.map(f => `
                            <option value="${f.id}" ${opts.sourceArray === f.id ? 'selected' : ''}>
                                ${f.label || f.id}
                            </option>
                        `).join('')}
                        ${fields.filter(f => !f.type || f.type !== 'array').length > 0 ? `
                            <optgroup label="Or choose main fields:">
                                <option value="__fields__" ${opts.sourceArray === '__fields__' ? 'selected' : ''}>All main fields</option>
                            </optgroup>
                        ` : ''}
                    </select>
                </div>
                
                <div class="config-section">
                    <label>Target Array (save clones to)</label>
                    <input type="text" id="config-target-array" value="${escapeHtml(opts.targetArray || 'customItems')}" placeholder="e.g., customGroups" />
                    <small class="config-hint">Where cloned items will be stored</small>
                </div>
                
                <div class="config-actions">
                    <button type="button" class="btn btn-primary full-width" id="save-config-btn">Save Changes</button>
                    <button type="button" class="btn btn-danger full-width" id="delete-config-btn">Delete Module</button>
                </div>
            `;
            
            // Bind save for nested-list
            document.getElementById('save-config-btn')?.addEventListener('click', () => {
                saveCloneGroupConfig(moduleId);
            });
            
            // Bind delete
            document.getElementById('delete-config-btn')?.addEventListener('click', () => {
                deleteModule(moduleId);
            });
            
            return;
        }
        
        // Type-specific default value input (for non-clone modules)
        let defaultValueHtml = '';
        if (module.type === 'color-picker') {
            const colorVal = module.defaultValue || '#00aa00';
            const varName = module.options?.variableName || module.linkedField || '';
            defaultValueHtml = `
                <div class="config-section">
                    <label>Color Variable Name</label>
                    <input type="text" id="config-color-variable" value="${escapeHtml(varName)}" placeholder="e.g., headerColor" />
                    <small class="config-hint">Variable used in output template: {variableName}</small>
                </div>
                <div class="config-section">
                    <label>Default Color</label>
                    <div class="color-picker-row">
                        <input type="color" id="config-default-color" value="${colorVal}" />
                        <input type="text" id="config-default" value="${escapeHtml(colorVal)}" placeholder="#00aa00" />
                    </div>
                </div>
            `;
        } else if (module.type === 'toggle') {
            const checked = module.defaultValue === 'true' || module.defaultValue === true;
            defaultValueHtml = `
                <div class="config-section">
                    <label>Default State</label>
                    <label class="checkbox-label">
                        <input type="checkbox" id="config-default-toggle" ${checked ? 'checked' : ''} />
                        <span>Enabled by default</span>
                    </label>
                    <input type="hidden" id="config-default" value="${checked ? 'true' : 'false'}" />
                </div>
            `;
        } else if (module.type === 'clone-group' || module.type === 'repeater') {
            // Clone Group config - define child fields
            const childFields = module.options?.childFields || [{ id: 'value', label: 'Value', type: 'text-input' }];
            const childFieldsJson = JSON.stringify(childFields);
            defaultValueHtml = `
                <div class="config-section">
                    <label>Array Variable Name</label>
                    <input type="text" id="config-linked-field" value="${escapeHtml(module.linkedField || '')}" placeholder="e.g., mirrors" />
                    <small class="config-hint">Use in LOOP: &lt;!--LOOP:variableName--&gt;</small>
                </div>
                <div class="config-section">
                    <label>Child Fields (per item)</label>
                    <div id="child-fields-list" class="child-fields-list">
                        ${childFields.map((f, i) => `
                            <div class="child-field-row" data-index="${i}">
                                <input type="text" class="child-field-id" value="${escapeHtml(f.id)}" placeholder="ID" />
                                <input type="text" class="child-field-label" value="${escapeHtml(f.label)}" placeholder="Label" />
                                <select class="child-field-type">
                                    <option value="text-input" ${f.type === 'text-input' ? 'selected' : ''}>Text</option>
                                    <option value="url-input" ${f.type === 'url-input' ? 'selected' : ''}>URL</option>
                                </select>
                                <button type="button" class="remove-child-btn" onclick="this.parentElement.remove()">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" id="add-child-field-btn" class="btn btn-sm btn-secondary">+ Add Field</button>
                </div>
                <input type="hidden" id="config-default" value="" />
            `;
        } else if (module.type === 'dropdown') {
            // Dropdown config - define choices
            const choices = module.options?.choices || [];
            defaultValueHtml = `
                <div class="config-section">
                    <label>Options (one per line)</label>
                    <textarea id="config-dropdown-choices" rows="4" placeholder="Option 1&#10;Option 2&#10;Option 3">${escapeHtml(choices.join('\n'))}</textarea>
                </div>
                <div class="config-section">
                    <label>Default Value</label>
                    <input type="text" id="config-default" value="${escapeHtml(module.defaultValue || '')}" />
                </div>
            `;
        } else {
            defaultValueHtml = `
                <div class="config-section">
                    <label>Default Value</label>
                    <input type="text" id="config-default" value="${escapeHtml(module.defaultValue || '')}" />
                </div>
            `;
        }
        
        configPanel.innerHTML = `
            <div class="config-module-type">
                <span class="type-icon">${typeDef?.icon || '❓'}</span>
                <span class="type-name">${typeDef?.name || 'Unknown'}</span>
            </div>
            <div class="config-section">
                <label>Label</label>
                <input type="text" id="config-label" value="${escapeHtml(module.label || '')}" />
            </div>
            <div class="config-section">
                <label>Linked Variable</label>
                <select id="config-linked-field">
                    <option value="">-- None --</option>
                    ${fields.map(f => `
                        <option value="${f.id}" ${module.linkedField === f.id ? 'selected' : ''}>
                            {${f.id}} - ${f.label || f.id}
                        </option>
                    `).join('')}
                </select>
            </div>
            ${defaultValueHtml}
            <div class="config-actions">
                <button type="button" class="btn btn-primary full-width" id="save-config-btn">Save Changes</button>
                <button type="button" class="btn btn-danger full-width" id="delete-config-btn">Delete Module</button>
            </div>
        `;
        
        // Bind save
        document.getElementById('save-config-btn')?.addEventListener('click', () => {
            saveModuleConfig(moduleId);
        });
        
        // Bind delete
        document.getElementById('delete-config-btn')?.addEventListener('click', () => {
            deleteModule(moduleId);
        });
        
        // Bind color picker sync (if present)
        const colorPicker = document.getElementById('config-default-color');
        const colorText = document.getElementById('config-default');
        if (colorPicker && colorText) {
            colorPicker.addEventListener('input', (e) => {
                colorText.value = e.target.value;
            });
            colorText.addEventListener('input', (e) => {
                if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
                    colorPicker.value = e.target.value;
                }
            });
        }
        
        // Bind toggle checkbox (if present)
        const toggleCheckbox = document.getElementById('config-default-toggle');
        const toggleHidden = document.getElementById('config-default');
        if (toggleCheckbox && toggleHidden) {
            toggleCheckbox.addEventListener('change', (e) => {
                toggleHidden.value = e.target.checked ? 'true' : 'false';
            });
        }
        
        // Bind Add Child Field button (for clone-group)
        const addChildBtn = document.getElementById('add-child-field-btn');
        const childFieldsList = document.getElementById('child-fields-list');
        if (addChildBtn && childFieldsList) {
            addChildBtn.addEventListener('click', () => {
                const index = childFieldsList.querySelectorAll('.child-field-row').length;
                const newRow = document.createElement('div');
                newRow.className = 'child-field-row';
                newRow.dataset.index = index;
                newRow.innerHTML = `
                    <input type="text" class="child-field-id" value="" placeholder="ID" />
                    <input type="text" class="child-field-label" value="" placeholder="Label" />
                    <select class="child-field-type">
                        <option value="text-input">Text</option>
                        <option value="url-input">URL</option>
                    </select>
                    <button type="button" class="remove-child-btn" onclick="this.parentElement.remove()">✕</button>
                `;
                childFieldsList.appendChild(newRow);
            });
        }
    }
    
    // Save clone-group specific config
    function saveCloneGroupConfig(moduleId) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const module = template.modules?.find(m => m.id === moduleId);
        if (!module) return;
        
        // Initialize options if needed
        if (!module.options) module.options = {};
        
        // Get values from form
        module.options.buttonLabel = document.getElementById('config-button-label')?.value || 'Add Item';
        module.options.sourceArray = document.getElementById('config-source-array')?.value || '';
        module.options.targetArray = document.getElementById('config-target-array')?.value || 'customItems';
        
        // Parse blank fields
        const blankFieldsStr = document.getElementById('config-blank-fields')?.value || '';
        module.options.blankFields = blankFieldsStr.split(',').map(s => s.trim()).filter(s => s);
        
        module.options.titleField = document.getElementById('config-title-field')?.value || 'title';
        
        // Also update label
        module.label = module.options.buttonLabel;
        
        TemplateManager.saveCurrentTemplate();
        renderModulesToZones(template.modules);
        showModuleConfig(moduleId); // Refresh panel
        
        console.log('[ModuleSystem] Clone group config saved:', module.options);
    }
    
    // Save module config from side panel
    function saveModuleConfig(moduleId) {
        const label = document.getElementById('config-label')?.value;
        const linkedField = document.getElementById('config-linked-field')?.value;
        const defaultValue = document.getElementById('config-default')?.value;
        
        const template = TemplateManager.getCurrentTemplate();
        if (!template || !template.modules) return;
        
        const module = template.modules.find(m => m.id === moduleId);
        if (module) {
            module.label = label || module.label;
            module.linkedField = linkedField || '';
            module.defaultValue = defaultValue || '';
            
            if (!module.options) module.options = {};
            
            // Save color variable name for color-picker modules
            if (module.type === 'color-picker') {
                const colorVariable = document.getElementById('config-color-variable')?.value;
                if (colorVariable) {
                    module.options.variableName = colorVariable;
                    // Also set linkedField to the variable name for consistency
                    module.linkedField = colorVariable;
                }
            }
            
            // Save clone-group child fields
            if (module.type === 'clone-group' || module.type === 'repeater') {
                const childFieldRows = document.querySelectorAll('#child-fields-list .child-field-row');
                const childFields = [];
                childFieldRows.forEach(row => {
                    const id = row.querySelector('.child-field-id')?.value?.trim();
                    const fieldLabel = row.querySelector('.child-field-label')?.value?.trim();
                    const fieldType = row.querySelector('.child-field-type')?.value || 'text-input';
                    if (id) {
                        childFields.push({ id, label: fieldLabel || id, type: fieldType });
                    }
                });
                module.options.childFields = childFields.length > 0 ? childFields : [{ id: 'value', label: 'Value', type: 'text-input' }];
            }
            
            // Save dropdown choices
            if (module.type === 'dropdown') {
                const choicesText = document.getElementById('config-dropdown-choices')?.value || '';
                module.options.choices = choicesText.split('\n').map(c => c.trim()).filter(c => c);
            }
            
            TemplateManager.saveCurrentTemplate();
            
            // Re-render the module instance
            renderModulesToZones(template.modules);
            
            // Re-select the module to refresh the config panel
            selectModule(moduleId);
            
            console.log('[ModuleSystem] Module config saved:', module);
        }
    }
    
    // Drag handlers
    function handleDragStart(e, moduleItem) {
        if (!moduleItem) return;
        
        draggedModuleType = moduleItem.dataset.moduleType;
        moduleItem.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'copy';
        e.dataTransfer.setData('text/plain', draggedModuleType);
        console.log('[ModuleSystem] Drag started:', draggedModuleType);
    }
    
    function handleDragEnd(e, moduleItem) {
        if (moduleItem) {
            moduleItem.classList.remove('dragging');
        }
        draggedModuleType = null;
        console.log('[ModuleSystem] Drag ended');
    }
    
    // Instance drag handlers (for reordering)
    function handleInstanceDragStart(e, instance) {
        if (!instance) return;
        
        draggedInstanceId = instance.dataset.moduleId;
        instance.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedInstanceId);
        console.log('[ModuleSystem] Instance drag started:', draggedInstanceId);
    }
    
    function handleInstanceDragEnd(e, instance) {
        if (instance) {
            instance.classList.remove('dragging');
        }
        draggedInstanceId = null;
        removeDropIndicator();
        console.log('[ModuleSystem] Instance drag ended');
    }
    
    // Drop indicator for reordering
    function updateDropIndicator(e, zone) {
        const zoneModules = zone.querySelector('.zone-modules');
        if (!zoneModules) return;
        
        removeDropIndicator();
        
        const indicator = document.createElement('div');
        indicator.className = 'drop-indicator';
        indicator.id = 'module-drop-indicator';
        
        const instances = Array.from(zoneModules.querySelectorAll('.module-instance:not(.dragging)'));
        let insertBefore = null;
        
        for (const inst of instances) {
            const rect = inst.getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                insertBefore = inst;
                break;
            }
        }
        
        if (insertBefore) {
            zoneModules.insertBefore(indicator, insertBefore);
        } else {
            zoneModules.appendChild(indicator);
        }
    }
    
    function removeDropIndicator() {
        document.getElementById('module-drop-indicator')?.remove();
    }
    
    function getDropIndex(e, zone) {
        const zoneModules = zone.querySelector('.zone-modules');
        if (!zoneModules) return 0;
        
        const instances = Array.from(zoneModules.querySelectorAll('.module-instance:not(.dragging)'));
        
        for (let i = 0; i < instances.length; i++) {
            const rect = instances[i].getBoundingClientRect();
            if (e.clientY < rect.top + rect.height / 2) {
                return i;
            }
        }
        
        return instances.length;
    }
    
    // Move module to different position/zone
    function moveModule(moduleId, newZone, newIndex) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template?.modules) return;
        
        const oldIndex = template.modules.findIndex(m => m.id === moduleId);
        if (oldIndex === -1) return;
        
        const module = template.modules[oldIndex];
        const oldZone = module.zone || 'left';
        
        // Update zone
        module.zone = newZone;
        
        // If same zone, reorder
        if (oldZone === newZone) {
            // Get modules in this zone in their current order
            const zoneModules = template.modules.filter(m => (m.zone || 'left') === newZone);
            const otherModules = template.modules.filter(m => (m.zone || 'left') !== newZone);
            
            // Remove the module from its position
            const moduleInZone = zoneModules.splice(zoneModules.findIndex(m => m.id === moduleId), 1)[0];
            
            // Insert at new position
            zoneModules.splice(newIndex, 0, moduleInZone);
            
            // Rebuild modules array maintaining zone order
            template.modules = [...otherModules, ...zoneModules];
        } else {
            // Moving to different zone - just update zone property
            // The rendering will handle the order
        }
        
        TemplateManager.saveCurrentTemplate();
        renderModulesToZones(template.modules);
        
        console.log('[ModuleSystem] Module moved:', moduleId, 'to zone:', newZone, 'at index:', newIndex);
    }
    
    // Add new module
    function addModule(type, zoneName = 'left') {
        console.log('[ModuleSystem] addModule called:', type, zoneName);
        const template = TemplateManager.getCurrentTemplate();
        if (!template) {
            console.error('[ModuleSystem] No active template!');
            return;
        }
        
        const typeInfo = MODULE_TYPES[type];
        if (!typeInfo) {
            console.error('[ModuleSystem] Unknown module type:', type);
            return;
        }
        
        const module = {
            id: DataStore.generateId(),
            type: type,
            label: typeInfo.defaultLabel,
            linkedField: '',
            defaultValue: type === 'color-picker' ? '#00aa00' : '',
            zone: zoneName,
            options: {}
        };
        
        if (!template.modules) template.modules = [];
        template.modules.push(module);
        console.log('[ModuleSystem] Module added to template:', module);
        console.log('[ModuleSystem] Template now has', template.modules.length, 'modules');
        
        TemplateManager.saveCurrentTemplate();
        
        renderModulesToZones(template.modules);
        
        // Select the new module
        selectModule(module.id);
    }
    
    // Render modules to their respective zones
    function renderModulesToZones(modules) {
        console.log('[ModuleSystem] renderModulesToZones called with', modules.length, 'modules');
        
        // Clear all zones
        clearAllZones();
        
        // Group modules by zone
        const byZone = {
            left: [],
            right: [],
            center: []
        };
        
        modules.forEach(mod => {
            const zone = mod.zone || 'left';
            if (byZone[zone]) {
                byZone[zone].push(mod);
            }
        });
        
        console.log('[ModuleSystem] Modules by zone:', byZone);
        
        // Render each zone
        Object.entries(byZone).forEach(([zoneName, zoneModules]) => {
            const container = elements[zoneName + 'Zone']?.();
            console.log('[ModuleSystem] Zone', zoneName, 'container:', container, 'modules:', zoneModules.length);
            if (!container) {
                console.error('[ModuleSystem] Container not found for zone:', zoneName);
                return;
            }
            
            const html = zoneModules.map(mod => renderModuleInstance(mod)).join('');
            console.log('[ModuleSystem] Rendering HTML to', zoneName, ':', html.substring(0, 100));
            container.innerHTML = html;
        });
        
        updateModuleCount(modules.length);
    }
    
    // Render single module instance for designer with Use Mode style preview
    function renderModuleInstance(mod) {
        const typeInfo = MODULE_TYPES[mod.type] || { icon: '❓', name: 'Unknown' };
        const preview = getModulePreview(mod);
        return `
            <div class="module-instance" data-module-id="${mod.id}" draggable="true">
                <div class="module-preview-container">
                    ${preview}
                </div>
                <div class="module-meta">
                    <span class="module-label">${escapeHtml(mod.label)}</span>
                    <span class="module-link">${mod.linkedField ? `→ {${mod.linkedField}}` : '<em>Not linked</em>'}</span>
                </div>
            </div>
        `;
    }
    
    // Get Use Mode style preview HTML for a module
    function getModulePreview(mod) {
        const colorValue = mod.defaultValue || '#00aa00';
        const buttonLabel = mod.options?.buttonLabel || mod.label || 'Add Item';
        switch(mod.type) {
            case 'text-input':
                return `<input type="text" class="preview-input" placeholder="${escapeHtml(mod.label)}..." disabled>`;
            case 'textarea':
                return `<textarea class="preview-textarea" rows="2" placeholder="${escapeHtml(mod.label)}..." disabled></textarea>`;
            case 'url-input':
                return `<input type="text" class="preview-input preview-url" placeholder="https://..." disabled>`;
            case 'number-input':
                return `<input type="number" class="preview-input preview-number" placeholder="0" disabled>`;
            case 'color-picker':
                return `<div class="preview-color"><input type="color" value="${colorValue}" disabled><span>Color</span></div>`;
            case 'dropdown':
                return `<select class="preview-select" disabled><option>Select...</option></select>`;
            case 'toggle':
                return `<label class="preview-toggle"><input type="checkbox" disabled><span class="toggle-slider"></span><span>Toggle</span></label>`;
            case 'copy-button':
                return `<button class="preview-btn">📋 Copy</button>`;
            case 'file-input':
                return `<div class="preview-file-input">📁 Choose file...</div>`;
            case 'file-drop':
                return `<div class="preview-file-drop"><span>📂</span><span>Drop files here</span></div>`;
            case 'raw-text-input':
                return `<textarea class="preview-textarea preview-raw" rows="3" placeholder="Paste raw text..." disabled></textarea>`;
            case 'output-panel':
                return `<div class="preview-output"><div class="preview-tabs"><span class="active">BBCode</span><span>Preview</span></div><div class="preview-output-area">Output...</div></div>`;
            case 'live-preview':
                return `<div class="preview-live">👁️ Live Preview</div>`;
            case 'group':
                return `<div class="preview-group">📦 Section</div>`;
            case 'repeater':
                return `<div class="preview-repeater">🔄 List Items</div>`;
            case 'clone-group':
                return `<div class="preview-clone-group">
                    <button class="preview-add-btn">➕ ${escapeHtml(buttonLabel)}</button>
                    <div class="preview-clone-info">${mod.options?.sourceArray ? `From: ${mod.options.sourceArray}` : 'Configure source array'}</div>
                </div>`;
            case 'nested-list':
                return `<div class="preview-nested-list">
                    <button class="preview-add-btn">➕ ${escapeHtml(buttonLabel)}</button>
                    <div class="preview-nested-info">Nested items</div>
                </div>`;
            default:
                const typeInfo = MODULE_TYPES[mod.type] || { icon: '❓' };
                return `<div class="preview-unknown">${typeInfo.icon} ${escapeHtml(mod.label)}</div>`;
        }
    }
    
    // Legacy alias
    function renderModulesList(modules) {
        renderModulesToZones(modules);
    }
    
    // Update module count
    function updateModuleCount(count) {
        const el = elements.moduleCount();
        if (el) el.textContent = `${count} module${count !== 1 ? 's' : ''}`;
    }
    
    // Update field options dropdown
    function updateFieldOptions(fields) {
        const select = elements.moduleLinkedField();
        if (!select) return;
        
        select.innerHTML = '<option value="">-- Select Field --</option>';
        fields.forEach(f => {
            const option = document.createElement('option');
            option.value = f.id;
            option.textContent = `${f.label} (${f.id})`;
            select.appendChild(option);
        });
    }
    
    // Open module config modal
    function openModuleConfig(moduleId) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        const module = template.modules?.find(m => m.id === moduleId);
        if (!module) return;
        
        editingModuleId = moduleId;
        
        elements.moduleLabel().value = module.label;
        elements.moduleLinkedField().value = module.linkedField || '';
        elements.moduleDefault().value = module.defaultValue || '';
        
        // Update field options
        updateFieldOptions(template.parser?.fields || []);
        
        // Type-specific options
        renderTypeSpecificOptions(module);
        
        elements.moduleModal()?.classList.remove('hidden');
    }
    
    // Render type-specific options
    function renderTypeSpecificOptions(module) {
        const container = elements.moduleSpecificOptions();
        if (!container) return;
        
        let html = '';
        
        switch (module.type) {
            case 'dropdown':
                html = `
                    <div class="form-group">
                        <label>Options (one per line):</label>
                        <textarea id="module-dropdown-options" rows="4" style="width:100%;background:var(--bg-primary);border:1px solid var(--border-color);border-radius:4px;color:var(--text-primary);padding:8px;">${(module.options?.items || []).join('\n')}</textarea>
                    </div>
                `;
                break;
            case 'copy-button':
                html = `
                    <div class="form-group">
                        <label>Copy Source (field or custom template):</label>
                        <input type="text" id="module-copy-source" value="${module.options?.source || ''}" style="width:100%;">
                        <span class="help-text">Use {fieldName} for dynamic values</span>
                    </div>
                `;
                break;
        }
        
        container.innerHTML = html;
    }
    
    // Handle module form submit
    function handleModuleFormSubmit(e) {
        e.preventDefault();
        
        const template = TemplateManager.getCurrentTemplate();
        if (!template || !editingModuleId) return;
        
        const module = template.modules?.find(m => m.id === editingModuleId);
        if (!module) return;
        
        module.label = elements.moduleLabel().value;
        module.linkedField = elements.moduleLinkedField().value;
        module.defaultValue = elements.moduleDefault().value;
        
        // Type-specific options
        switch (module.type) {
            case 'dropdown':
                const optionsText = document.getElementById('module-dropdown-options')?.value || '';
                module.options.items = optionsText.split('\n').map(s => s.trim()).filter(Boolean);
                break;
            case 'copy-button':
                module.options.source = document.getElementById('module-copy-source')?.value || '';
                break;
        }
        
        TemplateManager.saveCurrentTemplate();
        renderModulesList(template.modules);
        
        elements.moduleModal()?.classList.add('hidden');
        editingModuleId = null;
    }
    
    // Handle delete module (from modal)
    function handleDeleteModule() {
        if (editingModuleId) {
            deleteModule(editingModuleId);
            elements.moduleModal()?.classList.add('hidden');
            editingModuleId = null;
        }
    }
    
    // Delete module
    function deleteModule(moduleId) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        template.modules = (template.modules || []).filter(m => m.id !== moduleId);
        TemplateManager.saveCurrentTemplate();
        renderModulesList(template.modules);
    }
    
    // Render modules for use mode
    function renderForUseMode(modules, container, context = {}) {
        if (!container) return;
        
        container.innerHTML = modules.map(mod => {
            const currentValue = context[mod.linkedField] || mod.defaultValue || '';
            return renderModule(mod, currentValue);
        }).join('');
        
        // Bind value change events
        container.querySelectorAll('[data-module-id]').forEach(el => {
            const moduleId = el.dataset.moduleId;
            const module = modules.find(m => m.id === moduleId);
            if (!module) return;
            
            const input = el.querySelector('input, textarea, select');
            if (input) {
                input.addEventListener('input', () => {
                    document.dispatchEvent(new CustomEvent('moduleValueChanged', {
                        detail: { moduleId, field: module.linkedField, value: input.value }
                    }));
                });
            }
            
            // Toggle special handling
            const toggle = el.querySelector('.toggle-switch');
            if (toggle) {
                toggle.addEventListener('click', () => {
                    toggle.classList.toggle('active');
                    const value = toggle.classList.contains('active');
                    document.dispatchEvent(new CustomEvent('moduleValueChanged', {
                        detail: { moduleId, field: module.linkedField, value }
                    }));
                });
            }
            
            // Copy button
            const copyBtn = el.querySelector('.copy-btn');
            if (copyBtn) {
                copyBtn.addEventListener('click', () => handleCopy(module, context));
            }
        });
    }
    
    // Render single module
    function renderModule(module, value) {
        const typeInfo = MODULE_TYPES[module.type] || { icon: '❓' };
        
        switch (module.type) {
            case 'text-input':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <input type="text" value="${escapeHtml(value)}">
                </div>`;
                
            case 'textarea':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <textarea rows="4">${escapeHtml(value)}</textarea>
                </div>`;
                
            case 'color-picker':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <input type="color" value="${value || '#000000'}">
                </div>`;
                
            case 'dropdown':
                const options = (module.options?.items || []).map(opt => 
                    `<option value="${escapeHtml(opt)}" ${opt === value ? 'selected' : ''}>${escapeHtml(opt)}</option>`
                ).join('');
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <select>${options}</select>
                </div>`;
                
            case 'toggle':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <div class="toggle-container">
                        <div class="toggle-switch ${value ? 'active' : ''}"></div>
                        <label>${escapeHtml(module.label)}</label>
                    </div>
                </div>`;
                
            case 'copy-button':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <button class="copy-btn">${escapeHtml(module.label)}</button>
                </div>`;
                
            case 'url-input':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <input type="url" value="${escapeHtml(value)}">
                </div>`;
                
            case 'number-input':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <input type="number" value="${escapeHtml(value)}">
                </div>`;
                
            case 'file-input':
                return `<div class="rendered-module" data-module-id="${module.id}">
                    <label>${escapeHtml(module.label)}</label>
                    <input type="file">
                </div>`;
                
            default:
                return '';
        }
    }
    
    // Handle copy button
    function handleCopy(module, context) {
        let text = module.options?.source || '';
        
        // Replace variables
        text = text.replace(/\{([^}]+)\}/g, (match, varName) => {
            return context[varName] !== undefined ? context[varName] : match;
        });
        
        navigator.clipboard.writeText(text).then(() => {
            // Could add visual feedback here
        });
    }
    
    // Utility
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    return {
        init,
        MODULE_TYPES,
        renderForUseMode,
        renderModulesToZones
    };
})();
