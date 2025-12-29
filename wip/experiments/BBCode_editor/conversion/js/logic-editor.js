/**
 * Logic Flow Editor - Node-based visual editor (V1 Simplified)
 */
const LogicEditor = (function() {
    
    // Node type definitions
    const NODE_TYPES = {
        input: { icon: '📥', title: 'Input', color: '#22c55e', outputs: ['data'] },
        parser: { icon: '⚙️', title: 'Parser', color: '#f59e0b', inputs: ['text'], outputs: ['fields'] },
        transform: { icon: '🔄', title: 'Transform', color: '#8b5cf6', inputs: ['in'], outputs: ['out'] },
        output: { icon: '📤', title: 'Output', color: '#ef4444', inputs: ['data'] }
    };
    
    // DOM Elements
    const elements = {
        canvas: () => document.getElementById('logic-canvas'),
        nodesContainer: () => document.getElementById('nodes-container'),
        connectionsSvg: () => document.getElementById('connections-svg'),
        clearBtn: () => document.getElementById('clear-logic-btn'),
        autoLayoutBtn: () => document.getElementById('auto-layout-btn'),
        nodePalette: () => document.querySelector('.node-palette')
    };
    
    let nodes = [];
    let connections = [];
    let selectedNode = null;
    let draggingNode = null;
    let dragOffset = { x: 0, y: 0 };
    let connectingFrom = null;
    
    // Initialize
    function init() {
        bindEvents();
        
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
    }
    
    // Bind events
    function bindEvents() {
        // Add node buttons
        elements.nodePalette()?.querySelectorAll('.node-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const type = btn.dataset.nodeType;
                if (type) addNode(type);
            });
        });
        
        // Clear all
        elements.clearBtn()?.addEventListener('click', clearAll);
        
        // Auto layout
        elements.autoLayoutBtn()?.addEventListener('click', autoLayout);
        
        // Canvas events
        const canvas = elements.canvas();
        if (canvas) {
            canvas.addEventListener('mouseup', handleCanvasMouseUp);
            canvas.addEventListener('mousemove', handleCanvasMouseMove);
        }
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        nodes = template.logicFlow?.nodes || [];
        connections = template.logicFlow?.connections || [];
        render();
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        nodes = [];
        connections = [];
        render();
    }
    
    // Add new node
    function addNode(type) {
        const typeInfo = NODE_TYPES[type];
        if (!typeInfo) return;
        
        // Position in center of visible area
        const canvas = elements.canvas();
        const rect = canvas?.getBoundingClientRect();
        
        const node = {
            id: 'node_' + Date.now(),
            type: type,
            x: (rect?.width || 400) / 2 - 90 + Math.random() * 100,
            y: 100 + nodes.length * 120,
            config: {}
        };
        
        nodes.push(node);
        saveAndRender();
    }
    
    // Render all nodes and connections
    function render() {
        const container = elements.nodesContainer();
        const svg = elements.connectionsSvg();
        if (!container || !svg) return;
        
        // Render empty state
        if (nodes.length === 0) {
            container.innerHTML = `
                <div class="logic-empty">
                    <div class="logic-empty-icon">🔗</div>
                    <p>Add nodes from the toolbar to create a logic flow</p>
                </div>
            `;
            svg.innerHTML = '';
            return;
        }
        
        // Render nodes
        container.innerHTML = nodes.map(node => renderNode(node)).join('');
        
        // Bind node events
        container.querySelectorAll('.logic-node').forEach(nodeEl => {
            const nodeId = nodeEl.dataset.nodeId;
            
            // Header drag
            const header = nodeEl.querySelector('.node-header');
            header?.addEventListener('mousedown', (e) => startDrag(e, nodeId));
            
            // Delete button
            nodeEl.querySelector('.node-delete')?.addEventListener('click', () => deleteNode(nodeId));
            
            // Select
            nodeEl.addEventListener('click', (e) => {
                if (!e.target.closest('.node-delete') && !e.target.closest('.port-dot')) {
                    selectNode(nodeId);
                }
            });
            
            // Port connections
            nodeEl.querySelectorAll('.port-dot').forEach(port => {
                port.addEventListener('mousedown', (e) => startConnection(e, nodeId, port.dataset.port, port.dataset.direction));
            });
        });
        
        // Render connections
        renderConnections();
    }
    
    // Render single node
    function renderNode(node) {
        const typeInfo = NODE_TYPES[node.type];
        if (!typeInfo) return '';
        
        const isSelected = selectedNode === node.id;
        
        // Build ports HTML
        let inputPorts = '';
        let outputPorts = '';
        
        if (typeInfo.inputs) {
            inputPorts = typeInfo.inputs.map(p => `
                <div class="port port-input">
                    <span class="port-dot" data-port="${p}" data-direction="input"></span>
                    <span>${p}</span>
                </div>
            `).join('');
        }
        
        if (typeInfo.outputs) {
            outputPorts = typeInfo.outputs.map(p => `
                <div class="port port-output">
                    <span>${p}</span>
                    <span class="port-dot" data-port="${p}" data-direction="output"></span>
                </div>
            `).join('');
        }
        
        return `
            <div class="logic-node ${node.type}-node ${isSelected ? 'selected' : ''}" 
                 data-node-id="${node.id}"
                 style="left: ${node.x}px; top: ${node.y}px;">
                <div class="node-header">
                    <span class="node-icon">${typeInfo.icon}</span>
                    <span class="node-title">${typeInfo.title}</span>
                    <button class="node-delete" title="Delete">×</button>
                </div>
                <div class="node-content">
                    ${renderNodeContent(node)}
                </div>
                ${(inputPorts || outputPorts) ? `
                <div class="node-ports">
                    <div class="port-group">${inputPorts}</div>
                    <div class="port-group">${outputPorts}</div>
                </div>
                ` : ''}
            </div>
        `;
    }
    
    // Render node-specific content
    function renderNodeContent(node) {
        switch (node.type) {
            case 'input':
                return `
                    <div class="node-field">
                        <label>Source</label>
                        <select data-config="source">
                            <option value="paste" ${node.config?.source === 'paste' ? 'selected' : ''}>Paste Area</option>
                            <option value="file" ${node.config?.source === 'file' ? 'selected' : ''}>File Drop</option>
                        </select>
                    </div>
                `;
            case 'parser':
                return `
                    <div class="node-field">
                        <label>Uses template parser</label>
                    </div>
                `;
            case 'transform':
                return `
                    <div class="node-field">
                        <label>Operation</label>
                        <select data-config="operation">
                            <option value="uppercase" ${node.config?.operation === 'uppercase' ? 'selected' : ''}>Uppercase</option>
                            <option value="lowercase" ${node.config?.operation === 'lowercase' ? 'selected' : ''}>Lowercase</option>
                            <option value="trim" ${node.config?.operation === 'trim' ? 'selected' : ''}>Trim</option>
                        </select>
                    </div>
                `;
            case 'output':
                return `
                    <div class="node-field">
                        <label>Target</label>
                        <select data-config="target">
                            <option value="template" ${node.config?.target === 'template' ? 'selected' : ''}>To Template</option>
                            <option value="preview" ${node.config?.target === 'preview' ? 'selected' : ''}>Preview Only</option>
                        </select>
                    </div>
                `;
            default:
                return '';
        }
    }
    
    // Render connections
    function renderConnections() {
        const svg = elements.connectionsSvg();
        if (!svg) return;
        
        svg.innerHTML = connections.map(conn => {
            const fromNode = document.querySelector(`[data-node-id="${conn.fromNode}"]`);
            const toNode = document.querySelector(`[data-node-id="${conn.toNode}"]`);
            
            if (!fromNode || !toNode) return '';
            
            const fromPort = fromNode.querySelector(`.port-dot[data-port="${conn.fromPort}"][data-direction="output"]`);
            const toPort = toNode.querySelector(`.port-dot[data-port="${conn.toPort}"][data-direction="input"]`);
            
            if (!fromPort || !toPort) return '';
            
            const fromRect = fromPort.getBoundingClientRect();
            const toRect = toPort.getBoundingClientRect();
            const canvasRect = svg.getBoundingClientRect();
            
            const x1 = fromRect.left + fromRect.width/2 - canvasRect.left;
            const y1 = fromRect.top + fromRect.height/2 - canvasRect.top;
            const x2 = toRect.left + toRect.width/2 - canvasRect.left;
            const y2 = toRect.top + toRect.height/2 - canvasRect.top;
            
            // Bezier curve
            const cx = (x1 + x2) / 2;
            
            return `<path class="connection-line" d="M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}" data-from="${conn.fromNode}" data-to="${conn.toNode}"/>`;
        }).join('');
    }
    
    // Start dragging node
    function startDrag(e, nodeId) {
        e.preventDefault();
        draggingNode = nodeId;
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            dragOffset = { x: e.clientX - node.x, y: e.clientY - node.y };
        }
        
        document.addEventListener('mousemove', handleDrag);
        document.addEventListener('mouseup', stopDrag);
    }
    
    function handleDrag(e) {
        if (!draggingNode) return;
        const node = nodes.find(n => n.id === draggingNode);
        if (node) {
            node.x = e.clientX - dragOffset.x;
            node.y = e.clientY - dragOffset.y;
            
            const nodeEl = document.querySelector(`[data-node-id="${draggingNode}"]`);
            if (nodeEl) {
                nodeEl.style.left = node.x + 'px';
                nodeEl.style.top = node.y + 'px';
            }
            
            renderConnections();
        }
    }
    
    function stopDrag() {
        if (draggingNode) {
            save();
        }
        draggingNode = null;
        document.removeEventListener('mousemove', handleDrag);
        document.removeEventListener('mouseup', stopDrag);
    }
    
    // Connection handling
    function startConnection(e, nodeId, portName, direction) {
        e.stopPropagation();
        if (direction === 'output') {
            connectingFrom = { nodeId, portName };
        }
    }
    
    function handleCanvasMouseMove(e) {
        // Could draw temp connection line here
    }
    
    function handleCanvasMouseUp(e) {
        if (connectingFrom) {
            // Check if dropped on an input port
            const target = e.target;
            if (target.classList.contains('port-dot') && target.dataset.direction === 'input') {
                const toNodeId = target.closest('.logic-node').dataset.nodeId;
                const toPort = target.dataset.port;
                
                // Don't connect to self
                if (toNodeId !== connectingFrom.nodeId) {
                    // Check if connection already exists
                    const exists = connections.find(c => 
                        c.fromNode === connectingFrom.nodeId && 
                        c.fromPort === connectingFrom.portName &&
                        c.toNode === toNodeId &&
                        c.toPort === toPort
                    );
                    
                    if (!exists) {
                        connections.push({
                            fromNode: connectingFrom.nodeId,
                            fromPort: connectingFrom.portName,
                            toNode: toNodeId,
                            toPort: toPort
                        });
                        saveAndRender();
                    }
                }
            }
            connectingFrom = null;
        }
    }
    
    // Select node
    function selectNode(nodeId) {
        selectedNode = nodeId;
        render();
    }
    
    // Delete node
    function deleteNode(nodeId) {
        nodes = nodes.filter(n => n.id !== nodeId);
        connections = connections.filter(c => c.fromNode !== nodeId && c.toNode !== nodeId);
        if (selectedNode === nodeId) selectedNode = null;
        saveAndRender();
    }
    
    // Clear all
    function clearAll() {
        if (confirm('Clear all nodes and connections?')) {
            nodes = [];
            connections = [];
            selectedNode = null;
            saveAndRender();
        }
    }
    
    // Auto layout
    function autoLayout() {
        const startY = 50;
        const startX = 100;
        const spacingX = 220;
        const spacingY = 150;
        
        // Group by type for ordering
        const typeOrder = ['input', 'parser', 'transform', 'output'];
        const sorted = [...nodes].sort((a, b) => typeOrder.indexOf(a.type) - typeOrder.indexOf(b.type));
        
        sorted.forEach((node, i) => {
            node.x = startX + (typeOrder.indexOf(node.type) * spacingX);
            node.y = startY + (i % 3) * spacingY;
        });
        
        saveAndRender();
    }
    
    // Save to template
    function save() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) return;
        
        template.logicFlow = { nodes, connections };
        TemplateManager.saveCurrentTemplate();
    }
    
    function saveAndRender() {
        save();
        render();
    }
    
    return {
        init,
        NODE_TYPES
    };
})();
