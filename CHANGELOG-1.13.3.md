# TicketVault 1.13.3 — Quick-Add: data per kartu, ne celá stránka

## 🐛 Co bylo špatně v 1.13.2

V tvém posledním screenshotu jsi měl 5 sales na Viagogo My Sales (Metallica 2×, Bad Bunny 3×). Picker se otevřel se 5 řádky, **ale všechny zobrazovaly stejná data**:

```
Tickets - Concert, Sport &amp; Theatre Tickets | viagogo the Ticket Marketplace
19.05.2026 · Slaski Stadium · Sekce 20G2 / řada C2 · 25595.94 CZK · Sale #...
```

To byla **stejná data z celé stránky** opakovaná 5×. Sale IDs byly správné, ale event/datum/sekce/cena byly stejné.

### Příčina

Walk-up DOMu si bral první ancestor co měl heading + cenu + datum. Jenže ten ancestor byl **rodič všech 5 karet** (kontainer `<main>` nebo `<section>`). Pro každý ID jsme tedy extrahovali z té samé velké chunk textu → vyšla 5× ta samá data.

## ✅ Oprava

Walk-up nyní zastavuje **přesně před** tím rodičem který by obsahoval i jiné Sale ID. Tím získáme **smallest container holding exactly one card**.

```js
while (card) {
  const txt = card.textContent;
  // Pokud bys posunul výš, zahrneš jiné ID → STOP
  if (otherIds.some(other => txt.includes(other))) break;
  lastClean = card;
  card = card.parentElement;
}
// → použij lastClean = poslední čistý ancestor
```

### Plus oprava event name

Místo `<title>` page si bere **`<a href="/concerts/...">Metallica</a>` link uvnitř karty**. Viagogo i Stubhub mají event link v každé kartě → správně dostaneme `Metallica`, `Bad Bunny` atd.

Pokud link chybí, fallback na heading/strong **s filtrem** který odhodí page-level titles ("viagogo the Ticket Marketplace").

### Vyladěná regex pro Section

`Section 20G2 / řada C2` se teď odděluje správně — sekce končí na řádku/odrážce/`Row` keyword/qty.

## 🎯 Jak by to mělo vypadat teď

```
Vyber kterou položku importovat (5 nalezeno)

Metallica
📅 19.05.2026 · 📍 Slaski Stadium · 🎫 Sekce 20G · 2 ks · 13011.29 CZK · Sale #631553584

Metallica
📅 19.05.2026 · 📍 Slaski Stadium · 🎫 Sekce 15D · 3 ks · 25595.94 CZK · Sale #634179845

Bad Bunny
📅 26.05.2026 · 📍 Estadio da Luz · 🎫 Sekce Piso Tres 07 / Row C · 2 ks · 7578.82 CZK · Sale #635500161

Bad Bunny
📅 10.06.2026 · 📍 Riyadh Air Metropolitano · 🎫 Sekce 425 / Row 13 · 2 ks · 9385.58 CZK · Sale #635833347

Bad Bunny
📅 10.06.2026 · 📍 Riyadh Air Metropolitano · 🎫 Sekce 425 / Row 13 · 2 ks · 9385.58 CZK · Sale #635847690
```

## 🔗 Klik položku → match picker

To už funguje od 1.12.1: po kliknutí item v pickeru se zavolá `proceedWithSingleItem()` který:

1. Najde tickety v DB se shodným event name (fuzzy match)
2. Pokud najde → otevře **match picker** se seznamem (klikneš ten správný a updatne se)
3. Pokud nenajde → otevře **Add modal** s předvyplněnými daty

Workflow:

```
Klik ⚡ na My Sales
    ↓
Item picker (5 nalezeno) → klikneš Metallica 20G
    ↓
Match picker: "Nalezeno 2 vstupenky se shodným eventem"
    • ★ Metallica  · 20G · onasp@seznam   [Koupeno]   →
    •   Metallica  · 15D · yawns          [Koupeno]   →
    + Vytvořit novou vstupenku
    ↓
Klikneš ten správný → ticket se updatne na sold + Sale #
```

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.13.3.zip sem (přepiš)
git add .
git commit -m "fix 1.13.3 - per-card scrape isolation"
git tag v1.13.3 && git push && git push --tags
```

## 🧪 Test

1. Klik **Viagogo** → My Sales (5 sales viditelné)
2. Klik **⚡ Přidat do TicketVault**
3. Item picker musí ukázat **5 RŮZNÝCH** položek (Metallica + Bad Bunny, různé sekce, různé ceny)
4. Klikni Metallica 20G → otevře se match picker s tickety v DB se shodným eventem
5. Klikni v DB ten správný → ticket se updatne na `sold`

Pokud něco z dat chybí nebo je špatně, screenshot prosím — doladíme regex/selektory pro konkrétní layout, který vidíš.
