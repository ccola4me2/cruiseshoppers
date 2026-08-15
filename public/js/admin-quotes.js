// Admin: every advisor quote across all advisors.

let OFFERS = [];

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
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    render();
  });
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
  const list = OFFERS.filter((o) => {
    if (!q) return true;
    const hay = [o.advisor_name, o.advisor_email, o.client_first, o.client_last, o.client_email,
      o.cruise_line, o.ship, o.sailing_name, o.price].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });
  document.getElementById('count').textContent =
    `${OFFERS.length} quote${OFFERS.length === 1 ? '' : 's'}${q ? ` · ${list.length} shown` : ''}`;
  if (!list.length) {
    results.innerHTML = `<div class="state">${OFFERS.length ? 'No quotes match your search.' : 'No advisor quotes submitted yet.'}</div>`;
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
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}</h3>
        <div class="lead-sub">${escapeHtml(advisor)}${o.advisor_email ? ` &middot; <a href="mailto:${escapeHtml(o.advisor_email)}">${escapeHtml(o.advisor_email)}</a>` : ''}</div>
      </div>
      <span class="status-badge status-active">${escapeHtml(o.price || 'Quoted')}</span>
    </div>
    <div class="lead-grid">
      ${row('Client', client)}
      ${o.client_email ? row('Client email', o.client_email) : ''}
      ${o.cruise_line ? row('Cruise line', o.cruise_line) : ''}
      ${o.ship ? row('Ship', o.ship) : ''}
      ${o.sailing_dates ? row('Sailing', o.sailing_dates) : ''}
      ${o.departure_port ? row('Departs', o.departure_port) : ''}
      ${row('Price', o.price)}
      ${row('Submitted', niceDateTime(o.created_at))}
      ${o.specials ? row('Specials', o.specials) : ''}
      ${o.additional_info ? row('Additional info', o.additional_info) : ''}
    </div>
  </article>`;
}

init();
