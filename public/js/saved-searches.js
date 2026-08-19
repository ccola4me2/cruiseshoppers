// Saved searches on Browse Sailings: save the current filters, re-run a saved
// search with one click, and opt in to new-deal alerts. Drives search.js by
// setting the filter inputs and dispatching the form's submit.

(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('savedBar') || !$('searchBar')) return;

  const FIELDS = { destination: 'f-destination', saildate: 'f-saildate', type: 'f-type', length: 'f-length', line: 'f-line', q: 'f-q', port: 'f-port' };

  function readCriteria() {
    const c = {};
    for (const [k, id] of Object.entries(FIELDS)) { const el = $(id); if (el) c[k] = el.value || ''; }
    return c;
  }

  function applyCriteria(c) {
    for (const [k, id] of Object.entries(FIELDS)) {
      const el = $(id);
      if (el && c[k] != null) el.value = c[k];
    }
    // Advanced fields present? open the panel so the user sees them.
    if ((c.q || c.port) && $('f-advPanel')) $('f-advPanel').hidden = false;
    $('searchBar').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
    window.scrollTo({ top: $('searchBar').offsetTop - 20, behavior: 'smooth' });
  }

  async function load() {
    const { ok, data } = await api('/api/searches');
    if (!ok) return;
    const list = data.searches || [];
    $('savedLabel').hidden = list.length === 0;
    $('savedList').innerHTML = list.map((s) =>
      `<span class="saved-chip" data-id="${escapeHtml(s.id)}">
        <button type="button" class="saved-chip-run" data-run="${escapeHtml(s.id)}">${s.alerts ? '🔔 ' : ''}${escapeHtml(s.name || 'Search')}</button>
        <button type="button" class="saved-chip-del" data-del="${escapeHtml(s.id)}" aria-label="Delete">×</button>
      </span>`).join('');
    window.__saved = list;
    $('savedList').querySelectorAll('[data-run]').forEach((b) =>
      b.addEventListener('click', () => {
        const s = (window.__saved || []).find((x) => x.id === b.getAttribute('data-run'));
        if (s) applyCriteria(s.criteria || {});
      }));
    $('savedList').querySelectorAll('[data-del]').forEach((b) =>
      b.addEventListener('click', async () => {
        await api('/api/searches/delete', { method: 'POST', body: { id: b.getAttribute('data-del') } });
        load();
      }));
  }

  function autoName(c) {
    const lineText = $('f-line') && $('f-line').selectedOptions[0] ? $('f-line').selectedOptions[0].textContent : c.line;
    const parts = [c.destination, lineText, c.length ? `${c.length} nights` : '', c.port].filter((x) => x && x !== 'All Cruiselines' && x !== 'Any Destination');
    return parts.slice(0, 3).join(' · ') || 'My search';
  }

  $('saveSearchBtn').addEventListener('click', () => {
    const c = readCriteria();
    $('saveName').value = autoName(c);
    $('saveForm').classList.remove('hidden');
    $('saveSearchBtn').classList.add('hidden');
    $('saveName').focus();
  });
  $('saveCancel').addEventListener('click', () => {
    $('saveForm').classList.add('hidden');
    $('saveSearchBtn').classList.remove('hidden');
  });
  $('saveConfirm').addEventListener('click', async () => {
    const c = readCriteria();
    const lineText = $('f-line') && $('f-line').selectedOptions[0] ? $('f-line').selectedOptions[0].textContent : '';
    const cruiseLine = (lineText && lineText !== 'All Cruiselines') ? lineText : (c.line || '');
    const btn = $('saveConfirm');
    btn.disabled = true;
    const { ok } = await api('/api/searches', { method: 'POST', body: { name: $('saveName').value.trim(), criteria: c, cruise_line: cruiseLine, alerts: $('saveAlerts').checked } });
    btn.disabled = false;
    if (ok) {
      $('saveForm').classList.add('hidden');
      $('saveSearchBtn').classList.remove('hidden');
      $('saveAlerts').checked = false;
      load();
    }
  });

  load();
})();
