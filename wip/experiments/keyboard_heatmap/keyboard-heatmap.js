class KeyboardTracker {
    constructor() {
        this.keyData = {};
        this.totalPresses = 0;
        this.spamMode = false;
        this.currentLayout = '100-ansi';
        this.lastKeyTime = {};
        
        this.layouts = {
            '100-ansi': {
                name: '100% ANSI (Final Corrected)',
                description: 'Standard ANSI keyboard with corrected alignment and spacing.',
                emoji: '🌏',
                // Layout is defined on a 96-unit grid. 1u = 4 units.
                // Numpad keys now have unique identifiers (e.g., Num1, Num/).
                keys: [
                    // Row 1 (Function)
                    ['Esc::4', '::4', 'F1::4', 'F2::4', 'F3::4', 'F4::4', '::2', 'F5::4', 'F6::4', 'F7::4', 'F8::4', '::2', 'F9::4', 'F10::4', 'F11::4', 'F12::4', '::4', 'PrtSc::4', 'ScrLk::4', 'Pause::4'],
                    // An empty array creates a visual gap between rows
                    [],
                    // Row 2 (Number + Nav + Numpad)
                    ['`::4', '1::4', '2::4', '3::4', '4::4', '5::4', '6::4', '7::4', '8::4', '9::4', '0::4', '-::4', '=::4', 'Backspace:wide:8', '::4', 'Ins::4', 'Home::4', 'PgUp::4', '::4', 'NumLock::4', 'Num/::4', 'Num*::4', 'Num-::4'],
                    // Row 3 (QWERTY + Nav + Numpad)
                    ['Tab:wide:6', 'Q::4', 'W::4', 'E::4', 'R::4', 'T::4', 'Y::4', 'U::4', 'I::4', 'O::4', 'P::4', '[::4', ']::4', '\\:wide:6', '::4', 'Del::4', 'End::4', 'PgDn::4', '::4', 'Num7::4', 'Num8::4', 'Num9::4', 'Num+:num-plus-tall:4'],
                    // Row 4 (ASDF + Numpad)
                    ['Caps:wide:7', 'A::4', 'S::4', 'D::4', 'F::4', 'G::4', 'H::4', 'J::4', 'K::4', 'L::4', ';::4', "'::4", 'Enter:wide:9', '::4', '::12', '::4', 'Num4::4', 'Num5::4', 'Num6::4', ''],
                    // Row 5 (ZXCV + Nav + Numpad)
                    ['ShiftLeft:extra-wide:9', 'Z::4', 'X::4', 'C::4', 'V::4', 'B::4', 'N::4', 'M::4', ',::4', '.::4', '/::4', 'ShiftRight:extra-wide:11', '::4', '::4', '↑::4', '::4', '::4', 'Num1::4', 'Num2::4', 'Num3::4', 'NumEnter:num-enter-tall:4'],
                    // Row 6 (Bottom + Nav + Numpad)
                    ['CtrlLeft::5', 'WinLeft::5', 'AltLeft::5', 'Space:spacebar:25', 'AltRight::5', 'WinRight::5', 'Menu::5', 'CtrlRight::5', '::4', '←::4', '↓::4', '→::4', '::4', 'Num0:wide:8', 'Num.::4', '']
                ]
            },
            // Other layouts remain unchanged but would need similar updates to be fully functional
            'tkl': {
                name: '80% Tenkeyless',
                description: 'Full-size without numpad - perfect for gaming',
                emoji: '🎮',
                keys: [
                    ['Esc', '', 'F1', 'F2', 'F3', 'F4', '', 'F5', 'F6', 'F7', 'F8', '', 'F9', 'F10', 'F11', 'F12', '', 'PrtSc', 'ScrLk', 'Pause'],
                    ['`', '1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '=', 'Backspace:wide', '', 'Ins', 'Home', 'PgUp'],
                    ['Tab:wide', 'Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', '[', ']', '\\', '', 'Del', 'End', 'PgDn'],
                    ['Caps:wide', 'A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'", 'Enter:wide', '', '', '', ''],
                    ['ShiftLeft:extra-wide', 'Z', 'X', 'C', 'V', 'B', 'N', 'M', ',', '.', '/', 'ShiftRight:wide', '', '', '↑', ''],
                    ['CtrlLeft', 'WinLeft', 'AltLeft', 'Space:spacebar', 'AltRight', 'WinRight', 'Menu', 'CtrlRight', '', '←', '↓', '→']
                ]
            }
        };

        this.init();
    }

    init() {
        this.setupEventListeners();
        this.renderKeyboard();
        this.updateStats();
        this.showNotification('🎉 Keyboard Tracker Loaded! Start typing to see the magic!', 3000);
    }

    setupEventListeners() {
        document.addEventListener('keydown', (e) => this.handleKeyPress(e));
        
        document.getElementById('spamToggle').addEventListener('click', () => this.toggleSpamMode());
        document.getElementById('settingsBtn').addEventListener('click', () => this.openSettings());
        document.getElementById('closeModal').addEventListener('click', () => this.closeSettings());
        
        document.querySelectorAll('.sort-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.setSortMode(e.target.dataset.sort));
        });

        document.getElementById('settingsModal').addEventListener('click', (e) => {
            if (e.target.id === 'settingsModal') this.closeSettings();
        });
    }

    handleKeyPress(e) {
        if (this.spamMode) {
            e.preventDefault();
            e.stopPropagation();
        }

        const key = this.normalizeKey(e.key, e.code, e.location);
        
        if (!this.keyData[key]) {
            this.keyData[key] = { count: 0, percentage: 0, lastUsed: Date.now() };
        }
        
        this.keyData[key].count++;
        this.keyData[key].lastUsed = Date.now();
        this.totalPresses++;
        
        this.updatePercentages();
        this.animateKeyPress(key); // Animate just the pressed key
        this.updateAllKeyVisuals(); // Update colors/percentages for ALL keys
        this.updateStats();
        this.updateHeaderStats();
    }

    normalizeKey(key, code, location) {
        // Numpad keys are identified by their 'code'
        if (code.startsWith('Numpad')) {
            const numpadMap = {
                'Numpad0': 'Num0', 'Numpad1': 'Num1', 'Numpad2': 'Num2',
                'Numpad3': 'Num3', 'Numpad4': 'Num4', 'Numpad5': 'Num5',
                'Numpad6': 'Num6', 'Numpad7': 'Num7', 'Numpad8': 'Num8',
                'Numpad9': 'Num9', 'NumpadAdd': 'Num+', 'NumpadSubtract': 'Num-',
                'NumpadMultiply': 'Num*', 'NumpadDivide': 'Num/', 'NumpadDecimal': 'Num.',
                'NumpadEnter': 'NumEnter'
            };
            return numpadMap[code] || key;
        }

        // Location-specific keys
        if (key === 'Meta' || code === 'MetaLeft' || code === 'MetaRight') return location === 1 ? 'WinLeft' : 'WinRight';
        if (key === 'Control' || code.startsWith('Control')) return location === 1 ? 'CtrlLeft' : 'CtrlRight';
        if (key === 'Alt' || code.startsWith('Alt')) return location === 1 ? 'AltLeft' : 'AltRight';
        if (key === 'Shift' || code.startsWith('Shift')) return location === 1 ? 'ShiftLeft' : 'ShiftRight';
        
        // General keys
        const keyMap = {
            ' ': 'Space', 'ArrowUp': '↑', 'ArrowDown': '↓', 'ArrowLeft': '←', 'ArrowRight': '→',
            'Enter': 'Enter', 'Backspace': 'Backspace', 'Tab': 'Tab', 'CapsLock': 'Caps',
            'Escape': 'Esc', 'Insert': 'Ins', 'Delete': 'Del', 'Home': 'Home', 'End': 'End',
            'PageUp': 'PgUp', 'PageDown': 'PgDn', 'PrintScreen': 'PrtSc', 'ScrollLock': 'ScrLk',
            'Pause': 'Pause', 'NumLock': 'NumLock', 'ContextMenu': 'Menu'
        };
        
        return keyMap[key] || key.toUpperCase();
    }

    updatePercentages() {
        if (this.totalPresses === 0) return;
        Object.keys(this.keyData).forEach(key => {
            this.keyData[key].percentage = ((this.keyData[key].count / this.totalPresses) * 100);
        });
    }

    animateKeyPress(key) {
        const keyElements = document.querySelectorAll(`[data-key="${key}"]`);
        keyElements.forEach(keyElement => {
            keyElement.classList.add('pressed');
            setTimeout(() => keyElement.classList.remove('pressed'), 400);
        });
    }

    updateAllKeyVisuals() {
        // This function updates the color and text for every key on the board.
        const allKeyElements = document.querySelectorAll('.key');
        allKeyElements.forEach(keyElement => {
            const keyName = keyElement.dataset.key;
            const data = this.keyData[keyName];
            
            if (data) {
                // Update percentage text
                const percentElement = keyElement.querySelector('.key-percent');
                if (percentElement) {
                    percentElement.textContent = `${data.percentage.toFixed(1)}%`;
                }
                // Update color
                this.updateKeyColor(keyElement, data.percentage);
            } else {
                // If key has no data, ensure it's in its default state
                const percentElement = keyElement.querySelector('.key-percent');
                if (percentElement) {
                    percentElement.textContent = '0.0%';
                }
                this.updateKeyColor(keyElement, 0);
            }
        });
    }

    updateKeyColor(element, percentage) {
        const percent = parseFloat(percentage) || 0;
        let gradient = 'linear-gradient(145deg, #3a3a3a, #2d2d2d)';
        
        if (percent > 0) {
            if (percent < 2) gradient = 'linear-gradient(145deg, #00ff00, #00cc00)';
            else if (percent < 5) gradient = 'linear-gradient(145deg, #80ff00, #66cc00)';
            else if (percent < 10) gradient = 'linear-gradient(145deg, #ffff00, #cccc00)';
            else if (percent < 15) gradient = 'linear-gradient(145deg, #ff8000, #cc6600)';
            else gradient = 'linear-gradient(145deg, #ff0000, #cc0000)';
        }
        
        element.style.background = gradient;
        element.style.borderColor = this.lighten(this.extractColor(gradient), 20);
    }

    extractColor(gradient) {
        const match = gradient.match(/#[a-fA-F0-9]{6}/);
        return match ? match[0] : '#3a3a3a';
    }

    lighten(color, percent) {
        const num = parseInt(color.replace("#", ""), 16);
        const amt = Math.round(2.55 * percent);
        const R = Math.min(255, (num >> 16) + amt);
        const G = Math.min(255, (num >> 8 & 0x00FF) + amt);
        const B = Math.min(255, (num & 0x0000FF) + amt);
        return "#" + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
    }

    renderKeyboard() {
        const keyboard = document.getElementById('keyboard');
        keyboard.innerHTML = '';
        const baseLayoutClass = this.currentLayout.split('-')[0];
        keyboard.className = `keyboard keyboard-${baseLayoutClass}`;
        
        const layout = this.layouts[this.currentLayout];
        
        const isModernLayout = this.currentLayout === '100-ansi';

        layout.keys.forEach(row => {
            if (isModernLayout && row.length === 0) {
                const gap = document.createElement('div');
                gap.style.gridColumn = '1 / -1';
                gap.style.height = '10px';
                keyboard.appendChild(gap);
                return;
            }

            row.forEach(keyDef => {
                if (keyDef === '') return;

                const parts = keyDef.split(':');
                const keyName = parts[0];
                const keyClass = parts[1] || '';
                const span = isModernLayout ? (parts[2] ? parseInt(parts[2], 10) : 4) : null;

                if (keyName === '') {
                    const spacer = document.createElement('div');
                    spacer.className = 'key-spacer';
                    if (isModernLayout) spacer.style.gridColumn = `span ${span}`;
                    keyboard.appendChild(spacer);
                    return;
                }
                
                const keyElement = document.createElement('div');
                keyElement.className = `key ${keyClass ? `key-${keyClass}` : ''}`;
                keyElement.dataset.key = keyName;
                if (isModernLayout) keyElement.style.gridColumn = `span ${span}`;
                
                keyElement.innerHTML = `
                    <div class="key-label">${keyName}</div>
                    <div class="key-percent">0.0%</div>
                `;
                keyboard.appendChild(keyElement);
            });
        });
        
        this.updateAllKeyVisuals();
    }

    updateHeaderStats() {
        document.getElementById('totalCount').textContent = this.totalPresses;
        document.getElementById('activeCount').textContent = Object.keys(this.keyData).length;
    }

    updateStats() {
        const tbody = document.getElementById('statsTableBody');
        const sortedKeys = this.getSortedKeys();
        
        tbody.innerHTML = sortedKeys.map(key => {
            const data = this.keyData[key] || { count: 0, percentage: 0, lastUsed: 0 };
            const barWidth = Math.min(data.percentage * 2, 100);
            const timeSince = data.lastUsed ? this.formatTimeSince(Date.now() - data.lastUsed) : 'Never';
            
            return `
                <tr style="animation: fadeIn 0.3s ease-in;">
                    <td><strong style="color: #4a90e2;">${key}</strong></td>
                    <td><span style="color: #00ff88;">${data.count}</span></td>
                    <td><span style="color: #ffaa00;">${data.percentage.toFixed(2)}%</span></td>
                    <td>
                        <div class="progress-bar">
                            <div class="progress-fill" style="width: ${barWidth}%;"></div>
                        </div>
                    </td>
                    <td><span style="color: #aaa; font-size: 11px;">${timeSince}</span></td>
                </tr>
            `;
        }).join('');
    }

    formatTimeSince(ms) {
        if (ms < 1000) return 'Just now';
        if (ms < 60000) return `${Math.floor(ms/1000)}s ago`;
        if (ms < 3600000) return `${Math.floor(ms/60000)}m ago`;
        return `${Math.floor(ms/3600000)}h ago`;
    }

    getSortedKeys() {
        const activeSort = document.querySelector('.sort-btn.active').dataset.sort;
        const allKeys = new Set([
            ...Object.keys(this.keyData),
            ...this.getAllLayoutKeys()
        ]);
        
        const keysArray = Array.from(allKeys);
        
        switch (activeSort) {
            case 'count':
                return keysArray.sort((a, b) => (this.keyData[b]?.count || 0) - (this.keyData[a]?.count || 0));
            case 'count-asc':
                return keysArray.sort((a, b) => (this.keyData[a]?.count || 0) - (this.keyData[b]?.count || 0));
            case 'percent':
                return keysArray.sort((a, b) => (this.keyData[b]?.percentage || 0) - (this.keyData[a]?.percentage || 0));
            case 'alphabetical':
                return keysArray.sort();
            case 'recent':
                return keysArray.sort((a, b) => (this.keyData[b]?.lastUsed || 0) - (this.keyData[a]?.lastUsed || 0));
            default:
                return keysArray;
        }
    }

    getAllLayoutKeys() {
        const keys = new Set();
        const layout = this.layouts[this.currentLayout];
        if (!layout) return [];

        layout.keys.forEach(row => {
            row.forEach(keyDef => {
                if (keyDef && keyDef !== '') {
                    const keyName = keyDef.split(':')[0];
                    if (keyName) keys.add(keyName);
                }
            });
        });
        return Array.from(keys);
    }

    setSortMode(mode) {
        document.querySelectorAll('.sort-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`[data-sort="${mode}"]`).classList.add('active');
        this.updateStats();
        this.showNotification(`📊 Sorted by ${mode}`, 1500);
    }

    toggleSpamMode() {
        this.spamMode = !this.spamMode;
        const button = document.getElementById('spamToggle');
        
        if (this.spamMode) {
            button.textContent = '✅ SPAM MODE ON';
            button.classList.add('active');
            document.body.style.userSelect = 'none';
            this.showNotification('🚫 Spam Mode Active! Most shortcuts blocked (Windows key still works due to browser limits)', 4000);
        } else {
            button.textContent = '🚫 SPAM MODE OFF';
            button.classList.remove('active');
            document.body.style.userSelect = '';
            this.showNotification('✅ Spam Mode Disabled', 2000);
        }
    }

    openSettings() {
        const modal = document.getElementById('settingsModal');
        const layoutGrid = document.getElementById('layoutGrid');
        
        layoutGrid.innerHTML = Object.entries(this.layouts).map(([layoutId, layout]) => `
            <div class="layout-option ${layoutId === this.currentLayout ? 'active' : ''}" 
                 data-layout="${layoutId}">
                <div class="layout-title">${layout.emoji} ${layout.name}</div>
                <div class="layout-desc">${layout.description}</div>
            </div>
        `).join('');
        
        layoutGrid.addEventListener('click', (e) => {
            const option = e.target.closest('.layout-option');
            if (option) {
                const layoutId = option.dataset.layout;
                this.setLayout(layoutId);
                
                document.querySelectorAll('.layout-option').forEach(opt => opt.classList.remove('active'));
                option.classList.add('active');
            }
        });
        
        modal.style.display = 'block';
    }

    closeSettings() {
        document.getElementById('settingsModal').style.display = 'none';
    }

    setLayout(layout) {
        this.currentLayout = layout;
        this.renderKeyboard();
        const layoutInfo = this.layouts[layout];
        this.showNotification(`⌨️ Switched to ${layoutInfo.name}`, 2000);
    }

    showNotification(text, duration = 3000) {
        const notification = document.getElementById('notification');
        const notificationText = document.getElementById('notificationText');
        
        notificationText.textContent = text;
        notification.classList.add('show');
        
        setTimeout(() => {
            notification.classList.remove('show');
        }, duration);
    }
}

// Initialize the application
new KeyboardTracker();
