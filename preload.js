const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    selectDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    readSourceFiles: (path) => ipcRenderer.invoke('fs:readSourceFiles', path),
    readTargetFolders: (path) => ipcRenderer.invoke('fs:readTargetFolders', path),
    moveFile: (sourcePath, targetDir) => ipcRenderer.invoke('fs:moveFile', sourcePath, targetDir),
    autoOrganize: (targetDir) => ipcRenderer.invoke('fs:autoOrganize', targetDir),
    undoAutoOrganize: (targetDir) => ipcRenderer.invoke('fs:undoAutoOrganize', targetDir),
    readFileContent: (filePath) => ipcRenderer.invoke('fs:readFileContent', filePath),
    readDocxContent: (filePath) => ipcRenderer.invoke('fs:readDocxContent', filePath),
    readHeicContent: (filePath) => ipcRenderer.invoke('fs:readHeicContent', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('fs:deleteFile', filePath)
});
