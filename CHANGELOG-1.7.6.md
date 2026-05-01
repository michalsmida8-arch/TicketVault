# TicketVault 1.7.6 — Currency display fix

**Datum:** 2026-04-30

## 🐛 Co bylo špatně

V Plánu výplat (a několika dalších místech) se u lístků s **různou měnou nákupu vs. prodeje** zobrazoval špatný měnový symbol.

Příklad: lístek koupený přes Fifa za USD, prodaný přes Viagogo za EUR. `salePrice = 1318.50` (EUR), ale UI ho ukazovalo jako `$1,318.50` — protože `formatMoney()` dostával `ticketCurrency()` (= měna nákupu, USD) místo `saleCurrency()` (= měna prodeje, EUR).

## ✅ Opraveno na 9 místech

### Plán výplat (`renderPayoutsPage`)
1. **Stat karty nahoře** — `Čeká`, `Vyplaceno`, `Po termínu` se teď spočítají správně i u mixed-currency tiketů
2. **Nejbližší výplata** — částka v EUR ne v USD
3. **Hlavní řádek tabulky** ← **viditelný bug ze screenshotu**
4. **Sloupec "Stav výplaty"** — částka v badge tooltipu i rozdíl `(+5 €)` / `(−2 €)`
5. **Modal "Přišlo"** — info o očekávané částce

### Toasty při startu
6. **Sumární toast po termínu** (`💸 X výplat po termínu (XYZ €)`)
7. **Per-payout toast pro nadcházející výplaty** (`💰 Výplata zítra: ...`)

### Hlavní tabulka K dořešení
8. **Tooltip sloupce "Prodej"** — `Cena za 1 ks` a `Původní cena` v hover

### Statistiky
9. **Graf "Nákup vs Prodej"** — sloupec "Prodej" se konvertoval ze špatné měny

## 🔍 Root cause

Helper `saleCurrency(t)` existuje od verze 1.6.4 (`t.saleCurrency || ticketCurrency(t)`), ale na některých místech se i potom dál používal `ticketCurrency(t)` pro zobrazení/agregaci **prodejních** částek. Tyto fixy sjednocují použití.

## ✅ Co se NEMĚNILO (a proč)

Tato místa správně používají `ticketCurrency(t)`:
- `calcProfit` / `calcProfitInPrimary` — profit se počítá v měně **nákupu** (sale se nejdřív přepočte do purchase ccy a pak odečte cost)
- `calcCostInPrimary` — cost je v měně nákupu
- Sloupec "Nákup" v hlavní tabulce + tooltip — zobrazuje nákupní cenu
- Modal "Prodat" → "Nákup / ks" — zobrazuje co stálo
- Inbox match: nabídka existujících lístků k označení — ukazuje purchase price

## 🧪 Jak otestovat

1. Najdi lístek koupený v jedné měně, prodaný ve druhé (např. nákup Fifa USD → prodej Viagogo EUR)
2. Otevři **Plán výplat** → měna v sloupci **Prodej** musí být měna prodeje (€), ne nákupu ($)
3. Hover na sloupec **Prodej** v hlavní **K dořešení** tabulce → tooltip `Cena za 1 ks` musí mít správnou měnu
4. **Statistiky** → graf **Průměr nákup vs. prodej** → sloupec "Prodej" musí ukazovat reálné EUR hodnoty (ne nesmyslně přepočtené)
