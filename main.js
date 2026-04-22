const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const { autoUpdater } = require('electron-updater');

// ============ AUTO-UPDATER ============
// electron-updater checks the GitHub Releases of this repo for a newer version
// than the one currently running. When found, it downloads the installer in
// the background and prompts the user to restart & install when ready.
//
// The release config (repo owner + name) lives in package.json under
// build.publish. GitHub Releases must expose the installer artifacts — our
// .github/workflows/release.yml handles that automatically when we push a
// tag like v1.0.1.
//
// On first run (or dev mode) the updater is a no-op. If the network is down
// or GitHub rate-limits us, we just log the error and continue normally.

// Let electron-updater use its own logger; we pipe the important events to
// the renderer so users see what's happening.
autoUpdater.autoDownload = true;              // download silently in background
autoUpdater.autoInstallOnAppQuit = false;     // we explicitly prompt before installing

// Wire the updater lifecycle events to the renderer via IPC so the UI can
// show toasts / progress / restart prompts. Each event just forwards a
// simple payload — the renderer handles all presentation.
function wireAutoUpdaterEvents(getWindow) {
  autoUpdater.on('checking-for-update', () => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', { type: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', {
      type: 'available',
      version: info.version,
      releaseNotes: info.releaseNotes || ''
    });
  });

  autoUpdater.on('update-not-available', () => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', { type: 'not-available' });
  });

  autoUpdater.on('download-progress', (progress) => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', {
      type: 'progress',
      percent: Math.round(progress.percent || 0),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', {
      type: 'downloaded',
      version: info.version
    });
  });

  autoUpdater.on('error', (err) => {
    const w = getWindow();
    if (w) w.webContents.send('updater:event', {
      type: 'error',
      message: err?.message || String(err)
    });
    console.error('[auto-updater]', err);
  });
}

// ============ USERS (multi-tenant, backend-based) ============
// Users and per-user data buckets now live on the cloud backend. This module
// is a thin proxy that forwards auth requests to the configured API URL. The
// successful login token is stored in config.cloud.apiKey and used as the
// Bearer token for ALL subsequent cloud API calls — both auth and data.
//
// Why here and not directly from the renderer? We already route all cloud
// traffic through main.js (for the API key header injection and for offline
// caching). Proxying auth the same way keeps credentials out of the renderer
// process and lets us reuse the existing cloudFetch plumbing.

// Helper: make a raw fetch to the configured backend without requiring a token
// (for login/register/recover where the user hasn't got one yet). Uses the URL
// saved in config but lets callers override it (e.g. first-run, where user may
// type a different URL). Returns parsed JSON on success or throws with .status.
async function authFetch(endpoint, body, overrideApiUrl = null) {
  const config = loadConfig();
  const apiUrl = (overrideApiUrl || (config.cloud && config.cloud.apiUrl) || '').replace(/\/$/, '');
  if (!apiUrl) {
    throw new Error('Backend URL není nastavena. Zadej ji na přihlašovací obrazovce.');
  }
  const res = await fetch(apiUrl + endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const data = await res.json().catch(() => ({ error: 'Neplatná odpověď serveru.' }));
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

// Helper: fetch with the stored token as Bearer. Used by all post-login calls.
async function authFetchWithToken(endpoint, { method = 'GET', body = null } = {}) {
  const config = loadConfig();
  const apiUrl = (config.cloud && config.cloud.apiUrl || '').replace(/\/$/, '');
  const token = config.cloud && config.cloud.apiKey;
  if (!apiUrl) throw new Error('Backend URL není nastavena.');
  if (!token) throw new Error('Nejsi přihlášen.');
  const res = await fetch(apiUrl + endpoint, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({ error: 'Neplatná odpověď serveru.' }));
  if (!res.ok) {
    const err = new Error(data.error || ('HTTP ' + res.status));
    err.status = res.status;
    throw err;
  }
  return data;
}

// Persist the token returned by login/register into cloud config so the rest
// of the app (existing cloud sync) picks it up as the Bearer credential.
// Also caches the public user info so offline startups can skip re-verify.
function persistAuthToken(token, apiUrl, user = null) {
  const config = loadConfig();
  if (!config.cloud) config.cloud = { enabled: true };
  config.cloud.enabled = true;
  config.cloud.apiKey = token;
  if (apiUrl) config.cloud.apiUrl = apiUrl.replace(/\/$/, '');
  // Cache public user info (id/username/role only — never hashes) so we can
  // let the user into the app offline without re-verifying via /auth/me.
  if (user) {
    config.cloud.cachedUser = {
      id: user.id,
      username: user.username,
      role: user.role
    };
  }
  saveConfig(config);
}

function clearAuthToken() {
  const config = loadConfig();
  if (config.cloud) {
    config.cloud.apiKey = '';
    config.cloud.cachedUser = null;
  }
  saveConfig(config);
}

// ============ CONFIG MANAGEMENT ============
const configPath = path.join(app.getPath('userData'), 'config.json');

function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      // Backwards-compat: ensure alerts structure exists
      if (!cfg.alerts) {
        cfg.alerts = {
          animations: true,
          startupToast: true,
          unsoldDays: 7,
          undeliveredDays: 5,
          mutedTicketIds: []
        };
      } else {
        if (cfg.alerts.animations === undefined) cfg.alerts.animations = true;
        if (cfg.alerts.startupToast === undefined) cfg.alerts.startupToast = true;
        if (cfg.alerts.unsoldDays === undefined) cfg.alerts.unsoldDays = 7;
        if (cfg.alerts.undeliveredDays === undefined) cfg.alerts.undeliveredDays = 5;
        if (!Array.isArray(cfg.alerts.mutedTicketIds)) cfg.alerts.mutedTicketIds = [];
      }
      return cfg;
    }
  } catch (e) {
    console.error('Config load error:', e);
  }
  // Default config
  return {
    dbPath: path.join(app.getPath('userData'), 'ticketvault-db.json'),
    currency: 'EUR',
    firstRun: true,
    cloud: {
      enabled: false,
      apiUrl: '',
      apiKey: '',
      lastSync: null
    },
    alerts: {
      animations: true,          // Puls / bliknutí
      startupToast: true,        // Souhrnné toasty při spuštění
      unsoldDays: 7,             // Neprodané - kolik dní před eventem varovat
      undeliveredDays: 5,        // Neodeslané (sold) - kolik dní před eventem varovat
      mutedTicketIds: []         // Vstupenky, které uživatel ztlumil manuálně
    }
  };
}

function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    return true;
  } catch (e) {
    console.error('Config save error:', e);
    return false;
  }
}

// ============ DATABASE MANAGEMENT ============
function getDefaultDb() {
  return {
    version: 1,
    created: new Date().toISOString(),
    tickets: [],
    accounts: [],
    events: [],
    memberships: [],
    expenses: [],
    payoutRules: [
      { platform: 'Viagogo', baseDate: 'eventDate', offsetDays: 8 },
      { platform: 'Stubhub', baseDate: 'deliveryDate', offsetDays: 3 },
      { platform: 'TicketMaster', baseDate: 'eventDate', offsetDays: 7 }
    ],
    inbox: [],
    // Users are stored in the DB so they sync via the same cloud mechanism
    // as the rest of the data. This means logins work from any device once
    // the user has been created on any one device and the cloud has synced.
    users: []
  };
}

function loadDb() {
  const config = loadConfig();
  try {
    if (fs.existsSync(config.dbPath)) {
      const data = JSON.parse(fs.readFileSync(config.dbPath, 'utf-8'));
      // Ensure schema
      if (!data.tickets) data.tickets = [];
      if (!data.accounts) data.accounts = [];
      if (!data.events) data.events = [];
      if (!data.memberships) data.memberships = [];
      if (!data.expenses) data.expenses = [];
      if (!data.inbox) data.inbox = [];
      if (!Array.isArray(data.users)) data.users = [];
      if (!data.payoutRules || !Array.isArray(data.payoutRules) || data.payoutRules.length === 0) {
        data.payoutRules = [
          { platform: 'Viagogo', baseDate: 'eventDate', offsetDays: 8 },
          { platform: 'Stubhub', baseDate: 'deliveryDate', offsetDays: 3 },
          { platform: 'TicketMaster', baseDate: 'eventDate', offsetDays: 7 }
        ];
      } else {
        // Deduplicate rules by platform name (case-insensitive)
        // This cleans up legacy databases that might have "Stubhub" and "StubHub" as duplicates
        const seen = new Set();
        data.payoutRules = data.payoutRules.filter(r => {
          if (!r || !r.platform) return false;
          const key = r.platform.toLowerCase().trim();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      return data;
    }
  } catch (e) {
    console.error('DB load error:', e);
  }
  const defaultDb = getDefaultDb();
  saveDb(defaultDb);
  return defaultDb;
}

function saveDb(db) {
  const config = loadConfig();
  try {
    // Ensure directory exists
    const dir = path.dirname(config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Create backup before save
    if (fs.existsSync(config.dbPath)) {
      const backupPath = config.dbPath + '.backup';
      fs.copyFileSync(config.dbPath, backupPath);
    }
    db.lastModified = new Date().toISOString();
    fs.writeFileSync(config.dbPath, JSON.stringify(db, null, 2));
    return true;
  } catch (e) {
    console.error('DB save error:', e);
    return false;
  }
}

// ============ CLOUD SYNC ============
function getCloudConfig() {
  const config = loadConfig();
  const cloud = config.cloud || {};
  if (!cloud.enabled || !cloud.apiUrl || !cloud.apiKey) return null;
  return cloud;
}

function buildCloudUrl(apiUrl, endpoint) {
  const base = apiUrl.replace(/\/$/, '');
  return base + endpoint;
}

async function cloudFetch(endpoint, options = {}) {
  const cloud = getCloudConfig();
  if (!cloud) throw new Error('Cloud not configured');
  
  const url = buildCloudUrl(cloud.apiUrl, endpoint);
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${cloud.apiKey}`,
    ...(options.headers || {})
  };
  
  // Timeout 15s
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  
  try {
    const res = await fetch(url, { ...options, headers, signal: controller.signal });
    clearTimeout(timeout);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error('Timeout - server neodpovídá');
    throw e;
  }
}

async function cloudTestConnection(apiUrl, apiKey) {
  const base = apiUrl.replace(/\/$/, '');
  try {
    // First test ping (no auth)
    const pingRes = await fetch(base + '/ping', { 
      signal: AbortSignal.timeout(10000) 
    });
    if (!pingRes.ok) throw new Error('Server neodpověděl správně');
    const ping = await pingRes.json();
    if (!ping.ok) throw new Error('Backend nefunguje');
    if (!ping.hasApiKey) throw new Error('Server nemá nastavený API_KEY env variable');
    
    // Test authenticated endpoint
    const dbRes = await fetch(base + '/db', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000)
    });
    if (dbRes.status === 401) throw new Error('Neplatný API klíč');
    if (!dbRes.ok) {
      const err = await dbRes.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${dbRes.status}`);
    }
    const db = await dbRes.json();
    return { success: true, tickets: (db.tickets || []).length, lastModified: db.lastModified };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function cloudPullDb() {
  const data = await cloudFetch('/db', { method: 'GET' });
  if (!data.tickets) data.tickets = [];
  return data;
}

async function cloudPushDb(db) {
  return await cloudFetch('/db', {
    method: 'PUT',
    body: JSON.stringify(db)
  });
}

async function cloudUpsertTicket(ticket) {
  return await cloudFetch('/ticket', {
    method: 'POST',
    body: JSON.stringify(ticket)
  });
}

async function cloudDeleteTicket(id) {
  return await cloudFetch('/ticket/' + encodeURIComponent(id), {
    method: 'DELETE'
  });
}

async function cloudBulkDelete(ids) {
  return await cloudFetch('/tickets/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });
}

// ============ WINDOW CREATION ============
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    backgroundColor: '#0f0f14',
    title: 'TicketVault',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    show: false
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Dev tools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Menu
  const menuTemplate = [
    {
      label: 'Soubor',
      submenu: [
        {
          label: 'Export databáze (JSON)',
          accelerator: 'CmdOrCtrl+E',
          click: () => mainWindow.webContents.send('menu:export-db')
        },
        {
          label: 'Import databáze (JSON)',
          accelerator: 'CmdOrCtrl+I',
          click: () => mainWindow.webContents.send('menu:import-db')
        },
        { type: 'separator' },
        {
          label: 'Nastavení',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow.webContents.send('menu:settings')
        },
        { type: 'separator' },
        { role: 'quit', label: 'Ukončit' }
      ]
    },
    {
      label: 'Úpravy',
      submenu: [
        { role: 'undo', label: 'Zpět' },
        { role: 'redo', label: 'Znovu' },
        { type: 'separator' },
        { role: 'cut', label: 'Vyjmout' },
        { role: 'copy', label: 'Kopírovat' },
        { role: 'paste', label: 'Vložit' },
        { role: 'selectAll', label: 'Vybrat vše' }
      ]
    },
    {
      label: 'Zobrazení',
      submenu: [
        { role: 'reload', label: 'Obnovit' },
        { role: 'toggleDevTools', label: 'Vývojářské nástroje' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Reset zoom' },
        { role: 'zoomIn', label: 'Přiblížit' },
        { role: 'zoomOut', label: 'Oddálit' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Celá obrazovka' }
      ]
    },
    {
      label: 'Nápověda',
      submenu: [
        {
          label: 'O aplikaci',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'O aplikaci',
              message: 'TicketVault',
              detail: 'Verze 1.0.0\n\nSpráva inventáře vstupenek pro přeprodej.\n\nPro sdílení databáze s kamarádem nastav cestu k databázi do sdílené složky (OneDrive, Dropbox, Google Drive).'
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));
}

app.whenReady().then(() => {
  createWindow();

  // Wire updater events to the current window (window may be recreated, so
  // we pass a getter rather than a static reference).
  wireAutoUpdaterEvents(() => mainWindow);

  // Kick off the update check ~3 seconds after window is ready so the app
  // has time to fully render before we show any "checking for update" UI.
  // Skipped during development (npm run dev) since dev doesn't have a valid
  // packaged version to compare against — it would always error out.
  if (app.isPackaged) {
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch((err) => {
        console.error('[auto-updater] initial check failed:', err?.message || err);
      });
    }, 3000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ============ IPC HANDLERS ============

// Auto-updater manual controls. Renderer calls these from the Settings page:
//   'updater:check'     — explicitly check for new version (also triggers on startup)
//   'updater:install'   — quit and run the downloaded installer
//   'updater:get-version' — current app version string (for display)
ipcMain.handle('updater:check', async () => {
  try {
    if (!app.isPackaged) {
      return { success: false, error: 'Auto-update funguje jen v nainstalované verzi (ne v dev).' };
    }
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo || null };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('updater:install', () => {
  // Quits the app immediately and runs the staged installer.
  // After install the app restarts automatically.
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

ipcMain.handle('updater:get-version', () => {
  return app.getVersion();
});

// Get config
ipcMain.handle('config:get', () => loadConfig());

// Update config
ipcMain.handle('config:set', (event, config) => {
  return saveConfig(config);
});

// ============ CURRENCY RATES ============
// Fetches latest EUR-based exchange rates from open.er-api.com (free tier,
// no API key required, 1000 requests/day — we use once per day per user).
// Returns a flat { CODE: rate } map plus _updated ISO timestamp, and persists
// it in config.exchangeRates so all renderer processes can read via config:get.
//
// We normalize on EUR as the base (rates[EUR] = 1, rates[USD] = 1.08, ...) so
// conversion through EUR works: amount_in_B = (amount_in_A / rateA) * rateB.
const SUPPORTED_CURRENCY_CODES = [
  'EUR', 'CZK', 'USD', 'GBP', 'CHF', 'PLN', 'HUF', 'SEK', 'NOK', 'DKK',
  'CAD', 'AUD', 'JPY', 'MXN', 'BRL', 'ZAR', 'AED', 'SGD', 'NZD', 'TRY'
];

async function fetchExchangeRatesFromApi() {
  // open.er-api.com is a public mirror of exchangerate-api.com's free tier.
  // Response shape: { result: "success", rates: { EUR: 1.0, USD: 1.08, ... }, time_last_update_utc: "..." }
  // Base currency is whatever we pass as the last path segment.
  const res = await fetch('https://open.er-api.com/v6/latest/EUR');
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from open.er-api.com`);
  }
  const data = await res.json();
  if (data.result !== 'success' || !data.rates) {
    throw new Error('API returned invalid response');
  }
  const rates = { _updated: new Date().toISOString() };
  for (const code of SUPPORTED_CURRENCY_CODES) {
    if (data.rates[code] !== undefined) {
      rates[code] = data.rates[code];
    }
  }
  // Sanity: EUR should always be 1.0 (base).
  rates.EUR = 1;
  return rates;
}

ipcMain.handle('currency:fetchRates', async () => {
  try {
    const rates = await fetchExchangeRatesFromApi();
    const config = loadConfig();
    config.exchangeRates = rates;
    saveConfig(config);
    const count = Object.keys(rates).filter(k => !k.startsWith('_')).length;
    return { success: true, count, rates };
  } catch (e) {
    console.error('currency:fetchRates failed:', e.message);
    return { success: false, error: e.message };
  }
});

// Auto-refresh on demand: called by renderer during init. Returns without
// doing anything if rates are fresh (<24h old) to avoid hammering the API.
ipcMain.handle('currency:autoRefreshIfStale', async () => {
  const config = loadConfig();
  const existing = config.exchangeRates;
  const updated = existing?._updated;
  if (updated) {
    const ageMs = Date.now() - new Date(updated).getTime();
    if (ageMs < 24 * 3600 * 1000) {
      return { success: true, skipped: true, reason: 'fresh' };
    }
  }
  try {
    const rates = await fetchExchangeRatesFromApi();
    config.exchangeRates = rates;
    saveConfig(config);
    return { success: true, skipped: false, rates };
  } catch (e) {
    // Non-fatal — app continues with whatever rates it has (or empty).
    console.error('auto-refresh rates failed:', e.message);
    return { success: false, error: e.message };
  }
});

// ============ AUTH IPC ============
// All handlers proxy to the backend. Tokens are stored in config.cloud.apiKey
// so the existing cloud sync works automatically with the authenticated user.

// Check current auth state. Returns:
//   - hasToken: whether we have a stored token in config
//   - me: the current user object (from backend /auth/me) if token is valid
//   - apiUrl: configured backend URL (for pre-filling login screen)
// This is what the renderer calls on startup to decide setup vs login vs go-to-app.
ipcMain.handle('auth:getState', async () => {
  const config = loadConfig();
  const apiUrl = (config.cloud && config.cloud.apiUrl) || '';
  const token = (config.cloud && config.cloud.apiKey) || '';
  const cachedUser = (config.cloud && config.cloud.cachedUser) || null;
  const state = {
    apiUrl,
    hasToken: !!token,
    me: null,
    offline: false,
    error: null
  };
  if (!token || !apiUrl) return state;
  // Verify the token is still valid by calling /auth/me.
  try {
    const data = await authFetchWithToken('/auth/me');
    state.me = data.user;
    // Refresh the cached user so next offline startup has up-to-date role/username.
    if (data.user) {
      config.cloud.cachedUser = {
        id: data.user.id,
        username: data.user.username,
        role: data.user.role
      };
      saveConfig(config);
    }
  } catch (e) {
    if (e.status === 401) {
      // Token definitively invalid (server said so) — clear and force login.
      clearAuthToken();
      state.hasToken = false;
    } else {
      // Network error / server unreachable. Accept the cached user so the
      // app opens in offline mode, continuing to work on the local DB cache.
      // Data writes will queue to push on next reconnect.
      state.error = e.message;
      state.offline = true;
      if (cachedUser) {
        state.me = cachedUser;
      }
    }
  }
  return state;
});

// Register new account. If apiUrl is provided, it overrides (and saves)
// the configured URL — useful on a fresh install where the URL isn't set yet.
ipcMain.handle('auth:register', async (event, { username, password, inviteCode, apiUrl }) => {
  try {
    const data = await authFetch('/auth/register',
      { username, password, inviteCode },
      apiUrl
    );
    persistAuthToken(data.token, apiUrl, data.user);
    return {
      success: true,
      user: data.user,
      recoveryCode: data.recoveryCode
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:login', async (event, { username, password, apiUrl }) => {
  try {
    const data = await authFetch('/auth/login', { username, password }, apiUrl);
    persistAuthToken(data.token, apiUrl, data.user);
    return {
      success: true,
      user: data.user
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:recover', async (event, { username, recoveryCode, newPassword, apiUrl }) => {
  try {
    const data = await authFetch('/auth/recover',
      { username, recoveryCode, newPassword },
      apiUrl
    );
    persistAuthToken(data.token, apiUrl, data.user);
    return {
      success: true,
      user: data.user,
      newRecoveryCode: data.newRecoveryCode
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  clearAuthToken();
  return { success: true };
});

ipcMain.handle('auth:changeOwnPassword', async (event, { oldPassword, newPassword }) => {
  try {
    await authFetchWithToken('/auth/change-password', {
      method: 'POST',
      body: { oldPassword, newPassword }
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:updateEmailSettings', async (event, { email, digestEnabled }) => {
  try {
    const data = await authFetchWithToken('/auth/email-settings', {
      method: 'POST',
      body: { email, digestEnabled }
    });
    return { success: true, email: data.email, digestEnabled: data.digestEnabled };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:getAllowedSenders', async () => {
  try {
    const data = await authFetchWithToken('/auth/allowed-senders');
    return { success: true, senders: data.senders || [] };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:addAllowedSender', async (event, { email }) => {
  try {
    const data = await authFetchWithToken('/auth/allowed-senders/add', {
      method: 'POST',
      body: { email }
    });
    return { success: true, senders: data.senders };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:removeAllowedSender', async (event, { email }) => {
  try {
    const data = await authFetchWithToken('/auth/allowed-senders/remove', {
      method: 'POST',
      body: { email }
    });
    return { success: true, senders: data.senders };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:testDigest', async () => {
  try {
    const data = await authFetchWithToken('/auth/test-digest', { method: 'POST' });
    return { success: true, total: data.total, messageId: data.messageId };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ---- Admin user management (all backend-side permission-checked) ----

ipcMain.handle('auth:listUsers', async () => {
  try {
    const data = await authFetchWithToken('/auth/users');
    return data.users || [];
  } catch (e) {
    console.error('listUsers failed:', e.message);
    return [];
  }
});

ipcMain.handle('auth:createUser', async (event, { username, password, role, shareMyData }) => {
  try {
    const data = await authFetchWithToken('/auth/users', {
      method: 'POST',
      body: { username, password, role, shareMyData: !!shareMyData }
    });
    return { success: true, user: data.user };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:shareData', async (event, { targetUserId }) => {
  try {
    await authFetchWithToken('/auth/users/' + encodeURIComponent(targetUserId) + '/share-data', {
      method: 'POST'
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:unshareData', async (event, { targetUserId }) => {
  try {
    await authFetchWithToken('/auth/users/' + encodeURIComponent(targetUserId) + '/unshare-data', {
      method: 'POST'
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:deleteUser', async (event, { targetUserId }) => {
  try {
    await authFetchWithToken('/auth/users/' + encodeURIComponent(targetUserId), {
      method: 'DELETE'
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('auth:resetUserPassword', async (event, { targetUserId, newPassword }) => {
  try {
    await authFetchWithToken('/auth/users/' + encodeURIComponent(targetUserId) + '/reset-password', {
      method: 'POST',
      body: { newPassword }
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Get full DB (from cloud if enabled, else local)
ipcMain.handle('db:load', async () => {
  const cloud = getCloudConfig();
  if (cloud) {
    try {
      const remoteDb = await cloudPullDb();
      // Cache locally for offline fallback
      saveDb(remoteDb);
      return remoteDb;
    } catch (e) {
      console.error('Cloud load failed, using local cache:', e.message);
      const local = loadDb();
      local._offline = true;
      local._cloudError = e.message;
      return local;
    }
  }
  return loadDb();
});

// Load local DB directly (bypasses cloud pull) - use after import to show imported data
ipcMain.handle('db:loadLocal', () => loadDb());

// Save full DB
ipcMain.handle('db:save', (event, db) => saveDb(db));

// Add/Update ticket
ipcMain.handle('db:upsertTicket', async (event, ticket) => {
  const cloud = getCloudConfig();
  
  // Always update local first (for cache)
  const db = loadDb();
  if (ticket.id) {
    const idx = db.tickets.findIndex(t => t.id === ticket.id);
    if (idx >= 0) {
      db.tickets[idx] = { ...db.tickets[idx], ...ticket, updated: new Date().toISOString() };
    } else {
      db.tickets.push({ ...ticket, created: new Date().toISOString() });
    }
  } else {
    ticket.id = 't_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    ticket.created = new Date().toISOString();
    db.tickets.push(ticket);
  }
  saveDb(db);
  
  // Push to cloud if enabled
  if (cloud) {
    try {
      const result = await cloudUpsertTicket(ticket);
      return result.ticket || ticket;
    } catch (e) {
      console.error('Cloud upsert failed:', e.message);
      return { ...ticket, _cloudError: e.message };
    }
  }
  
  return ticket;
});

// Delete ticket
ipcMain.handle('db:deleteTicket', async (event, id) => {
  const cloud = getCloudConfig();
  // Delete locally
  const db = loadDb();
  db.tickets = db.tickets.filter(t => t.id !== id);
  saveDb(db);
  // Delete on cloud
  if (cloud) {
    try {
      await cloudDeleteTicket(id);
    } catch (e) {
      console.error('Cloud delete failed:', e.message);
      return { success: true, _cloudError: e.message };
    }
  }
  return true;
});

// Bulk delete
ipcMain.handle('db:deleteTickets', async (event, ids) => {
  const cloud = getCloudConfig();
  // Local
  const db = loadDb();
  db.tickets = db.tickets.filter(t => !ids.includes(t.id));
  saveDb(db);
  // Cloud
  if (cloud) {
    try {
      await cloudBulkDelete(ids);
    } catch (e) {
      console.error('Cloud bulk delete failed:', e.message);
      return { success: true, _cloudError: e.message };
    }
  }
  return true;
});

// ============ MEMBERSHIPS ============
// Add/Update membership
ipcMain.handle('db:upsertMembership', async (event, m) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.memberships) db.memberships = [];
  
  if (m.id) {
    const idx = db.memberships.findIndex(x => x.id === m.id);
    if (idx >= 0) {
      db.memberships[idx] = { ...db.memberships[idx], ...m, updated: new Date().toISOString() };
    } else {
      db.memberships.push({ ...m, created: new Date().toISOString() });
    }
  } else {
    m.id = 'm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    m.created = new Date().toISOString();
    db.memberships.push(m);
  }
  saveDb(db);
  
  // Push to cloud if enabled
  if (cloud) {
    try {
      await cloudPushDb(db);
    } catch (e) {
      console.error('Cloud push (membership) failed:', e.message);
      return { ...m, _cloudError: e.message };
    }
  }
  return m;
});

// Delete membership
ipcMain.handle('db:deleteMembership', async (event, id) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.memberships) db.memberships = [];
  db.memberships = db.memberships.filter(m => m.id !== id);
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message };
    }
  }
  return true;
});

// Bulk delete memberships
ipcMain.handle('db:deleteMemberships', async (event, ids) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.memberships) db.memberships = [];
  db.memberships = db.memberships.filter(m => !ids.includes(m.id));
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message };
    }
  }
  return true;
});

// Export memberships CSV
ipcMain.handle('db:exportMembershipsCsv', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportovat Memberships CSV',
    defaultPath: `memberships-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    const db = loadDb();
    const memberships = db.memberships || [];
    const headers = ['ID', 'Team', 'MemberID', 'Email', 'Heslo', 'Karta', 'Skupina', 'Status', 'LP', 'Vlastnik', 'BankAccount', 'Telefon', 'URL', 'Poznamka'];
    const rows = memberships.map(m => [
      m.id,
      m.team || '',
      m.memberId || '',
      m.email || '',
      m.password || '',
      m.card || '',
      m.group || '',
      m.status || 'neutral',
      (m.lp === 0 || m.lp) ? m.lp : '',
      m.owner || '',
      m.bankAccount || '',
      m.phone || '',
      m.url || '',
      (m.notes || '').replace(/[\n\r]/g, ' ')
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    fs.writeFileSync(result.filePath, '\uFEFF' + csv);
    return { success: true, count: memberships.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Import memberships CSV
ipcMain.handle('db:importMembershipsCsv', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importovat Memberships CSV',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    let content = fs.readFileSync(result.filePaths[0], 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    
    const parseCSV = (text) => {
      const rows = [];
      let row = [], field = '', inQuotes = false, i = 0;
      while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQuotes = false; i++; continue;
          }
          field += ch; i++;
        } else {
          if (ch === '"') { inQuotes = true; i++; continue; }
          if (ch === ',') { row.push(field); field = ''; i++; continue; }
          if (ch === '\n' || ch === '\r') {
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
            if (ch === '\r' && text[i + 1] === '\n') i++;
            i++; continue;
          }
          field += ch; i++;
        }
      }
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
      return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
    };
    
    const rows = parseCSV(content);
    if (rows.length < 2) throw new Error('CSV je prázdné');
    
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const idx = (name) => headers.findIndex(h => h === name.toLowerCase());
    
    const db = loadDb();
    if (!db.memberships) db.memberships = [];
    let imported = 0;
    
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (row.length < 2) continue;
      const lpRaw = row[idx('lp')];
      const lpParsed = (lpRaw === '' || lpRaw == null) ? null : parseInt(lpRaw);
      const m = {
        id: row[idx('id')] || 'm_' + Date.now() + '_' + r,
        team: row[idx('team')] || '',
        memberId: row[idx('memberid')] || row[idx('member id')] || '',
        email: row[idx('email')] || row[idx('mail')] || '',
        password: row[idx('heslo')] || row[idx('password')] || '',
        card: row[idx('karta')] || row[idx('card')] || '',
        group: row[idx('skupina')] || row[idx('group')] || row[idx('parovani')] || '',
        status: row[idx('status')] || 'neutral',
        lp: isNaN(lpParsed) ? null : lpParsed,
        owner: row[idx('vlastnik')] || row[idx('owner')] || '',
        bankAccount: row[idx('bankaccount')] || row[idx('bu')] || row[idx('ucet')] || '',
        phone: row[idx('telefon')] || row[idx('phone')] || '',
        url: row[idx('url')] || '',
        notes: row[idx('poznamka')] || row[idx('notes')] || '',
        created: new Date().toISOString()
      };
      db.memberships.push(m);
      imported++;
    }
    saveDb(db);
    
    const cloud = getCloudConfig();
    if (cloud) {
      try { await cloudPushDb(db); } catch (e) {}
    }
    
    return { success: true, imported };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ EXPENSES ============
ipcMain.handle('db:upsertExpense', async (event, e) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.expenses) db.expenses = [];
  
  if (e.id) {
    const idx = db.expenses.findIndex(x => x.id === e.id);
    if (idx >= 0) {
      db.expenses[idx] = { ...db.expenses[idx], ...e, updated: new Date().toISOString() };
    } else {
      db.expenses.push({ ...e, created: new Date().toISOString() });
    }
  } else {
    e.id = 'e_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    e.created = new Date().toISOString();
    db.expenses.push(e);
  }
  saveDb(db);
  
  if (cloud) {
    try { await cloudPushDb(db); } catch (err) {
      return { ...e, _cloudError: err.message };
    }
  }
  return e;
});

ipcMain.handle('db:deleteExpense', async (event, id) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.expenses) db.expenses = [];
  db.expenses = db.expenses.filter(e => e.id !== id);
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (err) {
      return { success: true, _cloudError: err.message };
    }
  }
  return true;
});

ipcMain.handle('db:deleteExpenses', async (event, ids) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.expenses) db.expenses = [];
  db.expenses = db.expenses.filter(e => !ids.includes(e.id));
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (err) {
      return { success: true, _cloudError: err.message };
    }
  }
  return true;
});

ipcMain.handle('db:exportExpensesCsv', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportovat výdaje CSV',
    defaultPath: `expenses-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    const db = loadDb();
    const expenses = db.expenses || [];
    const headers = ['ID', 'Nazev', 'Kategorie', 'Cena', 'Frekvence', 'CustomDays', 'NasledujiciPlatba', 'PrvniPlatba', 'Karta', 'URL', 'Aktivni', 'Poznamka'];
    const rows = expenses.map(e => [
      e.id,
      e.name || '',
      e.category || '',
      e.price || 0,
      e.frequency || 'monthly',
      e.customDays || '',
      e.nextPayment || '',
      e.startDate || '',
      e.card || '',
      e.url || '',
      e.active !== false ? '1' : '0',
      (e.notes || '').replace(/[\n\r]/g, ' ')
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    fs.writeFileSync(result.filePath, '\uFEFF' + csv);
    return { success: true, count: expenses.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ============ PAYOUT RULES ============
ipcMain.handle('db:getPayoutRules', () => {
  const db = loadDb();
  return db.payoutRules || [];
});

ipcMain.handle('db:savePayoutRules', async (event, rules) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  // Deduplicate by platform (case-insensitive)
  const seen = new Set();
  const cleaned = (Array.isArray(rules) ? rules : []).filter(r => {
    if (!r || !r.platform) return false;
    const key = String(r.platform).toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  db.payoutRules = cleaned;
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message, rules: cleaned };
    }
  }
  return { success: true, rules: cleaned };
});

// Mark a ticket's payout as paid (sets paidOut flag on the ticket)
ipcMain.handle('db:markPayoutPaid', async (event, { ticketId, paidOutDate, paidOutAmount }) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  const idx = db.tickets.findIndex(t => t.id === ticketId);
  if (idx < 0) return { success: false, error: 'Vstupenka nenalezena' };
  db.tickets[idx] = {
    ...db.tickets[idx],
    paidOut: true,
    paidOutDate: paidOutDate || new Date().toISOString().slice(0, 10),
    paidOutAmount: (paidOutAmount === null || paidOutAmount === undefined || paidOutAmount === '') ? null : Number(paidOutAmount),
    updated: new Date().toISOString()
  };
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message };
    }
  }
  return { success: true, ticket: db.tickets[idx] };
});

ipcMain.handle('db:unmarkPayoutPaid', async (event, ticketId) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  const idx = db.tickets.findIndex(t => t.id === ticketId);
  if (idx < 0) return { success: false, error: 'Vstupenka nenalezena' };
  db.tickets[idx] = {
    ...db.tickets[idx],
    paidOut: false,
    paidOutDate: null,
    paidOutAmount: null,
    updated: new Date().toISOString()
  };
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message };
    }
  }
  return { success: true };
});

// ============ INBOX ============
ipcMain.handle('db:updateInboxItem', async (event, { id, updates }) => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.inbox) db.inbox = [];
  const idx = db.inbox.findIndex(i => i.id === id);
  if (idx < 0) return { success: false, error: 'Item not found' };
  db.inbox[idx] = { ...db.inbox[idx], ...updates };
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, _cloudError: e.message };
    }
  }
  return { success: true };
});

ipcMain.handle('db:clearResolvedInbox', async () => {
  const cloud = getCloudConfig();
  const db = loadDb();
  if (!db.inbox) return { success: true };
  const before = db.inbox.length;
  db.inbox = db.inbox.filter(i => i.state !== 'approved' && i.state !== 'dismissed');
  saveDb(db);
  if (cloud) {
    try { await cloudPushDb(db); } catch (e) {
      return { success: true, removed: before - db.inbox.length, _cloudError: e.message };
    }
  }
  return { success: true, removed: before - db.inbox.length };
});

// Export database to chosen path
ipcMain.handle('db:exportJson', async (event) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportovat databázi',
    defaultPath: `ticketvault-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    const db = loadDb();
    fs.writeFileSync(result.filePath, JSON.stringify(db, null, 2));
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Import database
ipcMain.handle('db:importJson', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importovat databázi',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    const data = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'));
    if (!data.tickets) throw new Error('Neplatný formát databáze');
    
    const cloud = getCloudConfig();
    const cloudActive = !!cloud;
    
    // Confirm import with user - with cloud warning
    const cloudWarning = cloudActive 
      ? '\n\n⚠️ ONLINE REŽIM JE ZAPNUTÝ\nImportovaná data se automaticky nahrají do cloudu a přepíší stávající cloud databázi.'
      : '';
    const confirm = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['Zrušit', 'Sloučit', 'Přepsat'],
      defaultId: 1,
      cancelId: 0,
      title: 'Import databáze',
      message: `Nalezeno ${data.tickets.length} vstupenek v souboru.`,
      detail: 'Sloučit = přidat nové záznamy k existujícím\nPřepsat = smazat stávající a nahradit novými' + cloudWarning
    });
    if (confirm.response === 0) return { success: false, canceled: true };
    
    let finalDb;
    if (confirm.response === 2) {
      // OVERWRITE: pokud je cloud aktivní, použijeme importovaná data jako je
      // nepotřebujeme nejdřív číst cloud (protože ho přepisujeme)
      finalDb = data;
      saveDb(finalDb);
    } else {
      // MERGE: potřebujeme aktuální data
      // Pokud cloud aktivní, merge proti cloudu (ne lokální cache, která může být stará)
      let currentDb;
      if (cloudActive) {
        try {
          currentDb = await cloudPullDb();
        } catch (e) {
          // cloud unavailable - fall back to local
          currentDb = loadDb();
        }
      } else {
        currentDb = loadDb();
      }
      
      const existingIds = new Set(currentDb.tickets.map(t => t.id));
      const newTickets = data.tickets.filter(t => !existingIds.has(t.id));
      currentDb.tickets = [...currentDb.tickets, ...newTickets];
      
      // Merge accounts
      if (data.accounts) {
        if (!currentDb.accounts) currentDb.accounts = [];
        const existingAccIds = new Set(currentDb.accounts.map(a => a.id));
        const newAccounts = data.accounts.filter(a => !existingAccIds.has(a.id));
        currentDb.accounts = [...currentDb.accounts, ...newAccounts];
      }
      finalDb = currentDb;
      saveDb(finalDb);
    }
    
    // CRITICAL: If cloud is active, push the final DB to cloud
    // This prevents the next sync/refresh from overwriting our imported data
    let cloudPushResult = { pushed: false };
    if (cloudActive) {
      try {
        await cloudPushDb(finalDb);
        cloudPushResult = { pushed: true };
      } catch (e) {
        console.error('Cloud push after import failed:', e.message);
        cloudPushResult = { pushed: false, error: e.message };
      }
    }
    
    return { 
      success: true, 
      imported: data.tickets.length,
      mode: confirm.response === 2 ? 'overwrite' : 'merge',
      cloudActive,
      cloudPushed: cloudPushResult.pushed,
      cloudError: cloudPushResult.error
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Export to CSV
ipcMain.handle('db:exportCsv', async (event) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportovat CSV',
    defaultPath: `ticketvault-${new Date().toISOString().slice(0, 10)}.csv`,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    const db = loadDb();
    const headers = ['ID', 'Event', 'Datum', 'Misto', 'Sekce', 'Rada', 'Sedadlo', 'Ucet', 'Platforma', 'Ks', 'Status', 'Nakup', 'Prodej', 'Profit', 'ROI', 'Poznamka'];
    const rows = db.tickets.map(t => {
      const profit = (t.salePrice || 0) - (t.purchasePrice || 0);
      const roi = t.purchasePrice > 0 ? ((profit / t.purchasePrice) * 100).toFixed(1) : '0';
      return [
        t.id,
        t.eventName || '',
        t.eventDate || '',
        t.venue || '',
        t.section || '',
        t.row || '',
        t.seat || '',
        t.account || '',
        t.platform || '',
        t.quantity || 1,
        t.status || 'available',
        t.purchasePrice || 0,
        t.salePrice || 0,
        profit.toFixed(2),
        roi + '%',
        (t.notes || '').replace(/[\n\r;,]/g, ' ')
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    fs.writeFileSync(result.filePath, '\uFEFF' + csv); // BOM for Excel
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Import from CSV (smart - recognizes both TicketVault export format and silently.gg checkout log format)
ipcMain.handle('db:importCsv', async (event) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Importovat CSV',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile']
  });
  if (result.canceled) return { success: false, canceled: true };
  try {
    let content = fs.readFileSync(result.filePaths[0], 'utf-8');
    if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    
    // ============ ROBUST CSV PARSER (handles multi-line quoted fields) ============
    function parseCSV(text) {
      const rows = [];
      let row = [];
      let field = '';
      let inQuotes = false;
      let i = 0;
      while (i < text.length) {
        const ch = text[i];
        if (inQuotes) {
          if (ch === '"') {
            if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
            inQuotes = false; i++; continue;
          }
          field += ch; i++;
        } else {
          if (ch === '"') { inQuotes = true; i++; continue; }
          if (ch === ',') { row.push(field); field = ''; i++; continue; }
          if (ch === '\n' || ch === '\r') {
            // end of row
            row.push(field); field = '';
            if (row.length > 1 || row[0] !== '') rows.push(row);
            row = [];
            // skip \r\n
            if (ch === '\r' && text[i + 1] === '\n') i++;
            i++; continue;
          }
          field += ch; i++;
        }
      }
      // last field
      if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
      return rows.filter(r => r.length > 1 || (r[0] && r[0].trim() !== ''));
    }
    
    const rows = parseCSV(content);
    if (rows.length < 2) throw new Error('CSV je prázdné');
    
    const headers = rows[0].map(h => h.toLowerCase().trim());
    const idx = (name) => headers.findIndex(h => h === name.toLowerCase());
    
    // Detect format
    const isCheckoutLog = headers.includes('checkout time') && headers.includes('site') && headers.includes('name') && headers.includes('price');
    const isTicketVault = headers.includes('event') && headers.includes('datum') && headers.includes('nakup');
    
    if (!isCheckoutLog && !isTicketVault) {
      throw new Error('Neznámý formát CSV. Musí obsahovat buď sloupce TicketVault (Event, Datum, Nakup...) nebo checkout log (Checkout Time, Site, Name, Price...)');
    }
    
    const db = loadDb();
    let imported = 0;
    let skipped = 0;
    
    if (isCheckoutLog) {
      // ============ CHECKOUT LOG FORMAT (silently.gg / ticketmaster bot) ============
      const iTime = headers.indexOf('checkout time');
      const iSite = headers.indexOf('site');
      const iName = headers.indexOf('name');
      const iPrice = headers.indexOf('price');
      const iSeat = headers.indexOf('seat');
      const iAccount = headers.indexOf('account');
      
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (!row[iName]) { skipped++; continue; }
        
        // Parse Name field - 1st line = event name, 2nd line contains venue + ISO date + (id)
        const nameLines = (row[iName] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const eventName = nameLines[0] || '';
        let venue = '';
        let eventDate = '';
        if (nameLines[1]) {
          // format: "The O2, London 2026-02-16T18:30:00Z (3500631CA3D1333C)"
          const dateMatch = nameLines[1].match(/(\d{4}-\d{2}-\d{2})T/);
          if (dateMatch) eventDate = dateMatch[1];
          // venue is everything before the ISO date
          venue = nameLines[1].replace(/\s*\d{4}-\d{2}-\d{2}T[\d:Z.+-]+\s*\([^)]+\)\s*$/, '').trim();
        }
        
        // Parse Price field - format: "321.00£ (80.25£ x 4)" or "320.25€ (106.75€ x 3)"
        const priceStr = row[iPrice] || '';
        let totalPrice = 0;
        let unitPrice = 0;
        let quantity = 1;
        const priceMatch = priceStr.match(/([\d.]+)\s*[£€$]?\s*\(\s*([\d.]+)\s*[£€$]?\s*x\s*(\d+)\s*\)/);
        if (priceMatch) {
          totalPrice = parseFloat(priceMatch[1]);
          unitPrice = parseFloat(priceMatch[2]);
          quantity = parseInt(priceMatch[3]);
        } else {
          // fallback: just total price
          const simpleMatch = priceStr.match(/([\d.]+)/);
          if (simpleMatch) totalPrice = parseFloat(simpleMatch[1]);
        }
        
        // Detect currency
        let currency = 'EUR';
        if (priceStr.includes('£')) currency = 'GBP';
        else if (priceStr.includes('$')) currency = 'USD';
        
        // Convert GBP/USD to EUR (approximate rates; user can adjust later)
        const rates = { GBP: 1.16, USD: 0.92, EUR: 1 };
        const eurRate = rates[currency] || 1;
        const purchasePriceEur = unitPrice > 0 ? unitPrice * eurRate : (totalPrice / quantity) * eurRate;
        
        // Parse Seat field - 1st line = section, 2nd = row, 3rd = seats
        const seatLines = (row[iSeat] || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        let section = seatLines[0] || '';
        let seatRow = '';
        let seatNum = '';
        for (const line of seatLines) {
          if (/^Row\s+/i.test(line)) seatRow = line.replace(/^Row\s+/i, '').trim();
          else if (/^Seat\s+/i.test(line)) seatNum = line.replace(/^Seat\s+/i, '').trim();
        }
        
        // Account - extract email
        const account = row[iAccount] || '';
        
        const ticket = {
          id: 't_' + Date.now() + '_' + r + '_' + Math.random().toString(36).substr(2, 6),
          eventName: eventName,
          eventDate: eventDate,
          venue: venue,
          section: section,
          row: seatRow,
          seat: seatNum,
          account: account,
          platform: row[iSite] || '',
          quantity: quantity,
          status: 'listed',  // Defaults to "listed" since these are purchased tickets
          purchasePrice: Math.round(purchasePriceEur * 100) / 100,
          salePrice: 0,
          notes: `Importováno z checkout logu ${row[iTime] || ''}. Původní cena: ${priceStr}`,
          created: new Date().toISOString()
        };
        db.tickets.push(ticket);
        imported++;
      }
    } else {
      // ============ TICKETVAULT EXPORT FORMAT ============
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        if (row.length < 3) { skipped++; continue; }
        const ticket = {
          id: row[idx('id')] || 't_' + Date.now() + '_' + r,
          eventName: row[idx('event')] || '',
          eventDate: row[idx('datum')] || '',
          venue: row[idx('misto')] || '',
          section: row[idx('sekce')] || '',
          row: row[idx('rada')] || '',
          seat: row[idx('sedadlo')] || '',
          account: row[idx('ucet')] || '',
          platform: row[idx('platforma')] || '',
          quantity: parseInt(row[idx('ks')]) || 1,
          status: row[idx('status')] || 'available',
          purchasePrice: parseFloat(row[idx('nakup')]) || 0,
          salePrice: parseFloat(row[idx('prodej')]) || 0,
          notes: row[idx('poznamka')] || '',
          created: new Date().toISOString()
        };
        db.tickets.push(ticket);
        imported++;
      }
    }
    
    saveDb(db);
    
    // If online mode is on, push to cloud
    const cloud = getCloudConfig();
    if (cloud) {
      try { await cloudPushDb(db); } catch (e) { console.error('Cloud push after import failed:', e.message); }
    }
    
    return { 
      success: true, 
      imported, 
      skipped,
      format: isCheckoutLog ? 'checkout-log' : 'ticketvault'
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Choose DB file path
ipcMain.handle('config:chooseDbPath', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Vyberte umístění databáze (tip: sdílená složka OneDrive/Dropbox)',
    defaultPath: 'ticketvault-db.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['createDirectory']
  });
  if (result.canceled) return { success: false, canceled: true };
  
  const config = loadConfig();
  const oldPath = config.dbPath;
  
  // If file doesn't exist at new location, migrate current DB there
  try {
    if (!fs.existsSync(result.filePath)) {
      // Copy existing DB to new location
      if (fs.existsSync(oldPath)) {
        fs.copyFileSync(oldPath, result.filePath);
      } else {
        fs.writeFileSync(result.filePath, JSON.stringify(getDefaultDb(), null, 2));
      }
    }
    config.dbPath = result.filePath;
    saveConfig(config);
    return { success: true, path: result.filePath };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Open file location
ipcMain.handle('config:openDbLocation', () => {
  const config = loadConfig();
  shell.showItemInFolder(config.dbPath);
  return true;
});

// Sync - reload DB from file OR pull from cloud
ipcMain.handle('db:sync', async () => {
  const cloud = getCloudConfig();
  if (cloud) {
    try {
      const remoteDb = await cloudPullDb();
      saveDb(remoteDb); // cache locally
      // Update last sync time
      const cfg = loadConfig();
      if (!cfg.cloud) cfg.cloud = {};
      cfg.cloud.lastSync = new Date().toISOString();
      saveConfig(cfg);
      return remoteDb;
    } catch (e) {
      const local = loadDb();
      local._offline = true;
      local._cloudError = e.message;
      return local;
    }
  }
  return loadDb();
});

// Cloud: test connection
ipcMain.handle('cloud:test', async (event, { apiUrl, apiKey }) => {
  return await cloudTestConnection(apiUrl, apiKey);
});

// Cloud: push entire local DB to cloud (upload)
ipcMain.handle('cloud:pushAll', async () => {
  const cloud = getCloudConfig();
  if (!cloud) return { success: false, error: 'Cloud není zapnutý' };
  try {
    const db = loadDb();
    const res = await cloudPushDb(db);
    return { success: true, count: res.count };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Cloud: pull from cloud and replace local (download)
ipcMain.handle('cloud:pullAll', async () => {
  const cloud = getCloudConfig();
  if (!cloud) return { success: false, error: 'Cloud není zapnutý' };
  try {
    const remoteDb = await cloudPullDb();
    saveDb(remoteDb);
    return { success: true, count: (remoteDb.tickets || []).length };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Cloud: get status
ipcMain.handle('cloud:status', () => {
  const config = loadConfig();
  return {
    enabled: !!(config.cloud && config.cloud.enabled),
    configured: !!(config.cloud && config.cloud.apiUrl && config.cloud.apiKey),
    apiUrl: config.cloud?.apiUrl || '',
    lastSync: config.cloud?.lastSync || null
  };
});

// Dialog helpers
ipcMain.handle('dialog:confirm', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, {
    type: options.type || 'question',
    buttons: options.buttons || ['Zrušit', 'OK'],
    defaultId: options.defaultId ?? 1,
    cancelId: 0,
    title: options.title || 'Potvrzení',
    message: options.message || '',
    detail: options.detail || ''
  });
  return result.response;
});

ipcMain.handle('dialog:info', (event, options) => {
  return dialog.showMessageBox(mainWindow, {
    type: options.type || 'info',
    title: options.title || 'Informace',
    message: options.message || '',
    detail: options.detail || ''
  });
});

ipcMain.handle('app:getPath', () => {
  return {
    userData: app.getPath('userData'),
    home: app.getPath('home'),
    documents: app.getPath('documents')
  };
});

// ============ VIAGOGO / STUBHUB FETCH ============
// Fetches HTML from event ticket sites bypassing CORS (runs in main process)
// Includes aggressive anti-bot mitigation: full Chrome headers, cookies, redirects

function httpsRequest(url, headers, cookies = [], redirectCount = 0) {
  return new Promise((resolve) => {
    if (redirectCount > 5) {
      resolve({ ok: false, error: 'Příliš mnoho redirectů' });
      return;
    }
    try {
      const urlObj = new URL(url);
      const reqHeaders = { ...headers };
      if (cookies.length > 0) {
        reqHeaders['Cookie'] = cookies.join('; ');
      }
      
      const req = https.get({
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: reqHeaders,
        timeout: 15000
      }, (res) => {
        // Collect new cookies from Set-Cookie headers
        const newCookies = [...cookies];
        const setCookie = res.headers['set-cookie'];
        if (setCookie) {
          setCookie.forEach(c => {
            const pair = c.split(';')[0];
            if (pair && !newCookies.includes(pair)) newCookies.push(pair);
          });
        }
        
        // Handle redirects (including to different hostnames)
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          let redirectUrl = res.headers.location;
          if (!redirectUrl.startsWith('http')) {
            redirectUrl = `https://${urlObj.hostname}${redirectUrl.startsWith('/') ? '' : '/'}${redirectUrl}`;
          }
          res.resume(); // drain response
          // Update Referer to current URL
          const nextHeaders = { ...headers, 'Referer': url };
          httpsRequest(redirectUrl, nextHeaders, newCookies, redirectCount + 1).then(resolve);
          return;
        }
        
        let chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString('utf-8');
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            html: data,
            status: res.statusCode,
            cookies: newCookies,
            error: res.statusCode >= 400 ? `HTTP ${res.statusCode}` : null
          });
        });
      });
      
      req.on('error', err => resolve({ ok: false, error: err.message }));
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Timeout (15s) - server neodpověděl' });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

ipcMain.handle('fetchEventPage', async (event, url) => {
  // Realistic Chrome on Windows 11 headers
  const chromeHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
    'Accept-Language': 'en-US,en;q=0.9,cs;q=0.8',
    'Accept-Encoding': 'identity',
    'Cache-Control': 'max-age=0',
    'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
    'DNT': '1',
    'Connection': 'keep-alive'
  };
  
  const urlObj = new URL(url);
  const isViagogo = /viagogo\.com/i.test(urlObj.hostname);
  
  // STEP 1: For Viagogo, prefetch homepage FIRST to get session cookies
  // This mimics real browser behavior — user visits homepage, then clicks a link to event
  let initialCookies = [];
  if (isViagogo) {
    try {
      const homepageUrl = `https://${urlObj.hostname}/`;
      const homepageResult = await httpsRequest(homepageUrl, chromeHeaders);
      if (homepageResult.cookies) {
        initialCookies = homepageResult.cookies;
      }
      // Small delay to look human
      await new Promise(r => setTimeout(r, 600));
    } catch (e) { /* ignore, proceed anyway */ }
  }
  
  // STEP 2: Fetch event page with cookies + Referer from homepage
  const eventHeaders = {
    ...chromeHeaders,
    'Sec-Fetch-Site': isViagogo ? 'same-origin' : 'none',
    'Referer': isViagogo ? `https://${urlObj.hostname}/` : 'https://www.google.com/'
  };
  
  let result = await httpsRequest(url, eventHeaders, initialCookies);
  
  // If bot detection triggered, try once more with all accumulated cookies + delay
  if (result.ok && result.html) {
    const botDetected = /JavaScript is disabled|captcha|cf-challenge|access[\s-]?denied|pardon our interruption/i.test(result.html);
    if (botDetected && result.cookies && result.cookies.length > 0) {
      await new Promise(r => setTimeout(r, 1500));
      const retryHeaders = { ...eventHeaders, 'Sec-Fetch-Site': 'same-origin' };
      const retry = await httpsRequest(url, retryHeaders, result.cookies);
      if (retry.ok && retry.html && !/JavaScript is disabled|captcha|cf-challenge|pardon our interruption/i.test(retry.html)) {
        return retry;
      }
    }
  }
  
  // Try mobile User-Agent fallback (often has weaker bot detection)
  if (result.ok && result.html && /JavaScript is disabled|captcha|pardon our interruption/i.test(result.html)) {
    const mobileHeaders = {
      ...chromeHeaders,
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
      'Sec-Ch-Ua-Mobile': '?1',
      'Sec-Ch-Ua-Platform': '"iOS"',
      'Referer': `https://${urlObj.hostname}/`
    };
    const mobileResult = await httpsRequest(url, mobileHeaders, initialCookies);
    if (mobileResult.ok && mobileResult.html && !/JavaScript is disabled|captcha|pardon our interruption/i.test(mobileResult.html)) {
      return mobileResult;
    }
  }
  
  return result;
});

