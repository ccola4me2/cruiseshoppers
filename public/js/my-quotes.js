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
  document.getElementById('count').textContent =
    QUOTES.length ? `${QUOTES.length} quote${QUOTES.length === 1 ? '' : 's'}` : '';
  if (!QUOTES.length) {
    results.innerHTML = `<div class="state">You don't have any quotes yet. Once you request a quote on a sailing, advisor offers will appear here.<div style="margin-top:16px;"><a href="/app" class="btn btn-primary">Browse sailings</a></div></div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${QUOTES.map(card).join('')}</div>`;
  results.querySelectorAll('[data-accept]').forEach((b) =>
    b.addEventListener('click', () => accept(b.getAttribute('data-accept'), b)));
}

function row(k, v) {
  if (!v) return '';
  return `<div class="lead-row"><span class="lead-k">${escapeHtml(k)}</span><span class="lead-v">${escapeHtml(v)}</span></div>`;
}

function card(o) {
  const accepted = o.status === 'accepted';
  const badge = accepted
    ? `<span class="status-badge status-active">Accepted</span>`
    : `<span class="status-badge status-pending">${escapeHtml(o.price || 'Quoted')}</span>`;
  const action = accepted
    ? `<span class="no-price">You accepted this quote. Your advisor will be in touch to finalize.</span>`
    : `<button type="button" class="btn btn-primary" data-accept="${escapeHtml(o.id)}">Accept this quote</button>`;
  return `<article class="lead" data-id="${escapeHtml(o.id)}">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}</h3>
        <div class="lead-sub">${o.advisor_name ? `Quote from ${escapeHtml(o.advisor_name)}` : 'Personalized quote'}</div>
      </div>
      ${badge}
    </div>
    <div class="lead-grid">
      ${o.cruise_line ? row('Cruise line', o.cruise_line) : ''}
      ${o.ship ? row('Ship', o.ship) : ''}
      ${o.sailing_dates ? row('Sailing', o.sailing_dates) : ''}
      ${o.departure_port ? row('Departs', o.departure_port) : ''}
      ${row('Price', o.price)}
      ${o.specials ? row('Special offers', o.specials) : ''}
      ${o.additional_info ? row('Details', o.additional_info) : ''}
      ${row('Received', niceDateTime(o.created_at))}
    </div>
    <div class="lead-actions">${action}</div>
  </article>`;
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
