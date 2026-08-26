// Client "My quotes": one collapsible card per request. Open a request to see
// its quotes stacked vertically; open a quote to see the full detail and decide
// (Accept, Hold, Request requote, with a reason, or Decline).

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
  return new Date(Number(ms)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateStr(s) {
  if (!s) return '';
  const d = new Date(String(s) + 'T00:00:00');
  if (isNaN(d)) return escapeHtml(String(s));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Sort: accepted first, then open (submitted/hold/requote), then closed.
function offerRank(o) {
  if (o.status === 'accepted') return 0;
  if (o.status === 'declined') return 2;
  return 1;
}
function offersFor(r) {
  return QUOTES.filter((q) => q.quote_request_id === r.id).sort((a, b) => offerRank(a) - offerRank(b));
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
  results.innerHTML = `<div class="qr-list">${REQUESTS.map(requestCard).join('')}</div>`;
  wireInteractions(results);
}

// --- Collapsible request card -------------------------------------------------

function requestCard(r) {
  const sailing = r.sailing_name || r.ship || 'Cruise';
  const meta = [r.cruise_line, r.ship, r.sailing_dates, r.departure_port ? `Departs ${r.departure_port}` : '']
    .filter(Boolean).join('  ·  ');
  const offers = offersFor(r);
  const n = offers.length;
  const accepted = offers.some((o) => o.status === 'accepted');
  const badge = accepted
    ? `<span class="status-badge status-active">Accepted</span>`
    : n
    ? `<span class="status-badge status-pending">${n} quote${n === 1 ? '' : 's'}</span>`
    : `<span class="status-badge status-declined">Awaiting quotes</span>`;
  const quotesHtml = n
    ? offers.map(quoteItem).join('')
    : `<div class="qo-empty">Awaiting advisor quotes. We'll email you the moment one arrives.</div>`;
  return `<article class="qr" data-req="${escapeHtml(r.id)}">
    <button type="button" class="qr-head" data-toggle-req aria-expanded="false">
      <span class="qr-head-main">
        <span class="qr-title">${escapeHtml(sailing)}</span>
        <span class="qr-sub">${escapeHtml(meta)} · requested ${escapeHtml(niceDateTime(r.created_at))}</span>
      </span>
      <span class="qr-head-side">${badge}<span class="qr-chev" aria-hidden="true">▾</span></span>
    </button>
    <div class="qr-quotes" hidden>${quotesHtml}</div>
  </article>`;
}

// --- One collapsible quote ----------------------------------------------------

function statusPill(o) {
  if (o.status === 'accepted') return `<span class="status-badge status-active">${o.booking_status === 'booked' ? 'Booked' : 'Accepted'}</span>`;
  if (o.status === 'declined') return `<span class="status-badge status-declined">Declined</span>`;
  if (o.status === 'requote') return `<span class="status-badge status-pending">Requote requested</span>`;
  if (o.status === 'hold') return `<span class="status-badge status-hold">On hold</span>`;
  return '';
}

function priceLabel(o) {
  if (Array.isArray(o.cabin_fares) && o.cabin_fares.length) {
    const lows = o.cabin_fares.map((c) => c && c.fare).filter((n) => n != null);
    if (lows.length) return `from ${money(Math.min(...lows))}`;
  }
  if (o.total_price != null) return money(o.total_price);
  return o.price ? money(o.price) : 'Quote';
}

function quoteItem(o) {
  const id = escapeHtml(o.id);
  const who = o.advisor_name
    ? `${escapeHtml(o.advisor_name)}${o.advisor_agency ? ` · ${escapeHtml(o.advisor_agency)}` : ''}`
    : 'Personalized quote';
  const verified = o.advisor_name ? ' <span class="verified-pill" title="Credential-verified travel advisor">✓</span>' : '';
  return `<div class="qo status-${escapeHtml(o.status || 'submitted')}" data-offer="${id}">
    <button type="button" class="qo-head" data-toggle-offer aria-expanded="false">
      <span class="qo-who">${who}${verified}</span>
      <span class="qo-price">${escapeHtml(priceLabel(o))}</span>
      <span class="qo-status">${statusPill(o)}</span>
      <span class="qr-chev" aria-hidden="true">▾</span>
    </button>
    <div class="qo-body" hidden>
      ${quoteDetail(o)}
      ${actions(o)}
      ${extras(o)}
    </div>
  </div>`;
}

function quoteDetail(o) {
  const priceBlock = (Array.isArray(o.cabin_fares) && o.cabin_fares.length)
    ? `<div class="offer-fares">${o.cabin_fares.map((c) => `<div class="offer-fare"><span class="offer-fare-type">${escapeHtml(c.type)}</span><span class="offer-fare-amt">${escapeHtml(money(c.fare))}</span></div>`).join('')}</div>`
    : `<div class="offer-price">${o.price ? escapeHtml(money(o.price)) : 'Quote'}</div>`;

  const line = (label, val) => (val || val === 0) ? `<div class="offer-detail"><span class="k">${label}</span> ${escapeHtml(String(val))}</div>` : '';
  const money2 = (v) => (v == null ? '' : money(v));
  const rows = [
    line('Total (all guests)', o.total_price != null ? money2(o.total_price) : ''),
    line('Base fare', o.base_fare != null ? money2(o.base_fare) : ''),
    line('Taxes &amp; fees', o.taxes_fees != null ? money2(o.taxes_fees) : ''),
    line('Onboard credit', o.obc_amount != null ? money2(o.obc_amount) : ''),
    o.gratuities_included != null ? line('Gratuities', o.gratuities_included ? 'Included' : 'Not included') : '',
    line('Deposit due', o.deposit_amount != null ? money2(o.deposit_amount) : ''),
    o.final_payment_date ? line('Final payment', fmtDateStr(o.final_payment_date)) : '',
    line('Perks &amp; notes', o.specials || ''),
    line('Details', o.additional_info || ''),
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
  const rating = o.advisor_rating ? `<div class="qo-rating">${ratingBadge(o.advisor_rating, o.advisor_review_count)}</div>` : '';

  return `<div class="qo-detail">
    ${priceBlock}
    <div class="qo-meta">Quoted ${escapeHtml(niceDateTime(o.created_at))}</div>
    ${rating}
    <div class="offer-details">${rows}</div>
    ${contact}
  </div>`;
}

function actions(o) {
  const id = escapeHtml(o.id);
  if (o.status === 'accepted' || o.status === 'declined' || o.status === 'requote') {
    return `<div class="qo-actions qo-closed">${statusPill(o)}</div>`;
  }
  const held = o.status === 'hold';
  return `<div class="qo-actions">
    <button type="button" class="btn btn-primary" data-act="accept" data-id="${id}">Accept</button>
    ${held
      ? `<button type="button" class="btn btn-ghost" data-act="release" data-id="${id}">Release hold</button>`
      : `<button type="button" class="btn btn-ghost" data-act="hold" data-id="${id}">Hold</button>`}
    <button type="button" class="btn btn-ghost" data-act="requote" data-id="${id}">Request requote</button>
    <button type="button" class="btn btn-danger" data-act="decline" data-id="${id}">Decline</button>
  </div>`;
}

// Messages thread + review widget, shown once a quote is accepted.
function extras(o) {
  if (o.status !== 'accepted') return '';
  const thread = `<div class="thread-bar"><button type="button" class="btn btn-ghost thread-toggle" data-offer="${escapeHtml(o.id)}">Messages${o.unread ? ` <span class="unread-dot">${o.unread}</span>` : ''}</button></div>
    <div class="thread" data-offer="${escapeHtml(o.id)}" hidden><div class="thread-title">Messages with ${o.advisor_name ? escapeHtml(o.advisor_name) : 'your advisor'}</div></div>`;
  const review = o.can_review ? reviewWidget(o) : '';
  return thread + review;
}

// --- Interaction --------------------------------------------------------------

function wireInteractions(scope) {
  scope.querySelectorAll('[data-toggle-req]').forEach((b) => b.addEventListener('click', () => {
    const qr = b.closest('.qr');
    const box = qr.querySelector('.qr-quotes');
    const open = box.hasAttribute('hidden');
    if (open) box.removeAttribute('hidden'); else box.setAttribute('hidden', '');
    b.setAttribute('aria-expanded', String(open));
    qr.classList.toggle('is-open', open);
  }));
  scope.querySelectorAll('[data-toggle-offer]').forEach((b) => b.addEventListener('click', () => {
    const qo = b.closest('.qo');
    const body = qo.querySelector('.qo-body');
    const open = body.hasAttribute('hidden');
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    b.setAttribute('aria-expanded', String(open));
    qo.classList.toggle('is-open', open);
  }));
  scope.querySelectorAll('[data-act]').forEach((b) =>
    b.addEventListener('click', () => onAction(b.getAttribute('data-id'), b.getAttribute('data-act'), b)));
  if (typeof wireThreadToggles === 'function') wireThreadToggles(scope);
  wireReviews(scope);
}

async function onAction(id, action, btn) {
  if (action === 'requote') { openRequoteModal(id); return; }
  const prompts = {
    accept: 'Accept this quote? The other quotes on this sailing will close and your advisor will be notified to finalize.',
    decline: 'Decline this quote?',
    hold: null, // no confirm, reversible
    release: null,
  };
  if (prompts[action] && !confirm(prompts[action])) return;
  await respond(id, action, null, btn);
}

async function respond(id, action, reason, btn) {
  const group = btn ? btn.closest('.qo-actions') : null;
  const buttons = group ? [...group.querySelectorAll('button')] : (btn ? [btn] : []);
  buttons.forEach((b) => (b.disabled = true));
  const { ok, data } = await api('/api/my/quotes/respond', { method: 'POST', body: { offer_id: id, action, reason } });
  if (!ok) {
    buttons.forEach((b) => (b.disabled = false));
    alert((data && data.message) || 'Could not update right now. Please try again.');
    return false;
  }
  const q = QUOTES.find((x) => x.id === id);
  const newStatus = { accept: 'accepted', decline: 'declined', requote: 'requote', hold: 'hold', release: 'submitted' }[action];
  let reqId = q ? q.quote_request_id : null;
  if (q) {
    q.status = newStatus;
    if (action === 'requote') q.requote_reason = reason;
    if (action === 'accept') {
      QUOTES.forEach((x) => {
        if (x.quote_request_id === q.quote_request_id && x.id !== id && ['submitted', 'hold'].includes(x.status)) x.status = 'declined';
      });
    }
  }
  render();
  // Keep the request (and the acted quote) open so the user sees the result.
  if (reqId) {
    const qr = document.querySelector(`.qr[data-req="${cssEscape(reqId)}"]`);
    if (qr) { qr.querySelector('.qr-quotes').removeAttribute('hidden'); qr.classList.add('is-open'); qr.querySelector('[data-toggle-req]').setAttribute('aria-expanded', 'true'); }
    const qo = document.querySelector(`.qo[data-offer="${cssEscape(id)}"]`);
    if (qo) { const body = qo.querySelector('.qo-body'); if (body) body.removeAttribute('hidden'); qo.classList.add('is-open'); }
  }
  return true;
}

function cssEscape(s) { return String(s).replace(/["\\]/g, '\\$&'); }

// --- Requote reason modal -----------------------------------------------------

function openRequoteModal(offerId) {
  let ov = document.getElementById('requoteModal');
  if (!ov) {
    ov = document.createElement('div');
    ov.id = 'requoteModal';
    ov.className = 'modal-overlay';
    ov.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="requoteTitle">
        <h3 id="requoteTitle">Request a revised quote</h3>
        <p class="modal-sub">Tell your advisor what you'd like changed, a lower price, a different cabin, added perks, other dates, etc. They'll use this to send an updated quote.</p>
        <textarea id="requoteReason" rows="4" maxlength="1000" placeholder="e.g. Can you match a lower price I found, or include gratuities?"></textarea>
        <div class="modal-err" id="requoteErr" hidden></div>
        <div class="modal-actions">
          <button type="button" class="btn btn-ghost" id="requoteCancel">Cancel</button>
          <button type="button" class="btn btn-primary" id="requoteSend">Send request</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
  }
  const ta = ov.querySelector('#requoteReason');
  const err = ov.querySelector('#requoteErr');
  ta.value = ''; err.hidden = true;
  ov.classList.add('open');
  setTimeout(() => ta.focus(), 30);
  const close = () => { ov.classList.remove('open'); };
  ov.querySelector('#requoteCancel').onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.querySelector('#requoteSend').onclick = async () => {
    const reason = ta.value.trim();
    if (!reason) { err.textContent = 'Please add a short note so the advisor knows what to revise.'; err.hidden = false; return; }
    const sendBtn = ov.querySelector('#requoteSend');
    sendBtn.disabled = true;
    const okDone = await respond(offerId, 'requote', reason, null);
    sendBtn.disabled = false;
    if (okDone) close();
  };
}

// --- Reviews (unchanged) ------------------------------------------------------

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

init();
