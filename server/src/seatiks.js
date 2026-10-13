'use strict';
// Seatiks (1.20) — broker platform that publishes one listing on ~20 marketplaces.
// Seller API: https://api.seatiks.com/v1 (Bearer stk_test_… sandbox / stk_live_…), spec at /v1/openapi.json.
// The key lives only here, on the user record (users.json, never sent back to the app).
//   - listing from the inventory: POST /v1/listings (idempotent per ticket), ticket → status listed
//   - sales: polled every 5 minutes (GET /v1/sales) and fed through the normal sale ingest
//     (inbox card + auto-apply by listing id + notifications + delivery drafts in the app).
const cfg = require('./config');
const store = require('./store');

const BASE = 'https://api.seatiks.com/v1';
const POLL_MINUTES = 5;

class SeatiksError extends Error {
  constructor(message, status = 502, code = null) { super(message); this.status = status; this.code = code; }
}

function keyOf(user) { return (user && user.seatiksKey) || process.env.SEATIKS_KEY || ''; }
const hint = key => key ? key.slice(0, 9) + '…' + key.slice(-4) : '';

async function api(key, method, path, body, query) {
  if (!key) throw new SeatiksError('Seatiks API klíč není nastavený (Nastavení → Seatiks).', 400, 'no_key');
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res;
  try {
    res = await fetch(BASE + path + qs, {
      method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
    });
  } catch (e) { throw new SeatiksError('Seatiks nedostupný: ' + e.message, 502, 'network'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    throw new SeatiksError(`Seatiks ${res.status}: ${err.message || err.code || 'chyba'}`, res.status === 401 || res.status === 403 ? 400 : 502, err.code || null);
  }
  return data;
}

// ---- key management ------------------------------------------------------------------
async function status(user) {
  const key = keyOf(user);
  if (!key) return { configured: false };
  try {
    const me = await api(key, 'GET', '/me');
    return { configured: true, hint: hint(key), mode: me.mode, scopes: me.scopes || [], kyc: me.kyc_status || null, currency: me.default_currency || 'EUR' };
  } catch (e) { return { configured: true, hint: hint(key), error: e.message }; }
}
async function setKey(user, key) {
  key = String(key || '').trim();
  if (!key) {
    await store.updateUsers(us => { const u = us.find(x => x.id === user.id); delete u.seatiksKey; delete u.seatiksSyncedAt; });
    return { configured: false };
  }
  if (!/^stk_(test|live)_[A-Za-z0-9_-]{8,}$/.test(key)) throw new SeatiksError('Tohle nevypadá jako Seatiks klíč (stk_test_… nebo stk_live_…).', 400);
  const me = await api(key, 'GET', '/me');
  await store.updateUsers(us => { const u = us.find(x => x.id === user.id); u.seatiksKey = key; u.seatiksMode = me.mode; });
  return { configured: true, hint: hint(key), mode: me.mode, scopes: me.scopes || [] };
}

// ---- catalog ---------------------------------------------------------------------------
async function searchEvents(user, q) {
  const d = await api(keyOf(user), 'GET', '/events', null, { q: q.q, date_from: q.from, date_to: q.to, listable: 'true', limit: 50 });
  return (d.data || []).map(e => ({ id: e.id, name: e.name, date: e.start_date, venue: e.venue, city: e.city, country: e.country, currency: e.currency }));
}
async function getEvent(user, id) {
  const e = await api(keyOf(user), 'GET', '/events/' + encodeURIComponent(id));
  return { id: e.id, name: e.name, date: e.start_date, venue: e.venue, city: e.city, currency: e.currency, sections: (e.sections || []).map(s => ({ key: s.key, name: s.name, category: s.category })) };
}
async function platforms(user) { return (await api(keyOf(user), 'GET', '/platforms')).data || []; }

// ---- listing ---------------------------------------------------------------------------
const TRANSFER = ['E-ticket', 'Mobile Screenshot', 'External Transfer', 'Mobile Link/PKPASS', 'Paper', 'Local Delivery'];
const SPLITS = ['Any split', 'None', 'All together', 'Avoid leaving one', 'multiple of 2', 'multiple of 3', 'multiple of 4'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD', 'AED', 'AUD', 'CHF'];

// body: { ticketId, eventId, eventName, section, sectionName, quantity, price, currency, faceValue, faceCurrency, splitType, transferMethod, platforms? }
async function listTicket(user, body) {
  const b = body || {};
  const quantity = parseInt(b.quantity, 10), price = Number(b.price);
  if (!b.ticketId || !/^\d+$/.test(String(b.eventId || '')) || !b.section) throw new SeatiksError('Chybí vstupenka, akce nebo sekce.', 400);
  if (!(quantity > 0) || !(price > 0)) throw new SeatiksError('Chybí počet nebo cena.', 400);
  const currency = CURRENCIES.includes(b.currency) ? b.currency : 'EUR';
  const db = store.loadBucket(user.dataKey);
  const t = db.tickets.find(x => x.id === b.ticketId);
  if (!t) throw new SeatiksError('Vstupenka nenalezena.', 404);
  if ((t.externalIds || {}).seatiksListingId) throw new SeatiksError('Vstupenka už na Seatiks zalistovaná je.', 409);
  const listing = {
    event_id: String(b.eventId), section: String(b.section),
    hide_seats: true,                       // Michal's rule: section only, no row or seats
    quantity, price: Math.round(price * 100) / 100, price_currency: currency,
    split_type: SPLITS.includes(b.splitType) ? b.splitType : (quantity > 1 ? 'Avoid leaving one' : 'Any split'),
    transfer_method: TRANSFER.includes(b.transferMethod) ? b.transferMethod : 'Mobile Link/PKPASS',
    internal_note: `TicketVault ${t.id}`.slice(0, 200),
    idempotency_key: ('tv-' + t.id).replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 100)
  };
  if (Number(b.faceValue) > 0) { listing.face_value = Math.round(Number(b.faceValue) * 100) / 100; listing.face_value_currency = CURRENCIES.includes(b.faceCurrency) ? b.faceCurrency : currency; }
  if (Array.isArray(b.platforms) && b.platforms.length) listing.platforms = b.platforms;
  const r = await api(keyOf(user), 'POST', '/listings', { listings: [listing] });
  const item = (r.data || [])[0] || {};
  if (item.status === 'error' || !['created', 'duplicate', 'pending_approval', 'pending'].includes(item.status)) {
    throw new SeatiksError('Seatiks inzerát odmítl: ' + ((item.error && (item.error.message || item.error.code)) || item.status || 'neznámá chyba'), 400, item.error && item.error.code);
  }
  const pending = item.status === 'pending_approval' || item.status === 'pending';
  // The bulk result carries the id inside `listing` (item.id can be null for a fresh listing).
  item.id = item.id || (item.listing && item.listing.id) || null;
  const now = new Date().toISOString();
  const saved = await store.updateBucket(user.dataKey, d => {
    const i = d.tickets.findIndex(x => x.id === t.id);
    if (i < 0) return null;
    const cur = d.tickets[i];
    const ext = { ...(cur.externalIds || {}) };
    if (item.id) ext.seatiksListingId = String(item.id);
    d.tickets[i] = { ...cur, status: 'listed', platform: cur.platform && !/seatiks/i.test(cur.platform) ? cur.platform : 'Seatiks', externalIds: ext,
      listing: { ...(cur.listing || {}), platform: 'Seatiks', status: 'listed', price: listing.price, currency, listingId: item.id || '', listedAt: now,
        seatiks: { listingId: item.id || null, shortId: (item.listing && item.listing.short_id) || null, status: item.status, eventId: listing.event_id,
          eventName: b.eventName || null, section: listing.section, sectionName: b.sectionName || null, quantity, transferMethod: listing.transfer_method,
          mode: user.seatiksMode || null, idempotencyKey: listing.idempotency_key, at: now } },
      updated: now, _serverAt: now };
    return d.tickets[i];
  });
  return { ok: true, status: item.status, pending, listingId: item.id || null, ticket: saved };
}

// Pending listings come back with the same idempotency key: still pending, or duplicate (= approved) with the listing.
async function refreshPending(user) {
  const db = store.loadBucket(user.dataKey);
  const pend = db.tickets.filter(t => t.listing && t.listing.seatiks && (/pending/.test(t.listing.seatiks.status || '') || !(t.externalIds || {}).seatiksListingId));
  let changed = 0;
  for (const t of pend) {
    const r = await api(keyOf(user), 'GET', '/listings', null, { event_id: t.listing.seatiks.eventId, limit: 100 }).catch(() => null);
    const found = r && (r.data || []).find(l => String(l.internal_note || '').includes(t.id));
    if (!found) continue;
    await store.updateBucket(user.dataKey, d => {
      const x = d.tickets.find(y => y.id === t.id);
      if (!x) return;
      x.externalIds = { ...(x.externalIds || {}), seatiksListingId: found.id };
      x.listing.seatiks = { ...x.listing.seatiks, listingId: found.id, shortId: found.short_id || null, status: 'published' };
      x.listing.listingId = found.id;
      x._serverAt = x.updated = new Date().toISOString();
    });
    changed++;
  }
  return changed;
}

async function unpublishForTicket(user, ticket) {
  const id = ticket && (ticket.externalIds || {}).seatiksListingId;
  if (!id || !keyOf(user)) return false;
  await api(keyOf(user), 'POST', '/listings/' + encodeURIComponent(id) + '/unpublish');
  return true;
}

// ---- sales -----------------------------------------------------------------------------
function stagesOf(sale) {
  const st = String(sale.status || '');
  if (/^cancelled/.test(st)) return ['cancelled'];
  const out = ['sold'];
  if (st === 'delivered' || sale.delivered_at) out.push('delivered');
  if (sale.is_paid) out.push('paid');
  return out;
}
function parsedFor(sale, stage) {
  const buyer = (sale.buyers || [])[0] || {};
  const name = [buyer.first_name, buyer.last_name].filter(Boolean).join(' ').trim();
  const payout = sale.payout || {};
  return {
    success: true, kind: 'sale', platform: 'Seatiks', saleStage: stage,
    event: (sale.event && sale.event.name) || null, eventDate: sale.event && sale.event.start_date ? String(sale.event.start_date).slice(0, 10) : null,
    venue: (sale.event && sale.event.venue) || null, section: sale.section || null, row: null, seat: null,
    quantity: sale.quantity || null, pricePerTicket: payout.unit_amount || null, totalAmount: payout.total_amount || null, currency: payout.currency || null,
    orderId: String(sale.short_id || sale.id), listingId: sale.listing_id || null, purchaseDate: String(sale.created_at || '').slice(0, 10) || null,
    buyerName: name || null, buyerEmail: buyer.email || null, accountEmail: null, confidence: 1, parser: 'seatiks-api',
    notes: `Seatiks ${sale.marketplace ? 'via ' + sale.marketplace : ''} · obj. ${sale.short_id || sale.id}`.trim(), ticketNumbers: []
  };
}

let polling = false;
async function pollUser(user) {
  const key = keyOf(user);
  if (!key) return { skipped: true };
  const { ingestSale } = require('./ingest/pipeline');
  const since = new Date(Date.now() - 60 * 86400000).toISOString();
  const sales = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const r = await api(key, 'GET', '/sales', null, { created_since: since, limit: 200, cursor });
    sales.push(...(r.data || []));
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  const log = entry => store.appendIngestLog({ ...entry, at: new Date().toISOString(), mailbox: 'seatiks' });
  let applied = 0;
  // Oldest first, and within a sale sold → delivered → paid, so the stages land in order.
  for (const sale of sales.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))) {
    for (const stage of stagesOf(sale)) {
      const parsed = parsedFor(sale, stage);
      const mail = { date: new Date(sale.updated_at || sale.created_at || Date.now()), from: 'Seatiks API', to: '', subject: `Seatiks ${stage}: ${parsed.event || ''} · ${parsed.quantity || '?'} ks · obj. ${parsed.orderId}`, messageId: `seatiks-${sale.id}-${stage}` };
      const r = await ingestSale(mail, parsed, { owner: user, dataKey: user.dataKey, mailboxName: 'seatiks' }, null, log).catch(e => ({ error: e.message }));
      if (r && r.result === 'applied') applied++;
    }
  }
  await store.updateUsers(us => { const u = us.find(x => x.id === user.id); if (u) u.seatiksSyncedAt = new Date().toISOString(); });
  await refreshPending(user).catch(() => 0);
  return { sales: sales.length, applied };
}
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    for (const u of store.loadUsers().filter(x => x.seatiksKey)) {
      try { await pollUser(u); } catch (e) { console.warn('[seatiks]', u.username, e.message); }
    }
  } finally { polling = false; }
}
function startPoller() {
  setTimeout(pollAll, 20000);
  setInterval(pollAll, POLL_MINUTES * 60000);
}

module.exports = { status, setKey, searchEvents, getEvent, platforms, listTicket, unpublishForTicket, pollUser, startPoller, SeatiksError, _stagesOf: stagesOf, _parsedFor: parsedFor };
