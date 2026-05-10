# TicketVault 1.15.3 — ISO kódy zemí místo emoji vlajek

## ✨ Změna

Vyměnil jsem **emoji vlajky** (`🇬🇧 🇨🇿 🇺🇸`) za **ISO kód v badgi** (`GB CZ US`):

```
EVENT          MÍSTO              ZEMĚ                       SEKCE
Arsenal v ...  Emirates Stadium   ⌜GB⌟ Spojené království    99, 10
West Ham       London Stadium     ⌜GB⌟ Velká Británie        213, 73
Czech Rep ...  AT&T Stadium       ⌜US⌟ USA                   503, 14
Bad Bunny      Estádio da Luz     ⌜PT⌟ Portugalsko           Piso T...
```

(`⌜...⌟` představuje malý zlato-tónovaný badge, který obsahuje 2 ISO písmena)

## Proč

V 1.15.2 jsem přidal flag emoji `🇬🇧`. Funguje to ale jen tam, kde OS má v emoji fontu skutečné vlajky — **Windows Segoe UI Emoji** v některých verzích nemá flagy a místo toho ukáže `GB` jako fallback. To vypadalo špatně (text místo vlajky, různě široký).

ISO kód v badgi:
- **Funguje na všech systémech identicky** — žádný fallback, žádné rendering quirks
- **Šetří místo** — 26px wide badge je menší než emoji + tooltip
- **Vypadá profesionálně** — jako airport / IATA tag (`LHR`, `JFK`)
- **Stejná hierarchie** — badge je primary (zlato-tónovaný), název země je muted text vedle

## Vzhled badge

- **Velikost** — 26px wide, monospace font, 2 písmena `GB`/`CZ`/`US`
- **Barva** — zlato-tónovaná (matchuje accent paletu appky)
- **Hover** — tooltip s plným názvem země
- **Bez ISO kódu** — pokud zemi nepoznám (rare), zobrazí jen text bez badge
- **Bez země vůbec** — `—` (em-dash)

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.3.zip sem (přepiš)
git add .
git commit -m "feat 1.15.3 - country ISO badge instead of flag emoji"
git tag v1.15.3 && git push && git push --tags
```

## 🧪 Test

Po update v Ticket Inventory by sloupec **ZEMĚ** měl ukazovat:
- `GB Spojené království` (badge GB + text)
- `US USA`
- `CZ Česko`
- `PT Portugalsko`

Bez stranger artefactů (žádné emoji, žádné fallback letter-pairs).
