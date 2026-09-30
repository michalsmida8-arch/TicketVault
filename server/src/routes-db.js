'use strict';
// Data routes used by the desktop app's cloud sync:
//   GET  /db                    whole bucket
//   PUT  /db                    replace bucket (server-side inbox items are preserved)
//   POST /ticket                upsert one ticket
//   DELETE /ticket/:id
//   POST /tickets/bulk-delete   { ids }
// plus ingest helpers:
//   GET  /inbox/raw/:id         original e-mail (.eml) of an inbox item
//   POST /ingest/email          manual/webhook ingest { from, subject, text, html, date }
//   POST /ingest/reprocess/:id  re-run extraction on the stored raw e-mail
//   GET  /ingest/status         mailbox connection state
const express = require('express');
const fs = require('fs');
const { requireAuth } = require('./auth');
const store = require('./store');

const router = express.Router();
router.use(requireAuth);

// ---- protecting server-side ticket changes (auto-applied sales) ------------------
// The ingest marks tickets sold/delivered/paid and stamps them with _serverAt. The
// app may still hold an older copy and push it back (full PUT /db, or POST /ticket
// when the user edits something else). A client copy is "stale" when its `updated`
// is older than the server change; then the server-owned sale fields win.
const SERVER_FIELDS = ['status', 'quantity', 'salePrice', 'saleCurrency', 'saleDate', 'buyerName', 'buyerEmail',
  'deliveredAt', 'paidOut', 'paidOutDate', 'paidOutAmount', 'externalIds', 'notes', 'platform', '_serverAt', 'updated'];
function isStale(client, server) {
  return !!(server && server._serverAt && String(client.updated || client.created || '') < String(server._serverAt));
}
function keepServerFields(client, server) {
  const out = { ...client };
  for (const f of SERVER_FIELDS) { if (f in server) out[f] = server[f]; else delete out[f]; }
  return out;
}
function mergeTickets(serverTickets, clientTickets, pulledAt) {
  const byId = new Map(serverTickets.map(t => [t.id, t]));
  const seen = new Set();
  const out = clientTickets.map(c => {
    seen.add(c.id);
    const s = byId.get(c.id);
    return s && isStale(c, s) ? { ...c, ...keepServerFields(c, s) } : c;
  });
  // Tickets the server created (split rows) after the client last pulled.
  for (const s of serverTickets) {
    if (!seen.has(s.id) && s._serverAt && new Date(s._serverAt).getTime() >= pulledAt) out.push(s);
  }
  return out;
}

// When did each user last pull the DB? PUT /db uses it to decide which server
// inbox items the client could not have known about yet.
const lastPull = new Map();

router.get('/db', (req, res) => {
  const db = store.loadBucket(req.user.dataKey);
  lastPull.set(req.user.id, Date.now());
  res.json(db);
});

router.put('/db', async (req, res) => {
  const incoming = req.body;
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.tickets)) {
    return res.status(400).json({ error: 'Neplatné tělo požadavku (očekávám celou DB).' });
  }
  const pulledAt = lastPull.get(req.user.id) || 0;
  const count = await store.updateBucket(req.user.dataKey, db => {
    const knownIds = new Set((incoming.inbox || []).map(i => i.id));
    // Inbox items the ingest created after the client's last GET are unknown to
    // the client and must survive the full replace. Anything older that the client
    // dropped (clearResolvedInbox) stays dropped.
    // createdAt is server time (set by the ingest), so it compares cleanly with pulledAt.
    const preserved = (db.inbox || []).filter(i =>
      !knownIds.has(i.id) && new Date(i.createdAt || i.receivedAt || 0).getTime() >= pulledAt);
    const merged = store.ensureSchema({ ...incoming });
    merged.inbox = [...(incoming.inbox || []), ...preserved];
    merged.tickets = mergeTickets(db.tickets || [], incoming.tickets, pulledAt);
    merged.created = db.created || merged.created;
    Object.assign(db, merged);
    for (const k of Object.keys(db)) if (!(k in merged)) delete db[k];
    return db.tickets.length;
  });
  res.json({ ok: true, count });
});

router.post('/ticket', async (req, res) => {
  const ticket = req.body;
  if (!ticket || typeof ticket !== 'object') return res.status(400).json({ error: 'Neplatná vstupenka.' });
  const saved = await store.updateBucket(req.user.dataKey, db => {
    const now = new Date().toISOString();
    if (ticket.id) {
      const idx = db.tickets.findIndex(t => t.id === ticket.id);
      if (idx >= 0) {
        const cur = db.tickets[idx];
        const incoming = isStale(ticket, cur) ? keepServerFields(ticket, cur) : ticket;
        db.tickets[idx] = { ...cur, ...incoming, updated: now };
        return db.tickets[idx];
      }
      const t = { ...ticket, created: ticket.created || now }; db.tickets.push(t); return t;
    }
    const t = { ...ticket, id: 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 11), created: now };
    db.tickets.push(t);
    return t;
  });
  res.json({ ok: true, ticket: saved });
});

router.delete('/ticket/:id', async (req, res) => {
  await store.updateBucket(req.user.dataKey, db => { db.tickets = db.tickets.filter(t => t.id !== req.params.id); });
  res.json({ ok: true });
});

router.post('/tickets/bulk-delete', async (req, res) => {
  const ids = new Set((req.body || {}).ids || []);
  await store.updateBucket(req.user.dataKey, db => { db.tickets = db.tickets.filter(t => !ids.has(t.id)); });
  res.json({ ok: true });
});

// ---- ingest helpers ------------------------------------------------------------
router.get('/inbox/raw/:id', (req, res) => {
  const db = store.loadBucket(req.user.dataKey);
  const item = db.inbox.find(i => i.id === req.params.id);
  if (!item || !item.source?.rawPath || !fs.existsSync(item.source.rawPath)) return res.status(404).json({ error: 'Původní e-mail není uložen.' });
  res.type('message/rfc822').send(fs.readFileSync(item.source.rawPath));
});

router.post('/ingest/email', async (req, res) => {
  const { ingestParsedMail } = require('./ingest/pipeline');
  const b = req.body || {};
  if (!b.subject && !b.text && !b.html) return res.status(400).json({ error: 'Chybí obsah e-mailu.' });
  try {
    const r = await ingestParsedMail({
      from: b.from || '', to: b.to || '', subject: b.subject || '', date: b.date ? new Date(b.date) : new Date(),
      text: b.text || '', html: b.html || '', messageId: b.messageId || null, attachments: []
    }, { mailboxName: 'webhook', owner: req.user, dataKey: req.user.dataKey });
    res.json(r);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/ingest/reprocess/:id', async (req, res) => {
  const { reprocessInboxItem } = require('./ingest/pipeline');
  try { res.json(await reprocessInboxItem(req.user, req.params.id)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/ingest/status', (req, res) => {
  const { getStatus } = require('./ingest/imap');
  res.json(getStatus());
});

module.exports = router;
