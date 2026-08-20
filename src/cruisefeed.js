// CruiseFeed adapter — broad cruise catalog (61 lines) via server-side search.
// Auth is the X-CruiseFeed-Key header, supplied as the CRUISEFEED_KEY Worker
// secret (never in code). We map their CruiseOut records to our internal
// sailing shape so the rest of the app is unchanged.

const BASE = 'https://api.cruisefeed.io';

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
  if (f.embark_port) out.embark_port = String(f.embark_port);
  if (f.departure_from) out.departure_from = f.departure_from;
  if (f.departure_to) out.departure_to = f.departure_to;
  if (f.month) Object.assign(out, monthRange(f.month));
  if (f.nights_min != null && f.nights_min !== '') out.min_nights = String(f.nights_min);
  if (f.nights_max != null && f.nights_max !== '') out.max_nights = String(f.nights_max);
  if (f.budget_pp != null && f.budget_pp !== '') out.max_price = String(f.budget_pp);
  return out;
}

// Search CruiseFeed and return mapped sailings. Throws with .code
// 'not_configured' if no key, or .status on an upstream error.
export async function searchCruiseFeed(env, filters = {}, opts = {}) {
  const key = env.CRUISEFEED_KEY;
  if (!key) { const e = new Error('not_configured'); e.code = 'not_configured'; throw e; }

  const p = new URLSearchParams(toCruiseFeedParams(filters));
  // Interpret any budget filter in USD, but do NOT filter by currency — that
  // would exclude sailings not priced in USD and shrink line coverage.
  p.set('price_in', 'USD');
  p.set('dedupe', 'true');
  p.set('has_price', 'false'); // include sailings even without a lead-in fare
  p.set('sort', 'departure_date');
  p.set('limit', String(Math.min(opts.limit || 50, 500)));

  const res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    cf: { cacheTtl: 900, cacheEverything: true },
  });
  if (!res.ok) { const e = new Error('cruisefeed_upstream'); e.status = res.status; throw e; }
  const data = await res.json();
  const items = Array.isArray(data.items) ? data.items : [];
  return items.map(mapCruiseFeed);
}
