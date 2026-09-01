// Admin: every advisor quote across all advisors.

let OFFERS = [];
let STATS = { accepted: 0, booked: 0 };

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin/quotes'; return; }
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
  // Delegate archive / unarchive / delete actions.
  document.getElementById('results').addEventListener('click', onAction);
}

async function onAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  if (!id) return;
  if (act === 'delete') {
    if (!confirm('Permanently delete this quote? This cannot be undone.')) return;
  }
  btn.disabled = true;
  try {
    if (act === 'delete') {
      const res = await fetch('/api/admin/offer-delete', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not delete the quote.'); btn.disabled = false; return; }
      OFFERS = OFFERS.filter((o) => o.id !== id);
    } else {
      const archived = act === 'archive';
      const res = await fetch('/api/admin/offer-archive', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not update the quote.'); btn.disabled = false; return; }
      const o = OFFERS.find((x) => x.id === id);
      if (o) o.archived_at = archived ? Date.now() : null;
    }
    render();
  } catch (_) {
    alert('Something went wrong. Please try again.');
    btn.disabled = false;
  }
}

async function load() {
  const res = await fetch('/api/admin/offers', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin/quotes'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load quotes right now. Please try again.</div>`; return; }
  OFFERS = data.offers || [];
  STATS = { accepted: data.accepted || 0, booked: data.booked || 0 };
  render();
}

function niceDateTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function render() {
  const results = document.getElementById('results');
  const q = document.getElementById('q').value.trim().toLowerCase();
  const showArchived = document.getElementById('showArchived').checked;
  const active = OFFERS.filter((o) => !o.archived_at);
  const archivedCount = OFFERS.length - active.length;
  const list = OFFERS.filter((o) => {
    if (!showArchived && o.archived_at) return false;
    if (!q) return true;
    const hay = [o.advisor_name, o.advisor_email, o.client_first, o.client_last, o.client_email,
      o.cruise_line, o.ship, o.sailing_name, o.price].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  const winRate = STATS.accepted ? Math.round((STATS.booked / STATS.accepted) * 100) : 0;
  document.getElementById('count').textContent =
    `${active.length} quote${active.length === 1 ? '' : 's'}` +
    (archivedCount ? ` · ${archivedCount} archived` : '') +
    (q || showArchived ? ` · ${list.length} shown` : '') +
    (STATS.accepted ? ` · ${STATS.booked}/${STATS.accepted} accepted booked (${winRate}%)` : '');
  if (!list.length) {
    const msg = OFFERS.length
      ? (archivedCount && !showArchived ? 'No active quotes. Tick “Show archived” to see archived quotes.' : 'No quotes match your search.')
      : 'No advisor quotes submitted yet.';
    results.innerHTML = `<div class="state">${msg}</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(card).join('')}</div>`;
}

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function card(o) {
  const client = [o.client_first, o.client_last].filter(Boolean).join(' ') || 'Client';
  const advisor = o.advisor_name || o.advisor_email || 'Advisor';
  const id = escapeHtml(o.id);
  const archived = !!o.archived_at;
  const actions = archived
    ? `<button type="button" class="btn btn-ghost btn-sm" data-act="unarchive" data-id="${id}">Unarchive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-act="archive" data-id="${id}">Archive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`;
  const cabinRows = (Array.isArray(o.cabin_fares) && o.cabin_fares.length)
    ? row(o.quote_kind === 'cabins' ? 'Cabins' : 'Options (picks one)', '') + o.cabin_fares.map((c) => {
        const t = (c && c.type || '').trim();
        const code = (c && c.code || '').trim();
        const label = t && code ? `${t} (${code})` : (t || (code ? `Cabin (${code})` : 'Cabin'));
        return row(label, money(c.fare));
      }).join('') + (o.quote_kind === 'cabins' && o.total_price != null ? row('Total', money(o.total_price)) : '')
    : '';
  const contactBits = [];
  if (o.advisor_email) contactBits.push(`<a href="mailto:${escapeHtml(o.advisor_email)}">${escapeHtml(o.advisor_email)}</a>`);
  if (o.advisor_phone) contactBits.push(`<a href="tel:${escapeHtml(String(o.advisor_phone).replace(/[^0-9+]/g, ''))}">${escapeHtml(o.advisor_phone)}</a>`);
  const agencyLine = [o.advisor_agency, o.advisor_location].filter(Boolean).map(escapeHtml).join(' · ');
  return `<article class="lead${archived ? ' is-archived' : ''}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}${archived ? ' <span class="status-badge status-declined">Archived</span>' : ''}</h3>
        <div class="lead-sub" style="font-weight:600;color:var(--navy);">${escapeHtml(advisor)}</div>
        ${agencyLine ? `<div class="lead-sub">${agencyLine}</div>` : ''}
        ${contactBits.length ? `<div class="lead-sub">${contactBits.join(' &middot; ')}</div>` : ''}
      </div>
      <span class="status-badge status-active">${o.price ? escapeHtml(money(o.price)) : 'Quoted'}</span>
    </div>
    <div class="lead-grid">
      ${row('Client', client)}
      ${o.client_email ? row('Client email', o.client_email) : ''}
      ${o.cruise_line ? row('Cruise line', o.cruise_line) : ''}
      ${o.ship ? row('Ship', o.ship) : ''}
      ${o.sailing_dates ? row('Sailing', o.sailing_dates) : ''}
      ${o.departure_port ? row('Departs', o.departure_port) : ''}
      ${cabinRows}
      ${row('Price', money(o.price))}
      ${o.insurance_amount != null ? row('Cruise insurance', money(o.insurance_amount)) : ''}
      ${o.booking_status ? row('Booking', o.booking_status === 'booked' ? `Booked${o.booking_amount ? ' · ' + money(o.booking_amount) : ''}${o.booking_ref ? ' · Ref ' + o.booking_ref : ''}` : 'Not booked') : ''}
      ${row('Submitted', niceDateTime(o.created_at))}
      ${o.specials ? row('Specials', o.specials) : ''}
      ${o.additional_info ? row('Additional info', o.additional_info) : ''}
    </div>
    <div class="lead-actions">${actions}</div>
  </article>`;
}

init();
