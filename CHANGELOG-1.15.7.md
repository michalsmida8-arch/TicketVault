# TicketVault 1.15.7 — Inbox: auto-fill + editable fields + advanced modal

## ✨ Co je nové

Když parser nezvládne email (typicky **Ticketmaster ES/IT/DE**, forwardované emaily, nebo nové vendory), inbox karta měla všechno prázdné `—` a nedalo se to opravit. Teď:

### 1. 🎯 Auto-fill ze subjectu

Před zobrazením karty se subject prožene **fallback parserem** který vytáhne:
- **Event name** — Spanish (`Confirmacion de compra para X`), English (`Your tickets for X`), German (`Ihre Bestellung für X`), Czech (`Vaše objednávka pro X`), French, Italian
- **Order ID / Reference** — `número de referencia`, `Order #`, `Booking ref`, atd.
- **Platforma** — Ticketmaster, Stubhub, Viagogo, Eventim, Live Nation, AXS, See Tickets

Pro tvůj **Bad Bunny email** se po update zobrazí:

```
🛒 NÁKUP  ·  Ticketmaster  ·  11. 5. 2026 20:12:33

Bad Bunny - DeBÍ TiRAR MáS FOToS World Tour
Fwd: Confirmacion de compra para Bad Bunny - DeBÍ TiRAR MáS FOToS World Tour, número de referencia 011377758

Datum      Místo      Sekce      Ks    Cena    Order ID
[YYYY-MM-DD] [...]    [...]      [1]   [...]   011377758
```

Tj. **event a order ID se vyplní automaticky**, zbytek je editovatelný.

### 2. ✏️ Editovatelné fields přímo v inbox card

Každé pole (datum, místo, sekce, ks, cena, měna, order ID) je teď **input s placeholder**. Klikneš, zadáš, **změna se uloží automaticky na blur**. Žádné `Save` tlačítko — uloží se průběžně.

- **Event name nahoře** — contenteditable (klik = piš jako v poznámkovém bloku, Enter potvrdí)
- **Měna** — dropdown s nejčastějšími (EUR, USD, GBP, CZK, PLN, CHF, ...)
- **Vše ostatní** — text/number input

Pokud zase otevřeš inbox, tvoje editovy zůstanou (uloženo jako `parsedOverrides` v DB).

### 3. 🔧 Pokročilá úprava (modal)

Vedle `✓ Přidat do inventáře` přibyl button **🔧 Pokročilá úprava**. Otevře modal s **všemi parseable fields** rozdělenými do sekcí:

- **Event** — název, datum, čas, místo
- **Vstupenky** — sekce, řada, sedadlo, počet ks
- **Cena / Platforma** — cena celkem, cena/ks, měna, platforma, order ID
- **Kupující** — jméno a email (jen pro prodeje)

Užitečné když máš víc fields k doplnění nebo chceš strukturovaný pohled.

## Jak to funguje technicky

1. **enrichParsedFromSubject(parsed, subject)** — non-destructive merge. Doplní jen prázdná pole, originální server parsing nepřemaže.
2. **`item.parsedOverrides`** — nový field v inbox item, který drží uživatelské editace. Uloží se přes `db:updateInboxItem` IPC.
3. **Approve flow** — `approveInboxItem`, `applyInboxSale`, `createTicketFromInboxAsSold` všechny teď čtou `{ ...serverParsed, ...enrichment, ...overrides }` — overrides mají nejvyšší prioritu.

Cloud sync funguje normálně (parsedOverrides je součást DB).

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.7.zip sem (přepiš)
git add .
git commit -m "feat 1.15.7 - inbox auto-fill + editable fields + advanced modal"
git tag v1.15.7 && git push && git push --tags
```

## 🧪 Test

1. Otevři **Příchozí** → najdi Bad Bunny email
2. Event name **už nebude (bez názvu)** — vyplní se z subjectu
3. Order ID **už nebude `—`** — vyplní se `011377758`
4. Klikni do pole **Datum** → napíš `2026-06-07` → tab → uloží se
5. Klikni do **Místo** → `Estadio Riyadh Air Metropolitano`
6. **Sekce** → `Gold Circle`, **Ks** → `2`, **Cena** → `326.60`, **Měna** → `EUR`
7. Klik **✓ Přidat do inventáře** → ticket je v Inventory se všemi údaji

Nebo:

1. Klik **🔧 Pokročilá úprava** → modal se všemi fields → vyplň co potřebuješ → **Uložit změny**
2. Pak **✓ Přidat do inventáře**

Pokud subject u jiného emailu nematchuje žádný pattern, dej vědět konkrétní subject a přidám regex pro něj.
