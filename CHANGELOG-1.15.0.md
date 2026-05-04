# TicketVault 1.15.0 — Emailové schránky: heslo + plný email

## ✨ Nové

V sekci **Emailové schránky** přibyly dvě věci:

### 1. Pole pro heslo

V modalu **Přidat / Upravit schránku** je teď nové pole **Heslo k emailu** s eye-toggle (👁) tlačítkem pro zobrazení / skrytí během zápisu.

```
┌─ Upravit schránku ────────────────────────┐
│ Jméno *           Příjmení *              │
│ [Michal      ]   [Šmída         ]         │
│                                            │
│ Email *                                    │
│ [michal.smida8885@gmail.com           ]   │
│                                            │
│ Heslo k emailu                             │
│ [•••••••••••••••••              ] [👁]    │ ← NOVÉ
│                                            │
│ Poznámka                                   │
│ [...]                                      │
└────────────────────────────────────────────┘
```

### 2. Sloupec HESLO v tabulce

```
☐ JMÉNO    PŘÍJMENÍ   EMAIL                          HESLO       AKCE
☐ Michal   Šmída      michal.smida8885@gmail.com 📋  ••••••••• 📋 Edit Del
☐ Jan      Novák      jan.novak@icloud.com      📋  ••••••••• 📋 Edit Del
```

- **Klik na ••••••••** → ukáže heslo
- **Klik znovu** → skryje
- **📋 ikona vedle** → zkopíruje heslo do schránky (1 klik)
- Bez hesla zobrazí jen `—`

### 3. Email už NENÍ oříznutý

Stará konfigurace měla `max-width: 200px` + `overflow: hidden + ellipsis`, takže delší emaily (`michal.smida8885@gmail.com`) se zobrazovaly oříznuté `michal.smida8885@gmail...`. Nyní je sloupec rozšířený na 360px a obsah se může zalomit do druhého řádku pokud by byl extrémně dlouhý — všechno je vidět.

## 🔒 Bezpečnost

- Heslo se ukládá **plain-text** v lokální DB (stejný trust model jako zbytek dat)
- **Není** zahrnuté v search filteru (kdyby ses omylem hledal heslem v search baru)
- **Nesyncuje se** k email providerovi — je to čistě tvoje lokální poznámka, abys měl credentials pohromadě
- Cloud sync je end-to-end šifrovaný (jako celá DB)

> ⚠️ **Pokud je tě více lidí na jednom účtu**, mějte na paměti že každý kdo má přístup k aplikaci uvidí hesla po klik. TicketVault není password manager — pro vážné credential management použij Bitwarden / 1Password.

## 🚀 Release

```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.0.zip sem (přepiš)
git add .
git commit -m "feat 1.15.0 - mailbox password field + full email visible"
git tag v1.15.0 && git push && git push --tags
```

## 🧪 Test

1. Klik **Emailové schránky** v sidebaru
2. Klik na existující email → **Edit** → otevře modal
3. V modalu vidíš nové pole **Heslo k emailu** — vyplň, klikni 👁 pro zobrazení, **Uložit**
4. V tabulce vedle emailu se objeví sloupec **HESLO** s `••••••••` — klik to ukáže
5. Klik 📋 vedle hesla → zkopíruje
6. Email v tabulce už není oříznutý (`michal.smida8885@gmail.com` viditelný celý)
