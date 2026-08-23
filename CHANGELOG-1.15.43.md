# TicketVault 1.15.43 — Výkon u velkých inventářů

## ⚡ Opravy výkonu
Po importu tisíců lístků se appka sekala. Příčiny a opravy:
- **Delegace událostí** — místo ~7 listenerů na každý řádek (u 2500 lístků přes
  17 000 listenerů, znovu při každém překreslení) je teď jeden listener na celou
  tabulku. Zásadní zrychlení akcí a filtrování.
- **Strop vykreslených řádků** — do DOM se najednou vykreslí max 150 řádků,
  s tlačítky „Zobrazit dalších 150" a „Zobrazit vše". Strop se resetuje při
  změně filtru/řazení. Řeší sekání při scrollování.

Funkce zůstávají stejné (výběr, hromadné akce, filtry) — jen plynulé.
