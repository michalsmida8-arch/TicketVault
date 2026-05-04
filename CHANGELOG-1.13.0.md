# TicketVault 1.13.0 — SalesPro + Zoom v marketplace webview

## ✨ Nové

### 1. 🟣 SalesPro Stubhub jako třetí marketplace

Přibyl třetí item v sekci MARKETPLACES:

- 🟠 **Stubhub** (stubhub.ie/my/sales) — seller portál
- 🔵 **Viagogo** (viagogo.com/secure/MySales/Sales) — seller portál
- 🟣 **SalesPro** (salespro.stubhub.ie) — broker portál

Stejný princip jako u ostatních: persistent login (`persist:salespro` partition), toolbar s back/forward/reload/home, ↗ otevření v prohlížeči.

> ⚠️ Quick-Add **není** v SalesPro (nedává smysl — broker dashboard nemá per-sale stránky).

### 2. 🔍 Zoom v marketplace webview

Funguje teď několika způsoby:

| Způsob | Co dělá |
|---|---|
| **Ctrl + kolečko myši** | Zoom in/out plynule |
| **Ctrl + +** / **Ctrl + =** | Zoom in po krocích 10 % |
| **Ctrl + −** | Zoom out po krocích 10 % |
| **Ctrl + 0** | Reset na 100 % |
| **Toolbar tlačítka − / 100% / +** | Klik = zoom in/out/reset, prostřední tlačítko ukazuje aktuální % |

Rozsah: **50 % — 200 %**. Zoom level se pamatuje **per marketplace** (Stubhub může být na 90 %, Viagogo na 110 % zároveň). Po reload stránky zoom **zůstává** zachovaný.

## 🔧 Technické detaily

### Proč zoom dřív nefungoval

Kolečko a klávesové zkratky uvnitř `<webview>` se **nedostanou ven** k host renderer procesu (jsou v separátním procesu). Standard Electron shortcut handler nezachytí ani Ctrl+/− ani Ctrl+kolečko jakmile fokus skočí do webview.

### Jak je to teď řešené

Vytvořil jsem **`src/webview-preload.js`** — tiny bridge který:
1. Běží **uvnitř** webview (před page scripty)
2. Zachytí Ctrl+wheel + zoom shortcuts
3. Forwarduje signály přes `ipcRenderer.sendToHost('zoom', ±1 | 'reset')`
4. Host renderer poslouchá `ipc-message` event na `<webview>` a volá `setZoomFactor()`

**Bezpečnost:** preload má jen `ipcRenderer.sendToHost` — žádný `fs`, `shell`, network. Ani kompromitovaná stránka přes preload nic neudělá.

### main.js update

`will-attach-webview` nyní povoluje **náš trusted preload** (`webview-preload.js`), jakýkoli jiný strip-uje. Takže to není security hole.

`webPreferences.sandbox: false` nastaveno — vyžadováno aby preload mohl `require('electron')`. Žádné jiné bezpečnostní opt-outy.

### Zoom restore po navigaci

Electron resetuje zoomFactor na 1.0 po každé navigaci. Listener `did-finish-load` v ensureMarketplaceLoaded re-aplikuje uložený zoom — uživatel ho po loadingu nemusí znovu nastavovat.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.13.0.zip sem (přepiš)
git add .
git commit -m "feat 1.13.0 - SalesPro + zoom in marketplace webview"
git tag v1.13.0 && git push && git push --tags
```

## 🧪 Test

1. **SalesPro:** klik nový item v sidebaru → musí se objevit `salespro.stubhub.ie` login (nebo dashboard pokud máš cookies)
2. **Zoom shortcuts:** klik Viagogo → My Sales → stiskni **Ctrl++** několikrát → stránka se zvětší, prostřední tlačítko v toolbaru ukazuje "120%"
3. **Ctrl + kolečko:** scroll přes Ctrl → plynulý zoom
4. **Ctrl+0:** reset na 100 %
5. **Per-marketplace zoom:** Stubhub na 80 %, přepni na Viagogo (musí být 100 %), zpět na Stubhub (musí být zase 80 %)
6. **Reload:** zoom Stubhub na 120 % → klik ⟳ Reload → zoom zůstane na 120 %
