// Client "My quotes": view the quotes advisors submitted on your requests,
// and accept one.

let QUOTES = [];

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
  render();
}

function niceDateTime(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function render() {
  const results = document.getElementById('results');
  if (!QUOTES.length) {
    document.getElementById('count').textContent = '';
    results.innerHTML = `<div class="state">You don't have any quotes yet. Once you request a quote on a sailing, advisor offers will appear here.<div style="margin-top:16px;"><a href="/app" class="btn btn-primary">Browse sailings</a></div></div>`;
    return;
  }
  // Group quotes by the sailing (request) so you can compare advisors' offers.
  const groups = new Map();
  for (const q of QUOTES) {
    const k = q.quote_request_id || q.id;
    if (!groups.has(k)) groups.set(k, { rep: q, offers: [] });
    groups.get(k).offers.push(q);
  }
  const arr = [...groups.values()];
  document.getElementById('count').textContent =
    `${QUOTES.length} quote${QUOTES.length === 1 ? '' : 's'} across ${arr.length} sailing${arr.length === 1 ? '' : 's'}`;
  results.innerHTML = `<div class="lead-list">${arr.map(groupCard).join('')}</div>`;
  results.querySelectorAll('[data-accept]').forEach((b) =>
    b.addEventListener('click', () => accept(b.getAttribute('data-accept'), b)));
}

function groupCard(g) {
  const s = g.rep;
  const sailing = s.sailing_name || s.ship || 'Cruise';
  const meta = [s.cruise_line, s.ship, s.sailing_dates, s.departure_port ? `Departs ${s.departure_port}` : '']
    .filter(Boolean).join('  ·  ');
  const n = g.offers.length;
  const offers = g.offers
    .slice()
    .sort((a, b) => (a.status === 'accepted' ? -1 : 0) - (b.status === 'accepted' ? -1 : 0))
    .map(offerRow).join('');
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(sailing)}</h3>
        <div class="lead-sub">${escapeHtml(meta)}</div>
      </div>
      <span class="status-badge status-pending">${n} quote${n === 1 ? '' : 's'}</span>
    </div>
    <div class="offers-list">${offers}</div>
  </article>`;
}

function offerRow(o) {
  const accepted = o.status === 'accepted';
  const action = accepted
    ? `<span class="status-badge status-active">Accepted</span>`
    : `<button type="button" class="btn btn-primary" data-accept="${escapeHtml(o.id)}">Accept</button>`;
  const details = [
    o.specials ? `<div class="offer-detail"><span class="k">Special offers</span> ${escapeHtml(o.specials)}</div>` : '',
    o.additional_info ? `<div class="offer-detail"><span class="k">Details</span> ${escapeHtml(o.additional_info)}</div>` : '',
  ].join('');
  return `<div class="offer-row">
    <div class="offer-main">
      <div class="offer-price">${escapeHtml(o.price || 'Quote')}</div>
      <div class="offer-advisor">${o.advisor_name ? `from ${escapeHtml(o.advisor_name)}` : 'Personalized quote'} · ${escapeHtml(niceDateTime(o.created_at))}</div>
      ${details}
    </div>
    <div class="offer-action">${action}</div>
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
