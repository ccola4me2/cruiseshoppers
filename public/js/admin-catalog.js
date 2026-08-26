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
    // Keep advancing until the whole catalog is loaded (or an error), refreshing
    // status between steps so progress is visible. Larger catalogs just take more
    // steps; the loop cap is generous.
    let first = true;
    let fails = 0;
    for (let i = 0; i < 1200; i++) {
      const path = '/api/admin/import-catalog?pages=4' + ((force && first) ? '&force=1' : '');
      const res = await api(path, { method: 'POST' });
      first = false;
      if (!res.ok || !res.data || res.data.ok === false) {
        // A single step can fail transiently (a slow batch, a brief upstream
        // blip). The cursor is saved, so retry a few times before giving up.
        fails++;
        if (fails > 6) { showAlert(document.getElementById('alert'), 'error', 'Import kept failing. Progress is saved — click “Run a step now” to resume, or wait for the 15-minute auto-run.'); break; }
        note.textContent = `Retrying (a step hiccuped)… ${fails}/6`;
        await new Promise((r) => setTimeout(r, 1200));
        continue;
      }
      fails = 0;
      const data = res.data;
      await loadStatus();
      if (data.skipped) { note.textContent = 'Already fully imported for the current snapshot.'; break; }
      note.textContent = `Imported ${Number(data.imported || 0).toLocaleString()} sailings so far…`;
      if (data.done) { note.textContent = `Done — ${Number(data.imported || 0).toLocaleString()} sailings loaded.`; break; }
    }
  } catch (e) {
    showAlert(document.getElementById('alert'), 'error', 'Import failed. Please try again.');
  }
  runBtn.disabled = false; forceBtn.disabled = false;
  RUNNING = false;
}

init();
