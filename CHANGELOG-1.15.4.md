# TicketVault 1.15.4 — Po termínu eventu = červený řádek

## ✨ Co je nové

Tickety s **eventem v minulosti** které ještě nejsou uzavřené (`Zalistováno`, `Koupeno`, `Prodáno`-ale-ne-doručeno) se teď zvýrazňují **červeně** na 3 místech:

### 1. Ticket Inventory — celý řádek červený

```
🔴 Manchester City v Brentford   2026-05-09   Etihad Stadium   ⌜GB⌟ Spojené...   314, 5
   [NEPRODÁNO · event byl před 1 dnem 🔕]                     Zalistováno
```

- **Levý červený proužek** + **červené pozadí** řádku (silnější tint než upcoming events)
- **Pulsující červený dot** + chip s textem `NEPRODÁNO · event byl před X dny`
- **Animace pulsu** (volitelná) přitahuje oko

### 2. K dořešení (sidebar tab) — vlastní sekce nahoře

Nová sekce **"Po termínu eventu"** je vždy **úplně nahoře** v K dořešení:

```
┌─ Po termínu eventu ─────────────────────────────────────  [1] ─┐
│ 1   Manchester City v Brentford                                 │
│ DNÍ 2026-05-09 · Etihad Stadium · Sekce 314 · 2 ks · Stubhub    │
│ ZPĚT                                  [Vyřešit] [Edit] [🔕]     │
└─────────────────────────────────────────────────────────────────┘
```

Plus **červená summary card "PO TERMÍNU"** vedle ostatních (CELKEM / PO TERMÍNU / K ZALISTOVÁNÍ / PRODAT / DORUČIT).

### 3. Sidebar badge na K dořešení

Počítadlo zahrnuje i past events, takže sidebar řekne kolik položek celkem potřebuje pozornost.

## Logika past events

Ticket je `past-event` když:
- `eventDate` < dnes **A**
- `status` ≠ `delivered` **A**
- `status` ≠ `refunded`

Tj. tickety v `available` / `listed` / `sold` (ale ještě ne doručené) → past-event.

**Doručené tickety zůstávají bez alertu** (jsou hotové, event je jen historie).
**Refundované taky** (peníze vrácené, žádná akce nepotřebná).

## Action buttons v K dořešení

- Pokud je status `sold` (prodáno ale nedoručeno) → **`✓ Doručit`**
- Jinak (zalistováno / koupeno) → **`Vyřešit`** (otevře Edit)

## Tabulka — nové třídy

- `.row-past-event` — červený řádek (silnější než `.row-urgent-deliver`)
- `.urgent-chip-past` — solid red chip s bílým textem (vs. lighter tinted chip pro upcoming)

## Co opraví

Tvůj **Manchester City v Brentford** (event 9. května, dnes 10. května, status Zalistováno) byl předtím vidět **stejně jako ostatní tickety** — žádný indikátor že event už proběhl. Teď okamžitě uvidíš že potřebuje akci.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.4.zip sem (přepiš)
git add .
git commit -m "feat 1.15.4 - past-event red highlight + K-dořešení section"
git tag v1.15.4 && git push && git push --tags
```

## 🧪 Test

1. Otevři **Dashboard** — Manchester City v Brentford má teď červený řádek s červeným chipem `NEPRODÁNO · event byl před 1 dnem`
2. Otevři **K dořešení** — nová sekce "Po termínu eventu" s tím samým ticketem
3. **Vyřeš to**: klik **Vyřešit** → Edit modal → změň status na `Refundováno` nebo zruš listing → uloží
4. Po refresh se ticket vyřadí z červeného highlightingu
