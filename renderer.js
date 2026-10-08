// GÜVENLİK YAMASI 3: DOM-based XSS (Cross-Site Scripting) Koruması
// Zararlı dosya isimlerindeki HTML/Script tag'lerini zararsız karaktere dönüştürür
function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

let currentSourcePath = null;
let currentTargetPath = null;
let totalSourceFiles = 0;

let selectedFiles = new Set();
let lastSelectedElement = null;

const btnSelectSource = document.getElementById('btn-select-source');
const btnUndoSource = document.getElementById('btn-undo-source');
const sourcePathLabel = document.getElementById('source-path-label');
const sourceFilesContainer = document.getElementById('source-files-container');

function updateSelectionUI() {
    document.querySelectorAll('.file-item').forEach(el => {
        const filePath = el.getAttribute('data-filepath');
        if (selectedFiles.has(filePath)) {
            el.classList.add('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
            const textEl = el.querySelector('.flex-1');
            if(textEl) { textEl.classList.remove('text-on-surface-variant'); textEl.classList.add('text-primary-fixed-dim'); }
        } else {
            el.classList.remove('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
            const textEl = el.querySelector('.flex-1');
            if(textEl) { textEl.classList.remove('text-primary-fixed-dim'); textEl.classList.add('text-on-surface-variant'); }
        }
    });
}

function handleFileClick(e, itemEl, fileObj, iconData) {
    const filePath = fileObj.path;
    const allFileItems = Array.from(document.querySelectorAll('.file-item'));

    if (e.shiftKey && lastSelectedElement) {
        const currentIndex = allFileItems.indexOf(itemEl);
        const lastIndex = allFileItems.indexOf(lastSelectedElement);
        
        if (currentIndex !== -1 && lastIndex !== -1) {
            const start = Math.min(currentIndex, lastIndex);
            const end = Math.max(currentIndex, lastIndex);
            
            selectedFiles.clear();
            for (let i = start; i <= end; i++) {
                selectedFiles.add(allFileItems[i].getAttribute('data-filepath'));
            }
        }
    } else if (e.ctrlKey || e.metaKey) {
        if (selectedFiles.has(filePath)) {
            selectedFiles.delete(filePath);
            if (lastSelectedElement === itemEl) lastSelectedElement = null;
        } else {
            selectedFiles.add(filePath);
            lastSelectedElement = itemEl;
        }
    } else {
        selectedFiles.clear();
        selectedFiles.add(filePath);
        lastSelectedElement = itemEl;
    }

    updateSelectionUI();
    
    if (selectedFiles.has(filePath)) {
        showPreview(fileObj, iconData);
    } else {
        previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70">Önizleme bulunamadı</div>';
    }
}

document.addEventListener('keydown', async (e) => {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && lastSelectedElement) {
        e.preventDefault();
        const allFileItems = Array.from(document.querySelectorAll('.file-item'));
        const currentIndex = allFileItems.indexOf(lastSelectedElement);
        
        if (currentIndex !== -1) {
            let nextIndex = currentIndex;
            if (e.key === 'ArrowDown') {
                nextIndex = Math.min(currentIndex + 1, allFileItems.length - 1);
            } else if (e.key === 'ArrowUp') {
                nextIndex = Math.max(currentIndex - 1, 0);
            }
            
            const nextElement = allFileItems[nextIndex];
            if (nextElement && nextElement !== lastSelectedElement) {
                const clickEvent = new MouseEvent('click', {
                    bubbles: true,
                    cancelable: true,
                    shiftKey: e.shiftKey,
                    ctrlKey: e.ctrlKey || e.metaKey
                });
                nextElement.dispatchEvent(clickEvent);
                nextElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
        }
        return;
    }

    if (e.key === 'Delete' && selectedFiles.size > 0) {
        const confirmDelete = confirm(`${selectedFiles.size} adet dosyayı çöp kutusuna taşımak istediğinize emin misiniz?`);
        if (!confirmDelete) return;

        let successCount = 0;
        previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70">Siliniyor...</div>';
        
        for (const filePath of selectedFiles) {
            const res = await window.electronAPI.deleteFile(filePath);
            if (res.success) successCount++;
        }

        selectedFiles.clear();
        lastSelectedElement = null;
        
        await refreshSourceFiles();
        await refreshTargetFolders();

        previewCanvas.innerHTML = `
            <div class="text-error text-center opacity-70 flex flex-col items-center p-4">
                <span class="material-symbols-outlined text-6xl mb-4">delete</span>
                <p class="text-xl font-bold">${successCount} Dosya Silindi</p>
                <p>Dosyalar çöp kutusuna gönderildi.</p>
            </div>
        `;
    }
});

sourceFilesContainer.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    sourceFilesContainer.classList.add('bg-primary-container/10', 'border-primary', 'border-dashed', 'border-2');
});
sourceFilesContainer.addEventListener('dragleave', () => {
    sourceFilesContainer.classList.remove('bg-primary-container/10', 'border-primary', 'border-dashed', 'border-2');
});
sourceFilesContainer.addEventListener('drop', async (e) => {
    e.preventDefault();
    sourceFilesContainer.classList.remove('bg-primary-container/10', 'border-primary', 'border-dashed', 'border-2');
    
    if (!currentSourcePath) return;

    try {
        const data = JSON.parse(e.dataTransfer.getData('text/plain'));
        let successCount = 0;
        
        previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70">Taşınıyor...</div>';
        for (const sourcePath of data) {
            const result = await window.electronAPI.moveFile(sourcePath, currentSourcePath);
            if (result.success) successCount++;
        }
        
        await refreshTargetFolders();
        await refreshSourceFiles();
        
        previewCanvas.innerHTML = `
            <div class="text-on-surface-variant text-center opacity-70 flex flex-col items-center p-4">
                <span class="material-symbols-outlined text-6xl mb-2 text-primary">undo</span>
                <p class="text-xl font-bold">${successCount} Dosya</p>
                <p>Başarıyla kaynağa geri taşındı.</p>
            </div>
        `;
        const previewTitle = document.getElementById('preview-title');
        if(previewTitle) previewTitle.textContent = "Geri Taşıma Başarılı";
    } catch(err) {}
});

const btnSelectTarget = document.getElementById('btn-select-target');
const targetPathLabel = document.getElementById('target-path-label');
const targetFoldersContainer = document.getElementById('target-folders-container');

const previewHeader = document.getElementById('preview-header');
const previewIcon = document.getElementById('preview-icon');
const previewTitle = document.getElementById('preview-title');
const previewSize = document.getElementById('preview-size');
const previewCanvas = document.getElementById('preview-canvas');
const statusCount = document.getElementById('status-count');

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function getIconForExt(ext) {
    const images = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'];
    const videos = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    const audios = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'wma'];
    const docs = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'md'];
    const archives = ['zip', 'rar', '7z', 'tar', 'gz', 'iso'];
    
    if (images.includes(ext)) return { icon: 'image', color: 'text-purple-400' };
    if (videos.includes(ext)) return { icon: 'movie', color: 'text-pink-400' };
    if (audios.includes(ext)) return { icon: 'audiotrack', color: 'text-teal-400' };
    if (docs.includes(ext)) return { icon: 'description', color: 'text-blue-400' };
    if (archives.includes(ext)) return { icon: 'folder_zip', color: 'text-orange-400' };
    
    return { icon: 'draft', color: 'text-on-surface-variant' };
}

btnSelectSource.addEventListener('click', async () => {
    const dirPath = await window.electronAPI.selectDirectory();
    if (dirPath) {
        currentSourcePath = dirPath;
        const folderName = dirPath.split('\\').pop() || dirPath.split('/').pop();
        sourcePathLabel.textContent = escapeHTML(folderName);
        sourcePathLabel.title = dirPath;
        
        btnUndoSource.classList.remove('hidden');
        await refreshSourceFiles();
    }
});

btnUndoSource.addEventListener('click', async () => {
    if (!currentSourcePath) return;
    const confirmUndo = confirm("Dikkat: Bu işlem, seçtiğiniz klasörün içindeki klasörlere dağıtılmış tüm dosyaları tekrar ana klasöre (buraya) çıkaracaktır. Emin misiniz?");
    if (!confirmUndo) return;
    
    sourceFilesContainer.innerHTML = '<div class="text-on-surface-variant text-center mt-10 italic">Geri alınıyor...</div>';
    
    const result = await window.electronAPI.undoAutoOrganize(currentSourcePath);
    if (result.success) {
        await refreshSourceFiles();
        if (currentTargetPath === currentSourcePath) await refreshTargetFolders();
        
        previewCanvas.innerHTML = `
            <div class="text-on-surface-variant text-center opacity-70 flex flex-col items-center">
                <span class="material-symbols-outlined text-6xl mb-4 text-orange-400">undo</span>
                <p class="text-2xl font-bold">Geri Alma Başarılı!</p>
                <p class="text-lg mt-2">${result.successCount} dosya ana klasöre geri çıkarıldı.</p>
            </div>
        `;
        previewTitle.textContent = "İşlem Geri Alındı";
        previewSize.classList.add('hidden');
        previewIcon.textContent = "undo";
        previewIcon.className = "material-symbols-outlined text-xl text-orange-400";
    } else {
        alert("Hata oluştu: " + result.error);
    }
});

btnSelectTarget.addEventListener('click', async () => {
    const dirPath = await window.electronAPI.selectDirectory();
    if (dirPath) {
        currentTargetPath = dirPath;
        const folderName = dirPath.split('\\').pop() || dirPath.split('/').pop();
        targetPathLabel.textContent = escapeHTML(folderName);
        targetPathLabel.title = dirPath;
        await refreshTargetFolders();
    }
});

async function refreshSourceFiles() {
    if (!currentSourcePath) return;
    const response = await window.electronAPI.readSourceFiles(currentSourcePath);
    const groupedFiles = response.groups || {};
    totalSourceFiles = response.totalCount || 0;
    
    sourceFilesContainer.innerHTML = '';
    
    const groups = Object.keys(groupedFiles).sort();
    
    if (groups.length === 0 || totalSourceFiles === 0) {
        sourceFilesContainer.innerHTML = '<div class="text-on-surface-variant text-center mt-10 italic">Bu klasörde dosya bulunamadı.</div>';
        statusCount.textContent = "0 Öğe";
        return;
    }

    groups.forEach(group => {
        const groupData = groupedFiles[group];
        const files = groupData.files;
        const groupTotal = groupData.totalItems;
        
        const groupEl = document.createElement('div');
        // XSS Koruması: Grup adı da sanite edilir
        const safeGroupName = escapeHTML(group);
        
        groupEl.innerHTML = `
            <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-default group transition-colors">
                <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-on-surface">expand_more</span>
                <span class="material-symbols-outlined text-[18px] text-yellow-500" style="font-variation-settings: 'FILL' 1;">folder</span>
                <span class="text-body-sm font-medium truncate flex-1 text-on-surface">${safeGroupName} Dosyaları</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 bg-primary text-on-primary rounded">${groupTotal}</span>
            </div>
            <div class="ml-6 border-l border-outline-variant pl-2 space-y-0.5 file-list-container"></div>
        `;
        
        const fileListContainer = groupEl.querySelector('.file-list-container');
        
        files.forEach(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            const iconData = getIconForExt(ext);
            const safeFileName = escapeHTML(file.name);
            
            const itemEl = document.createElement('div');
            itemEl.className = 'file-item flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-grab active:cursor-grabbing group transition-colors';
            itemEl.draggable = true;
            itemEl.setAttribute('data-filepath', file.path);
            
            itemEl.innerHTML = `
                <span class="w-2"></span>
                <span class="material-symbols-outlined text-[18px] ${iconData.color}">${iconData.icon}</span>
                <span class="text-body-sm truncate flex-1 text-on-surface-variant group-hover:text-on-surface select-none">${safeFileName}</span>
                <span class="text-mono-sm text-on-surface-variant opacity-70 select-none">${formatBytes(file.size)}</span>
            `;
            
            itemEl.addEventListener('click', (e) => handleFileClick(e, itemEl, file, iconData));
            
            itemEl.addEventListener('dragstart', (e) => {
                if (!selectedFiles.has(file.path)) {
                    selectedFiles.clear();
                    selectedFiles.add(file.path);
                    lastSelectedElement = itemEl;
                    updateSelectionUI();
                }
                const filesToDrag = Array.from(selectedFiles);
                e.dataTransfer.setData('text/plain', JSON.stringify(filesToDrag));
                e.dataTransfer.effectAllowed = 'move';
                
                document.querySelectorAll('.file-selected').forEach(el => el.style.opacity = '0.5');
            });
            
            itemEl.addEventListener('dragend', () => {
                document.querySelectorAll('.file-selected').forEach(el => el.style.opacity = '1');
            });
            
            fileListContainer.appendChild(itemEl);
        });
        
        if (groupTotal > files.length) {
            const moreEl = document.createElement('div');
            moreEl.className = "text-center text-on-surface-variant text-sm mt-2 opacity-50 italic px-2 py-1.5";
            moreEl.textContent = `... ve ${groupTotal - files.length} dosya daha`;
            fileListContainer.appendChild(moreEl);
        }
        
        sourceFilesContainer.appendChild(groupEl);
    });
    
    updateSelectionUI();
    statusCount.textContent = `${totalSourceFiles} Öğe`;
}

async function showPreview(file, iconData) {
    previewIcon.textContent = iconData.icon;
    previewIcon.className = `material-symbols-outlined text-xl ${iconData.color}`;
    
    if (selectedFiles.size > 1) {
        previewTitle.textContent = `${selectedFiles.size} Dosya Seçildi`;
        previewSize.textContent = "Toplu İşlem Bekleniyor";
        previewSize.classList.remove('hidden');
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex flex-col items-center justify-center p-4">
                <span class="material-symbols-outlined text-6xl mb-4 text-primary">library_add_check</span>
                <p class="text-2xl font-bold">${selectedFiles.size} Dosya Seçili</p>
                <p class="text-on-surface-variant mt-2 text-center">Bu dosyaları sağdaki klasörlere sürükleyebilir<br>veya <kbd class="px-2 py-1 bg-surface-container-high rounded ml-1 border border-outline">Delete</kbd> tuşu ile silebilirsiniz.</p>
            </div>
        `;
        return;
    }

    const safeFileName = escapeHTML(file.name);
    previewTitle.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);
    previewSize.classList.remove('hidden');

    const ext = file.name.split('.').pop().toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    const audioExts = ['mp3', 'wav', 'm4a', 'flac', 'aac', 'wma'];
    const textExts = ['txt', 'bat', 'md', 'csv', 'json', 'js', 'py', 'html', 'css', 'xml'];
    const docxExts = ['docx', 'doc'];
    
    previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70"><span class="material-symbols-outlined text-4xl mb-2 animate-spin">refresh</span><br>Yükleniyor...</div>';
    
    // GÜVENLİK YAMASI 1.2: Local kaynaklar "safe-file://" custom protokolü üzerinden çağrılıyor
    if (imageExts.includes(ext)) {
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex items-center justify-center p-4">
                <img src="safe-file://${file.path}" class="max-w-full max-h-[70vh] rounded-lg shadow-lg border border-outline/20 object-contain" alt="preview">
            </div>
        `;
    } else if (videoExts.includes(ext)) {
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex items-center justify-center p-4">
                <video src="safe-file://${file.path}" controls autoplay class="max-w-full max-h-[70vh] rounded-lg shadow-lg border border-outline/20 object-contain"></video>
            </div>
        `;
    } else if (audioExts.includes(ext)) {
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex flex-col items-center justify-center p-4">
                <span class="material-symbols-outlined text-[80px] mb-6 text-teal-400">audiotrack</span>
                <audio src="safe-file://${file.path}" controls autoplay class="w-full max-w-md drop-shadow-md"></audio>
            </div>
        `;
    } else if (ext === 'pdf') {
        previewCanvas.innerHTML = `
            <div class="w-full h-full p-2">
                <embed src="safe-file://${file.path}" type="application/pdf" class="w-full h-full rounded shadow-lg border border-outline/20"></embed>
            </div>
        `;
    } else if (ext === 'heic') {
        const res = await window.electronAPI.readHeicContent(file.path);
        if (res.success) {
            previewCanvas.innerHTML = `
                <div class="w-full h-full flex items-center justify-center p-4">
                    <img src="data:image/jpeg;base64,${res.base64}" class="max-w-full max-h-[70vh] rounded-lg shadow-lg border border-outline/20 object-contain" alt="heic-preview">
                </div>
            `;
        } else {
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">HEIC fotoğraf okunamadı: <br> ${escapeHTML(res.error)}</div>`;
        }
    } else if (textExts.includes(ext)) {
        const res = await window.electronAPI.readFileContent(file.path);
        if (res.success) {
            previewCanvas.innerHTML = `
                <div class="w-full h-full flex flex-col p-4 bg-surface-container-lowest overflow-hidden">
                    <pre class="w-full h-full overflow-auto text-sm font-mono-sm text-on-surface whitespace-pre-wrap select-text p-2"></pre>
                </div>
            `;
            // textContent XSS'e karşı doğal korumadır.
            previewCanvas.querySelector('pre').textContent = res.content;
        } else {
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">${escapeHTML(res.error)}</div>`;
        }
    } else if (docxExts.includes(ext)) {
        const res = await window.electronAPI.readDocxContent(file.path);
        if (res.success) {
            previewCanvas.innerHTML = `
                <div class="w-full h-full flex flex-col p-4 bg-surface-container-lowest overflow-hidden">
                    <div class="w-full h-full overflow-auto text-base text-black bg-white p-6 rounded shadow-lg border border-outline/20" style="font-family: Arial, sans-serif; line-height: 1.6;">
                        ${res.content}
                    </div>
                </div>
            `;
        } else {
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">DOCX okunamadı: <br> ${escapeHTML(res.error)}</div>`;
        }
    } else {
        previewCanvas.innerHTML = `
            <div class="text-on-surface-variant text-center opacity-70 flex flex-col items-center">
                <span class="material-symbols-outlined text-6xl mb-4 ${iconData.color}">${iconData.icon}</span>
                <p class="text-lg">Önizleme desteklenmiyor (Sadece Dosya)</p>
                <p class="text-sm mt-2 opacity-50">${safeFileName}</p>
            </div>
        `;
    }
}

async function refreshTargetFolders() {
    if (!currentTargetPath) return;
    
    const folders = await window.electronAPI.readTargetFolders(currentTargetPath);
    targetFoldersContainer.innerHTML = '';
    
    if (folders.length === 0) {
        folders.push({ name: 'Ana Klasör (Kendisi)', path: currentTargetPath, files: [] });
    }
    
    folders.forEach(folder => {
        const folderContainer = document.createElement('div');
        folderContainer.className = 'mb-2';
        
        const folderEl = document.createElement('div');
        folderEl.className = 'flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-default group transition-colors bg-surface-container mb-1';
        
        const safeFolderName = escapeHTML(folder.name);

        folderEl.innerHTML = `
            <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-on-surface">chevron_right</span>
            <span class="material-symbols-outlined text-[18px] text-yellow-500" style="font-variation-settings: 'FILL' 1;">folder</span>
            <span class="text-body-sm truncate flex-1 font-medium text-on-surface">${safeFolderName}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 bg-secondary-container text-on-secondary-container rounded">${folder.files ? folder.files.length : 0}</span>
        `;
        
        folderEl.addEventListener('dragover', (e) => {
            e.preventDefault(); 
            e.dataTransfer.dropEffect = 'move';
            folderEl.classList.add('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r');
        });
        
        folderEl.addEventListener('dragleave', () => {
            folderEl.classList.remove('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r');
        });
        
        folderEl.addEventListener('drop', async (e) => {
            e.preventDefault();
            folderEl.classList.remove('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r');
            
            if (!folder.path) return;

            try {
                const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                let successCount = 0;
                
                previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70">Taşınıyor...</div>';
                
                for (const sourcePath of data) {
                    const result = await window.electronAPI.moveFile(sourcePath, folder.path);
                    if (result.success) successCount++;
                }

                await refreshSourceFiles();
                await refreshTargetFolders(); 
                
                previewCanvas.innerHTML = `
                    <div class="text-on-surface-variant text-center opacity-50 flex flex-col items-center">
                        <span class="material-symbols-outlined text-6xl mb-2 text-green-400">task_alt</span>
                        <p class="text-xl font-bold">${successCount} Dosya</p>
                        <p>Başarıyla taşındı.</p>
                    </div>
                `;
                previewTitle.textContent = "İşlem Başarılı";
                previewSize.classList.add('hidden');
                previewIcon.textContent = "task_alt";
                previewIcon.className = "material-symbols-outlined text-xl text-green-400";
                
                selectedFiles.clear();
                lastSelectedElement = null;
            } catch(err) {}
        });
        
        folderContainer.appendChild(folderEl);

        if (folder.files && folder.files.length > 0) {
            const fileListContainer = document.createElement('div');
            fileListContainer.className = 'ml-6 border-l border-outline-variant pl-2 space-y-0.5 file-list-container';
            
            folder.files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                const iconData = getIconForExt(ext);
                const safeFileName = escapeHTML(file.name);
                
                const itemEl = document.createElement('div');
                itemEl.className = 'file-item flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-grab active:cursor-grabbing group transition-colors';
                itemEl.draggable = true; 
                itemEl.setAttribute('data-filepath', file.path);
                
                itemEl.innerHTML = `
                    <span class="w-2"></span>
                    <span class="material-symbols-outlined text-[16px] ${iconData.color}">${iconData.icon}</span>
                    <span class="text-body-sm truncate flex-1 text-on-surface-variant group-hover:text-on-surface select-none">${safeFileName}</span>
                `;
                
                itemEl.addEventListener('click', (e) => handleFileClick(e, itemEl, file, iconData));
                
                itemEl.addEventListener('dragstart', (e) => {
                    if (!selectedFiles.has(file.path)) {
                        selectedFiles.clear();
                        selectedFiles.add(file.path);
                        lastSelectedElement = itemEl;
                        updateSelectionUI();
                    }
                    const filesToDrag = Array.from(selectedFiles);
                    e.dataTransfer.setData('text/plain', JSON.stringify(filesToDrag));
                    e.dataTransfer.effectAllowed = 'move';
                    document.querySelectorAll('.file-selected').forEach(el => el.style.opacity = '0.5');
                });
                
                itemEl.addEventListener('dragend', () => {
                    document.querySelectorAll('.file-selected').forEach(el => el.style.opacity = '1');
                });
                
                fileListContainer.appendChild(itemEl);
            });
            folderContainer.appendChild(fileListContainer);
        }

        targetFoldersContainer.appendChild(folderContainer);
    });
    
    updateSelectionUI();
}
