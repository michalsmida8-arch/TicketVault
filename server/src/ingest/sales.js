'use strict';
// Server-side application of marketplace sale e-mails to the inventory, mirroring
// what the desktop app does when you click "Označit prodané" (applyInboxSale),
// "Doručeno" (markDelivered) and "Přišlo" (markPayoutPaid):
//   sold      -> ticket.status = 'sold', salePrice, saleDate, orderId; split row on partial sale
//   delivered -> ticket.status = 'delivered', deliveredAt
//   paid      -> paidOut, paidOutDate, paidOutAmount
// It only acts when exactly one ticket matches. Anything ambiguous stays a card
// in "Příchozí" for manual review.
const crypto = require('crypto');

const STOP = new Set(['vs', 'v', 'fc', 'the', 'and', 'tickets', 'ticket', 'match', 'league', 'cup', 'rb', 'sc', 'afc', 'cf',
  'nations', 'friendly', 'game', 'tour', 'live', 'concert', 'united', 'city', 'club', 'real', 'sport', 'sportverein', 'ssc']);
function words(s) {
  return new Set(String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)));
}
function norm(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function today() { return new Date().toISOString().slice(0, 10); }
function newTicketId() { return 't_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex').slice(0, 9); }

function orderKey(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('viagogo')) return 'viagogoOrderId';
  if (p.includes('stubhub')) return 'stubhubOrderId';
  if (p.includes('ticketmaster')) return 'ticketmasterOrderId';
  if (p.includes('syncseats')) return 'syncseatsOrderId';
  return 'otherId';
}
function listingKey(platform) {
  const p = String(platform || '').toLowerCase();
  if (p.includes('viagogo')) return 'viagogoListingId';
  if (p.includes('stubhub')) return 'stubhubListingId';
  return null;
}

const OPEN = new Set(['available', 'listed', 'pending', undefined, null, '']);

// Tickets already carrying this sale's order number (sold earlier by us or by hand).
function findByOrder(db, p) {
  if (!p.orderId) return [];
  const key = norm(p.orderId);
  return db.tickets.filter(t => Object.entries(t.externalIds || {}).some(([k, v]) => /OrderId$/i.test(k) && norm(v) === key));
}

// Unsold tickets that this sale could belong to. Returns { match, candidates, by }.
function findOpenTicket(db, p) {
  const open = db.tickets.filter(t => OPEN.has(t.status));
  // 1) exact IDs, same rules as the app's findMatchesForSale
  const lk = listingKey(p.platform);
  const ids = [p.listingId, p.orderId].filter(Boolean).map(norm);
  if (ids.length) {
    const byId = open.filter(t => {
      const e = t.externalIds || {};
      return (lk && e[lk] && ids.includes(norm(e[lk]))) || (e[orderKey(p.platform)] && ids.includes(norm(e[orderKey(p.platform)])));
    });
    if (byId.length === 1) return { match: byId[0], candidates: byId, by: 'id' };
    if (byId.length > 1) return { match: null, candidates: byId, by: 'id-ambiguous' };
  }
  // 2) same event date + shared team/artist word + enough quantity
  if (!p.eventDate || !p.event) return { match: null, candidates: [], by: 'no-event-data' };
  const w = words(p.event);
  const qty = Number(p.quantity) || 1;
  let c = open.filter(t => t.eventDate === p.eventDate && [...words(t.eventName)].some(x => w.has(x)) && (Number(t.quantity) || 1) >= qty);
  if (c.length > 1) {
    // tie-breakers: listed on the same marketplace, then exact quantity, then section
    const plat = String(p.platform || '').toLowerCase();
    const onPlat = c.filter(t => String(t.platform || '').toLowerCase().includes(plat) && plat);
    if (onPlat.length >= 1) c = onPlat;
  }
  if (c.length > 1) { const exact = c.filter(t => (Number(t.quantity) || 1) === qty); if (exact.length >= 1) c = exact; }
  if (c.length > 1 && p.section) { const sec = c.filter(t => norm(t.section) && norm(t.section) === norm(p.section)); if (sec.length === 1) c = sec; }
  if (c.length === 1) return { match: c[0], candidates: c, by: 'event+date' };
  return { match: null, candidates: c, by: c.length ? 'ambiguous' : 'none' };
}

// Mark sold (with split), exactly like applyInboxSale in the app.
function markSold(db, ticket, p, when) {
  const emailQty = Number(p.quantity) || 1;
  const ticketQty = Number(ticket.quantity) || 1;
  const perKs = p.totalAmount && emailQty ? p.totalAmount / emailQty : (p.pricePerTicket || 0);
  const purchaseCcy = ticket.currency || p.currency || 'EUR';
  const emailCcy = p.currency || purchaseCcy;
  let saleNote = '';
  if (p.grossSubtotal && p.totalAmount && p.grossSubtotal !== p.totalAmount) {
    const fee = +(p.grossSubtotal - p.totalAmount).toFixed(2);
    saleNote = `Prodej z ${p.platform}: kupující zaplatil ${p.grossSubtotal}, tobě přišlo ${p.totalAmount} (provize ${fee}, ${((fee / p.grossSubtotal) * 100).toFixed(1)}%)`;
  }
  const now = new Date().toISOString();
  const sold = {
    ...ticket,
    quantity: Math.min(emailQty, ticketQty),
    status: 'sold',
    salePrice: +perKs.toFixed(2),
    currency: purchaseCcy,
    saleCurrency: emailCcy !== purchaseCcy ? emailCcy : (ticket.saleCurrency || undefined),
    saleDate: when || today(),
    buyerName: p.buyerName || ticket.buyerName,
    buyerEmail: p.buyerEmail || ticket.buyerEmail,
    externalIds: { ...(ticket.externalIds || {}) },
    updated: now, _serverAt: now
  };
  if (p.orderId) sold.externalIds[orderKey(p.platform)] = p.orderId;
  if (!sold.platform || /^other$/i.test(sold.platform)) sold.platform = p.platform;
  const notes = [ticket.notes, saleNote, 'Označeno automaticky z e-mailu'];
  let remainingId = null;
  if (emailQty < ticketQty) {
    notes.push(`Rozděleno: ${emailQty} z ${ticketQty} ks prodáno (z emailu)`);
    const { id, created, updated, _serverAt, ...rest } = ticket; // eslint-disable-line no-unused-vars
    const remaining = {
      ...rest, id: newTicketId(), created: now, updated: now, _serverAt: now,
      quantity: ticketQty - emailQty, status: ticket.status || 'available', salePrice: 0, saleDate: null,
      buyerName: undefined, buyerEmail: undefined,
      notes: [ticket.notes, `Zbylo z původních ${ticketQty} ks (prodáno ${emailQty})`].filter(Boolean).join(' | ')
    };
    db.tickets.push(remaining);
    remainingId = remaining.id;
  }
  sold.notes = notes.filter(Boolean).join(' | ');
  db.tickets[db.tickets.findIndex(t => t.id === ticket.id)] = sold;
  return { ticketId: sold.id, remainingId };
}

// Entry point. Runs inside the bucket lock (caller passes the live db object).
// Returns { applied: true, action, ticketId, ... } or { applied: false, reason, candidates }.
function applySale(db, p, mailDate) {
  const when = (mailDate ? new Date(mailDate) : new Date()).toISOString().slice(0, 10);
  const byOrder = findByOrder(db, p);
  const stage = p.saleStage || 'sold';

  if (stage === 'sold') {
    if (byOrder.length) return { applied: false, reason: 'already-sold', duplicate: true, ticketId: byOrder[0].id };
    const r = findOpenTicket(db, p);
    if (!r.match) return { applied: false, reason: r.by, candidates: r.candidates.map(t => t.id) };
    const s = markSold(db, r.match, p, when);
    return { applied: true, action: 'sold', by: r.by, ...s };
  }

  // delivered / paid: the ticket should already be sold with this order number.
  let target = byOrder.length === 1 ? byOrder[0] : null;
  let soldNow = null;
  if (!target && byOrder.length === 0) {
    // The "sold" mail was missed or not applied: sell it now, then continue.
    const r = findOpenTicket(db, p);
    if (!r.match) return { applied: false, reason: 'no-sold-ticket:' + r.by, candidates: r.candidates.map(t => t.id) };
    soldNow = markSold(db, r.match, p, when);
    target = db.tickets.find(t => t.id === soldNow.ticketId);
  }
  if (!target) return { applied: false, reason: 'order-on-multiple-tickets', candidates: byOrder.map(t => t.id) };
  const idx = db.tickets.findIndex(t => t.id === target.id);
  const now = new Date().toISOString();

  if (stage === 'delivered') {
    if (target.status === 'delivered') return { applied: false, reason: 'already-delivered', duplicate: true, ticketId: target.id };
    db.tickets[idx] = { ...target, status: 'delivered', deliveredAt: mailDate ? new Date(mailDate).toISOString() : now, updated: now, _serverAt: now };
    return { applied: true, action: soldNow ? 'sold+delivered' : 'delivered', ticketId: target.id };
  }
  if (stage === 'paid') {
    if (target.paidOut) return { applied: false, reason: 'already-paid', duplicate: true, ticketId: target.id };
    db.tickets[idx] = {
      ...target, paidOut: true, paidOutDate: when,
      paidOutAmount: p.totalAmount != null ? Number(p.totalAmount) : null,
      status: target.status === 'sold' ? 'delivered' : target.status,   // paid implies delivered
      deliveredAt: target.deliveredAt || (target.status === 'sold' ? now : target.deliveredAt),
      updated: now, _serverAt: now
    };
    return { applied: true, action: soldNow ? 'sold+paid' : 'paid', ticketId: target.id };
  }
  return { applied: false, reason: 'unknown-stage' };
}

module.exports = { applySale, findOpenTicket, words };
