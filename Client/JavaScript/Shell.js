var BootCSS = [
    '* { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }',
    'body { -webkit-app-region: no-drag; }',
    'body::before {',
    '  content: \'\';',
    '  position: fixed;',
    '  top: 0; left: 0; right: 0;',
    '  height: 28px;',
    '  -webkit-app-region: drag;',
    '  z-index: 2147483648;',
    '}'
].join('\n');

var BootJS = [
    '(function() {',
    '  var E = document.createElement(\'div\');',
    '  E.id = \'liefos-bezel\';',
    '  E.style.cssText = \'position:fixed;inset:0;border:10px solid #000;border-radius:54px;pointer-events:none;z-index:2147483647;\';',
    '  document.body.appendChild(E);',
    '})();'
].join('\n');

var PendingScale = false;

function UpdateScale() {
    if (PendingScale) return;
    PendingScale = true;
    requestAnimationFrame(function() {
        PendingScale = false;
        var Scaler = document.getElementById('app-scaler');
        if (!Scaler) return;
        var S = window.innerWidth / 390;
        Scaler.style.transform = 'scale(' + S + ')';
    });
}

window.addEventListener('resize', UpdateScale);
UpdateScale();

var PendingInject = false;
var Webview = null;

function NavigateWebView(Path, Inject) {
    if (!Webview) return;
    PendingInject = Inject;
    Webview.src = 'file://' + Path;
}

document.addEventListener('DOMContentLoaded', async function() {
    try {
        Webview = document.getElementById('content-view');

        Webview.addEventListener('did-finish-load', function() {
            if (PendingInject) {
                PendingInject = false;
                Webview.insertCSS(BootCSS);
                Webview.executeJavaScript(BootJS);
            }
        });

        var AppPath = await window.liefOSAPI.GetAppPath();
        Webview.preload = 'file://' + AppPath + '/Client/JavaScript/liefOSAPI.js';
        Webview.src = 'launcher.html';
    } catch (E) {
        console.error('Shell init error:', E);
    }
});
