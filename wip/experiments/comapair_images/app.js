// DLSS 4.5 Comparison Test - Application Logic

/*************************************
 * CONFIGURATION & DATA
 *************************************/
const CONFIG = {
    API_BASE: 'https://main-backend-wip.rosiesite.workers.dev',
    DLSS_MODES: ['Ultra Performance', 'Performance', 'Balanced', 'Quality', 'DLAA'],
    SCENES: [1, 2, 3],
    IMAGES_PER_SCENE: 5
};

// Answer key - the correct DLSS mode for each image
const ANSWER_KEY = {
    1: { // Scene 1
        1: 'Performance',
        2: 'Ultra Performance',
        3: 'Balanced',
        4: 'Quality',
        5: 'DLAA'
    },
    2: { // Scene 2
        1: 'DLAA',
        2: 'Balanced',
        3: 'Quality',
        4: 'Ultra Performance',
        5: 'Performance'
    },
    3: { // Scene 3
        1: 'Balanced',
        2: 'Ultra Performance',
        3: 'Quality',
        4: 'DLAA',
        5: 'Performance'
    }
};

/*************************************
 * STATE MANAGEMENT
 *************************************/
let state = {
    revealMode: null, // 'perScene' or 'allAtOnce'
    currentScene: 1,
    guesses: {
        1: { 1: '', 2: '', 3: '', 4: '', 5: '' },
        2: { 1: '', 2: '', 3: '', 4: '', 5: '' },
        3: { 1: '', 2: '', 3: '', 4: '', 5: '' }
    },
    revealed: {
        1: false,
        2: false,
        3: false
    },
    submitted: false,
    lightbox: {
        zoom: 1,
        panX: 0,
        panY: 0,
        isDragging: false,
        startX: 0,
        startY: 0
    }
};

/*************************************
 * DOM ELEMENTS
 *************************************/
function getElements() {
    return {
        // Sections
        introSection: document.getElementById('introSection'),
        gameSection: document.getElementById('gameSection'),
        resultsSection: document.getElementById('resultsSection'),
        
        // Mode selection
        revealPerScene: document.getElementById('revealPerScene'),
        revealAllAtOnce: document.getElementById('revealAllAtOnce'),
        
        // Scene navigation
        sceneTabs: document.querySelectorAll('.scene-tab'),
        sceneContent: document.getElementById('sceneContent'),
        prevSceneBtn: document.getElementById('prevSceneBtn'),
        nextSceneBtn: document.getElementById('nextSceneBtn'),
        submitSceneBtn: document.getElementById('submitSceneBtn'),
        submitAllBtn: document.getElementById('submitAllBtn'),
        
        // Progress
        progressFill: document.getElementById('progressFill'),
        answeredCount: document.getElementById('answeredCount'),
        totalCount: document.getElementById('totalCount'),
        
        // Images
        referenceImage: document.getElementById('referenceImage'),
        comparisonGrid: document.querySelector('.comparison-grid'),
        guessGrid: document.getElementById('guessGrid'),
        
        // Lightbox
        lightboxModal: document.getElementById('lightboxModal'),
        lightboxImage: document.getElementById('lightboxImage'),
        lightboxTitle: document.getElementById('lightboxTitle'),
        lightboxImageContainer: document.getElementById('lightboxImageContainer'),
        zoomIn: document.getElementById('zoomIn'),
        zoomOut: document.getElementById('zoomOut'),
        zoomReset: document.getElementById('zoomReset'),
        zoomLevel: document.getElementById('zoomLevel'),
        lightboxClose: document.querySelector('.lightbox-close'),
        
        // Results
        scoreNumber: document.getElementById('scoreNumber'),
        resultsBreakdown: document.getElementById('resultsBreakdown'),
        tryAgainBtn: document.getElementById('tryAgainBtn'),
        viewCommunityBtn: document.getElementById('viewCommunityBtn'),
        
        // Community modal
        viewResultsBtn: document.getElementById('viewResultsBtn'),
        communityModal: document.getElementById('communityModal'),
        communityLoading: document.getElementById('communityLoading'),
        communityResults: document.getElementById('communityResults'),
        statsSummary: document.getElementById('statsSummary'),
        communityTableBody: document.getElementById('communityTableBody'),
        closeModalBtn: document.querySelector('.close-modal')
    };
}

/*************************************
 * INITIALIZATION
 *************************************/
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    loadSavedProgress();
});

function setupEventListeners() {
    const elements = getElements();
    
    // Mode selection
    elements.revealPerScene.addEventListener('click', () => startGame('perScene'));
    elements.revealAllAtOnce.addEventListener('click', () => startGame('allAtOnce'));
    
    // Scene tabs
    elements.sceneTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const scene = parseInt(tab.dataset.scene);
            navigateToScene(scene);
        });
    });
    
    // Navigation buttons
    elements.prevSceneBtn.addEventListener('click', () => navigateToScene(state.currentScene - 1));
    elements.nextSceneBtn.addEventListener('click', () => navigateToScene(state.currentScene + 1));
    elements.submitSceneBtn.addEventListener('click', () => submitScene());
    elements.submitAllBtn.addEventListener('click', () => submitAll());
    
    // Results actions
    elements.tryAgainBtn.addEventListener('click', resetGame);
    elements.viewCommunityBtn.addEventListener('click', openCommunityModal);
    
    // Community modal
    elements.viewResultsBtn.addEventListener('click', openCommunityModal);
    elements.closeModalBtn.addEventListener('click', closeCommunityModal);
    elements.communityModal.addEventListener('click', (e) => {
        if (e.target === elements.communityModal) closeCommunityModal();
    });
    
    // Lightbox
    elements.lightboxClose.addEventListener('click', closeLightbox);
    elements.lightboxModal.addEventListener('click', (e) => {
        if (e.target === elements.lightboxModal) closeLightbox();
    });
    elements.zoomIn.addEventListener('click', () => adjustZoom(0.25));
    elements.zoomOut.addEventListener('click', () => adjustZoom(-0.25));
    elements.zoomReset.addEventListener('click', resetZoom);
    
    // Lightbox drag/pan
    elements.lightboxImageContainer.addEventListener('mousedown', startDrag);
    elements.lightboxImageContainer.addEventListener('mousemove', drag);
    elements.lightboxImageContainer.addEventListener('mouseup', endDrag);
    elements.lightboxImageContainer.addEventListener('mouseleave', endDrag);
    elements.lightboxImageContainer.addEventListener('wheel', handleWheel);
    
    // Keyboard
    document.addEventListener('keydown', handleKeydown);
}

/*************************************
 * GAME FLOW
 *************************************/
function startGame(mode) {
    state.revealMode = mode;
    state.currentScene = 1;
    
    const elements = getElements();
    elements.introSection.style.display = 'none';
    elements.gameSection.style.display = 'block';
    elements.resultsSection.style.display = 'none';
    
    renderScene(1);
    updateProgress();
    updateNavigationButtons();
    saveProgress();
}

function navigateToScene(scene) {
    if (scene < 1 || scene > 3) return;
    
    // In perScene mode, can't navigate to unrevealed scenes after current
    if (state.revealMode === 'perScene') {
        // Can navigate to any scene that's already revealed or current working scene
        const maxAccessibleScene = Object.values(state.revealed).filter(v => v).length + 1;
        if (scene > Math.min(maxAccessibleScene, 3)) return;
    }
    
    state.currentScene = scene;
    renderScene(scene);
    updateNavigationButtons();
    updateSceneTabs();
    saveProgress();
}

function renderScene(scene) {
    const elements = getElements();
    
    // Update reference image
    elements.referenceImage.src = `images/scene ${scene} refrence.jpg`;
    elements.referenceImage.onclick = () => openLightbox(`images/scene ${scene} refrence.jpg`, 'Reference (DLSS Disabled)');
    
    // Render comparison images
    elements.comparisonGrid.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const item = document.createElement('div');
        item.className = 'comparison-item';
        item.id = `comparison-${scene}-${i}`;
        
        const isRevealed = state.revealed[scene];
        const userGuess = state.guesses[scene][i];
        const correctAnswer = ANSWER_KEY[scene][i];
        
        if (isRevealed) {
            if (userGuess === correctAnswer) {
                item.classList.add('correct');
            } else {
                item.classList.add('incorrect');
            }
        }
        
        item.innerHTML = `
            <span class="image-label">Image ${i}</span>
            <img src="images/scene ${scene} image ${i}.jpg" 
                 alt="Comparison image ${i}" 
                 class="comparison-image"
                 onclick="openLightbox('images/scene ${scene} image ${i}.jpg', 'Image ${i}')">
            <div class="result-overlay ${isRevealed ? 'visible' : ''}">
                ${isRevealed ? `
                    <div class="${userGuess === correctAnswer ? 'result-correct' : 'result-incorrect'}">
                        ${userGuess === correctAnswer ? '✓ Correct!' : '✗ Incorrect'}
                    </div>
                    <div class="result-answer">Answer: ${correctAnswer}</div>
                ` : ''}
            </div>
        `;
        
        elements.comparisonGrid.appendChild(item);
    }
    
    // Render guess dropdowns
    elements.guessGrid.innerHTML = '';
    for (let i = 1; i <= 5; i++) {
        const guessItem = document.createElement('div');
        guessItem.className = 'guess-item';
        
        const isRevealed = state.revealed[scene];
        const userGuess = state.guesses[scene][i];
        const correctAnswer = ANSWER_KEY[scene][i];
        
        let selectClass = '';
        if (isRevealed) {
            selectClass = userGuess === correctAnswer ? 'correct' : 'incorrect';
        }
        
        guessItem.innerHTML = `
            <label for="guess-${scene}-${i}">Image ${i}</label>
            <select id="guess-${scene}-${i}" 
                    data-scene="${scene}" 
                    data-image="${i}"
                    class="${selectClass}"
                    ${isRevealed ? 'disabled' : ''}>
                <option value="">-- Select Mode --</option>
                ${CONFIG.DLSS_MODES.map(mode => `
                    <option value="${mode}" ${userGuess === mode ? 'selected' : ''}>${mode}</option>
                `).join('')}
            </select>
        `;
        
        const select = guessItem.querySelector('select');
        select.addEventListener('change', (e) => handleGuessChange(e, scene, i));
        
        elements.guessGrid.appendChild(guessItem);
    }
}

function handleGuessChange(e, scene, image) {
    state.guesses[scene][image] = e.target.value;
    updateProgress();
    updateNavigationButtons();
    saveProgress();
}

function updateProgress() {
    let answered = 0;
    for (const scene of CONFIG.SCENES) {
        for (let i = 1; i <= 5; i++) {
            if (state.guesses[scene][i]) answered++;
        }
    }
    
    const elements = getElements();
    elements.answeredCount.textContent = answered;
    elements.progressFill.style.width = `${(answered / 15) * 100}%`;
}

function updateNavigationButtons() {
    const elements = getElements();
    const scene = state.currentScene;
    const isRevealed = state.revealed[scene];
    
    // Previous button
    elements.prevSceneBtn.style.display = scene > 1 ? 'block' : 'none';
    
    // Check if current scene is fully answered
    const sceneComplete = Object.values(state.guesses[scene]).every(v => v !== '');
    
    // Check if all scenes are complete
    const allComplete = CONFIG.SCENES.every(s => 
        Object.values(state.guesses[s]).every(v => v !== '')
    );
    
    if (state.revealMode === 'perScene') {
        // Per-scene mode
        if (isRevealed) {
            // Already revealed - show next or completion
            elements.submitSceneBtn.style.display = 'none';
            elements.submitAllBtn.style.display = 'none';
            elements.nextSceneBtn.style.display = scene < 3 ? 'block' : 'none';
            
            // If all scenes revealed, show final results option
            if (Object.values(state.revealed).every(v => v)) {
                elements.nextSceneBtn.style.display = 'none';
                if (!state.submitted) {
                    showFinalResults();
                }
            }
        } else {
            // Not revealed yet
            elements.nextSceneBtn.style.display = 'none';
            elements.submitSceneBtn.style.display = sceneComplete ? 'block' : 'none';
            elements.submitAllBtn.style.display = 'none';
        }
    } else {
        // All at once mode
        elements.submitSceneBtn.style.display = 'none';
        
        if (scene < 3) {
            elements.nextSceneBtn.style.display = 'block';
            elements.submitAllBtn.style.display = 'none';
        } else {
            elements.nextSceneBtn.style.display = 'none';
            elements.submitAllBtn.style.display = allComplete ? 'block' : 'none';
            elements.submitAllBtn.disabled = !allComplete;
        }
    }
}

function updateSceneTabs() {
    const elements = getElements();
    elements.sceneTabs.forEach(tab => {
        const scene = parseInt(tab.dataset.scene);
        tab.classList.remove('active', 'completed', 'revealed');
        
        if (scene === state.currentScene) {
            tab.classList.add('active');
        }
        
        if (state.revealed[scene]) {
            tab.classList.add('revealed');
        } else if (Object.values(state.guesses[scene]).every(v => v !== '')) {
            tab.classList.add('completed');
        }
    });
}

/*************************************
 * SUBMISSION & RESULTS
 *************************************/
function submitScene() {
    const scene = state.currentScene;
    state.revealed[scene] = true;
    
    renderScene(scene);
    updateSceneTabs();
    updateNavigationButtons();
    saveProgress();
    
    // If all scenes revealed, submit to server
    if (Object.values(state.revealed).every(v => v)) {
        submitToServer();
    }
}

function submitAll() {
    // Reveal all scenes
    state.revealed = { 1: true, 2: true, 3: true };
    submitToServer();
    showFinalResults();
}

async function submitToServer() {
    if (state.submitted) return;
    state.submitted = true;
    
    const score = calculateScore();
    
    const payload = {
        timestamp: new Date().toISOString(),
        guesses: state.guesses,
        score: {
            correct: score.total,
            total: 15,
            perScene: score.perScene
        }
    };
    
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/dlss/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            console.error('Failed to submit results');
        }
    } catch (error) {
        console.error('Error submitting results:', error);
    }
}

function calculateScore() {
    const perScene = {};
    let total = 0;
    
    for (const scene of CONFIG.SCENES) {
        let sceneCorrect = 0;
        for (let i = 1; i <= 5; i++) {
            if (state.guesses[scene][i] === ANSWER_KEY[scene][i]) {
                sceneCorrect++;
                total++;
            }
        }
        perScene[scene] = sceneCorrect;
    }
    
    return { total, perScene };
}

function showFinalResults() {
    const elements = getElements();
    const score = calculateScore();
    
    elements.gameSection.style.display = 'none';
    elements.resultsSection.style.display = 'block';
    
    // Animate score number
    animateNumber(elements.scoreNumber, score.total);
    
    // Build results breakdown
    let breakdownHTML = '';
    for (const scene of CONFIG.SCENES) {
        breakdownHTML += `
            <div class="scene-results">
                <h3>
                    Scene ${scene}
                    <span class="scene-score">${score.perScene[scene]}/5 correct</span>
                </h3>
        `;
        
        for (let i = 1; i <= 5; i++) {
            const userGuess = state.guesses[scene][i];
            const correct = ANSWER_KEY[scene][i];
            const isCorrect = userGuess === correct;
            
            breakdownHTML += `
                <div class="result-row ${isCorrect ? 'correct' : 'incorrect'}">
                    <span>Image ${i}</span>
                    <span class="your-guess">Your guess: ${userGuess || 'None'}</span>
                    <span class="correct-answer">${isCorrect ? '✓' : `Answer: ${correct}`}</span>
                </div>
            `;
        }
        
        breakdownHTML += '</div>';
    }
    
    elements.resultsBreakdown.innerHTML = breakdownHTML;
    
    // Clear saved progress
    localStorage.removeItem('dlss_comparison_progress');
}

function animateNumber(element, target) {
    let current = 0;
    const duration = 1000;
    const step = target / (duration / 50);
    
    const interval = setInterval(() => {
        current += step;
        if (current >= target) {
            element.textContent = target;
            clearInterval(interval);
        } else {
            element.textContent = Math.floor(current);
        }
    }, 50);
}

function resetGame() {
    state = {
        revealMode: null,
        currentScene: 1,
        guesses: {
            1: { 1: '', 2: '', 3: '', 4: '', 5: '' },
            2: { 1: '', 2: '', 3: '', 4: '', 5: '' },
            3: { 1: '', 2: '', 3: '', 4: '', 5: '' }
        },
        revealed: { 1: false, 2: false, 3: false },
        submitted: false,
        lightbox: { zoom: 1, panX: 0, panY: 0, isDragging: false, startX: 0, startY: 0 }
    };
    
    localStorage.removeItem('dlss_comparison_progress');
    
    const elements = getElements();
    elements.introSection.style.display = 'block';
    elements.gameSection.style.display = 'none';
    elements.resultsSection.style.display = 'none';
    
    updateSceneTabs();
}

/*************************************
 * LIGHTBOX
 *************************************/
function openLightbox(src, title) {
    const elements = getElements();
    
    state.lightbox = { zoom: 1, panX: 0, panY: 0, isDragging: false, startX: 0, startY: 0 };
    
    elements.lightboxImage.src = src;
    elements.lightboxTitle.textContent = title;
    elements.lightboxModal.style.display = 'block';
    
    // Center the image after it loads
    elements.lightboxImage.onload = () => {
        centerImage();
    };
    
    updateZoomDisplay();
    document.body.style.overflow = 'hidden';
}

function closeLightbox() {
    const elements = getElements();
    elements.lightboxModal.style.display = 'none';
    document.body.style.overflow = '';
}

function centerImage() {
    const elements = getElements();
    const container = elements.lightboxImageContainer;
    const img = elements.lightboxImage;
    
    const containerRect = container.getBoundingClientRect();
    const imgWidth = img.naturalWidth * state.lightbox.zoom;
    const imgHeight = img.naturalHeight * state.lightbox.zoom;
    
    state.lightbox.panX = (containerRect.width - imgWidth) / 2;
    state.lightbox.panY = (containerRect.height - imgHeight) / 2;
    
    updateImageTransform();
}

function adjustZoom(delta) {
    state.lightbox.zoom = Math.max(0.25, Math.min(5, state.lightbox.zoom + delta));
    updateZoomDisplay();
    centerImage();
}

function resetZoom() {
    state.lightbox.zoom = 1;
    updateZoomDisplay();
    centerImage();
}

function updateZoomDisplay() {
    const elements = getElements();
    elements.zoomLevel.textContent = `${Math.round(state.lightbox.zoom * 100)}%`;
}

function updateImageTransform() {
    const elements = getElements();
    const { zoom, panX, panY } = state.lightbox;
    
    elements.lightboxImage.style.width = `${elements.lightboxImage.naturalWidth * zoom}px`;
    elements.lightboxImage.style.height = `${elements.lightboxImage.naturalHeight * zoom}px`;
    elements.lightboxImage.style.left = `${panX}px`;
    elements.lightboxImage.style.top = `${panY}px`;
}

function startDrag(e) {
    state.lightbox.isDragging = true;
    state.lightbox.startX = e.clientX - state.lightbox.panX;
    state.lightbox.startY = e.clientY - state.lightbox.panY;
}

function drag(e) {
    if (!state.lightbox.isDragging) return;
    e.preventDefault();
    
    state.lightbox.panX = e.clientX - state.lightbox.startX;
    state.lightbox.panY = e.clientY - state.lightbox.startY;
    updateImageTransform();
}

function endDrag() {
    state.lightbox.isDragging = false;
}

function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    state.lightbox.zoom = Math.max(0.25, Math.min(5, state.lightbox.zoom + delta));
    updateZoomDisplay();
    updateImageTransform();
}

function handleKeydown(e) {
    if (e.key === 'Escape') {
        closeLightbox();
        closeCommunityModal();
    }
}

/*************************************
 * COMMUNITY RESULTS
 *************************************/
async function openCommunityModal() {
    const elements = getElements();
    elements.communityModal.style.display = 'block';
    elements.communityLoading.style.display = 'block';
    elements.communityResults.style.display = 'none';
    document.body.style.overflow = 'hidden';
    
    try {
        const response = await fetch(`${CONFIG.API_BASE}/api/dlss/results`);
        
        if (!response.ok) throw new Error('Failed to fetch results');
        
        const data = await response.json();
        displayCommunityResults(data);
    } catch (error) {
        elements.communityLoading.textContent = 'Failed to load results. Please try again.';
        console.error('Error fetching community results:', error);
    }
}

function displayCommunityResults(data) {
    const elements = getElements();
    elements.communityLoading.style.display = 'none';
    elements.communityResults.style.display = 'block';
    
    const results = data.results || [];
    
    // Calculate stats
    const totalSubmissions = results.length;
    const avgScore = totalSubmissions > 0 
        ? (results.reduce((sum, r) => sum + (r.correct_count || 0), 0) / totalSubmissions).toFixed(1)
        : 0;
    const perfectScores = results.filter(r => r.correct_count === 15).length;
    
    // Display stats
    elements.statsSummary.innerHTML = `
        <div class="stat-card">
            <div class="stat-value">${totalSubmissions}</div>
            <div class="stat-label">Total Submissions</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${avgScore}</div>
            <div class="stat-label">Average Score</div>
        </div>
        <div class="stat-card">
            <div class="stat-value">${perfectScores}</div>
            <div class="stat-label">Perfect Scores</div>
        </div>
    `;
    
    // Build table
    elements.communityTableBody.innerHTML = results.map((result, index) => {
        const scoreClass = result.correct_count >= 12 ? 'high-score' : 
                          result.correct_count >= 8 ? 'mid-score' : 'low-score';
        
        const guesses = result.guesses_json ? JSON.parse(result.guesses_json) : {};
        const sceneScores = [1, 2, 3].map(scene => {
            let correct = 0;
            for (let i = 1; i <= 5; i++) {
                if (guesses[scene] && guesses[scene][i] === ANSWER_KEY[scene][i]) {
                    correct++;
                }
            }
            return correct;
        });
        
        const date = new Date(result.submitted_at);
        const formattedDate = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        
        return `
            <tr>
                <td>${index + 1}</td>
                <td class="score-cell ${scoreClass}">${result.correct_count}/15</td>
                <td>${sceneScores[0]}/5</td>
                <td>${sceneScores[1]}/5</td>
                <td>${sceneScores[2]}/5</td>
                <td>${formattedDate}</td>
            </tr>
        `;
    }).join('');
}

function closeCommunityModal() {
    const elements = getElements();
    elements.communityModal.style.display = 'none';
    document.body.style.overflow = '';
}

/*************************************
 * LOCAL STORAGE
 *************************************/
function saveProgress() {
    const saveData = {
        revealMode: state.revealMode,
        currentScene: state.currentScene,
        guesses: state.guesses,
        revealed: state.revealed,
        submitted: state.submitted
    };
    localStorage.setItem('dlss_comparison_progress', JSON.stringify(saveData));
}

function loadSavedProgress() {
    const saved = localStorage.getItem('dlss_comparison_progress');
    if (!saved) return;
    
    try {
        const data = JSON.parse(saved);
        
        // Don't restore if already submitted
        if (data.submitted) {
            localStorage.removeItem('dlss_comparison_progress');
            return;
        }
        
        // Restore state
        state.revealMode = data.revealMode;
        state.currentScene = data.currentScene;
        state.guesses = data.guesses;
        state.revealed = data.revealed;
        state.submitted = data.submitted;
        
        // If game was in progress, show it
        if (data.revealMode) {
            const elements = getElements();
            elements.introSection.style.display = 'none';
            elements.gameSection.style.display = 'block';
            
            renderScene(state.currentScene);
            updateProgress();
            updateNavigationButtons();
            updateSceneTabs();
        }
    } catch (error) {
        console.error('Error loading saved progress:', error);
        localStorage.removeItem('dlss_comparison_progress');
    }
}

// Make openLightbox globally accessible for onclick handlers
window.openLightbox = openLightbox;
