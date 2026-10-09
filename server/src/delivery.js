'use strict';
// Ticket delivery e-mails (1.19). The app prepares the e-mail to the buyer (SeatLabs
// links + instructions) and the server stores it as a DRAFT in the seller's Gmail
// (IMAP APPEND into the \Drafts folder of DELIVERY_MAILBOX). Nothing is ever sent:
// the user reviews the draft in Gmail and sends it himself.
// The tickets get `delivery` stamped under the bucket lock, so two clients (PC, Mac,
// the server copy of the app) can't create the same draft twice.
const cfg = require('./config');
const store = require('./store');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function senderMailbox() {
  const want = String(cfg.DELIVERY_MAILBOX || '').trim().toLowerCase();
  if (!want) return null;
  return cfg.loadMailboxes().find(m => m.email.toLowerCase() === want || String(m.name).toLowerCase() === want) || null;
}

function composeRaw(mail) {
  const MailComposer = require('nodemailer/lib/mail-composer');
  return new Promise((resolve, reject) => new MailComposer(mail).compile().build((e, msg) => (e ? reject(e) : resolve(msg))));
}

async function appendToDrafts(mb, raw) {
  const { ImapFlow } = require('imapflow');
  const client = new ImapFlow({
    host: mb.host, port: mb.port, secure: mb.secure,
    auth: { user: mb.user, pass: mb.pass },
    logger: false, emitLogs: false,
    clientInfo: { name: 'TicketVault', version: '1.0' }
  });
  await client.connect();
  try {
    const drafts = (await client.list()).find(b => b.specialUse === '\\Drafts');
    if (!drafts) throw new Error(`Ve schránce ${mb.email} chybí složka Koncepty.`);
    const r = await client.append(drafts.path, raw, ['\\Draft', '\\Seen']);
    return { folder: drafts.path, uid: (r && r.uid) || null };
  } finally {
    await client.logout().catch(() => {});
  }
}

let appender = appendToDrafts;
function _setAppender(fn) { appender = fn || appendToDrafts; } // tests

class DeliveryError extends Error {
  constructor(message, status = 400, extra = {}) { super(message); this.status = status; Object.assign(this, extra); }
}

// body: { ticketIds[], to, subject, text, html?, links?: [{ ticketId, ... }], force? }
async function saveDraft(user, body) {
  const b = body || {};
  const ids = Array.isArray(b.ticketIds) ? b.ticketIds.filter(Boolean) : [];
  if (!ids.length) throw new DeliveryError('Chybí vstupenky.');
  if (!EMAIL_RE.test(String(b.to || '').trim())) throw new DeliveryError('Neplatný e-mail kupujícího.');
  if (!String(b.subject || '').trim() || !String(b.text || '').trim()) throw new DeliveryError('Chybí předmět nebo text e-mailu.');
  const mb = senderMailbox();
  if (!mb) throw new DeliveryError('Na serveru není nastavená schránka pro koncepty (DELIVERY_MAILBOX).', 500);

  return store.updateBucket(user.dataKey, async db => {
    const tickets = ids.map(id => db.tickets.find(t => t.id === id));
    const missing = ids.filter((id, i) => !tickets[i]);
    if (missing.length) throw new DeliveryError('Vstupenka nenalezena: ' + missing.join(', '), 404);
    const done = tickets.find(t => t.delivery && t.delivery.draftAt);
    if (done && !b.force) {
      throw new DeliveryError(`Koncept pro ${done.buyerName || done.buyerEmail || 'kupujícího'} už byl vytvořen ${done.delivery.draftAt.slice(0, 16).replace('T', ' ')}.`, 409,
        { duplicate: true, ticketId: done.id, draftAt: done.delivery.draftAt });
    }
    const raw = await composeRaw({
      from: { name: cfg.DELIVERY_FROM_NAME, address: mb.email },
      to: String(b.to).trim(),
      subject: String(b.subject).trim(),
      text: String(b.text),
      html: b.html ? String(b.html) : undefined
    });
    const saved = await appender(mb, raw);
    const now = new Date().toISOString();
    const links = Array.isArray(b.links) ? b.links : [];
    for (const t of tickets) {
      t.delivery = { draftAt: now, to: String(b.to).trim(), subject: String(b.subject).trim(), mailbox: mb.email, folder: saved.folder,
        links: links.filter(l => !l.ticketId || l.ticketId === t.id) };
      t.updated = now;
      t._serverAt = now;
    }
    return { ok: true, draftAt: now, mailbox: mb.email, folder: saved.folder, ticketIds: ids };
  });
}

module.exports = { saveDraft, DeliveryError, composeRaw, _setAppender };
