# TicketVault 1.15.33 — Oprava přepočtu RSD (srbský dinár) na EUR

## 🐛 Bugfix

Vstupenky z **Tickets.rs** (srbská platforma) se v inventáři zobrazovaly s
nesmyslnou částkou — např. **52 316,16 €** místo reálných **~446 €**. Cena byla
správně v RSD (srbský dinár), ale aplikace ji nepřevedla na EUR a jen na dinárové
číslo plácla symbol €.

### Proč se to dělo

V kódu byly **dva seznamy měn, které se rozešly**:

- `src/app.js` → `CURRENCIES` obsahuje **21 měn včetně RSD** (RSD se sem přidala
  kvůli Tickets.rs parseru, ať jde dinár aspoň zobrazit a vybrat).
- `main.js` → `SUPPORTED_CURRENCY_CODES` obsahoval jen **20 měn a RSD chyběla**.

Kurzy se z `open.er-api.com` filtrují právě přes `SUPPORTED_CURRENCY_CODES`, takže
kurz pro RSD (který API běžně vrací) se po stažení **zahodil** a do
`config.exchangeRates` se nikdy neuložil. Funkce `convertCurrency()` má fail-open
logiku `if (!fromRate || !toRate) return amount` — když kurz nenajde, vrátí
původní (nepřevedenou) částku. Výsledek: dinár prošel beze změny a UI na něj dalo €.

### Oprava

Do `SUPPORTED_CURRENCY_CODES` v `main.js` byla doplněna `'RSD'`, takže oba seznamy
měn teď sedí (21 = 21) a kurz dináru se z API stáhne a uloží. Backend ani email
parser se nemění — chyba byla čistě v tom, že se renderer a main proces rozešly
v seznamu sledovaných měn.

Přidaný komentář u seznamu nově upozorňuje, že musí zůstat v souladu s polem
`CURRENCIES` v `src/app.js`, aby tahle třída chyb znovu nevznikla.

## ⚠️ Důležité po nasazení

Tohle je změna v **main procesu** Electronu → vyžaduje rebuild/přeinstalaci appky
(reload okna nestačí). A protože uložené kurzy v `config.exchangeRates` jsou
nacachované, RSD v nich nebude, dokud neproběhne nový fetch:

➡️ Po update klikni v **Nastavení → Měny** na **„Aktualizovat kurzy"**.
   Toast má hlásit **21 měn** (dřív 20). Pak se ten Tickets.rs řádek přepočítá
   správně (52 316,16 RSD → ~446 €, ~74 €/ks při kurzu ~117 RSD/€).

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.33.zip sem (přepiš)
git add .
git commit -m "fix 1.15.33 - RSD currency conversion (sync main.js currency list with app.js)"
git tag v1.15.33 && git push && git push --tags
```

## 🧪 Test

1. Otevři **Nastavení → Měny** → klikni **Aktualizovat kurzy** → toast = „21 měn".
2. V tabulce kurzů ověř, že přibyl řádek **RSD ≈ 117** (dín za 1 €).
3. Jdi do **Inventáře** na ten řádek **UFC Fight Night Belgrade (Tickets.rs, 6 ks)**.
4. Místo `52 316,16 €` má být **~446 €** celkem a **~74 €/ks**.
5. Zkontroluj i Dashboard/Statistiky — souhrnné částky se posunou o reálnou hodnotu
   toho lístku (předtím byly nafouknuté o ~52 tisíc €).
