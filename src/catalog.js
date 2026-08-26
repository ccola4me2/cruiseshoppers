// Local CruiseFeed catalog: a scheduled import copies the sailings catalog into
// D1 (table `sailings`), and searches/pickers read from D1 instead of hitting
// the metered API on every request.
//
// The import is resumable and quota-aware: it pages the catalog by offset,
// saves a cursor in `catalog_import_state`, only re-imports when CruiseFeed's
// monthly snapshot date (x-data-as-of) changes, and stops before draining the
// monthly results allowance.

const BASE = 'https://api.cruisefeed.io';
const PAGE = 500;            // rows per API page
const DB_BATCH = 50;         // rows per D1 batch write

// Lowercased, alphanumeric-only key for robust ship/line name matching.
function normKey(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
function iso10(d) { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(d == null ? '' : d)); return m ? m[1] : null; }

async function stateGet(env, k) {
  try { const r = await env.DB.prepare('SELECT v FROM catalog_import_state WHERE k = ?').bind(k).first(); return r ? r.v : null; }
  catch (_) { return null; }
}
async function stateSet(env, k, v) {
  await env.DB.prepare('INSERT INTO catalog_import_state (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v')
    .bind(k, v == null ? '' : String(v)).run();
}

// Fetch one page of the catalog plus the quota/snapshot headers.
async function fetchPage(env, offset, limit) {
  // Upcoming departures only: those are the bookable ones shoppers can request,
  // and it keeps the import lean on a full/live plan (no already-sailed rows).
  const p = new URLSearchParams({
    dedupe: 'true', include_past: 'false', sort: 'departure_date',
    limit: String(limit), offset: String(offset),
  });
  const res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, {
    headers: { Authorization: `Bearer ${env.CRUISEFEED_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) { const e = new Error('cruisefeed_upstream'); e.status = res.status; throw e; }
  const data = await res.json();
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: data.total != null ? Number(data.total) : null,
    asOf: res.headers.get('x-data-as-of') || 'unknown',
    remaining: res.headers.get('x-results-remaining') != null ? Number(res.headers.get('x-results-remaining')) : null,
  };
}

async function upsertBatch(env, items) {
  const sql = `INSERT INTO sailings
    (id, cruise_line, ship, ship_norm, line_norm, name, depart_date, return_date, nights,
     departure_port, disembark_port, destination, round_trip, price_amount, price_currency, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      cruise_line=excluded.cruise_line, ship=excluded.ship, ship_norm=excluded.ship_norm,
      line_norm=excluded.line_norm, name=excluded.name, depart_date=excluded.depart_date,
      return_date=excluded.return_date, nights=excluded.nights, departure_port=excluded.departure_port,
      disembark_port=excluded.disembark_port, destination=excluded.destination, round_trip=excluded.round_trip,
      price_amount=excluded.price_amount, price_currency=excluded.price_currency, updated_at=excluded.updated_at`;
  const stmt = env.DB.prepare(sql);
  const now = Date.now();
  const bound = [];
  for (const c of items) {
    const depart = iso10(c.departure_date);
    const id = c.id || (c.ship_name && depart ? `${c.ship_name}|${depart}` : null);
    if (!id) continue;
    const nights = c.nights != null ? c.nights : (c.duration_days != null ? Math.max(0, c.duration_days - 1) : null);
    bound.push(stmt.bind(
      id, c.cruise_line || null, c.ship_name || null, normKey(c.ship_name), normKey(c.cruise_line),
      c.title || null, depart, iso10(c.return_date), nights,
      c.embark_port || null, c.disembark_port || null, c.region || null,
      c.round_trip ? 1 : 0, c.price_amount != null ? Number(c.price_amount) : null, c.price_currency || null, now
    ));
  }
  for (let i = 0; i < bound.length; i += DB_BATCH) {
    await env.DB.batch(bound.slice(i, i + DB_BATCH));
  }
  return bound.length;
}

// Run one bounded step of the import. Safe to call repeatedly (cron or manual);
// it resumes from the saved cursor and no-ops once the current snapshot is fully
// imported. opts: { maxPages, reserve, limit, force }.
export async function importCatalogStep(env, opts = {}) {
  if (!env.DB || !env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  const maxPages = opts.maxPages || 6;
  // Plan is uncapped, so no quota reserve by default; still honored if a caller
  // passes one and the API reports a finite remaining allowance.
  const reserve = opts.reserve != null ? opts.reserve : 0;
  const limit = opts.limit || PAGE;

  let head;
  try { head = await fetchPage(env, 0, 1); } catch (e) { return { ok: false, reason: 'fetch_failed', status: e.status || null }; }
  const asOf = head.asOf;
  const importedAsOf = await stateGet(env, 'imported_as_of');
  const cycleDone = (await stateGet(env, 'cycle_done')) === '1';

  // Fully imported for this snapshot already: do nothing (spends no quota).
  if (cycleDone && importedAsOf === asOf && !opts.force) {
    return { ok: true, skipped: true, asOf, imported: Number(await stateGet(env, 'row_count')) || 0, total: head.total };
  }
  // New snapshot (or forced full rebuild): reset the cursor. A forced rebuild
  // also clears the table for a clean slate (e.g. to drop rows from a previous
  // import that used different filters).
  if (importedAsOf !== asOf || opts.force) {
    if (opts.force) { try { await env.DB.prepare('DELETE FROM sailings').run(); } catch (_) {} }
    await stateSet(env, 'imported_as_of', asOf);
    await stateSet(env, 'offset', '0');
    await stateSet(env, 'cycle_done', '0');
    await stateSet(env, 'row_count', '0');
  }

  let offset = Number(await stateGet(env, 'offset')) || 0;
  let imported = Number(await stateGet(env, 'row_count')) || 0;
  let pages = 0, done = false, remaining = head.remaining;

  while (pages < maxPages) {
    let page;
    try { page = await fetchPage(env, offset, limit); } catch (_) { break; }
    if (page.remaining != null) remaining = page.remaining;
    if (!page.items.length) { done = true; break; }
    await upsertBatch(env, page.items);
    imported += page.items.length;
    offset += page.items.length;
    pages++;
    await stateSet(env, 'offset', String(offset));
    await stateSet(env, 'row_count', String(imported));
    if (page.items.length < limit) { done = true; break; }        // last page
    if (remaining != null && remaining < reserve) break;          // protect quota
  }

  if (done) {
    await stateSet(env, 'cycle_done', '1');
    await stateSet(env, 'last_full_import', String(Date.now()));
  }
  await stateSet(env, 'last_run', String(Date.now()));
  await stateSet(env, 'last_remaining', remaining == null ? '' : String(remaining));
  return { ok: true, asOf, offset, imported, pages, done, remaining, total: head.total };
}

// Whether the local catalog has data to serve (so callers can fall back to the
// live API before the first import completes).
export async function catalogReady(env) {
  if (!env.DB) return false;
  const n = Number(await stateGet(env, 'row_count')) || 0;
  return n > 0;
}

export async function importStatus(env) {
  if (!env.DB) return { configured: false };
  const keys = ['imported_as_of', 'offset', 'row_count', 'cycle_done', 'last_run', 'last_full_import', 'last_remaining'];
  const out = { configured: true };
  for (const k of keys) out[k] = await stateGet(env, k);
  try {
    const c = await env.DB.prepare('SELECT COUNT(*) AS n FROM sailings').first();
    out.rows_in_db = c ? c.n : null;
    const s = await env.DB.prepare('SELECT COUNT(DISTINCT ship_norm) AS n FROM sailings').first();
    out.distinct_ships = s ? s.n : null;
  } catch (_) {}
  return out;
}

// All distinct departure dates for one ship from the local catalog. Returns null
// if the catalog is not ready (caller should fall back to the live API).
export async function dbShipDates(env, ship, line) {
  if (!(await catalogReady(env))) return null;
  const shipNorm = normKey(ship);
  if (!shipNorm) return [];
  try {
    // Only upcoming, bookable departures reach a shopper, even though the table
    // may also hold past sailings from a full import.
    const today = new Date().toISOString().slice(0, 10);
    let q = `SELECT id, depart_date, nights, name, departure_port, destination, cruise_line, ship
             FROM sailings WHERE ship_norm = ? AND depart_date >= ?`;
    const binds = [shipNorm, today];
    if (line) { q += ' AND line_norm = ?'; binds.push(normKey(line)); }
    q += ' ORDER BY depart_date ASC';
    const res = await env.DB.prepare(q).bind(...binds).all();
    const rows = res.results || [];
    const seen = new Set();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.depart_date)) continue;
      seen.add(r.depart_date);
      out.push({
        id: r.id, depart_date: r.depart_date, nights: r.nights, name: r.name,
        departure_port: r.departure_port, destination: r.destination, line: r.cruise_line, ship: r.ship,
      });
    }
    return out;
  } catch (_) { return null; }
}
