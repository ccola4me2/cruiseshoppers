// Widgety Cruise & Tours API V3 ("Holidays API") sailings proxy.
//
// Keeps credentials server-side and returns a normalized, PRICE-FREE dataset of
// sailings for the public catalog/search.
//
// === Widgety credentials ===============================================
// Set these as Cloudflare Worker secrets (preferred) so they never touch the
// repo: `wrangler secret put WIDGETY_APP_ID` and `wrangler secret put WIDGETY_TOKEN`.
// The placeholder WIDGETY_API_KEY_HERE is only a fallback for quick testing.
const WIDGETY_APP_ID_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';
const WIDGETY_TOKEN_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';
// =======================================================================

const WIDGETY_BASE = 'https://www.widgety.co.uk/api';
const WIDGETY_ACCEPT = 'application/json;api_version=3'; // V3 (V2 is deprecated / errors)
const MARKET = 'us';
const MAX_PAGES = 45; // 25 holidays/page; stays under the Workers free-plan ~50 subrequest cap

import { json } from './util.js';

export async function handleSailings(request, env, ctx) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

  const appId = env.WIDGETY_APP_ID || WIDGETY_APP_ID_PLACEHOLDER;
  const token = env.WIDGETY_TOKEN || WIDGETY_TOKEN_PLACEHOLDER;
  if (!appId || !token || appId === 'WIDGETY_API_KEY_HERE' || token === 'WIDGETY_API_KEY_HERE') {
    return json(
      {
        error: 'not_configured',
        message:
          'Widgety credentials are not set. Add WIDGETY_APP_ID and WIDGETY_TOKEN as Worker secrets.',
      },
      503
    );
  }

  const url = new URL(request.url);
  const auth = `app_id=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}&market=${MARKET}`;

  let raw;
  try {
    raw = await fetchAllHolidays(auth);
  } catch (err) {
    const st = err && err.status;
    if (st === 401 || st === 403) {
      return json(
        { error: 'catalog_unavailable', message: 'Our cruise catalog is being connected. Please check back soon.' },
        503
      );
    }
    return json(
      { error: 'fetch_failed', message: 'We could not load sailings right now. Please try again shortly.' },
      502
    );
  }

  // Debug passthrough to verify field mapping against live data.
  if (url.searchParams.get('debug') === 'raw') {
    return json({ sample: raw.slice(0, 3), count: raw.length }, 200);
  }

  const sailings = raw.map(normalizeHoliday).filter((s) => s.line || s.name);

  // Attach a real ship photo (from the cruise line's fleet) to each sailing,
  // and pass a ship-name -> image map so the client can swap to the exact ship
  // photo once it resolves the ship name from the detail endpoint.
  let shipImagesByName = {};
  try {
    const fleet = await fetchFleet(appId, token);
    shipImagesByName = fleet.byName || {};
    for (const s of sailings) {
      const imgs = fleet.byLine[s.line];
      if (imgs && imgs.length) s.image = imgs[hashStr(s.id) % imgs.length];
    }
  } catch (_) {
    /* best-effort; cards fall back to a destination photo client-side */
  }

  sailings.sort((a, b) => (a.depart_date || '9999').localeCompare(b.depart_date || '9999'));

  const lines = [...new Set(sailings.map((s) => s.line).filter(Boolean))].sort();
  const destinations = [...new Set(sailings.map((s) => s.destination).filter(Boolean))].sort();

  return json(
    { sailings, count: sailings.length, lines, destinations, shipImages: shipImagesByName, source: 'Widgety' },
    200,
    { 'Cache-Control': 'public, max-age=600, s-maxage=21600' }
  );
}

// Per-itinerary detail: real ship name + departure/arrival ports + countries.
export async function getSailingDetail(request, env) {
  const url = new URL(request.url);
  const ref = (url.searchParams.get('ref') || '').trim();
  if (!/^[A-Za-z0-9_-]{4,48}$/.test(ref)) return json({ error: 'bad_ref' }, 400);

  const appId = env.WIDGETY_APP_ID || WIDGETY_APP_ID_PLACEHOLDER;
  const token = env.WIDGETY_TOKEN || WIDGETY_TOKEN_PLACEHOLDER;
  if (!appId || !token || appId === 'WIDGETY_API_KEY_HERE' || token === 'WIDGETY_API_KEY_HERE') {
    return json({ error: 'not_configured' }, 503);
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://cruiseshoppers.internal/widgety/detail/${encodeURIComponent(ref)}`, { method: 'GET' });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const q = `app_id=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}&market=${MARKET}`;
  const candidates = ref.endsWith('HOL') ? [ref] : [`${ref}HOL`, ref];
  let h = null;
  for (const c of candidates) {
    const res = await fetch(`${WIDGETY_BASE}/holidays/${encodeURIComponent(c)}.json?${q}`, {
      headers: { Accept: WIDGETY_ACCEPT },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    if (res.ok) { const d = await res.json(); h = d && typeof d.holiday === 'object' ? d.holiday : d; break; }
  }
  if (!h) return json({ error: 'not_found' }, 404);

  let ship = null, dep = null, arr = null;
  for (const s of h.operating_seasons || []) {
    for (const d of s.dates || []) {
      ship = ship || d.ship_title || null;
      dep = dep || (d.starts_at && d.starts_at.name) || null;
      arr = arr || (d.ends_at && d.ends_at.name) || null;
      if (ship && dep) break;
    }
    if (ship && dep) break;
  }
  const ports = Array.isArray(h.countries) ? h.countries : [];
  const resp = json(
    { ship, departure_port: dep, arrival_port: arr, ports, nights: h.cruise_nights || null },
    200,
    { 'Cache-Control': 'public, max-age=21600' }
  );
  await cache.put(cacheKey, resp.clone());
  return resp;
}

async function fetchAllHolidays(auth) {
  const cache = caches.default;
  const cacheKey = new Request('https://cruiseshoppers.internal/widgety/holidays-v3-p45', { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${WIDGETY_BASE}/holidays.json?${auth}&page=${page}`, {
      headers: { Accept: WIDGETY_ACCEPT },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!res.ok) {
      if (page === 1) { const e = new Error('widgety_upstream'); e.status = res.status; throw e; }
      break; // earlier pages still usable
    }
    const data = await res.json();
    const batch = Array.isArray(data.holidays) ? data.holidays : [];
    all.push(...batch);
    if (batch.length < 25) break; // last page
  }

  const store = new Response(JSON.stringify(all), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' },
  });
  await cache.put(cacheKey, store.clone());
  return all;
}

// ---------------------------------------------------------------------------
// Normalize a V3 holiday LIST item into a sailing. The list gives name +
// holiday_ref + operator_title; nights/destination come from the name and the
// sail date is encoded in the ref (…-DDMMYY[HOL]). No pricing is ever emitted.
// Use /api/sailings?debug=raw to inspect the live list shape.
// ---------------------------------------------------------------------------
function normalizeHoliday(h) {
  const name = String(h.name || '').trim();
  const ref = String(h.holiday_ref || '').trim();
  const line = String(h.operator_title || '').trim();

  const nightsMatch = name.match(/(\d+)\s*(?:nights?|nts?|nt)\b/i);
  const nights = nightsMatch ? parseInt(nightsMatch[1], 10) : null;

  const type = /river/i.test(name)
    ? 'River'
    : /\b(tour|escorted|land|rail|stay)\b/i.test(name)
    ? 'Tour'
    : 'Ocean';

  const destination = classifyRegion(name);

  let depart = null, ret = null;
  const m = ref.match(/-(\d{2})(\d{2})(\d{2})(?:HOL)?$/);
  if (m) {
    depart = `20${m[3]}-${m[2]}-${m[1]}`;
    if (nights) ret = addDays(depart, nights);
  }

  return {
    id: ref || name,
    name,
    line,
    ship: null,
    depart_date: depart,
    return_date: ret,
    nights,
    departure_port: null,
    destination,
    type,
    itinerary: [],
    url: h.holiday || null,
    image: null,
  };
}

// Cruise-line fleet images: { byLine: {line: [imgUrls]}, byName: {shipName: imgUrl} }.
async function fetchFleet(appId, token) {
  const cache = caches.default;
  const cacheKey = new Request('https://cruiseshoppers.internal/widgety/fleet-v1', { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const res = await fetch(
    `${WIDGETY_BASE}/operators.json?app_id=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}`,
    { headers: { Accept: WIDGETY_ACCEPT }, cf: { cacheTtl: 21600, cacheEverything: true } }
  );
  const byLine = {}, byName = {};
  if (res.ok) {
    const data = await res.json();
    for (const op of data.operators || []) {
      const line = (op.title || '').trim();
      const imgs = [];
      for (const sh of op.ships || []) {
        const im = sh && (sh.cover_image_href || sh.profile_image_href);
        if (im) {
          imgs.push(im);
          if (sh.name) byName[String(sh.name).trim()] = im;
        }
      }
      if (op.cover_image_href) imgs.push(op.cover_image_href);
      if (line && imgs.length) byLine[line] = imgs;
    }
  }
  const store = new Response(JSON.stringify({ byLine, byName }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' },
  });
  await cache.put(cacheKey, store.clone());
  return { byLine, byName };
}

function hashStr(s) {
  let h = 0;
  s = String(s || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

// Classify an itinerary name into a broad, filter-friendly destination region.
function classifyRegion(name) {
  const t = String(name || '').toLowerCase();
  const has = (re) => re.test(t);
  if (has(/alaska|glacier bay|juneau|ketchikan|skagway|inside passage|dawes/)) return 'Alaska';
  if (has(/bahama|great stirrup|cococay|perfect day|nassau|freeport/)) return 'Bahamas';
  if (has(/bermuda/)) return 'Bermuda';
  if (has(/hawaii|honolulu|maui|kauai/)) return 'Hawaii';
  if (has(/panama canal/)) return 'Panama Canal';
  if (has(/transatlantic|repositioning/)) return 'Transatlantic';
  if (has(/mexic|cabo|riviera|cozumel|ensenada|baja/)) return 'Mexico';
  if (has(/canada|new england|quebec|halifax|maritimes/)) return 'Canada & New England';
  if (has(/mediterran|greek|greece|ital|spain|barcelona|rome|adriatic|santorini|croatia|venice/)) return 'Mediterranean';
  if (has(/norw|fjord|iceland|baltic|scandinav|northern europe|british isles|amsterdam/)) return 'Northern Europe';
  if (has(/europe/)) return 'Europe';
  if (has(/pacific coast|california coast/)) return 'Pacific Coast';
  if (has(/caribbean|carib\b|antilles|aruba|cura|st\.? |virgin islands|puerto rico|jamaica|grand cayman|cayman/)) return 'Caribbean';
  return 'Other Destinations';
}

function addDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
