'use strict';
// Small CLI for operating the ingest without the HTTP API:
//   node src/cli.js ingest-file <path.eml> [username]   process one saved e-mail
//   node src/cli.js ingest-once                          connect each mailbox, fetch new mail, exit
//   node src/cli.js reset-checkpoint <mailboxName>       forget last UID (re-runs the backfill window)
const fs = require('fs');
const cfg = require('./config');
const store = require('./store');

async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  if (cmd === 'ingest-file') {
    if (!a1 || !fs.existsSync(a1)) throw new Error('usage: ingest-file <path.eml> [username]');
    const users = store.loadUsers();
    const owner = a2 ? users.find(u => u.username === a2) : (users.find(u => u.role === 'admin') || users[0]);
    if (!owner) throw new Error('no users registered yet');
    const { ingestRaw } = require('./ingest/pipeline');
    const r = await ingestRaw(fs.readFileSync(a1), { mailboxName: 'cli', owner, dataKey: owner.dataKey, rawPath: a1 });
    console.log(JSON.stringify(r, null, 2));
  } else if (cmd === 'ingest-once') {
    const { MailboxWorker } = require('./ingest/imap');
    for (const mb of cfg.loadMailboxes()) {
      const w = new MailboxWorker(mb);
      // runOnce blocks until the connection closes, so drive the check manually.
      const { ImapFlow } = require('imapflow');
      const client = new ImapFlow({ host: mb.host, port: mb.port, secure: mb.secure, auth: { user: mb.user, pass: mb.pass }, logger: false });
      client.on('error', e => console.error(`[${mb.name}]`, e.message));
      await client.connect();
      const { findAllMail } = require('./ingest/imap');
      const all = findAllMail(await client.list());
      const lock = await client.getMailboxLock(mb.folder === 'auto' ? (all || 'INBOX') : mb.folder);
      w.client = client;
      w.state.uidValidity = String(client.mailbox.uidValidity);
      try { await w.checkNew('cli'); } finally { lock.release(); await client.logout(); }
      console.log(JSON.stringify(w.status));
    }
  } else if (cmd === 'reset-checkpoint') {
    if (!a1) throw new Error('usage: reset-checkpoint <mailboxName>');
    store.saveImapState(a1, { lastUid: 0, uidValidity: null });
    console.log('checkpoint reset for', a1);
  } else {
    console.log('commands: ingest-file <eml> [user] | ingest-once | reset-checkpoint <mailbox>');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
