// Public cruise search on the front page. Renders professional result cards
// grouped by itinerary with clickable sail-date chips. Requesting a quote
// requires a client sign-in.

(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('searchBar')) return;
  let ALL = [];

  async function load() {
    let data = {};
    try {
      const res = await fetch('/api/sailings');
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'error');
    } catch (e) {
      const msg =
        data.error === 'not_configured'
          ? 'Our sailings catalog is being connected. Please check back shortly.'
          : 'We could not load sailings right now. Please try again in a moment.';
      $('f-results').innerHTML = `<div class="state">${escapeHtml(msg)}</div>`;
      $('f-count').textContent = '';
      return;
    }
    ALL = data.sailings || [];
    fillFacets(data);
    applyFilters();
  }

  function uniq(a) { return [...new Set(a.filter(Boolean))]; }
  function monthKey(d) { const m = /^(\d{4})-(\d{2})/.exec(d || ''); return m ? `${m[1]}-${m[2]}` : ''; }
  function monthLabel(k) {
    const m = /^(\d{4})-(\d{2})$/.exec(k); if (!m) return k;
    const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${names[+m[2] - 1]} ${m[1]}`;
  }
  function fill(id, values, allLabel) {
    const sel = $(id); const cur = sel.value;
    const vals = uniq(values).sort();
    sel.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>` +
      vals.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    sel.value = cur;
  }
  function fillFacets(data) {
    fill('f-destination', data.destinations || uniq(ALL.map((s) => s.destination)), 'Any Destination');
    fill('f-line', data.lines || uniq(ALL.map((s) => s.line)), 'All Cruiselines');
    const months = uniq(ALL.map((s) => monthKey(s.depart_date))).sort();
    const sel = $('f-saildate'); const cur = sel.value;
    sel.innerHTML = `<option value="">Any Month/Year</option>` +
      months.map((m) => `<option value="${m}">${escapeHtml(monthLabel(m))}</option>`).join('');
    sel.value = cur;
  }

  function applyFilters() {
    const dest = $('f-destination').value.toLowerCase();
    const sd = $('f-saildate').value;
    const type = $('f-type').value.toLowerCase();
    const len = $('f-length').value;
    const line = $('f-line').value.toLowerCase();
    const q = ($('f-q') ? $('f-q').value : '').trim().toLowerCase();
    const port = ($('f-port') ? $('f-port').value : '').trim().toLowerCase();
    let lmin = null, lmax = null;
    if (len) { const p = len.split('-'); lmin = +p[0]; lmax = +p[1]; }

    const out = ALL.filter((s) => {
      if (dest && (s.destination || '').toLowerCase() !== dest) return false;
      if (line && (s.line || '').toLowerCase() !== line) return false;
      if (sd && monthKey(s.depart_date) !== sd) return false;
      if (type && (s.type || '').toLowerCase() !== type) return false;
      if (len) { const n = Number(s.nights); if (!n || n < lmin || n > lmax) return false; }
      if (port && !(s.departure_port || '').toLowerCase().includes(port)) return false;
      if (q) {
        const hay = [s.name, s.line, s.ship, s.departure_port, s.destination].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    renderGroups(out);
  }

  // Group sailings that share an itinerary (line + ship + name) so their many
  // sail dates collapse into one card with date chips.
  function renderGroups(list) {
    const results = $('f-results');
    const groups = new Map();
    for (const s of list) {
      const key = `${s.line || ''}||${s.ship || ''}||${s.name || ''}`;
      if (!groups.has(key)) groups.set(key, { rep: s, dates: [] });
      if (s.depart_date) groups.get(key).dates.push({ id: s.id, date: s.depart_date });
    }
    const arr = [...groups.values()];
    for (const g of arr) g.dates.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    arr.sort((a, b) => ((a.dates[0] && a.dates[0].date) || '9999').localeCompare((b.dates[0] && b.dates[0].date) || '9999'));

    $('f-count').textContent =
      `${arr.length} itinerar${arr.length === 1 ? 'y' : 'ies'} · ${list.length} sailing${list.length === 1 ? '' : 's'}`;

    if (!arr.length) {
      results.innerHTML = `<div class="state">No cruises match your search. Try broadening your filters.</div>`;
      return;
    }
    results.innerHTML = `<div class="res-list">${arr.map(card).join('')}</div>`;
    results.querySelectorAll('[data-sail]').forEach((b) =>
      b.addEventListener('click', () => requestQuote(b.getAttribute('data-sail'))));
  }

  function portsSummary(s) {
    const ports = (s.itinerary || []).map((d) => d.port).filter(Boolean);
    if (!ports.length) {
      return [s.departure_port ? `Departs ${s.departure_port}` : '', s.destination].filter(Boolean).join(' · ');
    }
    const start = ports[0];
    const rest = uniq(ports.slice(1));
    const shown = rest.slice(0, 5).join(', ');
    const more = rest.length > 5 ? `, +${rest.length - 5} more` : '';
    return `Departs ${escapeHtml(start)}. Calls at ${escapeHtml(shown)}${escapeHtml(more)}.`;
  }

  function niceDate(d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); if (!m) return d || '';
    const dt = new Date(+m[1], +m[2] - 1, +m[3]);
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function card(g) {
    const s = g.rep;
    const thumb = s.image
      ? `<div class="res-thumb" style="background-image:url('${escapeHtml(s.image)}')"></div>`
      : `<div class="res-thumb res-thumb-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15h16l-2 4H6l-2-4Z"/><path d="M6 15V8h8l3.5 7"/><line x1="10" y1="8" x2="10" y2="4"/></svg></div>`;
    const chips = g.dates
      .map((d) => `<button type="button" class="date-chip" data-sail="${escapeHtml(d.id)}">${escapeHtml(niceDate(d.date))}</button>`)
      .join('');
    const nights = s.nights ? `<span class="res-nights">${escapeHtml(String(s.nights))} nights</span>` : '';
    return `<article class="rescard">
      ${thumb}
      <div class="rescard-main">
        <div class="rescard-head">
          ${s.line ? `<span class="line-badge">${escapeHtml(s.line)}</span>` : ''}
          ${s.ship ? `<span class="rescard-ship">${escapeHtml(s.ship)}</span>` : ''}
          ${nights}
        </div>
        <h3 class="rescard-title">${escapeHtml(s.name || s.destination || 'Cruise itinerary')}</h3>
        <p class="rescard-ports">${portsSummary(s)}</p>
        <div class="rescard-dates">
          <span class="rescard-dates-label">Sail dates</span>
          ${chips}
        </div>
      </div>
    </article>`;
  }

  function requestQuote(id) {
    const s = ALL.find((x) => String(x.id) === String(id));
    if (!s) return;
    try { sessionStorage.setItem('cs_quote_sailing', JSON.stringify(s)); } catch (e) {}
    getMe().then((u) => {
      window.location.href = u ? '/quote' : '/signup?next=/quote';
    });
  }

  // Wire controls
  ['f-destination', 'f-saildate', 'f-type', 'f-length', 'f-line'].forEach((id) =>
    $(id).addEventListener('change', applyFilters));
  $('searchBar').addEventListener('submit', (e) => { e.preventDefault(); applyFilters(); });
  $('f-advToggle').addEventListener('click', (e) => {
    e.preventDefault();
    const p = $('f-advPanel');
    p.hidden = !p.hidden;
    if (!p.hidden) {
      $('f-q').addEventListener('input', applyFilters);
      $('f-port').addEventListener('input', applyFilters);
    }
  });

  load();
})();
