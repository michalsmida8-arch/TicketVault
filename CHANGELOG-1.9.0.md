# TicketVault 1.9.0 — Kategorie vstupenek (Fotbal / Koncerty / Jiné)

Dashboard a Statistiky lze nyní filtrovat podle kategorie — odděleně sleduješ profit z fotbalu vs koncertů.

## ✨ Nové funkce

### Kategorie u každé vstupenky
- Nový dropdown **Kategorie** v Add/Edit modalu: ⚽ Fotbal / 🎵 Koncert / 🎫 Jiné
- Při přidávání nové vstupenky se kategorie předvyplní podle aktuálně zvolené v Dashboardu
  (např. když koukáš na Koncerty a klikneš +Přidat, dropdown je hned na Koncert)

### Přepínač Vše / Fotbal / Koncerty / Jiné
- Nahoře v **Dashboardu** i **Statistikách** chip přepínač
- **Synchronizovaný** — klikneš "Koncerty" v Dashboardu a Statistiky ukazují koncerty taky
- Filtruje **5 stat karet, tabulku vstupenek, KPI insights, grafy** — všechno v daném view
- Výběr se uloží mezi restarty (UI prefs v localStorage)

### Migrace existujících dat
- Všechny stávající vstupenky dostanou kategorii **'concert'** (per dohoda)
- Fotbalové vstupenky můžeš přepnout ručně přes Edit modal

## 🎨 Vizuální

- Aktivní chip má barevný akcent: zelená (Fotbal), oranžová (Koncerty), šedá (Jiné), fialová (Vše)
- Odpovídá to existující barvě hero karet a celkovému dark + purple theme

## 🔧 Technické

- Nové pole `category` na ticket objektu: `'football' | 'concert' | 'other'`
- Migrace v `loadDb()`: legacy tickets bez `category` → `'concert'`
- Nová funkce `syncCategoryToggleUI()` synchronizuje active chip mezi oběma toggly
- Filtr v `getFilteredTickets()`, `renderStats()`, `getStatsFilteredTickets()`
- Cloud sync: kategorie se posílá s ostatními poli, žádné nové IPC

## 📋 Co rozhodně **NENÍ** filtrované podle kategorie
- Memberships, Mailboxes, SIM karty, Inbox, Výdaje, Výplaty — záměrně sdílené
- "K dořešení" todo — záměrně sdílené (vidíš všechny urgentní věci najednou)
