// CruiseFeed adapter — broad cruise catalog (61 lines) via server-side search.
// Auth is Authorization: Bearer <CRUISEFEED_KEY> (Worker secret; never in code).
// We map their CruiseOut records to our internal sailing shape so the rest of the
// app is unchanged.

import { json } from './util.js';
import { listActiveSpecials } from './db.js';

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
  return {
    id: c.id,
    name,
    line: c.cruise_line || null,
    ship: c.ship_name || null,
    image: null,
    depart_date: c.departure_date || null,
    return_date: c.return_date || null,
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

// GET /api/sailings backed by CruiseFeed — public browse. Reads the search-bar
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
    const lines = await getCruiseLinesLive(env);
    return json(
      { sailings: [], count: 0, lines, destinations: CF_REGIONS, shipImages: {}, source: 'cruisefeed' },
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

  if (line) filters.cruise_line = line;
  if (dest) filters.destination = dest;
  if (port) filters.embark_port = port;
  if (/^\d{4}-\d{2}$/.test(month)) filters.month = month;
  if (length) {
    const [lo, hi] = length.split('-');
    if (lo) filters.nights_min = parseInt(lo, 10);
    if (hi) filters.nights_max = parseInt(hi, 10);
  }
  // Free-text box: route to the best CruiseFeed substring (line > region > ship).
  if (q) {
    const ql = q.toLowerCase();
    const lineHit = CF_LINES.find((l) => ql.includes(l.toLowerCase()) || l.toLowerCase().includes(ql));
    const regionHit = CF_REGIONS.find((r) => ql.includes(r.toLowerCase()) || r.toLowerCase().includes(ql));
    if (lineHit && !filters.cruise_line) filters.cruise_line = lineHit;
    else if (regionHit && !filters.destination) filters.destination = regionHit;
    else filters.ship_name = q;
  }

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

// Search CruiseFeed and return mapped sailings. Throws with .code
// 'not_configured' if no key, or .status on an upstream error.
export async function searchCruiseFeed(env, filters = {}, opts = {}) {
  const key = env.CRUISEFEED_KEY;
  if (!key) { const e = new Error('not_configured'); e.code = 'not_configured'; throw e; }

  const p = new URLSearchParams(toCruiseFeedParams(filters));
  // Interpret any budget filter in USD, but do NOT filter by currency — that
  // would exclude sailings not priced in USD and shrink line coverage. We also
  // deliberately omit has_price: has_price=false returns ONLY no-price sailings,
  // and has_price=true drops any without a lead-in fare — omitting it returns all.
  p.set('price_in', 'USD');
  p.set('dedupe', 'true');
  p.set('sort', 'departure_date');
  p.set('limit', String(Math.min(opts.limit || 50, 500)));

  const res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    // Cache at the edge for 24h — the free plan only refreshes daily anyway, so
    // this maximizes free repeat-search hits without any real freshness loss.
    cf: { cacheTtl: 86400, cacheEverything: true },
  });
  if (!res.ok) { const e = new Error('cruisefeed_upstream'); e.status = res.status; throw e; }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  const sailings = items.map(mapCruiseFeed);
  return annotateSpecials(env, sailings);
}

// Flag catalog sailings whose ship has an active advisor special, so shoppers
// see "Special available" right where they browse. Coarse by design (matches on
// ship, guarded by line) — best-effort and never blocks the search.
async function annotateSpecials(env, sailings) {
  if (!sailings.length || !env || !env.DB) return sailings;
  let specials;
  try { specials = await listActiveSpecials(env.DB, 200); } catch (_) { return sailings; }
  if (!specials || !specials.length) return sailings;
  const normShip = (s) => String(s || '').toLowerCase().replace(/^(ms|mv|ss|rms|m\/s|m\/v)\s+/, '').replace(/[^a-z0-9]+/g, '');
  const normLine = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
  // Two indexes: an exact ship+date map (Phase 2, when the advisor set a
  // departure date) and a ship-only map (Phase 1, coarse) for dateless specials.
  const byShipDate = new Map();
  const byShip = new Map();
  for (const sp of specials) {
    const ship = normShip(sp.ship);
    if (!ship) continue;
    if (isDate(sp.depart_date)) {
      const k = `${ship}|${sp.depart_date}`;
      if (!byShipDate.has(k)) byShipDate.set(k, sp);
    } else if (!byShip.has(ship)) {
      byShip.set(ship, sp);
    }
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
