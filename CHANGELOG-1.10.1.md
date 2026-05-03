# TicketVault 1.10.1 — Multi-select & "🎯 Vybrané" chip + sticky bulk bar

## ✨ Co nového proti 1.10.0

### 🎯 Nový chip „Vybrané (N)" v hlavičce Dashboardu + Statistik

Vedle Vše / Koncerty / Fotbal / Jiné se objeví **🎯 Vybrané (3)** ihned jak naklikáš první řádek v tabulce. Klik na chip:

- **Stat karty nahoře** (Profit, Utraceno, Obrat, Prodáno, Zbývá) se přepočítají **jen na vybrané řádky**
- **Tabulka** pofiltruje na vybrané
- Stejně funguje na Statistikách — všechny KPI a grafy se zobrazí jen pro vybranou podmnožinu

Chip zmizí když odznačíš všechno; pokud byl při tom aktivní, filter sám spadne zpátky na _Vše_ (jinak by tě nechal koukat na prázdný dashboard).

### 📌 Sticky bulk bar

Bar dole (s počtem, souhrnem a tlačítky Hromadná editace / Smazat) je teď **sticky** — drží se u spodního okraje viewportu. Předtím byl pod tabulkou a u dlouhých seznamů jsi ho neviděl bez scrollu (proto jsi mi včera psal "nic se neděje" 😅).

## ⚙️ Jak to celé funguje dohromady

```
1. Naklikáš 3 řádky checkboxem
   ↓
2. Vidíš 2 věci najednou:
   • TOP:    chip "🎯 Vybrané (3)" — totaly v EUR (Profit, Utraceno, Obrat...)
   • BOTTOM: sticky bar — Nákup/Prodej/Zisk/ROI + tlačítka Edit/Delete
   ↓
3a. Chceš jen vidět summary → klik chip → karty se přepočítají
3b. Chceš editovat → klik "Hromadná editace" v sticky baru
3c. Chceš smazat → klik "Smazat vybrané"
```

## 🔧 Vše co bylo v 1.10.0 zůstává

- Multi-select + bulk edit modal pro Vstupenky a Výplaty
- Bulk označit přijaté pro Výplaty
- Cloud-safe upsert (full ticket merge před odesláním)
- Mixed-currency přepočet na primární měnu

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
# rozbal TicketVault-1.10.1.zip sem (přepiš)

git add .
git commit -m "release 1.10.1 - selected chip + sticky bulk bar"
git tag v1.10.1
git push && git push --tags
```
