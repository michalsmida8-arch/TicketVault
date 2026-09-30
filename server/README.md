# TicketVault Server (self-hosted)

Náhrada Netlify backendu. Běží na tvém serveru, všechna data drží v souborech
ve složce `data/` a navíc sám čte e-mailové schránky přes IMAP a vytváří položky
v „Příchozích“ v appce (nákupy, prodeje, ke kontrole).

```
data/
  users.json                účty (hesla hashovaná)
  buckets/<id>.json         databáze TicketVaultu (jedna na účet, nebo sdílená)
  mail/<schránka>/<uid>.eml originální e-maily, kdykoliv znovu zpracovatelné
  state/                    checkpoint UID per schránka + log každého e-mailu
  backups/                  denní kopie DB, posledních 14
  mailboxes.json            které schránky sledovat (viz níže)
  examples.json             volitelné: opravené příklady pro Claude
```

## 1. Spuštění

```bash
cd server
npm install
copy .env.example .env      # a vyplň (INVITE_CODE, ANTHROPIC_API_KEY)
npm start
```

Server poslouchá na `http://0.0.0.0:8787/api`. Test: `curl http://localhost:8787/api/ping`.

**Trvalý běh (start po bootu, restart při pádu):** z PowerShellu jako správce
```powershell
powershell -ExecutionPolicy Bypass -File .\install-task.ps1
```
Log je v `server\server.log`. Odinstalace: `Unregister-ScheduledTask -TaskName TicketVaultServer -Confirm:$false`.

**Firewall** (jen když se připojuješ z jiného stroje):
```powershell
New-NetFirewallRule -DisplayName "TicketVault 8787" -Direction Inbound -Protocol TCP -LocalPort 8787 -Action Allow
```

## 2. Připojení appky

1. V appce na přihlašovací obrazovce zadej Backend URL: `http://<IP-serveru>:8787/api`
   (přes Tailscale např. `http://100.x.y.z:8787/api`).
2. **První registrace = admin** a nepotřebuje pozvánkový kód. Každý další účet
   potřebuje `INVITE_CODE` z `.env`.
3. Ulož si obnovovací kód, který registrace vrátí.
4. Přenos dat z Netlify: v appce Nastavení → Cloud → „Nahrát vše na server“
   (push celé lokální DB). Appka má lokální kopii, takže stačí být přihlášený
   na novém serveru a pushnout.

## 3. Sledované schránky (IMAP)

Vytvoř `data/mailboxes.json`:

```json
[
  { "name": "gmail-michal", "email": "michal@gmail.com", "pass": "xxxx xxxx xxxx xxxx", "owner": "michal" },
  { "name": "seznam-1",     "email": "neco@seznam.cz",   "pass": "heslo-k-seznamu",    "owner": "michal" }
]
```

- `owner` = uživatelské jméno v appce, do jehož „Příchozích“ mají e-maily padat.
- **Gmail**: zapni 2FA a vytvoř *App password* (Google účet → Zabezpečení → Hesla aplikací). Musí být povolený IMAP.
- **Seznam**: běžné heslo, IMAP je zapnutý ve výchozím stavu (`imap.seznam.cz`).
- Jiný poskytovatel: přidej `"host": "imap.example.com"` (a případně `"port"`).
- Změny v `mailboxes.json` se načtou po restartu serveru.

Co se děje s e-mailem:

1. **Prefilter** – zahodí newslettery, resety hesel apod. (`INGEST_PREFILTER=false` pošle vše Claudovi).
2. **Deterministické parsery** – zatím faktura RB Leipzig (PDF), zdarma a okamžitě.
3. **Claude** – strukturovaná extrakce (platforma, akce, datum, sektor, ks, cena, měna, číslo objednávky…) včetně PDF příloh. Model `CLAUDE_MODEL`.
4. **Deduplikace** – podle Message-ID a podle platforma + číslo objednávky (doručení vstupenek k už zapsané objednávce se nezakládá znovu).
5. **Zápis do Příchozích** + okamžitá notifikace na Discord/Pushover, pokud je máš v appce zapnuté.
6. Zrušení, refundace a nerozpoznané typy se ukážou jako karta „Nerozpoznáno“ s popisem, aby nic nezapadlo.

### Prodeje (Stubhub, Viagogo, SyncSeats)

E-maily z tržišť jsou vždy prodej a server je rovnou promítne do inventáře
(`AUTO_APPLY_SALES=true`), stejně jako tlačítka v appce:

| E-mail | Co se stane se vstupenkou |
|---|---|
| „You sold your ticket…“ | stav prodáno, cena za kus = čistá výplata / ks, datum prodeje, číslo objednávky; při částečném prodeji se řádek rozdělí |
| „Your tickets were delivered…“ | stav doručeno + čas doručení (od něj se počítá výplata) |
| „Payment processed…“ | výplata přišla, datum a částka |

Vstupenka se hledá podle čísla objednávky / ID inzerátu, jinak podle data akce,
společného slova v názvu (tým, interpret) a počtu kusů; při shodě více řádků
rozhoduje platforma, přesný počet kusů a sektor. Označí se **jen při jediné shodě**,
jinak zůstane karta v Příchozích. Ingest čeká, dokud na serveru nejsou vstupenky
(nejdřív v appce „Nahrát vše“). Když appka pošle starší kopii vstupenky, změny
prodeje/doručení/výplaty ze serveru se nepřepíšou.

Při prvním startu se načte posledních `INGEST_BACKFILL_DAYS` dní (výchozí 30).
Nové e-maily chodí přes IMAP IDLE do pár sekund, každých `INGEST_POLL_MINUTES`
minut se navíc dělá kontrola „UID větší než poslední“, takže výpadek IDLE nic neztratí.

Stav: `GET /api/ingest/status` (s tokenem). Log: `data/state/ingest-log.jsonl`.

## 4. Ruční operace

```bash
node src/cli.js ingest-file cesta\k\mailu.eml        # zpracuj jeden uložený e-mail
node src/cli.js ingest-once                           # jednorázově stáhni nové e-maily a skonči
node src/cli.js reset-checkpoint gmail-michal         # znovu projet backfill okno
```

API (Bearer token z přihlášení):

- `POST /api/ingest/email` `{from, subject, text, html}` – ruční/webhook vstup
- `POST /api/ingest/reprocess/:inboxId` – znovu vytěžit uložený e-mail (po úpravě promptu / příkladů)
- `GET  /api/inbox/raw/:inboxId` – stáhnout původní .eml

## 5. Učení z oprav

Když v appce opravíš špatně vytěženou kartu, přidej dvojici do `data/examples.json`:

```json
[
  { "subject": "Your StubHub sale: Arsenal v Chelsea",
    "body": "…text e-mailu…",
    "output": { "relevant": true, "kind": "sale", "platform": "Stubhub", "event": "Arsenal v Chelsea",
                "eventDate": "2026-10-10", "quantity": 2, "totalAmount": 310, "grossSubtotal": 350,
                "currency": "GBP", "orderId": "STH-12345", "confidence": 0.95 } }
]
```

Posledních 12 příkladů se přidává ke každému dotazu. Server je načte bez restartu.

## 6. Denní souhrn

V `DIGEST_HOUR` (výchozí 8:00) pošle každému uživateli se zapnutým kanálem
souhrn: počet položek ke kontrole, akce do 7 dnů, prodané neodeslané, neprodané.
E-mail vyžaduje `SMTP_*` v `.env`; Discord a Pushover se berou z nastavení v appce.

## Testy

```bash
npm test
```
