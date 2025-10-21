document.addEventListener('DOMContentLoaded', () => {
    // --- DOM Elements ---
    const dropZone = document.getElementById('file-drop-zone');
    const fileInput = document.getElementById('file-input');
    const textInput = document.getElementById('text-input');
    const processTextBtn = document.getElementById('process-text-btn');
    const customizationPanel = document.getElementById('customization-panel');
    const gameSelector = document.getElementById('game-selector');
    const gameVersionContainer = document.getElementById('game-version-container');
    const simpleModeBtn = document.getElementById('simple-mode-btn');
    const advancedModeBtn = document.getElementById('advanced-mode-btn');
    const simpleModeControls = document.getElementById('simple-mode-controls');
    const advancedModeControls = document.getElementById('advanced-mode-controls');
    const templateEditor = document.getElementById('template-editor');
    const resetTemplateBtn = document.getElementById('reset-template-btn');
    const titleColorInput = document.getElementById('title-color');
    const urlInputsContainer = document.getElementById('url-inputs');
    const crackedOptionsContainer = document.getElementById('cracked-options');
    const patchNotesOptionsContainer = document.getElementById('patchnotes-options');
    const previewTabBtn = document.getElementById('preview-tab-btn');
    const codeTabBtn = document.getElementById('code-tab-btn');
    const previewPane = document.getElementById('preview-pane');
    const codePane = document.getElementById('code-pane');
    const outputCode = document.getElementById('output-code');
    const copyBtnTop = document.getElementById('copy-btn-top');
    const copyBtnBottom = document.getElementById('copy-btn-bottom');
    const downloadBtn = document.getElementById('download-btn');

    // --- App State ---
    const state = {
        games: [],
        activeGameIndex: 0,
        settings: {
            titleColor: '#00ff00',
        },
        template: document.getElementById('default-bbcode-template').innerHTML,
    };
    
    // --- Caching Functions ---
    const CACHE_KEY = 'gameInfoFormatterCache';

    const saveStateToCache = () => {
        try {
            const stateToSave = {
                games: state.games,
                activeGameIndex: state.activeGameIndex
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(stateToSave));
        } catch (error) {
            console.error("Failed to save state to cache:", error);
        }
    };

    const loadStateFromCache = () => {
        try {
            const cachedState = localStorage.getItem(CACHE_KEY);
            if (cachedState) {
                const parsedState = JSON.parse(cachedState);
                state.games = parsedState.games || [];
                state.activeGameIndex = parsedState.activeGameIndex || 0;

                if (state.games.length > 0) {
                    customizationPanel.classList.remove('hidden');
                    updateGameSelector();
                    updateUIForActiveGame();
                }
            }
        } catch (error) {
            console.error("Failed to load state from cache:", error);
            localStorage.removeItem(CACHE_KEY); // Clear corrupted cache
        }
    };

    // --- Core Functions ---
    
    const sanitizeGameTitle = (title) => {
        return title.replace(/&/g, 'and').replace(/[^\w\s-]/gi, '').trim();
    };

    const parseInputText = (text) => {
        const parsedGames = {};
        
        const gameBlocks = text.split(/(?=\[url=)/).filter(block => block.trim().length > 10);
        const blockRegex = /\[b\](?<gameName>.+?)\s\[(?<platform>Win\d+|Linux\d+|Mac)\]\s\[Branch:\s(?<branch>[^\]]+)\].*?Version:\[\/b\]\s\[i\](?<fullDate>.+?UTC\s\[Build\s(?<buildId>\d+)\])/s;

        for (const block of gameBlocks) {
            const match = block.match(blockRegex);
            if (!match) continue;

            const { gameName, platform, branch, fullDate, buildId } = match.groups;
            const sanitizedTitle = sanitizeGameTitle(gameName);

            if (!parsedGames[sanitizedTitle]) {
                parsedGames[sanitizedTitle] = {
                    gameTitle: sanitizedTitle,
                    originalTitle: gameName,
                    files: [],
                    gameVersion: ''
                };
            }
            
            const shortDate = fullDate.split(' - ')[0];

            const existingFile = parsedGames[sanitizedTitle].files.find(f => f.platform === platform && f.branch === branch);
            if (!existingFile) {
                parsedGames[sanitizedTitle].files.push({
                    platform,
                    branch,
                    fullDate,
                    shortDate,
                    buildId,
                    cleanUrl: '',
                    crackedUrl: '',
                    patchNoteUrl: `https://steamdb.info/patchnotes/${buildId}/`,
                    includeCracked: true,
                    crackType: 'Cracked: Goldberg'
                });
            }
        }
        
        for (const key in parsedGames) {
            if (Object.hasOwnProperty.call(parsedGames, key)) {
                const game = parsedGames[key];
                game.files.sort((a, b) => {
                    const getOrder = (platform) => {
                        if (platform.startsWith('Win')) return 1;
                        if (platform.startsWith('Linux')) return 2;
                        if (platform.startsWith('Mac')) return 3;
                        return 4;
                    };
                    return getOrder(a.platform) - getOrder(b.platform);
                });
            }
        }

        state.games = Object.values(parsedGames);
        if(state.games.length > 0) {
            state.activeGameIndex = 0;
            customizationPanel.classList.remove('hidden');
            updateGameSelector();
            updateUIForActiveGame();
        } else {
            console.warn("Could not find any valid game data in the input.");
        }
        saveStateToCache();
    };

    const handleFiles = (files) => {
        let combinedText = '';
        let filesRead = 0;
        if (files.length === 0) return;

        Array.from(files).forEach(file => {
            const reader = new FileReader();
            reader.onload = (e) => {
                combinedText += e.target.result + '\n\n';
                filesRead++;
                if (filesRead === files.length) {
                    parseInputText(combinedText);
                }
            };
            reader.readAsText(file);
        });
    };

    const updateGameSelector = () => {
        gameSelector.innerHTML = '';
        state.games.forEach((game, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = game.gameTitle;
            if (index === state.activeGameIndex) {
                option.selected = true;
            }
            gameSelector.appendChild(option);
        });
    };

    const updateUIForActiveGame = () => {
        if (state.games.length === 0) {
            customizationPanel.classList.add('hidden');
            return;
        };

        const activeGame = state.games[state.activeGameIndex];
        if (!activeGame) return;

        gameVersionContainer.innerHTML = `
            <label for="game-version-input" class="block text-sm font-medium text-gray-300">Optional Game Version (e.g., 1.1.1.G)</label>
            <input type="text" id="game-version-input" value="${activeGame.gameVersion || ''}" class="w-full mt-1 p-2 bg-gray-900 border border-gray-700 rounded-md text-sm">
        `;

        titleColorInput.value = state.settings.titleColor;
        
        urlInputsContainer.innerHTML = '';
        crackedOptionsContainer.innerHTML = '';
        patchNotesOptionsContainer.innerHTML = '';

        activeGame.files.forEach((file, index) => {
            const urlGroup = document.createElement('div');
            urlGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
            urlGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
                <label class="block text-xs font-medium text-gray-400">Clean File URL</label>
                <input type="text" data-file-index="${index}" data-prop="cleanUrl" value="${file.cleanUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
                <div id="cracked-url-container-${index}" class="${file.includeCracked ? '' : 'hidden'}">
                    <label class="block text-xs font-medium text-gray-400 mt-2">Cracked File URL</label>
                    <input type="text" data-file-index="${index}" data-prop="crackedUrl" value="${file.crackedUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
                </div>`;
            urlInputsContainer.appendChild(urlGroup);

            const crackGroup = document.createElement('div');
            crackGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
            crackGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
                 <div class="flex items-center justify-between">
                    <label class="text-sm text-gray-300">Include Cracked Version</label>
                    <input type="checkbox" data-file-index="${index}" data-prop="includeCracked" ${file.includeCracked ? 'checked' : ''} class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500">
                 </div>
                 <div id="crack-type-container-${index}" class="${file.includeCracked ? '' : 'hidden'} mt-2">
                    <label class="block text-xs font-medium text-gray-400">Crack Type</label>
                    <select data-file-index="${index}" data-prop="crackType" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">
                        <option value="Cracked: Goldberg" ${file.crackType === 'Cracked: Goldberg' ? 'selected' : ''}>Goldberg</option>
                        <option value="Cracked: Goldberg + Steamless" ${file.crackType === 'Cracked: Goldberg + Steamless' ? 'selected' : ''}>Goldberg + Steamless</option>
                        <option value="custom">Custom</option>
                    </select>
                    <input type="text" data-file-index="${index}" data-prop="customCrackType" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm ${file.crackType.startsWith('Cracked:') ? 'hidden' : ''}" placeholder="Enter custom crack name" value="${!file.crackType.startsWith('Cracked:') ? file.crackType : ''}">
                 </div>`;
            crackedOptionsContainer.appendChild(crackGroup);

            const patchNotesGroup = document.createElement('div');
            patchNotesGroup.className = 'p-3 bg-gray-700/50 rounded-md border border-gray-600';
            patchNotesGroup.innerHTML = `<p class="font-semibold text-white text-sm mb-2">${file.platform} - ${file.branch}</p>
                <label class="block text-xs font-medium text-gray-400">Patch Notes URL</label>
                <input type="text" data-file-index="${index}" data-prop="patchNoteUrl" value="${file.patchNoteUrl}" class="w-full mt-1 p-1 bg-gray-900 border border-gray-600 rounded-md text-sm">`;
            patchNotesOptionsContainer.appendChild(patchNotesGroup);
        });

        templateEditor.value = state.template;
        renderOutput();
    };
    
    const renderOutput = () => {
         if (state.games.length === 0) {
             outputCode.value = '';
             previewPane.innerHTML = '<p class="text-gray-500">No data to display.</p>';
             [copyBtnTop, copyBtnBottom, downloadBtn].forEach(btn => btn.disabled = true);
             return;
         }
        
        const activeGame = state.games[state.activeGameIndex];
        if (!activeGame) return;

        let processedTemplate = state.template;

        const gameVersionExists = activeGame.gameVersion && activeGame.gameVersion.trim() !== '';
        const versionIfRegex = /<!--IF:gameVersion-->([\s\S]*?)<!--\/IF:gameVersion-->/s;
        processedTemplate = processedTemplate.replace(versionIfRegex, (match, innerContent) => {
            return gameVersionExists ? applyTemplate(innerContent, { gameVersion: activeGame.gameVersion }) : '';
        });

        const crackedExists = activeGame.files.some(f => f.includeCracked);
        const ifRegex = /<!--IF:crackedExists-->([\s\S]*?)<!--\/IF:crackedExists-->/s;
        processedTemplate = processedTemplate.replace(ifRegex, crackedExists ? '$1' : '');

        const loopRegex = /<!--LOOP:(\w+)-->([\s\S]*?)<!--\/LOOP:\1-->/gs;
        processedTemplate = processedTemplate.replace(loopRegex, (match, loopType, loopContent) => {
            let items;
            if (loopType === 'cleanFiles' || loopType === 'patchNotes') items = activeGame.files;
            else if (loopType === 'crackedFiles') items = activeGame.files.filter(f => f.includeCracked);
            else return '';

            if (!items || items.length === 0) return '';

            const trimmedLoopContent = loopContent.trim();
            return items.map(file => {
                const templateData = { 
                    file: file, 
                    gameTitle: activeGame.originalTitle, 
                    titleColor: state.settings.titleColor 
                };
                return applyTemplate(trimmedLoopContent, templateData);
            }).join('\n\n');
        });

        const finalOutput = processedTemplate.trim();
        outputCode.value = finalOutput;
        renderPreview(finalOutput);
        [copyBtnTop, copyBtnBottom, downloadBtn].forEach(btn => btn.disabled = false);
    };

    const applyTemplate = (template, data) => {
        return template.replace(/\{([\w.]+)\}/g, (match, key) => {
            const keys = key.split('.');
            let value = data;
            for (const k of keys) {
                if (value && typeof value === 'object' && k in value) {
                    value = value[k];
                } else { return match; }
            }
            return value !== undefined ? value : match;
        });
    };

    const renderPreview = (bbcode) => {
        let html = bbcode
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/\[url=([^\]]*)\](.*?)\[\/url\]/gs, (match, url, text) => {
                const hrefAttr = url ? `href="${url}"` : '';
                return `<a ${hrefAttr} class="postlink" target="_blank" rel="nofollow">${text}</a>`;
            })
            .replace(/(?<!href=")(?<!\[url=])(https?:\/\/[^\s<\]\[]+)/g, '<a href="$1" class="postlink" target="_blank" rel="nofollow">$1</a>')
            .replace(/\n/g, '<br>')
            .replace(/\[b\](.*?)\[\/b\]/gs, '<span style="font-weight: bold;">$1</span>')
            .replace(/\[i\](.*?)\[\/i\]/gs, '<span style="font-style: italic;">$1</span>')
            .replace(/\[color=(.*?)\](.*?)\[\/color\]/gs, '<span style="color: $1;">$2</span>')
            .replace(/\[size=(.*?)\](.*?)\[\/size\]/gs, '<span style="font-size: $1%; line-height: normal;">$2</span>');
        
        previewPane.innerHTML = `<div class="postbody">${html}</div>`;
    };

    const handleCopyClick = async (button) => {
        if (!outputCode.value) return;
        const originalText = button.textContent;
        try {
            await navigator.clipboard.writeText(outputCode.value);
            button.textContent = 'Copied!';
        } catch (err) {
            console.warn('Clipboard API failed, falling back to execCommand.', err);
            outputCode.select();
            outputCode.setSelectionRange(0, 99999);
            if (document.execCommand('copy')) {
                button.textContent = 'Copied!';
            } else {
                button.textContent = 'Copy Failed';
            }
            window.getSelection().removeAllRanges();
        } finally {
            setTimeout(() => { button.textContent = originalText; }, 2000);
        }
    };

    // --- Event Listeners ---
    
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', (e) => { e.preventDefault(); dropZone.classList.remove('dragover'); handleFiles(e.dataTransfer.files); });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
    
    processTextBtn.addEventListener('click', () => { if (textInput.value.trim()) { parseInputText(textInput.value); } });

    gameSelector.addEventListener('change', (e) => { state.activeGameIndex = parseInt(e.target.value, 10); updateUIForActiveGame(); });

    simpleModeBtn.addEventListener('click', () => {
        simpleModeBtn.classList.add('active'); advancedModeBtn.classList.remove('active');
        simpleModeControls.classList.remove('hidden'); advancedModeControls.classList.add('hidden');
    });
    advancedModeBtn.addEventListener('click', () => {
        advancedModeBtn.classList.add('active'); simpleModeBtn.classList.remove('active');
        advancedModeControls.classList.remove('hidden'); simpleModeControls.classList.add('hidden');
    });
    
    previewTabBtn.addEventListener('click', () => {
        previewTabBtn.classList.add('active'); codeTabBtn.classList.remove('active');
        previewPane.classList.remove('hidden'); codePane.classList.add('hidden');
    });
    codeTabBtn.addEventListener('click', () => {
        codeTabBtn.classList.add('active'); previewTabBtn.classList.remove('active');
        codePane.classList.remove('hidden'); previewPane.classList.add('hidden');
    });

    titleColorInput.addEventListener('input', (e) => { state.settings.titleColor = e.target.value; renderOutput(); });
    
    customizationPanel.addEventListener('input', (e) => {
        const target = e.target;
        const activeGame = state.games[state.activeGameIndex];
        if (!activeGame) return;

        if (target.id === 'game-version-input') {
            activeGame.gameVersion = target.value;
        }

        const fileIndex = target.dataset.fileIndex;
        if (fileIndex !== undefined) {
            const file = activeGame.files[fileIndex];
            const prop = target.dataset.prop;

            if (prop === 'includeCracked') {
                file.includeCracked = target.checked;
                updateUIForActiveGame(); // Redraw UI to hide/show sections
            } else if (prop === 'crackType') {
                const customInput = target.closest('.p-3').querySelector('[data-prop="customCrackType"]');
                if (target.value === 'custom') {
                    customInput.classList.remove('hidden');
                    file.crackType = customInput.value || 'Custom';
                } else {
                    customInput.classList.add('hidden');
                    file.crackType = target.value;
                }
            } else if (prop === 'customCrackType') {
                 file.crackType = target.value || 'Custom';
            } else if (prop === 'patchNoteUrl') {
                file.patchNoteUrl = target.value;
                const buildIdMatch = target.value.match(/\/(\d+)\/?$/);
                if (buildIdMatch && buildIdMatch[1]) {
                    file.buildId = buildIdMatch[1];
                }
            } else if (prop) {
                file[prop] = target.value;
            }
        }
        
        renderOutput();
        saveStateToCache();
    });

    templateEditor.addEventListener('input', (e) => { state.template = e.target.value; renderOutput(); });
    resetTemplateBtn.addEventListener('click', () => {
        state.template = document.getElementById('default-bbcode-template').innerHTML;
        templateEditor.value = state.template;
        renderOutput();
    });

    copyBtnTop.addEventListener('click', () => handleCopyClick(copyBtnTop));
    copyBtnBottom.addEventListener('click', () => handleCopyClick(copyBtnBottom));

    downloadBtn.addEventListener('click', () => {
        if (state.games.length === 0 || !outputCode.value) return;
        const activeGame = state.games[state.activeGameIndex];
        const blob = new Blob([outputCode.value], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeGame.gameTitle}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    // Load state from cache on initial load
    loadStateFromCache();
});
