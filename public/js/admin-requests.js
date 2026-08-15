// Admin: every client quote request with its quote status.

let REQUESTS = [];
let FILTER = 'all';

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin/requests'; return; }
  if (user.role !== 'admin') { window.location.href = '/'; return; }
  renderNav(user);
  wireTabs();
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

function wireTabs() {
  document.querySelectorAll('#tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      FILTER = btn.getAttribute('data-filter');
      document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      render();
    });
  });
}

function wireFilters() {
  document.getElementById('q').addEventListener('input', render);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    render();
  });
}

async function load() {
  const res = await fetch('/api/admin/requests', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin/requests'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load requests right now. Please try again.</div>`; return; }
  REQUESTS = data.requests || [];
  render();
}

function statusOf(r) {
  if ((r.accepted_count || 0) > 0) return 'accepted';
  if ((r.offer_count || 0) > 0) return 'quoted';
  return 'awaiting';
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
  let list = REQUESTS.filter((r) => (FILTER === 'all' ? true : statusOf(r) === FILTER));
  if (q) {
    list = list.filter((r) => [r.first_name, r.last_name, r.email, r.cruise_line, r.ship, r.sailing_name, r.destination]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  const counts = REQUESTS.reduce((m, r) => { const s = statusOf(r); m[s] = (m[s] || 0) + 1; return m; }, {});
  document.getElementById('count').textContent =
    `${counts.awaiting || 0} awaiting · ${counts.quoted || 0} quoted · ${counts.accepted || 0} accepted`;
  if (!list.length) {
    results.innerHTML = `<div class="state">${REQUESTS.length ? 'No requests match.' : 'No quote requests yet.'}</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(card).join('')}</div>`;
}

function badge(s) {
  if (s === 'accepted') return `<span class="status-badge status-active">Accepted</span>`;
  if (s === 'quoted') return `<span class="status-badge status-pending">Quoted</span>`;
  return `<span class="status-badge status-declined">Awaiting quotes</span>`;
}

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function card(r) {
  const client = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client';
  const s = statusOf(r);
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(r.sailing_name || r.ship || 'Cruise request')}</h3>
        <div class="lead-sub">${escapeHtml(client)}${r.email ? ` &middot; <a href="mailto:${escapeHtml(r.email)}">${escapeHtml(r.email)}</a>` : ''}</div>
      </div>
      ${badge(s)}
    </div>
    <div class="lead-grid">
      ${r.cruise_line ? row('Cruise line', r.cruise_line) : ''}
      ${r.ship ? row('Ship', r.ship) : ''}
      ${r.sailing_dates ? row('Sailing', r.sailing_dates) : ''}
      ${r.departure_port ? row('Departs', r.departure_port) : ''}
      ${r.phone ? row('Phone', r.phone) : ''}
      ${row('Quotes', String(r.offer_count || 0))}
      ${row('Requested', niceDateTime(r.created_at))}
      ${r.notes ? row('Details', r.notes) : ''}
    </div>
  </article>`;
}

init();
