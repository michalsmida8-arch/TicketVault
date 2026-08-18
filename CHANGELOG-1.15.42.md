# TicketVault 1.15.42 — Přidání zápasu z PDF (sken faktury)

## ✨ Nová funkce
V Ticket Inventory je nové tlačítko **📄 Přidat z PDF**. Vybereš PDF fakturu /
vstupenku, appka z ní vytáhne detaily a **předvyplní formulář pro přidání
vstupenky** — jen zkontroluješ a uložíš.

Zatím podporováno: **faktury RB Leipzig** (formát z rbleipzig.com). Vytáhne:
- zápas (RB Leipzig v soupeř), datum a čas výkopu
- blok, řadu, sedačky, počet
- cenu za kus, celkovou cenu, měnu (EUR)
- číslo objednávky (do poznámky)

Chytře řeší i „slepenou" tabulku v PDF (přes kontrolu total = počet × cena).

## 🔧 Technicky
- Přidána závislost **pdf-parse** (čistě JS, žádné nativní moduly). Čtení PDF a
  parsing běží v hlavním procesu (knihovna se načítá až při importu, takže
  nemůže ovlivnit start appky).
- Nový IPC `pdf:import` (dialog na výběr PDF → text → parser → předvyplnění).

## ⚠️ Nasazení
- Je to změna hlavního procesu **+ nová npm závislost**. Do repa se musí dostat
  **package.json i package-lock.json** (obojí se změnilo), jinak CI (`npm ci`)
  selže. Po tagu CI nainstaluje pdf-parse a přibalí ho do buildu. Pak appku
  **přeinstaluj**.

## 🚀 Release
```bash
cd ~/Desktop/ticketvault
git pull --rebase
# rozbal obsah TicketVault-1.15.42.zip sem (přepiš) — VČETNĚ package-lock.json
git add .
git status   # ověř: main.js, preload.js, src/*, package.json, package-lock.json
git commit -m "feat 1.15.42 - import ticket from PDF invoice (RB Leipzig)"
git tag v1.15.42 && git push && git push --tags
```

## 🧪 Test
1. Inventory → **📄 Přidat z PDF** → vyber RB Leipzig fakturu.
2. Otevře se formulář předvyplněný (zápas, datum, blok/řada/sedačky, cena…).
3. Zkontroluj a ulož.

## Další formáty
Zatím jen RB Leipzig. Další (jiné kluby / obecné faktury) se přidají stejným
způsobem — pošli vzorové PDF.
