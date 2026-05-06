# TicketVault 1.15.2 — Sloupec Země v Ticket Inventory

## ✨ Nové

V tabulce **Ticket Inventory** přibyl sloupec **ZEMĚ** mezi MÍSTO a SEKCE:

```
EVENT          DATUM        MÍSTO              ZEMĚ                SEKCE
Arsenal v ...  2026-04-25   Emirates Stadium   🇬🇧 Velká Británie    99, 10
West Ham v ... 2026-05-10   London Stadium     🇬🇧 Spojené králov... 213, 73
Czech Rep ...  2026-06-12   AT&T Stadium       🇺🇸 USA              503, 14
Bad Bunny      2026-05-26   Estádio da Luz     🇵🇹 Portugalsko       Piso T...
```

Každá země má **vlajku jako emoji** (`🇬🇧`, `🇨🇿`, `🇵🇱`, `🇺🇸` atd.) — rychle vidíš **kde** se hraje bez čtení textu.

## Jak to funguje

1. **Pole `country`** už dlouho existovalo na ticketu — bylo viditelné jen v editor formuláři, teď je v tabulce
2. **Vlajka emoji** se generuje z ISO 3166-1 alpha-2 kódu (`gb` → `🇬🇧`) — žádné externí závislosti, žádné obrázky
3. **Lookup je tolerantní** k diakritice / variantám:
   - `Velká Británie` ✓
   - `Spojené království` ✓
   - `United Kingdom` ✓
   - `England` / `Anglie` ✓
   - `UK` ✓
4. **Pokud zemi nepoznám**, zobrazí jen text bez vlajky (žádný crash). Hlaste pokud nějakou zemi přidám
5. **Pokud country chybí** úplně, zobrazí se `—`

## Pokrytí zemí (ze všech ticketů které máš)

Hlavní evropské + UK + USA + Brazil + JAR + Argentina + Mexiko + Saudská Arábie + Katar + Korea + Japan + Austrálie + Indie + Thajsko atd. — **přes 50 zemí**. Pokud nějaká chybí, řekni a přidám.

## Doplnění existujících ticketů

Pokud u některých ticketů není `country` vyplněné (například starší importy ze Stubhubu), zobrazí se `—`. Můžeš je doplnit:
- **Edit ticket** → pole **Země** (s našeptávačem)
- **Hromadná editace** → vybereš checkboxy → "Země" → zadáš jednou pro všechny vybrané

## Implementace

- Nová mapa `COUNTRY_TO_ISO` s ~50 zeměmi (Czech canonical + English + běžné aliasy)
- `normalizeCountryKey()` — strip diacritics + lowercase + remove spaces
- `isoToFlag(iso)` — Unicode regional indicators (`U+1F1E6 + offset`)
- Buňka v tabulce má `max-width: 140px` + ellipsis pro dlouhé názvy

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.2.zip sem (přepiš)
git add .
git commit -m "feat 1.15.2 - country column with flags in tickets table"
git tag v1.15.2 && git push && git push --tags
```

## 🧪 Test

1. Po update: klik **Dashboard** (Ticket Inventory)
2. Sloupec **ZEMĚ** mezi MÍSTO a SEKCE — s vlajkami
3. Filtr/sort funguje normálně (na country sort jsem nedělal — řekni jestli chceš)
4. Pokud chybí země — Edit ticket → vyplň → uloží se vlajka

Pokud chceš jiné pořadí sloupců (např. ZEMĚ úplně před MÍSTO, nebo až za SEKCE), napiš.
