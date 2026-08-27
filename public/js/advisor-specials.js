// Advisor "Manage Specials": create, list, edit, toggle, and delete the deals
// this advisor highlights to clients.

let SPECIALS = [];

const alertEl = () => document.getElementById('addAlert');
const val = (id) => (document.getElementById(id).value || '').trim();
const set = (id, v) => { document.getElementById(id).value = v == null ? '' : v; };

document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

async function init() {
  const u = await getMe();
  if (!u) { window.location.href = '/advisor/login?next=/advisor/specials'; return; }
  if (u.role !== 'advisor') { window.location.href = u.role === 'admin' ? '/admin' : '/app'; return; }
  if (u.status !== 'active') { window.location.href = '/advisor/pending'; return; }
  wireForm();
  wireFinder();
  document.getElementById('offAllBtn').addEventListener('click', offAll);
  document.getElementById('cancelEdit').addEventListener('click', resetForm);
  await load();
}

// --- Catalog sailing finder: pick a real sailing to auto-fill line/ship/date ---
let FINDER = [];

function finderDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || '');
  if (!m) return d || '';
  return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function optionTag(value, label) { return `<option value="${escapeHtml(value)}">${escapeHtml(label != null ? label : value)}</option>`; }

function wireFinder() {
  const lineSel = document.getElementById('finder_line');
  if (!lineSel) return;
  lineSel.addEventListener('change', () => populateFinderShips(lineSel.value));
  document.getElementById('finder_ship_sel').addEventListener('change', (e) => populateFinderDates(lineSel.value, e.target.value));
  document.getElementById('finder_date').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v === '__all__') { useAllDepartures(lineSel.value, document.getElementById('finder_ship_sel').value); return; }
    const s = FINDER.find((x) => String(x.depart_date) === v);
    if (s) useSailing(s);
    else clearPicked();
  });
  const md = document.getElementById('manual_date');
  const mi = document.getElementById('manual_itin');
  if (md) md.addEventListener('change', useManual);
  if (mi) mi.addEventListener('input', useManual);
  populateFinderLines();
}

// Show/hide the manual sailing-entry block (departure date + itinerary), used
// when the chosen ship has no departures in the catalog.
function manualShow(on) {
  const el = document.getElementById('manualEntry');
  if (el) el.classList.toggle('hidden', !on);
}

// Clear the picked sailing (hidden fields + summary), called when a higher-level
// dropdown changes and invalidates the current pick.
function clearPicked() {
  set('cruise_line', ''); set('ship', ''); set('depart_date', ''); set('sail_dates', ''); set('all_dates', ''); set('itinerary', '');
  showPicked();
  document.getElementById('finderResults').innerHTML = '';
}

async function populateFinderLines() {
  const sel = document.getElementById('finder_line');
  try {
    const data = await (await fetch('/api/sailings?facets=1', { credentials: 'same-origin', cache: 'no-cache' })).json();
    const lines = data.lines || [];
    sel.innerHTML = '<option value="">Choose cruise line…</option>' + lines.map((l) => optionTag(l)).join('');
  } catch (_) {}
}

async function populateFinderShips(line) {
  const shipSel = document.getElementById('finder_ship_sel');
  const dateSel = document.getElementById('finder_date');
  clearPicked();
  dateSel.disabled = true; dateSel.innerHTML = '<option value="">Choose departure date…</option>';
  if (!line) { shipSel.disabled = true; shipSel.innerHTML = '<option value="">Choose ship…</option>'; return; }
  shipSel.disabled = true; shipSel.innerHTML = '<option value="">Loading ships…</option>';
  let ships = [];
  try { ships = (await (await fetch('/api/ships?line=' + encodeURIComponent(line), { credentials: 'same-origin', cache: 'no-cache' })).json()).ships || []; } catch (_) {}
  shipSel.innerHTML = '<option value="">Choose ship…</option>' + ships.map((s) => optionTag(s)).join('');
  shipSel.disabled = false;
}

async function populateFinderDates(line, ship) {
  const dateSel = document.getElementById('finder_date');
  const box = document.getElementById('finderResults');
  clearPicked();
  manualShow(false);
  const md = document.getElementById('manual_date'); if (md) md.value = '';
  const mi = document.getElementById('manual_itin'); if (mi) mi.value = '';
  if (!ship) { dateSel.disabled = true; dateSel.innerHTML = '<option value="">Choose departure date…</option>'; return; }
  dateSel.disabled = true; dateSel.innerHTML = '<option value="">Loading departures…</option>';
  box.innerHTML = `<div class="finder-note">Loading all departures for ${escapeHtml(ship)}…</div>`;
  const params = new URLSearchParams();
  params.set('ship', ship);
  if (line) params.set('line', line);
  let data = {};
  try { data = await (await fetch('/api/ship-dates?' + params.toString(), { credentials: 'same-origin', cache: 'no-cache' })).json(); } catch (_) {}
  // /api/ship-dates already returns distinct, sorted departures for the ship.
  FINDER = (data.dates || []).filter((s) => s.depart_date);
  // "All departures for this ship" is always available, even when the catalog
  // returns no individual dates (some ships have no dated sailings in the feed).
  const allOpt = '<option value="__all__">🗓 All departures for this ship</option>';
  if (!FINDER.length) {
    // No catalog departures: fall back to manual date + itinerary entry.
    dateSel.innerHTML = '<option value="">No catalog dates — enter manually below</option>' + allOpt;
    dateSel.disabled = false;
    box.innerHTML = '';
    manualShow(true);
    return;
  }
  dateSel.innerHTML = '<option value="">Choose departure date…</option>' + allOpt +
    FINDER.map((s) => optionTag(s.depart_date, finderDate(s.depart_date) + (s.nights ? ` · ${s.nights} nights` : '') + (s.name ? ` · ${s.name}` : ''))).join('');
  dateSel.disabled = false;
  box.innerHTML = '';
}

function useSailing(s) {
  if (!s || !s.depart_date) return;
  set('cruise_line', s.line || '');
  set('ship', s.ship || '');
  set('depart_date', s.depart_date || '');
  set('all_dates', '');
  set('itinerary', '');
  set('sail_dates', finderDate(s.depart_date));
  showPicked(s.ship, s.line, s.depart_date, s.nights, s.departure_port);
  document.getElementById('finderResults').innerHTML =
    `<div class="finder-note finder-ok">✓ Sailing selected. Add your headline and price below.</div>`;
}

// Pick "all departures for this ship": no single date, the special covers every
// sailing of the chosen line + ship.
function useAllDepartures(line, ship) {
  if (!ship) return;
  manualShow(false);
  set('cruise_line', line || '');
  set('ship', ship);
  set('depart_date', '');
  set('all_dates', '1');
  set('itinerary', '');
  set('sail_dates', 'All departures');
  showPicked(ship, line, null, null, null, true);
  document.getElementById('finderResults').innerHTML =
    `<div class="finder-note finder-ok">✓ All departures of ${escapeHtml(ship)} selected. Add your headline and price below.</div>`;
}

// Manual entry: the advisor types the departure date and itinerary for a ship
// with no catalog departures. Uses the cruise line + ship chosen in the finder.
function useManual() {
  const line = document.getElementById('finder_line').value;
  const ship = document.getElementById('finder_ship_sel').value;
  const date = document.getElementById('manual_date').value;
  const itin = (document.getElementById('manual_itin').value || '').trim();
  if (!ship || !date) { clearPicked(); return; }
  // Selecting a manual date clears any "all departures" dropdown choice.
  const dateSel = document.getElementById('finder_date'); if (dateSel) dateSel.value = '';
  set('cruise_line', line || '');
  set('ship', ship);
  set('depart_date', date);
  set('all_dates', '');
  set('itinerary', itin);
  set('sail_dates', finderDate(date));
  showPicked(ship, line, date, null, null, false, itin);
  document.getElementById('finderResults').innerHTML =
    `<div class="finder-note finder-ok">✓ Sailing entered manually. Add your headline and price below.</div>`;
}

// Render the read-only "selected sailing" summary (or the empty prompt). When
// `all` is true the special covers every departure of the ship; `itin` is a
// manually entered itinerary to show under the ship.
function showPicked(ship, line, date, nights, port, all, itin) {
  const el = document.getElementById('pickedSailing');
  if (!el) return;
  if (!date && !all) {
    el.className = 'picked-sailing picked-empty';
    el.textContent = 'No sailing selected yet, pick a cruise line, ship, and a departure date (or all departures) above.';
    return;
  }
  el.className = 'picked-sailing picked-ok';
  if (all) {
    el.innerHTML = `✓ <strong>${escapeHtml(ship || 'Ship')}</strong>${line ? ' · ' + escapeHtml(line) : ''}` +
      `<div class="picked-sub">All departures for this ship</div>`;
    return;
  }
  const sub = [finderDate(date), nights ? nights + ' nights' : '', port, itin].filter(Boolean).join(' · ');
  el.innerHTML = `✓ <strong>${escapeHtml(ship || 'Ship')}</strong>${line ? ' · ' + escapeHtml(line) : ''}` +
    (sub ? `<div class="picked-sub">${escapeHtml(sub)}</div>` : '');
}

async function load() {
  const { ok, data } = await api('/api/advisor/specials');
  const results = document.getElementById('results');
  if (!ok) { results.innerHTML = `<div class="state">Could not load your specials.</div>`; return; }
  SPECIALS = data.specials || [];
  render();
}

function render() {
  const results = document.getElementById('results');
  if (!SPECIALS.length) {
    results.innerHTML = `<div class="state">You haven't posted any specials yet. Add one above and it will appear on the client Specials page.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${SPECIALS.map(card).join('')}</div>`;
  wireCards(results);
}

function card(s) {
  const off = s.status === 'off';
  const expired = !!s.expires_on && s.expires_on < todayISO();
  const price = s.rate_from
    ? `<span class="offer-price">${escapeHtml(money(s.rate_from))}</span>${s.brochure_price ? ` <span class="special-was">${escapeHtml(money(s.brochure_price))}</span>` : ''} <span class="special-pp">pp</span>`
    : '';
  const shipLine = [s.cruise_line, s.ship].filter(Boolean).map(escapeHtml).join(' · ');
  const badge = expired
    ? `<span class="status-badge status-declined">Expired</span>`
    : `<span class="status-badge ${off ? 'status-declined' : 'status-active'}">${off ? 'Off' : 'Active'}</span>`;
  return `<article class="lead${expired ? ' is-archived' : ''}" data-id="${escapeHtml(s.id)}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(s.headline)}</h3>
        ${shipLine ? `<div class="lead-contact">${shipLine}</div>` : ''}
      </div>
      ${badge}
    </div>
    <div class="lead-body">
      ${price ? `<div style="margin-bottom:6px;">${price}</div>` : ''}
      ${s.itinerary ? `<div class="meta"><div class="meta-row"><span class="k">Itinerary</span> ${escapeHtml(s.itinerary)}</div></div>` : ''}
      ${s.sail_dates ? `<div class="meta"><div class="meta-row"><span class="k">Sail dates</span> ${escapeHtml(s.sail_dates)}</div></div>` : ''}
      ${s.expires_on ? `<div class="meta"><div class="meta-row"><span class="k">Expires</span> ${escapeHtml(finderDate(s.expires_on))}${expired ? ' (auto-hidden from clients)' : ''}</div></div>` : ''}
      ${s.description ? `<div class="lead-notes" style="white-space:pre-line">${escapeHtml(s.description)}</div>` : ''}
      ${s.us_canada_only ? `<div class="hint">U.S. residents only</div>` : ''}
    </div>
    <div class="lead-foot" style="display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-ghost" data-toggle>${off ? 'Turn on' : 'Turn off'}</button>
      <button type="button" class="btn btn-ghost" data-edit>Edit</button>
      <button type="button" class="btn btn-danger" data-delete>Delete</button>
    </div>
  </article>`;
}

function wireCards(scope) {
  scope.querySelectorAll('.lead').forEach((cardEl) => {
    const id = cardEl.getAttribute('data-id');
    cardEl.querySelector('[data-toggle]').addEventListener('click', () => toggle(id));
    cardEl.querySelector('[data-edit]').addEventListener('click', () => startEdit(id));
    cardEl.querySelector('[data-delete]').addEventListener('click', () => del(id));
  });
}

function wireForm() {
  document.getElementById('specialForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertEl());
    const allDates = val('all_dates') === '1';
    if (!val('ship') || (!val('depart_date') && !allDates)) {
      showAlert(alertEl(), 'error', 'Please pick the cruise line and ship at the top, then choose a departure date or "All departures for this ship".');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    if (!val('headline')) { showAlert(alertEl(), 'error', 'Please enter a headline.'); return; }
    const editingId = val('editingId');
    const btn = document.getElementById('saveBtn');
    btn.disabled = true; btn.textContent = editingId ? 'Saving…' : 'Adding…';
    const body = {
      headline: val('headline'),
      cruise_line: val('cruise_line'),
      ship: val('ship'),
      sail_dates: val('sail_dates'),
      rate_from: val('rate_from'),
      brochure_price: val('brochure_price'),
      cabin_category: val('cabin_category'),
      depart_date: val('depart_date'),
      all_dates: allDates,
      itinerary: val('itinerary'),
      expires_on: val('expires_on'),
      description: val('description'),
      us_canada_only: document.getElementById('us_canada_only').checked,
    };
    const path = editingId ? '/api/advisor/specials/edit' : '/api/advisor/specials';
    if (editingId) body.id = editingId;
    const { ok, data } = await api(path, { method: 'POST', body });
    btn.disabled = false; btn.textContent = editingId ? 'Save changes' : 'Add special';
    if (!ok) { showAlert(alertEl(), 'error', (data && data.message) || 'Could not save the special.'); return; }
    resetForm();
    toast(editingId ? 'Special updated.' : 'Special added.');
    await load();
  });
}

function startEdit(id) {
  const s = SPECIALS.find((x) => x.id === id);
  if (!s) return;
  set('editingId', s.id);
  set('headline', s.headline);
  set('cruise_line', s.cruise_line);
  set('ship', s.ship);
  set('sail_dates', s.sail_dates);
  set('rate_from', s.rate_from);
  set('brochure_price', s.brochure_price);
  set('cabin_category', s.cabin_category);
  set('depart_date', s.depart_date);
  const isAll = !!s.all_dates;
  set('all_dates', isAll ? '1' : '');
  set('itinerary', s.itinerary || '');
  set('expires_on', s.expires_on);
  set('description', s.description);
  // A manual special (a departure date plus a typed itinerary) reopens with the
  // manual fields visible and filled, so it can be edited the same way.
  const isManual = !isAll && !!s.depart_date && !!s.itinerary;
  manualShow(isManual);
  if (isManual) {
    const md = document.getElementById('manual_date'); if (md) md.value = s.depart_date || '';
    const mi = document.getElementById('manual_itin'); if (mi) mi.value = s.itinerary || '';
  }
  showPicked(s.ship, s.cruise_line, s.depart_date, null, null, isAll, s.itinerary || '');
  document.getElementById('finderResults').innerHTML = (s.depart_date || isAll) ? '' :
    `<div class="finder-note">This special isn't tied to a sailing yet, please search and pick a departure (or all departures) before saving.</div>`;
  document.getElementById('us_canada_only').checked = !!s.us_canada_only;
  document.getElementById('formTitle').textContent = 'Edit special';
  document.getElementById('saveBtn').textContent = 'Save changes';
  document.getElementById('cancelEdit').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('specialForm').reset();
  set('editingId', '');
  // Reset the cascading finder dropdowns to their initial state.
  const lineSel = document.getElementById('finder_line');
  const shipSel = document.getElementById('finder_ship_sel');
  const dateSel = document.getElementById('finder_date');
  if (lineSel) lineSel.value = '';
  if (shipSel) { shipSel.innerHTML = '<option value="">Choose ship…</option>'; shipSel.disabled = true; }
  if (dateSel) { dateSel.innerHTML = '<option value="">Choose departure date…</option>'; dateSel.disabled = true; }
  manualShow(false);
  const md = document.getElementById('manual_date'); if (md) md.value = '';
  const mi = document.getElementById('manual_itin'); if (mi) mi.value = '';
  set('cruise_line', ''); set('ship', ''); set('depart_date', ''); set('sail_dates', ''); set('all_dates', ''); set('itinerary', '');
  showPicked();
  document.getElementById('finderResults').innerHTML = '';
  document.getElementById('formTitle').textContent = 'Add a special';
  document.getElementById('saveBtn').textContent = 'Add special';
  document.getElementById('cancelEdit').classList.add('hidden');
  hideAlert(alertEl());
}

async function toggle(id) {
  const s = SPECIALS.find((x) => x.id === id);
  if (!s) return;
  const status = s.status === 'off' ? 'active' : 'off';
  const { ok } = await api('/api/advisor/specials/status', { method: 'POST', body: { id, status } });
  if (ok) { await load(); toast(status === 'off' ? 'Special turned off.' : 'Special turned on.'); }
}

async function del(id) {
  if (!window.confirm('Delete this special? This cannot be undone.')) return;
  const { ok } = await api('/api/advisor/specials/delete', { method: 'POST', body: { id } });
  if (ok) { await load(); toast('Special deleted.'); }
}

async function offAll() {
  if (!SPECIALS.some((s) => s.status !== 'off')) { toast('No active specials to turn off.'); return; }
  if (!window.confirm('Turn off all your specials? They will be hidden from clients until you turn them back on.')) return;
  const { ok } = await api('/api/advisor/specials/status', { method: 'POST', body: { all: true } });
  if (ok) { await load(); toast('All your specials are now off.'); }
}

function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2600);
}

init();
