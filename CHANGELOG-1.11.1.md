# TicketVault 1.11.1 — Fix marketplace view + Stubhub.ie

## 🐛 Bugfixy

### 1. Webview se nezobrazoval celý

V 1.11.0 byl horní toolbar viditelný, ale samotný webview byl prázdný (jen pruh nahoře). Příčiny:

- `<webview>` má v Electronu default `display: inline-flex` — neroztáhne se na 100% výšky rodiče
- `.marketplace-view` používala negativní marginy + `height: 100vh` v scrollovaném containeru → matematika nesedla
- Sloupcový flex container neměl `min-height: 0` → webview wrap se nesmrskl

**Oprava:**
- `.marketplace-view.active` je teď `position: absolute; inset: 0` přes celý `.main` (čisté pokrytí, žádné magické marginy)
- `<webview>` má `display: flex !important` aby zaokrouhlil 100% výšky
- `.mkt-webview-wrap` má `min-height: 0` (standardní flex shrink fix)

### 2. Stubhub.com → Stubhub.ie

Tvůj seller účet je na irské doméně. Změnili:
- Webview src z `stubhub.com/secure/account/manage-listings` → `stubhub.ie/my/sales`
- "Domů" tlačítko taky míří na .ie
- ↗ Otevřít v prohlížeči = .ie
- Sidebar item `↗` ext button = .ie

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.11.1.zip sem (přepiš)

git add .
git commit -m "fix 1.11.1 - marketplace view sizing + stubhub.ie"
git tag v1.11.1
git push && git push --tags
```

## 🧪 Co po nasazení

1. Klik **Stubhub** v sidebaru → musí se objevit **celý** Stubhub.ie login (ne jen pruh nahoře)
2. Klik **Viagogo** → totéž
3. Toolbar buttons fungují, URL bar zobrazuje aktuální stránku
