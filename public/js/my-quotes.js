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
  results.querySelectorAll('[data-respond]').forEach((b) =>
    b.addEventListener('click', () => respond(b.getAttribute('data-id'), b.getAttribute('data-respond'), b)));
  if (typeof wireThreadToggles === 'function') wireThreadToggles(results);
  wireReviews(results);
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
  let body;
  let wide = '';
  if (!offers.length) {
    body = `<div class="offers-list"><div class="offer-row"><div class="offer-main"><div class="offer-advisor">Awaiting advisor quotes. We'll email you the moment a quote comes in.</div></div></div></div>`;
  } else if (offers.length >= 2 && !accepted) {
    // Multiple live quotes on one sailing: show a side-by-side comparison.
    body = comparisonTable(offers);
    wide = ' lead-wide';
  } else {
    body = `<div class="offers-list">${offers.map(offerRow).join('')}</div>`;
  }
  return `<article class="lead${wide}">
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

// Pull the first number out of a free-text price so we can flag the lowest.
function priceValue(v) {
  if (v == null) return null;
  const m = String(v).replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// Per-column action controls, shared by the comparison table.
function offerActions(o) {
  const id = escapeHtml(o.id);
  if (o.status === 'accepted') return `<span class="status-badge status-active">${o.booking_status === 'booked' ? 'Booked' : 'Accepted'}</span>`;
  if (o.status === 'declined') return `<span class="status-badge status-declined">Declined</span>`;
  if (o.status === 'requote') return `<span class="status-badge status-pending">Requote requested</span>`;
  return `<div class="offer-actions cmp-actions">
    <button type="button" class="btn btn-primary" data-respond="accept" data-id="${id}">Accept</button>
    <button type="button" class="btn btn-ghost" data-respond="requote" data-id="${id}">Request requote</button>
    <button type="button" class="btn btn-danger" data-respond="decline" data-id="${id}">Decline</button>
  </div>`;
}

// Side-by-side comparison of every advisor quote on one sailing.
function comparisonTable(offers) {
  // Lowest price among quotes still in play (ignore declined ones).
  const live = offers.filter((o) => o.status !== 'declined');
  const vals = live.map((o) => priceValue(o.price)).filter((n) => n != null);
  const lowest = vals.length ? Math.min(...vals) : null;

  const head = offers.map((o) => {
    const val = priceValue(o.price);
    const best = lowest != null && o.status !== 'declined' && val === lowest;
    const who = o.advisor_name
      ? `${escapeHtml(o.advisor_name)}${o.advisor_agency ? `<span class="cmp-agency">${escapeHtml(o.advisor_agency)}</span>` : ''}`
      : 'Personalized quote';
    const rating = o.advisor_rating ? `<div class="cmp-rating">${ratingBadge(o.advisor_rating, o.advisor_review_count)}</div>` : '';
    return `<th class="${best ? 'is-best' : ''}${o.status === 'declined' ? ' is-declined' : ''}">
      ${best ? '<span class="cmp-best-tag">Lowest price</span>' : ''}
      <div class="cmp-adv">${who}</div>${rating}
    </th>`;
  }).join('');

  const priceCells = offers.map((o) => {
    const val = priceValue(o.price);
    const best = lowest != null && o.status !== 'declined' && val === lowest;
    return `<td class="cmp-price ${best ? 'is-best' : ''}${o.status === 'declined' ? ' is-declined' : ''}">${o.price ? escapeHtml(money(o.price)) : 'Quote'}</td>`;
  }).join('');
  const obcCells = offers.map((o) => `<td>${o.specials ? escapeHtml(o.specials) : '<span class="cmp-dash">—</span>'}</td>`).join('');
  const detailCells = offers.map((o) => `<td>${o.additional_info ? escapeHtml(o.additional_info) : '<span class="cmp-dash">—</span>'}</td>`).join('');
  const dateCells = offers.map((o) => `<td>${escapeHtml(niceDateTime(o.created_at))}</td>`).join('');
  const actionCells = offers.map((o) => `<td class="cmp-action-cell">${offerActions(o)}</td>`).join('');

  return `<div class="cmp-wrap">
    <table class="cmp">
      <thead><tr><th class="cmp-label">Compare ${offers.length} quotes</th>${head}</tr></thead>
      <tbody>
        <tr><th class="cmp-label">Price</th>${priceCells}</tr>
        <tr><th class="cmp-label">Onboard credit &amp; perks</th>${obcCells}</tr>
        <tr><th class="cmp-label">Details</th>${detailCells}</tr>
        <tr><th class="cmp-label">Quoted</th>${dateCells}</tr>
        <tr><th class="cmp-label"></th>${actionCells}</tr>
      </tbody>
    </table>
  </div>`;
}

function offerRow(o) {
  const accepted = o.status === 'accepted';
  const declined = o.status === 'declined';
  const requote = o.status === 'requote';
  const id = escapeHtml(o.id);
  const action = accepted
    ? `<span class="status-badge status-active">${o.booking_status === 'booked' ? 'Booked' : 'Accepted'}</span>`
    : declined
    ? `<span class="status-badge status-declined">Declined</span>`
    : requote
    ? `<span class="status-badge status-pending">Requote requested</span>`
    : `<div class="offer-actions">
        <button type="button" class="btn btn-primary" data-respond="accept" data-id="${id}">Accept</button>
        <button type="button" class="btn btn-ghost" data-respond="requote" data-id="${id}">Request requote</button>
        <button type="button" class="btn btn-danger" data-respond="decline" data-id="${id}">Decline</button>
      </div>`;
  const details = [
    o.specials ? `<div class="offer-detail"><span class="k">Special offers</span> ${escapeHtml(o.specials)}</div>` : '',
    o.additional_info ? `<div class="offer-detail"><span class="k">Details</span> ${escapeHtml(o.additional_info)}</div>` : '',
  ].join('');

  const contactBits = [];
  if (o.advisor_email) contactBits.push(`<a href="mailto:${escapeHtml(o.advisor_email)}">${escapeHtml(o.advisor_email)}</a>`);
  if (o.advisor_phone) contactBits.push(`<a href="tel:${escapeHtml(String(o.advisor_phone).replace(/[^0-9+]/g, ''))}">${escapeHtml(o.advisor_phone)}</a>`);
  const contact = (contactBits.length || o.advisor_location || o.advisor_hours || o.advisor_bio)
    ? `<div class="offer-contact">
        ${o.advisor_location ? `<div class="offer-contact-agency">${escapeHtml(o.advisor_location)}</div>` : ''}
        ${o.advisor_bio ? `<div class="offer-contact-bio">${escapeHtml(o.advisor_bio)}</div>` : ''}
        ${contactBits.length ? `<div>${contactBits.join(' &middot; ')}</div>` : ''}
        ${o.advisor_hours ? `<div class="offer-contact-hours">Available: ${escapeHtml(o.advisor_hours)}</div>` : ''}
      </div>`
    : '';
  const quotedBy = o.advisor_name
    ? `Quoted by ${escapeHtml(o.advisor_name)}${o.advisor_agency ? `, ${escapeHtml(o.advisor_agency)}` : ''}`
    : 'Personalized quote';
  const rating = o.advisor_rating ? ` &middot; ${ratingBadge(o.advisor_rating, o.advisor_review_count)}` : '';
  const review = (accepted && o.can_review) ? reviewWidget(o) : '';
  const thread = accepted
    ? `<div class="thread-bar"><button type="button" class="btn btn-ghost thread-toggle" data-offer="${escapeHtml(o.id)}">Messages${o.unread ? ` <span class="unread-dot">${o.unread}</span>` : ''}</button></div>
       <div class="thread" data-offer="${escapeHtml(o.id)}" hidden><div class="thread-title">Messages with ${o.advisor_name ? escapeHtml(o.advisor_name) : 'your advisor'}</div></div>`
    : '';
  return `<div class="offer-wrap${declined ? ' is-declined' : ''}">
    <div class="offer-row">
      <div class="offer-main">
        <div class="offer-price">${o.price ? escapeHtml(money(o.price)) : 'Quote'}</div>
        <div class="offer-advisor">${quotedBy}${rating} · ${escapeHtml(niceDateTime(o.created_at))}</div>
        ${details}
        ${contact}
        ${review}
      </div>
      <div class="offer-action">${action}</div>
    </div>
    ${thread}
  </div>`;
}

function reviewWidget(o) {
  const r = o.my_review;
  const cur = r ? r.rating : 0;
  const starBtns = [1, 2, 3, 4, 5]
    .map((n) => `<button type="button" class="rate-star${n <= cur ? ' on' : ''}" data-rate="${n}" aria-label="${n} star">★</button>`)
    .join('');
  return `<div class="review-widget" data-review="${escapeHtml(o.id)}">
    <div class="review-title">${r ? 'Your review' : 'How was your advisor?'}</div>
    <div class="rate-stars" data-current="${cur}">${starBtns}</div>
    <textarea class="review-comment" data-review-comment placeholder="Share a few words about your experience (optional)">${r && r.comment ? escapeHtml(r.comment) : ''}</textarea>
    <button type="button" class="btn btn-ghost btn-sm" data-review-save>${r ? 'Update review' : 'Submit review'}</button>
    <span class="review-msg" data-review-msg></span>
  </div>`;
}

function wireReviews(scope) {
  scope.querySelectorAll('.review-widget').forEach((w) => {
    const starsEl = w.querySelector('.rate-stars');
    const stars = [...w.querySelectorAll('.rate-star')];
    stars.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        const n = idx + 1;
        starsEl.setAttribute('data-current', String(n));
        stars.forEach((b, i) => b.classList.toggle('on', i < n));
      });
    });
    const saveBtn = w.querySelector('[data-review-save]');
    saveBtn.addEventListener('click', async () => {
      const rating = parseInt(starsEl.getAttribute('data-current'), 10) || 0;
      const msg = w.querySelector('[data-review-msg]');
      if (rating < 1) { msg.style.color = 'var(--danger)'; msg.textContent = 'Please choose a star rating.'; return; }
      const comment = w.querySelector('[data-review-comment]').value.trim();
      saveBtn.disabled = true;
      const { ok, data } = await api('/api/reviews', { method: 'POST', body: { offer_id: w.getAttribute('data-review'), rating, comment } });
      saveBtn.disabled = false;
      if (ok) { msg.style.color = 'var(--success)'; msg.textContent = 'Thanks for your review!'; saveBtn.textContent = 'Update review'; }
      else { msg.style.color = 'var(--danger)'; msg.textContent = (data && data.message) || 'Could not save your review.'; }
    });
  });
}

async function respond(id, action, btn) {
  const prompts = {
    accept: 'Accept this quote? The other quotes on this sailing will close and your advisor will be notified to finalize.',
    decline: 'Decline this quote?',
    requote: 'Ask this advisor for a revised quote?',
  };
  if (!confirm(prompts[action] || 'Continue?')) return;
  const buttons = btn.closest('.offer-actions') ? btn.closest('.offer-actions').querySelectorAll('button') : [btn];
  buttons.forEach((b) => (b.disabled = true));
  const { ok } = await api('/api/my/quotes/respond', { method: 'POST', body: { offer_id: id, action } });
  if (!ok) { buttons.forEach((b) => (b.disabled = false)); alert('Could not update right now. Please try again.'); return; }
  const q = QUOTES.find((x) => x.id === id);
  const newStatus = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'requote';
  if (q) {
    q.status = newStatus;
    if (action === 'accept') {
      // Sibling quotes on the same request are now closed.
      QUOTES.forEach((x) => {
        if (x.quote_request_id === q.quote_request_id && x.id !== id && x.status === 'submitted') x.status = 'declined';
      });
    }
  }
  render();
}

init();
