'use strict';
// SyncSeats routes for the app (all need the user's session; the API key stays on the server):
//   GET  /syncseats/status          key configured? mode (test/live), scopes, last sync
//   POST /syncseats/key   { key }   validate with GET /v1/me and store on the user ('' = remove)
//   GET  /syncseats/events?q=&from=&to=   event search (YYYY-MM-DD)
//   POST /syncseats/list            one inventory ticket → DRAFT listing (see syncseats.listTicket)
//   POST /syncseats/sync            pull sales now (otherwise every 5 minutes)
const express = require('express');
const { requireAuth } = require('./auth');
const store = require('./store');
const syncseats = require('./syncseats');

const router = express.Router();
router.use(requireAuth);
const me = req => store.loadUsers().find(u => u.id === req.user.id) || req.user;
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || undefined }); }
};

router.get('/status', wrap(req => syncseats.status(me(req))));
router.post('/key', wrap(req => syncseats.setKey(me(req), (req.body || {}).key)));
router.get('/events', wrap(req => syncseats.searchEvents(me(req), { q: req.query.q, from: req.query.from, to: req.query.to })));
router.post('/list', wrap(req => syncseats.listTicket(me(req), req.body)));
router.post('/sync', wrap(req => syncseats.pollUser(me(req))));

module.exports = router;
