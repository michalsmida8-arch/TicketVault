# TicketVault 1.11.2 — Skutečný fix marketplace layoutu

## 🐛 Bugfix

V 1.11.1 webview pořád zaujímal jen ~150px nahoře. Po debugu jsem zjistil **3 příčiny** (předchozí pokus jednu chyběl):

### 1. CSS specificita

`.view.active { display: block }` má specificitu (0,1,1) a v cascade je **níže** než `.marketplace-view.active { display: flex }` (0,1,1). Stejná specificita → vyhrává pozdější deklarace = `display: block`.

Fix: chained selektor `.view.marketplace-view.active` (specificita 0,2,1) přepíše původní + `display: flex !important`.

### 2. fadeIn animace s transformem

`.view.active` má `animation: fadeIn` které používá `transform: translateY(4px → 0)`. **Transform na ancestoru webview rozbije GPU layer** — webview se vykreslí jen do té části kde rodič byl PŘED transformem. To vysvětluje proč ses díval na "useknutý" webview po prvním otevření.

Fix: `animation: none !important; transform: none !important` na marketplace-view.

### 3. `.main` padding + overflow

`.main` má `padding: 28px 36px` a `overflow-y: auto`. Když je dítě `position: absolute; inset: 0`, **inset počítá od padding boxu**, ne od border boxu — takže zbývalo `28px` mezery nahoře/dole. A `overflow-y` na rodiči absolutně-pozicovaného dítěte občas dělá problémy s kompozičním layoutem.

Fix: CSS `:has(.marketplace-view.active)` selektor + JS fallback (body class) — když je marketplace aktivní, `.main` dostane `padding: 0; overflow: hidden`.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.11.2.zip sem (přepiš)
git add .
git commit -m "fix 1.11.2 - marketplace layout (CSS specificity + transform + main padding)"
git tag v1.11.2 && git push && git push --tags
```

## 🧪 Test

1. Klik **Viagogo** v sidebaru → musí se objevit **celá** stránka, ne jen pruh nahoře
2. Klik **Stubhub** → totéž
3. Klik **Dashboard** → návrat k normálnímu layoutu, padding zase tam
4. Pingpong několikrát mezi marketplace a Dashboard — nesmí nic zaseknout
