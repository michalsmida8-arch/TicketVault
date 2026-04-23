# TicketVault 1.4.0 — 8 nových email parserů

Obrovský přírůstek do email parseru: appka teď rozpozná a automaticky zpracuje emaily z **8 dalších platforem**. Dříve parsery pokrývaly Viagogo, StubHub, Chelsea FC, Manchester City, Arsenal FC a Ticketmaster — teď je seznam o víc než dvojnásobek bohatší.

## Nové platformy

| Platforma | Země | Typ emailu | Podporované prvky |
|---|---|---|---|
| **Gigs and Tours** | UK | Order confirmation | event, order ID, datum, venue, block/row/seats, qty, cena/ks, celkem |
| **See Tickets** | UK | E-Ticket confirmation | event, order ID, datum, venue, block/row/seats, qty, cena/ks, celkem |
| **Entradas.com** | ES | Confirmación de compra | event, order ID, datum, recinto, sector/fila/asiento, qty, cena/ks, celkem |
| **MEO Blueticket** | PT | Confirmação de compra | event (full name), order ID, datum, balcão/sector/fila/cadeira, qty, cena/ks, celkem |
| **AXS** | UK | Order confirmation | event, order ID, datum, venue, block/row/seat range, qty, cena/ks, celkem |
| **Eventim** | DE/EU | Bestellbestätigung | event, order ID, datum, Ort, block/Reihe/Platz, qty, cena/ks, celkem |
| **TicketOne** | IT | Order confirmation | event, order ID, datum, venue, sector/block/row/seat, qty, cena/ks, celkem |
| **Ticketportal** | CZ | Potvrzení objednávky | event, var. symbol, datum, aréna, sektor/řada/místo, qty, cena/ks, celkem v Kč |

## Technické detaily

### Nové helpery v `inbox.js`
- **`parseMultiLocaleDate`** — podporuje české (`13. dubna 2026`), německé (`01.07.2026`), italské, španělské a portugalské měsíce
- **`parseEuropeanPrice`** — zvládá zápis `1 290,00 Kč`, `€ 82,00`, `644,28€`, `1,290.00` i `1.290,00`
- **Vylepšená extrakce forwardovaného subjectu** — Seznam forwardy často přelamují Předmět přes víc řádků, teď se řádky správně spojí

### Vylepšení existující logiky
- `detectPlatform` rozšířen o 8 nových domén (seetickets.com, gigsandtours.com, entradas.com, blueticket.meo.pt, boxoffice.axs.co.uk, ticketone.it, eventim.de, ticketportal.cz)
- `detectPlatformFromContent` (fallback pro Apple Mail forwardy bez hlavičky) rozšířen o content-based rules

### Frontend
- Platform dropdown v ticket modalu má nyní všech 11 platforem
- Žádné další UI změny — parser je zcela backend záležitost

## Deploy

Musíš nasadit **oba** ZIPy, protože parser žije v backendu, ale verze 1.4.0 frontendu ukazuje na aktualizovaný `publicUser` response (`mailToken` atd.) — tzn. backend by měl pokrývat minimálně 1.3.0 rozhraní.

### 1) Backend (Netlify)
Drag&drop `ticketvault-backend-1.4.0.zip` do Netlify dashboardu stejně jako minule. Všechny změny jsou v `netlify/functions/inbox.js` (api.js je identický s 1.3.0).

### 2) Frontend (GitHub)
```powershell
cd C:\Users\msmida\Desktop\ticketvault
# rozbal ticketvault-1.4.0-frontend.zip sem (přepsat soubory)
git add .
git commit -m "release 1.4.0 - 8 new email parsers"
git tag v1.4.0
git push && git push --tags
```

Za ~5 minut GitHub Actions zbuildí installer a auto-updater stáhne novou verzi stávajícím instalacím.

## Testování

Všech 8 parserů bylo otestováno na vzorových .eml souborech z reálných emailů. Všechny parsery správně extrahují event name, order ID, datum, venue, sedadla, quantity, cenu za ks i celkem. Dedupe seats pro emaily s HTML+plain (kde stejná data se objevují dvakrát).

Pokud by nějaký email neparseoval správně (nevíš které pole selhalo), pošli ho jako .eml a můžu dodat fix v 1.4.1.
