// Agency owner portal: manage advisor seats and view every seat's quotes.

let ADVISORS = [];
let QUOTES = [];
let TAB = 'advisors';
let SEATS_MAX = 6;
let SEATS_REMAINING = 6;

const alertEl = () => document.getElementById('addAlert');
const val = (id) => (document.getElementById(id).value || '').trim();

document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

async function init() {
  const u = await getMe();
  if (!u) { window.location.href = '/agency/login?next=/agency'; return; }
  if (u.role !== 'advisor') { window.location.href = u.role === 'admin' ? '/admin' : '/app'; return; }
  if (u.status !== 'active') { window.location.href = '/advisor/pending'; return; }
  if (u.agency_role !== 'owner') { window.location.href = '/advisor'; return; }

  document.querySelectorAll('#tabs .tab').forEach((t) =>
    t.addEventListener('click', () => switchTab(t.getAttribute('data-tab'))));
  document.getElementById('seatForm').addEventListener('submit', addSeat);
  await Promise.all([loadAdvisors(), loadQuotes()]);
}

function switchTab(tab) {
  TAB = tab;
  document.querySelectorAll('#tabs .tab').forEach((t) =>
    t.classList.toggle('is-active', t.getAttribute('data-tab') === tab));
  document.getElementById('tab-advisors').hidden = tab !== 'advisors';
  document.getElementById('tab-quotes').hidden = tab !== 'quotes';
}

async function loadAdvisors() {
  const { ok, data } = await api('/api/agency/advisors');
  const box = document.getElementById('advisorsResults');
  if (!ok) { box.innerHTML = `<div class="state">Could not load your advisors.</div>`; return; }
  ADVISORS = data.advisors || [];
  if (data.agency && data.agency.name) {
    document.getElementById('agencyTitle').textContent = data.agency.name;
  }
  SEATS_MAX = data.seats_max != null ? data.seats_max : 6;
  const seatsUsed = data.seats_used != null ? data.seats_used : ADVISORS.filter((a) => !a.is_owner).length;
  SEATS_REMAINING = data.seats_remaining != null ? data.seats_remaining : Math.max(0, SEATS_MAX - seatsUsed);
  document.getElementById('count').textContent = `${seatsUsed} of ${SEATS_MAX} advisor seats used`;
  updateSeatForm();
  renderAdvisors();
}

function renderAdvisors() {
  const box = document.getElementById('advisorsResults');
  box.innerHTML = `<div class="lead-list">${ADVISORS.map(advisorCard).join('')}</div>`;
  box.querySelectorAll('[data-status]').forEach((b) =>
    b.addEventListener('click', () => setStatus(b.getAttribute('data-id'), b.getAttribute('data-status'))));
}

function advisorCard(a) {
  const badge = a.is_owner
    ? `<span class="status-badge status-active">Owner</span>`
    : a.status === 'suspended'
    ? `<span class="status-badge status-declined">Suspended</span>`
    : `<span class="status-badge status-active">Active</span>`;
  const mineOffers = QUOTES.filter((q) => q.advisor_name && `${a.name}` === q.advisor_name).length;
  const actions = a.is_owner
    ? '<span class="hint">That\'s you</span>'
    : a.status === 'suspended'
    ? `<button type="button" class="btn btn-ghost" data-status="active" data-id="${escapeHtml(a.id)}">Reactivate</button>`
    : `<button type="button" class="btn btn-danger" data-status="suspended" data-id="${escapeHtml(a.id)}">Suspend</button>`;
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(a.name)}</h3>
        <div class="lead-contact">${a.email ? `<a href="mailto:${escapeHtml(a.email)}">${escapeHtml(a.email)}</a>` : ''}</div>
      </div>
      ${badge}
    </div>
    <div class="lead-foot" style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;">
      <span class="hint">${mineOffers} quote${mineOffers === 1 ? '' : 's'} submitted</span>
      ${actions}
    </div>
  </article>`;
}

function updateSeatForm() {
  const atLimit = SEATS_REMAINING <= 0;
  const btn = document.getElementById('addBtn');
  btn.disabled = atLimit;
  btn.textContent = atLimit ? `Seat limit reached (${SEATS_MAX} of ${SEATS_MAX})` : 'Add advisor';
  ['s_first', 's_last', 's_email', 's_pass'].forEach((id) => { document.getElementById(id).disabled = atLimit; });
  const note = document.getElementById('seatNote');
  if (note) {
    note.textContent = atLimit
      ? `You have used all ${SEATS_MAX} advisor seats. Suspend or remove a seat to add another.`
      : `${SEATS_REMAINING} of ${SEATS_MAX} seat${SEATS_REMAINING === 1 ? '' : 's'} remaining.`;
  }
}

async function addSeat(e) {
  e.preventDefault();
  hideAlert(alertEl());
  if (SEATS_REMAINING <= 0) { showAlert(alertEl(), 'error', `Your agency has reached its limit of ${SEATS_MAX} advisor seats.`); return; }
  if (!val('s_first')) { showAlert(alertEl(), 'error', 'Please enter a first name.'); return; }
  if (!val('s_email')) { showAlert(alertEl(), 'error', 'Please enter an email.'); return; }
  if (val('s_pass').length < 8) { showAlert(alertEl(), 'error', 'Temporary password must be at least 8 characters.'); return; }
  const btn = document.getElementById('addBtn');
  btn.disabled = true; btn.textContent = 'Adding…';
  const { ok, data } = await api('/api/agency/advisors', {
    method: 'POST',
    body: { first_name: val('s_first'), last_name: val('s_last'), email: val('s_email'), password: val('s_pass') },
  });
  btn.disabled = false; btn.textContent = 'Add advisor';
  if (!ok) { showAlert(alertEl(), 'error', (data && data.message) || 'Could not add the advisor.'); return; }
  document.getElementById('seatForm').reset();
  showAlert(alertEl(), 'success', data.emailed ? 'Advisor added and emailed their sign-in details.' : 'Advisor added. (Invite email could not be sent, share the password manually.)');
  await loadAdvisors();
}

async function setStatus(id, status) {
  const verb = status === 'suspended' ? 'Suspend' : 'Reactivate';
  if (!confirm(`${verb} this advisor?`)) return;
  const { ok } = await api('/api/agency/advisors/status', { method: 'POST', body: { id, status } });
  if (ok) await loadAdvisors();
}

async function loadQuotes() {
  const { ok, data } = await api('/api/agency/quotes');
  const box = document.getElementById('quotesResults');
  if (!ok) { box.innerHTML = `<div class="state">Could not load agency quotes.</div>`; return; }
  QUOTES = data.offers || [];
  renderQuotes();
  renderAdvisors();
}

function renderQuotes() {
  const box = document.getElementById('quotesResults');
  if (!QUOTES.length) { box.innerHTML = `<div class="state">No quotes have been submitted by your advisors yet.</div>`; return; }
  box.innerHTML = `<div class="lead-list">${QUOTES.map(quoteCard).join('')}</div>`;
  if (typeof wireThreadToggles === 'function') wireThreadToggles(box);
}

function statusBadge(status) {
  if (status === 'accepted') return `<span class="status-badge status-active">Accepted</span>`;
  if (status === 'declined') return `<span class="status-badge status-declined">Not selected</span>`;
  if (status === 'requote') return `<span class="status-badge status-pending">Requote requested</span>`;
  return `<span class="status-badge status-pending">Submitted</span>`;
}

function quoteCard(o) {
  const client = [o.client_first, o.client_last].filter(Boolean).join(' ') || 'Client';
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}</h3>
        <div class="lead-sub">By ${escapeHtml(o.advisor_name)} &middot; for ${escapeHtml(client)}${o.client_email ? ` &middot; <a href="mailto:${escapeHtml(o.client_email)}">${escapeHtml(o.client_email)}</a>` : ''}</div>
      </div>
      <div style="text-align:right;">
        <div class="offer-price">${o.price ? escapeHtml(money(o.price)) : 'Quote'}</div>
        ${statusBadge(o.status)}
      </div>
    </div>
    <div class="lead-grid">
      ${o.cruise_line ? metaRow('Cruise line', o.cruise_line) : ''}
      ${o.ship ? metaRow('Ship', o.ship) : ''}
      ${o.sailing_dates ? metaRow('Sailing', o.sailing_dates) : ''}
      ${o.departure_port ? metaRow('Departs', o.departure_port) : ''}
      ${metaRow('Submitted', niceDateTime(o.created_at))}
      ${o.specials ? metaRow('Specials', o.specials) : ''}
      ${o.additional_info ? metaRow('Additional info', o.additional_info) : ''}
    </div>
  </article>`;
}

function metaRow(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function niceDateTime(ms) {
  if (!ms) return '';
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

init();
