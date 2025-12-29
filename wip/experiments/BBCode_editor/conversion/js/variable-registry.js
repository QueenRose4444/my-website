/**
 * Variable Registry - Shared variable system accessible across all pages
 * Collects variables from parser fields and makes them available for:
 * - Output Template Builder (insert variables)
 * - Logic Flow Editor (reference variables)
 * - Modules (bind to variables)
 */
const VariableRegistry = (function() {
    
    let variables = [];
    
    // Initialize - listen for template/parser changes
    function init() {
        document.addEventListener('templateLoaded', refreshVariables);
        document.addEventListener('parserFieldsChanged', refreshVariables);
    }
    
    // Refresh variables from current template
    function refreshVariables() {
        const template = TemplateManager?.getCurrentTemplate();
        if (!template) {
            variables = [];
            dispatchChange();
            return;
        }
        
        variables = [];
        
        // Get all fields from all parser variants
        if (template.parser?.variants) {
            template.parser.variants.forEach(variant => {
                (variant.fields || []).forEach(field => {
                    // Avoid duplicates
                    if (!variables.find(v => v.id === field.id)) {
                        variables.push({
                            id: field.id,
                            label: field.label,
                            type: 'field',
                            source: variant.name,
                            isPrimaryKey: field.isPrimaryKey || false
                        });
                    }
                });
            });
        }
        
        // Legacy support: direct parser.fields
        if (template.parser?.fields) {
            template.parser.fields.forEach(field => {
                if (!variables.find(v => v.id === field.id)) {
                    variables.push({
                        id: field.id,
                        label: field.label,
                        type: 'field',
                        source: 'parser',
                        isPrimaryKey: field.isPrimaryKey || false
                    });
                }
            });
        }
        
        // Add any custom variables defined in template
        if (template.variables) {
            template.variables.forEach(v => {
                if (!variables.find(existing => existing.id === v.id)) {
                    variables.push({
                        id: v.id,
                        label: v.label,
                        type: v.type || 'custom',
                        source: 'custom'
                    });
                }
            });
        }
        
        // Add variables defined by modules (e.g., color-picker with variableName)
        if (template.modules) {
            template.modules.forEach(mod => {
                const varId = mod.options?.variableName || mod.linkedField;
                if (varId && !variables.find(v => v.id === varId)) {
                    // Determine type based on module type
                    let varType = 'module';
                    if (mod.type === 'color-picker') varType = 'color';
                    else if (mod.type === 'url-input') varType = 'url';
                    
                    variables.push({
                        id: varId,
                        label: mod.label || varId,
                        type: varType,
                        source: 'module',
                        inputType: mod.type === 'color-picker' ? 'color' : mod.type,
                        defaultValue: mod.defaultValue
                    });
                }
            });
        }
        
        dispatchChange();
    }
    
    // Dispatch change event
    function dispatchChange() {
        document.dispatchEvent(new CustomEvent('variablesChanged', {
            detail: { variables }
        }));
    }
    
    // Get all variables
    function getVariables() {
        return [...variables];
    }
    
    // Get variable by ID
    function getVariable(id) {
        return variables.find(v => v.id === id);
    }
    
    // Register a custom variable (for Logic nodes, etc.)
    function registerVariable(id, label, type = 'custom') {
        if (variables.find(v => v.id === id)) return false;
        
        variables.push({ id, label, type, source: 'custom' });
        
        // Persist to template
        const template = TemplateManager?.getCurrentTemplate();
        if (template) {
            template.variables = template.variables || [];
            template.variables.push({ id, label, type });
            TemplateManager.saveCurrentTemplate();
        }
        
        dispatchChange();
        return true;
    }
    
    // Remove a custom variable
    function unregisterVariable(id) {
        const index = variables.findIndex(v => v.id === id && v.source === 'custom');
        if (index === -1) return false;
        
        variables.splice(index, 1);
        
        // Remove from template
        const template = TemplateManager?.getCurrentTemplate();
        if (template?.variables) {
            template.variables = template.variables.filter(v => v.id !== id);
            TemplateManager.saveCurrentTemplate();
        }
        
        dispatchChange();
        return true;
    }
    
    // Render variable picker (reusable UI component)
    function renderVariablePicker(containerId, onSelect) {
        const container = document.getElementById(containerId);
        if (!container) return;
        
        if (variables.length === 0) {
            container.innerHTML = `
                <p class="empty-message">No variables defined yet.</p>
                <p class="help-text">Add fields in the Parser tab to see them here.</p>
            `;
            return;
        }
        
        // Group variables by category
        const colorVars = variables.filter(v => isColorVariable(v));
        const urlVars = variables.filter(v => isUrlVariable(v));
        const generalVars = variables.filter(v => !isColorVariable(v) && !isUrlVariable(v));
        
        let html = '<div class="variable-list">';
        
        // Color variables section
        if (colorVars.length > 0) {
            html += `
                <div class="var-section">
                    <div class="var-section-header">🎨 Colors</div>
                    ${colorVars.map(v => renderVariableItem(v, true)).join('')}
                </div>
            `;
        }
        
        // URL variables section
        if (urlVars.length > 0) {
            html += `
                <div class="var-section">
                    <div class="var-section-header">🔗 URLs</div>
                    ${urlVars.map(v => renderVariableItem(v)).join('')}
                </div>
            `;
        }
        
        // General variables section
        if (generalVars.length > 0) {
            html += `
                <div class="var-section">
                    <div class="var-section-header">📋 Fields</div>
                    ${generalVars.map(v => renderVariableItem(v)).join('')}
                </div>
            `;
        }
        
        html += '</div>';
        container.innerHTML = html;
        
        // Bind click events
        container.querySelectorAll('.variable-item').forEach(item => {
            item.addEventListener('click', () => {
                const varId = item.dataset.varId;
                if (onSelect) onSelect(varId);
            });
        });
    }
    
    // Check if variable is a color type
    function isColorVariable(v) {
        const id = v.id.toLowerCase();
        const label = (v.label || '').toLowerCase();
        return id.includes('color') || label.includes('color') || 
               v.inputType === 'color' || v.type === 'color';
    }
    
    // Check if variable is a URL type
    function isUrlVariable(v) {
        const id = v.id.toLowerCase();
        const label = (v.label || '').toLowerCase();
        return id.includes('url') || id.includes('link') || 
               label.includes('url') || label.includes('link') ||
               v.inputType === 'url' || v.type === 'url';
    }
    
    // Render a single variable item
    function renderVariableItem(v, showColorSwatch = false) {
        // Get color value - first check variable's stored defaultValue, then lookup
        const colorValue = v.defaultValue || getVariableValue(v.id);
        const swatchStyle = showColorSwatch && isValidColor(colorValue) 
            ? `style="background-color: ${colorValue}; width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(255,255,255,0.3); margin-right: 6px;"`
            : '';
        
        return `
            <div class="variable-item ${v.isPrimaryKey ? 'is-primary' : ''} ${showColorSwatch ? 'has-color' : ''}" 
                 data-var-id="${v.id}" 
                 title="${escapeHtml(v.label)} (${v.source})${showColorSwatch && colorValue ? ' - ' + colorValue : ''}">
                ${showColorSwatch ? `<span class="color-swatch" ${swatchStyle}></span>` : ''}
                <span class="var-name">{${v.id}}</span>
                <span class="var-label">${escapeHtml(v.label)}</span>
                ${v.isPrimaryKey ? '<span class="var-key" title="Primary Key">🔑</span>' : ''}
            </div>
        `;
    }
    
    // Get current value of a variable from data store or module default
    function getVariableValue(varId) {
        const template = TemplateManager?.getCurrentTemplate();
        if (!template) return null;
        
        // First check DataStore entries
        const templateId = TemplateManager?.getCurrentTemplateId();
        if (templateId) {
            const data = DataStore?.getTemplateData(templateId);
            if (data?.entries?.length > 0 && data.entries[0][varId]) {
                return data.entries[0][varId];
            }
        }
        
        // Check module defaultValue (for color-picker and other modules with defaults)
        const module = template.modules?.find(m => 
            m.linkedField === varId || 
            m.options?.variableName === varId
        );
        if (module?.defaultValue) {
            return module.defaultValue;
        }
        
        // Check parser fields for default
        const field = template.parser?.fields?.find(f => f.id === varId);
        if (field?.defaultValue) {
            return field.defaultValue;
        }
        
        return null;
    }
    
    // Check if a string is a valid CSS color
    function isValidColor(str) {
        if (!str || typeof str !== 'string') return false;
        // Check for hex, rgb, named colors
        return /^#([0-9A-Fa-f]{3}){1,2}$/.test(str) ||
               /^rgb\(/.test(str) ||
               /^(white|black|red|green|blue|yellow|orange|purple|pink|gray|grey)$/i.test(str);
    }
    
    // Utility: escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    return {
        init,
        getVariables,
        getVariable,
        registerVariable,
        unregisterVariable,
        renderVariablePicker,
        refresh: refreshVariables
    };
})();
