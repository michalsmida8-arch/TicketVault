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
      statsFilters: state.statsFilters,
      membershipFilters: state.membershipFilters,
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
    if (prefs.statsFilters) Object.assign(state.statsFilters, prefs.statsFilters);
    if (prefs.membershipFilters) Object.assign(state.membershipFilters, prefs.membershipFilters);
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

function calcProfit(t) {
  if (t.status !== 'sold' && t.status !== 'delivered') return 0;
  const qty = Number(t.quantity) || 1;
  const sale = Number(t.salePrice) || 0;
  const purchase = Number(t.purchasePrice) || 0;
  // salePrice a purchasePrice jsou za 1 kus - násobíme počtem kusů
  return (sale - purchase) * qty;
}

function calcRoi(t) {
  if ((t.status !== 'sold' && t.status !== 'delivered') || !t.purchasePrice) return 0;
  const qty = Number(t.quantity) || 1;
  const totalCost = (Number(t.purchasePrice) || 0) * qty;
  if (totalCost <= 0) return 0;
  // ROI is a ratio, so currency cancels out — no conversion needed.
  return (calcProfit(t) / totalCost) * 100;
}

// Total revenue for one ticket row (sale price × quantity), ticket's currency.
function calcRevenue(t) {
  if (t.status !== 'sold' && t.status !== 'delivered') return 0;
  return (Number(t.salePrice) || 0) * (Number(t.quantity) || 1);
}

// Total cost for one ticket row (purchase × quantity), ticket's currency.
function calcCost(t) {
  return (Number(t.purchasePrice) || 0) * (Number(t.quantity) || 1);
}

// Primary-currency variants — used when summing across tickets whose currencies
// may differ. Each ticket's amount is converted via today's exchange rate.
function calcProfitInPrimary(t) {
  return convertCurrency(calcProfit(t), ticketCurrency(t), getPrimaryCurrency());
}
function calcRevenueInPrimary(t) {
  return convertCurrency(calcRevenue(t), ticketCurrency(t), getPrimaryCurrency());
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

// Logout: clear token in backend config and reload. Reload guarantees clean
// DOM state (open modals, cached data) so the next user starts fresh.
async function handleLogout() {
  await window.api.authLogout();
  state.currentUser = null;
  window.location.reload();
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
  if (days === null || days < 0) return null;  // past events ignored
  
  const cfg = getAlertsConfig();
  const isMuted = cfg.mutedTicketIds.includes(t.id);
  
  // Sold (ale ne doručeno) a event do N dní → "potřebuje doručit"
  if (t.status === 'sold' && days <= cfg.undeliveredDays) {
    return { type: 'undelivered', days, level: 'critical', muted: isMuted };
  }
  // Dostupné nebo listed a event do N dní → "potřebuje prodat"
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
  let unsold = 0, undelivered = 0;
  for (const t of all) {
    const u = getTicketUrgency(t);
    if (!u) continue;
    if (u.type === 'unsold') unsold++;
    else if (u.type === 'undelivered') undelivered++;
  }
  return { unsold, undelivered, total: unsold + undelivered };
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
  if ($('#view-stats').classList.contains('active')) renderStatsPage();
  if ($('#view-todo').classList.contains('active')) renderTodoPage();
}

function getFilteredTickets() {
  let list = [...state.db.tickets];
  const f = state.filters;
  
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
    else { av = a[state.sortBy]; bv = b[state.sortBy]; }
    if (typeof av === 'string') { av = av.toLowerCase(); bv = (bv || '').toLowerCase(); }
    av = av ?? ''; bv = bv ?? '';
    if (av < bv) return state.sortDir === 'asc' ? -1 : 1;
    if (av > bv) return state.sortDir === 'asc' ? 1 : -1;
    return 0;
  });
  
  return list;
}

function renderStats() {
  const all = state.db.tickets;
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
    return;
  }
  empty.style.display = 'none';
  
  tbody.innerHTML = list.map(t => {
    const profit = calcProfit(t);
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
    if (urgency) {
      const daysText = urgency.days === 0
        ? 'dnes je event'
        : urgency.days === 1
          ? 'zítra je event'
          : `${urgency.days} dny do eventu`;
      const action = urgency.type === 'undelivered' ? 'Doručit' : 'Prodat';
      const dotClass = urgency.type === 'undelivered' ? 'urgent-dot-red' : 'urgent-dot-yellow';
      const chipAnimClass = cfg.animations && !urgency.muted ? ' animated' : '';
      const chipMutedClass = urgency.muted ? ' muted' : '';
      const muteBtn = urgency.muted
        ? `<button class="urgent-mute-btn" data-unmute-id="${t.id}" title="Obnovit upozornění">🔔</button>`
        : `<button class="urgent-mute-btn" data-mute-id="${t.id}" title="Ztlumit upozornění pro tuto vstupenku">🔕</button>`;
      urgencyBadge = `
        <span class="urgent-chip ${urgency.type === 'undelivered' ? 'urgent-chip-red' : 'urgent-chip-yellow'}${chipAnimClass}${chipMutedClass}" 
              title="${action} — ${daysText}${urgency.muted ? ' (ztlumené)' : ''}">
          <span class="urgent-dot ${dotClass}${cfg.animations && !urgency.muted ? ' animated' : ''}"></span>
          <span class="urgent-chip-text">${daysText}</span>
          ${muteBtn}
        </span>`;
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
      <tr data-id="${t.id}" class="${rowClass}">
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
        <td>${t.eventDate || '—'}</td>
        <td>${escapeHtml(t.venue || '—')}</td>
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
        <td title="${(Number(t.quantity) || 1) > 1 ? 'Cena za 1 ks: ' + formatMoney(t.purchasePrice, ticketCurrency(t)) : ''}">${formatMoney(calcCost(t), ticketCurrency(t))}${(Number(t.quantity) || 1) > 1 ? ` <span class="per-ks">(${formatMoney(t.purchasePrice, ticketCurrency(t))}/ks)</span>` : ''}</td>
        <td title="${isSoldOrDelivered && (Number(t.quantity) || 1) > 1 ? 'Cena za 1 ks: ' + formatMoney(t.salePrice, ticketCurrency(t)) : ''}">${isSoldOrDelivered ? formatMoney(calcRevenue(t), ticketCurrency(t)) + ((Number(t.quantity) || 1) > 1 ? ` <span class="per-ks">(${formatMoney(t.salePrice, ticketCurrency(t))}/ks)</span>` : '') : '—'}</td>
        <td class="${profitClass}">${isSoldOrDelivered ? formatMoney(profit, ticketCurrency(t)) : '—'}</td>
        <td>${isSoldOrDelivered ? `<span class="roi-pill ${roiClass}">${roi.toFixed(1)}%</span>` : '—'}</td>
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
      renderBulkActions();
    });
  });
  
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
  const bar = $('#bulkActions');
  const count = state.selectedIds.size;
  if (count > 0) {
    bar.style.display = 'flex';
    $('#bulkCount').textContent = `${count} vybráno`;
  } else {
    bar.style.display = 'none';
  }
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

  for (const t of all) {
    if (cfg.mutedTicketIds.includes(t.id)) continue;

    const days = t.eventDate ? daysUntil(t.eventDate) : null;

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

  return { notListed, unsold, undelivered };
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
  const { notListed, unsold, undelivered } = collectTodoItems();
  const total = notListed.length + unsold.length + undelivered.length;
  const cfg = getAlertsConfig();

  // Summary cards — 4 mini cards on wider screens, wraps on narrow.
  const summary = $('#todoSummary');
  if (summary) {
    summary.innerHTML = `
      <div class="todo-summary-card total">
        <span class="todo-summary-label">CELKEM</span>
        <span class="todo-summary-value">${total}</span>
      </div>
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
  const { notListed, unsold, undelivered } = collectTodoItems();
  const total = notListed.length + unsold.length + undelivered.length;
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
  
  if (name === 'stats') renderStatsPage();
  if (name === 'memberships') renderMembershipsPage();
  if (name === 'expenses') renderExpensesPage();
  if (name === 'payouts') renderPayoutsPage();
  if (name === 'inbox') renderInboxPage();
  if (name === 'todo') renderTodoPage();
  // Refresh user list whenever Settings is opened so admins see latest state.
  if (name === 'settings') {
    renderUsersList();
    loadEmailSettingsUI();
    loadCurrencySettingsUI();
    loadMailForwardUI();
  }
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
  if (rule.baseDate === 'eventDate') baseDateStr = ticket.eventDate;
  else if (rule.baseDate === 'saleDate') baseDateStr = ticket.saleDate;
  else if (rule.baseDate === 'deliveryDate') {
    // If ticket is delivered, use delivery date (= when status became "delivered" → updated)
    // For simplicity, use saleDate + estimated delivery buffer (1 day)
    // If ticket has deliveryDate field, use it
    baseDateStr = ticket.deliveryDate || ticket.saleDate;
  }
  else baseDateStr = ticket.eventDate || ticket.saleDate;
  
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
  
  // p.amount is in each ticket's own currency. When summing, convert to the
  // primary currency so the header cards show consistent totals across mixed
  // currencies. Per-row amounts below stay in the ticket's own currency —
  // they're naturally scoped to one ticket.
  const toPrimary = (p, amt) => convertCurrency(Number(amt) || 0, ticketCurrency(p.ticket), getPrimaryCurrency());
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
    $('#payNext').innerHTML = `${escapeHtml(n.ticket.eventName || '—')} <span style="color:var(--text-tertiary); font-size:12px;">(${dayLabel}, ${formatMoney(n.amount, ticketCurrency(n.ticket))})</span>`;
  } else {
    $('#payNext').textContent = '—';
  }
  
  // Table
  const tbody = $('#payoutsBody');
  const empty = $('#pEmptyState');
  
  if (list.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
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
      const tc = ticketCurrency(t);
      const diffLabel = Math.abs(diff) < 0.01 ? '' : ` <span style="color:${diff >= 0 ? 'var(--green-bright)' : 'var(--red-bright)'}">(${diff >= 0 ? '+' : ''}${formatMoney(diff, tc)})</span>`;
      payoutStatusCell = `<span class="status-pill status-sold" title="Přijato ${formatDate(t.paidOutDate)} - ${formatMoney(paidAmount, tc)}">✓ Vyplaceno</span>${diffLabel}`;
      actionCell = `<button class="btn btn-dark btn-sm" data-p-action="unpaid" data-id="${t.id}" title="Vrátit zpět na čekání">↶ Vrátit</button>`;
    } else if (p.isOverdue) {
      payoutStatusCell = '<span class="status-pill status-cancelled">⚠ Po termínu</span>';
      actionCell = `<button class="btn btn-success btn-sm" data-p-action="paid" data-id="${t.id}">💰 Přišlo</button>`;
    } else if (p.expectedDate) {
      payoutStatusCell = '<span class="status-pill" style="background:rgba(167, 139, 250, 0.15);color:#c4b5fd;border:1px solid rgba(167, 139, 250, 0.35)">⏳ Čeká</span>';
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
        <td><strong>${escapeHtml(t.eventName || '—')}</strong></td>
        <td>${t.eventDate ? formatDate(t.eventDate) : '—'}</td>
        <td>${t.quantity || 1}</td>
        <td><strong>${formatMoney(p.amount, ticketCurrency(t))}</strong></td>
        <td>${escapeHtml(t.platform || '—')}${ruleInfo}</td>
        <td>${status}</td>
        <td>${p.expectedDate ? formatDate(p.expectedDate) : '—'}</td>
        <td>${p.isPaid ? '—' : `<span class="days-badge ${urgency.class}">${urgency.label}</span>`}</td>
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
      <span class="sell-info-value"><strong>${formatMoney(amount, ticketCurrency(ticket))}</strong>${expectedDate ? ` (${formatDate(expectedDate)})` : ''}</span>
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
    const sumOverdue = overdue.reduce((s, p) => s + convertCurrency(p.amount, ticketCurrency(p.ticket), primary), 0);
    toast(`💸 ${overdue.length} výplat po termínu (${formatMoney(sumOverdue, primary)}) - zkontroluj účet!`, 'error', 10000);
  }
  if (incoming.length > 0) {
    incoming.forEach(p => {
      const label = p.daysLeft === 0 ? 'DNES' : (p.daysLeft === 1 ? 'zítra' : `za ${p.daysLeft} dny`);
      toast(`💰 Výplata ${label}: ${p.ticket.eventName} (${formatMoney(p.amount, ticketCurrency(p.ticket))})`, 'info', 8000);
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
    });
  });
}

function renderInboxCard(item) {
  const p = item.parsed || {};
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
        <span class="inbox-platform-badge">${escapeHtml(p.platform)}</span>
        <span class="inbox-date">${received}</span>
      </div>
      <div class="inbox-title">${escapeHtml(p.event || '(bez názvu)')}</div>
      <div class="inbox-subject">${escapeHtml(item.subject || '')}</div>
      <div class="inbox-details-grid">
        <div class="inbox-detail">
          <span class="inbox-detail-label">Datum</span>
          <span class="inbox-detail-value">${p.eventDate ? formatDate(p.eventDate) : '—'}${p.eventTime ? ' ' + p.eventTime : ''}</span>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Místo</span>
          <span class="inbox-detail-value">${escapeHtml(p.venue || '—')}</span>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Sekce</span>
          <span class="inbox-detail-value">${escapeHtml(p.section || '—')}${p.row ? ', Row ' + escapeHtml(p.row) : ''}</span>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Ks</span>
          <span class="inbox-detail-value">${p.quantity || 1}</span>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">${isPurchase ? 'Cena' : 'Proceeds'}</span>
          <span class="inbox-detail-value price">${price.toFixed(2)} ${currency}</span>
        </div>
        <div class="inbox-detail">
          <span class="inbox-detail-label">Order ID</span>
          <span class="inbox-detail-value" style="font-family: var(--font-mono); font-size: 11px;">${escapeHtml(p.orderId || '—')}</span>
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
      <div class="inbox-actions">${actions}</div>
    </div>
  `;
}

// ============ INBOX ACTIONS ============
async function approveInboxItem(id) {
  const item = (state.db.inbox || []).find(i => i.id === id);
  if (!item || !item.parsed?.success) return;
  const p = item.parsed;
  
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

async function applyInboxSale(inboxId, ticketId) {
  const item = (state.db.inbox || []).find(i => i.id === inboxId);
  const ticket = (state.db.tickets || []).find(t => t.id === ticketId);
  if (!item || !ticket) return;
  const p = item.parsed;

  const platformLower = (p.platform || '').toLowerCase();
  const salePricePerKs = p.pricePerTicket || (p.totalAmount && p.quantity ? p.totalAmount / p.quantity : 0);

  // Build a short note about the gross-vs-net split so the user can see at a
  // glance how much StubHub's commission ate from the buyer's payment.
  let saleNote = '';
  if (p.grossSubtotal && p.totalAmount && p.grossSubtotal !== p.totalAmount) {
    const fee = p.grossSubtotal - p.totalAmount;
    const pct = ((fee / p.grossSubtotal) * 100).toFixed(1);
    saleNote = `Prodej z ${p.platform}: kupující zaplatil ${p.grossSubtotal}, tobě přišlo ${p.totalAmount} (provize ${fee}, ${pct}%)`;
  }

  const updated = {
    ...ticket,
    status: 'sold',
    salePrice: salePricePerKs,
    // Only overwrite currency if parser found one and ticket doesn't have a mismatched value.
    // In practice the sale email should be in the same currency as the purchase, so we
    // keep the original ticket currency as source-of-truth and trust the parsed amount.
    currency: ticket.currency || p.currency || getDefaultTicketCurrency(),
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
  const p = item.parsed;
  
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

  // Common options for vertical bar/line charts
  const baseOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false }  // most charts don't need legend (single series)
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
    plugins: {
      legend: { display: false },
      tooltip: {
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
    state.charts.cumulative = new Chart(canvas, {
      type: 'line',
      data: {
        labels: cumulData.map(d => d.x),
        datasets: [{
          label: `Zisk (${getPrimaryCurrency()})`,
          data: cumulData.map(d => d.y),
          borderColor: chartPurple,
          backgroundColor: chartFill,
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointBackgroundColor: chartPurple,
          pointBorderColor: chartPointBorder,
          pointBorderWidth: 1.5,
          pointHoverRadius: 6,
          borderWidth: 2
        }]
      },
      options: {
        ...baseOptions,
        plugins: {
          legend: { display: false },
          tooltip: {
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
    state.charts.top = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: topEvents.map(e => e[0].length > 28 ? e[0].substring(0, 28) + '…' : e[0]),
        datasets: [{
          label: `Profit (${getPrimaryCurrency()})`,
          data: topEvents.map(e => e[1]),
          backgroundColor: topEvents.map(e => e[1] >= 0 ? '#10b981' : '#ef4444'),
          borderRadius: 4,
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
    state.charts.roi = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: roiList.map(e => e[0].length > 24 ? e[0].substring(0, 24) + '…' : e[0]),
        datasets: [{
          label: 'ROI (%)',
          data: roiList.map(e => e[1]),
          backgroundColor: roiList.map(e => e[1] >= 0 ? '#10b981' : '#ef4444'),
          borderRadius: 4,
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
    state.charts.status = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: statusLabelsLocal,
        datasets: [{
          data: Object.values(statusData),
          backgroundColor: statusColors,
          borderColor: '#1a1a24',
          borderWidth: 2,
          hoverOffset: 8
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '60%',
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
      events[name].purchases.push(convertCurrency(Number(t.purchasePrice) || 0, tc, primary));
      events[name].sales.push(convertCurrency(Number(t.salePrice) || 0, tc, primary));
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
    purchasePrice: parseFloat($('#fPurchasePrice').value) || 0,
    salePrice: parseFloat($('#fSalePrice').value) || 0,
    currency: $('#fCurrency')?.value || getDefaultTicketCurrency(),
    logo: $('#fLogo').value.trim(),
    notes: $('#fNotes').value.trim(),
    externalIds: Object.keys(externalIds).length > 0 ? externalIds : undefined,
    // Buyer info (only saved if non-empty)
    buyerName: $('#fBuyerName').value.trim() || undefined,
    buyerEmail: $('#fBuyerEmail').value.trim() || undefined,
    buyerPhone: $('#fBuyerPhone').value.trim() || undefined,
    saleDate: $('#fSaleDate').value || undefined
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
    const totalCost = purchasePerKs * sellQty;
    const profit = totalRevenue - totalCost;
    const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
    const profitColor = profit >= 0 ? 'var(--green-bright)' : 'var(--red-bright)';

    // Preview stays in the ticket's native currency — we don't convert during
    // sale entry, since the user is typing in that currency.
    const tc = ticketCurrency(ticket);
    const primaryLine = state.sellPriceMode === 'total'
      ? `Za 1 ks: <strong>${formatMoney(pricePerKs, tc)}</strong> (${sellQty}× = ${formatMoney(totalRevenue, tc)})`
      : `Celkem prodej: <strong>${formatMoney(totalRevenue, tc)}</strong> (${sellQty}× ${formatMoney(pricePerKs, tc)})`;

    totalLine.innerHTML = `
      <div>${primaryLine}</div>
      <div>Profit: <strong style="color:${profitColor}">${formatMoney(profit, tc)}</strong> (ROI ${roi.toFixed(1)}%)</div>
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
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  
  $('#navSync').addEventListener('click', syncNow);
  $('#navExport').addEventListener('click', exportCsv);
  $('#navImport').addEventListener('click', importCsv);
  $('#navBackupExport').addEventListener('click', exportBackup);
  $('#navBackupImport').addEventListener('click', importBackup);
  $('#navSettings').addEventListener('click', () => switchView('settings'));
  
  // Add event
  $('#btnAddEvent').addEventListener('click', () => openTicketModal());
  
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
});
