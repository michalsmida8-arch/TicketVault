# TicketVault 1.14.3 — Quick-fix: price >999 + American date format

## 🐛 Bugfixy

### 1. Cena přes 999 byla useknutá

V tvém screenshotu picker ukazoval **105.00 EUR** místo **1054.80 EUR** pro Metallica 15D. Příčina:

```
Stará regex:  \d{1,3} ... → match jen prvních 3 číslic
Nová regex:   \d+ → match libovolný počet číslic
```

Plus přepsal jsem normalizaci čísla — robustnější detekce decimal vs thousand separator:

```
Strategy: pohled na POSLEDNÍ separator (. nebo ,)
  - Pokud následují 1-2 číslice → decimal separator
  - Pokud následují 3 číslice → thousand separator (číslo bez decimal)
```

Test cases které teď dávají správný výsledek:

| Vstup | Výstup |
|---|---|
| `€536.20` | 536.20 EUR ✓ |
| `€1054.80` | **1054.80 EUR** ✓ (předtím 105.00) |
| `Kč13011.29` | 13011.29 CZK ✓ |
| `1,234.56` | 1234.56 (US) ✓ |
| `1.234,56` | 1234.56 (EU) ✓ |
| `1 234.56 EUR` | 1234.56 EUR ✓ |

### 2. Datum "May 19" (US formát) — nyní podporováno

Stará regex hledala `19 May` (UK/EU). Viagogo s některými lokálemi píše `May 19`. Teď zkusí oba.

## ⚠️ Co stále chybí — datum 📅 a qty `? ks`

V tvém screenshotu je v pickeru u všech 5 řádků:
- 📅 **prázdné** (žádné datum)
- ? ks (žádná quantity)

To znamená že Viagogo s EUR layoutem **má v kartě jiný formát data** než kódy regex znají, a žádný `\\d Tickets` pattern.

Bez vidění reálného HTML to ladím poslepu — proto **prosím pošli outerHTML jedné karty**:

### Postup
1. Klik **Viagogo** v sidebaru
2. Menu **Zobrazení → Vývojářské nástroje** (nebo Ctrl+Shift+I)
3. V **Console** záložce napiš a stiskni Enter:
   ```
   document.getElementById('webview-viagogo').openDevTools()
   ```
4. Otevře se druhé DevTools okno (specifické pro Viagogo)
5. V druhém okně klikni ikonku **šipky** (Inspect) → klikni v Viagogo na bílou kartu jednoho prodeje (např. Metallica €536.20)
6. V Elements panelu pravoklik na zvýrazněný `<div>` → **Copy → Copy outerHTML**
7. Pasti to sem (i jako příloha v souboru `.html`)

Z toho udělám deterministické selektory typu `.querySelector('[data-testid="sale-card"]')` místo fragilních regexů.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.3.zip sem (přepiš)
git add .
git commit -m "fix 1.14.3 - price regex (4+ digits) + American date format"
git tag v1.14.3 && git push && git push --tags
```

## 🧪 Test

1. **Viagogo s EUR**: klik ⚡ na My Sales → picker by měl ukázat:
   - Metallica · 536.20 EUR ✓ (už správně)
   - Metallica · **1054.80 EUR** ← **TO JE TEN FIX** (předtím 105.00)
   - Bad Bunny · 312.92 EUR ✓
   - atd.
2. **Datum** může být pořád `—` — to čeká na HTML. Pošli outerHTML jedné karty pak doladím.
