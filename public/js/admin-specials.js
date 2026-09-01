// Admin: every advisor special across all advisors. Archive (hide from the
// public listing) or permanently delete.

let SPECIALS = [];
let ADVISORS = []; // active advisors, for the "listed by" reassign dropdown

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin/specials'; return; }
  if (user.role !== 'admin') { window.location.href = '/'; return; }
  renderNav(user);
  wireFilters();
  await load();
}

function renderNav(user) {
  const nav = document.getElementById('accountNav');
  nav.innerHTML =
    `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">${escapeHtml(user.first_name || 'Admin')}</span>` +
    `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
  nav.querySelector('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

function wireFilters() {
  document.getElementById('q').addEventListener('input', render);
  document.getElementById('showArchived').addEventListener('change', render);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('showArchived').checked = false;
    render();
  });
  document.getElementById('results').addEventListener('click', onAction);
  document.getElementById('results').addEventListener('change', onReassign);
}

// Reassign a special to a different advisor: its public name/agency and lead
// routing follow the chosen advisor.
async function onReassign(e) {
  const sel = e.target.closest('select[data-reassign]');
  if (!sel) return;
  const id = sel.getAttribute('data-id');
  const advisorId = sel.value;
  const special = SPECIALS.find((s) => s.id === id);
  if (!id || !advisorId || !special || advisorId === special.advisor_id) return;
  const prev = special.advisor_id;
  sel.disabled = true;
  try {
    const res = await fetch('/api/admin/special-reassign', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, advisor_id: advisorId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.message || 'Could not reassign the special.'); sel.value = prev || ''; sel.disabled = false; return; }
    special.advisor_id = advisorId;
    special.advisor_name = data.advisor_name || special.advisor_name;
    const adv = ADVISORS.find((a) => a.id === advisorId);
    special.advisor_agency = adv ? (adv.agency || null) : special.advisor_agency;
    special.advisor_email = adv ? (adv.email || null) : special.advisor_email;
    render();
  } catch (_) {
    alert('Something went wrong. Please try again.');
    sel.value = prev || ''; sel.disabled = false;
  }
}

async function onAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  if (!id) return;
  if (act === 'delete' && !confirm('Permanently delete this special? This cannot be undone.')) return;
  btn.disabled = true;
  try {
    if (act === 'delete') {
      const res = await fetch('/api/admin/special-delete', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not delete the special.'); btn.disabled = false; return; }
      SPECIALS = SPECIALS.filter((s) => s.id !== id);
    } else {
      const archived = act === 'archive';
      const res = await fetch('/api/admin/special-archive', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not update the special.'); btn.disabled = false; return; }
      const s = SPECIALS.find((x) => x.id === id);
      if (s) s.status = archived ? 'archived' : 'active';
    }
    render();
  } catch (_) {
    alert('Something went wrong. Please try again.');
    btn.disabled = false;
  }
}

async function load() {
  const res = await fetch('/api/admin/specials', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin/specials'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load specials right now. Please try again.</div>`; return; }
  SPECIALS = data.specials || [];
  // Advisors for the "listed by" dropdown (active advisors only).
  try {
    const ar = await fetch('/api/admin/advisors', { credentials: 'same-origin' });
    const ad = await ar.json().catch(() => ({}));
    ADVISORS = (ad.advisors || [])
      .filter((a) => a.status === 'active')
      .map((a) => ({ id: a.id, name: [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email, agency: a.agency, email: a.email }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (_) { ADVISORS = []; }
  render();
}

function advisorOptions(selectedId) {
  const opts = ADVISORS.map((a) => {
    const label = a.agency ? `${a.name} — ${a.agency}` : a.name;
    return `<option value="${escapeHtml(a.id)}"${a.id === selectedId ? ' selected' : ''}>${escapeHtml(label)}</option>`;
  });
  // If the current advisor isn't in the active list (e.g. suspended), keep them selectable so we don't silently drop them.
  if (selectedId && !ADVISORS.some((a) => a.id === selectedId)) {
    opts.unshift(`<option value="${escapeHtml(selectedId)}" selected>Current advisor</option>`);
  }
  return opts.join('');
}

function niceDate(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusLabel(s) {
  if (s.status === 'archived') return '<span class="status-badge status-declined">Archived</span>';
  if (s.status === 'off') return '<span class="status-badge status-pending">Off</span>';
  return '<span class="status-badge status-active">Active</span>';
}

function render() {
  const results = document.getElementById('results');
  const q = document.getElementById('q').value.trim().toLowerCase();
  const showArchived = document.getElementById('showArchived').checked;
  const active = SPECIALS.filter((s) => s.status !== 'archived');
  const archivedCount = SPECIALS.length - active.length;
  const list = SPECIALS.filter((s) => {
    if (!showArchived && s.status === 'archived') return false;
    if (!q) return true;
    const hay = [s.advisor_name, s.advisor_email, s.advisor_agency, s.cruise_line, s.ship, s.headline, s.description]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  document.getElementById('count').textContent =
    `${active.length} special${active.length === 1 ? '' : 's'}` +
    (archivedCount ? ` · ${archivedCount} archived` : '') +
    (q || showArchived ? ` · ${list.length} shown` : '');
  if (!list.length) {
    const msg = SPECIALS.length
      ? (archivedCount && !showArchived ? 'No active specials. Tick “Show archived” to see archived ones.' : 'No specials match your search.')
      : 'No specials posted yet.';
    results.innerHTML = `<div class="state">${msg}</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(card).join('')}</div>`;
}

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function card(s) {
  const id = escapeHtml(s.id);
  const archived = s.status === 'archived';
  const rate = s.rate_from ? (typeof money === 'function' ? money(s.rate_from) : ('$' + s.rate_from)) : '';
  const actions = archived
    ? `<button type="button" class="btn btn-ghost btn-sm" data-act="unarchive" data-id="${id}">Unarchive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-act="archive" data-id="${id}">Archive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`;
  return `<article class="lead${archived ? ' is-archived' : ''}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(s.headline || s.ship || s.cruise_line || 'Special')}</h3>
        <div class="lead-sub">${escapeHtml(s.advisor_name)}${s.advisor_email ? ` &middot; <a href="mailto:${escapeHtml(s.advisor_email)}">${escapeHtml(s.advisor_email)}</a>` : ''}</div>
      </div>
      ${statusLabel(s)}
    </div>
    <div class="lead-grid">
      ${s.cruise_line ? row('Cruise line', s.cruise_line) : ''}
      ${s.ship ? row('Ship', s.ship) : ''}
      ${s.sail_dates ? row('Sail dates', s.sail_dates) : ''}
      ${rate ? row('Rate from', rate) : ''}
      ${s.advisor_agency ? row('Agency', s.advisor_agency) : ''}
      ${row('Posted', niceDate(s.created_at))}
      ${s.description ? row('Description', s.description) : ''}
    </div>
    <div class="lead-row" style="align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="lead-k">Listed by</span>
      <select data-reassign data-id="${id}" style="padding:7px 10px;border:1px solid var(--line);border-radius:8px;max-width:320px;">
        ${advisorOptions(s.advisor_id)}
      </select>
    </div>
    <div class="lead-actions">${actions}</div>
  </article>`;
}

init();
