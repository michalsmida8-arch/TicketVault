# TicketVault 1.14.2 — Quick-Add: currency-agnostic + multi-locale

## 🐛 Co bylo špatně

Když jsi přepnul Viagogo měnu na EUR, item picker přestal zobrazovat:
- 📅 Datum (`—` všude)
- 💰 Cenu (`—` všude)
- Sekci / qty (`?` všude)

### Příčiny

1. **Cena** — Viagogo s EUR formátem píše `€236.40` nebo `236.40 €` (po čísle). Stará regex hledala jen "currency PŘED číslem" + pokoušela odstraňovat čárky bez ohledu na to, jestli jsou decimal nebo thousand separator.

2. **Datum** — Viagogo s EUR layoutem nemá vždycky `Tue, 19 May 2026` (s rokem) — v některých variantách rok chybí. Stará logika fallbackovala na current year jen pokud byl pattern `Měsíc, rok` přímo. Teď bere rok odkudkoliv z karty (nebo current year).

3. **Sekce/qty** — anglické labels `Section`/`Row`/`Tickets` byly OK, ale Viagogo s českým jazykem píše `Sekce`/`řada`/`vstupenek` → regex nezachytil.

## ✅ Opravy

### 1. Currency-agnostic price parsing

```js
// Pattern A: SYMBOL/CODE then number — €236.40, Kč13011.29
// Pattern B: number then SYMBOL/CODE — 236.40 €, 1500.00 EUR
```

Dvě nezávislé regexy, výsledky se sloučí, vyhrává největší (= total price, ne per-ticket).

Decimal/thousand separator detekce:
```
"1,234.56"  → 1234.56  (US format: . is decimal)
"1.234,56"  → 1234.56  (EU format: , is decimal)
"236,40"    → 236.40   (comma decimal, < 1000)
"1,234"     → 1234     (no decimal — thousand sep)
```

Podporované měny: **EUR, USD, GBP, CZK, PLN, CHF** + symboly `€ $ £ Kč`.

### 2. Datum napříč 4 formáty

```
ISO          2026-05-19
dd.mm.yyyy   19.05.2026  (CZ/SK)
dd-mm-yyyy   17-06-2026  (SalesPro)
"19 May"     → najdu rok kdekoliv v kartě, fallback current year
```

### 3. Bilingual labels

```
Section / Sekce
Row     / řada
Tickets / vstupenek / vstupenky / ks
```

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.2.zip sem (přepiš)
git add .
git commit -m "fix 1.14.2 - currency-agnostic + multi-locale Quick-Add"
git tag v1.14.2 && git push && git push --tags
```

## 🧪 Test

1. **Viagogo s EUR měnou** — klik ⚡ na My Sales → picker musí ukázat:
   - 📅 datum (např. 19.05.2026)
   - 💰 cenu (€236.40 → 236.40 EUR)
   - 🎫 sekci (Section nebo Sekce)
2. **Viagogo s CZK měnou** — vrátit zpět na CZK a ⚡ → musí pořád fungovat (Kč13011.29)
3. **SalesPro** — ⚡ → musí fungovat se všemi měnami v list view (USD, GBP, EUR, PLN)

Pokud něco bude pořád prázdné, **otevři DevTools v Electron menu → Vývojářské nástroje** (Ctrl+Shift+I), pravoklik na jednu kartu na Viagogo → Inspect → screenshot toho HTML stromu vlevo. Doladím selektory přesně. 🎯
