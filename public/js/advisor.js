// Advisor dashboard: lists client quote requests (leads).

let ALL = [];

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/advisor/login?next=/advisor'; return; }
  if (user.role !== 'advisor') { window.location.href = '/app'; return; }
  renderAdvisorNav(user);
  await load();
  wireFilters();
}

function renderAdvisorNav(user) {
  const nav = document.getElementById('accountNav');
  nav.innerHTML =
    `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">${escapeHtml(user.first_name || 'Advisor')}</span>` +
    `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
  nav.querySelector('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

async function load() {
  const res = await fetch('/api/quotes', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/advisor/login?next=/advisor'; return; }
  if (res.status === 403) { window.location.href = '/app'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load leads right now. Please try again.</div>`; return; }

  ALL = data.leads || [];
  const lines = [...new Set(ALL.map((l) => l.cruise_line).filter(Boolean))].sort();
  const sel = document.getElementById('line');
  sel.innerHTML = `<option value="">All lines</option>` + lines.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  render(ALL);
}

function applyFilters() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const line = document.getElementById('line').value.toLowerCase();
  const filtered = ALL.filter((l) => {
    if (line && (l.cruise_line || '').toLowerCase() !== line) return false;
    if (q) {
      const hay = [l.first_name, l.last_name, l.email, l.cruise_line, l.ship, l.destination, l.sailing_name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  render(filtered);
}

function render(list) {
  const results = document.getElementById('results');
  document.getElementById('count').textContent = `${list.length} request${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    results.innerHTML = `<div class="state">No quote requests yet. New client requests will appear here.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(leadCard).join('')}</div>`;
  results.querySelectorAll('[data-itin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.lead').querySelector('.itin');
      const open = panel.classList.toggle('open');
      btn.textContent = open ? 'Hide itinerary' : 'View itinerary';
    });
  });
}

function leadCard(l) {
  const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Client';
  const when = niceDateTime(l.created_at);
  const itin = (l.itinerary || []).length
    ? `<ol>${l.itinerary.map((d) => `<li><span class="d">Day ${escapeHtml(String(d.day))}${d.port ? ':' : ''}</span> ${escapeHtml(d.port || d.note || 'At sea')}</li>`).join('')}</ol>`
    : `<p class="no-price">No detailed itinerary provided.</p>`;
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(name)}</h3>
        <div class="lead-contact">
          ${l.email ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>` : ''}
          ${l.phone ? ` &middot; <a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>` : ''}
        </div>
      </div>
      <div class="lead-when">${escapeHtml(when)}</div>
    </div>
    <div class="lead-body">
      ${l.cruise_line ? `<span class="line-badge">${escapeHtml(l.cruise_line)}</span>` : ''}
      <div class="lead-sailing">${escapeHtml(l.sailing_name || l.ship || l.destination || 'Cruise request')}</div>
      <div class="meta">
        ${l.ship ? metaRow('Ship', l.ship) : ''}
        ${l.sailing_dates ? metaRow('Sailing', l.sailing_dates) : ''}
        ${l.departure_port ? metaRow('Departs', l.departure_port) : ''}
        ${l.destination ? metaRow('Destination', l.destination) : ''}
      </div>
      ${l.notes ? `<div class="lead-notes"><span class="k">Note</span> ${escapeHtml(l.notes)}</div>` : ''}
      <div class="itin-toggle"><button type="button" data-itin>View itinerary</button></div>
      <div class="itin">${itin}</div>
    </div>
    <div class="lead-foot">
      ${l.email ? `<a class="btn btn-primary" href="mailto:${escapeHtml(l.email)}?subject=${encodeURIComponent('Your CruiseShoppers quote')}">Email client</a>` : ''}
    </div>
  </article>`;
}

function metaRow(k, v) {
  return `<div class="meta-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`;
}

function niceDateTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function wireFilters() {
  document.getElementById('q').addEventListener('input', applyFilters);
  document.getElementById('line').addEventListener('change', applyFilters);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('line').value = '';
    render(ALL);
  });
}

init();
