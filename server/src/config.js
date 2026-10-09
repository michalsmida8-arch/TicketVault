'use strict';
// Central configuration. Everything comes from .env (see .env.example);
// sensible defaults let the server start with nothing but a data directory.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT = path.join(__dirname, '..');
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));

function readOrCreateSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const p = path.join(DATA_DIR, 'jwt-secret.txt');
  try {
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf8').trim();
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const s = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(p, s);
    return s;
  } catch (e) {
    throw new Error('Cannot create JWT secret: ' + e.message);
  }
}

function loadMailboxes() {
  // Mailboxes come from data/mailboxes.json (preferred, editable without restart
  // of .env) or from the MAILBOXES env var (JSON array). Format per entry:
  // { "name": "gmail-michal", "email": "x@gmail.com", "pass": "app password",
  //   "owner": "michal", "host"?: "imap.gmail.com", "port"?: 993 }
  let list = [];
  const file = path.join(DATA_DIR, 'mailboxes.json');
  try {
    if (fs.existsSync(file)) list = JSON.parse(fs.readFileSync(file, 'utf8'));
    else if (process.env.MAILBOXES) list = JSON.parse(process.env.MAILBOXES);
  } catch (e) {
    console.error('[config] mailboxes config unreadable:', e.message);
  }
  if (!Array.isArray(list)) list = [];
  return list.map(normalizeMailbox).filter(Boolean);
}

const HOST_BY_DOMAIN = {
  'gmail.com': 'imap.gmail.com',
  'googlemail.com': 'imap.gmail.com',
  'seznam.cz': 'imap.seznam.cz',
  'email.cz': 'imap.seznam.cz',
  'post.cz': 'imap.seznam.cz',
  'outlook.com': 'outlook.office365.com',
  'hotmail.com': 'outlook.office365.com',
  'icloud.com': 'imap.mail.me.com',
  'centrum.cz': 'imap.centrum.cz',
  'volny.cz': 'imap.volny.cz'
};

function normalizeMailbox(mb) {
  if (!mb || !mb.email || !mb.pass) return null;
  const domain = String(mb.email).split('@')[1]?.toLowerCase() || '';
  const host = mb.host || HOST_BY_DOMAIN[domain];
  if (!host) {
    console.error(`[config] mailbox ${mb.email}: unknown provider, set "host" explicitly`);
    return null;
  }
  return {
    name: mb.name || mb.email,
    email: mb.email,
    user: mb.user || mb.email,
    pass: mb.pass,
    host,
    port: Number(mb.port || 993),
    secure: mb.secure !== false,
    owner: mb.owner || null,          // username whose bucket receives inbox items
    // 'auto' = Gmail "All Mail" (catches mail that filters move out of INBOX), else INBOX
    folder: mb.folder || 'auto',
    enabled: mb.enabled !== false
  };
}

module.exports = {
  ROOT,
  DATA_DIR,
  PORT: Number(process.env.PORT || 8787),
  HOST: process.env.HOST || '0.0.0.0',
  JWT_SECRET: readOrCreateSecret(),
  JWT_DAYS: Number(process.env.JWT_DAYS || 90),
  INVITE_CODE: process.env.INVITE_CODE || '',
  CLAUDE_MODEL: process.env.CLAUDE_MODEL || 'claude-opus-5',
  LLM_ENABLED: process.env.LLM_ENABLED !== 'false',
  // Mails the keyword prefilter can't classify are screened by a cheap model (sender + subject).
  TRIAGE_ENABLED: process.env.TRIAGE_ENABLED !== 'false',
  TRIAGE_MODEL: process.env.TRIAGE_MODEL || 'claude-haiku-4-5',
  INGEST_ENABLED: process.env.INGEST_ENABLED !== 'false',
  INGEST_POLL_MINUTES: Number(process.env.INGEST_POLL_MINUTES || 5),
  INGEST_BACKFILL_DAYS: Number(process.env.INGEST_BACKFILL_DAYS || 30),
  INGEST_PREFILTER: process.env.INGEST_PREFILTER !== 'false',
  // Apply marketplace sale mails (sold / delivered / paid) directly to the inventory
  // when exactly one ticket matches. false = always leave a card in "Příchozí".
  AUTO_APPLY_SALES: process.env.AUTO_APPLY_SALES !== 'false',
  // Complete, high-confidence purchase confirmations go straight into the inventory.
  AUTO_ADD_PURCHASES: process.env.AUTO_ADD_PURCHASES !== 'false',
  AUTO_ADD_MIN_CONFIDENCE: Number(process.env.AUTO_ADD_MIN_CONFIDENCE || 0.9),
  // Digest times (server local hours). The app's settings text promises 8:00 and 18:00.
  DIGEST_HOURS: String(process.env.DIGEST_HOURS || process.env.DIGEST_HOUR || '8,18').split(',').map(h => Number(h.trim())).filter(h => h >= 0 && h < 24),
  SMTP: process.env.SMTP_HOST ? {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== 'false',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || process.env.SMTP_USER
  } : null,
  // Ticket delivery drafts (1.19): Gmail mailbox (name or e-mail from mailboxes.json) whose
  // Drafts folder receives the e-mails to buyers, and the sender name shown on them.
  DELIVERY_MAILBOX: process.env.DELIVERY_MAILBOX || '',
  DELIVERY_FROM_NAME: process.env.DELIVERY_FROM_NAME || 'Michal Šmída',
  loadMailboxes
};
