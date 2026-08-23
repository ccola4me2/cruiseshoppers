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
  results.querySelectorAll('[data-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => toggleMore(btn));
  });
  window.__specials = specials;
}

// Expand / collapse the "More information" panel on a special card.
function toggleMore(btn) {
  const cardEl = btn.closest('.special-card');
  const panel = cardEl && cardEl.querySelector('.special-more');
  if (!panel) return;
  const opening = panel.hasAttribute('hidden');
  if (opening) panel.removeAttribute('hidden'); else panel.setAttribute('hidden', '');
  btn.setAttribute('aria-expanded', String(opening));
  btn.textContent = opening ? 'Less information' : 'More information';
}

function card(s) {
  const line = [s.cruise_line, s.ship].filter(Boolean).map(escapeHtml).join(' · ') || 'Cruise special';
  const offeredBy = [s.advisor_name, s.agency].filter(Boolean).join(', ');

  // The cruise line + ship already show in the header, so strip a duplicate
  // leading mention from the headline to keep the title short and readable.
  const esc = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let title = String(s.headline || '').trim();
  [s.cruise_line, s.ship].filter(Boolean).forEach((p) => {
    title = title.replace(new RegExp('^\\s*' + esc(p) + '\\s*[-–·:,]?\\s*', 'i'), '');
  });
  title = title.trim() || s.headline || 'Cruise special';
  const num = (v) => { const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };
  const rate = num(s.rate_from);
  const brochure = num(s.brochure_price);
  const save = (rate != null && brochure != null && brochure > rate) ? Math.round(brochure - rate) : null;

  const priceRow = rate != null
    ? `<div class="special-price-row">
        <div class="special-price"><span class="special-from">from</span> ${escapeHtml(money(s.rate_from))}<span class="special-pp">/person</span></div>
        ${brochure != null ? `<span class="special-was">${escapeHtml(money(s.brochure_price))}</span>` : ''}
        ${save ? `<span class="special-save">Save $${save.toLocaleString()} pp</span>` : ''}
      </div>`
    : '';

  const chips = [];
  if (s.cabin_category) chips.push(`<span class="special-chip is-cabin">${escapeHtml(s.cabin_category)}</span>`);
  if (s.sail_dates) chips.push(`<span class="special-chip">${escapeHtml(s.sail_dates)}</span>`);
  if (s.us_canada_only) chips.push(`<span class="special-chip is-note">U.S. residents only</span>`);

  const rating = s.advisor_rating ? `<span class="special-rating">${ratingBadge(s.advisor_rating, s.advisor_review_count)}</span>` : '';

  // Everything below the price is collapsed behind "More information".
  const hasMore = !!(s.description || offeredBy);
  const more = hasMore
    ? `<div class="special-more" hidden>
        ${s.description ? `<p class="special-desc">${escapeHtml(s.description)}</p>` : ''}
        ${offeredBy ? `<div class="special-advisor"><span class="special-advisor-name">${escapeHtml(offeredBy)}</span><span class="verified-pill" title="Credential-verified travel advisor">✓ Verified</span>${rating}</div>` : ''}
      </div>`
    : '';

  return `<article class="special-card">
    <div class="special-top">
      <span class="special-tag">Featured deal</span>
      <div class="special-line">${line}</div>
    </div>
    <div class="special-body">
      <h2 class="special-headline">${escapeHtml(title)}</h2>
      ${chips.length ? `<div class="special-chips">${chips.join('')}</div>` : ''}
      ${priceRow}
      ${more}
    </div>
    <div class="special-foot">
      ${hasMore ? `<button type="button" class="special-toggle" data-toggle="${escapeHtml(s.id)}" aria-expanded="false">More information</button>` : ''}
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
