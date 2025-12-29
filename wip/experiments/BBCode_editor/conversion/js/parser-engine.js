/**
 * Parser Engine V2 - Smart parser with Nth occurrence matching and parser variants
 * Features:
 * - Nth occurrence pattern matching (e.g., "4th [ to ]")
 * - Parser variants for different input types
 * - Auto-detection of best matching variant
 * - Count occurrences utility
 * - Regex and before/after pattern support
 */
const ParserEngine = (function() {
    
    // DOM Elements
    const elements = {
        sampleText: () => document.getElementById('sample-text'),
        fieldsList: () => document.getElementById('fields-list'),
        parserResults: () => document.getElementById('parser-results'),
        testBtn: () => document.getElementById('test-parser-btn'),
        addFieldBtn: () => document.getElementById('add-field-btn'),
        fieldModal: () => document.getElementById('field-modal'),
        fieldForm: () => document.getElementById('field-form'),
        fieldName: () => document.getElementById('field-name'),
        fieldLabel: () => document.getElementById('field-label'),
        fieldIsPrimary: () => document.getElementById('field-is-primary'),
        selectedPreview: () => document.getElementById('selected-text-preview'),
        patternPreview: () => document.getElementById('pattern-preview'),
        patternMode: () => document.getElementById('pattern-mode'),
        patternBefore: () => document.getElementById('pattern-before'),
        patternAfter: () => document.getElementById('pattern-after'),
        patternRegex: () => document.getElementById('pattern-regex'),
        patternOccurrence: () => document.getElementById('pattern-occurrence'),
        patternNthSettings: () => document.getElementById('pattern-nth-settings'),
        patternRegexSettings: () => document.getElementById('pattern-regex-settings'),
        sampleTextModal: () => document.getElementById('modal-sample-text'),
        primaryKeyInfo: () => document.getElementById('primary-key-info'),
        variantSelector: () => document.getElementById('parser-variant-selector'),
        addVariantBtn: () => document.getElementById('add-variant-btn')
    };
    
    let currentSelection = null;
    let editingFieldIndex = -1;
    let activeVariantId = null;
    
    // Common delimiters for pattern detection (ordered by specificity)
    const DELIMITERS = [
        // BBCode tags (most specific)
        '[b]', '[/b]', '[i]', '[/i]', '[u]', '[/u]',
        '[url=', '[/url]', '[color=', '[/color]', '[size=', '[/size]',
        '[spoiler=', '[/spoiler]', '[code', '[/code]',
        // Semantic patterns
        'Branch:', 'Build ', 'Version:', 'Manifest ',
        // Common brackets/delimiters
        '[', ']', '(', ')', '{', '}', '<', '>',
        // Other common separators
        ' - ', ': ', ' | ', '\n', '\r\n'
    ];
    
    // Initialize
    function init() {
        bindEvents();
        document.addEventListener('templateLoaded', handleTemplateLoaded);
        document.addEventListener('templateUnloaded', handleTemplateUnloaded);
    }
    
    // Bind events
    function bindEvents() {
        // Parser test and add field buttons
        elements.testBtn()?.addEventListener('click', testParser);
        elements.addFieldBtn()?.addEventListener('click', handleAddField);
        elements.fieldForm()?.addEventListener('submit', handleFieldFormSubmit);
        elements.sampleText()?.addEventListener('mouseup', handleTextSelection);
        elements.sampleText()?.addEventListener('input', debounce(() => {
            const template = TemplateManager.getCurrentTemplate();
            const variant = getActiveVariant(template);
            if (variant) {
                variant.sampleText = elements.sampleText().value;
                TemplateManager.saveCurrentTemplate();
            }
        }, 500));
        
        // Variant selector and controls - use event delegation on document
        // to ensure they work even if template isn't loaded yet
        elements.variantSelector()?.addEventListener('change', handleVariantChange);
        
        // Use click delegation for variant buttons
        document.addEventListener('click', function(e) {
            // Add Variant button
            if (e.target.matches('#add-variant-btn')) {
                handleAddVariant();
            }
            // Edit variant rules button  
            if (e.target.matches('#edit-variant-btn')) {
                handleEditVariantRules();
            }
            // Delete variant button
            if (e.target.matches('#delete-variant-btn')) {
                handleDeleteVariant();
            }
            // Add rule button
            if (e.target.matches('#add-rule-btn')) {
                addRuleRow();
            }
            // Save rules button
            if (e.target.matches('#save-rules-btn')) {
                saveVariantRules();
            }
        });
        
        // Pattern mode selector - toggle visibility of settings
        elements.patternMode()?.addEventListener('change', handlePatternModeChange);
    }
    
    // Handle pattern mode change - show/hide relevant settings
    function handlePatternModeChange(e) {
        const mode = e.target.value;
        const nthSettings = elements.patternNthSettings();
        const regexSettings = elements.patternRegexSettings();
        
        if (!nthSettings || !regexSettings) return;
        
        switch (mode) {
            case 'auto':
            case 'nth':
                nthSettings.classList.remove('hidden');
                regexSettings.classList.add('hidden');
                break;
            case 'simple':
                nthSettings.classList.remove('hidden');
                regexSettings.classList.add('hidden');
                // Hide occurrence input for simple mode
                if (elements.patternOccurrence()) {
                    elements.patternOccurrence().parentElement.style.display = 'none';
                }
                break;
            case 'regex':
                nthSettings.classList.add('hidden');
                regexSettings.classList.remove('hidden');
                break;
        }
        
        // Re-show occurrence for non-simple modes
        if (mode !== 'simple' && elements.patternOccurrence()) {
            elements.patternOccurrence().parentElement.style.display = '';
        }
    }
    
    // Get active parser variant
    function getActiveVariant(template) {
        if (!template?.parser?.variants) return null;
        return template.parser.variants.find(v => v.id === activeVariantId) 
            || template.parser.variants[0];
    }
    
    // Handle template loaded
    function handleTemplateLoaded(e) {
        const { template } = e.detail;
        
        // Ensure parser has variants structure
        if (!template.parser) {
            template.parser = { variants: [], defaultVariant: null };
        }
        if (!template.parser.variants) {
            // Migrate old single-parser format to variants
            template.parser.variants = [{
                id: 'default',
                name: 'Default Parser',
                detectionRules: [],
                sampleText: template.parser.sampleText || '',
                fields: template.parser.fields || []
            }];
            template.parser.defaultVariant = 'default';
            delete template.parser.sampleText;
            delete template.parser.fields;
            TemplateManager.saveCurrentTemplate();
        }
        
        // Ensure at least one variant exists
        if (template.parser.variants.length === 0) {
            template.parser.variants.push({
                id: 'default',
                name: 'Default Parser',
                detectionRules: [],
                sampleText: '',
                fields: []
            });
            template.parser.defaultVariant = 'default';
            TemplateManager.saveCurrentTemplate();
        }
        
        // Set active variant
        activeVariantId = template.parser.defaultVariant || template.parser.variants[0]?.id;
        
        renderVariantSelector(template);
        loadVariantData(template);
    }
    
    // Render variant dropdown
    function renderVariantSelector(template) {
        const selector = elements.variantSelector();
        if (!selector) return;
        
        selector.innerHTML = template.parser.variants.map(v => 
            `<option value="${v.id}" ${v.id === activeVariantId ? 'selected' : ''}>${escapeHtml(v.name)}</option>`
        ).join('');
    }
    
    // Load variant data into UI
    function loadVariantData(template) {
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        elements.sampleText().value = variant.sampleText || '';
        renderFieldsList(variant.fields || []);
        
        if (variant.fields?.length > 0) {
            testParser();
        } else {
            showParserHelp();
        }
    }
    
    // Show parser help
    function showParserHelp() {
        elements.parserResults().innerHTML = `
            <div class="parser-help">
                <h4>🎯 Smart Parser Guide</h4>
                <ol>
                    <li>Paste sample text in the left panel</li>
                    <li>Click "+ Add Field" to create extraction rules</li>
                    <li>In the modal, <strong>select text</strong> to auto-detect smart patterns</li>
                    <li>The parser uses <strong>Nth occurrence</strong> matching for accuracy</li>
                    <li>Click "Test Parser" to verify extraction</li>
                </ol>
                <div class="parser-tips">
                    <strong>💡 Smart Features:</strong>
                    <ul>
                        <li>Automatically detects "the 4th [ to ]" type patterns</li>
                        <li>Supports BBCode tags, brackets, and custom delimiters</li>
                        <li>Use regex override for complex patterns</li>
                    </ul>
                </div>
            </div>
        `;
    }
    
    // Handle variant change
    function handleVariantChange(e) {
        activeVariantId = e.target.value;
        const template = TemplateManager.getCurrentTemplate();
        if (template) {
            template.parser.defaultVariant = activeVariantId;
            TemplateManager.saveCurrentTemplate();
            loadVariantData(template);
        }
    }
    
    // Handle add variant
    function handleAddVariant() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) {
            alert('Please select or create a template first.');
            return;
        }
        
        const name = prompt('Enter variant name (e.g., "BBCode Re-import"):');
        if (!name) return;
        
        const id = 'variant_' + Date.now();
        template.parser.variants.push({
            id,
            name,
            detectionRules: [],
            sampleText: '',
            fields: []
        });
        activeVariantId = id;
        template.parser.defaultVariant = id;
        TemplateManager.saveCurrentTemplate();
        
        renderVariantSelector(template);
        loadVariantData(template);
    }
    
    // Handle delete variant
    function handleDeleteVariant() {
        const template = TemplateManager.getCurrentTemplate();
        if (!template) {
            alert('Please select or create a template first.');
            return;
        }
        
        const variants = template.parser.variants;
        if (variants.length <= 1) {
            alert('Cannot delete the only parser variant.');
            return;
        }
        
        const variant = getActiveVariant(template);
        if (!confirm(`Delete variant "${variant.name}"?`)) return;
        
        const index = variants.findIndex(v => v.id === activeVariantId);
        variants.splice(index, 1);
        activeVariantId = variants[0]?.id;
        template.parser.defaultVariant = activeVariantId;
        
        TemplateManager.saveCurrentTemplate();
        renderVariantSelector(template);
        loadVariantData(template);
    }
    
    // Handle edit variant rules
    function handleEditVariantRules() {
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        renderRulesList(variant.detectionRules || []);
        document.getElementById('variant-rules-modal')?.classList.remove('hidden');
    }
    
    // Render rules list
    function renderRulesList(rules) {
        const container = document.getElementById('rules-list');
        if (!container) return;
        
        if (rules.length === 0) {
            container.innerHTML = '<p class="rules-empty">No detection rules. Add rules to auto-detect this variant.</p>';
            return;
        }
        
        container.innerHTML = rules.map((rule, index) => `
            <div class="rule-item" data-index="${index}">
                <div class="rule-type">
                    <select>
                        <option value="contains" ${rule.type === 'contains' ? 'selected' : ''}>Contains</option>
                        <option value="regex" ${rule.type === 'regex' ? 'selected' : ''}>Regex</option>
                    </select>
                </div>
                <div class="rule-value">
                    <input type="text" value="${escapeHtml(rule.value)}" placeholder="e.g., Depots & Manifests">
                </div>
                <button class="rule-delete" title="Delete rule">🗑️</button>
            </div>
        `).join('');
        
        // Bind delete buttons
        container.querySelectorAll('.rule-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.target.closest('.rule-item').remove();
            });
        });
    }
    
    // Add new rule row
    function addRuleRow() {
        const container = document.getElementById('rules-list');
        if (!container) return;
        
        // Remove empty message if present
        const emptyMsg = container.querySelector('.rules-empty');
        if (emptyMsg) emptyMsg.remove();
        
        const ruleDiv = document.createElement('div');
        ruleDiv.className = 'rule-item';
        ruleDiv.innerHTML = `
            <div class="rule-type">
                <select>
                    <option value="contains" selected>Contains</option>
                    <option value="regex">Regex</option>
                </select>
            </div>
            <div class="rule-value">
                <input type="text" value="" placeholder="e.g., Depots & Manifests">
            </div>
            <button class="rule-delete" title="Delete rule">🗑️</button>
        `;
        
        ruleDiv.querySelector('.rule-delete').addEventListener('click', () => ruleDiv.remove());
        container.appendChild(ruleDiv);
    }
    
    // Save variant rules
    function saveVariantRules() {
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        const container = document.getElementById('rules-list');
        const ruleItems = container.querySelectorAll('.rule-item');
        
        const rules = [];
        ruleItems.forEach(item => {
            const type = item.querySelector('select').value;
            const value = item.querySelector('input').value.trim();
            if (value) {
                rules.push({ type, value });
            }
        });
        
        variant.detectionRules = rules;
        TemplateManager.saveCurrentTemplate();
        
        document.getElementById('variant-rules-modal')?.classList.add('hidden');
    }
    
    // Handle template unloaded
    function handleTemplateUnloaded() {
        elements.sampleText().value = '';
        elements.fieldsList().innerHTML = '<p class="empty-message">No fields defined yet.</p>';
        elements.parserResults().innerHTML = '<p class="empty-message">Add fields and click "Test Parser".</p>';
        activeVariantId = null;
    }
    
    // Render fields list with pattern info
    function renderFieldsList(fields) {
        const container = elements.fieldsList();
        if (!container) return;
        
        if (fields.length === 0) {
            container.innerHTML = '<p class="empty-message">No fields defined yet. Click "+ Add Field" to start.</p>';
            return;
        }
        
        container.innerHTML = fields.map((field, index) => {
            const patternDesc = getPatternDescription(field.pattern);
            return `
                <div class="field-item ${field.isPrimaryKey ? 'primary-key' : ''}" data-index="${index}">
                    <div class="field-info">
                        <span class="field-id">
                            {${field.id}}
                            ${field.isPrimaryKey ? '<span class="primary-badge" title="Primary Key">🔑 KEY</span>' : ''}
                        </span>
                        <span class="field-label">${escapeHtml(field.label)}</span>
                        <span class="field-pattern" title="${escapeHtml(patternDesc.full)}">${escapeHtml(patternDesc.short)}</span>
                    </div>
                    <div class="field-actions">
                        <button class="btn btn-sm btn-secondary field-edit" title="Edit">✏️</button>
                        <button class="btn btn-sm btn-danger field-delete" title="Delete">🗑️</button>
                    </div>
                </div>
            `;
        }).join('');
        
        // Bind field action events
        container.querySelectorAll('.field-edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.closest('.field-item').dataset.index);
                editField(index);
            });
        });
        
        container.querySelectorAll('.field-delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const index = parseInt(e.target.closest('.field-item').dataset.index);
                deleteField(index);
            });
        });
    }
    
    // Get human-readable pattern description
    function getPatternDescription(pattern) {
        if (!pattern) return { short: 'No pattern', full: 'No pattern defined' };
        
        if (pattern.regex) {
            return { short: `Regex: ${pattern.regex.slice(0, 20)}...`, full: `Custom regex: ${pattern.regex}` };
        }
        
        const before = pattern.before || '';
        const after = pattern.after || '';
        const occurrence = pattern.occurrence || 1;
        
        if (occurrence > 1) {
            return {
                short: `#${occurrence} "${before}" → "${after}"`,
                full: `Occurrence #${occurrence} of "${before}" to "${after}"`
            };
        }
        
        return {
            short: `"${before}" → "${after}"`,
            full: `After "${before}" to "${after}"`
        };
    }
    
    // Handle text selection in sample text
    function handleTextSelection() {
        const textarea = elements.sampleText();
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        if (start !== end) {
            const text = textarea.value.substring(start, end);
            const fullText = textarea.value;
            
            currentSelection = {
                text: text,
                start: start,
                end: end,
                before: fullText.substring(Math.max(0, start - 100), start),
                after: fullText.substring(end, Math.min(fullText.length, end + 100)),
                fullText: fullText
            };
        }
    }
    
    // Handle add field button
    function handleAddField() {
        editingFieldIndex = -1;
        
        // Clear form
        elements.fieldName().value = '';
        elements.fieldLabel().value = '';
        elements.fieldIsPrimary().checked = false;
        elements.patternBefore().value = '';
        elements.patternAfter().value = '';
        elements.patternRegex().value = '';
        if (elements.patternOccurrence()) elements.patternOccurrence().value = '1';
        
        // Show sample text in modal
        const sampleText = elements.sampleText()?.value || '';
        const modalSampleText = elements.sampleTextModal();
        if (modalSampleText) {
            modalSampleText.value = sampleText;
            modalSampleText.removeAttribute('readonly');
            modalSampleText.addEventListener('mouseup', handleModalTextSelection);
        }
        
        if (currentSelection && currentSelection.fullText === sampleText) {
            populateFromSelection(currentSelection);
        } else {
            currentSelection = null;
            elements.selectedPreview().innerHTML = '<em class="help-text">Select text from the sample above to auto-detect patterns</em>';
            elements.patternPreview().innerHTML = '<p class="help-text">Pattern will appear after you select text.</p>';
        }
        
        updatePrimaryKeyInfo();
        elements.fieldModal()?.classList.remove('hidden');
        
        if (!currentSelection && modalSampleText) {
            modalSampleText.focus();
        } else {
            elements.fieldName()?.focus();
        }
    }
    
    // Handle text selection in modal
    function handleModalTextSelection(e) {
        const textarea = e.target;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        
        if (start !== end) {
            const text = textarea.value.substring(start, end);
            const fullText = textarea.value;
            
            currentSelection = {
                text: text,
                start: start,
                end: end,
                before: fullText.substring(0, start),
                after: fullText.substring(end),
                fullText: fullText
            };
            
            populateFromSelection(currentSelection);
        }
    }
    
    // Populate form from selection - NOW WITH Nth OCCURRENCE
    function populateFromSelection(selection) {
        elements.selectedPreview().innerHTML = `
            <div class="selected-value">"${escapeHtml(selection.text)}"</div>
            <div class="selected-context">
                <span class="context-before">...${escapeHtml(selection.before.slice(-40))}</span>
                <span class="context-selected">${escapeHtml(selection.text)}</span>
                <span class="context-after">${escapeHtml(selection.after.slice(0, 40))}...</span>
            </div>
        `;
        
        // SMART PATTERN DETECTION with Nth occurrence
        const pattern = detectSmartPattern(selection);
        
        elements.patternBefore().value = pattern.before;
        elements.patternAfter().value = pattern.after;
        if (elements.patternOccurrence()) {
            elements.patternOccurrence().value = pattern.occurrence || 1;
        }
        
        // Show pattern preview with explanation
        const occurrenceText = pattern.occurrence > 1 
            ? `<span class="occurrence-badge">#${pattern.occurrence}</span> occurrence of` 
            : '';
        
        elements.patternPreview().innerHTML = `
            <div class="pattern-detected">
                <div class="pattern-rule">
                    <span class="pattern-label">Find ${occurrenceText}:</span>
                    <code>"${escapeHtml(pattern.before)}"</code>
                </div>
                <div class="pattern-rule">
                    <span class="pattern-label">Stop at:</span>
                    <code>"${escapeHtml(pattern.after)}"</code>
                </div>
                <div class="pattern-test">
                    <span class="pattern-label">Would extract:</span>
                    <strong class="extracted-preview">"${escapeHtml(selection.text)}"</strong>
                </div>
                ${pattern.confidence < 100 ? `<div class="pattern-warning">⚠️ Confidence: ${pattern.confidence}% - consider adjusting in advanced settings</div>` : ''}
            </div>
        `;
        
        // Auto-generate field ID
        const suggestedId = generateFieldId(selection.text);
        if (!elements.fieldName().value) {
            elements.fieldName().value = suggestedId;
        }
        if (!elements.fieldLabel().value) {
            elements.fieldLabel().value = prettifyLabel(selection.text);
        }
    }
    /**
     * SMART PATTERN DETECTION - The heart of the smart parser
     * Now respects user's selected pattern mode and is BBCode-aware
     */
    function detectSmartPattern(selection) {
        const { text, start, fullText } = selection;
        const textBefore = fullText.substring(0, start);
        const textAfter = fullText.substring(start + text.length);
        
        // Get user's selected pattern mode
        const patternMode = elements.patternMode()?.value || 'auto';
        
        // If user selected regex mode, don't auto-detect - let them set it manually
        if (patternMode === 'regex') {
            return {
                before: '',
                after: '',
                occurrence: 1,
                confidence: 50,
                mode: 'regex',
                note: 'Enter custom regex pattern'
            };
        }
        
        // Find BBCode-aware boundaries
        const beforePattern = findBestBeforePattern(textBefore, patternMode);
        const afterPattern = findBestAfterPattern(textAfter);
        
        return {
            before: beforePattern.delimiter,
            after: afterPattern.delimiter,
            occurrence: beforePattern.occurrence,
            confidence: Math.min(beforePattern.confidence, afterPattern.confidence),
            mode: patternMode
        };
    }
    
    /**
     * Find the best "before" pattern - BBCode-aware
     * Key fix: Don't grab characters that precede BBCode tags like "/" before "[b]"
     */
    function findBestBeforePattern(textBefore, mode) {
        let bestMatch = { delimiter: '', occurrence: 1, confidence: 50 };
        
        // Priority 1: Look for opening BBCode tags first (most reliable)
        // Match common tags: [b], [i], [u], [s], [url=...], [color=...], [size=...], [spoiler=...], [code]
        const bbcodeOpenMatch = textBefore.match(/(\[(?:b|i|u|s|code(?:=[^\]]*)?|url(?:=[^\]]*)?|color=[^\]]*|size=\d+|spoiler=[^\]]*)\])$/i);
        if (bbcodeOpenMatch) {
            const tag = bbcodeOpenMatch[1];
            const count = countDelimiterOccurrences(textBefore, tag);
            return {
                delimiter: tag,
                occurrence: count,
                confidence: 95
            };
        }
        
        // Priority 2: Closing BBCode tags ending at selection point
        // This handles cases like selecting text after [/b] 
        const closingTagMatch = textBefore.match(/(\[\/(?:b|i|u|s|url|color|size|spoiler|code)\]\s*)$/i);
        if (closingTagMatch) {
            const tag = closingTagMatch[1];
            const count = countDelimiterOccurrences(textBefore, tag.trim());
            return {
                delimiter: tag,
                occurrence: count,
                confidence: 90
            };
        }
        
        // Priority 3: Semantic patterns like "Version:", "Build "
        const SEMANTIC_PATTERNS = ['Version:', 'Build ', 'Branch:', 'Manifest ', 'Uploaded version:', ': ', ' - '];
        for (const pattern of SEMANTIC_PATTERNS) {
            if (textBefore.endsWith(pattern)) {
                const count = countDelimiterOccurrences(textBefore, pattern);
                return {
                    delimiter: pattern,
                    occurrence: count,
                    confidence: 90
                };
            }
            // Also check if pattern is near the end (within 3 chars)
            const idx = textBefore.lastIndexOf(pattern);
            if (idx !== -1 && textBefore.length - (idx + pattern.length) <= 3) {
                const count = countDelimiterOccurrences(textBefore, pattern);
                return {
                    delimiter: pattern,
                    occurrence: count,
                    confidence: 85
                };
            }
        }
        
        // Priority 4: Simple bracket/delimiter detection for simple mode
        if (mode === 'simple') {
            // Just find the immediate delimiter
            const simpleDelimiters = ['[', ']', '(', ')', '{', '}', '<', '>'];
            for (const delim of simpleDelimiters) {
                if (textBefore.endsWith(delim)) {
                    return {
                        delimiter: delim,
                        occurrence: 1, // Simple mode = first occurrence
                        confidence: 70
                    };
                }
            }
        }
        
        // Priority 5: Nth occurrence mode - search for best repeating delimiter
        if (mode === 'nth' || mode === 'auto') {
            for (const delimiter of DELIMITERS) {
                const idx = textBefore.lastIndexOf(delimiter);
                if (idx !== -1 && textBefore.length - (idx + delimiter.length) <= 5) {
                    const count = countDelimiterOccurrences(textBefore, delimiter);
                    const confidence = delimiter.length > 2 ? 80 : 70;
                    
                    if (confidence > bestMatch.confidence || 
                        (confidence === bestMatch.confidence && delimiter.length > bestMatch.delimiter.length)) {
                        bestMatch = {
                            delimiter: delimiter,
                            occurrence: count,
                            confidence: confidence
                        };
                    }
                }
            }
        }
        
        // Fallback: use last 10 chars
        if (!bestMatch.delimiter) {
            bestMatch = {
                delimiter: textBefore.slice(-10).trim(),
                occurrence: 1,
                confidence: 40
            };
        }
        
        return bestMatch;
    }
    
    /**
     * Find the best "after" pattern
     */
    function findBestAfterPattern(textAfter) {
        // Priority 1: Closing BBCode tag at start (most common for extracting text)
        // Match [/b], [/i], [/u], [/color], [/size], etc.
        const closingTagMatch = textAfter.match(/^(\s*)(\[\/(?:b|i|u|s|url|color|size|spoiler|code)\])/i);
        if (closingTagMatch) {
            const whitespace = closingTagMatch[1] || '';
            const tag = closingTagMatch[2];
            return {
                delimiter: whitespace + tag,
                confidence: 95
            };
        }
        
        // Priority 2: Opening BBCode tag at start (means user selected up to next tag)
        const bbcodeOpenMatch = textAfter.match(/^(\s*)(\[(?:b|i|u|s|url(?:=[^\]]*)?|color=[^\]]*|size=\d+|spoiler=[^\]]*|code)[^\]]*\]?)/i);
        if (bbcodeOpenMatch) {
            const whitespace = bbcodeOpenMatch[1] || '';
            // Just use the bracket as stop point
            return {
                delimiter: whitespace ? ' [' : '[',
                confidence: 90
            };
        }
        
        // Priority 3: Simple delimiters at start like [ or ]
        const simpleMatch = textAfter.match(/^(\s*)([\[\](){}<>])/);
        if (simpleMatch) {
            const found = (simpleMatch[1] || '') + simpleMatch[2];
            return {
                delimiter: found.trimStart() || found,
                confidence: 80
            };
        }
        
        // Priority 4: Look for common patterns within first 30 chars
        for (const delimiter of DELIMITERS) {
            const idx = textAfter.indexOf(delimiter);
            if (idx !== -1 && idx <= 30) {
                return {
                    delimiter: delimiter,
                    confidence: 75
                };
            }
        }
        
        // Fallback
        return {
            delimiter: textAfter.slice(0, 10).trim() || ']',
            confidence: 40
        };
    }
    
    // Count delimiter occurrences
    function countDelimiterOccurrences(text, delimiter) {
        let count = 0;
        let pos = 0;
        while ((pos = text.indexOf(delimiter, pos)) !== -1) {
            count++;
            pos += delimiter.length;
        }
        return Math.max(1, count);
    }
    
    // Generate field ID from text
    function generateFieldId(text) {
        const cleaned = text.replace(/[^a-zA-Z0-9\s]/g, '').trim().toLowerCase();
        if (!cleaned) return 'field' + Date.now();
        
        const words = cleaned.split(/\s+/).slice(0, 3);
        return words.map((word, i) => 
            i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
        ).join('');
    }
    
    // Prettify label
    function prettifyLabel(text) {
        const cleaned = text.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
        const words = cleaned.split(/\s+/).slice(0, 4);
        return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
    }
    
    // Update primary key info
    function updatePrimaryKeyInfo() {
        const info = elements.primaryKeyInfo();
        if (!info) return;
        
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        const hasPrimaryKey = variant?.fields?.some(f => f.isPrimaryKey);
        
        info.innerHTML = hasPrimaryKey 
            ? '<span class="info-existing">✓ Primary key is set</span>'
            : '<span class="info-needed">ℹ️ Set a primary key for data updates</span>';
    }
    
    // Handle field form submit
    function handleFieldFormSubmit(e) {
        e.preventDefault();
        
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        const occurrence = elements.patternOccurrence() 
            ? parseInt(elements.patternOccurrence().value) || 1 
            : 1;
        
        const field = {
            id: elements.fieldName().value.trim().replace(/[^a-zA-Z0-9_]/g, ''),
            label: elements.fieldLabel().value.trim(),
            isPrimaryKey: elements.fieldIsPrimary().checked,
            pattern: {
                before: elements.patternBefore().value,
                after: elements.patternAfter().value,
                occurrence: occurrence,
                regex: elements.patternRegex().value || null
            }
        };
        
        if (!field.id || !field.label) {
            alert('Please enter both Field ID and Label');
            return;
        }
        
        const fields = variant.fields || [];
        const existingIndex = fields.findIndex(f => f.id === field.id);
        
        if (editingFieldIndex === -1) {
            if (existingIndex !== -1) {
                alert('Field ID already exists!');
                return;
            }
            if (field.isPrimaryKey) {
                fields.forEach(f => f.isPrimaryKey = false);
            }
            fields.push(field);
        } else {
            if (existingIndex !== -1 && existingIndex !== editingFieldIndex) {
                alert('Field ID already exists!');
                return;
            }
            if (field.isPrimaryKey) {
                fields.forEach(f => f.isPrimaryKey = false);
            }
            fields[editingFieldIndex] = field;
        }
        
        variant.fields = fields;
        
        if (field.isPrimaryKey) {
            template.mergeConfig = template.mergeConfig || {};
            template.mergeConfig.primaryKey = field.id;
        }
        
        TemplateManager.saveCurrentTemplate();
        renderFieldsList(fields);
        
        elements.fieldModal()?.classList.add('hidden');
        currentSelection = null;
        
        testParser();
    }
    
    // Edit field
    function editField(index) {
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        const field = variant.fields[index];
        if (!field) return;
        
        editingFieldIndex = index;
        
        elements.fieldName().value = field.id;
        elements.fieldLabel().value = field.label;
        elements.fieldIsPrimary().checked = field.isPrimaryKey || false;
        elements.patternBefore().value = field.pattern?.before || '';
        elements.patternAfter().value = field.pattern?.after || '';
        elements.patternRegex().value = field.pattern?.regex || '';
        if (elements.patternOccurrence()) {
            elements.patternOccurrence().value = field.pattern?.occurrence || 1;
        }
        
        const sampleText = elements.sampleText()?.value || '';
        const modalSampleText = elements.sampleTextModal();
        if (modalSampleText) {
            modalSampleText.value = sampleText;
            modalSampleText.addEventListener('mouseup', handleModalTextSelection);
        }
        
        const patternDesc = getPatternDescription(field.pattern);
        elements.selectedPreview().innerHTML = '<em>Editing field - select new text to update pattern</em>';
        elements.patternPreview().innerHTML = `
            <div class="pattern-detected">
                <div class="pattern-rule">
                    <span class="pattern-label">Current pattern:</span>
                    <code>${escapeHtml(patternDesc.full)}</code>
                </div>
            </div>
        `;
        
        updatePrimaryKeyInfo();
        elements.fieldModal()?.classList.remove('hidden');
    }
    
    // Delete field
    function deleteField(index) {
        if (!confirm('Delete this field?')) return;
        
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        variant.fields.splice(index, 1);
        TemplateManager.saveCurrentTemplate();
        renderFieldsList(variant.fields);
        testParser();
    }
    
    // Test parser - with improved extraction
    function testParser() {
        const template = TemplateManager.getCurrentTemplate();
        const variant = getActiveVariant(template);
        if (!variant) return;
        
        const text = elements.sampleText().value;
        const fields = variant.fields || [];
        
        if (fields.length === 0) {
            showParserHelp();
            return;
        }
        
        const results = {};
        for (const field of fields) {
            const value = extractField(text, field);
            results[field.id] = { value, field };
        }
        
        renderResults(results, text);
        storeExtractedData(results, template);
    }
    
    /**
     * EXTRACT FIELD - Uses Nth occurrence matching
     */
    function extractField(text, field) {
        // Custom regex takes priority
        if (field.pattern?.regex) {
            try {
                const regex = new RegExp(field.pattern.regex);
                const match = text.match(regex);
                return match ? (match[1] || match[0]).trim() : null;
            } catch (e) {
                console.error('Invalid regex:', e);
                return null;
            }
        }
        
        const before = field.pattern?.before || '';
        const after = field.pattern?.after || '';
        const occurrence = field.pattern?.occurrence || 1;
        
        if (!before && !after) return null;
        
        // Find the Nth occurrence of the "before" pattern
        let startIdx = 0;
        if (before) {
            let found = 0;
            let pos = 0;
            while ((pos = text.indexOf(before, pos)) !== -1) {
                found++;
                if (found === occurrence) {
                    startIdx = pos + before.length;
                    break;
                }
                pos += before.length;
            }
            if (found < occurrence) return null; // Didn't find enough occurrences
        }
        
        // Find the "after" pattern
        let endIdx = text.length;
        if (after) {
            const afterIdx = text.indexOf(after, startIdx);
            if (afterIdx !== -1) endIdx = afterIdx;
        }
        
        const extracted = text.substring(startIdx, endIdx).trim();
        return extracted || null;
    }
    
    // Render parser results
    function renderResults(results, sourceText) {
        const container = elements.parserResults();
        if (!container) return;
        
        const entries = Object.entries(results);
        let successCount = 0;
        let failCount = 0;
        entries.forEach(([, r]) => { r.value ? successCount++ : failCount++; });
        
        let html = `
            <div class="results-header">
                <h4>📊 Extraction Results</h4>
                <div class="results-summary">
                    <span class="success-count">✓ ${successCount} found</span>
                    ${failCount > 0 ? `<span class="fail-count">✗ ${failCount} not found</span>` : ''}
                </div>
            </div>
            <div class="results-list">
        `;
        
        for (const [key, result] of entries) {
            const hasValue = result.value !== null;
            const isPrimary = result.field.isPrimaryKey;
            const patternDesc = getPatternDescription(result.field.pattern);
            
            html += `
                <div class="result-item ${hasValue ? 'success' : 'error'} ${isPrimary ? 'is-primary' : ''}">
                    <div class="result-header">
                        <span class="result-key">{${key}}</span>
                        ${isPrimary ? '<span class="primary-indicator">🔑 Primary Key</span>' : ''}
                        <span class="result-status">${hasValue ? '✓' : '✗'}</span>
                    </div>
                    <div class="result-body">
                        <div class="result-label">${escapeHtml(result.field.label)}</div>
                        <div class="result-pattern">${escapeHtml(patternDesc.short)}</div>
                        <div class="result-value">
                            ${hasValue 
                                ? `<code>${escapeHtml(result.value)}</code>` 
                                : '<em class="not-found">Not found - check pattern</em>'
                            }
                        </div>
                    </div>
                </div>
            `;
        }
        
        html += '</div>';
        
        if (successCount > 0) {
            html += `
                <div class="results-actions">
                    <button id="save-parsed-data" class="btn btn-success">💾 Save Extracted Data</button>
                    <span class="action-hint">Saves to template data store</span>
                </div>
            `;
        }
        
        container.innerHTML = html;
        
        document.getElementById('save-parsed-data')?.addEventListener('click', () => {
            saveExtractedData(results);
        });
    }
    
    // Store extracted data
    function storeExtractedData(results, template) {
        const data = {};
        for (const [key, result] of Object.entries(results)) {
            if (result.value !== null) {
                data[key] = result.value;
            }
        }
        template._lastExtracted = data;
    }
    
    // Save extracted data
    function saveExtractedData(results) {
        const template = TemplateManager.getCurrentTemplate();
        const templateId = TemplateManager.getCurrentTemplateId();
        if (!template || !templateId) return;
        
        const entry = {};
        for (const [key, result] of Object.entries(results)) {
            if (result.value !== null) {
                entry[key] = result.value;
            }
        }
        
        if (Object.keys(entry).length === 0) {
            alert('No data to save!');
            return;
        }
        
        DataStore.upsertEntry(templateId, entry, template);
        alert('Data saved!');
        
        document.dispatchEvent(new CustomEvent('dataSaved', { detail: { entry }}));
    }
    
    /**
     * AUTO-DETECT VARIANT based on input text
     */
    function detectVariant(inputText, template) {
        const variants = template?.parser?.variants || [];
        if (variants.length <= 1) return variants[0] || null;
        
        let bestMatch = null;
        let bestScore = 0;
        
        for (const variant of variants) {
            let score = 0;
            
            for (const rule of (variant.detectionRules || [])) {
                if (rule.type === 'contains' && inputText.includes(rule.value)) {
                    score += 1;
                } else if (rule.type === 'regex') {
                    try {
                        if (new RegExp(rule.value).test(inputText)) {
                            score += 2;
                        }
                    } catch (e) {}
                }
            }
            
            if (score > bestScore) {
                bestScore = score;
                bestMatch = variant;
            }
        }
        
        return bestMatch || variants.find(v => v.id === template.parser.defaultVariant) || variants[0];
    }
    
    // Parse text with the best matching variant
    function parse(text, template) {
        const variant = detectVariant(text, template);
        if (!variant) return {};
        
        const result = {};
        for (const field of (variant.fields || [])) {
            result[field.id] = extractField(text, field);
        }
        
        return result;
    }
    
    // Utility: count occurrences of a substring (for advanced features)
    function countSubstringOccurrences(text, substring) {
        if (!substring) return 0;
        let count = 0;
        let pos = 0;
        while ((pos = text.indexOf(substring, pos)) !== -1) {
            count++;
            pos += substring.length;
        }
        return count;
    }
    
    // Utility: escape HTML
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
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
        parse,
        extractField,
        testParser,
        detectVariant,
        countSubstringOccurrences,
        getActiveVariant,
        // Alias for UseMode compatibility  
        parseInput: parse
    };
})();
