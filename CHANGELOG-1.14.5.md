# TicketVault 1.14.5 — Viagogo default URL = my.viagogo.com/sales

## ✨ Změna

Viagogo se teď otevírá rovnou na **`my.viagogo.com/sales`** — tj. tvojí Sales stránce, ne na hlavní Viagogo homepage. Šetří klik.

Změny:
- Webview `src` startovní URL
- Tlačítko 🏠 Domů
- ↗ Prohlížeč v toolbaru
- ↗ ikonka v sidebaru
- URL bar default text

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.5.zip sem (přepiš)
git add .
git commit -m "feat 1.14.5 - Viagogo default URL = my.viagogo.com/sales"
git tag v1.14.5 && git push && git push --tags
```

⚠️ **Restart appky vyžadován** aby se webview načetlo s novou URL. (Pokud webview byl už načtený, klikni 🏠 Domů.)
