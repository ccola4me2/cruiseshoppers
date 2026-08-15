// Client quote request: a native form modeled on the "Request" form, with the
// selected cruise shown pre-filled. Submits to our backend so it appears in the
// advisor portal + /admin and emails the operators.

async function init() {
  renderAccountNav(document.getElementById('accountNav'));

  const sailing = readSailing();
  if (!sailing) { window.location.href = '/app'; return; }
  renderSummary(sailing);

  const user = await getMe();
  if (!user) { window.location.href = '/login?next=/app'; return; }

  renderForm(sailing, user);
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
  const ph = escapeHtml(user.phone || '');
  const cruise = cruiseSummary(sailing);
  const opt = `<span style="font-weight:400;color:var(--muted)">(optional)</span>`;
  const req = `<span style="color:var(--danger)">*</span>`;

  embed.innerHTML = `
    <form class="quote-form" id="quoteForm" novalidate>
      <p class="quote-intro">Please complete this quote request. A cruise specialist will respond with a personalized quote. No pricing is shown online, and there's no obligation.</p>

      <div class="row-2">
        <div class="field"><label for="first_name">First name ${req}</label><input type="text" id="first_name" value="${fn}" autocomplete="given-name" required /></div>
        <div class="field"><label for="last_name">Last name ${req}</label><input type="text" id="last_name" value="${ln}" autocomplete="family-name" required /></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="email">Email ${req}</label><input type="email" id="email" value="${em}" autocomplete="email" readonly required /></div>
        <div class="field"><label for="phone">Phone ${req}</label><input type="tel" id="phone" value="${ph}" autocomplete="tel" required /></div>
      </div>
      <div class="row-2">
        <div class="field"><label for="city">City ${opt}</label><input type="text" id="city" autocomplete="address-level2" /></div>
        <div class="field"><label for="state">State ${req}</label><input type="text" id="state" autocomplete="address-level1" required /></div>
      </div>

      <div class="field">
        <label for="cruise">Cruise of interest</label>
        <textarea id="cruise" rows="2" readonly>${escapeHtml(cruise)}</textarea>
        <div class="hint">This is the sailing you selected. It will be sent with your request.</div>
      </div>

      <div class="row-2">
        <div class="field"><label for="cabins">Number of cabins ${req}</label><input type="text" id="cabins" inputmode="numeric" placeholder="e.g. 1" required /></div>
        <div class="field"><label for="guests">Number of guests ${req}</label><input type="text" id="guests" inputmode="numeric" placeholder="e.g. 2" required /></div>
      </div>
      <div class="field">
        <label for="cabinDetails">If multiple cabins, tell us cabin type and ages per cabin ${opt}</label>
        <textarea id="cabinDetails" rows="2" placeholder="e.g. 1 balcony (ages 42, 40), 1 interior (ages 12, 9)"></textarea>
      </div>

      <h3 class="form-section">Traveler ages</h3>
      <div class="row-4">
        <div class="field"><label for="t1">Traveler 1 ${req}</label><input type="text" id="t1" inputmode="numeric" placeholder="Age" required /></div>
        <div class="field"><label for="t2">Traveler 2 ${opt}</label><input type="text" id="t2" inputmode="numeric" placeholder="Age" /></div>
        <div class="field"><label for="t3">Traveler 3</label><input type="text" id="t3" inputmode="numeric" placeholder="Age" /></div>
        <div class="field"><label for="t4">Traveler 4</label><input type="text" id="t4" inputmode="numeric" placeholder="Age" /></div>
      </div>
      <p class="hint">If more than 4 people are traveling, please add their ages under Additional information.</p>

      <div class="field"><label for="loyalty">Loyalty number(s) ${opt}</label><input type="text" id="loyalty" placeholder="Cruise line loyalty / past-guest number" /></div>

      <div class="field">
        <label>Check if applicable ${opt}</label>
        <label class="check"><input type="checkbox" id="d_military" /> <span>Military</span></label>
        <label class="check"><input type="checkbox" id="d_law" /> <span>Law Enforcement</span></label>
        <label class="check"><input type="checkbox" id="d_fire" /> <span>Fire / EMT</span></label>
      </div>

      <div class="field">
        <label for="notes">Additional information ${opt}</label>
        <textarea id="notes" rows="4" placeholder="Budget, flexibility, cabin preferences, special occasions, questions…"></textarea>
      </div>

      <div class="alert hidden" id="alert"></div>
      <button type="submit" class="btn btn-primary btn-lg btn-block" id="submitBtn">Send my quote request</button>
      <p class="no-price" style="margin-top:12px;">A cruise specialist will follow up with personalized quotes.</p>
    </form>`;

  const alertEl = document.getElementById('alert');
  const val = (id) => (document.getElementById(id).value || '').trim();

  document.getElementById('quoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertEl);
    const required = [
      ['first_name', 'your first name'],
      ['last_name', 'your last name'],
      ['email', 'your email'],
      ['phone', 'your phone number'],
      ['state', 'your state'],
      ['cabins', 'the number of cabins'],
      ['guests', 'the number of guests'],
      ['t1', "traveler 1's age"],
    ];
    for (const [id, label] of required) {
      if (!val(id)) {
        showAlert(alertEl, 'error', `Please enter ${label}.`);
        document.getElementById(id).focus();
        return;
      }
    }
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    // Compose the extra answers into one readable note for the advisor.
    const discounts = [];
    if (document.getElementById('d_military').checked) discounts.push('Military');
    if (document.getElementById('d_law').checked) discounts.push('Law Enforcement');
    if (document.getElementById('d_fire').checked) discounts.push('Fire/EMT');
    const ages = [val('t1'), val('t2'), val('t3'), val('t4')].filter(Boolean);
    const lines = [];
    const loc = [val('city'), val('state')].filter(Boolean).join(', ');
    if (loc) lines.push(`Location: ${loc}`);
    if (val('guests')) lines.push(`Guests: ${val('guests')}`);
    if (val('cabins')) lines.push(`Cabins: ${val('cabins')}`);
    if (val('cabinDetails')) lines.push(`Cabin details: ${val('cabinDetails')}`);
    if (ages.length) lines.push(`Traveler ages: ${ages.join(', ')}`);
    if (val('loyalty')) lines.push(`Loyalty #: ${val('loyalty')}`);
    if (discounts.length) lines.push(`Discounts: ${discounts.join(', ')}`);
    if (val('notes')) lines.push(`Notes: ${val('notes')}`);

    const { ok, data } = await api('/api/quotes', {
      method: 'POST',
      body: {
        sailing: { ...sailing, sailing_dates: datesText(sailing) },
        first_name: val('first_name'),
        last_name: val('last_name'),
        phone: val('phone'),
        notes: lines.join('\n'),
      },
    });

    if (ok) {
      embed.innerHTML = `
        <div class="quote-done">
          <div class="quote-check">✓</div>
          <h2>Request sent!</h2>
          <p>Thanks, ${escapeHtml(val('first_name') || 'traveler')}. Your request for
          <strong>${escapeHtml(sailing.name || sailing.ship || 'this sailing')}</strong> is in.
          A cruise specialist will reach out with personalized quotes soon.</p>
          <a href="/app" class="btn btn-primary btn-lg">Browse more sailings</a>
        </div>`;
    } else {
      showAlert(alertEl, 'error', (data && data.message) || 'Something went wrong sending your request. Please try again.');
      btn.disabled = false; btn.textContent = 'Send my quote request';
    }
  });
}

function datesText(s) {
  if (!s.depart_date) return s.nights ? `${s.nights} nights` : '';
  const parts = [s.depart_date];
  if (s.return_date) parts.push(`to ${s.return_date}`);
  if (s.nights) parts.push(`(${s.nights} nights)`);
  return parts.join(' ');
}

function renderSummary(s) {
  document.getElementById('sumShip').textContent = [s.line, s.ship].filter(Boolean).join(' · ');
  const rows = [
    ['Sailing', s.name || s.destination || '-'],
    ['Dates', datesText(s) || '-'],
    ['Departs', s.departure_port || '-'],
    ['Destination', s.destination || '-'],
  ];
  document.getElementById('sumMeta').innerHTML = rows
    .map(([k, v]) => `<div class="meta-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`)
    .join('');
}

init();
