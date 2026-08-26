// Admin: monitor and advance the CruiseFeed -> D1 catalog import.

let RUNNING = false;

async function init() {
  const u = await getMe();
  if (!u) { window.location.href = '/admin/login?next=/admin/catalog'; return; }
  if (u.role !== 'admin') { window.location.href = '/'; return; }
  renderAccountNav(document.getElementById('accountNav'));
  document.getElementById('runBtn').addEventListener('click', () => runStep(false));
  document.getElementById('forceBtn').addEventListener('click', () => {
    if (window.confirm('Re-import the entire catalog from scratch? This is safe but uses API results allowance.')) runStep(true);
  });
  document.getElementById('refreshBtn').addEventListener('click', loadStatus);
  await loadStatus();
}

function fmtWhen(ms) {
  const n = Number(ms);
  if (!n) return '—';
  try { return new Date(n).toLocaleString(); } catch { return String(ms); }
}

async function loadStatus() {
  const box = document.getElementById('status');
  const { ok, data } = await api('/api/admin/import-status');
  if (!ok) { box.innerHTML = `<div class="state">Could not load status.</div>`; return; }
  if (!data.configured) { box.innerHTML = `<div class="state">Database not configured.</div>`; return; }
  const done = data.cycle_done === '1';
  const rows = [
    ['Sailings in database', data.rows_in_db != null ? Number(data.rows_in_db).toLocaleString() : '—'],
    ['Distinct ships', data.distinct_ships != null ? Number(data.distinct_ships).toLocaleString() : '—'],
    ['Snapshot date (CruiseFeed)', data.imported_as_of || '—'],
    ['Import complete for this snapshot', done ? 'Yes ✓' : 'No — more to load'],
    ['Rows imported so far', data.row_count != null ? Number(data.row_count).toLocaleString() : '—'],
    ['API results remaining this month', data.last_remaining ? Number(data.last_remaining).toLocaleString() : '—'],
    ['Last run', fmtWhen(data.last_run)],
    ['Last full import', fmtWhen(data.last_full_import)],
  ];
  box.innerHTML = rows.map(([k, v]) =>
    `<div class="meta-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span></div>`
  ).join('');
}

async function runStep(force) {
  if (RUNNING) return;
  RUNNING = true;
  const note = document.getElementById('runNote');
  const runBtn = document.getElementById('runBtn');
  const forceBtn = document.getElementById('forceBtn');
  runBtn.disabled = true; forceBtn.disabled = true;
  hideAlert(document.getElementById('alert'));
  note.textContent = force ? 'Starting a full rebuild…' : 'Running an import step…';
  try {
    // Keep advancing until the snapshot is fully loaded (or an error), refreshing
    // status between steps so progress is visible.
    let first = true;
    for (let i = 0; i < 60; i++) {
      const path = '/api/admin/import-catalog?pages=25' + ((force && first) ? '&force=1' : '');
      first = false;
      const { ok, data } = await api(path, { method: 'POST' });
      if (!ok) { showAlert(document.getElementById('alert'), 'error', (data && data.reason) || 'Import step failed.'); break; }
      await loadStatus();
      if (data.skipped) { note.textContent = 'Already fully imported for the current snapshot.'; break; }
      note.textContent = `Imported ${Number(data.imported || 0).toLocaleString()} sailings so far…`;
      if (data.done) { note.textContent = `Done — ${Number(data.imported || 0).toLocaleString()} sailings loaded.`; break; }
      if (data.remaining != null && data.remaining < 3000) { note.textContent = 'Stopped to protect your monthly API allowance. Run again next month or after quota resets.'; break; }
    }
  } catch (e) {
    showAlert(document.getElementById('alert'), 'error', 'Import failed. Please try again.');
  }
  runBtn.disabled = false; forceBtn.disabled = false;
  RUNNING = false;
}

init();
