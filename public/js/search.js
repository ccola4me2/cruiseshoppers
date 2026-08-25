// Public cruise search on the front page. Renders professional result cards
// grouped by itinerary with clickable sail-date chips. Requesting a quote
// requires a client sign-in.

(function () {
  const $ = (id) => document.getElementById(id);
  if (!$('searchBar')) return;
  let ALL = [];
  let SHIP_IMAGES = {};
  let CF = false; // true when the catalog is served by CruiseFeed (query-on-demand)
  // Whether the visitor is signed in — decides how the "click a date" hint reads.
  let SIGNED_IN = false;
  try { getMe().then((u) => { SIGNED_IN = !!u; }).catch(() => {}); } catch (_) {}

  async function load() {
    let data = {};
    try {
      const res = await fetch('/api/sailings?facets=1');
      data = await res.json();
      if (!res.ok) throw new Error(data.error || 'error');
    } catch (e) {
      const msg =
        data.message ||
        (data.error === 'not_configured'
          ? 'Our sailings catalog is being connected. Please check back shortly.'
          : 'We could not load sailings right now. Please try again in a moment.');
      $('f-results').innerHTML = `<div class="state">${escapeHtml(msg)}</div>`;
      $('f-count').textContent = '';
      return;
    }
    ALL = data.sailings || [];
    SHIP_IMAGES = data.shipImages || {};
    CF = data.source === 'cruisefeed';
    fillFacets(data);
    // Wait for the traveler to click "Search Cruises" before showing sailings.
    showPrompt();
  }

  // CruiseFeed is query-on-demand: send the chosen filters to the server and
  // render what comes back (already filtered), instead of filtering a full
  // preloaded catalog client-side.
  async function runSearchCF(overrides) {
    overrides = overrides || {};
    const params = new URLSearchParams();
    const set = (k, v) => { if (v) params.set(k, v); };
    set('destination', overrides.destination || $('f-destination').value);
    set('line', $('f-line').value);
    set('month', overrides.month || $('f-saildate').value);
    set('length', $('f-length').value);
    set('q', (overrides.q != null ? overrides.q : ($('f-q') ? $('f-q').value : '')).trim());
    set('port', ($('f-port') ? $('f-port').value : '').trim());
    // A ship chosen from the dropdown is an exact filter; skip it when the ship
    // finder tab drove the search (it passes its own q override).
    if (overrides.q == null) set('ship', $('f-ship') ? $('f-ship').value : '');
    $('f-count').textContent = '';
    $('f-results').innerHTML = `<div class="state"><div class="spinner"></div>Searching sailings…</div>`;
    try {
      const res = await fetch('/api/sailings?' + params.toString());
      const data = await res.json();
      if (data && data.error) {
        $('f-count').textContent = '';
        $('f-results').innerHTML =
          `<div class="state">${escapeHtml(data.message || 'We could not load sailings right now. Please try again.')}</div>`;
        return;
      }
      ALL = data.sailings || [];
      renderGroups(ALL);
    } catch (e) {
      $('f-results').innerHTML = `<div class="state">We could not load sailings right now. Please try again.</div>`;
    }
  }

  function showPrompt() {
    $('f-count').textContent = '';
    $('f-results').innerHTML =
      `<div class="state">Choose your options above and click <strong>Search Cruises</strong> to see sailings.</div>`;
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
    if ($('f-port')) fill('f-port', data.ports || uniq(ALL.map((s) => s.departure_port)), 'Any departure port');
    const sel = $('f-saildate'); const cur = sel.value;
    let months;
    if (CF) {
      // Generate the next 24 months (we don't preload the whole catalog).
      months = [];
      const now = new Date();
      for (let i = 0; i < 24; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
        months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
      }
    } else {
      months = uniq(ALL.map((s) => monthKey(s.depart_date))).sort();
    }
    sel.innerHTML = `<option value="">Any Month/Year</option>` +
      months.map((m) => `<option value="${m}">${escapeHtml(monthLabel(m))}</option>`).join('');
    sel.value = cur;
  }

  // Load the chosen cruise line's ships into the Ship dropdown, using the FREE
  // /v1/ships reference (no metered catalog credits). Departure Port stays the
  // full free list; results only cost credits on the actual Search click.
  async function populateShips(line) {
    const sel = $('f-ship');
    if (!sel) return;
    const cur = sel.value;
    if (!line) {
      sel.innerHTML = '<option value="">Any ship (choose a line first)</option>';
      sel.disabled = true;
      return;
    }
    sel.disabled = true;
    sel.innerHTML = '<option value="">Loading ships…</option>';
    let ships = [];
    try { ships = (await (await fetch('/api/ships?line=' + encodeURIComponent(line))).json()).ships || []; } catch (_) {}
    sel.innerHTML = '<option value="">Any ship</option>' +
      ships.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
    if (cur && ships.includes(cur)) sel.value = cur;
    sel.disabled = false;
  }

  function applyFilters() {
    const dest = $('f-destination').value.toLowerCase();
    const sd = $('f-saildate').value;
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
      if (s.depart_date) groups.get(key).dates.push({ id: s.id, date: s.depart_date, special: s.special || null });
    }
    const arr = [...groups.values()].filter((g) => g.dates.length > 0);
    for (const g of arr) g.dates.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    arr.sort((a, b) => ((a.dates[0] && a.dates[0].date) || '9999').localeCompare((b.dates[0] && b.dates[0].date) || '9999'));

    $('f-count').textContent =
      `${arr.length} itinerar${arr.length === 1 ? 'y' : 'ies'} · ${list.length} sailing${list.length === 1 ? '' : 's'}`;

    if (!arr.length) {
      results.innerHTML = `<div class="state">No cruises match your search. Try broadening your filters.</div>`;
      return;
    }
    const hint = SIGNED_IN
      ? '👉 Click a sail date to request a personalized, no-obligation quote on that sailing.'
      : '👉 Click a sail date to request a quote. It’s free — you’ll create a quick account, then go straight to your request.';
    results.innerHTML =
      `<p class="res-hint">${hint}</p>` +
      `<div class="res-list">${arr.map(card).join('')}</div>`;
    results.querySelectorAll('[data-sail]').forEach((b) =>
      b.addEventListener('click', () => requestQuote(b.getAttribute('data-sail'))));
    loadShipImages(arr);
  }

  // Fetch real ship photos (Wikimedia via our cached endpoint) and swap them
  // into the matching cards. Ships without a photo keep the neutral tile.
  async function loadShipImages(groups) {
    const ships = [...new Set(groups.map((g) => g.rep && g.rep.ship).filter(Boolean))];
    if (!ships.length) return;
    let images = {};
    try {
      const res = await fetch('/api/ship-images', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ships }),
      });
      if (!res.ok) return;
      images = (await res.json()).images || {};
    } catch (e) { return; }
    document.querySelectorAll('.res-thumb[data-ship]').forEach((el) => {
      const info = images[el.getAttribute('data-ship')];
      el.classList.remove('res-thumb-loading');
      if (info && info.image) {
        el.style.backgroundImage = `url('${info.image}')`;
        el.classList.add('res-thumb-photo');
        // Keep attribution available on hover (no visible text on the card).
        if (info.credit) el.title = 'Photo: ' + info.credit + (info.source ? ' — ' + info.source : '');
      } else {
        el.classList.add('res-thumb-empty');
      }
    });
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

  function imageFor(s) {
    if (s.image) return s.image; // real ship photo from the cruise line's fleet
    const t = `${s.destination || ''} ${s.name || ''}`.toLowerCase();
    if (/alaska|glacier|juneau|ketchikan|skagway/.test(t)) return '/img/dest-alaska.jpg';
    if (/norw|fjord|iceland|baltic|scandinav|northern europe/.test(t)) return '/img/dest-fjords.jpg';
    if (/mediterran|greek|greece|ital|spain|adriatic|europe|barcelona|rome/.test(t)) return '/img/dest-mediterranean.jpg';
    if (/bahama|bermuda|great stirrup|cococay|perfect day|nassau/.test(t)) return '/img/dest-bahamas.jpg';
    return '/img/dest-caribbean.jpg'; // tropical default (most US-market sailings)
  }
  function nightsLabel(n) { return `${n} ${Number(n) === 1 ? 'night' : 'nights'}`; }
  function metaText(s) {
    const bits = [];
    if (s.destination) bits.push(s.destination);
    if (s.type && s.type !== 'Ocean') bits.push(`${s.type}`);
    if (s.departure_port) bits.push(`Departs ${s.departure_port}`);
    return bits.join('  ·  ');
  }
  function card(g) {
    const s = g.rep;
    // A special applies to the specific sail dates the server flagged — not the
    // whole itinerary. Tag only those date chips, and word the badge to match.
    const specialDates = g.dates.filter((d) => d.special);
    const sp = specialDates.length ? specialDates[0].special : null;
    const allSpecial = sp && specialDates.length === g.dates.length;
    // More than one distinct special across the dates: don't show a single price.
    const multiSpecial = new Set(specialDates.map((d) => d.special && d.special.id).filter(Boolean)).size > 1;
    const chips = g.dates
      .map((d) => {
        const on = !!d.special;
        return `<button type="button" class="date-chip${on ? ' date-chip-special' : ''}" data-sail="${escapeHtml(d.id)}"${on ? ' title="Special available on this date"' : ''}>${on ? '🏷 ' : ''}${escapeHtml(niceDate(d.date))}</button>`;
      })
      .join('');
    // The actual ship photo loads in after render (matched by ship name); start
    // with a neutral tile so no destination stock is shown.
    const thumb = s.image
      ? `<div class="res-thumb res-thumb-photo" style="background-image:url('${escapeHtml(s.image)}')"></div>`
      : `<div class="res-thumb res-thumb-loading" data-ship="${escapeHtml(s.ship || '')}"></div>`;
    return `<article class="rescard" data-ref="${escapeHtml(s.id)}">
      ${thumb}
      <div class="rescard-main">
        <div class="rescard-head">
          ${s.line ? `<span class="line-badge">${escapeHtml(s.line)}</span>` : ''}
          <span class="rescard-ship" data-ship>${s.ship ? escapeHtml(s.ship) : ''}</span>
          ${s.nights ? `<span class="res-nights">${escapeHtml(nightsLabel(s.nights))}</span>` : ''}
        </div>
        <h3 class="rescard-title">${escapeHtml(s.name || s.destination || 'Cruise itinerary')}</h3>
        <p class="rescard-ports"><span>${escapeHtml(metaText(s))}</span><span data-depart></span></p>
        ${sp ? `<div class="rescard-special" title="${escapeHtml(multiSpecial ? 'Specials available' : (sp.headline || 'Special available'))}"><span class="special-flag">🏷 ${allSpecial ? 'Special available' : 'Special on select dates'}</span> <span class="rescard-special-sub">${(!multiSpecial && sp.rate_from) ? `from ${escapeHtml(money(sp.rate_from))} pp — ` : ''}${allSpecial ? 'pick a date to request' : 'pick a highlighted date below'}</span></div>` : ''}
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
    // If this sailing has an advisor special, route the request to that advisor.
    if (s.special && s.special.id) s.special_id = s.special.id;
    // CruiseFeed sailings already carry ship + ports, so quote directly.
    try { sessionStorage.setItem('cs_quote_sailing', JSON.stringify(s)); } catch (e) {}
    getMe().then((u) => { window.location.href = u ? '/quote' : '/signup?next=/quote'; });
  }

  // Natural-language concierge box (home page): sentence -> AI filters ->
  // CruiseFeed, rendered with the same cards. Requires sign-in (AI is gated).
  async function runConcierge() {
    const q = ($('cx-q') ? $('cx-q').value : '').trim();
    if (!q) return;
    $('f-count').textContent = '';
    $('f-results').innerHTML = `<div class="state"><div class="spinner"></div>Neptune is searching every cruise line…</div>`;
    const r = $('f-results'); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
    let res, data;
    try {
      res = await fetch('/api/concierge', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q }),
      });
      data = await res.json();
    } catch (e) {
      $('f-results').innerHTML = `<div class="state">We could not search right now. Please try again.</div>`;
      return;
    }
    if (res.status === 401) {
      $('f-results').innerHTML = `<div class="state">Sign in to ask Neptune. <a href="/login?next=/">Log in</a> or <a href="/signup?next=/">sign up free</a> — or use the filters below.</div>`;
      return;
    }
    ALL = data.matches || [];
    if (!ALL.length) {
      $('f-results').innerHTML = `<div class="state">Neptune couldn't find a match for that. Try fewer specifics, a different month, or the filters below.</div>`;
      return;
    }
    renderGroups(ALL);
  }
  if ($('cx-go')) {
    $('cx-go').addEventListener('click', runConcierge);
    $('cx-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); runConcierge(); } });
  }

  // Search-mode tabs: switch between the filter and Neptune panes.
  const spTabs = document.querySelectorAll('.sp-tab');
  if (spTabs.length) {
    const panes = document.querySelectorAll('.sp-pane');
    spTabs.forEach((tab) => tab.addEventListener('click', () => {
      const mode = tab.getAttribute('data-mode');
      spTabs.forEach((x) => {
        const on = x === tab;
        x.classList.toggle('is-active', on);
        x.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      panes.forEach((p) => p.classList.toggle('is-active', p.getAttribute('data-pane') === mode));
      const focusEl = { neptune: 'cx-q' }[mode];
      if (focusEl && $(focusEl)) $(focusEl).focus();
    }));
  }

  // Choosing a cruise line loads its ships (free reference call). No other
  // per-change lookups — results only cost credits on the Search click.
  if ($('f-line')) {
    $('f-line').addEventListener('change', () => populateShips($('f-line').value));
  }

  // Wire controls: results are shown only when "Search Cruises" is clicked
  // (or Enter is pressed in the form), never live as filters change.
  $('searchBar').addEventListener('submit', (e) => {
    e.preventDefault();
    if (CF) runSearchCF(); else applyFilters();
    const r = $('f-results');
    if (r) r.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  // Popular-destination tiles run a live search for that region.
  document.querySelectorAll('.dest[data-dest]').forEach((el) => {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const d = el.getAttribute('data-dest');
      const sel = $('f-destination');
      if (sel && [...sel.options].some((o) => o.value === d)) sel.value = d;
      if (CF) runSearchCF({ destination: d }); else applyFilters();
    });
  });


  load();
})();
