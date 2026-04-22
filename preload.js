const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Config
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (config) => ipcRenderer.invoke('config:set', config),
  // Auto-updater API. Renderer uses onUpdaterEvent to subscribe to updater
  // lifecycle (checking → available → progress → downloaded → error).
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  installUpdate: () => ipcRenderer.invoke('updater:install'),
  getAppVersion: () => ipcRenderer.invoke('updater:get-version'),
  onUpdaterEvent: (callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on('updater:event', listener);
    // Return unsubscribe for callers that want to clean up.
    return () => ipcRenderer.removeListener('updater:event', listener);
  },
  // Currency-friendly aliases used by settings UI.
  loadConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:set', config),
  fetchExchangeRates: () => ipcRenderer.invoke('currency:fetchRates'),
  autoRefreshExchangeRates: () => ipcRenderer.invoke('currency:autoRefreshIfStale'),
  chooseDbPath: () => ipcRenderer.invoke('config:chooseDbPath'),
  openDbLocation: () => ipcRenderer.invoke('config:openDbLocation'),

  // Auth (multi-user, backend-based)
  authGetState: () => ipcRenderer.invoke('auth:getState'),
  authRegister: (args) => ipcRenderer.invoke('auth:register', args),
  authLogin: (args) => ipcRenderer.invoke('auth:login', args),
  authRecover: (args) => ipcRenderer.invoke('auth:recover', args),
  authLogout: () => ipcRenderer.invoke('auth:logout'),
  authListUsers: () => ipcRenderer.invoke('auth:listUsers'),
  authCreateUser: (args) => ipcRenderer.invoke('auth:createUser', args),
  authDeleteUser: (args) => ipcRenderer.invoke('auth:deleteUser', args),
  authResetUserPassword: (args) => ipcRenderer.invoke('auth:resetUserPassword', args),
  authShareData: (args) => ipcRenderer.invoke('auth:shareData', args),
  authUnshareData: (args) => ipcRenderer.invoke('auth:unshareData', args),
  authChangeOwnPassword: (args) => ipcRenderer.invoke('auth:changeOwnPassword', args),
  authUpdateEmailSettings: (args) => ipcRenderer.invoke('auth:updateEmailSettings', args),
  authTestDigest: () => ipcRenderer.invoke('auth:testDigest'),
  authGetAllowedSenders: () => ipcRenderer.invoke('auth:getAllowedSenders'),
  authAddAllowedSender: (args) => ipcRenderer.invoke('auth:addAllowedSender', args),
  authRemoveAllowedSender: (args) => ipcRenderer.invoke('auth:removeAllowedSender', args),

  // Database
  loadDb: () => ipcRenderer.invoke('db:load'),
  loadLocalDb: () => ipcRenderer.invoke('db:loadLocal'),
  saveDb: (db) => ipcRenderer.invoke('db:save', db),
  syncDb: () => ipcRenderer.invoke('db:sync'),
  upsertTicket: (ticket) => ipcRenderer.invoke('db:upsertTicket', ticket),
  deleteTicket: (id) => ipcRenderer.invoke('db:deleteTicket', id),
  deleteTickets: (ids) => ipcRenderer.invoke('db:deleteTickets', ids),

  // Memberships
  upsertMembership: (m) => ipcRenderer.invoke('db:upsertMembership', m),
  deleteMembership: (id) => ipcRenderer.invoke('db:deleteMembership', id),
  deleteMemberships: (ids) => ipcRenderer.invoke('db:deleteMemberships', ids),
  exportMembershipsCsv: () => ipcRenderer.invoke('db:exportMembershipsCsv'),
  importMembershipsCsv: () => ipcRenderer.invoke('db:importMembershipsCsv'),

  // Expenses
  upsertExpense: (e) => ipcRenderer.invoke('db:upsertExpense', e),
  deleteExpense: (id) => ipcRenderer.invoke('db:deleteExpense', id),
  deleteExpenses: (ids) => ipcRenderer.invoke('db:deleteExpenses', ids),
  exportExpensesCsv: () => ipcRenderer.invoke('db:exportExpensesCsv'),

  // Payouts
  getPayoutRules: () => ipcRenderer.invoke('db:getPayoutRules'),
  savePayoutRules: (rules) => ipcRenderer.invoke('db:savePayoutRules', rules),
  markPayoutPaid: (args) => ipcRenderer.invoke('db:markPayoutPaid', args),
  unmarkPayoutPaid: (ticketId) => ipcRenderer.invoke('db:unmarkPayoutPaid', ticketId),

  // Inbox
  updateInboxItem: (id, updates) => ipcRenderer.invoke('db:updateInboxItem', { id, updates }),
  clearResolvedInbox: () => ipcRenderer.invoke('db:clearResolvedInbox'),

  // Export / Import
  exportJson: () => ipcRenderer.invoke('db:exportJson'),
  importJson: () => ipcRenderer.invoke('db:importJson'),
  exportCsv: () => ipcRenderer.invoke('db:exportCsv'),
  importCsv: () => ipcRenderer.invoke('db:importCsv'),

  // Cloud sync
  cloudTest: (creds) => ipcRenderer.invoke('cloud:test', creds),
  cloudPushAll: () => ipcRenderer.invoke('cloud:pushAll'),
  cloudPullAll: () => ipcRenderer.invoke('cloud:pullAll'),
  cloudStatus: () => ipcRenderer.invoke('cloud:status'),

  // Dialogs
  confirm: (options) => ipcRenderer.invoke('dialog:confirm', options),
  info: (options) => ipcRenderer.invoke('dialog:info', options),

  // App paths
  getPath: () => ipcRenderer.invoke('app:getPath'),

  // Fetch HTML from Viagogo/StubHub (bypasses CORS)
  fetchEventPage: (url) => ipcRenderer.invoke('fetchEventPage', url),

  // Menu events
  onMenuAction: (callback) => {
    ipcRenderer.on('menu:export-db', () => callback('export-db'));
    ipcRenderer.on('menu:import-db', () => callback('import-db'));
    ipcRenderer.on('menu:settings', () => callback('settings'));
  }
});
