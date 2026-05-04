# TicketVault 1.11.0 — Stubhub & Viagogo uvnitř aplikace 🌐

## ✨ Nové marketplaces v sidebaru

V levé navigaci pod sekcí **MARKETPLACES** přibyly dva nové itemy:

- 🟠 **Stubhub** — otevře Stubhub seller portál (Manage Listings) přímo v aplikaci
- 🔵 **Viagogo** — otevře Viagogo Sales přímo v aplikaci

Klik na sidebar item = embed verze. Klik na malou šipku **↗** vpravo na hover = otevře v systémovém prohlížeči.

## 🛠️ Mini browser bar

Každý marketplace má vlastní toolbar:

| Tlačítko | Co dělá |
|---|---|
| ← → | Zpět/vpřed v historii (auto-disabled když není kam) |
| ⟳ | Reload aktuální stránky |
| 🏠 | Domů (Manage Listings / My Sales) |
| URL bar | Aktuální adresa (read-only, lze označit a zkopírovat) |
| ↗ Prohlížeč | Otevřít aktuální URL v systémovém prohlížeči |

## 🔐 Persistent session

Cookies + login data se ukládají v separátním partition (`persist:stubhub`, `persist:viagogo`) — **přihlásíš se jednou a appka si tě pamatuje** napříč restarty. Stejně jako v normálním prohlížeči.

SSO přes Google/Facebook funguje (popup okna se otevírají correctly v rámci Electronu).

## 🔒 Bezpečnost

- Webviews běží v sandboxed režimu, oddělený proces
- `nodeIntegration: false`, `contextIsolation: true`
- Externí odkazy ("terms", "help" apod.) se otevírají v systémovém prohlížeči, ne uvnitř webview
- IPC handler `shell:openExternal` whitelistuje pouze `https?://` URL

## 💡 Co to znamená v praxi

```
Workflow před 1.11.0:
1. TicketVault — zkontroluj prodaný West Ham
2. Otevři Chrome
3. Přihlaš se na Stubhub
4. Najdi listing
5. Updatuj cenu
6. Vrať se do TicketVault

Workflow v 1.11.0:
1. TicketVault — zkontroluj prodaný West Ham
2. Klik "Stubhub" v sidebaru → už jsi přihlášen
3. Updatuj cenu
4. Klik "Dashboard" v sidebaru → zpět doma
```

Žádné Alt+Tab, žádné Cmd+Tab, žádné druhé okno prohlížeče.

## ⚠️ Co NENÍ (zatím)

- ❌ **Auto-sync dat z marketplaces zpět do TicketVault** — to vyžaduje API access (požádali jsme paralelně, viz README). Webview je zatím pouze "vidět/používat", nevidí dovnitř DOMu pro skraping.
- ❌ Multi-account přepínač (na Stubhubu jsi přihlášen vždy jako jeden user). Pokud potřebuješ víc účtů, použij ↗ pro otevření v prohlížeči s incognitem.

## 🔧 Technické detaily (pro tebe)

- `webviewTag: true` zapnut v hlavním BrowserWindow webPreferences
- `will-attach-webview` strip preload + force sandbox (paranoid hardening)
- `did-attach-webview` setWindowOpenHandler — popup routing pro SSO vs externí odkazy
- Lazy loading: webview se nenačte dokud nepřepneš na sekci (úspora paměti za běhu)
- User-agent overridenut na desktop Chrome (Stubhub občas blokuje "Electron" UA)

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.11.0.zip sem (přepiš)

git add .
git commit -m "release 1.11.0 - embedded Stubhub & Viagogo marketplaces"
git tag v1.11.0
git push && git push --tags
```

## 🧪 Test scénář

1. Spusť app → klik **Stubhub** v sidebaru
2. Měl bys vidět login screen Stubhubu (nebo dashboard pokud máš cookie)
3. Přihlas se → měl bys přistát na Manage Listings
4. Klikni **Dashboard** v sidebaru, pak zpět **Stubhub** → měl bys být pořád přihlášen
5. **Zavři appku úplně, znovu spusť** → klik **Stubhub** → pořád přihlášen ✓
6. Klikni ↗ Prohlížeč v toolbaru → otevře aktuální URL v Chrome/Edge
7. Zopakuj pro Viagogo

Pokud něco nepůjde (login redirect smyčka, popup zablokován apod.), pošli screenshot. 🎯
