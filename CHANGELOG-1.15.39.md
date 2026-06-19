# TicketVault 1.15.39 — Sledované akce: ruční přidání (koncerty atd.)

## ✨ Co je nové

Do sekce **Sledované akce** přibylo tlačítko **„+ Přidat ručně"** — můžeš si
přidat libovolnou akci, která není v rozlosu Premier League (třeba koncert).

Formulář:
- **Název akce** (povinné) — např. „Coldplay — Music of the Spheres"
- **Datum + čas akce** (volitelné)
- **Místo** (volitelné)
- **Jde do prodeje — datum + čas**
- **Poznámka**

Ručně přidané akce fungují úplně stejně jako sledované zápasy:
- mají odznak „dnes! / za N dní" podle data prodeje,
- počítají se do **odznaku** v menu a do **startup upozornění**,
- objeví se v **emailovém souhrnu** v sekci „🎟️ Jde do prodeje".

Akce bez soupeře (koncert) se zobrazí jen názvem (ne „Název v ") a má štítek
**„ručně"**.

## 🔧 Technicky
- Ruční akce se ukládají do `db.watchedMatches` s `manual:true` a `id` `man_…`;
  perzistence + cloud sync stejná jako u zápasů.
- Vykreslování (appka i email) nově rozlišuje „Domácí v Hosté" vs. akce jen
  s názvem. **Email vyžaduje backend 1.4.13.**

## ⚠️ Nasazení
1. **Backend 1.4.13** (`ticketvault-backend-1.4.13-watched-manual`) na Netlify
   (kvůli správnému zobrazení akcí bez soupeře v emailu).
2. **Frontend 1.15.39** — extract → commit → tag → push (CI build, přeinstalovat).

## 🚀 Release
```bash
cd /c/Users/msmida/Desktop/ticketvault
git pull --rebase
# rozbal TicketVault-1.15.39.zip sem (přepiš)
git add .
git commit -m "feat 1.15.39 - Sledovane akce: rucni pridani akce (koncerty)"
git tag v1.15.39 && git push && git push --tags
```

## 🧪 Test
1. Sledované akce → **+ Přidat ručně** → vyplň „Coldplay", datum prodeje na dnes
   → Uložit. Akce se přidá se štítkem „ručně" a odznakem „dnes!".
2. V menu naskočí počítadlo, po restartu appky přijde toast.
3. Email souhrn → sekce „Jde do prodeje" obsahuje i koncert (bez koncového „v").
