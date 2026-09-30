# TicketVault 1.16.0 — vlastní server místo Netlify

## ✨ Nové

- **Vlastní server** (`server/`): data leží na tvém serveru, přístup přes Tailscale.
  Výchozí adresa serveru v appce je `http://100.87.47.36:8787/api`.
- **Příchozí emaily bez přeposílání**: server sám čte e-mailové schránky (Gmail, Seznam).
  V Nastavení → Příchozí emaily vidíš stav každé schránky a čas poslední kontroly.
- **Prodeje se zapisují samy**: e-maily ze StubHubu, Viagoga a SyncSeats
  (prodáno, doručeno, výplata) server rovnou promítne do inventáře, když najde
  jedinou odpovídající vstupenku. Jinak zůstane karta v Příchozích.

## 🔧 Změny

- Sekce „Online režim (Netlify)“ přejmenována na „Server (online režim)“.
- Odstraněna CloudMailin forward adresa a návod na přeposílání.
- Tlačítka migrace: „Nahrát lokální data na server“ / „Stáhnout data ze serveru“.

## 🛡️ Ochrana dat

- Při přihlášení k prázdnému serveru appka **nepřepíše** lokální data prázdnou
  databází. Místo toho ukáže upozornění, jak data na server nahrát.
