# TicketVault 1.8.0 — Evidence emailových schránek + SIM karet

Dvě nové evidenční záložky v sidebaru pod Membershipy.

## ✨ Nové funkce

### 📧 Emailové schránky
Jednoduchá evidence emailových schránek (Jméno, Příjmení, Email + poznámka).

- Vyhledávání napříč všemi poli
- Kopírovací tlačítko pro email (jeden klik → schránka)
- Hromadné mazání (checkboxy + "Smazat vybrané")
- Řazení podle příjmení (česká diakritika)

### 📱 SIM karty
Evidence SIM karet s automatickým hlídáním expirace.

- **Pole:** Operátor, Telefonní číslo, Datum expirace, Vlastník, Poznámka
- **Operátor jako dropdown** s předvyplněnými hodnotami **T-Mobile / O2 / Vodafone / Kaktus**.
  Tlačítko `+` přidá vlastního operátora — uloží se do DB a synchronizuje přes cloud.
- **Tlačítko ↻ Prodlouženo** přidá 1 rok k datu expirace jedním klikem.
  Pokud SIM už vypršela, kotví na **dnešek** (aby uživatel dostal použitelné budoucí datum,
  ne další minulé).
- **Barevné zvýraznění expirace:**
  - 🟢 Zelená — v pořádku
  - 🟡 Žlutá — vyprší za méně než 30 dní
  - 🔴 Červená — vyprší za méně než 7 dní
  - ❌ Šedá s přeškrtnutím — už vypršela
- **Sidebar badge** ukazuje počet urgentních/vypršelých SIMek (vidíš to i bez otevření záložky)
- **Filtry:** hledání, operátor, stav (V pořádku / Brzy / Urgent / Vypršelo)
- Řazení podle data expirace vzestupně (nejdřív ty, co brzy vyprší)

## 🔧 Technické

- DB schema: nová pole `mailboxes: []`, `simcards: []`, `simOperators: ['T-Mobile','O2','Vodafone','Kaktus']`
- Schema migrace: existující DB se automaticky doplní o nová pole při startu (nic se nemaže)
- Cloud sync: všechny CRUD operace (upsert/delete/bulk) okamžitě pushují změny do cloudu
- UI prefs: filtry obou nových záložek se zachovávají mezi restarty
