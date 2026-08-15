// Advisor portal: browse client quote requests, submit a priced quote
// (specials + additional info + price) on any request, and see the quotes
// you've submitted.

let REQUESTS = [];
let OFFERS = [];
let TAB = 'requests';

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/advisor/login?next=/advisor'; return; }
  if (user.role !== 'advisor') { window.location.href = user.role === 'admin' ? '/admin' : '/app'; return; }
  if (user.status !== 'active') { window.location.href = '/advisor/pending'; return; }
  renderAdvisorNav(user);
  wireTabs();
  wireFilters();
  await load();
}

function renderAdvisorNav(user) {
  const nav = document.getElementById('accountNav');
  nav.innerHTML =
    `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">${escapeHtml(user.first_name || 'Advisor')}</span>` +
    `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
  nav.querySelector('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

function wireTabs() {
  document.querySelectorAll('#tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      TAB = btn.getAttribute('data-tab');
      document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.getElementById('filters').style.display = TAB === 'requests' ? '' : 'none';
      document.getElementById('pageTitle').textContent = TAB === 'requests' ? 'My requests' : 'My submitted quotes';
      render();
    });
  });
}

async function load() {
  const [rq, of] = await Promise.all([
    fetch('/api/quotes', { credentials: 'same-origin' }),
    fetch('/api/advisor/offers', { credentials: 'same-origin' }),
  ]);
  if (rq.status === 401) { window.location.href = '/advisor/login?next=/advisor'; return; }
  if (rq.status === 403) { window.location.href = '/advisor/pending'; return; }

  let rd = {}, od = {};
  try { rd = await rq.json(); } catch (_) {}
  try { od = await of.json(); } catch (_) {}
  REQUESTS = rd.leads || [];
  OFFERS = od.offers || [];

  const lines = [...new Set(REQUESTS.map((l) => l.cruise_line).filter(Boolean))].sort();
  const sel = document.getElementById('line');
  sel.innerHTML = `<option value="">All lines</option>` + lines.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  render();
}

function offersForRequest(id) {
  return OFFERS.filter((o) => o.quote_request_id === id);
}

function filteredRequests() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const line = document.getElementById('line').value.toLowerCase();
  return REQUESTS.filter((l) => {
    if (line && (l.cruise_line || '').toLowerCase() !== line) return false;
    if (q) {
      const hay = [l.first_name, l.last_name, l.email, l.cruise_line, l.ship, l.destination, l.sailing_name]
        .filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function render() {
  const results = document.getElementById('results');
  if (TAB === 'quotes') return renderQuotes(results);

  // Advisors only see requests they have submitted a quote on.
  const list = filteredRequests().filter((l) => offersForRequest(l.id).length > 0);
  document.getElementById('count').textContent =
    `${list.length} request${list.length === 1 ? '' : 's'} you've quoted · ${OFFERS.length} quote${OFFERS.length === 1 ? '' : 's'} submitted`;
  if (!list.length) {
    results.innerHTML = `<div class="state">You haven't quoted any requests yet. Requests you submit a price on will appear here.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(requestCard).join('')}</div>`;
  wireRequestCards(results);
}

function requestCard(l) {
  const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Client';
  const when = niceDateTime(l.created_at);
  const mine = offersForRequest(l.id);
  const quotedBadge = mine.length
    ? `<span class="status-badge status-active">You quoted ${escapeHtml(mine[0].price || '')}</span>`
    : '';
  return `<article class="lead" data-id="${escapeHtml(l.id)}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(name)}</h3>
        <div class="lead-contact">
          ${l.email ? `<a href="mailto:${escapeHtml(l.email)}">${escapeHtml(l.email)}</a>` : ''}
          ${l.phone ? ` &middot; <a href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a>` : ''}
        </div>
      </div>
      ${quotedBadge || `<div class="lead-when">${escapeHtml(when)}</div>`}
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
      ${l.notes ? `<div class="lead-notes" style="white-space:pre-line"><span class="k">Client details</span> ${escapeHtml(l.notes)}</div>` : ''}
    </div>
    <div class="lead-foot">
      <button type="button" class="btn btn-primary" data-give-price>${mine.length ? 'Add another quote' : 'Give a price'}</button>
      ${l.email ? `<a class="btn btn-ghost" href="mailto:${escapeHtml(l.email)}?subject=${encodeURIComponent('Your CruiseShoppers quote')}">Email client</a>` : ''}
    </div>
    <div class="offer-form" hidden>
      <div class="field"><label>Special offers on this sailing</label><textarea data-specials rows="2" placeholder="Onboard credit, free gratuities, cabin upgrade, kids sail free…"></textarea></div>
      <div class="field"><label>Additional information</label><textarea data-info rows="2" placeholder="What's included, terms, deposit, your direct contact…"></textarea></div>
      <div class="field"><label>Price <span style="color:var(--danger)">*</span></label><input type="text" data-price placeholder="e.g. $1,499 per person, taxes included" /></div>
      <div class="alert hidden" data-alert></div>
      <button type="button" class="btn btn-primary" data-submit-offer>Submit quote</button>
    </div>
  </article>`;
}

function wireRequestCards(scope) {
  scope.querySelectorAll('[data-give-price]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const form = btn.closest('.lead').querySelector('.offer-form');
      form.hidden = !form.hidden;
      if (!form.hidden) form.querySelector('[data-price]').focus();
    });
  });
  scope.querySelectorAll('[data-submit-offer]').forEach((btn) => {
    btn.addEventListener('click', () => submitOffer(btn));
  });
}

async function submitOffer(btn) {
  const card = btn.closest('.lead');
  const id = card.getAttribute('data-id');
  const price = card.querySelector('[data-price]').value.trim();
  const specials = card.querySelector('[data-specials]').value.trim();
  const additional_info = card.querySelector('[data-info]').value.trim();
  const alertEl = card.querySelector('[data-alert]');
  if (!price) { showAlert(alertEl, 'error', 'Please enter a price.'); return; }

  btn.disabled = true; btn.textContent = 'Submitting…';
  const { ok, data } = await api('/api/advisor/offers', {
    method: 'POST',
    body: { quote_request_id: id, price, specials, additional_info },
  });
  if (!ok) {
    showAlert(alertEl, 'error', (data && data.message) || 'Could not submit your quote. Please try again.');
    btn.disabled = false; btn.textContent = 'Submit quote';
    return;
  }
  // Reflect locally so the badge + My Quotes update without a reload.
  const req = REQUESTS.find((r) => r.id === id) || {};
  OFFERS.unshift({
    id: data.id, quote_request_id: id, price, specials, additional_info,
    status: 'submitted', created_at: data.created_at || Date.now(),
    sailing_name: req.sailing_name, cruise_line: req.cruise_line, ship: req.ship,
    sailing_dates: req.sailing_dates, departure_port: req.departure_port, destination: req.destination,
    client_first: req.first_name, client_last: req.last_name, client_email: req.email,
  });
  toast('Quote submitted.');
  render();
}

function renderQuotes(results) {
  document.getElementById('count').textContent = `${OFFERS.length} quote${OFFERS.length === 1 ? '' : 's'} submitted`;
  if (!OFFERS.length) {
    results.innerHTML = `<div class="state">You haven't submitted any quotes yet. Open a request and click "Give a price".</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${OFFERS.map(offerCard).join('')}</div>`;
}

function offerCard(o) {
  const client = [o.client_first, o.client_last].filter(Boolean).join(' ') || 'Client';
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}</h3>
        <div class="lead-contact">For ${escapeHtml(client)}${o.client_email ? ` &middot; <a href="mailto:${escapeHtml(o.client_email)}">${escapeHtml(o.client_email)}</a>` : ''}</div>
      </div>
      <span class="status-badge status-active">${escapeHtml(o.price || 'Quoted')}</span>
    </div>
    <div class="lead-grid">
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

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
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
  document.getElementById('q').addEventListener('input', render);
  document.getElementById('line').addEventListener('change', render);
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('q').value = '';
    document.getElementById('line').value = '';
    render();
  });
}

let toastTimer = null;
function toast(msg, isError) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('toast-error', !!isError);
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 3000);
}

init();
