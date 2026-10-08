// Tikey Manager (1.18) — REAL sale prices from the marketplaces, read through the
// user's own Tikey login in the embedded "Tikey" panel (persist:tikey).
// Tikey's Sales Tracker records every sale on StubHub (Premier League) and
// Viagogo (everything else) with time, section, row, quantity and unit price.
// For each future unsold ticket we find the event in Tikey, pull its sales and
// keep a summary on the ticket (listing.tikey): the whole event and the
// ticket's own section. Read-only — nothing is ever written to Tikey.
// Endpoints (internal, cookie session; see CLAUDE.md):
//   GET /api/salestracker/v2/trackers?platform=stubhub|viagogo&query=…  → events[]
//   GET /api/salestracker/v2/data?platform=…&eventId=<StubHub id | E-<viagogo id>>&salesLimit&salesPage → salesData[]
// Relies on app.js globals: state, ensureMarketplaceLoaded, toast, escapeHtml,
// formatMoney, refreshDb; listing.js: window.__listing (platformOf, searchTerms, score).
(function () {
  const DAY = 86400000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const STALE_MS = 6 * 3600000;
  const isWeb = () => document.documentElement.classList.contains('web-mode');
  const st = t => String(t.status || 'available').trim().toLowerCase();
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // ---------- panel ----------------------------------------------------------------
  async function panel() {
    if (isWeb()) throw new Error('Tikey funguje jen v desktopové aplikaci.');
    if (typeof ensureMarketplaceLoaded === 'function') ensureMarketplaceLoaded('tikey');
    const wv = document.getElementById('webview-tikey');
    if (!wv) throw new Error('Panel Tikey nenalezen');
    for (let i = 0; i < 60; i++) {
      try { if (wv.getURL() && !wv.isLoading()) return wv; } catch (_) { /* not attached yet */ }
      await sleep(500);
    }
    throw new Error('Panel Tikey se nenačetl');
  }
  async function inPanel(fn, arg) {
    const wv = await panel();
    return wv.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`, true);
  }

  // Page functions — serialized and run INSIDE tikeymanager.com. Self-contained.
  async function pageTikeySearch(q) {
    const r = await fetch('/api/salestracker/v2/trackers?platform=' + q.platform + '&limit=20&page=1&includeTotal=true&query=' + encodeURIComponent(q.term) + '&sort=search_relevance', { credentials: 'include' });
    if (r.status === 401 || r.status === 403 || r.redirected) return { error: 'login' };
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const j = await r.json().catch(() => null);
    if (!j) return { error: 'login' };
    return { events: (j.events || []).map(e => ({
      id: q.platform === 'stubhub' ? String(e.StubHubId || e.eventid) : (e.VggId || 'E-' + e.eventid),
      name: e.eventtitle, date: e.eventdate, venue: e.venue && e.venue.name, city: e.city, sales: e.salesCount })) };
  }
  async function pageTikeySales(q) {
    const sales = [];
    let summary = null;
    for (let p = 1; p <= 25; p++) {
      const r = await fetch('/api/salestracker/v2/data?platform=' + q.platform + '&eventId=' + encodeURIComponent(q.eventId) + '&salesLimit=100&salesPage=' + p + '&includeRaw=false&salesSortField=time&salesSortDirection=descending', { credentials: 'include' });
      if (r.status === 401 || r.status === 403 || r.redirected) return { error: 'login' };
      if (r.status === 404) return { missing: true };
      if (!r.ok) return { error: 'HTTP ' + r.status };
      const j = await r.json().catch(() => null);
      if (!j) return { error: 'login' };
      summary = summary || j.salesSummary || null;
      for (const x of j.salesData || []) sales.push({ at: x.soldAt, section: x.section || '', row: x.row || '', qty: Number(x.quantity) || 1, price: Number(x.unitPrice) || 0, currency: x.currency || null });
      if (!j.hasMoreSales) break;
    }
    return { sales, summary };
  }

  // ---------- matching ---------------------------------------------------------------
  // Tikey platform for a ticket follows the listing rule: Premier League → StubHub, else Viagogo.
  const tikeyPlatform = t => (window.__listing && window.__listing.platformOf(t) === 'Stubhub') ? 'stubhub' : 'viagogo';

  // Section key shared by tickets and Tikey sales: "Longside Lower Central 004" → "4",
  // "101 (1. POSCHODÍ)" → "101", "Block 13.1" → "13.1", "Stání (vstup SEVER)" / "Floor" → "floor".
  function secKey(s) {
    const str = norm(s);
    if (/\b(floor|stani|stehplatz|stehplatze|innenraum|plocha|parter|standing|pitch|golden circle)\b/.test(str)) return 'floor';
    const b = str.match(/block\s+([0-9]+(?:\.[0-9]+)?[a-z]?)/) || str.match(/\b([a-z]?\d+(?:\.\d+)?[a-z]?)\b/);
    return b ? b[1].replace(/^0+(?=\d)/, '') : '';
  }

  // Matched in Tikey every time (by name + date), cached per event for this app session.
  const found = new Map();
  async function findEvent(t, platform) {
    const ck = platform + '|' + norm(t.eventName) + '|' + String(t.eventDate || '').slice(0, 10);
    if (found.has(ck)) return found.get(ck);
    const lst = window.__listing;
    let best = null;
    for (const term of lst.searchTerms(t)) {
      const r = await inPanel(pageTikeySearch, { platform, term });
      if (!r || r.error) return { error: r && r.error === 'login' ? 'Přihlas se v panelu Tikey' : (r && r.error) || 'bez odpovědi' };
      for (const e of r.events || []) {
        const sc = lst.score(t, { name: e.name, date: String(e.date || '').slice(0, 10), venue: e.venue });
        if (!best || sc > best.score) best = { ...e, score: sc };
      }
      if (best && best.score >= 14) break;
    }
    // Only football moves for TV; a concert must be the same day (4. vs 5. 12.).
    const sameDay = best && String(best.date || '').slice(0, 10) === String(t.eventDate || '').slice(0, 10);
    const res = { best: best && best.score >= 12 && (sameDay || (lst.isFootball && lst.isFootball(t))) ? best : null };
    found.set(ck, res);
    return res;
  }

  // ---------- statistics -------------------------------------------------------------
  function stats(sales) {
    if (!sales.length) return null;
    const tickets = sales.reduce((s, x) => s + x.qty, 0);
    const sum = sales.reduce((s, x) => s + x.price * x.qty, 0);
    const prices = sales.map(x => x.price).sort((a, b) => a - b);
    const mid = Math.floor(prices.length / 2);
    const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
    const since = Date.now() - DAY;
    const day = sales.filter(x => Date.parse(x.at) >= since);
    const r2 = n => Math.round(n * 100) / 100;
    return { sales: sales.length, tickets, avg: r2(sum / tickets), median: r2(median), min: prices[0], max: prices[prices.length - 1],
      last24h: day.reduce((s, x) => s + x.qty, 0), lastAt: sales[0].at,
      recent: sales.slice(0, 5).map(x => ({ at: x.at, price: x.price, qty: x.qty, row: x.row })) };
  }

  // ---------- refresh one ticket -------------------------------------------------------
  const cache = new Map(); // `${platform}:${eventId}` -> { sales, at }
  async function eventSales(platform, eventId) {
    const k = platform + ':' + eventId;
    const c = cache.get(k);
    if (c && Date.now() - c.at < 10 * 60000) return c;
    const r = await inPanel(pageTikeySales, { platform, eventId });
    if (!r || r.error) throw new Error(r && r.error === 'login' ? 'Přihlas se v panelu Tikey' : (r && r.error) || 'bez odpovědi');
    const v = { sales: r.missing ? null : r.sales, at: Date.now() };
    cache.set(k, v);
    return v;
  }

  async function saveTikey(t, tikey) {
    const fresh = (state.db.tickets || []).find(x => x.id === t.id) || t;
    const next = { ...fresh, listing: { ...(fresh.listing || {}), tikey } };
    await window.api.upsertTicket(next);
    Object.assign(fresh, next);
  }

  async function refresh(t, opts = {}) {
    const platform = tikeyPlatform(t);
    const f = await findEvent(t, platform);
    if (f.error) throw new Error(f.error);
    const sales = f.best ? (await eventSales(platform, f.best.id)).sales : null;
    if (!sales) {
      await saveTikey(t, { platform, eventId: '', notFound: true, at: new Date().toISOString() });
      return null;
    }
    const eventId = f.best.id, eventName = f.best.name;
    const key = secKey(t.section);
    const tikey = { platform, eventId, eventName, eventDate: String(f.best.date || '').slice(0, 10),
      at: new Date().toISOString(), currency: 'EUR', event: stats(sales), section: key, sectionStats: key ? stats(sales.filter(x => secKey(x.section) === key)) : null };
    await saveTikey(t, tikey);
    return tikey;
  }

  // Every future ticket that is not sold yet.
  const targets = () => ((state.db && state.db.tickets) || []).filter(t => ['available', 'listed'].includes(st(t))
    && t.eventDate && Date.parse(String(t.eventDate).slice(0, 10)) >= Date.now() - DAY);

  let running = null;
  async function refreshAll(opts = {}) {
    if (running) return running;
    running = (async () => {
      // Premier League fixtures decide StubHub vs Viagogo — load them first.
      if (window.__listing && window.__listing.loadPL) await window.__listing.loadPL();
      const list = targets().filter(t => opts.force || !(t.listing && t.listing.tikey && Date.now() - Date.parse(t.listing.tikey.at) < STALE_MS));
      let ok = 0, missing = 0;
      const errors = [];
      for (const t of list) {
        try { (await refresh(t)) ? ok++ : missing++; }
        catch (e) {
          if (/Přihlas se/.test(e.message)) { if (!opts.quiet) toast('Tikey: ' + e.message, 'error', 6000); break; }
          errors.push(`${t.eventName}: ${e.message}`);
        }
      }
      if (errors.length) console.warn('[tikey]', errors);
      if (typeof refreshDb === 'function') await refreshDb();
      if (typeof window.renderListingPage === 'function' && state.currentView === 'listing') window.renderListingPage();
      if (!opts.quiet) toast(`Tikey: reálné prodeje načtené u ${ok} vstupenek${missing ? `, ${missing} akcí v Tikey nenalezeno` : ''}`, 'success', 6000);
      return { ok, missing, errors };
    })().finally(() => { running = null; });
    return running;
  }

  // ---------- rendering helpers (used by listing.js and the inventory table) -----------
  const money = n => typeof formatMoney === 'function' ? formatMoney(n, 'EUR') : Math.round(n) + ' €';
  const ago = iso => {
    const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
    return h < 1 ? 'před chvílí' : h < 48 ? `před ${h} h` : `před ${Math.round(h / 24)} d`;
  };
  // The price to show: own section if it has sales, else the whole event.
  function best(t) {
    const k = t.listing && t.listing.tikey;
    if (!k || !k.event) return null;
    const s = k.sectionStats;
    return s ? { ...s, scope: 'sekce ' + k.section } : { ...k.event, scope: 'celá akce' };
  }
  function tooltip(t) {
    const k = t.listing.tikey, b = best(t);
    const lines = [`Tikey · ${k.platform === 'stubhub' ? 'StubHub' : 'Viagogo'} · ${b.scope}`,
      `Prodáno ${b.tickets} ks (${b.sales}×), průměr ${money(b.avg)}, medián ${money(b.median)}, ${money(b.min)}–${money(b.max)}`,
      `Za 24 h: ${b.last24h} ks · poslední prodej ${ago(b.lastAt)}`];
    if (k.sectionStats) lines.push(`Celá akce: ${k.event.tickets} ks, průměr ${money(k.event.avg)}, 24 h ${k.event.last24h} ks`);
    if (b.recent && b.recent.length) lines.push('Poslední: ' + b.recent.map(x => `${money(x.price)}×${x.qty}`).join(', '));
    lines.push('Načteno ' + ago(k.at));
    return lines.join('\n');
  }
  // Inventory "Tržba" cell for an unsold ticket: expected price per ticket.
  function cellHtml(t) {
    const b = best(t);
    if (!b) return '';
    return `<div class="tk-est" title="${escapeHtml(tooltip(t))}"><span class="tk-est-val">≈ ${money(b.median)}</span><span class="tk-est-sub">/ks · ${escapeHtml(b.scope === 'celá akce' ? 'akce' : 'sekce')}</span></div>`;
  }
  // Inventory group row: expected revenue of the unsold rows that have Tikey data.
  function groupHtml(items) {
    const rows = items.filter(t => ['available', 'listed'].includes(st(t)) && best(t));
    if (!rows.length) return '';
    const qty = rows.reduce((s, t) => s + (Number(t.quantity) || 1), 0);
    const sum = rows.reduce((s, t) => s + best(t).median * (Number(t.quantity) || 1), 0);
    return `<div class="tk-est" title="Odhad podle skutečných prodejů (Tikey, medián za kus) — ${qty} neprodaných ks"><span class="tk-est-val">≈ ${money(sum)}</span><span class="tk-est-sub">odhad · ${qty} ks</span></div>`;
  }
  // Zalistování market column block.
  function listingHtml(t) {
    const k = t.listing && t.listing.tikey;
    if (!k) return `<div class="lst-sub tk-muted">Tikey: zatím nenačteno</div>`;
    if (k.notFound || !k.event) return `<div class="lst-sub tk-muted">Tikey: akce nenalezena</div>`;
    const b = best(t);
    return `<div class="tk-block" title="${escapeHtml(tooltip(t))}">
      <div class="lst-market-label">Prodává se (${escapeHtml(b.scope)})</div>
      <div class="lst-market-val">≈ ${money(b.median)}</div>
      <div class="lst-sub">${b.tickets} ks · ${money(b.min)}–${money(b.max)} · 24 h: ${b.last24h} ks</div>
    </div>`;
  }

  window.__tikey = { refresh, refreshAll, secKey, stats, best, cellHtml, groupHtml, listingHtml, tikeyPlatform, _page: { search: pageTikeySearch, sales: pageTikeySales } };
})();
