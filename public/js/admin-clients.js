// Admin: list client accounts with signup, last log-in, and quote activity.

let CLIENTS = [];

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/admin/login?next=/admin/clients'; return; }
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
  if (res.status === 401) { window.location.href = '/admin/login?next=/admin/clients'; return; }
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
  results.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => act(b.getAttribute('data-id'), b.getAttribute('data-action'), b)));
  results.querySelectorAll('[data-reset]').forEach((b) =>
    b.addEventListener('click', () => resetPassword(b.getAttribute('data-reset'), b)));
  results.querySelectorAll('[data-quotes]').forEach((b) =>
    b.addEventListener('click', () => toggleClientQuotes(b.getAttribute('data-quotes'), b)));
}

// --- Drill into one client's quote requests + the advisor quotes on them ------

const CLIENT_QUOTES = {}; // clientId -> { requests, quotes } once loaded

async function toggleClientQuotes(id, btn) {
  const box = document.querySelector(`[data-quotes-box="${cssEscape(id)}"]`);
  if (!box) return;
  if (!box.hasAttribute('hidden')) { box.setAttribute('hidden', ''); return; }
  box.removeAttribute('hidden');
  if (CLIENT_QUOTES[id]) { renderClientQuotes(box, CLIENT_QUOTES[id]); return; }
  box.innerHTML = `<div class="muted" style="padding:10px 0;">Loading quotes…</div>`;
  const { ok, data } = await api('/api/admin/client-quotes?id=' + encodeURIComponent(id));
  if (!ok || !data) { box.innerHTML = `<div class="state">Couldn't load this client's quotes.</div>`; return; }
  CLIENT_QUOTES[id] = data;
  renderClientQuotes(box, data);
}

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

function fmtDateStr(s) {
  if (!s) return '';
  const d = new Date(String(s) + 'T00:00:00');
  return isNaN(d) ? escapeHtml(String(s)) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function cabinFareLabel(c) {
  const t = (c && c.type || '').trim();
  const code = (c && c.code || '').trim();
  if (t && code) return `${t} (${code})`;
  return t || (code ? `Cabin (${code})` : 'Cabin');
}

function quoteStatusBadge(s) {
  if (s === 'accepted') return `<span class="status-badge status-active">Accepted</span>`;
  if (s === 'declined') return `<span class="status-badge status-declined">Declined</span>`;
  if (s === 'requote') return `<span class="status-badge status-pending">Requote</span>`;
  if (s === 'hold') return `<span class="status-badge status-hold">On hold</span>`;
  return `<span class="status-badge status-pending">Open</span>`;
}

function offerBlock(o) {
  const who = [o.advisor_name, o.advisor_agency].filter(Boolean).map(escapeHtml).join(' · ') || 'Advisor';
  const lines = (Array.isArray(o.cabin_fares) && o.cabin_fares.length)
    ? `<div class="cq-fares">${o.cabin_fares.map((c) => `<div class="cq-fare"><span>${escapeHtml(cabinFareLabel(c))}</span><span>${escapeHtml(money(c.fare))}</span></div>`).join('')}${(o.quote_kind === 'cabins' && o.total_price != null) ? `<div class="cq-fare cq-fare-total"><span>Total</span><span>${escapeHtml(money(o.total_price))}</span></div>` : ''}</div>`
    : `<div class="cq-price">${o.total_price != null ? escapeHtml(money(o.total_price)) : (o.price ? escapeHtml(money(o.price)) : 'Quote')}</div>`;
  const bits = [];
  if (o.quote_kind !== 'cabins' && Array.isArray(o.cabin_fares) && o.cabin_fares.length > 1) bits.push('client picks one option');
  if (o.insurance_amount != null) bits.push(`insurance ${money(o.insurance_amount)}`);
  if (o.gratuities_included != null) bits.push(o.gratuities_included ? 'gratuities included' : 'gratuities not included');
  return `<div class="cq-offer">
    <div class="cq-offer-head"><span class="cq-who">${who}</span>${quoteStatusBadge(o.status)}</div>
    ${lines}
    ${bits.length ? `<div class="cq-note">${escapeHtml(bits.join(' · '))}</div>` : ''}
    ${o.specials ? `<div class="cq-note"><strong>Perks:</strong> ${escapeHtml(o.specials)}</div>` : ''}
    ${o.additional_info ? `<div class="cq-note"><strong>Notes:</strong> ${escapeHtml(o.additional_info)}</div>` : ''}
    <div class="cq-when">Quoted ${escapeHtml(niceDateTime(o.created_at) || '')}</div>
  </div>`;
}

function renderClientQuotes(box, data) {
  const requests = data.requests || [];
  const quotes = data.quotes || [];
  if (!requests.length) { box.innerHTML = `<div class="muted" style="padding:10px 0;">This client hasn't requested any quotes yet.</div>`; return; }
  const meta = (r) => [r.cruise_line, r.ship, r.sailing_dates, r.departure_port ? `Departs ${r.departure_port}` : '']
    .filter(Boolean).map(escapeHtml).join('  ·  ');
  box.innerHTML = requests.map((r) => {
    const offers = quotes.filter((o) => o.quote_request_id === r.id);
    return `<div class="cq-request">
      <div class="cq-req-head">
        <div class="cq-req-title">${escapeHtml(r.sailing_name || r.ship || r.destination || 'Cruise request')}</div>
        <div class="cq-req-meta">${meta(r)}${r.created_at ? `  ·  requested ${escapeHtml(niceDateTime(r.created_at) || '')}` : ''}</div>
      </div>
      ${offers.length ? offers.map(offerBlock).join('') : `<div class="cq-empty">No advisor quotes yet on this request.</div>`}
    </div>`;
  }).join('');
}

async function resetPassword(id, btn) {
  btn.disabled = true; const label = btn.textContent; btn.textContent = 'Sending…';
  const { ok, data } = await api('/api/admin/reset-user', { method: 'POST', body: { id } });
  btn.disabled = false; btn.textContent = label;
  if (!ok) { toast('Could not send the reset email.', true); return; }
  toast(data && data.emailed ? `Reset link sent to ${data.email}.` : 'Reset created (email not configured).');
}

function row(label, value) {
  if (!value) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(label)}</span><span class="lead-v">${escapeHtml(value)}</span></div>`;
}

function statusBadge(status) {
  const s = status === 'suspended' ? 'suspended' : 'active';
  return `<span class="status-badge status-${s}">${s === 'suspended' ? 'Suspended' : 'Active'}</span>`;
}

// Human-readable one-line summary of where a client came from (UTM / referrer).
function attrSummary(a) {
  if (!a || typeof a !== 'object') return '';
  if (a.source) {
    let out = a.source;
    if (a.medium) out += ` / ${a.medium}`;
    if (a.campaign) out += ` · ${a.campaign}`;
    if (a.content) out += ` (${a.content})`;
    return out;
  }
  if (a.referrer) return `Referral: ${a.referrer}`;
  return '';
}

function card(c) {
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ') || '(no name)';
  const lastLogin = niceDateTime(c.last_login_at);
  const quotes = c.quote_count || 0;
  const status = c.status || 'active';
  const btn = (action, label, cls) =>
    `<button type="button" class="btn ${cls}" data-action="${action}" data-id="${escapeHtml(c.id)}">${label}</button>`;
  const actions =
    `<button type="button" class="btn btn-navy" data-quotes="${escapeHtml(c.id)}">View quotes${quotes ? ` (${quotes})` : ''}</button>` +
    (status === 'suspended' ? btn('active', 'Reactivate', 'btn-primary') : btn('suspended', 'Suspend', 'btn-ghost')) +
    `<button type="button" class="btn btn-ghost" data-reset="${escapeHtml(c.id)}">Reset password</button>` +
    btn('delete', 'Delete', 'btn-danger');
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3 class="lead-name">${escapeHtml(name)}</h3>
        <div class="lead-sub"><a href="mailto:${escapeHtml(c.email)}">${escapeHtml(c.email)}</a></div>
      </div>
      ${statusBadge(status)}
    </div>
    <div class="lead-grid">
      ${row('Phone', c.phone)}
      ${row('Registered', niceDateTime(c.created_at))}
      ${row('Last log-in', lastLogin || 'Not since tracking began')}
      ${row('Quote requests', String(quotes))}
      ${attrSummary(c.attribution) ? row('Signed up via', attrSummary(c.attribution)) : ''}
    </div>
    <div class="lead-actions">${actions}</div>
    <div class="client-quotes" data-quotes-box="${escapeHtml(c.id)}" hidden></div>
  </article>`;
}

async function act(id, action, btn) {
  const buttons = btn.parentElement.querySelectorAll('button');
  const c = CLIENTS.find((x) => x.id === id);
  const who = c ? [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email : 'this client';

  if (action === 'delete') {
    if (!confirm(`Permanently delete ${who}? This also removes their quote requests and cannot be undone.`)) return;
    buttons.forEach((b) => (b.disabled = true));
    const { ok, data } = await api('/api/admin/user-delete', { method: 'POST', body: { id } });
    if (!ok) { buttons.forEach((b) => (b.disabled = false)); toast((data && data.message) || 'Could not delete. Please try again.', true); return; }
    CLIENTS = CLIENTS.filter((x) => x.id !== id);
    toast('Client deleted.');
    render();
    return;
  }

  if (action === 'suspended' && !confirm(`Suspend ${who}? They will be signed out and unable to log in.`)) return;

  buttons.forEach((b) => (b.disabled = true));
  const { ok, data } = await api('/api/admin/user-status', { method: 'POST', body: { id, status: action } });
  if (!ok) { buttons.forEach((b) => (b.disabled = false)); toast((data && data.message) || 'Could not update. Please try again.', true); return; }
  if (c) c.status = action;
  toast(action === 'suspended' ? 'Client suspended.' : 'Client reactivated.');
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
