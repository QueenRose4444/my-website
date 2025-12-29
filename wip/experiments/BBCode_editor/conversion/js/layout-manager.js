/**
 * Layout Manager - Handles UI layout customization
 */
const LayoutManager = (function() {
    
    // DOM Elements
    const elements = {
        layoutPreview: () => document.getElementById('layout-preview'),
        twoColBtn: () => document.getElementById('two-col-btn'),
        threeColBtn: () => document.getElementById('three-col-btn'),
        leftZone: () => document.querySelector('[data-zone="left"]'),
        rightZone: () => document.querySelector('[data-zone="right"]'),
        centerZone: () => document.querySelector('[data-zone="center"]')
    };
    
    let draggedItem = null;
    
    // Initialize
    function init() {
        bindEvents();
        
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
    }
    
    // Bind events
    function bindEvents() {
        // Column toggle
        elements.twoColBtn()?.addEventListener('click', () => setColumns(2));
        elements.threeColBtn()?.addEventListener('click', () => setColumns(3));
        
        // Zone drag events
        document.querySelectorAll('.layout-zone').forEach(zone => {
            zone.addEventListener('dragover', handleDragOver);
            zone.addEventListener('dragleave', handleDragLeave);
            zone.addEventListener('drop', handleDrop);
        });
        
        // Zone purpose dropdown handlers
        document.querySelectorAll('.zone-purpose').forEach(select => {
            select.addEventListener('change', (e) => {
                const zoneName = e.target.dataset.zone;
                const purpose = e.target.value;
                handleZonePurposeChange(zoneName, purpose);
            });
        });
    }
    
    // Handle zone purpose change
    function handleZonePurposeChange(zoneName, purpose) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        // Initialize layout config if needed
        if (!template.layout) template.layout = {};
        if (!template.layout.zonePurposes) template.layout.zonePurposes = {};
        if (!template.layout.zones) template.layout.zones = { left: [], right: [], center: [] };
        if (!template.modules) template.modules = [];
        
        // Remove old system modules from this zone
        const systemModulesInZone = template.modules.filter(m => 
            m.zone === zoneName && m.isSystemModule
        );
        systemModulesInZone.forEach(mod => {
            // Remove from modules array
            template.modules = template.modules.filter(m => m.id !== mod.id);
            // Remove from zone layout
            template.layout.zones[zoneName] = (template.layout.zones[zoneName] || []).filter(id => id !== mod.id);
        });
        
        // Add system modules based on purpose
        if (purpose === 'inputs') {
            addSystemModule('file-drop', zoneName, template);
            addSystemModule('raw-text-input', zoneName, template);
        } else if (purpose === 'outputs') {
            addSystemModule('output-panel', zoneName, template);
        } else if (purpose === 'preview') {
            addSystemModule('live-preview', zoneName, template);
        }
        // 'modules' purpose = no system modules added
        
        // Save the purpose
        template.layout.zonePurposes[zoneName] = purpose;
        TemplateManager.saveCurrentTemplate();
        
        // Re-render modules in zones
        ModuleSystem.renderModulesToZones(template.modules);
        
        console.log('[LayoutManager] Zone', zoneName, 'purpose set to:', purpose);
    }
    
    // Add a system module to a zone
    function addSystemModule(type, zoneName, template) {
        const typeInfo = ModuleSystem.MODULE_TYPES[type];
        if (!typeInfo) return;
        
        const module = {
            id: DataStore.generateId(),
            type: type,
            label: typeInfo.defaultLabel,
            linkedField: '',
            defaultValue: '',
            zone: zoneName,
            isSystemModule: true,  // Mark as system module
            options: {}
        };
        
        template.modules.push(module);
        
        // Add to zone layout
        if (!template.layout.zones[zoneName]) template.layout.zones[zoneName] = [];
        template.layout.zones[zoneName].push(module.id);
        
        console.log('[LayoutManager] Added system module:', type, 'to zone:', zoneName);
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        const columns = template.layout?.columns || 2;
        setColumns(columns, false);
        renderZones(template);
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        setColumns(2, false);
        clearZones();
    }
    
    // Set column count
    function setColumns(count, save = true) {
        const preview = elements.layoutPreview();
        if (!preview) return;
        
        // Update classes
        preview.classList.remove('two-columns', 'three-columns');
        preview.classList.add(count === 3 ? 'three-columns' : 'two-columns');
        
        // Update buttons
        elements.twoColBtn()?.classList.toggle('active', count === 2);
        elements.threeColBtn()?.classList.toggle('active', count === 3);
        
        // Show/hide center zone
        const centerZone = elements.centerZone();
        if (centerZone) {
            centerZone.classList.toggle('hidden', count === 2);
        }
        
        // Save to template
        if (save) {
            const template = TemplateManager.getCurrentTemplate();
            if (template) {
                template.layout.columns = count;
                TemplateManager.saveCurrentTemplate();
            }
        }
    }
    
    // Render modules in zones
    function renderZones(template) {
        const modules = template.modules || [];
        const zones = template.layout?.zones || { left: [], right: [], center: [] };
        
        // Clear all zones first
        clearZones();
        
        // Render each zone
        ['left', 'right', 'center'].forEach(zoneName => {
            const zone = document.querySelector(`[data-zone="${zoneName}"] .zone-modules`);
            if (!zone) return;
            
            const zoneModuleIds = zones[zoneName] || [];
            
            if (zoneModuleIds.length === 0) {
                zone.innerHTML = '<div class="zone-empty">Drop modules here</div>';
            } else {
                zone.innerHTML = zoneModuleIds.map(modId => {
                    const mod = modules.find(m => m.id === modId);
                    if (!mod) return '';
                    
                    const typeInfo = ModuleSystem.MODULE_TYPES[mod.type] || { icon: '❓' };
                    return `
                        <div class="zone-module-item" draggable="true" data-module-id="${mod.id}">
                            <span class="zone-module-icon">${typeInfo.icon}</span>
                            <span class="zone-module-name">${escapeHtml(mod.label)}</span>
                            <button class="zone-module-remove" title="Remove">&times;</button>
                        </div>
                    `;
                }).join('');
                
                // Bind events for items
                zone.querySelectorAll('.zone-module-item').forEach(item => {
                    item.addEventListener('dragstart', handleItemDragStart);
                    item.addEventListener('dragend', handleItemDragEnd);
                    
                    item.querySelector('.zone-module-remove')?.addEventListener('click', (e) => {
                        e.stopPropagation();
                        removeFromZone(item.dataset.moduleId, zoneName);
                    });
                });
            }
        });
        
        // Add unassigned modules indicator
        const unassigned = modules.filter(m => {
            return !zones.left.includes(m.id) && 
                   !zones.right.includes(m.id) && 
                   !zones.center.includes(m.id);
        });
        
        if (unassigned.length > 0) {
            const leftZone = document.querySelector('[data-zone="left"] .zone-modules');
            if (leftZone) {
                const unassignedHtml = unassigned.map(mod => {
                    const typeInfo = ModuleSystem.MODULE_TYPES[mod.type] || { icon: '❓' };
                    return `
                        <div class="zone-module-item" draggable="true" data-module-id="${mod.id}" style="border-style:dashed;opacity:0.7;">
                            <span class="zone-module-icon">${typeInfo.icon}</span>
                            <span class="zone-module-name">${escapeHtml(mod.label)} (unassigned)</span>
                        </div>
                    `;
                }).join('');
                
                leftZone.insertAdjacentHTML('beforeend', unassignedHtml);
                
                // Rebind events
                leftZone.querySelectorAll('.zone-module-item[style*="dashed"]').forEach(item => {
                    item.addEventListener('dragstart', handleItemDragStart);
                    item.addEventListener('dragend', handleItemDragEnd);
                });
            }
        }
    }
    
    // Clear all zones
    function clearZones() {
        document.querySelectorAll('.zone-modules').forEach(zone => {
            zone.innerHTML = '<div class="zone-empty">Drop modules here</div>';
        });
    }
    
    // Drag handlers for zone items
    function handleItemDragStart(e) {
        draggedItem = e.target.dataset.moduleId;
        e.target.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    }
    
    function handleItemDragEnd(e) {
        e.target.classList.remove('dragging');
        draggedItem = null;
    }
    
    function handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('drag-over');
    }
    
    function handleDragLeave(e) {
        e.currentTarget.classList.remove('drag-over');
    }
    
    function handleDrop(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('drag-over');
        
        if (!draggedItem) return;
        
        const zoneName = e.currentTarget.dataset.zone;
        if (!zoneName) return;
        
        addToZone(draggedItem, zoneName);
    }
    
    // Add module to zone
    function addToZone(moduleId, zoneName) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        // Remove from all zones first
        ['left', 'right', 'center'].forEach(z => {
            template.layout.zones[z] = (template.layout.zones[z] || []).filter(id => id !== moduleId);
        });
        
        // Add to target zone
        if (!template.layout.zones[zoneName]) template.layout.zones[zoneName] = [];
        template.layout.zones[zoneName].push(moduleId);
        
        TemplateManager.saveCurrentTemplate();
        renderZones(template);
    }
    
    // Remove module from zone
    function removeFromZone(moduleId, zoneName) {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        template.layout.zones[zoneName] = (template.layout.zones[zoneName] || []).filter(id => id !== moduleId);
        TemplateManager.saveCurrentTemplate();
        renderZones(template);
    }
    
    // Get layout for use mode
    function getLayoutForUseMode(template) {
        const modules = template.modules || [];
        const zones = template.layout?.zones || { left: [], right: [], center: [] };
        const columns = template.layout?.columns || 2;
        
        const result = { columns, zones: {} };
        
        ['left', 'right', 'center'].forEach(zoneName => {
            result.zones[zoneName] = (zones[zoneName] || [])
                .map(id => modules.find(m => m.id === id))
                .filter(Boolean);
        });
        
        return result;
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
        setColumns,
        getLayoutForUseMode
    };
})();
