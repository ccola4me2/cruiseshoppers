// Advisor portal: browse client quote requests, submit a priced quote
// (specials + additional info + price) on any request, and see the quotes
// you've submitted.

let REQUESTS = [];
let OFFERS = [];
let FOCUS = null; // a specific request opened from a new-request email link
let TAB = 'open';

async function init() {
  const user = await getMe();
  if (!user) { window.location.href = '/advisor/login?next=' + encodeURIComponent(location.pathname + location.search); return; }
  if (user.role !== 'advisor') { window.location.href = user.role === 'admin' ? '/admin' : '/app'; return; }
  if (user.status !== 'active') { window.location.href = '/advisor/pending'; return; }
  renderAdvisorNav(user);
  wireTabs();
  wireFilters();
  await load();
  const focusId = new URLSearchParams(location.search).get('request');
  if (focusId) await loadFocus(focusId);
  render();
}

async function loadFocus(id) {
  try {
    const res = await fetch(`/api/advisor/request?id=${encodeURIComponent(id)}`, { credentials: 'same-origin' });
    if (!res.ok) return;
    const d = await res.json();
    FOCUS = d.request || null;
  } catch (_) {}
}

function renderAdvisorNav(user) {
  const nav = document.getElementById('accountNav');
  nav.innerHTML =
    `<span class="hide-sm" style="color:var(--muted);font-size:.92rem;">${escapeHtml(user.first_name || 'Advisor')}</span>` +
    (user.agency_role === 'owner' ? `<a href="/agency">Agency portal</a>` : '') +
    `<a href="/advisor/specials">Specials</a>` +
    `<a href="/advisor/profile">My profile</a>` +
    `<a href="#" id="logoutLink" class="btn btn-ghost" style="padding:8px 16px;">Sign out</a>`;
  nav.querySelector('#logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });
}

const TAB_TITLE = { open: 'Open quotes', submitted: 'Submitted quotes', closed: 'Closed quotes' };

function wireTabs() {
  document.querySelectorAll('#tabs .tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      TAB = btn.getAttribute('data-tab');
      document.querySelectorAll('#tabs .tab').forEach((b) => b.classList.toggle('is-active', b === btn));
      document.getElementById('filters').style.display = TAB === 'open' ? '' : 'none';
      document.getElementById('pageTitle').textContent = TAB_TITLE[TAB] || 'Quotes';
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
  if (TAB === 'submitted') {
    return renderOffers(results, OFFERS.filter((o) => ['submitted', 'requote'].includes(o.status || 'submitted')), 'submitted');
  }
  if (TAB === 'closed') {
    return renderOffers(results, OFFERS.filter((o) => ['accepted', 'declined'].includes(o.status)), 'closed');
  }

  // Open quotes: requests not yet closed AND that this advisor hasn't quoted yet
  // (once you submit a quote it moves to the Submitted tab).
  let list = filteredRequests().filter((l) => !l.closed && offersForRequest(l.id).length === 0);
  if (FOCUS && !FOCUS.closed && offersForRequest(FOCUS.id).length === 0 && !list.some((l) => l.id === FOCUS.id)) {
    list = [FOCUS, ...list];
  }
  document.getElementById('count').textContent = `${list.length} open request${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    results.innerHTML = `<div class="state">No open requests to quote right now. New client requests will appear here, and we'll email you.</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(requestCard).join('')}</div>`;
  wireRequestCards(results);
  if (FOCUS) {
    const card = results.querySelector(`.lead[data-id="${FOCUS.id}"]`);
    if (card) {
      const f = card.querySelector('.offer-form');
      if (f && offersForRequest(FOCUS.id).length === 0) f.hidden = false;
      card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function renderOffers(results, list, kind) {
  document.getElementById('count').textContent =
    `${list.length} ${kind} quote${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    results.innerHTML = `<div class="state">${kind === 'closed' ? 'No closed quotes yet.' : 'You have no active quotes. Price an open request to get started.'}</div>`;
    return;
  }
  results.innerHTML = `<div class="lead-list">${list.map(offerCard).join('')}</div>`;
  if (typeof wireThreadToggles === 'function') wireThreadToggles(results);
  wireBookings(results);
}

function requestCard(l) {
  const when = niceDateTime(l.created_at);
  const mine = offersForRequest(l.id);
  const hasRequote = mine.some((o) => o.status === 'requote');
  const quotedBadge = hasRequote
    ? `<span class="status-badge status-pending">Requote requested</span>`
    : mine.length
    ? `<span class="status-badge status-active">You quoted ${escapeHtml(money(mine[0].price) || '')}</span>`
    : '';
  const priceBtnLabel = hasRequote ? 'Submit updated quote' : mine.length ? 'Add another quote' : 'Give a price';

  // When the client asked about multiple cabin types, let the advisor quote each.
  const cabinTypes = Array.isArray(l.cabin_types) ? l.cabin_types : [];
  const multiCabin = cabinTypes.length >= 2;
  const fareField = multiCabin
    ? `<div class="field"><label>Total fare per cabin type (USD) <span style="color:var(--danger)">*</span></label>
        <div class="cabin-fares">${cabinTypes.map((t) => `
          <div class="cabin-fare"><span class="cabin-fare-type">${escapeHtml(t)}</span><input type="text" inputmode="decimal" data-cabinfare data-cabintype="${escapeHtml(t)}" placeholder="e.g. 5254" /></div>`).join('')}
        </div>
        <div class="hint">Total fare for all guests in each cabin type, including taxes and fees. Fill in the ones you can quote.</div></div>`
    : `<div class="field"><label>Total fare (USD) <span style="color:var(--danger)">*</span></label><input type="text" inputmode="decimal" data-total placeholder="e.g. 5254" /><div class="hint">Total fare for all guests, including taxes and fees.</div></div>`;

  return `<article class="lead" data-id="${escapeHtml(l.id)}">
    <div class="lead-head">
      <div>
        <h3>Cruise Shopper</h3>
        <div class="lead-contact">Request ${escapeHtml(l.ref || '')} &middot; contact shared when they accept your quote</div>
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
      <button type="button" class="btn btn-primary" data-give-price>${priceBtnLabel}</button>
    </div>
    <div class="offer-form" hidden>
      <div class="field"><label>Special offers on this sailing</label><textarea data-specials rows="2" placeholder="Onboard credit, free gratuities, cabin upgrade, kids sail free…"></textarea></div>
      <div class="field"><label>Additional information</label><textarea data-info rows="2" placeholder="What's included, terms, deposit, your direct contact…"></textarea></div>
      ${fareField}
      <div class="breakdown">
        <div class="breakdown-head">Price breakdown <span>optional, powers the client's side-by-side comparison</span></div>
        <div class="price-grid">
          ${multiCabin ? '' : `<div class="field"><label>Base fare (USD)</label><input type="text" inputmode="decimal" data-base placeholder="e.g. 1499" /></div>
          <div class="field"><label>Taxes &amp; fees (USD)</label><input type="text" inputmode="decimal" data-taxes placeholder="e.g. 210" /></div>`}
          <div class="field"><label class="check-inline"><input type="checkbox" data-grats /> Gratuities included</label></div>
          <div class="field"><label>Deposit due (USD)</label><input type="text" inputmode="decimal" data-deposit placeholder="e.g. 500" /></div>
          <div class="field"><label>Final payment date</label><input type="date" data-final /></div>
        </div>
      </div>
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
  const toNum = (v) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };
  const specials = card.querySelector('[data-specials]').value.trim();
  const additional_info = card.querySelector('[data-info]').value.trim();
  const readVal = (sel) => { const el = card.querySelector(sel); return el ? el.value.trim() : ''; };
  const base_fare = readVal('[data-base]');
  const taxes_fees = readVal('[data-taxes]');
  const obc_amount = readVal('[data-obc]');
  const gratuities_included = card.querySelector('[data-grats]').checked;
  const deposit_amount = card.querySelector('[data-deposit]').value.trim();
  const final_payment_date = card.querySelector('[data-final]').value.trim();
  const alertEl = card.querySelector('[data-alert]');

  // Single Total fare, or a fare per requested cabin type.
  const totalEl = card.querySelector('[data-total]');
  const body = { quote_request_id: id, specials, additional_info, base_fare, taxes_fees, obc_amount, gratuities_included, deposit_amount, final_payment_date };
  let localTotal = null;
  let cabinFares = null;
  if (totalEl) {
    const totalNum = toNum(totalEl.value);
    if (totalNum == null || totalNum <= 0) { showAlert(alertEl, 'error', 'Please enter a total fare.'); return; }
    body.total_price = totalEl.value.trim();
    localTotal = totalNum;
  } else {
    cabinFares = [];
    card.querySelectorAll('[data-cabinfare]').forEach((inp) => {
      const fare = toNum(inp.value);
      if (fare != null && fare > 0) cabinFares.push({ type: inp.getAttribute('data-cabintype'), fare });
    });
    if (!cabinFares.length) { showAlert(alertEl, 'error', 'Please enter a fare for at least one cabin type.'); return; }
    body.cabin_fares = cabinFares;
    localTotal = Math.min(...cabinFares.map((c) => c.fare));
  }

  btn.disabled = true; btn.textContent = 'Submitting…';
  const { ok, data } = await api('/api/advisor/offers', { method: 'POST', body });
  if (!ok) {
    showAlert(alertEl, 'error', (data && data.message) || 'Could not submit your quote. Please try again.');
    btn.disabled = false; btn.textContent = 'Submit quote';
    return;
  }
  // Reflect locally so the badge + My Quotes update without a reload.
  const req = REQUESTS.find((r) => r.id === id) || {};
  OFFERS.unshift({
    id: data.id, quote_request_id: id, price: String(localTotal), total_price: localTotal, cabin_fares: cabinFares, specials, additional_info,
    base_fare: toNum(base_fare), taxes_fees: toNum(taxes_fees), obc_amount: toNum(obc_amount),
    gratuities_included: gratuities_included ? 1 : 0,
    deposit_amount: toNum(deposit_amount), final_payment_date: final_payment_date || null,
    status: 'submitted', created_at: data.created_at || Date.now(),
    sailing_name: req.sailing_name, cruise_line: req.cruise_line, ship: req.ship,
    sailing_dates: req.sailing_dates, departure_port: req.departure_port, destination: req.destination,
    client_first: req.first_name, client_last: req.last_name, client_email: req.email,
  });
  toast('Quote submitted.');
  render();
}

function statusBadge(status, price) {
  if (status === 'accepted') return `<span class="status-badge status-active">Accepted</span>`;
  if (status === 'declined') return `<span class="status-badge status-declined">Not selected</span>`;
  if (status === 'requote') return `<span class="status-badge status-pending">Requote requested</span>`;
  return `<span class="status-badge status-pending">${price ? escapeHtml(money(price)) : 'Quoted'}</span>`;
}

function offerCard(o) {
  const revealed = o.client_revealed && (o.client_first || o.client_last || o.client_email);
  const client = [o.client_first, o.client_last].filter(Boolean).join(' ') || 'the client';
  const contactLine = revealed
    ? `For ${escapeHtml(client)}${o.client_email ? ` &middot; <a href="mailto:${escapeHtml(o.client_email)}">${escapeHtml(o.client_email)}</a>` : ''}`
    : `Cruise Shopper &middot; contact shared when they accept`;
  const thread = o.status === 'accepted'
    ? `<div class="thread-bar"><button type="button" class="btn btn-ghost thread-toggle" data-offer="${escapeHtml(o.id)}">Messages${o.unread ? ` <span class="unread-dot">${o.unread}</span>` : ''}</button></div>
       <div class="thread" data-offer="${escapeHtml(o.id)}" hidden><div class="thread-title">Messages with ${escapeHtml(client)}</div></div>`
    : '';
  return `<article class="lead">
    <div class="lead-head">
      <div>
        <h3>${escapeHtml(o.sailing_name || o.ship || 'Cruise')}</h3>
        <div class="lead-contact">${contactLine}</div>
      </div>
      ${statusBadge(o.status, o.price)}
    </div>
    <div class="lead-grid">
      ${o.cruise_line ? row('Cruise line', o.cruise_line) : ''}
      ${o.ship ? row('Ship', o.ship) : ''}
      ${o.sailing_dates ? row('Sailing', o.sailing_dates) : ''}
      ${o.departure_port ? row('Departs', o.departure_port) : ''}
      ${Array.isArray(o.cabin_fares) && o.cabin_fares.length
        ? o.cabin_fares.map((c) => row(`${escapeHtml(c.type)} fare`, money(c.fare))).join('')
        : row('Total fare', money(o.total_price != null ? o.total_price : o.price))}
      ${o.base_fare != null ? row('Base fare', money(o.base_fare)) : ''}
      ${o.taxes_fees != null ? row('Taxes &amp; fees', money(o.taxes_fees)) : ''}
      ${o.obc_amount != null ? row('Onboard credit', money(o.obc_amount)) : ''}
      ${o.gratuities_included != null ? row('Gratuities', o.gratuities_included ? 'Included' : 'Not included') : ''}
      ${o.deposit_amount != null ? row('Deposit due', money(o.deposit_amount)) : ''}
      ${o.final_payment_date ? row('Final payment', fmtDateStr(o.final_payment_date)) : ''}
      ${row('Submitted', niceDateTime(o.created_at))}
      ${o.specials ? row('Specials', o.specials) : ''}
      ${o.additional_info ? row('Additional info', o.additional_info) : ''}
    </div>
    ${o.status === 'accepted' ? bookingBlock(o) : ''}
    ${thread}
  </article>`;
}

function bookingBlock(o) {
  if (o.booking_status === 'booked') {
    const amt = o.booking_amount ? ` &middot; ${escapeHtml(money(o.booking_amount))}` : '';
    const ref = o.booking_ref ? ` &middot; Ref ${escapeHtml(o.booking_ref)}` : '';
    return `<div class="booking-bar" data-id="${escapeHtml(o.id)}"><span class="status-badge status-active">Booked${amt}</span><span class="booking-meta">${ref}</span><button type="button" class="btn btn-ghost btn-sm" data-book-change>Update</button></div>`;
  }
  if (o.booking_status === 'not_booked') {
    return `<div class="booking-bar" data-id="${escapeHtml(o.id)}"><span class="status-badge status-declined">Not booked</span><button type="button" class="btn btn-ghost btn-sm" data-book-change>Change</button></div>`;
  }
  return `<div class="booking-bar" data-id="${escapeHtml(o.id)}">
    <span class="booking-prompt">Did this book?</span>
    <button type="button" class="btn btn-primary btn-sm" data-book="booked">Mark as booked</button>
    <button type="button" class="btn btn-ghost btn-sm" data-book="not_booked">Not booked</button>
    <div class="booking-form hidden" data-book-form>
      <input type="text" data-book-amount placeholder="Total booked (optional)" />
      <input type="text" data-book-ref placeholder="Confirmation # (optional)" />
      <button type="button" class="btn btn-navy btn-sm" data-book-confirm>Confirm booked</button>
    </div>
  </div>`;
}

function wireBookings(scope) {
  scope.querySelectorAll('.booking-bar').forEach((bar) => {
    const id = bar.getAttribute('data-id');
    const save = async (status, amount, ref) => {
      const { ok, data } = await api('/api/advisor/offers/booking', { method: 'POST', body: { offer_id: id, status, amount, ref } });
      if (ok) {
        const o = OFFERS.find((x) => x.id === id);
        if (o) { o.booking_status = status; o.booking_amount = amount || null; o.booking_ref = ref || null; }
        render();
        toast(status === 'booked' ? 'Marked as booked.' : 'Marked as not booked.');
      } else {
        toast((data && data.message) || 'Could not save.');
      }
    };
    const bookBtn = bar.querySelector('[data-book="booked"]');
    const form = bar.querySelector('[data-book-form]');
    if (bookBtn && form) bookBtn.addEventListener('click', () => form.classList.toggle('hidden'));
    const confirm = bar.querySelector('[data-book-confirm]');
    if (confirm) confirm.addEventListener('click', () =>
      save('booked', bar.querySelector('[data-book-amount]').value.trim(), bar.querySelector('[data-book-ref]').value.trim()));
    const notBtn = bar.querySelector('[data-book="not_booked"]');
    if (notBtn) notBtn.addEventListener('click', () => { if (window.confirm('Mark this as not booked?')) save('not_booked'); });
    const change = bar.querySelector('[data-book-change]');
    if (change) change.addEventListener('click', () => {
      const o = OFFERS.find((x) => x.id === id);
      if (o) { o.booking_status = null; render(); }
    });
  });
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

// Format an ISO date string (YYYY-MM-DD) without timezone drift.
function fmtDateStr(s) {
  if (!s) return '';
  const d = new Date(String(s) + 'T00:00:00');
  if (isNaN(d)) return escapeHtml(String(s));
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
