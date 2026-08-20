// Client-facing Specials page: browse advisor-posted deals and request a quote.
// Requesting a quote stores the sailing and sends the client to /quote, where
// the request is routed only to the advisor who posted the special.

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  const { ok, data } = await api('/api/specials');
  const results = document.getElementById('results');
  const count = document.getElementById('count');
  if (!ok) { results.innerHTML = `<div class="state">Could not load specials right now. Please try again.</div>`; count.textContent = ''; return; }
  const specials = data.specials || [];
  count.textContent = specials.length ? `${specials.length} special${specials.length === 1 ? '' : 's'} available` : 'No specials right now';
  if (!specials.length) {
    results.innerHTML = `<div class="state">There are no specials posted right now. Check back soon, or <a href="/app">browse all sailings</a> to request a quote on any cruise.</div>`;
    return;
  }
  results.innerHTML = `<div class="special-grid">${specials.map(card).join('')}</div>`;
  results.querySelectorAll('[data-request]').forEach((btn) => {
    btn.addEventListener('click', () => request(btn.getAttribute('data-request')));
  });
  window.__specials = specials;
}

function card(s) {
  const shipLine = [s.cruise_line, s.ship].filter(Boolean).map(escapeHtml).join(' · ');
  const offeredBy = [s.advisor_name, s.agency].filter(Boolean).join(', ');
  const price = s.rate_from
    ? `<div class="special-price">${escapeHtml(money(s.rate_from))} <span class="special-pp">pp</span>${s.brochure_price ? ` <span class="special-was">${escapeHtml(money(s.brochure_price))}</span>` : ''}</div>`
    : '';
  return `<article class="special-card">
    <div class="special-body">
      ${shipLine ? `<div class="special-ship">${shipLine}</div>` : ''}
      <h2 class="special-headline">${escapeHtml(s.headline)}</h2>
      ${s.sail_dates ? `<div class="special-dates">${escapeHtml(s.sail_dates)}</div>` : ''}
      ${price}
      ${s.description ? `<p class="special-desc">${escapeHtml(s.description)}</p>` : ''}
      ${s.us_canada_only ? `<div class="hint">U.S. residents only</div>` : ''}
      ${offeredBy ? `<div class="special-advisor">Offered by ${escapeHtml(offeredBy)}${s.advisor_rating ? ` &middot; ${ratingBadge(s.advisor_rating, s.advisor_review_count)}` : ''}</div>` : ''}
    </div>
    <div class="special-foot">
      <button type="button" class="btn btn-primary btn-block" data-request="${escapeHtml(s.id)}">Request a quote</button>
      <div class="no-price">No obligation. The advisor confirms final pricing.</div>
    </div>
  </article>`;
}

function request(id) {
  const s = (window.__specials || []).find((x) => x.id === id);
  if (!s) return;
  const sailing = {
    line: s.cruise_line || '',
    ship: s.ship || '',
    name: s.headline || '',
    sailing_dates: s.sail_dates || '',
    special_id: s.id,
  };
  try { sessionStorage.setItem('cs_quote_sailing', JSON.stringify(sailing)); } catch {}
  window.location.href = '/quote';
}

init();
