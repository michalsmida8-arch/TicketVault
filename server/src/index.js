'use strict';
const express = require('express');
const cfg = require('./config');
const { router: authRouter } = require('./auth');
const dbRouter = require('./routes-db');
const pkg = require('../package.json');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '50mb' }));

// Small request log (one line per request, no bodies).
app.use((req, res, next) => {
  const t = Date.now();
  res.on('finish', () => {
    if (req.path !== '/api/db' || res.statusCode >= 400) {
      console.log(`[http] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - t}ms`);
    }
  });
  next();
});

// The desktop app is configured with ".../api" as base URL, so everything
// lives under /api. Same handlers are also mounted at root for convenience.
const api = express.Router();
api.get('/ping', (req, res) => res.json({
  ok: true, service: 'TicketVault API (self-hosted)', version: pkg.version,
  time: new Date().toISOString(),
  hasInviteCode: !!cfg.INVITE_CODE,
  hasApiKey: true   // legacy field the app's "Testovat připojení" checks
}));
api.use('/auth', authRouter);
api.use('/', dbRouter);
app.use('/api', api);
app.use('/', api);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[http] error:', err.message);
  res.status(err.status || 500).json({ error: err.type === 'entity.parse.failed' ? 'Neplatný JSON.' : err.message });
});

const server = app.listen(cfg.PORT, cfg.HOST, () => {
  console.log(`TicketVault server ${pkg.version} listening on http://${cfg.HOST}:${cfg.PORT}/api  (data: ${cfg.DATA_DIR})`);
  if (cfg.INGEST_ENABLED) require('./ingest/imap').startAll();
  else console.log('[ingest] disabled (INGEST_ENABLED=false)');
  require('./digest').startScheduler();
  require('./digest').startAlertScheduler();
});

function shutdown() {
  console.log('shutting down...');
  try { require('./ingest/imap').stopAll(); } catch { /* ignore */ }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('unhandledRejection', e => console.error('[unhandledRejection]', e));
