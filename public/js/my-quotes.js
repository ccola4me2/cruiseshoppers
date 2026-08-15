// Client "My quotes": view the quotes advisors submitted on your requests,
// and accept one.

let QUOTES = [];
let REQUESTS = [];

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/login?next=/my-quotes'; return; }
  renderAccountNav(document.getElementById('accountNav'));
  await load();
}

async function load() {
  const res = await fetch('/api/my/quotes', { credentials: 'same-origin' });
  const results = document.getElementById('results');
  if (res.status === 401) { window.location.href = '/login?next=/my-quotes'; return; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) { results.innerHTML = `<div class="state">Couldn't load your quotes right now. Please try again.</div>`; return; }
  QUOTES = data.quotes || [];
  REQUESTS = data.requests || [];
  render();
}

function niceDateTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  const results = document.getElementById('results');
  if (!REQUESTS.length) {
    document.getElementById('count').textContent = '';
    results.innerHTML = `<div class="state">You haven't requested any quotes yet. Find a sailing you like and request a quote.<div style="margin-top:16px;"><a href="/app" class="btn btn-primary">Browse sailings</a></div></div>`;
    return;
  }
  document.getElementById('count').textContent =
    `${REQUESTS.length} request${REQUESTS.length === 1 ? '' : 's'} · ${QUOTES.length} quote${QUOTES.length === 1 ? '' : 's'} received`;
  results.innerHTML = `<div class="lead-list">${REQUESTS.map(requestGroupCard).join('')}</div>`;
  results.querySelectorAll('[data-accept]').forEach((b) =>
    b.addEventListener('click', () => accept(b.getAttribute('data-accept'), b)));
  if (typeof wireThreadToggles === 'function') wireThreadToggles(results);
}

// One card per submitted request, showing its advisor quotes (or "awaiting").
function requestGroupCard(r) {
  const sailing = r.sailing_name || r.ship || 'Cruise';
  const meta = [r.cruise_line, r.ship, r.sailing_dates, r.departure_port ? `Departs ${r.departure_port}` : '']
    .filter(Boolean).join('  ·  ');
  const offers = QUOTES.filter((q) => q.quote_request_id === r.id)
    .sort((a, b) => (b.status === 'accepted' ? 1 : 0) - (a.status === 'accepted' ? 1 : 0));
  const accepted = offers.some((o) => o.status === 'accepted');
  const badge = accepted
    ? `<span class="status-badge status-active">Accepted</span>`
    : offers.length
    ? `<span class="status-badge status-pending">${offers.length} quote${offers.length === 1 ? '' : 's'}</span>`
    : `<span class="status-badge status-declined">Awaiting quotes</span>`;
  const body = offers.length
    ? `<div class="offers-list">${offers.map(offerRow).join('')}</div>`
    : `<div class="offers-list"><div class="offer-row"><div class="offer-main"><div class="offer-advisor">Awaiting advisor quotes. We'll email you the moment a quote comes in.</div></div></div></div>`;
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(sailing)}</h3>
        <div class="lead-sub">${escapeHtml(meta)} · requested ${escapeHtml(niceDateTime(r.created_at))}</div>
      </div>
      ${badge}
    </div>
    ${body}
  </article>`;
}

function offerRow(o) {
  const accepted = o.status === 'accepted';
  const declined = o.status === 'declined';
  const action = accepted
    ? `<span class="status-badge status-active">Accepted</span>`
    : declined
    ? `<span class="status-badge status-declined">Not selected</span>`
    : `<button type="button" class="btn btn-primary" data-accept="${escapeHtml(o.id)}">Accept</button>`;
  const details = [
    o.specials ? `<div class="offer-detail"><span class="k">Special offers</span> ${escapeHtml(o.specials)}</div>` : '',
    o.additional_info ? `<div class="offer-detail"><span class="k">Details</span> ${escapeHtml(o.additional_info)}</div>` : '',
  ].join('');
  const thread = accepted
    ? `<div class="thread-bar"><button type="button" class="btn btn-ghost thread-toggle" data-offer="${escapeHtml(o.id)}">Messages${o.unread ? ` <span class="unread-dot">${o.unread}</span>` : ''}</button></div>
       <div class="thread" data-offer="${escapeHtml(o.id)}" hidden><div class="thread-title">Messages with ${o.advisor_name ? escapeHtml(o.advisor_name) : 'your advisor'}</div></div>`
    : '';
  return `<div class="offer-wrap${declined ? ' is-declined' : ''}">
    <div class="offer-row">
      <div class="offer-main">
        <div class="offer-price">${escapeHtml(o.price || 'Quote')}</div>
        <div class="offer-advisor">${o.advisor_name ? `from ${escapeHtml(o.advisor_name)}` : 'Personalized quote'} · ${escapeHtml(niceDateTime(o.created_at))}</div>
        ${details}
      </div>
      <div class="offer-action">${action}</div>
    </div>
    ${thread}
  </div>`;
}

async function accept(id, btn) {
  if (!confirm('Accept this quote? Your advisor will be notified to finalize the booking.')) return;
  btn.disabled = true; btn.textContent = 'Accepting…';
  const { ok } = await api('/api/my/quotes/accept', { method: 'POST', body: { offer_id: id } });
  if (!ok) { btn.disabled = false; btn.textContent = 'Accept this quote'; alert('Could not accept right now. Please try again.'); return; }
  const q = QUOTES.find((x) => x.id === id);
  if (q) q.status = 'accepted';
  render();
}

init();
