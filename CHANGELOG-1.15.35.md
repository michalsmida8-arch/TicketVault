# TicketVault 1.15.35 — Premier League kalendář (sezóna 2026/27)

## ✨ Co je nové

Nová sekce **Premier League** v levém menu (skupina FOTBAL). Zobrazí kompletní
rozlosy sezóny 2026/27 z **oficiálního** kalendáře Premier League (eCal feed),
seskupené **po kolech**.

- **Filtr týmů** (multi-select s checkboxy) — vyber jeden nebo víc týmů a vidíš
  jen jejich zápasy (doma i venku). Tlačítko hlásí „Všechny týmy" / název týmu /
  „Vybráno: N".
- **Filtr kola** a **hledání** podle týmu nebo stadionu.
- Každý zápas: datum + čas (v tvém čase), domácí–hosté, stadion.
- **🔄 Aktualizovat** stáhne čerstvá data; jinak se používá serverová cache
  (auto-refresh po ~12 h), takže přesuny zápasů / TV časy se samy promítnou.

## Jak to funguje

- **Backend** (verze 1.4.11): nová Netlify funkce `pl-fixtures` stáhne oficiální
  ICS kalendář, naparsuje VEVENTy (datum/čas, „Domácí v Hosté", stadion),
  odvodí čísla kol a **nacachuje do Netlify Blobs** (~12 h TTL). Když zdroj
  selže, vrátí poslední cache. Vyžaduje nasazení backendu **1.4.11**.
- **Frontend** tahá hotová data z `…netlify.app/pl-fixtures`, drží je v paměti
  a renderuje seznam po kolech. Filtrování i seskupení běží lokálně.
- Zdroj feedu lze přepnout přes env `PL_ICS_URL` na backendu (default = oficiální
  „All fixtures" feed).

## ⚠️ Potřeba nasadit i backend

Tahle funkce závisí na backendu **1.4.11** (`ticketvault-backend-1.4.11-pl-fixtures`).
Nasaď ho na Netlify dřív / spolu s tímto frontendem, jinak sekce ukáže
„Nepodařilo se načíst rozlosy".

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.35.zip sem (přepiš)
git add .
git commit -m "feat 1.15.35 - Premier League fixtures calendar (2026/27) with team filter"
git tag v1.15.35 && git push && git push --tags
```

## 🧪 Test

1. Nasaď backend 1.4.11 na Netlify, otevři `…netlify.app/pl-fixtures` v prohlížeči
   → má vrátit JSON s polem `fixtures` (380 zápasů).
2. V appce klikni v menu na **Premier League** → naběhne seznam po kolech.
3. Otevři filtr týmů, zaškrtni např. **Arsenal + Liverpool** → jen jejich zápasy.
4. Vyber **Kolo 1** → jen úvodní kolo. Napiš do hledání stadion → filtruje.
5. Klikni **🔄 Aktualizovat** → přetáhne čerstvá data (`?refresh=1`).
