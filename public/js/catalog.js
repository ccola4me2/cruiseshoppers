// Sailings catalog: loads the auth-gated Widgety proxy, renders cards, filters.

let ALL = [];

async function init() {
  renderAccountNav(document.getElementById('accountNav'));
  await load();
  wireFilters();
}

async function load() {
  const res = await fetch('/api/sailings', { credentials: 'same-origin' });
  const results = document.getElementById('results');

  if (res.status === 401) { window.location.href = '/login?next=/app'; return; }

  let data = {};
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    const msg =
      data.error === 'not_configured'
        ? 'The sailings catalog isn’t connected yet. Add your Widgety credentials to see live sailings.'
        : 'We couldn’t load sailings right now. Please try again shortly.';
    results.innerHTML = `<div class="state">${escapeHtml(msg)}</div>`;
    document.getElementById('count').textContent = '';
    return;
  }

  ALL = data.sailings || [];
  fillFacet('line', data.lines || []);
  fillFacet('destination', data.destinations || []);
  render(ALL);
}

function fillFacet(id, values) {
  const sel = document.getElementById(id);
  const current = sel.value;
  sel.innerHTML = `<option value="">All ${id === 'line' ? 'lines' : 'destinations'}</option>` +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
  sel.value = current;
}

function applyFilters() {
  const q = document.getElementById('q').value.trim().toLowerCase();
  const line = document.getElementById('line').value.toLowerCase();
  const destination = document.getElementById('destination').value.toLowerCase();
  const from = document.getElementById('from').value;
  const to = document.getElementById('to').value;

  const filtered = ALL.filter((s) => {
    if (q) {
      const hay = [s.name, s.line, s.ship, s.departure_port, s.destination].filter(Boolean).join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (line && (s.line || '').toLowerCase() !== line) return false;
    if (destination && (s.destination || '').toLowerCase() !== destination) return false;
    if (from && s.depart_date && s.depart_date < from) return false;
    if (to && s.depart_date && s.depart_date > to) return false;
    return true;
  });
  render(filtered);
}

function render(list) {
  const results = document.getElementById('results');
  document.getElementById('count').textContent =
    `${list.length} sailing${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    results.innerHTML = `<div class="state">No sailings match your filters. Try broadening your search.</div>`;
    return;
  }

  results.innerHTML = `<div class="sailing-grid">${list.map(card).join('')}</div>`;

  results.querySelectorAll('[data-itin]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.closest('.sailing-card').querySelector('.itin');
      const open = panel.classList.toggle('open');
      btn.textContent = open ? 'Hide itinerary' : 'View itinerary';
    });
  });
  results.querySelectorAll('[data-quote]').forEach((btn) => {
    btn.addEventListener('click', () => requestQuote(btn.getAttribute('data-quote')));
  });
}

function card(s) {
  const dates = formatDates(s.depart_date, s.return_date, s.nights);
  const itin = (s.itinerary || []).length
    ? `<ol>${s.itinerary
        .map(
          (d) =>
            `<li><span class="d">Day ${escapeHtml(String(d.day))}${d.port ? ':' : ''}</span> ${escapeHtml(d.port || d.note || 'At sea')}</li>`
        )
        .join('')}</ol>`
    : `<p class="no-price">Detailed itinerary available on request.</p>`;

  return `<article class="sailing-card">
    <div class="head">
      ${s.line ? `<span class="line-badge">${escapeHtml(s.line)}</span>` : ''}
      <h3>${escapeHtml(s.name || s.destination || 'Cruise sailing')}</h3>
      ${s.ship ? `<div class="ship">${escapeHtml(s.ship)}</div>` : ''}
    </div>
    <div class="meta">
      ${dates ? metaRow('Sailing', dates) : ''}
      ${s.departure_port ? metaRow('Departs', s.departure_port) : ''}
      ${s.destination ? metaRow('Destination', s.destination) : ''}
      ${s.arrival_port && s.arrival_port !== s.departure_port ? metaRow('Returns to', s.arrival_port) : ''}
    </div>
    <div class="itin-toggle"><button type="button" data-itin>View itinerary</button></div>
    <div class="itin">${itin}</div>
    <div class="foot">
      <div class="no-price">Pricing available by personalized quote.</div>
      <button type="button" class="btn btn-primary btn-block" data-quote="${escapeHtml(s.id)}">Request a quote</button>
    </div>
  </article>`;
}

function metaRow(k, v) {
  return `<div class="meta-row"><span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(v)}</span></div>`;
}

function formatDates(depart, ret, nights) {
  if (!depart) return nights ? `${nights} nights` : '';
  const d = niceDate(depart);
  const r = ret ? niceDate(ret) : '';
  const n = nights ? ` · ${nights} nights` : '';
  return r ? `${d} → ${r}${n}` : `${d}${n}`;
}

function niceDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return s;
  const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// Stash the selected sailing and go to the quote page.
function requestQuote(id) {
  const sailing = ALL.find((s) => String(s.id) === String(id));
  if (!sailing) return;
  sessionStorage.setItem('cs_quote_sailing', JSON.stringify(sailing));
  window.location.href = `/quote?sailing=${encodeURIComponent(id)}`;
}

function wireFilters() {
  ['q', 'line', 'destination', 'from', 'to'].forEach((id) => {
    const el = document.getElementById(id);
    el.addEventListener(id === 'q' ? 'input' : 'change', applyFilters);
  });
  document.getElementById('resetFilters').addEventListener('click', () => {
    document.getElementById('filters').reset();
    render(ALL);
  });
}

init();
