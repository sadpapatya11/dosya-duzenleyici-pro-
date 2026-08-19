let currentSourcePath = null;
let currentTargetPath = null;
let totalSourceFiles = 0;

// DOM Elements
const btnSelectSource = document.getElementById('btn-select-source');
const btnUndoSource = document.getElementById('btn-undo-source');
const sourcePathLabel = document.getElementById('source-path-label');
const sourceFilesContainer = document.getElementById('source-files-container');

// Sol Panele (Kaynak) Drop (Sağdan Sola Taşıma) Özelliği Ekle
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
    
    const sourcePath = e.dataTransfer.getData('text/plain');
    if (sourcePath && currentSourcePath) {
        const result = await window.electronAPI.moveFile(sourcePath, currentSourcePath);
        if (result.success) {
            await refreshTargetFolders();
            await refreshSourceFiles();
            
            previewCanvas.innerHTML = `
                <div class="text-on-surface-variant text-center opacity-70 flex flex-col items-center">
                    <span class="material-symbols-outlined text-4xl mb-2 text-primary">undo</span>
                    <p>Dosya başarıyla kaynağa geri taşındı.</p>
                </div>
            `;
            const previewTitle = document.getElementById('preview-title');
            if(previewTitle) previewTitle.textContent = "İşlem Başarılı";
        } else {
            alert('Dosya taşınamadı: ' + result.error);
        }
    }
});

const btnSelectTarget = document.getElementById('btn-select-target');
const targetPathLabel = document.getElementById('target-path-label');
const targetFoldersContainer = document.getElementById('target-folders-container');

// Preview Elements
const previewHeader = document.getElementById('preview-header');
const previewIcon = document.getElementById('preview-icon');
const previewTitle = document.getElementById('preview-title');
const previewSize = document.getElementById('preview-size');
const previewCanvas = document.getElementById('preview-canvas');
const statusCount = document.getElementById('status-count');

// Helper: Format Bytes
function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Get Icon by Extension
function getIconForExt(ext) {
    const images = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'heic'];
    const videos = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    const docs = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'md'];
    const archives = ['zip', 'rar', '7z', 'tar', 'gz'];
    
    if (images.includes(ext)) return { icon: 'image', color: 'text-purple-400' };
    if (videos.includes(ext)) return { icon: 'movie', color: 'text-pink-400' };
    if (docs.includes(ext)) return { icon: 'description', color: 'text-blue-400' };
    if (archives.includes(ext)) return { icon: 'folder_zip', color: 'text-orange-400' };
    
    return { icon: 'draft', color: 'text-on-surface-variant' };
}

// Select Directories
btnSelectSource.addEventListener('click', async () => {
    const dirPath = await window.electronAPI.selectDirectory();
    if (dirPath) {
        currentSourcePath = dirPath;
        const folderName = dirPath.split('\\').pop() || dirPath.split('/').pop();
        sourcePathLabel.textContent = folderName;
        sourcePathLabel.title = dirPath;
        
        // Otomatik düzenlemeyi kaldırdık! Sadece dosyaları listele
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
        targetPathLabel.textContent = folderName;
        targetPathLabel.title = dirPath;
        await refreshTargetFolders();
    }
});

// Render Source Files
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
        const files = groupData.files; // Sadece ilk 50 dosya gelir
        const groupTotal = groupData.totalItems;
        
        // Group Header
        const groupEl = document.createElement('div');
        groupEl.innerHTML = `
            <div class="flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-default group transition-colors">
                <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-on-surface">expand_more</span>
                <span class="material-symbols-outlined text-[18px] text-yellow-500" style="font-variation-settings: 'FILL' 1;">folder</span>
                <span class="text-body-sm font-medium truncate flex-1 text-on-surface">${group} Dosyaları</span>
                <span class="text-[10px] font-bold px-1.5 py-0.5 bg-primary text-on-primary rounded">${groupTotal}</span>
            </div>
            <div class="ml-6 border-l border-outline-variant pl-2 space-y-0.5 file-list-container"></div>
        `;
        
        const fileListContainer = groupEl.querySelector('.file-list-container');
        
        // Files
        files.forEach(file => {
            const ext = file.name.split('.').pop().toLowerCase();
            const iconData = getIconForExt(ext);
            
            const itemEl = document.createElement('div');
            itemEl.className = 'flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-grab active:cursor-grabbing group transition-colors';
            itemEl.draggable = true;
            
            itemEl.innerHTML = `
                <span class="w-2"></span>
                <span class="material-symbols-outlined text-[18px] ${iconData.color}">${iconData.icon}</span>
                <span class="text-body-sm truncate flex-1 text-on-surface-variant group-hover:text-on-surface">${file.name}</span>
                <span class="text-mono-sm text-on-surface-variant opacity-70">${formatBytes(file.size)}</span>
            `;
            
            // Events
            itemEl.addEventListener('click', () => {
                // Seçili durum stili
                document.querySelectorAll('.file-selected').forEach(el => {
                    el.classList.remove('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
                    const textEl = el.querySelector('.flex-1');
                    if(textEl) { textEl.classList.remove('text-primary-fixed-dim'); textEl.classList.add('text-on-surface-variant'); }
                });
                
                itemEl.classList.add('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
                const textEl = itemEl.querySelector('.flex-1');
                textEl.classList.remove('text-on-surface-variant');
                textEl.classList.add('text-primary-fixed-dim');

                showPreview(file, iconData);
            });
            
            itemEl.addEventListener('dragstart', (e) => {
                e.dataTransfer.setData('text/plain', file.path);
                e.dataTransfer.effectAllowed = 'move';
                itemEl.style.opacity = '0.5';
            });
            itemEl.addEventListener('dragend', () => {
                itemEl.style.opacity = '1';
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
    
    statusCount.textContent = `${totalSourceFiles} Öğe`;
}

// Show Preview in Center Canvas
async function showPreview(file, iconData) {
    // Header Info
    previewIcon.textContent = iconData.icon;
    previewIcon.className = `material-symbols-outlined text-xl ${iconData.color}`;
    previewTitle.textContent = file.name;
    previewSize.textContent = formatBytes(file.size);
    previewSize.classList.remove('hidden');

    const ext = file.name.split('.').pop().toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'];
    const videoExts = ['mp4', 'webm', 'ogg', 'mov', 'avi', 'mkv'];
    const textExts = ['txt', 'bat', 'md', 'csv', 'json', 'js', 'py', 'html', 'css', 'xml'];
    const docxExts = ['docx', 'doc'];
    
    previewCanvas.innerHTML = '<div class="text-on-surface-variant text-center opacity-70"><span class="material-symbols-outlined text-4xl mb-2 animate-spin">refresh</span><br>Yükleniyor...</div>';
    
    if (imageExts.includes(ext)) {
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex items-center justify-center p-4">
                <img src="file://${file.path}" class="max-w-full max-h-[70vh] rounded-lg shadow-lg border border-outline/20 object-contain" alt="preview">
            </div>
        `;
    } else if (videoExts.includes(ext)) {
        previewCanvas.innerHTML = `
            <div class="w-full h-full flex items-center justify-center p-4">
                <video src="file://${file.path}" controls autoplay class="max-w-full max-h-[70vh] rounded-lg shadow-lg border border-outline/20 object-contain"></video>
            </div>
        `;
    } else if (ext === 'pdf') {
        previewCanvas.innerHTML = `
            <div class="w-full h-full p-2">
                <embed src="file://${file.path}" type="application/pdf" class="w-full h-full rounded shadow-lg border border-outline/20"></embed>
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
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">HEIC fotoğraf okunamadı: <br> ${res.error}</div>`;
        }
    } else if (textExts.includes(ext)) {
        const res = await window.electronAPI.readFileContent(file.path);
        if (res.success) {
            previewCanvas.innerHTML = `
                <div class="w-full h-full flex flex-col p-4 bg-surface-container-lowest overflow-hidden">
                    <pre class="w-full h-full overflow-auto text-sm font-mono-sm text-on-surface whitespace-pre-wrap select-text p-2"></pre>
                </div>
            `;
            // İçeriği textContent ile setleyerek HTML escape sağlıyoruz (XSS koruması)
            previewCanvas.querySelector('pre').textContent = res.content;
        } else {
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">${res.error}</div>`;
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
            previewCanvas.innerHTML = `<div class="text-error text-center p-4">DOCX okunamadı: <br> ${res.error}</div>`;
        }
    } else {
        previewCanvas.innerHTML = `
            <div class="text-on-surface-variant text-center opacity-70 flex flex-col items-center">
                <span class="material-symbols-outlined text-6xl mb-4 ${iconData.color}">${iconData.icon}</span>
                <p class="text-lg">Önizleme desteklenmiyor (Sadece Dosya)</p>
                <p class="text-sm mt-2 opacity-50">${file.name}</p>
            </div>
        `;
    }
}

// Render Target Folders
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
        
        folderEl.innerHTML = `
            <span class="material-symbols-outlined text-[16px] text-on-surface-variant group-hover:text-on-surface">chevron_right</span>
            <span class="material-symbols-outlined text-[18px] text-yellow-500" style="font-variation-settings: 'FILL' 1;">folder</span>
            <span class="text-body-sm truncate flex-1 font-medium text-on-surface">${folder.name}</span>
            <span class="text-[10px] font-bold px-1.5 py-0.5 bg-secondary-container text-on-secondary-container rounded">${folder.files ? folder.files.length : 0}</span>
        `;
        
        // Drop Events (Hedef Klasöre dosya bırakma)
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
            
            const sourcePath = e.dataTransfer.getData('text/plain');
            if (sourcePath && folder.path) {
                const result = await window.electronAPI.moveFile(sourcePath, folder.path);
                if (result.success) {
                    await refreshSourceFiles();
                    await refreshTargetFolders(); // Hedefi de tazele ki atılan dosya sağda da görünsün
                    // Önizlemeyi temizle
                    previewCanvas.innerHTML = `
                        <div class="text-on-surface-variant text-center opacity-50 flex flex-col items-center">
                            <span class="material-symbols-outlined text-4xl mb-2">check_circle</span>
                            <p>Dosya başarıyla taşındı.</p>
                        </div>
                    `;
                    previewTitle.textContent = "İşlem Başarılı";
                    previewSize.classList.add('hidden');
                    previewIcon.textContent = "task_alt";
                    previewIcon.className = "material-symbols-outlined text-xl text-green-400";
                } else {
                    alert('Dosya taşınamadı: ' + result.error);
                }
            }
        });
        
        folderContainer.appendChild(folderEl);

        // Hedef klasörün altındaki dosyaları listele (Sağdan sola taşıyabilmek için)
        if (folder.files && folder.files.length > 0) {
            const fileListContainer = document.createElement('div');
            fileListContainer.className = 'ml-6 border-l border-outline-variant pl-2 space-y-0.5 file-list-container';
            
            folder.files.forEach(file => {
                const ext = file.name.split('.').pop().toLowerCase();
                const iconData = getIconForExt(ext);
                
                const itemEl = document.createElement('div');
                itemEl.className = 'flex items-center gap-2 px-2 py-1.5 hover:bg-surface-container-high rounded cursor-grab active:cursor-grabbing group transition-colors';
                itemEl.draggable = true; // SAĞDAN SOLA SÜRÜKLEME DESTEĞİ
                
                itemEl.innerHTML = `
                    <span class="w-2"></span>
                    <span class="material-symbols-outlined text-[16px] ${iconData.color}">${iconData.icon}</span>
                    <span class="text-body-sm truncate flex-1 text-on-surface-variant group-hover:text-on-surface">${file.name}</span>
                `;
                
                // Sağdaki dosyaya tıklayınca da önizleme yapsın
                itemEl.addEventListener('click', () => {
                    document.querySelectorAll('.file-selected').forEach(el => {
                        el.classList.remove('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
                        const textEl = el.querySelector('.flex-1');
                        if(textEl) { textEl.classList.remove('text-primary-fixed-dim'); textEl.classList.add('text-on-surface-variant'); }
                    });
                    itemEl.classList.add('bg-primary-container/20', 'border-l-2', 'border-primary', 'rounded-r', 'file-selected');
                    const textEl = itemEl.querySelector('.flex-1');
                    textEl.classList.remove('text-on-surface-variant');
                    textEl.classList.add('text-primary-fixed-dim');
                    
                    showPreview(file, iconData);
                });
                
                // Sürüklemeyi Başlat
                itemEl.addEventListener('dragstart', (e) => {
                    e.dataTransfer.setData('text/plain', file.path);
                    e.dataTransfer.effectAllowed = 'move';
                    itemEl.style.opacity = '0.5';
                });
                itemEl.addEventListener('dragend', () => itemEl.style.opacity = '1');
                
                fileListContainer.appendChild(itemEl);
            });
            folderContainer.appendChild(fileListContainer);
        }

        targetFoldersContainer.appendChild(folderContainer);
    });
}


