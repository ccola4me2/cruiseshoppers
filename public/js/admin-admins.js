// Admin: list admin accounts + send password resets.

let ADMINS = [];

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin/admins'; return; }
  if (user.role !== 'admin') { window.location.href = '/'; return; }
  renderNav(user);
  wireAddForm();
  await load();
}

function wireAddForm() {
  const form = document.getElementById('addAdminForm');
  const alertEl = document.getElementById('addAlert');
  const val = (id) => (document.getElementById(id).value || '').trim();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertEl);
    if (!val('a_first')) { showAlert(alertEl, 'error', 'Enter a first name.'); return; }
    if (!val('a_email')) { showAlert(alertEl, 'error', 'Enter an email.'); return; }
    if (val('a_pass').length < 8) { showAlert(alertEl, 'error', 'Temporary password must be at least 8 characters.'); return; }
    const btn = document.getElementById('addBtn');
    btn.disabled = true; btn.textContent = 'Adding…';
    const { ok, data } = await api('/api/admin/add-admin', {
      method: 'POST',
      body: { first_name: val('a_first'), last_name: val('a_last'), email: val('a_email'), password: val('a_pass') },
    });
    btn.disabled = false; btn.textContent = 'Add admin';
    if (!ok) { showAlert(alertEl, 'error', (data && data.message) || 'Could not add admin.'); return; }
    showAlert(alertEl, 'success', data.emailed ? `Admin added. Invite emailed to ${data.email}.` : `Admin added (email not configured, share the password directly).`);
    form.reset();
    await load();
  });
}

function renderNav(user) {
  const nav = document.getElementById('accountNav');
  nav.innerHTML =
    `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">${escapeHtml(user.first_name || 'Admin')}</span>` +
    `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
  nav.querySelector('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

async function load() {
  const res = await fetch('/api/admin/admins', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin/admins'; return; }
  if (res.status === 403) { window.location.href = '/'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load admins right now. Please try again.</div>`; return; }
  ADMINS = data.admins || [];
  const emails = data.configured_emails || [];
  document.getElementById('hint').textContent =
    `Admins are set by the ADMIN_EMAILS Worker secret (${emails.length} configured). To add an admin, add their email to ADMIN_EMAILS in Cloudflare and have them sign up with that email.`;
  render();
}

function niceDateTime(ms) {
  if (!ms) return 'Never';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function render() {
  const results = document.getElementById('results');
  document.getElementById('count').textContent = `${ADMINS.length} admin${ADMINS.length === 1 ? '' : 's'}`;
  if (!ADMINS.length) {
    results.innerHTML = `<div class="state">No admin accounts found yet. Add an email to ADMIN_EMAILS and sign up with it.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${ADMINS.map(card).join('')}</div>`;
  results.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => resetPassword(b.getAttribute('data-reset'), b)));
}

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function card(a) {
  const name = [a.first_name, a.last_name].filter(Boolean).join(' ') || '(no name)';
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3 class="lead-name">${escapeHtml(name)}</h3>
        <div class="lead-sub"><a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a></div>
      </div>
      <span class="status-badge status-active">Admin</span>
    </div>
    <div class="lead-grid">
      ${row('Phone', a.phone)}
      ${row('Access via', a.via === 'role' ? 'Role' : 'ADMIN_EMAILS')}
      ${row('Last log-in', niceDateTime(a.last_login_at))}
    </div>
    <div class="lead-actions">
      <button type="button" class="btn btn-ghost" data-reset="${escapeHtml(a.id)}">Send password reset</button>
    </div>
  </article>`;
}

async function resetPassword(id, btn) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
  const { ok, data } = await api('/api/admin/reset-user', { method: 'POST', body: { id } });
  btn.disabled = false; btn.textContent = label;
  if (!ok) { alert('Could not send the reset email. Please try again.'); return; }
  alert(data && data.emailed ? `Password reset link sent to ${data.email}.` : 'Reset created, but email is not configured.');
}

init();
