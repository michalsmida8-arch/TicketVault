# Release Guide

Auto-update funguje **jen na Windows**, Mac builds jsou manuální.

## 🚢 Nová Windows release

1. **Bump verze v `package.json`:**
   ```json
   "version": "1.0.1"    // z 1.0.0 → 1.0.1
   ```

2. **Commit + tag + push:**
   ```bash
   git add package.json
   git commit -m "release 1.0.1"
   git tag v1.0.1
   git push && git push --tags
   ```

3. **GitHub Actions automaticky buildne** (~5 min):
   - Spustí Windows runner
   - Nainstaluje závislosti
   - Zbuildí `TicketVault-Setup-1.0.1.exe`
   - Nahraje ho do GitHub Release `v1.0.1`

4. **Uživatelé** při příštím startu appky uvidí banner "Nová verze 1.0.1 dostupná", stáhne se na pozadí, pak "Restartovat a nainstalovat".

## 🍏 macOS build (manuální)

```bash
npm run build:mac
```

DMG v `dist/` pošli uživatelům přímo.

## 🔐 Auto-update flow

1. App startuje → 3 sekundy poté `autoUpdater.checkForUpdates()`
2. Porovná verze s GitHub Releases latest
3. Pokud novější → stáhne installer na pozadí
4. `update-downloaded` event → banner "Restartovat a nainstalovat"
5. User kliká → `quitAndInstall()` → app se zavře, installer běží, po instalaci autorestart
