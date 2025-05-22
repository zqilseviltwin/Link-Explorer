document.addEventListener('DOMContentLoaded', () => {
    const firebaseConfig = {
        apiKey: "AIzaSyAlFt_RtMiFCkOorKaWxQxsJxg7XcHncgo", // Replace with your actual config
        authDomain: "hardcobox-7d1f9.firebaseapp.com",
        projectId: "hardcobox-7d1f9",
        storageBucket: "hardcobox-7d1f9.firebasestorage.app",
        messagingSenderId: "362005078918",
        appId: "1:362005078918:web:b1bade6100bd945df08207",
        measurementId: "G-9TRKKSB3TG"
    };

    firebase.initializeApp(firebaseConfig);
    const db = firebase.firestore();
    const itemsCollection = db.collection("linkExplorerItems");

    let currentFolderId = null;
    let currentPath = [{ id: null, name: "Root" }];
    let clipboard = { items: [], action: null };
    let selectedItemIds = [];
    let anchorItemIdForShift = null;
    let focusedItemId = null;
    
    let isInlineRenamingFolder = false;
    let editingItemId = null; 
    
    // Firestore Listeners
    let currentFolderItemsListenerUnsubscribe = null; // For items IN the current folder
    let currentViewingFolderDocListenerUnsubscribe = null; // For the current folder DOCUMENT itself

    const breadcrumbsContainer = document.getElementById('breadcrumbs');
    const itemListContainer = document.getElementById('itemList');
    const addFolderBtn = document.getElementById('addFolderBtn');
    const addLinkBtn = document.getElementById('addLinkBtn');
    const pasteBtn = document.getElementById('pasteBtn');
    const statusMessageEl = document.getElementById('statusMessage');

    const addFolderModal = document.getElementById('addFolderModal');
    const addLinkModal = document.getElementById('addLinkModal');
    const editLinkModal = document.getElementById('editLinkModal');

    const newFolderNameInput = document.getElementById('newFolderName');
    const newLinkNameInput = document.getElementById('newLinkName');
    const newLinkUrlInput = document.getElementById('newLinkUrl');
    const editLinkNameInput = document.getElementById('editLinkName');
    const editLinkUrlInput = document.getElementById('editLinkUrl');

    const submitAddFolderBtn = document.getElementById('submitAddFolder');
    const submitAddLinkBtn = document.getElementById('submitAddLink');
    const submitEditLinkBtn = document.getElementById('submitEditLink');

    const closeButtons = document.querySelectorAll('.close-button');

    function showStatus(message, isError = false, duration = 3000) {
        statusMessageEl.textContent = message;
        statusMessageEl.className = `mb-2 text-sm italic h-5 ${isError ? 'text-red-500' : 'text-blue-600'}`;
        if (message && duration > 0) {
            setTimeout(() => {
                if (statusMessageEl.textContent === message) { // Clear only if message hasn't changed
                    statusMessageEl.textContent = '';
                }
            }, duration);
        }
    }

    function updatePasteButtonState() {
        pasteBtn.disabled = clipboard.items.length === 0;
    }

    function clearClipboard() {
        clipboard.items = [];
        clipboard.action = null;
        updatePasteButtonState();
    }
    
    function updateItemVisuals() {
        const allItemDivs = itemListContainer.querySelectorAll('div[data-item-id]');
        allItemDivs.forEach(div => {
            const id = div.dataset.itemId;
            div.classList.toggle('selected-item', selectedItemIds.includes(id));
            div.classList.toggle('hover:bg-gray-100', !selectedItemIds.includes(id));
            
            div.classList.toggle('focused-item-outline', id === focusedItemId && !selectedItemIds.includes(id));

            if (id === focusedItemId) {
                div.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            }
        });
    }

    function openModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.style.display = 'block';
        if (modalId === 'addFolderModal') { newFolderNameInput.focus(); newFolderNameInput.select(); } 
        else if (modalId === 'addLinkModal') { newLinkNameInput.focus(); newLinkNameInput.select(); } 
        else if (modalId === 'editLinkModal') { editLinkNameInput.focus(); editLinkNameInput.select(); }
    }

    function closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (!modal) return;
        modal.style.display = 'none';
        if (modalId === 'addFolderModal') { newFolderNameInput.value = ''; addFolderBtn.focus(); } 
        else if (modalId === 'addLinkModal') { newLinkNameInput.value = ''; newLinkUrlInput.value = ''; addLinkBtn.focus(); } 
        else if (modalId === 'editLinkModal') { editLinkNameInput.value = ''; editLinkUrlInput.value = ''; editingItemId = null; }
        
        const isAnotherModalOpen = Array.from(document.querySelectorAll('.modal')).some(m => m.style.display === 'block');
        if (!isAnotherModalOpen && (document.activeElement === document.body || document.getElementById(modalId)?.contains(document.activeElement))) {
            itemListContainer.focus();
        }
    }

    addFolderBtn.addEventListener('click', () => openModal('addFolderModal'));
    addLinkBtn.addEventListener('click', () => openModal('addLinkModal'));
    closeButtons.forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.modalId)));
    
    document.addEventListener('click', (event) => {
        if (event.target.classList.contains('modal')) { closeModal(event.target.id); return; }
        const isModalOpen = document.querySelector('.modal[style*="display: block"]');
        if (isModalOpen || isInlineRenamingFolder) return;
        const clickedElement = event.target;
        if (!clickedElement.closest('div[data-item-id]') &&
            !clickedElement.closest('#breadcrumbs span.cursor-pointer') &&
            !clickedElement.closest('#controls button') && // More specific: include pasteBtn explicitly if needed
            !clickedElement.closest('.modal-content') &&
             selectedItemIds.length > 0) {
            selectedItemIds = []; anchorItemIdForShift = null; focusedItemId = null;
            updateItemVisuals();
        }
    });
    
    // Modal input handlers (Enter/Escape)
    newFolderNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); if (newFolderNameInput.value.trim()) submitAddFolderBtn.click(); else showStatus("Folder name cannot be empty.", true, 2000); } });
    addFolderModal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeModal('addFolderModal'); } });
    newLinkNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); newLinkUrlInput.focus(); } });
    newLinkUrlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); const linkNameVal = newLinkNameInput.value.trim(); let linkUrlVal = newLinkUrlInput.value.trim(); if (linkNameVal && linkUrlVal) { if (linkUrlVal && !linkUrlVal.match(/^([a-zA-Z]+:)?\/\//)) linkUrlVal = 'https://' + linkUrlVal; if (!linkUrlVal.startsWith('http://') && !linkUrlVal.startsWith('https://')) { showStatus("URL must start with http:// or https://.", true, 3500); return; } submitAddLinkBtn.click(); } else { showStatus( (!linkNameVal && !linkUrlVal) ? "Link name and URL cannot be empty." : (!linkNameVal ? "Link name cannot be empty." : "Link URL cannot be empty."), true, 2000); } } });
    addLinkModal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeModal('addLinkModal'); } });
    editLinkNameInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); editLinkUrlInput.focus(); } });
    editLinkUrlInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); submitEditLinkBtn.click(); } });
    editLinkModal.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); closeModal('editLinkModal'); } });

    submitEditLinkBtn.addEventListener('click', async () => {
        const linkName = editLinkNameInput.value.trim(); let linkUrl = editLinkUrlInput.value.trim();
        if (!editingItemId) { showStatus("Error: No item selected for editing.", true); return; }
        if (!linkName || !linkUrl) { showStatus("Link name and URL cannot be empty.", true, 2000); return; }
        if (linkUrl && !linkUrl.match(/^([a-zA-Z]+:)?\/\//)) linkUrl = 'https://' + linkUrl;
        if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) { showStatus("URL must start with http:// or https://.", true, 3500); return; }
        
        try {
            const originalItemDoc = await itemsCollection.doc(editingItemId).get();
            if (!originalItemDoc.exists) { showStatus("Item to edit no longer exists (possibly deleted by another user).", true, 4000); closeModal('editLinkModal'); return; }
            const originalItemData = originalItemDoc.data();

            if (originalItemData.name !== linkName) { // Name changed, check for conflict
                const conflictCheck = await itemsCollection.where("parentId", "==", originalItemData.parentId).where("name", "==", linkName).where("type", "==", "link").limit(1).get();
                if (!conflictCheck.empty && conflictCheck.docs[0].id !== editingItemId) { showStatus(`A link named "${linkName}" already exists here.`, true, 4000); editLinkNameInput.focus(); editLinkNameInput.select(); return; }
            }
            await itemsCollection.doc(editingItemId).update({ name: linkName, url: linkUrl });
            closeModal('editLinkModal'); 
            showStatus(`Link "${linkName}" updated.`);
        } catch (error) { console.error("Error updating link: ", error); showStatus(`Failed to update link: ${error.message}.`, true); }
    });

    function renderBreadcrumbs() {
        breadcrumbsContainer.innerHTML = '';
        currentPath.forEach((segment, index) => {
            const span = document.createElement('span');
            span.textContent = segment.name;
            if (index < currentPath.length - 1) {
                span.classList.add('cursor-pointer', 'hover:underline', 'text-blue-500', 'p-1');
                span.addEventListener('click', () => navigateToFolder(segment.id, segment.name, index));
                span.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; span.classList.add('drop-target-breadcrumbs'); });
                span.addEventListener('dragleave', () => span.classList.remove('drop-target-breadcrumbs'));
                span.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); span.classList.remove('drop-target-breadcrumbs'); const data = e.dataTransfer.getData('text/plain'); if (!data) return; const { draggedItemId, draggedItemType, originalParentId: draggedOriginalParentId, draggedItemName } = JSON.parse(data); await handleDrop(draggedItemId, draggedItemType, draggedOriginalParentId, segment.id, draggedItemName); });
                breadcrumbsContainer.appendChild(span);
                const separator = document.createElement('span'); separator.textContent = ' / '; separator.classList.add('mx-1');
                breadcrumbsContainer.appendChild(separator);
            } else {
                span.classList.add('p-1', 'text-gray-500'); breadcrumbsContainer.appendChild(span);
            }
        });
    }
    
    function renderItemsFromSnapshot(querySnapshot) {
        if (isInlineRenamingFolder) {
            console.warn("Snapshot received during inline folder rename. DOM update deferred.");
            return;
        }
        itemListContainer.innerHTML = '';
        const itemsArray = [];
        querySnapshot.forEach(doc => itemsArray.push({ id: doc.id, ...doc.data() }));

        if (itemsArray.length === 0) {
            itemListContainer.innerHTML = '<p class="text-gray-500">This folder is empty.</p>';
            if (!querySnapshot.metadata.fromCache) { // Server update confirming empty or deleted content
                 focusedItemId = null; selectedItemIds = []; anchorItemIdForShift = null;
            }
            updateItemVisuals();
            return;
        }

        itemsArray.forEach(item => {
            const itemId = item.id;
            const itemDiv = document.createElement('div');
            itemDiv.className = 'flex items-center justify-between p-2 rounded border-b last:border-b-0';
            itemDiv.dataset.itemId = itemId; itemDiv.classList.add('hover:bg-gray-100');
            itemDiv.draggable = true;

            itemDiv.addEventListener('dragstart', (e) => {
                if (isInlineRenamingFolder) { e.preventDefault(); return; }
                const itemsToDrag = selectedItemIds.includes(itemId) ? selectedItemIds : [itemId];
                itemsToDrag.forEach(id => itemListContainer.querySelector(`div[data-item-id="${id}"]`)?.classList.add('dragging-item'));
                // For simplicity, drag data is for the primary item. Multi-item drag-and-drop needs more complex data.
                // Here, we'll assume single item drag initiation or first of selected.
                e.dataTransfer.setData('text/plain', JSON.stringify({ draggedItemId: itemId, draggedItemType: item.type, draggedItemName: item.name, originalParentId: item.parentId, selectedDraggedIds: itemsToDrag }));
                e.dataTransfer.effectAllowed = 'move';
            });
            itemDiv.addEventListener('dragend', () => itemListContainer.querySelectorAll('.dragging-item').forEach(el => el.classList.remove('dragging-item')));

            const nameAndIconDiv = document.createElement('div');
            nameAndIconDiv.className = 'flex items-center cursor-pointer flex-grow';
            nameAndIconDiv.dataset.nameContainer = true;

            nameAndIconDiv.addEventListener('click', (e) => { /* Selection logic from original, seems fine */ 
                if (isInlineRenamingFolder || e.target.closest('.item-actions') || e.target.classList.contains('item-rename-input')) return;
                const clickedItemId = itemId; const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0; const ctrlKey = isMac ? e.metaKey : e.ctrlKey;
                if (e.shiftKey && anchorItemIdForShift) {
                    const allEls = Array.from(itemListContainer.querySelectorAll('div[data-item-id]'));
                    const anchorIdx = allEls.findIndex(el => el.dataset.itemId === anchorItemIdForShift); const currentIdx = allEls.findIndex(el => el.dataset.itemId === clickedItemId);
                    if (anchorIdx !== -1 && currentIdx !== -1) {
                        const newSel = new Set(ctrlKey ? selectedItemIds : []); const start = Math.min(anchorIdx, currentIdx); const end = Math.max(anchorIdx, currentIdx);
                        for (let i = start; i <= end; i++) newSel.add(allEls[i].dataset.itemId);
                        selectedItemIds = Array.from(newSel);
                    } else { selectedItemIds = [clickedItemId]; anchorItemIdForShift = clickedItemId; }
                } else if (ctrlKey) {
                    if (selectedItemIds.includes(clickedItemId)) { selectedItemIds = selectedItemIds.filter(id => id !== clickedItemId); if (anchorItemIdForShift === clickedItemId) anchorItemIdForShift = selectedItemIds.length > 0 ? selectedItemIds[selectedItemIds.length - 1] : null; }
                    else { selectedItemIds.push(clickedItemId); anchorItemIdForShift = clickedItemId; }
                } else { selectedItemIds = [clickedItemId]; anchorItemIdForShift = clickedItemId; }
                focusedItemId = clickedItemId; updateItemVisuals();
            });
            nameAndIconDiv.addEventListener('dblclick', async (e) => {
                if (isInlineRenamingFolder || e.target.closest('.item-actions') || e.target.classList.contains('item-rename-input')) return;
                // Re-fetch item to ensure it still exists before navigating or opening
                try {
                    const itemDoc = await itemsCollection.doc(itemId).get();
                    if (!itemDoc.exists) { showStatus("Item no longer exists.", true); return; }
                    const freshItemData = itemDoc.data();
                    if (freshItemData.type === 'folder') navigateToFolder(itemId, freshItemData.name); 
                    else if (freshItemData.type === 'link') window.open(freshItemData.url, '_blank');
                } catch (error) { console.error("Error on dblclick:", error); showStatus("Error opening item.", true); }
            });

            if (item.type === 'folder') {
                nameAndIconDiv.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); e.dataTransfer.dropEffect = 'move'; const dataStr = e.dataTransfer.getData('text/plain'); if (!dataStr) return; const data = JSON.parse(dataStr); if (data.draggedItemId !== itemId && !(data.selectedDraggedIds && data.selectedDraggedIds.includes(itemId)) ) nameAndIconDiv.classList.add('drop-target-folder'); });
                nameAndIconDiv.addEventListener('dragleave', (e) => { e.stopPropagation(); nameAndIconDiv.classList.remove('drop-target-folder'); });
                nameAndIconDiv.addEventListener('drop', async (e) => { e.preventDefault(); e.stopPropagation(); nameAndIconDiv.classList.remove('drop-target-folder'); const dataStr = e.dataTransfer.getData('text/plain'); if (!dataStr) return; const { draggedItemId, draggedItemType, originalParentId: dOrigPId, draggedItemName, selectedDraggedIds } = JSON.parse(dataStr); if (selectedDraggedIds && selectedDraggedIds.includes(itemId)) { showStatus("Cannot drop items into one of the selected items being dragged.", true); return; } await handleDrop(draggedItemId, draggedItemType, dOrigPId, itemId, draggedItemName, selectedDraggedIds); });
            }
            const icon = document.createElement('i'); icon.className = `item-icon fas ${item.type === 'folder' ? 'fa-folder text-yellow-500' : 'fa-link text-blue-500'}`;
            nameAndIconDiv.appendChild(icon);
            const nameSpan = document.createElement('span'); nameSpan.textContent = item.name; nameSpan.dataset.nameSpan = true;
            nameAndIconDiv.appendChild(nameSpan); itemDiv.appendChild(nameAndIconDiv);

            const actionsDiv = document.createElement('div'); actionsDiv.className = 'item-actions flex space-x-2 items-center ml-2';
            const editBtnEl = document.createElement('button'); editBtnEl.innerHTML = '<i class="fas fa-edit text-green-500 hover:text-green-700"></i>'; editBtnEl.className = 'p-1'; editBtnEl.title = `Edit ${item.type} (F2)`;
            editBtnEl.addEventListener('click', (e) => { e.stopPropagation(); enableRename(itemId, itemDiv); }); actionsDiv.appendChild(editBtnEl);
            const copyBtnEl = document.createElement('button'); copyBtnEl.innerHTML = '<i class="fas fa-copy text-blue-500 hover:text-blue-700"></i>'; copyBtnEl.className = 'p-1'; copyBtnEl.title = "Copy (Ctrl+C)";
            copyBtnEl.addEventListener('click', (e) => { e.stopPropagation(); handleCopySingleItem(itemId, item); }); actionsDiv.appendChild(copyBtnEl);
            const cutBtnEl = document.createElement('button'); cutBtnEl.innerHTML = '<i class="fas fa-cut text-orange-500 hover:text-orange-700"></i>'; cutBtnEl.className = 'p-1'; cutBtnEl.title = "Cut (Ctrl+X)";
            cutBtnEl.addEventListener('click', (e) => { e.stopPropagation(); handleCutSingleItem(itemId, item); }); actionsDiv.appendChild(cutBtnEl);
            const deleteBtnEl = document.createElement('button'); deleteBtnEl.innerHTML = '<i class="fas fa-trash-alt text-red-500 hover:text-red-700"></i>'; deleteBtnEl.className = 'p-1'; deleteBtnEl.title = `Delete ${item.type} (Delete)`;
            deleteBtnEl.addEventListener('click', (e) => { e.stopPropagation(); deleteItem(itemId, item.type, item.name); }); actionsDiv.appendChild(deleteBtnEl);
            itemDiv.appendChild(actionsDiv); itemListContainer.appendChild(itemDiv);
        });

        // Preserve focus and selection: filter out IDs that no longer exist in itemsArray
        selectedItemIds = selectedItemIds.filter(id => itemsArray.some(item => item.id === id));
        if (selectedItemIds.length === 0) anchorItemIdForShift = null;
        else if (anchorItemIdForShift && !selectedItemIds.includes(anchorItemIdForShift)) anchorItemIdForShift = selectedItemIds[0] || null;
        
        const currentFocusedItemStillExists = itemsArray.some(i => i.id === focusedItemId);
        if (!currentFocusedItemStillExists) { // If focused item disappeared
            if (selectedItemIds.length > 0) focusedItemId = selectedItemIds[0]; // Focus first selected
            else if (itemsArray.length > 0) focusedItemId = itemsArray[0].id; // Focus first available
            else focusedItemId = null;
        }
        if (!focusedItemId && itemsArray.length > 0 && selectedItemIds.length === 0) {
            focusedItemId = itemsArray[0].id;
        }
        updateItemVisuals();
    }

    async function setupFolderItemsListener(folderIdToListen) {
        if (currentFolderItemsListenerUnsubscribe) {
            currentFolderItemsListenerUnsubscribe();
            currentFolderItemsListenerUnsubscribe = null;
        }
        itemListContainer.innerHTML = '<p class="text-gray-500">Loading items...</p>';

        const query = itemsCollection
            .where("parentId", "==", folderIdToListen)
            .orderBy("type", "desc") // Folders first
            .orderBy("name", "asc");

        currentFolderItemsListenerUnsubscribe = query.onSnapshot(
            renderItemsFromSnapshot,
            error => {
                console.error("Error with Firestore items listener: ", error);
                showStatus("Error loading items. Real-time updates may be affected.", true, 5000);
                itemListContainer.innerHTML = '<p class="text-red-500">Error loading items. Please try navigating again.</p>';
                // Consider navigating to Root if error implies current folder is inaccessible
                if (currentFolderId === folderIdToListen && (error.code === 'permission-denied' || error.code === 'unauthenticated')) {
                    showStatus("Access denied or folder issue. Navigating to Root.", true, 5000);
                    _navigateToFolderInternal(null, "Root", 0, true); // Use internal to avoid loop
                }
            }
        );
    }
    
    // The main navigation function, now more robust
    async function navigateToFolder(targetFolderId, targetFolderNameFromPath, pathIndexToSlice = -1) {
        // Detach previous listener for the folder *document* itself early
        if (currentViewingFolderDocListenerUnsubscribe) {
            currentViewingFolderDocListenerUnsubscribe();
            currentViewingFolderDocListenerUnsubscribe = null;
        }
        // Detach items listener too, will be re-attached by _navigateToFolderInternal
        if (currentFolderItemsListenerUnsubscribe) {
            currentFolderItemsListenerUnsubscribe();
            currentFolderItemsListenerUnsubscribe = null;
        }
        
        let effectiveFolderId = targetFolderId;
        let effectiveFolderName = targetFolderNameFromPath;
        let effectivePathIndex = pathIndexToSlice;

        // 1. Validate targetFolderId if not Root
        if (effectiveFolderId !== null) {
            try {
                const folderDoc = await itemsCollection.doc(effectiveFolderId).get();
                if (!folderDoc.exists) {
                    showStatus(`Folder "${effectiveFolderName}" no longer exists. Attempting to find last valid parent.`, true, 5000);
                    // Try to navigate to the closest existing parent from currentPath or root
                    let foundValidParent = false;
                    for (let i = Math.min(currentPath.length - 1, (effectivePathIndex > -1 ? effectivePathIndex : currentPath.length -1) ); i >= 0; i--) {
                         const segment = currentPath[i];
                         if (segment.id === null) { // Root is always valid
                            effectiveFolderId = null; effectiveFolderName = "Root"; effectivePathIndex = 0;
                            foundValidParent = true; break;
                         }
                         const parentDoc = await itemsCollection.doc(segment.id).get();
                         if (parentDoc.exists) {
                            effectiveFolderId = segment.id; effectiveFolderName = segment.name; effectivePathIndex = i;
                            foundValidParent = true; break;
                         }
                    }
                    if (!foundValidParent) { // Fallback to Root if no valid parent in path found
                         effectiveFolderId = null; effectiveFolderName = "Root"; effectivePathIndex = 0;
                    }
                    showStatus(`Navigated to "${effectiveFolderName}" as "${targetFolderNameFromPath}" was not found.`, false, 4000);
                } else {
                    effectiveFolderName = folderDoc.data().name; // Use fresh name from DB
                }
            } catch (error) {
                console.error("Error checking folder existence during navigation:", error);
                showStatus("Error accessing folder. Navigating to Root.", true, 4000);
                effectiveFolderId = null; effectiveFolderName = "Root"; effectivePathIndex = 0;
            }
        }
        _navigateToFolderInternal(effectiveFolderId, effectiveFolderName, effectivePathIndex);
    }

    function _navigateToFolderInternal(folderId, folderName, pathIndex = -1) {
        currentFolderId = folderId;
        selectedItemIds = []; anchorItemIdForShift = null; focusedItemId = null;

        // Reconstruct currentPath
        if (pathIndex > -1) { // Navigating via breadcrumb click or to a known parent
            currentPath = currentPath.slice(0, pathIndex + 1);
            // Ensure the name in path is up-to-date if we navigated to an existing segment
            if (currentPath[pathIndex] && currentPath[pathIndex].id === folderId) {
                 currentPath[pathIndex].name = folderName;
            } else { // Path became inconsistent, rebuild (should be rare with pre-checks)
                console.warn("Path inconsistency during slice. Rebuilding to current target.");
                _rebuildPathTo(folderId, folderName); // Async, but breadcrumbs will update
            }
        } else { // Navigating "down" or to root directly
            if (folderId === null) { // To Root
                currentPath = [{ id: null, name: "Root" }];
            } else { // Navigating into a subfolder not already in path history for this branch
                // Check if current last path segment is indeed the parent of 'folderId'
                // This logic assumes 'folderId' is a direct child or path was reconstructed.
                // For simplicity, if pathIndex is -1, we append. Robustness relies on caller.
                const existingIndexInPath = currentPath.findIndex(p => p.id === folderId);
                if (existingIndexInPath !== -1) { // Should have been caught by pathIndex > -1
                    currentPath = currentPath.slice(0, existingIndexInPath + 1);
                    currentPath[existingIndexInPath].name = folderName;
                } else {
                    currentPath.push({ id: folderId, name: folderName });
                }
            }
        }
        // Final path validation
        if (currentPath[currentPath.length - 1].id !== currentFolderId || currentPath[currentPath.length -1].name !== folderName) {
            console.warn(`Path final segment (${currentPath[currentPath.length -1].name}) mismatch with target (${folderName}). Fixing.`);
            currentPath[currentPath.length -1] = {id: currentFolderId, name: folderName}; // Force last segment
        }


        renderBreadcrumbs();
        setupFolderItemsListener(currentFolderId); // Sets up listener for ITEMS IN FOLDER

        // Setup listener for the FOLDER DOCUMENT ITSELF (if not root)
        if (currentFolderId !== null) {
            const folderDocRef = itemsCollection.doc(currentFolderId);
            currentViewingFolderDocListenerUnsubscribe = folderDocRef.onSnapshot(docSnapshot => {
                // Check if this listener is still for the actively viewed folder
                if (currentFolderId !== folderDocRef.id) {
                    if (currentViewingFolderDocListenerUnsubscribe) currentViewingFolderDocListenerUnsubscribe(); // Detach self if stale
                    return;
                }

                if (!docSnapshot.exists) {
                    showStatus(`Folder "${folderName}" (you were in) was deleted by another user. Navigating to Root.`, true, 6000);
                    // No need to detach currentFolderItemsListenerUnsubscribe, navigateToFolder will handle it.
                    navigateToFolder(null, "Root"); // This will re-trigger the whole navigation flow
                } else {
                    const freshFolderData = docSnapshot.data();
                    if (folderName !== freshFolderData.name) { // Current folder was renamed
                        showStatus(`Current folder renamed from "${folderName}" to "${freshFolderData.name}".`, false, 4000);
                        // Update currentPath's last segment and current internal folderName variable
                        currentPath[currentPath.length - 1].name = freshFolderData.name;
                        folderName = freshFolderData.name; // Update local `folderName` for this scope if it's used by breadcrumbs
                        renderBreadcrumbs();
                    }
                }
            }, error => {
                console.error("Error listening to current folder document:", error);
                if (currentFolderId === folderDocRef.id) { // Check if listener is still relevant
                    showStatus("Error with current folder status. Navigating to Root.", true, 4000);
                    navigateToFolder(null, "Root");
                }
            });
        }
        itemListContainer.focus();
    }
    
    // Helper to rebuild path if needed (can be slow if deep)
    async function _rebuildPathTo(targetFolderId, targetFolderName) {
        if (targetFolderId === null) {
            currentPath = [{ id: null, name: "Root" }];
            renderBreadcrumbs();
            return;
        }
        const newPath = [{ id: targetFolderId, name: targetFolderName }];
        let currentId = targetFolderId;
        try {
            while (currentId !== null) {
                const doc = await itemsCollection.doc(currentId).get();
                if (!doc.exists) break; // Should not happen if targetFolderId is valid
                const data = doc.data();
                if (data.parentId === null) {
                    newPath.push({ id: null, name: "Root" });
                    break;
                }
                const parentDoc = await itemsCollection.doc(data.parentId).get();
                if (!parentDoc.exists) { // Parent deleted, path broken
                    newPath.push({ id: null, name: "Root" }); // Add root and stop
                    break;
                }
                newPath.push({ id: parentDoc.id, name: parentDoc.data().name });
                currentId = parentDoc.id;
            }
            currentPath = newPath.reverse();
            renderBreadcrumbs();
        } catch (e) {
            console.error("Error rebuilding path", e);
            currentPath = [{id: null, name: "Root"}, {id: targetFolderId, name: targetFolderName}]; // Fallback
            renderBreadcrumbs();
        }
    }


    submitAddFolderBtn.addEventListener('click', async () => {
        const folderName = newFolderNameInput.value.trim(); if (!folderName) { showStatus("Folder name cannot be empty.", true, 2000); return; }
        try {
            // Optimistically check currentFolderId's existence if not root
            if (currentFolderId) {
                const parentDoc = await itemsCollection.doc(currentFolderId).get();
                if (!parentDoc.exists) {
                    showStatus("Parent folder no longer exists. Cannot add folder.", true, 4000);
                    closeModal('addFolderModal');
                    navigateToFolder(null, "Root"); // Or last known valid path
                    return;
                }
            }
            const conflictCheck = await itemsCollection.where("parentId", "==", currentFolderId).where("name", "==", folderName).where("type", "==", "folder").limit(1).get();
            if (!conflictCheck.empty) { showStatus(`Folder "${folderName}" already exists.`, true, 3000); return; }
            await itemsCollection.add({ name: folderName, type: "folder", parentId: currentFolderId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            closeModal('addFolderModal'); 
            showStatus(`Folder "${folderName}" created.`);
        } catch (error) { console.error("Error adding folder: ", error); showStatus(`Failed to add folder: ${error.message}. Target folder might be gone.`, true, 4000); }
    });

    submitAddLinkBtn.addEventListener('click', async () => {
        const linkName = newLinkNameInput.value.trim(); let linkUrl = newLinkUrlInput.value.trim();
        if (!linkName || !linkUrl) { showStatus("Link name and URL cannot be empty.", true, 2000); return; }
        if (linkUrl && !linkUrl.match(/^([a-zA-Z]+:)?\/\//)) linkUrl = 'https://' + linkUrl;
        if (!linkUrl.startsWith('http://') && !linkUrl.startsWith('https://')) { showStatus("URL must start with http:// or https://.", true, 3500); return; }
        try {
            // Optimistically check currentFolderId's existence if not root
            if (currentFolderId) {
                const parentDoc = await itemsCollection.doc(currentFolderId).get();
                if (!parentDoc.exists) {
                    showStatus("Parent folder no longer exists. Cannot add link.", true, 4000);
                    closeModal('addLinkModal');
                    navigateToFolder(null, "Root"); // Or last known valid path
                    return;
                }
            }
            const conflictCheck = await itemsCollection.where("parentId", "==", currentFolderId).where("name", "==", linkName).where("type", "==", "link").limit(1).get();
            if (!conflictCheck.empty) { showStatus(`Link "${linkName}" already exists.`, true, 3000); return; }
            await itemsCollection.add({ name: linkName, url: linkUrl, type: "link", parentId: currentFolderId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
            closeModal('addLinkModal'); 
            showStatus(`Link "${linkName}" added.`);
        } catch (error) { console.error("Error adding link: ", error); showStatus(`Failed to add link: ${error.message}. Target folder might be gone.`, true, 4000); }
    });

    async function deleteItem(itemId, itemType, itemName) { // Single item delete
        const confirmMsg = `Delete ${itemType} "${itemName}"?${itemType === 'folder' ? ' ALL contents will be deleted.' : ''} This is irreversible.`;
        if (!confirm(confirmMsg)) return;
        showStatus(`Deleting ${itemType} "${itemName}"...`, false, 0); // No timeout
        try {
            const itemDoc = await itemsCollection.doc(itemId).get();
            if (!itemDoc.exists) { showStatus(`${itemType} "${itemName}" was already deleted.`, false, 3000); return; }

            // Logic to determine next focus (simplified, listener handles actual UI update)
            let nextFocusedCandidateId = null;
            if (focusedItemId === itemId) {
                const allItemDivs = Array.from(itemListContainer.querySelectorAll('div[data-item-id]'));
                const currentIndex = allItemDivs.findIndex(div => div.dataset.itemId === itemId);
                if (currentIndex !== -1 && allItemDivs.length > 1) {
                    nextFocusedCandidateId = (allItemDivs[currentIndex + 1] || allItemDivs[currentIndex - 1])?.dataset.itemId;
                }
            }

            if (itemType === 'link') {
                await itemsCollection.doc(itemId).delete();
            } else if (itemType === 'folder') {
                await deleteFolderRecursive(itemId);
            }
            showStatus(`${itemType.charAt(0).toUpperCase() + itemType.slice(1)} "${itemName}" deleted.`);
            
            selectedItemIds = selectedItemIds.filter(id => id !== itemId); 
            if (anchorItemIdForShift === itemId) anchorItemIdForShift = selectedItemIds.length > 0 ? selectedItemIds[0] : null;
            if (focusedItemId === itemId) focusedItemId = nextFocusedCandidateId || (selectedItemIds.length > 0 ? selectedItemIds[0] : null);
            
            clipboard.items = clipboard.items.filter(ci => ci.id !== itemId); updatePasteButtonState();
            // Visuals updated by listener. If last item, focusedItemId will become null if nextFocused is null.
        } catch (error) { console.error(`Error deleting ${itemType}: `, error); showStatus(`Failed to delete ${itemType}: ${error.message}. It might have been already modified.`, true); }
    }

    async function deleteFolderRecursive(folderId) {
        const batch = db.batch();
        let operationsInBatch = 0;
        const MAX_BATCH_OPS = 450; // Firestore limit 500, safety margin

        async function commitBatchIfFull(currentBatch) {
            if (operationsInBatch >= MAX_BATCH_OPS) {
                await currentBatch.commit();
                operationsInBatch = 0;
                return db.batch(); // Return new batch
            }
            return currentBatch; // Return same batch
        }

        const itemsInFolderQuery = itemsCollection.where("parentId", "==", folderId);
        const itemsSnapshot = await itemsInFolderQuery.get();
        
        const subFolderDeletePromises = [];
        for (const doc of itemsSnapshot.docs) {
            const item = doc.data();
            if (item.type === 'folder') {
                subFolderDeletePromises.push(deleteFolderRecursive(doc.id)); // Recursive call
            } else {
                batch.delete(doc.ref);
                operationsInBatch++;
                batch = await commitBatchIfFull(batch);
            }
        }
        if (operationsInBatch > 0) await batch.commit(); // Commit remaining link deletions
        await Promise.all(subFolderDeletePromises); // Wait for all subfolders to be deleted
        
        // Finally, delete the folder itself (if it wasn't already deleted by a concurrent op)
        try {
            const folderDocRef = itemsCollection.doc(folderId);
            // Optional: check if it still exists before deleting, though delete is idempotent
            // const folderDoc = await folderDocRef.get();
            // if (folderDoc.exists) { await folderDocRef.delete(); }
            await folderDocRef.delete();
        } catch (delError) {
            // If folder was already deleted (e.g. by another user), this might error or do nothing.
            // Firestore delete on non-existent doc is a no-op.
            console.warn(`Minor issue deleting folder ${folderId}, might be already gone: ${delError.message}`);
        }
    }
    
    // --- Clipboard Handlers (Copy/Cut single/multiple) ---
    // These are largely unchanged but their usage context is now more robust due to folder listeners
    function handleCopySingleItem(itemId, itemData) { clearClipboard(); clipboard.items.push({ id: itemId, type: itemData.type, name: itemData.name, data: { ...itemData } }); clipboard.action = 'copy'; updatePasteButtonState(); showStatus(`Copied "${itemData.name}".`); }
    function handleCutSingleItem(itemId, itemData) { clearClipboard(); clipboard.items.push({ id: itemId, type: itemData.type, name: itemData.name, originalParentId: itemData.parentId }); clipboard.action = 'cut'; updatePasteButtonState(); showStatus(`Cut "${itemData.name}".`); }
    async function handleCopySelectedItems() { if (selectedItemIds.length === 0) return; clearClipboard(); const itemFetchPromises = selectedItemIds.map(id => itemsCollection.doc(id).get()); const itemDocs = await Promise.all(itemFetchPromises); itemDocs.forEach(docSnap => { if (docSnap.exists) { const itemData = docSnap.data(); clipboard.items.push({ id: docSnap.id, type: itemData.type, name: itemData.name, data: { ...itemData } }); } }); if (clipboard.items.length > 0) { clipboard.action = 'copy'; updatePasteButtonState(); showStatus(`${clipboard.items.length} item(s) copied.`); } else showStatus(`Selected item(s) not found for copying (possibly deleted).`, true); }
    async function handleCutSelectedItems() { if (selectedItemIds.length === 0) return; clearClipboard(); const itemFetchPromises = selectedItemIds.map(id => itemsCollection.doc(id).get()); const itemDocs = await Promise.all(itemFetchPromises); itemDocs.forEach(docSnap => { if (docSnap.exists) { const itemData = docSnap.data(); clipboard.items.push({ id: docSnap.id, type: itemData.type, name: itemData.name, originalParentId: itemData.parentId }); } }); if (clipboard.items.length > 0) { clipboard.action = 'cut'; updatePasteButtonState(); showStatus(`${clipboard.items.length} item(s) cut.`); } else showStatus(`Selected item(s) not found for cutting (possibly deleted).`, true); }
    
    async function isDescendant(potentialDescendantFolderId, potentialAncestorFolderId) {
        if (!potentialDescendantFolderId || (potentialAncestorFolderId === undefined)) return false; // Ancestor can be null (root)
        if (potentialDescendantFolderId === potentialAncestorFolderId) return true;
        if (potentialDescendantFolderId === null) return false; // Root cannot be a descendant of a non-root folder

        let currentIdToCheck = potentialDescendantFolderId;
        const visited = new Set(); 
        try {
            while (currentIdToCheck) {
                if (visited.has(currentIdToCheck)) { console.warn("Cycle detected in parent chain for ID:", currentIdToCheck); return true; } // Treat cycle as error / descendant
                visited.add(currentIdToCheck);
                const doc = await itemsCollection.doc(currentIdToCheck).get();
                if (!doc.exists) return false; // Path broken, not a descendant
                const itemData = doc.data();
                if (itemData.parentId === potentialAncestorFolderId) return true;
                currentIdToCheck = itemData.parentId;
            }
        } catch (error) { console.error("Error in isDescendant check:", error); showStatus("Error checking folder structure.", true); return true; } // Fail safe
        return false;
    }
    
    async function copyFolderRecursive(originalFolderId, originalFolderName, targetParentId) {
        let newFolderName = originalFolderName;
        // Check for name conflict for the folder itself and find unique name
        const baseName = originalFolderName.replace(/ \(Copy( \d+)?\)$/, '');
        let suffixCounter = 0;
        while (true) {
            const existingCheck = await itemsCollection.where("parentId", "==", targetParentId).where("name", "==", newFolderName).where("type", "==", "folder").limit(1).get();
            if (existingCheck.empty) break;
            suffixCounter++;
            newFolderName = `${baseName} (Copy${suffixCounter > 1 ? ' ' + suffixCounter : ''})`;
            if (suffixCounter > 100) throw new Error("Too many copies with same name, aborting.");
        }

        const newFolderRef = itemsCollection.doc(); // Firestore generates ID
        await newFolderRef.set({ name: newFolderName, type: "folder", parentId: targetParentId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
        const newClonedFolderId = newFolderRef.id;

        const childrenSnapshot = await itemsCollection.where("parentId", "==", originalFolderId).get();
        if (childrenSnapshot.empty) return newClonedFolderId;

        let batch = db.batch();
        let batchOperationsCount = 0;
        const MAX_BATCH_OPERATIONS = 450;
        const childFolderCopyPromises = [];

        for (const childDoc of childrenSnapshot.docs) {
            const childData = childDoc.data();
            const childId = childDoc.id;

            if (childData.type === 'link') {
                // Optional: check/rename link conflicts (simplified: allow duplicates across folders or same name if copied)
                const newLinkRef = itemsCollection.doc();
                batch.set(newLinkRef, { ...childData, parentId: newClonedFolderId, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
                batchOperationsCount++;
            } else if (childData.type === 'folder') {
                if (batchOperationsCount > 0) { await batch.commit(); batch = db.batch(); batchOperationsCount = 0; }
                childFolderCopyPromises.push(copyFolderRecursive(childId, childData.name, newClonedFolderId));
            }
            if (batchOperationsCount >= MAX_BATCH_OPERATIONS) { await batch.commit(); batch = db.batch(); batchOperationsCount = 0; }
        }
        if (batchOperationsCount > 0) await batch.commit();
        await Promise.all(childFolderCopyPromises);
        return newClonedFolderId;
    }

    pasteBtn.addEventListener('click', async () => {
        if (clipboard.items.length === 0) { showStatus("Clipboard is empty.", true); return; }
        
        // Check if current target folder still exists
        if (currentFolderId !== null) {
            const targetParentDoc = await itemsCollection.doc(currentFolderId).get();
            if (!targetParentDoc.exists) {
                showStatus("Target folder for paste no longer exists. Operation cancelled.", true, 5000);
                navigateToFolder(null, "Root"); // Navigate to safety
                return;
            }
        }
        showStatus(`Pasting ${clipboard.items.length} item(s)...`, false, 0);
        let itemsProcessed = 0, errorsEncountered = 0;
        const itemsToClearFromCutClipboard = [];
        let batch = db.batch(); let batchHasOperations = false;

        for (const clipItem of clipboard.items) {
            try {
                // Pre-fetch the item to ensure it still exists, especially for 'cut'
                const itemToProcessDoc = await itemsCollection.doc(clipItem.id).get();
                if (!itemToProcessDoc.exists && clipboard.action === 'cut') {
                    showStatus(`Item "${clipItem.name}" to be cut no longer exists. Skipped.`, true); errorsEncountered++; continue;
                }
                // if !itemToProcessDoc.exists && clipboard.action === 'copy', it means source was deleted.
                // copyFolderRecursive and link copy will handle data from clipItem.data if needed.

                if (clipboard.action === 'cut') {
                    if (clipItem.id === currentFolderId) { showStatus(`Cannot move folder "${clipItem.name}" into itself. Skipped.`, true); errorsEncountered++; continue; }
                    if (clipItem.type === 'folder' && await isDescendant(currentFolderId, clipItem.id)) { showStatus(`Cannot move folder "${clipItem.name}" into its own subfolder. Skipped.`, true); errorsEncountered++; continue; }
                    
                    // Name conflict check for cut/move
                    if (clipItem.originalParentId !== currentFolderId) { // Only check if moving to a different folder
                        const existingItemCheck = await itemsCollection.where("parentId", "==", currentFolderId).where("name", "==", clipItem.name).where("type", "==", clipItem.type).limit(1).get();
                        if (!existingItemCheck.empty) { showStatus(`Item named "${clipItem.name}" already exists in the target location. Move skipped.`, true, 4000); errorsEncountered++; continue; }
                    } else { // Moving within the same folder (no actual move, just clearing clipboard)
                         showStatus(`"${clipItem.name}" is already in this folder. Cut operation cleared from clipboard.`, false, 3000); itemsToClearFromCutClipboard.push(clipItem.id); itemsProcessed++; continue;
                    }
                    
                    batch.update(itemsCollection.doc(clipItem.id), { parentId: currentFolderId });
                    batchHasOperations = true; itemsToClearFromCutClipboard.push(clipItem.id); itemsProcessed++;

                } else if (clipboard.action === 'copy') {
                    if (!clipItem.data) { showStatus(`Clipboard data error for "${clipItem.name}". Skipped.`, true); errorsEncountered++; continue; }
                    let newName = clipItem.name;
                    // Name conflict resolution for copy (always, even if source parent is same as target)
                    const baseName = clipItem.name.replace(/ \(Copy( \d+)?\)$/, ''); 
                    let suffixCounter = 0;
                    while(true) {
                        const check = await itemsCollection.where("parentId", "==", currentFolderId).where("name", "==", newName).where("type", "==", clipItem.type).limit(1).get();
                        if (check.empty) break;
                        suffixCounter++; newName = `${baseName} (Copy${suffixCounter > 1 ? ' ' + suffixCounter : ''})`;
                        if (suffixCounter > 100) { throw new Error(`Too many copies of "${clipItem.name}".`); }
                    }

                    if (clipItem.type === 'link') {
                        const newLinkRef = itemsCollection.doc();
                        batch.set(newLinkRef, { ...clipItem.data, name: newName, parentId: currentFolderId, createdAt: firebase.firestore.FieldValue.serverTimestamp(), id: undefined }); // remove old id
                        batchHasOperations = true;
                    } else if (clipItem.type === 'folder') {
                        // Original folder for copy might have been deleted.
                        // copyFolderRecursive needs originalFolderId. If clipItem.id (original) is gone, this will fail inside.
                        // For simplicity, assume clipItem.id is the source. If it was deleted, copyFolderRecursive won't find children.
                        if (batchHasOperations) { await batch.commit(); batch = db.batch(); batchHasOperations = false; }
                        await copyFolderRecursive(clipItem.id, newName, currentFolderId);
                    }
                    itemsProcessed++;
                }
            } catch (error) { console.error(`Error pasting "${clipItem.name}":`, error); showStatus(`Error processing "${clipItem.name}": ${error.message}. Skipped.`, true, 4000); errorsEncountered++; }
        }
        
        if(batchHasOperations) {
            try { await batch.commit(); } catch (commitError) { console.error("Batch commit error during paste:", commitError); showStatus("Error finalizing paste operation.", true); errorsEncountered++; }
        }

        if (itemsProcessed > 0 && errorsEncountered === 0) showStatus(`${itemsProcessed} item(s) ${clipboard.action === 'cut' ? 'moved' : 'copied'}.`);
        else if (itemsProcessed > 0 && errorsEncountered > 0) showStatus(`${itemsProcessed} processed, ${errorsEncountered} error(s). Some items might require attention.`, true, 5000);
        else if (errorsEncountered > 0 && itemsProcessed === 0) showStatus(`Paste failed. ${errorsEncountered} error(s).`, true, 5000);
        else if (clipboard.items.length > 0 && itemsProcessed === 0 && errorsEncountered === 0) showStatus("No items needed pasting or were skipped.", false, 3000);
        
        if (clipboard.action === 'cut') {
            clipboard.items = clipboard.items.filter(item => !itemsToClearFromCutClipboard.includes(item.id));
            if (clipboard.items.length === 0) clearClipboard(); else updatePasteButtonState();
        }
        // Listener will update the UI
    });

    // --- Drag and Drop Handlers ---
    itemListContainer.addEventListener('dragover', (e) => { if (e.target === itemListContainer) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; itemListContainer.classList.add('drop-target-list'); } });
    itemListContainer.addEventListener('dragleave', (e) => { if (e.target === itemListContainer) itemListContainer.classList.remove('drop-target-list'); });
    itemListContainer.addEventListener('drop', async (e) => { if (e.target === itemListContainer) { e.preventDefault(); itemListContainer.classList.remove('drop-target-list'); const dataStr = e.dataTransfer.getData('text/plain'); if (!dataStr) return; const { draggedItemId, draggedItemType, originalParentId: dOrigPId, draggedItemName, selectedDraggedIds } = JSON.parse(dataStr); await handleDrop(draggedItemId, draggedItemType, dOrigPId, currentFolderId, draggedItemName, selectedDraggedIds); } });

    // `selectedDraggedIds` is new, for handling multi-item drag if implemented more fully.
    // For now, assume primarily single item or operate on `draggedItemId` as the primary.
    async function handleDrop(draggedItemId, draggedItemType, draggedOriginalParentId, targetFolderId, draggedItemName, selectedDraggedIds = []) {
        // Ensure target folder for drop still exists
        if (targetFolderId !== null) {
            const targetDoc = await itemsCollection.doc(targetFolderId).get();
            if (!targetDoc.exists) {
                showStatus(`Target folder for drop no longer exists. Operation cancelled.`, true, 4000);
                return;
            }
        }
        
        // Handle multi-item drop (simplified: move each selected item individually)
        const itemsToMove = (selectedDraggedIds && selectedDraggedIds.length > 0 && selectedDraggedIds.includes(draggedItemId)) 
                            ? selectedDraggedIds 
                            : [draggedItemId];

        let successCount = 0;
        let errorCount = 0;
        const batch = db.batch();
        let batchHasOps = false;

        for (const itemIdToMove of itemsToMove) {
            // Fetch fresh item data for each item in selection
            const itemDoc = await itemsCollection.doc(itemIdToMove).get();
            if (!itemDoc.exists) { errorCount++; console.warn(`Item ${itemIdToMove} not found for drag/drop.`); continue; }
            const itemData = itemDoc.data();

            if (itemIdToMove === targetFolderId && itemData.type === 'folder') { showStatus(`Cannot move folder "${itemData.name}" into itself.`, true); errorCount++; continue; }
            if (itemData.parentId === targetFolderId) { /* Already here, do nothing */ successCount++; continue; } // Consider it a "success"
            if (itemData.type === 'folder' && await isDescendant(targetFolderId, itemIdToMove)) { showStatus(`Cannot move folder "${itemData.name}" into its subfolder.`, true); errorCount++; continue; }
            
            // Check for name conflict in target for each item
            const existingItemCheck = await itemsCollection.where("parentId", "==", targetFolderId).where("name", "==", itemData.name).where("type", "==", itemData.type).limit(1).get();
            if (!existingItemCheck.empty) { showStatus(`Item named "${itemData.name}" of type "${itemData.type}" already exists in target. Move aborted for this item.`, true, 4000); errorCount++; continue; }
            
            batch.update(itemsCollection.doc(itemIdToMove), { parentId: targetFolderId });
            batchHasOps = true;
            successCount++;
        }

        if (batchHasOps) {
            try {
                await batch.commit();
                showStatus(`${successCount} item(s) moved. ${errorCount > 0 ? errorCount + ' error(s).' : ''}`, errorCount > 0);
                if (clipboard.action === 'cut') { // If these items were also in cut clipboard
                    const newClipboardItems = clipboard.items.filter(ci => !itemsToMove.includes(ci.id));
                    if (newClipboardItems.length !== clipboard.items.length) {
                        clipboard.items = newClipboardItems;
                        if (clipboard.items.length === 0) clearClipboard(); else updatePasteButtonState();
                    }
                }
            } catch (e) {
                showStatus(`Error finalizing move: ${e.message}`, true);
                console.error("Error committing batch in handleDrop:", e);
            }
        } else if (errorCount > 0) {
            showStatus(`Move failed for ${errorCount} item(s).`, true);
        } else if (successCount > 0) { // Items were already there
             showStatus(`${successCount} item(s) already in target location.`, false, 3000);
        }
        // Listener updates UI
    }

    async function enableRename(itemId, itemDiv) {
        if (isInlineRenamingFolder || document.querySelector('.modal[style*="display: block"]')) return;

        const itemDoc = await itemsCollection.doc(itemId).get();
        if (!itemDoc.exists) { showStatus("Item to rename no longer exists.", true, 3000); return; }
        const itemData = itemDoc.data();

        if (itemData.type === 'folder') {
            isInlineRenamingFolder = true; // Set flag early
            const nameContainer = itemDiv.querySelector('[data-name-container]');
            const nameSpan = itemDiv.querySelector('[data-name-span]');
            const icon = itemDiv.querySelector('.item-icon');
            if (!nameSpan || !nameContainer) { isInlineRenamingFolder = false; return; }

            const originalName = nameSpan.textContent; // Use current DOM text as original
            const input = document.createElement('input');
            input.type = 'text'; input.value = originalName;
            input.className = 'item-rename-input ml-1 text-sm flex-grow';
            input.style.width = `calc(${nameContainer.offsetWidth}px - ${icon ? icon.offsetWidth + 12 : 30}px)`; // Adjust width
            
            nameContainer.replaceChild(input, nameSpan);
            input.focus(); input.select();
            let hasFinishedRename = false;

            const finishFolderRename = async (save) => {
                if (hasFinishedRename) return;
                hasFinishedRename = true;
                const newName = input.value.trim();
                // Restore span before async ops, to avoid input field being removed by snapshot update if rename is slow
                if (input.parentNode) nameContainer.replaceChild(nameSpan, input); // Put span back
                isInlineRenamingFolder = false; // Clear flag: allows snapshots to render normally now

                if (save && newName && newName !== originalName) {
                    try {
                        // Re-fetch doc to ensure it wasn't deleted/renamed during inline edit
                        const currentItemDoc = await itemsCollection.doc(itemId).get();
                        if (!currentItemDoc.exists) { showStatus("Folder was deleted during rename.", true); nameSpan.textContent = originalName; /* Listener will remove it */ return; }
                        // If parentId of item changed, it means it was moved. Abort rename.
                        if (currentItemDoc.data().parentId !== currentFolderId) { showStatus("Folder was moved during rename. Rename aborted.", true); nameSpan.textContent = currentItemDoc.data().name; /* Listener updates */ return;}
                        
                        const conflictCheck = await itemsCollection.where("parentId", "==", currentFolderId).where("name", "==", newName).where("type", "==", "folder").limit(1).get();
                        if (!conflictCheck.empty && conflictCheck.docs[0].id !== itemId) {
                            showStatus(`Folder "${newName}" already exists. Rename aborted.`, true, 4000);
                            nameSpan.textContent = currentItemDoc.data().name; // Use latest name from DB before abort
                        } else {
                            await itemsCollection.doc(itemId).update({ name: newName }); 
                            showStatus(`Renamed to "${newName}".`);
                            // Update breadcrumbs if this renamed folder is in the path
                            currentPath.forEach(p => { if (p.id === itemId) p.name = newName; });
                            renderBreadcrumbs();
                        }
                    } catch (error) { console.error("Error renaming folder:", error); showStatus(`Failed to rename folder: ${error.message}`, true); nameSpan.textContent = originalName; } // Revert to original DOM name on error
                } else if (save && !newName) {
                    showStatus("Name cannot be empty. Reverted.", true, 3000); nameSpan.textContent = originalName;
                } else { // Cancelled (Escape) or no change
                    const currentItemDoc = await itemsCollection.doc(itemId).get(); // Get latest name
                    nameSpan.textContent = currentItemDoc.exists ? currentItemDoc.data().name : originalName;
                }
                updateItemVisuals(); // Restore focus styles if any
                itemListContainer.focus();
            };
            input.addEventListener('blur', () => finishFolderRename(true));
            input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finishFolderRename(true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishFolderRename(false); } });
        
        } else if (itemData.type === 'link') {
            editingItemId = itemId;
            editLinkNameInput.value = itemData.name; editLinkUrlInput.value = itemData.url;
            openModal('editLinkModal');
        }
    }

    // --- Keyboard Event Listener (largely same, ensure fetches before action if item might be stale) ---
    document.addEventListener('keydown', async (event) => {
        const activeModal = document.querySelector('.modal[style*="display: block"]');
        if (activeModal || isInlineRenamingFolder || (document.activeElement.tagName === 'INPUT' && !document.activeElement.classList.contains('item-rename-input')) || document.activeElement.tagName === 'TEXTAREA') {
            if (document.activeElement.classList.contains('item-rename-input') && ['F2', 'Delete', 'Backspace', 'Escape', 'Enter'].includes(event.key)) { /* Let input handler take over */ } 
            else if (activeModal || (document.activeElement.tagName === 'INPUT' && !document.activeElement.classList.contains('item-rename-input'))) { return; }
        }
        
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
        const ctrlKey = isMac ? event.metaKey : event.ctrlKey;
        const allRendItems = Array.from(itemListContainer.querySelectorAll('div[data-item-id]'));
        
        if (allRendItems.length === 0 && !['Escape', 'Backspace', 'KeyN', 'KeyL'].includes(event.code) && !(ctrlKey && ['KeyC', 'KeyX', 'KeyV', 'KeyA'].includes(event.code))) {
            if (!(event.key === 'Backspace' && (document.activeElement === itemListContainer || document.activeElement === document.body))) return; // Allow backspace for navigation even if empty
        }
        let currentIdx = focusedItemId ? allRendItems.findIndex(el => el.dataset.itemId === focusedItemId) : -1;

        if (event.altKey && event.code === 'KeyN') { event.preventDefault(); openModal('addFolderModal'); return; }
        if (event.altKey && event.code === 'KeyL') { event.preventDefault(); openModal('addLinkModal'); return; }

        switch (event.key) {
            // ArrowUp, ArrowDown, Home, End, Space for selection: Original logic is mostly fine.
            // Ensure focusedItemId and selectedItemIds are valid against allRendItems.
            case 'ArrowUp': case 'ArrowDown':
                event.preventDefault(); if (allRendItems.length === 0) break;
                let nextIdx = currentIdx;
                if (event.key === 'ArrowUp') nextIdx = (currentIdx > 0) ? currentIdx - 1 : 0;
                else nextIdx = (currentIdx < allRendItems.length - 1) ? currentIdx + 1 : allRendItems.length - 1;
                if (nextIdx === -1 && allRendItems.length > 0) nextIdx = 0;
                if (allRendItems[nextIdx]) focusedItemId = allRendItems[nextIdx].dataset.itemId; else break;

                if (event.shiftKey) { 
                    if (!anchorItemIdForShift && currentIdx !== -1 && allRendItems[currentIdx]) anchorItemIdForShift = allRendItems[currentIdx].dataset.itemId; 
                    else if (!anchorItemIdForShift && allRendItems.length > 0) anchorItemIdForShift = allRendItems[0].dataset.itemId;
                    const anchorI = allRendItems.findIndex(el => el.dataset.itemId === anchorItemIdForShift); 
                    const focusI = allRendItems.findIndex(el => el.dataset.itemId === focusedItemId);
                    if (anchorI !== -1 && focusI !== -1) { const newSel = new Set(ctrlKey ? selectedItemIds : []); const start = Math.min(anchorI, focusI); const end = Math.max(anchorI, focusI); for (let i = start; i <= end; i++) newSel.add(allRendItems[i].dataset.itemId); selectedItemIds = Array.from(newSel); }
                } else if (!ctrlKey) { selectedItemIds = [focusedItemId]; anchorItemIdForShift = focusedItemId; }
                updateItemVisuals(); break;
            case 'Home': case 'End':
                event.preventDefault(); if (allRendItems.length === 0) break;
                focusedItemId = (event.key === 'Home') ? allRendItems[0].dataset.itemId : allRendItems[allRendItems.length - 1].dataset.itemId;
                if (event.shiftKey) { 
                    if (!anchorItemIdForShift && currentIdx !== -1 && allRendItems[currentIdx]) anchorItemIdForShift = allRendItems[currentIdx].dataset.itemId; 
                    else if (!anchorItemIdForShift && allRendItems.length > 0) anchorItemIdForShift = allRendItems[0].dataset.itemId;
                    const anchorI = allRendItems.findIndex(el => el.dataset.itemId === anchorItemIdForShift); 
                    const focusI = allRendItems.findIndex(el => el.dataset.itemId === focusedItemId);
                    if (anchorI !== -1 && focusI !== -1) { const newSel = new Set(ctrlKey ? selectedItemIds : []); const start = Math.min(anchorI, focusI); const end = Math.max(anchorI, focusI); for (let i = start; i <= end; i++) newSel.add(allRendItems[i].dataset.itemId); selectedItemIds = Array.from(newSel); }
                } else if (!ctrlKey) { selectedItemIds = [focusedItemId]; anchorItemIdForShift = focusedItemId; }
                updateItemVisuals(); break;
            case ' ': 
                if (focusedItemId && (document.activeElement === itemListContainer || document.activeElement === document.body)) { 
                     event.preventDefault();
                     if (ctrlKey) {
                        if (selectedItemIds.includes(focusedItemId)) { selectedItemIds = selectedItemIds.filter(id => id !== focusedItemId); if (anchorItemIdForShift === focusedItemId) anchorItemIdForShift = selectedItemIds.length > 0 ? selectedItemIds[0] : null; }
                        else { selectedItemIds.push(focusedItemId); if (!anchorItemIdForShift) anchorItemIdForShift = focusedItemId; }
                    } else { selectedItemIds = [focusedItemId]; anchorItemIdForShift = focusedItemId; }
                    updateItemVisuals();
                } break;

            case 'F2':
                if (selectedItemIds.length === 1 || (focusedItemId && selectedItemIds.includes(focusedItemId)) || (focusedItemId && selectedItemIds.length === 0)) {
                    event.preventDefault(); const itemIdToRename = selectedItemIds.length === 1 ? selectedItemIds[0] : focusedItemId;
                    if (!itemIdToRename) break; // No item to rename
                    const itemDiv = itemListContainer.querySelector(`div[data-item-id="${itemIdToRename}"]`);
                    if (itemDiv) enableRename(itemIdToRename, itemDiv); // enableRename fetches doc
                } break;
            case 'Delete': case 'Backspace': // Combined logic for delete and navigate back
                const isFocusedOnListOrBody = document.activeElement === itemListContainer || document.activeElement === document.body;
                if (event.key === 'Backspace' && isFocusedOnListOrBody && !isMac && currentPath.length > 1 && selectedItemIds.length === 0) { 
                    event.preventDefault(); const parentSeg = currentPath[currentPath.length - 2]; navigateToFolder(parentSeg.id, parentSeg.name, currentPath.length - 2); return; 
                } 
                else if (isMac && event.key === 'Backspace' && !event.metaKey && isFocusedOnListOrBody && currentPath.length > 1 && selectedItemIds.length === 0) { 
                    event.preventDefault(); const parentSeg = currentPath[currentPath.length - 2]; navigateToFolder(parentSeg.id, parentSeg.name, currentPath.length - 2); return; 
                }
                
                if (event.key === 'Delete' || (isMac && event.key === 'Backspace' && event.metaKey)) { 
                    if (selectedItemIds.length > 0) {
                        event.preventDefault(); 
                        const itemsToDeleteDetails = [];
                        const itemDocs = await Promise.all(selectedItemIds.map(id => itemsCollection.doc(id).get()));
                        itemDocs.forEach(docSnap => { if (docSnap.exists) itemsToDeleteDetails.push({id: docSnap.id, name: docSnap.data().name, type: docSnap.data().type }); });
                        
                        if (itemsToDeleteDetails.length === 0) { showStatus("Selected items already deleted.", false, 3000); selectedItemIds = []; updateItemVisuals(); break; }
                        const confirmMsg = `Delete ${itemsToDeleteDetails.length} item(s)? Folders and their contents will be removed. This is irreversible.`;
                        if (confirm(confirmMsg)) {
                            showStatus(`Deleting ${itemsToDeleteDetails.length} item(s)...`, false, 0);
                            let successCount = 0, errorCount = 0;
                            
                            // Determine next focused item more carefully
                            let nextFocusedCandidateId = null;
                            if (allRendItems.length > itemsToDeleteDetails.length) { // If not deleting all items
                                const currentSelectedIndices = selectedItemIds
                                    .map(id => allRendItems.findIndex(el => el.dataset.itemId === id))
                                    .filter(idx => idx !== -1) // Filter out not found (shouldn't happen if allRendItems is fresh)
                                    .sort((a,b) => a-b);
                                
                                if (currentSelectedIndices.length > 0) {
                                    const lastDeletedVisualIndex = currentSelectedIndices[currentSelectedIndices.length - 1];
                                    // Try to focus item after the last deleted
                                    let potentialNextFocusIndex = -1;
                                    for(let i = lastDeletedVisualIndex + 1; i < allRendItems.length; i++) {
                                        if (!selectedItemIds.includes(allRendItems[i].dataset.itemId)) {
                                            potentialNextFocusIndex = i; break;
                                        }
                                    }
                                    if (potentialNextFocusIndex !== -1) {
                                        nextFocusedCandidateId = allRendItems[potentialNextFocusIndex].dataset.itemId;
                                    } else { // If nothing after, try before the first deleted
                                        const firstDeletedVisualIndex = currentSelectedIndices[0];
                                        for(let i = firstDeletedVisualIndex - 1; i >= 0; i--) {
                                            if (!selectedItemIds.includes(allRendItems[i].dataset.itemId)) {
                                                potentialNextFocusIndex = i; break;
                                            }
                                        }
                                        if (potentialNextFocusIndex !== -1) {
                                            nextFocusedCandidateId = allRendItems[potentialNextFocusIndex].dataset.itemId;
                                        }
                                    }
                                }
                            } // else: all items deleted, nextFocusedCandidateId remains null
                            if (!nextFocusedCandidateId && focusedItemId && !selectedItemIds.includes(focusedItemId)) {
                                nextFocusedCandidateId = focusedItemId; // Keep current focus if not part of deletion
                            }


                            const folderDeletePromises = [];
                            let deleteBatch = db.batch();
                            let opsInBatch = 0;

                            for (const itemDetail of itemsToDeleteDetails) {
                                if (itemDetail.type === 'link') { 
                                    deleteBatch.delete(itemsCollection.doc(itemDetail.id)); opsInBatch++; 
                                    if (opsInBatch >= 450) { await deleteBatch.commit(); deleteBatch = db.batch(); opsInBatch = 0; }
                                }
                                else if (itemDetail.type === 'folder') { folderDeletePromises.push(deleteFolderRecursive(itemDetail.id)); }
                                successCount++; // Assume success, errors caught by Promise.all or batch commit
                                clipboard.items = clipboard.items.filter(ci => ci.id !== itemDetail.id);
                            }
                            try {
                                if(opsInBatch > 0) await deleteBatch.commit();
                                await Promise.all(folderDeletePromises);
                                updatePasteButtonState();
                                showStatus(`${successCount} item(s) deletion process initiated.`);
                            } catch (delError) {
                                console.error("Error during batched delete or folder recursion:", delError);
                                errorCount = itemsToDeleteDetails.length; // Mark all as error for simplicity
                                showStatus(`Error deleting items: ${delError.message}`, true);
                            }
                            
                            focusedItemId = nextFocusedCandidateId; // This will be picked up by listener/render
                            selectedItemIds = []; 
                            anchorItemIdForShift = null;
                            // renderItems() removed; listener updates UI and selection state internally
                        }
                    }
                } break;
            case 'Escape': if (selectedItemIds.length > 0) { selectedItemIds = []; anchorItemIdForShift = null; updateItemVisuals(); event.preventDefault(); } break;
            case 'Enter':
                let itemToOpenId = null;
                if (focusedItemId && selectedItemIds.includes(focusedItemId)) itemToOpenId = focusedItemId;
                else if (selectedItemIds.length === 1) itemToOpenId = selectedItemIds[0];
                else if (focusedItemId && selectedItemIds.length === 0 && allRendItems.some(el => el.dataset.itemId === focusedItemId)) itemToOpenId = focusedItemId;
                
                if (itemToOpenId) {
                    event.preventDefault();
                    try { 
                        const docSnap = await itemsCollection.doc(itemToOpenId).get(); 
                        if (docSnap.exists) { 
                            const itemData = docSnap.data(); 
                            if (itemData.type === 'folder') navigateToFolder(itemToOpenId, itemData.name); 
                            else if (itemData.type === 'link') window.open(itemData.url, '_blank'); 
                        } else { showStatus("Item to open no longer exists.", true); }
                    } 
                    catch (error) { console.error("Error opening item:", error); showStatus(`Error opening item: ${error.message}`, true); }
                } break;
            case 'a': case 'A': if (ctrlKey && (document.activeElement === itemListContainer || document.activeElement === document.body)) { event.preventDefault(); if (allRendItems.length > 0) { selectedItemIds = allRendItems.map(el => el.dataset.itemId); anchorItemIdForShift = allRendItems[0].dataset.itemId; focusedItemId = allRendItems[allRendItems.length-1].dataset.itemId; updateItemVisuals(); showStatus(`${selectedItemIds.length} item(s) selected.`); } } break;
            case 'c': case 'C': if (ctrlKey) { event.preventDefault(); if (selectedItemIds.length > 0) await handleCopySelectedItems(); else if (focusedItemId) { const doc = await itemsCollection.doc(focusedItemId).get(); if (doc.exists) handleCopySingleItem(focusedItemId, doc.data()); else showStatus("Focused item not found for copy.", true); } } break;
            case 'x': case 'X': if (ctrlKey) { event.preventDefault(); if (selectedItemIds.length > 0) await handleCutSelectedItems(); else if (focusedItemId) { const doc = await itemsCollection.doc(focusedItemId).get(); if (doc.exists) handleCutSingleItem(focusedItemId, doc.data()); else showStatus("Focused item not found for cut.", true); } } break;
            case 'v': case 'V': if (ctrlKey) { event.preventDefault(); if (!pasteBtn.disabled) pasteBtn.click(); } break;
        }
    });

    // Initial Load
    updatePasteButtonState();
    navigateToFolder(null, "Root"); 
});