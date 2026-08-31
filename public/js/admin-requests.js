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
  document.getElementById('showArchived').addEventListener('change', render);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('showArchived').checked = false;
    render();
  });
  // Delegate archive / unarchive / delete actions on the cards.
  document.getElementById('results').addEventListener('click', onAction);
}

async function onAction(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.getAttribute('data-id');
  const act = btn.getAttribute('data-act');
  if (!id) return;
  if (act === 'delete' && !confirm('Permanently delete this request and any quotes on it? This cannot be undone.')) return;
  btn.disabled = true;
  try {
    if (act === 'delete') {
      const res = await fetch('/api/admin/request-delete', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not delete the request.'); btn.disabled = false; return; }
      REQUESTS = REQUESTS.filter((r) => r.id !== id);
    } else {
      const archived = act === 'archive';
      const res = await fetch('/api/admin/request-archive', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.message || 'Could not update the request.'); btn.disabled = false; return; }
      const r = REQUESTS.find((x) => x.id === id);
      if (r) r.archived_at = archived ? Date.now() : null;
    }
    render();
  } catch (_) {
    alert('Something went wrong. Please try again.');
    btn.disabled = false;
  }
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
  const showArchived = document.getElementById('showArchived').checked;
  const active = REQUESTS.filter((r) => !r.archived_at);
  const archivedCount = REQUESTS.length - active.length;
  let list = REQUESTS.filter((r) => {
    if (!showArchived && r.archived_at) return false;
    return FILTER === 'all' ? true : statusOf(r) === FILTER;
  });
  if (q) {
    list = list.filter((r) => [r.first_name, r.last_name, r.email, r.cruise_line, r.ship, r.sailing_name, r.destination]
      .filter(Boolean).join(' ').toLowerCase().includes(q));
  }
  const counts = active.reduce((m, r) => { const s = statusOf(r); m[s] = (m[s] || 0) + 1; return m; }, {});
  document.getElementById('count').textContent =
    `${counts.awaiting || 0} awaiting · ${counts.quoted || 0} quoted · ${counts.accepted || 0} accepted` +
    (archivedCount ? ` · ${archivedCount} archived` : '');
  if (!list.length) {
    const msg = !REQUESTS.length ? 'No quote requests yet.'
      : (archivedCount && !showArchived ? 'No active requests. Tick “Show archived” to see archived ones.' : 'No requests match.');
    results.innerHTML = `<div class="state">${msg}</div>`;
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

// Human-readable one-line summary of where a lead came from (UTM / referrer).
function attrSummary(a) {
  if (!a || typeof a !== 'object') return '';
  if (a.source) {
    let out = a.source;
    if (a.medium) out += ` / ${a.medium}`;
    if (a.campaign) out += ` · ${a.campaign}`;
    if (a.content) out += ` (${a.content})`;
    if (a.term) out += ` [${a.term}]`;
    return out;
  }
  if (a.referrer) return `Referral: ${a.referrer}`;
  return '';
}

function card(r) {
  const client = [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client';
  const s = statusOf(r);
  const archived = !!r.archived_at;
  const id = escapeHtml(r.id);
  const actions = archived
    ? `<button type="button" class="btn btn-ghost btn-sm" data-act="unarchive" data-id="${id}">Unarchive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`
    : `<button type="button" class="btn btn-ghost btn-sm" data-act="archive" data-id="${id}">Archive</button>
       <button type="button" class="btn btn-danger btn-sm" data-act="delete" data-id="${id}">Delete</button>`;
  return `<article class="lead${archived ? ' is-archived' : ''}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(r.sailing_name || r.ship || 'Cruise request')}${archived ? ' <span class="status-badge status-declined">Archived</span>' : ''}</h3>
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
      ${attrSummary(r.attribution) ? row('Lead source', attrSummary(r.attribution)) : ''}
      ${r.notes ? row('Details', r.notes) : ''}
    </div>
    <div class="lead-foot" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${actions}</div>
  </article>`;
}

init();
