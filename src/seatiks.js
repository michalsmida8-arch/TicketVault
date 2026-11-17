// Seatiks (1.20) and SyncSeats (1.23) — app side. The Seller API key is pasted here once and stored
// ONLY on the server (POST /<broker>/key); the app never keeps it. Zalistování (listing.js) lists
// tickets through window.__seatiks / window.__syncseats .call(); sales come back by the server's 5-minute poll.
// Relies on app.js globals: toast, escapeHtml, refreshDb.
(function () {
  function broker({ id, label, prefix, howTo, liveText }) {
    const P = id[0].toUpperCase() + id.slice(1); // element ids: btnSeatiksKeySave / btnSyncseatsKeySave …
    async function call(method, path, body) {
      if (!window.api || !window.api[id]) throw new Error(label + ' potřebuje novější verzi aplikace.');
      const r = await window.api[id](method, path, body);
      if (!r || !r.success) throw new Error((r && r.error) || label + ' bez odpovědi');
      return r.data;
    }

    let cached = null;
    async function status(force) {
      if (!force && cached && Date.now() - cached.at < 5 * 60000) return cached.s;
      const s = await call('GET', '/status').catch(e => ({ configured: false, error: e.message }));
      cached = { s, at: Date.now() };
      return s;
    }

    function statusHtml(s) {
      if (!s) return 'Načítání…';
      if (s.error && !s.configured) return `<span class="st-bad">${escapeHtml(s.error)}</span>`;
      if (!s.configured) return `Klíč zatím není nastavený. ${howTo} (začni testovacím <code>${prefix}test_…</code>) a vlož ho sem.`;
      if (s.error) return `Klíč <code>${escapeHtml(s.hint)}</code> — <span class="st-bad">${escapeHtml(s.error)}</span>`;
      const mode = s.mode === 'live' ? `<b class="st-live">OSTRÝ</b> (${liveText})` : '<b class="st-test">TESTOVACÍ (sandbox)</b> — nic se nezveřejní, skutečné vstupenky se nemění';
      return `Připojeno · klíč <code>${escapeHtml(s.hint)}</code> · ${mode}<br>Oprávnění: ${(s.scopes || []).map(escapeHtml).join(', ') || '—'}`;
    }

    async function renderSettings() {
      const box = document.getElementById(id + 'SettingsBox');
      if (!box) return;
      box.innerHTML = statusHtml(null);
      box.innerHTML = statusHtml(await status(true));
    }

    function wireSettings() {
      const save = document.getElementById(`btn${P}KeySave`);
      if (!save || save.dataset.wired) return;
      save.dataset.wired = '1';
      const input = document.getElementById(id + 'KeyInput');
      save.addEventListener('click', async () => {
        const key = input.value.trim();
        if (!key) { toast(`Vlož klíč ${prefix}test_… nebo ${prefix}live_…`, 'error'); return; }
        save.disabled = true;
        try {
          const s = await call('POST', '/key', { key });
          input.value = '';
          cached = null;
          toast(`${label} připojen (${s.mode === 'live' ? 'ostrý' : 'testovací'} klíč)`, 'success', 6000);
          renderSettings();
        } catch (e) { toast(e.message, 'error', 8000); }
        finally { save.disabled = false; }
      });
      document.getElementById(`btn${P}KeyRemove`).addEventListener('click', async () => {
        if (!confirm(`Odpojit ${label}? Klíč se na serveru smaže; inzeráty na ${label} zůstanou.`)) return;
        try { await call('POST', '/key', { key: '' }); cached = null; renderSettings(); toast(label + ' odpojen', 'success'); }
        catch (e) { toast(e.message, 'error'); }
      });
      document.getElementById(`btn${P}Sync`).addEventListener('click', async () => {
        try {
          const r = await call('POST', '/sync');
          if (typeof refreshDb === 'function') await refreshDb();
          toast(`${label}: načteno ${r.sales || 0} prodejů${r.applied ? `, nově zapsáno ${r.applied}` : ''}`, 'success', 6000);
        } catch (e) { toast(e.message, 'error', 8000); }
      });
    }
    return { call, status, settings: () => { wireSettings(); renderSettings(); } };
  }

  const seatiks = broker({ id: 'seatiks', label: 'Seatiks', prefix: 'stk_', howTo: 'Vytvoř ho na seatiks.com → Settings → Developers', liveText: 'inzeráty jdou na tržiště' });
  const syncseats = broker({ id: 'syncseats', label: 'SyncSeats', prefix: 'ssapi_', howTo: 'Vytvoř ho v SyncSeats (sekce Seller API)', liveText: 'koncepty inzerátů zveřejňuješ v SyncSeats sám' });
  // Settings view opens → show the state (app.js calls window.renderSeatiksSettings if present).
  window.renderSeatiksSettings = () => { seatiks.settings(); syncseats.settings(); };
  window.__seatiks = { call: seatiks.call, status: seatiks.status };
  window.__syncseats = { call: syncseats.call, status: syncseats.status };
})();
