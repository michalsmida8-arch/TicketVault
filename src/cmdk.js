// Command palette (Ctrl+K / Cmd+K): jump to a section, open a ticket, find an
// inbox item or run a common action from the keyboard. Uses globals from app.js
// (state, switchView, openTicketModal, fmtDateCz, icon, escapeHtml).
(function () {
  const VIEWS = [
    ['dashboard', 'Inventář', 'layers'], ['todo', 'K dořešení', 'alert'], ['stats', 'Statistiky', 'chart'],
    ['expenses', 'Výdaje', 'wallet'], ['payouts', 'Výplaty', 'euro'], ['inbox', 'Příchozí', 'inbox'],
    ['memberships', 'Membershipy', 'user'], ['mailboxes', 'E-mailové schránky', 'mail'], ['simcards', 'SIM karty', 'phone'],
    ['premierleague', 'Premier League', 'football'], ['watched', 'Sledované akce', 'star'],
    ['stubhub', 'StubHub', 'external'], ['viagogo', 'Viagogo', 'external'], ['settings', 'Nastavení', 'settings']
  ];
  const ACTIONS = [
    ['Přidat vstupenku', 'plus', () => window.openTicketModal && window.openTicketModal()],
    ['Synchronizovat se serverem', 'refresh', () => document.getElementById('btnSync')?.click() || (window.refreshDb && window.refreshDb())],
    ['Přidat vstupenku z PDF', 'pdf', () => document.getElementById('btnImportPdf')?.click()]
  ];
  const STATUS = { available: 'koupeno', listed: 'zalistováno', sold: 'prodáno', delivered: 'doručeno', cancelled: 'odepsáno' };
  let root, input, list, items = [], sel = 0;

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function match(q, ...fields) { if (!q) return true; const hay = norm(fields.join(' ')); return q.split(/\s+/).every(w => hay.includes(w)); }

  function build() {
    root = document.createElement('div');
    root.className = 'cmdk';
    root.innerHTML = `<div class="cmdk-backdrop"></div><div class="cmdk-box" role="dialog" aria-label="Rychlé hledání">
      <div class="cmdk-input-wrap">${icon('search', 18)}<input class="cmdk-input" placeholder="Hledej akci, vstupenku, sekci nebo příkaz…" spellcheck="false"><span class="cmdk-kbd">Esc</span></div>
      <div class="cmdk-list"></div></div>`;
    document.body.appendChild(root);
    input = root.querySelector('.cmdk-input');
    list = root.querySelector('.cmdk-list');
    root.querySelector('.cmdk-backdrop').addEventListener('click', close);
    input.addEventListener('input', render);
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { run(items[sel]); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
    list.addEventListener('mousemove', e => { const el = e.target.closest('.cmdk-item'); if (el) { sel = Number(el.dataset.i); paint(); } });
    list.addEventListener('click', e => { const el = e.target.closest('.cmdk-item'); if (el) run(items[Number(el.dataset.i)]); });
  }

  function render() {
    const q = norm(input.value.trim());
    const db = (typeof state !== 'undefined' && state.db) || {};
    const out = [];
    const views = VIEWS.filter(v => match(q, v[1], v[0])).map(v => ({ group: 'Sekce', ico: v[2], title: v[1], run: () => window.switchView(v[0]) }));
    const actions = ACTIONS.filter(a => match(q, a[0])).map(a => ({ group: 'Akce', ico: a[1], title: a[0], run: a[2] }));
    let tickets = [];
    if (q) {
      tickets = (db.tickets || []).filter(t => match(q, t.eventName, t.venue, t.section, t.account, t.platform, t.purchasePlatform, Object.values(t.externalIds || {}).join(' ')))
        .sort((a, b) => String(b.eventDate || '').localeCompare(String(a.eventDate || '')))
        .slice(0, 8)
        .map(t => ({ group: 'Vstupenky', ico: 'ticket', title: t.eventName || '—',
          meta: `${window.fmtDateCz(t.eventDate)} · ${t.quantity || 1} ks · ${STATUS[t.status] || t.status || ''}`,
          run: () => { window.switchView('dashboard'); window.openTicketModal(t); } }));
    }
    let inbox = [];
    if (q) {
      inbox = (db.inbox || []).filter(i => (i.state === 'pending_review' || !i.state) && match(q, i.subject, i.parsed && i.parsed.event, i.parsed && i.parsed.platform))
        .slice(0, 5).map(i => ({ group: 'Příchozí', ico: 'inbox', title: (i.parsed && i.parsed.event) || i.subject || '—', meta: (i.parsed && i.parsed.platform) || '', run: () => window.switchView('inbox') }));
    }
    out.push(...tickets, ...inbox, ...actions, ...views);
    items = out; sel = 0;
    if (!items.length) { list.innerHTML = '<div class="cmdk-empty">Nic nenalezeno</div>'; return; }
    let html = '', last = '';
    items.forEach((it, i) => {
      if (it.group !== last) { html += `<div class="cmdk-group">${it.group}</div>`; last = it.group; }
      html += `<div class="cmdk-item" data-i="${i}">${icon(it.ico, 16)}<span class="cmdk-title">${window.escapeHtml(it.title)}</span>${it.meta ? `<span class="cmdk-meta">${window.escapeHtml(it.meta)}</span>` : ''}</div>`;
    });
    list.innerHTML = html;
    paint();
  }
  function paint() {
    list.querySelectorAll('.cmdk-item').forEach(el => el.classList.toggle('sel', Number(el.dataset.i) === sel));
    const cur = list.querySelector('.cmdk-item.sel'); if (cur) cur.scrollIntoView({ block: 'nearest' });
  }
  function run(it) { if (!it) return; close(); setTimeout(() => { try { it.run(); } catch (e) { console.error(e); } }, 0); }
  function open() { if (!root) build(); root.classList.add('open'); input.value = ''; render(); setTimeout(() => input.focus(), 0); }
  function close() { if (root) root.classList.remove('open'); }
  window.openCommandPalette = open;

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      if (document.querySelector('#authOverlay.active, .auth-overlay.active')) return;
      e.preventDefault();
      if (root && root.classList.contains('open')) close(); else open();
    }
  });
})();
