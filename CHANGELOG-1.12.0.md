# TicketVault 1.12.0 — ⚡ Quick-Add z marketplaces

## ✨ Nová funkce

V toolbaru Stubhub a Viagogo přibylo tlačítko **⚡ Přidat do TicketVault**.

### Workflow

```
1. Klikni Viagogo v sidebaru
2. Najdi sale/listing/event stránku (přihlášený jsi automaticky)
3. Klik ⚡ Přidat do TicketVault
4. Otevře se Add Ticket modal s předvyplněnými poli:
   ✓ Název eventu
   ✓ Datum eventu
   ✓ Venue + země
   ✓ Sekce + řada
   ✓ Quantity
   ✓ Cena (přepočtena per ks)
   ✓ Měna (z páge — EUR/USD/GBP/CZK)
   ✓ Status (sold pro sale page, listed pro listing page)
   ✓ Platform (Stubhub / Viagogo)
   ✓ External IDs (Sale No., Listing ID — pro budoucí API sync)
   ✓ Datum prodeje (pro sale page = dnes)
   ✓ Poznámka "Importováno z … dne …"
5. Zkontroluješ + Uložit
```

Toaster ti řekne kolik z 6 hlavních polí se podařilo vyplnit (typicky 4–6/6 podle stránky).

## 🔧 Jak to funguje technicky

Tlačítko spustí JS uvnitř webview přes `executeJavaScript()` — kód běží v té samé session jako bys byl běžně na Viagogo. **Bot detekce neexistuje, jsme uvnitř.**

Scraper čte data ze tří zdrojů (od nejspolehlivějšího):
1. **JSON-LD `application/ld+json`** — SEO microdata, oba sites mají
2. **URL pattern** — detekce typu stránky (sale / listing / event)
3. **DOM regex** — section/row/qty/price text patterns

URL pattern detekce nastavuje status správně:
- `/viagogo.com/.*/sale` → status `sold`, saleDate = dnes
- `/viagogo.com/.*/listing` → status `listed`
- `/...event...` → status `available` (default)

## 📦 External IDs

Pokud stránka obsahuje "Sale No. 631553584" nebo "Listing ID 12345678", uloží se do `externalIds.viagogoOrderId` / `viagogoListingId`. **Tohle bude klíčové až dostaneme API access** — můžeme reconcilovat manuální záznamy se sales co přijdou z API.

## ⚠️ Limitace

### 1. Křehkost
Pokud Viagogo redesignuje sale page (pošlou jiné HTML třídy, jiné pojmenování polí), scraper se začne nebýt přesný. **Známé selektory:**
- `Sale No. \\d+` — Viagogo
- `Order #\\d+` — Stubhub
- `Section [A-Z0-9]+` — oba
- `Row [A-Z0-9]+` — oba
- `\\d+ Tickets` — quantity
- `Total price [currency] [amount]` — cena

Když se některý zlomí, řekni mi a doladíme regex.

### 2. SPA navigace
Viagogo a Stubhub jsou single-page apps. Když scrolluješ přes několik sales na jedné URL, scraper čte **aktuálně otevřenou kartu** (tu kterou klikneš). Pokud máš na obrazovce 3 sales a klikneš ⚡, vezme se ten první — proto **klikni "Show details" na konkrétním sale** než zmáčkneš ⚡, ať jsi na detail page.

### 3. Total price interpretation
Některé Viagogo stránky ukazují "Total price" ve dvou variantách (with/without fees). Kód bere první match — pokud nesedí, ručně oprav.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.12.0.zip sem (přepiš)
git add .
git commit -m "feat 1.12.0 - quick-add from marketplaces (DOM scrape via executeJavaScript)"
git tag v1.12.0 && git push && git push --tags
```

## 🧪 Test

1. Klik **Viagogo** v sidebaru → My Sales
2. Klik na **Show details** u konkrétního sale (Metallica)
3. Klik **⚡ Přidat do TicketVault** v toolbaru
4. Měl by se otevřít Dashboard + modal s vyplněným:
   - Název: Metallica
   - Datum: 2026-05-19
   - Venue: Slaski Stadium, Chorzów
   - Sekce: 20G
   - Quantity: 2
   - Cena: 6 505.65 Kč (13011.29 ÷ 2)
   - Status: Prodáno
   - Platforma: Viagogo
5. Doplň co chybí (Account, nákupní cenu) → Uložit

Když něco extrahuje špatně, pošli screenshot toho co bylo na stránce + screenshot vyplněného modalu, doladíme. 🎯
