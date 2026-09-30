# TicketVault 1.16.0 — vlastní server, automatické zapisování z e-mailů, nový vzhled

## 🖥️ Vlastní server místo Netlify

- Data leží na tvém serveru (`server/`), přístup přes Tailscale. Výchozí adresa
  v appce je `http://100.87.47.36:8787/api`.
- Server běží trvale (úloha Windows při startu, po pádu se sám restartuje).
- **Webová verze:** stejná appka v prohlížeči na `http://100.87.47.36:8787/app`
  (i na mobilu přes Tailscale). Zabudovaný StubHub/Viagogo, import PDF/CSV a
  načítání stránek akcí zůstávají jen v desktopové appce.

## 📥 Automatické zapisování z e-mailů

- Server sám čte schránky (Gmail, Seznam) a e-maily zpracuje do minuty.
- **Nákupy** s úplnými údaji se rovnou založí do inventáře; nejisté zůstanou
  v Příchozích. Možný duplicitní nákup má v kartě varování.
- **Prodeje** ze StubHubu, Viagoga a SyncSeats se promítnou samy: prodáno
  (i částečný prodej s rozdělením řádku), doručeno, výplata, zrušení prodeje.
- **PDF vstupenky** z e-mailů jsou uložené u vstupenky (ikona PDF v řádku).
- **Upozornění** na Discord/Pushover: nedoručené prodeje a nezalistované
  vstupenky před akcí, souhrn v 8:00 a 18:00.
- V Nastavení → Příchozí emaily je stav každé schránky.

## ✨ Nový vzhled

- Panel **Dnes**: co doručit, zalistovat, výplaty a Příchozí; kalendář akcí na
  30 dní; kolik přijde za 7 a 30 dní a kolik kapitálu je ve vstupenkách.
- **Inventář seskupený podle akce** s rozbalením; kompaktní tabulka, která se
  vejde do okna (i na 1366 px notebooku).
- **Detail vstupenky jako boční panel** — tabulka zůstane vidět.
- **Ctrl+K**: rychlé hledání akcí, vstupenek, sekcí a příkazů.
- Jednotné písmo a čárové ikony místo emoji, česká data (5. 12. 2026),
  sloučená upozornění, klidnější barvy tlačítek.

## 🔐 Ostatní

- **Zapamatovat přihlášení** — zůstaneš přihlášený; bez zaškrtnutí se odhlásíš
  zavřením appky. Jméno se předvyplní.
- Při prvním přihlášení k prázdnému serveru appka nepřepíše lokální data.
- Starší kopie z jiného zařízení už nepřepíše prodeje, doručení, výplaty ani
  smazané řádky, které mezitím zapsal server.
