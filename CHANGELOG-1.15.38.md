# TicketVault 1.15.38 — Sledované akce (watchlist + prodej + upozornění)

## ✨ Nová funkce: Sledované akce

Vyber si z rozlosu zápasy, které chceš koupit, a hlídej si, kdy jdou do prodeje.

### Jak to funguje
- V sekci **Premier League** má každý zápas **hvězdičku ☆**. Kliknutím se přidá
  mezi sledované (★).
- Nová sekce **„Sledované akce"** (menu, skupina FOTBAL) ukazuje **jen vybrané
  zápasy**. U každého si zapíšeš:
  - **Datum + čas, kdy jde do prodeje**
  - volitelnou **poznámku** (např. „členská předprodej")
- Seznam je seřazený podle data prodeje (nejbližší nahoře), u každého je odznak
  „dnes! / zítra / za N dní / v prodeji".

### Upozornění (2 kanály)
1. **V aplikaci**:
   - **Odznak** u „Sledované akce" = počet zápasů, které jdou do prodeje
     **dnes nebo do 3 dnů**.
   - **Toast při startu** appky, když něco jde **dnes** do prodeje.
2. **V emailovém souhrnu** (digest): nová sekce **„🎟️ Jde do prodeje"** se
   zápasy, kterým prodej začíná **v následujících 7 dnech**. Vyžaduje backend
   **1.4.12** (viz níže).

## 🔧 Technicky
- Sledované zápasy se ukládají do `db.watchedMatches` → perzistují lokálně a
  **synchronizují na cloud** (nový IPC `db:saveWatched` → push celého DB), takže
  k nim má přístup i serverový digest.
- Digest na backendu (1.4.12) čte `db.watchedMatches` a přidává on-sale sekci do
  HTML i textové verze emailu.

## ⚠️ Nasazení — POTŘEBA OBOJÍ
1. **Backend 1.4.12** (`ticketvault-backend-1.4.12-watched-onsale`) na Netlify —
   kvůli on-sale sekci v emailovém souhrnu.
2. **Frontend 1.15.38** — změna i v `main.js`/`preload.js` (hlavní proces) →
   po tagu nech CI postavit build a appku **přeinstaluj**.

## 🚀 Release (frontend)
```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.38.zip sem (přepiš)
git add .
git commit -m "feat 1.15.38 - Sledovane akce (watchlist + on-sale date + in-app & email notifications)"
git tag v1.15.38 && git push && git push --tags
```

## 🧪 Test
1. Nasaď backend 1.4.12 + nainstaluj frontend 1.15.38.
2. Premier League → u zápasu klikni ☆ → toast „Přidáno", hvězdička ★.
3. Otevři **Sledované akce** → zápas je tam. Nastav „jde do prodeje" na dnešní
   datum → objeví se odznak „dnes!" a v menu se rozsvítí počítadlo.
4. Restartuj appku → toast „🎟️ Dnes jde do prodeje: …".
5. Email: Nastavení → otestovat souhrn (nebo počkej na denní digest) → sekce
   „Jde do prodeje" se zápasy v okně 7 dnů.
6. Sledované se synchronizují i na druhé zařízení (cloud).
