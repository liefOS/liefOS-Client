const { contextBridge, ipcRenderer } = require('electron');

var DragState = null;

document.addEventListener('mousedown', function(E) {
    if (E.clientY > 28) return;
    DragState = { Sx: E.screenX, Sy: E.screenY, Started: false };
});

document.addEventListener('mousemove', function(E) {
    if (!DragState) return;
    if (!DragState.Started) {
        var Dx = E.screenX - DragState.Sx;
        var Dy = E.screenY - DragState.Sy;
        if (Math.abs(Dx) < 3 && Math.abs(Dy) < 3) return;
        DragState.Started = true;
    }
    if (DragState.Next && Date.now() < DragState.Next) return;
    DragState.Next = Date.now() + 16;
    var Dx = E.screenX - DragState.Sx;
    var Dy = E.screenY - DragState.Sy;
    ipcRenderer.send('move-window-by', Dx, Dy);
    DragState.Sx = E.screenX;
    DragState.Sy = E.screenY;
});

document.addEventListener('mouseup', function() {
    DragState = null;
});

contextBridge.exposeInMainWorld('liefOSAPI', {
    QuitApp: () => ipcRenderer.send('quit-app'),
    RebootApp: () => ipcRenderer.send('shutdown-reopen'),
    DownloadAndExtract: () => ipcRenderer.invoke('download-and-extract'),
    CancelDownload: () => ipcRenderer.send('cancel-download'),
    BootProcess: (Version) => ipcRenderer.invoke('boot-process', Version),
    OnDownloadProgress: (Callback) => ipcRenderer.on('download-progress', Callback),
    OnBootProgress: (Callback) => ipcRenderer.on('boot-progress', (Event, Data) => Callback(Data)),
    OnLaunchError: (Callback) => ipcRenderer.on('launch-error', (Event, Message) => Callback(Message)),
    GetDevMode: () => ipcRenderer.invoke('get-dev-mode'),
    GetLocalVersion: () => ipcRenderer.invoke('get-local-version'),
    DeleteAllVersions: (KeepVersion) => ipcRenderer.invoke('delete-all-versions', KeepVersion),
    SetOrientation: (Width, Height) => ipcRenderer.invoke('set-orientation', Width, Height),
    ClearSystemData: () => ipcRenderer.invoke('clear-system-data'),
    NavigateView: (Path) => ipcRenderer.send('navigate-view', Path),
    QuitToLauncher: () => ipcRenderer.send('quit-to-launcher'),
    GetLocale: () => ipcRenderer.invoke('get-locale'),
    FetchLocalClientVersion: () => ipcRenderer.invoke('get-local-client-version'),
    OpenUpdateUrl: () => ipcRenderer.send('open-update-url'),

    OnAppLaunched: (AppID, AppName) => ipcRenderer.send('app-launched', AppID, AppName),
    OnAppTerminated: (AppID) => ipcRenderer.send('app-terminated', AppID),

    IsElectron: true,
    GetAppPath: () => ipcRenderer.invoke('get-app-path'),
    OpenExternal: (URL) => ipcRenderer.send('open-external', URL),

    GetImproperShutdown: () => ipcRenderer.invoke('get-improper-shutdown'),
    GetClientInfo: () => ipcRenderer.invoke('get-client-info'),
    GetSystemInfo: () => ipcRenderer.invoke('get-system-info'),
    GetMemoryUsage: () => ipcRenderer.invoke('get-memory-usage'),
});
