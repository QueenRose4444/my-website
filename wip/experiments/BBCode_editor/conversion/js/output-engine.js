/**
 * Output Engine - Template rendering with IF/LOOP support
 */
const OutputEngine = (function() {
    
    // DOM Elements
    const elements = {
        outputTemplate: () => document.getElementById('output-template'),
        outputPreview: () => document.getElementById('output-preview'),
        outputCode: () => document.getElementById('output-code'),
        previewRenderedBtn: () => document.getElementById('preview-rendered-btn'),
        previewCodeBtn: () => document.getElementById('preview-code-btn'),
        templateHelpers: () => document.querySelectorAll('[data-insert]')
    };
    
    let previewMode = 'rendered';
    
    // Initialize
    function init() {
        bindEvents();
        
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
        
        // Re-render variable picker when variables change
        document.addEventListener('variablesChanged', renderVariablePicker);
        
        // Refresh variable picker when switching to Output tab
        document.addEventListener('tabChanged', (e) => {
            if (e.detail?.tab === 'output') {
                VariableRegistry.refresh();
                renderVariablePicker();
            }
        });
    }
    
    // Bind events
    function bindEvents() {
        // Template changes - cleanup unused variables on change
        elements.outputTemplate()?.addEventListener('input', debounce(() => {
            const value = elements.outputTemplate().value;
            TemplateManager.updateTemplate('output.template', value);
            updatePreview();
            // Cleanup unused auto-created variables after a short delay
            cleanupUnusedVariables();
        }, 500));
        
        // Preview mode toggle
        elements.previewRenderedBtn()?.addEventListener('click', () => setPreviewMode('rendered'));
        elements.previewCodeBtn()?.addEventListener('click', () => setPreviewMode('code'));
        
        // Template helpers (IF/LOOP)
        elements.templateHelpers().forEach(btn => {
            btn.addEventListener('click', () => insertHelper(btn.dataset.insert));
        });
        
        // BBCode quick helpers
        document.querySelectorAll('[data-bbcode]').forEach(btn => {
            btn.addEventListener('click', () => insertBBCode(btn.dataset.bbcode));
        });
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        elements.outputTemplate().value = template.output?.template || '';
        renderVariablePicker();
        updatePreview();
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        elements.outputTemplate().value = '';
        elements.outputPreview().innerHTML = '<p class="empty-message">Preview will appear here...</p>';
        elements.outputCode().value = '';
        renderVariablePicker();
    }
    
    // Render variable picker
    function renderVariablePicker() {
        VariableRegistry.renderVariablePicker('variable-picker', insertVariable);
    }
    
    // Insert variable into template editor
    function insertVariable(varId) {
        const textarea = elements.outputTemplate();
        if (!textarea) return;
        
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const insert = `{${varId}}`;
        
        textarea.value = text.substring(0, start) + insert + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
        textarea.focus();
        
        TemplateManager.updateTemplate('output.template', textarea.value);
        updatePreview();
    }
    
    // Set preview mode
    function setPreviewMode(mode) {
        previewMode = mode;
        
        elements.previewRenderedBtn()?.classList.toggle('active', mode === 'rendered');
        elements.previewCodeBtn()?.classList.toggle('active', mode === 'code');
        
        if (mode === 'rendered') {
            elements.outputPreview()?.classList.remove('hidden');
            elements.outputCode()?.classList.add('hidden');
        } else {
            elements.outputPreview()?.classList.add('hidden');
            elements.outputCode()?.classList.remove('hidden');
        }
    }
    
    // Insert template helper
    function insertHelper(type) {
        const textarea = elements.outputTemplate();
        if (!textarea) return;
        
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        let insert = '';
        
        switch (type) {
            case 'var':
                insert = '{variableName}';
                break;
            case 'if':
                insert = '<!--IF:condition-->\n\n<!--/IF:condition-->';
                break;
            case 'loop':
                insert = '<!--LOOP:arrayName-->\n\n<!--/LOOP:arrayName-->';
                break;
        }
        
        textarea.value = text.substring(0, start) + insert + text.substring(end);
        textarea.selectionStart = textarea.selectionEnd = start + insert.length;
        textarea.focus();
        
        TemplateManager.updateTemplate('output.template', textarea.value);
    }
    
    // Insert BBCode tag - fast insertion with smart defaults
    function insertBBCode(tag) {
        const textarea = elements.outputTemplate();
        if (!textarea) return;
        
        // Capture selection IMMEDIATELY before any async operations
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const text = textarea.value;
        const selectedText = text.substring(start, end);
        
        let insert = '';
        let varName = '';
        
        // Generate smart default variable name
        const getVarName = (base) => {
            const template = TemplateManager.getCurrentTemplate();
            const fields = template?.parser?.fields || [];
            // Check if base exists, if so add number
            let name = base;
            let counter = 1;
            while (fields.some(f => f.id === name)) {
                name = `${base}${counter++}`;
            }
            return name;
        };
        
        switch (tag) {
            case 'url':
                varName = getVarName('fileUrl');
                insert = `[url={${varName}}]${selectedText || '{linkText}'}[/url]`;
                autoCreateVariable(varName, 'URL Field');
                break;
                
            case 'color':
                varName = getVarName('textColor');
                insert = `[color={${varName}}]${selectedText || 'Text'}[/color]`;
                autoCreateVariable(varName, 'Color');
                break;
                
            case 'b':
                // Bold - just wrap selected text, no variable
                insert = `[b]${selectedText || 'Text'}[/b]`;
                break;
                
            case 'i':
                // Italic - just wrap selected text, no variable  
                insert = `[i]${selectedText || 'Text'}[/i]`;
                break;
                
            case 'size':
                varName = getVarName('fontSize');
                insert = `[size={${varName}}]${selectedText || 'Text'}[/size]`;
                autoCreateVariable(varName, 'Size Value');
                break;
                
            case 'spoiler':
                varName = getVarName('spoilerTitle');
                insert = `[spoiler="{${varName}}"]${selectedText || 'Content'}[/spoiler]`;
                autoCreateVariable(varName, 'Spoiler Title');
                break;
        }
        
        // Insert at the captured position
        textarea.value = text.substring(0, start) + insert + text.substring(end);
        
        // Position cursor appropriately
        const newPos = start + insert.length;
        textarea.selectionStart = textarea.selectionEnd = newPos;
        textarea.focus();
        
        TemplateManager.updateTemplate('output.template', textarea.value);
        updatePreview();
    }
    
    // Auto-create variable in parser fields if it doesn't exist
    function autoCreateVariable(varId, label) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        if (!template.parser) template.parser = { fields: [] };
        if (!template.parser.fields) template.parser.fields = [];
        
        // Check if variable already exists
        const exists = template.parser.fields.some(f => f.id === varId);
        if (!exists) {
            template.parser.fields.push({
                id: varId,
                label: label,
                type: 'string',
                autoCreated: true  // Flag to track auto-created variables
            });
            TemplateManager.saveCurrentTemplate();
            
            // Notify that variables have changed
            document.dispatchEvent(new CustomEvent('variablesChanged'));
            
            console.log(`[OutputEngine] Auto-created variable: ${varId}`);
        }
    }
    
    // Cleanup unused auto-created variables
    function cleanupUnusedVariables() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template?.parser?.fields) return;
        
        const outputTemplate = template.output?.template || '';
        
        // Get all referenced variable IDs from output template
        const referencedVars = new Set();
        const varMatches = outputTemplate.match(/\{([^}]+)\}/g) || [];
        varMatches.forEach(match => {
            referencedVars.add(match.replace(/[{}]/g, ''));
        });
        
        // Also check modules for referenced variables
        (template.modules || []).forEach(mod => {
            if (mod.linkedField) referencedVars.add(mod.linkedField);
        });
        
        // Also check parser pattern references (they use the variable)
        const parserVars = new Set(
            (template.parser.variants || []).flatMap(v => (v.fields || []).map(f => f.id))
        );
        
        // Filter out unused auto-created variables
        const originalCount = template.parser.fields.length;
        template.parser.fields = template.parser.fields.filter(field => {
            // Keep if not auto-created
            if (!field.autoCreated) return true;
            // Keep if referenced in output template, modules, or is a parser field from variants
            if (referencedVars.has(field.id)) return true;
            if (parserVars.has(field.id)) return true;
            
            console.log(`[OutputEngine] Removing unused auto-created variable: ${field.id}`);
            return false;
        });
        
        if (template.parser.fields.length !== originalCount) {
            TemplateManager.saveCurrentTemplate();
            document.dispatchEvent(new CustomEvent('variablesChanged'));
        }
    }
    
    // Update preview
    function updatePreview() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        // For preview, use sample data from parser results or mock data
        const templateStr = template.output?.template || '';
        const fields = template.parser?.fields || [];
        
        // Create sample context from fields
        const context = {};
        fields.forEach(f => {
            context[f.id] = `{Sample ${f.label}}`;
        });
        
        // Add module defaults (for color-picker and other modules with defaults)
        (template.modules || []).forEach(mod => {
            if (mod.linkedField && mod.defaultValue) {
                context[mod.linkedField] = mod.defaultValue;
            }
            if (mod.options?.variableName && mod.defaultValue) {
                context[mod.options.variableName] = mod.defaultValue;
            }
        });
        
        // Get actual data if available (overrides defaults)
        const templateId = TemplateManager.getCurrentTemplateId();
        if (templateId) {
            const data = DataStore.getTemplateData(templateId);
            if (data.entries.length > 0) {
                Object.assign(context, data.entries[0]);
            }
        }
        
        const rendered = render(templateStr, context);
        
        elements.outputCode().value = rendered;
        elements.outputPreview().innerHTML = bbcodeToHtml(rendered);
    }
    
    // Main render function
    function render(template, context) {
        if (!template) return '';
        
        let result = template;
        
        // Process LOOPs first
        result = processLoops(result, context);
        
        // Process IFs
        result = processConditions(result, context);
        
        // Replace variables
        result = replaceVariables(result, context);
        
        return result;
    }
    
    // Process LOOP blocks
    function processLoops(template, context) {
        const loopRegex = /<!--LOOP:(\w+)-->([\s\S]*?)<!--\/LOOP:\1-->/g;
        
        return template.replace(loopRegex, (match, arrayName, content) => {
            const array = context[arrayName];
            if (!Array.isArray(array) || array.length === 0) return '';
            
            return array.map(item => {
                // Create item context with item. prefix support
                const itemContext = { ...context };
                
                // Add item properties with both direct and prefixed access
                if (typeof item === 'object') {
                    Object.keys(item).forEach(key => {
                        itemContext[key] = item[key];
                        itemContext[`item.${key}`] = item[key];
                    });
                }
                
                let itemResult = content;
                itemResult = processConditions(itemResult, itemContext);
                itemResult = replaceVariables(itemResult, itemContext);
                
                return itemResult;
            }).join('');
        });
    }
    
    // Process IF blocks
    function processConditions(template, context) {
        const ifRegex = /<!--IF:([^>]+)-->([\s\S]*?)<!--\/IF:\1-->/g;
        
        return template.replace(ifRegex, (match, condition, content) => {
            const value = resolveValue(condition, context);
            
            // Falsy check
            if (!value || value === '' || value === 'false' || value === '0' || 
                (Array.isArray(value) && value.length === 0)) {
                return '';
            }
            
            // Recursively process nested conditions
            return processConditions(content, context);
        });
    }
    
    // Replace variables
    function replaceVariables(template, context) {
        return template.replace(/\{([^}]+)\}/g, (match, varName) => {
            const value = resolveValue(varName, context);
            return value !== undefined && value !== null ? String(value) : match;
        });
    }
    
    // Resolve value from context (supports dot notation)
    function resolveValue(path, context) {
        const parts = path.split('.');
        let value = context;
        
        for (const part of parts) {
            if (value === undefined || value === null) return undefined;
            value = value[part];
        }
        
        return value;
    }
    
    // Convert BBCode to HTML for preview
    function bbcodeToHtml(bbcode) {
        if (!bbcode) return '<p class="empty-message">No output to preview</p>';
        
        let html = bbcode;
        
        // Escape HTML first
        html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        
        // BBCode replacements
        const replacements = [
            [/\[b\](.*?)\[\/b\]/gi, '<strong>$1</strong>'],
            [/\[i\](.*?)\[\/i\]/gi, '<em>$1</em>'],
            [/\[u\](.*?)\[\/u\]/gi, '<u>$1</u>'],
            [/\[s\](.*?)\[\/s\]/gi, '<s>$1</s>'],
            [/\[url=(.*?)\](.*?)\[\/url\]/gi, '<a href="$1" style="color:#6366f1;">$2</a>'],
            [/\[url\](.*?)\[\/url\]/gi, '<a href="$1" style="color:#6366f1;">$1</a>'],
            [/\[color=([^\]]+)\](.*?)\[\/color\]/gi, '<span style="color:$1;">$2</span>'],
            [/\[size=(\d+)\](.*?)\[\/size\]/gi, '<span style="font-size:$1%;">$2</span>'],
            [/\[spoiler="?([^"\]]*)"?\](.*?)\[\/spoiler\]/gis, '<details><summary style="cursor:pointer;color:#6366f1;">$1</summary><div style="padding:8px;background:#1a1a24;border-radius:4px;margin-top:4px;">$2</div></details>'],
            [/\[code\](.*?)\[\/code\]/gis, '<pre style="background:#0f0f14;padding:8px;border-radius:4px;overflow-x:auto;"><code>$1</code></pre>'],
            [/\[code=([^\]]+)\](.*?)\[\/code\]/gis, '<pre style="background:#0f0f14;padding:8px;border-radius:4px;overflow-x:auto;"><code>$2</code></pre>'],
            [/\[quote\](.*?)\[\/quote\]/gis, '<blockquote style="border-left:3px solid #6366f1;padding-left:12px;margin:8px 0;color:#a0a0b0;">$1</blockquote>'],
            [/\n/g, '<br>']
        ];
        
        for (const [pattern, replacement] of replacements) {
            html = html.replace(pattern, replacement);
        }
        
        return `<div style="font-family:inherit;line-height:1.6;">${html}</div>`;
    }
    
    // Utility: debounce
    function debounce(fn, delay) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), delay);
        };
    }
    
    return {
        init,
        render,
        updatePreview,
        bbcodeToHtml,
        // Aliases for UseMode compatibility
        generateOutput: render,
        renderBBCodeToHTML: bbcodeToHtml
    };
})();
