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

// ---- Web edition: the same UI served from the repo's src/ folder -----------------
// /app loads index.html with web-api.js injected (it replaces the Electron preload),
// everything else under /app is served as static files.
const path = require('path');
const fsx = require('fs');
const APP_DIR = path.join(__dirname, '..', '..', 'src');
function sendIndex(req, res) {
  try {
    let html = fsx.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
    html = html.replace('<script src="icons.js"></script>', '<script src="web-api.js"></script>\n  <script src="icons.js"></script>');
    res.set('Cache-Control', 'no-cache').type('html').send(html);
  } catch (e) { res.status(500).send('TicketVault web není k dispozici: ' + e.message); }
}
if (fsx.existsSync(APP_DIR)) {
  app.get(['/app', '/app/', '/app/index.html'], sendIndex);
  app.use('/app', express.static(APP_DIR, { index: false, maxAge: 0 }));
  app.get('/', (req, res) => res.redirect('/app/'));
}

// The desktop app is configured with ".../api" as base URL, so everything
// lives under /api. Same handlers are also mounted at root for convenience.
const api = express.Router();
api.get('/ping', (req, res) => res.json({
  ok: true, service: 'TicketVault API (self-hosted)', version: pkg.version,
  time: new Date().toISOString(),
  hasInviteCode: !!cfg.INVITE_CODE,
  hasApiKey: true   // legacy field the app's "Testovat připojení" checks
}));
// Exchange rates for the web edition (the page may only talk to its own origin).
let ratesCache = null;
api.get('/rates', async (req, res) => {
  try {
    if (!ratesCache || Date.now() - ratesCache.at > 6 * 3600 * 1000) {
      const r = await fetch('https://open.er-api.com/v6/latest/EUR');
      const d = await r.json();
      if (d.result !== 'success') throw new Error('rate API error');
      ratesCache = { at: Date.now(), rates: { ...d.rates, EUR: 1, _updated: new Date().toISOString() } };
    }
    res.json({ rates: ratesCache.rates });
  } catch (e) { res.status(502).json({ error: 'Kurzy se nepodařilo načíst: ' + e.message }); }
});
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
