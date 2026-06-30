const { app: App, BrowserWindow, ipcMain: IpcMain, shell: Shell, Menu, dialog: Dialog, screen: Screen } = require('electron');
const Path = require('path');
const Fs = require('fs').promises;
const FsSync = require('fs');
const Https = require('https');
const Crypto = require('crypto');
const Os = require('os');
const { execFile: ExecFile } = require('child_process');
const { promisify: Promisify } = require('util');
const ExecFileAsync = Promisify(ExecFile);
// Set to true for development mode, it basically just shows the latest version and current version, oh and devtools.
const DevelopmentMode = false;
const GotTheLock = App.requestSingleInstanceLock();
const macOSClient = process.platform === 'darwin';
const windowsClient = process.platform === 'win32';
const WindowState = require('electron-window-state');
let MainWindow;
const AppDataPath = App.getPath('userData');
const VersionsPath = Path.join(AppDataPath, 'versions');
const OsTempDir = Path.join(Os.tmpdir(), 'liefOS');
const IconPath = Path.join(__dirname, 'build', 'icons', 'icon.icns');
const BootedFlagPath = Path.join(AppDataPath, 'booted.flag');
const SettingsPath = Path.join(AppDataPath, 'settings.json');
let Locale;
let ClientVersionInfo;
let CachedMemoryUsage = null;
let DownloadRequest = null;
const MinWindowWidth = 390;
const MinWindowHeight = 844;

try {
    Locale = JSON.parse(FsSync.readFileSync(Path.join(__dirname, 'locales', 'English.json'), 'utf-8'));
} catch (_) {
    Locale = {};
}

function LocStr(Key, Params = {}) {
    let Str = Key.split('.').reduce((O, K) => O?.[K], Locale);
    if (Str === undefined) return Key;
    for (const [K, V] of Object.entries(Params)) {
        Str = Str.replace(new RegExp(`\\{${K}\\}`, 'g'), V);
    }
    return Str;
}

if (!GotTheLock) {
    App.quit();
} else {
    App.on('second-instance', () => {
        if (MainWindow) {
            if (MainWindow.isMinimized()) MainWindow.restore();
            MainWindow.focus();
        }
    });
}

try {
    require('electron-reloader')(module);
} catch (_) { }

function GetSetting(Key, Default) {
    try {
        if (!FsSync.existsSync(SettingsPath)) return Default;
        var D = JSON.parse(FsSync.readFileSync(SettingsPath, 'utf-8'));
        return Key in D ? D[Key] : Default;
    } catch (_) { return Default; }
}

function SetSetting(Key, Val) {
    try {
        var D = {};
        if (FsSync.existsSync(SettingsPath)) {
            D = JSON.parse(FsSync.readFileSync(SettingsPath, 'utf-8'));
        }
        D[Key] = Val;
        FsSync.writeFileSync(SettingsPath, JSON.stringify(D, null, 2));
    } catch (_) { }
}

try {
    ClientVersionInfo = JSON.parse(FsSync.readFileSync(Path.join(__dirname, 'client.json'), 'utf-8'));
} catch (_) {
    ClientVersionInfo = { ClientVersion: "0.0.0" };
}

async function ExtractZip(ZipPath, DestPath) {
    if (process.platform === 'win32') {
        if (!FsSync.existsSync(DestPath)) {
            FsSync.mkdirSync(DestPath, { recursive: true });
        }
        const PsCmd = `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory('${ZipPath.replace(/'/g, "''")}', '${DestPath.replace(/'/g, "''")}', $true)`;
        await ExecFileAsync('powershell', ['-Command', PsCmd], { timeout: 20000 });
    } else {
        if (!FsSync.existsSync(DestPath)) {
            FsSync.mkdirSync(DestPath, { recursive: true });
        }
        await ExecFileAsync('unzip', ['-o', ZipPath, '-d', DestPath], { timeout: 20000 });
    }
}

async function ComputeSHA512(FilePath) {
    const Buffer = await Fs.readFile(FilePath);
    return Crypto.createHash('sha512').update(Buffer).digest('hex');
}

function CreateApplicationMenu() {
    const L = Locale.menu || {};
    const IsMac = macOSClient;
    const Template = [];

    if (IsMac) {
        Template.push({
            label: App.name,
            submenu: [
                { label: L.about, role: 'about' },
                { type: 'separator' },
                { label: L.quit, role: 'quit' }
            ]
        });
    }

    Template.push(
        ...(IsMac ? [] : [{
            label: L.file,
            submenu: [
                { label: L.quit, role: 'quit' }
            ]
        }]),
        {
            label: L.edit,
            submenu: [
                { label: L.cut, role: 'cut' },
                { label: L.copy, role: 'copy' },
                { label: L.paste, role: 'paste' }
            ]
        },
        {
            label: L.window,
            submenu: [
                ...(IsMac ? [] : [{ label: L.close, role: 'close' }]),
                { type: 'separator' },
                {
                    label: L.resetScaling,
                    click: function () {
                        if (MainWindow) {
                            var Pos = MainWindow.getPosition();
                            var Sz = MainWindow.getSize();
                            MainWindow.setSize(390, 844);
                            MainWindow.setPosition(
                                Pos[0] + Math.round((Sz[0] - 390) / 2),
                                Pos[1] + Math.round((Sz[1] - 844) / 2)
                            );
                        }
                    }
                },
                {
                    label: L.saveWindowState,
                    type: 'checkbox',
                    checked: GetSetting('saveWindowState', true),
                    click: function (Item) { SetSetting('saveWindowState', Item.checked); }
                }
            ]
        },
        {
            label: L.help,
            submenu: [
                { label: L.about, role: 'about' }
            ]
        }
    );

    const MenuInstance = Menu.buildFromTemplate(Template);
    Menu.setApplicationMenu(MenuInstance);
}

function CreateWindow() {
    var SaveState = GetSetting('saveWindowState', true);
    var WState = WindowState({
        defaultWidth: 390,
        defaultHeight: 844
    });

    var WinW, WinH, WinX, WinY;
    if (SaveState && WState.width !== 390 && WState.height !== 844) {
        WinW = WState.width;
        WinH = WState.height;
        WinX = WState.x;
        WinY = WState.y;
    } else {
        var WorkArea = Screen.getPrimaryDisplay().workAreaSize;
        var MaxScale = Math.min(WorkArea.width / 390, WorkArea.height / 844) * 0.85;
        WinW = Math.round(390 * MaxScale);
        WinH = Math.round(844 * MaxScale);
        WinX = Math.round((WorkArea.width - WinW) / 2 + WorkArea.x);
        WinY = Math.round((WorkArea.height - WinH) / 2 + WorkArea.y);
    }

    MainWindow = new BrowserWindow({
        width: WinW,
        height: WinH,
        x: WinX,
        y: WinY,
        minWidth: 195,
        minHeight: 422,
        frame: false,
        resizable: true,
        hasShadow: true,
        transparent: true,
        roundedCorners: false,
        backgroundColor: '#00000000',
        webPreferences: {
            preload: Path.join(__dirname, 'Client', 'JavaScript', 'liefOSAPI.js'),
            nodeIntegration: false,
            contextIsolation: true,
            webviewTag: true,
            devTools: DevelopmentMode,
            scrollBounce: macOSClient
        }
    });

    if (SaveState) {
        WState.manage(MainWindow);
    }

    MainWindow.loadFile(Path.join(__dirname, 'liefOS.html'));

    MainWindow.setAspectRatio(390 / 844);

    if (!macOSClient) {
        MainWindow.setAutoHideMenuBar(true);
    }

    MainWindow.webContents.setWindowOpenHandler(() => {
        return { action: 'deny' };
    });
}

IpcMain.on('shutdown-reopen', () => {
    App.relaunch();
    App.exit();
});

App.whenReady().then(async () => {
    App.setName(LocStr('app.name'));
    CreateApplicationMenu();

    if (!FsSync.existsSync(VersionsPath)) {
        FsSync.mkdirSync(VersionsPath, { recursive: true });
    }

    CreateWindow();
    App.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) CreateWindow();
    });
});

App.on('window-all-closed', () => {
    if (process.platform !== 'darwin') App.quit();
});

App.on('before-quit', async () => {
    try {
        if (FsSync.existsSync(OsTempDir)) {
            await Fs.rm(OsTempDir, { recursive: true, force: true });
        }
    } catch (_) { }
});

IpcMain.on('quit-app', () => {
    try { FsSync.unlinkSync(BootedFlagPath); } catch (_) { }
    App.quit();
});

IpcMain.handle('get-dev-mode', () => {
    return DevelopmentMode;
});

IpcMain.handle('get-improper-shutdown', () => {
    return FsSync.existsSync(BootedFlagPath);
});

IpcMain.handle('get-setting', (Event, Key, Default) => {
    return GetSetting(Key, Default);
});

IpcMain.on('set-setting', (Event, Key, Val) => {
    SetSetting(Key, Val);
});

IpcMain.on('navigate-view', (IpcEvent, Path) => {
    if (Path !== 'launcher.html') {
        try { FsSync.writeFileSync(BootedFlagPath, '1'); } catch (_) { }
    }
    if (MainWindow) {
        var Inject = Path !== 'launcher.html';
        var Escaped = Path.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        MainWindow.webContents.executeJavaScript(
            'NavigateWebView(\'' + Escaped + '\', ' + Inject + ');'
        ).catch(function (Err) { console.error('Shell nav error:', Err); });
    }
});

IpcMain.on('quit-to-launcher', () => {
    if (MainWindow) {
        const [Wx, Wy] = MainWindow.getPosition();
        const [Ww, Wh] = MainWindow.getSize();
        MainWindow.setSize(390, 844);
        MainWindow.setPosition(Wx + Math.round((Ww - 390) / 2), Wy + Math.round((Wh - 844) / 2));
        MainWindow.webContents.executeJavaScript(
            'NavigateWebView(\'launcher.html\', false);'
        ).catch(function (Err) { console.error('Shell nav error:', Err); });
    }
});

IpcMain.on('move-window-by', (Event, Dx, Dy) => {
    if (MainWindow) {
        var Pos = MainWindow.getPosition();
        MainWindow.setPosition(Pos[0] + Dx, Pos[1] + Dy);
    }
});

IpcMain.handle('get-local-version', async () => {
    if (!FsSync.existsSync(VersionsPath)) return { version: null, hasAnyFiles: false };

    const AllFiles = FsSync.readdirSync(VersionsPath);
    const HasAnyFiles = AllFiles.some(F => F !== '.DS_Store');

    const VersionRegex = /^liefOS-(\d+)\.(\d+)\.(\d+)\.zip$/;
    const ValidZips = AllFiles
        .filter(F => VersionRegex.test(F))
        .map(F => ({
            name: F,
            version: F.replace('liefOS-', '').replace('.zip', ''),
            mtime: FsSync.statSync(Path.join(VersionsPath, F)).mtimeMs
        }))
        .sort((A, B) => B.mtime - A.mtime);

    if (ValidZips.length === 0) return { version: null, hasAnyFiles: HasAnyFiles };

    return { version: ValidZips[0].version, hasAnyFiles: true };
});

IpcMain.handle('delete-all-versions', async (IpcEvent, KeepVersion) => {
    if (!FsSync.existsSync(VersionsPath)) return { success: true };
    try {
        const Files = FsSync.readdirSync(VersionsPath).filter(F => F.endsWith('.zip') && F.startsWith('liefOS-'));
        for (const FileEntry of Files) {
            if (KeepVersion) {
                const V = FileEntry.replace('liefOS-', '').replace('.zip', '');
                if (V === KeepVersion) continue;
            }
            FsSync.unlinkSync(Path.join(VersionsPath, FileEntry));
        }
        return { success: true };
    } catch (Err) {
        return { success: false, error: Err.message };
    }
});

IpcMain.on('cancel-download', () => {
    if (DownloadRequest) {
        DownloadRequest.destroy();
        DownloadRequest = null;
    }
});

IpcMain.handle('download-and-extract', async (IpcEvent) => {
    let Version, SecureHash;
    try {
        const Response = await fetch('https://web-liefos.netlify.app/version.json');
        if (!Response.ok) throw new Error(`HTTP ${Response.status}`);
        const Data = await Response.json();
        Version = Data.Version;
        SecureHash = Data.SecureHash;
        if (!Version || !SecureHash) throw new Error(LocStr('errors.invalidVersionData'));
    } catch (Err) {
        throw new Error(LocStr('errors.fetchFailed', { message: Err.message }));
    }

    return new Promise((Resolve, Reject) => {
        const Url = `https://web-liefos.netlify.app/Software/liefOS-${Version}.zip`;
        const VersionZipPath = Path.join(VersionsPath, `liefOS-${Version}.zip`);
        const TempDownloadPath = Path.join(AppDataPath, `temp_${Version}.zip`);

        const WriteStream = FsSync.createWriteStream(TempDownloadPath);

        let DownloadedBytes = 0;
        let LastDownloadedBytes = 0;
        let WatchdogTimer = null;

        const HttpRequest = Https.get(Url, async (ServerResponse) => {
            if (ServerResponse.statusCode !== 200) {
                Reject(new Error(LocStr('errors.serverStatus', { status: ServerResponse.statusCode })));
                return;
            }

            const TotalBytes = parseInt(ServerResponse.headers['content-length'], 10) || 0;
            let StartTime = Date.now();

            WatchdogTimer = setInterval(() => {
                if (DownloadedBytes === LastDownloadedBytes) {
                    clearInterval(WatchdogTimer);
                    HttpRequest.destroy();
                    Reject(new Error(LocStr('errors.watchdogTimeout')));
                }
                LastDownloadedBytes = DownloadedBytes;
            }, 10000);

            ServerResponse.on('data', (DataChunk) => {
                DownloadedBytes += DataChunk.length;

                const Elapsed = (Date.now() - StartTime) / 1000;
                const Bps = DownloadedBytes / Elapsed;
                const RemainingBytes = TotalBytes - DownloadedBytes;
                const Eta = Bps > 0 ? Math.round(RemainingBytes / Bps) : 0;

                IpcEvent.sender.send('download-progress', {
                    downloadedBytes: DownloadedBytes,
                    totalBytes: TotalBytes,
                    eta: Eta,
                    speed: Math.round(Bps)
                });
            });

            ServerResponse.pipe(WriteStream);

            WriteStream.on('finish', async () => {
                clearInterval(WatchdogTimer);
                WriteStream.close();
                try {
                    const DownloadedHash = await ComputeSHA512(TempDownloadPath);

                    if (DownloadedHash.toLowerCase() !== SecureHash.toLowerCase()) {
                        await Fs.unlink(TempDownloadPath).catch(() => { });
                        Reject(new Error(LocStr('errors.securityFailed')));
                        return;
                    }

                    if (FsSync.existsSync(VersionsPath)) {
                        const OldFiles = FsSync.readdirSync(VersionsPath)
                            .filter(F => F.endsWith('.zip') && F.startsWith('liefOS-') && !F.includes(Version));
                        for (const OldFile of OldFiles) {
                            FsSync.unlinkSync(Path.join(VersionsPath, OldFile));
                        }
                    }

                    await Fs.copyFile(TempDownloadPath, VersionZipPath);

                    await Fs.unlink(TempDownloadPath).catch(() => { });

                    Resolve({ verified: true, version: Version });
                } catch (Err) {
                    await Fs.unlink(TempDownloadPath).catch(() => { });
                    Reject(Err);
                }
            });
        });

        HttpRequest.on('error', (Err) => {
            clearInterval(WatchdogTimer);
            WriteStream.close();
            Fs.unlink(TempDownloadPath).catch(() => { });
            Reject(Err);
        });

        DownloadRequest = HttpRequest;
    });
});

IpcMain.handle('boot-process', async (IpcEvent, Version) => {
    try {
        const SendProgress = (Status, Progress) => {
            IpcEvent.sender.send('boot-progress', { status: Status, progress: Progress });
        };

        const VersionZipPath = Path.join(VersionsPath, `liefOS-${Version}.zip`);

        SendProgress(LocStr('status.checkingVersionBoot'), 10);
        if (!FsSync.existsSync(VersionZipPath)) {
            return { error: LocStr('errors.versionNotFound', { version: Version }) };
        }

        SendProgress(LocStr('status.checkingHash'), 30);
        let VersionData;
        try {
            const Response = await fetch('https://web-liefos.netlify.app/version.json');
            if (!Response.ok) return { error: LocStr('errors.fetchFailedHttp', { status: Response.status }) };
            VersionData = await Response.json();
            if (!VersionData.SecureHash) return { error: LocStr('errors.missingHash') };
        } catch (Err) {
            return { error: LocStr('errors.fetchFailed', { message: Err.message }) };
        }

        SendProgress(LocStr('status.verifyingIntegrity'), 60);
        const LocalHash = await ComputeSHA512(VersionZipPath);
        if (LocalHash.toLowerCase() !== VersionData.SecureHash.toLowerCase()) {
            return { error: LocStr('errors.integrityFailed') };
        }

        SendProgress(LocStr('status.unzipping'), 80);
        await Fs.rm(OsTempDir, { recursive: true, force: true }).catch(() => { });
        await Fs.mkdir(OsTempDir, { recursive: true });
        await ExtractZip(VersionZipPath, OsTempDir);

        SendProgress(LocStr('status.loading'), 95);
        const TempIndexPath = Path.join(OsTempDir, 'liefOS', 'System', 'index.html');
        if (!FsSync.existsSync(TempIndexPath)) {
            return { error: LocStr('errors.invalidStructure') };
        }

        return { success: true, path: TempIndexPath };
    } catch (Err) {
        return { error: Err.message || LocStr('errors.bootFailed') };
    }
});

IpcMain.handle('list-versions', async () => {
    if (!FsSync.existsSync(VersionsPath)) return [];

    const VersionRegex = /^liefOS-(\d+)\.(\d+)\.(\d+)\.zip$/;
    const Files = FsSync.readdirSync(VersionsPath).filter(F => VersionRegex.test(F));

    const VersionInfo = Files.map(FileEntry => {
        const Version = FileEntry.replace('liefOS-', '').replace('.zip', '');
        const VersionPath = Path.join(VersionsPath, FileEntry);
        const Stats = FsSync.statSync(VersionPath);
        const Size = Stats.size;

        return {
            version: Version,
            installedDate: Stats.mtime.toISOString(),
            sizeBytes: Size,
            sizeReadable: FormatBytes(Size)
        };
    });

    return VersionInfo.sort((A, B) => new Date(B.installedDate) - new Date(A.installedDate));
});

IpcMain.handle('delete-version', async (IpcEvent, Version) => {
    const VersionZipPath = Path.join(VersionsPath, `liefOS-${Version}.zip`);

    if (FsSync.existsSync(VersionZipPath)) {
        try {
            FsSync.unlinkSync(VersionZipPath);
            return { success: true };
        } catch (Err) {
            return { success: false, error: Err.message };
        }
    }
    return { success: false, error: LocStr('errors.versionNotFoundSimple') };
});

IpcMain.handle('cleanup-temp-versions', async () => {
    try {
        if (!FsSync.existsSync(OsTempDir)) {
            return { cleaned: 0 };
        }

        const Entries = await Fs.readdir(OsTempDir);
        await Fs.rm(OsTempDir, { recursive: true, force: true });

        return { cleaned: Entries.length };
    } catch (ErrorObj) {
        return { cleaned: 0, error: ErrorObj.message };
    }
});

function FormatBytes(Bytes) {
    if (Bytes === 0) return LocStr('format.zeroBytes');
    const K = 1024;
    const Sizes = ['bytes', 'kb', 'mb', 'gb'];
    const I = Math.floor(Math.log(Bytes) / Math.log(K));
    return Math.round((Bytes / Math.pow(K, I)) * 100) / 100 + ' ' + LocStr('format.' + Sizes[I]);
}

IpcMain.handle('clear-system-data', async () => {
    try {
        if (MainWindow) {
            const Session = MainWindow.webContents.session;
            await Session.clearStorageData({
                storages: ['localstorage', 'indexeddb', 'websql', 'cookies', 'filesystem']
            });
            return { success: true };
        }
        return { success: false, error: LocStr('errors.noWindow') };
    } catch (Err) {
        return { success: false, error: Err.message };
    }
});

IpcMain.handle('get-locale', () => {
    return Locale;
});

IpcMain.handle('get-local-client-version', () => {
    return ClientVersionInfo.ClientVersion;
});

IpcMain.on('open-update-url', () => {
    Shell.openExternal('https://liefos.netlify.app/install');
});

IpcMain.on('app-launched', (IpcEvent, AppID, AppName) => {
    if (MainWindow) MainWindow.setTitle('liefOS - ' + (AppName || AppID));
});

IpcMain.on('app-terminated', () => {
    if (MainWindow) MainWindow.setTitle('liefOS');
});

IpcMain.handle('get-app-path', () => {
    return __dirname;
});

IpcMain.on('open-external', (IpcEvent, URL) => {
    if (URL) Shell.openExternal(URL);
});

IpcMain.handle('get-client-info', () => {
    return {
        clientVersion: ClientVersionInfo.ClientVersion,
        platform: process.platform,
        electronVersion: process.versions.electron,
        chromiumVersion: process.versions.chrome
    };
});

IpcMain.handle('get-system-info', async () => {
    const Cpus = Os.cpus();
    const PrimaryDisplay = Screen.getPrimaryDisplay();
    const AllDisplays = Screen.getAllDisplays();

    let GpuInfo;
    try {
        GpuInfo = await App.getGPUInfo('basic');
    } catch (_) {
        GpuInfo = null;
    }

    return {
        os: {
            platform: Os.platform(),
            release: Os.release(),
            arch: Os.arch(),
            type: Os.type(),
            hostname: Os.hostname()
        },
        ram: {
            total: Os.totalmem(),
            totalReadable: FormatBytes(Os.totalmem()),
            free: Os.freemem(),
            freeReadable: FormatBytes(Os.freemem())
        },
        gpu: GpuInfo,
        cpu: {
            model: Cpus.length > 0 ? Cpus[0].model : 'unknown',
            speed: Cpus.length > 0 ? Cpus[0].speed : 0,
            cores: Cpus.length,
            architecture: Os.arch()
        },
        screen: {
            primary: {
                width: PrimaryDisplay.size.width,
                height: PrimaryDisplay.size.height,
                scaleFactor: PrimaryDisplay.scaleFactor
            },
            all: AllDisplays.map(D => ({
                width: D.size.width,
                height: D.size.height,
                scaleFactor: D.scaleFactor
            }))
        }
    };
});

IpcMain.handle('get-memory-usage', () => {
    const Usage = process.memoryUsage();
    CachedMemoryUsage = {
        rss: FormatBytes(Usage.rss),
        heapTotal: FormatBytes(Usage.heapTotal),
        heapUsed: FormatBytes(Usage.heapUsed),
        external: FormatBytes(Usage.external)
    };
    return CachedMemoryUsage;
});