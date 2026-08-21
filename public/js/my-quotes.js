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

// Format an ISO date string (YYYY-MM-DD) without timezone drift.
function fmtDateStr(s) {
  if (!s) return '';
  const d = new Date(String(s) + 'T00:00:00');
  if (isNaN(d)) return escapeHtml(String(s));
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

// Structured helpers for the comparison chart.
function offerTotal(o) {
  // The all-in total: the numeric Total price, or base fare + taxes as a fallback.
  if (o.total_price != null) return o.total_price;
  return o.base_fare != null ? o.base_fare + (o.taxes_fees || 0) : null;
}
function offerNet(o) {
  // Total price after subtracting onboard credit (true out-of-pocket value).
  const t = offerTotal(o);
  return t != null ? t - (o.obc_amount || 0) : null;
}
function dash() { return '<span class="cmp-dash">—</span>'; }

// When the client asked about multiple cabin types, compare a fare per cabin
// type: one row per type, with the lowest live fare in each row flagged.
function comparisonTableByCabin(offers) {
  const live = offers.filter((o) => o.status !== 'declined');
  const order = ['Inside', 'Outside/Ocean View', 'Balcony', 'Suite'];
  const seen = [];
  offers.forEach((o) => (o.cabin_fares || []).forEach((c) => {
    if (c && c.type && !seen.includes(c.type)) seen.push(c.type);
  }));
  const types = seen.slice().sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  const fareFor = (o, type) => {
    const c = (o.cabin_fares || []).find((x) => x && x.type === type);
    return c && c.fare != null ? c.fare : null;
  };
  const cls = (o, extra) => `${extra || ''}${o.status === 'declined' ? ' is-declined' : ''}`;

  const head = offers.map((o) => {
    const who = o.advisor_name
      ? `${escapeHtml(o.advisor_name)}${o.advisor_agency ? `<span class="cmp-agency">${escapeHtml(o.advisor_agency)}</span>` : ''}`
      : 'Personalized quote';
    const rating = o.advisor_rating ? `<div class="cmp-rating">${ratingBadge(o.advisor_rating, o.advisor_review_count)}</div>` : '';
    const verified = o.advisor_name ? `<div class="cmp-verified"><span class="verified-pill" title="Credential-verified travel advisor">✓ Verified</span></div>` : '';
    return `<th class="${o.status === 'declined' ? 'is-declined' : ''}"><div class="cmp-adv">${who}</div>${verified}${rating}</th>`;
  }).join('');

  let cabinRows = '';
  types.forEach((type) => {
    const liveFares = live.map((o) => fareFor(o, type)).filter((n) => n != null);
    const low = liveFares.length ? Math.min(...liveFares) : null;
    const cells = offers.map((o) => {
      const f = fareFor(o, type);
      const best = low != null && o.status !== 'declined' && f === low;
      const val = f != null ? `${escapeHtml(money(f))}${best ? '<span class="cmp-low">Lowest</span>' : ''}` : dash();
      return `<td class="cmp-price${cls(o, best ? ' is-best' : '')}">${val}</td>`;
    }).join('');
    cabinRows += `<tr><th class="cmp-label">${escapeHtml(type)}</th>${cells}</tr>`;
  });

  const rowFor = (label, present, cell) => present
    ? `<tr><th class="cmp-label">${label}</th>${offers.map((o) => `<td class="${cls(o)}">${cell(o)}</td>`).join('')}</tr>`
    : '';
  let extraRows = '';
  extraRows += rowFor('Onboard credit', offers.some((o) => o.obc_amount != null), (o) => o.obc_amount != null ? escapeHtml(money(o.obc_amount)) : dash());
  extraRows += rowFor('Gratuities', offers.some((o) => o.gratuities_included != null), (o) => o.gratuities_included == null ? dash() : (o.gratuities_included ? 'Included' : 'Not included'));
  extraRows += rowFor('Deposit due', offers.some((o) => o.deposit_amount != null), (o) => o.deposit_amount != null ? escapeHtml(money(o.deposit_amount)) : dash());
  extraRows += rowFor('Final payment', offers.some((o) => o.final_payment_date), (o) => o.final_payment_date ? fmtDateStr(o.final_payment_date) : dash());
  extraRows += rowFor('Perks &amp; notes', offers.some((o) => o.specials), (o) => o.specials ? escapeHtml(o.specials) : dash());
  extraRows += rowFor('Details', offers.some((o) => o.additional_info), (o) => o.additional_info ? escapeHtml(o.additional_info) : dash());

  const dateCells = offers.map((o) => `<td class="${cls(o)}">${escapeHtml(niceDateTime(o.created_at))}</td>`).join('');
  const actionCells = offers.map((o) => `<td class="cmp-action-cell">${offerActions(o)}</td>`).join('');

  return `<div class="cmp-wrap">
    <table class="cmp">
      <thead><tr><th class="cmp-label">Fare by cabin <span class="cmp-note">lowest flagged per row</span></th>${head}</tr></thead>
      <tbody>
        ${cabinRows}
        ${extraRows}
        <tr><th class="cmp-label">Quoted</th>${dateCells}</tr>
        <tr><th class="cmp-label"></th>${actionCells}</tr>
      </tbody>
    </table>
  </div>`;
}

// Side-by-side comparison of every advisor quote on one sailing. When advisors
// give a structured price breakdown we rank by net value ("Best value");
// otherwise we fall back to the lowest free-text price.
function comparisonTable(offers) {
  // Per-cabin-type comparison when advisors priced individual cabin types.
  if (offers.some((o) => Array.isArray(o.cabin_fares) && o.cabin_fares.length)) {
    return comparisonTableByCabin(offers);
  }
  const live = offers.filter((o) => o.status !== 'declined');

  // Ranking: use net value (Total price minus onboard credit) when 2+ live
  // quotes give a comparable total; otherwise fall back to lowest free-text.
  const nets = live.map(offerNet).filter((n) => n != null);
  const useNet = nets.length >= 2;
  const anyObc = offers.some((o) => o.obc_amount != null && o.obc_amount > 0);
  const showNetRow = useNet && anyObc; // net differs from total only with a credit
  let bestVal = null;
  if (useNet) bestVal = Math.min(...nets);
  else {
    const vals = live.map((o) => priceValue(o.price)).filter((n) => n != null);
    bestVal = vals.length ? Math.min(...vals) : null;
  }
  const isBest = (o) => {
    if (o.status === 'declined' || bestVal == null) return false;
    const metric = useNet ? offerNet(o) : priceValue(o.price);
    return metric != null && metric === bestVal;
  };
  const bestLabel = useNet ? 'Best value' : 'Lowest price';

  const head = offers.map((o) => {
    const who = o.advisor_name
      ? `${escapeHtml(o.advisor_name)}${o.advisor_agency ? `<span class="cmp-agency">${escapeHtml(o.advisor_agency)}</span>` : ''}`
      : 'Personalized quote';
    const rating = o.advisor_rating ? `<div class="cmp-rating">${ratingBadge(o.advisor_rating, o.advisor_review_count)}</div>` : '';
    const verified = o.advisor_name ? `<div class="cmp-verified"><span class="verified-pill" title="Credential-verified travel advisor">✓ Verified</span></div>` : '';
    return `<th class="${isBest(o) ? 'is-best' : ''}${o.status === 'declined' ? ' is-declined' : ''}">
      ${isBest(o) ? `<span class="cmp-best-tag">${bestLabel}</span>` : ''}
      <div class="cmp-adv">${who}</div>${verified}${rating}
    </th>`;
  }).join('');

  const cls = (o, extra) => `${extra || ''}${o.status === 'declined' ? ' is-declined' : ''}`;
  // Total price (all-in) is always shown; highlight it when it is the ranking metric.
  const priceCells = offers.map((o) => {
    const t = offerTotal(o);
    const val = t != null ? money(t) : (o.price ? money(o.price) : 'Quote');
    const hi = isBest(o) && !showNetRow ? ' is-best' : '';
    return `<td class="cmp-price${cls(o, hi)}">${escapeHtml(val)}</td>`;
  }).join('');

  // Structured rows, each group shown only when an advisor supplied it.
  let structuredRows = '';
  const hasPriceParts = offers.some(
    (o) => o.base_fare != null || o.taxes_fees != null || o.obc_amount != null || o.gratuities_included != null
  );
  if (hasPriceParts) {
    const baseCells = offers.map((o) => `<td class="${cls(o)}">${o.base_fare != null ? escapeHtml(money(o.base_fare)) : dash()}</td>`).join('');
    const taxCells = offers.map((o) => `<td class="${cls(o)}">${o.taxes_fees != null ? escapeHtml(money(o.taxes_fees)) : dash()}</td>`).join('');
    const obcCells = offers.map((o) => `<td class="${cls(o)}">${o.obc_amount != null ? escapeHtml(money(o.obc_amount)) : dash()}</td>`).join('');
    const gratCells = offers.map((o) => `<td class="${cls(o)}">${o.gratuities_included == null ? dash() : (o.gratuities_included ? 'Included' : 'Not included')}</td>`).join('');
    structuredRows +=
      `<tr><th class="cmp-label">Base fare</th>${baseCells}</tr>` +
      `<tr><th class="cmp-label">Taxes &amp; fees</th>${taxCells}</tr>` +
      `<tr><th class="cmp-label">Onboard credit</th>${obcCells}</tr>` +
      `<tr><th class="cmp-label">Gratuities</th>${gratCells}</tr>`;
  }
  if (showNetRow) {
    const netCells = offers.map((o) => {
      const net = offerNet(o);
      const hi = isBest(o) ? ' is-best' : '';
      return `<td class="cmp-price${cls(o, hi)}">${net != null ? escapeHtml(money(net)) : dash()}</td>`;
    }).join('');
    structuredRows += `<tr><th class="cmp-label">Net after credit</th>${netCells}</tr>`;
  }
  // Payment terms (shown only when at least one advisor provided them).
  if (offers.some((o) => o.deposit_amount != null)) {
    const depCells = offers.map((o) => `<td class="${cls(o)}">${o.deposit_amount != null ? escapeHtml(money(o.deposit_amount)) : dash()}</td>`).join('');
    structuredRows += `<tr><th class="cmp-label">Deposit due</th>${depCells}</tr>`;
  }
  if (offers.some((o) => o.final_payment_date)) {
    const finCells = offers.map((o) => `<td class="${cls(o)}">${o.final_payment_date ? fmtDateStr(o.final_payment_date) : dash()}</td>`).join('');
    structuredRows += `<tr><th class="cmp-label">Final payment</th>${finCells}</tr>`;
  }

  const permsRow = offers.some((o) => o.specials)
    ? `<tr><th class="cmp-label">Perks &amp; notes</th>${offers.map((o) => `<td class="${cls(o)}">${o.specials ? escapeHtml(o.specials) : dash()}</td>`).join('')}</tr>`
    : '';
  const detailsRow = offers.some((o) => o.additional_info)
    ? `<tr><th class="cmp-label">Details</th>${offers.map((o) => `<td class="${cls(o)}">${o.additional_info ? escapeHtml(o.additional_info) : dash()}</td>`).join('')}</tr>`
    : '';
  const dateCells = offers.map((o) => `<td class="${cls(o)}">${escapeHtml(niceDateTime(o.created_at))}</td>`).join('');
  const actionCells = offers.map((o) => `<td class="cmp-action-cell">${offerActions(o)}</td>`).join('');

  return `<div class="cmp-wrap">
    <table class="cmp">
      <thead><tr><th class="cmp-label">Compare ${offers.length} quotes</th>${head}</tr></thead>
      <tbody>
        <tr><th class="cmp-label">Total fare <span class="cmp-note">all guests, incl. taxes &amp; fees</span></th>${priceCells}</tr>
        ${structuredRows}
        ${permsRow}
        ${detailsRow}
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
  const verified = o.advisor_name ? ' <span class="verified-pill" title="Credential-verified travel advisor">✓ Verified</span>' : '';
  const rating = o.advisor_rating ? ` &middot; ${ratingBadge(o.advisor_rating, o.advisor_review_count)}` : '';
  const review = (accepted && o.can_review) ? reviewWidget(o) : '';
  const thread = accepted
    ? `<div class="thread-bar"><button type="button" class="btn btn-ghost thread-toggle" data-offer="${escapeHtml(o.id)}">Messages${o.unread ? ` <span class="unread-dot">${o.unread}</span>` : ''}</button></div>
       <div class="thread" data-offer="${escapeHtml(o.id)}" hidden><div class="thread-title">Messages with ${o.advisor_name ? escapeHtml(o.advisor_name) : 'your advisor'}</div></div>`
    : '';
  // Show a fare per cabin type when the advisor priced several; else one price.
  const priceBlock = (Array.isArray(o.cabin_fares) && o.cabin_fares.length)
    ? `<div class="offer-fares">${o.cabin_fares.map((c) => `<div class="offer-fare"><span class="offer-fare-type">${escapeHtml(c.type)}</span><span class="offer-fare-amt">${escapeHtml(money(c.fare))}</span></div>`).join('')}</div>`
    : `<div class="offer-price">${o.price ? escapeHtml(money(o.price)) : 'Quote'}</div>`;
  return `<div class="offer-wrap${declined ? ' is-declined' : ''}">
    <div class="offer-row">
      <div class="offer-main">
        ${priceBlock}
        <div class="offer-advisor">${quotedBy}${verified}${rating} · ${escapeHtml(niceDateTime(o.created_at))}</div>
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
