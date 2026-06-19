# TicketVault 1.15.37 — PL: ignorovat oznámení eCalu + jasný stav feedu

## ✨ Vylepšení

Po připojení PL feedu (1.15.36) se v kalendáři ukazovaly i **oznamovací události
eCalu** („Zveřejnění zápasů…", „Success! You're connected…") jako kdyby to byly
zápasy. Navíc dokud eCal po vydání nenaplní rozlosy, feed obsahuje jen tyhle
oznámení.

Nově:
- **Filtrují se jen reálné zápasy** (rozparsované na Domácí–Hosté). Oznamovací /
  onboarding události eCalu se do kalendáře nezobrazují.
- Když feed zatím **neobsahuje žádné zápasy** (jen oznámení), ukáže se jasná
  hláška: *„Feed je připojený, ale zatím v něm nejsou žádné zápasy…"* místo
  matoucích prázdných řádků.
- Handler nově nehlásí chybu, když je feed dostupný, ale bez zápasů (rozliší
  „nedostupné" od „zatím prázdné").

## Pozn. k release dni

Rozlosy 2026/27 vyšly 19. 6. v 10:00; eCal plní zápasy do odběratelských feedů
postupně pod velkým náporem. Až dorazí do tvého feedu, klikni **Aktualizovat** a
zápasy naskočí (oznámení zůstanou skrytá).

## ⚠️ Nasazení

Změna je i v **hlavním procesu** (`main.js`) → po extrakci a tagu nech CI postavit
build a appku **přeinstaluj**.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.37.zip sem (přepiš)
git add .
git commit -m "fix 1.15.37 - PL filter out eCal announcement events, clearer empty state"
git tag v1.15.37 && git push && git push --tags
```
