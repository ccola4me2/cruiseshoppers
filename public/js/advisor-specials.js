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

function wireFinder() {
  const btn = document.getElementById('finderBtn');
  if (!btn) return;
  btn.addEventListener('click', runFinder);
  document.getElementById('finder_ship').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFinder(); }
  });
  document.getElementById('finderResults').addEventListener('click', (e) => {
    const b = e.target.closest('[data-use]');
    if (b) useSailing(FINDER[Number(b.getAttribute('data-use'))]);
  });
}

async function runFinder() {
  const ship = val('finder_ship');
  const month = val('finder_month'); // YYYY-MM or ''
  const box = document.getElementById('finderResults');
  if (!ship && !month) { box.innerHTML = `<div class="finder-note">Enter a ship name to search.</div>`; return; }
  box.innerHTML = `<div class="finder-note">Searching the catalog…</div>`;
  const params = new URLSearchParams();
  if (ship) params.set('q', ship);
  if (/^\d{4}-\d{2}$/.test(month)) params.set('month', month);
  let data = {};
  try {
    const res = await fetch('/api/sailings?' + params.toString(), { credentials: 'same-origin' });
    data = await res.json();
    if (!res.ok) { box.innerHTML = `<div class="finder-note">${escapeHtml((data && data.message) || 'Could not search right now.')}</div>`; return; }
  } catch (_) {
    box.innerHTML = `<div class="finder-note">Could not search right now. Please try again.</div>`; return;
  }
  const sailings = (data.sailings || []).filter((s) => s.depart_date);
  sailings.sort((a, b) => String(a.depart_date).localeCompare(String(b.depart_date)));
  FINDER = sailings.slice(0, 40);
  if (!FINDER.length) {
    box.innerHTML = `<div class="finder-note">No sailings found. Try a different ship name or month.</div>`;
    return;
  }
  box.innerHTML = FINDER.map((s, i) => `
    <div class="finder-row">
      <div class="finder-info">
        <strong>${escapeHtml(s.ship || 'Ship')}</strong>${s.line ? ` &middot; ${escapeHtml(s.line)}` : ''}
        <div class="finder-sub">${escapeHtml(finderDate(s.depart_date))}${s.nights ? ` &middot; ${s.nights} nights` : ''}${s.departure_port ? ` &middot; ${escapeHtml(s.departure_port)}` : ''}</div>
      </div>
      <button type="button" class="btn btn-ghost btn-sm" data-use="${i}">Use this</button>
    </div>`).join('');
}

function useSailing(s) {
  if (!s || !s.depart_date) return;
  set('cruise_line', s.line || '');
  set('ship', s.ship || '');
  set('depart_date', s.depart_date || '');
  set('sail_dates', finderDate(s.depart_date));
  showPicked(s.ship, s.line, s.depart_date, s.nights, s.departure_port);
  document.getElementById('finderResults').innerHTML =
    `<div class="finder-note finder-ok">✓ Sailing selected. Add your headline and price below.</div>`;
}

// Render the read-only "selected sailing" summary (or the empty prompt).
function showPicked(ship, line, date, nights, port) {
  const el = document.getElementById('pickedSailing');
  if (!el) return;
  if (!date) {
    el.className = 'picked-sailing picked-empty';
    el.textContent = 'No sailing selected yet — search and pick one above.';
    return;
  }
  el.className = 'picked-sailing picked-ok';
  const sub = [finderDate(date), nights ? nights + ' nights' : '', port].filter(Boolean).join(' · ');
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
  const price = s.rate_from
    ? `<span class="offer-price">${escapeHtml(money(s.rate_from))}</span>${s.brochure_price ? ` <span class="special-was">${escapeHtml(money(s.brochure_price))}</span>` : ''} <span class="special-pp">pp</span>`
    : '';
  const shipLine = [s.cruise_line, s.ship].filter(Boolean).map(escapeHtml).join(' · ');
  return `<article class="lead" data-id="${escapeHtml(s.id)}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(s.headline)}</h3>
        ${shipLine ? `<div class="lead-contact">${shipLine}</div>` : ''}
      </div>
      <span class="status-badge ${off ? 'status-declined' : 'status-active'}">${off ? 'Off' : 'Active'}</span>
    </div>
    <div class="lead-body">
      ${price ? `<div style="margin-bottom:6px;">${price}</div>` : ''}
      ${s.sail_dates ? `<div class="meta"><div class="meta-row"><span class="k">Sail dates</span> ${escapeHtml(s.sail_dates)}</div></div>` : ''}
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
    if (!val('depart_date') || !val('ship')) {
      showAlert(alertEl(), 'error', 'Please search and pick the exact sailing at the top — every special must be tied to one specific departure.');
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
  set('description', s.description);
  showPicked(s.ship, s.cruise_line, s.depart_date);
  document.getElementById('finderResults').innerHTML = s.depart_date ? '' :
    `<div class="finder-note">This special isn't tied to a specific sailing yet — please search and pick its exact departure before saving.</div>`;
  document.getElementById('us_canada_only').checked = !!s.us_canada_only;
  document.getElementById('formTitle').textContent = 'Edit special';
  document.getElementById('saveBtn').textContent = 'Save changes';
  document.getElementById('cancelEdit').classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function resetForm() {
  document.getElementById('specialForm').reset();
  set('editingId', '');
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
