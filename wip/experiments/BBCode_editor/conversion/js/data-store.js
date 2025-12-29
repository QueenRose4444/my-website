/**
 * Data Store - Manages template storage and user data per template
 */
const DataStore = (function() {
    const STORAGE_PREFIX = 'templateBuilder_';
    const TEMPLATES_KEY = STORAGE_PREFIX + 'templates';
    
    // Generate unique ID
    function generateId() {
        return 'tpl_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
    }
    
    // Get all templates metadata
    function getTemplates() {
        try {
            const data = localStorage.getItem(TEMPLATES_KEY);
            return data ? JSON.parse(data) : [];
        } catch (e) {
            console.error('Error loading templates:', e);
            return [];
        }
    }
    
    // Save templates list
    function saveTemplates(templates) {
        try {
            localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
            return true;
        } catch (e) {
            console.error('Error saving templates:', e);
            return false;
        }
    }
    
    // Get single template by ID
    function getTemplate(templateId) {
        try {
            const key = STORAGE_PREFIX + 'template_' + templateId;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : null;
        } catch (e) {
            console.error('Error loading template:', e);
            return null;
        }
    }
    
    // Save single template
    function saveTemplate(template) {
        try {
            const key = STORAGE_PREFIX + 'template_' + template.id;
            template.updatedAt = Date.now();
            localStorage.setItem(key, JSON.stringify(template));
            
            // Update templates list
            const templates = getTemplates();
            const index = templates.findIndex(t => t.id === template.id);
            const metadata = {
                id: template.id,
                name: template.name,
                createdAt: template.createdAt,
                updatedAt: template.updatedAt
            };
            
            if (index >= 0) {
                templates[index] = metadata;
            } else {
                templates.push(metadata);
            }
            saveTemplates(templates);
            return true;
        } catch (e) {
            console.error('Error saving template:', e);
            return false;
        }
    }
    
    // Create new template with defaults
    function createTemplate(name) {
        const now = Date.now();
        const template = {
            id: generateId(),
            name: name,
            version: 1,
            createdAt: now,
            updatedAt: now,
            
            // Parser configuration
            parser: {
                sampleText: '',
                fields: []
            },
            
            // Output template
            output: {
                template: ''
            },
            
            // Layout configuration
            layout: {
                columns: 2,
                zones: {
                    left: [],
                    right: [],
                    center: []
                }
            },
            
            // UI Modules
            modules: [],
            
            // Logic flow
            logicFlow: {
                nodes: [],
                connections: []
            },
            
            // Merge configuration
            mergeConfig: {
                primaryKey: '',
                rules: []
            }
        };
        
        if (saveTemplate(template)) {
            return template;
        }
        return null;
    }
    
    // Delete template
    function deleteTemplate(templateId) {
        try {
            // Remove template data
            const templateKey = STORAGE_PREFIX + 'template_' + templateId;
            const dataKey = STORAGE_PREFIX + 'data_' + templateId;
            localStorage.removeItem(templateKey);
            localStorage.removeItem(dataKey);
            
            // Update templates list
            const templates = getTemplates().filter(t => t.id !== templateId);
            saveTemplates(templates);
            return true;
        } catch (e) {
            console.error('Error deleting template:', e);
            return false;
        }
    }
    
    // Rename template
    function renameTemplate(templateId, newName) {
        const template = getTemplate(templateId);
        if (template) {
            template.name = newName;
            return saveTemplate(template);
        }
        return false;
    }
    
    // Get user data for a template
    function getTemplateData(templateId) {
        try {
            const key = STORAGE_PREFIX + 'data_' + templateId;
            const data = localStorage.getItem(key);
            return data ? JSON.parse(data) : { entries: [], lastUpdated: null };
        } catch (e) {
            console.error('Error loading template data:', e);
            return { entries: [], lastUpdated: null };
        }
    }
    
    // Save user data for a template
    function saveTemplateData(templateId, data) {
        try {
            const key = STORAGE_PREFIX + 'data_' + templateId;
            data.lastUpdated = Date.now();
            localStorage.setItem(key, JSON.stringify(data));
            return true;
        } catch (e) {
            console.error('Error saving template data:', e);
            return false;
        }
    }
    
    // Add or update entry in template data
    function upsertEntry(templateId, entry, template) {
        const data = getTemplateData(templateId);
        const primaryKey = template.mergeConfig.primaryKey;
        
        if (!primaryKey || !entry[primaryKey]) {
            // No primary key, just add as new
            entry._id = generateId();
            data.entries.push(entry);
        } else {
            // Check for existing entry
            const existingIndex = data.entries.findIndex(e => e[primaryKey] === entry[primaryKey]);
            
            if (existingIndex >= 0) {
                // Merge based on rules
                const existing = data.entries[existingIndex];
                const merged = mergeEntry(existing, entry, template.mergeConfig.rules);
                data.entries[existingIndex] = merged;
            } else {
                // Add new
                entry._id = generateId();
                data.entries.push(entry);
            }
        }
        
        return saveTemplateData(templateId, data);
    }
    
    // Merge two entries based on rules
    function mergeEntry(existing, incoming, rules) {
        const result = { ...existing };
        
        for (const key of Object.keys(incoming)) {
            if (key === '_id') continue;
            
            const rule = rules.find(r => r.field === key);
            const action = rule ? rule.action : 'replace';
            
            switch (action) {
                case 'keep':
                    // Keep original value
                    break;
                case 'merge-arrays':
                    if (Array.isArray(result[key]) && Array.isArray(incoming[key])) {
                        result[key] = [...new Set([...result[key], ...incoming[key]])];
                    } else {
                        result[key] = incoming[key];
                    }
                    break;
                case 'append':
                    if (typeof result[key] === 'string' && typeof incoming[key] === 'string') {
                        result[key] = result[key] + incoming[key];
                    } else {
                        result[key] = incoming[key];
                    }
                    break;
                case 'replace':
                default:
                    result[key] = incoming[key];
                    break;
            }
        }
        
        return result;
    }
    
    // Delete entry from template data
    function deleteEntry(templateId, entryId) {
        const data = getTemplateData(templateId);
        data.entries = data.entries.filter(e => e._id !== entryId);
        return saveTemplateData(templateId, data);
    }
    
    // Clear all entries for a template
    function clearTemplateData(templateId) {
        return saveTemplateData(templateId, { entries: [], lastUpdated: Date.now() });
    }
    
    // Export all data (templates + data)
    function exportAll() {
        const templates = getTemplates();
        const fullData = {
            exportedAt: Date.now(),
            version: 1,
            templates: templates.map(t => ({
                template: getTemplate(t.id),
                data: getTemplateData(t.id)
            }))
        };
        return fullData;
    }
    
    // Import all data
    function importAll(data) {
        if (!data || !data.templates) {
            throw new Error('Invalid import data format');
        }
        
        let imported = 0;
        for (const item of data.templates) {
            if (item.template) {
                // Generate new ID to avoid conflicts
                const newId = generateId();
                item.template.id = newId;
                item.template.createdAt = Date.now();
                
                if (saveTemplate(item.template)) {
                    if (item.data && item.data.entries) {
                        saveTemplateData(newId, item.data);
                    }
                    imported++;
                }
            }
        }
        return imported;
    }
    
    // Export single template (for sharing)
    function exportTemplate(templateId) {
        const template = getTemplate(templateId);
        if (!template) return null;
        
        return {
            exportedAt: Date.now(),
            version: 1,
            template: template
            // Note: data is NOT included in template export
        };
    }
    
    // Import single template
    function importTemplate(data) {
        if (!data || !data.template) {
            throw new Error('Invalid template format');
        }
        
        const template = data.template;
        template.id = generateId();
        template.createdAt = Date.now();
        template.updatedAt = Date.now();
        
        if (saveTemplate(template)) {
            return template;
        }
        throw new Error('Failed to save template');
    }
    
    return {
        generateId,
        getTemplates,
        getTemplate,
        saveTemplate,
        createTemplate,
        deleteTemplate,
        renameTemplate,
        getTemplateData,
        saveTemplateData,
        upsertEntry,
        deleteEntry,
        clearTemplateData,
        exportAll,
        importAll,
        exportTemplate,
        importTemplate
    };
})();
