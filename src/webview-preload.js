// TicketVault: Webview preload bridge.
//
// This script runs INSIDE every embedded marketplace webview (Stubhub, Viagogo,
// SalesPro) before the page's own scripts. It captures Ctrl+wheel and the
// Ctrl+/− /Ctrl+0 keyboard shortcuts and forwards them to the host renderer
// via ipcRenderer.sendToHost('zoom', delta) — the host then calls
// webview.setZoomFactor() to apply the change.
//
// Why a preload script? Wheel and keyboard events fired inside a <webview>
// tag don't bubble up to the host page (they're in a different process).
// The only clean way to bridge them is a preload that has access to
// ipcRenderer.sendToHost, which we then listen for via 'ipc-message' on
// the webview element.
//
// Security: this preload contains no privileged operations (no fs, no shell,
// no network). It only captures user input and forwards a number/'reset'
// signal. Even if a marketplace page is compromised, the worst it can do is
// trigger zoom changes on itself.

const { ipcRenderer } = require('electron');

(function installZoomBridge() {
  // Guard against double-install (some pages reload subframes).
  if (window.__tvZoomBridgeInstalled) return;
  window.__tvZoomBridgeInstalled = true;

  // Ctrl/Cmd + mouse wheel → zoom step. capture:true + passive:false so we
  // can preventDefault before the page's own scroll handler fires.
  window.addEventListener('wheel', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    e.stopPropagation();
    // deltaY < 0 means scrolling up = zoom IN. Convert to ±1 step.
    ipcRenderer.sendToHost('zoom', e.deltaY < 0 ? 1 : -1);
  }, { passive: false, capture: true });

  // Ctrl/Cmd + (=, +, -, _, 0) → zoom shortcuts (matching browser conventions).
  window.addEventListener('keydown', function (e) {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      ipcRenderer.sendToHost('zoom', 1);
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      ipcRenderer.sendToHost('zoom', -1);
    } else if (e.key === '0') {
      e.preventDefault();
      ipcRenderer.sendToHost('zoom', 'reset');
    }
  }, true);
})();
