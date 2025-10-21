document.addEventListener('DOMContentLoaded', () => {
    // DOM Element References
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const fileList = document.getElementById('file-list');
    const promptInput = document.getElementById('prompt-input');
    const outputPreview = document.getElementById('output-preview');
    const copyButton = document.getElementById('copy-button');
    const downloadButton = document.getElementById('download-button');
    const toast = document.getElementById('toast');
    const addFileBtn = document.getElementById('add-file-btn');
    const addFileModal = document.getElementById('add-file-modal');
    const modalFilenameInput = document.getElementById('modal-filename-input');
    const modalContentInput = document.getElementById('modal-content-input');
    const modalSaveBtn = document.getElementById('modal-save-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');


    // State
    let files = [];

    // Initialize SortableJS
    new Sortable(fileList, {
        animation: 150,
        ghostClass: 'sortable-ghost',
        handle: '.drag-handle',
        onEnd: updatePreview // Update preview on reorder
    });

    // --- Event Listeners ---

    // File Drop Zone
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-highlight');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-highlight');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-highlight');
        handleFileUpload(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files));

    // Prompt Input
    promptInput.addEventListener('input', updatePreview);

    // Action Buttons
    copyButton.addEventListener('click', copyToClipboard);
    downloadButton.addEventListener('click', downloadAsTextFile);
    
    // Modal Listeners
    addFileBtn.addEventListener('click', () => {
        addFileModal.style.display = 'flex';
        modalFilenameInput.focus();
    });

    modalCancelBtn.addEventListener('click', closeModal);
    
    addFileModal.addEventListener('click', (e) => {
        // Close if clicking on the overlay itself
        if (e.target === addFileModal) {
            closeModal();
        }
    });

    modalSaveBtn.addEventListener('click', handleManualFileAdd);


    // --- Core Functions ---

    function closeModal() {
        // Clear inputs for next time
        modalFilenameInput.value = '';
        modalContentInput.value = '';
        addFileModal.style.display = 'none';
    }

    function handleManualFileAdd() {
        const fileName = modalFilenameInput.value.trim();
        const content = modalContentInput.value;

        if (!fileName) {
            showToast('Filename cannot be empty.', true);
            return;
        }

        const newFile = {
            id: `file-${Date.now()}-${Math.random()}`,
            fileName: fileName,
            content: content
        };
        files.push(newFile);
        renderFileList();
        updatePreview();
        closeModal();
    }

    function handleFileUpload(uploadedFiles) {
        for (const file of uploadedFiles) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const newFile = {
                    id: `file-${Date.now()}-${Math.random()}`,
                    fileName: file.name,
                    content: e.target.result
                };
                files.push(newFile);
                renderFileList();
                updatePreview();
            };
            reader.onerror = () => {
                showToast(`Error reading file: ${file.name}`, true);
            };
            reader.readAsText(file);
        }
    }

    function renderFileList() {
        fileList.innerHTML = ''; // Clear the list
        files.forEach(file => {
            const li = document.createElement('li');
            li.className = 'file-item';
            li.dataset.id = file.id;
            
            li.innerHTML = `
                <span class="drag-handle">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
                    </svg>
                </span>
                <input type="text" class="file-name-input" value="${escapeHtml(file.fileName)}" data-id="${file.id}">
                <button class="remove-file-btn" data-id="${file.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            `;
            fileList.appendChild(li);
        });

        // Add event listeners for new elements
        addEventListenersToItems();
    }

    function addEventListenersToItems() {
        // Remove button listeners
        document.querySelectorAll('.remove-file-btn').forEach(button => {
            button.addEventListener('click', (e) => {
                const fileId = e.currentTarget.dataset.id;
                files = files.filter(f => f.id !== fileId);
                renderFileList();
                updatePreview();
            });
        });

        // Filename input listeners
        document.querySelectorAll('.file-name-input').forEach(input => {
            input.addEventListener('input', (e) => {
                const fileId = e.currentTarget.dataset.id;
                const file = files.find(f => f.id === fileId);
                if (file) {
                    file.fileName = e.currentTarget.value;
                    updatePreview();
                }
            });
        });
    }

    function getFormattedOutputString() {
        const parts = [];
        const promptText = promptInput.value;

        // Only add the prompt if it's not just whitespace
        if (promptText.trim()) {
            parts.push(promptText);
        }

        const fileOrder = Array.from(fileList.children).map(item => item.dataset.id);
        const orderedFiles = fileOrder.map(id => files.find(f => f.id === id)).filter(Boolean);

        orderedFiles.forEach(file => {
            const fileBlock = `${file.fileName}\n\`\`\`\n${file.content}\n\`\`\``;
            parts.push(fileBlock);
        });
        
        // Use three newlines to create two visual blank lines for better separation
        return parts.join('\n\n\n');
    }

    function updatePreview() {
        const outputString = getFormattedOutputString();
        outputPreview.textContent = outputString;

        // Enable or disable buttons based on content
        const hasContent = outputString.length > 0;
        copyButton.disabled = !hasContent;
        downloadButton.disabled = !hasContent;
    }

    function copyToClipboard() {
        const textToCopy = getFormattedOutputString(); // Get the string directly
        if (!textToCopy) return;

        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        document.body.appendChild(textArea);
        textArea.select();
        try {
            document.execCommand('copy');
            showToast('Copied to clipboard!');
        } catch (err) {
            console.error('Failed to copy text: ', err);
            showToast('Failed to copy!', true);
        }
        document.body.removeChild(textArea);
    }
    
    function downloadAsTextFile() {
        const textToDownload = getFormattedOutputString(); // Get the string directly
        if (!textToDownload) return;

        const blob = new Blob([textToDownload], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'formatted-prompt.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function showToast(message, isError = false) {
        if (!toast) return;
        toast.textContent = message;
        
        // Reset classes
        toast.className = 'toast-notification'; 
        
        if (isError) {
            toast.classList.add('error');
        } else {
            toast.classList.add('success');
        }

        toast.classList.add('show');

        setTimeout(() => {
            toast.classList.remove('show');
        }, 2000);
    }

    function escapeHtml(unsafe) {
        return unsafe
             .replace(/&/g, "&amp;")
             .replace(/</g, "&lt;")
             .replace(/>/g, "&gt;")
             .replace(/"/g, "&quot;")
             .replace(/'/g, "&#039;");
    }

    // Initial call to set button states correctly on page load
    updatePreview();
});
