'use strict';
// One persistent IMAP connection per mailbox. New mail arrives through IDLE
// (the server pushes an "exists" event within seconds); a reconcile poll every
// INGEST_POLL_MINUTES re-checks "UID > last processed" so a silently dead IDLE
// never loses mail. Every fetched message is stored raw before processing.
const { ImapFlow } = require('imapflow');
const cfg = require('../config');
const store = require('../store');
const { ingestRaw } = require('./pipeline');
const { prefilter } = require('./parsers');
const { triage } = require('./llm');

const workers = new Map();   // name -> worker state

function resolveOwner(mb) {
  const users = store.loadUsers();
  if (mb.owner) {
    const u = users.find(x => x.username.toLowerCase() === String(mb.owner).toLowerCase());
    if (u) return u;
    console.error(`[imap:${mb.name}] owner "${mb.owner}" not found among users; falling back to first admin`);
  }
  return users.find(u => u.role === 'admin') || users[0] || null;
}

// Does the MIME tree contain a PDF part (attachment or inline)?
function structureHasPdf(node) {
  if (!node) return false;
  const name = (node.dispositionParameters && node.dispositionParameters.filename) || (node.parameters && node.parameters.name) || '';
  if (/pdf/i.test(node.type || '') || /\.pdf$/i.test(name)) return true;
  return (node.childNodes || []).some(structureHasPdf);
}

async function resolveFolder(client, wanted) {
  if (wanted && wanted !== 'auto') return wanted;
  return findAllMail(await client.list().catch(() => [])) || 'INBOX';
}

// Gmail "All Mail" by special-use attribute, raw flag, or localized name.
function findAllMail(list) {
  const f = (list || []).find(x => x.specialUse === '\\All')
    || (list || []).find(x => x.flags && [...x.flags].includes('\\All'))
    || (list || []).find(x => /^\[Gmail\]\/(All Mail|Všechny zprávy|Alle Nachrichten|Tous les messages)$/i.test(x.path));
  return f ? f.path : null;
}

class MailboxWorker {
  constructor(mb) {
    this.mb = mb;
    this.client = null;
    this.stopped = false;
    this.backoff = 5000;
    this.state = store.loadImapState(mb.name);
    this.status = { name: mb.name, email: mb.email, connected: false, lastUid: this.state.lastUid, lastCheck: null, lastError: null, processed: 0 };
    this.pollTimer = null;
    this.fetching = false;
    this.pendingCheck = false;
  }

  log(...a) { console.log(`[imap:${this.mb.name}]`, ...a); }

  async start() {
    while (!this.stopped) {
      try {
        await this.runOnce();
        this.backoff = 5000;
      } catch (e) {
        this.status.connected = false;
        this.status.lastError = e.message;
        this.log('connection error:', e.message);
      }
      if (this.stopped) break;
      this.log(`reconnecting in ${Math.round(this.backoff / 1000)}s`);
      await new Promise(r => setTimeout(r, this.backoff));
      this.backoff = Math.min(this.backoff * 2, 10 * 60 * 1000);
    }
  }

  async runOnce() {
    const mb = this.mb;
    const client = new ImapFlow({
      host: mb.host, port: mb.port, secure: mb.secure,
      auth: { user: mb.user, pass: mb.pass },
      logger: false, emitLogs: false,
      clientInfo: { name: 'TicketVault', version: '1.0' }
    });
    this.client = client;
    const closed = new Promise((resolve) => {
      client.once('close', () => resolve('close'));
      // .on, not .once: a second 'error' without a listener would crash the whole process.
      client.on('error', (e) => { this.status.lastError = e.message; resolve('error:' + e.message); });
    });
    await client.connect();
    const folder = await resolveFolder(client, mb.folder);
    const lock = await client.getMailboxLock(folder);
    this.status.connected = true;
    this.status.lastError = null;
    this.log(`connected (${mb.host}) folder "${folder}", ${client.mailbox.exists} messages, lastUid=${this.state.lastUid}`);

    // UIDVALIDITY changed => the server renumbered everything; start over from the backfill window.
    if (this.state.uidValidity && String(client.mailbox.uidValidity) !== String(this.state.uidValidity)) {
      this.log('UIDVALIDITY changed, resetting checkpoint');
      this.state.lastUid = 0;
    }
    this.state.uidValidity = String(client.mailbox.uidValidity);

    client.on('exists', () => this.scheduleCheck('idle'));
    this.pollTimer = setInterval(() => this.scheduleCheck('poll'), cfg.INGEST_POLL_MINUTES * 60 * 1000);

    try {
      await this.checkNew('startup');
      const why = await closed;           // block here until the connection drops
      throw new Error('connection closed: ' + why);
    } finally {
      clearInterval(this.pollTimer);
      this.status.connected = false;
      try { lock.release(); } catch { /* ignore */ }
      try { await client.logout(); } catch { /* ignore */ }
      this.client = null;
    }
  }

  scheduleCheck(reason) {
    if (this.fetching) { this.pendingCheck = true; return; }
    this.checkNew(reason).catch(e => { this.status.lastError = e.message; this.log('check failed:', e.message); });
  }

  async checkNew(reason) {
    if (!this.client || this.fetching) return;
    this.fetching = true;
    try {
      const client = this.client;
      let uids;
      if (this.state.lastUid > 0) {
        uids = await client.search({ uid: `${this.state.lastUid + 1}:*` }, { uid: true });
        uids = (uids || []).filter(u => u > this.state.lastUid);
        // Gmail's long-lived session on "All Mail" can stop seeing new mail (no EXISTS,
        // SEARCH stays empty). STATUS reports the real UIDNEXT: if it says there is
        // mail we cannot see, drop the connection so the reconnect's startup check reads it.
        if (!uids.length && reason !== 'startup') {
          const st = await client.status(client.mailbox.path, { uidNext: true }).catch(() => null);
          if (st && st.uidNext && st.uidNext - 1 > this.state.lastUid) {
            this.log(`stale session: UIDNEXT ${st.uidNext} but nothing after ${this.state.lastUid}, reconnecting`);
            this.backoff = 1000;
            client.close();
            return;
          }
        }
      } else {
        const since = new Date(Date.now() - cfg.INGEST_BACKFILL_DAYS * 86400000);
        uids = (await client.search({ since }, { uid: true })) || [];
        this.log(`initial backfill: ${uids.length} messages since ${since.toISOString().slice(0, 10)}`);
      }
      this.status.lastCheck = new Date().toISOString();
      if (!uids.length) return;
      uids.sort((a, b) => a - b);
      const owner = resolveOwner(this.mb);
      if (!owner) { this.log('no users registered yet, waiting'); return; }
      // Sales are matched against the inventory, so wait until the app has uploaded it.
      if (!store.loadBucket(owner.dataKey).tickets.length) {
        if (!this.warnedEmpty) this.log(`owner "${owner.username}" has no tickets on the server yet (use "Nahrát vše" in the app), waiting`);
        this.warnedEmpty = true;
        return;
      }

      for (const uid of uids) {
        if (this.stopped) break;
        let source = null;
        let fromAddr = '', subject = '';
        let hasPdf = false;
        for await (const msg of client.fetch({ uid: String(uid) }, { uid: true, envelope: true, bodyStructure: true }, { uid: true })) {
          fromAddr = (msg.envelope?.from || []).map(x => x.address || '').join(',').toLowerCase();
          subject = msg.envelope?.subject || '';
          hasPdf = structureHasPdf(msg.bodyStructure);
        }
        // Our own sent mail shows up in Gmail "All Mail"; never ingest it.
        if (fromAddr && fromAddr.includes(this.mb.email.toLowerCase())) { this.advance(uid); continue; }
        // Cheap prefilter on the envelope before downloading the full message.
        if (cfg.INGEST_PREFILTER) {
          const pre = prefilter({ from: fromAddr, subject });
          // A PDF attachment (tickets, receipts, invoices) always goes through, whatever the language.
          let triaged = null;
          if (!pre.pass && !hasPdf && pre.reason === 'no-keyword' && cfg.TRIAGE_ENABLED && cfg.LLM_ENABLED) {
            triaged = await triage(fromAddr, subject);
            if (triaged.relevant) pre.pass = true;
          }
          if (triaged) store.appendIngestLog({ mailbox: this.mb.name, uid, from: fromAddr, subject, result: 'triage', answer: triaged.answer, error: triaged.error, usage: triaged.usage });
          if (!pre.pass && !(hasPdf && pre.reason !== 'junk-subject')) {
            store.appendIngestLog({ mailbox: this.mb.name, uid, from: fromAddr, subject, result: 'skipped', reason: pre.reason });
            this.advance(uid);
            continue;
          }
        }
        for await (const msg of client.fetch({ uid: String(uid) }, { uid: true, source: true }, { uid: true })) {
          source = msg.source;
        }
        if (!source) { this.log(`uid ${uid}: no source returned, skipping`); this.advance(uid); continue; }
        const rawPath = store.saveRawMail(this.mb.name, uid, source);
        try {
          // The envelope-level screening above already decided: don't filter again.
          const r = await ingestRaw(source, { mailboxName: this.mb.name, owner, dataKey: owner.dataKey, uid, rawPath, prefilterPassed: true });
          this.status.processed++;
          if (r.result === 'created') this.log(`uid ${uid}: inbox item ${r.item.id} (${r.item.parsed.kind}, ${r.item.parsed.platform || '?'})`);
        } catch (e) {
          this.log(`uid ${uid}: pipeline error: ${e.message}`);
          store.appendIngestLog({ mailbox: this.mb.name, uid, result: 'error', error: e.message });
          if (e.retryable) {
            // Keep the checkpoint before this UID; the next poll/IDLE retries it.
            this.status.lastError = e.message;
            this.log(`stopping this pass, will retry uid ${uid} on next check`);
            break;
          }
        }
        this.advance(uid);
      }
      this.log(`check (${reason}): ${uids.length} new`);
    } finally {
      this.fetching = false;
      if (this.pendingCheck) { this.pendingCheck = false; this.scheduleCheck('queued'); }
    }
  }

  advance(uid) {
    this.state.lastUid = Math.max(this.state.lastUid, uid);
    this.status.lastUid = this.state.lastUid;
    store.saveImapState(this.mb.name, this.state);
  }

  async stop() {
    this.stopped = true;
    clearInterval(this.pollTimer);
    try { if (this.client) await this.client.logout(); } catch { /* ignore */ }
  }
}

function startAll() {
  const list = cfg.loadMailboxes().filter(m => m.enabled);
  if (!list.length) { console.log('[ingest] no mailboxes configured (data/mailboxes.json or MAILBOXES env)'); return; }
  if (cfg.LLM_ENABLED && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log('[ingest] NOT started: ANTHROPIC_API_KEY is empty in .env (set it, or LLM_ENABLED=false for parsers only)');
    return;
  }
  for (const mb of list) {
    if (workers.has(mb.name)) continue;
    const w = new MailboxWorker(mb);
    workers.set(mb.name, w);
    w.start();
  }
  console.log(`[ingest] watching ${list.length} mailbox(es): ${list.map(m => m.email).join(', ')}`);
}

function stopAll() { for (const w of workers.values()) w.stop(); }
function getStatus() { return { mailboxes: [...workers.values()].map(w => w.status), model: cfg.CLAUDE_MODEL, llm: cfg.LLM_ENABLED }; }

module.exports = { startAll, stopAll, getStatus, MailboxWorker, findAllMail };
