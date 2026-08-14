// Admin dashboard: review advisor applications and approve/decline them.

let ADVISORS = [];
let FILTER = 'pending';

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin'; return; }
  if (user.role !== 'admin') {
    // Non-admins are bounced by the Worker too; this is a friendly fallback.
    window.location.href = '/';
    return;
  }
  renderNav(user);
  wireTabs();
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

async function load() {
  const res = await fetch('/api/admin/advisors', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load advisors right now. Please try again.</div>`; return; }
  ADVISORS = data.advisors || [];
  render();
}

function render() {
  const results = document.getElementById('results');
  const list = FILTER === 'all' ? ADVISORS : ADVISORS.filter((a) => (a.status || 'active') === FILTER);
  const counts = ADVISORS.reduce((m, a) => { const s = a.status || 'active'; m[s] = (m[s] || 0) + 1; return m; }, {});
  document.getElementById('count').textContent =
    `${counts.pending || 0} pending · ${counts.active || 0} approved · ${counts.declined || 0} declined`;

  if (!list.length) {
    results.innerHTML = `<div class="state">No ${FILTER === 'all' ? '' : FILTER + ' '}advisors.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(card).join('')}</div>`;
  results.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => act(b.getAttribute('data-id'), b.getAttribute('data-action'), b)));
}

function niceDate(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function badge(status) {
  const s = status || 'active';
  const label = s === 'active' ? 'Approved' : s === 'declined' ? 'Declined' : s === 'suspended' ? 'Suspended' : 'Pending';
  return `<span class="status-badge status-${s}">${label}</span>`;
}

function row(label, value) {
  if (!value) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(label)}</span><span class="lead-v">${escapeHtml(value)}</span></div>`;
}

function card(a) {
  const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || '(no name)';
  const cred = a.credential_type ? `${a.credential_type} ${a.credential || ''}`.trim() : '';
  const status = a.status || 'active';
  const btn = (action, label, cls) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${escapeHtml(a.id)}">${label}</button>`;
  let actions = '';
  if (status === 'pending') actions = btn('active', 'Approve', 'btn-primary') + btn('declined', 'Decline', 'btn-ghost');
  else if (status === 'active') actions = btn('pending', 'Revoke', 'btn-ghost') + btn('suspended', 'Suspend', 'btn-ghost');
  else if (status === 'declined') actions = btn('active', 'Approve', 'btn-primary');
  else if (status === 'suspended') actions = btn('active', 'Reactivate', 'btn-primary');
  actions += btn('delete', 'Delete', 'btn-danger');

  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3 class="lead-name">${escapeHtml(name)}</h3>
        <div class="lead-sub">${escapeHtml(a.agency || 'Independent advisor')}</div>
      </div>
      ${badge(status)}
    </div>
    <div class="lead-grid">
      ${row('Email', a.email)}
      ${row('Phone', a.phone)}
      ${row('Credential', cred)}
      ${row('Location', a.location)}
      ${row('Website', a.website)}
      ${row('Experience', a.experience)}
      ${row('Applied', niceDate(a.created_at))}
      ${row('Heard via', a.source)}
    </div>
    <div class="lead-actions">${actions}</div>
  </article>`;
}

async function act(id, action, btn) {
  const buttons = btn.parentElement.querySelectorAll('button');
  const a = ADVISORS.find((x) => x.id === id);
  const who = a ? [a.first_name, a.last_name].filter(Boolean).join(' ') || a.email : 'this advisor';

  if (action === 'delete') {
    if (!confirm(`Permanently delete ${who}? This cannot be undone.`)) return;
    buttons.forEach((b) => (b.disabled = true));
    const { ok, data } = await api('/api/admin/user-delete', { method: 'POST', body: { id } });
    if (!ok) { buttons.forEach((b) => (b.disabled = false)); toast((data && data.message) || 'Could not delete. Please try again.', true); return; }
    ADVISORS = ADVISORS.filter((x) => x.id !== id);
    toast('Advisor deleted.');
    render();
    return;
  }

  if (action === 'suspended' && !confirm(`Suspend ${who}? They will be signed out and unable to log in.`)) return;

  buttons.forEach((b) => (b.disabled = true));
  const { ok, data } = await api('/api/admin/user-status', { method: 'POST', body: { id, status: action } });
  if (!ok) { buttons.forEach((b) => (b.disabled = false)); toast((data && data.message) || 'Could not update. Please try again.', true); return; }
  if (a) a.status = action;
  const msg =
    action === 'active' ? (data && data.emailed ? 'Advisor approved, email sent.' : 'Advisor approved.') :
    action === 'declined' ? 'Advisor declined.' :
    action === 'suspended' ? 'Advisor suspended.' :
    'Advisor set back to pending.';
  toast(msg);
  render();
}

let toastTimer = null;
function toast(msg, isError) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('toast-error', !!isError);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3200);
}

init();
