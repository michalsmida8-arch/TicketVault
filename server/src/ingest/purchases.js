'use strict';
// Purchase confirmations -> inventory, mirroring the app's approveInboxItem().
// Only high-confidence, complete extractions are added automatically; anything
// that looks like a duplicate of a ticket already in the inventory stays a card
// with a warning ("possibleDuplicate") so the user decides.
const crypto = require('crypto');
const { words } = require('./sales');

function norm(s) { return String(s || '').replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function newTicketId() { return 't_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex').slice(0, 9); }

const REQUIRED = ['event', 'eventDate', 'quantity'];

// Why a purchase can't be added automatically (null = OK).
function blocker(p, minConfidence) {
  if (!p.success || p.kind !== 'purchase' || p.eventKind !== 'purchase') return 'not-a-purchase';
  for (const f of REQUIRED) if (!p[f]) return 'missing-' + f;
  if (!p.totalAmount && !p.pricePerTicket) return 'missing-price';
  if ((p.confidence ?? 0) < minConfidence) return 'low-confidence';
  return null;
}

// Same order number anywhere on a ticket (any externalIds key, incl. otherId) = certain duplicate.
// Same event date + shared name word + same quantity or same total = possible duplicate.
function findDuplicates(db, p) {
  const key = norm(p.orderId);
  const certain = key ? db.tickets.filter(t => Object.values(t.externalIds || {}).some(v => norm(v) === key)) : [];
  if (certain.length) return { certain, possible: [] };
  if (!p.eventDate || !p.event) return { certain: [], possible: [] };
  const w = words(p.event);
  const total = p.totalAmount || (p.pricePerTicket || 0) * (p.quantity || 1);
  const sameEvent = db.tickets.filter(t => t.eventDate === p.eventDate && [...words(t.eventName)].some(x => w.has(x)));
  // Rows split by sales keep the purchase total spread over rows: compare summed quantities too.
  const sumQty = sameEvent.reduce((s, t) => s + (Number(t.quantity) || 0), 0);
  const possible = sameEvent.filter(t => {
    const q = Number(t.quantity) || 1;
    const tTotal = (Number(t.purchasePrice) || 0) * q;
    return q === Number(p.quantity) || sumQty === Number(p.quantity) || (total && Math.abs(tTotal - total) <= Math.max(1, total * 0.01));
  });
  return { certain: [], possible };
}

function orderKey(platform) {
  const s = String(platform || '').toLowerCase();
  if (s.includes('ticketmaster')) return 'ticketmasterOrderId';
  if (s.includes('viagogo')) return 'viagogoOrderId';
  if (s.includes('stubhub')) return 'stubhubOrderId';
  return 'otherId';
}

function buildTicket(p, mail, receivedAt) {
  const now = new Date().toISOString();
  const qty = Number(p.quantity) || 1;
  const perKs = p.pricePerTicket || (p.totalAmount ? p.totalAmount / qty : 0);
  const t = {
    id: newTicketId(),
    eventName: p.event,
    eventDate: p.eventDate || '',
    eventTime: p.eventTime || '',
    venue: p.venue || '',
    section: p.section || '',
    row: p.row || '',
    seat: p.seat || '',
    quantity: qty,
    account: p.accountEmail || '',
    purchasePlatform: p.platform || '',
    platform: '',
    status: 'available',
    purchaseDate: (receivedAt || now).slice(0, 10),
    purchasePrice: Math.round(perKs * 100) / 100,
    salePrice: 0,
    currency: p.currency || 'EUR',
    category: p.category || 'concert',
    logo: '',
    notes: `Přidáno automaticky z e-mailu (${mail.subject || ''})`,
    externalIds: {},
    created: now, updated: now, _serverAt: now
  };
  if (p.orderId) t.externalIds[orderKey(p.platform)] = p.orderId;
  return t;
}

module.exports = { blocker, findDuplicates, buildTicket };
