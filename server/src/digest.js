'use strict';
// Daily digest per user: pending inbox items, events in the next 7 days,
// sold-but-undelivered tickets, unsold tickets with an event within 7 days.
// Sent once a day at DIGEST_HOUR (server local time) to every channel the user enabled.
const cfg = require('./config');
const store = require('./store');
const notify = require('./notify');

function buildDigest(user) {
  const db = store.loadBucket(user.dataKey);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const in7 = new Date(today.getTime() + 7 * 86400000);
  const d = (s) => { const x = new Date(s); return isNaN(x) ? null : x; };

  const pending = db.inbox.filter(i => !i.state || i.state === 'pending_review');
  const upcoming = db.tickets.filter(t => { const x = d(t.eventDate); return x && x >= today && x <= in7 && t.status !== 'cancelled'; })
    .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)));
  const undelivered = upcoming.filter(t => t.status === 'sold');
  const unsold = upcoming.filter(t => t.status === 'available' || t.status === 'listed');

  const lines = [];
  lines.push(`TicketVault souhrn ${new Date().toLocaleDateString('cs-CZ')}`);
  lines.push(`📥 Ke kontrole v Příchozích: ${pending.length}`);
  lines.push(`📅 Akce do 7 dnů: ${upcoming.length}`);
  for (const t of upcoming.slice(0, 15)) {
    lines.push(`  • ${t.eventDate} ${t.eventName} — ${t.quantity} ks, ${t.status}${t.platform ? ' (' + t.platform + ')' : ''}`);
  }
  if (undelivered.length) lines.push(`🚚 Prodané, neodeslané: ${undelivered.length}`);
  if (unsold.length) lines.push(`⚠ Neprodané do 7 dnů: ${unsold.length}`);
  return { text: lines.join('\n'), total: pending.length + upcoming.length, pending: pending.length, upcoming: upcoming.length };
}

async function sendDigestForUser(user, { force = false } = {}) {
  const { text, total } = buildDigest(user);
  const channels = {};
  if (user.email && (user.digestEnabled || force)) channels.email = await notify.email(user.email, 'TicketVault – denní souhrn', text);
  if (user.discordEnabled && user.discordWebhook) channels.discord = await notify.discord(user.discordWebhook, '```\n' + text + '\n```');
  if (user.pushoverEnabled && user.pushoverUser && user.pushoverToken) channels.pushover = await notify.pushover(user.pushoverUser, user.pushoverToken, 'TicketVault souhrn', text);
  return { total, channels, messageId: channels.email?.messageId || null, text };
}

const lastRun = new Set();   // 'YYYY-MM-DD@H' already sent
function startScheduler() {
  setInterval(async () => {
    const now = new Date();
    const slot = now.toLocaleDateString('sv-SE') + '@' + now.getHours();
    if (!cfg.DIGEST_HOURS.includes(now.getHours()) || lastRun.has(slot)) return;
    lastRun.add(slot);
    for (const u of store.loadUsers()) {
      const wants = (u.digestEnabled && u.email) || (u.discordEnabled && u.discordWebhook) || (u.pushoverEnabled && u.pushoverUser);
      if (!wants) continue;
      try { const r = await sendDigestForUser(u); console.log(`[digest] ${u.username}:`, JSON.stringify(r.channels)); }
      catch (e) { console.error(`[digest] ${u.username} failed:`, e.message); }
    }
  }, 60 * 1000).unref();
  console.log(`[digest] scheduled daily at ${cfg.DIGEST_HOURS.map(h => h + ':00').join(', ')}`);
}

module.exports = { buildDigest, sendDigestForUser, startScheduler };
