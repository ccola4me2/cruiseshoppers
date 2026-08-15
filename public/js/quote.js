// Quote request page: shows the selected sailing and embeds the GHL
// (LeadConnector) "Request" form, pre-filled with the client's details and the
// cruise they chose (custom field key: contact.cruise_of_interest).

const GHL_FORM_ID = 'TS38U9Knz8aGxWE5JDUA';
const GHL_FORM_BASE = `https://api.leadconnectorhq.com/widget/form/${GHL_FORM_ID}`;
const GHL_EMBED_SCRIPT = 'https://link.msgsndr.com/js/form_embed.js';

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

// A single readable line describing the chosen cruise, for the GHL
// "cruise of interest" field. No em dashes (pipes/commas only).
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

  const summary = cruiseSummary(sailing);
  const p = new URLSearchParams();
  if (user.first_name) p.set('first_name', user.first_name);
  if (user.last_name) p.set('last_name', user.last_name);
  if (user.email) p.set('email', user.email);
  if (user.phone) p.set('phone', user.phone);
  if (summary) {
    // Set both key forms so prefill works regardless of how GHL expects it.
    p.set('cruise_of_interest', summary);
    p.set('contact.cruise_of_interest', summary);
  }

  const iframe = document.createElement('iframe');
  iframe.src = `${GHL_FORM_BASE}?${p.toString()}`;
  iframe.id = `inline-${GHL_FORM_ID}`;
  iframe.title = 'Request';
  iframe.setAttribute('data-layout', "{'id':'INLINE'}");
  iframe.setAttribute('data-form-id', GHL_FORM_ID);
  iframe.setAttribute('data-form-name', 'Request');
  iframe.style.cssText = 'width:100%;border:none;border-radius:11px;min-height:720px;background:transparent;';

  embed.innerHTML = '';
  embed.appendChild(iframe);

  // Load LeadConnector's embed script once (handles auto-resize).
  if (!document.getElementById('ghl-embed-script')) {
    const sc = document.createElement('script');
    sc.id = 'ghl-embed-script';
    sc.src = GHL_EMBED_SCRIPT;
    document.body.appendChild(sc);
  }
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
