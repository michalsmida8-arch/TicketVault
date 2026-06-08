# TicketVault 1.15.34 — Filtr statusů: výběr více najednou

## ✨ Co je nové

Filtr **Status** v Ticket Inventory byl jednovýběrový (jen jeden stav, nebo
„Všechny statusy"). Teď je to **multi-select s checkboxy** — můžeš si zobrazit
libovolnou kombinaci stavů najednou, např. *Koupeno + Zalistováno* (vše, co máš
na skladě), nebo *Prodáno + Doručeno*.

- Klik na filtr otevře rozbalovací panel s odškrtávátky: Koupeno, Zalistováno,
  Prodáno, Doručeno, Zrušeno.
- Tlačítko ukazuje, co je vybráno: „Všechny statusy" (nic = vše), název stavu
  (1 vybraný), nebo „Vybráno: N" (více vybraných).
- Tabulka se filtruje okamžitě při každém zaškrtnutí.
- Výběr se ukládá do preferencí a přežije restart appky.
- **Reset** i „Všechny statusy" = prázdný výběr = zobrazí se vše.

## Jak to funguje technicky

- `state.filters.status` byl `string`, teď je **pole** kódů stavů (`[]` = vše).
- Zpětná kompatibilita: uložené staré preference (status jako string) se při
  načtení automaticky převedou na pole (`normalizeStatusFilter()`), takže o nic
  nepřijdeš.
- Filtr v `getFilteredTickets()` nově testuje příslušnost do množiny:
  `statusSel.includes(t.status)`.
- `<select>` nahrazen vlastním dropdownem (`#filterStatusPanel`) s checkboxy ve
  stejném vizuálním stylu jako ostatní filtry; zavírá se kliknutím mimo / Esc.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.34.zip sem (přepiš)
git add .
git commit -m "feat 1.15.34 - multi-select status filter in inventory"
git tag v1.15.34 && git push && git push --tags
```

## 🧪 Test

1. Ticket Inventory → klikni na filtr **Status** → otevře se panel s checkboxy.
2. Zaškrtni **Koupeno** i **Zalistováno** → tabulka ukáže jen tyto dva stavy,
   tlačítko hlásí „Vybráno: 2".
3. Odškrtni vše → tlačítko „Všechny statusy", zobrazí se všechny řádky.
4. Vyber jeden stav → tlačítko ukáže jeho název (např. „Prodáno").
5. Restartuj appku → tvůj výběr zůstane zachovaný.
6. **× Reset** → filtr se vyprázdní (zobrazí se vše).
