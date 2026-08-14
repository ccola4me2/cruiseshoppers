// Widgety Cruise & Tours API V3 sailings proxy — built from the SHIPS feed.
//
// Each ship carries ALL of its cruises, so a few Ships calls yield the entire
// catalog *with* ship names and photos, and stays within the Workers free-plan
// subrequest limit. No pricing is ever read or emitted.
//
// Set WIDGETY_APP_ID and WIDGETY_TOKEN as Cloudflare Worker secrets.
const WIDGETY_APP_ID_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';
const WIDGETY_TOKEN_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';

const WIDGETY_BASE = 'https://www.widgety.co.uk/api';
const WIDGETY_ACCEPT = 'application/json;api_version=3';
const MARKET = 'us';
const SHIP_PAGES = 5; // 25 ships/page; ~53 ships total -> a few calls for the whole catalog

import { json } from './util.js';

export async function handleSailings(request, env, ctx) {
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { Allow: 'GET' });

  const appId = env.WIDGETY_APP_ID || WIDGETY_APP_ID_PLACEHOLDER;
  const token = env.WIDGETY_TOKEN || WIDGETY_TOKEN_PLACEHOLDER;
  if (!appId || !token || appId === 'WIDGETY_API_KEY_HERE' || token === 'WIDGETY_API_KEY_HERE') {
    return json(
      { error: 'not_configured', message: 'Widgety credentials are not set. Add WIDGETY_APP_ID and WIDGETY_TOKEN as Worker secrets.' },
      503
    );
  }

  const url = new URL(request.url);
  let sailings;
  try {
    sailings = await getCatalog(appId, token);
  } catch (err) {
    const st = err && err.status;
    if (st === 401 || st === 403) {
      return json({ error: 'catalog_unavailable', message: 'Our cruise catalog is being connected. Please check back soon.' }, 503);
    }
    return json({ error: 'fetch_failed', message: 'We could not load sailings right now. Please try again shortly.' }, 502);
  }

  if (url.searchParams.get('debug') === 'raw') {
    return json({ sample: sailings.slice(0, 3), count: sailings.length }, 200);
  }

  sailings.sort((a, b) => (a.depart_date || '9999').localeCompare(b.depart_date || '9999'));
  const lines = [...new Set(sailings.map((s) => s.line).filter(Boolean))].sort();
  const destinations = [...new Set(sailings.map((s) => s.destination).filter(Boolean))].sort();
  const shipImages = {};
  for (const s of sailings) if (s.ship && s.image && !shipImages[s.ship]) shipImages[s.ship] = s.image;

  return json(
    { sailings, count: sailings.length, lines, destinations, shipImages, source: 'Widgety' },
    200,
    { 'Cache-Control': 'public, max-age=600, s-maxage=21600' }
  );
}

// Assemble the full catalog from the Ships feed; cache the compact result so the
// heavy parse happens only on a cold cache.
async function getCatalog(appId, token) {
  const cache = caches.default;
  const key = new Request('https://cruiseshoppers.internal/widgety/catalog-ships-v1', { method: 'GET' });
  const cached = await cache.match(key);
  if (cached) return cached.json();

  const q = `app_id=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}`;
  const byRef = new Map();
  for (let page = 1; page <= SHIP_PAGES; page++) {
    const res = await fetch(`${WIDGETY_BASE}/ships.json?${q}&per_page=25&page=${page}`, {
      headers: { Accept: WIDGETY_ACCEPT },
      cf: { cacheTtl: 21600, cacheEverything: true },
    });
    if (!res.ok) {
      if (page === 1) { const e = new Error('widgety_upstream'); e.status = res.status; throw e; }
      break;
    }
    const data = await res.json();
    const ships = Array.isArray(data.ships) ? data.ships : [];
    for (const sh of ships) {
      const shipName = (sh.title || '').trim();
      const line = ((sh.operator && sh.operator.name) || '').trim();
      const image = sh.cover_image_href || sh.profile_image_href || (sh.operator && sh.operator.cover_image_href) || null;
      for (const c of sh.cruises || []) {
        const ref = String(c.ref || '').trim();
        if (!ref || byRef.has(ref)) continue;
        byRef.set(ref, normalizeCruiseEntry(c.name, ref, line, shipName, image));
      }
    }
    if (ships.length < 25) break;
  }

  const arr = [...byRef.values()];
  const store = new Response(JSON.stringify(arr), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' },
  });
  await cache.put(key, store.clone());
  return arr;
}

function normalizeCruiseEntry(name, ref, line, ship, image) {
  name = String(name || '').trim();
  const p = parseSailing(name, ref);
  return {
    id: ref,
    name,
    line: line || null,
    ship: ship || null,
    image: image || null,
    depart_date: p.depart,
    return_date: p.ret,
    nights: p.nights,
    departure_port: null,
    destination: p.destination,
    type: p.type,
    itinerary: [],
    url: null,
  };
}

// Parse nights/type/region from the name and the sail date from the ref.
function parseSailing(name, ref) {
  const nm = name.match(/(\d+)\s*(?:nights?|nts?|nt)\b/i);
  const nights = nm ? parseInt(nm[1], 10) : null;
  const type = /river/i.test(name)
    ? 'River'
    : /\b(tour|escorted|land|rail|stay)\b/i.test(name)
    ? 'Tour'
    : 'Ocean';
  const destination = classifyRegion(name);
  let depart = null, ret = null;
  // NCL: ...-YYYYMMDD-...   RCI: ...-DDMMYY[HOL]
  let m = ref.match(/-(\d{4})(\d{2})(\d{2})(?=-|HOL|$)/);
  if (m) depart = `${m[1]}-${m[2]}-${m[3]}`;
  else {
    m = ref.match(/-(\d{2})(\d{2})(\d{2})(?:HOL)?$/);
    if (m) depart = `20${m[3]}-${m[2]}-${m[1]}`;
  }
  if (depart && nights) ret = addDays(depart, nights);
  return { nights, type, destination, depart, ret };
}

// Per-itinerary detail: real departure/arrival ports + countries + ship.
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
  if (has(/caribbean|carib\b|antilles|aruba|cura|virgin islands|puerto rico|jamaica|grand cayman|cayman/)) return 'Caribbean';
  return 'Other Destinations';
}

function addDays(iso, n) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
