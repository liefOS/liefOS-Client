let Locale = {};

function LocStr(Key, Params = {}) {
    let Str = Key.split('.').reduce((O, K) => O?.[K], Locale);
    if (Str === undefined) return Key;
    for (const [K, V] of Object.entries(Params)) {
        Str = Str.replace(new RegExp(`\\{${K}\\}`, 'g'), V);
    }
    return Str;
}

let DownloadCancelled = false;
let BootHasErrored = false;
let IsDownloading = false;
let IsBooting = false;
let ClientUpdateRequired = false;
let BootPhase = 'normal';

function ShowStatus(Text) {
    const El = document.getElementById('ClientStatus');
    El.textContent = Text;
    El.style.display = Text ? 'block' : 'none';
}

function ShowButtons(ShowAction, ShowShutdown, ShowRestart) {
    document.getElementById('ActionButton').style.display = ShowAction ? 'inline-block' : 'none';
    document.getElementById('ShutdownButton').style.display = ShowShutdown ? 'inline-block' : 'none';
    document.getElementById('RestartButton').style.display = ShowRestart ? 'inline-block' : 'none';
    document.getElementById('Buttons').style.display = (ShowAction || ShowShutdown || ShowRestart) ? 'flex' : 'none';
}

function ShowProgress(Show) {
    document.getElementById('ClientProgress').style.display = Show ? 'block' : 'none';
}

function ShowActionPrompt(Message, ActionLabel) {
    ShowStatus(Message);
    document.getElementById('ActionButton').textContent = ActionLabel;
    ShowButtons(true, true, false);
    ShowProgress(false);
    document.getElementById('CancelButton').style.display = 'none';
}

function UpdateBootProgress(ClientStatus, Progress) {
    document.getElementById('ProgressBarState').style.width = `${Progress}%`;
    document.getElementById('ProgressBarStatus').textContent = ClientStatus;
    document.getElementById('CancelButton').style.display = 'none';
    document.getElementById('ClientProgress').style.display = 'block';
    document.getElementById('ClientStatus').style.display = 'none';
}

function FormatSpeed(BytesPerSec) {
    if (BytesPerSec >= 1048576) {
        return LocStr('format.speedMB', { value: (BytesPerSec / 1048576).toFixed(1) });
    }
    if (BytesPerSec >= 1024) {
        return LocStr('format.speedKB', { value: (BytesPerSec / 1024).toFixed(1) });
    }
    return LocStr('format.speedB', { value: BytesPerSec });
}

function ParseVersion(Str) {
    const Parts = Str.split('.');
    if (Parts.length !== 3) return null;
    const Major = parseInt(Parts[0], 10);
    const Minor = parseInt(Parts[1], 10);
    const Patch = parseInt(Parts[2], 10);
    if (isNaN(Major) || isNaN(Minor) || isNaN(Patch)) return null;
    return { major: Major, minor: Minor, patch: Patch };
}

function CompareVersions(A, B) {
    const Va = ParseVersion(A);
    const Vb = ParseVersion(B);
    if (!Va || !Vb) return 'invalid';
    if (Va.major > Vb.major) return 'newer';
    if (Va.major < Vb.major) return 'older';
    if (Va.minor > Vb.minor) return 'newer';
    if (Va.minor < Vb.minor) return 'older';
    if (Va.patch > Vb.patch) return 'newer';
    if (Va.patch < Vb.patch) return 'older';
    return 'same';
}

document.getElementById('CancelButton').addEventListener('click', () => {
    DownloadCancelled = true;
    window.liefOSAPI.CancelDownload();
    window.liefOSAPI.QuitApp();
});

document.getElementById('ActionButton').addEventListener('click', () => {
    if (BootPhase === 'improper-shutdown') {
        BootPhase = 'normal';
        ShowButtons(false, false, false);
        CheckVersionAndBoot();
        return;
    }
    if (ClientUpdateRequired) {
        window.liefOSAPI.OpenUpdateUrl();
        return;
    }
    window.liefOSAPI.DeleteAllVersions().then(() => StartDownload());
});

document.getElementById('ShutdownButton').addEventListener('click', () => {
    window.liefOSAPI.QuitApp();
});

document.getElementById('RestartButton').addEventListener('click', () => {
    window.liefOSAPI.RebootApp();
});

window.liefOSAPI.OnLaunchError((Message) => {
    BootHasErrored = true;
    ShowError(Message);
});

window.liefOSAPI.OnBootProgress((Data) => {
    UpdateBootProgress(Data.status, Data.progress);
});

window.liefOSAPI.OnDownloadProgress((IpcEvent, ProgressData) => {
    if (DownloadCancelled) return;
    const { downloadedBytes: DownloadedBytes, totalBytes: TotalBytes, speed: Speed } = ProgressData;
    const Percent = TotalBytes > 0 ? (DownloadedBytes / TotalBytes) * 100 : 0;
    document.getElementById('ProgressBarState').style.width = `${Percent}%`;

    const DlMB = (DownloadedBytes / 1048576).toFixed(1);
    const TotalMB = (TotalBytes / 1048576).toFixed(1);
    const SpeedStr = FormatSpeed(Speed || 0);
    document.getElementById('ProgressBarStatus').textContent = LocStr('download.progressFormat', { downloaded: DlMB, total: TotalMB, speed: SpeedStr });
    document.getElementById('CancelButton').style.display = 'inline-block';
});

function ShowError(Message) {
    ShowProgress(false);
    ShowStatus(Message);
    ShowButtons(true, true, true);
    document.getElementById('ActionButton').textContent = LocStr('buttons.reinstall');
    document.getElementById('CancelButton').style.display = 'none';
}

function ShowClientUpdateRequired(LatestVersion) {
    ClientUpdateRequired = true;
    ShowProgress(false);
    if (LatestVersion === 'unknown') {
        ShowButtons(false, true, true);
        ShowStatus(LocStr('clientUpdate.failed'));
    } else {
        document.getElementById('ActionButton').textContent = LocStr('clientUpdate.downloadButton');
        ShowStatus(LocStr('clientUpdate.message', { version: LatestVersion }));
        ShowButtons(true, true, false);
    }
    document.getElementById('CancelButton').style.display = 'none';
}

function StartBootProcess(Version) {
    IsBooting = true;
    ShowProgress(true);
    ShowButtons(false, false, false);

    let Fallback = setTimeout(() => {
        if (BootHasErrored) return;
        IsBooting = false;
        ShowError(LocStr('errors.genericRestart'));
    }, 25000);

    window.liefOSAPI.BootProcess(Version)
        .then((Result) => {
            IsBooting = false;
            clearTimeout(Fallback);
            if (Result && Result.error) {
                BootHasErrored = true;
                ShowError(Result.error);
            } else if (Result && Result.path) {
                document.body.classList.add('fading-out');
                setTimeout(function() {
                    window.liefOSAPI.NavigateView(Result.path);
                }, 350);
            }
        })
        .catch((Err) => {
            IsBooting = false;
            clearTimeout(Fallback);
            BootHasErrored = true;
            ShowError(Err.message || LocStr('errors.bootFailed'));
        });
}

function StartDownload() {
    DownloadCancelled = false;
    IsDownloading = true;
    ShowProgress(true);
    ShowButtons(false, false, false);
    document.getElementById('CancelButton').style.display = 'inline-block';
    ShowStatus('');

    window.liefOSAPI.DownloadAndExtract()
        .then((Result) => {
            IsDownloading = false;
            ShowProgress(false);
            document.getElementById('CancelButton').style.display = 'none';
            StartBootProcess(Result.version);
        })
        .catch((Err) => {
            IsDownloading = false;
            if (DownloadCancelled) return;
            document.getElementById('CancelButton').style.display = 'none';
            ShowError(LocStr('errors.genericRestart'));
        });
}

async function Init() {
    try {
        Locale = await window.liefOSAPI.GetLocale();
    } catch (_) { }

    document.title = LocStr('app.name');
    document.querySelector('.liefOSLogo').alt = LocStr('app.name');
    document.getElementById('CopyrightText').textContent = LocStr('app.copyright');
    document.getElementById('CancelButton').textContent = LocStr('buttons.cancel');
    document.getElementById('ActionButton').textContent = LocStr('buttons.install');
    document.getElementById('ShutdownButton').textContent = LocStr('buttons.shutDown');
    document.getElementById('RestartButton').textContent = LocStr('buttons.restart');

    try {
        var Improper = await window.liefOSAPI.GetImproperShutdown();
        if (Improper) {
            ShowImproperShutdownPrompt();
            return;
        }
    } catch (_) {}

    CheckVersionAndBoot();
}

function ShowImproperShutdownPrompt() {
    BootPhase = 'improper-shutdown';
    ShowProgress(false);
    document.getElementById('ClientStatus').innerHTML = '<strong>' + LocStr('improperShutdown.title') + '</strong><br><span style="font-size:14px;opacity:0.7">' + LocStr('improperShutdown.subtitle') + '</span>';
    document.getElementById('ClientStatus').style.display = 'block';
    document.getElementById('CancelButton').style.display = 'none';
    document.getElementById('ActionButton').textContent = LocStr('improperShutdown.continue');
    ShowButtons(true, true, false);
}

async function CheckVersionAndBoot() {
    try {
        const IsDevMode = await window.liefOSAPI.GetDevMode();
        if (IsDevMode) {
            document.getElementById('DeveloperIndicator').classList.add('active');
        }

        UpdateBootProgress(LocStr('status.fetchingInfo'), 10);

        const Controller = new AbortController();
        const Timeout = setTimeout(() => Controller.abort(), 8000);
        const Res = await fetch('https://web-liefos.netlify.app/version.json', { signal: Controller.signal });
        clearTimeout(Timeout);
        if (!Res.ok) throw new Error('HTTP ' + Res.status);
        const VersionData = await Res.json();
        if (!VersionData.Version || !VersionData.SecureHash) throw new Error('Invalid version data from server');

        const LocalClientVersion = await window.liefOSAPI.FetchLocalClientVersion();
        if (!VersionData.LatestClient || VersionData.LatestClient !== LocalClientVersion) {
            ShowClientUpdateRequired(VersionData.LatestClient || LocStr('clientUpdate.unknownVersion'));
            return;
        }

        UpdateBootProgress(LocStr('status.checkingVersion'), 30);
        const LocalInfo = await window.liefOSAPI.GetLocalVersion();

        if (IsDevMode) {
            document.getElementById('DevelopmentVersionInfo').textContent =
                LocStr('dev.versionInfo', { latest: VersionData.Version, local: LocalInfo.version || LocStr('status.notInstalled') });
        }

        if (!LocalInfo.version) {
            if (LocalInfo.hasAnyFiles) {
                ShowActionPrompt(LocStr('prompts.noValidInstall', { version: VersionData.Version }), LocStr('buttons.installVersion', { version: VersionData.Version }));
            } else {
                ShowActionPrompt(LocStr('prompts.installPrompt', { version: VersionData.Version }), LocStr('buttons.installVersion', { version: VersionData.Version }));
            }
        } else {
            const Cmp = CompareVersions(LocalInfo.version, VersionData.Version);
            if (Cmp === 'same') {
                StartBootProcess(VersionData.Version);
            } else if (Cmp === 'older') {
                ShowActionPrompt(LocStr('prompts.updatePrompt', { version: VersionData.Version }), LocStr('buttons.updateTo', { version: VersionData.Version }));
            } else {
                ShowActionPrompt(LocStr('prompts.corruptedPrompt'), LocStr('buttons.installLatest'));
            }
        }
    } catch (Err) {
        ShowClientUpdateRequired(LocStr('clientUpdate.unknownVersion'));
    }
}

Init();
