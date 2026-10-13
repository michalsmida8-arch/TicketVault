'use strict';
// Seatiks routes for the app (all need the user's session; the API key stays on the server):
//   GET  /seatiks/status          key configured? mode (test/live), scopes
//   POST /seatiks/key   { key }   validate with GET /v1/me and store on the user ('' = remove)
//   GET  /seatiks/events?q=&from=&to=   event search
//   GET  /seatiks/events/:id      event + section catalog
//   GET  /seatiks/platforms       marketplace ids
//   POST /seatiks/list            list one inventory ticket (see seatiks.listTicket)
//   POST /seatiks/sync            pull sales now (otherwise every 5 minutes)
const express = require('express');
const { requireAuth } = require('./auth');
const store = require('./store');
const seatiks = require('./seatiks');

const router = express.Router();
router.use(requireAuth);
// req.user from the token may be a trimmed copy: take the stored record (it holds the key).
const me = req => store.loadUsers().find(u => u.id === req.user.id) || req.user;
const wrap = fn => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(e.status || 500).json({ error: e.message, code: e.code || undefined }); }
};

router.get('/status', wrap(req => seatiks.status(me(req))));
router.post('/key', wrap(req => seatiks.setKey(me(req), (req.body || {}).key)));
router.get('/events', wrap(req => seatiks.searchEvents(me(req), { q: req.query.q, from: req.query.from, to: req.query.to })));
router.get('/events/:id', wrap(req => seatiks.getEvent(me(req), req.params.id)));
router.get('/platforms', wrap(req => seatiks.platforms(me(req))));
router.post('/list', wrap(req => seatiks.listTicket(me(req), req.body)));
router.post('/sync', wrap(req => seatiks.pollUser(me(req))));

module.exports = router;
