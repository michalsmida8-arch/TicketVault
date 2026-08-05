# TicketVault 1.15.40 — Discord + Pushover notifikace

## ✨ Co je nové
V **Nastavení** přibyly kanály pro denní souhrn vedle emailu:
- **💬 Discord** — vlož webhook URL svého kanálu, zapni, hotovo.
- **🔔 Pushover** — zadej User Key + API Token (z pushover.net) pro push na mobil.

Tlačítko **„🚀 Poslat test do všech kanálů"** pošle testovací souhrn a rovnou
ukáže, co prošlo (email ✓ / Discord ✓ / Pushover ✓).

Posílá se stejný obsah co e-mailem (K zalistování / Neprodané / Doručit /
Jde do prodeje) ve stejný čas (8:00 a 18:00).

## ⚠️ Nasazení — potřeba obojí
1. **Backend 1.4.17** (`ticketvault-backend-1.4.17-discord-pushover`) na Netlify.
2. **Frontend 1.15.40** — je i změna hlavního procesu → po tagu CI build + přeinstalovat.

## Jak si vzít webhook / klíče
- **Discord:** server → Nastavení kanálu → Integrace → Webhooky → Nový webhook → Kopírovat URL.
- **Pushover:** účet na pushover.net → zkopíruj *User Key*; appka na pushover.net/apps/build → *API Token*.

## 🚀 Release
```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.40.zip sem
git add . && git commit -m "feat 1.15.40 - Discord + Pushover digest notifications"
git tag v1.15.40 && git push && git push --tags
```
