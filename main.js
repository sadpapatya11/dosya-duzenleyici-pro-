const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const mammoth = require('mammoth');
const heicConvert = require('heic-convert');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false,
            plugins: true,
            webSecurity: false
        },
        autoHideMenuBar: true,
        title: 'Dosya Düzenleyici Pro'
    });

    mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
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

// Klasör Seçim İsteği
ipcMain.handle('dialog:openDirectory', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (canceled) {
        return null;
    } else {
        return filePaths[0];
    }
});

// Kaynak Dosyaları Okuma (Gruplanmış ve Sıralanmış - Recursive & Optimized for IPC)
ipcMain.handle('fs:readSourceFiles', async (event, dirPath) => {
    try {
        const filesArray = [];
        
        async function scanDirectory(currentPath) {
            try {
                const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                for (const item of items) {
                    const itemPath = path.join(currentPath, item.name);
                    if (item.isDirectory()) {
                        // Kısır döngüleri ve gizli sistem klasörlerini atlamak için
                        if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                        await scanDirectory(itemPath); // Recursive
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
            // UI'ı kilitlenmekten kurtarmak için sadece ilk 50 dosyayı aktar
            if (groupedFiles[f.group].files.length < 50) {
                groupedFiles[f.group].files.push(f);
            }
        });

        // Kısmi boyut sıralaması
        Object.keys(groupedFiles).forEach(group => {
            groupedFiles[group].files.sort((a, b) => b.size - a.size);
        });

        return { groups: groupedFiles, totalCount: filesArray.length };
    } catch (error) {
        console.error("Kaynak klasör okunamadı:", error);
        return { groups: {}, totalCount: 0 };
    }
});

// Hedef Klasör Hiyerarşisini Okuma
ipcMain.handle('fs:readTargetFolders', async (event, dirPath) => {
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
                
                // Klasörün içindeki dosyaları oku (sadece 1 kademe)
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
                    // Dosyaları boyuta göre sırala
                    folderObj.files.sort((a, b) => b.size - a.size);
                    // UI çökmesin diye ilk 100 tanesini alalım
                    if (folderObj.files.length > 100) {
                         folderObj.files = folderObj.files.slice(0, 100);
                    }
                } catch(e) {}

                folders.push(folderObj);
            }
        }
        return folders;
    } catch (error) {
        console.error("Hedef klasör okunamadı:", error);
        return [];
    }
});

// Dosya Taşıma
ipcMain.handle('fs:moveFile', async (event, sourcePath, targetDir) => {
    try {
        const fileName = path.basename(sourcePath);
        const destPath = path.join(targetDir, fileName);
        
        fs.renameSync(sourcePath, destPath);
        return { success: true, newPath: destPath };
    } catch (error) {
        console.error("Dosya taşıma hatası:", error);
        return { success: false, error: error.message };
    }
});

// HEIC Dosyalarını Okuma (Preview için)
ipcMain.handle('fs:readHeicContent', async (event, filePath) => {
    try {
        const inputBuffer = await fs.promises.readFile(filePath);
        const outputBuffer = await heicConvert({
            buffer: inputBuffer, // the HEIC file buffer
            format: 'JPEG',      // output format
            quality: 0.5         // the jpeg compression quality, between 0 and 1
        });
        const base64Str = outputBuffer.toString('base64');
        return { success: true, base64: base64Str };
    } catch (error) {
        console.error('HEIC çevirme hatası:', error);
        return { success: false, error: error.message };
    }
});

// Tüm Dosyaları Otomatik Düzenle (.bat scripti mantığı) - Ram/IPC Dostu
ipcMain.handle('fs:autoOrganize', async (event, sourceDir) => {
    try {
        let successCount = 0;
        let failCount = 0;
        
        async function organizeDirectory(currentPath) {
            try {
                const items = await fs.promises.readdir(currentPath, { withFileTypes: true });
                for (const item of items) {
                    const itemPath = path.join(currentPath, item.name);
                    if (item.isDirectory()) {
                        // Oluşturduğumuz klasörlere geri girmemesi ve döngüye girmemesi için:
                        // Eğer bu klasör ana dizindeyse ve isminde nokta yoksa es geçebiliriz ama en iyisi:
                        if (item.name.startsWith('$') || item.name === 'System Volume Information') continue;
                        // Hedef klasörleri okuma ki sonsuz döngü olmasın (ör: 'JPG' klasörünün içine tekrar girmemeli)
                        // Bunu anlamak için sourceDir klasörünün altındaki doğrudan klasörler eğer hedeflerse onlara girmeyebiliriz. 
                        // Fakat daha basit bir recursive kontrol yapalım.
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
                        } catch (err) {
                            failCount++;
                        }
                    }
                }
            } catch (e) {}
        }
        
        await organizeDirectory(sourceDir);
        return { success: true, successCount, failCount };
    } catch (error) {
        console.error("Otomatik organize hatası:", error);
        return { success: false, error: error.message };
    }
});

// Otomatik Düzenlemeyi Geri Al (Dosyaları Ana Klasöre Çıkar)
ipcMain.handle('fs:undoAutoOrganize', async (event, sourceDir) => {
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
                    // Klasör içi boşaldıysa klasörü sil
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

// Metin Dosyalarını Okuma (Preview için)
ipcMain.handle('fs:readFileContent', async (event, filePath) => {
    try {
        const stat = await fs.promises.stat(filePath);
        // Eğer 5 MB'dan büyükse tam okuma
        if (stat.size > 5 * 1024 * 1024) {
            return { error: 'Dosya çok büyük (5MB+). Önizleme desteklenmiyor.' };
        }
        const content = await fs.promises.readFile(filePath, 'utf-8');
        return { success: true, content: content };
    } catch (error) {
        return { error: error.message };
    }
});

// DOCX Dosyalarını Okuma (Preview için)
ipcMain.handle('fs:readDocxContent', async (event, filePath) => {
    try {
        const stat = await fs.promises.stat(filePath);
        if (stat.size > 20 * 1024 * 1024) { // 20 MB Limit
            return { success: false, error: 'Word dosyası çok büyük (20MB+).' };
        }
        const result = await mammoth.convertToHtml({path: filePath});
        return { success: true, content: result.value };
    } catch (error) {
        return { success: false, error: 'Dosya okunurken hata oluştu veya bozuk: ' + error.message };
    }
});

