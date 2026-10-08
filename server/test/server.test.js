'use strict';
// End-to-end smoke test: boots the server on a temp data dir with a random port,
// registers, logs in, syncs a DB, upserts a ticket, pushes a mail through the
// webhook ingest with the LLM disabled (deterministic path only) and checks the
// inbox merge rule on PUT /db. Run: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}/api`;
let proc, token, dataDir;

async function api(method, p, body, auth = true) {
  const res = await fetch(BASE + p, {
    method, headers: { 'Content-Type': 'application/json', ...(auth && token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-test-'));
  proc = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, INVITE_CODE: 'inv', INGEST_ENABLED: 'false', LLM_ENABLED: 'false', ANTHROPIC_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.stderr.on('data', d => process.stderr.write(d));
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(BASE + '/ping'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('server did not start');
});

after(() => { proc.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ } });

test('ping has the fields the app checks', async () => {
  const r = await fetch(BASE + '/ping').then(x => x.json());
  assert.equal(r.ok, true);
  assert.equal(r.hasInviteCode, true);
  assert.equal(r.hasApiKey, true);
});

test('first registration becomes admin, second needs invite code', async () => {
  let r = await api('POST', '/auth/register', { username: 'michal', password: 'secret1' }, false);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.role, 'admin');
  assert.match(r.data.recoveryCode, /^\d{6}$/);
  assert.ok(r.data.token.split('.').length === 3);
  token = r.data.token;

  r = await api('POST', '/auth/register', { username: 'jan', password: 'secret2', inviteCode: 'wrong' }, false);
  assert.equal(r.status, 403);
  r = await api('POST', '/auth/register', { username: 'jan', password: 'secret2', inviteCode: 'inv' }, false);
  assert.equal(r.status, 200);
  assert.equal(r.data.user.role, 'user');
});

test('login + me', async () => {
  let r = await api('POST', '/auth/login', { username: 'michal', password: 'nope' }, false);
  assert.equal(r.status, 401);
  r = await api('POST', '/auth/login', { username: 'michal', password: 'secret1' }, false);
  assert.equal(r.status, 200);
  token = r.data.token;
  r = await api('GET', '/auth/me');
  assert.equal(r.data.user.username, 'michal');
});

test('db sync: GET, PUT, ticket upsert/delete', async () => {
  let r = await api('GET', '/db');
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.tickets, []);
  const db = r.data;
  db.tickets.push({ id: 't_1', eventName: 'Arsenal v Chelsea', eventDate: '2026-10-10', quantity: 2, status: 'available' });
  r = await api('PUT', '/db', db);
  assert.equal(r.data.count, 1);
  r = await api('POST', '/ticket', { eventName: 'Coldplay', quantity: 1, status: 'available' });
  assert.ok(r.data.ticket.id.startsWith('t_'));
  r = await api('GET', '/db');
  assert.equal(r.data.tickets.length, 2);
  r = await api('POST', '/tickets/bulk-delete', { ids: [r.data.tickets[1].id] });
  r = await api('GET', '/db');
  assert.equal(r.data.tickets.length, 1);
});

test('webhook ingest: prefilter skips junk, deterministic PDF parser creates an item', async () => {
  let r = await api('POST', '/ingest/email', { from: 'news@shop.com', subject: 'Newsletter: last chance', text: 'buy now' });
  assert.equal(r.data.result, 'skipped');
  // With LLM disabled and no PDF, a plausible order mail is skipped but logged
  r = await api('POST', '/ingest/email', { from: 'tickets@stubhub.com', subject: 'Your listing sold', text: 'Order 123' });
  assert.equal(r.data.reason, 'llm-disabled');
});

test('PUT /db keeps inbox items created server-side after the client pulled', async () => {
  const store = loadStore();
  const users = store.loadUsers();
  const me = users.find(u => u.username === 'michal');
  // client pulls
  let r = await api('GET', '/db');
  const clientDb = r.data;
  // meanwhile the ingest adds an item
  await store.updateBucket(me.dataKey, db => { db.inbox.push({ id: 'in_new', state: 'pending_review', receivedAt: '2026-01-01T00:00:00.000Z', createdAt: new Date().toISOString(), parsed: { success: true } }); });
  // client pushes its stale copy
  r = await api('PUT', '/db', clientDb);
  r = await api('GET', '/db');
  assert.ok(r.data.inbox.some(i => i.id === 'in_new'), 'server-side inbox item survived the client PUT');
  // client resolves + clears it -> it stays gone
  const cleared = { ...r.data, inbox: [] };
  r = await api('PUT', '/db', cleared);
  r = await api('GET', '/db');
  assert.equal(r.data.inbox.length, 0);
});

test('RB Leipzig invoice parser', () => {
  const { parseLeipzigInvoice } = require('../src/ingest/parsers');
  const txt = `Invoice\nRB Leipzig - FC Bayern München / 14.03.2026 / 18:30\nOrder number: 987654\n12 Fanbereich Block\n2 - 14 Sitz 228.00 EUR 56.00 EUR\nTotal: 56.00 EUR`;
  const r = parseLeipzigInvoice(txt);
  assert.equal(r.event, 'RB Leipzig v FC Bayern München');
  assert.equal(r.eventDate, '2026-03-14');
  assert.equal(r.orderId, '987654');
  assert.equal(r.quantity, 2);
  assert.equal(r.pricePerTicket, 28);
  assert.equal(r.totalAmount, 56);
});

test('admin user management + data sharing', async () => {
  let r = await api('GET', '/auth/users');
  assert.equal(r.data.users.length, 2);
  const jan = r.data.users.find(u => u.username === 'jan');
  assert.equal(jan.sharesBucketWithViewer, false);
  r = await api('POST', `/auth/users/${jan.id}/share-data`);
  r = await api('GET', '/auth/users');
  assert.equal(r.data.users.find(u => u.username === 'jan').sharesBucketWithViewer, true);
  r = await api('POST', '/auth/users', { username: 'petr', password: 'secret3', role: 'user', shareMyData: true });
  assert.equal(r.status, 200);
  r = await api('DELETE', `/auth/users/${r.data.user.id}`);
  assert.equal(r.status, 200);
});

function loadStore() {
  process.env.DATA_DIR = dataDir;
  delete require.cache[require.resolve('../src/config')];
  delete require.cache[require.resolve('../src/store')];
  return require('../src/store');
}

test('prefilter: drops account-creation and marketing, keeps orders', () => {
  const { prefilter } = require('../src/ingest/parsers');
  const drop = [
    ['info@info.ticketmaster.es', 'Tu código de autenticación'],
    ['info@info.ticketmaster.de', 'Dein Authentifizierungscode'],
    ['info@info.ticketmaster.de', 'Willkommen bei Ticketmaster!'],
    ['info@info.ticketmaster.es', '¡Bienvenido a Ticketmaster!'],
    ['info@info.ticketmaster.cz', 'Váš ověřovací kód'],
    ['info@info.ticketmaster.cz', 'Vítejte v Ticketmaster!'],
    ['news@email.ticketmaster.de', 'Hilary Duff, Cirque du Soleil ALIZÉ, Simply Red & mehr'],
    ['x@comms.tottenhamhotspur.com', 'Exclusive | 15% OFF EVERYTHING*'],
    ['x@mail.ovoarena.co.uk', 'Presales for Macklemore, James Marriott'],
    ['x@resend.dev', 'TicketVault — 9 položek k vyřešení'],
    ['x@quantumproxies.net', 'Confirm enabling 2FA — Quantum Proxies'],
    ['x@mail.pdc.tv', 'Winmau World Masters: Last Remaining Tickets']
  ];
  const keep = [
    ['orders@orders.stubhubinternational.com', 'Your tickets were delivered for order# 287914560 - England vs Spain'],
    ['x@tickets.rbleipzig.com', 'Für das Spiel von RB Leipzig sind Mobile Ticket(s) verfügbar'],
    ['x@service.mancity.com', '🎫 City v Brighton ticket information'],
    ['x@alza.cz', 'Děkujeme za objednávku #123'],
    ['x@ticketmaster.co.uk', 'Your Ticketmaster Order Confirmation'],
    ['x@viagogo.com', 'Your tickets have sold!']
  ];
  for (const [from, subject] of drop) assert.equal(prefilter({ from, subject }).pass, false, 'should drop: ' + subject);
  for (const [from, subject] of keep) assert.equal(prefilter({ from, subject }).pass, true, 'should keep: ' + subject);
});

test('marketplace mails are always sales, with stage and canonical platform', () => {
  const { toParsed } = require('../src/ingest/pipeline');
  const base = { relevant: true, event: 'England vs Spain', eventDate: '2026-09-26', quantity: 3, totalAmount: 303.6, currency: 'EUR', orderId: '287914560', listingId: '' , confidence: 0.9 };
  // Model mislabels a StubHub "delivered" notice as a delivery of a purchase
  let p = toParsed({ ...base, kind: 'delivery', platform: 'StubHub' },
    { from: 'orders@orders.stubhubinternational.com', subject: 'Your tickets were delivered for order# 287914560 - England vs Spain' });
  assert.equal(p.kind, 'sale');
  assert.equal(p.saleStage, 'delivered');
  assert.equal(p.platform, 'Stubhub');
  p = toParsed({ ...base, kind: 'purchase', platform: '' },
    { from: 'orders@orders.stubhubinternational.com', subject: 'You sold your ticket for Arsenal FC vs Chelsea FC Tickets' });
  assert.equal(p.kind, 'sale'); assert.equal(p.saleStage, 'sold'); assert.equal(p.platform, 'Stubhub');
  p = toParsed({ ...base, kind: 'sale', platform: 'stubhub.com' },
    { from: 'orders@orders.stubhubinternational.com', subject: 'Payment processed on #287914560' });
  assert.equal(p.saleStage, 'paid');
  // Refund from a marketplace is NOT forced into a sale
  p = toParsed({ ...base, kind: 'refund', platform: 'Stubhub' }, { from: 'orders@stubhub.com', subject: 'Your order was cancelled' });
  assert.equal(p.success, false);
  // A club purchase stays a purchase
  p = toParsed({ ...base, kind: 'purchase', platform: 'Chelsea FC' }, { from: 'tickets@chelseafc.com', subject: 'Order confirmation' });
  assert.equal(p.kind, 'purchase');
});

test('prefilter drops StubHub new-listing notices', () => {
  const { prefilter } = require('../src/ingest/parsers');
  assert.equal(prefilter({ from: 'orders@orders.stubhubinternational.com', subject: 'Your new listing on StubHub' }).pass, false);
  assert.equal(prefilter({ from: 'orders@orders.stubhubinternational.com', subject: 'You sold your ticket for Arsenal FC vs Chelsea FC' }).pass, true);
});

test('applySale: sold by event+date with split, then delivered and paid by order number', () => {
  const { applySale } = require('../src/ingest/sales');
  const db = { inbox: [], tickets: [
    { id: 't_a', eventName: 'Bayern Mnichov - Union Berlín', eventDate: '2026-09-18', quantity: 3, status: 'listed', platform: 'Stubhub', currency: 'EUR', externalIds: {} },
    { id: 't_b', eventName: 'Arsenal v Chelsea', eventDate: '2026-10-04', quantity: 2, status: 'available', currency: 'GBP', externalIds: {} }
  ] };
  const p = { kind: 'sale', saleStage: 'sold', platform: 'Stubhub', event: 'FC Bayern Munich vs 1. FC Union Berlin', eventDate: '2026-09-18',
    quantity: 1, totalAmount: 79.29, grossSubtotal: 90, currency: 'EUR', orderId: '288678456' };
  let r = applySale(db, p, '2026-09-10T10:00:00Z');
  assert.equal(r.applied, true, JSON.stringify(r));
  assert.equal(r.by, 'event+date');
  const sold = db.tickets.find(t => t.id === 't_a');
  assert.equal(sold.status, 'sold'); assert.equal(sold.quantity, 1); assert.equal(sold.salePrice, 79.29);
  assert.equal(sold.externalIds.stubhubOrderId, '288678456'); assert.equal(sold.saleDate, '2026-09-10');
  const rest = db.tickets.find(t => t.id === r.remainingId);
  assert.equal(rest.quantity, 2); assert.equal(rest.status, 'listed');
  // same "sold" mail again -> duplicate, nothing changes
  r = applySale(db, p, '2026-09-10T10:00:00Z');
  assert.equal(r.duplicate, true);
  // delivered
  r = applySale(db, { ...p, saleStage: 'delivered' }, '2026-09-12T08:00:00Z');
  assert.equal(r.action, 'delivered'); assert.equal(db.tickets.find(t => t.id === 't_a').status, 'delivered');
  // paid
  r = applySale(db, { ...p, saleStage: 'paid', totalAmount: 79.29 }, '2026-09-24T08:00:00Z');
  assert.equal(r.action, 'paid');
  const paid = db.tickets.find(t => t.id === 't_a');
  assert.equal(paid.paidOut, true); assert.equal(paid.paidOutDate, '2026-09-24'); assert.equal(paid.paidOutAmount, 79.29);
});

test('applySale: ambiguous or unknown event stays for manual review', () => {
  const { applySale } = require('../src/ingest/sales');
  const db = { inbox: [], tickets: [
    { id: 't1', eventName: 'Arsenal v Chelsea', eventDate: '2026-10-04', quantity: 2, status: 'available', section: 'A' },
    { id: 't2', eventName: 'Arsenal v Chelsea', eventDate: '2026-10-04', quantity: 2, status: 'available', section: 'B' }
  ] };
  let r = applySale(db, { saleStage: 'sold', platform: 'Stubhub', event: 'Arsenal FC vs Chelsea FC', eventDate: '2026-10-04', quantity: 2, totalAmount: 400 });
  assert.equal(r.applied, false); assert.equal(r.candidates.length, 2);
  // section breaks the tie
  r = applySale(db, { saleStage: 'sold', platform: 'Stubhub', event: 'Arsenal FC vs Chelsea FC', eventDate: '2026-10-04', quantity: 2, totalAmount: 400, section: 'B' });
  assert.equal(r.applied, true); assert.equal(r.ticketId, 't2');
  r = applySale(db, { saleStage: 'sold', platform: 'Stubhub', event: 'Coldplay', eventDate: '2026-11-01', quantity: 1, totalAmount: 100 });
  assert.equal(r.applied, false); assert.equal(r.reason, 'none');
});

test('stale app copy cannot undo a server-side sale (PUT /db and POST /ticket)', async () => {
  const store = loadStore();
  const me = store.loadUsers().find(u => u.username === 'michal');
  let r = await api('GET', '/db');
  const clientDb = r.data;                         // client copy before the sale
  const t = clientDb.tickets.find(x => x.id === 't_1');
  assert.ok(t, 'fixture ticket exists');
  await new Promise(res => setTimeout(res, 20));
  const now = new Date().toISOString();
  await store.updateBucket(me.dataKey, db => {
    const i = db.tickets.findIndex(x => x.id === 't_1');
    db.tickets[i] = { ...db.tickets[i], status: 'sold', salePrice: 150, updated: now, _serverAt: now };
  });
  // full push of the stale copy
  r = await api('PUT', '/db', clientDb);
  r = await api('GET', '/db');
  assert.equal(r.data.tickets.find(x => x.id === 't_1').status, 'sold');
  // single-ticket push of the stale copy with an unrelated edit
  r = await api('POST', '/ticket', { ...t, venue: 'Emirates' });
  r = await api('GET', '/db');
  const after = r.data.tickets.find(x => x.id === 't_1');
  assert.equal(after.status, 'sold'); assert.equal(after.salePrice, 150); assert.equal(after.venue, 'Emirates');
  // after a fresh pull the user CAN change the status deliberately
  r = await api('POST', '/ticket', { ...after, status: 'available' });
  r = await api('GET', '/db');
  assert.equal(r.data.tickets.find(x => x.id === 't_1').status, 'available');
});

test('delivered/paid mails match tickets sold by hand; cancellation reverts an auto split', () => {
  const { applySale } = require('../src/ingest/sales');
  const { saleStage } = require('../src/ingest/parsers');
  assert.equal(saleStage('You successfully confirmed transfer for order # 655268025'), 'delivered');
  assert.equal(saleStage('Your sale 655518574 has been cancelled'), 'cancelled');
  assert.equal(saleStage('Please send your tickets for sale # 655268025 immediately'), 'sold');

  // England v Spain: three rows delivered by hand, no Stubhub order numbers stored
  const db = { inbox: [], tickets: [
    { id: 't_e1', eventName: 'England v Spain', eventDate: '2026-09-26', quantity: 2, status: 'delivered', salePrice: 101.2, externalIds: { otherId: '4430397' } },
    { id: 't_e2', eventName: 'England v Spain', eventDate: '2026-09-26', quantity: 3, status: 'delivered', salePrice: 101.2, externalIds: { otherId: '4430397' } },
    { id: 't_e3', eventName: 'England v Spain', eventDate: '2026-09-26', quantity: 3, status: 'delivered', salePrice: 101.2, externalIds: { otherId: '4430397' } }
  ] };
  const base = { platform: 'Stubhub', event: 'England vs Spain - Nations League 2026-27', eventDate: '2026-09-26' };
  let r = applySale(db, { ...base, saleStage: 'delivered', quantity: 2, orderId: '287914078', totalAmount: 202.4 });
  assert.equal(r.action, 'already-delivered'); assert.equal(r.ticketId, 't_e1');
  r = applySale(db, { ...base, saleStage: 'delivered', quantity: 3, orderId: '287914303', totalAmount: 303.6 });
  r = applySale(db, { ...base, saleStage: 'delivered', quantity: 3, orderId: '287914560', totalAmount: 303.6 });
  const ids = db.tickets.map(t => t.externalIds.stubhubOrderId).sort();
  assert.deepEqual(ids, ['287914078', '287914303', '287914560'], 'each row got its own order number');
  // the same delivered mail again is a duplicate
  r = applySale(db, { ...base, saleStage: 'delivered', quantity: 2, orderId: '287914078' });
  assert.equal(r.duplicate, true);
  // payout for one of them now matches by order number
  r = applySale(db, { ...base, saleStage: 'paid', quantity: 3, orderId: '287914560', totalAmount: 303.6 }, '2026-10-01T09:00:00Z');
  assert.equal(r.action, 'paid');

  // A$AP Rocky: 4 listed, 1 sold automatically (split), then the sale is cancelled
  const db2 = { inbox: [], tickets: [{ id: 't_a', eventName: "A$AP ROCKY - DON'T BE DUMB WORLD TOUR", eventDate: '2026-10-11', quantity: 4, status: 'listed', platform: 'Viagogo', currency: 'EUR', externalIds: {} }] };
  const sale = { platform: 'Viagogo', event: 'A$AP Rocky', eventDate: '2026-10-11', quantity: 1, totalAmount: 105.48, currency: 'EUR', orderId: '655518574' };
  r = applySale(db2, { ...sale, saleStage: 'sold' });
  assert.equal(r.action, 'sold');
  db2.inbox.push({ id: 'in1', autoApplied: { action: 'sold', ticketId: r.ticketId, remainingId: r.remainingId } });
  assert.equal(db2.tickets.length, 2);
  r = applySale(db2, { ...sale, saleStage: 'cancelled' });
  assert.equal(r.action, 'cancelled-merged');
  assert.equal(db2.tickets.length, 1);
  assert.equal(db2.tickets[0].quantity, 4); assert.equal(db2.tickets[0].status, 'listed');
});

test('stale app copy cannot reopen an inbox item the server resolved', async () => {
  const store = loadStore();
  const me = store.loadUsers().find(u => u.username === 'michal');
  await store.updateBucket(me.dataKey, db => { db.inbox.push({ id: 'in_x', state: 'pending_review', createdAt: '2026-01-01T00:00:00Z', _serverAt: '2026-01-01T00:00:00Z', parsed: { success: true } }); });
  let r = await api('GET', '/db');
  const stale = r.data;
  const now = new Date().toISOString();
  await store.updateBucket(me.dataKey, db => { const i = db.inbox.find(x => x.id === 'in_x'); i.state = 'approved'; i._serverAt = now; });
  await api('PUT', '/db', stale);
  r = await api('GET', '/db');
  assert.equal(r.data.inbox.find(x => x.id === 'in_x').state, 'approved');
});

test('purchases: complete high-confidence order is added, duplicates are held back', () => {
  const { blocker, findDuplicates, buildTicket } = require('../src/ingest/purchases');
  const p = { success: true, kind: 'purchase', eventKind: 'purchase', platform: 'RB Leipzig', event: 'RB Leipzig v Manchester City',
    eventDate: '2026-11-04', quantity: 6, totalAmount: 336, currency: 'EUR', orderId: '9899575', confidence: 0.95, category: 'football' };
  assert.equal(blocker(p, 0.9), null);
  assert.equal(blocker({ ...p, confidence: 0.6 }, 0.9), 'low-confidence');
  assert.equal(blocker({ ...p, totalAmount: null }, 0.9), 'missing-price');
  assert.equal(blocker({ ...p, eventKind: 'delivery' }, 0.9), 'not-a-purchase');
  const t = buildTicket(p, { subject: 'Your booking confirmation 9899575' }, '2026-09-28T10:00:00Z');
  assert.equal(t.purchasePrice, 56); assert.equal(t.quantity, 6); assert.equal(t.status, 'available');
  assert.equal(t.category, 'football'); assert.equal(t.externalIds.otherId, '9899575'); assert.equal(t.purchaseDate, '2026-09-28');
  // certain duplicate: order number stored under any key
  let d = findDuplicates({ tickets: [{ id: 'x', eventName: 'Leipzig City', eventDate: '2026-11-04', externalIds: { otherId: '9899575' } }] }, p);
  assert.equal(d.certain.length, 1);
  // possible duplicate: same event split into rows 1 + 3 = 4 ks (A$AP Rocky case)
  const asap = { ...p, platform: 'High Priority Promotions', event: "A$AP ROCKY - DON'T BE DUMB WORLD TOUR", eventDate: '2026-10-11', quantity: 4, totalAmount: 346, orderId: 'HPP1' };
  d = findDuplicates({ tickets: [
    { id: 'a', eventName: "A$AP ROCKY - DON'T BE DUMB WORLD TOUR", eventDate: '2026-10-11', quantity: 1, purchasePrice: 86.5 },
    { id: 'b', eventName: "A$AP ROCKY - DON'T BE DUMB WORLD TOUR", eventDate: '2026-10-11', quantity: 3, purchasePrice: 86.5 }] }, asap);
  assert.equal(d.possible.length, 2);
  // another order for the same event (different order number or section) is not a duplicate
  const calin = { ...p, platform: 'Ticketportal', event: 'Calin & Viktor Sheen', eventDate: '2026-12-05', quantity: 4, totalAmount: 4080, orderId: '13642556', section: '414' };
  const have = { id: 'c', eventName: 'Calin & Viktor Sheen', eventDate: '2026-12-05', quantity: 4, purchasePrice: 2020, section: '114' };
  assert.equal(findDuplicates({ tickets: [{ ...have, externalIds: { otherId: '13642393' } }] }, calin).possible.length, 0);
  assert.equal(findDuplicates({ tickets: [have] }, calin).possible.length, 0);
  assert.equal(findDuplicates({ tickets: [{ ...have, section: '414 (4. poschodí)' }] }, calin).possible.length, 1);
});

test('deadline alerts pick undelivered sales and unlisted tickets near the event', () => {
  const store = loadStore();
  delete require.cache[require.resolve('../src/digest')];
  const { dueAlerts } = require('../src/digest');
  const me = store.loadUsers().find(u => u.username === 'michal');
  const now = new Date('2026-10-01T10:00:00');
  return store.updateBucket(me.dataKey, db => {
    db.tickets.push({ id: 'al1', eventName: 'Sold soon', eventDate: '2026-10-02', status: 'sold', quantity: 2 });
    db.tickets.push({ id: 'al2', eventName: 'Unlisted', eventDate: '2026-10-06', status: 'available', quantity: 1 });
    db.tickets.push({ id: 'al3', eventName: 'Far away', eventDate: '2026-12-01', status: 'sold', quantity: 1 });
  }).then(() => {
    const a = dueAlerts(me, now).map(x => x.key).sort();
    assert.ok(a.includes('deliver:al1')); assert.ok(a.includes('list:al2')); assert.ok(!a.some(k => k.endsWith('al3')));
  });
});

test('auth: /me renews tokens older than a day (remember login)', async () => {
  const jwt = require('jsonwebtoken');
  const secret = require('fs').readFileSync(require('path').join(dataDir, 'jwt-secret.txt'), 'utf8').trim();
  const store = loadStore();
  const me = store.loadUsers().find(u => u.username === 'michal');
  const old = jwt.sign({ sub: me.id, username: me.username, iat: Math.floor(Date.now() / 1000) - 3 * 86400 }, secret, { expiresIn: '90d' });
  let r = await fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer ' + old } }).then(x => x.json());
  assert.ok(r.token && r.token !== old, 'renewed token returned');
  r = await fetch(BASE + '/auth/me', { headers: { Authorization: 'Bearer ' + r.token } }).then(x => x.json());
  assert.equal(r.token, undefined, 'fresh token is not renewed again');
});

test('a ticket deleted on the server is not resurrected by a stale app copy', async () => {
  const store = loadStore();
  const { markDeleted } = require('../src/ingest/sales');
  const me = store.loadUsers().find(u => u.username === 'michal');
  await store.updateBucket(me.dataKey, db => { db.tickets.push({ id: 't_zombie', eventName: 'Zombie', updated: '2026-01-01T00:00:00Z' }); });
  let r = await api('GET', '/db');
  const stale = r.data;
  await store.updateBucket(me.dataKey, db => { db.tickets = db.tickets.filter(t => t.id !== 't_zombie'); markDeleted(db, 't_zombie'); });
  await api('PUT', '/db', stale);
  r = await api('GET', '/db');
  assert.ok(!r.data.tickets.some(t => t.id === 't_zombie'), 'not back after PUT');
  assert.ok(r.data._deletedTickets && r.data._deletedTickets.t_zombie, 'tombstone kept');
  await api('POST', '/ticket', stale.tickets.find(t => t.id === 't_zombie'));
  r = await api('GET', '/db');
  assert.ok(!r.data.tickets.some(t => t.id === 't_zombie'), 'not back after POST');
});

test('prefilter: Danish receipt and any PDF attachment go through', () => {
  const { prefilter } = require('../src/ingest/parsers');
  assert.equal(prefilter({ from: 'noreply@fordanmark.dbu.dk', subject: 'Din kvittering - DBU' }).pass, true);
  assert.equal(prefilter({ from: 'x@club.pt', subject: 'Os seus bilhetes' }).pass, true);
  assert.equal(prefilter({ from: 'x@x.pl', subject: 'Potwierdzenie zamówienia' }).pass, true);
  assert.equal(prefilter({ from: 'noreply@info-dbu.dk', subject: 'Info til din kampdag: Danmark - Portugal',
    attachments: [{ filename: 'tickets.pdf', contentType: 'application/pdf' }] }).pass, true);
  assert.equal(prefilter({ from: 'noreply@info-dbu.dk', subject: 'Storskærm i Fælledparken' }).pass, false);
});

test('delivery mails expose ticket numbers so separate transfers are not duplicates', () => {
  const { toParsed } = require('../src/ingest/pipeline');
  const text = 'Ticket-Details\nEvent Datum Ticketanzahl Ticketnummer RB Leipzig vs. PSV Eindhoven 13 Oct 2026\n21:00 2 38010778298, 38010779694\nBevor du dich';
  const p = toParsed({ relevant: true, kind: 'delivery', event: 'RB Leipzig vs. PSV Eindhoven', eventDate: '2026-10-13', quantity: 2 },
    { from: 'no-reply@tickets.rbleipzig.com', subject: 'Mobile Ticket(s) verfügbar', text });
  assert.deepEqual(p.ticketNumbers, ['38010778298', '38010779694']);
  assert.deepEqual(toParsed({ relevant: true, kind: 'purchase' }, { from: 'a@b.c', subject: 'x', text: 'Order 2026 total 45' }).ticketNumbers, []);
});

test('viagogo payout mail lists every order of the payment', () => {
  const { parseViagogoPayout } = require('../src/ingest/parsers');
  const text = 'Hello Michal,\nWe processed your payment on Friday, October 2, 2026.\nPayment reference # 67869485\nPayment IDOrder IDOrder DatePaymentTicket(s) YZO6786948563127843512-Dec-25 07:04\nPM€316.44\n2Czechia vs Croatia - Nations League6786948565526802526-Sep-26 12:27 PM€61.52\n2Payment:€377.96 \nIf you see a charge';
  const p = parseViagogoPayout({ from: '"viagogo" <automated@orders.viagogo.com>', subject: 'viagogo payment 67869485 - You have just been paid', text });
  assert.equal(p.paymentRef, '67869485');
  assert.equal(p.paidDate, '2026-10-02');
  assert.equal(p.total, 377.96);
  assert.deepEqual(p.orders.map(o => [o.orderId, o.saleDate, o.amount, o.quantity, o.event]),
    [['631278435', '2025-12-12', 316.44, 2, 'YZO'], ['655268025', '2026-09-26', 61.52, 2, 'Czechia vs Croatia - Nations League']]);
  assert.equal(parseViagogoPayout({ from: 'x@stubhub.com', subject: 'You have just been paid', text }), null);
});

test('login brute-force guard: 429 after repeated failures, per username and per client IP', async () => {
  const post = (username, ip) => fetch(BASE + '/auth/login', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip }, body: JSON.stringify({ username, password: 'wrong' }) });
  for (let i = 0; i < 8; i++) assert.equal((await post('ghost', '203.0.113.1')).status, 401);
  assert.equal((await post('ghost', '203.0.113.2')).status, 429);          // username locked from any IP
  for (let i = 0; i < 20; i++) await post('ghost' + i, '203.0.113.9');     // 20 failures from one IP…
  assert.equal((await post('someone', '203.0.113.9')).status, 429);       // …locks that IP
  assert.equal((await post('someone', '203.0.113.10')).status, 401);      // other IPs unaffected
});
