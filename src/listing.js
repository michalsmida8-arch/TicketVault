// "Zalistování" — prepared listings for unsold tickets (1.17).
// Rule: Premier League → StubHub via SalesPro, everything else → Viagogo via
// inv.viagogo. TicketVault finds the event on the marketplace, shows the market
// price, and pre-fills the listing form inside the embedded panel. The USER
// reviews and clicks Save/Uložit — this module never submits a listing.
// After the save, a hook inside the panel reports the new listing id back and the
// ticket becomes status=listed with externalIds.{stubhub,viagogo}ListingId.
// Also: a comparison of Viagogo's own event list with the inventory.
// Relies on app.js globals: state, $, switchView, ensureMarketplaceLoaded, toast,
// escapeHtml, formatMoney, refreshDb, openListModal; icons.js: icon, fmtDateCz.
(function () {
  const DAY = 86400000;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const PANEL = { Stubhub: 'salespro', Viagogo: 'invviagogo' };
  const PLATFORM_LABEL = { Stubhub: 'StubHub', Viagogo: 'Viagogo' };
  const SH_TYPES = [['EXT_MOBILE', 'Mobilní převod'], ['MOBILE', 'Mobilní'], ['PAPER', 'Poštou'], ['SEASON_CARD', 'Sezónní karta']];
  const VG_TYPES = [['TicketMasterMobile', 'Mobile Ticket Transfer'], ['ETicket', 'E-Tickets (PDF)'], ['ETicketUrl', 'Mobile Tickets (odkaz)']];
  const ui = { filter: 'all', search: {}, busy: {}, compare: null, wired: false };

  const isWeb = () => document.documentElement.classList.contains('web-mode');
  const st = t => String(t.status || 'available').trim().toLowerCase();
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const isoDay = d => d.toLocaleDateString('sv-SE');
  function dayOf(iso) { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function daysTo(iso) { const d = dayOf(iso); if (!d) return null; const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((d - t) / DAY); }
  const shift = (iso, n) => isoDay(new Date(dayOf(iso).getTime() + n * DAY));
  const usDate = iso => { const [y, m, d] = iso.split('-'); return `${m}/${d}/${y}`; };

  // ---------- which marketplace ----------------------------------------------------
  // Premier League = the ticket's event matches a PL fixture (both teams, ±1 day) or
  // the name says so. Fixtures come from the same backend feed as the PL page.
  const TEAM_ALIASES = { 'manchester united': ['man utd', 'man united', 'manchester united'], 'manchester city': ['man city', 'manchester city'],
    'wolverhampton wanderers': ['wolves', 'wolverhampton'], 'tottenham hotspur': ['tottenham', 'spurs'], 'brighton hove albion': ['brighton'],
    'west ham united': ['west ham'], 'aston villa': ['aston villa', 'villa'], 'crystal palace': ['crystal palace', 'palace'],
    'nottingham forest': ['nottingham forest', 'forest'], 'newcastle united': ['newcastle'], 'leeds united': ['leeds'], 'afc bournemouth': ['bournemouth'] };
  function teamKeys(team) {
    const n = norm(team).replace(/\b(fc|afc)\b/g, '').replace(/\s+/g, ' ').trim();
    for (const [k, v] of Object.entries(TEAM_ALIASES)) if (n === k || norm(k).includes(n) || n.includes(k)) return v;
    return [n.split(' ')[0]];
  }
  const hasTeam = (name, team) => teamKeys(team).some(k => (' ' + name + ' ').includes(' ' + k + ' '));
  let plLoading = null;
  function loadPL() {
    if (state.pl && state.pl.loaded) return Promise.resolve();
    if (!plLoading && window.api && window.api.fetchPLFixtures) {
      plLoading = window.api.fetchPLFixtures(false).then(d => {
        if (d && Array.isArray(d.fixtures)) {
          if (!state.pl) state.pl = { fixtures: [], teams: [], selectedTeams: [], round: '', search: '', loaded: false, loading: false, _wired: false };
          Object.assign(state.pl, { fixtures: d.fixtures, teams: d.teams || [], loaded: true });
        }
      }).catch(() => {});
    }
    return plLoading || Promise.resolve();
  }
  function plFixtureFor(t) {
    const fx = (state.pl && state.pl.fixtures) || [];
    const name = norm(t.eventName), d = dayOf(t.eventDate);
    return fx.find(f => {
      // A team pair meets at one ground once a season, so a few days' tolerance is
      // safe and survives TV re-scheduling (e.g. 17. 10. moved to 19. 10.).
      const fd = dayOf(String(f.date || f.start || '').slice(0, 10));
      if (d && fd && Math.abs(fd - d) > 5 * DAY) return false;
      return hasTeam(name, f.home) && hasTeam(name, f.away);
    }) || null;
  }
  function isPremierLeague(t) {
    if (/premier league/i.test((t.eventName || '') + ' ' + (t.notes || ''))) return true;
    return (t.category === 'football' || !t.category) && !!plFixtureFor(t);
  }
  const defaultPlatform = t => isPremierLeague(t) ? 'Stubhub' : 'Viagogo';
  // The rule decides unless the user picked a marketplace by hand for this ticket.
  const platformOf = t => (t.listing && t.listing.platformManual && t.listing.platform) || defaultPlatform(t);

  function candidates() {
    const all = (state.db && state.db.tickets) || [];
    return all.filter(t => st(t) === 'available' && (daysTo(t.eventDate) ?? 0) >= 0)
      .sort((a, b) => String(a.eventDate || '9').localeCompare(String(b.eventDate || '9')));
  }
  const waiting = () => ((state.db && state.db.tickets) || []).filter(t => st(t) === 'available' && t.listing && t.listing.status === 'prefilled');

  // ---------- talking to the embedded panels ---------------------------------------
  async function panel(name) {
    if (isWeb()) throw new Error('Zalistování funguje jen v desktopové aplikaci.');
    if (typeof ensureMarketplaceLoaded === 'function') ensureMarketplaceLoaded(name);
    const wv = document.getElementById('webview-' + name);
    if (!wv) throw new Error('Panel ' + name + ' nenalezen');
    for (let i = 0; i < 60; i++) {
      try { if (wv.getURL() && !wv.isLoading()) return wv; } catch (_) { /* not attached yet */ }
      await sleep(500);
    }
    throw new Error('Panel ' + name + ' se nenačetl');
  }
  async function inPanel(name, fn, arg) {
    const wv = await panel(name);
    return wv.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`, true);
  }

  // Page functions — serialized and run INSIDE the marketplace page. Keep them
  // self-contained (no closures over this module).
  async function pageStubhubSearch(q) {
    const tok = localStorage.token;
    if (!tok) return { error: 'login' };
    const url = '/api/poslite/search/suggestion?searchTerm=' + encodeURIComponent(q.term) + '&entityList=event&startDate=' + q.from + '&endDate=' + q.to + '&eventRows=10';
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401 || r.status === 403) return { error: 'login' };
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const j = await r.json();
    return { events: (j.events || []).map(e => ({ id: String(e.id), name: e.name, date: e.eventDateTime, venue: e.venue && e.venue.name,
      city: e.venue && e.venue.address && e.venue.address.locality, minPrice: e.minPrice && e.minPrice.price, minListPrice: e.minListPrice && e.minListPrice.price,
      currency: e.minPrice && e.minPrice.currencySymbol, total: e.totalListings, raw: e })) };
  }
  function pageViagogoSearch(q) {
    if (!window.$ || !window.VGPage) return { error: 'login' };
    return new Promise(res => {
      $.post('/Listings/EventSearch', { SearchPhrase: q.term, DateFrom: q.from, DateTo: q.to })
        .done(d => res({ events: ((d && d.Events) || []).map(e => ({ id: e.EventLink, name: e.EventName, date: e.EventDateVal, venue: e.VenueName, city: e.VenueCity })) }))
        .fail(x => res({ error: x.status === 401 || x.status === 302 ? 'login' : 'HTTP ' + x.status }));
    });
  }
  // Competitor listings for one Viagogo event (the "Market data" dialog of inv.viagogo).
  // The dialog HTML carries them as `var marketGridData = [...]`.
  async function pageViagogoMarket(q) {
    const r = await fetch('/Listings/MarketDataV3', { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
      body: 'eventId=' + encodeURIComponent(q.eventId) + '&latestServerStamp=0' });
    if (!r.ok) return { error: 'HTTP ' + r.status };
    const html = await r.text();
    const m = html.match(/var marketGridData = (\[[\s\S]*?\]);\s*\n/);
    if (!m) return { error: /login|sign in/i.test(html) ? 'login' : 'bez dat o trhu' };
    const rows = JSON.parse(m[1]).filter(x => !x.IsOwned && x.WebsitePriceVal > 0);
    return { listings: rows.map(x => ({ section: String(x.Section || ''), row: String(x.Row || ''), qty: x.Quantity, price: x.WebsitePriceVal, cls: x.TicketClass || '' })) };
  }

  function pageViagogoEvents() {
    if (!window.$ || !window.VGPage) return { error: 'login' };
    return new Promise(res => {
      $.post(VGPage.writeUrl('/Listings/GetListingEvents'), {})
        .done(d => res({ events: ((d && d.Events) || []).map(e => ({ id: e.EventId, link: e.EventLink, name: e.EventName, date: (e.EventDateTimeDisplay || ''),
          ms: Number(String(e.EventDateTime || '').replace(/\D/g, '')) || null, venue: e.VenueName, city: e.VenueCity,
          available: e.AvailableTickets, sold: e.TicketsSoldToDate, pending: e.SoldTicketsYetToBeFulfilled })) }))
        .fail(x => res({ error: 'HTTP ' + x.status }));
    });
  }

  // Opens SalesPro's "Přidat nabídku" form for one event and fills it through the
  // Vue components (same path the UI takes). Never calls save.
  async function pageStubhubPrefill(p) {
    // MessageChannel ticks are not throttled in a hidden/minimised window, timers are.
    const sleep = ms => new Promise(res => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => (Date.now() >= end ? res() : ch.port2.postMessage(0)); ch.port2.postMessage(0); });
    const tag = vm => vm.$options.name || vm.$options._componentTag;
    const anyVm = [...document.querySelectorAll('*')].find(e => e.__vue__ && e.__vue__.$bus);
    if (!anyVm) return { error: 'SalesPro není načtené (přihlas se v panelu)' };
    const bus = anyVm.__vue__.$bus;
    if (!window.__tvHooked) {
      window.__tvHooked = true;
      bus.$on('listingCreated', (op, flag, listingId) => { if (window.__tvPending) window.__tvSaved = Object.assign({}, window.__tvPending, { listingId: String(listingId || '') }); });
    }
    window.__tvPending = { ticketId: p.ticketId, eventId: p.event.id };
    if (!/#\/inventory/.test(location.hash)) { location.hash = '#/inventory'; await sleep(1500); }
    const openDlg = () => [...document.querySelectorAll('.dialog--active')].find(x => /Přidat nabídku/.test(x.innerText) && x.querySelector('input'));
    const old = openDlg();
    if (old) { const c = [...old.querySelectorAll('button')].find(b => /Zrušit/.test(b.innerText)); if (c) c.click(); await sleep(800); }
    // EditListingDialog (child of the Inventory page) owns the add flow: switchToAddMode
    // shows it, bulkEventsSelected with one event = "addListing" mode → listingCreated(id).
    let ed = null;
    for (let i = 0; i < 20 && !ed; i++) {
      const inv = [...document.querySelectorAll('*')].filter(e => e.__vue__).map(e => { let v = e.__vue__; while (v && tag(v) !== 'Inventory') v = v.$parent; return v; }).find(Boolean);
      ed = inv && inv.$children.find(c => tag(c) === 'EditListingDialog');
      if (!ed) await sleep(300);
    }
    if (!ed) return { error: 'V SalesPro otevři stránku Nabídky' };
    ed.switchToAddMode();
    await sleep(300);
    ed.bulkEventsSelected([p.event.raw]);
    // The form mounts in stages (listing object → sections over XHR → combos initialise),
    // so collect the components fresh, fill, then verify against ed.listing and repeat.
    const collect = () => {
      const dlg = openDlg(), vms = {};
      if (dlg) dlg.querySelectorAll('*').forEach(e => { let el = e; while (el && !el.__vue__) el = el.parentElement; let vm = el && el.__vue__; while (vm) { const t = tag(vm); if (t && !vms[t]) vms[t] = vm; vm = vm.$parent; } });
      return vms;
    };
    let vms = {};
    for (let i = 0; i < 60; i++) {
      await sleep(250);
      vms = collect();
      const sc = vms.SectionRowSeatCombo;
      if (sc && sc.sections && sc.sections.length && !sc.loadingSections && ed.listing && ed.listing.event && String(ed.listing.event.id) === String(p.event.id)) break;
    }
    if (!vms.SectionRowSeatCombo) return { error: 'Formulář SalesPro se neotevřel' };
    await sleep(600);
    const notes = [];
    const n = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const want = n(p.section), num = (want.match(/\d+[a-z]?/) || [])[0];
    const pickSection = sc => {
      const secs = sc.sections.filter(x => !x.isZone);
      let sec = secs.find(x => n(x.name) === want);
      if (!sec && num) { const hits = secs.filter(x => (n(x.name).match(/(\d+[a-z]?)$/) || [])[1] === num); if (hits.length === 1) sec = hits[0]; }
      return sec || null;
    };
    // Setting the same value twice does not fire Vue's watcher, so clear first.
    const put = async (vm, key, val) => { if (!vm) return; if (JSON.stringify(vm[key]) === JSON.stringify(val)) { vm[key] = null; await sleep(60); } vm[key] = val; await sleep(150); };
    let cur = p.currency, sec = null;
    for (let round = 0; round < 3; round++) {
      vms = collect();
      const sc = vms.SectionRowSeatCombo, L = ed.listing || {};
      sec = pickSection(sc);
      if (L.quantity !== p.quantity) await put(sc, 'quantity', p.quantity);
      if (sec && L.section !== sec.name) await put(sc, 'section', sec);
      if (p.row && String(L.row || '') !== String(p.row)) await put(sc, 'row', String(p.row));
      if (p.lowSeat && String(L.lowSeat || '') !== String(p.lowSeat)) await put(sc, 'lowSeat', String(p.lowSeat));
      if (p.ticketType && L.ticketType !== p.ticketType) await put(vms.FulfillmentCombo, 'ticketType', p.ticketType);
      const sell = vms['PriceCombo-Sell-Face'];
      cur = (sell && sell.sellPrice && sell.sellPrice.currencySymbol) || cur;
      if (p.price && (!L.sellPrice || Number(L.sellPrice.price) !== Number(p.price))) await put(sell, 'sellPrice', { price: Number(p.price), currencySymbol: cur });
      if (p.purchasePrice && (!p.purchaseCurrency || p.purchaseCurrency === cur) && (!L.purchasePrice || !L.purchasePrice.price)) {
        await put(vms['PriceCombo-Purchase-Payout'], 'purchasePrice', { price: Math.round(Number(p.purchasePrice) * 100) / 100, currencySymbol: cur });
      }
      await sleep(900);
      const M = ed.listing || {};
      const okAll = M.quantity === p.quantity && (!sec || M.section === sec.name) && (!p.row || String(M.row) === String(p.row)) &&
        (!p.ticketType || M.ticketType === p.ticketType) && (!p.price || (M.sellPrice && Number(M.sellPrice.price) === Number(p.price)));
      if (okAll) break;
    }
    if (!sec && p.section) notes.push('sekci „' + p.section + '“ vyber ručně');
    const L = ed.listing || {};
    if (L.quantity !== p.quantity) notes.push('zkontroluj počet');
    return { ok: true, notes, section: L.section, payout: L.payoutPrice && L.payoutPrice.price, currency: cur };
  }

  // Opens inv.viagogo's New Listing modal at the chosen ticket type and fills it.
  // Never clicks Save; a wrapper around VGPage.post reports the id once the user saves.
  async function pageViagogoPrefill(p) {
    const sleep = ms => new Promise(res => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => (Date.now() >= end ? res() : ch.port2.postMessage(0)); ch.port2.postMessage(0); });
    if (!window.$ || !window.VGPage || !$.modal) return { error: 'inv.viagogo není načtené (přihlas se v panelu)' };
    if (!window.__tvHooked) {
      window.__tvHooked = true;
      const orig = VGPage.post;
      VGPage.post = function (url, data, cb, type) {
        if (/savelisting$/i.test(String(url)) && typeof cb === 'function') {
          const wrapped = function (B) {
            try {
              if (B && B.Success && !B.RequiresConfirmation && window.__tvPending) {
                const u = B.Updates && B.Updates.ListingUpdates && B.Updates.ListingUpdates[0];
                window.__tvSaved = Object.assign({}, window.__tvPending, { listingId: String((u && u.Id) || '') });
              }
            } catch (_) { /* never break the page */ }
            return cb.apply(this, arguments);
          };
          return orig.call(this, url, data, wrapped, type);
        }
        return orig.apply(this, arguments);
      };
    }
    window.__tvPending = { ticketId: p.ticketId, eventId: p.event.id };
    // inv.viagogo keeps earlier modal contents in the DOM (hidden, same element ids), so
    // drop old listing forms first or the fill below could land in a stale hidden copy.
    try { $.modal.hide(); } catch (_) {}
    document.querySelectorAll('.js-modal-size').forEach(m => { if (m.querySelector('#Listing_WebsitePrice') || /session has expired/i.test(m.innerText)) m.remove(); });
    await sleep(300);
    $.modal.post('/Listings/NewListing', { eventlink: p.event.id, ticketType: p.ticketType || 'TicketMasterMobile', pcid: '' });
    let price = null;
    for (let i = 0; i < 60; i++) {
      price = [...document.querySelectorAll('#Listing_WebsitePrice')].find(e => e.offsetParent);
      if (price) break;
      if ([...document.querySelectorAll('.js-modal-size')].some(m => m.offsetParent && /session has expired|sign in again/i.test(m.innerText))) {
        return { error: 'inv.viagogo chce znovu přihlásit — přihlas se v panelu inv.viagogo a zkus to znovu' };
      }
      await sleep(250);
    }
    if (!price) return { error: 'Formulář Viagogo se neotevřel (zkus znovu, případně obnov panel inv.viagogo)' };
    await sleep(400);
    const notes = [];
    const set = (sel, v) => { if (v !== undefined && v !== null && v !== '') $(sel).val(String(v)).trigger('input').trigger('change').trigger('keyup'); };
    set('#Listing_AvailableTickets', p.quantity);
    set('#Listing_SplitType', p.quantity > 1 ? 'AvoidOne' : 'Any');
    const secSel = document.getElementById('Listing.Section');
    if (p.section && secSel) {
      const n = v => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
      const opts = [...secSel.options].map(o => o.value).filter(v => v && !/choose/i.test(v));
      const want = n(p.section), num = (want.match(/\d+[a-z]?/) || [])[0];
      let hit = opts.find(v => n(v) === want);
      if (!hit && num) { const h = opts.filter(v => n(v) === num || (n(v).match(/(\d+[a-z]?)$/) || [])[1] === num); if (h.length === 1) hit = h[0]; }
      if (hit) { $(secSel).val(hit).trigger('change'); await sleep(300); } else notes.push('sekci „' + p.section + '“ vyber ručně');
    } else if (p.section) {
      set('#Listing_Section', p.section);
    }
    if (p.row) {
      const rowSel = document.getElementById('Listing.Row');
      if (rowSel && rowSel.offsetParent && [...rowSel.options].some(o => o.value === String(p.row))) $(rowSel).val(String(p.row)).trigger('change');
      else set('#Listing_Row', p.row);
    }
    set('#Listing_SeatFrom', p.seatFrom); set('#Listing_SeatTo', p.seatTo);
    if (p.currency) set('#Listing_CurrencyCode', p.currency);
    if (p.price) { set('#Listing_WebsitePrice', Number(p.price).toFixed(2)); $('#Listing_WebsitePrice').trigger('blur'); }
    await sleep(1500);
    return { ok: true, notes, proceeds: $('#Listing_Proceeds').val(), currency: $('#Listing_CurrencyCode').val() };
  }

  // ---- save as INACTIVE (only on Michal's explicit "zalistuj za doporučenou cenu") ----
  // Both functions refuse to save unless the form verifiably says "not published".
  async function pageViagogoSaveInactive() {
    const sleep = ms => new Promise(res => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => (Date.now() >= end ? res() : ch.port2.postMessage(0)); ch.port2.postMessage(0); });
    const vis = e => !!(e && e.offsetParent);
    const price = [...document.querySelectorAll('#Listing_WebsitePrice')].find(vis);
    if (!price) return { error: 'Formulář Viagogo nenalezen' };
    const form = $(price).closest('form');
    const cb = form.find('#IsPublishToViagogo')[0];
    if (cb && cb.checked) { cb.click(); await sleep(200); }
    if (cb && cb.checked) { cb.checked = false; $(cb).trigger('change'); await sleep(200); }
    if (form.serializeArray().some(x => x.name === 'Listing.IsPublishToViagogo' && x.value === 'true')) return { error: 'Nepodařilo se vypnout Publish — neukládám' };
    window.__tvSaved = null;
    const btn = form.find('#btnSaveDetails').filter(':visible')[0] || [...document.querySelectorAll('#btnSaveDetails')].find(vis);
    if (!btn) return { error: 'Tlačítko Save nenalezeno' };
    btn.click();
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (window.__tvSaved) { const s = window.__tvSaved; window.__tvSaved = null; window.__tvPending = null; return { ok: true, listingId: s.listingId }; }
      const errs = form.find('.field-validation-error:visible, .input-validation-error:visible').map((_, e) => (e.innerText || e.name || '').trim()).get().filter(Boolean);
      if (errs.length && i > 2) return { error: 'Viagogo nepřijal formulář: ' + errs.slice(0, 3).join('; ') };
      const other = [...document.querySelectorAll('.js-modal-size')].find(m => vis(m) && !m.querySelector('#Listing_WebsitePrice'));
      if (other && i > 1) return { error: 'Viagogo chce potvrzení: ' + other.innerText.replace(/\s+/g, ' ').slice(0, 160) };
    }
    return { error: 'Uložení na Viagogu se nepotvrdilo' };
  }
  async function pageStubhubSaveInactive() {
    const sleep = ms => new Promise(res => { const end = Date.now() + ms, ch = new MessageChannel(); ch.port1.onmessage = () => (Date.now() >= end ? res() : ch.port2.postMessage(0)); ch.port2.postMessage(0); });
    const tag = vm => vm.$options.name || vm.$options._componentTag;
    const dlg = [...document.querySelectorAll('.dialog--active')].find(x => /Přidat nabídku/.test(x.innerText) && x.querySelector('input'));
    if (!dlg) return { error: 'Formulář SalesPro nenalezen' };
    const vms = {};
    dlg.querySelectorAll('*').forEach(e => { let el = e; while (el && !el.__vue__) el = el.parentElement; let vm = el && el.__vue__; while (vm) { const t = tag(vm); if (t && !vms[t]) vms[t] = vm; vm = vm.$parent; } });
    const form = vms.ListingDetailForm, ed = vms.EditListingDialog;
    if (!form || !ed || !ed.listing) return { error: 'Formulář SalesPro nenalezen' };
    ed.listing.publish = false;
    await sleep(400);
    // The "Publikovat" checkbox must show unticked before anything is saved.
    const label = [...dlg.querySelectorAll('*')].find(e => e.children.length === 0 && /^\s*Publikovat\s*$/.test(e.textContent || ''));
    const box = label && label.closest('.input-group, .checkbox, label, div');
    const boxText = box ? (box.closest('.input-group') || box).innerText : '';
    if (ed.listing.publish !== false || /\bcheck_box\b(?!_outline)/.test(boxText)) return { error: 'Nepodařilo se vypnout „Publikovat“ — neukládám' };
    window.__tvSaved = null; window.__tvSaveError = null;
    form.$bus.$once('listingDetailOperationFailed', code => { window.__tvSaveError = String(code || 'chyba'); });
    form.submitForm();
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (window.__tvSaved) { const s = window.__tvSaved; window.__tvSaved = null; window.__tvPending = null; return { ok: true, listingId: s.listingId }; }
      if (window.__tvSaveError) return { error: 'SalesPro odmítl uložení (' + window.__tvSaveError + ')' };
      const bad = [...dlg.querySelectorAll('.input-group--error')].map(e => e.innerText.split('\n')[0].trim()).filter(Boolean);
      if (bad.length && i > 2) return { error: 'SalesPro: vyplň ' + bad.slice(0, 3).join(', ') };
    }
    return { error: 'Uložení v SalesPro se nepotvrdilo' };
  }

  function pageTakeSaved() { const s = window.__tvSaved || null; if (s) { window.__tvSaved = null; window.__tvPending = null; } return s; }

  // ---------- event matching ---------------------------------------------------------
  // Search phrases from most to least specific. "England Croatia" finds the match
  // where "England" alone drowns in every event held in England.
  function searchTerms(t) {
    const name = String(t.eventName || '').replace(/\s+[-–|(].*$/, '').trim();
    const parts = name.split(/\s+(?:vs\.?|v|x|-)\s+/i).map(s => s.trim()).filter(Boolean);
    const out = [];
    if (parts.length > 1) {
      const strip = s => s.replace(/\b(FC|AFC|CF)\b/g, '').replace(/\s+/g, ' ').trim();
      out.push(strip(parts[0]) + ' ' + strip(parts[1]), strip(parts[0]));
    }
    // Concerts: the act before the tour name ("Backstreet Boys: Into The Millennium"),
    // then each act of a double bill ("Calin & Viktor Sheen").
    const act = name.split(/\s*[:–|,]\s*/)[0].replace(/\s+(?:world\s+)?tour\b.*$/i, '').trim();
    if (act) out.push(act, ...act.split(/\s+(?:&|x|feat\.?|ft\.?|and)\s+/i).map(s => s.trim()));
    out.push(name.split(/\s+/).slice(0, 3).join(' '));
    return [...new Set(out.filter(Boolean))];
  }
  const nameWords = t => [...new Set(norm(t.eventName).split(' ').filter(w => w.length > 2 && !['the', 'and', 'vs', 'fc'].includes(w)))];
  function nameHits(t, ev) { const b = norm(ev.name); return nameWords(t).filter(w => b.includes(w)).length; }
  function score(t, ev) {
    let sc = 0;
    const d = dayOf(t.eventDate), ed = dayOf(String(ev.date || '').slice(0, 10));
    // Football gets moved for TV a few days either way, so near dates still count.
    if (d && ed) { const diff = Math.abs(ed - d) / DAY; sc += diff === 0 ? 10 : diff <= 1 ? 6 : diff <= 4 ? 2 : -10; }
    sc += 2 * nameHits(t, ev);
    if (t.venue && ev.venue && norm(ev.venue).includes(norm(t.venue).split(' ')[0])) sc += 2;
    return sc;
  }
  async function findEvent(t, platform) {
    const date = String(t.eventDate || '').slice(0, 10);
    const today = isoDay(new Date());
    const from = date ? shift(date, -4) : today, to = date ? shift(date, 5) : shift(today, 365);
    const seen = new Map();
    let term = '';
    for (term of searchTerms(t)) {
      const res = platform === 'Stubhub'
        ? await inPanel('salespro', pageStubhubSearch, { term, from, to })
        : await inPanel('invviagogo', pageViagogoSearch, { term, from: usDate(from), to: usDate(to) });
      if (!res || res.error) return { error: res && res.error === 'login' ? `Přihlas se v panelu ${PLATFORM_LABEL[platform]}` : (res && res.error) || 'bez odpovědi', term };
      (res.events || []).forEach(e => { if (!seen.has(e.id)) seen.set(e.id, { ...e, score: score(t, e) }); });
      const top = [...seen.values()].sort((x, y) => y.score - x.score)[0];
      if (top && top.score >= 14) break;
    }
    const events = [...seen.values()].sort((x, y) => y.score - x.score);
    // A same-day event sharing one word ("Made in England") is not a match: ask for
    // two name words unless the ticket's name only has one.
    const top = events[0];
    // Same day + one shared word is enough when nothing else that day shares a word
    // (team names in another language: "Schachtar Donezk" vs "Shakhtar Donetsk").
    const sameDay = e => dayOf(t.eventDate) && dayOf(String(e.date || '').slice(0, 10)) && +dayOf(t.eventDate) === +dayOf(String(e.date).slice(0, 10));
    const soleSameDay = top && sameDay(top) && nameHits(t, top) >= 1 && events.filter(e => sameDay(e) && nameHits(t, e) >= 1).length === 1;
    const best = top && top.score >= 10 && (nameHits(t, top) >= Math.min(2, nameWords(t).length) || soleSameDay) ? top : null;
    return { events, best, term };
  }

  // ---------- persistence ---------------------------------------------------------------
  async function patchTicket(t, patch) {
    const fresh = (state.db.tickets || []).find(x => x.id === t.id) || t;
    const next = { ...fresh, ...patch };
    if (patch.listing) next.listing = { ...(fresh.listing || {}), ...patch.listing, updatedAt: new Date().toISOString() };
    await window.api.upsertTicket(next);
    Object.assign(fresh, next);
    return next;
  }

  // Section as Viagogo writes it: "Sektor D – Block 13.1 Home-Area" -> "13.1", "Unterrang MERKUR 9" -> "9".
  function sectionKey(s) {
    const str = String(s || '');
    const b = str.match(/block\s+([0-9]+(?:\.[0-9]+)?[a-z]?)/i);
    if (b) return b[1].toLowerCase();
    const n = str.match(/\b([a-z]?\d+(?:\.\d+)?[a-z]?)\b/i);
    return n ? n[1].toLowerCase() : '';
  }
  // Cheapest competitor listing on Viagogo, overall and in the ticket's own section.
  async function viagogoMarket(t, eventLink) {
    const id = String(eventLink || '').match(/(\d+)\s*$/);
    if (!id) return null;
    const r = await inPanel('invviagogo', pageViagogoMarket, { eventId: id[1] });
    if (!r || r.error) return null;
    const all = r.listings || [];
    const min = arr => arr.length ? Math.min(...arr.map(x => x.price)) : null;
    const key = sectionKey(t.section);
    const inSec = key ? all.filter(x => x.section.toLowerCase() === key) : [];
    return { price: min(all), total: all.length, tickets: all.reduce((s, x) => s + (Number(x.qty) || 0), 0),
      section: key, sectionPrice: min(inSec), sectionCount: inSec.length, currency: 'EUR', at: new Date().toISOString() };
  }

  async function lookup(t, platform, quiet) {
    ui.busy[t.id] = 'search'; render();
    try {
      // Market price always comes from StubHub (SalesPro search returns min prices);
      // for Viagogo listings we also need the Viagogo event link.
      const sh = await findEvent(t, 'Stubhub').catch(e => ({ error: e.message }));
      const vg = platform === 'Viagogo' ? await findEvent(t, 'Viagogo').catch(e => ({ error: e.message })) : null;
      ui.search[t.id] = { sh, vg };
      const target = platform === 'Stubhub' ? sh : vg;
      const listing = { platform };
      if (sh && sh.best) listing.market = { price: sh.best.minPrice, listPrice: sh.best.minListPrice, currency: sh.best.currency, total: sh.best.total, at: new Date().toISOString(), eventName: sh.best.name };
      if (target && target.best) { listing.eventId = target.best.id; listing.eventName = target.best.name; listing.eventDate = target.best.date; }
      if (platform === 'Viagogo' && listing.eventId) listing.vgMarket = await viagogoMarket(t, listing.eventId).catch(() => null);
      await patchTicket(t, { listing });
      if (!quiet && target && target.error) toast(target.error, 'error', 5000);
      else if (!quiet && target && !target.best) toast(`Akci na ${PLATFORM_LABEL[platform]} jsem jednoznačně nenašel — vyber ji ze seznamu`, 'info', 5000);
    } catch (e) {
      if (!quiet) toast('Hledání selhalo: ' + e.message, 'error', 5000);
    } finally {
      delete ui.busy[t.id]; render();
    }
  }

  // Home team as fans say it: "Tottenham Hotspur v Coventry City" -> "Tottenham",
  // but "Manchester United", "West Ham", "Crystal Palace" keep both words.
  function homeTeamShort(t) {
    const parts = String(t.eventName || '').split(/\s+(?:vs\.?|v\.?|x|–|-)\s+/i);
    if (parts.length < 2) return '';
    const words = parts[0].replace(/\b(FC|AFC|CF|SC)\b\.?/gi, ' ').replace(/\s+/g, ' ').trim().split(' ');
    const twoWord = /^(manchester|west|aston|crystal|nottingham|sheffield|queens|wolverhampton|leicester|newcastle|leeds|norwich|stoke|swansea|cardiff|hull|real|atletico|inter|ac|as|bayer|borussia|eintracht|rb|vfb|fc|paris|sporting|red)$/i;
    return (twoWord.test(words[0]) && words[1] ? words.slice(0, 2) : words.slice(0, 1)).join(' ');
  }

  function seatRange(seat) {
    const nums = String(seat || '').match(/\d+/g);
    if (!nums) return {};
    const v = nums.map(Number);
    return { lowSeat: Math.min(...v), seatFrom: Math.min(...v), seatTo: Math.max(...v) };
  }

  // opts.price: use this price instead of the row's input; opts.auto: called from
  // autoList — no success toast, no save watcher, returns { ok } / { error }.
  async function prefill(t, opts = {}) {
    const L = t.listing || {};
    const platform = platformOf(t);
    const row = document.querySelector(`.lst-row[data-id="${t.id}"]`);
    const price = opts.price || parseFloat(row && row.querySelector('.lst-price') ? row.querySelector('.lst-price').value : L.price);
    const ticketType = (row && row.querySelector('.lst-type') && row.querySelector('.lst-type').value) || L.ticketType;
    if (!price || price <= 0) { if (opts.auto) return { error: 'bez ceny' }; toast('Zadej cenu za kus', 'error'); row && row.querySelector('.lst-price') && row.querySelector('.lst-price').focus(); return; }
    let ev = null;
    const found = ui.search[t.id] && (platform === 'Stubhub' ? ui.search[t.id].sh : ui.search[t.id].vg);
    if (found && found.events) ev = found.events.find(e => e.id === L.eventId) || null;
    if (!ev) {
      ui.busy[t.id] = 'search'; render();
      const r = await findEvent(t, platform).catch(e => ({ error: e.message }));
      delete ui.busy[t.id];
      ui.search[t.id] = { ...(ui.search[t.id] || {}), [platform === 'Stubhub' ? 'sh' : 'vg']: r };
      if (r.error) { render(); if (opts.auto) return { error: r.error }; toast(r.error, 'error', 5000); return; }
      ev = (r.events || []).find(e => e.id === L.eventId) || r.best;
      if (!ev) { render(); if (opts.auto) return { error: 'akce nenalezena jednoznačně' }; toast('Vyber akci ze seznamu (nenašel jsem jednoznačnou shodu)', 'info', 5000); return; }
    }
    ui.busy[t.id] = 'prefill'; render();
    // StubHub convention (Michal): Row = home team's name, seat numbers stay empty,
    // only the section is real.
    // Viagogo: section only, row and seats stay empty (Michal, 5. 10. 2026).
    const seats = {};
    const rowText = platform === 'Stubhub' ? (homeTeamShort(t) || t.row || '') : '';
    const currency = (L.market && L.market.currency) || L.currency || t.currency || 'EUR';
    const payload = { ticketId: t.id, event: ev, quantity: Number(t.quantity) || 1, section: t.section || '', row: rowText, ...seats,
      price, currency: platform === 'Viagogo' ? (L.currency || 'EUR') : currency, ticketType,
      purchasePrice: t.purchasePrice, purchaseCurrency: t.currency };
    try {
      // One form per panel: an older pre-fill on the same marketplace is now abandoned.
      for (const o of waiting()) if (o.id !== t.id && platformOf(o) === platform) await patchTicket(o, { listing: { status: 'draft' } });
      await patchTicket(t, { listing: { platform, price, ticketType, eventId: ev.id, eventName: ev.name, currency: payload.currency, status: 'prefilling' } });
      // Show the panel FIRST: Chromium throttles timers in hidden webviews to about
      // one per minute, which would stall the step-by-step filling.
      switchView(PANEL[platform]);
      await sleep(400);
      // The New Listing modal lives on inv.viagogo's Listings page; after an app restart
      // the panel sits on the Dashboard, so open Listings first.
      if (platform === 'Viagogo') {
        const wv = await panel('invviagogo');
        if (!/inv\.viagogo\.com\/Listings/i.test(wv.getURL())) {
          wv.loadURL('https://inv.viagogo.com/Listings');
          await sleep(800);
          await panel('invviagogo');
          for (let i = 0; i < 20; i++) {
            if (await wv.executeJavaScript('!!(window.$ && $.modal && window.VGPage)').catch(() => false)) break;
            await sleep(500);
          }
        }
      }
      const res = await inPanel(PANEL[platform], platform === 'Stubhub' ? pageStubhubPrefill : pageViagogoPrefill, payload);
      if (!res || res.error) { await patchTicket(t, { listing: { status: 'draft' } }); if (opts.auto) return { error: (res && res.error) || 'předvyplnění selhalo' }; switchView('listing'); toast((res && res.error) || 'Předvyplnění selhalo', 'error', 6000); return; }
      await patchTicket(t, { listing: { status: 'prefilled', prefilledAt: new Date().toISOString() } });
      if (opts.auto) return { ok: true, res };
      const extra = res.notes && res.notes.length ? ' Pozor: ' + res.notes.join(', ') + '.' : '';
      const net = res.payout || res.proceeds;
      toast(`Formulář ${PLATFORM_LABEL[platform]} je předvyplněný${net ? ` (výplata ${net} ${res.currency || ''})` : ''}. Zkontroluj ho a ulož sám.${extra}`, 'success', 9000);
      startWatch();
    } catch (e) {
      if (opts.auto) return { error: e.message };
      switchView('listing');
      toast('Předvyplnění selhalo: ' + e.message, 'error', 6000);
    } finally {
      delete ui.busy[t.id]; render();
    }
  }

  // Recommended price: Viagogo = cheapest competitor in the ticket's own section, else
  // cheapest on the event; StubHub = cheapest list price on SalesPro.
  function recommendedPrice(t) {
    const L = t.listing || {};
    if (platformOf(t) === 'Viagogo') { const v = L.vgMarket; return v ? (v.sectionPrice || v.price || null) : null; }
    const m = L.market; return m ? (m.listPrice || m.price || null) : null;
  }

  // "Zalistuj za doporučenou cenu" (Michal's standing agreement): save each listing
  // UNPUBLISHED at 2× the recommended price; he reviews prices and publishes himself.
  async function autoList(list) {
    const done = [], failed = [];
    for (const t of list) {
      const rec = recommendedPrice(t);
      if (!rec) { failed.push(`${t.eventName}: chybí doporučená cena (dej Najít)`); continue; }
      const price = Math.round(rec * 2);
      const pre = await prefill(t, { price, auto: true });
      if (!pre || pre.error) { failed.push(`${t.eventName}: ${(pre && pre.error) || 'předvyplnění selhalo'}`); continue; }
      const platform = platformOf(t);
      const r = await inPanel(PANEL[platform], platform === 'Stubhub' ? pageStubhubSaveInactive : pageViagogoSaveInactive).catch(e => ({ error: e.message }));
      if (!r || r.error) { failed.push(`${t.eventName}: ${(r && r.error) || 'uložení selhalo'}`); await patchTicket(t, { listing: { status: 'draft' } }); continue; }
      await markListed(t, r.listingId, true, { inactive: true, price });
      done.push(`${t.eventName} · ${Number(t.quantity) || 1} ks · ${price} €/ks (${PLATFORM_LABEL[platform]})`);
      await sleep(800);
    }
    ui.autoResult = { done, failed, at: new Date() };
    switchView('listing');
    render();
    toast(`Neaktivně zalistováno: ${done.length}${failed.length ? `, nepovedlo se: ${failed.length}` : ''}. Ceny jsou 2× doporučené — zkontroluj je a zveřejni.`, failed.length ? 'info' : 'success', 12000);
  }

  // ---------- after the user saves: pick up the listing id ---------------------------
  let watchTimer = null;
  function startWatch() {
    if (watchTimer) return;
    watchTimer = setInterval(checkSaved, 3000);
  }
  async function checkSaved() {
    const pend = waiting();
    if (!pend.length) { clearInterval(watchTimer); watchTimer = null; return; }
    for (const name of new Set(pend.map(t => PANEL[platformOf(t)]))) {
      let saved = null;
      try { saved = await inPanel(name, pageTakeSaved); } catch (_) { continue; }
      if (!saved || !saved.ticketId) continue;
      const t = (state.db.tickets || []).find(x => x.id === saved.ticketId);
      if (t) await markListed(t, saved.listingId, true);
    }
  }
  async function markListed(t, listingId, auto, extra = {}) {
    const platform = platformOf(t);
    const key = platform === 'Stubhub' ? 'stubhubListingId' : 'viagogoListingId';
    const externalIds = { ...(t.externalIds || {}) };
    if (listingId) externalIds[key] = String(listingId);
    await patchTicket(t, { status: 'listed', platform, externalIds, listing: { status: 'listed', listingId: listingId || '', listedAt: new Date().toISOString(),
      ...(extra.inactive ? { inactive: true, price: extra.price } : {}) } });
    await refreshDb();
    if (extra.inactive) return;
    toast(`${t.eventName}: zalistováno na ${PLATFORM_LABEL[platform]}${listingId ? ' (ID ' + listingId + ')' : ''}`, 'success', 6000);
    if (auto && state.currentView !== 'listing') return;
    render();
  }

  // ---------- comparison with Viagogo ----------------------------------------------
  async function compareViagogo() {
    ui.compare = { loading: true }; render();
    try {
      const res = await inPanel('invviagogo', pageViagogoEvents);
      if (!res || res.error) throw new Error(res && res.error === 'login' ? 'Přihlas se v panelu inv.viagogo' : (res && res.error) || 'bez odpovědi');
      const tickets = state.db.tickets || [];
      const onVg = t => /viagogo/i.test(t.platform || '');
      const rows = [];
      for (const e of res.events) {
        const day = e.ms ? isoDay(new Date(e.ms)) : '';
        if (day && daysTo(day) < 0) continue;
        const mine = tickets.filter(t => String(t.eventDate || '').slice(0, 10) === day && score(t, { name: e.name, date: day, venue: e.venue }) >= 12);
        const qty = arr => arr.reduce((s, t) => s + (Number(t.quantity) || 1), 0);
        const listed = qty(mine.filter(t => st(t) === 'listed' && onVg(t)));
        const toDeliver = qty(mine.filter(t => st(t) === 'sold' && onVg(t)));
        const issues = [];
        if (!mine.length) {
          const near = day && tickets.find(t => nameHits(t, e) >= Math.min(2, nameWords(t).length) && dayOf(t.eventDate) && Math.abs(dayOf(t.eventDate) - dayOf(day)) <= 7 * DAY);
          issues.push(near ? `v inventáři je s datem ${fmtDateCz(near.eventDate)} — oprav termín` : 'akce v inventáři chybí');
        }
        else if (!mine.some(onVg)) issues.push('v inventáři je akce bez platformy Viagogo');
        if (e.available !== listed) issues.push(`nabízeno ${e.available}, v inventáři zalistováno ${listed}`);
        if (e.pending !== toDeliver) issues.push(`k doručení ${e.pending}, v inventáři prodáno nedoručeno ${toDeliver}`);
        rows.push({ e, day, issues });
      }
      ui.compare = { rows, at: new Date() };
    } catch (e) {
      ui.compare = { error: e.message };
    }
    render();
  }

  // ---------- rendering ---------------------------------------------------------------
  const money = (n, c) => (n || n === 0) && typeof formatMoney === 'function' ? formatMoney(n, c || 'EUR') : (n ? n + ' ' + (c || '') : '—');
  function typeOptions(platform, cur) {
    const list = platform === 'Stubhub' ? SH_TYPES : VG_TYPES;
    return list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');
  }
  function eventPicker(t, platform) {
    const s = ui.search[t.id];
    const r = s && (platform === 'Stubhub' ? s.sh : s.vg);
    const L = t.listing || {};
    if (r && r.error) return `<div class="lst-ev lst-warn">${icon('alert', 13)} ${escapeHtml(r.error)}</div>`;
    if (r && r.events && r.events.length) {
      const opts = r.events.slice(0, 8).map(e => `<option value="${escapeHtml(e.id)}"${e.id === L.eventId ? ' selected' : ''}>${escapeHtml(e.name)} · ${escapeHtml(String(e.date || '').slice(0, 10))}${e.city ? ' · ' + escapeHtml(e.city) : ''}</option>`).join('');
      return `<select class="lst-ev-select" data-id="${t.id}">${L.eventId ? '' : '<option value="">— vyber akci —</option>'}${opts}</select>`;
    }
    if (r && r.events) return `<div class="lst-ev lst-warn">${icon('alert', 13)} Nenalezeno („${escapeHtml(r.term || '')}“)</div>`;
    if (L.eventName && L.platform === platform) return `<div class="lst-ev">${icon('check', 13)} ${escapeHtml(L.eventName)}</div>`;
    return `<div class="lst-ev lst-muted">akce zatím nehledána</div>`;
  }
  function rowHtml(t) {
    const platform = platformOf(t), L = t.listing || {}, busy = ui.busy[t.id];
    const auto = !(t.listing && t.listing.platformManual) ?' <span class="lst-auto" title="Podle pravidla: Premier League → StubHub, ostatní → Viagogo">auto</span>' : '';
    const d = daysTo(t.eventDate);
    const m = L.market;
    const vg = platform === 'Viagogo' && L.vgMarket ? L.vgMarket : null;
    const hint = vg ? (vg.sectionPrice || vg.price) : (m && m.price);
    const cur = platform === 'Viagogo' ? (L.currency || 'EUR') : ((m && m.currency) || L.currency || t.currency || 'EUR');
    const status = L.status === 'prefilled' ? '<span class="lst-pill wait">čeká na uložení</span>' : '';
    return `<div class="lst-row" data-id="${t.id}">
      <div class="lst-main">
        <div class="lst-name">${escapeHtml(t.eventName || '—')} ${status}</div>
        <div class="lst-sub">${t.eventDate ? fmtDateCz(t.eventDate) : 'bez data'}${d != null ? ` · za ${d} d` : ''}${t.venue ? ' · ' + escapeHtml(t.venue) : ''}</div>
        <div class="lst-sub">${[t.section && 'Sekce ' + escapeHtml(t.section), t.row && 'řada ' + escapeHtml(t.row), t.seat && 'místa ' + escapeHtml(t.seat)].filter(Boolean).join(', ') || 'bez sekce'} · <strong>${Number(t.quantity) || 1} ks</strong> · nákup ${money(t.purchasePrice, t.currency)}/ks</div>
      </div>
      <div class="lst-target">
        <select class="lst-platform" data-id="${t.id}">
          <option value="Stubhub"${platform === 'Stubhub' ? ' selected' : ''}>StubHub (SalesPro)</option>
          <option value="Viagogo"${platform === 'Viagogo' ? ' selected' : ''}>Viagogo</option>
        </select>${auto}
        ${eventPicker(t, platform)}
      </div>
      <div class="lst-market">
        ${vg ? `
        <div class="lst-market-label">Viagogo od</div>
        <div class="lst-market-val">${vg.price ? money(vg.price, vg.currency) : '—'}</div>
        <div class="lst-sub">${vg.total} nabídek${vg.section ? ` · sekce ${escapeHtml(vg.section)}: ${vg.sectionPrice ? 'od ' + money(vg.sectionPrice, vg.currency) + ` (${vg.sectionCount})` : 'nikdo'}` : ''}</div>
        ${m && m.price ? `<div class="lst-sub">StubHub od ${money(m.price, m.currency)}</div>` : ''}` : `
        <div class="lst-market-label">StubHub od</div>
        <div class="lst-market-val">${m && m.price ? money(m.price, m.currency) : '—'}</div>
        ${m && m.total ? `<div class="lst-sub">${m.total} nabídek</div>` : ''}`}
        <button class="btn btn-sm lst-lookup" data-id="${t.id}" ${busy ? 'disabled' : ''}>${busy === 'search' ? 'Hledám…' : icon('search', 13) + ' Najít'}</button>
      </div>
      <div class="lst-form">
        <label class="lst-field"><span>Cena/ks (${escapeHtml(cur)})</span><input class="lst-price" type="number" min="0" step="0.01" value="${L.price || ''}" placeholder="${hint ? Math.round(hint) : ''}"></label>
        <label class="lst-field"><span>Typ vstupenky</span><select class="lst-type">${typeOptions(platform, L.ticketType)}</select></label>
      </div>
      <div class="lst-actions">
        <button class="btn btn-primary btn-sm lst-go" data-id="${t.id}" ${busy ? 'disabled' : ''}>${busy === 'prefill' ? 'Vyplňuji…' : 'Předvyplnit na ' + PLATFORM_LABEL[platform]}</button>
        ${L.status === 'prefilled' ? `<button class="btn btn-sm lst-done" data-id="${t.id}" title="Pokud se ID nenačetlo samo, zadej ho ručně">Uloženo ručně…</button>` : ''}
      </div>
    </div>`;
  }
  function autoResultHtml() {
    const r = ui.autoResult;
    if (!r) return '';
    return `<div class="lst-compare">
      <div class="lst-compare-head">${icon('zap', 15)} Neaktivně zalistováno ${r.done.length}${r.failed.length ? `, nepovedlo se ${r.failed.length}` : ''} — ceny jsou 2× doporučené, zkontroluj je a zveřejni na tržišti</div>
      ${r.done.map(x => `<div class="lst-cmp-row"><span class="lst-cmp-ev">${escapeHtml(x)}</span><span></span><span class="lst-cmp-issue">${icon('check', 13)} uloženo, nezveřejněno</span></div>`).join('')}
      ${r.failed.map(x => `<div class="lst-cmp-row bad"><span class="lst-cmp-ev">${escapeHtml(x)}</span><span></span><span class="lst-cmp-issue">${icon('alert', 13)} nezalistováno</span></div>`).join('')}
    </div>`;
  }
  function compareHtml() {
    const c = ui.compare;
    if (!c) return '';
    if (c.loading) return `<div class="lst-compare"><div class="lst-muted">Načítám inzeráty z inv.viagogo…</div></div>`;
    if (c.error) return `<div class="lst-compare"><div class="lst-warn">${icon('alert', 14)} ${escapeHtml(c.error)}</div></div>`;
    const bad = c.rows.filter(r => r.issues.length);
    return `<div class="lst-compare">
      <div class="lst-compare-head">${icon('layers', 15)} Porovnání s Viagogem · ${c.rows.length} akcí, ${bad.length ? `<strong class="lst-bad">${bad.length} s rozdílem</strong>` : 'vše sedí'}</div>
      ${c.rows.map(r => `<div class="lst-cmp-row${r.issues.length ? ' bad' : ''}">
        <span class="lst-cmp-ev">${escapeHtml(r.e.name)} <span class="lst-muted">· ${r.day ? fmtDateCz(r.day) : ''} · ${escapeHtml(r.e.city || '')}</span></span>
        <span class="lst-cmp-num">nabízeno ${r.e.available} · prodáno ${r.e.sold} · k doručení ${r.e.pending}</span>
        <span class="lst-cmp-issue">${r.issues.length ? icon('alert', 13) + ' ' + escapeHtml(r.issues.join('; ')) : icon('check', 13) + ' sedí'}</span>
      </div>`).join('')}
    </div>`;
  }

  function render() {
    const box = document.getElementById('listingBody');
    if (!box) return;
    updateBadge();
    if (state.currentView !== 'listing') return;
    if (isWeb()) { box.innerHTML = '<div class="pl-empty">Zalistování předvyplňuje formuláře v panelech SalesPro a inv.viagogo — funguje jen v desktopové aplikaci.</div>'; return; }
    const list = candidates();
    const f = ui.filter;
    const shown = list.filter(t => f === 'all' || platformOf(t) === f);
    const counts = { all: list.length, Stubhub: list.filter(t => platformOf(t) === 'Stubhub').length, Viagogo: list.filter(t => platformOf(t) === 'Viagogo').length };
    const chip = (k, l) => `<button class="lst-chip${f === k ? ' active' : ''}" data-filter="${k}">${l} <span>${counts[k]}</span></button>`;
    box.innerHTML = `
      <div class="lst-toolbar">
        <div class="lst-chips">${chip('all', 'Vše')}${chip('Stubhub', 'StubHub')}${chip('Viagogo', 'Viagogo')}</div>
        <div class="lst-tools">
          <button class="btn btn-sm" id="lstLookupAll">${icon('refresh', 13)} Načíst tržní ceny</button>
          <button class="btn btn-sm" id="lstCompare">${icon('layers', 13)} Porovnat s Viagogem</button>
          <button class="btn btn-sm" id="lstAutoList" title="Uloží inzeráty jako NEAKTIVNÍ za 2× doporučenou cenu (vše v aktuálním filtru); zveřejníš je sám">${icon('zap', 13)} Zalistovat neaktivně (2× doporučená)</button>
        </div>
      </div>
      ${autoResultHtml()}
      ${compareHtml()}
      ${shown.length ? `<div class="lst-list">${shown.map(rowHtml).join('')}</div>`
        : `<div class="pl-empty">${list.length ? 'V tomhle filtru nic není.' : 'Všechny budoucí vstupenky jsou zalistované nebo prodané.'}</div>`}
      <p class="lst-footnote">Formulář se jen předvyplní — <strong>Uložit</strong> v panelu tržiště klikáš ty. Po uložení si TicketVault sám přečte ID inzerátu a vstupenku přepne na Zalistováno.</p>`;
  }

  function updateBadge() {
    const b = document.getElementById('navListingBadge');
    if (!b) return;
    const n = candidates().length;
    b.textContent = n; b.style.display = n ? '' : 'none';
  }

  function wire() {
    if (ui.wired) return;
    const box = document.getElementById('listingBody');
    if (!box) return;
    ui.wired = true;
    const T = id => (state.db.tickets || []).find(t => t.id === id);
    box.addEventListener('click', async e => {
      const chipEl = e.target.closest('.lst-chip');
      if (chipEl) { ui.filter = chipEl.dataset.filter; render(); return; }
      if (e.target.closest('#lstCompare')) { compareViagogo(); return; }
      if (e.target.closest('#lstAutoList')) {
        const list = candidates().filter(t => ui.filter === 'all' || platformOf(t) === ui.filter);
        const ready = list.filter(t => recommendedPrice(t));
        if (!list.length) return;
        const skipped = list.length - ready.length;
        if (!confirm(`Uložit ${ready.length} inzerátů jako NEAKTIVNÍ za 2× doporučenou cenu?` + (skipped ? `\n${skipped} nemá doporučenou cenu — přeskočí se.` : '') + '\nNic se nezveřejní.')) return;
        autoList(ready);
        return;
      }
      if (e.target.closest('#lstLookupAll')) {
        const list = candidates().filter(t => ui.filter === 'all' || platformOf(t) === ui.filter);
        for (const t of list) await lookup(t, platformOf(t), true);
        toast('Tržní ceny načtené', 'success');
        return;
      }
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      const t = T(btn.dataset.id);
      if (!t) return;
      if (btn.classList.contains('lst-lookup')) lookup(t, platformOf(t));
      else if (btn.classList.contains('lst-go')) prefill(t);
      else if (btn.classList.contains('lst-done')) {
        const id = prompt(`ID inzerátu na ${PLATFORM_LABEL[platformOf(t)]} (nech prázdné, pokud ho nemáš):`, '');
        if (id !== null) markListed(t, id.trim(), false);
      }
    });
    box.addEventListener('change', async e => {
      const t = T(e.target.dataset.id || (e.target.closest('.lst-row') || {}).dataset?.id);
      if (!t) return;
      if (e.target.classList.contains('lst-platform')) {
        await patchTicket(t, { listing: { platform: e.target.value, platformManual: e.target.value !== defaultPlatform(t), eventId: '', eventName: '', ticketType: '' } });
        render();
        if (!ui.search[t.id] || (e.target.value === 'Viagogo' && !ui.search[t.id].vg)) lookup(t, e.target.value, true);
      } else if (e.target.classList.contains('lst-ev-select')) {
        const r = ui.search[t.id] && (platformOf(t) === 'Stubhub' ? ui.search[t.id].sh : ui.search[t.id].vg);
        const ev = r && r.events.find(x => x.id === e.target.value);
        const patch = { eventId: e.target.value, eventName: ev ? ev.name : '' };
        if (ev && platformOf(t) === 'Stubhub' && ev.minPrice) patch.market = { price: ev.minPrice, listPrice: ev.minListPrice, currency: ev.currency, total: ev.total, at: new Date().toISOString(), eventName: ev.name };
        if (ev && platformOf(t) === 'Viagogo') patch.vgMarket = await viagogoMarket(t, ev.id).catch(() => null);
        await patchTicket(t, { listing: patch });
        render();
      } else if (e.target.classList.contains('lst-price')) {
        await patchTicket(t, { listing: { price: parseFloat(e.target.value) || null } });
      } else if (e.target.classList.contains('lst-type')) {
        await patchTicket(t, { listing: { ticketType: e.target.value } });
      }
    });
  }

  window.renderListingPage = async function () {
    wire();
    render();
    await loadPL();
    render();
    if (waiting().length) startWatch();
  };
  window.updateListingBadge = function () { try { updateBadge(); } catch (_) { /* db not ready */ } };
  // Exposed for tests / console debugging.
  window.__listing = { isPremierLeague, platformOf, searchTerms, score, teamKeys, recommendedPrice, autoList, candidates };
})();
