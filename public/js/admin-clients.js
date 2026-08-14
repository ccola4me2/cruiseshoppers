// Admin: list client accounts with signup, last log-in, and quote activity.

let CLIENTS = [];

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/login?next=/admin/clients'; return; }
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
  const res = await fetch('/api/admin/clients', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/login?next=/admin/clients'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load clients right now. Please try again.</div>`; return; }
  CLIENTS = data.clients || [];
  render();
}

function niceDateTime(ms) {
  if (!ms) return null;
  const d = new Date(Number(ms));
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function render() {
  const results = document.getElementById('results');
  const q = document.getElementById('q').value.trim().toLowerCase();
  const list = CLIENTS.filter((c) => {
    if (!q) return true;
    const hay = [c.first_name, c.last_name, c.email, c.phone].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(q);
  });

  document.getElementById('count').textContent =
    `${CLIENTS.length} client${CLIENTS.length === 1 ? '' : 's'}${q ? ` · ${list.length} shown` : ''}`;

  if (!list.length) {
    results.innerHTML = `<div class="state">${CLIENTS.length ? 'No clients match your search.' : 'No client accounts yet.'}</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(card).join('')}</div>`;
}

function row(label, value) {
  if (!value) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(label)}</span><span class="lead-v">${escapeHtml(value)}</span></div>`;
}

function card(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  const lastLogin = niceDateTime(c.last_login_at);
  const quotes = c.quote_count || 0;
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3 class="lead-name">${escapeHtml(name)}</h3>
        <div class="lead-sub"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>
      </div>
      ${quotes ? `<span class="status-badge status-active">${quotes} quote${quotes === 1 ? '' : 's'}</span>` : `<span class="status-badge status-pending">No quotes</span>`}
    </div>
    <div class="lead-grid">
      ${row('Phone', c.phone)}
      ${row('Registered', niceDateTime(c.created_at))}
      ${row('Last log-in', lastLogin || 'Not since tracking began')}
      ${row('Quote requests', String(quotes))}
    </div>
  </article>`;
}

init();
