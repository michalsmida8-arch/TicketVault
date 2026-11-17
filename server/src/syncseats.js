'use strict';
// SyncSeats (1.23) — one listing on 17 marketplaces (Viagogo, StubHub, Ticketmaster, …).
// Seller API: https://www.syncseats.com/api/v1 (Bearer ssapi_test_… sandbox / ssapi_live_…), spec at /api/v1/openapi.json.
// The key lives only here, on the user record (users.json, never sent back to the app).
//   - sales + payouts: polled every 5 minutes (GET /v1/sales) and fed through the normal sale ingest
//     (auto-apply by order / listing id or event+date, buyer, payout state). Plain HTTP, no AI tokens.
const store = require('./store');

const BASE = 'https://www.syncseats.com/api/v1';
const POLL_MINUTES = 5;

class SyncSeatsError extends Error {
  constructor(message, status = 502, code = null) { super(message); this.status = status; this.code = code; }
}

function keyOf(user) { return (user && user.syncseatsKey) || ''; }
const isTestKey = key => /^ssapi_test_/.test(key || '');
const hint = key => key ? key.slice(0, 11) + '…' + key.slice(-4) : '';

async function api(key, method, path, body, query, headers) {
  if (!key) throw new SyncSeatsError('SyncSeats API klíč není nastavený.', 400, 'no_key');
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res;
  try {
    res = await fetch(BASE + path + qs, {
      method, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Accept: 'application/json', ...(headers || {}) },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000)
    });
  } catch (e) { throw new SyncSeatsError('SyncSeats nedostupný: ' + e.message, 502, 'network'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data.error || {};
    throw new SyncSeatsError(`SyncSeats ${res.status}: ${err.message || err.code || 'chyba'}`, res.status === 401 || res.status === 403 ? 400 : 502, err.code || null);
  }
  return data;
}

// ---- key management ------------------------------------------------------------------
async function status(user) {
  const key = keyOf(user);
  if (!key) return { configured: false };
  try {
    const me = await api(key, 'GET', '/me');
    return { configured: true, hint: hint(key), mode: me.mode, scopes: me.usable_scopes || me.scopes || [], syncedAt: user.syncseatsSyncedAt || null };
  } catch (e) { return { configured: true, hint: hint(key), error: e.message }; }
}
async function setKey(user, key) {
  key = String(key || '').trim();
  if (!key) {
    await store.updateUsers(us => { const u = us.find(x => x.id === user.id); delete u.syncseatsKey; delete u.syncseatsSyncedAt; });
    return { configured: false };
  }
  if (!/^ssapi_(test|live)_[A-Za-z0-9_-]{8,}$/.test(key)) throw new SyncSeatsError('Tohle nevypadá jako SyncSeats klíč (ssapi_test_… nebo ssapi_live_…).', 400);
  const me = await api(key, 'GET', '/me');
  await store.updateUsers(us => { const u = us.find(x => x.id === user.id); u.syncseatsKey = key; u.syncseatsMode = me.mode; });
  return { configured: true, hint: hint(key), mode: me.mode, scopes: me.usable_scopes || me.scopes || [] };
}

// ---- catalog ---------------------------------------------------------------------------
async function searchEvents(user, q) {
  const d = await api(keyOf(user), 'GET', '/events', null, { q: q.q, date_from: q.from, date_to: q.to, limit: 50 });
  return (d.data || []).filter(e => e.listable !== false).map(e => ({ id: e.id, name: e.name, date: e.starts_at_local, venue: e.venue, city: e.city, country: e.country }));
}

// ---- listing (always a draft: Michal publishes in SyncSeats himself) -----------------------
const TYPES = ['eticket', 'mobile', 'mobile_transfer'];
const SPLITS = ['any', 'no_singles', 'none', 'pairs'];
const money = (n, currency) => ({ amount: (Math.round(Number(n) * 100) / 100).toFixed(2), currency });

// body: { ticketId, eventId, eventName, quantity, price, currency (EUR|USD), faceValue, cost, ticketType, split }
function draftBody(t, b) {
  const quantity = parseInt(b.quantity, 10), price = Number(b.price);
  if (!/^[a-f0-9]{24}$/.test(String(b.eventId || ''))) throw new SyncSeatsError('Chybí akce z katalogu SyncSeats.', 400);
  if (!(quantity > 0 && quantity <= 50) || !(price > 0)) throw new SyncSeatsError('Chybí počet nebo cena.', 400);
  const currency = b.currency === 'USD' ? 'USD' : 'EUR';
  // Michal's rule: section only, no row or seats → SyncSeats takes it as `quantity` tickets in that section.
  const group = {
    quantity, price_per_ticket: money(price, currency),
    ticket_type: TYPES.includes(b.ticketType) ? b.ticketType : 'mobile_transfer',
    split: SPLITS.includes(b.split) ? b.split : (quantity > 1 ? 'no_singles' : 'any'),
    reference: String(t.id).slice(0, 100), internal_note: `TicketVault ${t.id}`.slice(0, 500)
  };
  if (t.section) group.section = String(t.section).slice(0, 50);
  if (Number(b.faceValue) > 0) group.face_value = money(b.faceValue, currency);
  if (Number(b.cost) > 0) group.cost_per_ticket = money(b.cost, currency);
  return { event_id: String(b.eventId), publish: false, listings: [group] };
}

async function listTicket(user, body) {
  const b = body || {};
  if (!b.ticketId) throw new SyncSeatsError('Chybí vstupenka.', 400);
  const t = store.loadBucket(user.dataKey).tickets.find(x => x.id === b.ticketId);
  if (!t) throw new SyncSeatsError('Vstupenka nenalezena.', 404);
  if ((t.externalIds || {}).syncseatsListingId) throw new SyncSeatsError('Vstupenka už na SyncSeats je.', 409);
  const req = draftBody(t, b);
  const key = keyOf(user);
  // Idempotency-Key: a retry for the same ticket returns the first draft instead of a second one.
  const r = await api(key, 'POST', '/listings', req, null, { 'Idempotency-Key': ('tv-' + t.id).slice(0, 100) });
  const item = (r.listings || [])[0];
  if (!item) {
    const s = (r.skipped || [])[0] || {};
    throw new SyncSeatsError('SyncSeats inzerát odmítl: ' + (s.message || s.code || 'neznámá chyba'), 400, s.code || null);
  }
  const now = new Date().toISOString();
  const info = { listingId: item.id, status: item.status, eventId: req.event_id, eventName: b.eventName || (item.event && item.event.name) || null,
    section: item.section || null, quantity: item.quantity, price: item.price_per_ticket, marketplaces: (item.marketplaces || []).length, at: now };
  // Sandbox key: the draft lives only in SyncSeats' sandbox, the real ticket stays as it is.
  const test = isTestKey(key);
  const saved = await store.updateBucket(user.dataKey, d => {
    const x = d.tickets.find(y => y.id === t.id);
    if (!x) return null;
    if (test) x.listing = { ...(x.listing || {}), syncseatsTest: info };
    else {
      x.externalIds = { ...(x.externalIds || {}), syncseatsListingId: String(item.id) };
      x.listing = { ...(x.listing || {}), platform: 'SyncSeats', status: 'prefilled', inactive: true, price: Number(b.price), currency: req.listings[0].price_per_ticket.currency,
        listingId: String(item.id), prefilledAt: now, syncseats: info };
    }
    x.updated = x._serverAt = now;
    return x;
  });
  return { ok: true, test, status: item.status, listingId: item.id, marketplaces: info.marketplaces, ticket: saved };
}
// ---- sales -----------------------------------------------------------------------------
function stagesOf(sale) {
  if (sale.status === 'cancelled' || sale.status === 'failed') return ['cancelled'];
  const out = ['sold'];
  if (sale.status === 'delivered' || sale.delivered_at) out.push('delivered');
  if (sale.payout && sale.payout.status === 'paid') out.push('paid');
  return out;
}
const num = m => (m && m.amount != null ? Number(m.amount) : null);
function parsedFor(sale, stage) {
  const p = sale.payout || {};
  // payouts are sent in EUR; amount_eur is fixed once the marketplace paid, before that the USD figure
  const money = p.amount_eur || p.amount || null;
  const total = num(money);
  const r = sale.recipient || {};
  const ev = sale.event || {};
  return {
    success: true, kind: 'sale', platform: 'SyncSeats', saleStage: stage,
    event: ev.name || null, eventDate: ev.starts_at ? String(ev.starts_at).slice(0, 10) : null, venue: ev.venue || null,
    section: sale.section || null, row: sale.row || null, seat: (sale.seats || []).join(', ') || null,
    quantity: sale.quantity || null, pricePerTicket: total != null && sale.quantity ? +(total / sale.quantity).toFixed(2) : null,
    totalAmount: total, currency: money ? money.currency : null,
    orderId: String(sale.id), listingId: sale.listing_id || null, purchaseDate: String(sale.sold_at || '').slice(0, 10) || null,
    buyerName: r.name || null, buyerEmail: r.email || null, accountEmail: null, confidence: 1, parser: 'syncseats-api',
    notes: `SyncSeats${sale.marketplace && sale.marketplace.name ? ' via ' + sale.marketplace.name : ''} · obj. ${sale.id}${sale.deliver_by ? ' · doručit do ' + String(sale.deliver_by).slice(0, 16).replace('T', ' ') : ''}`,
    ticketNumbers: []
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
  for (let page = 0; page < 20; page++) {
    const r = await api(key, 'GET', '/sales', null, { sold_since: since, limit: 100, cursor });
    sales.push(...(r.data || []));
    if (!r.has_more || !r.next_cursor) break;
    cursor = r.next_cursor;
  }
  const log = entry => store.appendIngestLog({ ...entry, at: new Date().toISOString(), mailbox: 'syncseats' });
  // Sandbox sales are simulated: only those on a listing some ticket carries are applied.
  const known = new Set(store.loadBucket(user.dataKey).tickets.map(t => (t.externalIds || {}).syncseatsListingId).filter(Boolean));
  const relevant = s => !isTestKey(key) || known.has(s.listing_id);
  let applied = 0;
  for (const sale of sales.filter(relevant).sort((a, b) => String(a.sold_at).localeCompare(String(b.sold_at)))) {
    for (const stage of stagesOf(sale)) {
      const parsed = parsedFor(sale, stage);
      const mail = { date: new Date(sale.sold_at || Date.now()), from: 'SyncSeats API', to: '', subject: `SyncSeats ${stage}: ${parsed.event || ''} · ${parsed.quantity || '?'} ks · obj. ${parsed.orderId}`, messageId: `syncseats-${sale.id}-${stage}` };
      const r = await ingestSale(mail, parsed, { owner: user, dataKey: user.dataKey, mailboxName: 'syncseats' }, null, log).catch(e => ({ error: e.message }));
      if (r && r.result === 'applied') applied++;
    }
  }
  await store.updateUsers(us => { const u = us.find(x => x.id === user.id); if (u) u.syncseatsSyncedAt = new Date().toISOString(); });
  return { sales: sales.length, applied };
}
async function pollAll() {
  if (polling) return;
  polling = true;
  try {
    for (const u of store.loadUsers().filter(x => x.syncseatsKey)) {
      try { await pollUser(u); } catch (e) { console.warn('[syncseats]', u.username, e.message); }
    }
  } finally { polling = false; }
}
function startPoller() {
  setTimeout(pollAll, 30000);
  setInterval(pollAll, POLL_MINUTES * 60000);
}

module.exports = { status, setKey, searchEvents, listTicket, pollUser, startPoller, keyOf, isTestKey, SyncSeatsError, _stagesOf: stagesOf, _parsedFor: parsedFor, _draftBody: draftBody };
