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
