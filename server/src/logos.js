'use strict';
// Team crests and artist pictures for the inventory, fetched once and cached in
// data/logos/ (index.json + small images).
//   teams   -> TheSportsDB (free key "123"): club and national-team badges
//   artists -> Deezer artist search: artist picture
//   GET /logos/resolve?team=RB%20Leipzig&artist=Backstreet%20Boys   (repeatable)
//       -> { logos: { "team:rb leipzig": "/logos/f/<hash>.png" | null }, pending: [keys] }
//   GET /logos/f/<file>
// Public on purpose: <img> tags cannot send the bearer token and the pictures are
// public. Unknown names are resolved in the background, one at a time, paced for the
// free APIs; the client polls again while keys are pending.
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const cfg = require('./config');

const DIR = path.join(cfg.DATA_DIR, 'logos');
const INDEX = path.join(DIR, 'index.json');
const UA = 'TicketVault/1.17 (self-hosted ticket inventory)';
const RETRY_MISS_MS = 7 * 86400000;

fs.mkdirSync(DIR, { recursive: true });
let index = {};
try { index = JSON.parse(fs.readFileSync(INDEX, 'utf8')); } catch { index = {}; }
const saveIndex = () => fs.writeFileSync(INDEX, JSON.stringify(index, null, 1));

const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9$&]+/g, ' ').trim();
const keyOf = (kind, name) => `${kind}:${norm(name)}`;

// Local / Czech / German spellings the sports database does not know.
const TEAM_ALIASES = {
  'psg': 'Paris Saint Germain', 'paris sg': 'Paris Saint Germain', 'paris saint germain': 'Paris Saint Germain',
  'man utd': 'Manchester United', 'man united': 'Manchester United', 'man city': 'Manchester City', 'spurs': 'Tottenham Hotspur',
  'bayern munchen': 'Bayern Munich', 'fc bayern munchen': 'Bayern Munich', 'bayern': 'Bayern Munich',
  'schachtar donezk': 'Shakhtar Donetsk', 'sachtar doneck': 'Shakhtar Donetsk', 'borussia m gladbach': "Borussia Monchengladbach",
  'borussia monchengladbach': 'Borussia Monchengladbach', 'inter': 'Inter Milan', 'inter milano': 'Inter Milan', 'ac milano': 'AC Milan',
  'sparta praha': 'Sparta Prague', 'slavia praha': 'Slavia Prague', 'viktoria plzen': 'Viktoria Plzen',
  'anglie': 'England', 'chorvatsko': 'Croatia', 'cesko': 'Czech Republic', 'ceska republika': 'Czech Republic', 'czechia': 'Czech Republic',
  'nemecko': 'Germany', 'spanelsko': 'Spain', 'francie': 'France', 'dansko': 'Denmark', 'portugalsko': 'Portugal', 'skotsko': 'Scotland',
  'danmark': 'Denmark', 'congo dr': 'DR Congo', 'dr congo': 'DR Congo', 'kongo': 'DR Congo', 'como 1907': 'Como',
  'brighton': 'Brighton and Hove Albion', 'brighton & hove albion': 'Brighton and Hove Albion', 'tottenham': 'Tottenham Hotspur', 'como': 'Como',
  'rc lens': 'Lens', 'sv elversberg 07': 'Elversberg', 'sv elversberg': 'Elversberg'
};
function teamVariants(name) {
  const n = norm(name);
  const out = [];
  if (TEAM_ALIASES[n]) out.push(TEAM_ALIASES[n]);
  out.push(name);
  // Drop club-form prefixes/suffixes: "FC", "SV", "AFC", "1.", trailing year digits.
  const stripped = name.replace(/\b(FC|AFC|CF|SC|SV|VfB|VfL|TSG|1\.|AC|AS|SSC|RC)\b\.?/gi, ' ').replace(/\b\d{2,4}\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (stripped && norm(stripped) !== n) out.push(TEAM_ALIASES[norm(stripped)] || stripped);
  return [...new Set(out)];
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (r.status === 429) { const e = new Error('rate limited'); e.retry = true; throw e; }
  if (!r.ok) throw new Error(new URL(url).host + ' ' + r.status);
  return r.json();
}

async function findTeam(name) {
  for (const q of teamVariants(name)) {
    const d = await getJson('https://www.thesportsdb.com/api/v1/json/123/searchteams.php?t=' + encodeURIComponent(q));
    // Senior men's sides only: a women's / youth team sharing the short name is the wrong crest.
    const teams = (d.teams || []).filter(t => t.strSport === 'Soccer' && t.strBadge &&
      !/women|wfc|\bu-?\d{2}\b|youth|reserves|\bii\b/i.test(t.strTeam + ' ' + (t.strLeague || '')));
    if (!teams.length) continue;
    const nq = norm(q);
    const score = t => (norm(t.strTeam) === nq ? 10 : 0);
    const best = teams.sort((a, b) => score(b) - score(a))[0];
    return { url: best.strBadge + '/small', label: best.strTeam + (best.strLeague ? ` (${best.strLeague})` : '') };
  }
  return null;
}

async function findArtist(name) {
  const tries = [name, name.split(/\s*(?:&|,| x | feat\.? | ft\.? | and )\s*/i)[0]];
  for (const q of [...new Set(tries.filter(Boolean))]) {
    const d = await getJson('https://api.deezer.com/search/artist?limit=5&q=' + encodeURIComponent(q));
    const hits = (d.data || []).filter(a => a.picture_medium && !/\/artist\/\/|\/images\/artist\/\//.test(a.picture_medium));
    const plain = s => norm(s).replace(/\$/g, 's');   // "Asap Rocky" = "A$AP Rocky"
    const nq = plain(q);
    // Only a real name match: event titles like 'UFC Fight Night' must not pick a random artist.
    const best = hits.find(a => plain(a.name) === nq) ||
      hits.find(a => plain(a.name).length > 2 && (nq.startsWith(plain(a.name) + ' ') || plain(a.name).startsWith(nq + ' ')));
    if (best) return { url: best.picture_medium, label: best.name };
  }
  return null;
}

async function resolve(kind, name) {
  const found = kind === 'team' ? await findTeam(name) : await findArtist(name);
  if (!found) return null;
  const r = await fetch(found.url, { headers: { 'User-Agent': UA } });
  const type = r.headers.get('content-type') || '';
  if (!r.ok || !/^image\//.test(type)) return null;
  const file = crypto.createHash('sha1').update(keyOf(kind, name)).digest('hex').slice(0, 16) + (/jpe?g/.test(type) ? '.jpg' : '.png');
  fs.writeFileSync(path.join(DIR, file), Buffer.from(await r.arrayBuffer()));
  return { file, label: found.label, source: found.url };
}

// Background queue, one lookup at a time (TheSportsDB free tier: ~30 requests/min).
const queue = [];
const queued = new Set();
let running = false;
async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    try {
      const r = await resolve(job.kind, job.name);
      index[job.key] = r ? { ...r, name: job.name, at: Date.now() } : { file: null, name: job.name, at: Date.now() };
      console.log(`[logos] ${job.key} -> ${r ? r.file + ' (' + r.label + ')' : 'not found'}`);
      saveIndex();
    } catch (e) {
      console.warn(`[logos] ${job.key} failed: ${e.message}`);
      if (e.retry) { queue.push(job); await new Promise(r => setTimeout(r, 30000)); continue; }
    }
    queued.delete(job.key);
    await new Promise(r => setTimeout(r, 2200));
  }
  running = false;
}

const router = express.Router();
router.get('/resolve', (req, res) => {
  const list = (v) => [].concat(v || []).map(String).filter(s => s.trim()).slice(0, 300);
  const logos = {}, pending = [];
  for (const [kind, names] of [['team', list(req.query.team)], ['artist', list(req.query.artist)]]) {
    for (const name of names) {
      const key = keyOf(kind, name);
      const hit = index[key];
      if (hit && (hit.file || Date.now() - hit.at < RETRY_MISS_MS)) { logos[key] = hit.file ? '/logos/f/' + hit.file : null; continue; }
      pending.push(key);
      if (!queued.has(key)) { queued.add(key); queue.push({ kind, name, key }); }
    }
  }
  if (queue.length) pump();
  res.json({ logos, pending });
});
router.use('/f', express.static(DIR, { maxAge: '30d', index: false, dotfiles: 'ignore' }));

module.exports = { router, keyOf, norm, teamVariants, _resolve: resolve };
