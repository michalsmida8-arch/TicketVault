# TicketVault 1.13.1 — Fix Zobrazení menu (zoom hlavní app)

## 🐛 Bugfix

**Menu Zobrazení → Přiblížit / Oddálit / Reset zoom přestalo fungovat.**

### Příčina

Electron `role: 'zoomIn'` / `'zoomOut'` / `'resetZoom'` pracují s **focused webContents**. Když jsi byl na marketplace view (Stubhub/Viagogo), focus přešel do embedded `<webview>`. Když jsi pak přepnul zpátky na Dashboard a klikl Zobrazení → Přiblížit, focus tracking nemusel správně zachytit přechod a zoom se aplikoval na špatný proces (nebo nikam).

### Oprava

Nahradil jsem `role: 'zoomIn'` atd. **explicitními handlery** které vždycky volají zoom na `mainWindow.webContents`:

```js
{
  label: 'Přiblížit',
  accelerator: 'CmdOrCtrl+=',
  click: () => mainWindow.webContents.setZoomLevel(... + 0.5)
}
```

Žádné spoléhání na focus tracking. Marketplace webviews mají vlastní zoom v toolbaru (z 1.13.0), takže si nezavazí.

### Klávesové zkratky

| Zkratka | Co dělá |
|---|---|
| **Ctrl + =** (= je s Shiftem +) | Přiblížit hlavní app |
| **Ctrl + −** | Oddálit hlavní app |
| **Ctrl + 0** | Reset hlavní app na 100 % |

V marketplace webview funguje **Ctrl + kolečko**, **Ctrl + + / − / 0** (přes preload bridge z 1.13.0) — pro zoom uvnitř té stránky.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.13.1.zip sem (přepiš)
git add .
git commit -m "fix 1.13.1 - menu Zobrazení zoom now targets main window explicitly"
git tag v1.13.1 && git push && git push --tags
```

## 🧪 Test

1. Na Dashboardu → menu **Zobrazení → Přiblížit** → UI se zvětší
2. Klik **Viagogo** v sidebaru → UI hlavní app zůstává zoomnuté, webview má vlastní zoom
3. Klik zpátky **Dashboard** → menu **Zobrazení → Reset zoom** → vrátí se na 100 %
4. **Ctrl+=** přímo v Dashboard → zoom +
5. **Ctrl+−** → zoom −

Marketplace zoom funguje **nezávisle** — Stubhub může být na 120 %, hlavní app na 90 %, Viagogo na 100 %.
