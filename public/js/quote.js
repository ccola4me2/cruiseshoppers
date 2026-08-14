// Quote request page: shows the selected sailing and submits a request that
// is saved for travel advisors to see (and worked as a lead).

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

function renderForm(sailing, user) {
  const embed = document.getElementById('embed');
  embed.innerHTML = `
    <div class="quote-form">
      <p class="quote-hi">You're requesting a personalized quote as <strong>${escapeHtml([user.first_name, user.last_name].filter(Boolean).join(' ') || user.email)}</strong>.</p>
      <div class="field">
        <label for="notes">Anything to add? <span style="font-weight:400;color:var(--muted)">(optional)</span></label>
        <textarea id="notes" rows="4" placeholder="Travel dates flexibility, number of guests, cabin preferences, budget range, questions…"></textarea>
      </div>
      <div class="alert hidden" id="alert"></div>
      <button type="button" class="btn btn-primary btn-lg" id="submitBtn">Send my quote request</button>
      <p class="no-price" style="margin-top:12px;">No pricing is shown online. A travel advisor will follow up with personalized quotes.</p>
    </div>`;

  const alertEl = document.getElementById('alert');
  document.getElementById('submitBtn').addEventListener('click', async () => {
    const btn = document.getElementById('submitBtn');
    btn.disabled = true; btn.textContent = 'Sending…';
    const { ok, data } = await api('/api/quotes', {
      method: 'POST',
      body: { sailing: { ...sailing, sailing_dates: datesText(sailing) }, notes: document.getElementById('notes').value },
    });
    if (ok) {
      embed.innerHTML = `
        <div class="quote-done">
          <div class="quote-check">✓</div>
          <h2>Request sent!</h2>
          <p>Thanks, ${escapeHtml(user.first_name || 'traveler')}. Your request for
          <strong>${escapeHtml(sailing.name || sailing.ship || 'this sailing')}</strong> has been sent to our
          travel advisors. They'll reach out with personalized quotes soon.</p>
          <a href="/app" class="btn btn-primary btn-lg">Browse more sailings</a>
        </div>`;
    } else {
      showAlert(alertEl, 'error', data.message || 'Something went wrong sending your request. Please try again.');
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
