'use strict';
// Accounts, JWT tokens and the /auth/* routes the desktop app calls.
// Data model (users.json):
//   id, username, passwordHash, role ('admin'|'user'), dataKey (which bucket the
//   user reads/writes; equals own id unless an admin shared their data),
//   recoveryHash, mailToken, email, digestEnabled, discord*/pushover*,
//   allowedSenders[], createdAt, lastLogin
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cfg = require('./config');
const store = require('./store');

const router = express.Router();

function newId(prefix) { return prefix + '_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }
function newMailToken() { return crypto.randomBytes(6).toString('hex'); }
function newRecoveryCode() { return String(crypto.randomInt(0, 1000000)).padStart(6, '0'); }

function publicUser(u) {
  return {
    id: u.id, username: u.username, role: u.role,
    email: u.email || '', digestEnabled: !!u.digestEnabled,
    discordWebhook: u.discordWebhook || '', discordEnabled: !!u.discordEnabled,
    pushoverUser: u.pushoverUser || '', pushoverToken: u.pushoverToken || '', pushoverEnabled: !!u.pushoverEnabled,
    mailToken: u.mailToken || '', createdAt: u.createdAt, lastLogin: u.lastLogin || null
  };
}

function signToken(u) {
  return jwt.sign({ sub: u.id, username: u.username }, cfg.JWT_SECRET, { expiresIn: `${cfg.JWT_DAYS}d` });
}

// Express middleware: resolves Bearer token -> req.user (full record).
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return res.status(401).json({ error: 'Chybí přihlašovací token.' });
  let payload;
  try { payload = jwt.verify(token, cfg.JWT_SECRET); }
  catch { return res.status(401).json({ error: 'Neplatný nebo expirovaný token.' }); }
  const user = store.loadUsers().find(u => u.id === payload.sub);
  if (!user) return res.status(401).json({ error: 'Uživatel neexistuje.' });
  req.user = user;
  req.tokenIat = payload.iat || 0;
  next();
}
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Jen pro administrátora.' });
  next();
}

function validCreds(username, password) {
  if (!username || !/^[\w.@-]{2,64}$/.test(username)) return 'Uživatelské jméno: 2-64 znaků (písmena, čísla, . _ - @).';
  if (!password || String(password).length < 6) return 'Heslo musí mít alespoň 6 znaků.';
  return null;
}

// ---- brute-force guard -------------------------------------------------------
// The server is reachable from the internet (Cloudflare tunnel), so failed
// logins / recovery codes are limited per client IP and per username.
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS = { ip: 20, user: 8 };
const fails = new Map(); // key -> [timestamps]
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  // Behind cloudflared the TCP peer is loopback; the real client is in CF-Connecting-IP.
  const local = /^(::1|127\.|::ffff:127\.)/.test(remote);
  return (local && req.headers['cf-connecting-ip']) || remote;
}
function recent(key) {
  const now = Date.now();
  const list = (fails.get(key) || []).filter(t => now - t < FAIL_WINDOW_MS);
  if (list.length) fails.set(key, list); else fails.delete(key);
  return list;
}
function guardKeys(req) {
  const name = String((req.body && req.body.username) || '').toLowerCase();
  return [['ip:' + clientIp(req), MAX_FAILS.ip], ...(name ? [['user:' + name, MAX_FAILS.user]] : [])];
}
function blocked(req) { return guardKeys(req).some(([k, max]) => recent(k).length >= max); }
function noteFail(req) { for (const [k] of guardKeys(req)) fails.set(k, [...recent(k), Date.now()]); }
function clearFails(req) { for (const [k] of guardKeys(req)) if (k.startsWith('user:')) fails.delete(k); }
function guard(req, res, next) {
  if (blocked(req)) return res.status(429).json({ error: 'Příliš mnoho neúspěšných pokusů. Zkus to znovu za 15 minut.' });
  next();
}

// ---- register / login / recover -------------------------------------------
router.post('/register', guard, async (req, res) => {
  const { username, password, inviteCode } = req.body || {};
  const err = validCreds(username, password);
  if (err) return res.status(400).json({ error: err });
  const result = await store.updateUsers(async users => {
    const first = users.length === 0;
    if (!first && cfg.INVITE_CODE && inviteCode !== cfg.INVITE_CODE) {
      noteFail(req);
      return { status: 403, error: 'Neplatný pozvánkový kód.' };
    }
    if (users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) {
      return { status: 409, error: 'Uživatelské jméno je obsazené.' };
    }
    const id = newId('u');
    const recoveryCode = newRecoveryCode();
    const u = {
      id, username, role: first ? 'admin' : 'user', dataKey: id,
      passwordHash: await bcrypt.hash(password, 10),
      recoveryHash: await bcrypt.hash(recoveryCode, 10),
      mailToken: newMailToken(), allowedSenders: [],
      createdAt: new Date().toISOString(), lastLogin: new Date().toISOString()
    };
    users.push(u);
    return { user: u, recoveryCode };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  res.json({ token: signToken(result.user), user: publicUser(result.user), recoveryCode: result.recoveryCode });
});

router.post('/login', guard, async (req, res) => {
  const { username, password } = req.body || {};
  const users = store.loadUsers();
  const u = users.find(x => x.username.toLowerCase() === String(username || '').toLowerCase());
  if (!u || !(await bcrypt.compare(String(password || ''), u.passwordHash))) {
    noteFail(req);
    return res.status(401).json({ error: 'Neplatné přihlašovací údaje.' });
  }
  clearFails(req);
  await store.updateUsers(list => { const x = list.find(y => y.id === u.id); if (x) x.lastLogin = new Date().toISOString(); });
  res.json({ token: signToken(u), user: publicUser(u) });
});

router.post('/recover', guard, async (req, res) => {
  const { username, recoveryCode, newPassword } = req.body || {};
  const err = validCreds(username, newPassword);
  if (err) return res.status(400).json({ error: err });
  const out = await store.updateUsers(async users => {
    const u = users.find(x => x.username.toLowerCase() === String(username).toLowerCase());
    if (!u || !u.recoveryHash || !(await bcrypt.compare(String(recoveryCode || ''), u.recoveryHash))) return null;
    const code = newRecoveryCode();
    u.passwordHash = await bcrypt.hash(newPassword, 10);
    u.recoveryHash = await bcrypt.hash(code, 10);
    return { user: u, code };
  });
  if (!out) { noteFail(req); return res.status(401).json({ error: 'Neplatné jméno nebo obnovovací kód.' }); }
  clearFails(req);
  res.json({ token: signToken(out.user), user: publicUser(out.user), newRecoveryCode: out.code });
});

// ---- self-service ---------------------------------------------------------------
router.use(requireAuth);

// Sliding session: a token older than a day is replaced on /me, so an app that is
// opened at least once every JWT_DAYS never gets logged out ("Zapamatovat přihlášení").
router.get('/me', (req, res) => {
  const ageSec = Date.now() / 1000 - (req.tokenIat || 0);
  const out = { user: publicUser(req.user) };
  if (ageSec > 24 * 3600) out.token = signToken(req.user);
  res.json(out);
});

router.post('/change-password', async (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!(await bcrypt.compare(String(oldPassword || ''), req.user.passwordHash))) return res.status(401).json({ error: 'Staré heslo nesouhlasí.' });
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Nové heslo musí mít alespoň 6 znaků.' });
  await store.updateUsers(async users => { const u = users.find(x => x.id === req.user.id); u.passwordHash = await bcrypt.hash(newPassword, 10); });
  res.json({ ok: true });
});

router.post('/email-settings', async (req, res) => {
  const { email, digestEnabled } = req.body || {};
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Neplatný e-mail.' });
  const u = await store.updateUsers(users => { const x = users.find(y => y.id === req.user.id); x.email = email || ''; x.digestEnabled = !!digestEnabled; return x; });
  res.json({ email: u.email, digestEnabled: u.digestEnabled });
});

router.post('/notification-settings', async (req, res) => {
  const b = req.body || {};
  const u = await store.updateUsers(users => {
    const x = users.find(y => y.id === req.user.id);
    x.discordWebhook = String(b.discordWebhook || ''); x.discordEnabled = !!b.discordEnabled;
    x.pushoverUser = String(b.pushoverUser || ''); x.pushoverToken = String(b.pushoverToken || ''); x.pushoverEnabled = !!b.pushoverEnabled;
    return x;
  });
  const p = publicUser(u);
  res.json({ discordWebhook: p.discordWebhook, discordEnabled: p.discordEnabled, pushoverUser: p.pushoverUser, pushoverToken: p.pushoverToken, pushoverEnabled: p.pushoverEnabled });
});

router.get('/allowed-senders', (req, res) => res.json({ senders: req.user.allowedSenders || [] }));
router.post('/allowed-senders/add', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Chybí e-mail.' });
  const u = await store.updateUsers(users => { const x = users.find(y => y.id === req.user.id); x.allowedSenders = [...new Set([...(x.allowedSenders || []), email])]; return x; });
  res.json({ senders: u.allowedSenders });
});
router.post('/allowed-senders/remove', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const u = await store.updateUsers(users => { const x = users.find(y => y.id === req.user.id); x.allowedSenders = (x.allowedSenders || []).filter(e => e !== email); return x; });
  res.json({ senders: u.allowedSenders });
});

router.post('/regenerate-mail-token', async (req, res) => {
  const u = await store.updateUsers(users => { const x = users.find(y => y.id === req.user.id); x.mailToken = newMailToken(); return x; });
  res.json({ mailToken: u.mailToken });
});

router.post('/test-digest', async (req, res) => {
  const { sendDigestForUser } = require('./digest');
  try {
    const r = await sendDigestForUser(req.user, { force: true });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ---- admin: user management ------------------------------------------------------
router.get('/users', requireAdmin, (req, res) => {
  const users = store.loadUsers().map(u => ({
    ...publicUser(u),
    sharesBucketWithViewer: u.dataKey === req.user.dataKey
  }));
  res.json({ users });
});

router.post('/users', requireAdmin, async (req, res) => {
  const { username, password, role, shareMyData } = req.body || {};
  const err = validCreds(username, password);
  if (err) return res.status(400).json({ error: err });
  const out = await store.updateUsers(async users => {
    if (users.some(u => u.username.toLowerCase() === String(username).toLowerCase())) return { error: 'Uživatelské jméno je obsazené.' };
    const id = newId('u');
    const u = {
      id, username, role: role === 'admin' ? 'admin' : 'user',
      dataKey: shareMyData ? req.user.dataKey : id,
      passwordHash: await bcrypt.hash(password, 10), recoveryHash: null,
      mailToken: newMailToken(), allowedSenders: [], createdAt: new Date().toISOString(), lastLogin: null
    };
    users.push(u);
    return { user: u };
  });
  if (out.error) return res.status(409).json({ error: out.error });
  res.json({ user: publicUser(out.user) });
});

router.post('/users/:id/share-data', requireAdmin, async (req, res) => {
  const ok = await store.updateUsers(users => { const t = users.find(u => u.id === req.params.id); if (!t) return false; t.dataKey = req.user.dataKey; return true; });
  if (!ok) return res.status(404).json({ error: 'Uživatel nenalezen.' });
  res.json({ ok: true });
});
router.post('/users/:id/unshare-data', requireAdmin, async (req, res) => {
  const ok = await store.updateUsers(users => { const t = users.find(u => u.id === req.params.id); if (!t) return false; t.dataKey = t.id; return true; });
  if (!ok) return res.status(404).json({ error: 'Uživatel nenalezen.' });
  res.json({ ok: true });
});
router.post('/users/:id/reset-password', requireAdmin, async (req, res) => {
  const { newPassword } = req.body || {};
  if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Heslo musí mít alespoň 6 znaků.' });
  const ok = await store.updateUsers(async users => { const t = users.find(u => u.id === req.params.id); if (!t) return false; t.passwordHash = await bcrypt.hash(newPassword, 10); return true; });
  if (!ok) return res.status(404).json({ error: 'Uživatel nenalezen.' });
  res.json({ ok: true });
});
router.delete('/users/:id', requireAdmin, async (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'Nemůžeš smazat sám sebe.' });
  const ok = await store.updateUsers(users => { const i = users.findIndex(u => u.id === req.params.id); if (i < 0) return false; users.splice(i, 1); return true; });
  if (!ok) return res.status(404).json({ error: 'Uživatel nenalezen.' });
  res.json({ ok: true });
});

module.exports = { router, requireAuth, requireAdmin, publicUser };
