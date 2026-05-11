# TicketVault 1.15.5 — Auto-refresh všech detail views

## 🐛 Co bylo špatně

Když jsi v **Plán výplat** klikl **💰 Označit přijaté** (hromadně), state se updatnul ale **tabulka se nepřerenderovala** — musel jsi z Výplat odejít a zase se vrátit, aby ses uvidět změny.

Stejný bug se mohl projevit i v dalších detail views (Výdaje, Příchozí, Memberships, Emailové schránky, SIM karty) — kdykoliv byla použita bulk operace nebo refreshDb().

## Příčina

Globální `render()` funkce volala jen 3 detail-view rendery:
- ✅ Stats
- ✅ Tickets
- ✅ Todo (K dořešení)
- ❌ Payouts (Výplaty)
- ❌ Expenses (Výdaje)  
- ❌ Inbox (Příchozí)
- ❌ Memberships
- ❌ Mailboxes (Emailové schránky)
- ❌ Simcards (SIM karty)

Hromadné akce volaly `refreshDb()` → `render()` který updatoval globální stat-cards na vrchu, ale **ne aktuální stránku** kde uživatel je.

Single-item akce (klik **Přišlo** u jednoho řádku) měly v sobě `renderPayoutsPage()` natvrdo, takže fungovaly OK. Jen bulk byl zlomený.

## ✅ Oprava

Rozšířil jsem `render()` aby auto-rerenderoval **kteroukoliv** detail stránku která je právě aktivní:

```js
if ($('#view-stats')?.classList.contains('active'))     renderStatsPage();
if ($('#view-todo')?.classList.contains('active'))      renderTodoPage();
if ($('#view-payouts')?.classList.contains('active'))   renderPayoutsPage();      // ← NOVÉ
if ($('#view-expenses')?.classList.contains('active'))  renderExpensesPage?.();   // ← NOVÉ
if ($('#view-inbox')?.classList.contains('active'))     renderInboxPage?.();      // ← NOVÉ
if ($('#view-memberships')?.classList.contains('active')) renderMembershipsPage?.();// ← NOVÉ
if ($('#view-mailboxes')?.classList.contains('active')) renderMailboxesPage?.();  // ← NOVÉ
if ($('#view-simcards')?.classList.contains('active'))  renderSimcardsPage?.();   // ← NOVÉ
```

Optional chaining `?.()` zajistí že kdyby v budoucnu některá funkce dočasně chyběla (refactor), aplikace nespadne.

## Co teď funguje líp

- **Plán výplat** → vybereš výplaty → **💰 Označit přijaté** → tabulka se aktualizuje **OKAMŽITĚ** (žádné odcházení/vracení)
- **Výdaje** → bulk označení → okamžitý refresh
- **Příchozí** → bulk akce → okamžitý refresh
- **Memberships / Emaily / SIM karty** → cokoliv bulk → okamžitý refresh
- Cloud sync nebo Auto-update DB → všechny aktivní pohledy se osvěží automaticky

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.5.zip sem (přepiš)
git add .
git commit -m "fix 1.15.5 - auto-refresh all active detail views after DB mutation"
git tag v1.15.5 && git push && git push --tags
```

## 🧪 Test

1. Plán výplat → vyber 2-3 výplaty checkboxy
2. Klik **💰 Označit přijaté** → potvrdit
3. Tabulka se musí **okamžitě** updatovat (stav výplaty `Přišlo` v zelené barvě, počítadla na vrchu)
4. Nemusíš nikam přepínat. ✓
