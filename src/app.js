// ============ STATE ============
let state = {
  db: { tickets: [], accounts: [], events: [] },
  config: null,
  // Currently logged-in user: { id, username, role }. null until login succeeds.
  // Used to gate admin-only UI (e.g. the Users section in Settings) and to pass
  // callerUserId to auth IPC calls so the backend can verify permissions.
  currentUser: null,
  editingTicket: null,
  sellingTicket: null,
  selectedIds: new Set(),
  selectedPayoutIds: new Set(),
  // Context for the shared Bulk Edit modal: 'tickets' or 'payouts'.
  bulkEditCtx: null,
  sortBy: 'eventDate',
  sortDir: 'desc',
  filters: {
    search: '',
    status: '',
    month: '',
    year: '',
    dateFrom: '',
    dateTo: ''
  },
  // Category filter — applies to BOTH Dashboard and Stats views (synced).
  // Defaults to 'concert' since per user, most existing tickets are concerts;
  // football/other are tagged manually via Edit modal.
  // Values: 'all' | 'football' | 'concert' | 'other'
  dashboardCategory: 'concert',
  statsFilters: {
    month: '',
    year: ''
  },
  membershipFilters: {
    search: '',
    team: '',
    owner: '',
    group: ''
  },
  editingMembership: null,
  selectedMembershipIds: new Set(),
  revealedPasswords: new Set(),
  mailboxFilters: {
    search: ''
  },
  editingMailbox: null,
  selectedMailboxIds: new Set(),
  simcardFilters: {
    search: '',
    operator: '',
    status: ''
  },
  editingSimcard: null,
  selectedSimcardIds: new Set(),
  expenseFilters: {
    search: '',
    type: '',      // '', 'expense', or 'income'
    category: '',
    frequency: '',
    status: ''
  },
  editingExpense: null,
  selectedExpenseIds: new Set(),
  payoutFilters: {
    search: '',
    platform: '',
    status: ''
  },
  payoutRules: [],
  payingOutTicket: null,
  inboxFilters: {
    kind: '',
    platform: ''
  },
  charts: {}
};

// ============ UI PREFERENCES PERSISTENCE ============
// Remember user's sort order, filters, and other UI prefs across restarts
// so the app feels "sticky". Stored in localStorage (survives even DB reset).
// Single key with a versioned schema; on load we merge over defaults so
// adding new preference fields later stays backwards-compatible.
const UI_PREFS_KEY = 'ticketvault.uiPrefs.v1';

function saveUiPrefs() {
  try {
    const prefs = {
      sortBy: state.sortBy,
      sortDir: state.sortDir,
      filters: state.filters,
      dashboardCategory: state.dashboardCategory,
      statsFilters: state.statsFilters,
      membershipFilters: state.membershipFilters,
      mailboxFilters: state.mailboxFilters,
      simcardFilters: state.simcardFilters,
      expenseFilters: state.expenseFilters,
      payoutFilters: state.payoutFilters,
      inboxFilters: state.inboxFilters
    };
    localStorage.setItem(UI_PREFS_KEY, JSON.stringify(prefs));
  } catch (_) { /* localStorage full or disabled — no-op */ }
}

function loadUiPrefs() {
  try {
    const raw = localStorage.getItem(UI_PREFS_KEY);
    if (!raw) return;
    const prefs = JSON.parse(raw);
    if (!prefs || typeof prefs !== 'object') return;

    // Shallow-merge each slice so unknown fields in storage don't clobber defaults,
    // and new fields added in future versions keep their default value.
    if (typeof prefs.sortBy === 'string') state.sortBy = prefs.sortBy;
    if (prefs.sortDir === 'asc' || prefs.sortDir === 'desc') state.sortDir = prefs.sortDir;
    if (prefs.filters) Object.assign(state.filters, prefs.filters);
    if (typeof prefs.dashboardCategory === 'string' &&
        ['all', 'football', 'concert', 'other'].includes(prefs.dashboardCategory)) {
      state.dashboardCategory = prefs.dashboardCategory;
    }
    if (prefs.statsFilters) Object.assign(state.statsFilters, prefs.statsFilters);
    if (prefs.membershipFilters) Object.assign(state.membershipFilters, prefs.membershipFilters);
    if (prefs.mailboxFilters) Object.assign(state.mailboxFilters, prefs.mailboxFilters);
    if (prefs.simcardFilters) Object.assign(state.simcardFilters, prefs.simcardFilters);
    if (prefs.expenseFilters) Object.assign(state.expenseFilters, prefs.expenseFilters);
    if (prefs.payoutFilters) Object.assign(state.payoutFilters, prefs.payoutFilters);
    if (prefs.inboxFilters) Object.assign(state.inboxFilters, prefs.inboxFilters);
  } catch (_) { /* corrupt JSON — ignore and keep defaults */ }
}

// Sync loaded state back to form inputs + sort-header arrows
// so the UI visually matches the restored preferences after a restart.
function applyUiPrefsToUI() {
  // Main inventory filters
  const f = state.filters;
  const set = (id, v) => { const el = $(id); if (el && v != null) el.value = v; };
  set('#filterSearch', f.search);
  set('#filterStatus', f.status);
  set('#filterMonth', f.month);
  set('#filterYear', f.year);
  set('#filterDateFrom', f.dateFrom);
  set('#filterDateTo', f.dateTo);

  // Inventory sort arrow indicator
  $$('.tickets-table th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
  const sortedTh = document.querySelector(`.tickets-table th[data-sort="${state.sortBy}"]`);
  if (sortedTh) sortedTh.classList.add('sorted-' + state.sortDir);

  // Inbox filters
  const i = state.inboxFilters;
  set('#iFilterKind', i.kind);
  set('#iFilterPlatform', i.platform);

  // Expense filters
  const e = state.expenseFilters;
  set('#eFilterSearch', e.search);
  set('#eFilterType', e.type);
  set('#eFilterCategory', e.category);
  set('#eFilterFrequency', e.frequency);
  set('#eFilterStatus', e.status);

  // Payout filters
  const p = state.payoutFilters;
  set('#pFilterSearch', p.search);
  set('#pFilterPlatform', p.platform);
  set('#pFilterStatus', p.status);

  // Membership filters
  const m = state.membershipFilters;
  set('#mFilterSearch', m.search);
  set('#mFilterTeam', m.team);
  set('#mFilterOwner', m.owner);
  set('#mFilterGroup', m.group);

  // Mailbox filters
  const mb = state.mailboxFilters;
  set('#mbFilterSearch', mb.search);

  // SIM card filters
  const sc = state.simcardFilters;
  set('#scFilterSearch', sc.search);
  set('#scFilterOperator', sc.operator);
  set('#scFilterStatus', sc.status);

  // Sync the category chip toggle (Dashboard + Stats)
  syncCategoryToggleUI();
}

// Mark the chip matching state.dashboardCategory as `.active` in BOTH toggles
// (#categoryToggle on Dashboard, #categoryToggleStats on Stats). Called whenever
// the category changes so the two views stay visually in sync. Also handles
// the 'selected' chip: shows it only when there's an active multi-selection,
// updates its count badge, and auto-deactivates the filter when selection
// is cleared (otherwise we'd show an empty filtered view).
function syncCategoryToggleUI() {
  const selCount = state.selectedIds.size;
  // Auto-fallback: if 'selected' is the active filter but selection is now
  // empty (e.g. user deselected all rows), drop back to 'all' so the user
  // doesn't end up staring at an empty dashboard.
  if (state.dashboardCategory === 'selected' && selCount === 0) {
    state.dashboardCategory = 'all';
    if (typeof saveUiPrefs === 'function') saveUiPrefs();
  }
  ['#categoryToggle', '#categoryToggleStats'].forEach(sel => {
    const container = $(sel);
    if (!container) return;
    container.querySelectorAll('.cat-chip').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.cat === state.dashboardCategory);
    });
    // Show/hide the 'selected' chip + update count badge.
    const selChip = container.querySelector('.cat-chip[data-cat="selected"]');
    if (selChip) {
      selChip.style.display = selCount > 0 ? '' : 'none';
      const countEl = selChip.querySelector('[data-cat-count]');
      if (countEl) countEl.textContent = selCount;
    }
  });
}

// ============ UTILS ============
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ============ CURRENCIES ============
// Supported currencies — code, symbol, and a sensible locale for formatting.
// The locale drives decimal/thousands separators; all currencies display 2
// fraction digits (no special-case for JPY since we focus on 10 main ones).
// Codes must match what exchangerate-api.com returns (ISO 4217).
const CURRENCIES = [
  { code: 'EUR', symbol: '€',  name: 'Euro',                locale: 'cs-CZ' },
  { code: 'CZK', symbol: 'Kč', name: 'Česká koruna',        locale: 'cs-CZ' },
  { code: 'USD', symbol: '$',  name: 'US dolar',            locale: 'en-US' },
  { code: 'GBP', symbol: '£',  name: 'Britská libra',       locale: 'en-GB' },
  { code: 'CHF', symbol: 'Fr', name: 'Švýcarský frank',     locale: 'de-CH' },
  { code: 'PLN', symbol: 'zł', name: 'Polský zlotý',        locale: 'pl-PL' },
  { code: 'HUF', symbol: 'Ft', name: 'Maďarský forint',     locale: 'hu-HU' },
  { code: 'SEK', symbol: 'kr', name: 'Švédská koruna',      locale: 'sv-SE' },
  { code: 'NOK', symbol: 'kr', name: 'Norská koruna',       locale: 'nb-NO' },
  { code: 'DKK', symbol: 'kr', name: 'Dánská koruna',       locale: 'da-DK' },
  { code: 'CAD', symbol: 'CA$',name: 'Kanadský dolar',      locale: 'en-CA' },
  { code: 'AUD', symbol: 'A$', name: 'Australský dolar',    locale: 'en-AU' },
  { code: 'JPY', symbol: '¥',  name: 'Japonský jen',        locale: 'ja-JP' },
  { code: 'MXN', symbol: 'MX$',name: 'Mexické peso',        locale: 'es-MX' },
  { code: 'BRL', symbol: 'R$', name: 'Brazilský real',      locale: 'pt-BR' },
  { code: 'ZAR', symbol: 'R',  name: 'Jihoafrický rand',    locale: 'en-ZA' },
  { code: 'AED', symbol: 'AED',name: 'Dirham SAE',          locale: 'ar-AE' },
  { code: 'SGD', symbol: 'S$', name: 'Singapurský dolar',   locale: 'en-SG' },
  { code: 'NZD', symbol: 'NZ$',name: 'Novozélandský dolar', locale: 'en-NZ' },
  { code: 'TRY', symbol: '₺',  name: 'Turecká lira',        locale: 'tr-TR' },
];

const CURRENCY_BY_CODE = Object.fromEntries(CURRENCIES.map(c => [c.code, c]));

// Return the user-selected primary currency (the one shown in dashboard stats
// after all conversions). Falls back to EUR if not set.
function getPrimaryCurrency() {
  return (state.config?.primaryCurrency) || 'EUR';
}

// Return the user's default currency for new tickets (separate from primary —
// e.g. primary=EUR for stats, but you mostly buy in GBP so default=GBP).
function getDefaultTicketCurrency() {
  return (state.config?.defaultTicketCurrency) || getPrimaryCurrency();
}

// Current exchange rates keyed by currency code, normalized to EUR=1.
// Shape: { EUR: 1, CZK: 24.5, USD: 1.08, ..., _updated: "ISO-date" }
// Lives in state.config.exchangeRates. Refreshed daily from exchangerate-api.com.
function getExchangeRates() {
  return state.config?.exchangeRates || { EUR: 1 };
}

// Convert an amount from currency A to currency B using stored rates.
// Both legs route through EUR since rates are EUR-denominated.
// If either currency is missing from the rate table, returns the original amount
// (fail-open — better to show something wrong than crash the dashboard).
function convertCurrency(amount, fromCode, toCode) {
  if (!amount || fromCode === toCode) return amount;
  const rates = getExchangeRates();
  const fromRate = rates[fromCode];
  const toRate = rates[toCode];
  if (!fromRate || !toRate) return amount;
  // amount_in_EUR = amount / fromRate (because rates[X] means 1 EUR = X units of X)
  // amount_in_TO  = amount_in_EUR * toRate
  return (amount / fromRate) * toRate;
}

// Format a money value with explicit currency code. If currency is omitted,
// uses the ticket's or primary. Returns "1 234,56 EUR" in cs-CZ locale, or
// "$1,234.56" in en-US for USD. Symbol placement follows locale conventions.
function formatMoney(n, currencyCode) {
  const num = Number(n) || 0;
  const code = currencyCode || getPrimaryCurrency();
  const meta = CURRENCY_BY_CODE[code];
  if (!meta) {
    return num.toLocaleString('cs-CZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + code;
  }
  try {
    return num.toLocaleString(meta.locale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  } catch {
    // Fallback if Intl doesn't know the currency (rare on old browsers).
    return num.toLocaleString(meta.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + code;
  }
}

// Convert + format in one call, shown in the primary currency. Uses the
// ticket's own currency as source. Most display code should use this.
function formatMoneyInPrimary(n, sourceCode) {
  const primary = getPrimaryCurrency();
  const from = sourceCode || primary;
  const converted = convertCurrency(Number(n) || 0, from, primary);
  return formatMoney(converted, primary);
}

// Return the currency code stored on a ticket, falling back to primary.
// Older tickets imported before the currency system exists have no `currency`
// field — we treat those as being in primary currency (backwards-compat).
function ticketCurrency(t) {
  return (t && t.currency) || getPrimaryCurrency();
}

function formatInt(n) {
  return (Number(n) || 0).toString();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}.${mm}.${yyyy}`;
  } catch (e) {
    return dateStr;
  }
}

// ---- Price calculations ----
// These return amounts in the TICKET's native currency (raw values from the
// ticket itself). They're the right choice for per-row display where you want
// to show the amount in its original currency next to the currency code.
//
// For aggregation (totals across many tickets in mixed currencies), use the
// *InPrimary variants below — those convert everything to the dashboard's
// primary currency via today's exchange rates.

// Helper — currency in which the SALE is denominated. Falls back to the
// ticket's main currency (which is purchase currency by convention).
function saleCurrency(t) {
  return (t && t.saleCurrency) || ticketCurrency(t);
}

function calcProfit(t) {
  if (t.status !== 'sold' && t.status !== 'delivered') return 0;
  const qty = Number(t.quantity) || 1;
  const sale = Number(t.salePrice) || 0;
  const purchase = Number(t.purchasePrice) || 0;
  // salePrice a purchasePrice jsou za 1 kus - násobíme počtem kusů
  // If sale and purchase are in different currencies, normalize sale to
  // the purchase currency before subtracting (returns profit in PURCHASE ccy).
  const purchaseCcy = ticketCurrency(t);
  const saleCcy = saleCurrency(t);
  const saleInPurchaseCcy = saleCcy === purchaseCcy
    ? sale
    : convertCurrency(sale, saleCcy, purchaseCcy);
  return (saleInPurchaseCcy - purchase) * qty;
}

function calcRoi(t) {
  if ((t.status !== 'sold' && t.status !== 'delivered') || !t.purchasePrice) return 0;
  const qty = Number(t.quantity) || 1;
  const totalCost = (Number(t.purchasePrice) || 0) * qty;
  if (totalCost <= 0) return 0;
  // ROI is a ratio, so currency cancels out — calcProfit is already in purchase ccy.
  return (calcProfit(t) / totalCost) * 100;
}

// Total revenue for one ticket row (sale price × quantity), in SALE currency.
function calcRevenue(t) {
  if (t.status !== 'sold' && t.status !== 'delivered') return 0;
  return (Number(t.salePrice) || 0) * (Number(t.quantity) || 1);
}

// Total cost for one ticket row (purchase × quantity), in PURCHASE currency.
function calcCost(t) {
  return (Number(t.purchasePrice) || 0) * (Number(t.quantity) || 1);
}

// Primary-currency variants — used when summing across tickets whose currencies
// may differ. Each ticket's amount is converted via today's exchange rate.
// Sale amounts use saleCurrency (which may differ from purchaseCurrency).
function calcProfitInPrimary(t) {
  // calcProfit returns in PURCHASE currency, so convert from there.
  return convertCurrency(calcProfit(t), ticketCurrency(t), getPrimaryCurrency());
}
function calcRevenueInPrimary(t) {
  return convertCurrency(calcRevenue(t), saleCurrency(t), getPrimaryCurrency());
}
function calcCostInPrimary(t) {
  return convertCurrency(calcCost(t), ticketCurrency(t), getPrimaryCurrency());
}

function toast(message, type = 'info', duration = 3000) {
  const container = $('#toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ';
  el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('fade-out');
    setTimeout(() => el.remove(), 250);
  }, duration);
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getEventInitials(name) {
  if (!name) return '?';
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return name.substring(0, 2).toUpperCase();
}

// ============ COUNTRIES ============
// All 195 UN-recognized countries + a few dependent territories relevant
// to the ticketing market (Hong Kong, Macau, Puerto Rico, Gibraltar).
// Tuple: [canonical Czech name, English name, ?optional Czech aliases separated by "/"].
// The datalist option shows "Czech / aliases (English)" so users can find a country
// by typing any common name — e.g. "Velká" matches "Spojené království" because
// "Velká Británie" is listed as an alias. The stored value is always the canonical
// Czech name (first element) for data consistency.
const COUNTRIES = [
  ['Afghánistán', 'Afghanistan'], ['Albánie', 'Albania'], ['Alžírsko', 'Algeria'],
  ['Andorra', 'Andorra'], ['Angola', 'Angola'], ['Antigua a Barbuda', 'Antigua and Barbuda'],
  ['Argentina', 'Argentina'], ['Arménie', 'Armenia'], ['Austrálie', 'Australia'],
  ['Ázerbájdžán', 'Azerbaijan'], ['Bahamy', 'Bahamas'], ['Bahrajn', 'Bahrain'],
  ['Bangladéš', 'Bangladesh'], ['Barbados', 'Barbados'], ['Belgie', 'Belgium'],
  ['Belize', 'Belize'], ['Bělorusko', 'Belarus'], ['Benin', 'Benin'],
  ['Bhútán', 'Bhutan'], ['Bolívie', 'Bolivia'], ['Bosna a Hercegovina', 'Bosnia and Herzegovina'],
  ['Botswana', 'Botswana'], ['Brazílie', 'Brazil'], ['Brunej', 'Brunei'],
  ['Bulharsko', 'Bulgaria'], ['Burkina Faso', 'Burkina Faso'], ['Burundi', 'Burundi'],
  ['Cookovy ostrovy', 'Cook Islands'], ['Čad', 'Chad'], ['Černá Hora', 'Montenegro'],
  ['Česko', 'Czech Republic', 'Česká republika / ČR'], ['Čína', 'China'], ['Dánsko', 'Denmark'],
  ['Dominika', 'Dominica'], ['Dominikánská republika', 'Dominican Republic'],
  ['Džibutsko', 'Djibouti'], ['Egypt', 'Egypt'], ['Ekvádor', 'Ecuador'],
  ['Eritrea', 'Eritrea'], ['Estonsko', 'Estonia'], ['Etiopie', 'Ethiopia'],
  ['Eswatini', 'Eswatini', 'Svazijsko'], ['Fidži', 'Fiji'], ['Filipíny', 'Philippines'],
  ['Finsko', 'Finland'], ['Francie', 'France'], ['Gabon', 'Gabon'],
  ['Gambie', 'Gambia'], ['Ghana', 'Ghana'], ['Gibraltar', 'Gibraltar'],
  ['Grenada', 'Grenada'], ['Gruzie', 'Georgia'], ['Guatemala', 'Guatemala'],
  ['Guinea', 'Guinea'], ['Guinea-Bissau', 'Guinea-Bissau'], ['Guyana', 'Guyana'],
  ['Haiti', 'Haiti'], ['Honduras', 'Honduras'], ['Hongkong', 'Hong Kong'],
  ['Chile', 'Chile'], ['Chorvatsko', 'Croatia'], ['Indie', 'India'],
  ['Indonésie', 'Indonesia'], ['Irák', 'Iraq'], ['Írán', 'Iran'],
  ['Irsko', 'Ireland'], ['Island', 'Iceland'], ['Itálie', 'Italy'],
  ['Izrael', 'Israel'], ['Jamajka', 'Jamaica'], ['Japonsko', 'Japan'],
  ['Jemen', 'Yemen'], ['Jihoafrická republika', 'South Africa', 'JAR'], ['Jižní Korea', 'South Korea', 'Korea'],
  ['Jižní Súdán', 'South Sudan'], ['Jordánsko', 'Jordan'], ['Kambodža', 'Cambodia'],
  ['Kamerun', 'Cameroon'], ['Kanada', 'Canada'], ['Kapverdy', 'Cape Verde'],
  ['Katar', 'Qatar'], ['Kazachstán', 'Kazakhstan'], ['Keňa', 'Kenya'],
  ['Kiribati', 'Kiribati'], ['Kolumbie', 'Colombia'], ['Komory', 'Comoros'],
  ['Kongo', 'Congo'], ['Konžská demokratická republika', 'DR Congo', 'DR Kongo'],
  ['Kosovo', 'Kosovo'], ['Kostarika', 'Costa Rica'], ['Kuba', 'Cuba'],
  ['Kuvajt', 'Kuwait'], ['Kypr', 'Cyprus'], ['Kyrgyzstán', 'Kyrgyzstan'],
  ['Laos', 'Laos'], ['Lesotho', 'Lesotho'], ['Libanon', 'Lebanon'],
  ['Libérie', 'Liberia'], ['Libye', 'Libya'], ['Lichtenštejnsko', 'Liechtenstein'],
  ['Litva', 'Lithuania'], ['Lotyšsko', 'Latvia'], ['Lucembursko', 'Luxembourg'],
  ['Macao', 'Macau'], ['Madagaskar', 'Madagascar'], ['Maďarsko', 'Hungary'],
  ['Malajsie', 'Malaysia'], ['Malawi', 'Malawi'], ['Maledivy', 'Maldives'],
  ['Mali', 'Mali'], ['Malta', 'Malta'], ['Maroko', 'Morocco'],
  ['Marshallovy ostrovy', 'Marshall Islands'], ['Mauricius', 'Mauritius'],
  ['Mauritánie', 'Mauritania'], ['Mexiko', 'Mexico'], ['Mikronésie', 'Micronesia'],
  ['Moldavsko', 'Moldova'], ['Monako', 'Monaco'], ['Mongolsko', 'Mongolia'],
  ['Mosambik', 'Mozambique'], ['Myanmar', 'Myanmar', 'Barma'], ['Namibie', 'Namibia'],
  ['Nauru', 'Nauru'], ['Německo', 'Germany'], ['Nepál', 'Nepal'],
  ['Niger', 'Niger'], ['Nigérie', 'Nigeria'], ['Nikaragua', 'Nicaragua'],
  ['Niue', 'Niue'], ['Nizozemsko', 'Netherlands', 'Holandsko'], ['Norsko', 'Norway'],
  ['Nový Zéland', 'New Zealand'], ['Omán', 'Oman'], ['Pákistán', 'Pakistan'],
  ['Palau', 'Palau'], ['Palestina', 'Palestine'], ['Panama', 'Panama'],
  ['Papua-Nová Guinea', 'Papua New Guinea'], ['Paraguay', 'Paraguay'],
  ['Peru', 'Peru'], ['Pobřeží slonoviny', 'Ivory Coast'], ['Polsko', 'Poland'],
  ['Portoriko', 'Puerto Rico'], ['Portugalsko', 'Portugal'], ['Rakousko', 'Austria'],
  ['Rovníková Guinea', 'Equatorial Guinea'], ['Rumunsko', 'Romania'], ['Rusko', 'Russia', 'Ruská federace'],
  ['Rwanda', 'Rwanda'], ['Řecko', 'Greece'], ['Salvador', 'El Salvador'],
  ['Samoa', 'Samoa'], ['San Marino', 'San Marino'], ['Saúdská Arábie', 'Saudi Arabia'],
  ['Senegal', 'Senegal'], ['Severní Korea', 'North Korea'], ['Severní Makedonie', 'North Macedonia', 'Makedonie'],
  ['Seychely', 'Seychelles'], ['Sierra Leone', 'Sierra Leone'], ['Singapur', 'Singapore'],
  ['Slovensko', 'Slovakia'], ['Slovinsko', 'Slovenia'], ['Somálsko', 'Somalia'],
  ['Spojené arabské emiráty', 'United Arab Emirates', 'SAE / Emiráty'],
  ['Spojené království', 'United Kingdom', 'Velká Británie / Británie / Anglie / UK'],
  ['Spojené státy americké', 'United States', 'USA / Amerika / Spojené státy'],
  ['Srbsko', 'Serbia'],
  ['Středoafrická republika', 'Central African Republic'], ['Súdán', 'Sudan'],
  ['Surinam', 'Suriname'], ['Svatá Lucie', 'Saint Lucia'],
  ['Svatý Kryštof a Nevis', 'Saint Kitts and Nevis'],
  ['Svatý Tomáš a Princův ostrov', 'São Tomé and Príncipe'],
  ['Svatý Vincenc a Grenadiny', 'Saint Vincent and the Grenadines'],
  ['Sýrie', 'Syria'], ['Šalamounovy ostrovy', 'Solomon Islands'],
  ['Španělsko', 'Spain'], ['Šrí Lanka', 'Sri Lanka'], ['Švédsko', 'Sweden'],
  ['Švýcarsko', 'Switzerland'], ['Tádžikistán', 'Tajikistan'], ['Tanzanie', 'Tanzania'],
  ['Thajsko', 'Thailand'], ['Tchaj-wan', 'Taiwan', 'Taiwan'], ['Togo', 'Togo'],
  ['Tonga', 'Tonga'], ['Trinidad a Tobago', 'Trinidad and Tobago'],
  ['Tunisko', 'Tunisia'], ['Turecko', 'Turkey'], ['Turkmenistán', 'Turkmenistan'],
  ['Tuvalu', 'Tuvalu'], ['Uganda', 'Uganda'], ['Ukrajina', 'Ukraine'],
  ['Uruguay', 'Uruguay'], ['Uzbekistán', 'Uzbekistan'], ['Vanuatu', 'Vanuatu'],
  ['Vatikán', 'Vatican City'], ['Venezuela', 'Venezuela'], ['Vietnam', 'Vietnam'],
  ['Východní Timor', 'Timor-Leste'], ['Zambie', 'Zambia'], ['Zimbabwe', 'Zimbabwe']
];

// Country → ISO-3166-1 alpha-2 code map for flag emoji rendering. Keys cover
// both Czech canonical names and common English variants stored historically
// (e.g. early imports from Stubhub/Viagogo before country normalization).
// Lookup is case/diacritic-insensitive via normalizeCountryKey().
const COUNTRY_TO_ISO = {
  // Europe — events Michal handles most often live here
  'velkabritanie': 'gb', 'velkábritánie': 'gb', 'spojenekralovstvi': 'gb', 'spojenékrálovství': 'gb', 'unitedkingdom': 'gb', 'uk': 'gb', 'england': 'gb', 'anglie': 'gb', 'scotland': 'gb', 'skotsko': 'gb', 'wales': 'gb',
  'cesko': 'cz', 'česko': 'cz', 'ceskarepublika': 'cz', 'českárepublika': 'cz', 'czechrepublic': 'cz', 'czechia': 'cz',
  'slovensko': 'sk', 'slovakia': 'sk',
  'polsko': 'pl', 'poland': 'pl',
  'nemecko': 'de', 'německo': 'de', 'germany': 'de',
  'francie': 'fr', 'france': 'fr',
  'spanelsko': 'es', 'španělsko': 'es', 'spain': 'es',
  'italie': 'it', 'itálie': 'it', 'italy': 'it',
  'portugalsko': 'pt', 'portugal': 'pt',
  'rakousko': 'at', 'austria': 'at',
  'nizozemsko': 'nl', 'netherlands': 'nl', 'holland': 'nl',
  'belgie': 'be', 'belgium': 'be',
  'svycarsko': 'ch', 'švýcarsko': 'ch', 'switzerland': 'ch',
  'irsko': 'ie', 'ireland': 'ie',
  'dansko': 'dk', 'dánsko': 'dk', 'denmark': 'dk',
  'svedsko': 'se', 'švédsko': 'se', 'sweden': 'se',
  'norsko': 'no', 'norway': 'no',
  'finsko': 'fi', 'finland': 'fi',
  'recko': 'gr', 'řecko': 'gr', 'greece': 'gr',
  'madarsko': 'hu', 'maďarsko': 'hu', 'hungary': 'hu',
  'rumunsko': 'ro', 'romania': 'ro',
  'bulharsko': 'bg', 'bulgaria': 'bg',
  'chorvatsko': 'hr', 'croatia': 'hr',
  'slovinsko': 'si', 'slovenia': 'si',
  'srbsko': 'rs', 'serbia': 'rs',
  'turecko': 'tr', 'turkey': 'tr',
  'ukrajina': 'ua', 'ukraine': 'ua',
  'rusko': 'ru', 'russia': 'ru',
  // Americas
  'usa': 'us', 'spojenestaty': 'us', 'spojenéstáty': 'us', 'unitedstates': 'us', 'unitedstatesofamerica': 'us', 'amerika': 'us',
  'kanada': 'ca', 'canada': 'ca',
  'mexiko': 'mx', 'mexico': 'mx',
  'brazilie': 'br', 'brazílie': 'br', 'brazil': 'br',
  'argentina': 'ar',
  // Asia / Middle East / Oceania
  'japonsko': 'jp', 'japan': 'jp',
  'cina': 'cn', 'čína': 'cn', 'china': 'cn',
  'jiznikorea': 'kr', 'jižníkorea': 'kr', 'korea': 'kr', 'southkorea': 'kr',
  'thajsko': 'th', 'thailand': 'th',
  'singapur': 'sg', 'singapore': 'sg',
  'vietnam': 'vn',
  'indie': 'in', 'india': 'in',
  'australie': 'au', 'austrálie': 'au', 'australia': 'au',
  'novyzeland': 'nz', 'novýzéland': 'nz', 'newzealand': 'nz',
  'spojeneArabskeemiraty': 'ae', 'spojenéarabskéemiráty': 'ae', 'uae': 'ae', 'unitedarabemirates': 'ae',
  'sauasdkaarabie': 'sa', 'saudskaarabie': 'sa', 'saudskáarábie': 'sa', 'saudiarabia': 'sa',
  'katar': 'qa', 'qatar': 'qa',
  // Africa
  'jihoafrickarepublika': 'za', 'jihoafrickárepublika': 'za', 'jar': 'za', 'southafrica': 'za',
  'maroko': 'ma', 'morocco': 'ma',
  'egypt': 'eg'
};

// Normalize a country string for ISO lookup: lowercase + strip diacritics + remove spaces/hyphens.
// "Spojené království" → "spojenekralovstvi", "United Kingdom" → "unitedkingdom".
function normalizeCountryKey(s) {
  if (!s) return '';
  return s.toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[\s\-_().,]/g, '');
}

// Public helper — given a country name in any common form, return its uppercase
// ISO-3166-1 alpha-2 code ("GB", "CZ", "US"...) or empty string if unknown.
// Used in the tickets table country column. Switched from emoji flags to ISO
// codes in 1.15.3 because Windows often renders flag emoji as letter-pair
// fallback (no flag glyph in Segoe UI Emoji), which looked worse than just
// showing the code intentionally.
function getCountryIso(country) {
  const iso = COUNTRY_TO_ISO[normalizeCountryKey(country)];
  return iso ? iso.toUpperCase() : '';
}

// Populate the #countryList datalist once the DOM is ready.
// option value = canonical Czech name (what gets stored)
// option text  = "Czech / alias1 / alias2 (English)" — datalist matches typed
// characters against both the value AND the visible text, so typing an alias
// still surfaces the option. On selection, the input receives the canonical value.
function populateCountryDatalist() {
  const dl = $('#countryList');
  if (!dl) return;
  const sorted = [...COUNTRIES].sort((a, b) => a[0].localeCompare(b[0], 'cs'));
  dl.innerHTML = sorted.map(([cs, en, aliases]) => {
    const labelParts = [cs];
    if (aliases) labelParts.push(aliases);
    const label = labelParts.join(' / ') + ' (' + en + ')';
    return `<option value="${escapeHtml(cs)}">${escapeHtml(label)}</option>`;
  }).join('');
}

// ============ LOAD DATA ============
async function init() {
  // Load saved UI preferences (sort, filters) before the first render
  // so the initial view reflects user's last state.
  loadUiPrefs();

  populateCountryDatalist();

  // AUTH GATE — check if we have a valid token. Backend-based auth:
  //   - no token / invalid token → show login tab (default)
  //   - valid token → skip login, go straight into app
  setupAuthUI();
  const authState = await window.api.authGetState();
  prefillAuthApiUrls(authState.apiUrl);
  if (authState.me) {
    // Already authenticated — token verified by backend.
    state.currentUser = authState.me;
    hideAuthOverlay();
    await proceedAfterLogin();
    return;
  }
  // Show login tab by default. User can switch to register tab for first-run
  // or new-device registration. There's no separate "setup" flow — the first
  // user to register on a fresh backend automatically becomes admin.
  showAuthTab('login');
}

// Called from the login/setup flow once state.currentUser is populated.
// Loads the DB, wires up listeners, and renders the main app.
async function proceedAfterLogin() {
  // Unlock the UI visually (main .app is .app-locked during auth).
  $('.app')?.classList.remove('app-locked');
  // Show the user chip in sidebar.
  updateSidebarUser();

  state.config = await window.api.getConfig();
  // Refresh exchange rates once per day. Skipped silently if fresh (<24h) or
  // if network is down — the app works fine with stale rates. When we do
  // successfully pull new rates, re-render stats and the ticket table so
  // converted amounts reflect today's rates.
  window.api.autoRefreshExchangeRates().then(async (r) => {
    if (r && r.success && !r.skipped) {
      state.config = await window.api.getConfig();
      if (state.db) {
        renderStats();
        renderTickets();
      }
    }
  }).catch(() => { /* non-fatal */ });
  await refreshDb();
  state.payoutRules = await window.api.getPayoutRules();
  setupEventListeners();
  setupAlertSettingsListeners();
  setupExternalIdsUI();
  setupBuyerSectionUI();
  updateDbPathDisplay();
  await loadCloudSettings();
  loadAlertSettings();
  startClock();

  // After listeners are attached and DOM is ready, sync loaded UI prefs
  // to form inputs and sort indicators. Then re-render with the restored state.
  applyUiPrefsToUI();
  render();
  // Show urgent SIM count in sidebar from the start, even before user opens the tab.
  if (typeof updateSimBadge === 'function') updateSimBadge();
  
  // Menu listeners
  window.api.onMenuAction((action) => {
    if (action === 'export-db') exportBackup();
    if (action === 'import-db') importBackup();
    if (action === 'settings') switchView('settings');
  });
  
  // Check for upcoming expense payments (3 days warning)
  setTimeout(() => {
    checkUpcomingExpenses();
    checkUpcomingPayouts();
    checkUpcomingTickets();
  }, 1500);
  
  // Auto-sync inbox every 60 seconds when window is visible and cloud is enabled.
  // This picks up emails forwarded to CloudMailin without needing a manual refresh.
  setInterval(silentRefreshInbox, 60000);
}

// ============ AUTH UI (backend-based) ============
// Auth is proxied through main.js to the backend. This module handles:
//   - Login tab (username + password + backend URL)
//   - Register tab (same + invite code + confirm)
//   - Recover screen (admin-only, uses 6-digit recovery code)
//   - Recovery code display (shown once after admin register/recover)
// After successful login/register, the backend's token is stored in the
// cloud config (via main.js) and all existing cloud sync uses it automatically.

// Pre-fill backend URL fields from saved config so user doesn't re-type it.
// Falls back to the known Michal-hosted backend so new installs Just Work.
const DEFAULT_API_URL = 'https://super-faun-e1d664.netlify.app/api';

function prefillAuthApiUrls(savedUrl) {
  const url = savedUrl || DEFAULT_API_URL;
  ['authLoginApiUrl', 'authRegApiUrl', 'authRecApiUrl'].forEach(id => {
    const el = $('#' + id);
    if (el) el.value = url;
  });
}

function setupAuthUI() {
  // Tab switching
  $$('.auth-tab').forEach(tab => {
    tab.addEventListener('click', () => showAuthTab(tab.dataset.authTab));
  });

  // LOGIN
  $('#btnAuthLogin')?.addEventListener('click', handleLoginSubmit);
  ['authLoginUsername', 'authLoginPassword'].forEach(id => {
    $('#' + id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleLoginSubmit(); }
    });
  });
  $('#btnAuthForgot')?.addEventListener('click', () => showAuthScreen('recover'));

  // REGISTER
  $('#btnAuthRegister')?.addEventListener('click', handleRegisterSubmit);
  ['authRegUsername', 'authRegPassword', 'authRegPassword2', 'authRegInvite'].forEach(id => {
    $('#' + id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleRegisterSubmit(); }
    });
  });

  // RECOVER
  $('#btnAuthRecover')?.addEventListener('click', handleRecoverSubmit);
  ['authRecoverUsername', 'authRecoverCode', 'authRecoverPassword'].forEach(id => {
    $('#' + id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); handleRecoverSubmit(); }
    });
  });
  $('#btnAuthBackToLogin')?.addEventListener('click', () => {
    showAuthScreen('login');
    showAuthTab('login');
  });

  // RECOVERY CODE display — user must check the confirmation box to proceed.
  const confirmCheckbox = $('#authRecoveryConfirmed');
  const confirmBtn = $('#btnAuthRecoveryDone');
  confirmCheckbox?.addEventListener('change', () => {
    confirmBtn.disabled = !confirmCheckbox.checked;
  });
  confirmBtn?.addEventListener('click', async () => {
    hideAuthOverlay();
    await proceedAfterLogin();
  });

  // Sidebar logout
  $('#btnLogout')?.addEventListener('click', handleLogout);
}

// Switch between login and register tabs (recover/recoveryCode screens hide tabs).
function showAuthTab(tab) {
  const overlay = $('#authOverlay');
  if (overlay) overlay.classList.remove('hidden');
  // Hide all screens, show only the one tied to this tab.
  ['Login', 'Register', 'Recover', 'RecoveryCode'].forEach(s => {
    const el = $('#authScreen' + s);
    if (el) el.style.display = 'none';
  });
  if (tab === 'login') $('#authScreenLogin').style.display = 'block';
  else if (tab === 'register') $('#authScreenRegister').style.display = 'block';
  // Tab visual state
  $$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.authTab === tab));
  $('#authTabs')?.classList.remove('hidden');
  // Clear error texts on tab switch
  ['authLoginError', 'authRegError'].forEach(id => {
    const e = $('#' + id); if (e) e.textContent = '';
  });
  setTimeout(() => {
    const firstInput = tab === 'login'
      ? $('#authLoginUsername')
      : $('#authRegUsername');
    firstInput?.focus();
  }, 50);
}

// Show a screen that's NOT login/register (recover / recoveryCode). Hides tabs.
function showAuthScreen(kind) {
  const overlay = $('#authOverlay');
  if (overlay) overlay.classList.remove('hidden');
  ['Login', 'Register', 'Recover', 'RecoveryCode'].forEach(s => {
    const el = $('#authScreen' + s);
    if (el) el.style.display = 'none';
  });
  const targetId = '#authScreen' + kind.charAt(0).toUpperCase() + kind.slice(1);
  const el = $(targetId);
  if (el) el.style.display = 'block';
  $('#authTabs')?.classList.add('hidden');
  ['authRecoverError'].forEach(id => {
    const e = $('#' + id); if (e) e.textContent = '';
  });
  setTimeout(() => {
    const firstInput = el?.querySelector('input[type="text"], input[type="password"]');
    firstInput?.focus();
  }, 50);
}

function hideAuthOverlay() {
  const overlay = $('#authOverlay');
  if (overlay) overlay.classList.add('hidden');
}

async function handleLoginSubmit() {
  const apiUrl = $('#authLoginApiUrl').value.trim();
  const username = $('#authLoginUsername').value.trim();
  const password = $('#authLoginPassword').value;
  const err = $('#authLoginError');
  if (!apiUrl || !username || !password) {
    err.textContent = 'Vyplň všechna pole.';
    return;
  }
  const btn = $('#btnAuthLogin');
  btn.disabled = true;
  btn.textContent = 'Přihlašuji...';
  try {
    const result = await window.api.authLogin({ apiUrl, username, password });
    if (!result.success) {
      err.textContent = result.error || 'Přihlášení se nezdařilo.';
      $('#authLoginPassword').value = '';
      $('#authLoginPassword').focus();
      return;
    }
    state.currentUser = result.user;
    hideAuthOverlay();
    await proceedAfterLogin();
  } catch (e) {
    err.textContent = 'Chyba: ' + (e?.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Přihlásit';
  }
}

async function handleRegisterSubmit() {
  const apiUrl = $('#authRegApiUrl').value.trim();
  const inviteCode = $('#authRegInvite').value.trim();
  const username = $('#authRegUsername').value.trim();
  const password = $('#authRegPassword').value;
  const password2 = $('#authRegPassword2').value;
  const err = $('#authRegError');

  if (!apiUrl || !username || !password) {
    err.textContent = 'Vyplň backend URL, jméno a heslo.';
    return;
  }
  if (password.length < 6) { err.textContent = 'Heslo musí mít aspoň 6 znaků.'; return; }
  if (password !== password2) { err.textContent = 'Hesla se neshodují.'; return; }

  const btn = $('#btnAuthRegister');
  btn.disabled = true;
  btn.textContent = 'Vytvářím...';
  try {
    const result = await window.api.authRegister({
      apiUrl, username, password, inviteCode
    });
    if (!result.success) {
      err.textContent = result.error || 'Nepodařilo se vytvořit účet.';
      return;
    }
    state.currentUser = result.user;
    // Only admins (first user) get a recovery code — show the display screen.
    // Regular users skip the code and go straight into the app.
    if (result.recoveryCode) {
      $('#authRecoveryCodeDisplay').textContent = result.recoveryCode;
      $('#authRecoveryConfirmed').checked = false;
      $('#btnAuthRecoveryDone').disabled = true;
      showAuthScreen('recoveryCode');
    } else {
      hideAuthOverlay();
      await proceedAfterLogin();
    }
  } catch (e) {
    err.textContent = 'Chyba: ' + (e?.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Vytvořit účet';
  }
}

async function handleRecoverSubmit() {
  const apiUrl = $('#authRecApiUrl').value.trim();
  const username = $('#authRecoverUsername').value.trim();
  const code = $('#authRecoverCode').value.trim();
  const newPassword = $('#authRecoverPassword').value;
  const err = $('#authRecoverError');

  if (!apiUrl || !username || !code || !newPassword) {
    err.textContent = 'Vyplň všechna pole.';
    return;
  }
  if (newPassword.length < 6) {
    err.textContent = 'Nové heslo musí mít aspoň 6 znaků.';
    return;
  }

  const btn = $('#btnAuthRecover');
  btn.disabled = true;
  btn.textContent = 'Obnovuji...';
  try {
    const result = await window.api.authRecover({
      apiUrl, username, recoveryCode: code, newPassword
    });
    if (!result.success) {
      err.textContent = result.error || 'Obnova se nezdařila.';
      return;
    }
    state.currentUser = result.user;
    // Rotated recovery code — user needs to save the new one.
    $('#authRecoveryCodeDisplay').textContent = result.newRecoveryCode;
    $('#authRecoveryConfirmed').checked = false;
    $('#btnAuthRecoveryDone').disabled = true;
    showAuthScreen('recoveryCode');
  } catch (e) {
    err.textContent = 'Chyba: ' + (e?.message || e);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Obnovit heslo';
  }
}

// Logout: clear token in backend config and reload. We use a hard navigation
// instead of reload() to guarantee a fresh process on Electron — reload()
// occasionally keeps in-memory state and we've seen reports of "previous
// user gets re-loaded after restart" which suggests stale state somewhere.
async function handleLogout() {
  // 1. Tell main process to wipe token + cachedUser from config.json
  await window.api.authLogout();
  // 2. Clear our in-memory state
  state.currentUser = null;
  state.db = null;
  // 3. Clear localStorage too — UI prefs/theme stay (they're not user-specific),
  //    but anything that could leak between users gets wiped.
  try {
    // Don't blow away theme/privacy/UI prefs — those are device-level not user-level
  } catch (_) { /* ignore */ }
  // 4. Hard reload — force a full page reset, no cache.
  // Pass a cache-bust param so Electron doesn't serve cached HTML.
  const url = new URL(window.location.href);
  url.searchParams.set('_logout', Date.now().toString());
  window.location.replace(url.toString());
}

// ============ SIDEBAR USER CHIP ============
function updateSidebarUser() {
  const row = $('#userRow');
  if (!state.currentUser) {
    if (row) row.style.display = 'none';
    return;
  }
  const { username, role } = state.currentUser;
  if (row) row.style.display = 'flex';
  const avatar = $('#userAvatar');
  if (avatar) avatar.textContent = (username[0] || '?').toUpperCase();
  const nameEl = $('#userName');
  if (nameEl) nameEl.textContent = username;
  const roleEl = $('#userRole');
  if (roleEl) roleEl.textContent = role === 'admin' ? 'Admin' : 'Uživatel';

  // Admin-only: show Users management section in Settings.
  const usersSection = $('#usersAdminSection');
  if (usersSection) {
    usersSection.style.display = role === 'admin' ? 'block' : 'none';
  }
}

// ============ USERS MANAGEMENT (Settings, admin only) ============
async function renderUsersList() {
  const container = $('#usersList');
  if (!container || !state.currentUser || state.currentUser.role !== 'admin') return;

  const users = await window.api.authListUsers();
  if (!Array.isArray(users) || users.length === 0) {
    container.innerHTML = '<div class="empty-state" style="padding:16px;">Žádní uživatelé nebo chyba při načítání.</div>';
    return;
  }

  container.innerHTML = users.map(u => {
    const isMe = u.id === state.currentUser.id;
    const lastLogin = u.lastLogin
      ? new Date(u.lastLogin).toLocaleString('cs-CZ')
      : 'nikdy';
    // sharesBucketWithViewer is true when target user's dataKey matches
    // the current admin's — i.e. they share the same tickets/expenses DB.
    const sharesWithMe = u.sharesBucketWithViewer === true && !isMe;
    const ownBucket = u.sharesBucketWithViewer === false && !isMe;
    const bucketBadge = isMe
      ? ''
      : sharesWithMe
        ? '<span class="user-item-badge shared" title="Tento uživatel vidí stejné vstupenky jako ty">📂 Sdílí tvou DB</span>'
        : '<span class="user-item-badge own" title="Tento uživatel má vlastní izolovanou databázi">📦 Vlastní DB</span>';

    return `
      <div class="user-item" data-uid="${escapeHtml(u.id)}">
        <div class="user-avatar">${escapeHtml((u.username[0] || '?').toUpperCase())}</div>
        <div class="user-item-info">
          <div class="user-item-name">
            ${escapeHtml(u.username)}
            <span class="user-item-badge ${u.role}">${u.role === 'admin' ? 'Admin' : 'Uživatel'}</span>
            ${isMe ? '<span class="user-item-badge me">Já</span>' : ''}
            ${bucketBadge}
          </div>
          <div class="user-item-meta">Poslední přihlášení: ${lastLogin}</div>
        </div>
        <div class="user-item-actions">
          ${ownBucket ? `<button class="btn btn-primary btn-sm" data-user-action="share" data-uid="${escapeHtml(u.id)}" data-uname="${escapeHtml(u.username)}" title="Propojit tohoto uživatele s tvojí databází">📂 Sdílet DB</button>` : ''}
          ${sharesWithMe ? `<button class="btn btn-dark btn-sm" data-user-action="unshare" data-uid="${escapeHtml(u.id)}" data-uname="${escapeHtml(u.username)}" title="Odpojit a dát mu vlastní prázdnou DB">📦 Odpojit</button>` : ''}
          ${!isMe ? `<button class="btn btn-dark btn-sm" data-user-action="reset" data-uid="${escapeHtml(u.id)}" data-uname="${escapeHtml(u.username)}">Reset hesla</button>` : ''}
          ${!isMe ? `<button class="btn btn-danger btn-sm" data-user-action="delete" data-uid="${escapeHtml(u.id)}" data-uname="${escapeHtml(u.username)}">Smazat</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('[data-user-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.userAction;
      const uid = btn.dataset.uid;
      const uname = btn.dataset.uname;
      if (action === 'delete') confirmDeleteUser(uid, uname);
      else if (action === 'reset') openResetPwModal(uid, uname);
      else if (action === 'share') confirmShareData(uid, uname);
      else if (action === 'unshare') confirmUnshareData(uid, uname);
    });
  });
}

// Link target user's data to admin's bucket. After this, both see the same tickets.
async function confirmShareData(uid, uname) {
  const res = await window.api.confirm({
    type: 'question',
    buttons: ['Zrušit', 'Sdílet'],
    defaultId: 1,
    cancelId: 0,
    title: 'Sdílet databázi',
    message: `Sdílet databázi s uživatelem "${uname}"?`,
    detail: 'Tento uživatel uvidí a bude moci upravovat stejné vstupenky jako ty. Jeho stávající databáze (pokud nějakou má) zůstane v cloudu, ale on k ní už nebude mít přístup skrz svůj účet.'
  });
  if (res !== 1) return;
  const result = await window.api.authShareData({ targetUserId: uid });
  if (!result.success) {
    toast(result.error || 'Nepodařilo se propojit databázi', 'error');
    return;
  }
  toast(`${uname} nyní sdílí tvou databázi`, 'success');
  await renderUsersList();
}

// Give target user a fresh empty bucket — they lose access to shared data.
async function confirmUnshareData(uid, uname) {
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Odpojit'],
    defaultId: 1,
    cancelId: 0,
    title: 'Odpojit databázi',
    message: `Odpojit uživatele "${uname}" od tvé databáze?`,
    detail: 'Dostane vlastní prázdnou databázi a už nebude mít přístup k tvým vstupenkám. Ty budeš mít svou databázi stále k dispozici.'
  });
  if (res !== 1) return;
  const result = await window.api.authUnshareData({ targetUserId: uid });
  if (!result.success) {
    toast(result.error || 'Nepodařilo se odpojit', 'error');
    return;
  }
  toast(`${uname} má nyní vlastní databázi`, 'success');
  await renderUsersList();
}

function openAddUserModal() {
  $('#newUserName').value = '';
  $('#newUserPassword').value = '';
  $('#newUserRole').value = 'user';
  $('#newUserShareData').checked = false;
  $('#newUserError').textContent = '';
  $('#modalAddUser').classList.add('active');
  setTimeout(() => $('#newUserName').focus(), 50);
}

async function confirmAddUser() {
  const username = $('#newUserName').value.trim();
  const password = $('#newUserPassword').value;
  const role = $('#newUserRole').value;
  const shareMyData = $('#newUserShareData').checked;
  const err = $('#newUserError');

  if (!username) { err.textContent = 'Zadej uživatelské jméno.'; return; }
  if (password.length < 6) { err.textContent = 'Heslo musí mít aspoň 6 znaků.'; return; }

  const result = await window.api.authCreateUser({ username, password, role, shareMyData });
  if (!result.success) {
    err.textContent = result.error || 'Nepodařilo se vytvořit účet.';
    return;
  }
  closeModal('modalAddUser');
  const msg = shareMyData
    ? `Uživatel ${username} vytvořen — sdílí tvou databázi`
    : `Uživatel ${username} vytvořen (vlastní databáze)`;
  toast(msg, 'success');
  await renderUsersList();
}

async function confirmDeleteUser(uid, uname) {
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    defaultId: 1,
    cancelId: 0,
    title: 'Smazat uživatele',
    message: `Opravdu smazat uživatele "${uname}"?`,
    detail: 'Jejich data zůstanou v cloud backendu, ale účet se už nebude moct přihlásit.'
  });
  // window.api.confirm returns the clicked button's index. Button 1 = "Smazat".
  if (res !== 1) return;

  const result = await window.api.authDeleteUser({ targetUserId: uid });
  if (!result.success) {
    toast(result.error || 'Nepodařilo se smazat uživatele', 'error');
    return;
  }
  toast(`Uživatel ${uname} smazán`, 'success');
  await renderUsersList();
}

function openResetPwModal(uid, uname) {
  state._resetPwTargetId = uid;
  $('#resetPwTargetName').textContent = uname;
  $('#resetPwNewPassword').value = '';
  $('#resetPwError').textContent = '';
  $('#modalResetPassword').classList.add('active');
  setTimeout(() => $('#resetPwNewPassword').focus(), 50);
}

async function confirmResetPassword() {
  const newPassword = $('#resetPwNewPassword').value;
  const err = $('#resetPwError');
  if (newPassword.length < 6) {
    err.textContent = 'Heslo musí mít aspoň 6 znaků.';
    return;
  }
  const result = await window.api.authResetUserPassword({
    targetUserId: state._resetPwTargetId,
    newPassword
  });
  if (!result.success) {
    err.textContent = result.error || 'Reset se nezdařil.';
    return;
  }
  closeModal('modalResetPassword');
  toast('Heslo resetováno — předej uživateli nové heslo.', 'success', 5000);
  await renderUsersList();
}

// ============ INBOUND EMAIL — PERSONAL FORWARD ADDRESS (v1.3.0) ============
// Each user has a unique mailToken that forms the +tag in their personal
// CloudMailin address:  <base>+<mailToken>@cloudmailin.net
// Emails forwarded to THAT exact address route straight to this user's
// inbox (via backend routing logic in inbox.js). No whitelist needed.
//
// The legacy allowedSenders whitelist is still active server-side as a
// fallback for forwards that arrive without +tag (e.g., Apple Mail
// sometimes strips it), but the UI no longer exposes it — users manage
// routing via the address alone, and optionally via regeneration.
const CLOUDMAILIN_BASE = 'e39a755c78a59a3e9759@cloudmailin.net';

function buildPersonalForwardAddress(mailToken) {
  if (!mailToken) return CLOUDMAILIN_BASE;  // fallback: legacy share-base if token missing
  // Split 'local@domain' and insert '+tag' before @
  const at = CLOUDMAILIN_BASE.indexOf('@');
  if (at < 0) return CLOUDMAILIN_BASE;
  return CLOUDMAILIN_BASE.slice(0, at) + '+' + mailToken + CLOUDMAILIN_BASE.slice(at);
}

async function loadMailForwardUI() {
  const el = $('#mailForwardAddress');
  if (!el) return;
  const mailToken = state.currentUser?.mailToken || '';
  const address = buildPersonalForwardAddress(mailToken);
  el.textContent = address;
  // Stash on the element so the copy button can grab it without re-querying.
  el.dataset.address = address;

  // Update the "status hint" below the address
  const hint = $('#mailForwardHint');
  if (hint) {
    if (mailToken) {
      hint.innerHTML = `<span class="mail-forward-ok">✓ Unikátní pro tebe</span> — emaily z tvého Gmailu (po forwardu sem) dorazí jen do tvé DB.`;
    } else {
      hint.innerHTML = `<span class="mail-forward-warn">⚠ Starší účet bez vlastního tagu</span> — klikni "Vygenerovat" pro vlastní adresu.`;
    }
  }
}

async function copyMailForwardAddress() {
  const el = $('#mailForwardAddress');
  if (!el) return;
  const addr = el.dataset.address || el.textContent || '';
  try {
    await navigator.clipboard.writeText(addr);
    toast('Adresa zkopírována', 'success');
  } catch (e) {
    toast('Kopírování selhalo', 'error');
  }
}

async function regenerateMailToken() {
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Vygenerovat novou'],
    defaultId: 1,
    cancelId: 0,
    title: 'Vygenerovat novou forward adresu',
    message: 'Opravdu vygenerovat novou adresu?',
    detail: 'Stará adresa okamžitě přestane fungovat. Budeš muset aktualizovat forward v Gmailu, jinak ti emaily přestanou chodit.'
  });
  if (res !== 1) return;

  const btn = $('#btnRegenMailToken');
  if (btn) btn.disabled = true;
  try {
    const result = await window.api.authRegenerateMailToken();
    if (!result.success) {
      toast(result.error || 'Regenerace selhala', 'error', 5000);
      return;
    }
    // Update local state and UI
    if (state.currentUser) state.currentUser.mailToken = result.mailToken;
    await loadMailForwardUI();
    toast('Nová adresa vygenerována — nezapomeň aktualizovat Gmail forward', 'success', 5000);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function copyMailAddress() {
  const text = $('#mailForwardAddress')?.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    toast('Zkopírováno do schránky', 'success');
  } catch (e) {
    toast('Kopírování selhalo: ' + e.message, 'error');
  }
}

// ============ CURRENCY SETTINGS UI ============
// Populates the primary/default dropdowns from the CURRENCIES constant and
// renders the rates table. Called when the Settings view is opened.
function loadCurrencySettingsUI() {
  const primarySel = $('#cfgPrimaryCurrency');
  const defaultSel = $('#cfgDefaultTicketCurrency');
  if (!primarySel || !defaultSel) return;

  const options = CURRENCIES
    .map(c => `<option value="${c.code}">${c.code} — ${c.name} (${c.symbol})</option>`)
    .join('');
  primarySel.innerHTML = options;
  defaultSel.innerHTML = options;

  primarySel.value = getPrimaryCurrency();
  defaultSel.value = getDefaultTicketCurrency();

  renderRatesTable();
}

// Render the mini grid of exchange rates. Each cell shows the currency code
// and "1 EUR = X <code>". The primary currency cell gets a subtle ring so it
// stands out (rate is 1.0 since rates are EUR-normalized — still worth showing).
function renderRatesTable() {
  const wrap = $('#ratesTableWrap');
  if (!wrap) return;
  const rates = getExchangeRates();
  const primary = getPrimaryCurrency();
  const updated = rates._updated;

  // Label with relative time since last update.
  const label = $('#ratesUpdatedLabel');
  if (label) {
    if (!updated) {
      label.textContent = 'Kurzy ještě nebyly staženy. Klikni na Aktualizovat nyní.';
    } else {
      const d = new Date(updated);
      const hoursAgo = Math.round((Date.now() - d.getTime()) / 3600000);
      const when = hoursAgo < 1
        ? 'před chvílí'
        : hoursAgo < 24 ? `před ${hoursAgo} h` : `před ${Math.round(hoursAgo / 24)} dny`;
      label.textContent = `Naposledy aktualizováno ${d.toLocaleString('cs-CZ')} (${when}).`;
    }
  }

  // Always show all supported currencies even if we don't have a rate yet —
  // makes it visually obvious that something's missing if fetch failed.
  wrap.innerHTML = CURRENCIES.map(c => {
    const rate = rates[c.code];
    const rateText = rate !== undefined
      ? (rate === 1 ? '1 : 1' : `1 EUR = ${rate.toFixed(3)} ${c.code}`)
      : '—';
    const primaryClass = c.code === primary ? ' rate-primary' : '';
    return `<div class="rate-cell${primaryClass}" title="${c.name}">
      <span class="rate-code">${c.code}</span>
      <span class="rate-value">${rateText}</span>
    </div>`;
  }).join('');
}

async function saveCurrencySettings() {
  const primary = $('#cfgPrimaryCurrency').value;
  const def = $('#cfgDefaultTicketCurrency').value;

  // Persist in config (local to this device). We don't push currency prefs to
  // the cloud DB — each user picks their own viewing currency.
  state.config = state.config || {};
  state.config.primaryCurrency = primary;
  state.config.defaultTicketCurrency = def;
  await window.api.saveConfig(state.config);

  toast(`Hlavní měna: ${primary} · výchozí pro nové: ${def}`, 'success');
  // Re-render everything so amounts update immediately with the new primary currency.
  renderStats();
  renderTickets();
  renderRatesTable();
}

// Trigger a fresh fetch from the exchange rate API via the Electron main process.
// The main process caches the result in config, so all renderers see it next time
// they call getExchangeRates().
async function refreshRates() {
  const btn = $('#btnRefreshRates');
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = '⏳ Aktualizuji...';
  try {
    const result = await window.api.fetchExchangeRates();
    if (!result.success) {
      toast(result.error || 'Nepodařilo se stáhnout kurzy', 'error');
      return;
    }
    // Config is re-loaded in memory from disk after main updates it.
    state.config = await window.api.loadConfig();
    renderRatesTable();
    // Stats + rows depend on rates — re-render them too.
    renderStats();
    renderTickets();
    toast(`Kurzy aktualizovány (${result.count} měn)`, 'success');
  } catch (e) {
    toast('Chyba: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

async function handleChangeOwnPassword() {
  const oldPw = $('#cpOldPassword').value;
  const newPw = $('#cpNewPassword').value;
  const newPw2 = $('#cpNewPassword2').value;

  if (!oldPw || !newPw) {
    toast('Vyplň všechna pole', 'error');
    return;
  }
  if (newPw.length < 6) {
    toast('Nové heslo musí mít aspoň 6 znaků', 'error');
    return;
  }
  if (newPw !== newPw2) {
    toast('Hesla se neshodují', 'error');
    return;
  }

  const result = await window.api.authChangeOwnPassword({
    oldPassword: oldPw,
    newPassword: newPw
  });
  if (!result.success) {
    toast(result.error || 'Změna hesla se nezdařila', 'error');
    return;
  }
  $('#cpOldPassword').value = '';
  $('#cpNewPassword').value = '';
  $('#cpNewPassword2').value = '';
  toast('Heslo úspěšně změněno', 'success');
}

// ============ EMAIL DIGEST SETTINGS ============
// Populate fields from the current user's backend record (state.currentUser
// has email/digestEnabled because publicUser exposes them).
function loadEmailSettingsUI() {
  if (!state.currentUser) return;
  const emailEl = $('#emailNotifyAddr');
  const enabledEl = $('#emailNotifyEnabled');
  if (emailEl) emailEl.value = state.currentUser.email || '';
  if (enabledEl) enabledEl.checked = !!state.currentUser.digestEnabled;
}

async function saveEmailSettings() {
  const email = $('#emailNotifyAddr').value.trim();
  const digestEnabled = $('#emailNotifyEnabled').checked;
  // Basic sanity — the backend also validates, but fail fast in UI.
  if (digestEnabled && !email) {
    toast('Pro zapnutí notifikací zadej email', 'error');
    return;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    toast('Neplatný formát emailu', 'error');
    return;
  }
  const btn = $('#btnSaveEmailSettings');
  btn.disabled = true;
  try {
    const result = await window.api.authUpdateEmailSettings({ email, digestEnabled });
    if (!result.success) {
      toast(result.error || 'Uložení selhalo', 'error');
      return;
    }
    // Sync local state so next render has the right values.
    state.currentUser.email = result.email;
    state.currentUser.digestEnabled = result.digestEnabled;
    toast('Nastavení uloženo', 'success');
  } finally {
    btn.disabled = false;
  }
}

async function sendTestDigest() {
  if (!state.currentUser?.email) {
    toast('Nejdřív ulož svou emailovou adresu', 'error');
    return;
  }
  const btn = $('#btnTestDigest');
  btn.disabled = true;
  btn.textContent = '📨 Odesílám...';
  try {
    const result = await window.api.authTestDigest();
    if (!result.success) {
      toast(result.error || 'Odeslání selhalo. Zkontroluj backend config.', 'error', 6000);
      return;
    }
    toast(`Testovací email odeslán (${result.total} položek k vyřešení)`, 'success', 5000);
  } finally {
    btn.disabled = false;
    btn.textContent = '📨 Poslat testovací email';
  }
}

function checkUpcomingExpenses() {
  const expenses = state.db.expenses || [];
  const upcoming = expenses.filter(e => {
    if (e.active === false) return false;
    if (e.frequency === 'oneoff') return false;
    if (!e.nextPayment) return false;
    const days = daysUntil(e.nextPayment);
    return days !== null && days >= 0 && days <= 3;
  });
  const overdue = expenses.filter(e => {
    if (e.active === false) return false;
    if (e.frequency === 'oneoff') return false;
    if (!e.nextPayment) return false;
    const days = daysUntil(e.nextPayment);
    return days !== null && days < 0;
  });
  
  if (overdue.length > 0) {
    const names = overdue.slice(0, 3).map(e => e.name).join(', ');
    const suffix = overdue.length > 3 ? ` a dalších ${overdue.length - 3}` : '';
    toast(`⚠ PO TERMÍNU: ${names}${suffix}`, 'error', 10000);
  }
  if (upcoming.length > 0) {
    upcoming.forEach(e => {
      const days = daysUntil(e.nextPayment);
      const dayLabel = days === 0 ? 'DNES' : (days === 1 ? 'zítra' : `za ${days} dny`);
      toast(`💳 ${e.name} - platba ${dayLabel} (${formatMoney(e.price, e.currency)})`, 'info', 8000);
    });
  }
}

// ============ THEME ============
// Theme is bootstrapped by an inline <script> in index.html <head>
// (before CSS applies) to avoid FOUC. Here we only handle the runtime toggle.
// Saved values: 'dark' | 'light' | 'auto'. 'auto' follows prefers-color-scheme.
function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') || 'dark';
}

function applyTheme(value) {
  // value is the stored preference ('dark' | 'light' | 'auto')
  // Resolve 'auto' to actual mode based on system preference.
  let resolved = value;
  if (value === 'auto') {
    resolved = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark';
  }
  document.documentElement.setAttribute('data-theme', resolved);
  localStorage.setItem('theme', value);

  // Re-render charts so they pick up theme-aware colors.
  // Guard: state.charts may not exist during initial bootstrap.
  if (state.charts && Object.keys(state.charts).length > 0 && typeof renderStatsPage === 'function') {
    try { renderStatsPage(); } catch (_) {}
  }
}

function toggleTheme() {
  // Quick-toggle button flips between light and dark (no 'auto' here).
  // If user wants 'auto', they set it from the settings page (future).
  const current = getCurrentTheme();
  const next = current === 'light' ? 'dark' : 'light';
  applyTheme(next);
}

// ── PRIVACY MODE ────────────────────────────────────────────────────────
// Toggle a `privacy-mode` class on <body>. CSS does the rest (blur on all
// sensitive elements). State persists in localStorage so it survives reload.

function isPrivacyModeOn() {
  return localStorage.getItem('privacyMode') === '1';
}

function applyPrivacyMode(on) {
  document.body.classList.toggle('privacy-mode', !!on);
  localStorage.setItem('privacyMode', on ? '1' : '0');
  // Update button title to reflect current state
  const btn = document.getElementById('btnPrivacyToggle');
  if (btn) {
    btn.title = on
      ? 'Soukromý režim ZAPNUTÝ — klikni nebo Ctrl+Shift+H pro vypnutí'
      : 'Soukromý režim (Ctrl+Shift+H)';
  }
}

function togglePrivacyMode() {
  applyPrivacyMode(!isPrivacyModeOn());
  // Tiny toast so the user gets feedback the shortcut worked, especially
  // important since the keyboard shortcut has no visible button click.
  if (typeof toast === 'function') {
    toast(
      isPrivacyModeOn() ? '🔒 Soukromý režim zapnutý' : '👁️ Soukromý režim vypnutý',
      'info',
      1500
    );
  }
}

// Apply on initial load (before user interaction) so blur is in place
// even before app.js fully boots — no flicker of plaintext numbers.
if (typeof document !== 'undefined' && document.body && isPrivacyModeOn()) {
  document.body.classList.add('privacy-mode');
}

// Keep theme in sync with OS preference when user has 'auto' selected.
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    const saved = localStorage.getItem('theme') || 'dark';
    if (saved === 'auto') applyTheme('auto');
  });
}

// ============ CLOCK ============
function startClock() {
  updateClock();
  setInterval(updateClock, 1000);
}

function updateClock() {
  const now = new Date();
  
  // Time: HH:MM:SS
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const timeEl = $('#clockTime');
  if (timeEl) timeEl.textContent = `${hh}:${mm}:${ss}`;
  
  // Date: pondělí, 20. 4. 2026
  const days = ['neděle', 'pondělí', 'úterý', 'středa', 'čtvrtek', 'pátek', 'sobota'];
  const months = ['ledna', 'února', 'března', 'dubna', 'května', 'června', 'července', 'srpna', 'září', 'října', 'listopadu', 'prosince'];
  const dateStr = `${days[now.getDay()]}, ${now.getDate()}. ${months[now.getMonth()]} ${now.getFullYear()}`;
  const dateEl = $('#clockDate');
  if (dateEl) dateEl.textContent = dateStr;
}

async function refreshDb() {
  state.db = await window.api.loadDb();
  if (!state.db.tickets) state.db.tickets = [];

  // Show cloud offline warning if applicable
  if (state.db._offline) {
    toast('⚠️ Cloud nedostupný, zobrazuji lokální cache: ' + (state.db._cloudError || ''), 'error', 5000);
    updateCloudBadge(true);
  } else {
    updateCloudBadge(false);
  }

  populateYearFilter();
  render();
}

function updateCloudBadge(offline) {
  const badge = $('#cloudBadge');
  if (!badge) return;
  if (!state.config?.cloud?.enabled) {
    badge.style.display = 'none';
    return;
  }
  badge.style.display = 'inline-block';
  if (offline) {
    badge.classList.add('offline');
    badge.textContent = '☁️ Offline';
  } else {
    badge.classList.remove('offline');
    badge.textContent = '☁️ Cloud';
  }
}

function updateDbPathDisplay() {
  const path = state.config?.dbPath || '—';
  $('#dbPath').textContent = path.split(/[\/\\]/).pop();
  $('#dbPath').title = path;
  if ($('#dbPathDisplay')) $('#dbPathDisplay').textContent = path;
}

// ============ URGENT TICKETS (alerts) ============
function getAlertsConfig() {
  const a = state.config?.alerts || {};
  return {
    animations: a.animations !== false,
    startupToast: a.startupToast !== false,
    unsoldDays: Number.isFinite(a.unsoldDays) ? a.unsoldDays : 7,
    undeliveredDays: Number.isFinite(a.undeliveredDays) ? a.undeliveredDays : 5,
    mutedTicketIds: Array.isArray(a.mutedTicketIds) ? a.mutedTicketIds : [],
    // TODO page toggles + thresholds.
    // Separate from the alertsUnsold/Undelivered above so user can e.g. show
    // unsold in TODO list but not trigger row animations on the main table.
    todoShowNotListed: a.todoShowNotListed !== false,
    todoShowUnsold: a.todoShowUnsold !== false,
    todoShowUndelivered: a.todoShowUndelivered !== false,
    todoUnsoldDays: Number.isFinite(a.todoUnsoldDays) ? a.todoUnsoldDays : 7,
    todoUndeliveredDays: Number.isFinite(a.todoUndeliveredDays) ? a.todoUndeliveredDays : 5
  };
}

async function setAlertsConfig(patch) {
  if (!state.config.alerts) state.config.alerts = {};
  Object.assign(state.config.alerts, patch);
  await window.api.setConfig(state.config);
}

async function muteTicket(id) {
  const cfg = getAlertsConfig();
  if (!cfg.mutedTicketIds.includes(id)) {
    cfg.mutedTicketIds.push(id);
    await setAlertsConfig({ mutedTicketIds: cfg.mutedTicketIds });
  }
  render();
  updateMutedRowUI();
  toast('Upozornění ztlumeno', 'info', 2000);
}

async function unmuteTicket(id) {
  const cfg = getAlertsConfig();
  const filtered = cfg.mutedTicketIds.filter(x => x !== id);
  await setAlertsConfig({ mutedTicketIds: filtered });
  render();
  updateMutedRowUI();
  toast('Upozornění obnoveno', 'info', 2000);
}

async function clearAllMuted() {
  await setAlertsConfig({ mutedTicketIds: [] });
  render();
  updateMutedRowUI();
  toast('Obnoveno všechno ztlumené', 'success');
}

function updateMutedRowUI() {
  const row = $('#mutedTicketsRow');
  const btn = $('#btnClearMuted');
  if (!row || !btn) return;
  const count = getAlertsConfig().mutedTicketIds.length;
  if (count > 0) {
    row.style.display = '';
    btn.textContent = `Obnovit všechny (${count})`;
  } else {
    row.style.display = 'none';
  }
}

function getTicketUrgency(t) {
  if (!t || !t.eventDate) return null;
  const days = daysUntil(t.eventDate);
  if (days === null) return null;

  const cfg = getAlertsConfig();
  const isMuted = cfg.mutedTicketIds.includes(t.id);

  // ── Past events ────────────────────────────────────────────────────────
  // Event already happened but ticket isn't in a final state (sold+delivered).
  // This is the loudest alert — money is potentially lost (unsold ticket =
  // wasted inventory; sold-but-not-delivered = customer didn't get the ticket
  // and is likely opening a chargeback/dispute right now).
  if (days < 0) {
    // Tickets in a "done" state (delivered or refunded) are fine — event is
    // just history at that point, no action needed.
    if (t.status === 'delivered' || t.status === 'refunded') return null;
    // Anything else (available/listed/sold) past the event date = real problem.
    const type = t.status === 'sold' ? 'past-undelivered' : 'past-unsold';
    return { type, days, level: 'critical', muted: isMuted };
  }

  // ── Upcoming events ────────────────────────────────────────────────────
  // Sold but not yet delivered, event soon → "needs delivery"
  if (t.status === 'sold' && days <= cfg.undeliveredDays) {
    return { type: 'undelivered', days, level: 'critical', muted: isMuted };
  }
  // Still available/listed, event soon → "needs sale"
  if ((t.status === 'available' || t.status === 'listed') && days <= cfg.unsoldDays) {
    return { type: 'unsold', days, level: 'warning', muted: isMuted };
  }
  return null;
}

// DEBUG: Inspect all tickets and their urgency status
function debugUrgencyStatus() {
  const all = state.db.tickets || [];
  console.log('=== DEBUG: Urgency Status ===');
  console.log('Today:', new Date().toISOString().slice(0, 10));
  console.log('Total tickets:', all.length);
  all.forEach(t => {
    const days = t.eventDate ? daysUntil(t.eventDate) : 'N/A';
    const urg = getTicketUrgency(t);
    console.log(`- ${t.eventName} (${t.eventDate}): status=${t.status}, days=${days}, urgency=${urg ? urg.type + '/' + urg.days + 'd' : 'none'}`);
  });
  const counts = countUrgentTickets();
  console.log('Counts:', counts);
  return counts;
}
// Expose to window for manual debugging from DevTools
window.debugUrgency = debugUrgencyStatus;

function countUrgentTickets() {
  const all = state.db.tickets || [];
  let unsold = 0, undelivered = 0, past = 0;
  for (const t of all) {
    const u = getTicketUrgency(t);
    if (!u) continue;
    // Past-event types count as their own bucket — counted separately so we
    // can highlight them more prominently in the K-dořešení tab if needed.
    if (u.type === 'past-unsold' || u.type === 'past-undelivered') past++;
    else if (u.type === 'unsold') unsold++;
    else if (u.type === 'undelivered') undelivered++;
  }
  return { unsold, undelivered, past, total: unsold + undelivered + past };
}

function updateSidebarBadge() {
  // The urgent-tickets badge used to sit on the Dashboard nav item.
  // Now that urgency lives on the dedicated "K dořešení" tab (updateTodoBadge),
  // showing the same count on two tabs was confusing — so we only clean up
  // any legacy badge still attached to Dashboard.
  const dashNav = document.querySelector('.nav-item[data-view="dashboard"]');
  if (!dashNav) return;
  const stale = dashNav.querySelector('.nav-badge');
  if (stale) stale.remove();
}

function checkUpcomingTickets() {
  const cfg = getAlertsConfig();
  if (!cfg.startupToast) return;  // user disabled startup toasts
  
  const all = state.db.tickets || [];
  const undelivered = [];
  const unsold = [];
  for (const t of all) {
    const u = getTicketUrgency(t);
    if (!u) continue;
    if (u.muted) continue;  // skip muted tickets
    if (u.type === 'undelivered') undelivered.push({ ticket: t, days: u.days });
    else if (u.type === 'unsold') unsold.push({ ticket: t, days: u.days });
  }
  
  if (undelivered.length > 0) {
    // Sort by urgency (closest first)
    undelivered.sort((a, b) => a.days - b.days);
    const names = undelivered.slice(0, 3).map(x => `${x.ticket.eventName} (${x.days === 0 ? 'DNES' : 'za ' + x.days + ' dní'})`).join(', ');
    const more = undelivered.length > 3 ? ` + dalších ${undelivered.length - 3}` : '';
    toast(`🚨 ${undelivered.length} vstupenek potřebuje doručit: ${names}${more}`, 'error', 12000);
  }
  
  if (unsold.length > 0) {
    unsold.sort((a, b) => a.days - b.days);
    const names = unsold.slice(0, 3).map(x => `${x.ticket.eventName} (${x.days === 0 ? 'DNES' : 'za ' + x.days + ' dní'})`).join(', ');
    const more = unsold.length > 3 ? ` + dalších ${unsold.length - 3}` : '';
    toast(`⚠️ ${unsold.length} vstupenek neprodaných, event za < ${cfg.unsoldDays} dní: ${names}${more}`, 'error', 10000);
  }
}

// ============ RENDER ============
function render() {
  renderStats();
  renderTickets();
  renderBulkActions();
  updateSidebarBadge();
  updateInboxBadge();
  updateTodoBadge();
  // Debug log for urgent ticket detection
  const urgentCounts = countUrgentTickets();
  if (urgentCounts.total > 0) {
    console.log('[URGENT] Detected:', urgentCounts);
  }
  // Re-render the currently-active detail view. Otherwise mutations made
  // from within the Payouts/Stats/Todo/Expenses/etc. screens (e.g. "Označit
  // přijaté") only refresh the global state, not the actively visible table —
  // so the user has to navigate away and back to see the change.
  if ($('#view-stats')?.classList.contains('active')) renderStatsPage();
  if ($('#view-todo')?.classList.contains('active')) renderTodoPage();
  if ($('#view-payouts')?.classList.contains('active')) renderPayoutsPage();
  if ($('#view-expenses')?.classList.contains('active')) renderExpensesPage?.();
  if ($('#view-inbox')?.classList.contains('active')) renderInboxPage?.();
  if ($('#view-memberships')?.classList.contains('active')) renderMembershipsPage?.();
  if ($('#view-mailboxes')?.classList.contains('active')) renderMailboxesPage?.();
  if ($('#view-simcards')?.classList.contains('active')) renderSimcardsPage?.();
}

function getFilteredTickets() {
  let list = [...state.db.tickets];
  const f = state.filters;

  // Category filter — Dashboard's chip toggle. 'all' = no filter.
  // 'selected' is a pseudo-category that filters to whatever rows the user has
  // multi-selected; useful for inspecting totals of an arbitrary subset.
  // Tickets without category default to 'concert' (set by main.js migration).
  if (state.dashboardCategory === 'selected') {
    list = list.filter(t => state.selectedIds.has(t.id));
  } else if (state.dashboardCategory && state.dashboardCategory !== 'all') {
    list = list.filter(t => (t.category || 'concert') === state.dashboardCategory);
  }
  
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(t => 
      (t.eventName || '').toLowerCase().includes(q) ||
      (t.venue || '').toLowerCase().includes(q) ||
      (t.section || '').toLowerCase().includes(q) ||
      (t.account || '').toLowerCase().includes(q)
    );
  }
  if (f.status) list = list.filter(t => t.status === f.status);
  if (f.month) list = list.filter(t => t.eventDate && new Date(t.eventDate).getMonth() + 1 === parseInt(f.month));
  if (f.year) list = list.filter(t => t.eventDate && new Date(t.eventDate).getFullYear() === parseInt(f.year));
  if (f.dateFrom) list = list.filter(t => t.eventDate && t.eventDate >= f.dateFrom);
  if (f.dateTo) list = list.filter(t => t.eventDate && t.eventDate <= f.dateTo);
  
  // Sort
  list.sort((a, b) => {
    let av, bv;
    if (state.sortBy === 'profit') { av = calcProfit(a); bv = calcProfit(b); }
    else if (state.sortBy === 'hold') { av = calcHoldDays(a); bv = calcHoldDays(b); }
    else { av = a[state.sortBy]; bv = b[state.sortBy]; }
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    av = av ?? ''; bv = bv ?? '';
    if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
    if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  return list;
}

// Compute hold duration (days). Used by both the renderer and the sort comparator.
// Only sold/delivered tickets have a meaningful hold — for unsold returns -1
// so they sort to the bottom regardless of direction.
function calcHoldDays(t) {
  if (!t || !t.purchaseDate || !t.saleDate) return -1;
  if (t.status !== 'sold' && t.status !== 'delivered') return -1;
  const p = new Date(t.purchaseDate);
  const s = new Date(t.saleDate);
  if (isNaN(p) || isNaN(s)) return -1;
  return Math.max(0, Math.round((s - p) / 86400000));
}

function renderStats() {
  // Apply the dashboard category filter so the 5 stat cards (Profit / Spent /
  // Revenue / Sold / Stock) reflect ONLY the selected category — same scope
  // as the table below them. 'selected' is the pseudo-category that filters
  // to multi-select chosen rows, mirroring the same logic in getFilteredTickets.
  let all = state.db.tickets;
  if (state.dashboardCategory === 'selected') {
    all = all.filter(t => state.selectedIds.has(t.id));
  } else if (state.dashboardCategory && state.dashboardCategory !== 'all') {
    all = all.filter(t => (t.category || 'concert') === state.dashboardCategory);
  }
  const sold = all.filter(t => t.status === 'sold' || t.status === 'delivered');

  // Aggregate in primary currency since tickets may have mixed currencies.
  const totalProfit = sold.reduce((s, t) => s + calcProfitInPrimary(t), 0);
  const totalSpent = all.reduce((s, t) => s + calcCostInPrimary(t), 0);
  const revenue = sold.reduce((s, t) => s + calcRevenueInPrimary(t), 0);

  // Počítáme KUSY, ne řádky
  const sumQty = (arr) => arr.reduce((s, t) => s + (Number(t.quantity) || 1), 0);
  const soldQty = sumQty(sold);
  const totalQty = sumQty(all);
  const inStockQty = sumQty(all.filter(t => t.status === 'available' || t.status === 'listed'));

  const primary = getPrimaryCurrency();
  $('#statProfit').textContent = formatMoney(totalProfit, primary);
  $('#statSpent').textContent = formatMoney(totalSpent, primary);
  $('#statRevenue').textContent = formatMoney(revenue, primary);
  $('#statSold').textContent = `${soldQty} / ${totalQty}`;
  $('#statStock').textContent = formatInt(inStockQty);
}

function renderTickets() {
  const list = getFilteredTickets();
  const tbody = $('#ticketsBody');
  const empty = $('#emptyState');
  
  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    // Filter narrowed everything away → drop selection + hide bulk bar so it
    // doesn't show "5 vybráno" when there's literally nothing on screen.
    state.selectedIds.clear();
    renderBulkActions();
    const saEmpty = $('#selectAll');
    if (saEmpty) { saEmpty.checked = false; saEmpty.indeterminate = false; }
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = list.map(t => {
    // All money displayed in primary currency for consistency across rows.
    // Conversion uses current FX rates from Settings.
    const primary = getPrimaryCurrency();
    const profit = calcProfitInPrimary(t);
    const roi = calcRoi(t);
    const profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
    const roiClass = roi >= 0 ? 'roi-positive' : 'roi-negative';
    const checked = state.selectedIds.has(t.id) ? 'checked' : '';
    const logo = t.logo 
      ? `<img src="${escapeHtml(t.logo)}" alt="" onerror="this.style.display='none';this.parentElement.textContent='${getEventInitials(t.eventName)}'">`
      : getEventInitials(t.eventName);
    const isSold = t.status === 'sold';
    const isDelivered = t.status === 'delivered';
    const isSoldOrDelivered = isSold || isDelivered;
    
    // Status label (pretty Czech labels)
    const statusLabels = {
      available: 'Koupeno',
      listed: 'Zalistováno',
      sold: 'Prodáno',
      delivered: '✓ Doručeno',
      cancelled: 'Zrušeno'
    };
    const statusLabel = statusLabels[t.status] || (t.status || 'available');
    
    const urgency = getTicketUrgency(t);
    const cfg = getAlertsConfig();
    let rowClass = isDelivered ? 'row-delivered' : '';
    if (urgency && !urgency.muted) {
      rowClass += (rowClass ? ' ' : '') + (urgency.type === 'undelivered' ? 'row-urgent-deliver' : 'row-urgent-sell');
      if (cfg.animations) {
        rowClass += ' animated';
      }
    }
    
    // Pulsing dot + human-readable text + mute button
    let urgencyBadge = '';
    let rowExtraClass = '';
    if (urgency) {
      // Past-event types use a clearer label since "−3 dny do eventu" reads weird.
      let daysText;
      if (urgency.type === 'past-unsold' || urgency.type === 'past-undelivered') {
        const ago = Math.abs(urgency.days);
        const action = urgency.type === 'past-undelivered' ? 'NEDORUČENO' : 'NEPRODÁNO';
        daysText = ago === 0
          ? `${action} · dnes byl event`
          : ago === 1
            ? `${action} · včera byl event`
            : `${action} · event byl před ${ago} dny`;
      } else {
        daysText = urgency.days === 0
          ? 'dnes je event'
          : urgency.days === 1
            ? 'zítra je event'
            : `${urgency.days} dny do eventu`;
      }
      const action = (urgency.type === 'undelivered' || urgency.type === 'past-undelivered') ? 'Doručit' : 'Prodat';
      // Past events get the red dot + a darker red chip variant. Add row class
      // so the entire <tr> can show a subtle red background for visibility.
      const isPast = urgency.type === 'past-unsold' || urgency.type === 'past-undelivered';
      const dotClass = (urgency.type === 'undelivered' || isPast) ? 'urgent-dot-red' : 'urgent-dot-yellow';
      const chipColorClass = isPast
        ? 'urgent-chip-past'
        : (urgency.type === 'undelivered' ? 'urgent-chip-red' : 'urgent-chip-yellow');
      const chipAnimClass = cfg.animations && !urgency.muted ? ' animated' : '';
      const chipMutedClass = urgency.muted ? ' muted' : '';
      const muteBtn = urgency.muted
        ? `<button class="urgent-mute-btn" data-unmute-id="${t.id}" title="Obnovit upozornění">🔔</button>`
        : `<button class="urgent-mute-btn" data-mute-id="${t.id}" title="Ztlumit upozornění pro tuto vstupenku">🔕</button>`;
      urgencyBadge = `
        <span class="urgent-chip ${chipColorClass}${chipAnimClass}${chipMutedClass}"
              title="${action} — ${daysText}${urgency.muted ? ' (ztlumené)' : ''}">
          <span class="urgent-dot ${dotClass}${cfg.animations && !urgency.muted ? ' animated' : ''}"></span>
          <span class="urgent-chip-text">${daysText}</span>
          ${muteBtn}
        </span>`;
      // Mark the row visually if event is past and ticket isn't resolved.
      if (isPast && !urgency.muted) rowExtraClass = ' row-past-event';
    }
    
    // External IDs link (small icon next to event name)
    let listingLinkIcon = '';
    const extIds = t.externalIds || {};
    if (extIds.viagogoListingId) {
      listingLinkIcon = `<a class="listing-link" href="https://www.viagogo.co.uk/secure/myaccount/Listings/Details/${encodeURIComponent(extIds.viagogoListingId)}" target="_blank" rel="noopener" title="Viagogo Listing ${escapeHtml(extIds.viagogoListingId)}">🔗</a>`;
    } else if (extIds.stubhubListingId) {
      listingLinkIcon = `<a class="listing-link" href="https://www.stubhub.ie/my/sales" target="_blank" rel="noopener" title="StubHub Listing ${escapeHtml(extIds.stubhubListingId)}">🔗</a>`;
    }
    
    return `
      <tr data-id="${t.id}" class="${rowClass}${rowExtraClass}">
        <td class="col-check"><input type="checkbox" class="row-check" data-id="${t.id}" ${checked}></td>
        <td>
          <div class="event-cell">
            <div class="event-logo">${logo}</div>
            <div class="event-name-wrap">
              <div class="event-name">${escapeHtml(t.eventName || '—')}${listingLinkIcon}</div>
              ${urgencyBadge}
            </div>
          </div>
        </td>
        <td class="col-date">${t.eventDate || '—'}</td>
        <td>${escapeHtml(t.venue || '—')}</td>
        <td class="col-country">${(() => {
          // Country cell — ISO-code badge (e.g. "GB") + full country name.
          // Empty/missing country shows a dim em-dash. Badge is golden-tinted
          // to match the app's accent palette; the name uses muted text so
          // the badge reads as the primary identifier at a glance.
          const c = t.country;
          if (!c) return '<span class="muted">—</span>';
          const iso = getCountryIso(c);
          const badge = iso ? `<span class="country-iso" title="${escapeHtml(c)}">${iso}</span>` : '';
          return `<span class="country-cell" title="${escapeHtml(c)}">${badge}<span class="country-name">${escapeHtml(c)}</span></span>`;
        })()}</td>
        <td>${escapeHtml([t.section, t.row].filter(Boolean).join(', ') || '—')}</td>
        <td>${escapeHtml(t.account || '—')}</td>
        <td>${(() => {
          const purchase = t.purchasePlatform;
          const sale = t.platform;
          if (purchase && sale && purchase !== sale) {
            return `<span class="platform-pair" title="Nákup → Prodej">${escapeHtml(purchase)} <span class="platform-arrow">→</span> ${escapeHtml(sale)}</span>`;
          }
          return escapeHtml(sale || purchase || '—');
        })()}</td>
        <td>${t.quantity || 1}</td>
        <td><span class="status-pill status-${t.status || 'available'}">${statusLabel}</span></td>
        <td class="col-purchase" title="${(() => {
          // Tooltip shows the original currency price (so user knows what was actually paid in source currency)
          const origCcy = ticketCurrency(t);
          const isMixed = origCcy !== primary;
          const perKs = (Number(t.quantity) || 1) > 1 ? 'Cena za 1 ks: ' + formatMoney(t.purchasePrice, origCcy) + '\n' : '';
          const orig = isMixed ? `Původní cena: ${formatMoney(calcCost(t), origCcy)}` : '';
          return (perKs + orig).trim();
        })()}">${formatMoney(calcCostInPrimary(t), primary)}${(Number(t.quantity) || 1) > 1 ? ` <span class="per-ks">(${formatMoney(calcCostInPrimary(t) / (Number(t.quantity) || 1), primary)}/ks)</span>` : ''}</td>
        <td class="col-sale" title="${(() => {
          if (!isSoldOrDelivered) return '';
          const origCcy = saleCurrency(t);
          const isMixed = origCcy !== primary;
          const perKs = (Number(t.quantity) || 1) > 1 ? 'Cena za 1 ks: ' + formatMoney(t.salePrice, origCcy) + '\n' : '';
          const orig = isMixed ? `Původní cena: ${formatMoney(calcRevenue(t), origCcy)}` : '';
          return (perKs + orig).trim();
        })()}">${isSoldOrDelivered ? formatMoney(calcRevenueInPrimary(t), primary) + ((Number(t.quantity) || 1) > 1 ? ` <span class="per-ks">(${formatMoney(calcRevenueInPrimary(t) / (Number(t.quantity) || 1), primary)}/ks)</span>` : '') : '—'}</td>
        <td class="col-hold">${(() => {
          // HOLD = days between purchase and sale.
          // Only shown for sold/delivered tickets — for unsold tickets the
          // "hold" is undefined (we haven't realized the timing yet).
          if (!isSoldOrDelivered) return '<span class="hold-na">—</span>';
          if (!t.purchaseDate || !t.saleDate) return '<span class="hold-na">—</span>';
          const purchaseD = new Date(t.purchaseDate);
          const saleD = new Date(t.saleDate);
          if (isNaN(purchaseD) || isNaN(saleD)) return '<span class="hold-na">—</span>';
          const days = Math.max(0, Math.round((saleD - purchaseD) / 86400000));
          return `<span class="hold-final" title="Prodáno za ${days} dní od nákupu">${days} d</span>`;
        })()}</td>
        <td class="col-profit ${profitClass}">${isSoldOrDelivered ? formatMoney(profit, primary) : '—'}</td>
        <td class="col-roi">${isSoldOrDelivered ? `<span class="roi-pill ${roiClass}">${roi.toFixed(1)}%</span>` : '—'}</td>
        <td class="col-actions">
          <div class="actions-cell">
            ${t.status === 'available' ? `<button class="btn btn-list btn-sm" data-action="list" data-id="${t.id}" title="Vyplnit Listing ID a převést do stavu Zalistováno">Zalistovat</button>` : ''}
            ${t.status === 'listed' ? `<button class="btn btn-success btn-sm" data-action="sell" data-id="${t.id}">Prodat</button>` : ''}
            ${isSold ? `<button class="btn btn-deliver btn-sm" data-action="deliver" data-id="${t.id}" title="Označit jako doručené zákazníkovi">✓ Doručit</button>` : ''}
            ${isDelivered ? `<button class="btn btn-undeliver btn-sm" data-action="undeliver" data-id="${t.id}" title="Vrátit zpět na prodáno">↶</button>` : ''}
            <button class="btn btn-clone btn-sm" data-action="clone" data-id="${t.id}" title="Klonovat - vytvořit novou vstupenku s předvyplněnými daty">🗐</button>
            <button class="btn btn-dark btn-sm" data-action="edit" data-id="${t.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-action="delete" data-id="${t.id}">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Attach action listeners
  tbody.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (action === 'edit') openTicketModal(state.db.tickets.find(t => t.id === id));
      if (action === 'delete') deleteTicket(id);
      if (action === 'clone') cloneTicket(state.db.tickets.find(t => t.id === id));
      if (action === 'sell') openSellModal(state.db.tickets.find(t => t.id === id));
      if (action === 'deliver') markDelivered(id);
      if (action === 'undeliver') markUndelivered(id);
      if (action === 'list') openListModal(state.db.tickets.find(t => t.id === id));
    });
  });
  
  tbody.querySelectorAll('.row-check').forEach(cb => {
    cb.addEventListener('change', (e) => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      // Keep header checkbox in sync with row state — checked when ALL visible
      // rows selected, indeterminate when SOME, unchecked when none.
      const sa = $('#selectAll');
      if (sa) {
        const visibleSelected = list.filter(t => state.selectedIds.has(t.id)).length;
        sa.checked = visibleSelected === list.length;
        sa.indeterminate = visibleSelected > 0 && visibleSelected < list.length;
      }
      // If the "🎯 Vybrané" filter is active, the row we just unchecked must
      // disappear from view (and the stat cards above must drop its totals).
      // renderTickets re-runs getFilteredTickets which honors the chip filter;
      // renderStats does the same for the cards on top.
      if (state.dashboardCategory === 'selected') {
        renderStats();
        renderTickets();
        return; // renderTickets already calls renderBulkActions at the end
      }
      renderBulkActions();
    });
  });

  // Sync header checkbox state on each render (e.g. after filter changes).
  const saHeader = $('#selectAll');
  if (saHeader) {
    const visibleSelected = list.filter(t => state.selectedIds.has(t.id)).length;
    saHeader.checked = list.length > 0 && visibleSelected === list.length;
    saHeader.indeterminate = visibleSelected > 0 && visibleSelected < list.length;
  }
  renderBulkActions();
  
  // Mute/unmute listeners
  tbody.querySelectorAll('[data-mute-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      muteTicket(btn.dataset.muteId);
    });
  });
  tbody.querySelectorAll('[data-unmute-id]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      unmuteTicket(btn.dataset.unmuteId);
    });
  });
}

function renderBulkActions() {
  // Keep the "🎯 Vybrané" chip in sync with selection state on every change —
  // visibility, count badge, and auto-fallback to 'all' if selection emptied.
  syncCategoryToggleUI();

  const bar = $('#bulkActions');
  const count = state.selectedIds.size;
  if (count === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  $('#bulkCount').textContent = `${count} vybráno`;

  // Compute summary in primary (EUR) currency over the selected tickets.
  // Profit/cost/revenue helpers already handle per-ticket conversion to primary.
  const selected = state.db.tickets.filter(t => state.selectedIds.has(t.id));
  const primary = getPrimaryCurrency();
  let totalCost = 0;
  let totalRevenue = 0;
  let totalProfit = 0;
  let costForRoi = 0; // only count cost of SOLD/DELIVERED tickets for honest ROI
  selected.forEach(t => {
    totalCost += calcCostInPrimary(t);
    if (t.status === 'sold' || t.status === 'delivered') {
      totalRevenue += calcRevenueInPrimary(t);
      totalProfit += calcProfitInPrimary(t);
      costForRoi += calcCostInPrimary(t);
    }
  });
  const roi = costForRoi > 0 ? (totalProfit / costForRoi) * 100 : 0;
  const profitClass = totalProfit >= 0 ? 'profit-positive' : 'profit-negative';
  const roiClass = roi >= 0 ? 'roi-positive' : 'roi-negative';

  $('#bulkSummary').innerHTML = `
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">Nákup</span>
      <span class="bulk-summary-value">${formatMoney(totalCost, primary)}</span>
    </div>
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">Prodej</span>
      <span class="bulk-summary-value">${formatMoney(totalRevenue, primary)}</span>
    </div>
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">Zisk</span>
      <span class="bulk-summary-value ${profitClass}">${totalProfit >= 0 ? '+' : ''}${formatMoney(totalProfit, primary)}</span>
    </div>
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">ROI</span>
      <span class="bulk-summary-value ${roiClass}">${costForRoi > 0 ? (roi >= 0 ? '+' : '') + roi.toFixed(1) + ' %' : '—'}</span>
    </div>
  `;
}

// ============ PAYOUTS BULK ACTIONS ============
// Mirrors renderBulkActions but for the Payouts view. Operates on the
// payout objects (which wrap tickets) so we can sum p.amount in saleCurrency.
function renderPayoutBulkActions() {
  const bar = $('#pBulkActions');
  if (!bar) return;
  const count = state.selectedPayoutIds.size;
  if (count === 0) {
    bar.style.display = 'none';
    return;
  }
  bar.style.display = 'flex';
  $('#pBulkCount').textContent = `${count} vybráno`;

  const all = getPayoutTickets();
  const selected = all.filter(p => state.selectedPayoutIds.has(p.ticket.id));
  const primary = getPrimaryCurrency();

  let totalToReceive = 0; // pending only — what's still owed
  let totalReceived = 0;  // already paid out
  let overdueCount = 0;
  selected.forEach(p => {
    const amt = convertCurrency(Number(p.amount) || 0, saleCurrency(p.ticket), primary);
    if (p.isPaid) {
      const paidRaw = (p.ticket.paidOutAmount !== null && p.ticket.paidOutAmount !== undefined)
        ? Number(p.ticket.paidOutAmount) : Number(p.amount);
      totalReceived += convertCurrency(paidRaw, saleCurrency(p.ticket), primary);
    } else {
      totalToReceive += amt;
      if (p.isOverdue) overdueCount++;
    }
  });

  $('#pBulkSummary').innerHTML = `
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">K přijetí</span>
      <span class="bulk-summary-value">${formatMoney(totalToReceive, primary)}</span>
    </div>
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">Vyplaceno</span>
      <span class="bulk-summary-value">${formatMoney(totalReceived, primary)}</span>
    </div>
    <div class="bulk-summary-item">
      <span class="bulk-summary-label">Po termínu</span>
      <span class="bulk-summary-value ${overdueCount > 0 ? 'profit-negative' : ''}">${overdueCount}</span>
    </div>
  `;
}

function populateYearFilter() {
  const years = new Set(state.db.tickets.map(t => t.eventDate ? new Date(t.eventDate).getFullYear() : null).filter(Boolean));
  const sel = $('#filterYear');
  const current = sel.value;
  sel.innerHTML = '<option value="">Všechny roky</option>' + 
    [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
  sel.value = current;
}

// ============ TODO PAGE (K dořešení) ============
// Collects tickets that need action, grouped by status. Sections are
// MUTUALLY EXCLUSIVE (each ticket in ≤1 section) so no duplicates.
//   1) "K zalistování" — status=available (Koupeno), ANY date. No day threshold.
//   2) "Neprodané"     — status=listed (Zalistováno), event within todoUnsoldDays.
//   3) "Neodeslané"    — status=sold (not delivered), event within todoUndeliveredDays.
//
// Workflow:  Koupeno → Zalistováno → Prodáno → Doručeno
//               ↑           ↑            ↑
//            K zalis-   Neprodané   Neodeslané
//            tování     (if close)   (if close)
//
// The day thresholds gate visibility: items with event farther out don't
// appear until they get close. Adjust thresholds in Settings → K dořešení.
// Sort: by daysUntil eventDate ascending within each section (nearest first).
function collectTodoItems() {
  const cfg = getAlertsConfig();
  const all = state.db.tickets || [];
  const notListed = [];
  const unsold = [];
  const undelivered = [];
  const pastEvent = [];

  for (const t of all) {
    if (cfg.mutedTicketIds.includes(t.id)) continue;

    const days = t.eventDate ? daysUntil(t.eventDate) : null;

    // PAST EVENT — date already gone but ticket isn't in a final state
    // (delivered/refunded). Highest priority bucket. Sort by how recently the
    // event passed, most recent first.
    if (days !== null && days < 0) {
      if (t.status !== 'delivered' && t.status !== 'refunded') {
        pastEvent.push({ ticket: t, days });
      }
      continue;
    }

    // "K zalistování": status=available, no day threshold. Skip past events.
    if (cfg.todoShowNotListed &&
        t.status === 'available' &&
        (days === null || days >= 0)) {
      notListed.push({ ticket: t, days: days == null ? Infinity : days });
      continue;
    }

    // For the other two we require a future eventDate.
    if (days === null || days < 0) continue;

    // "Neprodané": status=listed, event within threshold.
    if (cfg.todoShowUnsold &&
        t.status === 'listed' &&
        days <= cfg.todoUnsoldDays) {
      unsold.push({ ticket: t, days });
    } else if (cfg.todoShowUndelivered &&
               t.status === 'sold' &&
               days <= cfg.todoUndeliveredDays) {
      undelivered.push({ ticket: t, days });
    }
  }

  notListed.sort((a, b) => a.days - b.days);
  unsold.sort((a, b) => a.days - b.days);
  undelivered.sort((a, b) => a.days - b.days);
  // Past events: sort by how recently the event was (smallest |days| first).
  pastEvent.sort((a, b) => Math.abs(a.days) - Math.abs(b.days));

  return { notListed, unsold, undelivered, pastEvent };
}

function getTodoUrgencyLevel(days) {
  if (days <= 1) return 'critical';
  if (days <= 3) return 'high';
  if (days <= 5) return 'medium';
  return 'low';
}

function renderTodoItem(item, kind) {
  const t = item.ticket;
  const cfg = getAlertsConfig();

  // For notListed items where days=Infinity (no eventDate) or kind itself,
  // show a different label instead of day counter.
  let level, daysLabel, daysNum;
  if (kind === 'notListed') {
    // Always low urgency — these are reminders, not deadlines.
    // Display indicates status rather than time.
    level = 'low';
    daysNum = '●';
    daysLabel = 'KOUPENO';
  } else if (kind === 'pastEvent') {
    // Past event = always critical urgency. Show how many days AGO.
    level = 'critical';
    const ago = Math.abs(item.days);
    daysNum = ago === 0 ? '!' : ago;
    daysLabel = ago === 0 ? 'DNES' : ago === 1 ? 'VČERA' : 'DNÍ ZPĚT';
  } else {
    // Threshold depends on which action is pending: selling vs delivering.
    const threshold = kind === 'unsold' ? cfg.todoUnsoldDays : cfg.todoUndeliveredDays;
    level = getTodoUrgencyLevel(item.days, threshold);
    daysLabel = item.days === 0 ? 'DNES' : item.days === 1 ? 'ZÍTRA' : 'DNÍ';
    daysNum = item.days === 0 ? '!' : item.days;
  }

  const eventName = escapeHtml(t.eventName || t.event || '—');
  const venue = t.venue ? escapeHtml(t.venue) : '';
  const section = t.section ? `Sekce ${escapeHtml(t.section)}` : '';
  const seats = t.seat ? `Sedadla ${escapeHtml(t.seat)}` : '';
  const qty = (Number(t.quantity) || 1) + ' ks';
  const platform = t.platform ? escapeHtml(t.platform) : '';
  const account = t.account ? escapeHtml(t.account) : '';

  // For notListed items there may be no eventDate — show "Bez data" instead.
  const dateLabel = t.eventDate ? formatDate(t.eventDate) : 'Bez data';

  const metaParts = [
    `<span>${dateLabel}</span>`,
    venue ? `<span>${venue}</span>` : '',
    section ? `<span>${section}</span>` : '',
    seats ? `<span>${seats}</span>` : '',
    `<span>${qty}</span>`,
    platform ? `<span class="mono">${platform}</span>` : '',
    account ? `<span class="mono">${account}</span>` : ''
  ].filter(Boolean).join('');

  // Per-kind primary action
  let primaryAction;
  if (kind === 'unsold') {
    primaryAction = `<button class="btn btn-success btn-sm" data-todo-action="sell" data-id="${t.id}">Prodat</button>`;
  } else if (kind === 'undelivered') {
    primaryAction = `<button class="btn btn-deliver btn-sm" data-todo-action="deliver" data-id="${t.id}">✓ Doručit</button>`;
  } else if (kind === 'pastEvent') {
    // For past events, the right action depends on current status: if sold but
    // not delivered, prompt to deliver. Otherwise just open Edit so user can
    // mark it refunded / delivered / whatever applies.
    if (t.status === 'sold') {
      primaryAction = `<button class="btn btn-deliver btn-sm" data-todo-action="deliver" data-id="${t.id}">✓ Doručit</button>`;
    } else {
      primaryAction = `<button class="btn btn-dark btn-sm" data-todo-action="edit" data-id="${t.id}">Vyřešit</button>`;
    }
  } else { // notListed
    // Quick action: mark as Zalistováno (status=listed) directly.
    // Opens sell/listing flow — actually just flips status in one click.
    primaryAction = `<button class="btn btn-success btn-sm" data-todo-action="list" data-id="${t.id}" title="Označit jako Zalistováno">Zalistovat</button>`;
  }

  return `
    <div class="todo-item level-${level}" data-ticket-id="${t.id}">
      <div class="todo-item-days">
        <div class="todo-item-days-num">${daysNum}</div>
        <div class="todo-item-days-label">${daysLabel}</div>
      </div>
      <div class="todo-item-body">
        <div class="todo-item-title">${eventName}</div>
        <div class="todo-item-meta">${metaParts}</div>
      </div>
      <div class="todo-item-actions">
        ${primaryAction}
        <button class="btn btn-dark btn-sm" data-todo-action="edit" data-id="${t.id}">Edit</button>
        <button class="btn btn-dark btn-sm" data-todo-action="mute" data-id="${t.id}" title="Ztlumit upozornění">🔕</button>
      </div>
    </div>
  `;
}

function renderTodoPage() {
  const { notListed, unsold, undelivered, pastEvent } = collectTodoItems();
  const total = notListed.length + unsold.length + undelivered.length + pastEvent.length;
  const cfg = getAlertsConfig();

  // Summary cards — 4 mini cards on wider screens, wraps on narrow.
  const summary = $('#todoSummary');
  if (summary) {
    summary.innerHTML = `
      <div class="todo-summary-card total">
        <span class="todo-summary-label">CELKEM</span>
        <span class="todo-summary-value">${total}</span>
      </div>
      ${pastEvent.length > 0 ? `
      <div class="todo-summary-card past-event">
        <span class="todo-summary-label">PO TERMÍNU</span>
        <span class="todo-summary-value">${pastEvent.length}</span>
      </div>` : ''}
      <div class="todo-summary-card not-listed">
        <span class="todo-summary-label">K ZALISTOVÁNÍ</span>
        <span class="todo-summary-value">${notListed.length}</span>
      </div>
      <div class="todo-summary-card urgent-sell">
        <span class="todo-summary-label">PRODAT (do ${cfg.todoUnsoldDays} dní)</span>
        <span class="todo-summary-value">${unsold.length}</span>
      </div>
      <div class="todo-summary-card urgent-deliver">
        <span class="todo-summary-label">DORUČIT (do ${cfg.todoUndeliveredDays} dní)</span>
        <span class="todo-summary-value">${undelivered.length}</span>
      </div>
    `;
  }

  // Subtitle
  const subtitle = $('#todoSubtitle');
  if (subtitle) {
    if (total === 0) {
      subtitle.textContent = 'Všechno vyřešené. Žádné urgentní akce. 🎉';
    } else {
      subtitle.textContent = `${total} ${total === 1 ? 'položka vyžaduje' : total < 5 ? 'položky vyžadují' : 'položek vyžaduje'} tvou pozornost.`;
    }
  }

  // Sections
  const container = $('#todoSections');
  if (!container) return;

  if (total === 0) {
    const allOff = !cfg.todoShowNotListed && !cfg.todoShowUnsold && !cfg.todoShowUndelivered;
    container.innerHTML = `
      <div class="todo-empty">
        <div class="todo-empty-icon">✓</div>
        <div class="todo-empty-title">Všechno je v pořádku</div>
        <div class="todo-empty-text">
          Žádné vstupenky nevyžadují okamžitou akci.<br>
          ${allOff ? 'Všechny sekce jsou vypnuté — můžeš je zapnout v Nastavení.' : 'Až se blíží nějaký event, objeví se tu.'}
        </div>
      </div>
    `;
    return;
  }

  let html = '';

  // Section 0: Po termínu (PAST EVENT) — highest priority. Always shown when
  // any exist, regardless of cfg.todoShow* toggles, because it's a real loss
  // signal: ticket was bought, event happened, money still tied up.
  if (pastEvent.length > 0) {
    html += `
      <div class="todo-section past">
        <div class="todo-section-header">
          <div class="todo-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div>
            <div class="todo-section-title">Po termínu eventu</div>
            <div class="todo-section-hint">Event už proběhl, ale ticket není uzavřený</div>
          </div>
          <span class="todo-section-count">${pastEvent.length}</span>
        </div>
        <div class="todo-list">
          ${pastEvent.map(i => renderTodoItem(i, 'pastEvent')).join('')}
        </div>
      </div>
    `;
  }

  // Section 1: K zalistování (Koupeno, not yet Listed)
  if (cfg.todoShowNotListed && notListed.length > 0) {
    html += `
      <div class="todo-section list">
        <div class="todo-section-header">
          <div class="todo-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 11l3 3L22 4"/>
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
            </svg>
          </div>
          <div>
            <div class="todo-section-title">K zalistování</div>
            <div class="todo-section-hint">Koupeno, ještě nevystaveno na prodej</div>
          </div>
          <span class="todo-section-count">${notListed.length}</span>
        </div>
        <div class="todo-list">
          ${notListed.map(i => renderTodoItem(i, 'notListed')).join('')}
        </div>
      </div>
    `;
  }

  // Section 2: Neprodané (event se blíží)
  if (cfg.todoShowUnsold && unsold.length > 0) {
    html += `
      <div class="todo-section sell">
        <div class="todo-section-header">
          <div class="todo-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div>
            <div class="todo-section-title">Neprodané vstupenky</div>
            <div class="todo-section-hint">Zalistováno na prodej, event do ${cfg.todoUnsoldDays} dní, ještě neprodáno</div>
          </div>
          <span class="todo-section-count">${unsold.length}</span>
        </div>
        <div class="todo-list">
          ${unsold.map(i => renderTodoItem(i, 'unsold')).join('')}
        </div>
      </div>
    `;
  }

  // Section 3: Neodeslané
  if (cfg.todoShowUndelivered && undelivered.length > 0) {
    html += `
      <div class="todo-section deliver">
        <div class="todo-section-header">
          <div class="todo-section-icon">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
            </svg>
          </div>
          <div>
            <div class="todo-section-title">Neodeslané vstupenky</div>
            <div class="todo-section-hint">Status Prodáno, ještě nedoručeno kupujícímu, event do ${cfg.todoUndeliveredDays} dní</div>
          </div>
          <span class="todo-section-count">${undelivered.length}</span>
        </div>
        <div class="todo-list">
          ${undelivered.map(i => renderTodoItem(i, 'undelivered')).join('')}
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Bind action handlers (reuse existing ticket action functions)
  container.querySelectorAll('[data-todo-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const action = btn.dataset.todoAction;
      const ticket = state.db.tickets.find(t => t.id === id);
      if (!ticket) return;
      if (action === 'sell') openSellModal(ticket);
      else if (action === 'deliver') markDelivered(id);
      else if (action === 'edit') openTicketModal(ticket);
      else if (action === 'mute') muteTicket(id);
      else if (action === 'list') openListModal(ticket);
    });
  });
}

// Quick action: flip a ticket's status from 'available' (Koupeno) → 'listed' (Zalistováno)
// without opening the full edit modal. Saves and re-renders.
async function markAsListed(id) {
  const ticket = state.db.tickets.find(t => t.id === id);
  if (!ticket) return;
  ticket.status = 'listed';
  await window.api.upsertTicket(ticket);
  await refreshDb();
  render();
  toast('Označeno jako Zalistováno', 'success', 2000);
}

function updateTodoBadge() {
  const badge = $('#navTodoBadge');
  if (!badge) return;
  const { notListed, unsold, undelivered, pastEvent } = collectTodoItems();
  const total = notListed.length + unsold.length + undelivered.length + pastEvent.length;
  if (total > 0) {
    badge.textContent = total;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

// ============ VIEWS ============
function switchView(name) {
  state.currentView = name;
  $$('.view').forEach(v => v.classList.remove('active'));
  $('#view-' + name).classList.add('active');
  $$('.nav-item[data-view]').forEach(n => n.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-view="${name}"]`);
  if (navBtn) navBtn.classList.add('active');

  // Marketplace views need the .main container to drop its padding/overflow
  // so the embedded webview fills edge-to-edge. We toggle a body class as a
  // belt-and-braces fallback to the CSS :has() selector — older renderers
  // or future Electron upgrades that disable :has() will still work.
  document.body.classList.toggle(
    'marketplace-active',
    name === 'stubhub' || name === 'viagogo' || name === 'salespro' || name === 'invviagogo'
  );
  
  if (name === 'stats') renderStatsPage();
  if (name === 'memberships') renderMembershipsPage();
  if (name === 'mailboxes') renderMailboxesPage();
  if (name === 'simcards') renderSimcardsPage();
  if (name === 'expenses') renderExpensesPage();
  if (name === 'payouts') renderPayoutsPage();
  if (name === 'inbox') renderInboxPage();
  if (name === 'todo') renderTodoPage();
  if (name === 'stubhub' || name === 'viagogo' || name === 'salespro' || name === 'invviagogo') ensureMarketplaceLoaded(name);
  // Refresh user list whenever Settings is opened so admins see latest state.
  if (name === 'settings') {
    renderUsersList();
    loadEmailSettingsUI();
    loadCurrencySettingsUI();
    loadMailForwardUI();
  }
}

// ============ MARKETPLACES (Stubhub + Viagogo embedded webviews) ============
// Each marketplace lives in its own <webview> with a persist:* partition so
// cookies/login survive across app restarts. We attach event listeners once
// per webview (lazy, on first switchView), then drive the toolbar from the
// webview's actual state via did-navigate / did-start-loading events.

// Tracks which marketplaces have already had their listeners wired up.
const _marketplaceWired = new Set();

// Set the webview preload URL on all <webview> elements as early as possible,
// before they attach and start loading. Preload provides the zoom bridge
// (see webview-preload.js). We use file:// resolved against this document so
// it works in both dev and packaged builds.
function _initMarketplaceWebviewPreloads() {
  try {
    const preloadUrl = new URL('webview-preload.js', window.location.href).href;
    document.querySelectorAll('webview.mkt-webview').forEach(wv => {
      // Only set if not already set (don't clobber on hot-reload).
      if (!wv.getAttribute('preload')) {
        wv.setAttribute('preload', preloadUrl);
      }
    });
  } catch (e) {
    console.warn('Failed to set webview preload:', e);
  }
}
// Run synchronously on script load — DOM is parsed by this point because
// our <script> tag is at the bottom of body. Webviews don't start fetching
// until next tick, so we beat the load.
_initMarketplaceWebviewPreloads();

// Default landing pages. "Home" button returns here; we also use this URL to
// detect an unloaded webview (still pointing at src=).
const MARKETPLACE_HOMES = {
  stubhub: 'https://www.stubhub.ie/my/sales',
  viagogo: 'https://my.viagogo.com/sales',
  salespro: 'https://salespro.stubhub.ie/',
  invviagogo: 'https://inv.viagogo.com/'
};

// Per-marketplace zoom factor — Electron <webview> doesn't persist zoom on
// its own and Ctrl+wheel/+/- shortcuts don't bubble up from inside the
// webview. We track a multiplier and apply it via setZoomFactor on each
// webview, plus restore on did-finish-load (zoom resets after navigation).
const _marketplaceZoom = { stubhub: 1, viagogo: 1, salespro: 1, invviagogo: 1 };
const ZOOM_STEP = 0.1;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.0;

function ensureMarketplaceLoaded(name) {
  if (_marketplaceWired.has(name)) return;
  const wv = document.getElementById('webview-' + name);
  if (!wv) return;
  _marketplaceWired.add(name);

  const urlEl = document.getElementById('mktUrl' + name.charAt(0).toUpperCase() + name.slice(1));
  const loadingEl = document.getElementById('mktLoading' + name.charAt(0).toUpperCase() + name.slice(1));

  // URL bar reflects the current page so the user knows where they are
  // (especially useful after multi-step OAuth flows that bounce between domains).
  const updateUrl = () => {
    try {
      const u = wv.getURL();
      if (urlEl && u) urlEl.textContent = u;
    } catch (_) { /* webview not ready yet, ignore */ }
  };

  wv.addEventListener('did-start-loading', () => {
    if (loadingEl) loadingEl.classList.add('active');
  });
  wv.addEventListener('did-stop-loading', () => {
    if (loadingEl) loadingEl.classList.remove('active');
    updateUrl();
    updateNavButtons(name);
  });
  // did-navigate fires for top-level navigations (full page loads).
  // did-navigate-in-page fires for SPA-style hash/history changes — both portals
  // use these once you're logged in, so we listen to both.
  wv.addEventListener('did-navigate', updateUrl);
  wv.addEventListener('did-navigate-in-page', updateUrl);

  // If a load fails (network down, blocked resource), drop the spinner instead
  // of leaving it spinning forever.
  wv.addEventListener('did-fail-load', (e) => {
    if (loadingEl) loadingEl.classList.remove('active');
    // -3 = ABORTED (intentional, e.g. user clicked back) — not an error.
    if (e.errorCode !== -3) {
      console.warn('[' + name + '] did-fail-load:', e.errorCode, e.errorDescription);
    }
  });

  // Zoom restore — Electron resets zoomFactor to 1 on every navigation, so
  // we re-apply the saved zoom whenever a page finishes loading. Without this
  // the user has to keep re-zooming after every page load.
  wv.addEventListener('did-finish-load', () => {
    try { wv.setZoomFactor(_marketplaceZoom[name] || 1); } catch (_) {}
  });

  // Zoom keyboard shortcuts + Ctrl+wheel inside the webview — the events
  // don't bubble out of <webview>, so a tiny preload script (webview-preload.js)
  // captures them and forwards via ipcRenderer.sendToHost('zoom', delta).
  // We listen for that here on the host side and adjust zoom accordingly.
  wv.addEventListener('ipc-message', (e) => {
    if (e.channel === 'zoom') {
      const delta = e.args && e.args[0];
      adjustMarketplaceZoom(name, delta);
    }
  });
}

// Bump zoom up/down by ZOOM_STEP, or reset to 1.0. Updates the chip in the
// toolbar so the user sees current zoom level.
function adjustMarketplaceZoom(name, direction) {
  const wv = document.getElementById('webview-' + name);
  if (!wv) return;
  let z = _marketplaceZoom[name] || 1;
  if (direction === 'reset' || direction === 0) {
    z = 1;
  } else if (direction === 1 || direction > 0) {
    z = Math.min(ZOOM_MAX, z + ZOOM_STEP);
  } else if (direction === -1 || direction < 0) {
    z = Math.max(ZOOM_MIN, z - ZOOM_STEP);
  }
  // Round to avoid float drift (e.g. 0.7000000000000001).
  z = Math.round(z * 100) / 100;
  _marketplaceZoom[name] = z;
  try { wv.setZoomFactor(z); } catch (_) {}

  // Update the "100%" chip label in the toolbar.
  const label = document.querySelector(`.mkt-btn[data-mkt-action="zoom-reset"][data-mkt="${name}"]`);
  if (label) label.textContent = Math.round(z * 100) + '%';
}

// Enable/disable the back/forward buttons based on whether the embedded web
// session has history in that direction. Saves the user from clicking dead
// buttons on a fresh page.
function updateNavButtons(name) {
  const wv = document.getElementById('webview-' + name);
  if (!wv) return;
  const back = document.querySelector(`.mkt-btn[data-mkt-action="back"][data-mkt="${name}"]`);
  const fwd = document.querySelector(`.mkt-btn[data-mkt-action="forward"][data-mkt="${name}"]`);
  try {
    if (back) back.disabled = !wv.canGoBack();
    if (fwd) fwd.disabled = !wv.canGoForward();
  } catch (_) { /* webview not ready, ignore */ }
}

// One handler for all marketplace toolbar buttons — back, forward, reload,
// home, external. Driven by data-attributes set in HTML.
function handleMarketplaceAction(action, name, externalUrl) {
  if (action === 'external') {
    // ↗ button — open in user's default browser via shell.openExternal.
    // The renderer doesn't have shell directly; we go through preload's window.api.
    const url = externalUrl || MARKETPLACE_HOMES[name];
    if (url && window.api?.openExternal) {
      window.api.openExternal(url);
    } else if (url) {
      // Fallback for older preload — use a temp anchor which Electron intercepts.
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.click();
    }
    return;
  }
  if (action === 'quickadd') {
    quickAddFromMarketplace(name);
    return;
  }
  if (action === 'zoom-in') { adjustMarketplaceZoom(name, 1); return; }
  if (action === 'zoom-out') { adjustMarketplaceZoom(name, -1); return; }
  if (action === 'zoom-reset') { adjustMarketplaceZoom(name, 'reset'); return; }
  const wv = document.getElementById('webview-' + name);
  if (!wv) return;
  try {
    if (action === 'back' && wv.canGoBack()) wv.goBack();
    else if (action === 'forward' && wv.canGoForward()) wv.goForward();
    else if (action === 'reload') wv.reload();
    else if (action === 'home') wv.loadURL(MARKETPLACE_HOMES[name]);
  } catch (e) {
    console.warn('Marketplace action failed:', action, name, e);
  }
}

// ============ MARKETPLACE QUICK-ADD ============
// Scrapes the currently-displayed marketplace page for ticket data and opens
// the Add Ticket modal pre-filled. Runs JS inside the webview via
// executeJavaScript — that means we read the DOM AS THE LOGGED-IN USER sees
// it, bypassing bot detection (we ARE the user). The trade-off is fragility:
// when Stubhub/Viagogo redesign their pages, the selectors break.
//
// We extract from three sources in order of reliability:
//   1) JSON-LD <script type="application/ld+json"> — SEO microdata, stable
//   2) Page title + URL — fallback for event name + IDs
//   3) DOM selectors — last resort, most fragile

// The scraper script runs in the webview's isolated world. It must be a
// self-contained string (no closures over renderer-side variables). Returns
// a plain object with either a single item OR an array of items found on
// the page (for list-style pages like "My Sales" overview).
const MARKETPLACE_SCRAPER_SCRIPT = `
(function() {
  const result = {
    success: false,
    url: location.href,
    title: document.title,
    pageType: 'other',  // 'sale' | 'listing' | 'event' | 'other'
    multiple: false,    // true when items[] has >1 entries (list-style page)
    items: []           // each: {eventName, eventDate, venue, country, section, row, quantity, salePrice, saleCurrency, listingId, saleId, label}
  };

  // ----- Detect overall page type from URL -----
  const url = location.href;
  const isViagogoSale = /viagogo\\.com\\/.*sale/i.test(url);
  const isViagogoListing = /viagogo\\.com\\/.*listing/i.test(url);
  const isStubhubSale = /stubhub\\.[a-z]+\\/.*\\/(sale|order)/i.test(url);
  const isStubhubListing = /stubhub\\.[a-z]+\\/.*listing/i.test(url);

  if (isViagogoSale || isStubhubSale) result.pageType = 'sale';
  else if (isViagogoListing || isStubhubListing) result.pageType = 'listing';
  else result.pageType = 'event';

  try {
    // ----- Strategy: find repeated "card" elements that contain a sale/listing.
    // Viagogo "My Sales" renders each sale in a container that has
    // "Sale No.", "Show details" link, and a price block. Same for "My Listings"
    // ("Listing No." instead of "Sale No.").
    //
    // We find the SMALLEST element containing both "Sale No. NNNN" and a price,
    // then walk up to find sibling cards with the same shape.

    const bodyText = document.body.textContent || '';
    const idMatches = [...bodyText.matchAll(/(Sale\\s*(?:No\\.?|number)|Listing\\s*(?:No\\.?|number)|Order\\s*[#:])\\s*[:#]?\\s*(\\d{6,})/gi)];

    // If the page mentions multiple distinct sale/listing IDs, it's a list page.
    const uniqueIds = [...new Set(idMatches.map(m => m[2]))];

    // Detect SalesPro layout — different from Viagogo/Stubhub.ie. SalesPro
    // sale cards don't have visible Sale No. — they have "Prodeje"/"Sales"
    // and "Platba"/"Payment" labels inside each card. We find them by walking
    // the DOM for elements that contain BOTH labels.
    const isSalesPro = /salespro\\.stubhub/i.test(location.href);
    if (isSalesPro && uniqueIds.length === 0) {
      // Look for repeated card containers — each has "Prodeje" + "Platba" labels
      // AND a venue+date row. We use the date strings as anchors (each card has
      // a unique combination of date + price).
      const allElements = document.querySelectorAll('[class*="row"], [class*="card"], [class*="item"], [class*="sale"], li, tr, [role="listitem"]');
      const seenCards = new Set();
      allElements.forEach(el => {
        const txt = el.textContent || '';
        // Must have Sales + Payment-like text AND a venue/date.
        const hasSalesPaymentLabels = /Prodeje|Sales/i.test(txt) && /Platba|Payment/i.test(txt);
        const hasDate = /\\b\\d{1,2}-\\d{1,2}-\\d{4}\\b/.test(txt) || /\\b\\d{1,2}\\.\\d{1,2}\\.\\d{4}\\b/.test(txt);
        const hasPrice = /\\d{1,3}(?:[\\s.,]\\d{3})*[.,]\\d{2}/.test(txt);
        const reasonableSize = txt.length > 30 && txt.length < 1500;
        if (hasSalesPaymentLabels && hasDate && hasPrice && reasonableSize) {
          // Avoid duplicates — if this element is INSIDE one we already accepted,
          // skip it (we want the OUTERMOST card-sized element, not nested).
          // Conversely, if a parent already accepted, skip too.
          let parent = el.parentElement;
          let parentSeen = false;
          while (parent) {
            if (seenCards.has(parent)) { parentSeen = true; break; }
            parent = parent.parentElement;
          }
          if (parentSeen) return;
          seenCards.add(el);
        }
      });
      const salesproCards = [...seenCards];

      if (salesproCards.length > 0) {
        salesproCards.forEach((card, idx) => {
          const cardTxt = card.textContent || '';

          // First pull the date out — it's our anchor for splitting event/venue.
          // SalesPro: "st, 17-06-2026 3:00 pm" or "17-06-2026" — dash format.
          let eventDate = '';
          const dashDate = cardTxt.match(/(\\d{1,2})-(\\d{1,2})-(\\d{4})/);
          const dotDate = cardTxt.match(/(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})/);
          if (dashDate) {
            eventDate = dashDate[3] + '-' + dashDate[2].padStart(2,'0') + '-' + dashDate[1].padStart(2,'0');
          } else if (dotDate) {
            eventDate = dotDate[3] + '-' + dotDate[2].padStart(2,'0') + '-' + dotDate[1].padStart(2,'0');
          }

          // Strategy for event name + venue:
          // SalesPro packs them into one text run like:
          //   "England vs Croatia - Group L - Football World Cup 2026 - ...AT&T Stadium, Arlington, TX, US st, 17-06-2026 3:00 pm Prodeje 3 287,24 USD..."
          // We want to split where venue starts. Venue almost always contains
          // a building suffix (Stadium/Arena/Hall/Park/Stade/Estadio/Centre)
          // OR is a comma-list (Venue, City, ...) right before the date.
          //
          // Approach: find the substring BEFORE the date, then within that
          // substring find the LAST building-suffix word — everything before
          // that word is event name, from there onwards is venue.

          let textBeforeDate = cardTxt;
          if (dashDate) {
            // Find position of first date weekday hint or the date itself.
            const dateIdx = cardTxt.indexOf(dashDate[0]);
            if (dateIdx > 0) {
              // Also strip Czech weekday prefixes like "st, " before the date.
              // We want everything UP TO that, minus optional weekday.
              textBeforeDate = cardTxt.slice(0, dateIdx)
                .replace(/\\s*(po|út|st|čt|pá|so|ne|mon|tue|wed|thu|fri|sat|sun)[,.]?\\s*$/i, '')
                .trim();
            }
          } else if (dotDate) {
            const dateIdx = cardTxt.indexOf(dotDate[0]);
            if (dateIdx > 0) {
              textBeforeDate = cardTxt.slice(0, dateIdx)
                .replace(/\\s*(po|út|st|čt|pá|so|ne|mon|tue|wed|thu|fri|sat|sun)[,.]?\\s*$/i, '')
                .trim();
            }
          }

          // Now split textBeforeDate into event + venue.
          // Find the LAST occurrence of a building-suffix word in textBeforeDate
          // (last because event name might contain words like "Park" too —
          // e.g. "Linkin Park" — and we want the venue's suffix, not the band's).
          let eventName = '';
          let venue = '';
          const suffixRegex = /\\b(Stadium|Arena|Hall|Centre|Center|Park|Stade|Estadio|Stadion|Forum|Amphitheatre|Amphitheater|Coliseum|Field|Bowl|Garden|Gardens|Theatre|Theater|Auditorium)\\b/gi;
          let lastSuffixMatch = null;
          let m;
          while ((m = suffixRegex.exec(textBeforeDate)) !== null) {
            lastSuffixMatch = m;
          }
          if (lastSuffixMatch) {
            // Walk backward from the suffix to find where the venue name starts.
            // Venue name typically begins after a sentence/event boundary —
            // capital letter following a non-letter character (space, punctuation).
            const suffixEnd = lastSuffixMatch.index + lastSuffixMatch[0].length;
            // From the suffix word, walk backward up to N characters and find
            // the start of a capitalized "venue chunk".
            // Simpler: take the last 60 chars before suffix end, and start from
            // the first capital letter after a space.
            const before = textBeforeDate.slice(0, lastSuffixMatch.index);
            // Try splitting at last punctuation/sentence boundary that signals
            // a separator. We accept event name endings like "Match 22" or
            // "London" — typically followed directly by venue without delimiter.
            // Heuristic: the venue word is the last 1-5 capitalized words BEFORE
            // the suffix. We greedily back up as long as words are Title Case.
            const wordsBefore = before.match(/(?:[A-Z][\\w&'.\\-]*\\s*){1,6}$/);
            if (wordsBefore) {
              const venueStart = before.length - wordsBefore[0].length;
              eventName = textBeforeDate.slice(0, venueStart).trim();
              venue = textBeforeDate.slice(venueStart, suffixEnd).trim();
              // The remainder after suffix is "city, country" — append.
              const after = textBeforeDate.slice(suffixEnd).trim();
              // Trim leading punctuation
              const afterClean = after.replace(/^[,\\s]+/, '').trim();
              if (afterClean) venue = venue + ', ' + afterClean;
            } else {
              // Couldn't isolate venue word — take everything as venue
              venue = textBeforeDate.slice(0, suffixEnd).trim();
              const after = textBeforeDate.slice(suffixEnd).trim().replace(/^[,\\s]+/, '');
              if (after) venue = venue + ', ' + after;
            }
          } else {
            // No building suffix — try comma-split: "Venue, City, State, Country"
            // The first comma's left side is venue, right side is location info.
            const firstComma = textBeforeDate.indexOf(',');
            if (firstComma > 5 && firstComma < textBeforeDate.length - 5) {
              // Heuristic: assume the part BEFORE the first comma is venue if it
              // looks venue-like (Title Case + short). Otherwise whole text is event.
              const beforeComma = textBeforeDate.slice(0, firstComma).trim();
              if (beforeComma.length < 50 && /^[A-Z]/.test(beforeComma)) {
                venue = textBeforeDate.trim();
                eventName = '';
              } else {
                eventName = textBeforeDate.trim();
              }
            } else {
              eventName = textBeforeDate.trim();
            }
          }

          // Clean event name — strip trailing dashes/spaces
          eventName = eventName.replace(/[\\s\\-]+$/, '').trim();
          // Clean venue — collapse double commas/spaces
          venue = venue.replace(/,\\s*,/g, ',').replace(/\\s{2,}/g, ' ').trim();

          // If event name is empty but we have venue, leave event empty —
          // user will see "Sale #?" and venue, can match by venue alone.

          // Prices — SalesPro shows "Prodeje: X", "Platba: Y" with mezery as thousand sep
          // ("3 287,24 USD"). Largest price = total sale.
          let salePrice = null, saleCurrency = null;
          // Pattern: number with optional spaces, comma decimal, then 3-letter currency code
          const priceRegex = /(\\d{1,3}(?:[\\s.]\\d{3})*[.,]\\d{2})\\s*(USD|EUR|GBP|CZK|PLN|CHF|AUD|CAD)/g;
          let priceMatch;
          let bestPrice = null;
          while ((priceMatch = priceRegex.exec(cardTxt)) !== null) {
            const raw = priceMatch[1].replace(/[\\s.]/g, '').replace(',', '.');
            const num = parseFloat(raw);
            if (!isNaN(num) && num > 0 && num < 1e7) {
              if (!bestPrice || num > bestPrice.amount) {
                bestPrice = { amount: num, currency: priceMatch[2] };
              }
            }
          }
          if (bestPrice) {
            salePrice = bestPrice.amount;
            saleCurrency = bestPrice.currency;
          }

          // Section / row / qty — try common patterns
          const sectionMatch = cardTxt.match(/Section\\s+([A-Z0-9]{1,8})|Sekce\\s+([A-Z0-9]{1,8})/i);
          const rowMatch = cardTxt.match(/Row\\s+([A-Z0-9]{1,4})|řada\\s+([A-Z0-9]{1,4})/i);
          const qtyMatch = cardTxt.match(/(\\d{1,3})\\s+(Tickets?|vstupenek)\\b/i);

          const item = {
            eventName: (eventName || '').replace(/\\s*tickets?\\s*$/i, '').trim(),
            eventDate: eventDate,
            venue: venue,
            country: '',
            section: sectionMatch ? (sectionMatch[1] || sectionMatch[2]) : null,
            row: rowMatch ? (rowMatch[1] || rowMatch[2]) : null,
            quantity: qtyMatch ? parseInt(qtyMatch[1], 10) : null,
            salePrice: salePrice,
            saleCurrency: saleCurrency,
            listingId: null,
            saleId: null, // SalesPro doesn't expose IDs in the list view — only on click
            pageType: 'sale',
            label: [eventName, sectionMatch ? 'Sec '+(sectionMatch[1]||sectionMatch[2]) : '', salePrice ? salePrice + ' ' + (saleCurrency||'') : '']
              .filter(Boolean).join(' · ')
          };
          result.items.push(item);
        });

        result.multiple = result.items.length > 1;
        result.success = result.items.length > 0;
        result.pageType = 'sale';
      }
    }

    if (uniqueIds.length > 1) {
      // ----- Multi-item list page -----
      // STRATEGY: For each ID, find its text node, then walk UP only as far
      // as needed — STOP the moment the next ancestor would also contain
      // a DIFFERENT ID. That gives us the smallest container that holds
      // exactly one card's worth of data. The previous heuristic walked too
      // far and ended up extracting from the whole page.

      const seen = new Set();
      uniqueIds.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);

        // Find the first text node that contains this ID.
        const xpathResult = document.evaluate(
          \`//text()[contains(., '\${id}')]\`,
          document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null
        );
        const textNode = xpathResult.singleNodeValue;
        if (!textNode) return;

        // Walk up — keep going while the parent contains ONLY our ID.
        // The moment a parent ALSO contains another card's ID, we've gone
        // too far → use the previous (still-clean) container.
        let card = textNode.parentElement;
        let lastClean = null;
        let safety = 25;
        const otherIds = uniqueIds.filter(x => x !== id);

        while (card && safety-- > 0) {
          const txt = card.textContent || '';
          // If this container leaks into a sibling card, stop.
          const containsOther = otherIds.some(other => txt.includes(other));
          if (containsOther) break;
          // If the container has actually grown to include the whole page
          // (text length explodes), stop too — defensive bound.
          if (txt.length > 6000) break;
          lastClean = card;
          card = card.parentElement;
        }
        if (!lastClean) return;
        const bestCard = lastClean;
        const cardTxt = bestCard.textContent || '';

        // ----- Event name -----
        // Strategy 1: <a> link inside card with event-style href
        let eventName = '';
        const eventLinkSelectors = [
          'a[href*="/concerts/"]',
          'a[href*="/sports/"]',
          'a[href*="/theatre/"]',
          'a[href*="/event/"]',
          'a[href*="/Event/"]',
          'a[href*="-tickets"]'
        ];
        for (const sel of eventLinkSelectors) {
          const link = bestCard.querySelector(sel);
          if (link && link.textContent && link.textContent.trim().length > 1) {
            eventName = link.textContent.trim();
            break;
          }
        }
        // Strategy 2: text that appears immediately BEFORE "Sale No." in the
        // card (Viagogo cards render: <h-something>Event Name</h><a>↗</a><br>Sale No. ...).
        // Walk DOM order and grab last non-empty text element before the ID.
        if (!eventName) {
          const allTextEls = bestCard.querySelectorAll('h1,h2,h3,h4,h5,h6,[role="heading"],strong,b,span,div,p');
          let lastBeforeId = '';
          for (const el of allTextEls) {
            const t = (el.textContent || '').trim();
            // Stop once we hit the Sale No. text — last 'good' text before that wins.
            if (/Sale\\s*No\\.|Listing\\s*No\\.|Order\\s*[#:]/i.test(t) && t.length < 60) break;
            // Skip page-title leaks, status pills, generic UI labels.
            if (/viagogo|stubhub|ticket marketplace|concert,?\\s*sport/i.test(t)) continue;
            if (/^(Open|Closed|Show details|Sale|Listing|Transfer pending|Confirm|See actions|Upload|Total price|Section|Row|Tickets)$/i.test(t)) continue;
            // Skip if too short (likely just a label) or too long (full card text).
            if (t.length < 2 || t.length > 120) continue;
            // Skip if mostly digits/punctuation.
            if (!/[a-zA-Z]{3,}/.test(t)) continue;
            lastBeforeId = t;
          }
          if (lastBeforeId) eventName = lastBeforeId;
        }
        // Strategy 3: very last fallback — first non-empty card text line
        if (!eventName) {
          const lines = (cardTxt || '').split(/\\n+/).map(s => s.trim()).filter(Boolean);
          for (const line of lines) {
            if (/viagogo|stubhub|ticket marketplace/i.test(line)) continue;
            if (/^(Open|Closed|Sale|Listing)$/i.test(line)) continue;
            if (line.length > 1 && line.length < 120 && /[a-zA-Z]{3,}/.test(line)) {
              eventName = line;
              break;
            }
          }
        }
        // Strip generic suffixes.
        eventName = eventName
          .replace(/\\s*[|–-]\\s*viagogo.*$/i, '')
          .replace(/\\s*[|–-]\\s*stubhub.*$/i, '')
          .replace(/\\s+tickets?\\s*$/i, '')
          .replace(/\\s*↗\\s*$/, '') // strip trailing ↗ icon if it leaked
          .trim();

        // ----- Date — only from this card's text -----
        // Tries multiple formats in order of specificity:
        //   ISO: 2026-05-19
        //   dd.mm.yyyy: 19.05.2026 (CZ/SK)
        //   dd-mm-yyyy: 17-06-2026 (SalesPro)
        //   "19 May" / "19 May 2026" / "Tue, 19 May 2026"
        let eventDate = '';
        const isoMatch = cardTxt.match(/(\\d{4})-(\\d{2})-(\\d{2})/);
        const dotMatch = cardTxt.match(/\\b(\\d{1,2})\\.(\\d{1,2})\\.(\\d{4})\\b/);
        const dashMatch = cardTxt.match(/\\b(\\d{1,2})-(\\d{1,2})-(\\d{4})\\b/);
        // "19 May" (UK/EU) and "May 19" (US) — both common on Viagogo.
        const dmonthMatch = cardTxt.match(/\\b(\\d{1,2})\\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\b/);
        const monthdMatch = !dmonthMatch && cardTxt.match(/\\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s+(\\d{1,2})\\b/);
        const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
        const findYear = (anchor) => {
          // Try directly around the anchor first.
          const near = cardTxt.match(new RegExp(anchor+'[^\\\\d]{0,30}(20[2-3]\\\\d)'));
          if (near) return near[1];
          // Fallback: any year in card.
          const any = cardTxt.match(/\\b(20[2-3]\\d)\\b/);
          return any ? any[1] : String(new Date().getFullYear());
        };
        if (isoMatch) {
          eventDate = isoMatch[1] + '-' + isoMatch[2] + '-' + isoMatch[3];
        } else if (dotMatch) {
          eventDate = dotMatch[3] + '-' + dotMatch[2].padStart(2,'0') + '-' + dotMatch[1].padStart(2,'0');
        } else if (dashMatch) {
          eventDate = dashMatch[3] + '-' + dashMatch[2].padStart(2,'0') + '-' + dashMatch[1].padStart(2,'0');
        } else if (dmonthMatch) {
          eventDate = findYear(dmonthMatch[2]) + '-' + monthMap[dmonthMatch[2]] + '-' + dmonthMatch[1].padStart(2,'0');
        } else if (monthdMatch) {
          eventDate = findYear(monthdMatch[1]) + '-' + monthMap[monthdMatch[1]] + '-' + monthdMatch[2].padStart(2,'0');
        }

        // ----- Section / row / qty / venue — local to card -----
        // textContent of adjacent DOM siblings has NO whitespace between them.
        // So "Section 20G" + "2 Tickets" in DOM becomes "Section 20G2 Tickets"
        // in textContent — making regex fragile (G2 looks like one word).
        //
        // Solution: walk individual ELEMENTS in the card and extract each
        // attribute from its OWN element's text. Each "Section 20G", "Row 132",
        // "2 Tickets" lives in a separate <span> or <div>.
        let sectionVal = null, rowVal = null, qtyVal = null;
        const childEls = bestCard.querySelectorAll('*');
        for (const el of childEls) {
          // Skip elements that have child elements with their own text — we want
          // LEAF text nodes (smallest containers).
          // Instead of recursing, just check direct textContent — even if it
          // includes children, the regex matches PER-element, so as long as the
          // element text itself contains "Section 20G" cleanly without trailing
          // qty digits, we're good.
          const t = (el.textContent || '').trim();
          // Skip empty or huge containers (the whole card would match too).
          if (!t || t.length > 80) continue;

          if (!sectionVal) {
            const m = t.match(/^(?:Section|Sekce)\\s+([A-Z0-9][\\w\\s/\\-]{0,30})$/i);
            if (m) sectionVal = m[1].trim();
          }
          if (!rowVal) {
            const m = t.match(/^(?:Row|\u0159ada)\\s+([A-Z0-9][\\w\\s/\\-]{0,12})$/i);
            if (m) rowVal = m[1].trim();
          }
          if (!qtyVal) {
            const m = t.match(/^(\\d{1,3})\\s*(?:Tickets?|vstupenek|vstupenky|ks)$/i);
            if (m) qtyVal = parseInt(m[1], 10);
          }
        }
        // Last resort: regex on whole textContent if per-element scan missed something.
        if (!sectionVal) {
          const m = cardTxt.match(/(?:Section|Sekce)\\s+([A-Z0-9](?:[\\w\\s/\\-]{0,12}?[A-Za-z]|[A-Z0-9]{0,3}))(?=\\d{1,3}\\s*(?:Tickets|vstupenek|vstupenky|ks)|Row\\b|\u0159ada\\b|Total|Transfer|See|Confirm|$)/i);
          if (m) sectionVal = m[1].trim();
        }
        if (!rowVal) {
          // For row, the textContent fallback is hard — row numbers like 132
          // can blend into qty. Try a tight pattern that requires Row + space + alnum.
          const m = cardTxt.match(/(?:Row|\u0159ada)\\s+([A-Z]{1,2}|[A-Z]?\\d{1,4})(?=[A-Z]|\\d{1,2}\\s*Tickets|$)/i);
          if (m) rowVal = m[1].trim();
        }
        if (!qtyVal) {
          // qty: the LAST 1-2 digit run before "Tickets"/etc — preceded by non-digit
          // (so we don't pick up trailing digits from row/section).
          const matches = [...cardTxt.matchAll(/(?:[A-Za-z]|^|\\s)(\\d{1,2})\\s*(?:Tickets?|vstupenek|vstupenky|ks)\\b/gi)];
          if (matches.length > 0) qtyVal = parseInt(matches[matches.length - 1][1], 10);
        }
        let venue = '';
        const venueMatch = cardTxt.match(/([A-Z][\\w'\\-]*(?:\\s+[\\w'\\-]+){0,5}\\s+(Stadium|Arena|Hall|Centre|Center|Park|Stade|Estadio))[,\\s]/i);
        if (venueMatch) venue = venueMatch[1].trim();

        // ----- Price — only from this card's text -----
        // Currency can appear BEFORE the number (€236.40, Kč13011.29) OR
        // AFTER (236.40 €, 1500.00 EUR). Different markets format differently.
        // Number can use either '.' or ',' as decimal sep, and either ' ' or
        // ',' as thousand sep (locale dependent). We collect all candidates
        // and take the largest = "Total price" (not per-ticket).
        let salePrice = null, saleCurrency = null;
        const curMap = { '€':'EUR','$':'USD','£':'GBP','Kč':'CZK','K\u010d':'CZK' };
        const allPrices = [];
        // Pattern A: SYMBOL/CODE then number — €236.40, Kč13011.29, €1054.80
        // Use \\d+ (not \\d{1,3}) so we capture 4+ digit numbers without
        // thousand separators (Viagogo with EUR sometimes shows "€1054.80").
        const pricePatternBefore = /(K\u010d|EUR|USD|GBP|CZK|PLN|CHF|[€$£])\\s*(\\d+(?:[\\s,.]\\d{3})*(?:[.,]\\d{2})?)/g;
        // Pattern B: number then SYMBOL/CODE — 236.40 €, 1500.00 EUR
        const pricePatternAfter = /(\\d+(?:[\\s,.]\\d{3})*(?:[.,]\\d{2})?)\\s*(K\u010d|EUR|USD|GBP|CZK|PLN|CHF|[€$£])/g;

        // Robust numeric parser. Looks at the LAST separator: if followed by
        // 1-2 digits → it's the decimal separator; otherwise (3 digits) it's
        // a thousand separator and the number has no decimal.
        const parseLocaleNum = (s) => {
          s = s.replace(/\\s/g, '');
          const lastSep = Math.max(s.lastIndexOf('.'), s.lastIndexOf(','));
          if (lastSep === -1) return parseFloat(s);
          const tail = s.slice(lastSep + 1);
          if (tail.length >= 1 && tail.length <= 2) {
            // Last sep is decimal. Strip all other separators from int part.
            return parseFloat(s.slice(0, lastSep).replace(/[.,]/g, '') + '.' + tail);
          }
          // 3 digits after last sep → it was a thousand separator.
          return parseFloat(s.replace(/[.,]/g, ''));
        };

        const collectPrices = (regex, curIndex, numIndex) => {
          let m;
          while ((m = regex.exec(cardTxt)) !== null) {
            const cur = m[curIndex];
            const num = parseLocaleNum(m[numIndex]);
            if (!isNaN(num) && num > 0 && num < 1e7) {
              allPrices.push({ amount: num, currency: curMap[cur] || cur.toUpperCase() });
            }
          }
        };
        collectPrices(pricePatternBefore, 1, 2);
        collectPrices(pricePatternAfter, 2, 1);

        if (allPrices.length > 0) {
          // Largest = total. Tie-break by currency (prefer non-empty).
          allPrices.sort((a, b) => b.amount - a.amount);
          salePrice = allPrices[0].amount;
          saleCurrency = allPrices[0].currency;
        }

        // Detect this card's type (sale vs listing) from its own text.
        let cardType = result.pageType;
        if (/Sale\\s*No\\.|Order\\s*[#:]/i.test(cardTxt)) cardType = 'sale';
        else if (/Listing\\s*No\\./i.test(cardTxt)) cardType = 'listing';

        const item = {
          eventName: eventName.replace(/\\s*tickets?\\s*$/i, '').trim(),
          eventDate: eventDate,
          venue: venue,
          country: '',
          section: sectionVal,
          row: rowVal,
          quantity: qtyVal,
          salePrice: salePrice,
          saleCurrency: saleCurrency,
          listingId: cardType === 'listing' ? id : null,
          saleId: cardType === 'sale' ? id : null,
          pageType: cardType,
          label: [eventName || ('Sale #'+id), sectionVal ? 'Sec '+sectionVal : '', salePrice ? salePrice + ' ' + (saleCurrency||'') : '']
            .filter(Boolean).join(' · ')
        };
        result.items.push(item);
      });

      result.multiple = result.items.length > 1;
      result.success = result.items.length > 0;
    }

    // ----- Single-item / detail page fallback -----
    // If we didn't find multiple cards, fall back to the original whole-page scrape.
    if (result.items.length === 0) {
      const single = {
        eventName: null, eventDate: null, venue: null, country: null,
        section: null, row: null, seat: null, quantity: null,
        salePrice: null, saleCurrency: null,
        listingId: null, saleId: null, saleDate: null,
        pageType: result.pageType, label: null
      };

      // JSON-LD first
      const ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
      let ldEvent = null;
      ldScripts.forEach(s => {
        try {
          const parsed = JSON.parse(s.textContent);
          const items = Array.isArray(parsed) ? parsed : [parsed];
          for (const it of items) {
            if (!it || !it['@type']) continue;
            if (String(it['@type']).toLowerCase().includes('event') && !ldEvent) ldEvent = it;
          }
        } catch (_) {}
      });
      if (ldEvent) {
        if (ldEvent.name) single.eventName = String(ldEvent.name).replace(/\\s*tickets?\\s*$/i, '').trim();
        if (ldEvent.startDate) {
          try {
            const d = new Date(ldEvent.startDate);
            if (!isNaN(d)) single.eventDate = d.toISOString().slice(0,10);
          } catch (_) {}
        }
        const loc = Array.isArray(ldEvent.location) ? ldEvent.location[0] : ldEvent.location;
        if (loc) {
          const venueName = loc.name || '';
          const city = loc.address && (loc.address.addressLocality || loc.address['@addressLocality']) || '';
          single.venue = [venueName, city].filter(Boolean).join(', ');
          const country = loc.address && (loc.address.addressCountry || loc.address['@addressCountry']) || '';
          if (country) single.country = typeof country === 'string' ? country : (country.name || '');
        }
      }

      // DOM patterns
      if (idMatches.length === 1) {
        const id = idMatches[0][2];
        if (/Listing/i.test(idMatches[0][1])) single.listingId = id;
        else single.saleId = id;
      }
      const sectionMatch = bodyText.match(/Section\\s+([A-Z0-9]{1,8})\\b/i);
      if (sectionMatch) single.section = sectionMatch[1];
      const rowMatch = bodyText.match(/Row\\s+([A-Z0-9]{1,4})\\b/i);
      if (rowMatch) single.row = rowMatch[1];
      const qtyMatch = bodyText.match(/(\\d{1,3})\\s+Tickets?\\b/i);
      if (qtyMatch) single.quantity = parseInt(qtyMatch[1], 10);

      // URL-based listing ID
      const listingUrlMatch = url.match(/[?&](listing|listingid|id)=(\\d+)/i);
      if (listingUrlMatch && !single.listingId) single.listingId = listingUrlMatch[2];

      // Price — Total price label
      const priceMatch = bodyText.match(/(?:Total\\s*price|Total)[^\\d]*([A-Z]{2,3}|[€$£]|K\u010d)\\s*([\\d.,]+)/i);
      if (priceMatch) {
        const cur = priceMatch[1];
        const num = parseFloat(priceMatch[2].replace(/,/g, ''));
        if (!isNaN(num)) {
          single.salePrice = num;
          const curMap = { '€':'EUR','$':'USD','£':'GBP','Kč':'CZK' };
          single.saleCurrency = curMap[cur] || cur.toUpperCase();
        }
      }

      // Title fallback
      if (!single.eventName && document.title) {
        const cleanTitle = document.title.replace(/\\s*[-|]\\s*(viagogo|stubhub).*/i, '').replace(/\\s*tickets?\\s*$/i, '').trim();
        if (cleanTitle.length > 2 && cleanTitle.length < 200) single.eventName = cleanTitle;
      }

      single.label = single.eventName || 'Detail stránky';
      if (single.eventName || single.saleId || single.listingId) {
        result.items.push(single);
        result.success = true;
      }
    }

    // Add origin breadcrumb to all items.
    result.items.forEach(it => {
      it.notes = 'Importováno z ' + location.host + ' dne ' + new Date().toISOString().slice(0,10);
    });

  } catch (e) {
    result.error = String(e && e.message || e);
  }

  return result;
})();
`;

async function quickAddFromMarketplace(name) {
  const wv = document.getElementById('webview-' + name);
  if (!wv) return;
  const btn = document.querySelector(`.mkt-btn[data-mkt-action="quickadd"][data-mkt="${name}"]`);
  const origLabel = btn?.textContent;

  // Disable button during scrape so user can't double-click.
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Čtu stránku…';
  }

  try {
    const data = await wv.executeJavaScript(MARKETPLACE_SCRAPER_SCRIPT, true);

    if (!data) {
      toast('Stránka neodpověděla — zkus reload', 'error');
      return;
    }
    if (data.error) {
      console.error('Scraper error:', data.error);
      toast('Chyba při čtení stránky: ' + data.error, 'error', 5000);
      return;
    }
    if (!data.success || !data.items || data.items.length === 0) {
      toast('Žádná data nenalezena. Otevři konkrétní sale/event/listing stránku a zkus znovu.', 'error', 5000);
      return;
    }

    // Map marketplace name → platform name stored on tickets. SalesPro is
    // Stubhub's broker portal, so its sales are Stubhub sales (matters for
    // payout rules and external IDs).
    const platform = (name === 'stubhub' || name === 'salespro') ? 'Stubhub' : 'Viagogo';

    // Multi-item page (e.g. My Sales overview with 4 sales) — let user pick
    // WHICH item to import first, then proceed to match-or-create flow with it.
    if (data.multiple || data.items.length > 1) {
      openMktItemPicker(data, platform, name);
      return;
    }

    // Single item — same flow as 1.12.1 (match picker or fallback to create).
    proceedWithSingleItem(data.items[0], platform, name);

  } catch (e) {
    console.error('quickAdd failed:', e);
    toast('Selhalo čtení stránky: ' + (e.message || e), 'error', 5000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origLabel;
    }
  }
}

// Take a single scraped item and decide: match-existing or create-new.
// Used by both quickAdd (single-item page) and openMktItemPicker (after user
// picks one of multiple items).
function proceedWithSingleItem(item, platform, marketplaceName) {
  // event/other pages → just open Add modal (no matching needed)
  if (item.pageType === 'event' || item.pageType === 'other') {
    openAddModalFromScraped(item, platform);
    return;
  }
  // For sale/listing pages we ALWAYS show the match picker — even if our
  // fuzzy matcher finds nothing. The user explicitly told us they want to
  // *connect* this marketplace sale to an existing ticket in the dashboard,
  // not create a new one. If our auto-match fails (e.g. event name didn't
  // get scraped well), we still show the dashboard tickets so the user can
  // pick manually. Only the "+ Vytvořit novou" fallback creates a new ticket.
  const matches = findMatchingTicketsForScraped(item, platform);
  openMktMatchPicker(item, platform, matches, marketplaceName);
}

// When the page has multiple sales/listings (overview list), show a picker
// asking the user which one to import. Then proceed with the chosen item.
function openMktItemPicker(data, platform, marketplaceName) {
  state._mktItemPickerCtx = { items: data.items, platform, marketplaceName };

  $('#mktMatchTitle').textContent = `Vyber kterou položku importovat (${data.items.length} nalezeno)`;
  $('#mktMatchSummary').innerHTML = `
    <div class="mkt-match-summary-title">⚡ Načteno z ${platform}</div>
    <div class="mkt-match-summary-meta">
      Stránka obsahuje <strong>${data.items.length}</strong> ${data.items.length === 1 ? 'položku' : data.items.length < 5 ? 'položky' : 'položek'}.
      Klikni tu, kterou chceš přidat do TicketVault.
    </div>
  `;
  $('#mktMatchCount').textContent = '';
  // Hide the "create new" button — only relevant in the match picker, not item picker.
  const newBtn = $('#btnMktMatchNew');
  if (newBtn) newBtn.style.display = 'none';

  $('#mktMatchList').innerHTML = data.items.map((item, idx) => {
    const typeLabel = item.pageType === 'sale' ? 'Sale' :
                       item.pageType === 'listing' ? 'Listing' : 'Položka';
    const idLabel = item.saleId ? `Sale #${item.saleId}` :
                    item.listingId ? `Listing #${item.listingId}` : '';
    const priceLabel = item.salePrice
      ? `${item.salePrice.toFixed(2)} ${item.saleCurrency || ''}`
      : '—';
    return `
      <div class="mkt-match-row" data-item-index="${idx}">
        <div class="mkt-match-row-info">
          <div class="mkt-match-row-title">${escapeHtml(item.eventName || ('Sale #' + (item.saleId || item.listingId || '?')))}</div>
          <div class="mkt-match-row-meta">
            <span>📅 ${item.eventDate ? formatDate(item.eventDate) : '—'}</span>
            ${item.venue ? `<span>📍 ${escapeHtml(item.venue)}</span>` : ''}
            <span>🎫 Sekce ${escapeHtml(item.section || '—')}${item.row ? ' / řada '+escapeHtml(item.row) : ''}</span>
            <span>${item.quantity || '?'} ks</span>
            <span style="color:var(--purple)"><strong>${priceLabel}</strong></span>
            ${idLabel ? `<span style="color:var(--text-tertiary)">${idLabel}</span>` : ''}
          </div>
        </div>
        <div class="mkt-match-row-status">
          <span class="status-pill" style="background:rgba(167,139,250,0.15);color:#c4b5fd;border:1px solid rgba(167,139,250,0.35)">${typeLabel}</span>
        </div>
        <div class="mkt-match-row-action">→</div>
      </div>
    `;
  }).join('');

  $('#mktMatchList').querySelectorAll('.mkt-match-row').forEach(row => {
    row.addEventListener('click', () => {
      const idx = parseInt(row.dataset.itemIndex, 10);
      const ctx = state._mktItemPickerCtx;
      if (!ctx || !ctx.items[idx]) return;
      closeModal('modalMktMatch');
      const item = ctx.items[idx];
      const plat = ctx.platform;
      const mkt = ctx.marketplaceName;
      state._mktItemPickerCtx = null;
      // Restore the new-ticket button for the match picker that comes next.
      const newBtn = $('#btnMktMatchNew');
      if (newBtn) newBtn.style.display = '';
      // Continue with chosen item.
      proceedWithSingleItem(item, plat, mkt);
    });
  });

  $('#modalMktMatch').classList.add('active');
}

// Build a partial ticket object from scraped data, used for both "create new"
// and as a fallback in match flow. Splits price by qty so we always store per-ks.
function scrapedToPartialTicket(data, platform) {
  const partial = {
    eventName: data.eventName || '',
    eventDate: data.eventDate || '',
    venue: data.venue || '',
    country: data.country || '',
    section: data.section || '',
    row: data.row || '',
    quantity: data.quantity || 1,
    salePrice: (data.salePrice && data.quantity) ? data.salePrice / data.quantity : (data.salePrice || ''),
    saleCurrency: data.saleCurrency || getDefaultTicketCurrency(),
    currency: data.saleCurrency || getDefaultTicketCurrency(),
    status: data.pageType === 'sale' ? 'sold' :
            data.pageType === 'listing' ? 'listed' : 'available',
    saleDate: data.pageType === 'sale' ? new Date().toISOString().slice(0,10) : '',
    platform: data.pageType === 'sale' || data.pageType === 'listing' ? platform : '',
    notes: data.notes || '',
    externalIds: {}
  };
  if (data.saleId) {
    partial.externalIds[platform === 'Stubhub' ? 'stubhubOrderId' : 'viagogoOrderId'] = data.saleId;
  }
  if (data.listingId) {
    partial.externalIds[platform === 'Stubhub' ? 'stubhubListingId' : 'viagogoListingId'] = data.listingId;
  }
  return partial;
}

function openAddModalFromScraped(data, platform) {
  const partial = scrapedToPartialTicket(data, platform);
  switchView('dashboard');
  openTicketModal(partial);
  const filledFields = ['eventName','eventDate','venue','section','salePrice','quantity']
    .filter(k => partial[k] && partial[k] !== '').length;
  toast(`✓ Předvyplněno ${filledFields}/6 polí — zkontroluj a ulož`, 'success', 4000);
}

// Find tickets in DB that could plausibly be this scraped sale/listing.
// Per user preference ("volněji"), we match on event name (fuzzy) without
// requiring exact section/date — the user will pick the right one from a list.
function findMatchingTicketsForScraped(data, platform) {
  if (!data.eventName) return [];

  const tickets = state.db.tickets || [];
  const eventNorm = normalizeEventName(data.eventName);

  return tickets
    .map(t => {
      const tEventNorm = normalizeEventName(t.eventName || '');
      // Score each ticket — higher = better match. Used to surface likely
      // candidates first and to flag "perfect" matches (listing ID hit).
      let score = 0;
      let reasons = [];

      // Event name match (required — at least partial)
      if (eventNorm && tEventNorm && (eventNorm.includes(tEventNorm) || tEventNorm.includes(eventNorm))) {
        score += 30;
        reasons.push('event');
      } else {
        return null; // no event match → not a candidate
      }

      // Date match (+20 if same day)
      if (data.eventDate && t.eventDate === data.eventDate) {
        score += 20;
        reasons.push('datum');
      }

      // Section match (+15)
      if (data.section && t.section &&
          String(data.section).toLowerCase() === String(t.section).toLowerCase()) {
        score += 15;
        reasons.push('sekce');
      }

      // Listing ID exact match — perfect match, big bonus
      const idKey = platform === 'Stubhub' ? 'stubhubListingId' : 'viagogoListingId';
      if (data.listingId && t.externalIds && t.externalIds[idKey] === data.listingId) {
        score += 100;
        reasons.push('listing ID');
      }

      // Order ID match (for sales)
      const orderKey = platform === 'Stubhub' ? 'stubhubOrderId' : 'viagogoOrderId';
      if (data.saleId && t.externalIds && t.externalIds[orderKey] === data.saleId) {
        score += 100;
        reasons.push('order ID');
      }

      // Filter by status appropriate to page type — don't suggest "delivered"
      // tickets for a fresh listing (they're already done).
      if (data.pageType === 'listing') {
        // Listing page: only show available/listed (you wouldn't list something sold)
        if (!['available', 'listed'].includes(t.status)) return null;
      } else if (data.pageType === 'sale') {
        // Sale page: show available, listed, even sold (in case of relist + resale)
        if (!['available', 'listed', 'sold'].includes(t.status)) return null;
      }

      return { ticket: t, score, reasons, isPerfect: score >= 100 };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20); // cap at 20 — anything beyond is noise
}

// Normalize event names for fuzzy matching: lowercase, strip diacritics,
// remove common boilerplate ("tickets", venue suffixes), collapse whitespace.
function normalizeEventName(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\s*(tickets?|vstupenky|live|tour|world tour)\s*/gi, ' ')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function openMktMatchPicker(data, platform, matches, marketplaceName) {
  const partial = scrapedToPartialTicket(data, platform);
  state._mktPickerCtx = { data, platform, partial, marketplaceName };

  const action = data.pageType === 'sale' ? 'prodaný ticket' :
                 data.pageType === 'listing' ? 'zalistovaný ticket' :
                 'ticket';
  $('#mktMatchTitle').textContent = `Přiřadit ${action} k existující vstupence`;

  const fmt = (v) => v || '<span style="color:var(--text-tertiary)">—</span>';
  const priceDisplay = data.salePrice
    ? `${data.salePrice.toFixed(2)} ${data.saleCurrency || ''} (celkem)`
    : '—';
  $('#mktMatchSummary').innerHTML = `
    <div class="mkt-match-summary-title">
      ⚡ Načteno z ${platform}
    </div>
    <div class="mkt-match-summary-meta">
      <strong>${escapeHtml(fmt(data.eventName))}</strong> · ${fmt(data.eventDate)} · ${escapeHtml(fmt(data.venue))}<br>
      Sekce <strong>${escapeHtml(fmt(data.section))}</strong>${data.row ? ' · řada <strong>'+escapeHtml(data.row)+'</strong>' : ''} · <strong>${data.quantity || '?'}</strong> ks · <strong>${priceDisplay}</strong>
      ${data.saleId ? '<br>Sale No.: <strong>'+escapeHtml(data.saleId)+'</strong>' : ''}
      ${data.listingId ? '<br>Listing ID: <strong>'+escapeHtml(data.listingId)+'</strong>' : ''}
    </div>
  `;

  // If we have auto-matches, show them. If not, fall back to ALL tickets
  // (filtered to plausible statuses) so the user can pick manually — this is
  // the explicit user request: never create a new ticket on a sale event,
  // always link to existing.
  const useFallback = matches.length === 0;
  let candidates;
  if (useFallback) {
    // Build candidate list from all tickets in plausible states for THIS page type.
    // Sale pages → tickets that aren't already delivered/cancelled.
    // Listing pages → tickets that are still available or already listed.
    const all = state.db.tickets || [];
    candidates = all
      .filter(t => {
        if (data.pageType === 'sale') return ['available','listed','sold'].includes(t.status);
        if (data.pageType === 'listing') return ['available','listed'].includes(t.status);
        return true;
      })
      // Sort: closest event date first (most likely to be the active sale)
      .sort((a, b) => {
        const ad = a.eventDate || '9999';
        const bd = b.eventDate || '9999';
        return ad.localeCompare(bd);
      })
      .map(t => ({ ticket: t, score: 0, reasons: [], isPerfect: false }));
    $('#mktMatchCount').innerHTML = `<span style="color:var(--text-tertiary)">Auto-match nic nenašel</span> · zobrazuji všechny vstupenky (<strong>${candidates.length}</strong>) — vyber ručně:`;
  } else {
    candidates = matches;
    $('#mktMatchCount').textContent = `Nalezeno ${matches.length} ${matches.length === 1 ? 'vstupenka' : matches.length < 5 ? 'vstupenky' : 'vstupenek'} se shodným eventem`;
  }

  // Build the search filter input — useful when fallback list is long.
  const filterHtml = `
    <input type="text" id="mktMatchFilter" class="mkt-match-filter"
           placeholder="🔍 Filtr: event, místo, sekce, účet…"
           autocomplete="off">
  `;

  if (candidates.length === 0) {
    $('#mktMatchList').innerHTML = '<div class="mkt-match-empty">V DB nejsou žádné vstupenky odpovídající tomuto typu stránky. Použij tlačítko nahoře pro vytvoření nové.</div>';
  } else {
    $('#mktMatchList').innerHTML = filterHtml +
      `<div id="mktMatchRows">${renderMktMatchRows(candidates)}</div>`;

    // Wire up row clicks (delegated, so they survive filter re-render).
    $('#mktMatchList').addEventListener('click', _onMktMatchListClick);

    // Filter input — re-render rows on each keystroke.
    const filterInput = $('#mktMatchFilter');
    if (filterInput) {
      filterInput.addEventListener('input', () => {
        const q = filterInput.value.toLowerCase().trim();
        const filtered = !q ? candidates : candidates.filter(c => {
          const t = c.ticket;
          return [t.eventName, t.venue, t.section, t.row, t.account, t.platform]
            .some(v => v && String(v).toLowerCase().includes(q));
        });
        const rowsEl = $('#mktMatchRows');
        if (rowsEl) rowsEl.innerHTML = renderMktMatchRows(filtered);
      });
      // Auto-focus filter when fallback list is shown — saves a click.
      if (useFallback) setTimeout(() => filterInput.focus(), 50);
    }
  }

  $('#modalMktMatch').classList.add('active');
}

// Build the row HTML for a list of match candidates. Extracted so the filter
// input can re-render rows without rebuilding the whole modal.
function renderMktMatchRows(candidates) {
  if (candidates.length === 0) {
    return '<div class="mkt-match-empty">Nic neodpovídá filtru.</div>';
  }
  return candidates.map(m => {
    const t = m.ticket;
    const statusLabel = {
      available: 'Koupeno', listed: 'Zalistováno', sold: 'Prodáno',
      delivered: '✓ Doručeno', cancelled: 'Zrušeno'
    }[t.status] || t.status;
    const statusPill = `<span class="status-pill status-${t.status}">${statusLabel}</span>`;
    const purchaseInfo = t.purchasePrice
      ? `${formatMoney(t.purchasePrice * (t.quantity || 1), t.currency)} nákup`
      : 'bez nákupní ceny';
    return `
      <div class="mkt-match-row ${m.isPerfect ? 'perfect-match' : ''}" data-ticket-id="${t.id}">
        <div class="mkt-match-row-info">
          <div class="mkt-match-row-title">${escapeHtml(t.eventName || '—')}</div>
          <div class="mkt-match-row-meta">
            <span>📅 ${t.eventDate ? formatDate(t.eventDate) : '—'}</span>
            <span>🎫 Sekce ${escapeHtml(t.section || '—')}${t.row ? ' / řada '+escapeHtml(t.row) : ''}</span>
            <span>👤 ${escapeHtml(t.account || '—')}</span>
            <span>💰 ${purchaseInfo}</span>
            ${m.reasons && m.reasons.length ? `<span style="color:var(--purple)">✓ shoda: ${m.reasons.join(', ')}</span>` : ''}
          </div>
        </div>
        <div class="mkt-match-row-status">${statusPill}</div>
        <div class="mkt-match-row-action">→</div>
      </div>
    `;
  }).join('');
}

// Single delegated click handler — survives filter re-renders.
function _onMktMatchListClick(e) {
  const row = e.target.closest('.mkt-match-row');
  if (!row) return;
  // Skip clicks inside the filter input.
  if (e.target.id === 'mktMatchFilter') return;
  applyMktMatchToTicket(row.dataset.ticketId);
}

// User picked which ticket the scraped sale/listing belongs to. Patch that
// ticket with the scraped data — preserving everything that's already set
// (notably purchasePrice, account) and overwriting/adding what's relevant.
async function applyMktMatchToTicket(ticketId) {
  const ctx = state._mktPickerCtx;
  if (!ctx) return;
  const existing = state.db.tickets.find(t => t.id === ticketId);
  if (!existing) {
    toast('Vstupenka už neexistuje, refresh', 'error');
    return;
  }

  const { data, platform, partial } = ctx;

  // Build patch — only set fields we have data for, never null/empty an
  // existing field. The point is to ENRICH the existing ticket, not overwrite.
  const patch = { ...existing };

  // Status: bump to 'listed' or 'sold' depending on what we scraped.
  // Don't downgrade — if ticket was already 'delivered', leave it alone.
  if (data.pageType === 'sale' && existing.status !== 'delivered' && existing.status !== 'cancelled') {
    patch.status = 'sold';
    if (!patch.saleDate) patch.saleDate = new Date().toISOString().slice(0,10);
  } else if (data.pageType === 'listing' && existing.status === 'available') {
    patch.status = 'listed';
  }

  // Sale price: only set if missing OR scraped page has a price.
  // We always store per-ks, so divide by qty when source was a total.
  if (data.salePrice) {
    const perKs = data.quantity ? data.salePrice / data.quantity : data.salePrice;
    patch.salePrice = perKs;
    if (data.saleCurrency) patch.saleCurrency = data.saleCurrency;
  }

  // Sale platform: track WHERE it sold (matters for payout rules).
  if (data.pageType === 'sale' || data.pageType === 'listing') {
    patch.platform = platform;
  }

  // External IDs: merge into existing object (don't overwrite other ID types).
  patch.externalIds = { ...(existing.externalIds || {}) };
  if (data.saleId) {
    patch.externalIds[platform === 'Stubhub' ? 'stubhubOrderId' : 'viagogoOrderId'] = data.saleId;
  }
  if (data.listingId) {
    patch.externalIds[platform === 'Stubhub' ? 'stubhubListingId' : 'viagogoListingId'] = data.listingId;
  }

  // Append a note breadcrumb (don't replace existing notes).
  const stamp = `[${new Date().toISOString().slice(0,16).replace('T',' ')}] Přiřazeno k ${platform} ${data.pageType === 'sale' ? 'sale' : 'listing'}${data.saleId ? ' #'+data.saleId : ''}${data.listingId ? ' (listing '+data.listingId+')' : ''}`;
  patch.notes = existing.notes ? existing.notes + '\n' + stamp : stamp;

  try {
    await window.api.upsertTicket(patch);
    await refreshDb();
    closeModal('modalMktMatch');
    state._mktPickerCtx = null;
    const summary = `${existing.eventName} → ${patch.status === 'sold' ? 'Prodáno' : 'Zalistováno'}`;
    toast('✓ Vstupenka aktualizována: ' + summary, 'success', 4000);
    // Switch to dashboard so user sees the updated ticket.
    switchView('dashboard');
  } catch (e) {
    console.error('Match apply failed:', e);
    toast('Chyba při ukládání: ' + (e.message || e), 'error', 5000);
  }
}

// "Vytvořit novou vstupenku místo přiřazení" — fallback inside picker modal.
function createNewFromMktPicker() {
  const ctx = state._mktPickerCtx;
  if (!ctx) return;
  closeModal('modalMktMatch');
  state._mktPickerCtx = null;
  openAddModalFromScraped(ctx.data, ctx.platform);
}

// ============ MEMBERSHIPS ============
// Color palette for group pairing - deterministic based on group number
// 16 visually distinct colors, chosen to be distinguishable from each other
const GROUP_COLORS = [
  { bg: 'rgba(167, 139, 250, 0.18)', border: 'rgba(167, 139, 250, 0.5)', text: '#c4b5fd' },     // 1 purple
  { bg: 'rgba(16, 185, 129, 0.18)', border: 'rgba(16, 185, 129, 0.5)', text: '#6ee7b7' },     // 2 green
  { bg: 'rgba(59, 130, 246, 0.18)', border: 'rgba(59, 130, 246, 0.5)', text: '#93c5fd' },     // 3 blue
  { bg: 'rgba(249, 115, 22, 0.18)', border: 'rgba(249, 115, 22, 0.5)', text: '#fdba74' },     // 4 orange
  { bg: 'rgba(236, 72, 153, 0.18)', border: 'rgba(236, 72, 153, 0.5)', text: '#f9a8d4' },     // 5 pink
  { bg: 'rgba(6, 182, 212, 0.18)', border: 'rgba(6, 182, 212, 0.5)', text: '#67e8f9' },       // 6 cyan
  { bg: 'rgba(251, 191, 36, 0.18)', border: 'rgba(251, 191, 36, 0.5)', text: '#fcd34d' },     // 7 yellow
  { bg: 'rgba(239, 68, 68, 0.18)', border: 'rgba(239, 68, 68, 0.5)', text: '#fca5a5' },       // 8 red
  { bg: 'rgba(132, 204, 22, 0.18)', border: 'rgba(132, 204, 22, 0.5)', text: '#bef264' },     // 9 lime
  { bg: 'rgba(217, 70, 239, 0.18)', border: 'rgba(217, 70, 239, 0.5)', text: '#f0abfc' },     // 10 fuchsia
  { bg: 'rgba(20, 184, 166, 0.18)', border: 'rgba(20, 184, 166, 0.5)', text: '#5eead4' },     // 11 teal
  { bg: 'rgba(251, 146, 60, 0.18)', border: 'rgba(251, 146, 60, 0.5)', text: '#fed7aa' },     // 12 amber
  { bg: 'rgba(99, 102, 241, 0.18)', border: 'rgba(99, 102, 241, 0.5)', text: '#a5b4fc' },     // 13 indigo
  { bg: 'rgba(190, 242, 100, 0.18)', border: 'rgba(190, 242, 100, 0.5)', text: '#d9f99d' },   // 14 light-lime
  { bg: 'rgba(244, 114, 182, 0.18)', border: 'rgba(244, 114, 182, 0.5)', text: '#fbcfe8' },   // 15 rose
  { bg: 'rgba(148, 163, 184, 0.18)', border: 'rgba(148, 163, 184, 0.5)', text: '#cbd5e1' }    // 16 slate
];

function getGroupColor(groupNum) {
  if (!groupNum && groupNum !== 0) return null;
  const n = parseInt(groupNum);
  if (isNaN(n)) return null;
  // Groups are 1-indexed for users (1, 2, 3...), map to 0-indexed palette
  // Skupina 0 → purple, 1 → purple, 2 → green, ..., 16 → slate, 17 → purple (wrap)
  const idx = n <= 0 ? 0 : ((n - 1) % GROUP_COLORS.length);
  return GROUP_COLORS[idx];
}

function getTeamInitials(team) {
  if (!team) return '?';
  const words = team.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return team.slice(0, 2).toUpperCase();
}

function getFilteredMemberships() {
  let list = [...(state.db.memberships || [])];
  const f = state.membershipFilters;
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(m =>
      (m.email || '').toLowerCase().includes(q) ||
      (m.team || '').toLowerCase().includes(q) ||
      (m.owner || '').toLowerCase().includes(q) ||
      (m.memberId || '').toLowerCase().includes(q)
    );
  }
  if (f.team) list = list.filter(m => m.team === f.team);
  if (f.owner) list = list.filter(m => m.owner === f.owner);
  if (f.group) list = list.filter(m => String(m.group || '') === String(f.group));
  return list;
}

function populateMembershipFilters() {
  const memberships = state.db.memberships || [];
  const teams = [...new Set(memberships.map(m => m.team).filter(Boolean))].sort();
  const owners = [...new Set(memberships.map(m => m.owner).filter(Boolean))].sort();
  const groups = [...new Set(memberships.map(m => m.group).filter(g => g !== '' && g != null))].sort((a, b) => parseInt(a) - parseInt(b));
  
  const fillSel = (id, items, emptyLabel) => {
    const sel = $('#' + id);
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = `<option value="">${emptyLabel}</option>` +
      items.map(i => `<option value="${escapeHtml(String(i))}">${escapeHtml(String(i))}</option>`).join('');
    sel.value = current;
  };
  fillSel('mFilterTeam', teams, 'Všechny týmy');
  fillSel('mFilterOwner', owners, 'Všichni vlastníci');
  fillSel('mFilterGroup', groups, 'Všechny skupiny');
}

function renderMembershipsPage() {
  populateMembershipFilters();
  const list = getFilteredMemberships();
  const tbody = $('#membershipsBody');
  const empty = $('#mEmptyState');
  
  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    renderMBulkActions();
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = list.map(m => {
    const checked = state.selectedMembershipIds.has(m.id) ? 'checked' : '';
    const revealed = state.revealedPasswords.has(m.id);
    const groupColor = getGroupColor(m.group);
    const groupStyle = groupColor
      ? `background:${groupColor.bg};color:${groupColor.text};border:1px solid ${groupColor.border}`
      : 'background:var(--bg-tertiary);color:var(--text-tertiary);border:1px solid var(--border)';
    
    const emailClass = 'email-' + (m.status || 'neutral');
    const emailDotColor = {
      green: '#10b981', blue: '#3b82f6', red: '#ef4444', neutral: '#9999a8'
    }[m.status || 'neutral'];
    
    const pwDisplay = m.password
      ? (revealed ? escapeHtml(m.password) : '••••••••')
      : '—';
    
    const urlCell = m.url
      ? `<a class="url-link" href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer" title="Otevřít: ${escapeHtml(m.url)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`
      : `<span style="color:var(--text-tertiary)">—</span>`;
    
    const lpVal = (m.lp === 0 || m.lp) ? m.lp : '';
    
    return `
      <tr data-id="${m.id}">
        <td class="col-check"><input type="checkbox" class="m-row-check" data-id="${m.id}" ${checked}></td>
        <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-tertiary)">${escapeHtml(m.memberId || '—')}</td>
        <td>
          <div class="team-cell">
            <div class="team-logo">${getTeamInitials(m.team)}</div>
            <span>${escapeHtml(m.team || '—')}</span>
          </div>
        </td>
        <td class="email-cell ${emailClass}" title="${escapeHtml(m.email || '')}">
          <span class="email-status-dot" style="background:${emailDotColor}"></span>
          <span class="cell-text">${escapeHtml(m.email || '—')}</span>
          ${m.email ? `<button class="copy-btn" data-copy="${escapeHtml(m.email)}" title="Kopírovat email">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>` : ''}
        </td>
        <td>${escapeHtml(m.card || '—')}</td>
        <td class="pw-cell-wrap">
          <span class="pw-cell ${revealed ? 'revealed' : ''}" data-pw-id="${m.id}" title="Klikni pro zobrazení/skrytí">${pwDisplay}</span>
          ${m.password ? `<button class="copy-btn" data-copy="${escapeHtml(m.password)}" title="Kopírovat heslo">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>` : ''}
        </td>
        <td><span class="group-pill" style="${groupStyle}">${m.group || '—'}</span></td>
        <td class="lp-cell">
          <input type="number" class="lp-input" data-lp-id="${m.id}" value="${lpVal}" placeholder="—" min="0" step="1">
        </td>
        <td>${escapeHtml(m.owner || '—')}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(m.bankAccount || '—')}</td>
        <td style="font-family:var(--font-mono);font-size:11px">${escapeHtml(m.phone || '—')}</td>
        <td class="url-cell">${urlCell}</td>
        <td class="col-actions">
          <div class="actions-cell">
            <button class="btn btn-clone btn-sm" data-m-action="clone" data-id="${m.id}" title="Klonovat membership">🗐</button>
            <button class="btn btn-dark btn-sm" data-m-action="edit" data-id="${m.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-m-action="delete" data-id="${m.id}">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Bind actions
  tbody.querySelectorAll('[data-m-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.mAction;
      if (act === 'edit') openMembershipModal(state.db.memberships.find(m => m.id === id));
      else if (act === 'delete') deleteMembership(id);
      else if (act === 'clone') cloneMembership(state.db.memberships.find(m => m.id === id));
    });
  });
  
  // LP inline edit (save on blur)
  tbody.querySelectorAll('.lp-input').forEach(inp => {
    const id = inp.dataset.lpId;
    let originalVal = inp.value;
    inp.addEventListener('focus', () => { originalVal = inp.value; });
    inp.addEventListener('blur', async () => {
      const newVal = inp.value.trim();
      if (newVal === originalVal) return;
      const m = state.db.memberships.find(x => x.id === id);
      if (!m) return;
      const lpNum = newVal === '' ? null : parseInt(newVal);
      const updated = { ...m, lp: (newVal === '' || isNaN(lpNum)) ? null : lpNum };
      await window.api.upsertMembership(updated);
      const idx = state.db.memberships.findIndex(x => x.id === id);
      if (idx >= 0) state.db.memberships[idx] = updated;
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') inp.blur();
      if (e.key === 'Escape') { inp.value = originalVal; inp.blur(); }
    });
  });
  
  // Password reveal on click
  tbody.querySelectorAll('.pw-cell').forEach(cell => {
    cell.addEventListener('click', () => {
      const id = cell.dataset.pwId;
      if (state.revealedPasswords.has(id)) state.revealedPasswords.delete(id);
      else state.revealedPasswords.add(id);
      renderMembershipsPage();
    });
  });
  
  // Copy to clipboard buttons
  tbody.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        // Visual confirmation: swap icon to checkmark briefly
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn.classList.add('copied');
        toast('Zkopírováno do schránky', 'success', 1500);
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 1200);
      } catch (err) {
        toast('Chyba kopírování: ' + err.message, 'error');
      }
    });
  });
  
  // Row checkboxes
  tbody.querySelectorAll('.m-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedMembershipIds.add(id);
      else state.selectedMembershipIds.delete(id);
      renderMBulkActions();
    });
  });
  
  renderMBulkActions();
}

function renderMBulkActions() {
  const bar = $('#mBulkActions');
  if (!bar) return;
  const count = state.selectedMembershipIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    $('#mBulkCount').textContent = `${count} vybráno`;
  } else {
    bar.style.display = 'none';
  }
}

async function toggleMembershipField(id, field) {
  // (Deprecated - kept as no-op for backward compatibility)
  console.warn('toggleMembershipField is deprecated');
}

function openMembershipModal(m = null) {
  // If m has no id, it's a clone template (treat as new)
  const isEditing = m && m.id;
  state.editingMembership = isEditing ? m : null;
  $('#mModalTitle').textContent = isEditing
    ? 'Upravit membership'
    : (m ? 'Klonovat membership (nová kopie)' : 'Přidat membership');
  
  $('#mfTeam').value = m?.team || '';
  $('#mfMemberId').value = m?.memberId || '';
  $('#mfEmail').value = m?.email || '';
  $('#mfPassword').value = m?.password || '';
  $('#mfPassword').type = 'password';
  $('#mfTogglePw').textContent = '👁️';
  $('#mfCard').value = m?.card || '';
  $('#mfGroup').value = m?.group || '';
  $('#mfOwner').value = m?.owner || '';
  $('#mfBankAccount').value = m?.bankAccount || '';
  $('#mfPhone').value = m?.phone || '';
  $('#mfUrl').value = m?.url || '';
  $('#mfNotes').value = m?.notes || '';
  $('#mfLP').value = (m?.lp === 0 || m?.lp) ? m.lp : '';
  
  const status = m?.status || 'neutral';
  $$('input[name="mfStatus"]').forEach(r => r.checked = r.value === status);
  
  // Live group color preview
  updateGroupColorPreview();
  
  $('#modalMembership').classList.add('active');
  $('#mfTeam').focus();
}

function updateGroupColorPreview() {
  const val = $('#mfGroup')?.value;
  const pill = $('#mfGroupPill');
  if (!pill) return;
  const color = getGroupColor(val);
  if (color) {
    pill.textContent = val;
    pill.style.background = color.bg;
    pill.style.color = color.text;
    pill.style.border = `1px solid ${color.border}`;
  } else {
    pill.textContent = '—';
    pill.style.background = 'var(--bg-tertiary)';
    pill.style.color = 'var(--text-tertiary)';
    pill.style.border = '1px solid var(--border)';
  }
}

async function saveMembership() {
  const team = $('#mfTeam').value.trim();
  const email = $('#mfEmail').value.trim();
  if (!team) { toast('Zadej team', 'error'); return; }
  if (!email) { toast('Zadej email', 'error'); return; }
  
  const statusRadio = document.querySelector('input[name="mfStatus"]:checked');
  const status = statusRadio ? statusRadio.value : 'neutral';
  
  const lpRaw = $('#mfLP').value.trim();
  const lpNum = lpRaw === '' ? null : parseInt(lpRaw);
  
  const m = {
    ...(state.editingMembership || {}),
    team,
    memberId: $('#mfMemberId').value.trim(),
    email,
    password: $('#mfPassword').value,
    card: $('#mfCard').value.trim(),
    group: $('#mfGroup').value.trim(),
    owner: $('#mfOwner').value.trim(),
    bankAccount: $('#mfBankAccount').value.trim(),
    phone: $('#mfPhone').value.trim(),
    url: $('#mfUrl').value.trim(),
    notes: $('#mfNotes').value.trim(),
    status,
    lp: (lpRaw === '' || isNaN(lpNum)) ? null : lpNum
  };
  // Clean up old fields if present (migration)
  delete m.ballot1;
  delete m.purchase1;
  delete m.ballot2;
  delete m.purchase2;
  
  const saved = await window.api.upsertMembership(m);
  // Update local state
  if (!state.db.memberships) state.db.memberships = [];
  const idx = state.db.memberships.findIndex(x => x.id === saved.id);
  if (idx >= 0) state.db.memberships[idx] = saved;
  else state.db.memberships.push(saved);
  
  closeModal('modalMembership');
  toast(state.editingMembership ? 'Membership upraven' : 'Membership přidán', 'success');
  renderMembershipsPage();
}

function cloneMembership(m) {
  if (!m) return;
  // Keep team, owner, card, BÚ, URL, status, group (common across grouped accounts)
  // Reset: id, memberId, email, password (unique per account)
  const clone = {
    team: m.team || '',
    memberId: '',
    email: '',
    password: '',
    card: m.card || '',
    group: m.group || '',
    owner: m.owner || '',
    bankAccount: m.bankAccount || '',
    phone: m.phone || '',
    url: m.url || '',
    status: m.status || 'neutral',
    lp: null,
    notes: ''
  };
  openMembershipModal(clone);
  // Focus on email since that's the unique thing you need to enter
  setTimeout(() => $('#mfEmail')?.focus(), 50);
  toast('Membership naklonován - vyplň email a heslo', 'info', 3000);
}

async function deleteMembership(id) {
  const m = state.db.memberships.find(x => x.id === id);
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Smazat membership',
    message: `Opravdu smazat ${m?.team || ''} — ${m?.email || ''}?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteMembership(id);
  state.db.memberships = state.db.memberships.filter(x => x.id !== id);
  state.selectedMembershipIds.delete(id);
  renderMembershipsPage();
  toast('Membership smazán', 'success');
}

async function bulkDeleteMemberships() {
  const ids = [...state.selectedMembershipIds];
  if (!ids.length) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} membershipů?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteMemberships(ids);
  state.db.memberships = state.db.memberships.filter(x => !ids.includes(x.id));
  state.selectedMembershipIds.clear();
  renderMembershipsPage();
  toast(`Smazáno ${ids.length} membershipů`, 'success');
}

// ============ MAILBOXES (Emailové schránky) ============
function getFilteredMailboxes() {
  const list = state.db.mailboxes || [];
  const f = state.mailboxFilters;
  const q = (f.search || '').toLowerCase().trim();
  return list.filter(mb => {
    if (q) {
      const hay = `${mb.firstName || ''} ${mb.lastName || ''} ${mb.email || ''} ${mb.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => {
    // Sort by lastName, then firstName
    const la = (a.lastName || '').toLowerCase();
    const lb = (b.lastName || '').toLowerCase();
    if (la !== lb) return la.localeCompare(lb, 'cs');
    return (a.firstName || '').toLowerCase().localeCompare((b.firstName || '').toLowerCase(), 'cs');
  });
}

function renderMailboxesPage() {
  const list = getFilteredMailboxes();
  const tbody = $('#mailboxesBody');
  const empty = $('#mbEmptyState');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    renderMbBulkActions();
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = list.map(mb => {
    const checked = state.selectedMailboxIds.has(mb.id) ? 'checked' : '';
    // Password cell — masked dots that the user reveals on click. Same UX
    // pattern as the SIM-card password field elsewhere in the app.
    const hasPw = !!(mb.password && mb.password.length > 0);
    const pwCell = hasPw
      ? `<td class="pw-cell-wrap">
           <span class="pw-cell" data-pw="${escapeHtml(mb.password)}" data-id="${mb.id}" title="Klikni pro zobrazení">••••••••</span>
           <button class="copy-btn" data-copy="${escapeHtml(mb.password)}" title="Kopírovat heslo">
             <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
           </button>
         </td>`
      : `<td class="pw-cell-wrap"><span style="color:var(--text-tertiary);font-size:11px;">—</span></td>`;
    return `
      <tr data-id="${mb.id}">
        <td class="col-check"><input type="checkbox" class="mb-row-check" data-id="${mb.id}" ${checked}></td>
        <td>${escapeHtml(mb.firstName || '—')}</td>
        <td>${escapeHtml(mb.lastName || '—')}</td>
        <td class="email-cell" title="${escapeHtml(mb.email || '')}">
          <span class="cell-text">${escapeHtml(mb.email || '—')}</span>
          ${mb.email ? `<button class="copy-btn" data-copy="${escapeHtml(mb.email)}" title="Kopírovat email">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>` : ''}
        </td>
        ${pwCell}
        <td class="col-actions">
          <div class="actions-cell">
            <button class="btn btn-dark btn-sm" data-mb-action="edit" data-id="${mb.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-mb-action="delete" data-id="${mb.id}">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind row actions
  tbody.querySelectorAll('[data-mb-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.mbAction;
      if (act === 'edit') openMailboxModal((state.db.mailboxes || []).find(x => x.id === id));
      else if (act === 'delete') deleteMailbox(id);
    });
  });

  // Copy buttons
  tbody.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn.classList.add('copied');
        toast('Zkopírováno do schránky', 'success', 1500);
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 1200);
      } catch (err) {
        toast('Chyba kopírování: ' + err.message, 'error');
      }
    });
  });

  // Row checkboxes
  tbody.querySelectorAll('.mb-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedMailboxIds.add(id);
      else state.selectedMailboxIds.delete(id);
      renderMbBulkActions();
    });
  });

  // Password cells — click to reveal, click again to hide. Plain dots ⇄ real
  // password as monospace text. Stored in `data-pw` so we don't keep it in
  // closures (rerenders blow them away anyway).
  tbody.querySelectorAll('.pw-cell').forEach(cell => {
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      const real = cell.dataset.pw || '';
      const isRevealed = cell.classList.contains('revealed');
      if (isRevealed) {
        cell.textContent = '••••••••';
        cell.classList.remove('revealed');
        cell.title = 'Klikni pro zobrazení';
      } else {
        cell.textContent = real;
        cell.classList.add('revealed');
        cell.title = 'Klikni pro skrytí';
      }
    });
  });

  renderMbBulkActions();
}

function renderMbBulkActions() {
  const bar = $('#mbBulkActions');
  if (!bar) return;
  const count = state.selectedMailboxIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    $('#mbBulkCount').textContent = `${count} vybráno`;
  } else {
    bar.style.display = 'none';
  }
}

function openMailboxModal(mb = null) {
  const isEditing = mb && mb.id;
  state.editingMailbox = isEditing ? mb : null;
  $('#mbModalTitle').textContent = isEditing ? 'Upravit schránku' : 'Přidat schránku';
  $('#mbfFirstName').value = mb?.firstName || '';
  $('#mbfLastName').value = mb?.lastName || '';
  $('#mbfEmail').value = mb?.email || '';
  // Password is stored plaintext alongside the rest of the mailbox record.
  // It's a local-only field (never synced to email provider) — purely for the
  // user's own reference so they can copy/paste credentials when needed.
  $('#mbfPassword').value = mb?.password || '';
  // Always reset visibility to hidden when reopening.
  $('#mbfPassword').type = 'password';
  $('#mbfNotes').value = mb?.notes || '';
  $('#modalMailbox').classList.add('active');
  $('#mbfFirstName').focus();
}

async function saveMailbox() {
  const firstName = $('#mbfFirstName').value.trim();
  const lastName = $('#mbfLastName').value.trim();
  const email = $('#mbfEmail').value.trim();
  if (!firstName) { toast('Zadej jméno', 'error'); return; }
  if (!lastName) { toast('Zadej příjmení', 'error'); return; }
  if (!email) { toast('Zadej email', 'error'); return; }

  const mb = {
    ...(state.editingMailbox || {}),
    firstName,
    lastName,
    email,
    // Save password as-is (no encryption — same trust model as the rest of the
    // local DB. Cloud sync sends it encrypted in transit and at rest server-side.)
    password: $('#mbfPassword').value,
    notes: $('#mbfNotes').value.trim()
  };

  const saved = await window.api.upsertMailbox(mb);
  if (!state.db.mailboxes) state.db.mailboxes = [];
  const idx = state.db.mailboxes.findIndex(x => x.id === saved.id);
  if (idx >= 0) state.db.mailboxes[idx] = saved;
  else state.db.mailboxes.push(saved);

  closeModal('modalMailbox');
  toast(state.editingMailbox ? 'Schránka upravena' : 'Schránka přidána', 'success');
  renderMailboxesPage();
}

async function deleteMailbox(id) {
  const mb = (state.db.mailboxes || []).find(x => x.id === id);
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Smazat schránku',
    message: `Opravdu smazat ${mb?.firstName || ''} ${mb?.lastName || ''} (${mb?.email || ''})?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteMailbox(id);
  state.db.mailboxes = (state.db.mailboxes || []).filter(x => x.id !== id);
  state.selectedMailboxIds.delete(id);
  renderMailboxesPage();
  toast('Schránka smazána', 'success');
}

async function bulkDeleteMailboxes() {
  const ids = [...state.selectedMailboxIds];
  if (!ids.length) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} schránek?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteMailboxes(ids);
  state.db.mailboxes = (state.db.mailboxes || []).filter(x => !ids.includes(x.id));
  state.selectedMailboxIds.clear();
  renderMailboxesPage();
  toast(`Smazáno ${ids.length} schránek`, 'success');
}

// ============ SIM CARDS ============
// Computes urgency status for an expiry date.
// Returns one of: 'ok' | 'warn' (<30d) | 'urgent' (<7d) | 'expired' (past)
function getSimcardStatus(expiryISO) {
  if (!expiryISO) return 'ok';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryISO);
  exp.setHours(0, 0, 0, 0);
  const diffMs = exp.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / 86400000);
  if (diffDays < 0) return 'expired';
  if (diffDays < 7) return 'urgent';
  if (diffDays < 30) return 'warn';
  return 'ok';
}

// Days remaining until expiry (negative = past)
function getDaysUntilExpiry(expiryISO) {
  if (!expiryISO) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expiryISO);
  exp.setHours(0, 0, 0, 0);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

function formatExpiryDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch (e) {
    return iso;
  }
}

// Adds 1 calendar year to an ISO date string (YYYY-MM-DD).
// If the input is empty/invalid, anchors on today.
function addOneYear(isoDate) {
  let d;
  if (isoDate) {
    d = new Date(isoDate);
    if (isNaN(d.getTime())) d = new Date();
  } else {
    d = new Date();
  }
  d.setFullYear(d.getFullYear() + 1);
  // Return as YYYY-MM-DD (local)
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getFilteredSimcards() {
  const list = state.db.simcards || [];
  const f = state.simcardFilters;
  const q = (f.search || '').toLowerCase().trim();
  return list.filter(sc => {
    if (q) {
      const hay = `${sc.operator || ''} ${sc.phone || ''} ${sc.owner || ''} ${sc.notes || ''}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.operator && sc.operator !== f.operator) return false;
    if (f.status) {
      const status = getSimcardStatus(sc.expiry);
      if (status !== f.status) return false;
    }
    return true;
  }).sort((a, b) => {
    // Sort by expiry ascending (most urgent first), missing dates last
    if (!a.expiry && !b.expiry) return 0;
    if (!a.expiry) return 1;
    if (!b.expiry) return -1;
    return a.expiry.localeCompare(b.expiry);
  });
}

function getSimOperators() {
  // Prefer the list stored in DB (synced via cloud); fall back to defaults
  const fromDb = (state.db && Array.isArray(state.db.simOperators)) ? state.db.simOperators : null;
  if (fromDb && fromDb.length) return fromDb;
  return ['T-Mobile', 'O2', 'Vodafone', 'Kaktus'];
}

function populateSimcardFilters() {
  const sel = $('#scFilterOperator');
  if (!sel) return;
  const current = state.simcardFilters.operator;
  // Build options from operators in use + known operators (deduped)
  const usedSet = new Set();
  (state.db.simcards || []).forEach(sc => { if (sc.operator) usedSet.add(sc.operator); });
  getSimOperators().forEach(op => usedSet.add(op));
  const opts = ['<option value="">Všichni operátoři</option>']
    .concat([...usedSet].sort().map(op => `<option value="${escapeHtml(op)}">${escapeHtml(op)}</option>`));
  sel.innerHTML = opts.join('');
  sel.value = current || '';
}

function populateSimOperatorSelect(currentValue = '') {
  const sel = $('#scfOperator');
  if (!sel) return;
  const ops = getSimOperators();
  // Make sure currentValue (from existing record) is always selectable even if removed from defaults
  const set = new Set(ops);
  if (currentValue && !set.has(currentValue)) ops.unshift(currentValue);
  sel.innerHTML = ops.map(op => `<option value="${escapeHtml(op)}">${escapeHtml(op)}</option>`).join('');
  sel.value = currentValue || ops[0] || '';
}

function renderSimcardsPage() {
  populateSimcardFilters();
  const list = getFilteredSimcards();
  const tbody = $('#simcardsBody');
  const empty = $('#scEmptyState');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    renderScBulkActions();
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = list.map(sc => {
    const checked = state.selectedSimcardIds.has(sc.id) ? 'checked' : '';
    const status = getSimcardStatus(sc.expiry);
    const days = getDaysUntilExpiry(sc.expiry);

    let statusBadge = '';
    let rowClass = '';
    let extendBtnClass = 'btn btn-extend btn-sm';
    if (status === 'expired') {
      statusBadge = `<span class="expiry-status status-expired">❌ Vypršelo (${Math.abs(days)} d)</span>`;
      rowClass = 'row-expired';
      extendBtnClass += ' urgent';
    } else if (status === 'urgent') {
      statusBadge = `<span class="expiry-status status-urgent">🔥 ${days} dní</span>`;
      rowClass = 'row-urgent';
      extendBtnClass += ' urgent';
    } else if (status === 'warn') {
      statusBadge = `<span class="expiry-status status-warn">⚠ ${days} dní</span>`;
      rowClass = 'row-warn';
    } else if (sc.expiry) {
      statusBadge = `<span class="expiry-status status-ok">✓ ${days} dní</span>`;
    } else {
      statusBadge = `<span class="expiry-status status-ok" style="opacity:0.5">—</span>`;
    }

    const expiryClass = `expiry-cell expiry-${status}`;

    return `
      <tr data-id="${sc.id}" class="${rowClass}">
        <td class="col-check"><input type="checkbox" class="sc-row-check" data-id="${sc.id}" ${checked}></td>
        <td class="operator-cell">${escapeHtml(sc.operator || '—')}</td>
        <td class="phone-cell">
          ${escapeHtml(sc.phone || '—')}
          ${sc.phone ? `<button class="copy-btn" data-copy="${escapeHtml(sc.phone)}" title="Kopírovat číslo">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
          </button>` : ''}
        </td>
        <td class="${expiryClass}">${formatExpiryDate(sc.expiry)}</td>
        <td>${statusBadge}</td>
        <td style="color:var(--text-secondary);font-size:12px">${escapeHtml(sc.notes || '—')}</td>
        <td class="col-actions">
          <div class="actions-cell">
            <button class="${extendBtnClass}" data-sc-action="extend" data-id="${sc.id}" title="Prodloužit datum expirace o 1 rok">↻ Prodlouženo</button>
            <button class="btn btn-dark btn-sm" data-sc-action="edit" data-id="${sc.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-sc-action="delete" data-id="${sc.id}">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Bind row actions
  tbody.querySelectorAll('[data-sc-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.scAction;
      if (act === 'edit') openSimcardModal((state.db.simcards || []).find(x => x.id === id));
      else if (act === 'delete') deleteSimcard(id);
      else if (act === 'extend') extendSimcardExpiry(id);
    });
  });

  // Copy buttons
  tbody.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const text = btn.dataset.copy;
      try {
        await navigator.clipboard.writeText(text);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`;
        btn.classList.add('copied');
        toast('Zkopírováno do schránky', 'success', 1500);
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('copied');
        }, 1200);
      } catch (err) {
        toast('Chyba kopírování: ' + err.message, 'error');
      }
    });
  });

  // Row checkboxes
  tbody.querySelectorAll('.sc-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedSimcardIds.add(id);
      else state.selectedSimcardIds.delete(id);
      renderScBulkActions();
    });
  });

  renderScBulkActions();
  updateSimBadge();
}

function renderScBulkActions() {
  const bar = $('#scBulkActions');
  if (!bar) return;
  const count = state.selectedSimcardIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    $('#scBulkCount').textContent = `${count} vybráno`;
  } else {
    bar.style.display = 'none';
  }
}

// Sidebar badge — count of SIM cards that are urgent or expired
function updateSimBadge() {
  const badge = $('#simBadge');
  if (!badge) return;
  const list = state.db.simcards || [];
  let count = 0;
  list.forEach(sc => {
    const s = getSimcardStatus(sc.expiry);
    if (s === 'urgent' || s === 'expired') count++;
  });
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function openSimcardModal(sc = null) {
  const isEditing = sc && sc.id;
  state.editingSimcard = isEditing ? sc : null;
  $('#scModalTitle').textContent = isEditing ? 'Upravit SIM' : 'Přidat SIM';
  populateSimOperatorSelect(sc?.operator || '');
  $('#scfPhone').value = sc?.phone || '';
  $('#scfExpiry').value = sc?.expiry || '';
  $('#scfOwner').value = sc?.owner || '';
  $('#scfNotes').value = sc?.notes || '';
  $('#modalSimcard').classList.add('active');
  $('#scfPhone').focus();
}

async function saveSimcard() {
  const operator = $('#scfOperator').value;
  const phone = $('#scfPhone').value.trim();
  const expiry = $('#scfExpiry').value;
  if (!operator) { toast('Zadej operátora', 'error'); return; }
  if (!phone) { toast('Zadej telefonní číslo', 'error'); return; }
  if (!expiry) { toast('Zadej datum expirace', 'error'); return; }

  const sc = {
    ...(state.editingSimcard || {}),
    operator,
    phone,
    expiry,
    owner: $('#scfOwner').value.trim(),
    notes: $('#scfNotes').value.trim()
  };

  const saved = await window.api.upsertSimcard(sc);
  if (!state.db.simcards) state.db.simcards = [];
  const idx = state.db.simcards.findIndex(x => x.id === saved.id);
  if (idx >= 0) state.db.simcards[idx] = saved;
  else state.db.simcards.push(saved);

  closeModal('modalSimcard');
  toast(state.editingSimcard ? 'SIM upravena' : 'SIM přidána', 'success');
  renderSimcardsPage();
}

async function deleteSimcard(id) {
  const sc = (state.db.simcards || []).find(x => x.id === id);
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Smazat SIM',
    message: `Opravdu smazat ${sc?.operator || ''} — ${sc?.phone || ''}?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteSimcard(id);
  state.db.simcards = (state.db.simcards || []).filter(x => x.id !== id);
  state.selectedSimcardIds.delete(id);
  renderSimcardsPage();
  toast('SIM smazána', 'success');
}

async function bulkDeleteSimcards() {
  const ids = [...state.selectedSimcardIds];
  if (!ids.length) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} SIM karet?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteSimcards(ids);
  state.db.simcards = (state.db.simcards || []).filter(x => !ids.includes(x.id));
  state.selectedSimcardIds.clear();
  renderSimcardsPage();
  toast(`Smazáno ${ids.length} SIM karet`, 'success');
}

// "Prodlouženo" button — extends the expiry by 1 calendar year from
// the CURRENT expiry date (if set). If the SIM already expired, anchors on today
// instead so the user actually gets a future date (not yet another past date).
async function extendSimcardExpiry(id) {
  const sc = (state.db.simcards || []).find(x => x.id === id);
  if (!sc) return;
  const status = getSimcardStatus(sc.expiry);
  // For expired SIMs: anchor on today (so "+1 year" gives a useful future date)
  // For all others: extend from current expiry (preserves the renewal cadence)
  const baseDate = (status === 'expired' || !sc.expiry) ? null : sc.expiry;
  const newExpiry = addOneYear(baseDate);

  const updated = { ...sc, expiry: newExpiry };
  const saved = await window.api.upsertSimcard(updated);
  const idx = state.db.simcards.findIndex(x => x.id === id);
  if (idx >= 0) state.db.simcards[idx] = saved;

  toast(`Prodlouženo do ${formatExpiryDate(newExpiry)}`, 'success', 2500);
  renderSimcardsPage();
}

async function addCustomSimOperator() {
  const name = (prompt('Název nového operátora:') || '').trim();
  if (!name) return;
  const res = await window.api.addSimOperator(name);
  if (res && res.success) {
    // Update local DB cache so getSimOperators() returns the new value
    if (!state.db.simOperators) state.db.simOperators = [];
    if (Array.isArray(res.operators)) state.db.simOperators = res.operators;
    populateSimOperatorSelect(name);
    toast(`Operátor "${name}" přidán`, 'success');
  } else {
    toast(res?.error || 'Nepodařilo se přidat operátora', 'error');
  }
}

// ============ PAYOUTS ============
function findPayoutRule(platform) {
  if (!platform) return null;
  const rules = state.payoutRules || [];
  // Case-insensitive partial match (e.g. "Stubhub" matches "stubhub", "Viagogo" matches "viagogo.com")
  const p = platform.toLowerCase().trim();
  return rules.find(r => p.includes((r.platform || '').toLowerCase())) ||
         rules.find(r => (r.platform || '').toLowerCase().includes(p)) ||
         null;
}

// Calculate expected payout date for a ticket based on rules
function calculatePayoutDate(ticket) {
  const rule = findPayoutRule(ticket.platform);
  if (!rule) return null;

  let baseDateStr;
  if (rule.baseDate === 'eventDate') {
    baseDateStr = ticket.eventDate;
  } else if (rule.baseDate === 'saleDate') {
    baseDateStr = ticket.saleDate;
  } else if (rule.baseDate === 'deliveryDate') {
    // "Po doručení" pravidlo se NESMÍ aktivovat dokud ticket NENÍ doručený.
    // Dřív kód padal na ticket.saleDate jako fallback, takže prodaný-ale-nedoručený
    // ticket se choval jako by už byl doručený a počítal výplatu od saleDate.
    // Teď: bez status=delivered nevracíme nic → sloupec ZBÝVÁ ukáže "—" a
    // STAV VÝPLATY se chová neutrálně (žádné falešné "po termínu").
    if (ticket.status !== 'delivered') return null;
    // Použij timestamp kdy bylo "Doručeno" potvrzeno (deliveredAt nastavuje
    // markDelivered v ISO formátu); pokud chybí (starší ticket před zavedením
    // pole), fallbackuj na saleDate aby starý záznam stále něco ukazoval.
    if (ticket.deliveryDate) {
      baseDateStr = ticket.deliveryDate;
    } else if (ticket.deliveredAt) {
      baseDateStr = String(ticket.deliveredAt).slice(0, 10);
    } else {
      baseDateStr = ticket.saleDate;
    }
  } else {
    baseDateStr = ticket.eventDate || ticket.saleDate;
  }

  if (!baseDateStr) return null;
  const d = new Date(baseDateStr);
  if (isNaN(d)) return null;
  d.setDate(d.getDate() + (Number(rule.offsetDays) || 0));
  return d.toISOString().slice(0, 10);
}

// Get all tickets that are eligible for payout (sold or delivered)
function getPayoutTickets() {
  return (state.db.tickets || [])
    .filter(t => t.status === 'sold' || t.status === 'delivered')
    .map(t => {
      const rule = findPayoutRule(t.platform);
      const expectedDate = calculatePayoutDate(t);
      const amount = (Number(t.salePrice) || 0) * (Number(t.quantity) || 1);
      const daysLeft = expectedDate ? daysUntil(expectedDate) : null;
      const isPaid = t.paidOut === true;
      const isOverdue = !isPaid && daysLeft !== null && daysLeft < 0;
      return {
        ticket: t,
        rule,
        expectedDate,
        amount,
        daysLeft,
        isPaid,
        isOverdue
      };
    });
}

function getFilteredPayouts() {
  let list = getPayoutTickets();
  const f = state.payoutFilters;
  
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(p =>
      (p.ticket.eventName || '').toLowerCase().includes(q) ||
      (p.ticket.platform || '').toLowerCase().includes(q)
    );
  }
  if (f.platform) list = list.filter(p => p.ticket.platform === f.platform);
  if (f.status === 'pending') list = list.filter(p => !p.isPaid && !p.isOverdue);
  if (f.status === 'overdue') list = list.filter(p => p.isOverdue);
  if (f.status === 'paid') list = list.filter(p => p.isPaid);
  
  // Sort: overdue first, then upcoming by date, paid at the end
  list.sort((a, b) => {
    // Paid → end
    if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
    // Overdue → top
    if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
    // Then by expected date (closest first)
    if (!a.expectedDate) return 1;
    if (!b.expectedDate) return -1;
    return a.expectedDate.localeCompare(b.expectedDate);
  });
  
  return list;
}

function populatePayoutFilters() {
  const payouts = getPayoutTickets();
  const platforms = [...new Set(payouts.map(p => p.ticket.platform).filter(Boolean))].sort();
  const sel = $('#pFilterPlatform');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">Všechny platformy</option>' +
      platforms.map(pl => `<option value="${escapeHtml(pl)}">${escapeHtml(pl)}</option>`).join('');
    sel.value = current;
  }
}

function renderPayoutsPage() {
  populatePayoutFilters();
  const list = getFilteredPayouts();
  const all = getPayoutTickets();
  
  // Stats
  const pending = all.filter(p => !p.isPaid);
  const paid = all.filter(p => p.isPaid);
  const overdue = all.filter(p => p.isOverdue);
  
  // p.amount is the sale revenue, denominated in saleCurrency. Convert from
  // saleCurrency (not ticketCurrency, which is purchase ccy) to primary so the
  // header cards show consistent totals across mixed currencies.
  const toPrimary = (p, amt) => convertCurrency(Number(amt) || 0, saleCurrency(p.ticket), getPrimaryCurrency());
  const pendingSum = pending.reduce((s, p) => s + toPrimary(p, p.amount), 0);
  const paidSum = paid.reduce((s, p) => {
    const amt = p.ticket.paidOutAmount !== null && p.ticket.paidOutAmount !== undefined ? Number(p.ticket.paidOutAmount) : p.amount;
    return s + toPrimary(p, amt);
  }, 0);
  const overdueSum = overdue.reduce((s, p) => s + toPrimary(p, p.amount), 0);

  const primary = getPrimaryCurrency();
  $('#payPending').textContent = formatMoney(pendingSum, primary);
  $('#payReceived').textContent = formatMoney(paidSum, primary);
  $('#payOverdue').textContent = formatMoney(overdueSum, primary);
  
  // Next upcoming payout
  const upcoming = pending
    .filter(p => !p.isOverdue && p.expectedDate && p.daysLeft !== null && p.daysLeft >= 0)
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  
  if (upcoming.length > 0) {
    const n = upcoming[0];
    const dayLabel = n.daysLeft === 0 ? 'dnes' : (n.daysLeft === 1 ? 'zítra' : `za ${n.daysLeft} dní`);
    $('#payNext').innerHTML = `${escapeHtml(n.ticket.eventName || '—')} <span style="color:var(--text-tertiary); font-size:12px;">(${dayLabel}, ${formatMoney(n.amount, saleCurrency(n.ticket))})</span>`;
  } else {
    $('#payNext').textContent = '—';
  }
  
  // Table
  const tbody = $('#payoutsBody');
  const empty = $('#pEmptyState');
  
  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    // Nothing visible → clear any stale payout selection so the bulk bar
    // doesn't sit there with old counts after a filter change.
    state.selectedPayoutIds.clear();
    renderPayoutBulkActions();
    const saEmpty = $('#pSelectAll');
    if (saEmpty) { saEmpty.checked = false; saEmpty.indeterminate = false; }
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = list.map(p => {
    const t = p.ticket;
    const urgency = getDaysUrgency(p.daysLeft);
    const status = t.status === 'delivered' ? '<span class="status-pill status-delivered">✓ Doručeno</span>' : '<span class="status-pill status-sold">Prodáno</span>';
    
    let payoutStatusCell;
    let actionCell;
    
    if (p.isPaid) {
      const paidAmount = t.paidOutAmount !== null && t.paidOutAmount !== undefined ? Number(t.paidOutAmount) : p.amount;
      const diff = paidAmount - p.amount;
      const tc = saleCurrency(t);
      const diffLabel = Math.abs(diff) < 0.01 ? '' : ` <span style="color:${diff >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'}">(${diff >= 0 ? '+' : ''}${formatMoney(diff, tc)})</span>`;
      payoutStatusCell = `<span class="status-pill status-sold" title="Přijato ${formatDate(t.paidOutDate)} - ${formatMoney(paidAmount, tc)}">✓ Vyplaceno</span>${diffLabel}`;
      actionCell = `<button class="btn btn-dark btn-sm" data-p-action="unpaid" data-id="${t.id}" title="Vrátit zpět na čekání">↶ Vrátit</button>`;
    } else if (p.isOverdue) {
      payoutStatusCell = '<span class="status-pill status-cancelled">⚠ Po termínu</span>';
      actionCell = `<button class="btn btn-success btn-sm" data-p-action="paid" data-id="${t.id}">💰 Přišlo</button>`;
    } else if (p.expectedDate) {
      payoutStatusCell = '<span class="status-pill" style="background:rgba(167, 139, 250, 0.15);color:#c4b5fd;border:1px solid rgba(167, 139, 250, 0.35)">⏳ Čeká</span>';
      actionCell = `<button class="btn btn-success btn-sm" data-p-action="paid" data-id="${t.id}">💰 Přišlo</button>`;
    } else if (p.rule && p.rule.baseDate === 'deliveryDate' && t.status !== 'delivered') {
      // Pravidlo "po doručení" existuje, ale ticket ještě není doručený zákazníkovi.
      // Jasný hint co s tím má uživatel udělat — nezobrazujeme ani "Po termínu" ani
      // "Neznámé pravidlo" (oboje by bylo zavádějící).
      payoutStatusCell = '<span class="status-pill" style="background:rgba(251, 191, 36, 0.12);color:#fbbf24;border:1px solid rgba(251, 191, 36, 0.35)" title="Pravidlo se aktivuje až po označení \'Doručeno\'">📦 Čeká na doručení</span>';
      actionCell = `<button class="btn btn-success btn-sm" data-p-action="paid" data-id="${t.id}">💰 Přišlo</button>`;
    } else {
      payoutStatusCell = '<span class="status-pill status-cancelled">? Neznámé pravidlo</span>';
      actionCell = `<button class="btn btn-success btn-sm" data-p-action="paid" data-id="${t.id}">💰 Přišlo</button>`;
    }
    
    const ruleInfo = p.rule
      ? `<small style="color:var(--text-tertiary); font-size:10px; display:block;">${p.rule.baseDate === 'eventDate' ? 'po eventu' : (p.rule.baseDate === 'deliveryDate' ? 'po doručení' : 'po prodeji')} +${p.rule.offsetDays} dní</small>`
      : `<small style="color:var(--red-bright); font-size:10px; display:block;">⚠ Chybí pravidlo - nastav v ⚙️</small>`;
    
    return `
      <tr data-id="${t.id}" class="${p.isOverdue && !p.isPaid ? 'row-urgent' : ''} ${p.isPaid ? 'row-paid' : ''}">
        <td class="col-check"><input type="checkbox" class="row-check p-row-check" data-id="${t.id}" ${state.selectedPayoutIds.has(t.id) ? 'checked' : ''}></td>
        <td><strong>${escapeHtml(t.eventName || '—')}</strong></td>
        <td>${t.eventDate ? formatDate(t.eventDate) : '—'}</td>
        <td>${t.quantity || 1}</td>
        <td><strong>${formatMoney(p.amount, saleCurrency(t))}</strong></td>
        <td>${escapeHtml(t.platform || '—')}${ruleInfo}</td>
        <td>${status}</td>
        <td>${p.expectedDate ? formatDate(p.expectedDate) : '—'}</td>
        <td>${(p.isPaid || !p.expectedDate) ? '—' : `<span class="days-badge ${urgency.class}">${urgency.label}</span>`}</td>
        <td>${payoutStatusCell}</td>
        <td class="col-actions"><div class="actions-cell">${actionCell}</div></td>
      </tr>
    `;
  }).join('');
  
  // Action listeners
  tbody.querySelectorAll('[data-p-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.pAction;
      const ticket = state.db.tickets.find(t => t.id === id);
      if (!ticket) return;
      if (act === 'paid') openPayoutPaidModal(ticket);
      else if (act === 'unpaid') unmarkPayoutPaid(id);
    });
  });

  // Row checkboxes — track selection in a Set keyed by ticket id (payouts ARE
  // tickets under the hood, so reusing the ticket id keeps things simple).
  tbody.querySelectorAll('.p-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedPayoutIds.add(id);
      else state.selectedPayoutIds.delete(id);
      // Sync selectAll header state.
      const sa = $('#pSelectAll');
      if (sa) {
        const visible = list.length;
        const selectedVisible = list.filter(p => state.selectedPayoutIds.has(p.ticket.id)).length;
        sa.checked = visible > 0 && selectedVisible === visible;
        sa.indeterminate = selectedVisible > 0 && selectedVisible < visible;
      }
      renderPayoutBulkActions();
    });
  });

  // Sync selectAll on (re)render based on currently visible rows.
  const sa = $('#pSelectAll');
  if (sa) {
    const visible = list.length;
    const selectedVisible = list.filter(p => state.selectedPayoutIds.has(p.ticket.id)).length;
    sa.checked = visible > 0 && selectedVisible === visible;
    sa.indeterminate = selectedVisible > 0 && selectedVisible < visible;
  }
  renderPayoutBulkActions();
}

function openPayoutPaidModal(ticket) {
  state.payingOutTicket = ticket;
  const amount = (Number(ticket.salePrice) || 0) * (Number(ticket.quantity) || 1);
  const expectedDate = calculatePayoutDate(ticket);
  
  $('#payPaidInfo').innerHTML = `
    <div class="sell-info-row">
      <span class="sell-info-label">Event:</span>
      <span class="sell-info-value">${escapeHtml(ticket.eventName || '—')}</span>
    </div>
    <div class="sell-info-row">
      <span class="sell-info-label">Platforma:</span>
      <span class="sell-info-value">${escapeHtml(ticket.platform || '—')}</span>
    </div>
    <div class="sell-info-row">
      <span class="sell-info-label">Očekáváno:</span>
      <span class="sell-info-value"><strong>${formatMoney(amount, saleCurrency(ticket))}</strong>${expectedDate ? ` (${formatDate(expectedDate)})` : ''}</span>
    </div>
  `;
  $('#payPaidDate').value = new Date().toISOString().slice(0, 10);
  $('#payPaidAmount').value = '';
  $('#payPaidAmount').placeholder = `${amount.toFixed(2)} (nech prázdné pokud sedí)`;
  
  $('#modalPayoutPaid').classList.add('active');
  $('#payPaidDate').focus();
}

async function confirmPayoutPaid() {
  const ticket = state.payingOutTicket;
  if (!ticket) return;
  const paidDate = $('#payPaidDate').value;
  const paidAmountStr = $('#payPaidAmount').value.trim();
  const paidAmount = paidAmountStr === '' ? null : parseFloat(paidAmountStr);
  
  const res = await window.api.markPayoutPaid({
    ticketId: ticket.id,
    paidOutDate: paidDate,
    paidOutAmount: paidAmount
  });
  
  if (res.success) {
    // Update local state
    const idx = state.db.tickets.findIndex(t => t.id === ticket.id);
    if (idx >= 0 && res.ticket) state.db.tickets[idx] = res.ticket;
    closeModal('modalPayoutPaid');
    renderPayoutsPage();
    toast('✓ Výplata zaznamenána', 'success');
  } else {
    toast('Chyba: ' + (res.error || 'neznámá'), 'error');
  }
}

async function unmarkPayoutPaid(ticketId) {
  const res = await window.api.unmarkPayoutPaid(ticketId);
  if (res.success) {
    const idx = state.db.tickets.findIndex(t => t.id === ticketId);
    if (idx >= 0) {
      state.db.tickets[idx] = {
        ...state.db.tickets[idx],
        paidOut: false,
        paidOutDate: null,
        paidOutAmount: null
      };
    }
    renderPayoutsPage();
    toast('Výplata vrácena do čekajících', 'info');
  }
}

// ============ PAYOUT RULES MODAL ============
function openPayoutRulesModal() {
  renderPayoutRulesList();
  $('#modalPayoutRules').classList.add('active');
}

function renderPayoutRulesList() {
  const list = $('#payoutRulesList');
  const rules = state.payoutRules || [];
  
  if (rules.length === 0) {
    list.innerHTML = '<p style="color:var(--text-tertiary); font-size:12px;">Žádná pravidla. Klikni na tlačítko níže pro přidání.</p>';
    return;
  }
  
  list.innerHTML = rules.map((r, i) => `
    <div class="payout-rule-row" data-idx="${i}">
      <div class="payout-rule-fields">
        <div class="form-group">
          <label>Platforma</label>
          <input type="text" class="rule-platform" value="${escapeHtml(r.platform || '')}" placeholder="Viagogo">
        </div>
        <div class="form-group">
          <label>Počítat od</label>
          <select class="rule-base-date">
            <option value="eventDate" ${r.baseDate === 'eventDate' ? 'selected' : ''}>Datum eventu</option>
            <option value="saleDate" ${r.baseDate === 'saleDate' ? 'selected' : ''}>Datum prodeje</option>
            <option value="deliveryDate" ${r.baseDate === 'deliveryDate' ? 'selected' : ''}>Datum doručení</option>
          </select>
        </div>
        <div class="form-group">
          <label>+ dní</label>
          <input type="number" class="rule-offset" min="0" step="1" value="${Number(r.offsetDays) || 0}">
        </div>
        <button class="btn btn-danger btn-sm rule-del" data-idx="${i}" title="Smazat pravidlo">×</button>
      </div>
    </div>
  `).join('');
  
  // Delete listeners
  list.querySelectorAll('.rule-del').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      state.payoutRules.splice(idx, 1);
      renderPayoutRulesList();
    });
  });
}

function addPayoutRule() {
  state.payoutRules.push({ platform: '', baseDate: 'eventDate', offsetDays: 7 });
  renderPayoutRulesList();
}

async function savePayoutRules() {
  // Collect values from UI
  const rows = $$('.payout-rule-row');
  const rules = [];
  rows.forEach(row => {
    const platform = row.querySelector('.rule-platform').value.trim();
    const baseDate = row.querySelector('.rule-base-date').value;
    const offsetDays = parseInt(row.querySelector('.rule-offset').value) || 0;
    if (platform) rules.push({ platform, baseDate, offsetDays });
  });
  
  const res = await window.api.savePayoutRules(rules);
  if (res.success) {
    // Use cleaned rules from backend (may have fewer items due to dedup)
    state.payoutRules = res.rules || rules;
    closeModal('modalPayoutRules');
    const removedCount = rules.length - state.payoutRules.length;
    if (removedCount > 0) {
      toast(`Pravidla uložena (odstraněno ${removedCount} duplikát${removedCount === 1 ? '' : 'y'})`, 'success');
    } else {
      toast('Pravidla uložena', 'success');
    }
    renderPayoutsPage();
  } else {
    toast('Chyba: ' + (res.error || 'neznámá'), 'error');
  }
}

// Export Payouts CSV (reuses ticket export for sold/delivered with payout info)
async function exportPayoutsCsv() {
  toast('Použij hlavní Export CSV v Dashboardu', 'info');
}

// Startup check for upcoming/overdue payouts
function checkUpcomingPayouts() {
  const payouts = getPayoutTickets().filter(p => !p.isPaid);
  const overdue = payouts.filter(p => p.isOverdue);
  const incoming = payouts.filter(p => !p.isOverdue && p.daysLeft !== null && p.daysLeft >= 0 && p.daysLeft <= 3);
  
  if (overdue.length > 0) {
    // Overdue sum may span multiple currencies → convert each to primary for a
    // single meaningful total in the toast.
    const primary = getPrimaryCurrency();
    const sumOverdue = overdue.reduce((s, p) => s + convertCurrency(p.amount, saleCurrency(p.ticket), primary), 0);
    toast(`💸 ${overdue.length} výplat po termínu (${formatMoney(sumOverdue, primary)}) - zkontroluj účet!`, 'error', 10000);
  }
  if (incoming.length > 0) {
    incoming.forEach(p => {
      const label = p.daysLeft === 0 ? 'DNES' : (p.daysLeft === 1 ? 'zítra' : `za ${p.daysLeft} dny`);
      toast(`💰 Výplata ${label}: ${p.ticket.eventName} (${formatMoney(p.amount, saleCurrency(p.ticket))})`, 'info', 8000);
    });
  }
}

// ============ INBOX (email parser results) ============
function getInboxItems() {
  return (state.db.inbox || []).filter(i => i.state === 'pending_review' || !i.state);
}

function getFilteredInboxItems() {
  let items = getInboxItems();
  const f = state.inboxFilters;
  if (f.kind === 'purchase') items = items.filter(i => i.parsed?.kind === 'purchase');
  else if (f.kind === 'sale') items = items.filter(i => i.parsed?.kind === 'sale');
  else if (f.kind === 'error') items = items.filter(i => !i.parsed?.success);
  if (f.platform) items = items.filter(i => i.parsed?.platform === f.platform);
  return items;
}

// Find matching tickets for a sale email based on Listing ID
function findMatchesForSale(parsed) {
  const tickets = state.db.tickets || [];
  if (!parsed || parsed.kind !== 'sale') return [];
  
  const platform = (parsed.platform || '').toLowerCase();
  const orderId = parsed.orderId;
  const listingId = parsed.listingId;
  
  if (!orderId && !listingId) return [];
  
  return tickets.filter(t => {
    if (t.status === 'sold' || t.status === 'delivered' || t.status === 'cancelled') return false;
    const ids = t.externalIds || {};
    
    if (platform.includes('viagogo')) {
      // Check if ticket's Viagogo Listing ID matches email's Order ID or Listing ID
      if (ids.viagogoListingId) {
        if (ids.viagogoListingId === orderId || ids.viagogoListingId === listingId) return true;
      }
      if (ids.viagogoOrderId && ids.viagogoOrderId === orderId) return true;
    } else if (platform.includes('stubhub')) {
      if (ids.stubhubListingId) {
        if (ids.stubhubListingId === orderId || ids.stubhubListingId === listingId) return true;
      }
      if (ids.stubhubOrderId && ids.stubhubOrderId === orderId) return true;
    }
    return false;
  });
}

function renderInboxPage() {
  const allPending = getInboxItems();
  const filtered = getFilteredInboxItems();
  const list = $('#inboxList');
  
  // Update stats
  $('#inboxPending').textContent = allPending.length;
  $('#inboxPurchases').textContent = allPending.filter(i => i.parsed?.kind === 'purchase').length;
  $('#inboxSales').textContent = allPending.filter(i => i.parsed?.kind === 'sale').length;
  $('#inboxErrors').textContent = allPending.filter(i => !i.parsed?.success).length;
  $('#inboxCountInline').textContent = allPending.length > 0 ? allPending.length : '';
  
  // Empty state - rebuild inline so we don't depend on a stale DOM reference
  // (the old code kept a ref to #inboxEmpty but list.innerHTML wipes it out).
  if (filtered.length === 0) {
    list.innerHTML = `
      <div class="empty-state" id="inboxEmpty">
        <div class="empty-icon">📭</div>
        <div class="empty-title">Žádné příchozí emaily</div>
        <div class="empty-text">
          Nastav si v Gmailu filter pro automatický forward emailů o nákupech/prodejích.<br>
          <a href="#" id="btnInboxHelp" style="color: var(--purple);">Zobrazit návod</a>
        </div>
      </div>
    `;
    // Re-attach help link handler since we just rebuilt the element
    $('#btnInboxHelp')?.addEventListener('click', (e) => {
      e.preventDefault();
      openInboxHelp();
    });
    return;
  }
  
  list.innerHTML = filtered.map(item => renderInboxCard(item)).join('');
  
  // Bind action listeners
  list.querySelectorAll('[data-inbox-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.inboxAction;
      const id = btn.dataset.inboxId;
      if (action === 'approve') await approveInboxItem(id);
      else if (action === 'dismiss') await dismissInboxItem(id);
      else if (action === 'apply-sale') await applyInboxSale(id, btn.dataset.ticketId);
      else if (action === 'create-and-mark-sold') await createTicketFromInboxAsSold(id);
      else if (action === 'pick-match') openMatchPickerModal(id);
      else if (action === 'advanced-edit') openInboxAdvancedEditModal(id);
    });
  });

  // Inline-edit handlers — save overrides on blur so the user can fix
  // missing fields right in the inbox card before approving.
  // Both <input> and contenteditable spans are covered.
  list.querySelectorAll('.inbox-detail-input').forEach(el => {
    el.addEventListener('change', async () => {
      await saveInboxFieldOverride(el.dataset.id, el.dataset.field, el.value);
    });
    // Stop click from bubbling into the card so we don't accidentally trigger
    // some future "click card to expand" interaction.
    el.addEventListener('click', e => e.stopPropagation());
  });
  list.querySelectorAll('.editable-title').forEach(el => {
    el.addEventListener('blur', async () => {
      const val = (el.textContent || '').trim();
      await saveInboxFieldOverride(el.dataset.id, el.dataset.field, val);
    });
    // Enter key commits + blurs (instead of inserting newline).
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
    });
    el.addEventListener('click', e => e.stopPropagation());
  });
}

// ============================================================
// FALLBACK SUBJECT PARSER
// ------------------------------------------------------------
// When the server-side parser returns a successful 'kind' but leaves event
// name / order ID / platform blank, we mine the email subject for whatever
// we can rescue. Handles common patterns from Ticketmaster (ES/UK/US),
// Stubhub, Viagogo, AXS, Eventim, See Tickets, Live Nation, etc.
//
// This NEVER overwrites fields that already have values from the server
// parser — it only fills in the blanks.
// ============================================================
function enrichParsedFromSubject(parsed, subject) {
  if (!subject) return parsed;
  const out = { ...parsed };
  const s = subject;

  // ── Platform detection ───────────────────────────────────────────────
  // Server typically sets this, but rescue if blank.
  if (!out.platform || out.platform === '—' || out.platform === 'Neznámá platforma') {
    if (/ticketmaster/i.test(s) || /referencia\s+\d+/i.test(s)) out.platform = 'Ticketmaster';
    else if (/stubhub/i.test(s)) out.platform = 'Stubhub';
    else if (/viagogo/i.test(s)) out.platform = 'Viagogo';
    else if (/eventim/i.test(s)) out.platform = 'Eventim';
    else if (/livenation|live\s+nation/i.test(s)) out.platform = 'Live Nation';
    else if (/axs\s/i.test(s)) out.platform = 'AXS';
    else if (/seetickets|see\s+tickets/i.test(s)) out.platform = 'See Tickets';
  }

  // ── Order / reference ID ────────────────────────────────────────────
  // Ticketmaster ES: "número de referencia 011377758"
  // Ticketmaster UK/US: "Order #12-12345/SF" / "Order Confirmation: 12345"
  // Stubhub: "Order 12345" / "#STH-12345"
  // Viagogo: "Order ID 123-456-789"
  if (!out.orderId) {
    const ref = s.match(/(?:n[uú]mero de referencia|reference|order(?:\s*id|\s*#|\s*number)?|orden(?:\s*n[uú]m)?|booking(?:\s*ref)?)\s*[:#]?\s*([A-Z0-9][\w\-/.]{4,})/i);
    if (ref) out.orderId = ref[1];
  }

  // ── Event name ──────────────────────────────────────────────────────
  // Strip common email prefixes ("Fwd:", "Re:", "RE:", "FW:") first.
  let work = s.replace(/^(?:Fwd|Fw|Re|RE)\s*:\s*/gi, '').trim();
  // Strip leading platform/marketing prefixes ("Confirmacion de compra para", etc.)
  const eventPatterns = [
    // Spanish: "Confirmacion de compra para <EVENT>, número de referencia ..."
    /confirmaci[oó]n?\s+de\s+compra\s+para\s+([^,]+?)(?:,\s*n[uú]mero|,\s*orden|,\s*referencia|$)/i,
    // English: "Your tickets for <EVENT>" / "Confirmation for <EVENT>"
    /your\s+(?:order|tickets?|booking)\s+(?:for|to)\s+(.+?)(?:\s*[-–—]\s*order|\s*\#|\s*\(|$)/i,
    /(?:confirmation|confirmed)\s+(?:for|of)?\s*[:\-]?\s*(.+?)(?:\s*[-–—]\s*order|\s*\#|\s*\(|$)/i,
    // German: "Ihre Bestellung für <EVENT>"
    /ihre\s+bestellung\s+(?:für|fuer)\s+(.+?)(?:\s*[-–—]|\s*\(|$)/i,
    // Czech: "Vaše objednávka pro <EVENT>"
    /vaše?\s+objedn[áa]vk[ay]\s+(?:pro|na)\s+(.+?)(?:\s*[-–—]|\s*\(|$)/i,
    // French: "Votre commande pour <EVENT>"
    /votre\s+commande\s+pour\s+(.+?)(?:\s*[-–—]|\s*\(|$)/i,
    // Italian: "Conferma ordine per <EVENT>"
    /conferma\s+ordine\s+per\s+(.+?)(?:\s*[-–—]|\s*\(|$)/i,
  ];
  if (!out.event) {
    for (const pat of eventPatterns) {
      const m = work.match(pat);
      if (m && m[1].trim().length > 3) {
        out.event = m[1].trim()
          // Strip trailing reference noise that crept past the comma
          .replace(/\s*[-–—]?\s*(?:n[uú]mero|orden|referencia|order|booking).*$/i, '')
          .trim();
        break;
      }
    }
  }
  return out;
}

function renderInboxCard(item) {
  // Apply subject-based enrichment to fill in blanks the server parser left.
  // This is non-destructive (only fills missing fields) and applied for both
  // 'purchase' and 'sale' kinds, plus failed/unknown.
  const p = enrichParsedFromSubject(item.parsed || {}, item.subject);
  // Also stash user-edited overrides if present (from inline field edits).
  if (item.parsedOverrides) Object.assign(p, item.parsedOverrides);
  const received = new Date(item.receivedAt).toLocaleString('cs-CZ');

  // Failed parser
  if (!p.success) {
    return `
      <div class="inbox-card inbox-card-error" data-id="${item.id}">
        <div class="inbox-card-header">
          <span class="inbox-kind-badge inbox-kind-error">⚠ Nerozpoznáno</span>
          <span class="inbox-platform-badge">${escapeHtml(p.platform || 'Neznámá platforma')}</span>
          <span class="inbox-date">${received}</span>
        </div>
        <div class="inbox-title">${escapeHtml(item.subject || '(bez předmětu)')}</div>
        <div class="inbox-subject">od: ${escapeHtml(item.from || '—')}</div>
        <div class="inbox-match-box no-match">
          ${escapeHtml(p.error || 'Parser neumí zpracovat tento typ emailu.')}
        </div>
        <div class="inbox-actions">
          <button class="btn btn-dark" data-inbox-action="dismiss" data-inbox-id="${item.id}">× Zahodit</button>
        </div>
      </div>
    `;
  }
  
  const isPurchase = p.kind === 'purchase';
  const isSale = p.kind === 'sale';
  const price = p.totalAmount || (p.pricePerTicket * (p.quantity || 1)) || 0;
  const currency = p.currency || 'EUR';
  
  // For sales, find matches
  let matchInfo = '';
  let actions = '';
  
  if (isSale) {
    const matches = findMatchesForSale(p);
    if (matches.length === 1) {
      const t = matches[0];
      matchInfo = `
        <div class="inbox-match-box">
          ✅ <strong>Spárováno:</strong> "${escapeHtml(t.eventName)}" (${t.eventDate || '?'}, ${t.quantity} ks)
          ${(t.externalIds?.viagogoListingId || t.externalIds?.stubhubListingId) ? `<br><small>Listing ID: ${escapeHtml(t.externalIds.viagogoListingId || t.externalIds.stubhubListingId)}</small>` : ''}
        </div>
      `;
      actions = `
        <button class="btn btn-success" data-inbox-action="apply-sale" data-inbox-id="${item.id}" data-ticket-id="${t.id}">✓ Označit prodané</button>
        <button class="btn btn-dark" data-inbox-action="dismiss" data-inbox-id="${item.id}">× Zahodit</button>
      `;
    } else if (matches.length > 1) {
      matchInfo = `
        <div class="inbox-match-box multi-match">
          ⚠️ <strong>${matches.length} možných shod</strong> - vyber ručně
        </div>
      `;
      actions = `
        <button class="btn btn-primary" data-inbox-action="pick-match" data-inbox-id="${item.id}">Vybrat vstupenku</button>
        <button class="btn btn-dark" data-inbox-action="dismiss" data-inbox-id="${item.id}">× Zahodit</button>
      `;
    } else {
      matchInfo = `
        <div class="inbox-match-box no-match">
          ⚠️ Žádná vstupenka s tímto Listing ID v inventáři.<br>
          <small>Viagogo Order ID: ${escapeHtml(p.orderId || '?')}, Listing ID: ${escapeHtml(p.listingId || '—')}</small>
        </div>
      `;
      actions = `
        <button class="btn btn-primary" data-inbox-action="pick-match" data-inbox-id="${item.id}">Vybrat ručně</button>
        <button class="btn btn-dark" data-inbox-action="create-and-mark-sold" data-inbox-id="${item.id}">Vytvořit novou + prodaná</button>
        <button class="btn btn-dark" data-inbox-action="dismiss" data-inbox-id="${item.id}">× Zahodit</button>
      `;
    }
  }
  
  if (isPurchase) {
    actions = `
      <button class="btn btn-success" data-inbox-action="approve" data-inbox-id="${item.id}">✓ Přidat do inventáře</button>
      <button class="btn btn-dark" data-inbox-action="dismiss" data-inbox-id="${item.id}">× Zahodit</button>
    `;
  }
  
  return `
    <div class="inbox-card inbox-card-${p.kind || 'error'}" data-id="${item.id}">
      <div class="inbox-card-header">
        <span class="inbox-kind-badge inbox-kind-${p.kind}">
          ${isPurchase ? '🛒 NÁKUP' : '💰 PRODEJ'}
          ${p.saleType === 'sold_transfer_needed' ? ' · TRANSFER' : ''}
          ${p.saleType === 'sold_upload_needed' ? ' · UPLOAD' : ''}
        </span>
        <span class="inbox-platform-badge">${escapeHtml(p.platform || '—')}</span>
        <span class="inbox-date">${received}</span>
      </div>
      <div class="inbox-title editable-title" data-field="event" data-id="${item.id}"
           contenteditable="true" spellcheck="false"
           data-placeholder="(klikni pro zadání eventu)">${escapeHtml(p.event || '')}</div>
      <div class="inbox-subject">${escapeHtml(item.subject || '')}</div>
      <div class="inbox-details-grid">
        <div class="inbox-detail">
          <span class="inbox-detail-label">Datum</span>
          <input class="inbox-detail-input" type="text" data-field="eventDate" data-id="${item.id}"
                 value="${escapeHtml(p.eventDate ? p.eventDate : '')}"
                 placeholder="YYYY-MM-DD"
                 inputmode="numeric">
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Místo</span>
          <input class="inbox-detail-input" type="text" data-field="venue" data-id="${item.id}"
                 value="${escapeHtml(p.venue || '')}"
                 placeholder="např. Etihad Stadium">
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Sekce</span>
          <input class="inbox-detail-input" type="text" data-field="section" data-id="${item.id}"
                 value="${escapeHtml(p.section || '')}"
                 placeholder="např. Gold Circle">
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Ks</span>
          <input class="inbox-detail-input" type="number" min="1" data-field="quantity" data-id="${item.id}"
                 value="${p.quantity || 1}">
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">${isPurchase ? 'Cena celkem' : 'Proceeds'}</span>
          <div class="inbox-price-row">
            <input class="inbox-detail-input price-input" type="number" step="0.01" data-field="totalAmount" data-id="${item.id}"
                   value="${price ? price.toFixed(2) : ''}"
                   placeholder="0.00">
            <select class="inbox-detail-input currency-input" data-field="currency" data-id="${item.id}">
              ${['EUR','USD','GBP','CZK','PLN','CHF','HUF','SEK','NOK','DKK','RON'].map(c => `<option value="${c}" ${c === currency ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Order ID</span>
          <input class="inbox-detail-input mono-input" type="text" data-field="orderId" data-id="${item.id}"
                 value="${escapeHtml(p.orderId || '')}"
                 placeholder="číslo objednávky">
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Datum nákupu</span>
          <input class="inbox-detail-input" type="date" data-field="purchaseDate" data-id="${item.id}"
                 value="${escapeHtml(p.purchaseDate || (item.receivedAt ? new Date(item.receivedAt).toISOString().split('T')[0] : ''))}"
                 title="Předvyplněno datem přijetí emailu — uprav pokud potřebuješ">
        </div>
        ${p.buyerName ? `
        <div class="inbox-detail">
          <span class="inbox-detail-label">Kupující</span>
          <span class="inbox-detail-value">${escapeHtml(p.buyerName)}</span>
        </div>` : ''}
        ${p.buyerEmail ? `
        <div class="inbox-detail">
          <span class="inbox-detail-label">Email kupujícího</span>
          <span class="inbox-detail-value" style="font-size: 11px;">${escapeHtml(p.buyerEmail)}</span>
        </div>` : ''}
      </div>
      ${matchInfo}
      <div class="inbox-actions">
        ${actions}
        <button class="btn btn-dark btn-sm inbox-advanced-btn" data-inbox-action="advanced-edit" data-inbox-id="${item.id}" title="Upravit všechny detaily">
          🔧 Pokročilá úprava
        </button>
      </div>
    </div>
  `;
}

// ============ INBOX ACTIONS ============
async function approveInboxItem(id) {
  const item = (state.db.inbox || []).find(i => i.id === id);
  if (!item || !item.parsed?.success) return;
  // Build the effective parsed object: server parsed → subject enrichment → user overrides.
  // This way the user's inline-edited fields (and advanced-modal saves) win.
  const p = Object.assign(
    {},
    enrichParsedFromSubject(item.parsed, item.subject),
    item.parsedOverrides || {}
  );

  // ─── Required fields validation ──────────────────────────────────────
  // Refuse to create a ticket if critical fields are missing. The user must
  // either edit them inline on the inbox card or use the Advanced Edit modal.
  // Critical = event + eventDate + venue + section + (quantity > 0) + price.
  // We tolerate missing row/seat/orderId because they're optional.
  const missing = [];
  if (!p.event || p.event === '(bez názvu)') missing.push('Název eventu');
  if (!p.eventDate) missing.push('Datum eventu');
  if (!p.venue) missing.push('Místo');
  if (!p.section) missing.push('Sekce');
  if (!p.quantity || p.quantity < 1) missing.push('Počet ks');
  // For purchases, we need at least one of totalAmount or pricePerTicket
  if (p.kind === 'purchase' && !p.totalAmount && !p.pricePerTicket) {
    missing.push('Cena');
  }

  if (missing.length > 0) {
    toast(`Chybí povinné údaje: ${missing.join(', ')}. Doplň je v kartě nebo přes 🔧 Pokročilá úprava.`, 'error', 6000);
    // Visually highlight the missing inputs so the user sees what's empty
    const card = document.querySelector(`.inbox-card[data-id="${id}"]`);
    if (card) {
      // Map field names to data-field attributes
      const fieldMap = {
        'Název eventu': 'event',
        'Datum eventu': 'eventDate',
        'Místo': 'venue',
        'Sekce': 'section',
        'Počet ks': 'quantity',
        'Cena': 'totalAmount'
      };
      missing.forEach(label => {
        const fieldName = fieldMap[label];
        if (!fieldName) return;
        const el = card.querySelector(`[data-field="${fieldName}"]`);
        if (el) {
          el.classList.add('field-required-missing');
          // Remove highlight when user starts editing
          const removeOnce = () => {
            el.classList.remove('field-required-missing');
            el.removeEventListener('input', removeOnce);
            el.removeEventListener('focus', removeOnce);
          };
          el.addEventListener('input', removeOnce);
          el.addEventListener('focus', removeOnce);
        }
      });
    }
    return;
  }

  // ─── Purchase date auto-fill ────────────────────────────────────────
  // If the email parser didn't set purchaseDate, derive it from when the
  // email arrived in our inbox (receivedAt) — that's when the user *bought*
  // the tickets, give or take a few minutes. The user can override this
  // later by editing the ticket directly in the Inventory.
  let purchaseDate = p.purchaseDate || '';
  if (!purchaseDate && item.receivedAt) {
    // Convert ISO timestamp to YYYY-MM-DD (local time, not UTC, so 23:59
    // forwards don't roll over to the next day in the user's timezone).
    const d = new Date(item.receivedAt);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    purchaseDate = `${yyyy}-${mm}-${dd}`;
  }

  // Create ticket from parsed data
  // Seat: either a single seat (from p.seat) or join all seat numbers
  // from multi-seat purchases (p.seats = [{section, row, seat, ...}, ...]).
  // Example: Chelsea purchase of seats 39 and 40 becomes "39, 40".
  let seatValue = p.seat || '';
  if (!seatValue && Array.isArray(p.seats) && p.seats.length > 0) {
    seatValue = p.seats.map(s => s.seat).filter(Boolean).join(', ');
  }

  const ticket = {
    eventName: p.event || '(bez názvu)',
    eventDate: p.eventDate || '',
    eventTime: p.eventTime || '',
    venue: p.venue || '',
    section: p.section || '',
    row: p.row || '',
    seat: seatValue,
    quantity: p.quantity || 1,
    account: p.accountEmail || '',
    platform: p.platform || 'Other',
    status: 'available',
    purchaseDate,
    purchasePrice: p.kind === 'purchase' ? (p.pricePerTicket || (p.totalAmount ? p.totalAmount / (p.quantity || 1) : 0)) : 0,
    salePrice: 0,
    // Preserve the currency the email was in (parser extracts £ → GBP, $ → USD, etc).
    // Without this, prices end up misinterpreted as primary currency — a £60 Arsenal
    // ticket would be stored as if it were 60 CZK, causing wildly wrong dashboard totals.
    currency: p.currency || getDefaultTicketCurrency(),
    logo: '',
    notes: `Přidáno z emailu (${item.subject})`
  };
  
  // Add order ID from email
  if (p.orderId) {
    ticket.externalIds = {};
    const platformLower = (p.platform || '').toLowerCase();
    if (platformLower.includes('viagogo')) {
      ticket.externalIds.viagogoOrderId = p.orderId;
    } else if (platformLower.includes('stubhub')) {
      ticket.externalIds.stubhubOrderId = p.orderId;
    } else if (platformLower.includes('ticketmaster')) {
      ticket.externalIds.ticketmasterOrderId = p.orderId;
    } else {
      ticket.externalIds.otherId = p.orderId;
    }
  }
  
  await window.api.upsertTicket(ticket);
  await markInboxItemState(id, 'approved');
  await refreshDb();
  renderInboxPage();
  render();
  toast('✓ Vstupenka přidána do inventáře', 'success', 3000);
}

async function dismissInboxItem(id) {
  await markInboxItemState(id, 'dismissed');
  await refreshDb();
  renderInboxPage();
  toast('Zahozeno', 'info', 2000);
}

// ============================================================
// INBOX FIELD OVERRIDES
// ------------------------------------------------------------
// Lets the user inline-edit fields on inbox cards (event name, date, venue,
// section, qty, price, currency, orderId, etc.) when the server parser
// missed something. Overrides are stored as `item.parsedOverrides` and
// preserved across reloads — applied on top of the server parsed payload
// at approve-time, so the resulting ticket has the user's corrections.
// ============================================================
async function saveInboxFieldOverride(id, field, rawValue) {
  if (!id || !field) return;
  const items = state.db.inbox || [];
  const item = items.find(i => i.id === id);
  if (!item) return;

  // Coerce value type per field. Numeric fields → Number, blank → delete override.
  let value = rawValue;
  if (typeof value === 'string') value = value.trim();
  if (field === 'quantity') {
    value = value === '' ? null : Math.max(1, parseInt(value, 10) || 1);
  } else if (field === 'totalAmount' || field === 'pricePerTicket') {
    value = value === '' ? null : parseFloat(value);
    if (Number.isNaN(value)) value = null;
  }

  item.parsedOverrides = item.parsedOverrides || {};
  if (value === null || value === '' || value === undefined) {
    delete item.parsedOverrides[field];
  } else {
    item.parsedOverrides[field] = value;
  }

  // Persist via the same DB upsert path the rest of the inbox uses.
  // We piggyback on the inbox state setter — it already accepts arbitrary
  // patches in the item record.
  try {
    if (window.api.updateInboxItem) {
      await window.api.updateInboxItem(id, { parsedOverrides: item.parsedOverrides });
    } else if (window.api.saveInbox) {
      // Fallback: rewrite the whole inbox array.
      await window.api.saveInbox(items);
    }
  } catch (e) {
    console.warn('saveInboxFieldOverride failed:', e);
  }
}

// ─── Advanced Edit Modal ─────────────────────────────────────────────
// One-click "Pokročilá úprava" opens a structured modal with all parseable
// fields (event, date, time, venue, section, row, seat, qty, price, currency,
// platform, order ID, buyer name/email). Saves overrides into the same
// `parsedOverrides` bag, then re-renders the inbox.
function openInboxAdvancedEditModal(id) {
  const item = (state.db.inbox || []).find(i => i.id === id);
  if (!item) return;
  const p = Object.assign(
    {},
    enrichParsedFromSubject(item.parsed || {}, item.subject),
    item.parsedOverrides || {}
  );

  // Build modal HTML — inline so we don't need to mutate index.html.
  // Two-column form, scrollable on small screens.
  const existing = document.getElementById('modalInboxEdit');
  if (existing) existing.remove();

  const currencies = ['EUR','USD','GBP','CZK','PLN','CHF','HUF','SEK','NOK','DKK','RON'];
  const platforms = ['Ticketmaster','Stubhub','Viagogo','Eventim','Live Nation','AXS','See Tickets','Other'];

  const modal = document.createElement('div');
  modal.className = 'modal active';
  modal.id = 'modalInboxEdit';
  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-content modal-large">
      <div class="modal-header">
        <h3>🔧 Pokročilá úprava emailu</h3>
        <button class="modal-close" id="iaeClose">×</button>
      </div>
      <div class="modal-body">
        <div class="modal-section-label">Event</div>
        <div class="form-row">
          <div class="form-group form-full">
            <label>Název eventu</label>
            <input type="text" id="iaeEvent" value="${escapeHtml(p.event || '')}" placeholder="Bad Bunny - World Tour">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Datum eventu (YYYY-MM-DD)</label>
            <input type="text" id="iaeDate" value="${escapeHtml(p.eventDate || '')}" placeholder="2026-06-07">
          </div>
          <div class="form-group">
            <label>Čas eventu</label>
            <input type="text" id="iaeTime" value="${escapeHtml(p.eventTime || '')}" placeholder="20:00">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-full">
            <label>Místo / Venue</label>
            <input type="text" id="iaeVenue" value="${escapeHtml(p.venue || '')}" placeholder="Estadio Riyadh Air Metropolitano">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-full">
            <label>Datum nákupu <span style="color: var(--text-tertiary); font-weight: 400;">(automaticky podle data přijetí emailu)</span></label>
            <input type="date" id="iaePurchaseDate" value="${escapeHtml(p.purchaseDate || (item.receivedAt ? new Date(item.receivedAt).toISOString().split('T')[0] : ''))}">
          </div>
        </div>

        <div class="modal-section-label">Vstupenky</div>
        <div class="form-row">
          <div class="form-group">
            <label>Sekce / Zóna</label>
            <input type="text" id="iaeSection" value="${escapeHtml(p.section || '')}" placeholder="Gold Circle">
          </div>
          <div class="form-group">
            <label>Řada</label>
            <input type="text" id="iaeRow" value="${escapeHtml(p.row || '')}">
          </div>
          <div class="form-group">
            <label>Sedadlo(a)</label>
            <input type="text" id="iaeSeat" value="${escapeHtml(p.seat || '')}">
          </div>
          <div class="form-group">
            <label>Počet ks</label>
            <input type="number" id="iaeQty" value="${p.quantity || 1}" min="1">
          </div>
        </div>

        <div class="modal-section-label">Cena / Platforma</div>
        <div class="form-row">
          <div class="form-group">
            <label>Cena celkem</label>
            <input type="number" step="0.01" id="iaeTotal" value="${p.totalAmount || ''}" placeholder="326.60">
          </div>
          <div class="form-group">
            <label>Cena/ks</label>
            <input type="number" step="0.01" id="iaePerKs" value="${p.pricePerTicket || ''}" placeholder="163.30">
          </div>
          <div class="form-group">
            <label>Měna</label>
            <select id="iaeCurrency">
              ${currencies.map(c => `<option value="${c}" ${c === (p.currency || 'EUR') ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Platforma</label>
            <select id="iaePlatform">
              ${platforms.map(pl => `<option value="${pl}" ${pl === (p.platform || 'Other') ? 'selected' : ''}>${pl}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group form-full">
            <label>Order ID / Reference</label>
            <input type="text" id="iaeOrderId" value="${escapeHtml(p.orderId || '')}" placeholder="011377758" style="font-family: var(--font-mono);">
          </div>
        </div>

        ${(p.kind === 'sale' || p.buyerName || p.buyerEmail) ? `
        <div class="modal-section-label">Kupující (jen pro prodej)</div>
        <div class="form-row">
          <div class="form-group">
            <label>Jméno kupujícího</label>
            <input type="text" id="iaeBuyerName" value="${escapeHtml(p.buyerName || '')}">
          </div>
          <div class="form-group">
            <label>Email kupujícího</label>
            <input type="email" id="iaeBuyerEmail" value="${escapeHtml(p.buyerEmail || '')}">
          </div>
        </div>` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn btn-dark" id="iaeCancel">Zrušit</button>
        <button class="btn btn-primary" id="iaeSave">Uložit změny</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => modal.remove();
  modal.querySelector('#iaeClose').addEventListener('click', close);
  modal.querySelector('#iaeCancel').addEventListener('click', close);
  modal.querySelector('.modal-backdrop').addEventListener('click', close);

  modal.querySelector('#iaeSave').addEventListener('click', async () => {
    const get = (id) => modal.querySelector('#' + id)?.value.trim();
    const getNum = (id) => {
      const v = modal.querySelector('#' + id)?.value;
      if (v === '' || v == null) return null;
      const n = parseFloat(v);
      return Number.isNaN(n) ? null : n;
    };

    const updates = {
      event: get('iaeEvent'),
      eventDate: get('iaeDate'),
      eventTime: get('iaeTime'),
      purchaseDate: get('iaePurchaseDate'),
      venue: get('iaeVenue'),
      section: get('iaeSection'),
      row: get('iaeRow'),
      seat: get('iaeSeat'),
      quantity: getNum('iaeQty') || 1,
      totalAmount: getNum('iaeTotal'),
      pricePerTicket: getNum('iaePerKs'),
      currency: get('iaeCurrency'),
      platform: get('iaePlatform'),
      orderId: get('iaeOrderId'),
    };
    const bn = get('iaeBuyerName'); if (bn) updates.buyerName = bn;
    const be = get('iaeBuyerEmail'); if (be) updates.buyerEmail = be;

    // Strip empty strings/null to keep parsedOverrides clean.
    const cleaned = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== null && v !== undefined && v !== '') cleaned[k] = v;
    }

    item.parsedOverrides = { ...(item.parsedOverrides || {}), ...cleaned };
    try {
      if (window.api.updateInboxItem) {
        await window.api.updateInboxItem(id, { parsedOverrides: item.parsedOverrides });
      } else if (window.api.saveInbox) {
        await window.api.saveInbox(state.db.inbox || []);
      }
    } catch (e) {
      console.warn('saveInboxFieldOverride failed:', e);
    }
    close();
    renderInboxPage();
    toast('Změny uloženy', 'success', 1800);
  });
}

async function applyInboxSale(inboxId, ticketId) {
  const item = (state.db.inbox || []).find(i => i.id === inboxId);
  const ticket = (state.db.tickets || []).find(t => t.id === ticketId);
  if (!item || !ticket) return;
  const p = Object.assign(
    {},
    enrichParsedFromSubject(item.parsed || {}, item.subject),
    item.parsedOverrides || {}
  );

  const platformLower = (p.platform || '').toLowerCase();
  const salePricePerKs = p.pricePerTicket || (p.totalAmount && p.quantity ? p.totalAmount / p.quantity : 0);

  // Reconcile quantities: the email tells us how many were sold (p.quantity),
  // the ticket row says how many we have (ticket.quantity). Three possible cases:
  //   1. Email sold == ticket has  → mark whole ticket sold (current behavior)
  //   2. Email sold <  ticket has  → SPLIT: sold portion + remaining row (NEW)
  //   3. Email sold >  ticket has  → unusual: probably bad parser data, warn and
  //                                  fall back to marking whole ticket sold.
  const emailQty = Number(p.quantity) || 1;
  const ticketQty = Number(ticket.quantity) || 1;

  // Build a short note about the gross-vs-net split so the user can see at a
  // glance how much StubHub's commission ate from the buyer's payment.
  let saleNote = '';
  if (p.grossSubtotal && p.totalAmount && p.grossSubtotal !== p.totalAmount) {
    const fee = p.grossSubtotal - p.totalAmount;
    const pct = ((fee / p.grossSubtotal) * 100).toFixed(1);
    saleNote = `Prodej z ${p.platform}: kupující zaplatil ${p.grossSubtotal}, tobě přišlo ${p.totalAmount} (provize ${fee}, ${pct}%)`;
  }

  // PARTIAL SALE — only some of the quantity was sold. Mirror the manual sell
  // modal flow: shrink the original row to the sold qty, create a new "available"
  // row for the remaining qty.
  if (emailQty < ticketQty) {
    const remaining = ticketQty - emailQty;

    const splitNote = `Rozděleno: ${emailQty} z ${ticketQty} ks prodáno (z emailu)`;
    const purchaseCcy = ticket.currency || p.currency || getDefaultTicketCurrency();
    const emailCcy = p.currency || purchaseCcy;
    // Only store saleCurrency when the sale email is in a different currency than
    // the ticket was bought in (e.g. bought in GBP but StubHub paid out in EUR).
    // If they match, leave it undefined so getRevenueInPrimary falls back to ticket.currency.
    const soldTicket = {
      ...ticket,
      quantity: emailQty,
      status: 'sold',
      salePrice: salePricePerKs,
      currency: purchaseCcy,
      saleCurrency: emailCcy !== purchaseCcy ? emailCcy : (ticket.saleCurrency || undefined),
      saleDate: new Date().toISOString().slice(0, 10),
      buyerName: p.buyerName || ticket.buyerName,
      buyerEmail: p.buyerEmail || ticket.buyerEmail,
      notes: [ticket.notes, saleNote, splitNote].filter(Boolean).join(' | '),
      externalIds: { ...(ticket.externalIds || {}) }
    };
    if (p.orderId) {
      if (platformLower.includes('viagogo')) soldTicket.externalIds.viagogoOrderId = p.orderId;
      else if (platformLower.includes('stubhub')) soldTicket.externalIds.stubhubOrderId = p.orderId;
      else if (platformLower.includes('ticketmaster')) soldTicket.externalIds.ticketmasterOrderId = p.orderId;
    }
    await window.api.upsertTicket(soldTicket);

    // Create a remaining row — same event, same purchase price, but available.
    // We strip ID/timestamps so backend assigns fresh ones.
    const { id, created, updated, ...ticketWithoutIds } = ticket;
    const remainingTicket = {
      ...ticketWithoutIds,
      quantity: remaining,
      status: 'available',
      salePrice: 0,
      saleDate: null,
      buyerName: undefined,
      buyerEmail: undefined,
      notes: [ticket.notes, `Zbylo z původních ${ticketQty} ks (prodáno ${emailQty})`].filter(Boolean).join(' | ')
    };
    await window.api.upsertTicket(remainingTicket);

    await markInboxItemState(inboxId, 'approved');
    await refreshDb();
    renderInboxPage();
    render();
    toast(`✓ Prodáno ${emailQty} ks, ${remaining} ks zbývá na novém řádku`, 'success', 5000);
    return;
  }

  // OVER-SALE — email reports more than we have. This is almost certainly bad
  // parser data (e.g. quantity field misread), but we mark the whole ticket
  // sold and warn the user.
  if (emailQty > ticketQty) {
    toast(`⚠ Email tvrdí ${emailQty} ks, ale máš jen ${ticketQty} ks. Označím všechno jako prodané — zkontroluj data.`, 'warn', 6000);
  }

  // FULL SALE (emailQty === ticketQty, or the warning fallback above).
  const purchaseCcy = ticket.currency || p.currency || getDefaultTicketCurrency();
  const emailCcy = p.currency || purchaseCcy;
  const updated = {
    ...ticket,
    status: 'sold',
    salePrice: salePricePerKs,
    // ticket.currency = purchase currency (kept as-is). saleCurrency is stored ONLY
    // when the sale email reports a different currency (e.g. bought in GBP for Arsenal,
    // but StubHub pays in EUR). Without this split, dashboard would re-interpret the
    // EUR amount as if it were GBP and apply the GBP→EUR rate, inflating revenue.
    currency: purchaseCcy,
    saleCurrency: emailCcy !== purchaseCcy ? emailCcy : (ticket.saleCurrency || undefined),
    saleDate: new Date().toISOString().slice(0, 10),
    buyerName: p.buyerName || ticket.buyerName,
    buyerEmail: p.buyerEmail || ticket.buyerEmail,
    notes: saleNote ? [ticket.notes, saleNote].filter(Boolean).join(' | ') : ticket.notes,
    externalIds: {
      ...(ticket.externalIds || {})
    }
  };
  
  // Save Order ID
  if (p.orderId) {
    if (platformLower.includes('viagogo')) updated.externalIds.viagogoOrderId = p.orderId;
    else if (platformLower.includes('stubhub')) updated.externalIds.stubhubOrderId = p.orderId;
    else if (platformLower.includes('ticketmaster')) updated.externalIds.ticketmasterOrderId = p.orderId;
  }
  
  await window.api.upsertTicket(updated);
  await markInboxItemState(inboxId, 'approved');
  await refreshDb();
  renderInboxPage();
  render();
  toast(`✓ ${ticket.eventName} označen jako prodaný`, 'success', 3000);
}

async function createTicketFromInboxAsSold(inboxId) {
  const item = (state.db.inbox || []).find(i => i.id === inboxId);
  if (!item || !item.parsed?.success) return;
  const p = Object.assign(
    {},
    enrichParsedFromSubject(item.parsed, item.subject),
    item.parsedOverrides || {}
  );
  
  const platformLower = (p.platform || '').toLowerCase();
  const salePricePerKs = p.pricePerTicket || (p.totalAmount && p.quantity ? p.totalAmount / p.quantity : 0);
  
  const ticket = {
    eventName: p.event || '(bez názvu)',
    eventDate: p.eventDate || '',
    venue: p.venue || '',
    section: p.section || '',
    row: p.row || '',
    quantity: p.quantity || 1,
    platform: p.platform || 'Other',
    status: 'sold',
    purchasePrice: 0,  // unknown, user fills in
    salePrice: salePricePerKs,
    // Parser extracts currency from price symbol (£/$/€). Keep it so dashboard
    // conversions work correctly — otherwise the sale price would be misread
    // as being in the user's primary currency.
    currency: p.currency || getDefaultTicketCurrency(),
    saleDate: new Date().toISOString().slice(0, 10),
    buyerName: p.buyerName,
    buyerEmail: p.buyerEmail,
    notes: `Přidáno z emailu o prodeji (${item.subject}). POZOR: Nákupní cena zatím neznámá - doplň.`,
    externalIds: {}
  };
  
  if (p.orderId) {
    if (platformLower.includes('viagogo')) ticket.externalIds.viagogoOrderId = p.orderId;
    else if (platformLower.includes('stubhub')) ticket.externalIds.stubhubOrderId = p.orderId;
  }
  
  await window.api.upsertTicket(ticket);
  await markInboxItemState(inboxId, 'approved');
  await refreshDb();
  renderInboxPage();
  render();
  toast('✓ Nová vstupenka vytvořena jako prodaná', 'success', 3000);
}

async function markInboxItemState(id, newState) {
  const db = state.db;
  const item = (db.inbox || []).find(i => i.id === id);
  if (!item) return;
  item.state = newState;
  item.resolvedAt = new Date().toISOString();
  // Save via dedicated API
  await window.api.updateInboxItem(id, { state: newState, resolvedAt: item.resolvedAt });
}

function openMatchPickerModal(inboxId) {
  const item = (state.db.inbox || []).find(i => i.id === inboxId);
  if (!item) return;
  const matches = findMatchesForSale(item.parsed);
  
  // If no strict matches, show all listed/available tickets for fuzzy selection
  let options = matches;
  if (options.length === 0) {
    options = (state.db.tickets || []).filter(t =>
      t.status === 'listed' || t.status === 'available'
    );
  }
  
  $('#inboxMatchTitle').textContent = `Vybrat vstupenku pro: ${item.parsed.event}`;
  const listEl = $('#inboxMatchList');
  
  if (options.length === 0) {
    listEl.innerHTML = '<p style="color: var(--text-tertiary);">Žádné dostupné vstupenky v inventáři.</p>';
  } else {
    listEl.innerHTML = options.map(t => `
      <div class="match-option" data-ticket-id="${t.id}" data-inbox-id="${inboxId}">
        <div class="match-option-header">
          <span class="match-option-event">${escapeHtml(t.eventName)}</span>
          <span class="match-option-price">${formatMoney(t.purchasePrice, ticketCurrency(t))}</span>
        </div>
        <div class="match-option-meta">
          ${t.eventDate || '?'} · ${escapeHtml(t.venue || '—')} · ${escapeHtml(t.section || '')} · ${t.quantity} ks · ${escapeHtml(t.platform || '—')} · <strong>${t.status}</strong>
          ${t.externalIds?.viagogoListingId ? `<br>Viagogo Listing: ${t.externalIds.viagogoListingId}` : ''}
        </div>
      </div>
    `).join('');
    
    listEl.querySelectorAll('.match-option').forEach(opt => {
      opt.addEventListener('click', async () => {
        const ticketId = opt.dataset.ticketId;
        closeModal('modalInboxMatch');
        await applyInboxSale(inboxId, ticketId);
      });
    });
  }
  
  $('#modalInboxMatch').classList.add('active');
}

async function refreshInbox() {
  const btn = $('#btnInboxRefresh');
  const origText = btn?.textContent;
  
  // Show busy state so the user knows the button was registered
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Obnovuji...';
  }
  
  try {
    // Remember current inbox IDs to detect what's actually new
    const prevIds = new Set((state.db.inbox || []).map(i => i.id));
    
    await refreshDb();
    renderInboxPage();
    updateInboxBadge();
    
    const nowIds = (state.db.inbox || []).map(i => i.id);
    const newCount = nowIds.filter(id => !prevIds.has(id)).length;
    
    if (newCount > 0) {
      const label = newCount === 1 ? '1 nový email' 
                  : newCount < 5 ? `${newCount} nové emaily`
                  : `${newCount} nových emailů`;
      toast('📥 ' + label, 'success', 3000);
    } else {
      toast('✓ Žádné nové emaily', 'info', 1500);
    }
  } catch (e) {
    console.error('refreshInbox failed:', e);
    toast('❌ Chyba: ' + (e?.message || 'neznámá'), 'error', 4000);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText || '🔄 Obnovit';
    }
  }
}

// Silent background inbox refresh - runs periodically, no "Obnoveno" toast.
// Only notifies when NEW items actually arrive, so user isn't bothered
// unnecessarily. Skips when offline or window is in the background to save
// API calls.
async function silentRefreshInbox() {
  if (!state.config?.cloud?.enabled) return;
  if (document.visibilityState !== 'visible') return;
  
  // Capture IDs we already knew about so we can detect what's new
  const prevInboxIds = new Set((state.db.inbox || []).map(i => i.id));
  
  try {
    const newDb = await window.api.loadDb();
    if (newDb._offline) return;  // Skip UI update if cloud is temporarily unreachable
    
    state.db = newDb;
    if (!state.db.tickets) state.db.tickets = [];
    
    const currentInbox = state.db.inbox || [];
    const newItems = currentInbox.filter(i => !prevInboxIds.has(i.id));
    
    // Always keep the badge count in sync
    updateInboxBadge();
    
    // Re-render inbox page if user is looking at it so they see the new items
    if (state.currentView === 'inbox') {
      renderInboxPage();
    }
    
    if (newItems.length > 0) {
      const msg = newItems.length === 1
        ? '📥 Nový email v příchozích'
        : `📥 ${newItems.length} nových emailů v příchozích`;
      toast(msg, 'success', 4000);
    }
  } catch (e) {
    // Silent: don't interrupt the user with errors during background sync
    console.warn('Silent inbox refresh failed:', e);
  }
}

function updateInboxBadge() {
  const count = getInboxItems().length;
  const nav = document.querySelector('.nav-item[data-view="inbox"]');
  if (!nav) return;
  let badge = nav.querySelector('.nav-badge');
  if (count === 0) {
    if (badge) badge.remove();
    return;
  }
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'nav-badge warning';
    nav.appendChild(badge);
  }
  badge.className = 'nav-badge warning';
  badge.textContent = count;
}

function openInboxHelp() {
  // Fill in the webhook URL based on user's cloud config
  const cfg = state.config?.cloud || {};
  let apiUrl = cfg.apiUrl || '';
  apiUrl = apiUrl.replace(/\/api\/?$/, '').replace(/\/$/, '');
  const webhookUrl = apiUrl ? `${apiUrl}/inbox` : '(nejdřív zapni cloud a zadej API URL v Nastavení)';
  $('#inboxWebhookUrlFull').value = webhookUrl;
  $('#inboxWebhookUrl').textContent = webhookUrl;
  $('#modalInboxHelp').classList.add('active');
}

// ============ EXPENSES ============
const FREQUENCY_LABELS = {
  monthly: 'Měsíční',
  yearly: 'Roční',
  oneoff: 'Jednorázové',
  custom: 'Vlastní'
};

const EXPENSE_CATEGORY_COLORS = {
  Entertainment: { bg: 'rgba(236, 72, 153, 0.15)', color: '#f9a8d4' },
  VPN: { bg: 'rgba(59, 130, 246, 0.15)', color: '#93c5fd' },
  Software: { bg: 'rgba(167, 139, 250, 0.15)', color: '#c4b5fd' },
  Hosting: { bg: 'rgba(16, 185, 129, 0.15)', color: '#6ee7b7' },
  'Doména': { bg: 'rgba(251, 191, 36, 0.15)', color: '#fcd34d' },
  Cloud: { bg: 'rgba(6, 182, 212, 0.15)', color: '#67e8f9' },
  'AI Tools': { bg: 'rgba(249, 115, 22, 0.15)', color: '#fdba74' },
  'Vývoj': { bg: 'rgba(132, 204, 22, 0.15)', color: '#bef264' },
  Design: { bg: 'rgba(217, 70, 239, 0.15)', color: '#f0abfc' },
  Produktivita: { bg: 'rgba(20, 184, 166, 0.15)', color: '#5eead4' },
  'Jiné': { bg: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1' }
};

function getCategoryColor(cat) {
  return EXPENSE_CATEGORY_COLORS[cat] || { bg: 'rgba(148, 163, 184, 0.15)', color: '#cbd5e1' };
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr);
  target.setHours(0, 0, 0, 0);
  const diffMs = target - today;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function getDaysUrgency(days) {
  if (days === null || days === undefined) return { class: 'days-none', label: '—' };
  if (days < 0) return { class: 'days-expired', label: `${Math.abs(days)} dní po termínu`, urgent: true };
  if (days === 0) return { class: 'days-today', label: 'Dnes!', urgent: true };
  if (days <= 3) return { class: 'days-urgent', label: `${days} ${days === 1 ? 'den' : 'dny'}`, urgent: true };
  if (days <= 7) return { class: 'days-soon', label: `${days} dní` };
  if (days <= 30) return { class: 'days-ok', label: `${days} dní` };
  return { class: 'days-far', label: `${days} dní` };
}

// Calculate monthly equivalent for any expense
function monthlyEquivalent(expense) {
  if (!expense.active || expense.active === false) return 0;
  if (expense.frequency === 'oneoff') return 0;  // one-off is not recurring
  const price = Number(expense.price) || 0;
  if (expense.frequency === 'monthly') return price;
  if (expense.frequency === 'yearly') return price / 12;
  if (expense.frequency === 'custom') {
    const days = Number(expense.customDays) || 30;
    return (price / days) * 30.4;  // avg days per month
  }
  return 0;
}

function yearlyEquivalent(expense) {
  return monthlyEquivalent(expense) * 12;
}

function getFilteredExpenses() {
  let list = [...(state.db.expenses || [])];
  const f = state.expenseFilters;
  if (f.search) {
    const q = f.search.toLowerCase();
    list = list.filter(e =>
      (e.name || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      (e.card || '').toLowerCase().includes(q)
    );
  }
  // Type filter — 'expense' or 'income' (items without a type are legacy
  // expenses, so no type filter defaults them to expense).
  if (f.type) list = list.filter(e => (e.type || 'expense') === f.type);
  if (f.category) list = list.filter(e => e.category === f.category);
  if (f.frequency) list = list.filter(e => e.frequency === f.frequency);
  if (f.status === 'active') list = list.filter(e => e.active !== false);
  if (f.status === 'inactive') list = list.filter(e => e.active === false);
  // Sort by next payment date (nearest first), active first
  list.sort((a, b) => {
    // Active first
    if ((a.active !== false) !== (b.active !== false)) {
      return a.active !== false ? -1 : 1;
    }
    // Then by date
    if (!a.nextPayment) return 1;
    if (!b.nextPayment) return -1;
    return a.nextPayment.localeCompare(b.nextPayment);
  });
  return list;
}

function populateExpenseFilters() {
  const expenses = state.db.expenses || [];
  const categories = [...new Set(expenses.map(e => e.category).filter(Boolean))].sort();
  const sel = $('#eFilterCategory');
  if (sel) {
    const current = sel.value;
    sel.innerHTML = '<option value="">Všechny kategorie</option>' +
      categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    sel.value = current;
  }
}

function renderExpensesPage() {
  populateExpenseFilters();
  const list = getFilteredExpenses();
  const all = state.db.expenses || [];
  const activeRecurring = all.filter(e => e.active !== false && e.frequency !== 'oneoff');

  // Stat cards (v1.2.0) — split active recurring items into expenses (default,
  // or explicit type="expense") vs incomes (type="income"). Net cost = výdaje
  // minus příjmy. "Moje náklady" is the headline metric the user actually
  // pays out of pocket each month.
  const primary = getPrimaryCurrency();
  // Convert to primary currency — fallback to EUR (not primary!) so that
  // legacy items without explicit currency don't "drift" when user changes
  // primary. We assume existing items are EUR (most common default in CZ/EU).
  const toPrim = (e, amt) => convertCurrency(amt, e.currency || primary, primary);

  const activeExpenses = activeRecurring.filter(e => (e.type || 'expense') === 'expense');
  const activeIncomes = activeRecurring.filter(e => e.type === 'income');

  const totalMonthlyExp = activeExpenses.reduce((s, e) => s + toPrim(e, monthlyEquivalent(e)), 0);
  const totalMonthlyInc = activeIncomes.reduce((s, e) => s + toPrim(e, monthlyEquivalent(e)), 0);
  const netMonthly = totalMonthlyExp - totalMonthlyInc;

  $('#expMonthly').textContent = formatMoney(totalMonthlyExp, primary);
  if ($('#expMonthlyIncome')) $('#expMonthlyIncome').textContent = formatMoney(totalMonthlyInc, primary);
  if ($('#expNetCost')) {
    $('#expNetCost').textContent = formatMoney(netMonthly, primary);
    // If net is negative (you earn more than you pay) show in green
    const netEl = $('#expNetCost');
    netEl.classList.remove('stat-red', 'stat-green', 'stat-purple');
    if (netMonthly < 0) netEl.classList.add('stat-green');
    else if (netMonthly > 0) netEl.classList.add('stat-red');
    else netEl.classList.add('stat-purple');
  }
  $('#expActive').textContent = activeRecurring.length;

  // Nearest upcoming payment (legacy stat card — may or may not exist in
  // DOM depending on user's version of the page). Kept defensive.
  const nextPaymentEl = $('#expNextPayment');
  if (nextPaymentEl) {
    const upcoming = activeRecurring
      .filter(e => e.nextPayment && daysUntil(e.nextPayment) !== null && daysUntil(e.nextPayment) >= 0)
      .sort((a, b) => a.nextPayment.localeCompare(b.nextPayment));
    if (upcoming.length > 0) {
      const next = upcoming[0];
      const d = daysUntil(next.nextPayment);
      const u = getDaysUrgency(d);
      nextPaymentEl.innerHTML = `${escapeHtml(next.name)} <span style="color:var(--text-tertiary); font-size:12px;">(${u.label})</span>`;
    } else {
      nextPaymentEl.textContent = '—';
    }
  }
  // Same for legacy expYearly if it's still in DOM
  const yearlyEl = $('#expYearly');
  if (yearlyEl) {
    const totalYearlyExp = activeExpenses.reduce((s, e) => s + toPrim(e, yearlyEquivalent(e)), 0);
    yearlyEl.textContent = formatMoney(totalYearlyExp, primary);
  }
  
  // Table
  const tbody = $('#expensesBody');
  const empty = $('#eEmptyState');
  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    renderEBulkActions();
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = list.map(e => {
    const checked = state.selectedExpenseIds.has(e.id) ? 'checked' : '';
    const catColor = getCategoryColor(e.category);
    const days = daysUntil(e.nextPayment);
    const urgency = getDaysUrgency(days);
    const freq = FREQUENCY_LABELS[e.frequency] || e.frequency;
    const isActive = e.active !== false;
    const isOneoff = e.frequency === 'oneoff';
    const isIncome = e.type === 'income';

    // After migration (see refreshDb), currency should always be set. Fallback
    // to primary only for the fleeting moment between load and migration save.
    let priceDisplay = formatMoney(e.price, e.currency || getPrimaryCurrency());
    if (e.frequency === 'monthly') priceDisplay += ' <span class="per-ks">/ měsíc</span>';
    else if (e.frequency === 'yearly') priceDisplay += ' <span class="per-ks">/ rok</span>';
    else if (e.frequency === 'custom' && e.customDays) priceDisplay += ` <span class="per-ks">/ ${e.customDays} dní</span>`;

    // Income amounts shown with leading "+" and green tint; expenses neutral/red-ish
    const priceCell = isIncome
      ? `<span class="amount-income">+${priceDisplay}</span>`
      : `<span class="amount-expense">−${priceDisplay}</span>`;

    const typePill = isIncome
      ? '<span class="type-pill type-pill-income"><span class="type-pill-dot"></span>Příjem</span>'
      : '<span class="type-pill type-pill-expense"><span class="type-pill-dot"></span>Výdaj</span>';

    const urlCell = e.url
      ? `<a class="url-link" href="${escapeHtml(e.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(e.url)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>`
      : '<span style="color:var(--text-tertiary)">—</span>';

    const statusPill = isActive
      ? '<span class="status-pill status-sold">Aktivní</span>'
      : '<span class="status-pill status-cancelled">Neaktivní</span>';

    const rowClasses = [];
    if (urgency.urgent && isActive && !isOneoff) rowClasses.push('row-urgent');
    if (isIncome) rowClasses.push('row-income');

    return `
      <tr data-id="${e.id}" class="${rowClasses.join(' ')}">
        <td class="col-check"><input type="checkbox" class="e-row-check" data-id="${e.id}" ${checked}></td>
        <td>${typePill}</td>
        <td><strong>${escapeHtml(e.name || '—')}</strong></td>
        <td>${e.category ? `<span class="cat-pill" style="background:${catColor.bg};color:${catColor.color}">${escapeHtml(e.category)}</span>` : '<span style="color:var(--text-tertiary)">—</span>'}</td>
        <td>${priceCell}</td>
        <td>${escapeHtml(freq || '—')}</td>
        <td>${e.nextPayment ? formatDate(e.nextPayment) : '—'}</td>
        <td><span class="days-badge ${urgency.class}">${urgency.label}</span></td>
        <td>${escapeHtml(e.card || '—')}</td>
        <td class="url-cell">${urlCell}</td>
        <td>${statusPill}</td>
        <td class="col-actions">
          <div class="actions-cell">
            ${!isOneoff && isActive ? `<button class="btn btn-success btn-sm" data-e-action="paid" data-id="${e.id}" title="${isIncome ? 'Obdrženo' : 'Zaplaceno'} — posune datum na další období">✓ ${isIncome ? 'Přijato' : 'Zaplaceno'}</button>` : ''}
            <button class="btn btn-clone btn-sm" data-e-action="clone" data-id="${e.id}" title="Klonovat">🗐</button>
            <button class="btn btn-dark btn-sm" data-e-action="edit" data-id="${e.id}">Edit</button>
            <button class="btn btn-danger btn-sm" data-e-action="delete" data-id="${e.id}">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
  
  // Bind actions
  tbody.querySelectorAll('[data-e-action]').forEach(btn => {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const id = btn.dataset.id;
      const act = btn.dataset.eAction;
      const exp = state.db.expenses.find(e => e.id === id);
      if (act === 'edit') openExpenseModal(exp);
      else if (act === 'delete') deleteExpense(id);
      else if (act === 'clone') cloneExpense(exp);
      else if (act === 'paid') markExpensePaid(exp);
    });
  });
  
  // Row checkboxes
  tbody.querySelectorAll('.e-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.id;
      if (cb.checked) state.selectedExpenseIds.add(id);
      else state.selectedExpenseIds.delete(id);
      renderEBulkActions();
    });
  });
  
  renderEBulkActions();
}

function renderEBulkActions() {
  const bar = $('#eBulkActions');
  if (!bar) return;
  const count = state.selectedExpenseIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    $('#eBulkCount').textContent = `${count} vybráno`;
  } else {
    bar.style.display = 'none';
  }
}

function openExpenseModal(exp = null) {
  const isEditing = exp && exp.id;
  state.editingExpense = isEditing ? exp : null;
  const typeValue = exp?.type === 'income' ? 'income' : 'expense';
  $('#eModalTitle').textContent = isEditing
    ? (typeValue === 'income' ? 'Upravit příjem' : 'Upravit výdaj')
    : (exp ? 'Klonovat položku (nová kopie)' : 'Přidat položku');

  // Set the Výdaj / Příjem radio
  const typeRadio = document.querySelector(`input[name="efType"][value="${typeValue}"]`);
  if (typeRadio) typeRadio.checked = true;

  $('#efName').value = exp?.name || '';
  $('#efCategory').value = exp?.category || '';
  $('#efPrice').value = exp?.price || '';
  $('#efFrequency').value = exp?.frequency || 'monthly';
  // Currency dropdown — expenses default to user's primary currency, but
  // each expense can be in a different one (e.g. Netflix in USD, Spotify in EUR).
  const curSel = $('#efCurrency');
  if (curSel) {
    curSel.innerHTML = CURRENCIES
      .map(c => `<option value="${c.code}">${c.code} — ${c.name}</option>`)
      .join('');
    curSel.value = exp?.currency || getDefaultTicketCurrency();
  }
  $('#efCustomDays').value = exp?.customDays || '';
  $('#efNextPayment').value = exp?.nextPayment || '';
  $('#efStartDate').value = exp?.startDate || '';
  $('#efCard').value = exp?.card || '';
  $('#efUrl').value = exp?.url || '';
  $('#efNotes').value = exp?.notes || '';
  $('#efActive').checked = exp ? exp.active !== false : true;
  
  // Show/hide custom days field based on frequency
  updateCustomDaysVisibility();
  
  $('#modalExpense').classList.add('active');
  $('#efName').focus();
}

function updateCustomDaysVisibility() {
  const freq = $('#efFrequency')?.value;
  const group = $('#efCustomDaysGroup');
  if (group) group.style.display = freq === 'custom' ? '' : 'none';
}

async function saveExpense() {
  const name = $('#efName').value.trim();
  const price = parseFloat($('#efPrice').value);
  const frequency = $('#efFrequency').value;
  const nextPayment = $('#efNextPayment').value;
  
  if (!name) { toast('Zadej název', 'error'); return; }
  if (isNaN(price) || price < 0) { toast('Zadej platnou cenu', 'error'); return; }
  if (!nextPayment && frequency !== 'oneoff') {
    toast('Zadej datum následující platby', 'error');
    return;
  }
  
  const customDays = frequency === 'custom' ? parseInt($('#efCustomDays').value) || 30 : null;

  // Read the Výdaj / Příjem radio; default to 'expense' for backward compat
  const typeChecked = document.querySelector('input[name="efType"]:checked');
  const type = typeChecked && typeChecked.value === 'income' ? 'income' : 'expense';

  const exp = {
    ...(state.editingExpense || {}),
    type,
    name,
    category: $('#efCategory').value.trim(),
    price,
    currency: $('#efCurrency')?.value || getDefaultTicketCurrency(),
    frequency,
    customDays,
    nextPayment: nextPayment || null,
    startDate: $('#efStartDate').value || null,
    card: $('#efCard').value.trim(),
    url: $('#efUrl').value.trim(),
    notes: $('#efNotes').value.trim(),
    active: $('#efActive').checked
  };

  const saved = await window.api.upsertExpense(exp);
  if (!state.db.expenses) state.db.expenses = [];
  const idx = state.db.expenses.findIndex(x => x.id === saved.id);
  if (idx >= 0) state.db.expenses[idx] = saved;
  else state.db.expenses.push(saved);

  closeModal('modalExpense');
  const label = type === 'income' ? 'Příjem' : 'Výdaj';
  toast(state.editingExpense ? `${label} upraven` : `${label} přidán`, 'success');
  renderExpensesPage();
}

async function deleteExpense(id) {
  const exp = state.db.expenses.find(x => x.id === id);
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Smazat výdaj',
    message: `Opravdu smazat "${exp?.name}"?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteExpense(id);
  state.db.expenses = state.db.expenses.filter(x => x.id !== id);
  state.selectedExpenseIds.delete(id);
  renderExpensesPage();
  toast('Výdaj smazán', 'success');
}

async function bulkDeleteExpenses() {
  const ids = [...state.selectedExpenseIds];
  if (!ids.length) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} výdajů?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteExpenses(ids);
  state.db.expenses = state.db.expenses.filter(x => !ids.includes(x.id));
  state.selectedExpenseIds.clear();
  renderExpensesPage();
  toast(`Smazáno ${ids.length} výdajů`, 'success');
}

function cloneExpense(exp) {
  if (!exp) return;
  const clone = {
    name: exp.name || '',
    category: exp.category || '',
    price: exp.price || 0,
    frequency: exp.frequency || 'monthly',
    customDays: exp.customDays || null,
    card: exp.card || '',
    url: exp.url || '',
    active: true,
    nextPayment: '',
    startDate: '',
    notes: ''
  };
  openExpenseModal(clone);
  setTimeout(() => $('#efName')?.focus(), 50);
  toast('Výdaj naklonován - uprav a ulož', 'info');
}

async function markExpensePaid(exp) {
  if (!exp || !exp.nextPayment) return;
  
  // Compute new next payment date based on frequency
  const current = new Date(exp.nextPayment);
  let nextDate = new Date(current);
  
  if (exp.frequency === 'monthly') {
    nextDate.setMonth(nextDate.getMonth() + 1);
  } else if (exp.frequency === 'yearly') {
    nextDate.setFullYear(nextDate.getFullYear() + 1);
  } else if (exp.frequency === 'custom' && exp.customDays) {
    nextDate.setDate(nextDate.getDate() + Number(exp.customDays));
  } else {
    toast('Tento typ výdaje nelze posunout', 'error');
    return;
  }
  
  const newDate = nextDate.toISOString().slice(0, 10);
  const updated = { ...exp, nextPayment: newDate };
  
  await window.api.upsertExpense(updated);
  const idx = state.db.expenses.findIndex(x => x.id === exp.id);
  if (idx >= 0) state.db.expenses[idx] = updated;
  
  renderExpensesPage();
  toast(`Platba zaznamenána - další ${formatDate(newDate)}`, 'success');
}

// Export CSV
async function exportExpensesCsv() {
  const res = await window.api.exportExpensesCsv();
  if (res.success) toast(`Exportováno ${res.count} výdajů`, 'success');
  else if (!res.canceled) toast('Chyba: ' + res.error, 'error');
}

// ============ STATS PAGE ============
function getStatsFilteredTickets() {
  let list = [...state.db.tickets];
  // Same category filter as Dashboard — both views share state.dashboardCategory
  // so toggling chips on either side stays in sync. 'selected' filters to the
  // multi-select set, same as on Dashboard.
  if (state.dashboardCategory === 'selected') {
    list = list.filter(t => state.selectedIds.has(t.id));
  } else if (state.dashboardCategory && state.dashboardCategory !== 'all') {
    list = list.filter(t => (t.category || 'concert') === state.dashboardCategory);
  }
  const m = state.statsFilters?.month;
  const y = state.statsFilters?.year;
  if (m) list = list.filter(t => t.eventDate && new Date(t.eventDate).getMonth() + 1 === parseInt(m));
  if (y) list = list.filter(t => t.eventDate && new Date(t.eventDate).getFullYear() === parseInt(y));
  return list;
}

function populateStatsYearFilter() {
  const years = new Set(state.db.tickets.map(t => t.eventDate ? new Date(t.eventDate).getFullYear() : null).filter(Boolean));
  const sel = $('#statsFilterYear');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">Všechny roky</option>' + 
    [...years].sort((a, b) => b - a).map(y => `<option value="${y}">${y}</option>`).join('');
  sel.value = current;
}

function renderStatsPage() {
  if (!state.statsFilters) state.statsFilters = { month: '', year: '' };
  populateStatsYearFilter();
  
  const all = getStatsFilteredTickets();
  // "sold" pro statistiky = prodáno NEBO doručeno (obojí generuje profit)
  const sold = all.filter(t => t.status === 'sold' || t.status === 'delivered');
  const delivered = all.filter(t => t.status === 'delivered');
  
  // 4 Stat cards — profit summed across mixed-currency tickets via primary.
  const totalProfit = sold.reduce((s, t) => s + calcProfitInPrimary(t), 0);
  const avgRoi = sold.length ? sold.reduce((s, t) => s + calcRoi(t), 0) / sold.length : 0;
  
  // Počítáme kusy, ne řádky
  const sumQty = (arr) => arr.reduce((s, t) => s + (Number(t.quantity) || 1), 0);
  const soldQty = sumQty(sold);
  const deliveredQty = sumQty(delivered);
  const totalQty = sumQty(all);
  
  // Delivered ratio - kolik ks z prodaných už je doručených
  const deliveredRatio = soldQty > 0 ? `${deliveredQty} / ${soldQty}` : `0 / 0`;
  
  // Success rate (prodané ks / celkem ks)
  const successRate = totalQty ? (soldQty / totalQty) * 100 : 0;
  
  if ($('#sProfit')) $('#sProfit').textContent = formatMoney(totalProfit, getPrimaryCurrency());
  if ($('#sAvgRoi')) $('#sAvgRoi').textContent = avgRoi.toFixed(1) + '%';
  if ($('#sDelivered')) $('#sDelivered').textContent = deliveredRatio;
  if ($('#sSuccessRate')) $('#sSuccessRate').textContent = successRate.toFixed(0) + '%';

  // ============================================================
  // KPI INSIGHTS — computed from sold tickets, displayed in the
  // four-panel row beneath the hero card.
  // ============================================================

  // Hero subtitle: "z 50 prodaných lístků"
  const subEl = $('#sProfitSub');
  if (subEl) {
    if (soldQty > 0) {
      const perTicket = totalProfit / soldQty;
      subEl.innerHTML = `z <strong>${soldQty}</strong> prodaných lístků · ø <strong>${formatMoney(perTicket, getPrimaryCurrency())}</strong> / ks`;
    } else {
      subEl.textContent = 'Žádný prodej zatím nezaznamenán';
    }
  }

  // 1) BEST EVENT — highest total profit
  if ($('#iBestEvent')) {
    const eventProfitMap = {};
    sold.forEach(t => {
      const name = t.eventName || '—';
      eventProfitMap[name] = (eventProfitMap[name] || 0) + calcProfitInPrimary(t);
    });
    const topEvent = Object.entries(eventProfitMap).sort((a, b) => b[1] - a[1])[0];
    if (topEvent) {
      $('#iBestEvent').textContent = topEvent[0];
      $('#iBestEvent').title = topEvent[0];   // tooltip for truncated names
      $('#iBestEventSub').textContent = `+${formatMoney(topEvent[1], getPrimaryCurrency())}`;
    } else {
      $('#iBestEvent').textContent = '—';
      $('#iBestEventSub').textContent = '—';
    }
  }

  // 2) ROI THIS MONTH vs all-time average — shows whether your current
  // month is hot or cold compared to your historical average performance.
  // "This month" is based on SALE date (when you actually realized the profit).
  if ($('#iRoiThisMonth')) {
    const now = new Date();
    const thisYear = now.getFullYear();
    const thisMonth = now.getMonth();

    const soldThisMonth = sold.filter(t => {
      if (!t.saleDate) return false;
      const d = new Date(t.saleDate);
      if (isNaN(d)) return false;
      return d.getFullYear() === thisYear && d.getMonth() === thisMonth;
    });

    if (soldThisMonth.length > 0) {
      const monthRoi = soldThisMonth.reduce((s, t) => s + calcRoi(t), 0) / soldThisMonth.length;
      // Relative difference: "tento měsíc je o X % lepší/horší než průměr"
      // Formula: (this_month - avg) / |avg| × 100
      // Using |avg| in the denominator handles negative averages correctly:
      // a swing from -10% avg to +5% should show "better", not flipped sign.
      let relativeDiff = 0;
      if (avgRoi !== 0) {
        relativeDiff = ((monthRoi - avgRoi) / Math.abs(avgRoi)) * 100;
      }
      $('#iRoiThisMonth').textContent = `${monthRoi.toFixed(1)}%`;
      const arrow = relativeDiff > 0 ? '▲' : (relativeDiff < 0 ? '▼' : '·');
      const trendClass = relativeDiff > 0 ? 'trend-up' : (relativeDiff < 0 ? 'trend-down' : 'trend-neutral');
      // If avg is 0 we can't compute a relative diff — show absolute instead.
      const diffStr = avgRoi === 0
        ? `${monthRoi >= 0 ? '+' : ''}${monthRoi.toFixed(1)}%`
        : `${arrow} ${Math.abs(relativeDiff).toFixed(1)}%`;
      $('#iRoiThisMonthSub').innerHTML = `<span class="${trendClass}">${diffStr}</span> vs průměr (${avgRoi.toFixed(1)}%)`;
    } else {
      $('#iRoiThisMonth').textContent = '—';
      $('#iRoiThisMonthSub').textContent = `průměr za vše: ${avgRoi.toFixed(1)}%`;
    }
  }

  // 3) AVG DAYS PURCHASE → SALE
  if ($('#iAvgDays')) {
    const withBoth = sold.filter(t => t.purchaseDate && t.saleDate);
    if (withBoth.length > 0) {
      const totalDays = withBoth.reduce((s, t) => {
        const d1 = new Date(t.purchaseDate);
        const d2 = new Date(t.saleDate);
        return s + Math.max(0, (d2 - d1) / 86400000);
      }, 0);
      const avg = totalDays / withBoth.length;
      $('#iAvgDays').textContent = `${avg.toFixed(0)} dní`;
    } else {
      $('#iAvgDays').textContent = '—';
    }
  }

  // 4) BEST MONTH — highest profit by event-date month
  if ($('#iBestMonth')) {
    const monthProfit = {};
    const CZ_MONTHS_LONG = ['Leden','Únor','Březen','Duben','Květen','Červen','Červenec','Srpen','Září','Říjen','Listopad','Prosinec'];
    sold.forEach(t => {
      if (!t.eventDate) return;
      const d = new Date(t.eventDate);
      if (isNaN(d)) return;
      const key = `${d.getFullYear()}-${d.getMonth()}`;
      monthProfit[key] = (monthProfit[key] || 0) + calcProfitInPrimary(t);
    });
    const topMonth = Object.entries(monthProfit).sort((a, b) => b[1] - a[1])[0];
    if (topMonth) {
      const [year, monthIdx] = topMonth[0].split('-');
      $('#iBestMonth').textContent = `${CZ_MONTHS_LONG[parseInt(monthIdx)]} ${year}`;
      $('#iBestMonthSub').textContent = `+${formatMoney(topMonth[1], getPrimaryCurrency())}`;
    } else {
      $('#iBestMonth').textContent = '—';
      $('#iBestMonthSub').textContent = '—';
    }
  }

  // ============================================================
  // CAPITAL EFFICIENCY METRICS (v1.6.0)
  // ============================================================
  const primary = getPrimaryCurrency();

  // 1) CLOSED COST — what sold tickets cost us (only those that closed)
  // This is different from "Utraceno" which sums ALL purchases.
  const closedCost = sold.reduce((s, t) => s + calcCostInPrimary(t), 0);
  if ($('#iClosedCost')) {
    $('#iClosedCost').textContent = formatMoney(closedCost, primary);
  }

  // 2) PROFIT % UZAVŘENÝCH — profit / closed cost × 100
  // True ROI on closed positions (different from "Avg ROI per ticket").
  const closedRoi = closedCost > 0 ? (totalProfit / closedCost) * 100 : 0;
  if ($('#iClosedRoi')) {
    $('#iClosedRoi').textContent = closedRoi.toFixed(1) + '%';
    $('#iClosedRoiSub').textContent = `${formatMoney(totalProfit, primary)} / ${formatMoney(closedCost, primary)}`;
  }

  // 3) CAPITAL HOLD — weighted-average days money was tied up
  // For each sold ticket: cost × hold_days. Sum / total_cost = weighted avg.
  // This is the foundation for the annualized rate.
  let capitalHold = 0;
  {
    const weighted = sold.reduce((acc, t) => {
      if (!t.purchaseDate || !t.saleDate) return acc;
      const days = calcHoldDays(t);
      if (days < 0) return acc;
      const cost = calcCostInPrimary(t);
      acc.numerator += cost * days;
      acc.denominator += cost;
      return acc;
    }, { numerator: 0, denominator: 0 });
    capitalHold = weighted.denominator > 0 ? weighted.numerator / weighted.denominator : 0;
  }
  if ($('#iCapitalHold')) {
    $('#iCapitalHold').textContent = capitalHold > 0 ? `${capitalHold.toFixed(1)} dní` : '—';
  }

  // 4) ANNUALIZED RATE — "if my business was a savings account, what %/year?"
  // Formula: (profit / cost) × (365 / capital_hold_days) × 100
  // Only meaningful when we have both real profit and real hold time.
  if ($('#iAnnualizedRate')) {
    if (closedCost > 0 && capitalHold > 0) {
      const annualRate = (totalProfit / closedCost) * (365 / capitalHold) * 100;
      $('#iAnnualizedRate').textContent = annualRate.toFixed(1) + '%';
    } else {
      $('#iAnnualizedRate').textContent = '—';
    }
  }

  // 5) OPEN CAPITAL — money tied up in unsold tickets (still in inventory)
  // We use the "available" / "listed" / no-status statuses.
  const open = all.filter(t => t.status !== 'sold' && t.status !== 'delivered' && t.status !== 'cancelled');
  const openCapital = open.reduce((s, t) => s + calcCostInPrimary(t), 0);
  const openQty = sumQty(open);
  if ($('#iOpenCapital')) {
    $('#iOpenCapital').textContent = formatMoney(openCapital, primary);
    $('#iOpenCapitalSub').textContent = `${openQty} ks v inventáři`;
  }

  // 6) UNPAID VOLUME — sold but not yet delivered (revenue we're owed)
  // "delivered" = paid out by platform; "sold" = we sold it but haven't been paid.
  const unpaidSales = all.filter(t => t.status === 'sold');
  const unpaidVolume = unpaidSales.reduce((s, t) => s + calcRevenueInPrimary(t), 0);
  if ($('#iUnpaidVolume')) {
    $('#iUnpaidVolume').textContent = formatMoney(unpaidVolume, primary);
  }

  // 7) UNSOLD BREAKDOWN — total unsold + listed (zalistováno) vs not listed.
  // Three separate panels for: total, listed count, not-listed count.
  const unsold = all.filter(t => t.status !== 'sold' && t.status !== 'delivered' && t.status !== 'cancelled');
  const listed = unsold.filter(t => t.status === 'listed');
  const notListed = unsold.filter(t => t.status !== 'listed');
  const listedQty = sumQty(listed);
  const notListedQty = sumQty(notListed);
  const unsoldQty = sumQty(unsold);
  const listingRate = unsoldQty > 0 ? (listedQty / unsoldQty) * 100 : 0;
  const notListedRate = unsoldQty > 0 ? (notListedQty / unsoldQty) * 100 : 0;
  if ($('#iUnsoldTotal')) {
    $('#iUnsoldTotal').textContent = `${unsoldQty} ks`;
  }
  if ($('#iUnsoldListed')) {
    $('#iUnsoldListed').textContent = `${listedQty} ks`;
    $('#iUnsoldListedSub').textContent = unsoldQty > 0
      ? `${listingRate.toFixed(1)} % z neprodaných`
      : '—';
  }
  if ($('#iUnsoldNotListed')) {
    $('#iUnsoldNotListed').textContent = `${notListedQty} ks`;
    $('#iUnsoldNotListedSub').textContent = unsoldQty > 0
      ? `${notListedRate.toFixed(1)} % z neprodaných`
      : '—';
  }

  renderCharts(sold, all);
}

function renderCharts(sold, all) {
  // Destroy existing charts
  Object.values(state.charts).forEach(c => c?.destroy());
  state.charts = {};
  
  if (typeof Chart === 'undefined') return;

  // Read theme-aware colors from CSS variables so charts adapt to light/dark.
  const rootStyle = getComputedStyle(document.documentElement);
  const chartPurple = rootStyle.getPropertyValue('--purple').trim() || '#a78bfa';
  const chartPurpleRgb = rootStyle.getPropertyValue('--purple-rgb').trim() || '167, 139, 250';
  const chartFill = `rgba(${chartPurpleRgb}, 0.15)`;
  const chartPointBorder = rootStyle.getPropertyValue('--bg-primary').trim() || '#0f0f14';
  
  function renderOrEmpty(canvasId, hasData, emptyMsg, createChart) {
    const canvas = $('#' + canvasId);
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const oldEmpty = wrap.querySelector('.chart-empty');
    if (oldEmpty) oldEmpty.remove();
    
    if (!hasData) {
      canvas.style.display = 'none';
      const empty = document.createElement('div');
      empty.className = 'chart-empty';
      empty.textContent = emptyMsg || 'Žádná data';
      wrap.appendChild(empty);
      return;
    }
    canvas.style.display = '';
    try { createChart(canvas); } catch (e) { console.error('Chart error:', e); }
  }
  
  // Read theme-aware chart axis colors
  const tickColor = rootStyle.getPropertyValue('--text-secondary').trim() || '#9999a8';
  const tickColorPrimary = rootStyle.getPropertyValue('--text-primary').trim() || '#e8e8f0';
  const gridColor = rootStyle.getPropertyValue('--border-subtle').trim() || '#20202c';

  // Premium tooltip styling — black/gold, matches the rest of the app.
  // Reused across every chart so the look stays consistent.
  const bgPrimary = rootStyle.getPropertyValue('--bg-primary').trim() || '#1a1816';
  const tooltipStyle = {
    enabled: true,
    backgroundColor: bgPrimary,
    titleColor: chartPurple,
    bodyColor: tickColorPrimary,
    borderColor: chartPurple,
    borderWidth: 1,
    cornerRadius: 8,
    padding: 12,
    titleFont: { size: 12, weight: '600' },
    bodyFont: { size: 13 },
    displayColors: false,
    caretSize: 6,
    boxPadding: 4
  };

  // Common options for vertical bar/line charts
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    // index mode: tooltip + crosshair appear when you hover anywhere along
    // the x-axis, not only when the cursor is exactly on a data point.
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { display: false },  // most charts don't need legend (single series)
      tooltip: tooltipStyle
    },
    scales: {
      x: { ticks: { color: tickColor, font: { size: 10 } }, grid: { color: gridColor } },
      y: { 
        ticks: { color: tickColor, font: { size: 10 } }, 
        grid: { color: gridColor },
        beginAtZero: true
      }
    }
  };
  
  // Options for HORIZONTAL bar (indexAxis: 'y')
  const horizontalOptions = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    interaction: { mode: 'index', intersect: false, axis: 'y' },
    plugins: {
      legend: { display: false },
      tooltip: {
        ...tooltipStyle,
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.x;
            return ` ${val.toFixed(2)}`;
          }
        }
      }
    },
    scales: {
      x: { 
        ticks: { color: tickColor, font: { size: 10 } }, 
        grid: { color: gridColor },
        beginAtZero: true
      },
      y: { 
        ticks: { color: tickColorPrimary, font: { size: 11 } }, 
        grid: { display: false }
      }
    }
  };
  
  // 1) CUMULATIVE PROFIT OVER TIME — in primary currency (converted per-ticket)
  const primarySym = CURRENCY_BY_CODE[getPrimaryCurrency()]?.symbol || getPrimaryCurrency();
  const soldSorted = sold
    .filter(t => t.saleDate || t.eventDate)
    .sort((a, b) => (a.saleDate || a.eventDate).localeCompare(b.saleDate || b.eventDate));

  let cumul = 0;
  const cumulData = soldSorted.map(t => {
    cumul += calcProfitInPrimary(t);
    return { x: t.saleDate || t.eventDate, y: cumul, event: t.eventName };
  });
  
  renderOrEmpty('chartCumulative', cumulData.length > 0, 'Žádná data. Prodej vstupenku pro zobrazení grafu.', (canvas) => {
    // Build a vertical gradient: gold near the line → fully transparent at bottom.
    // This mimics premium dashboard charts (Stripe, Linear, Bloomberg).
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
    gradient.addColorStop(0, `rgba(${chartPurpleRgb}, 0.35)`);
    gradient.addColorStop(0.5, `rgba(${chartPurpleRgb}, 0.12)`);
    gradient.addColorStop(1, `rgba(${chartPurpleRgb}, 0)`);

    state.charts.cumulative = new Chart(canvas, {
      type: 'line',
      data: {
        labels: cumulData.map(d => d.x),
        datasets: [{
          label: `Zisk (${getPrimaryCurrency()})`,
          data: cumulData.map(d => d.y),
          borderColor: chartPurple,
          backgroundColor: gradient,
          fill: true,
          tension: 0.35,
          // Visible dots on every data point — small by default, larger on hover.
          // Last point gets extra emphasis as the "current value" anchor.
          pointRadius: cumulData.map((_, i) => i === cumulData.length - 1 ? 6 : 3),
          pointHoverRadius: 8,
          pointBackgroundColor: chartPurple,
          pointBorderColor: chartPointBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 3,
          borderWidth: 2.5,
          // Smoother curve when there are many points
          cubicInterpolationMode: 'monotone'
        }]
      },
      options: {
        ...baseOptions,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              title: (items) => items[0].label,
              label: (ctx) => {
                const val = ctx.parsed.y;
                const event = cumulData[ctx.dataIndex]?.event || '';
                return [` Zisk: ${formatMoney(val, getPrimaryCurrency())}`, event ? ` ${event}` : ''];
              }
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            ticks: {
              ...baseOptions.scales.y.ticks,
              callback: (val) => val + ' ' + primarySym
            }
          }
        }
      }
    });
  });

  // 2) TOP 5 EVENTS BY PROFIT (horizontal bar) — primary currency
  const eventProfits = {};
  sold.forEach(t => {
    const name = t.eventName || '—';
    eventProfits[name] = (eventProfits[name] || 0) + calcProfitInPrimary(t);
  });
  const topEvents = Object.entries(eventProfits).sort((a, b) => b[1] - a[1]).slice(0, 5);

  renderOrEmpty('chartTopEvents', topEvents.length > 0, 'Žádné prodané eventy.', (canvas) => {
    // Gold gradient by rank: #1 = brightest gold, #5 = subdued.
    // Negative profits stay red regardless of rank.
    const goldRamp = ['#f0c85a', '#d4a94a', '#b8923a', '#9c7c2a', '#7d6420'];
    const topColors = topEvents.map((e, i) => {
      if (e[1] < 0) return 'rgba(208, 107, 90, 0.85)';
      return goldRamp[Math.min(i, goldRamp.length - 1)];
    });

    state.charts.top = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: topEvents.map(e => e[0].length > 28 ? e[0].substring(0, 28) + '…' : e[0]),
        datasets: [{
          label: `Profit (${getPrimaryCurrency()})`,
          data: topEvents.map(e => e[1]),
          backgroundColor: topColors,
          borderRadius: 6,
          barThickness: 22
        }]
      },
      options: {
        ...horizontalOptions,
        scales: {
          ...horizontalOptions.scales,
          x: {
            ...horizontalOptions.scales.x,
            ticks: {
              ...horizontalOptions.scales.x.ticks,
              callback: (val) => val + ' ' + primarySym
            }
          }
        }
      }
    });
  });

  // 3) ROI PER EVENT (horizontal bar) — ROI is unitless, no conversion needed,
  // but profit/cost sums still need converting so event's mixed-currency
  // tickets aggregate correctly.
  const eventRois = {};
  sold.forEach(t => {
    const name = t.eventName || '—';
    if (!eventRois[name]) eventRois[name] = { profit: 0, cost: 0 };
    eventRois[name].profit += calcProfitInPrimary(t);
    eventRois[name].cost += calcCostInPrimary(t);
  });
  const roiList = Object.entries(eventRois)
    .filter(([_, v]) => v.cost > 0)
    .map(([name, v]) => [name, (v.profit / v.cost) * 100])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  
  renderOrEmpty('chartRoi', roiList.length > 0, 'Žádné prodané eventy.', (canvas) => {
    // Semantic ROI tiers — instant visual signal without reading numbers:
    //   ≥150%  emerald (excellent — doubled+)
    //   100–149%  green (very good)
    //   50–99%  gold (decent)
    //   1–49%  yellow (low margin)
    //   <0%   red (loss)
    function roiColor(roi) {
      if (roi < 0) return '#d06b5a';      // loss — warm red
      if (roi < 50) return '#c98855';     // low — orange/copper
      if (roi < 100) return '#d4a94a';    // decent — gold
      if (roi < 150) return '#9bb86a';    // very good — olive green
      return '#5fa874';                   // excellent — emerald
    }

    state.charts.roi = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: roiList.map(e => e[0].length > 24 ? e[0].substring(0, 24) + '…' : e[0]),
        datasets: [{
          label: 'ROI (%)',
          data: roiList.map(e => e[1]),
          backgroundColor: roiList.map(e => roiColor(e[1])),
          borderRadius: 6,
          barThickness: 22
        }]
      },
      options: {
        ...horizontalOptions,
        scales: {
          ...horizontalOptions.scales,
          x: {
            ...horizontalOptions.scales.x,
            ticks: {
              ...horizontalOptions.scales.x.ticks,
              callback: (val) => val.toFixed(0) + '%'
            }
          }
        },
        plugins: {
          ...horizontalOptions.plugins,
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.x.toFixed(1)}%`
            }
          }
        }
      }
    });
  });
  
  // 4) STATUS DISTRIBUTION (doughnut)
  const statusData = {};
  all.forEach(t => {
    const s = t.status || 'available';
    statusData[s] = (statusData[s] || 0) + 1;
  });
  
  const statusLabelMap = {
    available: 'Koupeno',
    listed: 'Zalistováno',
    sold: 'Prodáno',
    delivered: 'Doručeno ✓',
    cancelled: 'Zrušeno'
  };
  const statusColorMap = {
    available: '#3b82f6',   // blue
    listed: '#fbbf24',      // yellow
    sold: '#10b981',        // green
    delivered: '#06b6d4',   // cyan/teal - clearly different from sold green
    cancelled: '#ef4444'    // red
  };
  const statusKeys = Object.keys(statusData);
  const statusLabelsLocal = statusKeys.map(k => statusLabelMap[k] || k);
  const statusColors = statusKeys.map(k => statusColorMap[k] || '#9333ea');
  
  renderOrEmpty('chartStatus', statusKeys.length > 0, 'Žádné eventy.', (canvas) => {
    // Center text plugin — shows total quantity in the donut hole.
    // Built inline because we don't ship Chart.js plugins separately.
    const totalForCenter = Object.values(statusData).reduce((s, v) => s + v, 0);
    const centerTextPlugin = {
      id: 'donutCenterText',
      afterDraw(chart) {
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        ctx.save();
        // Number
        ctx.fillStyle = rootStyle.getPropertyValue('--text-primary').trim() || '#fafafa';
        ctx.font = "600 28px 'Playfair Display', serif";
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(totalForCenter), cx, cy - 8);
        // Label
        ctx.fillStyle = rootStyle.getPropertyValue('--text-tertiary').trim() || '#71717a';
        ctx.font = "600 9px 'JetBrains Mono', monospace";
        ctx.textBaseline = 'middle';
        ctx.fillText('LÍSTKŮ CELKEM', cx, cy + 16);
        ctx.restore();
      }
    };
    state.charts.status = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: statusLabelsLocal,
        datasets: [{
          data: Object.values(statusData),
          backgroundColor: statusColors,
          borderColor: rootStyle.getPropertyValue('--bg-card').trim() || '#1a1714',
          borderWidth: 3,
          hoverOffset: 12,
          // Round the segment edges for premium look
          borderRadius: 4
        }]
      },
      plugins: [centerTextPlugin],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '72%',
        plugins: {
          legend: {
            position: 'right',
            labels: {
              color: tickColorPrimary,
              font: { size: 12 },
              padding: 14,
              usePointStyle: true,
              pointStyle: 'circle'
            }
          },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                const pct = total > 0 ? ((ctx.parsed / total) * 100).toFixed(0) : 0;
                return ` ${ctx.label}: ${ctx.parsed} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  });
  
  // 5) PURCHASE VS SALE per event — convert each ticket's prices to primary
  // currency so the averages across events are apples-to-apples.
  const soldWithPrices = sold.filter(t => (Number(t.purchasePrice) || 0) > 0 && (Number(t.salePrice) || 0) > 0);

  renderOrEmpty('chartBuySell', soldWithPrices.length > 0, 'Prodej alespoň jednu vstupenku pro zobrazení grafu.', (canvas) => {
    const primary = getPrimaryCurrency();
    const events = {};
    soldWithPrices.forEach(t => {
      const name = t.eventName || '—';
      if (!events[name]) events[name] = { purchases: [], sales: [] };
      const tc = ticketCurrency(t);
      const sc = saleCurrency(t);
      events[name].purchases.push(convertCurrency(Number(t.purchasePrice) || 0, tc, primary));
      events[name].sales.push(convertCurrency(Number(t.salePrice) || 0, sc, primary));
    });
    const labels = Object.keys(events).slice(0, 6);
    const avg = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const purchaseAvg = labels.map(n => avg(events[n].purchases));
    const saleAvg = labels.map(n => avg(events[n].sales));

    state.charts.buySell = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: labels.map(l => l.length > 16 ? l.substring(0, 16) + '…' : l),
        datasets: [
          { label: `Nákup / ks (${primary})`, data: purchaseAvg, backgroundColor: '#f97316', borderRadius: 4 },
          { label: `Prodej / ks (${primary})`, data: saleAvg, backgroundColor: '#10b981', borderRadius: 4 }
        ]
      },
      options: {
        ...baseOptions,
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: { color: tickColorPrimary, font: { size: 11 }, usePointStyle: true, pointStyle: 'rect', padding: 12 }
          },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${formatMoney(ctx.parsed.y, primary)}`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            ticks: {
              ...baseOptions.scales.y.ticks,
              callback: (val) => val + ' ' + primarySym
            }
          }
        }
      }
    });
  });

  // ============================================================
  // MONTHLY PROFIT BAR — sum of profit per calendar month, by sale date
  // ============================================================
  const monthlyData = {};
  const CZ_MONTHS_SHORT = ['led','úno','bře','dub','kvě','čvn','čvc','srp','zář','říj','lis','pro'];
  sold.forEach(t => {
    if (!t.saleDate) return;
    const d = new Date(t.saleDate);
    if (isNaN(d)) return;
    const key = `${d.getFullYear()}-${String(d.getMonth()).padStart(2, '0')}`;
    monthlyData[key] = (monthlyData[key] || 0) + calcProfitInPrimary(t);
  });
  const monthlyEntries = Object.entries(monthlyData).sort((a, b) => a[0].localeCompare(b[0]));

  renderOrEmpty('chartMonthlyProfit', monthlyEntries.length > 0, 'Žádná data — prodej alespoň jednu vstupenku.', (canvas) => {
    const labels = monthlyEntries.map(([k]) => {
      const [y, m] = k.split('-');
      return `${CZ_MONTHS_SHORT[parseInt(m)]} ${y.slice(2)}`;
    });
    const values = monthlyEntries.map(([, v]) => v);
    state.charts.monthlyProfit = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: `Zisk (${getPrimaryCurrency()})`,
          data: values,
          backgroundColor: values.map(v => v >= 0 ? chartPurple : '#d06b5a'),
          borderRadius: 4,
          barThickness: 'flex',
          maxBarThickness: 28
        }]
      },
      options: {
        ...baseOptions,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => ` Zisk: ${formatMoney(ctx.parsed.y, getPrimaryCurrency())}`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            ticks: {
              ...baseOptions.scales.y.ticks,
              callback: (val) => val + ' ' + primarySym
            }
          }
        }
      }
    });
  });

  // ============================================================
  // INVENTORY OVER TIME — count of unsold tickets at each date
  // For every distinct date (purchase or sale), compute current inventory
  // = tickets bought up to that date minus tickets sold up to that date.
  // ============================================================
  const inventoryPoints = (() => {
    // Collect all distinct dates we know about (purchase + sale)
    const dates = new Set();
    all.forEach(t => {
      if (t.purchaseDate) dates.add(t.purchaseDate);
      if (t.saleDate) dates.add(t.saleDate);
    });
    const sortedDates = [...dates].sort();
    if (sortedDates.length === 0) return [];

    // Sample every N days to keep chart readable for long ranges
    const start = new Date(sortedDates[0]);
    const end = new Date(sortedDates[sortedDates.length - 1]);
    const totalDays = Math.max(1, Math.round((end - start) / 86400000));
    const stepDays = Math.max(1, Math.ceil(totalDays / 200));  // cap at ~200 points

    const points = [];
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + stepDays)) {
      const dateStr = d.toISOString().slice(0, 10);
      // Inventory = bought before/on this date - sold before/on this date
      let inventoryQty = 0;
      all.forEach(t => {
        const qty = Number(t.quantity) || 1;
        if (t.purchaseDate && t.purchaseDate <= dateStr) inventoryQty += qty;
        if (t.saleDate && t.saleDate <= dateStr) inventoryQty -= qty;
      });
      points.push({ x: dateStr, y: Math.max(0, inventoryQty) });
    }
    return points;
  })();

  renderOrEmpty('chartInventory', inventoryPoints.length > 1, 'Žádná data — přidej lístky s datem nákupu.', (canvas) => {
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height || 300);
    gradient.addColorStop(0, `rgba(${chartPurpleRgb}, 0.3)`);
    gradient.addColorStop(1, `rgba(${chartPurpleRgb}, 0)`);
    state.charts.inventory = new Chart(canvas, {
      type: 'line',
      data: {
        labels: inventoryPoints.map(p => p.x),
        datasets: [{
          label: 'Počet vstupenek v inventáři',
          data: inventoryPoints.map(p => p.y),
          borderColor: chartPurple,
          backgroundColor: gradient,
          fill: true,
          tension: 0.25,
          // Up to 200 points — keep dots hidden by default (would be too noisy),
          // but show prominent dot on hover. index-mode tooltip ensures user can
          // hover anywhere along the x-axis and still get the value.
          pointRadius: 0,
          pointHoverRadius: 7,
          pointBackgroundColor: chartPurple,
          pointBorderColor: chartPointBorder,
          pointBorderWidth: 2,
          pointHoverBorderWidth: 3,
          borderWidth: 2,
          cubicInterpolationMode: 'monotone'
        }]
      },
      options: {
        ...baseOptions,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipStyle,
            callbacks: {
              label: (ctx) => ` ${ctx.parsed.y} ks v inventáři`
            }
          }
        },
        scales: {
          ...baseOptions.scales,
          y: {
            ...baseOptions.scales.y,
            beginAtZero: true,
            ticks: {
              ...baseOptions.scales.y.ticks,
              callback: (val) => val + ' ks',
              precision: 0
            }
          }
        }
      }
    });
  });
}

// ============ TICKET MODAL ============
// ============ BUYER SECTION HELPERS ============
function updateBuyerSectionVisibility() {
  const section = $('#buyerSection');
  if (!section) return;
  const status = $('#fStatus')?.value;
  const show = status === 'sold' || status === 'delivered';
  section.style.display = show ? 'block' : 'none';
}

function setupBuyerSectionUI() {
  // Show/hide when status changes
  $('#fStatus')?.addEventListener('change', updateBuyerSectionVisibility);
  
  // Copy buyer email to clipboard
  $('#btnCopyBuyerEmail')?.addEventListener('click', async (e) => {
    e.preventDefault();
    const email = $('#fBuyerEmail')?.value.trim();
    if (!email) {
      toast('Žádný email k zkopírování', 'info', 2000);
      return;
    }
    try {
      await navigator.clipboard.writeText(email);
      const btn = $('#btnCopyBuyerEmail');
      btn.classList.add('copied');
      btn.textContent = '✓';
      toast('Email zkopírován', 'success', 1500);
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.textContent = '📋';
      }, 1500);
    } catch (err) {
      toast('Chyba kopírování: ' + err.message, 'error');
    }
  });
}

// ============ EXTERNAL IDS HELPERS ============
function updateExternalIdsSummary() {
  const viagogoL = $('#fViagogoListingId')?.value.trim();
  const viagogoO = $('#fViagogoOrderId')?.value.trim();
  const stubhubL = $('#fStubhubListingId')?.value.trim();
  const stubhubO = $('#fStubhubOrderId')?.value.trim();
  const tmO = $('#fTicketmasterOrderId')?.value.trim();
  const otherO = $('#fOtherId')?.value.trim();
  const parts = [];
  if (viagogoL) parts.push('V:L' + viagogoL.slice(-4));
  if (viagogoO) parts.push('V:O' + viagogoO.slice(-4));
  if (stubhubL) parts.push('S:L' + stubhubL.slice(-4));
  if (stubhubO) parts.push('S:O' + stubhubO.slice(-4));
  if (tmO) parts.push('TM:' + tmO.slice(-4));
  if (otherO) parts.push('Other');
  const summary = $('#externalIdsSummary');
  if (summary) summary.textContent = parts.length > 0 ? parts.join(' · ') : '';
}

function updateListingLinks() {
  const vL = $('#fViagogoListingId')?.value.trim();
  const vLink = $('#viagogoListingLink');
  if (vLink) {
    vLink.innerHTML = vL
      ? `<a href="https://www.viagogo.co.uk/secure/myaccount/Listings/Details/${encodeURIComponent(vL)}" target="_blank" rel="noopener">🔗 Otevřít na Viagogo</a>`
      : '';
  }
  const sL = $('#fStubhubListingId')?.value.trim();
  const sLink = $('#stubhubListingLink');
  if (sLink) {
    sLink.innerHTML = sL
      ? `<a href="https://www.stubhub.ie/my/sales" target="_blank" rel="noopener">🔗 Otevřít na StubHub</a>`
      : '';
  }
}

function setupExternalIdsUI() {
  const toggle = $('#externalIdsToggle');
  const body = $('#externalIdsBody');
  if (toggle && body) {
    toggle.addEventListener('click', () => {
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      toggle.classList.toggle('open', !isOpen);
    });
  }
  // Live update summary and links when user types
  ['#fViagogoListingId', '#fViagogoOrderId', '#fStubhubListingId', '#fStubhubOrderId', '#fTicketmasterOrderId', '#fOtherId'].forEach(id => {
    $(id)?.addEventListener('input', () => {
      updateExternalIdsSummary();
      updateListingLinks();
    });
  });
}

// "Zalistovat" — opens the standard edit modal but pre-fills status=listed
// and auto-expands the External IDs section so the user can enter Listing IDs
// right away. Clicking "Uložit" will persist status=listed along with any
// IDs they've typed in. Reuses openTicketModal to avoid duplicating form setup.
function openListModal(ticket) {
  if (!ticket) return;
  openTicketModal(ticket);
  // Pre-select "Zalistováno" in the status dropdown — user can still change it
  // if they accidentally clicked the wrong button.
  $('#fStatus').value = 'listed';
  $('#modalTitle').textContent = 'Zalistovat vstupenku';
  // Force-expand External IDs section so Listing ID fields are visible.
  const body = $('#externalIdsBody');
  const toggle = $('#externalIdsToggle');
  if (body && toggle) {
    body.style.display = 'block';
    toggle.classList.add('open');
  }
  // Focus the most relevant Listing ID field based on platform.
  const platform = (ticket.platform || '').toLowerCase();
  let focusField;
  if (platform.includes('viagogo')) focusField = $('#fViagogoListingId');
  else if (platform.includes('stubhub')) focusField = $('#fStubhubListingId');
  if (focusField) focusField.focus();
}

function openTicketModal(ticket = null) {
  // If ticket has no id, it's a clone template (treat as new ticket)
  const isEditing = ticket && ticket.id;
  state.editingTicket = isEditing ? ticket : null;
  $('#modalTitle').textContent = isEditing ? 'Upravit vstupenku' : (ticket ? 'Klonovat vstupenku (nová kopie)' : 'Přidat vstupenku');
  
  $('#fEventName').value = ticket?.eventName || '';
  // Category — for new tickets, default to whatever's currently selected on
  // Dashboard (so adding a ticket while looking at Koncerty pre-fills 'concert').
  // Falls back to 'concert' if Dashboard is on 'all'.
  const defaultCat = (state.dashboardCategory && state.dashboardCategory !== 'all')
    ? state.dashboardCategory
    : 'concert';
  $('#fCategory').value = ticket?.category || defaultCat;
  $('#fEventDate').value = ticket?.eventDate || '';
  $('#fVenue').value = ticket?.venue || '';
  $('#fCountry').value = ticket?.country || '';
  $('#fSection').value = ticket?.section || '';
  $('#fRow').value = ticket?.row || '';
  $('#fSeat').value = ticket?.seat || '';
  $('#fQuantity').value = ticket?.quantity || 1;
  $('#fAccount').value = ticket?.account || '';
  $('#fPurchasePlatform').value = ticket?.purchasePlatform || '';
  $('#fPlatform').value = ticket?.platform || 'Stubhub';
  $('#fStatus').value = ticket?.status || 'available';
  $('#fPurchasePrice').value = ticket?.purchasePrice || '';
  $('#fSalePrice').value = ticket?.salePrice || '';
  // Purchase + sale price modes default to 'per' (per ks). Both prices are
  // ALWAYS stored per-ks in DB; the toggle only affects what the user types
  // in the input. Save logic divides by qty when mode='total'.
  state.purchasePriceMode = 'per';
  state.salePriceModeEdit = 'per';
  updatePurchasePriceModeUI();
  updatePurchasePriceHint();
  updateSalePriceModeEditUI();
  updateSalePriceEditHint();
  // Currency dropdown — populate from constants, default to user's preferred
  // "default for new tickets" setting. Existing tickets keep their stored value.
  const curSel = $('#fCurrency');
  if (curSel) {
    curSel.innerHTML = CURRENCIES
      .map(c => `<option value="${c.code}">${c.code} — ${c.name}</option>`)
      .join('');
    curSel.value = ticket?.currency || getDefaultTicketCurrency();
  }
  $('#fLogo').value = ticket?.logo || '';
  $('#fNotes').value = ticket?.notes || '';
  
  // External IDs
  const ids = ticket?.externalIds || {};
  $('#fViagogoListingId').value = ids.viagogoListingId || '';
  $('#fViagogoOrderId').value = ids.viagogoOrderId || '';
  $('#fStubhubListingId').value = ids.stubhubListingId || '';
  $('#fStubhubOrderId').value = ids.stubhubOrderId || '';
  $('#fTicketmasterOrderId').value = ids.ticketmasterOrderId || '';
  $('#fOtherId').value = ids.otherId || '';
  updateExternalIdsSummary();
  updateListingLinks();
  // Auto-expand section if ticket has any IDs
  const hasAnyId = Object.values(ids).some(v => v && String(v).trim().length > 0);
  const body = $('#externalIdsBody');
  const toggle = $('#externalIdsToggle');
  if (body && toggle) {
    body.style.display = hasAnyId ? 'block' : 'none';
    toggle.classList.toggle('open', hasAnyId);
  }
  
  // Buyer info
  $('#fBuyerName').value = ticket?.buyerName || '';
  $('#fBuyerEmail').value = ticket?.buyerEmail || '';
  $('#fBuyerPhone').value = ticket?.buyerPhone || '';
  $('#fSaleDate').value = ticket?.saleDate || '';
  // Purchase date — default to today for brand-new tickets only.
  // For Edit (isEditing) we use whatever the ticket has.
  // For Clone (ticket && !isEditing) we leave it empty (user re-fills).
  if (ticket?.purchaseDate) {
    $('#fPurchaseDate').value = ticket.purchaseDate;
  } else if (!ticket) {
    $('#fPurchaseDate').value = new Date().toISOString().slice(0, 10);
  } else {
    $('#fPurchaseDate').value = '';
  }
  updateBuyerSectionVisibility();
  
  // Reset prefill UI
  if ($('#fPrefillUrl')) $('#fPrefillUrl').value = '';
  if ($('#prefillStatus')) {
    $('#prefillStatus').textContent = '';
    $('#prefillStatus').className = 'prefill-status';
  }
  // Hide prefill box when editing (only show when adding new)
  if ($('#prefillBox')) $('#prefillBox').style.display = ticket ? 'none' : 'block';
  
  $('#modalTicket').classList.add('active');
  $('#fEventName').focus();
}

// ============ VIAGOGO / STUBHUB PREFILL ============
async function prefillFromUrl() {
  const urlInput = $('#fPrefillUrl');
  const btn = $('#btnPrefill');
  const status = $('#prefillStatus');
  const url = (urlInput.value || '').trim();
  
  if (!url) {
    status.className = 'prefill-status err';
    status.textContent = 'Zadej URL';
    return;
  }
  
  const isViagogo = /viagogo\.com/i.test(url);
  const isStubhub = /stubhub\./i.test(url);
  
  if (!isViagogo && !isStubhub) {
    status.className = 'prefill-status err';
    status.textContent = 'Podporované weby: Viagogo, StubHub';
    return;
  }
  
  const platform = isViagogo ? 'Viagogo' : 'StubHub';
  
  // UI loading state
  btn.disabled = true;
  btn.textContent = 'Stahuji...';
  status.className = 'prefill-status loading';
  status.textContent = '⏳ Načítám data ze stránky...';
  
  try {
    const result = await window.api.fetchEventPage(url);
    if (!result.ok) {
      throw new Error(result.error || 'Chyba při stahování');
    }
    const html = result.html;
    if (!html || html.length < 200) {
      throw new Error('Stránka je prázdná nebo blokovaná');
    }
    
    // Detect bot-detection / JavaScript-required fallback pages
    const botPatterns = /JavaScript is disabled|Please enable JavaScript|cf-challenge|captcha|pardon our interruption|access[\s-]?denied/i;
    if (botPatterns.test(html) && html.length < 50000) {
      throw new Error('Stránka zablokovala stahování (bot detekce). Otevři URL v prohlížeči, zkopíruj text a zadej data ručně.');
    }
    
    // Parse JSON-LD microdata (SEO schema)
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    
    let eventData = null;
    scripts.forEach(s => {
      try {
        const parsed = JSON.parse(s.textContent);
        // Support both single objects and arrays of objects
        const items = Array.isArray(parsed) ? parsed : [parsed];
        for (const item of items) {
          if (!item || !item['@type']) continue;
          const type = String(item['@type']).toLowerCase();
          if (type.includes('event') || type === 'sportsevent' || type === 'musicevent' || type === 'theaterevent') {
            eventData = item;
            break;
          }
        }
      } catch (e) { /* ignore invalid JSON */ }
    });
    
    let filledCount = 0;
    
    if (eventData) {
      // Event name
      if (eventData.name) {
        const cleanName = String(eventData.name)
          .replace(/\s*(tickets?|vstupenky|biljetter|biglietti|billets)\s*$/i, '')
          .trim();
        $('#fEventName').value = cleanName;
        filledCount++;
      }
      
      // Start date
      if (eventData.startDate) {
        try {
          const d = new Date(eventData.startDate);
          if (!isNaN(d)) {
            $('#fEventDate').value = d.toISOString().slice(0, 10);
            filledCount++;
          }
        } catch (e) {}
      }
      
      // Venue + city
      if (eventData.location) {
        const loc = Array.isArray(eventData.location) ? eventData.location[0] : eventData.location;
        const venueName = loc.name || '';
        const city = loc.address?.addressLocality || loc.address?.['@addressLocality'] || '';
        const venueStr = [venueName, city].filter(Boolean).join(', ');
        if (venueStr) {
          $('#fVenue').value = venueStr;
          filledCount++;
        }
      }
      
      // Platform
      $('#fPlatform').value = platform;
      filledCount++;
      
      status.className = 'prefill-status ok';
      status.textContent = `✓ Předvyplněno ${filledCount} polí. Zkontroluj a doplň cenu + sekci/sedadlo.`;
      
    } else {
      // Fallback: try to extract event name from URL itself
      const urlName = extractEventNameFromUrl(url);
      if (urlName) {
        $('#fEventName').value = urlName;
        $('#fPlatform').value = platform;
        status.className = 'prefill-status warn';
        status.textContent = '⚠ Web blokoval detaily. Vyplněn aspoň název z URL, doplň zbytek.';
      } else {
        $('#fPlatform').value = platform;
        status.className = 'prefill-status err';
        status.textContent = '✕ Data nenalezena. Platforma nastavena, zbytek zadej ručně.';
      }
    }
    
  } catch (e) {
    status.className = 'prefill-status err';
    status.textContent = '✕ ' + e.message;
    // Still try to extract name from URL as last resort
    const urlName = extractEventNameFromUrl(url);
    if (urlName && !$('#fEventName').value) {
      $('#fEventName').value = urlName;
      $('#fPlatform').value = platform;
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Předvyplnit';
  }
}

// Extract event name from URL path (fallback when HTML parsing fails)
function extractEventNameFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    
    // Blacklist of generic category segments we DON'T want
    const blacklist = /^(concert-tickets|sports-tickets|theater-tickets|hard-rock-and-metal-music|rock-and-pop|classical-music|pop-music|country|jazz|rap-and-hip-hop|electronic|event|events|en|cz|cs|de|fr|it|es|uk|ie|us)$/i;
    
    // Score each segment: prefer ones containing "tickets" or "-vs-" (sports) or "-the-"
    let best = null;
    let bestScore = 0;
    
    for (const part of parts) {
      // Skip generic IDs, numeric, category slugs
      if (/^[eE]-?\d+$/.test(part)) continue;
      if (/^\d+$/.test(part)) continue;
      if (part.length < 6) continue;
      if (blacklist.test(part)) continue;
      
      let score = 1;
      const lower = part.toLowerCase();
      // Prefer segments that clearly describe a specific event
      if (lower.endsWith('-tickets')) score += 10;
      if (lower.endsWith('tickets')) score += 8;
      if (lower.includes('-vs-')) score += 5;  // sports: "arsenal-vs-sporting"
      if (lower.includes('-tour')) score += 3;
      if (lower.includes('-live')) score += 2;
      if (/\d{4}/.test(part)) score += 2;  // year present
      // Penalize very long segments (probably full breadcrumb)
      if (part.length > 60) score -= 5;
      // Prefer segments later in URL
      score += parts.indexOf(part) * 0.5;
      
      if (score > bestScore) {
        bestScore = score;
        best = part;
      }
    }
    
    if (!best) return null;
    
    // Clean up: replace dashes with spaces, remove "tickets" suffix, title-case
    let name = decodeURIComponent(best)
      .replace(/[-_]+/g, ' ')
      .replace(/\s*(tickets?|vstupenky)\s*$/i, '')
      .trim();
    
    // Title case
    name = name.replace(/\b\w/g, c => c.toUpperCase());
    // Preserve common connecting words in lowercase
    name = name.replace(/\b(And|Or|The|Of|In|At|On|Vs|With|For|To|A|An)\b/g, w => w.toLowerCase());
    // Capitalize first word
    name = name.charAt(0).toUpperCase() + name.slice(1);
    
    return name;
  } catch (e) {
    return null;
  }
}

async function saveTicket() {
  const name = $('#fEventName').value.trim();
  const date = $('#fEventDate').value;
  if (!name) {
    toast('Zadej název eventu', 'error');
    return;
  }
  
  const externalIds = {
    viagogoListingId: $('#fViagogoListingId').value.trim(),
    viagogoOrderId: $('#fViagogoOrderId').value.trim(),
    stubhubListingId: $('#fStubhubListingId').value.trim(),
    stubhubOrderId: $('#fStubhubOrderId').value.trim(),
    ticketmasterOrderId: $('#fTicketmasterOrderId').value.trim(),
    otherId: $('#fOtherId').value.trim()
  };
  // Strip empty keys to keep DB clean
  Object.keys(externalIds).forEach(k => { if (!externalIds[k]) delete externalIds[k]; });
  
  const ticket = {
    ...(state.editingTicket || {}),
    eventName: name,
    // Category — football / concert / other. Drives Dashboard + Stats filtering.
    category: $('#fCategory')?.value || 'concert',
    eventDate: date,
    venue: $('#fVenue').value.trim(),
    country: $('#fCountry').value.trim() || undefined,
    section: $('#fSection').value.trim(),
    row: $('#fRow').value.trim(),
    seat: $('#fSeat').value.trim(),
    quantity: parseInt($('#fQuantity').value) || 1,
    account: $('#fAccount').value.trim(),
    purchasePlatform: $('#fPurchasePlatform')?.value || '',
    platform: $('#fPlatform').value,
    status: $('#fStatus').value,
    // Purchase + sale price are always stored per-ks in DB. When user typed
    // 'total', we divide by quantity here so downstream math (profit, ROI,
    // multi-qty displays) all stays consistent.
    purchasePrice: (() => {
      const raw = parseFloat($('#fPurchasePrice').value) || 0;
      if (state.purchasePriceMode === 'total') {
        const qty = parseInt($('#fQuantity').value) || 1;
        return qty > 0 ? raw / qty : raw;
      }
      return raw;
    })(),
    salePrice: (() => {
      const raw = parseFloat($('#fSalePrice').value) || 0;
      if (state.salePriceModeEdit === 'total') {
        const qty = parseInt($('#fQuantity').value) || 1;
        return qty > 0 ? raw / qty : raw;
      }
      return raw;
    })(),
    currency: $('#fCurrency')?.value || getDefaultTicketCurrency(),
    logo: $('#fLogo').value.trim(),
    notes: $('#fNotes').value.trim(),
    externalIds: Object.keys(externalIds).length > 0 ? externalIds : undefined,
    // Buyer info (only saved if non-empty)
    buyerName: $('#fBuyerName').value.trim() || undefined,
    buyerEmail: $('#fBuyerEmail').value.trim() || undefined,
    buyerPhone: $('#fBuyerPhone').value.trim() || undefined,
    saleDate: $('#fSaleDate').value || undefined,
    purchaseDate: $('#fPurchaseDate').value || undefined
  };
  
  await window.api.upsertTicket(ticket);
  await refreshDb();
  closeModal('modalTicket');
  toast(state.editingTicket ? 'Vstupenka upravena' : 'Vstupenka přidána', 'success');
}

// ============ SELL MODAL ============
function openSellModal(ticket) {
  state.sellingTicket = ticket;
  // Remember price entry mode across sell-modal opens. Default to "per" (per-ticket)
  // since that's what most single-ticket sales from email confirmations contain.
  if (!state.sellPriceMode) state.sellPriceMode = 'per';
  const totalQty = Number(ticket.quantity) || 1;
  
  // Set quantity: default = all available, max = total
  const qtyInput = $('#sellQuantity');
  qtyInput.value = totalQty;
  qtyInput.max = totalQty;
  qtyInput.min = 1;
  
  // Info banner
  $('#sellInfoBanner').innerHTML = `
    <div class="sell-info-row">
      <span class="sell-info-label">Event:</span>
      <span class="sell-info-value">${escapeHtml(ticket.eventName || '—')}</span>
    </div>
    <div class="sell-info-row">
      <span class="sell-info-label">K dispozici:</span>
      <span class="sell-info-value"><strong>${totalQty} ks</strong></span>
    </div>
    <div class="sell-info-row">
      <span class="sell-info-label">Nákup / ks:</span>
      <span class="sell-info-value">${formatMoney(ticket.purchasePrice, ticketCurrency(ticket))}</span>
    </div>
  `;
  
  // Pre-fill price: if ticket had a salePrice before (after editing), use it, else empty.
  // salePrice is stored as per-ticket price; if mode is "total", we multiply below.
  const savedPerKs = Number(ticket.salePrice) || 0;
  const initialQty = totalQty;
  if (state.sellPriceMode === 'total' && savedPerKs > 0) {
    $('#sellPrice').value = (savedPerKs * initialQty).toFixed(2);
  } else {
    $('#sellPrice').value = savedPerKs || '';
  }
  $('#sellDate').value = new Date().toISOString().slice(0, 10);

  // Currency dropdown — default to ticket's currency (or saleCurrency if previously set)
  const sellCurSel = $('#sellCurrency');
  if (sellCurSel) {
    sellCurSel.innerHTML = CURRENCIES
      .map(c => `<option value="${c.code}">${c.code}</option>`)
      .join('');
    // Prefer existing saleCurrency, fallback to ticket's currency
    sellCurSel.value = ticket.saleCurrency || ticket.currency || getPrimaryCurrency();
  }

  // Sync toggle buttons to remembered mode + wire click handlers.
  updatePriceModeUI();

  updateSellHints();
  
  $('#modalSell').classList.add('active');
  $('#sellQuantity').focus();
  $('#sellQuantity').select();
}

// Read price from the input AND the current mode, always return per-ticket price.
// Single source of truth for derived values (total revenue, profit, etc.).
function getSellPricePerKs() {
  const raw = parseFloat($('#sellPrice').value);
  if (!raw || raw <= 0) return 0;
  if (state.sellPriceMode === 'total') {
    const qty = parseInt($('#sellQuantity').value) || 1;
    return qty > 0 ? raw / qty : 0;
  }
  return raw;
}

function updatePriceModeUI() {
  const mode = state.sellPriceMode || 'per';
  const toggle = $('#sellPriceMode');
  if (!toggle) return;
  toggle.querySelectorAll('.price-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  // Update the field placeholder and hint text to match the mode.
  const input = $('#sellPrice');
  const hint = $('#sellPriceHint');
  if (mode === 'total') {
    input.placeholder = 'Celková částka za všechny ks';
    if (hint) {
      hint.textContent = 'Zadáš celkovou částku prodeje, my spočítáme kolik to je za 1 ks.';
      hint.className = 'sell-hint info';
    }
  } else {
    input.placeholder = 'Cena za 1 ks';
    if (hint) {
      hint.textContent = '';
      hint.className = 'sell-hint';
    }
  }
}

// ── EDIT-MODAL price mode helpers (purchase + sale) ─────────────────────────
// The ticket-edit modal has its own per/total toggles, separate from the
// sell modal. Same pattern as updatePriceModeUI but scoped to fPurchase*/fSale*.

function updatePurchasePriceModeUI() {
  const mode = state.purchasePriceMode || 'per';
  const toggle = $('#fPurchasePriceMode');
  if (!toggle) return;
  toggle.querySelectorAll('.price-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.pmode === mode);
  });
  const input = $('#fPurchasePrice');
  if (input) input.placeholder = mode === 'total' ? 'Celkem za všechny ks' : '89.61';
}

function updateSalePriceModeEditUI() {
  const mode = state.salePriceModeEdit || 'per';
  const toggle = $('#fSalePriceMode');
  if (!toggle) return;
  toggle.querySelectorAll('.price-mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.smode === mode);
  });
  const input = $('#fSalePrice');
  if (input) input.placeholder = mode === 'total' ? 'Celkem za všechny ks' : '151.36';
}

// Live conversion hint under purchase-price field — shows the OTHER value.
// In 'per' mode + qty>1 → "× 4 = 358 €". In 'total' mode → "= 89.61 €/ks".
// Uses the ticket's currency (selected in the modal) for display formatting.
function updatePurchasePriceHint() {
  const hint = $('#fPurchasePriceHint');
  if (!hint) return;
  const raw = parseFloat($('#fPurchasePrice')?.value) || 0;
  const qty = parseInt($('#fQuantity')?.value) || 1;
  const ccy = $('#fCurrency')?.value || getDefaultTicketCurrency();
  const mode = state.purchasePriceMode || 'per';
  if (raw <= 0) { hint.textContent = ''; return; }
  if (mode === 'total') {
    if (qty > 1) {
      const perKs = raw / qty;
      hint.textContent = `= ${formatMoney(perKs, ccy)} / ks`;
      hint.className = 'sell-hint info';
    } else {
      hint.textContent = '';
    }
  } else {
    if (qty > 1) {
      const total = raw * qty;
      hint.textContent = `× ${qty} ks = ${formatMoney(total, ccy)} celkem`;
      hint.className = 'sell-hint info';
    } else {
      hint.textContent = '';
    }
  }
}

// Same as updatePurchasePriceHint but for the sale-price field.
function updateSalePriceEditHint() {
  const hint = $('#fSalePriceHint');
  if (!hint) return;
  const raw = parseFloat($('#fSalePrice')?.value) || 0;
  const qty = parseInt($('#fQuantity')?.value) || 1;
  const ccy = $('#fCurrency')?.value || getDefaultTicketCurrency();
  const mode = state.salePriceModeEdit || 'per';
  if (raw <= 0) { hint.textContent = ''; return; }
  if (mode === 'total') {
    if (qty > 1) {
      const perKs = raw / qty;
      hint.textContent = `= ${formatMoney(perKs, ccy)} / ks`;
      hint.className = 'sell-hint info';
    } else {
      hint.textContent = '';
    }
  } else {
    if (qty > 1) {
      const total = raw * qty;
      hint.textContent = `× ${qty} ks = ${formatMoney(total, ccy)} celkem`;
      hint.className = 'sell-hint info';
    } else {
      hint.textContent = '';
    }
  }
}

function updateSellHints() {
  const ticket = state.sellingTicket;
  if (!ticket) return;
  const totalQty = Number(ticket.quantity) || 1;
  const sellQty = parseInt($('#sellQuantity').value) || 0;
  const pricePerKs = getSellPricePerKs();
  const purchasePerKs = Number(ticket.purchasePrice) || 0;
  
  // Quantity hint
  const hint = $('#sellQtyHint');
  if (sellQty <= 0) {
    hint.textContent = `Zadej počet (1 až ${totalQty})`;
    hint.className = 'sell-hint err';
  } else if (sellQty > totalQty) {
    hint.textContent = `⚠ Nemůžeš prodat víc než ${totalQty} ks`;
    hint.className = 'sell-hint err';
  } else if (sellQty === totalQty) {
    hint.textContent = `✓ Prodáš všechny (${totalQty} ks)`;
    hint.className = 'sell-hint ok';
  } else {
    const remaining = totalQty - sellQty;
    hint.textContent = `Prodáš ${sellQty} ks, zbyde ${remaining} ks (vytvoří se nový řádek)`;
    hint.className = 'sell-hint info';
  }
  
  // Total line — always shows both per-ks AND total revenue so the user can
  // sanity-check whichever number they didn't type directly.
  const totalLine = $('#sellTotalLine');
  if (pricePerKs > 0 && sellQty > 0) {
    const totalRevenue = pricePerKs * sellQty;
    // Currency-aware profit: when sale and purchase are in different currencies,
    // convert sale into purchase currency before computing profit.
    const purchaseCcy = ticketCurrency(ticket);
    const sellCcy = $('#sellCurrency')?.value || purchaseCcy;
    const totalCost = purchasePerKs * sellQty;
    const totalRevenueInPurchaseCcy = sellCcy === purchaseCcy
      ? totalRevenue
      : convertCurrency(totalRevenue, sellCcy, purchaseCcy);
    const profit = totalRevenueInPurchaseCcy - totalCost;
    const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const profitColor = profit >= 0 ? 'var(--green-bright)' : 'var(--red-bright)';

    // Preview shows numbers in the SALE currency the user is typing in;
    // profit is shown in the PURCHASE currency (apples-to-apples with cost).
    const primaryLine = state.sellPriceMode === 'total'
      ? `Za 1 ks: <strong>${formatMoney(pricePerKs, sellCcy)}</strong> (${sellQty}× = ${formatMoney(totalRevenue, sellCcy)})`
      : `Celkem prodej: <strong>${formatMoney(totalRevenue, sellCcy)}</strong> (${sellQty}× ${formatMoney(pricePerKs, sellCcy)})`;

    // Profit annotation — note original currency when conversion happened
    const profitNote = sellCcy !== purchaseCcy
      ? ` <span class="per-ks">(přepočet z ${sellCcy})</span>`
      : '';

    totalLine.innerHTML = `
      <div>${primaryLine}</div>
      <div>Profit: <strong style="color:${profitColor}">${formatMoney(profit, purchaseCcy)}</strong>${profitNote} (ROI ${roi.toFixed(1)}%)</div>
    `;
  } else {
    totalLine.innerHTML = '';
  }
}

async function confirmSell() {
  const ticket = state.sellingTicket;
  if (!ticket) return;

  // Validate sellQty first — needed to derive per-ks price when in "total" mode.
  const sellQty = parseInt($('#sellQuantity').value);
  const totalQty = Number(ticket.quantity) || 1;
  if (!sellQty || sellQty <= 0) {
    toast('Zadej počet kusů', 'error');
    return;
  }
  if (sellQty > totalQty) {
    toast(`Nemůžeš prodat víc než ${totalQty} ks`, 'error');
    return;
  }

  // Resolve price to per-ticket value regardless of which mode user used to enter it.
  // We persist salePrice as per-ks so downstream math (profit, ROI, displays) stays consistent.
  const pricePerKs = getSellPricePerKs();
  const saleDate = $('#sellDate').value;
  // saleCurrency is stored ONLY when it differs from the ticket's main currency.
  // If they match, leave it undefined and let calcRevenue fall back to t.currency.
  const sellCurrency = $('#sellCurrency')?.value || ticket.currency || getPrimaryCurrency();
  const ticketCcy = ticket.currency || getPrimaryCurrency();
  const saleCurrency = sellCurrency !== ticketCcy ? sellCurrency : undefined;

  if (!pricePerKs || pricePerKs <= 0) {
    toast('Zadej platnou cenu', 'error');
    return;
  }
  
  if (sellQty === totalQty) {
    // FULL SALE - just mark as sold (behavior as before)
    const soldTicket = {
      ...ticket,
      salePrice: pricePerKs,
      saleDate,
      saleCurrency,
      status: 'sold'
    };
    await window.api.upsertTicket(soldTicket);
    await refreshDb();
    closeModal('modalSell');
    toast('Vstupenka prodána', 'success');
  } else {
    // PARTIAL SALE - split into 2 rows:
    // 1) Existing ticket → becomes SOLD with reduced quantity
    // 2) New ticket → remaining quantity, still available
    const remaining = totalQty - sellQty;
    
    // Update original: sold portion
    const soldTicket = {
      ...ticket,
      quantity: sellQty,
      salePrice: pricePerKs,
      saleDate,
      saleCurrency,
      status: 'sold',
      notes: (ticket.notes ? ticket.notes + ' | ' : '') + `Rozděleno: ${sellQty} z ${totalQty} ks prodáno`
    };
    await window.api.upsertTicket(soldTicket);
    
    // Create new ticket for remaining quantity
    const { id, created, updated, ...ticketWithoutIds } = ticket;
    const remainingTicket = {
      ...ticketWithoutIds,
      quantity: remaining,
      status: 'available',
      salePrice: 0,
      saleDate: null,
      notes: (ticket.notes ? ticket.notes + ' | ' : '') + `Zbylo z původních ${totalQty} ks (prodáno ${sellQty})`
    };
    await window.api.upsertTicket(remainingTicket);
    
    await refreshDb();
    closeModal('modalSell');
    toast(`Prodáno ${sellQty} ks, ${remaining} ks zbývá na novém řádku`, 'success', 5000);
  }
}

function closeModal(id) {
  $('#' + id).classList.remove('active');
}

// ============ TICKET ACTIONS ============
function cloneTicket(ticket) {
  if (!ticket) return;
  // Create a shallow clone with fields that make sense to keep
  // Reset: id (will be auto-generated), sale data, status (back to available), timestamps
  const clone = {
    eventName: ticket.eventName || '',
    eventDate: ticket.eventDate || '',
    venue: ticket.venue || '',
    section: ticket.section || '',
    row: ticket.row || '',
    // intentionally skip: seat (usually different per ticket)
    account: ticket.account || '',
    platform: ticket.platform || '',
    quantity: ticket.quantity || 1,
    purchasePrice: ticket.purchasePrice || 0,
    // intentionally skip: salePrice, saleDate, status, notes
    status: 'available',
    logo: ticket.logo || ''
  };
  // Open the modal as if adding new, but pre-filled
  openTicketModal(clone);
  // Indicate it's a clone in the title
  const title = $('#modalTitle');
  if (title) title.textContent = 'Klonovat vstupenku (nová kopie)';
  // Focus on seat since it's the most common thing to change
  setTimeout(() => $('#fSeat')?.focus(), 50);
  toast('Vstupenka naklonována - uprav a ulož', 'info', 3000);
}

async function deleteTicket(id) {
  const ticket = state.db.tickets.find(t => t.id === id);
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Smazat vstupenku',
    message: `Opravdu smazat "${ticket?.eventName}"?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteTicket(id);
  state.selectedIds.delete(id);
  await refreshDb();
  toast('Vstupenka smazána', 'success');
}

async function markDelivered(id) {
  const ticket = state.db.tickets.find(t => t.id === id);
  if (!ticket) return;
  const updated = {
    ...ticket,
    status: 'delivered',
    deliveredAt: new Date().toISOString()
  };
  await window.api.upsertTicket(updated);
  await refreshDb();
  toast(`✓ Označeno jako doručeno zákazníkovi`, 'success');
}

async function markUndelivered(id) {
  const ticket = state.db.tickets.find(t => t.id === id);
  if (!ticket) return;
  const updated = {
    ...ticket,
    status: 'sold',
    deliveredAt: null
  };
  await window.api.upsertTicket(updated);
  await refreshDb();
  toast('Vráceno zpět na "Prodáno"', 'info');
}

async function bulkDelete() {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} vstupenek?`,
    detail: 'Akci nelze vrátit.'
  });
  if (res !== 1) return;
  await window.api.deleteTickets(ids);
  state.selectedIds.clear();
  await refreshDb();
  toast(`Smazáno ${ids.length} vstupenek`, 'success');
}

// ============ BULK EDIT MODAL (shared by Tickets + Payouts) ============
// One modal serves both views. The user picks ONE field to change, types one
// new value, and we patch every selected ticket via upsertTicket(). We don't
// touch fields we weren't asked to touch — upsertTicket merges via spread, so
// passing { id, status: 'sold' } only changes status.
//
// Field defs are declarative; each entry knows how to render its input and how
// to extract the value when Apply is clicked. Adding a new field = one entry.

const BULK_EDIT_FIELDS = [
  // Status / classification
  { key: 'status',          label: 'Status',                type: 'select',
    options: [
      { value: 'available', label: 'Koupeno' },
      { value: 'listed',    label: 'Zalistováno' },
      { value: 'sold',      label: 'Prodáno' },
      { value: 'delivered', label: 'Doručeno ✓' },
      { value: 'cancelled', label: 'Zrušeno' }
    ]
  },
  { key: 'category',        label: 'Kategorie',             type: 'select',
    options: [
      { value: 'concert',  label: '🎵 Koncerty a ostatní' },
      { value: 'football', label: '⚽ Fotbal' },
      { value: 'other',    label: '🎫 Jiné' }
    ]
  },
  // Identity / location
  { key: 'eventName',       label: 'Název eventu',          type: 'text' },
  { key: 'venue',           label: 'Místo (venue)',         type: 'text' },
  { key: 'country',         label: 'Země',                  type: 'text' },
  { key: 'section',         label: 'Sekce',                 type: 'text' },
  { key: 'row',             label: 'Řada',                  type: 'text' },
  // Account & platforms
  { key: 'account',         label: 'Účet',                  type: 'text' },
  { key: 'platform',        label: 'Platforma nákupu',      type: 'text' },
  { key: 'salePlatform',    label: 'Platforma prodeje',     type: 'text' },
  // Money — currency selectors mirror those in the ticket modal
  { key: 'currency',        label: 'Měna nákupu',           type: 'currency' },
  { key: 'saleCurrency',    label: 'Měna prodeje',          type: 'currency' },
  { key: 'purchasePrice',   label: 'Nákupní cena (za 1 ks)',type: 'number',
    hint: 'Cena se uloží na všechny vybrané vstupenky stejně.' },
  { key: 'salePrice',       label: 'Prodejní cena (za 1 ks)', type: 'number',
    hint: 'Cena se uloží na všechny vybrané vstupenky stejně.' },
  // Dates
  { key: 'eventDate',       label: 'Datum eventu',          type: 'date' },
  { key: 'purchaseDate',    label: 'Datum nákupu',          type: 'date' },
  { key: 'saleDate',        label: 'Datum prodeje',         type: 'date' },
  // Notes
  { key: 'notes',           label: 'Poznámka',              type: 'textarea' }
];

// Render the value-input portion of the modal based on the chosen field.
function renderBulkEditValueSlot(field) {
  const slot = $('#bulkEditValueSlot');
  const labelEl = $('#bulkEditValueLabel');
  const hintEl = $('#bulkEditValueHint');
  if (!slot) return;
  labelEl.textContent = 'Nová hodnota: ' + field.label;
  hintEl.textContent = field.hint || '';

  if (field.type === 'select') {
    const opts = field.options.map(o =>
      `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`
    ).join('');
    slot.innerHTML = `<select id="bulkEditValue">${opts}</select>`;
  } else if (field.type === 'currency') {
    const opts = CURRENCIES.map(c =>
      `<option value="${c.code}">${c.code} — ${escapeHtml(c.name)}</option>`
    ).join('');
    slot.innerHTML = `<select id="bulkEditValue">${opts}</select>`;
    const sel = $('#bulkEditValue');
    if (sel) sel.value = getPrimaryCurrency();
  } else if (field.type === 'number') {
    slot.innerHTML = `<input type="number" id="bulkEditValue" step="0.01" placeholder="0.00">`;
  } else if (field.type === 'date') {
    slot.innerHTML = `<input type="date" id="bulkEditValue">`;
  } else if (field.type === 'textarea') {
    slot.innerHTML = `<textarea id="bulkEditValue" rows="3" placeholder="Zadej hodnotu..."></textarea>`;
  } else { // text
    slot.innerHTML = `<input type="text" id="bulkEditValue" placeholder="Zadej hodnotu...">`;
  }
}

// Open the modal in either 'tickets' or 'payouts' context. The two contexts
// look up the selection from different Sets; everything else is shared.
function openBulkEditModal(ctx) {
  const ids = ctx === 'payouts'
    ? [...state.selectedPayoutIds]
    : [...state.selectedIds];
  if (!ids.length) return;

  state.bulkEditCtx = ctx;
  $('#bulkEditCount').textContent = ids.length;
  $('#bulkEditTitle').textContent = ctx === 'payouts'
    ? 'Hromadná editace výplat'
    : 'Hromadná editace vstupenek';
  $('#btnBulkEditApply').textContent = `Aplikovat na ${ids.length}`;

  // Populate field dropdown.
  const fieldSel = $('#bulkEditField');
  fieldSel.innerHTML = BULK_EDIT_FIELDS.map(f =>
    `<option value="${f.key}">${escapeHtml(f.label)}</option>`
  ).join('');

  // Default selection — sensible per context.
  fieldSel.value = ctx === 'payouts' ? 'salePrice' : 'status';
  renderBulkEditValueSlot(BULK_EDIT_FIELDS.find(f => f.key === fieldSel.value));

  $('#modalBulkEdit').classList.add('active');
}

// Wire up the field-change listener once on init (see initBulkEdit below).
function onBulkEditFieldChange() {
  const key = $('#bulkEditField').value;
  const field = BULK_EDIT_FIELDS.find(f => f.key === key);
  if (field) renderBulkEditValueSlot(field);
}

async function applyBulkEdit() {
  const ctx = state.bulkEditCtx;
  if (!ctx) return;
  const ids = ctx === 'payouts'
    ? [...state.selectedPayoutIds]
    : [...state.selectedIds];
  if (!ids.length) { closeModal('modalBulkEdit'); return; }

  const fieldKey = $('#bulkEditField').value;
  const field = BULK_EDIT_FIELDS.find(f => f.key === fieldKey);
  if (!field) return;

  const valEl = $('#bulkEditValue');
  if (!valEl) return;

  // Coerce + validate the value based on field type.
  let value;
  if (field.type === 'number') {
    const raw = valEl.value;
    if (raw === '' || raw === null || raw === undefined) {
      toast('Zadej hodnotu', 'error');
      return;
    }
    value = Number(raw);
    if (!isFinite(value)) {
      toast('Neplatné číslo', 'error');
      return;
    }
  } else if (field.type === 'date') {
    value = valEl.value || null; // empty date is allowed (clears the field)
  } else {
    value = valEl.value;
  }

  // Confirm before doing it — bulk edit is hard to undo.
  const fmtVal = field.type === 'select'
    ? (field.options.find(o => o.value === value)?.label || value)
    : (value === '' || value === null ? '(prázdné)' : value);
  const res = await window.api.confirm({
    type: 'question',
    buttons: ['Zrušit', 'Aplikovat'],
    title: 'Potvrdit hromadnou editaci',
    message: `Změnit pole "${field.label}" na "${fmtVal}" u ${ids.length} ${ctx === 'payouts' ? 'výplat' : 'vstupenek'}?`,
    detail: 'Akci nelze hromadně vrátit zpět (lze ručně po jednom).'
  });
  if (res !== 1) return;

  // Apply to each ticket. We must send the FULL merged ticket (not just a
  // patch) because main.js forwards exactly what we send to cloudUpsertTicket
  // — sending only { id, field: value } would clobber the cloud copy.
  // Run sequentially to avoid hammering the cloud endpoint.
  let ok = 0, fail = 0;
  for (const id of ids) {
    const existing = state.db.tickets.find(t => t.id === id);
    if (!existing) { fail++; continue; }
    const merged = { ...existing, [fieldKey]: value };
    try {
      await window.api.upsertTicket(merged);
      ok++;
    } catch (e) {
      console.error('Bulk edit failed for', id, e);
      fail++;
    }
  }

  closeModal('modalBulkEdit');
  await refreshDb();

  if (fail === 0) {
    toast(`Upraveno ${ok} ${ctx === 'payouts' ? 'výplat' : 'vstupenek'}`, 'success');
  } else {
    toast(`Upraveno ${ok}, selhalo ${fail}`, 'error', 5000);
  }
}

// ============ PAYOUT BULK ACTIONS ============

async function bulkMarkPaidPayouts() {
  const ids = [...state.selectedPayoutIds];
  if (!ids.length) return;

  // Skip already-paid tickets so we don't overwrite their stored paidOutDate.
  const tickets = state.db.tickets.filter(t => ids.includes(t.id));
  const toPay = tickets.filter(t => !t.paidOut);
  const skipping = tickets.length - toPay.length;

  if (toPay.length === 0) {
    toast('Všechny vybrané jsou už označené jako přijaté', 'info');
    return;
  }

  const res = await window.api.confirm({
    type: 'question',
    buttons: ['Zrušit', 'Označit přijaté'],
    title: 'Hromadné označení přijatých',
    message: `Označit ${toPay.length} výplat jako přijaté k dnešnímu datu?`,
    detail: skipping > 0
      ? `${skipping} už označených bude přeskočeno. Částka = očekávaná částka (lze ručně upravit po jedné).`
      : 'Částka = očekávaná částka (lze ručně upravit po jedné).'
  });
  if (res !== 1) return;

  const today = new Date().toISOString().slice(0, 10);
  let ok = 0, fail = 0;
  for (const t of toPay) {
    // Use the same expected amount the Payouts view shows: salePrice * qty.
    // That's what calcRevenue does, denominated in saleCurrency.
    const amount = (Number(t.salePrice) || 0) * (Number(t.quantity) || 1);
    try {
      const r = await window.api.markPayoutPaid({
        ticketId: t.id,
        paidOutDate: today,
        paidOutAmount: amount
      });
      if (r && r.success !== false) ok++; else fail++;
    } catch (e) {
      console.error('markPayoutPaid failed for', t.id, e);
      fail++;
    }
  }

  state.selectedPayoutIds.clear();
  await refreshDb();
  if (fail === 0) {
    toast(`Označeno ${ok} výplat jako přijaté`, 'success');
  } else {
    toast(`Označeno ${ok}, selhalo ${fail}`, 'error', 5000);
  }
}

async function bulkDeletePayoutTickets() {
  const ids = [...state.selectedPayoutIds];
  if (!ids.length) return;

  const res = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Smazat'],
    title: 'Hromadné smazání',
    message: `Opravdu smazat ${ids.length} prodaných vstupenek?`,
    detail: 'Smaže se celý záznam vstupenky včetně historie výplaty. Akci nelze vrátit.'
  });
  if (res !== 1) return;

  await window.api.deleteTickets(ids);
  state.selectedPayoutIds.clear();
  await refreshDb();
  toast(`Smazáno ${ids.length} vstupenek`, 'success');
}

// ============ SYNC & EXPORT/IMPORT ============
async function syncNow() {
  await refreshDb();
  toast('Databáze synchronizována', 'success');
}

async function exportBackup() {
  const res = await window.api.exportJson();
  if (res.success) toast('Záloha exportována', 'success');
  else if (!res.canceled) toast('Chyba při exportu: ' + res.error, 'error');
}

async function refreshDbLocal() {
  // Loads directly from local file (skips cloud pull). Used after import operations
  // so that we display the imported data even if cloud push is pending/failed.
  state.db = await window.api.loadLocalDb();
  if (!state.db.tickets) state.db.tickets = [];
  populateYearFilter();
  render();
}

async function importBackup() {
  const res = await window.api.importJson();
  if (res.success) {
    // Use LOCAL refresh to show imported data immediately
    // (avoids race condition where cloud refreshDb would fetch before our push completes)
    await refreshDbLocal();
    
    let msg = `✓ Importováno ${res.imported} vstupenek (${res.mode === 'overwrite' ? 'přepsáno' : 'sloučeno'})`;
    if (res.cloudActive) {
      if (res.cloudPushed) {
        msg += ' • nahráno do cloudu ☁️';
      } else {
        msg += ` • ⚠️ NAHRÁNÍ DO CLOUDU SELHALO: ${res.cloudError || 'neznámá chyba'}`;
        toast(msg, 'error', 12000);
        toast('Data jsou uložena LOKÁLNĚ. Zkus: Nastavení → ⬆️ Nahrát lokální data do cloudu', 'info', 10000);
        return;
      }
    }
    toast(msg, 'success', 5000);
  } else if (!res.canceled) {
    toast('Chyba při importu: ' + res.error, 'error', 6000);
  }
}

async function exportCsv() {
  const res = await window.api.exportCsv();
  if (res.success) toast('CSV exportováno', 'success');
  else if (!res.canceled) toast('Chyba: ' + res.error, 'error');
}

async function importCsv() {
  const res = await window.api.importCsv();
  if (res.success) {
    // Use LOCAL refresh to show imported data immediately
    await refreshDbLocal();
    
    const formatName = res.format === 'checkout-log' ? 'checkout log' : 'TicketVault';
    let msg = `✓ Importováno ${res.imported} vstupenek (${formatName})`;
    if (res.skipped) msg += `, přeskočeno ${res.skipped} prázdných`;
    const cfg = await window.api.getConfig();
    if (cfg?.cloud?.enabled) msg += ' • nahráno do cloudu ☁️';
    toast(msg, 'success', 5000);
  } else if (!res.canceled) {
    toast('Chyba: ' + res.error, 'error', 6000);
  }
}

async function changeDbPath() {
  const res = await window.api.chooseDbPath();
  if (res.success) {
    state.config = await window.api.getConfig();
    updateDbPathDisplay();
    await refreshDb();
    toast('Umístění databáze změněno', 'success');
  } else if (!res.canceled) {
    toast('Chyba: ' + res.error, 'error');
  }
}

// ============ EVENT LISTENERS ============
function setupEventListeners() {
  // Navigation
  $$('.nav-item[data-view]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // The "↗" badge on Stubhub/Viagogo nav items is a click-target inside
      // the button. If the user clicked it, open in system browser INSTEAD
      // of switching to the webview (intentional escape hatch).
      const ext = e.target.closest('[data-mkt-external]');
      if (ext) {
        e.stopPropagation();
        const url = ext.dataset.mktExternal;
        if (window.api?.openExternal) window.api.openExternal(url);
        else window.open(url, '_blank');
        return;
      }
      switchView(btn.dataset.view);
    });
  });

  // Marketplace toolbar buttons (back / forward / reload / home / external).
  // Delegated listener so it works even if buttons are added later.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.mkt-btn[data-mkt-action]');
    if (!btn) return;
    handleMarketplaceAction(btn.dataset.mktAction, btn.dataset.mkt, btn.dataset.mktExternal);
  });
  
  $('#navSync').addEventListener('click', syncNow);
  $('#navExport').addEventListener('click', exportCsv);
  $('#navImport').addEventListener('click', importCsv);
  $('#navBackupExport').addEventListener('click', exportBackup);
  $('#navBackupImport').addEventListener('click', importBackup);
  $('#navSettings').addEventListener('click', () => switchView('settings'));
  
  // Add event
  $('#btnAddEvent').addEventListener('click', () => openTicketModal());

  // CATEGORY CHIP TOGGLE — wires up BOTH the Dashboard and Stats toggles.
  // Clicking any chip on either page sets state.dashboardCategory and re-renders
  // both Dashboard (stat cards + table) and Stats (KPIs + charts) so they stay in sync.
  function setDashboardCategory(cat) {
    if (!['all', 'football', 'concert', 'other', 'selected'].includes(cat)) return;
    // 'selected' is a pseudo-category — only meaningful when there's an actual
    // selection. Guard against activating an empty filter (would show 0 rows).
    if (cat === 'selected' && state.selectedIds.size === 0) {
      toast('Nejdřív si naklikej řádky v tabulce', 'info', 2500);
      return;
    }
    state.dashboardCategory = cat;
    saveUiPrefs();
    syncCategoryToggleUI();
    // Re-render whichever view is visible. Both functions are cheap so we just
    // call both — no need to gate on currentView.
    renderStats();
    renderTickets();
    if (state.currentView === 'stats') renderStatsPage();
  }

  ['#categoryToggle', '#categoryToggleStats'].forEach(sel => {
    const container = $(sel);
    if (!container) return;
    container.querySelectorAll('.cat-chip').forEach(btn => {
      btn.addEventListener('click', () => setDashboardCategory(btn.dataset.cat));
    });
  });
  // Sync at boot so persisted preference shows correct active chip.
  syncCategoryToggleUI();

  // Modal closes
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.modal').classList.remove('active');
    });
  });
  $$('.modal-backdrop').forEach(bd => {
    bd.addEventListener('click', () => bd.closest('.modal').classList.remove('active'));
  });
  
  // Save ticket
  $('#btnSaveTicket').addEventListener('click', saveTicket);
  $('#btnConfirmSell').addEventListener('click', confirmSell);
  // Live updates in sell modal
  $('#sellQuantity')?.addEventListener('input', updateSellHints);
  $('#sellPrice')?.addEventListener('input', updateSellHints);
  $('#sellCurrency')?.addEventListener('change', updateSellHints);

  // Price mode toggle (per-ks / total) — switches interpretation of the price input.
  // When switching modes we convert the currently-typed value so the net per-ks
  // price stays the same; this way the user doesn't lose what they've typed.
  $('#sellPriceMode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.price-mode-btn');
    if (!btn) return;
    const newMode = btn.dataset.mode;
    const oldMode = state.sellPriceMode || 'per';
    if (newMode === oldMode) return;

    const input = $('#sellPrice');
    const raw = parseFloat(input.value);
    const qty = parseInt($('#sellQuantity').value) || 1;
    if (raw > 0 && qty > 0) {
      // Converting between modes: same sale, different display.
      if (oldMode === 'per' && newMode === 'total') {
        input.value = (raw * qty).toFixed(2);
      } else if (oldMode === 'total' && newMode === 'per') {
        input.value = (raw / qty).toFixed(2);
      }
    }
    state.sellPriceMode = newMode;
    updatePriceModeUI();
    updateSellHints();
  });

  // Edit-modal: PURCHASE price toggle. Same conversion behavior — switching
  // mode rewrites the visible value so the user doesn't lose their input.
  $('#fPurchasePriceMode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.price-mode-btn');
    if (!btn) return;
    const newMode = btn.dataset.pmode;
    const oldMode = state.purchasePriceMode || 'per';
    if (newMode === oldMode) return;
    const input = $('#fPurchasePrice');
    const raw = parseFloat(input.value);
    const qty = parseInt($('#fQuantity').value) || 1;
    if (raw > 0 && qty > 0) {
      if (oldMode === 'per' && newMode === 'total') input.value = (raw * qty).toFixed(2);
      else if (oldMode === 'total' && newMode === 'per') input.value = (raw / qty).toFixed(2);
    }
    state.purchasePriceMode = newMode;
    updatePurchasePriceModeUI();
    updatePurchasePriceHint();
  });

  // Edit-modal: SALE price toggle (same logic as purchase).
  $('#fSalePriceMode')?.addEventListener('click', (e) => {
    const btn = e.target.closest('.price-mode-btn');
    if (!btn) return;
    const newMode = btn.dataset.smode;
    const oldMode = state.salePriceModeEdit || 'per';
    if (newMode === oldMode) return;
    const input = $('#fSalePrice');
    const raw = parseFloat(input.value);
    const qty = parseInt($('#fQuantity').value) || 1;
    if (raw > 0 && qty > 0) {
      if (oldMode === 'per' && newMode === 'total') input.value = (raw * qty).toFixed(2);
      else if (oldMode === 'total' && newMode === 'per') input.value = (raw / qty).toFixed(2);
    }
    state.salePriceModeEdit = newMode;
    updateSalePriceModeEditUI();
    updateSalePriceEditHint();
  });

  // Live recompute hints when user types or changes related fields.
  $('#fPurchasePrice')?.addEventListener('input', updatePurchasePriceHint);
  $('#fSalePrice')?.addEventListener('input', updateSalePriceEditHint);
  $('#fQuantity')?.addEventListener('input', () => {
    updatePurchasePriceHint();
    updateSalePriceEditHint();
  });
  $('#fCurrency')?.addEventListener('change', () => {
    updatePurchasePriceHint();
    updateSalePriceEditHint();
  });
  
  // Prefill from Viagogo/StubHub URL
  const prefillBtn = $('#btnPrefill');
  if (prefillBtn) prefillBtn.addEventListener('click', prefillFromUrl);
  // Also trigger on Enter in URL field
  const prefillInput = $('#fPrefillUrl');
  if (prefillInput) prefillInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); prefillFromUrl(); }
  });
  
  // Filters
  $('#filterSearch').addEventListener('input', (e) => {
    state.filters.search = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  $('#filterStatus').addEventListener('change', (e) => {
    state.filters.status = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  $('#filterMonth').addEventListener('change', (e) => {
    state.filters.month = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  $('#filterYear').addEventListener('change', (e) => {
    state.filters.year = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  $('#filterDateFrom').addEventListener('change', (e) => {
    state.filters.dateFrom = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  $('#filterDateTo').addEventListener('change', (e) => {
    state.filters.dateTo = e.target.value;
    saveUiPrefs();
    renderTickets();
  });
  
  $('#btnReset').addEventListener('click', () => {
    state.filters = { search: '', status: '', month: '', year: '', dateFrom: '', dateTo: '' };
    $('#filterSearch').value = '';
    $('#filterStatus').value = '';
    $('#filterMonth').value = '';
    $('#filterYear').value = '';
    $('#filterDateFrom').value = '';
    $('#filterDateTo').value = '';
    saveUiPrefs();
    renderTickets();
  });
  
  $('#btnSync').addEventListener('click', syncNow);
  $('#btnExportCsv').addEventListener('click', exportCsv);
  
  // Sorting
  $$('.tickets-table th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.sort;
      if (state.sortBy === col) {
        state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = col;
        state.sortDir = 'desc';
      }
      $$('.tickets-table th').forEach(h => h.classList.remove('sorted-asc', 'sorted-desc'));
      th.classList.add('sorted-' + state.sortDir);
      saveUiPrefs();
      renderTickets();
    });
  });
  
  // Select all
  $('#selectAll').addEventListener('change', (e) => {
    const filtered = getFilteredTickets();
    if (e.target.checked) {
      filtered.forEach(t => state.selectedIds.add(t.id));
    } else {
      filtered.forEach(t => state.selectedIds.delete(t.id));
    }
    renderTickets();
    renderBulkActions();
  });
  
  $('#btnBulkDelete').addEventListener('click', bulkDelete);
  $('#btnBulkEdit')?.addEventListener('click', () => openBulkEditModal('tickets'));

  // Bulk-Edit modal — wire up once. Field-change repaints the value slot,
  // Apply runs the patch loop. Shared between Tickets and Payouts contexts.
  $('#bulkEditField')?.addEventListener('change', onBulkEditFieldChange);
  $('#btnBulkEditApply')?.addEventListener('click', applyBulkEdit);

  // Marketplace match picker — "Vytvořit novou" fallback button.
  $('#btnMktMatchNew')?.addEventListener('click', createNewFromMktPicker);

  // Cleanup picker state when modal closes (X, backdrop, Cancel button).
  // Both the match picker and the item picker share #modalMktMatch — we need
  // to clear both contexts and restore "+ Vytvořit novou" button visibility
  // (it's hidden during item picker mode). MutationObserver is the cleanest
  // way to react to the .active class being removed.
  const mktModal = document.getElementById('modalMktMatch');
  if (mktModal) {
    new MutationObserver(() => {
      if (!mktModal.classList.contains('active')) {
        state._mktPickerCtx = null;
        state._mktItemPickerCtx = null;
        const newBtn = $('#btnMktMatchNew');
        if (newBtn) newBtn.style.display = '';
      }
    }).observe(mktModal, { attributes: true, attributeFilter: ['class'] });
  }

  // PAYOUTS bulk actions: header checkbox + 3 action buttons.
  $('#pSelectAll')?.addEventListener('change', (e) => {
    const visible = getFilteredPayouts();
    if (e.target.checked) {
      visible.forEach(p => state.selectedPayoutIds.add(p.ticket.id));
    } else {
      visible.forEach(p => state.selectedPayoutIds.delete(p.ticket.id));
    }
    renderPayoutsPage();
  });
  $('#btnPBulkPaid')?.addEventListener('click', bulkMarkPaidPayouts);
  $('#btnPBulkEdit')?.addEventListener('click', () => openBulkEditModal('payouts'));
  $('#btnPBulkDelete')?.addEventListener('click', bulkDeletePayoutTickets);
  
  // MEMBERSHIPS
  $('#btnAddMembership')?.addEventListener('click', () => openMembershipModal());
  $('#btnSaveMembership')?.addEventListener('click', saveMembership);
  $('#mfTogglePw')?.addEventListener('click', () => {
    const inp = $('#mfPassword');
    const btn = $('#mfTogglePw');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    btn.textContent = inp.type === 'password' ? '👁️' : '🙈';
  });
  $('#mfGroup')?.addEventListener('input', updateGroupColorPreview);
  $('#mFilterSearch')?.addEventListener('input', (e) => {
    state.membershipFilters.search = e.target.value;
    saveUiPrefs();
    renderMembershipsPage();
  });
  $('#mFilterTeam')?.addEventListener('change', (e) => {
    state.membershipFilters.team = e.target.value;
    saveUiPrefs();
    renderMembershipsPage();
  });
  $('#mFilterOwner')?.addEventListener('change', (e) => {
    state.membershipFilters.owner = e.target.value;
    saveUiPrefs();
    renderMembershipsPage();
  });
  $('#mFilterGroup')?.addEventListener('change', (e) => {
    state.membershipFilters.group = e.target.value;
    saveUiPrefs();
    renderMembershipsPage();
  });
  $('#btnMReset')?.addEventListener('click', () => {
    state.membershipFilters = { search: '', team: '', owner: '', group: '' };
    $('#mFilterSearch').value = '';
    $('#mFilterTeam').value = '';
    $('#mFilterOwner').value = '';
    $('#mFilterGroup').value = '';
    saveUiPrefs();
    renderMembershipsPage();
  });
  $('#btnMExport')?.addEventListener('click', async () => {
    const res = await window.api.exportMembershipsCsv();
    if (res.success) toast(`Exportováno ${res.count} membershipů`, 'success');
    else if (!res.canceled) toast('Chyba: ' + res.error, 'error');
  });
  $('#btnMImport')?.addEventListener('click', async () => {
    const res = await window.api.importMembershipsCsv();
    if (res.success) {
      await refreshDbLocal();
      renderMembershipsPage();
      toast(`Importováno ${res.imported} membershipů`, 'success');
    } else if (!res.canceled) toast('Chyba: ' + res.error, 'error');
  });
  $('#mSelectAll')?.addEventListener('change', (e) => {
    const filtered = getFilteredMemberships();
    if (e.target.checked) filtered.forEach(m => state.selectedMembershipIds.add(m.id));
    else filtered.forEach(m => state.selectedMembershipIds.delete(m.id));
    renderMembershipsPage();
  });
  $('#btnMBulkDelete')?.addEventListener('click', bulkDeleteMemberships);
  
  // MAILBOXES
  $('#btnAddMailbox')?.addEventListener('click', () => openMailboxModal());
  $('#btnSaveMailbox')?.addEventListener('click', saveMailbox);

  // Eye-toggle inside the mailbox modal — flips input type between
  // 'password' and 'text' so the user can verify what they typed.
  $('#mbfPasswordToggle')?.addEventListener('click', () => {
    const input = $('#mbfPassword');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });
  $('#mbFilterSearch')?.addEventListener('input', (e) => {
    state.mailboxFilters.search = e.target.value;
    saveUiPrefs();
    renderMailboxesPage();
  });
  $('#btnMbReset')?.addEventListener('click', () => {
    state.mailboxFilters = { search: '' };
    $('#mbFilterSearch').value = '';
    saveUiPrefs();
    renderMailboxesPage();
  });
  $('#mbSelectAll')?.addEventListener('change', (e) => {
    const filtered = getFilteredMailboxes();
    if (e.target.checked) filtered.forEach(mb => state.selectedMailboxIds.add(mb.id));
    else filtered.forEach(mb => state.selectedMailboxIds.delete(mb.id));
    renderMailboxesPage();
  });
  $('#btnMbBulkDelete')?.addEventListener('click', bulkDeleteMailboxes);

  // SIM CARDS
  $('#btnAddSimcard')?.addEventListener('click', () => openSimcardModal());
  $('#btnSaveSimcard')?.addEventListener('click', saveSimcard);
  $('#scfAddOperator')?.addEventListener('click', addCustomSimOperator);
  $('#scFilterSearch')?.addEventListener('input', (e) => {
    state.simcardFilters.search = e.target.value;
    saveUiPrefs();
    renderSimcardsPage();
  });
  $('#scFilterOperator')?.addEventListener('change', (e) => {
    state.simcardFilters.operator = e.target.value;
    saveUiPrefs();
    renderSimcardsPage();
  });
  $('#scFilterStatus')?.addEventListener('change', (e) => {
    state.simcardFilters.status = e.target.value;
    saveUiPrefs();
    renderSimcardsPage();
  });
  $('#btnScReset')?.addEventListener('click', () => {
    state.simcardFilters = { search: '', operator: '', status: '' };
    $('#scFilterSearch').value = '';
    $('#scFilterOperator').value = '';
    $('#scFilterStatus').value = '';
    saveUiPrefs();
    renderSimcardsPage();
  });
  $('#scSelectAll')?.addEventListener('change', (e) => {
    const filtered = getFilteredSimcards();
    if (e.target.checked) filtered.forEach(sc => state.selectedSimcardIds.add(sc.id));
    else filtered.forEach(sc => state.selectedSimcardIds.delete(sc.id));
    renderSimcardsPage();
  });
  $('#btnScBulkDelete')?.addEventListener('click', bulkDeleteSimcards);
  
  // EXPENSES
  $('#btnAddExpense')?.addEventListener('click', () => openExpenseModal());
  $('#btnSaveExpense')?.addEventListener('click', saveExpense);
  $('#efFrequency')?.addEventListener('change', updateCustomDaysVisibility);
  $('#eFilterSearch')?.addEventListener('input', (ev) => {
    state.expenseFilters.search = ev.target.value;
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#eFilterCategory')?.addEventListener('change', (ev) => {
    state.expenseFilters.category = ev.target.value;
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#eFilterType')?.addEventListener('change', (ev) => {
    state.expenseFilters.type = ev.target.value;
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#eFilterFrequency')?.addEventListener('change', (ev) => {
    state.expenseFilters.frequency = ev.target.value;
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#eFilterStatus')?.addEventListener('change', (ev) => {
    state.expenseFilters.status = ev.target.value;
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#btnEReset')?.addEventListener('click', () => {
    state.expenseFilters = { search: '', type: '', category: '', frequency: '', status: '' };
    $('#eFilterSearch').value = '';
    if ($('#eFilterType')) $('#eFilterType').value = '';
    $('#eFilterCategory').value = '';
    $('#eFilterFrequency').value = '';
    $('#eFilterStatus').value = '';
    saveUiPrefs();
    renderExpensesPage();
  });
  $('#btnEExport')?.addEventListener('click', exportExpensesCsv);
  $('#eSelectAll')?.addEventListener('change', (ev) => {
    const filtered = getFilteredExpenses();
    if (ev.target.checked) filtered.forEach(e => state.selectedExpenseIds.add(e.id));
    else filtered.forEach(e => state.selectedExpenseIds.delete(e.id));
    renderExpensesPage();
  });
  $('#btnEBulkDelete')?.addEventListener('click', bulkDeleteExpenses);
  
  // PAYOUTS
  $('#btnPayoutSettings')?.addEventListener('click', openPayoutRulesModal);
  $('#btnAddPayoutRule')?.addEventListener('click', addPayoutRule);
  $('#btnSavePayoutRules')?.addEventListener('click', savePayoutRules);
  $('#btnConfirmPayoutPaid')?.addEventListener('click', confirmPayoutPaid);
  
  // INBOX
  $('#btnInboxRefresh')?.addEventListener('click', refreshInbox);
  $('#btnInboxHelp')?.addEventListener('click', (e) => { e.preventDefault(); openInboxHelp(); });

  // THEME TOGGLE
  $('#btnThemeToggle')?.addEventListener('click', toggleTheme);

  // PRIVACY MODE — blurs sensitive numbers across the app. State persists
  // in localStorage so the user doesn't have to re-enable after restart.
  // Bound to a sidebar button + Ctrl+Shift+H global shortcut.
  $('#btnPrivacyToggle')?.addEventListener('click', togglePrivacyMode);
  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+H (Cmd+Shift+H on Mac) — quick "panic button" when someone
    // sits down next to you. Doesn't conflict with browser shortcuts.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'H' || e.key === 'h')) {
      e.preventDefault();
      togglePrivacyMode();
    }
  });
  $('#iFilterKind')?.addEventListener('change', (e) => {
    state.inboxFilters.kind = e.target.value;
    saveUiPrefs();
    renderInboxPage();
  });
  $('#iFilterPlatform')?.addEventListener('change', (e) => {
    state.inboxFilters.platform = e.target.value;
    saveUiPrefs();
    renderInboxPage();
  });
  $('#btnCopyWebhookUrl')?.addEventListener('click', async () => {
    const url = $('#inboxWebhookUrlFull').value;
    try {
      await navigator.clipboard.writeText(url);
      toast('URL zkopírována', 'success', 1500);
    } catch (err) {
      toast('Chyba kopírování', 'error');
    }
  });
  $('#btnInboxDismissAll')?.addEventListener('click', async () => {
    const count = getInboxItems().length;
    if (count === 0) return;
    const res = await window.api.confirm({
      type: 'warning',
      buttons: ['Zrušit', 'Vyčistit'],
      title: 'Vyčistit vyřízené',
      message: `Odstranit všechny přijaté/zahozené položky z inboxu?`,
      detail: 'Pending položky zůstanou.'
    });
    if (res !== 1) return;
    await window.api.clearResolvedInbox();
    await refreshDb();
    renderInboxPage();
    toast('Vyčištěno', 'success');
  });
  $('#pFilterSearch')?.addEventListener('input', (ev) => {
    state.payoutFilters.search = ev.target.value;
    saveUiPrefs();
    renderPayoutsPage();
  });
  $('#pFilterPlatform')?.addEventListener('change', (ev) => {
    state.payoutFilters.platform = ev.target.value;
    saveUiPrefs();
    renderPayoutsPage();
  });
  $('#pFilterStatus')?.addEventListener('change', (ev) => {
    state.payoutFilters.status = ev.target.value;
    saveUiPrefs();
    renderPayoutsPage();
  });
  $('#btnPReset')?.addEventListener('click', () => {
    state.payoutFilters = { search: '', platform: '', status: '' };
    $('#pFilterSearch').value = '';
    $('#pFilterPlatform').value = '';
    $('#pFilterStatus').value = '';
    saveUiPrefs();
    renderPayoutsPage();
  });
  
  // Stats filters
  const sfm = $('#statsFilterMonth');
  const sfy = $('#statsFilterYear');
  const sfr = $('#btnStatsReset');
  if (sfm) sfm.addEventListener('change', (e) => {
    state.statsFilters.month = e.target.value;
    saveUiPrefs();
    renderStatsPage();
  });
  if (sfy) sfy.addEventListener('change', (e) => {
    state.statsFilters.year = e.target.value;
    saveUiPrefs();
    renderStatsPage();
  });
  if (sfr) sfr.addEventListener('click', () => {
    state.statsFilters = { month: '', year: '' };
    if (sfm) sfm.value = '';
    if (sfy) sfy.value = '';
    saveUiPrefs();
    renderStatsPage();
  });
  
  // Settings actions
  $('#btnChangeDbPath').addEventListener('click', changeDbPath);
  $('#btnOpenDbLocation').addEventListener('click', () => window.api.openDbLocation());
  $('#btnSyncNow').addEventListener('click', syncNow);
  $('#btnExportBackup').addEventListener('click', exportBackup);
  $('#btnImportBackup').addEventListener('click', importBackup);
  $('#btnExportCsvSettings').addEventListener('click', exportCsv);
  $('#btnImportCsvSettings').addEventListener('click', importCsv);

  // User management (admin only — section is hidden for non-admins).
  $('#btnAddUser')?.addEventListener('click', openAddUserModal);
  $('#btnConfirmAddUser')?.addEventListener('click', confirmAddUser);
  $('#btnConfirmResetPw')?.addEventListener('click', confirmResetPassword);
  $('#btnChangePassword')?.addEventListener('click', handleChangeOwnPassword);
  $('#btnSaveEmailSettings')?.addEventListener('click', saveEmailSettings);
  $('#btnTestDigest')?.addEventListener('click', sendTestDigest);
  $('#btnCopyMailAddress')?.addEventListener('click', copyMailAddress);
  // v1.3.0 — personal forward address: copy + regenerate
  $('#btnCopyForwardAddr')?.addEventListener('click', copyMailForwardAddress);
  $('#btnRegenMailToken')?.addEventListener('click', regenerateMailToken);
  $('#btnSaveCurrencySettings')?.addEventListener('click', saveCurrencySettings);
  $('#btnRefreshRates')?.addEventListener('click', refreshRates);
  // Enter-to-submit in add-user modal
  ['newUserName', 'newUserPassword'].forEach(id => {
    $('#' + id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); confirmAddUser(); }
    });
  });
  $('#resetPwNewPassword')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmResetPassword(); }
  });
  
  // Cloud / Online mode
  $('#btnCloudTest').addEventListener('click', testCloudConnection);
  $('#btnCloudSave').addEventListener('click', saveCloudSettings);
  $('#btnCloudPush').addEventListener('click', cloudPushLocal);
  $('#btnCloudPull').addEventListener('click', cloudPullRemote);
  $('#btnToggleKey').addEventListener('click', () => {
    const inp = $('#cloudApiKey');
    inp.type = inp.type === 'password' ? 'text' : 'password';
    $('#btnToggleKey').textContent = inp.type === 'password' ? '👁️' : '🙈';
  });
  $('#cloudEnabled').addEventListener('change', async (e) => {
    // If enabling, require saved credentials
    if (e.target.checked) {
      const status = await window.api.cloudStatus();
      if (!status.configured) {
        toast('Nejdřív zadej URL a API klíč, pak klikni Uložit', 'error');
        e.target.checked = false;
        return;
      }
    }
    await saveCloudSettings();
  });
  
  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      $$('.modal.active').forEach(m => m.classList.remove('active'));
    }
    if (e.ctrlKey && e.key === 'n') {
      e.preventDefault();
      openTicketModal();
    }
  });
}

// ============ CLOUD SYNC ============
async function loadCloudSettings() {
  const status = await window.api.cloudStatus();
  $('#cloudEnabled').checked = status.enabled;
  $('#cloudApiUrl').value = status.apiUrl || '';
  // Don't show key in UI for security - user must re-enter if they want to change
  if (status.configured) {
    $('#cloudApiKey').placeholder = '••••••••••••••••••••••••••• (uložen)';
  }
  updateLastSync(status.lastSync);
  updateCloudBadge(false);
}

// ============ ALERT SETTINGS ============
function loadAlertSettings() {
  const cfg = getAlertsConfig();
  const a = $('#alertsAnimations');
  const s = $('#alertsStartupToast');
  const ud = $('#alertsUnsoldDays');
  const dd = $('#alertsUndeliveredDays');
  if (a) a.checked = cfg.animations;
  if (s) s.checked = cfg.startupToast;
  if (ud) ud.value = cfg.unsoldDays;
  if (dd) dd.value = cfg.undeliveredDays;

  // TODO page settings
  const tsnl = $('#todoShowNotListed');
  const tsu = $('#todoShowUnsold');
  const tsd = $('#todoShowUndelivered');
  const tud = $('#todoUnsoldDays');
  const tdd = $('#todoUndeliveredDays');
  if (tsnl) tsnl.checked = cfg.todoShowNotListed;
  if (tsu) tsu.checked = cfg.todoShowUnsold;
  if (tsd) tsd.checked = cfg.todoShowUndelivered;
  if (tud) tud.value = cfg.todoUnsoldDays;
  if (tdd) tdd.value = cfg.todoUndeliveredDays;

  updateMutedRowUI();
}

function setupAlertSettingsListeners() {
  $('#alertsAnimations')?.addEventListener('change', async (e) => {
    await setAlertsConfig({ animations: e.target.checked });
    render();
    toast(e.target.checked ? 'Animace zapnuté' : 'Animace vypnuté', 'info', 2000);
  });
  $('#alertsStartupToast')?.addEventListener('change', async (e) => {
    await setAlertsConfig({ startupToast: e.target.checked });
    toast(e.target.checked ? 'Startup toasty zapnuté' : 'Startup toasty vypnuté', 'info', 2000);
  });
  $('#alertsUnsoldDays')?.addEventListener('change', async (e) => {
    const v = Math.max(0, Math.min(30, parseInt(e.target.value) || 7));
    e.target.value = v;
    await setAlertsConfig({ unsoldDays: v });
    render();
  });
  $('#alertsUndeliveredDays')?.addEventListener('change', async (e) => {
    const v = Math.max(0, Math.min(30, parseInt(e.target.value) || 5));
    e.target.value = v;
    await setAlertsConfig({ undeliveredDays: v });
    render();
  });
  $('#btnClearMuted')?.addEventListener('click', clearAllMuted);

  // TODO page settings listeners
  $('#todoShowNotListed')?.addEventListener('change', async (e) => {
    await setAlertsConfig({ todoShowNotListed: e.target.checked });
    if (state.currentView === 'todo') renderTodoPage();
    updateTodoBadge();
  });
  $('#todoShowUnsold')?.addEventListener('change', async (e) => {
    await setAlertsConfig({ todoShowUnsold: e.target.checked });
    if (state.currentView === 'todo') renderTodoPage();
    updateTodoBadge();
  });
  $('#todoShowUndelivered')?.addEventListener('change', async (e) => {
    await setAlertsConfig({ todoShowUndelivered: e.target.checked });
    if (state.currentView === 'todo') renderTodoPage();
    updateTodoBadge();
  });
  $('#todoUnsoldDays')?.addEventListener('change', async (e) => {
    const v = Math.max(1, Math.min(60, parseInt(e.target.value) || 7));
    e.target.value = v;
    await setAlertsConfig({ todoUnsoldDays: v });
    if (state.currentView === 'todo') renderTodoPage();
    updateTodoBadge();
  });
  $('#todoUndeliveredDays')?.addEventListener('change', async (e) => {
    const v = Math.max(1, Math.min(60, parseInt(e.target.value) || 5));
    e.target.value = v;
    await setAlertsConfig({ todoUndeliveredDays: v });
    if (state.currentView === 'todo') renderTodoPage();
    updateTodoBadge();
  });
}

function updateLastSync(isoDate) {
  if (!isoDate) {
    $('#lastSync').textContent = '';
    return;
  }
  const d = new Date(isoDate);
  $('#lastSync').textContent = '🕒 Poslední sync: ' + d.toLocaleString('cs-CZ');
}

function showCloudStatus(message, type = 'loading') {
  const el = $('#cloudStatus');
  el.style.display = 'flex';
  el.className = 'cloud-status ' + type;
  const icon = type === 'ok' ? '✓' : type === 'error' ? '✕' : '⏳';
  el.innerHTML = `<span>${icon}</span><span>${message}</span>`;
}

async function testCloudConnection() {
  const apiUrl = $('#cloudApiUrl').value.trim();
  const apiKey = $('#cloudApiKey').value.trim();
  
  if (!apiUrl || !apiKey) {
    showCloudStatus('Zadej URL i API klíč', 'error');
    return;
  }
  
  showCloudStatus('Testuju připojení...', 'loading');
  const result = await window.api.cloudTest({ apiUrl, apiKey });
  
  if (result.success) {
    const info = result.lastModified 
      ? `(${result.tickets} vstupenek v cloudu, naposledy ${new Date(result.lastModified).toLocaleString('cs-CZ')})`
      : '(cloud je prázdný)';
    showCloudStatus(`Úspěšně připojeno! ${info}`, 'ok');
  } else {
    showCloudStatus('Chyba: ' + result.error, 'error');
  }
}

async function saveCloudSettings() {
  const apiUrl = $('#cloudApiUrl').value.trim();
  const apiKeyInput = $('#cloudApiKey').value.trim();
  const enabled = $('#cloudEnabled').checked;
  
  const config = await window.api.getConfig();
  if (!config.cloud) config.cloud = {};
  
  if (apiUrl) config.cloud.apiUrl = apiUrl;
  if (apiKeyInput) config.cloud.apiKey = apiKeyInput;
  config.cloud.enabled = enabled;
  
  // Validate if enabling
  if (enabled && (!config.cloud.apiUrl || !config.cloud.apiKey)) {
    toast('Pro zapnutí online režimu vyplň URL i API klíč', 'error');
    $('#cloudEnabled').checked = false;
    config.cloud.enabled = false;
  }
  
  await window.api.setConfig(config);
  state.config = config;
  
  // Clear key input after save for security
  $('#cloudApiKey').value = '';
  $('#cloudApiKey').placeholder = '••••••••••••••••••••••••••• (uložen)';
  
  toast('Nastavení uloženo', 'success');
  
  // Reload DB (will use cloud if enabled)
  await refreshDb();
}

async function cloudPushLocal() {
  const confirm = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Nahrát a přepsat'],
    title: 'Nahrát lokální data',
    message: 'Nahrát lokální databázi do cloudu?',
    detail: 'Přepíše současný obsah v cloudu tvou lokální verzí. Data v cloudu budou ztracena.'
  });
  if (confirm !== 1) return;
  
  showCloudStatus('Nahrávám data do cloudu...', 'loading');
  const res = await window.api.cloudPushAll();
  if (res.success) {
    showCloudStatus(`Úspěšně nahráno ${res.count} vstupenek`, 'ok');
    toast('Data nahrána do cloudu', 'success');
  } else {
    showCloudStatus('Chyba: ' + res.error, 'error');
    toast('Chyba: ' + res.error, 'error');
  }
}

async function cloudPullRemote() {
  const confirm = await window.api.confirm({
    type: 'warning',
    buttons: ['Zrušit', 'Stáhnout a přepsat'],
    title: 'Stáhnout cloud data',
    message: 'Stáhnout data z cloudu a přepsat lokální?',
    detail: 'Tvá lokální databáze bude nahrazena verzí z cloudu.'
  });
  if (confirm !== 1) return;
  
  showCloudStatus('Stahuji data z cloudu...', 'loading');
  const res = await window.api.cloudPullAll();
  if (res.success) {
    showCloudStatus(`Úspěšně staženo ${res.count} vstupenek`, 'ok');
    toast('Data stažena z cloudu', 'success');
    await refreshDb();
  } else {
    showCloudStatus('Chyba: ' + res.error, 'error');
    toast('Chyba: ' + res.error, 'error');
  }
}

// ============ AUTO-UPDATE UI ============
// Subscribes to updater events from main.js and drives the banner + settings.
// The banner appears on first "available" event and stays through download,
// then shows "Restart and install" button when ready. Dismissable but reopens
// if another event fires (e.g. download progresses).
function setupAutoUpdater() {
  if (!window.api.onUpdaterEvent) return;  // API not available (old preload)

  const banner = $('#updateBanner');
  const title = $('#updateBannerTitle');
  const subtitle = $('#updateBannerSubtitle');
  const progressWrap = $('#updateBannerProgress');
  const progressBar = $('#updateBannerProgressBar');
  const installBtn = $('#btnUpdateInstall');
  const dismissBtn = $('#btnUpdateDismiss');

  function showBanner() { if (banner) banner.style.display = 'block'; }
  function hideBanner() { if (banner) banner.style.display = 'none'; }

  dismissBtn?.addEventListener('click', hideBanner);
  installBtn?.addEventListener('click', async () => {
    installBtn.disabled = true;
    installBtn.textContent = 'Instaluji...';
    await window.api.installUpdate();
    // App quits shortly after; no need to do more.
  });

  // Settings page — current version display + login-poster version footer.
  // Both read from package.json via app.getVersion(), so bumping the version
  // in package.json automatically updates everywhere.
  window.api.getAppVersion().then(v => {
    const el = $('#appVersionDisplay');
    if (el) el.textContent = 'v' + v;
    const posterEl = $('#authPosterVersion');
    if (posterEl) posterEl.textContent = 'VERSION ' + v;
  });

  $('#btnCheckForUpdates')?.addEventListener('click', async () => {
    const btn = $('#btnCheckForUpdates');
    const status = $('#updateCheckStatus');
    btn.disabled = true;
    btn.textContent = '⏳ Kontroluji...';
    if (status) { status.textContent = ''; status.style.color = ''; }
    try {
      const result = await window.api.checkForUpdates();
      if (!result.success && status) {
        status.textContent = result.error || 'Chyba při kontrole.';
        status.style.color = 'var(--red-bright, #ef4444)';
      }
      // If successful, the updater:event stream drives the banner.
    } finally {
      btn.disabled = false;
      btn.textContent = '🔄 Zkontrolovat aktualizace';
    }
  });

  // Listen for updater lifecycle events and drive the banner UI.
  window.api.onUpdaterEvent((ev) => {
    switch (ev.type) {
      case 'checking':
        // Silent on startup - we only surface the banner once we know there's
        // actually an update available. Showing "checking" on every start is noise.
        break;

      case 'available':
        if (title) title.textContent = `Nová verze ${ev.version} je dostupná`;
        if (subtitle) subtitle.textContent = 'Stahuji na pozadí...';
        if (progressWrap) progressWrap.style.display = 'block';
        if (progressBar) progressBar.style.width = '0%';
        if (installBtn) installBtn.style.display = 'none';
        showBanner();
        break;

      case 'progress':
        if (title) title.textContent = `Stahuji aktualizaci... ${ev.percent}%`;
        if (progressBar) progressBar.style.width = ev.percent + '%';
        if (ev.bytesPerSecond && subtitle) {
          const kbps = ev.bytesPerSecond / 1024;
          const speed = kbps > 1024
            ? (kbps / 1024).toFixed(1) + ' MB/s'
            : kbps.toFixed(0) + ' KB/s';
          subtitle.textContent = `${speed} · ${Math.round(ev.transferred / 1e6)} / ${Math.round(ev.total / 1e6)} MB`;
        }
        showBanner();
        break;

      case 'downloaded':
        if (title) title.textContent = `Verze ${ev.version} připravena k instalaci`;
        if (subtitle) subtitle.textContent = 'Klikni pro restart a dokončení.';
        if (progressWrap) progressWrap.style.display = 'none';
        if (installBtn) installBtn.style.display = 'inline-flex';
        showBanner();
        break;

      case 'not-available': {
        const status = $('#updateCheckStatus');
        if (status) {
          status.textContent = '✓ Máš nejnovější verzi';
          status.style.color = 'var(--green-bright, #22c55e)';
        }
        break;
      }

      case 'error': {
        // Silent-fail on startup (offline, rate-limit, etc.); for manual
        // checks we surface the error in Settings.
        const status = $('#updateCheckStatus');
        if (status) {
          status.textContent = '⚠ ' + ev.message;
          status.style.color = 'var(--red-bright, #ef4444)';
        }
        break;
      }
    }
  });
}

// ============ START ============
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupAutoUpdater();
  // Watch all 6 bulk action bars — when ANY of them becomes visible
  // (display != 'none'), set body.bulk-bar-visible so .main gets bottom
  // padding and the fixed bar doesn't cover the last row.
  const bulkBarIds = ['bulkActions','eBulkActions','pBulkActions','mBulkActions','mbBulkActions','scBulkActions'];
  const refreshBulkBodyClass = () => {
    const anyVisible = bulkBarIds.some(id => {
      const el = document.getElementById(id);
      return el && el.style.display && el.style.display !== 'none';
    });
    document.body.classList.toggle('bulk-bar-visible', anyVisible);
  };
  bulkBarIds.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    new MutationObserver(refreshBulkBodyClass).observe(el, { attributes: true, attributeFilter: ['style'] });
  });
  refreshBulkBodyClass();
});
