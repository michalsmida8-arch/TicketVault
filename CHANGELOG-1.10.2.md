# TicketVault 1.10.2 — Fix payout pravidel "po doručení"

## 🐛 Bugfix

**Pravidla "po doručení +X dní" se aktivovala už po prodeji.**

Příklad: Stubhub má pravidlo `po doručení +3 dny`. Měl jsi ticket West Ham v Arsenal — **prodaný ale nedoručený**, prodej 09.05.2026 → app ukazovala "výplata 12.05.2026, zbývá 3 dny" jako kdyby už byl doručený.

### Co se opravilo

`calculatePayoutDate()` v `src/app.js`:
- **Předtím:** když pravidlo říkalo `deliveryDate` a ticket neměl `deliveryDate` field, fallbackoval na `saleDate`. To znamenalo: u jakéhokoliv prodaného ticketu (i nedoručeného) se výplata začala odpočítávat od data prodeje.
- **Teď:** pravidlo `po doručení` se aktivuje **až když ticket má `status === 'delivered'`**. Pokud ne, `expectedDate` je `null` a sloupce ZBÝVÁ + STAV VÝPLATY se chovají odpovídajícím způsobem.

### Nový stav: 📦 Čeká na doručení

V STAV VÝPLATY uvidíš nový žlutý badge **"📦 Čeká na doručení"** u prodaných-ale-nedoručených ticketů s pravidlem typu `po doručení`. Předtím by tam svítilo "⏳ Čeká" (nesprávně) nebo "⚠ Po termínu" (úplně mimo).

| Stav | Kdy | Barva |
|---|---|---|
| ⏳ Čeká | Doručeno + před expected date | fialová |
| ⚠ Po termínu | Doručeno + po expected date | červená |
| 📦 Čeká na doručení | **Prodáno ale ne doručeno** + pravidlo "po doručení" | žlutá |
| ✓ Vyplaceno | Označeno jako přijaté | zelená |
| ? Neznámé pravidlo | Žádné pravidlo pro platformu | šedá |

### Datum základu výplaty

Když ticket OZNAČÍŠ jako doručený (`markDelivered`), zapíše se `deliveredAt` (timestamp). Tahle hodnota se teď používá jako základ pro výpočet expected date u pravidel `deliveryDate`. Pokud máš starší ticket bez `deliveredAt` (před zavedením pole), fallbackuje na `saleDate` — jeden ticket sem nebo tam to neporouchá.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
# rozbal TicketVault-1.10.2.zip sem (přepiš)

git add .
git commit -m "fix 1.10.2 - payout 'after delivery' rules now require status=delivered"
git tag v1.10.2
git push && git push --tags
```

## 🧪 Test scénář

1. Otevři Výplaty → najdi West Ham v Arsenal (prodán, ne doručen)
2. STAV VÝPLATY musí být **📦 Čeká na doručení** (žlutý)
3. ZBÝVÁ a VÝPLATA OČEKÁVÁNA musí být `—`
4. Klikni Doručeno na ticketu → vrať se na Výplaty → expected date by se měl objevit (3 dny od dnešního dne)
