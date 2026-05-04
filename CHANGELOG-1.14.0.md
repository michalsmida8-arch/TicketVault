# TicketVault 1.14.0 — Inventory Tools sekce + match-only quick-add

## ✨ Tři velké změny

### 1. Sidebar reorganizace

```
MARKETPLACES                  ← seller portály
  🟠 Stubhub      → stubhub.ie/my/sales
  🔵 Viagogo      → viagogo.com

INVENTORY TOOLS               ← NOVÁ SEKCE pro broker dashboardy
  🟣 SalesPro     → salespro.stubhub.ie
  🟢 inv.viagogo  → inv.viagogo.com
```

Každý se vlastním persistent loginem (`persist:invviagogo` partition), vlastním zoom levelem, vlastním toolbarem.

### 2. Quick-Add **vždy** přiřazuje, nikdy nevytváří

V 1.13.x ⚡ tlačítko vyhodilo Add modal jako "Klonovat vstupenku (nová kopie)" když auto-match nenašel shodu — to bylo špatně. Říkals jasně:

> *"nechci aby to fungovalo jako zadat listing... naopak chci ten prodej spojit s tím co mám v dashboardu aby se to přepsalo na prodej"*

Nyní:

```
Klik ⚡ na sale
    ↓
Match picker se VŽDY otevře — i když auto-match neuspěl
    ↓
Pokud našel shody → ukáže je nahoře (s ★ perfect match když listing ID sedí)
Pokud nenašel  → ukáže VŠECHNY tickety v DB s plausibilním statusem
                 + filter input "🔍 Filtr: event, místo, sekce, účet…"
                 + auto-focus na filter (rovnou píšeš)
    ↓
Klikneš ten ticket co odpovídá → updatne se na sold + dostane Sale # +
saleDate + salePrice (přepočet per ks). Tvoje purchase price + account
zůstávají!
```

`+ Vytvořit novou` tlačítko v rohu zůstává jako únikovka kdyby ten ticket
opravdu nebyl v DB.

### 3. Lepší extrakce event name pro multi-card pages

V minulé verzi item picker ukazoval prázdné event names u Bad Bunny řádků.
Příčina: Viagogo nemá `<a href="/concerts/">` u všech karet, jen u některých
typů. Nyní 3 strategie kaskádově:

1. `<a href="/concerts/...">` link uvnitř karty
2. **Text který je BEZPROSTŘEDNĚ PŘED "Sale No." v DOM order** (Viagogo
   render pattern: heading → ↗ → Sale No. → adresa → datum)
3. První non-empty line v textu karty

Plus lepší filtr na page-title leaks (`viagogo`, `stubhub`, `Open`, `Sale`,
`Show details`...).

Když event name pořád selže, picker ukazuje `Sale #631553584` jako fallback
title místo prázdného `—`, abys aspoň věděl o jaký sale jde.

## 🔧 Technické

- **Match picker delegated click handler** — survive filter re-renders
- **Filter input je sticky** — když scrolluješ list, zůstává nahoře
- **Auto-focus na filter** když se zobrazí fallback list
- **`MARKETPLACE_HOMES['invviagogo']` + zoom state + view check** — ekvivalent
  ostatních 3 marketplaces

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.14.0.zip sem (přepiš)
git add .
git commit -m "feat 1.14.0 - Inventory Tools sidebar section + match-only quick-add"
git tag v1.14.0 && git push && git push --tags
```

## 🧪 Test

1. **Sidebar:** dva oddíly — MARKETPLACES (Stubhub + Viagogo), INVENTORY TOOLS (SalesPro + inv.viagogo)
2. **inv.viagogo:** klik → načte se inv.viagogo.com login / dashboard
3. **Quick-Add s match:** ⚡ na Viagogo My Sales → vybereš sale → match picker ukáže shody nebo všechny tickety
4. **Manuální výběr:** filter "metallica" → ukáže jen Metallica tickety → klik správný → updatuje na sold
5. **Persistence loginů:** restart appky → klik všech 4 marketplaces → všechny zůstávají přihlášené
