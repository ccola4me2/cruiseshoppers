// Quote request page: a native form with the selected cruise shown and
// pre-filled. On submit it saves to our backend (advisor dashboard + admin
// email) and the Worker pushes the contact into GHL (Cruise of Interest filled).

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

// A single readable line describing the chosen cruise (no em dashes).
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
  const who = escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.email);
  const cruise = cruiseSummary(sailing);

  embed.innerHTML = `
    <form class="quote-form" id="quoteForm" novalidate>
      <p class="quote-hi">Requesting a personalized quote as <strong>${who}</strong>${user.email ? ` (${escapeHtml(user.email)})` : ''}.</p>

      <div class="field">
        <label for="cruise">Cruise of interest</label>
        <textarea id="cruise" rows="2" readonly>${escapeHtml(cruise)}</textarea>
        <div class="hint">This is the sailing you selected. It will be sent with your request.</div>
      </div>

      <div class="row-2">
        <div class="field"><label for="cabins">Number of cabins <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input type="text" id="cabins" inputmode="numeric" placeholder="e.g. 1" /></div>
        <div class="field"><label for="guests">Number of guests <span style="font-weight:400;color:var(--muted)">(optional)</span></label><input type="text" id="guests" inputmode="numeric" placeholder="e.g. 2" /></div>
      </div>

      <div class="field">
        <label for="notes">Additional information <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <textarea id="notes" rows="4" placeholder="Traveler ages, cabin type, loyalty numbers, military/first-responder, budget, flexibility, questions…"></textarea>
      </div>

      <div class="alert hidden" id="alert"></div>
      <button type="submit" class="btn btn-primary btn-lg btn-block" id="submitBtn">Send my quote request</button>
      <p class="no-price" style="margin-top:12px;">No pricing is shown online. A cruise specialist will follow up with personalized quotes.</p>
    </form>`;

  const alertEl = document.getElementById('alert');
  document.getElementById('quoteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideAlert(alertEl);
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';

    const { ok, data } = await api('/api/quotes', {
      method: 'POST',
      body: {
        sailing: { ...sailing, sailing_dates: datesText(sailing) },
        cabins: document.getElementById('cabins').value,
        guests: document.getElementById('guests').value,
        notes: document.getElementById('notes').value,
      },
    });

    if (ok) {
      embed.innerHTML = `
        <div class="quote-done">
          <div class="quote-check">✓</div>
          <h2>Request sent!</h2>
          <p>Thanks, ${escapeHtml(user.first_name || 'traveler')}. Your request for
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
