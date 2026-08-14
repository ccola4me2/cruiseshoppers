// Widgety sailings proxy.
//
// Keeps credentials server-side and returns a normalized, PRICE-FREE dataset of
// cruise sailings for the authenticated catalog. Mirrors the auth model of the
// existing ships proxy: query-param auth (app_id + token) with api_version=2.
//
// === Widgety credentials ===============================================
// Replace the placeholders below with your real Widgety TEST credentials, or
// (preferred) set them as Cloudflare Worker secrets so they never touch the
// repo: `wrangler secret put WIDGETY_APP_ID` and `wrangler secret put WIDGETY_TOKEN`.
// Widgety authenticates with an app_id + token PAIR (not a single key).
const WIDGETY_APP_ID_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';
const WIDGETY_TOKEN_PLACEHOLDER = 'WIDGETY_API_KEY_HERE';
// =======================================================================

const WIDGETY_BASE = 'https://www.widgety.co.uk/api';
const WIDGETY_ACCEPT = 'application/json;api_version=2';
const PER_PAGE = 25;
const MAX_PAGES = 12;

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
          'Widgety credentials are not set. Add WIDGETY_APP_ID and WIDGETY_TOKEN as Worker secrets (or replace the placeholders in src/widgety.js).',
      },
      503
    );
  }

  const url = new URL(request.url);
  const auth = `app_id=${encodeURIComponent(appId)}&token=${encodeURIComponent(token)}`;

  // Fetch (cached at the edge) then filter/normalize.
  let raw;
  try {
    raw = await fetchAllCruises(auth);
  } catch (err) {
    return json({ error: 'fetch_failed' }, 502);
  }

  // Debug passthrough (auth-gated by the router): inspect the live shape so
  // field mappings below can be verified/adjusted against real test data.
  if (url.searchParams.get('debug') === 'raw') {
    return json({ sample: raw.slice(0, 2), count: raw.length }, 200);
  }

  let sailings = raw.map(normalizeSailing).filter((s) => s.ship || s.line || s.name);

  // --- Server-side search & filters -------------------------------------
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const line = (url.searchParams.get('line') || '').trim().toLowerCase();
  const ship = (url.searchParams.get('ship') || '').trim().toLowerCase();
  const port = (url.searchParams.get('port') || '').trim().toLowerCase();
  const destination = (url.searchParams.get('destination') || '').trim().toLowerCase();
  const from = url.searchParams.get('from'); // YYYY-MM-DD
  const to = url.searchParams.get('to');

  if (q) {
    sailings = sailings.filter((s) =>
      [s.name, s.line, s.ship, s.departure_port, s.destination]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }
  if (line) sailings = sailings.filter((s) => (s.line || '').toLowerCase().includes(line));
  if (ship) sailings = sailings.filter((s) => (s.ship || '').toLowerCase().includes(ship));
  if (port) sailings = sailings.filter((s) => (s.departure_port || '').toLowerCase().includes(port));
  if (destination)
    sailings = sailings.filter((s) => (s.destination || '').toLowerCase().includes(destination));
  if (from) sailings = sailings.filter((s) => !s.depart_date || s.depart_date >= from);
  if (to) sailings = sailings.filter((s) => !s.depart_date || s.depart_date <= to);

  sailings.sort((a, b) => (a.depart_date || '9999').localeCompare(b.depart_date || '9999'));

  // Facets for the filter UI.
  const lines = [...new Set(sailings.map((s) => s.line).filter(Boolean))].sort();
  const destinations = [...new Set(sailings.map((s) => s.destination).filter(Boolean))].sort();

  return json(
    { sailings, count: sailings.length, lines, destinations, source: 'Widgety' },
    200,
    { 'Cache-Control': 'private, max-age=300' }
  );
}

async function fetchAllCruises(auth) {
  const cache = caches.default;
  const cacheKey = new Request('https://cruiseshoppers.internal/widgety/cruises', { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached.json();

  const all = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await fetch(`${WIDGETY_BASE}/cruises.json?${auth}&per_page=${PER_PAGE}&page=${page}`, {
      headers: { Accept: WIDGETY_ACCEPT },
      cf: { cacheTtl: 1800, cacheEverything: true },
    });
    if (!res.ok) {
      if (page === 1) throw new Error(`widgety ${res.status}`);
      break; // earlier pages still usable
    }
    const data = await res.json();
    const batch = Array.isArray(data.cruises) ? data.cruises : Array.isArray(data) ? data : [];
    all.push(...batch);
    if (batch.length < PER_PAGE) break;
  }

  // Cache the raw list briefly at the edge (dataset changes rarely).
  const store = new Response(JSON.stringify(all), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1800' },
  });
  await cache.put(cacheKey, store.clone());
  return all;
}

// ---------------------------------------------------------------------------
// Normalization: defensive against field-name variation across the Widgety
// cruises payload. IMPORTANT: no pricing fields are ever read or emitted.
// Use `/api/sailings?debug=raw` to confirm these mappings against live data.
// ---------------------------------------------------------------------------
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj && obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
}

function nameOf(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'object') return (pick(v, 'name', 'title') || '').toString().trim() || null;
  return null;
}

function normalizeType(v) {
  const s = nameOf(v);
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes('river')) return 'River';
  if (t.includes('tour') || t.includes('land') || t.includes('escorted') || t.includes('rail')) return 'Tour';
  if (t.includes('ocean') || t.includes('sea')) return 'Ocean';
  return s;
}

function toDate(v) {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : s.slice(0, 10);
}

function stripHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeItinerary(cruise) {
  const list =
    pick(cruise, 'itinerary', 'itineraries', 'itinerary_days', 'port_visits', 'days') || [];
  const days = Array.isArray(list) ? list : [];
  return days
    .map((d, i) => {
      const portName =
        nameOf(pick(d, 'port', 'port_name', 'location', 'name', 'title')) || null;
      return {
        day: pick(d, 'day', 'day_number', 'number') || i + 1,
        date: toDate(pick(d, 'date', 'visit_date', 'day_date')),
        port: portName,
        arrive: pick(d, 'arrival_time', 'arrive', 'arrival', 'arrives'),
        depart: pick(d, 'departure_time', 'depart', 'departure', 'departs'),
        note: stripHtml(pick(d, 'description', 'programme', 'summary', 'notes')).slice(0, 240) || null,
      };
    })
    .filter((d) => d.port || d.note);
}

function normalizeSailing(c) {
  const line = nameOf(pick(c, 'operator', 'cruise_line', 'line', 'brand'));
  const ship = nameOf(pick(c, 'ship', 'ship_name', 'vessel'));
  const departDate = toDate(
    pick(c, 'departure_date', 'start_date', 'sailing_date', 'depart_date', 'from_date')
  );
  const returnDate = toDate(
    pick(c, 'arrival_date', 'end_date', 'return_date', 'to_date', 'disembarkation_date')
  );
  const itinerary = normalizeItinerary(c);
  const departPort =
    nameOf(pick(c, 'departure_port', 'embarkation_port', 'start_port', 'from_port')) ||
    (itinerary[0] && itinerary[0].port) ||
    null;
  const arrivePort =
    nameOf(pick(c, 'arrival_port', 'disembarkation_port', 'end_port', 'to_port')) ||
    (itinerary.length ? itinerary[itinerary.length - 1].port : null);

  return {
    id: pick(c, 'id', 'cruise_id', 'code') || crypto.randomUUID(),
    name: nameOf(pick(c, 'name', 'title')) || null,
    line,
    ship,
    depart_date: departDate,
    return_date: returnDate,
    nights: pick(c, 'nights', 'duration', 'length_nights', 'num_nights'),
    departure_port: departPort,
    arrival_port: arrivePort,
    destination: nameOf(pick(c, 'destination', 'region', 'area', 'destination_name')),
    type: normalizeType(pick(c, 'cruise_type', 'type', 'category', 'holiday_type', 'style')),
    itinerary,
    url: pick(c, 'html_href', 'url', 'href'),
    image:
      pick(c, 'cover_image_href', 'image_href', 'image', 'profile_image_href') ||
      (c.ship && typeof c.ship === 'object'
        ? pick(c.ship, 'cover_image_href', 'profile_image_href', 'image_href', 'image')
        : null),
    // NOTE: pricing intentionally omitted, no live pricing anywhere on the site.
  };
}
