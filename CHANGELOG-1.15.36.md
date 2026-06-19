# TicketVault 1.15.36 — Oprava: Premier League „Failed to fetch"

## 🐛 Bugfix

Sekce **Premier League** (z 1.15.35) hlásila „Nepodařilo se načíst rozlosy /
Failed to fetch" a nic nezobrazila.

### Proč

Aplikace má v `index.html` CSP `default-src 'self'` **bez `connect-src`**, takže
renderer smí síťově komunikovat jen sám se sebou — přímý `fetch()` na cizí
doménu je zablokovaný. V 1.15.35 PL sekce volala backend přímo z rendereru, což
CSP zaříznul. (Proto appka veškerý backend provoz vede přes `window.api.*` →
hlavní proces, který CSP nemá.)

### Oprava

Stahování i parsování rozlosů jsem přesunul do **hlavního procesu**:
- `main.js` má nový IPC handler `pl:fixtures`, který stáhne **oficiální eCal ICS
  feed přímo**, naparsuje ho (stejný parser jako na backendu) a **nacachuje do
  configu s 12h TTL** (auto-update; při výpadku vrátí poslední cache).
- `preload.js` přidává `window.api.fetchPLFixtures(force)`.
- Renderer (`app.js`) teď volá tenhle bridge místo přímého `fetch()`.

### Bonus: backend pro tuhle funkci už není potřeba

Protože ICS feed stahuje přímo desktopová appka, **funkce `/pl-fixtures` na
Netlify (backend 1.4.11) už není pro Premier League sekci potřeba** — odpadá tím
i nejistota, jestli je správně nasazená. Backend 1.4.11 můžeš klidně nechat být
(neškodí), nebo ignorovat. Feed jde přepsat přes `config.plIcsUrl`.

## ⚠️ Nasazení

Změna je v **hlavním procesu** Electronu → vyžaduje rebuild/přeinstalaci appky
(reload okna nestačí). Tvoje CI ji postaví na tag push jako obvykle.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.36.zip sem (přepiš)
git add .
git commit -m "fix 1.15.36 - PL fixtures fetch via main process (CSP blocked renderer fetch)"
git tag v1.15.36 && git push && git push --tags
```

## 🧪 Test

1. Po instalaci 1.15.36 otevři v menu **Premier League**.
2. Měl by naběhnout seznam zápasů po kolech (Kolo 1, 2, 3…).
3. Filtr týmů (Arsenal + Liverpool), filtr kola, hledání, 🔄 Aktualizovat.
4. Když by se feed nenačetl, ukáže se konkrétní chyba (např. „HTTP 404") místo
   vágního „Failed to fetch" — pošli mi ji, kdyby něco.
