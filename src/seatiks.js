// Seatiks (1.20) — app side. The Seller API key is pasted here once and stored ONLY on the
// server (POST /seatiks/key); the app never keeps it. Zalistování (listing.js) lists tickets
// through window.__seatiks.call(); sales come back by the server's 5-minute poll.
// Relies on app.js globals: toast, escapeHtml, refreshDb.
(function () {
  async function call(method, path, body) {
    if (!window.api || !window.api.seatiks) throw new Error('Seatiks potřebuje novější verzi aplikace.');
    const r = await window.api.seatiks(method, path, body);
    if (!r || !r.success) throw new Error((r && r.error) || 'Seatiks bez odpovědi');
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
    if (!s.configured) return 'Klíč zatím není nastavený. Vytvoř ho na seatiks.com → Settings → Developers (začni testovacím <code>stk_test_…</code>) a vlož ho sem.';
    if (s.error) return `Klíč <code>${escapeHtml(s.hint)}</code> — <span class="st-bad">${escapeHtml(s.error)}</span>`;
    const mode = s.mode === 'live' ? '<b class="st-live">OSTRÝ</b> (inzeráty jdou na tržiště)' : '<b class="st-test">TESTOVACÍ (sandbox)</b> — fiktivní akce, nic se nezveřejní';
    return `Připojeno · klíč <code>${escapeHtml(s.hint)}</code> · ${mode}<br>Oprávnění: ${(s.scopes || []).map(escapeHtml).join(', ') || '—'}`;
  }

  async function renderSettings() {
    const box = document.getElementById('seatiksSettingsBox');
    if (!box) return;
    box.innerHTML = statusHtml(null);
    box.innerHTML = statusHtml(await status(true));
  }

  function wireSettings() {
    const save = document.getElementById('btnSeatiksKeySave');
    if (!save || save.dataset.wired) return;
    save.dataset.wired = '1';
    const input = document.getElementById('seatiksKeyInput');
    save.addEventListener('click', async () => {
      const key = input.value.trim();
      if (!key) { toast('Vlož klíč stk_test_… nebo stk_live_…', 'error'); return; }
      save.disabled = true;
      try {
        const s = await call('POST', '/key', { key });
        input.value = '';
        cached = null;
        toast(`Seatiks připojen (${s.mode === 'live' ? 'ostrý' : 'testovací'} klíč)`, 'success', 6000);
        renderSettings();
      } catch (e) { toast(e.message, 'error', 8000); }
      finally { save.disabled = false; }
    });
    document.getElementById('btnSeatiksKeyRemove').addEventListener('click', async () => {
      if (!confirm('Odpojit Seatiks? Klíč se na serveru smaže; zalistované inzeráty na Seatiks zůstanou.')) return;
      try { await call('POST', '/key', { key: '' }); cached = null; renderSettings(); toast('Seatiks odpojen', 'success'); }
      catch (e) { toast(e.message, 'error'); }
    });
    document.getElementById('btnSeatiksSync').addEventListener('click', async () => {
      try {
        const r = await call('POST', '/sync');
        if (typeof refreshDb === 'function') await refreshDb();
        toast(`Seatiks: načteno ${r.sales || 0} prodejů${r.applied ? `, nově zapsáno ${r.applied}` : ''}`, 'success', 6000);
      } catch (e) { toast(e.message, 'error', 8000); }
    });
  }

  // Settings view opens → show the state (app.js calls window.renderSeatiksSettings if present).
  window.renderSeatiksSettings = () => { wireSettings(); renderSettings(); };
  window.__seatiks = { call, status };
})();
