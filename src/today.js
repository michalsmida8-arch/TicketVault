// "Dnes" panel on the inventory dashboard: what needs doing today, the next
// 30 days of events as a calendar strip, and expected cash from payouts.
// Relies on app.js globals: state, getPayoutTickets, getPrimaryCurrency,
// convertCurrency, saleCurrency, calcCostInPrimary, formatMoney, switchView, escapeHtml.
(function () {
  const DAY = 86400000;
  function d0(x) { const d = new Date(x); d.setHours(0, 0, 0, 0); return d; }
  function isoDay(d) { return d.toLocaleDateString('sv-SE'); }
  function diffDays(iso) { if (!iso) return null; const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return null; return Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - d0(new Date())) / DAY); }
  function st(t) { return String(t.status || 'available').trim().toLowerCase(); }

  function compute() {
    const db = (typeof state !== 'undefined' && state.db) || {};
    const tickets = db.tickets || [];
    const primary = getPrimaryCurrency();
    const deliver = tickets.filter(t => st(t) === 'sold' && (diffDays(t.eventDate) ?? 99) <= 5);
    const list = tickets.filter(t => st(t) === 'available' && (diffDays(t.eventDate) ?? -1) >= 0);
    const unsoldSoon = tickets.filter(t => st(t) === 'listed' && (diffDays(t.eventDate) ?? 99) >= 0 && diffDays(t.eventDate) <= 7);
    const payouts = getPayoutTickets().filter(p => !p.isPaid);
    const conv = p => convertCurrency(p.amount, saleCurrency(p.ticket), primary);
    const payToday = payouts.filter(p => p.daysLeft === 0);
    const payOverdue = payouts.filter(p => p.isOverdue);
    const in7 = payouts.filter(p => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 7).reduce((s, p) => s + conv(p), 0);
    const in30 = payouts.filter(p => p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 30).reduce((s, p) => s + conv(p), 0);
    const overdueSum = payOverdue.reduce((s, p) => s + conv(p), 0);
    const openCapital = tickets.filter(t => ['available', 'listed'].includes(st(t)) && (diffDays(t.eventDate) ?? 0) >= 0).reduce((s, t) => s + calcCostInPrimary(t), 0);
    const inbox = (db.inbox || []).filter(i => i.state === 'pending_review' || !i.state).length;
    return { primary, deliver, list, unsoldSoon, payToday, payOverdue, in7, in30, overdueSum, openCapital, inbox, tickets };
  }

  function tile(kind, ico, n, label, sub, go) {
    const calm = n === 0;
    return `<button class="today-tile today-${kind}${calm ? ' calm' : ''}" data-go="${go}">
      <span class="today-ico">${icon(ico, 18)}</span>
      <span class="today-n">${n}</span>
      <span class="today-label">${label}</span>
      <span class="today-sub">${sub}</span>
    </button>`;
  }

  function calendar(tickets) {
    const start = d0(new Date());
    const byDay = {};
    tickets.forEach(t => {
      const dd = diffDays(t.eventDate);
      if (dd === null || dd < 0 || dd > 29) return;
      (byDay[t.eventDate.slice(0, 10)] = byDay[t.eventDate.slice(0, 10)] || []).push(t);
    });
    const WD = ['ne', 'po', 'út', 'st', 'čt', 'pá', 'so'];
    let html = '';
    for (let i = 0; i < 30; i++) {
      const d = new Date(start.getTime() + i * DAY);
      const key = isoDay(d);
      const list = byDay[key] || [];
      const needs = list.some(t => st(t) === 'sold') ? 'deliver' : list.some(t => ['available', 'listed'].includes(st(t))) ? 'sell' : list.length ? 'done' : '';
      const names = [...new Set(list.map(t => t.eventName))];
      const tip = names.length ? names.map(n => '• ' + n).join('\n') : '';
      html += `<div class="cal-day${i === 0 ? ' today' : ''}${d.getDay() === 0 || d.getDay() === 6 ? ' weekend' : ''}${needs ? ' has ' + needs : ''}" title="${escapeHtml(tip)}" ${names.length ? `data-cal-search="${escapeHtml(names[0])}"` : ''}>
        <span class="cal-wd">${WD[d.getDay()]}</span><span class="cal-d">${d.getDate()}</span>
        <span class="cal-dots">${list.slice(0, 3).map(t => `<i class="dot ${st(t)}"></i>`).join('')}${list.length > 3 ? '<i class="dot more"></i>' : ''}</span>
      </div>`;
    }
    return html;
  }

  window.renderTodayPanel = function renderTodayPanel() {
    const el = document.getElementById('todayPanel');
    if (!el || typeof state === 'undefined' || !state.db) return;
    const c = compute();
    const money = v => formatMoney(v, c.primary);
    const deliverSub = c.deliver.length ? c.deliver.slice(0, 2).map(t => escapeHtml(t.eventName)).join(', ') + (c.deliver.length > 2 ? '…' : '') : 'nic nečeká';
    const listSub = c.list.length ? 'koupeno, ještě v nabídce není' : 'vše zalistováno';
    const paySub = c.payOverdue.length ? `${c.payOverdue.length} po termínu · ${money(c.overdueSum)}` : c.payToday.length ? 'přijdou dnes' : 'dnes žádné';
    const inboxSub = c.inbox ? 'čeká na kontrolu' : 'vše vyřízeno';
    const greeting = (() => { const h = new Date().getHours(); return h < 10 ? 'Dobré ráno' : h < 18 ? 'Dobrý den' : 'Dobrý večer'; })();
    el.innerHTML = `
      <div class="today-head">
        <div><div class="today-title">${greeting}${state.currentUser && state.currentUser.username ? ', ' + escapeHtml(state.currentUser.username) : ''}</div>
        <div class="today-date">${new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}</div></div>
        <div class="today-cash">
          <div><span>Přijde do 7 dní</span><b>${money(c.in7)}</b></div>
          <div><span>Do 30 dní</span><b>${money(c.in30)}</b></div>
          <div><span>Kapitál ve vstupenkách</span><b>${money(c.openCapital)}</b></div>
        </div>
      </div>
      <div class="today-tiles">
        ${tile('deliver', 'truck', c.deliver.length, 'Doručit', deliverSub, 'todo')}
        ${tile('list', 'tag', c.list.length + c.unsoldSoon.length, 'Zalistovat / prodat', c.unsoldSoon.length ? `${c.unsoldSoon.length} v nabídce, akce do 7 dní` : listSub, 'todo')}
        ${tile('pay', 'euro', c.payToday.length + c.payOverdue.length, 'Výplaty', paySub, 'payouts')}
        ${tile('inbox', 'inbox', c.inbox, 'Příchozí', inboxSub, 'inbox')}
      </div>
      <div class="cal-strip">${calendar(c.tickets)}</div>`;
    el.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.go)));
    el.querySelectorAll('[data-cal-search]').forEach(d => d.addEventListener('click', () => {
      const inp = document.getElementById('filterSearch');
      if (!inp) return;
      inp.value = d.dataset.calSearch;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#view-dashboard .table-wrapper')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };
})();
