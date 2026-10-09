// Ticket delivery (1.19) — SeatLabs ticket links → e-mail to the buyer → DRAFT in Gmail.
// Links come from the user's own SeatLabs login in the embedded "SeatLabs" panel
// (persist:seatlabs): POST /api/getUserData → pdfs[] (team, game, member, ticket "block / row / seat",
// type digital-pass → ios/android, ticket → pdf, one-time → link) and GET /api/links/delivery
// (which links the buyer already opened). Missing links can be generated through
// api.seatlabs.net/generateTicketSite with a club membership login (3 Labs per ticket).
// The e-mail is filled from the sale (buyer, event, venue, seats) and the server stores it
// as a draft in the seller's Gmail (POST /delivery/draft). Nothing is ever sent from here.
// Automatic mode: a sold ticket whose links are unambiguous (exactly as many unused, not yet
// delivered links for that match as tickets sold) gets its draft without any click.
// Relies on app.js globals: state, ensureMarketplaceLoaded, toast, escapeHtml, refreshDb.
(function () {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isWeb = () => document.documentElement.classList.contains('web-mode');
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const LAB_PRICE = 3; // £ per generated ticket (SeatLabs pricing guide)
  const WHATSAPP = '+420 770700167';
  const SIGNATURE = 'Michal';

  // ---------- panel ----------------------------------------------------------------
  async function panel() {
    if (isWeb()) throw new Error('SeatLabs funguje jen v desktopové aplikaci.');
    if (typeof ensureMarketplaceLoaded === 'function') ensureMarketplaceLoaded('seatlabs');
    const wv = document.getElementById('webview-seatlabs');
    if (!wv) throw new Error('Panel SeatLabs nenalezen');
    for (let i = 0; i < 60; i++) {
      try { if (wv.getURL() && !wv.isLoading()) return wv; } catch (_) { /* not attached yet */ }
      await sleep(500);
    }
    throw new Error('Panel SeatLabs se nenačetl');
  }
  async function inPanel(fn, arg) {
    const wv = await panel();
    return wv.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)})`, true);
  }

  // Page functions — serialized and run INSIDE seatlabs.net. Self-contained.
  // The SeatLabs API key never leaves the page.
  async function pageSlLinks() {
    const r = await fetch('/api/getUserData', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'include' });
    if (r.status === 401 || r.status === 403 || r.redirected) return { error: 'login' };
    const j = await r.json().catch(() => null);
    if (!j || !Array.isArray(j.pdfs)) return { error: 'login' };
    let delivered = {};
    try {
      const d = await (await fetch('/api/links/delivery', { credentials: 'include' })).json();
      for (const x of (d && d.deliveries) || []) delivered[x.orderId] = x.deliveredAt;
    } catch (_) { /* optional */ }
    const links = j.pdfs.map(p => {
      const det = p.details || {};
      const parts = String(p.ticket || '').split('/').map(s => s.trim());
      return {
        orderId: p.orderId, team: p.team || '', game: String(p.game || det.Product || det.MATCH || '').trim(), type: p.type || '',
        member: p.member || p.memberName || '', createdAt: p.createdAt || null, expiryDate: p.expiryDate || null,
        block: String(det.Block || parts[0] || '').trim(), row: String(det.Row || parts[1] || '').trim(), seat: String(det.Seat || parts[2] || '').trim(),
        stand: det.Stand || det.STAND || '', supporter: det['Supporter Number'] || det['Supporter ID'] || det['CLIENT REF'] || det.CRN || '',
        ios: p.ios || '', android: p.android || '', link: p.link || p.oneTimeLink || '', pdf: p.pdf || '',
        deliveredAt: delivered[p.orderId] || null
      };
    });
    return { links, labs: j.labs };
  }
  async function pageSlGenerate(body) {
    const u = await fetch('/api/getUserData', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', credentials: 'include' });
    const j = await u.json().catch(() => null);
    if (!j || !j.apiKey) return { error: 'login' };
    try {
      const r = await fetch('https://api.seatlabs.net/generateTicketSite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: j.apiKey, ...body }) });
      const d = await r.json().catch(() => null);
      if (!d) return { error: 'HTTP ' + r.status };
      if (d.success !== true) return { error: d.error || 'Generování selhalo' };
      const tickets = Array.isArray(d.tickets) ? d.tickets : [];
      return { ok: tickets.filter(t => t && t.success !== false).length, failed: tickets.filter(t => t && t.success === false).map(t => t.error || 'chyba') };
    } catch (e) { return { error: e.message }; }
  }

  let linkCache = null;
  async function loadLinks(force) {
    if (!force && linkCache && Date.now() - linkCache.at < 60000) return linkCache;
    const r = await inPanel(pageSlLinks);
    if (!r || r.error) throw new Error(r && r.error === 'login' ? 'Přihlas se v panelu SeatLabs' : (r && r.error) || 'SeatLabs bez odpovědi');
    linkCache = { links: r.links, labs: r.labs, at: Date.now() };
    return linkCache;
  }

  // ---------- matching ---------------------------------------------------------------
  // Same club spelled differently in TicketVault, StubHub and SeatLabs.
  const ALIASES = [
    [/\bpsg\b/g, 'paris saint germain'], [/\bman\.? city\b/g, 'manchester city'], [/\bman\.? (?:utd|united)\b/g, 'manchester united'],
    [/\bspurs\b/g, 'tottenham hotspur'], [/\bwolves\b/g, 'wolverhampton wanderers'], [/\bbvb\b/g, 'borussia dortmund'],
    [/\bnewcastle utd\b/g, 'newcastle united'], [/\bnott(?:'|i)?m? forest\b/g, 'nottingham forest'], [/\bbrighton\b/g, 'brighton hove albion'],
    [/\bbayern\b(?! (?:leverkusen|munich|munchen))/g, 'bayern munich'], [/\binter\b/g, 'inter milan'], [/\batleti\b/g, 'atletico madrid']
  ];
  const STOP = new Set(['fc', 'afc', 'cf', 'sc', 'ac', 'the', 'and', 'club', 'football', 'tickets', 'ticket', 'match', 'de', 'hove']);
  function words(s) {
    let x = norm(s).replace(/[^a-z0-9]+/g, ' ');
    for (const [re, to] of ALIASES) x = x.replace(re, to);
    return new Set(x.split(' ').filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w)));
  }
  // "Manchester City FC vs Paris Saint-Germain - Champions League" → two sides.
  function sides(name) {
    const head = String(name || '').split(/\s[-–—|]\s/)[0];
    return head.split(/\s+(?:vs?\.?|x|@|–|-)\s+/i).map(s => s.trim()).filter(Boolean).slice(0, 2);
  }
  // Both teams must be in the SeatLabs game name (a Man City pass for another match must not be used).
  function sameMatch(eventName, game) {
    const g = words(game);
    const sd = sides(eventName);
    if (sd.length < 2) return false;
    return sd.every(s => {
      const w = [...words(s)];
      if (!w.length) return false;
      const hit = w.filter(x => g.has(x)).length;
      return hit / w.length >= 0.66;
    });
  }
  function seatSet(t) {
    const out = new Set();
    for (const part of String(t.seat || '').split(/[,;/\s]+/).filter(Boolean)) {
      const m = part.match(/^(\d+)-(\d+)$/);
      if (m && +m[2] >= +m[1] && +m[2] - +m[1] < 30) { for (let i = +m[1]; i <= +m[2]; i++) out.add(String(i)); }
      else out.add(part.replace(/^0+(?=\d)/, '').toLowerCase());
    }
    return out;
  }
  const blockKey = s => { const m = norm(s).match(/([a-z]*\d+[a-z]?)/); return m ? m[1].replace(/^([a-z]*)0+(?=\d)/, '$1') : ''; };
  const DAY = 86400000;
  function usedOrderIds(exceptIds) {
    const used = new Set();
    for (const t of (state.db && state.db.tickets) || []) {
      if (exceptIds && exceptIds.has(t.id)) continue;
      for (const l of (t.delivery && t.delivery.links) || []) if (l.orderId) used.add(l.orderId);
    }
    return used;
  }
  // Links of this match that may belong to ticket row t (seat list wins, else block).
  function candidatesFor(t, links, exceptIds) {
    const used = usedOrderIds(exceptIds);
    const ev = Date.parse(String(t.eventDate || '').slice(0, 10));
    const seats = seatSet(t);
    const blk = blockKey(t.section);
    return links.filter(l => {
      if (used.has(l.orderId) || !(l.ios || l.android || l.link || l.pdf)) return false;
      if (!sameMatch(t.eventName, l.game)) return false;
      const c = Date.parse(l.createdAt || '');
      if (ev && c && (c > ev + DAY || c < ev - 200 * DAY)) return false; // same fixture of another season
      if (seats.size) return seats.has(String(l.seat).replace(/^0+(?=\d)/, '').toLowerCase());
      if (blk) return blockKey(l.block) === blk;
      return true;
    }).sort(bySeat);
  }
  // Is the link in the block the buyer bought? Unknown section on the ticket = no constraint.
  function inSoldBlock(t, l) {
    const blk = blockKey(t.section);
    return !blk || blockKey(l.block) === blk;
  }
  function bySeat(a, b) {
    return String(a.block).localeCompare(String(b.block), undefined, { numeric: true })
      || String(a.row).localeCompare(String(b.row), undefined, { numeric: true })
      || String(a.seat).localeCompare(String(b.seat), undefined, { numeric: true });
  }

  const st = t => String(t.status || '').trim().toLowerCase();
  const qtyOf = t => Number(t.quantity) || 1;
  const pending = t => st(t) === 'sold' && t.buyerEmail && !(t.delivery && t.delivery.draftAt);
  // Other sold rows of the same match still waiting for their e-mail (they share the links).
  function siblings(t) {
    return ((state.db && state.db.tickets) || []).filter(x => pending(x) && x.eventDate === t.eventDate && norm(x.eventName) === norm(t.eventName));
  }
  // Split links between buyers: bigger orders first, seats kept in order.
  function allocate(rows, links) {
    const pool = [...links];
    const out = new Map();
    for (const r of [...rows].sort((a, b) => qtyOf(b) - qtyOf(a))) out.set(r.id, pool.splice(0, qtyOf(r)));
    return out;
  }

  // ---------- e-mail -------------------------------------------------------------------
  const cap = s => String(s || '').toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  const firstName = n => cap(String(n || '').trim().split(/\s+/)[0] || '');
  const looksLikeName = s => /^[\p{L}.' -]+$/u.test(String(s || '').trim()) && /\s/.test(String(s || '').trim());
  function eventTitle(t, links) {
    const g = links.find(l => l.game);
    return (g ? g.game : t.eventName || '').replace(/\s+/g, ' ').trim();
  }
  function linkLines(l) {
    const out = [];
    if (l.ios) out.push('iOS: ' + l.ios);
    if (l.android && l.android !== l.ios) out.push('Android: ' + l.android);
    if (!out.length && (l.link || l.pdf)) out.push(l.link || l.pdf);
    return out;
  }
  function seatLabel(l) {
    return [l.block && 'Block ' + l.block, l.row && 'Row ' + l.row, l.seat && 'Seat ' + l.seat].filter(Boolean).join(', ');
  }
  function buildEmail(t, links) {
    const n = links.length;
    const title = eventTitle(t, links);
    const blocks = [...new Set(links.map(l => l.block).filter(Boolean))];
    const pass = links.some(l => l.ios || l.android);
    const subject = `${title} – your ticket${n > 1 ? 's' : ''}${blocks.length ? ` (Block ${blocks.join(', ')})` : ''}`;
    const L = [];
    L.push(`Hi ${firstName(t.buyerName)},`.replace('Hi ,', 'Hi,'), '');
    L.push(`I am sending you the ticket${n > 1 ? 's' : ''} for the ${title} match${t.venue ? ' at the ' + String(t.venue).split(',')[0].trim() : ''}.`, '');
    links.forEach((l, i) => {
      L.push(`Ticket ${i + 1}${seatLabel(l) ? ' – ' + seatLabel(l) : ''}`, ...linkLines(l), '');
    });
    L.push('How to save the ticket on your phone', '');
    if (pass) {
      L.push('iPhone (iOS)', '1. Open the iOS link in Safari.', '2. Tap "Add to Apple Wallet" – the ticket is saved in your Wallet app.',
        '3. If you don\'t see it, tap the Share button (square with an arrow), choose "Add to Home Screen", then "Add".', '');
      L.push('Android', '1. Open the Android link in Chrome.', '2. Tap "Add to Google Wallet" – the ticket is saved in your Wallet app.',
        '3. If you don\'t see it, tap the three dots in the top right corner, choose "Add to Home screen", then "Add".', '');
    } else {
      L.push('iPhone (iOS)', '1. Open the ticket link in Safari.', '2. If you see "Add to Apple Wallet", tap it – the ticket is saved in your Wallet app.',
        '3. Otherwise tap the Share button (square with an arrow), choose "Add to Home Screen", then "Add".', '');
      L.push('Android', '1. Open the ticket link in Chrome.', '2. If you see "Add to Google Wallet", tap it – the ticket is saved in your Wallet app.',
        '3. Otherwise tap the three dots in the top right corner, choose "Add to Home screen", then "Add".', '');
    }
    // Wallet passes (Man City, Fulham) are NFC without a QR code; only mobile-pass "ticket" links show a dynamic QR.
    const qr = links.some(l => !(l.ios || l.android));
    L.push('Important',
      ...(qr ? ['- The QR code is dynamic (you will see a moving line around it) – screenshots will NOT work. Open the ticket live in your Wallet or browser at the gate.'] : []),
      '- Keep your phone charged and mobile data switched on.',
      '- Please arrive at the stadium about 45 minutes to 1 hour before kick-off and ideally let me know once you are inside.', '');
    L.push(`My WhatsApp: ${WHATSAPP}`, '');
    L.push('If anyone asks where you got the tickets from, you can say they are a gift from a friend.');
    const friends = [...new Set(links.map(l => String(l.member || '').replace(/^(mr|mrs|ms|miss)\.?\s+/i, '').trim()).filter(looksLikeName))];
    if (friends.length) L.push(`The name of the friend is: ${friends.join(' and ')}`);
    L.push('(But in 99.9% of cases, no one will ask anything.)', '');
    L.push('Enjoy the match!', '', 'After the game, please delete the tickets from your mobile wallet.', '', SIGNATURE);
    return { subject, text: L.join('\n') };
  }
  function textToHtml(text) {
    const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const body = esc(text).replace(/https?:\/\/[^\s<]+/g, u => `<a href="${u}">${u}</a>`)
      .replace(/(\+420[\d ]{9,12}\d)/g, m => `<a href="https://wa.me/${m.replace(/\D/g, '')}">${m}</a>`)
      .replace(/\n/g, '<br>\n');
    return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222">${body}</div>`;
  }

  async function saveDraft(t, links, mail, opts = {}) {
    const res = await window.api.saveDeliveryDraft({
      ticketIds: [t.id], to: mail.to || t.buyerEmail, subject: mail.subject, text: mail.text, html: textToHtml(mail.text), force: !!opts.force,
      links: links.map(l => ({ ticketId: t.id, orderId: l.orderId, block: l.block, row: l.row, seat: l.seat, member: l.member, game: l.game,
        ios: l.ios, android: l.android, link: l.link, pdf: l.pdf }))
    });
    if (!res || !res.success) { const e = new Error((res && res.error) || 'Koncept se nepodařilo uložit'); e.duplicate = res && res.duplicate; throw e; }
    return res;
  }

  // ---------- automatic run ----------------------------------------------------------------
  let autoRunning = null;
  async function autoRun(opts = {}) {
    if (isWeb() || autoRunning) return autoRunning;
    autoRunning = (async () => {
      const today = new Date(new Date().toDateString()).getTime();
      const waiting = ((state.db && state.db.tickets) || []).filter(t => pending(t) && Date.parse(String(t.eventDate || '').slice(0, 10)) >= today);
      if (!waiting.length) return { done: 0 };
      let links;
      try { links = (await loadLinks(true)).links; }
      catch (e) { if (!opts.quiet) toast('SeatLabs: ' + e.message, 'error', 6000); return { error: e.message }; }
      const fresh = links.filter(l => !l.deliveredAt);
      const seen = new Set();
      let done = 0;
      for (const t of waiting) {
        if (seen.has(t.id)) continue;
        const rows = siblings(t);
        rows.forEach(r => seen.add(r.id));
        const ids = new Set(rows.map(r => r.id));
        // Only seats in the block the buyer actually bought (StubHub section) — PSG 14. 10.: sold 4× block 004,
        // but only 2 seats are in 004 and 2 in 306. Anything else is the user's call in the dialog.
        const pool = [...new Map(rows.flatMap(r => candidatesFor(r, fresh, ids).filter(l => inSoldBlock(r, l))).map(l => [l.orderId, l])).values()].sort(bySeat);
        const need = rows.reduce((s, r) => s + qtyOf(r), 0);
        if (pool.length !== need) continue; // missing or extra links → user decides in the dialog
        const plan = allocate(rows, pool);
        for (const r of rows) {
          const ls = plan.get(r.id);
          try { await saveDraft(r, ls, buildEmail(r, ls)); done++; }
          catch (e) { if (!e.duplicate) console.warn('[delivery]', r.eventName, e.message); }
        }
      }
      if (done) {
        if (typeof refreshDb === 'function') await refreshDb();
        toast(`Lístky: ${done} ${done === 1 ? 'koncept připraven' : 'koncepty připraveny'} v Gmailu (Koncepty) — zkontroluj a odešli`, 'success', 8000);
      }
      return { done };
    })().finally(() => { autoRunning = null; });
    return autoRunning;
  }

  // ---------- generation through SeatLabs -----------------------------------------------------
  const MODULES = [
    [/manchester city|man city/, 'man city pass'], [/manchester united|man utd/, 'man utd'], [/arsenal/, 'arsenal pass'],
    [/tottenham|spurs/, 'spurs'], [/chelsea/, 'chelsea'], [/fulham/, 'fulham'], [/newcastle/, 'newcastle login'],
    [/aston villa/, 'aston villa'], [/brentford/, 'brentford'], [/everton/, 'everton'], [/crystal palace/, 'crystal palace'],
    [/sunderland/, 'sunderland'], [/bournemouth/, 'bournemouth'], [/ipswich/, 'ipswich'], [/wrexham/, 'wrexham'], [/celtic/, 'celtic'],
    [/bayern/, 'bayern'], [/dortmund|bvb/, 'bvb'], [/ajax/, 'ajax'], [/real madrid/, 'realmadrid'], [/monaco/, 'asmonaco'],
    [/brugge/, 'clubbrugge'], [/roma\b/, 'roma']
  ];
  const moduleFor = club => { const c = norm(club); const m = MODULES.find(([re]) => re.test(c)); return m ? m[1] : null; };
  const homeClub = t => sides(t.eventName)[0] || '';
  // Every word of the shorter name must be in the longer one: Tottenham = Tottenham Hotspur, Manchester City ≠ Manchester United.
  const sameClub = (a, b) => { const [S, L] = [words(a), words(b)].sort((x, y) => x.size - y.size); return S.size > 0 && [...S].every(x => L.has(x)); };
  function membershipsFor(t) {
    const club = homeClub(t);
    const acc = norm(t.account).trim();
    return ((state.db && state.db.memberships) || [])
      .filter(m => m.password && (m.email || m.memberId) && sameClub(club, m.team))
      .map(m => ({ m, own: !!acc && (norm(m.email).trim() === acc || norm(m.memberId).trim() === acc) }))
      .sort((a, b) => (b.own - a.own));
  }
  function generateBody(t, m) {
    const module = moduleFor(m.team) || moduleFor(homeClub(t));
    const kw = sides(t.eventName)[1] || '';
    return {
      module, email: String(m.email || m.memberId).trim(), password: m.password,
      applyAdultForChelsea: true, applyAdultForEverton: true,
      chelseaClosest: !kw, chelseaKeyword: module === 'chelsea' ? kw : '',
      manUtdKeyword: module === 'man utd' ? kw : '', ahlanClosest: true, ahlanKeyword: '',
      spursKeyword: module === 'spurs' ? kw : '', newcastleKeyword: module === 'newcastle login' ? kw : '',
      ajaxKeyword: module === 'ajax' ? kw : '', ajaxAll: false,
      manCitySeason: 'member', manCityEventKeyword: '', fulhamMode: 'member', proxies: ''
    };
  }

  // ---------- dialog ---------------------------------------------------------------------
  let dlg = null;
  function modal() {
    if (dlg) return dlg;
    dlg = document.createElement('div');
    dlg.className = 'modal';
    dlg.id = 'modalDelivery';
    dlg.innerHTML = `
      <div class="modal-backdrop" data-dlv-close></div>
      <div class="modal-content modal-large dlv-modal">
        <div class="modal-header"><h3 id="dlvTitle">Připravit lístky</h3><button class="modal-close" data-dlv-close>×</button></div>
        <div class="modal-body" id="dlvBody"></div>
        <div class="modal-footer">
          <span class="dlv-status" id="dlvStatus"></span>
          <button class="btn btn-dark" data-dlv-close>Zrušit</button>
          <button class="btn btn-primary" id="dlvSave">Uložit koncept do Gmailu</button>
        </div>
      </div>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('click', e => { if (e.target.closest('[data-dlv-close]')) dlg.classList.remove('active'); });
    return dlg;
  }

  async function open(id) {
    const t = ((state.db && state.db.tickets) || []).find(x => x.id === id);
    if (!t) return;
    if (!t.buyerEmail) { toast('U vstupenky chybí e-mail kupujícího (doplň ho v úpravě vstupenky).', 'error', 6000); return; }
    const m = modal();
    const body = m.querySelector('#dlvBody');
    m.querySelector('#dlvTitle').textContent = `Připravit lístky – ${t.eventName}`;
    body.innerHTML = '<div class="dlv-muted">Načítám odkazy ze SeatLabs…</div>';
    m.classList.add('active');
    const ui = { t, edited: false, links: [] };
    try { ui.links = (await loadLinks(true)).links; }
    catch (e) { body.innerHTML = `<div class="dlv-error">${escapeHtml(e.message)}. Otevři panel <b>SeatLabs</b> v menu vlevo a přihlas se.</div>`; return; }
    render(ui);
  }

  function render(ui) {
    const { t } = ui;
    const m = modal();
    const body = m.querySelector('#dlvBody');
    const rows = siblings(t).length ? siblings(t) : [t];
    const ids = new Set(rows.map(r => r.id));
    const cands = candidatesFor(t, ui.links, new Set([t.id]));
    if (!ui.selected) {
      const fresh = [...new Map(rows.flatMap(r => candidatesFor(r, ui.links.filter(l => !l.deliveredAt), ids)).map(l => [l.orderId, l])).values()].sort(bySeat);
      ui.selected = new Set(((allocate(rows, fresh).get(t.id)) || []).map(l => l.orderId));
    }
    const chosen = cands.filter(l => ui.selected.has(l.orderId));
    const need = qtyOf(t);
    const otherBlock = chosen.filter(l => !inSoldBlock(t, l));
    if (!ui.edited) ui.mail = { to: t.buyerEmail, ...buildEmail(t, chosen) };
    const ms = membershipsFor(t);
    const done = t.delivery && t.delivery.draftAt;
    body.innerHTML = `
      ${done ? `<div class="dlv-warn">Koncept už byl vytvořen ${escapeHtml(done.slice(0, 16).replace('T', ' '))} (${escapeHtml(t.delivery.to || '')}). Uložením vznikne další.</div>` : ''}
      <div class="dlv-buyer"><b>${escapeHtml(t.buyerName || 'Kupující')}</b> · ${need} ks · ${escapeHtml(t.eventName)} ${escapeHtml(t.eventDate || '')}
        ${rows.length > 1 ? `<div class="dlv-muted">Na tento zápas čeká na lístky ${rows.length} objednávek: ${rows.map(r => `${escapeHtml(r.buyerName || '?')} (${qtyOf(r)} ks)`).join(', ')}.</div>` : ''}</div>
      ${otherBlock.length ? `<div class="dlv-warn">Kupující koupil sekci <b>${escapeHtml(t.section)}</b>, ale ${otherBlock.map(l => escapeHtml(seatLabel(l))).join('; ')} ${otherBlock.length === 1 ? 'je' : 'jsou'} v jiném bloku.</div>` : ''}
      <div class="dlv-section-title">Lístky ze SeatLabs <span class="dlv-count ${chosen.length === need ? 'ok' : 'bad'}">vybráno ${chosen.length} z ${need}</span></div>
      ${cands.length ? `<div class="dlv-links">${cands.map(l => `
        <label class="dlv-link">
          <input type="checkbox" data-dlv-link="${escapeHtml(l.orderId)}" ${ui.selected.has(l.orderId) ? 'checked' : ''}>
          <span class="dlv-seat">${escapeHtml(seatLabel(l) || l.game)}</span>
          <span class="dlv-muted">${escapeHtml(l.member || '')} · ${escapeHtml(l.type || '')}${l.deliveredAt ? ' · <b>v SeatLabsu doručeno</b>' : ''}</span>
        </label>`).join('')}</div>`
        : '<div class="dlv-muted">Pro tento zápas a tato sedadla v SeatLabsu žádné nepoužité odkazy nejsou.</div>'}
      ${chosen.length < need ? `
        <div class="dlv-gen">
          <div class="dlv-section-title">Vygenerovat v SeatLabs</div>
          ${ms.length ? `
            <div class="dlv-muted">Přihlásí se do vybraných členství a vygeneruje jejich lístky (≈ ${LAB_PRICE} £ za lístek, platí se ze SeatLabs kreditu).
              ${/manchester city/.test(norm(homeClub(t))) ? '<br><b>Man City:</b> digital pass platí na nejbližší zápas — použijí se jen lístky, které SeatLabs vrátí přímo na tento zápas.' : ''}</div>
            ${ms.map(({ m: x, own }) => `<label class="dlv-link"><input type="checkbox" data-dlv-member="${escapeHtml(x.id)}" ${own ? 'checked' : ''}>
              <span class="dlv-seat">${escapeHtml(x.team)} · ${escapeHtml(x.owner || x.memberId || x.email)}</span><span class="dlv-muted">${escapeHtml(x.email || x.memberId)}${own ? ' · účet u vstupenky' : ''}</span></label>`).join('')}
            <button class="btn btn-sm" id="dlvGenerate">Vygenerovat vybraným</button>`
            : `<div class="dlv-muted">V Členství nemám přihlášení pro klub „${escapeHtml(homeClub(t))}“ — vygeneruj lístky přímo v panelu SeatLabs a pak dej Obnovit.</div>`}
        </div>` : ''}
      <div class="dlv-section-title">E-mail <button class="btn btn-sm" id="dlvRefresh" title="Znovu načíst odkazy ze SeatLabs">Obnovit odkazy</button></div>
      <div class="form-group"><label>Komu</label><input type="email" id="dlvTo" value="${escapeHtml(ui.mail.to)}"></div>
      <div class="form-group"><label>Předmět</label><input type="text" id="dlvSubject" value="${escapeHtml(ui.mail.subject)}"></div>
      <div class="form-group"><label>Text</label><textarea id="dlvText" rows="16">${escapeHtml(ui.mail.text)}</textarea></div>`;
    m.querySelector('#dlvStatus').textContent = 'Uloží se jako koncept do Gmailu — nic se neodešle.';

    body.querySelectorAll('[data-dlv-link]').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? ui.selected.add(cb.dataset.dlvLink) : ui.selected.delete(cb.dataset.dlvLink);
      ui.edited = false;
      render(ui);
    }));
    ['dlvTo', 'dlvSubject', 'dlvText'].forEach(idx => body.querySelector('#' + idx).addEventListener('input', () => {
      ui.edited = true;
      ui.mail = { to: body.querySelector('#dlvTo').value.trim(), subject: body.querySelector('#dlvSubject').value, text: body.querySelector('#dlvText').value };
    }));
    body.querySelector('#dlvRefresh').addEventListener('click', async () => {
      try { ui.links = (await loadLinks(true)).links; render(ui); } catch (e) { toast(e.message, 'error'); }
    });
    const gen = body.querySelector('#dlvGenerate');
    if (gen) gen.addEventListener('click', () => generate(ui));
    const save = m.querySelector('#dlvSave');
    save.onclick = async () => {
      const ls = cands.filter(l => ui.selected.has(l.orderId));
      if (!ls.length) { toast('Vyber aspoň jeden lístek.', 'error'); return; }
      if (ls.length !== need && !confirm(`Vybráno ${ls.length} lístků, prodáno ${need} ks. Uložit koncept i tak?`)) return;
      save.disabled = true;
      try {
        await saveDraft(t, ls, ui.mail, { force: !!done });
        m.classList.remove('active');
        if (typeof refreshDb === 'function') await refreshDb();
        toast('Koncept uložen v Gmailu (Koncepty) — zkontroluj ho a odešli.', 'success', 7000);
      } catch (e) { toast(e.message, 'error', 7000); }
      finally { save.disabled = false; }
    };
  }

  async function generate(ui) {
    const { t } = ui;
    const body = modal().querySelector('#dlvBody');
    const picked = [...body.querySelectorAll('[data-dlv-member]:checked')].map(cb => cb.dataset.dlvMember);
    const ms = membershipsFor(t).map(x => x.m).filter(x => picked.includes(String(x.id)));
    if (!ms.length) { toast('Vyber členství, ze kterého se mají lístky vygenerovat.', 'error'); return; }
    if (!confirm(`SeatLabs se přihlásí do ${ms.length} ${ms.length === 1 ? 'účtu' : 'účtů'} a vygeneruje jejich lístky (≈ ${LAB_PRICE} £ za každý lístek). Pokračovat?`)) return;
    const btn = body.querySelector('#dlvGenerate');
    btn.disabled = true;
    const errors = [];
    for (const x of ms) {
      btn.textContent = `Generuji ${x.owner || x.memberId || x.email}…`;
      const body2 = generateBody(t, x);
      if (!body2.module) { errors.push(`${x.team}: SeatLabs modul neznám`); continue; }
      const r = await inPanel(pageSlGenerate, body2).catch(e => ({ error: e.message }));
      if (!r || r.error) errors.push(`${x.owner || x.email}: ${r && r.error === 'login' ? 'přihlas se v panelu SeatLabs' : (r && r.error) || 'bez odpovědi'}`);
      else if (r.failed && r.failed.length) errors.push(...r.failed.filter(f => !/duplicate/i.test(f)).map(f => `${x.owner || x.email}: ${f}`));
    }
    try { ui.links = (await loadLinks(true)).links; } catch (e) { errors.push(e.message); }
    ui.selected = null;
    ui.edited = false;
    render(ui);
    if (errors.length) toast('SeatLabs: ' + errors.join(' · '), 'error', 9000);
  }

  // ---------- row button helper ----------------------------------------------------------------
  function rowButton(t) {
    if (st(t) !== 'sold' || !t.buyerEmail) return '';
    const done = t.delivery && t.delivery.draftAt;
    return `<button class="btn btn-sm ${done ? 'btn-dark' : 'btn-list'}" data-action="delivery" data-id="${t.id}" title="${done ? 'Koncept e-mailu s lístky je v Gmailu (' + escapeHtml(done.slice(0, 16).replace('T', ' ')) + ')' : 'Připravit e-mail s lístky ze SeatLabs (koncept v Gmailu)'}">${done ? 'Lístky ✓' : 'Lístky'}</button>`;
  }

  // Automatic drafts: shortly after start and then every 10 minutes (desktop only).
  if (!isWeb()) {
    setTimeout(() => autoRun({ quiet: true }), 45000);
    setInterval(() => autoRun({ quiet: true }), 10 * 60000);
  }

  window.__delivery = { open, autoRun, rowButton, loadLinks, _match: { sameMatch, sides, words, seatSet, candidatesFor, allocate, buildEmail, generateBody, membershipsFor } };
})();
