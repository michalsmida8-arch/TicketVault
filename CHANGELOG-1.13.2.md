# TicketVault 1.13.2 — Quick-Add z přehledu (My Sales / My Listings)

## 🐛 Co bylo špatně

V 1.12.1 jsem ⚡ tlačítko připravil tak, aby fungovalo na **detail page** jednoho sale/listing. Když jsi ho ale stiskl na **přehledu My Sales** kde je 4× sale vedle sebe (Metallica 13 011, Metallica 25 595, Bad Bunny 7 578, Bad Bunny 9 385), scraper:

- vzal celý `document.body.textContent`
- našel jen první match na `Sale No.` regex
- sečetl ceny → vyšlo nesmyslné číslo
- jeden řádek se předvyplnil jako "Metallica 13 011 € + 25 595 € + 7 578 €"

To je bug. Workflow měl být: **klik ⚡ → vyber který sale → match picker**.

## ✅ Oprava

Scraper nyní detekuje **víceřádkové stránky** a vrátí pole položek místo jedné. Workflow:

```
Klik ⚡ na Viagogo My Sales (4 sales na stránce)
    ↓
Scraper najde 4 distinct Sale No. → multiple=true
    ↓
Picker: "Vyber kterou položku importovat (4 nalezeno)"
   • Metallica · 19.05 · Sec 20G · 13011 EUR
   • Metallica · 19.05 · Sec 15D · 25595 EUR
   • Bad Bunny · 26.05 · Sec PT07 · 7578 EUR
   • Bad Bunny · 10.06 · Sec 425 · 9385 EUR
    ↓
Klikneš jeden →
    ↓
Match picker: hledá tickety v DB se shodným eventem
    ↓
Vybereš → ticket se updatne
```

Ten samý flow pak pro Listings overview, Stubhub My Sales atd.

## 🔧 Jak to detekuje "víceřádkovou stránku"

1. Najde všechny matche `Sale No. NNNNNN` / `Listing No. NNNNNN` / `Order #NNNNNN` na stránce
2. Pokud je **>1 unikátních ID**, je to overview list page
3. Pro každé ID vyšplhá DOMem z text node nahoru, dokud nenajde "card-like" container (má heading + ceny + datum)
4. Ze stejného containeru extrahuje event name, datum, sekci, qty, cenu (vybere **největší** cenu na kartě = "Total price")

Pokud je jen 1 ID, pokračuje původním whole-page scraperem (jako 1.12.1).

## 🧪 Test

1. Klik **Viagogo** v sidebaru → My Sales (4 sales viditelné)
2. Klik ⚡ Přidat do TicketVault
3. Picker ukáže 4 položky
4. Klikni Metallica 20G → match picker hledá v DB → vybereš ticket → updatne se na sold

Pokud klikneš ⚡ na konkrétním "Show details" page (1 sale), funguje stejně jako v 1.12.1 — rovnou match picker.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.13.2.zip sem (přepiš)
git add .
git commit -m "fix 1.13.2 - quick-add multi-item picker for overview pages"
git tag v1.13.2 && git push && git push --tags
```

## ⚠️ Ladění může být potřeba

Detekce kartiček je založená na DOM heuristice (heading + price + date v containeru). Pokud Viagogo na nějaké stránce dělá divné HTML, může:
- vynechat položku (pak vidíš "3 nalezeno" místo 4)
- vzít špatnou cenu (per-ticket místo total)
- nezachytit datum

Pokud něco takového uvidíš, pošli screenshot pickeru + screenshot Viagogo stránky, doladíme regex/selectory.
