const { app, BrowserWindow, ipcMain, dialog, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const sharp = require('sharp');

let mainWindow;

// GÜVENLİK YAMASI 2: Path Traversal (Yetkisiz Dizin Geçişi) Önlemi
// Uygulamanın sadece kullanıcının açıkça seçtiği klasörlerin içinde işlem yapmasını sağlayan "Sandbox" Listesi
let allowedPaths = new Set();

function isPathAllowed(targetPath) {
    if (!targetPath) return false;
    const resolvedPath = path.resolve(targetPath);
    for (const allowed of allowedPaths) {
        if (resolvedPath.startsWith(path.resolve(allowed))) {
            return true;
        }
    }
    return false;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            plugins: true,
            // GÜVENLİK YAMASI 1: XSS to Local File Read/RCE açığını önlemek için Cross-Origin politikası zorunlu kılındı.
            webSecurity: true 
        },
        autoHideMenuBar: true,
        title: 'Dosya Düzenleyici Pro (Red Team Secured)'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
    // GÜVENLİK YAMASI 1.1: webSecurity aktif edildiğinde lokal imajların güvenli gösterimi için Custom Sandbox Protocol.
    protocol.registerFileProtocol('safe-file', (request, callback) => {
        const url = request.url.replace('safe-file://', '');
        try {
            const decodedPath = decodeURIComponent(url);
            // Path Traversal engelleyici
            if (isPathAllowed(decodedPath)) {
                return callback(decodedPath);
            } else {
                console.warn(`[GÜVENLİK İHLALİ ENGELLENDİ] safe-file: ${decodedPath}`);
                return callback(403); 
            }
        } catch (error) {
            return callback(404);
        }
    });

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Klasör Seçim İsteği (Sandbox yetki verme noktası)
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (canceled) {
        return null;
    } else {
        allowedPaths.add(filePaths[0]); // Seçilen klasör Sandbox yetkisine eklendi.
        return filePaths[0];
    }
});

ipcMain.handle('fs:readSourceFiles', async (event, dirPath) => {
    if (!isPathAllowed(dirPath)) return { groups: {}, totalCount: 0 };
    try {
        const filesArray = [];
        
        async function scanDirectory(currentPath) {
            try {
                const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                for (const item of items) {
                    const itemPath = path.join(currentPath, item.name);
                    if (item.isDirectory()) {
                        if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                        await scanDirectory(itemPath); 
                    } else if (item.isFile()) {
                        try {
                            const stat = await fs.promises.stat(itemPath);
                            let ext = path.extname(item.name).toLowerCase();
                            let groupName = ext ? ext.substring(1).toUpperCase() : 'Bilinmeyen';
                            if (!groupName) groupName = 'Dosya';

                            filesArray.push({
                                name: item.name,
                                path: itemPath,
                                size: stat.size,
                                group: groupName
                            });
                        } catch (e) {}
                    }
                }
            } catch (err) {}
        }

        await scanDirectory(dirPath);

        const groupedFiles = {};
        filesArray.forEach(f => {
            if (!groupedFiles[f.group]) {
                groupedFiles[f.group] = { totalItems: 0, files: [] };
            }
            groupedFiles[f.group].totalItems++;
            if (groupedFiles[f.group].files.length < 50) {
                groupedFiles[f.group].files.push(f);
            }
        });

        Object.keys(groupedFiles).forEach(group => {
            groupedFiles[group].files.sort((a, b) => b.size - a.size);
        });

        return { groups: groupedFiles, totalCount: filesArray.length };
    } catch (error) {
        return { groups: {}, totalCount: 0 };
    }
});

ipcMain.handle('fs:readTargetFolders', async (event, dirPath) => {
    if (!isPathAllowed(dirPath)) return [];
    try {
        const items = fs.readdirSync(dirPath, { withFileTypes: true });
        const folders = [];
        
        for (const item of items) {
            if (item.isDirectory()) {
                if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                
                const folderPath = path.join(dirPath, item.name);
                const folderObj = {
                    name: item.name,
                    path: folderPath,
                    files: []
                };
                
                try {
                    const subItems = fs.readdirSync(folderPath, { withFileTypes: true });
                    for (const sub of subItems) {
                        if (sub.isFile()) {
                            const subPath = path.join(folderPath, sub.name);
                            try {
                                const stat = fs.statSync(subPath);
                                folderObj.files.push({
                                    name: sub.name,
                                    path: subPath,
                                    size: stat.size
                                });
                            } catch(e) {}
                        }
                    }
                    folderObj.files.sort((a, b) => b.size - a.size);
                    if (folderObj.files.length > 100) {
                         folderObj.files = folderObj.files.slice(0, 100);
                    }
                } catch(e) {}

                folders.push(folderObj);
            }
        }
        return folders;
    } catch (error) {
        return [];
    }
});

ipcMain.handle('fs:moveFile', async (event, sourcePath, targetDir) => {
    if (!isPathAllowed(sourcePath) || !isPathAllowed(targetDir)) {
        return { success: false, error: 'Sandbox yetkisi dışında işlem reddedildi.' };
    }
    try {
        const fileName = path.basename(sourcePath);
        const destPath = path.join(targetDir, fileName);
        fs.renameSync(sourcePath, destPath);
        return { success: true, newPath: destPath };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fs:deleteFile', async (event, filePath) => {
    if (!isPathAllowed(filePath)) {
        return { success: false, error: 'Sandbox yetkisi dışında işlem reddedildi.' };
    }
    try {
        await shell.trashItem(filePath);
        return { success: true };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fs:readHeicContent', async (event, filePath) => {
    if (!isPathAllowed(filePath)) return { success: false, error: 'Yetkisiz erişim.' };
    try {
        const outputBuffer = await sharp(filePath)
            .jpeg({ quality: 50 })
            .toBuffer();
        const base64Str = outputBuffer.toString('base64');
        return { success: true, base64: base64Str };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fs:autoOrganize', async (event, sourceDir) => {
    if (!isPathAllowed(sourceDir)) return { success: false, error: 'Yetki reddedildi.' };
    try {
        let successCount = 0;
        let failCount = 0;
        
        async function organizeDirectory(currentPath) {
            try {
                const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                for (const item of items) {
                    const itemPath = path.join(currentPath, item.name);
                    if (item.isDirectory()) {
                        if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                        await organizeDirectory(itemPath);
                    } else if (item.isFile()) {
                        try {
                            let ext = path.extname(item.name).toLowerCase();
                            let groupName = ext ? ext.substring(1).toUpperCase() : 'Bilinmeyen';
                            if (!groupName) groupName = 'Dosya';
                            
                            const groupFolder = path.join(sourceDir, groupName);
                            if (!fs.existsSync(groupFolder)) {
                                fs.mkdirSync(groupFolder, { recursive: true });
                            }
                            
                            const destPath = path.join(groupFolder, item.name);
                            if (itemPath !== destPath && fs.existsSync(itemPath)) {
                                fs.renameSync(itemPath, destPath);
                                successCount++;
                            }
                        } catch (err) { failCount++; }
                    }
                }
            } catch (e) {}
        }
        
        await organizeDirectory(sourceDir);
        return { success: true, successCount, failCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fs:undoAutoOrganize', async (event, sourceDir) => {
    if (!isPathAllowed(sourceDir)) return { success: false, error: 'Yetki reddedildi.' };
    try {
        let successCount = 0;
        let failCount = 0;
        
        const items = await fs.promises.readdir(sourceDir, { withFileTypes: true });
        for (const item of items) {
            if (item.isDirectory()) {
                if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                
                const folderPath = path.join(sourceDir, item.name);
                try {
                    const subItems = await fs.promises.readdir(folderPath, { withFileTypes: true });
                    for (const sub of subItems) {
                        if (sub.isFile()) {
                            const oldPath = path.join(folderPath, sub.name);
                            const newPath = path.join(sourceDir, sub.name);
                            if (oldPath !== newPath && fs.existsSync(oldPath)) {
                                fs.renameSync(oldPath, newPath);
                                successCount++;
                            }
                        }
                    }
                    const checkEmpty = await fs.promises.readdir(folderPath);
                    if (checkEmpty.length === 0) {
                        fs.rmdirSync(folderPath);
                    }
                } catch(e) { failCount++; }
            }
        }
        return { success: true, successCount, failCount };
    } catch (error) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('fs:readFileContent', async (event, filePath) => {
    if (!isPathAllowed(filePath)) return { error: 'Güvenlik İhlali: Sandbox dışı dosya okunamaz.' };
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > 5 * 1024 * 1024) {
            return { error: 'Dosya çok büyük (5MB+). Önizleme desteklenmiyor.' };
        }
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { success: true, content: content };
    } catch (error) {
        return { error: error.message };
    }
});

ipcMain.handle('fs:readDocxContent', async (event, filePath) => {
    if (!isPathAllowed(filePath)) return { success: false, error: 'Güvenlik ihlali.' };
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > 20 * 1024 * 1024) { 
            return { success: false, error: 'Word dosyası çok büyük (20MB+).' };
        }
        const result = await mammoth.convertToHtml({path: filePath});
        return { success: true, content: result.value };
    } catch (error) {
        return { success: false, error: 'Dosya okunurken hata oluştu veya bozuk: ' + error.message };
    }
});
