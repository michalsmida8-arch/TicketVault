'use strict';
// The ingest pipeline for one e-mail:
//   prefilter -> dedupe by Message-ID -> deterministic parsers -> Claude fallback
//   -> dedupe by platform+orderId -> inbox item in the owner's bucket -> notify
// Every decision is appended to state/ingest-log.jsonl so nothing disappears silently.
const crypto = require('crypto');
const fs = require('fs');
const { simpleParser } = require('mailparser');
const cfg = require('../config');
const store = require('../store');
const parsers = require('./parsers');
const llm = require('./llm');
const notify = require('../notify');
const sales = require('./sales');

const Anthropic = require('@anthropic-ai/sdk');
function isRetryable(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return true; // fix key, then retry
  if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.APIConnectionError) return true;
  if (e instanceof Anthropic.InternalServerError) return true;
  if (e instanceof Anthropic.APIError && (e.status === 529 || e.status >= 500)) return true;
  if (/api key|apiKey|authentication/i.test(e.message || '')) return true;
  return false;
}

const STOP = new Set(['vs', 'v', 'fc', 'the', 'and', 'tickets', 'ticket', 'match', 'league', 'cup', 'rb', 'sc', 'afc', 'cf']);
function words(s) { return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w))); }
function findSameEvent(db, parsed) {
  const w = words(parsed.event);
  const shares = (name) => [...words(name)].some(x => w.has(x));
  const t = db.tickets.find(x => x.eventDate === parsed.eventDate && shares(x.eventName));
  if (t) return { type: 'ticket', id: t.id, by: 'event+date' };
  const i = db.inbox.find(x => x.parsed?.eventDate === parsed.eventDate && shares(x.parsed?.event));
  if (i) return { type: 'inbox', id: i.id, by: 'event+date' };
  return null;
}

function newInboxId() { return 'in_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'); }
function normOrder(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }

// Turn a raw RFC822 buffer into the plain mail object the rest of the pipeline uses.
async function parseRaw(buffer) {
  const p = await simpleParser(buffer);
  return {
    from: p.from?.text || '',
    to: p.to?.text || '',
    subject: p.subject || '',
    date: p.date || new Date(),
    text: p.text || '',
    html: typeof p.html === 'string' ? p.html : '',
    messageId: p.messageId || null,
    attachments: (p.attachments || []).map(a => ({ filename: a.filename, contentType: a.contentType, content: a.content }))
  };
}

// Map an extraction (deterministic or LLM) to the `parsed` object the desktop app renders.
function toParsed(x, mail) {
  const platform = parsers.canonicalPlatform(x.platform || '') || parsers.detectPlatform(mail.from, mail.subject) || null;
  // Hard rule: mail from a marketplace where we sell (Stubhub, Viagogo, SyncSeats)
  // is always a sale, whatever the model said. Cancellations/refunds stay as they are.
  const fromMarketplace = parsers.isSalePlatform(platform) || parsers.isSalePlatform(parsers.detectPlatform(mail.from, ''));
  if (fromMarketplace && ['purchase', 'delivery', 'sale', 'other', 'transfer'].includes(x.kind) && x.relevant !== false) {
    x = { ...x, kind: 'sale' };
  }
  // A marketplace cancellation of OUR sale: handled as a sale stage so it can be reverted.
  if (fromMarketplace && x.kind === 'cancellation' && x.relevant !== false) {
    x = { ...x, kind: 'sale', _cancel: true };
  }
  const purchaseKinds = ['purchase', 'delivery'];
  const kind = x.kind === 'sale' ? 'sale' : (purchaseKinds.includes(x.kind) ? 'purchase' : x.kind);
  const p = {
    success: true,
    kind,
    eventKind: x.kind,
    saleStage: kind === 'sale' ? (x._cancel ? 'cancelled' : parsers.saleStage(mail.subject)) : null,
    listingId: x.listingId || null,
    platform: fromMarketplace ? (parsers.canonicalPlatform(platform) || parsers.detectPlatform(mail.from, '')) : platform,
    event: x.event || null,
    eventDate: x.eventDate || null,
    eventTime: x.eventTime || null,
    venue: x.venue || null,
    section: x.section || null,
    row: x.row || null,
    seat: x.seat || null,
    quantity: x.quantity || null,
    pricePerTicket: x.pricePerTicket || null,
    totalAmount: x.totalAmount || null,
    grossSubtotal: x.grossSubtotal || null,
    currency: x.currency || null,
    orderId: x.orderId || null,
    purchaseDate: x.purchaseDate || null,
    buyerName: x.buyerName || null,
    buyerEmail: x.buyerEmail || null,
    accountEmail: x.accountEmail || mail.to || null,
    confidence: x.confidence ?? null,
    parser: x.parser || 'llm',
    notes: x.notes || null
  };
  if (kind === 'sale') {
    p.saleType = 'sold';
    // Sale price per ticket = our net payout per ticket (the app uses pricePerTicket first).
    if (p.totalAmount && p.quantity) p.pricePerTicket = Math.round((p.totalAmount / p.quantity) * 100) / 100;
  }
  if (x.kind === 'cancellation' || x.kind === 'refund' || x.kind === 'transfer' || x.kind === 'other') {
    // The app has no card for these; show them as "needs attention" with context.
    p.success = false;
    p.kind = x.kind === 'other' ? 'purchase' : x.kind;
    p.error = { cancellation: 'Zrušení objednávky', refund: 'Refundace', transfer: 'Transfer vstupenek', other: 'Nerozpoznaný typ' }[x.kind]
      + (x.orderId ? ` (obj. ${x.orderId})` : '') + (x.event ? ` – ${x.event}` : '') + (x.notes ? `: ${x.notes}` : '');
  }
  return p;
}

// Core: process one already-parsed mail object into the owner's bucket.
// ctx: { mailboxName, owner (user record), dataKey, uid?, rawPath? }
async function ingestParsedMail(mail, ctx) {
  const log = (entry) => store.appendIngestLog({ mailbox: ctx.mailboxName, uid: ctx.uid || null, from: mail.from, subject: mail.subject, messageId: mail.messageId, ...entry });

  // 1) Message-ID dedupe (a forward + the original, or a reconnect re-fetch)
  if (mail.messageId) {
    const db = store.loadBucket(ctx.dataKey);
    if (db.inbox.some(i => i.messageId === mail.messageId)) { log({ result: 'duplicate-message-id' }); return { result: 'duplicate-message-id' }; }
  }

  // 2) Prefilter
  const pre = parsers.prefilter(mail);
  if (cfg.INGEST_PREFILTER && !pre.pass) { log({ result: 'skipped', reason: pre.reason }); return { result: 'skipped', reason: pre.reason }; }

  // 3) Deterministic parsers, then Claude
  let extraction = await parsers.runDeterministicParsers(mail);
  let usage = null;
  if (!extraction) {
    if (!cfg.LLM_ENABLED) { log({ result: 'skipped', reason: 'llm-disabled' }); return { result: 'skipped', reason: 'llm-disabled' }; }
    try {
      const r = await llm.extractFromMail(mail);
      extraction = r.data; usage = r.usage;
    } catch (e) {
      log({ result: 'error', error: e.message });
      // Transient / config problems (no key, rate limit, overload, network): do NOT
      // consume the mail. The IMAP worker keeps the checkpoint and retries later.
      if (isRetryable(e)) { const err = new Error('retryable: ' + e.message); err.retryable = true; throw err; }
      // Keep it visible: an error card in the inbox is better than silence.
      extraction = { relevant: true, kind: 'other', confidence: 0, notes: 'Extrakce selhala: ' + e.message };
    }
  }
  if (extraction.relevant === false) { log({ result: 'irrelevant', platform: pre.platform, usage }); return { result: 'irrelevant' }; }

  const parsed = toParsed(extraction, mail);

  // 4a) Marketplace sales: apply straight to the inventory when exactly one ticket matches.
  if (parsed.success && parsed.kind === 'sale') return ingestSale(mail, parsed, ctx, usage, log);

  // 4) Order-ID dedupe: same platform + order already in inbox or already a ticket.
  let dupOf = null;
  if (parsed.orderId) {
    const db = store.loadBucket(ctx.dataKey);
    const key = normOrder(parsed.orderId);
    const plat = (parsed.platform || '').toLowerCase();
    const inInbox = db.inbox.find(i => normOrder(i.parsed?.orderId) === key && (i.parsed?.platform || '').toLowerCase() === plat);
    // Only *OrderId keys: a listing ID on an unsold ticket must not make a "sold" mail a duplicate.
    const inTickets = db.tickets.find(t => Object.entries(t.externalIds || {})
      .some(([k, v]) => /OrderId$/i.test(k) && normOrder(v) === key));
    dupOf = inInbox ? { type: 'inbox', id: inInbox.id } : inTickets ? { type: 'ticket', id: inTickets.id } : null;
  }
  // Deliveries without an order number (e.g. "mobile tickets available"): match by
  // event date + a shared significant word in the event name.
  if (!dupOf && parsed.eventKind === 'delivery' && parsed.eventDate && parsed.event) {
    dupOf = findSameEvent(store.loadBucket(ctx.dataKey), parsed);
  }
  if (dupOf && ['delivery', 'purchase', 'sale'].includes(parsed.eventKind)) {
    log({ result: 'duplicate-order', kind: parsed.eventKind, dupOf });
    return { result: 'duplicate-order', dupOf };
  }

  // 5) Write the inbox item
  const item = {
    id: newInboxId(),
    state: 'pending_review',
    receivedAt: (mail.date ? new Date(mail.date) : new Date()).toISOString(),
    createdAt: new Date().toISOString(),
    from: mail.from, to: mail.to, subject: mail.subject, messageId: mail.messageId || null,
    parsed,
    source: { mailbox: ctx.mailboxName, uid: ctx.uid || null, rawPath: ctx.rawPath || null, model: usage ? cfg.CLAUDE_MODEL : null, usage },
    relatedTo: dupOf
  };
  await store.updateBucket(ctx.dataKey, db => { db.inbox.push(item); });
  log({ result: 'created', inboxId: item.id, kind: parsed.kind, platform: parsed.platform, orderId: parsed.orderId, confidence: parsed.confidence, parser: parsed.parser, usage });

  // 6) Notify the owner (instant, one line)
  if (ctx.owner) {
    const price = parsed.totalAmount ? ` ${parsed.totalAmount} ${parsed.currency || ''}` : '';
    const title = parsed.success
      ? `${parsed.kind === 'sale' ? ({ sold: '💰 Prodáno', delivered: '📦 Doručeno kupci', paid: '💶 Výplata' }[parsed.saleStage] || '💰 Prodej') : '🛒 Nákup'}: ${parsed.event || mail.subject}${price}`
      : `⚠ Ke kontrole: ${mail.subject}`;
    notify.pushToUser(ctx.owner, title, `${parsed.platform || '—'} · ${parsed.quantity || '?'} ks · ${parsed.eventDate || '?'}\nSchránka: ${ctx.mailboxName}`)
      .catch(e => console.warn('[notify]', e.message));
  }
  return { result: 'created', item };
}

const STAGE_TITLE = { sold: '💰 Prodáno', delivered: '📦 Doručeno kupci', paid: '💶 Výplata' };
const ACTION_TEXT = {
  sold: 'označeno jako prodané', delivered: 'označeno jako doručené', paid: 'výplata označena jako přijatá',
  'sold+delivered': 'označeno jako prodané a doručené', 'sold+paid': 'označeno jako prodané a vyplacené',
  'already-delivered': 'už bylo doručené, doplněno číslo objednávky',
  cancelled: 'prodej zrušen, vstupenka vrácena do prodeje', 'cancelled-merged': 'prodej zrušen, kusy vráceny do původního řádku'
};
STAGE_TITLE.cancelled = '↩️ Prodej zrušen';

async function ingestSale(mail, parsed, ctx, usage, log) {
  const item = {
    id: newInboxId(),
    state: 'pending_review',
    receivedAt: (mail.date ? new Date(mail.date) : new Date()).toISOString(),
    createdAt: new Date().toISOString(),
    from: mail.from, to: mail.to, subject: mail.subject, messageId: mail.messageId || null,
    parsed,
    source: { mailbox: ctx.mailboxName, uid: ctx.uid || null, rawPath: ctx.rawPath || null, model: usage ? cfg.CLAUDE_MODEL : null, usage },
    _serverAt: new Date().toISOString()
  };
  const outcome = await store.updateBucket(ctx.dataKey, db => {
    // Same order + same stage already recorded -> duplicate mail.
    const key = normOrder(parsed.orderId);
    if (key && db.inbox.some(i => normOrder(i.parsed?.orderId) === key && (i.parsed?.saleStage || 'sold') === parsed.saleStage && i.parsed?.kind === 'sale')) {
      return { duplicate: true, reason: 'inbox-same-order-stage' };
    }
    if (!cfg.AUTO_APPLY_SALES) { db.inbox.push(item); return { applied: false, reason: 'auto-apply-off' }; }
    const r = sales.applySale(db, parsed, mail.date);
    if (r.duplicate) return r;
    if (r.applied) {
      item.state = 'approved';
      item.resolvedAt = new Date().toISOString();
      item.autoApplied = { action: r.action, ticketId: r.ticketId, remainingId: r.remainingId || null, by: r.by || 'order' };
    } else {
      item.suggestedTicketIds = r.candidates || [];
      item.autoApplyReason = r.reason;
    }
    db.inbox.push(item);
    return r;
  });
  if (outcome.duplicate) {
    log({ result: 'duplicate-order', kind: 'sale', stage: parsed.saleStage, reason: outcome.reason, ticketId: outcome.ticketId });
    return { result: 'duplicate-order', reason: outcome.reason };
  }
  log({ result: outcome.applied ? 'applied' : 'created', inboxId: item.id, kind: 'sale', stage: parsed.saleStage, platform: parsed.platform,
    orderId: parsed.orderId, action: outcome.action, reason: outcome.reason, ticketId: outcome.ticketId, usage });

  if (ctx.owner) {
    const price = parsed.totalAmount ? ` ${parsed.totalAmount} ${parsed.currency || ''}` : '';
    const title = `${STAGE_TITLE[parsed.saleStage] || '💰 Prodej'}: ${parsed.event || mail.subject}${price}`;
    const status = outcome.applied
      ? `✅ Automaticky ${ACTION_TEXT[outcome.action] || outcome.action}`
      : `👀 Nespárováno (${outcome.reason}), zkontroluj v Příchozích`;
    notify.pushToUser(ctx.owner, title, `${status}\n${parsed.platform || '—'} · ${parsed.quantity || '?'} ks · ${parsed.eventDate || '?'}`)
      .catch(e => console.warn('[notify]', e.message));
  }
  return { result: outcome.applied ? 'applied' : 'created', item, outcome };
}

// Entry point used by the IMAP client: raw buffer + mailbox context.
async function ingestRaw(buffer, ctx) {
  const mail = await parseRaw(buffer);
  return ingestParsedMail(mail, ctx);
}

// Re-run the whole extraction for one inbox item from its stored .eml
// (after improving parsers/prompt or adding examples). Replaces `parsed`,
// keeps user overrides and state.
async function reprocessInboxItem(user, inboxId) {
  const db = store.loadBucket(user.dataKey);
  const item = db.inbox.find(i => i.id === inboxId);
  if (!item) throw new Error('Položka nenalezena.');
  if (!item.source?.rawPath || !fs.existsSync(item.source.rawPath)) throw new Error('Původní e-mail není uložen.');
  const mail = await parseRaw(fs.readFileSync(item.source.rawPath));
  let extraction = await parsers.runDeterministicParsers(mail);
  if (!extraction) extraction = (await llm.extractFromMail(mail)).data;
  const parsed = toParsed(extraction, mail);
  await store.updateBucket(user.dataKey, d => { const it = d.inbox.find(i => i.id === inboxId); if (it) { it.parsed = parsed; it.reprocessedAt = new Date().toISOString(); } });
  store.appendIngestLog({ result: 'reprocessed', inboxId, parsed });
  return { ok: true, parsed };
}

module.exports = { ingestRaw, ingestParsedMail, parseRaw, reprocessInboxItem, toParsed };
