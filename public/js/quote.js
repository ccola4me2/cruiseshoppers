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

      <div class="field">
        <label for="cabins">Number of cabins ${req}</label>
        <select id="cabins" required>
          <option value="">Select…</option>
          <option>1</option><option>2</option><option>3</option><option>4</option><option>5</option><option>6</option>
        </select>
      </div>
      <div id="cabinBlocks"></div>

      <div class="field">
        <label>Cabin type(s) <span style="font-weight:400;color:var(--muted)">(select all you'd like quoted)</span></label>
        <div class="check-grid">
          <label class="check"><input type="checkbox" id="c_inside" /> <span>Inside</span></label>
          <label class="check"><input type="checkbox" id="c_outside" /> <span>Outside / Ocean View</span></label>
          <label class="check"><input type="checkbox" id="c_balcony" /> <span>Balcony</span></label>
          <label class="check"><input type="checkbox" id="c_suite" /> <span>Suite</span></label>
        </div>
      </div>

      <div class="field"><label for="loyalty">Loyalty number(s) ${opt}</label><input type="text" id="loyalty" placeholder="Cruise line loyalty / past-guest number" /></div>

      <div class="field">
        <label>Check if applicable ${opt}</label>
        <div class="check-grid">
          <label class="check"><input type="checkbox" id="d_senior" /> <span>55+</span></label>
          <label class="check"><input type="checkbox" id="d_military" /> <span>Military</span></label>
          <label class="check"><input type="checkbox" id="d_law" /> <span>Law Enforcement</span></label>
          <label class="check"><input type="checkbox" id="d_fire" /> <span>Fire / EMT</span></label>
          <label class="check"><input type="checkbox" id="d_teacher" /> <span>Teacher</span></label>
          <label class="check"><input type="checkbox" id="d_gov" /> <span>Government employee</span></label>
        </div>
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

  // Build per-cabin "guests + ages" inputs when the cabin count changes.
  const cabinsSel = document.getElementById('cabins');
  const cabinBlocks = document.getElementById('cabinBlocks');
  cabinsSel.addEventListener('change', () => {
    const n = parseInt(cabinsSel.value, 10) || 0;
    let html = '';
    for (let i = 1; i <= n; i++) {
      const mark = i === 1 ? ` ${req}` : ` ${opt}`;
      html += `<div class="cabin-block"><div class="cabin-block-title">Cabin ${i}</div>
        <div class="row-2">
          <div class="field"><label>Guests in cabin ${i}${mark}</label><input type="text" inputmode="numeric" data-cg="${i}" placeholder="e.g. 2" /></div>
          <div class="field"><label>Ages in cabin ${i}${mark}</label><input type="text" data-ca="${i}" placeholder="e.g. 42, 40" /></div>
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
      ['phone', 'your phone number'],
      ['state', 'your state'],
      ['cabins', 'the number of cabins'],
    ];
    for (const [id, label] of required) {
      if (!val(id)) {
        showAlert(alertEl, 'error', `Please enter ${label}.`);
        document.getElementById(id).focus();
        return;
      }
    }

    // Per-cabin guests + ages (cabin 1 required).
    const cabinCount = parseInt(val('cabins'), 10) || 0;
    const cabinLines = [];
    for (let i = 1; i <= cabinCount; i++) {
      const gEl = document.querySelector(`[data-cg="${i}"]`);
      const aEl = document.querySelector(`[data-ca="${i}"]`);
      const g = gEl ? gEl.value.trim() : '';
      const a = aEl ? aEl.value.trim() : '';
      if (i === 1 && (!g || !a)) {
        showAlert(alertEl, 'error', 'Please enter the number of guests and their ages for cabin 1.');
        return;
      }
      if (g || a) cabinLines.push(`Cabin ${i}: ${[g ? `${g} guests` : '', a ? `ages ${a}` : ''].filter(Boolean).join(', ')}`);
    }

    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    // Compose the extra answers into one readable note for the advisor.
    const discounts = [];
    if (document.getElementById('d_senior').checked) discounts.push('55+');
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
