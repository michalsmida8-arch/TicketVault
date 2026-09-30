'use strict';
// File-backed storage. Layout under DATA_DIR:
//   users.json                 all accounts (hashed passwords)
//   buckets/<dataKey>.json     one TicketVault DB per data bucket (users can share one)
//   mail/<mailbox>/<uid>.eml   raw e-mails exactly as received (re-processable)
//   state/imap-<mailbox>.json  last processed UID per mailbox
//   state/ingest-log.jsonl     one line per processed e-mail (skipped/created/duplicate)
// Writes are atomic (tmp + rename) and serialized per file through a mutex, so a
// PUT /db from the app and an inbox insert from the ingest never interleave.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

for (const d of ['buckets', 'mail', 'state', 'backups']) {
  fs.mkdirSync(path.join(DATA_DIR, d), { recursive: true });
}

// ---- tiny per-key mutex --------------------------------------------------
const locks = new Map();
async function withLock(key, fn) {
  const prev = locks.get(key) || Promise.resolve();
  let release;
  const next = new Promise(r => { release = r; });
  locks.set(key, prev.then(() => next));
  await prev;
  try { return await fn(); }
  finally {
    release();
    if (locks.get(key) === next) locks.delete(key);
  }
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.error(`[store] cannot read ${file}: ${e.message}`);
    // Try the .bak copy before giving up
    try {
      if (fs.existsSync(file + '.bak')) return JSON.parse(fs.readFileSync(file + '.bak', 'utf8'));
    } catch { /* ignore */ }
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  fs.renameSync(tmp, file);
}

// ---- users -----------------------------------------------------------------
const USERS_FILE = path.join(DATA_DIR, 'users.json');
function loadUsers() { return readJson(USERS_FILE, { users: [] }).users || []; }
function saveUsers(users) { writeJson(USERS_FILE, { users }); }
function updateUsers(fn) { return withLock('users', async () => { const u = loadUsers(); const r = await fn(u); saveUsers(u); return r; }); }

// ---- buckets (TicketVault DBs) ----------------------------------------------
function defaultDb() {
  return {
    version: 1,
    created: new Date().toISOString(),
    tickets: [], accounts: [], events: [], memberships: [], mailboxes: [], simcards: [],
    simOperators: ['T-Mobile', 'O2', 'Vodafone', 'Kaktus'],
    expenses: [],
    payoutRules: [
      { platform: 'Viagogo', baseDate: 'eventDate', offsetDays: 8 },
      { platform: 'Stubhub', baseDate: 'deliveryDate', offsetDays: 3 },
      { platform: 'TicketMaster', baseDate: 'eventDate', offsetDays: 7 }
    ],
    inbox: [],
    users: []
  };
}

function ensureSchema(db) {
  const d = defaultDb();
  for (const k of Object.keys(d)) {
    if (db[k] === undefined || db[k] === null) db[k] = d[k];
  }
  for (const k of ['tickets', 'accounts', 'events', 'memberships', 'mailboxes', 'simcards', 'expenses', 'inbox', 'users']) {
    if (!Array.isArray(db[k])) db[k] = [];
  }
  return db;
}

function bucketFile(dataKey) {
  return path.join(DATA_DIR, 'buckets', `${String(dataKey).replace(/[^\w.-]/g, '_')}.json`);
}
function loadBucket(dataKey) { return ensureSchema(readJson(bucketFile(dataKey), defaultDb())); }
function saveBucket(dataKey, db) {
  db.lastModified = new Date().toISOString();
  writeJson(bucketFile(dataKey), db);
  rotateBackup(dataKey);
}
function updateBucket(dataKey, fn) {
  return withLock('bucket:' + dataKey, async () => {
    const db = loadBucket(dataKey);
    const r = await fn(db);
    saveBucket(dataKey, db);
    return r;
  });
}

// Daily backup copy per bucket, keep the last 14.
function rotateBackup(dataKey) {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(DATA_DIR, 'backups');
    const target = path.join(dir, `${dataKey}-${day}.json`);
    if (!fs.existsSync(target)) fs.copyFileSync(bucketFile(dataKey), target);
    const mine = fs.readdirSync(dir).filter(f => f.startsWith(dataKey + '-')).sort();
    while (mine.length > 14) fs.unlinkSync(path.join(dir, mine.shift()));
  } catch (e) { console.error('[store] backup failed:', e.message); }
}

// ---- ingest state ------------------------------------------------------------
function stateFile(name) { return path.join(DATA_DIR, 'state', `imap-${name.replace(/[^\w.-]/g, '_')}.json`); }
function loadImapState(name) { return readJson(stateFile(name), { lastUid: 0, uidValidity: null }); }
function saveImapState(name, st) { writeJson(stateFile(name), st); }

function rawMailPath(mailboxName, uid) {
  const dir = path.join(DATA_DIR, 'mail', mailboxName.replace(/[^\w.-]/g, '_'));
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${uid}.eml`);
}
function saveRawMail(mailboxName, uid, buffer) {
  const p = rawMailPath(mailboxName, uid);
  fs.writeFileSync(p, buffer);
  return p;
}

function appendIngestLog(entry) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, 'state', 'ingest-log.jsonl'),
      JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  } catch (e) { console.error('[store] ingest log failed:', e.message); }
}

module.exports = {
  withLock, readJson, writeJson,
  loadUsers, saveUsers, updateUsers,
  defaultDb, ensureSchema, loadBucket, saveBucket, updateBucket,
  loadImapState, saveImapState, saveRawMail, rawMailPath, appendIngestLog
};
