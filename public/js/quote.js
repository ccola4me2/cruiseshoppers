// Client quote request: a native form modeled on the "Request" form, with the
// selected cruise shown pre-filled. Submits to our backend so it appears in the
// advisor portal + /admin and emails the operators.

// Manual mode: the client is requesting a cruise we don't have listed, so the
// cruise details are entered by hand (opened via /quote?manual=1).
let MANUAL = false;

async function init() {
  renderAccountNav(document.getElementById('accountNav'));

  MANUAL = new URLSearchParams(location.search).get('manual') === '1';
  const sailing = readSailing();
  if (!sailing && !MANUAL) { window.location.href = '/app'; return; }

  const user = await getMe();
  if (!user) {
    const next = MANUAL ? '/quote?manual=1' : '/quote';
    window.location.href = `/login?next=${encodeURIComponent(next)}`;
    return;
  }

  renderSummary(sailing || {});
  renderForm(sailing || {}, user);
}

// First-touch lead attribution captured in the browser (see the inline UTM
// script injected on every page). Returned as an object to send with the quote.
function readAttribution() {
  try {
    const raw = localStorage.getItem('cs_attr');
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch (_) { return null; }
}

function readSailing() {
  try {
    const raw = sessionStorage.getItem('cs_quote_sailing');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function cruiseSummary(s) {
  const parts = [];
  if (s.line) parts.push(s.line);
  if (s.ship) parts.push(s.ship);
  if (s.name && s.name !== s.ship) parts.push(s.name);
  const dates = datesText(s);
  if (dates) parts.push(dates);
  if (s.departure_port) parts.push(`Departs ${s.departure_port}`);
  if (s.destination && s.destination !== s.name) parts.push(s.destination);
  return parts.join(' | ');
}

function renderForm(sailing, user) {
  const embed = document.getElementById('embed');
  const fn = escapeHtml(user.first_name || '');
  const ln = escapeHtml(user.last_name || '');
  const em = escapeHtml(user.email || '');
  const cruise = cruiseSummary(sailing);
  const opt = `<span style="font-weight:400;color:var(--muted)">(optional)</span>`;
  const req = `<span style="color:var(--danger)">*</span>`;

  // Prefill from a picked line/ship when the client came from a search that had
  // no live departures for that ship (they still enter the date + details).
  const pv = (k) => escapeHtml(sailing && sailing[k] != null ? sailing[k] : '');
  const mItin = pv('name') || pv('destination') || pv('itinerary');
  const mDates = pv('sailing_dates') || pv('depart_date');
  const n = MANUAL ? 1 : 0; // section-number offset when the cruise section is shown
  const topBlock = MANUAL
    ? `<section class="qsection">
        <div class="qsection-head"><span class="qsection-num">1</span><h3>Your cruise</h3></div>
        <p class="lbl-note" style="display:block;margin:-6px 0 12px;">Tell us the cruise you're looking for and we'll shop the best quotes. Fill in as much as you know.</p>
        <div class="row-2">
          <div class="field"><label for="m_line">Cruise line ${req}</label><input type="text" id="m_line" value="${pv('line')}" placeholder="e.g. Royal Caribbean" /></div>
          <div class="field"><label for="m_ship">Ship ${opt}</label><input type="text" id="m_ship" value="${pv('ship')}" placeholder="e.g. Symphony of the Seas" /></div>
        </div>
        <div class="field"><label for="m_itin">Itinerary / destination ${opt}</label><input type="text" id="m_itin" value="${mItin}" placeholder="e.g. 7-Night Southern Caribbean" /></div>
        <div class="row-2">
          <div class="field"><label for="m_port">Departure port ${opt}</label><input type="text" id="m_port" value="${pv('departure_port')}" placeholder="e.g. Miami, FL" /></div>
          <div class="field"><label for="m_dates">Sailing date(s) ${req}</label><input type="text" id="m_dates" value="${mDates}" placeholder="e.g. Jan 12, 2027 or Spring 2027" /></div>
        </div>
      </section>`
    : `<div class="quote-banner">
        <span class="quote-banner-eyebrow">You're requesting a quote for</span>
        <span class="quote-banner-cruise">${escapeHtml(cruise)}</span>
      </div>`;

  embed.innerHTML = `
    <form class="quote-form" id="quoteForm" novalidate>
      ${topBlock}

      <section class="qsection">
        <div class="qsection-head"><span class="qsection-num">${1 + n}</span><h3>Your details</h3></div>
        <div class="row-2">
          <div class="field"><label for="first_name">First name ${req}</label><input type="text" id="first_name" value="${fn}" autocomplete="given-name" required /></div>
          <div class="field"><label for="last_name">Last name ${req}</label><input type="text" id="last_name" value="${ln}" autocomplete="family-name" required /></div>
        </div>
        <div class="row-2">
          <div class="field"><label for="email">Email ${req}</label><input type="email" id="email" value="${em}" autocomplete="email" readonly required /></div>
          <div class="field"><label for="state">State ${req}</label><select id="state" autocomplete="address-level1" required><option value="">Select…</option>${stateOptions(user.location || '')}</select></div>
        </div>
        <div class="field"><label for="city">City ${opt}</label><input type="text" id="city" autocomplete="address-level2" /></div>
      </section>

      <section class="qsection">
        <div class="qsection-head"><span class="qsection-num">${2 + n}</span><h3>Cabins &amp; guests</h3></div>
        <div class="field">
          <label for="cabins">How many cabins? ${req}</label>
          <select id="cabins" required>
            <option value="">Select…</option>
            <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option>
          </select>
        </div>
        <div id="cabinBlocks"></div>

        <div class="field">
          <label>Cabin type(s) <span class="lbl-note">select all you'd like quoted</span></label>
          <div class="chips">
            <label class="chip"><input type="checkbox" id="c_inside" /><span>Inside</span></label>
            <label class="chip"><input type="checkbox" id="c_outside" /><span>Outside / Ocean View</span></label>
            <label class="chip"><input type="checkbox" id="c_balcony" /><span>Balcony</span></label>
            <label class="chip"><input type="checkbox" id="c_suite" /><span>Suite</span></label>
          </div>
          <div class="field" style="margin:12px 0 0;"><label for="cabin_specific">Specific cabin request ${opt}</label><input type="text" id="cabin_specific" placeholder='e.g. "9A" or "rear balcony"' /></div>
        </div>
      </section>

      <section class="qsection">
        <div class="qsection-head"><span class="qsection-num">${3 + n}</span><h3>Preferences &amp; savings</h3></div>
        <div class="row-2">
          <div class="field">
            <label for="sailed_before">Sailed this cruise line before? ${opt}</label>
            <select id="sailed_before"><option value="">Select…</option><option>Yes</option><option>No</option></select>
          </div>
          <div class="field">
            <label for="insurance">Interested in cruise insurance? ${opt}</label>
            <select id="insurance"><option value="">Select…</option><option>Yes</option><option>No</option><option>Not sure</option></select>
          </div>
        </div>
        <div class="field"><label for="loyalty">Loyalty / past-guest number ${opt}</label><input type="text" id="loyalty" placeholder="Cruise line loyalty number (can mean big savings)" /></div>
        <div class="field">
          <label>Do any of these apply? ${opt}</label>
          <div class="chips">
            <label class="chip"><input type="checkbox" id="d_senior" /><span>Senior 55+</span></label>
            <label class="chip"><input type="checkbox" id="d_military" /><span>Military</span></label>
            <label class="chip"><input type="checkbox" id="d_law" /><span>Law Enforcement</span></label>
            <label class="chip"><input type="checkbox" id="d_fire" /><span>Fire / EMT</span></label>
            <label class="chip"><input type="checkbox" id="d_teacher" /><span>Teacher</span></label>
            <label class="chip"><input type="checkbox" id="d_gov" /><span>Government employee</span></label>
          </div>
        </div>
      </section>

      <section class="qsection">
        <div class="qsection-head"><span class="qsection-num">${4 + n}</span><h3>Anything else?</h3></div>
        <div class="field">
          <label for="beat">Price to beat / booking to transfer ${opt}</label>
          <textarea id="beat" rows="2" placeholder="Have a competing quote or an onboard booking to transfer? Note the price, cabin #/category, and extras to get the best offers."></textarea>
        </div>
        <div class="field">
          <label for="notes">Additional information ${opt}</label>
          <textarea id="notes" rows="4" placeholder="Budget, flexibility, cabin preferences, special occasions, questions…"></textarea>
        </div>
      </section>

      <div class="alert hidden" id="alert"></div>
      <div class="quote-submit">
        <button type="submit" class="btn btn-primary btn-lg btn-block" id="submitBtn">Send my quote request</button>
        <p class="no-price">No pricing is shown online. Advisors send personalized quotes to your account to compare. Your name and contact stay private until you accept a quote. No obligation.</p>
      </div>
    </form>`;

  const alertEl = document.getElementById('alert');
  const val = (id) => (document.getElementById(id).value || '').trim();

  // Build per-cabin "guests + ages" inputs when the cabin count changes.
  const cabinsSel = document.getElementById('cabins');
  const cabinBlocks = document.getElementById('cabinBlocks');
  cabinsSel.addEventListener('change', () => {
    const n = parseInt(cabinsSel.value, 10) || 0;
    let html = '';
    for (let i = 1; i <= n; i++) {
      const mark = ` ${req}`;
      const guestOpts = ['<option value="">#</option>']
        .concat([1, 2, 3, 4, 5, 6].map((g) => `<option>${g}</option>`)).join('');
      html += `<div class="cabin-block"><div class="cabin-block-title">Cabin ${i}</div>
        <div class="row-2">
          <div class="field"><label>Guests${mark}</label><select data-cg="${i}">${guestOpts}</select></div>
          <div class="field"><label>Ages${mark}</label><input type="text" data-ca="${i}" placeholder="e.g. 42, 40, 8" /></div>
        </div></div>`;
    }
    cabinBlocks.innerHTML = html;
  });

  document.getElementById('quoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertEl);
    const required = [
      ['first_name', 'your first name'],
      ['last_name', 'your last name'],
      ['email', 'your email'],
      ['state', 'your state'],
      ['cabins', 'the number of cabins'],
    ];
    if (MANUAL) {
      required.unshift(['m_line', 'the cruise line'], ['m_dates', 'the sailing date(s)']);
    }
    for (const [id, label] of required) {
      if (!val(id)) {
        showAlert(alertEl, 'error', `Please enter ${label}.`);
        document.getElementById(id).focus();
        return;
      }
    }

    // Per-cabin guests + ages, required for every cabin so advisors can price correctly.
    const cabinCount = parseInt(val('cabins'), 10) || 0;
    const cabinLines = [];
    for (let i = 1; i <= cabinCount; i++) {
      const gEl = document.querySelector(`[data-cg="${i}"]`);
      const aEl = document.querySelector(`[data-ca="${i}"]`);
      const g = gEl ? gEl.value.trim() : '';
      const a = aEl ? aEl.value.trim() : '';
      if (!g || !a) {
        showAlert(alertEl, 'error', `Please enter the number of guests and their ages for cabin ${i}.`);
        if (!g && gEl) gEl.focus(); else if (aEl) aEl.focus();
        return;
      }
      cabinLines.push(`Cabin ${i}: ${g} guests, ages ${a}`);
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    // Compose the extra answers into one readable note for the advisor.
    const discounts = [];
    if (document.getElementById('d_senior').checked) discounts.push('Senior 55+');
    if (document.getElementById('d_military').checked) discounts.push('Military');
    if (document.getElementById('d_law').checked) discounts.push('Law Enforcement');
    if (document.getElementById('d_fire').checked) discounts.push('Fire/EMT');
    if (document.getElementById('d_teacher').checked) discounts.push('Teacher');
    if (document.getElementById('d_gov').checked) discounts.push('Government employee');
    const cabinTypes = [];
    if (document.getElementById('c_inside').checked) cabinTypes.push('Inside');
    if (document.getElementById('c_outside').checked) cabinTypes.push('Outside/Ocean View');
    if (document.getElementById('c_balcony').checked) cabinTypes.push('Balcony');
    if (document.getElementById('c_suite').checked) cabinTypes.push('Suite');
    const lines = [];
    const loc = [val('city'), val('state')].filter(Boolean).join(', ');
    if (loc) lines.push(`Location: ${loc}`);
    if (val('cabins')) lines.push(`Cabins: ${val('cabins')}`);
    cabinLines.forEach((c) => lines.push(c));
    if (cabinTypes.length) lines.push(`Cabin type(s): ${cabinTypes.join(', ')}`);
    if (val('cabin_specific')) lines.push(`Specific cabin: ${val('cabin_specific')}`);
    if (val('sailed_before')) lines.push(`Sailed this line before: ${val('sailed_before')}`);
    if (val('insurance')) lines.push(`Cruise insurance: ${val('insurance')}`);
    if (val('loyalty')) lines.push(`Loyalty #: ${val('loyalty')}`);
    if (discounts.length) lines.push(`Discounts: ${discounts.join(', ')}`);
    if (val('beat')) lines.push(`Price to beat / transfer: ${val('beat')}`);
    if (val('notes')) lines.push(`Notes: ${val('notes')}`);

    const finalSailing = MANUAL
      ? {
          line: val('m_line'),
          ship: val('m_ship'),
          name: val('m_itin'),
          departure_port: val('m_port'),
          sailing_dates: val('m_dates'),
        }
      : { ...sailing, sailing_dates: datesText(sailing) };

    const { ok, data } = await api('/api/quotes', {
      method: 'POST',
      body: {
        sailing: finalSailing,
        first_name: val('first_name'),
        last_name: val('last_name'),
        notes: lines.join('\n'),
        cabin_types: cabinTypes,
        attribution: readAttribution(),
      },
    });

    if (ok) {
      // Attribution has been recorded on this lead, clear it so a later,
      // separate request from this browser attributes to its own journey.
      try { localStorage.removeItem('cs_attr'); } catch (_) {}
      const what = finalSailing.name || finalSailing.ship || finalSailing.line || 'this cruise';
      embed.innerHTML = `
        <div class="quote-done">
          <div class="quote-check">✓</div>
          <h2>Request sent!</h2>
          <p>Thanks, ${escapeHtml(val('first_name') || 'traveler')}. Your request for
          <strong>${escapeHtml(what)}</strong> is in.
          Advisors will send personalized quotes to your account to compare. You stay anonymous until you accept one.</p>
          <a href="/app" class="btn btn-primary btn-lg">Browse more sailings</a>
        </div>`;
    } else {
      showAlert(alertEl, 'error', (data && data.message) || 'Something went wrong sending your request. Please try again.');
      btn.disabled = false; btn.textContent = 'Send my quote request';
    }
  });
}

function datesText(s) {
  if (!s.depart_date) return s.sailing_dates || (s.nights ? `${s.nights} nights` : '');
  const parts = [s.depart_date];
  if (s.return_date) parts.push(`to ${s.return_date}`);
  if (s.nights) parts.push(`(${s.nights} nights)`);
  return parts.join(' ');
}

function renderSummary(s) {
  if (MANUAL) {
    const h2 = document.querySelector('.summary-card h2');
    if (h2) h2.textContent = 'Your cruise request';
    document.getElementById('sumShip').textContent = "We're growing our catalog";
    document.getElementById('sumMeta').innerHTML =
      `<p style="color:var(--ink-soft);font-size:0.92rem;line-height:1.6;margin:0;">Tell us the cruise you're looking for and our advisors will shop the best quotes for you. There's no obligation and no pricing is shown online.</p>`;
    return;
  }
  document.getElementById('sumShip').textContent = [s.line, s.ship].filter(Boolean).join(' · ');
  // Show the itinerary too, and drop any rows we don't have data for so the card
  // never shows a lonely "-" (a special may carry an itinerary but no separate
  // departure port / destination region).
  const itin = s.itinerary && s.itinerary !== s.destination ? s.itinerary : '';
  const rows = [
    ['Sailing', s.name || ''],
    ['Dates', datesText(s)],
    ['Departs', s.departure_port || ''],
    ['Itinerary', itin],
    ['Destination', s.destination || ''],
  ].filter(([, v]) => v && String(v).trim());
  if (!rows.length) rows.push(['Sailing', s.name || s.ship || 'Selected cruise']);
  document.getElementById('sumMeta').innerHTML = rows
    .map(([k, v]) => `<div class="meta-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`)
    .join('');
}

init();
