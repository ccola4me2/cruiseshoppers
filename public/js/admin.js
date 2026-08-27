// Admin dashboard: review advisor applications and approve/decline them.

let ADVISORS = [];
let FILTER = 'all';

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
  wireToolbar();
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

// Group advisors under their agency (owner first), agencies sorted by name;
// unaffiliated (legacy) advisors sort last.
function agencyKey(a) { return (a.agency || (a.agency_id ? 'zzz-' + a.agency_id : 'zzzz-independent')).toLowerCase(); }
function byAgency(a, b) {
  const ka = agencyKey(a), kb = agencyKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ra = a.agency_role === 'owner' ? 0 : 1, rb = b.agency_role === 'owner' ? 0 : 1;
  if (ra !== rb) return ra - rb;
  return (b.created_at || 0) - (a.created_at || 0);
}

function render() {
  const results = document.getElementById('results');
  const list = (FILTER === 'all' ? ADVISORS.slice() : ADVISORS.filter((a) => (a.status || 'active') === FILTER)).sort(byAgency);
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
  results.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => resetPassword(b.getAttribute('data-reset'), b)));
  results.querySelectorAll('[data-agency]').forEach((b) =>
    b.addEventListener('click', () => agencyAction(b.getAttribute('data-aid'), b.getAttribute('data-agency'), b.getAttribute('data-name'))));
  results.querySelectorAll('[data-plan-select]').forEach((sel) =>
    sel.addEventListener('change', () => setSpecialsPlan(sel.getAttribute('data-id'), sel.value, sel)));
}

async function resetPassword(id, btn) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
  const { ok, data } = await api('/api/admin/reset-user', { method: 'POST', body: { id } });
  btn.disabled = false; btn.textContent = label;
  if (!ok) { toast('Could not send the reset email.', true); return; }
  toast(data && data.emailed ? `Reset link sent to ${data.email}.` : 'Reset created (email not configured).');
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
  const plan = a.specials_plan || 'off';
  const planOpt = (v, label) => `<option value="${v}"${plan === v ? ' selected' : ''}>${label}</option>`;
  const planControl =
    `<div class="lead-plan"><span class="k">Specials plan</span>` +
    `<select data-plan-select data-id="${escapeHtml(a.id)}" data-current="${plan}">` +
    planOpt('off', 'Off: no specials') +
    planOpt('ten', '10 active: $9.95/mo') +
    planOpt('twentyfive', '25 active: $14.95/mo') +
    planOpt('unlimited', 'Unlimited: $19.95/mo') +
    `</select></div>`;
  const btn = (action, label, cls) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${escapeHtml(a.id)}">${label}</button>`;
  let actions = '';
  if (status === 'pending') actions = btn('active', 'Approve', 'btn-primary') + btn('declined', 'Decline', 'btn-ghost');
  else if (status === 'active') actions = btn('pending', 'Revoke', 'btn-ghost') + btn('suspended', 'Suspend', 'btn-ghost');
  else if (status === 'declined') actions = btn('active', 'Approve', 'btn-primary');
  else if (status === 'suspended') actions = btn('active', 'Reactivate', 'btn-primary');
  actions += `<button type="button" class="btn btn-ghost" data-reset="${escapeHtml(a.id)}">Reset password</button>`;
  actions += btn('delete', 'Delete', 'btn-danger');
  // Agency-wide action lives on the owner card.
  if (a.agency_role === 'owner' && a.agency_id) {
    const aname = escapeHtml(a.agency || 'this agency');
    actions += (status === 'suspended')
      ? `<button type="button" class="btn btn-primary" data-agency="active" data-aid="${escapeHtml(a.agency_id)}" data-name="${aname}">Reactivate agency</button>`
      : `<button type="button" class="btn btn-danger" data-agency="suspended" data-aid="${escapeHtml(a.agency_id)}" data-name="${aname}">Suspend agency</button>`;
  }
  const roleTag = a.agency_role === 'owner' ? '<span class="role-pill owner">Owner</span>'
    : a.agency_role === 'seat' ? '<span class="role-pill seat">Seat</span>' : '';

  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3 class="lead-name">${escapeHtml(name)} ${roleTag}</h3>
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
      ${a.terms_accepted_at ? row('Terms accepted', `${a.terms_version || ''} on ${niceDate(a.terms_accepted_at)}`) : ''}
    </div>
    ${planControl}
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

async function agencyAction(agencyId, status, name) {
  if (status === 'suspended' && !confirm(`Suspend ${name || 'this agency'}? The owner AND every advisor under it will be signed out and unable to log in.`)) return;
  const { ok, data } = await api('/api/admin/agency-status', { method: 'POST', body: { agency_id: agencyId, status } });
  if (!ok) { toast((data && data.message) || 'Could not update the agency.', true); return; }
  toast(status === 'suspended' ? 'Agency suspended.' : 'Agency reactivated.');
  await load();
}

// Set an advisor's Specials Program plan (off / ten / twentyfive / unlimited).
async function setSpecialsPlan(id, plan, sel) {
  const prev = sel.getAttribute('data-current') || 'off';
  sel.disabled = true;
  const { ok, data } = await api('/api/admin/advisor-specials-plan', { method: 'POST', body: { advisor_id: id, plan } });
  sel.disabled = false;
  if (!ok) { sel.value = prev; toast((data && data.message) || 'Could not update the specials plan.', true); return; }
  sel.setAttribute('data-current', plan);
  const labels = { off: 'turned off', ten: 'set to 10 specials', twentyfive: 'set to 25 specials', unlimited: 'set to unlimited' };
  toast(`Specials plan ${labels[plan] || 'updated'}.`);
}

function wireToolbar() {
  const ab = document.getElementById('addAgencyBtn');
  const sb = document.getElementById('addSeatBtn');
  if (ab) ab.addEventListener('click', showAddAgency);
  if (sb) sb.addEventListener('click', showAddSeat);
}

function genPass() { return 'CS' + Math.random().toString(36).slice(2, 8) + Math.floor(10 + Math.random() * 89); }

// Agencies (from loaded owners) for the "add seat" dropdown.
function agencies() {
  const seen = new Map();
  ADVISORS.forEach((a) => { if (a.agency_role === 'owner' && a.agency_id) seen.set(a.agency_id, a.agency || '(agency)'); });
  return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((x, y) => x.name.localeCompare(y.name));
}

function showAddAgency() {
  const el = document.getElementById('adminForm');
  el.innerHTML = `<div class="admin-card"><h3>Add an agency</h3>
    <div class="alert hidden" data-a></div>
    <div class="row-2"><div class="field"><label>Agency name</label><input data-f="agency_name" /></div>
      <div class="field"><label>Website <span class="opt">(optional)</span></label><input data-f="website" placeholder="https://" /></div></div>
    <div class="row-2"><div class="field"><label>Owner first name</label><input data-f="first_name" /></div>
      <div class="field"><label>Owner last name</label><input data-f="last_name" /></div></div>
    <div class="row-2"><div class="field"><label>Owner email</label><input data-f="email" type="email" /></div>
      <div class="field"><label>Phone <span class="opt">(optional)</span></label><input data-f="phone" /></div></div>
    <div class="row-2"><div class="field"><label>Credential type <span class="opt">(optional)</span></label><select data-f="credential_type"><option value="">-</option><option value="CLIA">CLIA</option><option value="IATA">IATA / IATAN</option></select></div>
      <div class="field"><label>Credential # <span class="opt">(optional)</span></label><input data-f="credential" /></div></div>
    <div class="field"><label>Location <span class="opt">(optional)</span></label><input data-f="location" placeholder="Tampa, FL" /></div>
    <div class="field"><label>Temporary password</label><input data-f="password" value="${genPass()}" /><div class="hint">Emailed to the owner; they reset it after first login.</div></div>
    <div class="admin-card-actions"><button type="button" class="btn btn-primary" data-submit>Create agency</button><button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div>
  </div>`;
  wireAdminForm(el, '/api/admin/add-agency', 'Agency created.');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showAddSeat() {
  const el = document.getElementById('adminForm');
  const list = agencies();
  const opts = list.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('');
  el.innerHTML = `<div class="admin-card"><h3>Add an advisor to an agency</h3>
    <div class="alert hidden" data-a></div>
    ${list.length ? '' : '<p class="muted">No agencies yet, add an agency first.</p>'}
    <div class="field"><label>Agency</label><select data-f="agency_id">${opts}</select></div>
    <div class="row-2"><div class="field"><label>First name</label><input data-f="first_name" /></div>
      <div class="field"><label>Last name</label><input data-f="last_name" /></div></div>
    <div class="field"><label>Email</label><input data-f="email" type="email" /></div>
    <div class="field"><label>Temporary password</label><input data-f="password" value="${genPass()}" /><div class="hint">Emailed to the advisor.</div></div>
    <div class="admin-card-actions"><button type="button" class="btn btn-primary" data-submit>Add advisor</button><button type="button" class="btn btn-ghost" data-cancel>Cancel</button></div>
  </div>`;
  wireAdminForm(el, '/api/admin/add-seat', 'Advisor added.');
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function wireAdminForm(el, url, successMsg) {
  const alertEl = el.querySelector('[data-a]');
  el.querySelector('[data-cancel]').addEventListener('click', () => { el.innerHTML = ''; });
  el.querySelector('[data-submit]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const body = {};
    el.querySelectorAll('[data-f]').forEach((f) => { body[f.getAttribute('data-f')] = f.value.trim(); });
    btn.disabled = true; const label = btn.textContent; btn.textContent = 'Saving…';
    const { ok, data } = await api(url, { method: 'POST', body });
    btn.disabled = false; btn.textContent = label;
    if (!ok) { showAlert(alertEl, 'error', (data && data.message) || 'Could not save.'); return; }
    el.innerHTML = '';
    toast(data && data.emailed ? `${successMsg} Invite emailed.` : `${successMsg} (email not sent)`);
    await load();
  });
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
