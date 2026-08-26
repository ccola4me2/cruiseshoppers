// CruiseFeed adapter, broad cruise catalog (61 lines) via server-side search.
// Auth is Authorization: Bearer <CRUISEFEED_KEY> (Worker secret; never in code).
// We map their CruiseOut records to our internal sailing shape so the rest of the
// app is unchanged.

import { json } from './util.js';
import { listActiveSpecials } from './db.js';
import { dbShipDates, dbSearchSailings, dbFacets, dbShipsByLine } from './catalog.js';

const BASE = 'https://api.cruisefeed.io';

// Curated dropdown values. Lines are exact CruiseFeed cruise_line names (the
// cruise_line filter is a substring match, so exact names are safe). Regions are
// clean top-level buckets that substring-match CruiseFeed's granular region values
// (e.g. "Caribbean" matches Eastern/Western/Southern Caribbean).
export const CF_LINES = [
  'Carnival Cruise Line', 'Royal Caribbean', 'Norwegian Cruise Line', 'MSC Cruises',
  'Princess Cruises', 'Holland America Line', 'Celebrity Cruises', 'Disney Cruise Line',
  'Virgin Voyages', 'Costa Cruises', 'Cunard', 'Azamara', 'Oceania Cruises',
  'Regent Seven Seas Cruises', 'Seabourn', 'Silversea', 'Windstar Cruises', 'Ponant',
  'Viking Ocean Cruises', 'Viking River Cruises', 'AmaWaterways', 'Avalon Waterways',
  'Uniworld River Cruises', 'Scenic Ocean Cruises', 'Scenic River Cruises', 'Emerald Cruises',
  'Tauck', 'CroisiEurope Cruises', 'Riviera Travel Cruises', 'American Cruise Lines',
  'UnCruise Adventures Cruises', 'Star Clippers Cruises', 'Hurtigruten Cruises',
  'HX Expeditions', 'Lindblad Expeditions Cruises', 'Aurora Expeditions',
  'Margaritaville at Sea Cruises', 'P&O Cruises', 'Marella Cruises', 'Fred Olsen Cruise Lines',
  'AIDA Cruises', 'TUI Cruises', 'Celestyal Cruises', 'Atlas Ocean Voyages',
];
export const CF_REGIONS = [
  'Caribbean', 'Bahamas', 'Bermuda', 'Alaska', 'Mexico', 'Hawaii', 'Canada & New England',
  'Mediterranean', 'Europe', 'Northern Europe', 'Transatlantic', 'Panama Canal', 'Asia',
  'Australia', 'South America', 'Galapagos Islands', 'Africa', 'Antarctic', 'Amazon',
];

// One CruiseFeed CruiseOut record -> our internal sailing shape.
export function mapCruiseFeed(c) {
  const nights = c.nights != null ? c.nights : (c.duration_days != null ? Math.max(0, c.duration_days - 1) : null);
  const name = c.title || [c.ship_name, c.region, nights ? `${nights} nights` : ''].filter(Boolean).join(' ');
  // Normalize any date to a bare YYYY-MM-DD; a datetime would break the exact
  // string key used to match specials to sailings.
  const iso10 = (d) => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(d || '')); return m ? m[1] : null; };
  const depart = iso10(c.departure_date);
  return {
    // id is always present per the API, but fall back to ship|date so a sailing
    // never renders a date chip with an empty/duplicate identifier.
    id: c.id || (c.ship_name && depart ? `${c.ship_name}|${depart}` : c.id) || null,
    name,
    line: c.cruise_line || null,
    ship: c.ship_name || null,
    image: null,
    depart_date: depart,
    return_date: iso10(c.return_date),
    nights,
    departure_port: c.embark_port || null,
    disembark_port: c.disembark_port || null,
    destination: c.region || null,
    type: 'Ocean',
    itinerary: Array.isArray(c.itinerary) ? c.itinerary : [],
    url: c.detail_url || c.booking_url || null,
    // Pricing is available but not shown to shoppers (advisors quote); kept for
    // internal filtering (e.g. budget) and possible future use.
    price_amount: c.price_amount != null ? Number(c.price_amount) : null,
    price_currency: c.price_currency || null,
  };
}

// Turn a "YYYY-MM" into a first/last-day departure window.
function monthRange(m) {
  if (!/^\d{4}-\d{2}$/.test(String(m || ''))) return {};
  const [y, mo] = m.split('-').map(Number);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { departure_from: `${m}-01`, departure_to: `${m}-${String(last).padStart(2, '0')}` };
}

// Translate our concierge/search filters into CruiseFeed query params.
export function toCruiseFeedParams(f) {
  f = f || {};
  const out = {};
  if (f.cruise_line) out.cruise_line = String(f.cruise_line);
  if (f.destination) out.region = String(f.destination);
  if (f.ship_name) out.ship_name = String(f.ship_name);
  if (f.embark_port) out.embark_port = String(f.embark_port);
  if (f.departure_from) out.departure_from = f.departure_from;
  if (f.departure_to) out.departure_to = f.departure_to;
  if (f.month) Object.assign(out, monthRange(f.month));
  if (f.nights_min != null && f.nights_min !== '') out.min_nights = String(f.nights_min);
  if (f.nights_max != null && f.nights_max !== '') out.max_nights = String(f.nights_max);
  if (f.budget_pp != null && f.budget_pp !== '') out.max_price = String(f.budget_pp);
  return out;
}

// GET /api/sailings backed by CruiseFeed, public browse. Reads the search-bar
// params, routes the free-text box to a line/region/ship substring, queries
// CruiseFeed, and returns results plus the curated dropdown lists.
// Lightweight per-IP rate limit for the public search endpoint. This is a
// backstop so a bot cannot burn the metered catalogue by firing many varied
// queries (identical queries are already served free from the 24h edge cache).
// Degrades OPEN: if the req_rate table is missing or D1 errors, we never block
// a real search on the rate layer.
async function searchRateOk(env, ip, limit) {
  return rateLimitOk(env, 'search', ip, limit);
}

// Generic per-IP hourly rate limiter backed by the req_rate table. `bucket`
// namespaces the counter so different endpoints don't share a budget.
// Degrades OPEN (never blocks) if the table is missing or D1 errors.
export async function rateLimitOk(env, bucket, ip, limit) {
  const db = env.DB;
  if (!db || !ip) return true;
  const windowMs = 3600000; // 1 hour
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  try {
    const row = await db.prepare('SELECT count, reset_at FROM req_rate WHERE k = ?').bind(key).first();
    let count = 0;
    let resetAt = now + windowMs;
    if (row && Number(row.reset_at) > now) {
      count = Number(row.count) || 0;
      resetAt = Number(row.reset_at);
    }
    if (count >= limit) return false;
    await db
      .prepare(
        'INSERT INTO req_rate (k, count, reset_at) VALUES (?1, ?2, ?3) ' +
        'ON CONFLICT(k) DO UPDATE SET count = ?2, reset_at = ?3'
      )
      .bind(key, count + 1, resetAt)
      .run();
    return true;
  } catch (_) {
    return true; // table not migrated yet or transient error: do not block
  }
}

export async function handleSailingsCruiseFeed(request, env) {
  const url = new URL(request.url);
  const p = url.searchParams;

  // Facets-only request (initial page load): return the dropdown lists WITHOUT
  // querying the metered catalogue, so a page view costs zero results. The line
  // list comes from the free /v1/cruise-lines reference (edge-cached).
  if (p.get('facets')) {
    // Prefer facets derived from our own catalog so the dropdown values exactly
    // match what is stored (and thus filter correctly). Fall back to the live
    // reference lists until the catalog is loaded.
    const local = await dbFacets(env);
    if (local) {
      return json(
        { sailings: [], count: 0, lines: local.lines, destinations: local.destinations, ports: local.ports, shipImages: {}, source: 'catalog' },
        200,
        { 'Cache-Control': 'public, max-age=3600' }
      );
    }
    const [lines, ports] = await Promise.all([getCruiseLinesLive(env), getPortsLive(env)]);
    return json(
      { sailings: [], count: 0, lines, destinations: CF_REGIONS, ports, shipImages: {}, source: 'cruisefeed' },
      200,
      { 'Cache-Control': 'public, max-age=3600' }
    );
  }

  const filters = {};
  const line = (p.get('line') || '').trim();
  const dest = (p.get('destination') || p.get('region') || '').trim();
  const month = (p.get('month') || p.get('saildate') || '').trim();
  const port = (p.get('port') || '').trim();
  const length = (p.get('length') || '').trim(); // "min-max" or "31-"
  const q = (p.get('q') || '').trim();
  const ship = (p.get('ship') || '').trim(); // exact ship name chosen from a dropdown

  if (line) filters.cruise_line = line;
  if (dest) filters.destination = dest;
  if (ship) filters.ship_name = ship;
  if (port) filters.embark_port = port;
  if (/^\d{4}-\d{2}$/.test(month)) filters.month = month;
  if (length) {
    const [lo, hi] = length.split('-');
    if (lo) filters.nights_min = parseInt(lo, 10);
    if (hi) filters.nights_max = parseInt(hi, 10);
  }
  // Free-text box: route to the best CruiseFeed match (line > region > ship).
  // CruiseFeed's cruises ship_name filter matches the FULL normalized name, so a
  // partial like "harmony" won't hit "Harmony of the Seas", resolve the partial
  // to a real ship name via the free /v1/ships reference endpoint first.
  if (q) {
    const ql = q.toLowerCase().trim();
    // A confident line/region match: the text IS that line/region or clearly
    // contains its full name ("royal caribbean", "western caribbean"). We do NOT
    // match when a line name merely CONTAINS the query, ship names like
    // "Emerald", "Aurora", "Star" are substrings of line names and must not be
    // hijacked into a line filter (which would hide the actual ship).
    const lineHit = CF_LINES.find((l) => { const x = l.toLowerCase(); return ql === x || ql.includes(x); });
    const regionHit = CF_REGIONS.find((r) => { const x = r.toLowerCase(); return ql === x || ql.includes(x); });
    if (lineHit && !filters.cruise_line) {
      filters.cruise_line = lineHit;
      // Any words beyond the line name are a ship search within that line,
      // e.g. "royal caribbean harmony" -> line + ship "harmony".
      const rest = ql.replace(lineHit.toLowerCase(), ' ').replace(/\s+/g, ' ').trim();
      if (rest && !filters.ship_name) filters.ship_name = rest;
    } else if (regionHit && !filters.destination) {
      filters.destination = regionHit;
    } else if (!filters.ship_name) {
      filters.ship_name = q;
    }
  }

  // Serve from our local catalog when it is loaded: complete, instant, and no
  // metered API call or rate limit. Falls back to the live API otherwise.
  try {
    const local = await dbSearchSailings(env, filters, { limit: 400 });
    if (local) {
      await annotateSpecials(env, local);
      return json(
        { sailings: local, count: local.length, lines: CF_LINES, destinations: CF_REGIONS, shipImages: {}, source: 'catalog' },
        200,
        { 'Cache-Control': 'public, max-age=300' }
      );
    }
  } catch (_) { /* fall through to live API */ }

  // Rate-limit the metered path (facets above are exempt). Generous enough that
  // a real shopper never trips it; tight enough to stop automated abuse.
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
  const limit = Number(env.SEARCH_RATE_LIMIT) || 40;
  if (!(await searchRateOk(env, ip, limit))) {
    return json(
      { error: 'rate_limited', message: 'You have run a lot of searches in a short time. Please wait a few minutes and try again.' },
      429
    );
  }

  let sailings = [];
  try {
    // 20 keeps CruiseFeed's metered "results" usage down; itineraries group and
    // the dropdowns narrow further, so this is plenty per search.
    sailings = await searchCruiseFeed(env, filters, { limit: 20 });
  } catch (err) {
    if (err && err.code === 'not_configured') {
      return json({ error: 'not_configured', message: 'Our sailings catalog is being connected. Please check back shortly.' }, 503);
    }
    return json({ error: 'fetch_failed', message: 'We could not load sailings right now. Please try again shortly.' }, 502);
  }
  return json(
    { sailings, count: sailings.length, lines: CF_LINES, destinations: CF_REGIONS, shipImages: {}, source: 'cruisefeed' },
    200,
    { 'Cache-Control': 'public, max-age=300' }
  );
}

// The full cruise-line list from the FREE /v1/cruise-lines reference endpoint
// (does not spend result allowance). Edge-cached 24h; falls back to CF_LINES.
export async function getCruiseLinesLive(env) {
  const key = env.CRUISEFEED_KEY;
  if (!key) return CF_LINES;
  try {
    const res = await fetch(`${BASE}/v1/cruise-lines`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return CF_LINES;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : (Array.isArray(data.lines) ? data.lines : []);
    const list = items.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
    return list.length ? list.sort((a, b) => a.localeCompare(b)) : CF_LINES;
  } catch (_) {
    return CF_LINES;
  }
}

// Every embarkation port on offer, from the FREE /v1/ports reference endpoint
// (does not spend result allowance). Edge-cached 24h; [] on any error.
export async function getPortsLive(env) {
  const key = env.CRUISEFEED_KEY;
  if (!key) return [];
  try {
    const res = await fetch(`${BASE}/v1/ports`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data) ? data
      : (Array.isArray(data.items) ? data.items
      : (Array.isArray(data.ports) ? data.ports
      : (Array.isArray(data.values) ? data.values : [])));
    // Reference lists may be plain strings or objects, pull a name either way.
    const names = items
      .map((x) => (typeof x === 'string' ? x : (x && typeof x === 'object' ? (x.name || x.port_name || x.embark_port || x.port || x.value || x.label || '') : '')))
      // Strip the noisy trailing ". Embarkation" the feed appends to some ports
      // ("Aberdeen. Embarkation" -> "Aberdeen"); the bare name is what actually
      // substring-matches a sailing's embark_port, and it dedupes the variants.
      .map((x) => String(x).replace(/\s*[.,\-–—]?\s*embarkation\s*$/i, '').trim())
      .filter(Boolean);
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  } catch (_) {
    return [];
  }
}

// Search CruiseFeed and return mapped sailings. Throws with .code
// 'not_configured' if no key, or .status on an upstream error.
// Resolve a partial ship query ("harmony") to a full CruiseFeed ship name
// ("Harmony of the Seas") via the free /v1/ships reference endpoint, so the
// cruises ship_name filter (full-name match) actually hits. Returns null on no
// match or any error, and the caller falls back to the raw query. Edge-cached
// 24h since ship names are stable and /v1/ships is a non-metered reference.
export async function resolveShipName(env, q) {
  const key = env.CRUISEFEED_KEY;
  if (!key || !q) return null;
  try {
    const p = new URLSearchParams({ q, limit: '10' });
    const res = await fetch(`${BASE}/v1/ships?${p.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const names = items.map((s) => s && s.ship_name).filter(Boolean);
    if (!names.length) return null;
    const ql = String(q).toLowerCase();
    // Prefer exact, then prefix, then substring, else the first (best) result.
    return (
      names.find((n) => n.toLowerCase() === ql) ||
      names.find((n) => n.toLowerCase().startsWith(ql)) ||
      names.find((n) => n.toLowerCase().includes(ql)) ||
      names[0]
    );
  } catch (_) {
    return null;
  }
}

// GET /api/ship-dates?ship=&line=, EVERY departure date for one ship (not the
// small default page), for the advisor "pick the exact sailing" date dropdown.
// Metered (queries the catalog with a high limit) but edge-cached; gated to
// advisors in the router.
export async function handleShipDates(request, env) {
  const url = new URL(request.url);
  const ship = (url.searchParams.get('ship') || '').trim();
  const line = (url.searchParams.get('line') || '').trim();
  if (!ship) return json({ dates: [] }, 200);

  // Fallback: serve this ship's dates from our imported catalog (instant, free).
  const serveLocal = async () => {
    try {
      const local = await dbShipDates(env, ship, line);
      if (local) {
        await annotateSpecials(env, local);
        const cc = local.length ? 'public, max-age=600' : 'public, max-age=30';
        return json({ dates: local }, 200, { 'Cache-Control': cc });
      }
    } catch (_) {}
    return json({ dates: [] }, 200);
  };

  // Query CruiseFeed directly for THIS ONE ship. A per-ship query is authoritative
  // and cannot be truncated by whole-catalog pagination, so it always returns the
  // ship's full available schedule. It is metered, so cap per IP and fall back to
  // the local catalog when rate-limited or on error. Edge-cached to keep repeat
  // picks fast and cheap.
  if (!env.CRUISEFEED_KEY) return serveLocal();
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
  if (!(await rateLimitOk(env, 'shipdates', ip, Number(env.SHIPDATES_RATE_LIMIT) || 60))) {
    return serveLocal();
  }
  const filters = { ship_name: ship };
  if (line) filters.cruise_line = line;
  try {
    // Page through EVERY departure of this ship: request pages by offset and stop
    // on a short page (the last one) or a safety ceiling.
    // dedupe:false so we get EVERY individual dated departure of this ship, not
    // one representative per itinerary. Safe here because a single-ship query is
    // small (no whole-catalog pagination to truncate); we dedupe by date below.
    const PAGE = 200;
    const MAX_PAGES = 25; // up to 5000 sailings for one ship
    const sailings = [];
    for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex++) {
      const batch = await searchCruiseFeed(env, filters, { limit: PAGE, offset: pageIndex * PAGE, dedupe: false });
      if (!batch.length) break;
      for (const s of batch) sailings.push(s);
      if (batch.length < PAGE) break; // last page
    }
    const seen = new Set();
    const dates = [];
    for (const s of sailings) {
      if (!s.depart_date || seen.has(s.depart_date)) continue;
      seen.add(s.depart_date);
      // Include id + destination so the client picker can render the sailing and
      // request a quote on it (the advisor form ignores the extra fields).
      dates.push({ id: s.id || null, depart_date: s.depart_date, nights: s.nights || null, name: s.name || null, departure_port: s.departure_port || null, destination: s.destination || null, line: s.line || null, ship: s.ship || null, special: s.special || null });
    }
    dates.sort((a, b) => String(a.depart_date).localeCompare(String(b.depart_date)));
    // If the live query returned nothing, fall back to the local copy.
    if (!dates.length) return serveLocal();
    return json({ dates }, 200, { 'Cache-Control': 'public, max-age=1800' });
  } catch (_) {
    return serveLocal();
  }
}

// GET /api/ships?line=<cruise line>, the ship names for one cruise line, from
// the free /v1/ships reference endpoint (operator filter). Populates the client
// "choose a ship" dropdown. Non-metered and edge-cached; degrades to [] on any
// error so the UI can fall back to keyword search.
export async function handleShipsByLine(request, env) {
  const url = new URL(request.url);
  const line = (url.searchParams.get('line') || '').trim();
  if (!line) return json({ ships: [] }, 200);

  // Prefer the local catalog: only lists ships that actually have upcoming
  // departures for this line, and never rate-limited.
  try {
    const local = await dbShipsByLine(env, line);
    if (local && local.length) {
      return json({ ships: local, source: 'catalog' }, 200, { 'Cache-Control': 'public, max-age=1800' });
    }
  } catch (_) { /* fall through */ }

  const key = env.CRUISEFEED_KEY;
  if (!key) return json({ ships: [] }, 200);
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || '';
  if (!(await rateLimitOk(env, 'ships', ip, Number(env.SHIPS_RATE_LIMIT) || 120))) {
    return json({ error: 'rate_limited', ships: [] }, 429, { 'Retry-After': '300' });
  }
  try {
    const p = new URLSearchParams({ operator: line, limit: '500' });
    const res = await fetch(`${BASE}/v1/ships?${p.toString()}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true },
    });
    if (!res.ok) return json({ ships: [] }, 200);
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    const names = [...new Set(items.map((s) => s && s.ship_name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    return json({ ships: names }, 200, { 'Cache-Control': 'public, max-age=86400' });
  } catch (_) {
    return json({ ships: [] }, 200);
  }
}

export async function searchCruiseFeed(env, filters = {}, opts = {}) {
  const key = env.CRUISEFEED_KEY;
  if (!key) { const e = new Error('not_configured'); e.code = 'not_configured'; throw e; }

  // A ship_name may arrive as a partial ("harmony") from the search box or from
  // Neptune's extraction; the cruises filter needs the full name, so resolve it.
  if (filters.ship_name) {
    const full = await resolveShipName(env, filters.ship_name);
    if (full) filters = { ...filters, ship_name: full };
  }

  const p = new URLSearchParams(toCruiseFeedParams(filters));
  // Interpret any budget filter in USD, but do NOT filter by currency, that
  // would exclude sailings not priced in USD and shrink line coverage. We also
  // deliberately omit has_price: has_price=false returns ONLY no-price sailings,
  // and has_price=true drops any without a lead-in fare, omitting it returns all.
  p.set('price_in', 'USD');
  // dedupe collapses every repeated departure of the same itinerary down to one
  // representative sailing. That is right for the browse grid (one card per
  // itinerary), but wrong when we need every departure date of a ship, so the
  // date pickers pass dedupe:false to get all sailings.
  p.set('dedupe', opts.dedupe === false ? 'false' : 'true');
  p.set('sort', 'departure_date');
  // Only future sailings; without this the API can return past departures which,
  // sorted ascending, would fill the first page and crowd out upcoming dates.
  p.set('include_past', 'false');
  p.set('limit', String(Math.min(opts.limit || 50, 500)));
  if (opts.offset) p.set('offset', String(opts.offset));

  const res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    // Cache at the edge for 24h, the free plan only refreshes daily anyway, so
    // this maximizes free repeat-search hits without any real freshness loss.
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok) { const e = new Error('cruisefeed_upstream'); e.status = res.status; throw e; }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const sailings = items.map(mapCruiseFeed);
  return annotateSpecials(env, sailings);
}

// Best-effort parse of the FIRST (departure) date out of a special's free-text
// sail_dates. Handles ISO, MM/DD/YYYY (2- or 4-digit year), and "Month D, YYYY".
// Returns YYYY-MM-DD or null.
function firstDateISO(text) {
  const s = String(text || '');
  // Collect every date we can recognize with its position, then return the one
  // that appears FIRST in the text (the departure, a range lists it first),
  // regardless of which format it's written in.
  const cands = [];
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) cands.push([iso.index, `${iso[1]}-${iso[2]}-${iso[3]}`]);
  const mdy = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mdy) {
    const y = mdy[3].length === 2 ? `20${mdy[3]}` : mdy[3];
    cands.push([mdy.index, `${y}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`]);
  }
  const MO = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const mon = s.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/);
  if (mon) cands.push([mon.index, `${mon[3]}-${String(MO[mon[1]]).padStart(2, '0')}-${mon[2].padStart(2, '0')}`]);
  if (!cands.length) return null;
  cands.sort((a, b) => a[0] - b[0]);
  return cands[0][1];
}

// Flag catalog sailings whose ship has an active advisor special, so shoppers
// see "Special available" right where they browse. Coarse by design (matches on
// ship, guarded by line), best-effort and never blocks the search.
async function annotateSpecials(env, sailings) {
  if (!sailings.length || !env || !env.DB) return sailings;
  let specials;
  try { specials = await listActiveSpecials(env.DB, 200); } catch (_) { return sailings; }
  if (!specials || !specials.length) return sailings;
  const normShip = (s) => String(s || '').toLowerCase().replace(/^(ms|mv|ss|rms|m\/s|m\/v)\s+/, '').replace(/[^a-z0-9]+/g, '');
  const normLine = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // Pin each special to an exact ship + departure date so it badges only the
  // sailing it was posted for, never a blanket over every date of the ship.
  // Prefer the structured depart_date; else parse the departure out of the free
  // text sail_dates ("03/02/2027 - 03/06/27" -> 2027-03-02). A special we can't
  // pin to a date isn't badged in the catalog (it still shows on /specials).
  const byShipDate = new Map();
  // Ship-wide specials ("all departures"): keyed by ship only, they badge every
  // sailing of that ship regardless of date.
  const byShip = new Map();
  for (const sp of specials) {
    const ship = normShip(sp.ship);
    if (!ship) continue;
    if (sp.all_dates) {
      if (!byShip.has(ship)) byShip.set(ship, sp);
      continue;
    }
    const dt = isDate(sp.depart_date) ? sp.depart_date : firstDateISO(sp.sail_dates);
    if (!isDate(dt)) continue;
    const k = `${ship}|${dt}`;
    if (!byShipDate.has(k)) byShipDate.set(k, sp);
  }
  if (!byShipDate.size && !byShip.size) return sailings;
  for (const s of sailings) {
    const ship = normShip(s.ship);
    if (!ship) continue;
    const sp = byShipDate.get(`${ship}|${String(s.depart_date || '')}`) || byShip.get(ship);
    if (!sp) continue;
    // Ships are usually line-unique; if both name a line and they clearly
    // differ, skip (guards against a rare shared ship name).
    if (sp.cruise_line && s.line) {
      const a = normLine(sp.cruise_line), b = normLine(s.line);
      if (a !== b && !a.includes(b) && !b.includes(a)) continue;
    }
    s.special = { id: sp.id, headline: sp.headline || null, rate_from: sp.rate_from || null };
  }
  return sailings;
}
