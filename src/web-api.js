// TicketVault web edition — stands in for the Electron preload (window.api) when the
// app is opened in a browser from the self-hosted server (/app). Every call goes to the
// same server the desktop app uses; there is no local database, the server is the source
// of truth. Desktop-only features (embedded marketplaces, file dialogs, PDF/CSV import,
// page scraping) answer with a clear message instead.
(function () {
  if (window.api) return;                       // running inside Electron: preload wins
  const API = location.origin + '/api';
  const DESKTOP_ONLY = 'Tahle funkce je jen v desktopové aplikaci TicketVault.';
  document.documentElement.classList.add('web-mode');

  // ---- token & config (per browser) ----------------------------------------------
  const store = {
    get token() { try { return localStorage.getItem('tv.token') || sessionStorage.getItem('tv.token') || ''; } catch { return ''; } },
    setToken(t, remember) {
      try {
        localStorage.removeItem('tv.token'); sessionStorage.removeItem('tv.token');
        if (t) (remember ? localStorage : sessionStorage).setItem('tv.token', t);
      } catch { /* private mode */ }
    },
    get config() {
      let c = {};
      try { c = JSON.parse(localStorage.getItem('tv.config') || '{}'); } catch { c = {}; }
      c.currency = c.currency || 'EUR';
      c.alerts = c.alerts || { animations: true, startupToast: true, unsoldDays: 7, undeliveredDays: 5, mutedTicketIds: [] };
      c.cloud = { ...(c.cloud || {}), enabled: true, apiUrl: API, apiKey: this.token ? '(web)' : '' };
      c.dbPath = '(server)';
      return c;
    },
    saveConfig(c) {
      const copy = { ...c }; delete copy.cloud;
      const keep = { lastUsername: (c.cloud && c.cloud.lastUsername) || this.config.cloud.lastUsername, rememberLogin: c.cloud && c.cloud.rememberLogin };
      copy.cloud = keep;
      try { localStorage.setItem('tv.config', JSON.stringify(copy)); } catch { /* ignore */ }
      return true;
    }
  };

  async function call(path, { method = 'GET', body, raw = false } = {}) {
    const res = await fetch(API + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(store.token ? { Authorization: 'Bearer ' + store.token } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    if (raw) { if (!res.ok) throw new Error('HTTP ' + res.status); return res; }
    const data = await res.json().catch(() => ({ error: 'Neplatná odpověď serveru.' }));
    if (!res.ok) { const e = new Error(data.error || ('HTTP ' + res.status)); e.status = res.status; throw e; }
    return data;
  }
  const ok = (extra = {}) => ({ success: true, ...extra });
  const fail = (e) => ({ success: false, error: e && e.message ? e.message : String(e) });

  // ---- database: cached copy of the server bucket ----------------------------------
  let db = null;
  async function pull() { db = await call('/db'); return db; }
  async function ensure() { return db || pull(); }
  async function pushAll() { await call('/db', { method: 'PUT', body: db }); }
  const newId = (p) => p + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11);

  function upsertIn(listName, prefix) {
    return async (item) => {
      await ensure();
      if (!Array.isArray(db[listName])) db[listName] = [];
      const now = new Date().toISOString();
      if (item.id) {
        const i = db[listName].findIndex(x => x.id === item.id);
        if (i >= 0) db[listName][i] = { ...db[listName][i], ...item, updated: now };
        else db[listName].push({ ...item, created: now });
      } else { item.id = newId(prefix); item.created = now; db[listName].push(item); }
      try { await pushAll(); return item; } catch (e) { return { ...item, _cloudError: e.message }; }
    };
  }
  function deleteIn(listName) {
    return async (idOrIds) => {
      await ensure();
      const ids = Array.isArray(idOrIds) ? idOrIds : [idOrIds];
      db[listName] = (db[listName] || []).filter(x => !ids.includes(x.id));
      try { await pushAll(); return true; } catch (e) { return { success: true, _cloudError: e.message }; }
    };
  }
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function pickFile(accept) {
    return new Promise(resolve => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = accept;
      inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
      inp.click();
    });
  }

  window.api = {
    // config & app
    getConfig: async () => store.config,
    loadConfig: async () => store.config,
    setConfig: async (c) => store.saveConfig(c),
    saveConfig: async (c) => store.saveConfig(c),
    openExternal: async (url) => { window.open(url, '_blank', 'noopener'); return true; },
    checkForUpdates: async () => ({ success: true, web: true }),
    installUpdate: async () => true,
    getAppVersion: async () => { try { return (await call('/ping')).version + ' (web)'; } catch { return 'web'; } },
    onUpdaterEvent: () => () => {},
    onMenuAction: () => {},
    getPath: async () => ({ userData: '(web)', db: '(server)' }),
    chooseDbPath: async () => fail(new Error(DESKTOP_ONLY)),
    openDbLocation: async () => false,
    confirm: async (o) => { const b = (o && o.buttons) || ['Zrušit', 'OK']; return window.confirm([o.title, o.message, o.detail].filter(Boolean).join('\n\n')) ? b.length - 1 : 0; },
    info: async (o) => { window.alert([o.title, o.message, o.detail].filter(Boolean).join('\n\n')); return 0; },

    // currencies (server proxies the rate API so the page's CSP stays same-origin)
    fetchExchangeRates: async () => {
      try { const r = await call('/rates'); const c = store.config; c.exchangeRates = r.rates; store.saveConfig(c); return ok({ count: Object.keys(r.rates).length, rates: r.rates }); }
      catch (e) { return fail(e); }
    },
    autoRefreshExchangeRates: async () => {
      const c = store.config; const u = c.exchangeRates && c.exchangeRates._updated;
      if (u && Date.now() - new Date(u).getTime() < 24 * 3600 * 1000) return ok({ skipped: true, reason: 'fresh' });
      return window.api.fetchExchangeRates();
    },
    fetchPLFixtures: async () => fail(new Error(DESKTOP_ONLY)),

    // auth
    authGetState: async () => {
      const cfg = store.config;
      const state = { apiUrl: API, lastUsername: cfg.cloud.lastUsername || '', rememberLogin: cfg.cloud.rememberLogin !== false, hasToken: !!store.token, me: null, offline: false, error: null };
      if (!store.token) return state;
      try {
        const d = await call('/auth/me');
        state.me = d.user;
        if (d.token) store.setToken(d.token, !!localStorage.getItem('tv.token'));
      } catch (e) {
        if (e.status === 401) { store.setToken(''); state.hasToken = false; } else { state.error = e.message; state.offline = true; }
      }
      return state;
    },
    authLogin: async ({ username, password, remember }) => {
      try {
        const d = await call('/auth/login', { method: 'POST', body: { username, password } });
        store.setToken(d.token, remember !== false);
        const c = store.config; c.cloud.lastUsername = d.user.username; c.cloud.rememberLogin = remember !== false; store.saveConfig(c);
        db = null;
        return ok({ user: d.user });
      } catch (e) { return fail(e); }
    },
    authRegister: async ({ username, password, inviteCode }) => {
      try { const d = await call('/auth/register', { method: 'POST', body: { username, password, inviteCode } }); store.setToken(d.token, true); db = null; return ok({ user: d.user, recoveryCode: d.recoveryCode }); }
      catch (e) { return fail(e); }
    },
    authRecover: async ({ username, recoveryCode, newPassword }) => {
      try { const d = await call('/auth/recover', { method: 'POST', body: { username, recoveryCode, newPassword } }); store.setToken(d.token, true); return ok({ user: d.user, newRecoveryCode: d.newRecoveryCode }); }
      catch (e) { return fail(e); }
    },
    authLogout: async () => { store.setToken(''); db = null; return ok(); },
    authChangeOwnPassword: async (b) => { try { await call('/auth/change-password', { method: 'POST', body: b }); return ok(); } catch (e) { return fail(e); } },
    authUpdateEmailSettings: async (b) => { try { const d = await call('/auth/email-settings', { method: 'POST', body: b }); return ok(d); } catch (e) { return fail(e); } },
    authUpdateNotificationSettings: async (b) => { try { const d = await call('/auth/notification-settings', { method: 'POST', body: b }); return ok(d); } catch (e) { return fail(e); } },
    authTestDigest: async () => { try { const d = await call('/auth/test-digest', { method: 'POST' }); return ok(d); } catch (e) { return fail(e); } },
    authRegenerateMailToken: async () => { try { const d = await call('/auth/regenerate-mail-token', { method: 'POST' }); return ok(d); } catch (e) { return fail(e); } },
    authGetAllowedSenders: async () => { try { const d = await call('/auth/allowed-senders'); return ok({ senders: d.senders || [] }); } catch (e) { return fail(e); } },
    authAddAllowedSender: async ({ email }) => { try { const d = await call('/auth/allowed-senders/add', { method: 'POST', body: { email } }); return ok(d); } catch (e) { return fail(e); } },
    authRemoveAllowedSender: async ({ email }) => { try { const d = await call('/auth/allowed-senders/remove', { method: 'POST', body: { email } }); return ok(d); } catch (e) { return fail(e); } },
    authListUsers: async () => { try { return (await call('/auth/users')).users || []; } catch { return []; } },
    authCreateUser: async (b) => { try { const d = await call('/auth/users', { method: 'POST', body: b }); return ok(d); } catch (e) { return fail(e); } },
    authShareData: async ({ targetUserId }) => { try { await call('/auth/users/' + encodeURIComponent(targetUserId) + '/share-data', { method: 'POST' }); return ok(); } catch (e) { return fail(e); } },
    authUnshareData: async ({ targetUserId }) => { try { await call('/auth/users/' + encodeURIComponent(targetUserId) + '/unshare-data', { method: 'POST' }); return ok(); } catch (e) { return fail(e); } },
    authDeleteUser: async ({ targetUserId }) => { try { await call('/auth/users/' + encodeURIComponent(targetUserId), { method: 'DELETE' }); return ok(); } catch (e) { return fail(e); } },
    authResetUserPassword: async ({ targetUserId, newPassword }) => { try { await call('/auth/users/' + encodeURIComponent(targetUserId) + '/reset-password', { method: 'POST', body: { newPassword } }); return ok(); } catch (e) { return fail(e); } },

    // database
    loadDb: async () => { try { return await pull(); } catch (e) { const d = db || { tickets: [] }; return { ...d, _offline: true, _cloudError: e.message }; } },
    loadLocalDb: async () => ensure(),
    syncDb: async () => { try { return await pull(); } catch (e) { return { ...(db || { tickets: [] }), _offline: true, _cloudError: e.message }; } },
    saveDb: async (d) => { db = d; try { await pushAll(); return true; } catch { return false; } },
    saveWatched: async (list) => { await ensure(); db.watchedMatches = Array.isArray(list) ? list : []; try { await pushAll(); return ok(); } catch (e) { return { success: false, _cloudError: e.message }; } },
    upsertTicket: async (t) => {
      await ensure();
      try { const r = await call('/ticket', { method: 'POST', body: t }); const saved = r.ticket || t; const i = db.tickets.findIndex(x => x.id === saved.id); if (i >= 0) db.tickets[i] = saved; else db.tickets.push(saved); return saved; }
      catch (e) { return { ...t, _cloudError: e.message }; }
    },
    deleteTicket: async (id) => { try { await call('/ticket/' + encodeURIComponent(id), { method: 'DELETE' }); if (db) db.tickets = db.tickets.filter(t => t.id !== id); return true; } catch (e) { return { success: false, _cloudError: e.message }; } },
    deleteTickets: async (ids) => { try { await call('/tickets/bulk-delete', { method: 'POST', body: { ids } }); if (db) db.tickets = db.tickets.filter(t => !ids.includes(t.id)); return true; } catch (e) { return { success: false, _cloudError: e.message }; } },
    upsertMembership: upsertIn('memberships', 'm'),
    deleteMembership: deleteIn('memberships'),
    deleteMemberships: deleteIn('memberships'),
    upsertMailbox: upsertIn('mailboxes', 'mb'),
    deleteMailbox: deleteIn('mailboxes'),
    deleteMailboxes: deleteIn('mailboxes'),
    upsertSimcard: upsertIn('simcards', 'sc'),
    deleteSimcard: deleteIn('simcards'),
    deleteSimcards: deleteIn('simcards'),
    upsertExpense: upsertIn('expenses', 'e'),
    deleteExpense: deleteIn('expenses'),
    deleteExpenses: deleteIn('expenses'),
    addSimOperator: async (name) => {
      await ensure(); const n = String(name || '').trim();
      if (!n) return { success: false, error: 'Prázdný název' };
      if (!Array.isArray(db.simOperators)) db.simOperators = [];
      if (!db.simOperators.some(o => o.toLowerCase() === n.toLowerCase())) db.simOperators.push(n);
      try { await pushAll(); } catch { /* shown on next sync */ }
      return ok({ operators: db.simOperators });
    },
    getPayoutRules: async () => (await ensure()).payoutRules || [],
    savePayoutRules: async (rules) => {
      await ensure(); const seen = new Set();
      db.payoutRules = (Array.isArray(rules) ? rules : []).filter(r => r && r.platform && !seen.has(r.platform.toLowerCase().trim()) && seen.add(r.platform.toLowerCase().trim()));
      try { await pushAll(); return ok({ rules: db.payoutRules }); } catch (e) { return ok({ rules: db.payoutRules, _cloudError: e.message }); }
    },
    markPayoutPaid: async ({ ticketId, paidOutDate, paidOutAmount }) => {
      await ensure(); const t = db.tickets.find(x => x.id === ticketId); if (!t) return { success: false, error: 'Vstupenka nenalezena' };
      const u = { ...t, paidOut: true, paidOutDate: paidOutDate || new Date().toISOString().slice(0, 10), paidOutAmount: paidOutAmount === '' || paidOutAmount == null ? null : Number(paidOutAmount), updated: new Date().toISOString() };
      const saved = await window.api.upsertTicket(u); return ok({ ticket: saved });
    },
    unmarkPayoutPaid: async (ticketId) => {
      await ensure(); const t = db.tickets.find(x => x.id === ticketId); if (!t) return { success: false, error: 'Vstupenka nenalezena' };
      await window.api.upsertTicket({ ...t, paidOut: false, paidOutDate: null, paidOutAmount: null, updated: new Date().toISOString() }); return ok();
    },
    updateInboxItem: async ({ id, updates }) => {
      await ensure(); const i = (db.inbox || []).findIndex(x => x.id === id); if (i < 0) return { success: false, error: 'Item not found' };
      db.inbox[i] = { ...db.inbox[i], ...updates, _serverAt: new Date().toISOString() };
      try { await pushAll(); return ok(); } catch (e) { return ok({ _cloudError: e.message }); }
    },
    clearResolvedInbox: async () => {
      await ensure(); const before = (db.inbox || []).length;
      db.inbox = (db.inbox || []).filter(i => i.state !== 'approved' && i.state !== 'dismissed');
      try { await pushAll(); } catch { /* ignore */ }
      return ok({ removed: before - db.inbox.length });
    },
    exportJson: async () => { try { const d = await pull(); download(`ticketvault-zaloha-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(d, null, 2), 'application/json'); return ok(); } catch (e) { return fail(e); } },
    importJson: async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return { success: false, canceled: true };
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.tickets)) throw new Error('Soubor neobsahuje vstupenky.');
        const overwrite = window.confirm('Přepsat data na serveru obsahem zálohy?\n\nOK = přepsat, Zrušit = sloučit (přidat jen nové vstupenky).');
        await ensure();
        if (overwrite) db = data;
        else { const have = new Set(db.tickets.map(t => t.id)); data.tickets.forEach(t => { if (!have.has(t.id)) db.tickets.push(t); }); }
        await pushAll();
        return ok({ imported: data.tickets.length, mode: overwrite ? 'overwrite' : 'merge', cloudActive: true, cloudPushed: true });
      } catch (e) { return fail(e); }
    },
    exportCsv: async () => fail(new Error(DESKTOP_ONLY)),
    importCsv: async () => fail(new Error(DESKTOP_ONLY)),
    exportMembershipsCsv: async () => fail(new Error(DESKTOP_ONLY)),
    importMembershipsCsv: async () => fail(new Error(DESKTOP_ONLY)),
    exportExpensesCsv: async () => fail(new Error(DESKTOP_ONLY)),
    importPdf: async () => fail(new Error(DESKTOP_ONLY)),
    fetchEventPage: async () => fail(new Error(DESKTOP_ONLY)),

    // server
    cloudTest: async () => { try { const p = await call('/ping'); return ok({ tickets: (await ensure()).tickets.length, lastModified: p.time }); } catch (e) { return fail(e); } },
    cloudPushAll: async () => { try { await ensure(); await pushAll(); return ok({ count: db.tickets.length }); } catch (e) { return fail(e); } },
    cloudPullAll: async () => { try { await pull(); return ok({ count: db.tickets.length }); } catch (e) { return fail(e); } },
    cloudStatus: async () => ({ enabled: true, configured: !!store.token, apiUrl: API, lastSync: null }),
    ingestStatus: async () => { try { const d = await call('/ingest/status'); return ok({ mailboxes: d.mailboxes || [], model: d.model }); } catch (e) { return fail(e); } },
    openServerFile: async ({ inboxId, name }) => {
      try {
        const res = await call('/files/' + encodeURIComponent(inboxId) + '/' + encodeURIComponent(name), { raw: true });
        const url = URL.createObjectURL(await res.blob());
        window.open(url, '_blank', 'noopener');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        return ok();
      } catch (e) { return fail(e); }
    }
  };
})();
