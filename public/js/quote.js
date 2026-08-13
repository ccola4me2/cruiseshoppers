// Quote page: builds a GHL form embed pre-filled with the visitor's contact
// info (from their account) plus the selected sailing + itinerary from Widgety.
//
// ==========================================================================
// GHL CONFIGURATION: replace these placeholders with your real values.
// --------------------------------------------------------------------------
// 1) GHL_FORM_URL: the embed URL of your GoHighLevel form. In GHL open the
//    form builder → Integrate → copy the iframe "src" URL. It looks like:
//    https://api.leadconnectorhq.com/widget/form/XXXXXXXXXXXXXXXX
//
// 2) FIELD_KEYS: the query key of each GHL field you want pre-filled. Standard
//    contact fields use first_name / last_name / email / phone. For the cruise
//    details, create custom fields in GHL and set each one's "Query Key" to
//    match the values below (or change these strings to match your keys).
//    GHL pre-fills a field when a URL query param matches its query key.
// ==========================================================================
const GHL_FORM_URL = 'GHL_FORM_EMBED_URL_HERE';

const FIELD_KEYS = {
  first_name: 'first_name',
  last_name: 'last_name',
  email: 'email',
  phone: 'phone',
  cruise_line: 'cruise_line',
  ship_name: 'ship_name',
  sailing_dates: 'sailing_dates',
  departure_port: 'departure_port',
  destination: 'destination',
  itinerary_details: 'itinerary_details',
};
// ==========================================================================

async function init() {
  renderAccountNav(document.getElementById('accountNav'));

  const sailing = readSailing();
  if (!sailing) {
    window.location.href = '/app';
    return;
  }
  renderSummary(sailing);

  const user = await getMe();
  if (!user) { window.location.href = '/login?next=/app'; return; }

  const embed = document.getElementById('embed');

  if (!GHL_FORM_URL || GHL_FORM_URL === 'GHL_FORM_EMBED_URL_HERE') {
    embed.innerHTML = setupNotice();
    return;
  }

  const src = buildPrefillUrl(GHL_FORM_URL, user, sailing);
  const iframe = document.createElement('iframe');
  iframe.src = src;
  iframe.title = 'Request a quote';
  iframe.loading = 'eager';
  embed.innerHTML = '';
  embed.appendChild(iframe);
}

function readSailing() {
  try {
    const raw = sessionStorage.getItem('cs_quote_sailing');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function buildPrefillUrl(baseUrl, user, sailing) {
  const url = new URL(baseUrl);
  const set = (key, value) => {
    if (key && value != null && String(value).length) url.searchParams.set(key, String(value));
  };

  set(FIELD_KEYS.first_name, user.first_name);
  set(FIELD_KEYS.last_name, user.last_name);
  set(FIELD_KEYS.email, user.email);
  set(FIELD_KEYS.phone, user.phone);

  set(FIELD_KEYS.cruise_line, sailing.line);
  set(FIELD_KEYS.ship_name, sailing.ship);
  set(FIELD_KEYS.sailing_dates, datesText(sailing));
  set(FIELD_KEYS.departure_port, sailing.departure_port);
  set(FIELD_KEYS.destination, sailing.destination);
  set(FIELD_KEYS.itinerary_details, itineraryText(sailing));

  return url.toString();
}

function datesText(s) {
  if (!s.depart_date) return s.nights ? `${s.nights} nights` : '';
  const parts = [s.depart_date];
  if (s.return_date) parts.push(`to ${s.return_date}`);
  if (s.nights) parts.push(`(${s.nights} nights)`);
  return parts.join(' ');
}

function itineraryText(s) {
  const header = [
    s.name ? `Sailing: ${s.name}` : '',
    s.line ? `Cruise line: ${s.line}` : '',
    s.ship ? `Ship: ${s.ship}` : '',
    `Dates: ${datesText(s)}`,
    s.departure_port ? `Departs: ${s.departure_port}` : '',
    s.destination ? `Destination: ${s.destination}` : '',
  ].filter(Boolean).join(' | ');

  const days = (s.itinerary || [])
    .map((d) => `Day ${d.day}${d.date ? ` (${d.date})` : ''}: ${d.port || d.note || 'At sea'}`)
    .join('; ');

  return days ? `${header} || Itinerary: ${days}` : header;
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

function setupNotice() {
  return `<div style="padding:26px;">
    <div class="callout">
      <strong>Quote form not connected yet.</strong> Add your GoHighLevel form embed URL in
      <code>public/js/quote.js</code> (replace <code>GHL_FORM_EMBED_URL_HERE</code>). The visitor's
      contact info and the selected sailing/itinerary will pre-fill automatically once it's set.
    </div>
    <p style="color:var(--ink-soft);font-size:.92rem;margin:12px 0 0;">
      Create custom fields in GHL with query keys:
      <code>cruise_line</code>, <code>ship_name</code>, <code>sailing_dates</code>,
      <code>departure_port</code>, <code>destination</code>, <code>itinerary_details</code>.
    </p>
  </div>`;
}

init();
