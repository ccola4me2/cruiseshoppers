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
const DB_BATCH = 100;        // rows per D1 batch write

// Curated top-level destinations for the browse dropdown, so shoppers pick from
// ~20 clean choices instead of the ~240 raw region strings. Each maps to the
// keywords that appear in the catalog's raw `destination` values; selecting a
// region matches a sailing whose destination contains ANY of them. Order = the
// order shown in the dropdown.
const DEST_REGIONS = [
  { name: 'Caribbean', kw: ['caribbean', 'antilles'] },
  { name: 'Bahamas', kw: ['bahamas'] },
  { name: 'Bermuda', kw: ['bermuda'] },
  { name: 'Mexico', kw: ['mexico', 'baja', 'mexican'] },
  { name: 'Alaska', kw: ['alaska'] },
  { name: 'Hawaii', kw: ['hawaii'] },
  { name: 'Canada & New England', kw: ['canada', 'new england', 'canada-ne'] },
  { name: 'Panama Canal & Central America', kw: ['panama', 'central america', 'costa rica'] },
  { name: 'South America & Amazon', kw: ['south america', 'amazon', 'chile', 'argentina', 'brazil', 'peru'] },
  { name: 'Galapagos', kw: ['galapagos'] },
  { name: 'Antarctica', kw: ['antarctic'] },
  { name: 'Mediterranean', kw: ['mediterranean', 'adriatic', 'adria', 'aegean', 'greek', 'greece', 'croatia', 'dalmat', 'italy', 'spain', 'riviera', 'holy land'] },
  { name: 'Northern Europe & Baltic', kw: ['baltic', 'northern europe', 'scandinavia', 'norway', 'norwegian fjord', 'fjord', 'denmark', 'sweden', 'iceland', 'greenland'] },
  { name: 'British Isles', kw: ['british isles', 'ireland', 'england', 'scotland'] },
  { name: 'Canary Islands & Atlantic', kw: ['canary', 'canaries', 'madeira', 'azores', 'atlantic island'] },
  { name: 'Arctic', kw: ['arctic'] },
  { name: 'Transatlantic', kw: ['transatlantic'] },
  { name: 'Asia', kw: ['asia', 'japan', 'china', 'vietnam', 'thailand', 'singapore', 'transpacific'] },
  { name: 'Australia, NZ & South Pacific', kw: ['australia', 'new zealand', 'south pacific', 'tasman', 'tahiti'] },
  { name: 'Middle East & Arabia', kw: ['dubai', 'abu dhabi', 'qatar', 'arabia', 'middle east', 'persian', 'red sea'] },
  { name: 'Africa & Indian Ocean', kw: ['africa', 'afrika', 'seychelles', 'indian ocean', 'mauritius', 'madagascar'] },
  { name: 'Egypt & Nile', kw: ['egypt', 'nile'] },
  { name: 'European River Cruise', kw: ['danube', 'rhine', 'douro', 'elbe', 'seine', 'rhone', 'moselle', 'canals & tributaries', 'vltava', 'main,'] },
  { name: 'World Cruise', kw: ['world cruise', 'world voyage', 'grand voyage'] },
];

// Look up the keyword list for a curated region name (case-insensitive). Returns
// null when the value isn't one of our curated regions, so callers can fall back
// to a plain contains-match on the raw value.
function destKeywords(name) {
  const n = String(name || '').toLowerCase().trim();
  const hit = DEST_REGIONS.find((r) => r.name.toLowerCase() === n);
  return hit ? hit.kw : null;
}

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

// Fetch one page of the catalog plus the quota/snapshot headers. `extra` adds
// query params (e.g. { seen_since: '<iso>' } for an incremental/delta pull).
async function fetchPage(env, offset, limit, extra = {}) {
  // dedupe=true (one row per sailing across sources). dedupe=false is WRONG for a
  // bulk import: it returns each sailing once per source, which inflates the
  // near-term rows so much that paging by offset only covers a couple of weeks of
  // the calendar before stopping. dedupe does NOT collapse distinct departure
  // dates, so this still captures every date. include_past=false = upcoming only.
  const p = new URLSearchParams({
    dedupe: 'true', include_past: 'false', sort: 'departure_date',
    limit: String(limit), offset: String(offset),
  });
  for (const [k, v] of Object.entries(extra)) { if (v != null && v !== '') p.set(k, String(v)); }
  const res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, {
    headers: { Authorization: `Bearer ${env.CRUISEFEED_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch (_) {}
    const e = new Error('cruisefeed_upstream'); e.status = res.status; e.detail = detail; throw e;
  }
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
    // CruiseFeed's own id (one per deduped sailing); fall back to ship+date.
    const id = c.id || (c.ship_name && depart ? `${normKey(c.ship_name)}|${depart}` : null);
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

// --- Bulk CSV import ---------------------------------------------------------
// CruiseFeed exposes GET /v1/cruises.csv, the whole catalog in one download.
// This avoids offset paging entirely (offset paging skip-scans and gets slower
// the deeper it goes), so a full rebuild is a single fast download plus chunked
// D1 writes instead of ~150 ever-slower page fetches.

function normHeader(h) { return String(h == null ? '' : h).toLowerCase().replace(/[^a-z0-9]+/g, ''); }

// Minimal RFC-4180 CSV parser: handles quoted fields, escaped quotes (""),
// and commas/newlines inside quotes. Returns an array of string arrays.
function csvParse(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += ch;
    } else if (ch === '"') { inQuotes = true; }
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (ch === '\r') { /* ignore, handled by \n */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Map CSV rows (header + data) to the same item shape the JSON path produces,
// tolerant of column-name variants, so upsertBatch can consume them unchanged.
function csvToItems(rows) {
  if (!rows || rows.length < 2) return [];
  const idx = {};
  rows[0].forEach((h, i) => { const k = normHeader(h); if (!(k in idx)) idx[k] = i; });
  const pick = (r, aliases) => { for (const a of aliases) { const i = idx[a]; if (i != null && r[i] != null && r[i] !== '') return r[i]; } return null; };
  const numOrNull = (v) => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[^0-9.]/g, '')); return isFinite(n) ? n : null; };
  const items = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || (r.length === 1 && r[0] === '')) continue;
    items.push({
      id: pick(r, ['id', 'cruiseid', 'sailingid']),
      cruise_line: pick(r, ['cruiseline', 'line']),
      ship_name: pick(r, ['shipname', 'ship', 'vessel']),
      title: pick(r, ['title', 'name', 'sailingname']),
      departure_date: pick(r, ['departuredate', 'departdate', 'saildate', 'startdate']),
      return_date: pick(r, ['returndate', 'enddate', 'disembarkdate']),
      nights: numOrNull(pick(r, ['nights'])),
      duration_days: numOrNull(pick(r, ['durationdays', 'duration'])),
      embark_port: pick(r, ['embarkport', 'departureport', 'embarkationport', 'port']),
      disembark_port: pick(r, ['disembarkport', 'arrivalport', 'disembarkationport']),
      region: pick(r, ['region', 'destination', 'area']),
      round_trip: /^(1|true|yes|y)$/i.test(String(pick(r, ['roundtrip']) || '')),
      price_amount: numOrNull(pick(r, ['priceamount', 'price', 'fromprice', 'lowestprice'])),
      price_currency: pick(r, ['pricecurrency', 'currency']),
    });
  }
  return items;
}

// Rows per CSV page. Kept small on purpose: limit=10000 takes ~9s per page
// (near the request timeout), while 2000-5000 return in ~1-2s. 3000 is fast at
// shallow offsets and stays safe at deep offsets (where the API skip-scans).
const CSV_LIMIT = 3000;

// Fetch one page of the CSV (limit+offset, which the CSV endpoint supports; it
// does NOT support `sort`). Throws (with .status/.detail) on a bad response.
async function fetchCsvPage(env, offset, limit, extra = {}) {
  const p = new URLSearchParams({ dedupe: 'true', include_past: 'false', limit: String(limit), offset: String(offset) });
  for (const [k, v] of Object.entries(extra)) { if (v != null && v !== '') p.set(k, String(v)); }
  const res = await fetch(`${BASE}/v1/cruises.csv?${p.toString()}`, {
    headers: { Authorization: `Bearer ${env.CRUISEFEED_KEY}`, Accept: 'text/csv' },
  });
  if (!res.ok) { let detail = ''; try { detail = (await res.text()).slice(0, 200); } catch (_) {} const e = new Error('cruisefeed_csv'); e.status = res.status; e.detail = detail; throw e; }
  const rows = csvParse(await res.text());
  return { items: csvToItems(rows), headers: (rows[0] || []).slice(0, 40) };
}

// One bounded step of a CSV-based import. Pages /v1/cruises.csv in large chunks
// (CSV_LIMIT rows each) and writes them to D1, resuming from a saved offset.
// Far fewer requests than JSON paging (~8 pages vs ~150), each bounded in size.
export async function importCatalogCSVStep(env, opts = {}) {
  if (!env.DB || !env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  const maxPages = opts.maxCsvPages || 2;   // CSV pages to pull per step

  let head;
  try { head = await fetchPage(env, 0, 1); } catch (e) { return { ok: false, reason: 'fetch_failed', status: e.status || null, detail: e.detail || String((e && e.message) || e) }; }
  const asOf = head.asOf;
  const importedAsOf = await stateGet(env, 'imported_as_of');
  const cycleDone = (await stateGet(env, 'cycle_done')) === '1';

  if (cycleDone && importedAsOf === asOf && !opts.force) {
    return { ok: true, skipped: true, mode: 'csv', asOf, imported: Number(await stateGet(env, 'row_count')) || 0, total: head.total };
  }
  if (importedAsOf !== asOf || opts.force) {
    if (opts.force) { try { await env.DB.prepare('DELETE FROM sailings').run(); } catch (_) {} }
    await stateSet(env, 'imported_as_of', asOf);
    await stateSet(env, 'csv_offset', '0');
    await stateSet(env, 'offset', '0');
    await stateSet(env, 'cycle_done', '0');
    await stateSet(env, 'row_count', '0');
  }

  let offset = Number(await stateGet(env, 'csv_offset')) || 0;
  let imported = Number(await stateGet(env, 'row_count')) || 0;
  let done = false, headers = [];
  for (let pages = 0; pages < maxPages; pages++) {
    let page;
    try { page = await fetchCsvPage(env, offset, CSV_LIMIT); }
    catch (e) { return { ok: false, reason: 'csv_failed', status: e.status || null, detail: e.detail || String((e && e.message) || e) }; }
    headers = page.headers;
    if (!page.items.length) { done = true; break; }
    const written = await upsertBatch(env, page.items);
    // Parsed rows but wrote none on the first page => column mapping is wrong.
    if (offset === 0 && page.items.length >= 20 && written === 0) {
      return { ok: false, reason: 'csv_failed', detail: `csv parsed ${page.items.length} rows but wrote 0 (column mapping). headers: ${headers.join(', ')}` };
    }
    imported += written;
    offset += page.items.length;
    await stateSet(env, 'csv_offset', String(offset));
    await stateSet(env, 'offset', String(offset));
    await stateSet(env, 'row_count', String(imported));
    if (page.items.length < CSV_LIMIT) { done = true; break; }
  }

  if (done) { await stateSet(env, 'cycle_done', '1'); await stateSet(env, 'last_full_import', String(Date.now())); }
  await stateSet(env, 'last_run', String(Date.now()));
  return { ok: true, mode: 'csv', asOf, imported, total: head.total, offset, done };
}

// --- Incremental (delta) import ---------------------------------------------
// Once the base catalog is in D1, we no longer re-download all ~75k sailings
// every time CruiseFeed re-stamps the dataset (which happens whenever ANY price
// moves). Instead we pull only records changed since a saved watermark, using
// the `seen_since` filter, and upsert them onto the existing base. New sailings
// insert, changed ones update in place, and nothing is ever cleared. This keeps
// pay-as-you-go consumption tiny (a few rows per run instead of the whole file).
//
// Watermark buffer: `seen_since` is DATE-granular (YYYY-MM-DD), so we rewind the
// saved "since" by a full day on each run. Every run re-scans a ~1-day trailing
// window, which guarantees a record changed late in the day is never skipped
// while keeping the pull to a day or two of deltas.
const INCREMENTAL_OVERLAP_MS = 24 * 60 * 60 * 1000;   // 1 day
// Backstop for the very first delta run when no watermark exists yet: look back
// this far rather than pulling the whole catalog.
const INCREMENTAL_BACKSTOP_MS = 35 * 24 * 60 * 60 * 1000;   // 35 days
// Hard safety valve. Date-only deltas should be well under this per run. If a
// single step wants more than this, `seen_since` is almost certainly NOT being
// honored (it's returning the whole catalog), so we STOP, flag it, and do NOT
// advance the watermark — a misbehaving filter can never silently drain credit.
const INCREMENTAL_MAX_ROWS = 8000;

function isoNow(ms) { return new Date(ms == null ? Date.now() : ms).toISOString(); }
// `seen_since` wants a plain date (YYYY-MM-DD); a full datetime is rejected 422.
function isoDate(ms) { return new Date(ms == null ? Date.now() : ms).toISOString().slice(0, 10); }

// One bounded incremental step: pull sailings changed since the watermark and
// upsert them. opts: { maxCsvPages, force (ignored here) }.
export async function importCatalogIncrementalStep(env, opts = {}) {
  if (!env.DB || !env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  const maxPages = opts.maxCsvPages || 6;

  // Watermark: last point we're confident we've seen everything up to. Fall back
  // to the last full import time, else a bounded look-back (never the epoch,
  // which would re-pull the whole catalog on a feed that ignores the filter).
  let since = await stateGet(env, 'incremental_since');
  if (since) since = String(since).slice(0, 10);   // date-only; tolerate a stored datetime
  if (!since) {
    const lastFull = Number(await stateGet(env, 'last_full_import')) || 0;
    since = isoDate(lastFull ? lastFull - INCREMENTAL_OVERLAP_MS : Date.now() - INCREMENTAL_BACKSTOP_MS);
  }

  const runStart = Date.now();
  let offset = 0, imported = 0, pages = 0, done = false, overflow = false, headers = [];
  for (; pages < maxPages; pages++) {
    let page;
    try { page = await fetchCsvPage(env, offset, CSV_LIMIT, { seen_since: since }); }
    catch (e) {
      // 400/422 => endpoint rejected the seen_since param (unknown or bad value).
      // Report it so the caller can fix the param; we do NOT silently full-import,
      // which would spend big.
      if (e.status === 400 || e.status === 422) return { ok: false, reason: 'seen_since_unsupported', detail: (e.detail || '').slice(0, 200), since };
      return { ok: false, reason: 'csv_failed', status: e.status || null, detail: e.detail || String((e && e.message) || e), since };
    }
    headers = page.headers;
    if (!page.items.length) { done = true; break; }
    imported += await upsertBatch(env, page.items);
    offset += page.items.length;
    if (page.items.length < CSV_LIMIT) { done = true; break; }
    if (offset >= INCREMENTAL_MAX_ROWS) { overflow = true; break; }
  }

  await stateSet(env, 'last_run', String(runStart));
  await stateSet(env, 'last_incremental_run', String(runStart));
  await stateSet(env, 'incremental_rows_last', String(imported));
  if (overflow) {
    // Too many changes for a real date-delta: leave the watermark untouched so we
    // don't skip anything, and flag it for the admin status card.
    await stateSet(env, 'incremental_overflow', '1');
    return { ok: true, mode: 'incremental', since, imported, offset, overflow: true,
      note: 'seen_since returned more than the safety cap; watermark not advanced. Verify seen_since is honored (run incremental-probe).' };
  }
  await stateSet(env, 'incremental_overflow', '0');
  // Advance the watermark (date-only) to the run day minus the 1-day overlap.
  await stateSet(env, 'incremental_since', isoDate(runStart - INCREMENTAL_OVERLAP_MS));
  return { ok: true, mode: 'incremental', since, imported, offset, done };
}

// Decide full vs delta for a scheduled (cron) run and execute one step:
//  - No base yet, or the initial full cycle hasn't finished => keep building the
//    base with the full CSV import.
//  - Base present and fully loaded => pull deltas only (cheap).
// `force` always means a full rebuild. This is the cron entry point.
export async function runScheduledImport(env, opts = {}) {
  if (!env.DB || !env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  if (opts.force) return runImportStep(env, opts);
  const rows = Number(await stateGet(env, 'row_count')) || 0;
  const cycleDone = (await stateGet(env, 'cycle_done')) === '1';
  const baseReady = rows > 0 && cycleDone;
  if (!baseReady) return runImportStep(env, opts);
  // Base is loaded. Automatic delta pulls are GATED OFF by default: `seen_since`
  // is a "last crawled" filter, not "changed since", so on CruiseFeed it returns
  // almost the whole catalog every run — running it on the 15-min cron would burn
  // pay-as-you-go credit fast. The delta source is being moved to /v1/changes;
  // until that's proven cheap, the cron does nothing (spends nothing). Set env
  // CATALOG_DELTA=1 to re-enable the seen_since path for manual testing only.
  if (env.CATALOG_DELTA !== '1') {
    return { ok: true, skipped: true, reason: 'delta_disabled',
      note: 'base ready; automatic delta pulls off (seen_since returns ~full catalog). Pending /v1/changes.' };
  }
  const inc = await importCatalogIncrementalStep(env, opts);
  return inc;
}

// Diagnostic: prove that `seen_since` actually filters before we rely on it.
// Compares the match count for a far-past watermark (~ whole catalog) against a
// recent one (should be a small delta). Costs ~2 results. If the two counts are
// equal, the filter is being ignored and incremental mode is unsafe to trust.
export async function incrementalProbe(env) {
  if (!env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  const farPast = isoDate(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000);   // ~3 years
  const recent = isoDate(Date.now() - 2 * 24 * 60 * 60 * 1000);          // 2 days
  let baseline = null, recentHead = null, err = null;
  try { baseline = await fetchPage(env, 0, 1, { seen_since: farPast }); } catch (e) { err = { far: e.status || String((e && e.message) || e), detail: (e.detail || '').slice(0, 160) }; }
  try { recentHead = await fetchPage(env, 0, 1, { seen_since: recent }); } catch (e) { err = { ...(err || {}), recent: e.status || String((e && e.message) || e), detail: (e.detail || '').slice(0, 160) }; }
  if (err && (err.far === 400 || err.far === 422)) return { ok: false, supported: false, reason: 'seen_since_unsupported', error: err };
  const farTotal = baseline && baseline.total != null ? baseline.total : null;
  const recentTotal = recentHead && recentHead.total != null ? recentHead.total : null;
  const filtered = farTotal != null && recentTotal != null ? recentTotal < farTotal : null;
  return {
    ok: true,
    supported: filtered === true,
    far_past_total: farTotal,
    recent_total: recentTotal,
    filtered,
    note: filtered === true
      ? 'seen_since is honored; incremental mode is safe.'
      : (filtered === false
          ? 'seen_since returned the same total for both windows: the filter is NOT honored. Incremental mode would re-pull the whole catalog; keep full rebuilds (or use /v1/changes) instead.'
          : 'Could not read totals to decide; check error.'),
    error: err,
  };
}

// Diagnostic: hit the CSV endpoint and report what came back (no import, no
// secret exposed) so we can see status, size, headers, and how many rows map.
export async function csvProbe(env) {
  if (!env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  // Small page so the probe is instant (don't download the whole catalog).
  const p = new URLSearchParams({ dedupe: 'true', include_past: 'false', limit: '5', offset: '0' });
  let res;
  try { res = await fetch(`${BASE}/v1/cruises.csv?${p.toString()}`, { headers: { Authorization: `Bearer ${env.CRUISEFEED_KEY}`, Accept: 'text/csv' } }); }
  catch (e) { return { ok: false, reason: 'fetch_error', detail: String((e && e.message) || e) }; }
  let text = ''; try { text = await res.text(); } catch (_) {}
  const rows = csvParse(text);
  const items = csvToItems(rows);
  const mappable = items.filter((x) => x.id || (x.ship_name && x.departure_date)).length;
  let jsonTotal = null;
  try { jsonTotal = (await fetchPage(env, 0, 1)).total; } catch (_) {}
  // Probe several page sizes at offset 0 to find the largest limit the CSV
  // endpoint actually honors (spec says no max, but there may be an undocumented
  // cap). Report rows returned + time (or error) for each.
  const testLimit = async (lim) => {
    const t0 = Date.now();
    try { const r = await fetchCsvPage(env, 0, lim); return { limit: lim, rows: r.items.length, ms: Date.now() - t0 }; }
    catch (e) { return { limit: lim, error: e.status || String((e && e.message) || e), detail: (e && e.detail || '').slice(0, 160), ms: Date.now() - t0 }; }
  };
  const limitTests = [];
  for (const lim of [500, 2000, 5000, 10000]) limitTests.push(await testLimit(lim));
  // Also test a deep offset at 2000 to see if deep paging is honored/slow.
  let deep = null;
  { const t0 = Date.now(); try { const r = await fetchCsvPage(env, 60000, 2000); deep = { offset: 60000, limit: 2000, rows: r.items.length, ms: Date.now() - t0 }; } catch (e) { deep = { offset: 60000, error: e.status || String((e && e.message) || e), ms: Date.now() - t0 }; } }
  return {
    ok: res.ok,
    status: res.status,
    content_type: res.headers.get('content-type') || '',
    csv_rows_in_sample: Math.max(0, rows.length - 1),
    mappable_in_sample: mappable,
    json_total: jsonTotal,
    limit_tests: limitTests,
    deep_offset_test: deep,
    headers: (rows[0] || []).slice(0, 40),
    first_data_row: items[0] || null,
  };
}

// Diagnostic: run a live CruiseFeed query (e.g. a specific ship + embark port)
// and cross-check each result against our local DB, so we can tell "CruiseFeed
// doesn't have it" from "our import missed it".
export async function cfLookup(env, { embarkPort, shipName, cruiseLine } = {}) {
  if (!env.CRUISEFEED_KEY) return { ok: false, reason: 'not_configured' };
  const p = new URLSearchParams({ dedupe: 'true', include_past: 'false', sort: '-departure_date', limit: '25' });
  if (embarkPort) p.set('embark_port', embarkPort);
  if (shipName) p.set('ship_name', shipName);
  if (cruiseLine) p.set('cruise_line', cruiseLine);
  let res;
  try { res = await fetch(`${BASE}/v1/cruises?${p.toString()}`, { headers: { Authorization: `Bearer ${env.CRUISEFEED_KEY}`, Accept: 'application/json' } }); }
  catch (e) { return { ok: false, reason: 'fetch_error', detail: String((e && e.message) || e) }; }
  let data = {};
  try { data = await res.json(); } catch (_) {}
  const items = Array.isArray(data.items) ? data.items : [];
  let inDb = 0;
  const sample = [];
  for (const c of items) {
    const depart = iso10(c.departure_date);
    const id = c.id || (c.ship_name && depart ? `${normKey(c.ship_name)}|${depart}` : null);
    let present = false;
    if (id) { try { present = !!(await env.DB.prepare('SELECT 1 FROM sailings WHERE id = ?').bind(id).first()); } catch (_) {} }
    if (present) inDb++;
    if (sample.length < 12) sample.push({ id, ship: c.ship_name, embark: c.embark_port, date: depart, in_db: present });
  }
  return { ok: res.ok, status: res.status, query: Object.fromEntries(p), cf_total: data.total != null ? data.total : null, cf_returned: items.length, in_our_db: inDb, sample };
}

// Preferred entry point: try the fast CSV import; fall back to offset paging if
// the CSV endpoint is unavailable or returns short (but NOT on a key/upstream
// failure, where paging would fail identically).
export async function runImportStep(env, opts = {}) {
  const csv = await importCatalogCSVStep(env, opts);
  if (csv.ok || csv.reason === 'not_configured' || csv.reason === 'fetch_failed') return csv;
  if (csv.reason === 'csv_failed') {
    const fb = await importCatalogStep(env, { maxPages: opts.maxPages || 8 });
    return { ...fb, csv_fallback: true, csv_reason: csv.detail || csv.status || 'csv_failed' };
  }
  return csv;
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
  try { head = await fetchPage(env, 0, 1); } catch (e) { return { ok: false, reason: 'fetch_failed', status: e.status || null, detail: e.detail || String((e && e.message) || e) }; }
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
    await stateSet(env, 'csv_offset', '0');   // keep the CSV cursor in sync too
    await stateSet(env, 'cycle_done', '0');
    await stateSet(env, 'row_count', '0');
  }

  let offset = Number(await stateGet(env, 'offset')) || 0;
  let imported = Number(await stateGet(env, 'row_count')) || 0;
  let pages = 0, done = false, remaining = head.remaining;

  let stepError = null;
  while (pages < maxPages) {
    let page;
    // Fetch + write one page. On any failure, stop cleanly with progress saved
    // (the cursor was persisted after the previous page) instead of throwing.
    try {
      page = await fetchPage(env, offset, limit);
      if (page.remaining != null) remaining = page.remaining;
      if (!page.items.length) { done = true; break; }
      await upsertBatch(env, page.items);
    } catch (e) { stepError = String((e && e.message) || e); break; }
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
  const keys = ['imported_as_of', 'offset', 'row_count', 'cycle_done', 'last_run', 'last_full_import', 'last_remaining',
    'incremental_since', 'last_incremental_run', 'incremental_rows_last', 'incremental_overflow'];
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

// Dropdown facets derived from the local catalog, so the values the dropdowns
// send always match what is stored (exact filter matches). Upcoming only.
// Returns null if the catalog is not ready.
export async function dbFacets(env) {
  if (!(await catalogReady(env))) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const pick = async (col) => {
      const res = await env.DB.prepare(
        `SELECT DISTINCT ${col} AS v FROM sailings WHERE ${col} IS NOT NULL AND ${col} != '' AND depart_date >= ? ORDER BY ${col}`
      ).bind(today).all();
      return (res.results || []).map((r) => r.v).filter(Boolean);
    };
    const [lines, rawDests, ports] = await Promise.all([pick('cruise_line'), pick('destination'), pick('departure_port')]);
    // Consolidate the ~240 raw destination strings into the curated top-level
    // regions, keeping only those actually present in the catalog.
    const rawLower = rawDests.map((d) => String(d).toLowerCase());
    const destinations = DEST_REGIONS
      .filter((r) => r.kw.some((k) => rawLower.some((d) => d.includes(k))))
      .map((r) => r.name);
    return { lines, destinations, ports };
  } catch (_) { return null; }
}

// Distinct cruise lines in the catalog (upcoming only), so an advisor can follow
// a line even before any lead for it exists. Returns null if not ready.
export async function dbCruiseLines(env) {
  if (!(await catalogReady(env))) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const res = await env.DB.prepare(
      "SELECT DISTINCT cruise_line AS v FROM sailings WHERE cruise_line IS NOT NULL AND cruise_line != '' AND depart_date >= ? ORDER BY cruise_line"
    ).bind(today).all();
    return (res.results || []).map((r) => r.v).filter(Boolean);
  } catch (_) { return null; }
}

// Ship names for one cruise line from the local catalog (upcoming only), so the
// ship dropdown lists only ships that actually have bookable departures.
export async function dbShipsByLine(env, line) {
  if (!(await catalogReady(env))) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    // Prefix match so a line name variant still resolves, e.g. "Margaritaville at
    // Sea" finds sailings stored under "Margaritaville at Sea Cruises". Prefix
    // (no leading wildcard) still uses the line_norm index.
    const res = await env.DB.prepare(
      "SELECT DISTINCT ship AS v FROM sailings WHERE line_norm LIKE ? AND ship IS NOT NULL AND ship != '' AND depart_date >= ? ORDER BY ship"
    ).bind(normKey(line) + '%', today).all();
    return (res.results || []).map((r) => r.v).filter(Boolean);
  } catch (_) { return null; }
}

// Search the local catalog with the same filters the browse/filter and AI
// searches use. Returns sailing objects in our internal shape, or null if the
// catalog is not ready (caller falls back to the live API). Only upcoming
// (bookable) departures are returned.
export async function dbSearchSailings(env, filters = {}, opts = {}) {
  if (!(await catalogReady(env))) return null;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const where = ['depart_date >= ?'];
    const binds = [today];
    // Prefix match so a line name variant still resolves (e.g. "Margaritaville
    // at Sea" -> "Margaritaville at Sea Cruises"); index-friendly (no leading %).
    if (filters.cruise_line) { where.push('line_norm LIKE ?'); binds.push(normKey(filters.cruise_line) + '%'); }
    // LIKE so a free-text partial ("harmony") matches the full normalized ship
    // ("harmonyoftheseas"), while an exact dropdown pick still matches. This is
    // the "harmony finds Harmony of the Seas" behavior.
    if (filters.ship_name) { where.push('ship_norm LIKE ?'); binds.push('%' + normKey(filters.ship_name) + '%'); }
    if (filters.destination) {
      // A curated region expands to its keyword set (so "Mediterranean" also
      // matches "Adriatic", "Greek Isles", etc.); anything else is a plain match.
      const kw = destKeywords(filters.destination);
      if (kw && kw.length) {
        where.push('(' + kw.map(() => 'LOWER(destination) LIKE ?').join(' OR ') + ')');
        for (const k of kw) binds.push('%' + k + '%');
      } else {
        where.push('LOWER(destination) LIKE ?'); binds.push('%' + String(filters.destination).toLowerCase() + '%');
      }
    }
    if (filters.embark_port) { where.push('LOWER(departure_port) LIKE ?'); binds.push('%' + String(filters.embark_port).toLowerCase() + '%'); }
    // Broad free-text: match ship, itinerary name, destination, departure port,
    // or cruise line, so typing "Galveston" (a port) or "Cozumel" finds sailings.
    if (filters.text) {
      const t = '%' + String(filters.text).toLowerCase() + '%';
      const tn = '%' + normKey(filters.text) + '%';
      where.push('(ship_norm LIKE ? OR LOWER(name) LIKE ? OR LOWER(destination) LIKE ? OR LOWER(departure_port) LIKE ? OR LOWER(cruise_line) LIKE ?)');
      binds.push(tn, t, t, t, t);
    }
    if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) { where.push('substr(depart_date,1,7) = ?'); binds.push(filters.month); }
    if (filters.nights_min != null) { where.push('nights >= ?'); binds.push(Number(filters.nights_min)); }
    if (filters.nights_max != null) { where.push('nights <= ?'); binds.push(Number(filters.nights_max)); }
    const limit = Math.min(opts.limit || 300, 1000);
    const q = `SELECT id, cruise_line, ship, name, depart_date, return_date, nights,
                      departure_port, disembark_port, destination, price_amount, price_currency
               FROM sailings WHERE ${where.join(' AND ')} ORDER BY depart_date ASC LIMIT ?`;
    binds.push(limit);
    const res = await env.DB.prepare(q).bind(...binds).all();
    return (res.results || []).map((r) => ({
      id: r.id, name: r.name, line: r.cruise_line, ship: r.ship, image: null,
      depart_date: r.depart_date, return_date: r.return_date, nights: r.nights,
      departure_port: r.departure_port, disembark_port: r.disembark_port, destination: r.destination,
      type: 'Ocean', itinerary: [], url: null,
      price_amount: r.price_amount != null ? Number(r.price_amount) : null, price_currency: r.price_currency || null,
    }));
  } catch (_) { return null; }
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
