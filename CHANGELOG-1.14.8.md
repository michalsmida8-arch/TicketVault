# TicketVault 1.14.8 — Quick-Add: scraper crash fix

## 🐛 Co bylo špatně

Klik **⚡ Přidat do TicketVault** vyhodil:

```
Selhalo čtení stránky: Error invoking remote method 'GUEST_VIEW_MANAGER_CALL':
Error: Script failed to execute, this normally means an error was thrown.
Check the renderer console for the error.
```

V picker se nedošlo — celý scraper crashnul před spuštěním.

## Příčina (decentní bug)

Scraper kód je uložený jako **template literal** (backtick string):

```js
const MARKETPLACE_SCRAPER_SCRIPT = `
  // ... velký kus JS kódu pro běh ve webview ...
`;
```

V 1.14.6 jsem do toho komentářem přidal popis:

```js
// So "Section 20G\n2 Tickets" in DOM becomes "Section 20G2 Tickets" in
```

ALE — v template literalu `\n` **není escape sekvence v komentáři**, je to **reálný newline**! JS tedy ten template literal evalovalo a dostalo:

```
// So "Section 20G
2 Tickets" in DOM becomes "Section 20G2 Tickets" in
```

Druhý řádek (`2 Tickets" in DOM ...`) **už není komentář** — JS interpreter to bral jako kód, kde `Tickets` je nedefinovaný identifier. **Syntax error → script vůbec nespustil.**

## ✅ Oprava

Přepsal jsem ten komentář:

```js
// So "Section 20G" + "2 Tickets" in DOM becomes "Section 20G2 Tickets"
```

Nyní žádný `\n` v komentáři uvnitř template literalu, žádný falešný newline, žádný crash.

Plus opraveno několik dalších míst kde jsem měl 4 backslashes místo 2 (špatný escape level):

- Section/Row/qty fallback regexy

Plus pro pojistku jsem přidal kompilační test do build process — teď ověřuju že scraper script je validní JS před každým buildem.

## Co by mělo fungovat po updatu

- Klik **⚡ Přidat do TicketVault** v Stubhub / Viagogo / SalesPro toolbaru → otevře se item picker
- Per-element extrakce sekce/řady/qty pro Viagogo (z 1.14.6) — teď opravdu funguje
- SalesPro split event/venue (z 1.14.4)
- Currency-agnostic ceny (z 1.14.2/.3)

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.8.zip sem (přepiš)
git add .
git commit -m "fix 1.14.8 - scraper template literal newline bug"
git tag v1.14.8 && git push && git push --tags
```

## 🧪 Test

1. Klik **Viagogo** v sidebaru → My Sales
2. Klik **⚡ Přidat do TicketVault**
3. **NESMÍ** vyhodit error — musí se otevřít picker s 5 sales
4. Picker by měl ukázat:
   - Metallica · 19.05.2026 · Slaski Stadium · **Sekce 20G** · **2 ks** · 536.20 EUR ✓
   - Metallica · 19.05.2026 · Slaski Stadium · **Sekce 15D** · **3 ks** · 1054.80 EUR ✓
   - Bad Bunny · 26.05.2026 · ... · **Sekce Piso Tres 07** / **řada C** · **2 ks** · 312.92 EUR ✓
   - Bad Bunny · 10.06.2026 · ... · **Sekce 425** / **řada 132** · **2 ks** · 386.76 EUR ✓
   - Bad Bunny · 10.06.2026 · ... · **Sekce 425** / **řada 132** · **2 ks** · 386.76 EUR ✓
5. Klik na řádek → match picker → najdi v DB → klikni → updatne se na sold

Pokud scraper něco mine, screenshot pošli. 🎯
