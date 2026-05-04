# TicketVault 1.14.7 — Bulk action bar vždycky vidět

## 🐛 Co bylo špatně

Když jsi měl okno **menší než fullscreen** a vybral jsi ticket(y) checkboxem, **pole "HROMADNÁ EDITACE"** dole se neukázalo — bylo schované za fold okna a uživatel by musel scrolovat dolů aby ho viděl.

`position: sticky` se v menším okně chovalo jako "stick-on-scroll": dokud byl uživatel na vrchu tabulky, bar byl pod tabulkou (mimo viewport).

## ✅ Oprava

Bulk bar je teď **`position: fixed`** — ukotvený na spodní okraj **viewport**, vždycky vidět:

```css
.bulk-actions {
  position: fixed;
  bottom: 16px;
  left: 240px;   /* za sidebarem (220px + 20px breathing room) */
  right: 20px;
  z-index: 30;
}
```

Plus aby bar nepřekrýval poslední řádek tabulky když scrolluješ dolů, **`.main`** dostane `padding-bottom: 90px` v okamžiku kdy je bar viditelný:

```css
body.bulk-bar-visible .main {
  padding-bottom: 90px;
}
```

JS sleduje **všech 6 bulk barů** v aplikaci (Tickets, Expenses, Payouts, Memberships, MembershipBookings, SimCards) přes MutationObserver a toggluje `body.bulk-bar-visible` automaticky když cokoliv z nich přibude/zmizí.

## Behaviorální změny

- **Bar je teď VŽDY vidět** dole na obrazovce, jakmile vybereš ticket
- Funguje **bez ohledu na výšku okna** (i v půl obrazovce)
- Když scrolluješ tabulku, bar zůstává ukotvený na spodu viewport
- Po odznačení všech řádků bar zmizí + body class se odebere

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.7.zip sem (přepiš)
git add .
git commit -m "fix 1.14.7 - bulk action bar position: fixed (always visible)"
git tag v1.14.7 && git push && git push --tags
```

## 🧪 Test

1. **Půl-obrazovkový mode** (ne fullscreen)
2. Klik checkbox u libovolného ticketu
3. Bar **HROMADNÁ EDITACE** se musí objevit dole na obrazovce
4. Test ve všech 6 sekcích: Tickets, Expenses (Výdaje), Payouts (Výplaty), Memberships, MembershipBookings, SimCards
5. Po odznačení všech bar zmizí
