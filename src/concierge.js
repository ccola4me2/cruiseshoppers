// AI cruise concierge (spike): turn a shopper's sentence into structured search
// filters using Workers AI (env.AI, runs in-Worker, no external key), then match
// against our existing Widgety catalog. The model only extracts intent; the
// catalog does the matching, so cost per call is tiny.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import { searchCruiseFeed, CF_LINES, CF_REGIONS } from './cruisefeed.js';
import { dbSearchSailings } from './catalog.js';

// Small, fast, current model, much cheaper per call than 70b, and reliable for
// this short JSON extraction now that parsing is robust. Overridable via the
// CONCIERGE_MODEL var (e.g. bump to a larger model without a deploy).
const DEFAULT_MODEL = '@cf/meta/llama-3.1-8b-instruct-fast';

function systemPrompt(today) {
  return `Today's date is ${today}. You extract cruise-search filters from a shopper's message and reply with ONLY a JSON object (no prose, no code fences).
Resolve dates to "YYYY-MM" relative to today, ALWAYS in the future: if a month or date (e.g. "February", "2/15") has already passed this year, use next year. "next month", "this summer", "next spring" are relative to today.
Fields (all optional, omit any you cannot infer):
- ship: the specific ship name if the shopper names one (e.g. "Harmony of the Seas", "Icon of the Seas", "Wonder of the Seas", "Mardi Gras", "Norwegian Bliss", "Symphony", "Allure"). Extract it even if only part of the name is given (e.g. "Harmony" -> "Harmony of the Seas" if you are confident, otherwise keep what they typed). When a ship is named, that is the most important field.
- destination: a region such as Caribbean, Bahamas, Mediterranean, Alaska, Europe, Mexico, Hawaii, "Canada/New England", "Northern Europe", "Panama Canal", Asia, Australia, "South America"
- month: "YYYY-MM"
- nights_min, nights_max: integers. Interpret "weekend"=2-3, "long weekend"=3-4, "a week"=6-8, "about 10 nights"=9-11, "two weeks"=13-15
- cruise_line: the line if named (Carnival, Royal Caribbean, Norwegian, MSC, Princess, Holland America, Celebrity, Disney, Virgin Voyages, Costa, etc.). Do NOT guess a line just from a ship name, only include it if the shopper names the line.
- type: "Ocean", "River", or "Tour"
- budget_pp: integer US dollars per person if a budget is mentioned
Reply with {} only if truly nothing is clear.`;
}

// Two-shot examples to lock the output format (one with a ship, one without).
const EXAMPLE_USER = 'a relaxing week-long Alaska cruise on Princess';
const EXAMPLE_ASSISTANT = '{"destination":"Alaska","nights_min":6,"nights_max":8,"cruise_line":"Princess"}';
const EXAMPLE2_USER = 'Harmony of the Seas in March';
const EXAMPLE2_ASSISTANT = '{"ship":"Harmony of the Seas","month":"2027-03"}';

export async function handleConcierge(request, env, ctx) {
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, { Allow: 'POST' });

  // Gate to logged-in users so the AI endpoint can't be hammered anonymously.
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized', message: 'Please log in to use the concierge.' }, 401);

  if (!env.AI) {
    return json({ error: 'ai_unavailable', message: 'Workers AI is not enabled on this account yet.' }, 503);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const q = String(body.q || '').trim().slice(0, 500);
  if (!q) return json({ error: 'missing_query', message: 'Tell us what kind of cruise you want.' }, 400);

  // Rate limit per user (bounds AI + CruiseFeed usage). Opens if the table isn't
  // applied yet so it never hard-blocks search.
  const rl = await checkRate(env, user.id);
  if (!rl.ok) {
    const mins = Math.max(1, Math.ceil(rl.retryMs / 60000));
    return json({ error: 'rate_limited', message: `You've reached the search limit for now. Please try again in about ${mins} minute${mins === 1 ? '' : 's'}, or use the filters below.` }, 429);
  }

  // 1) Extract filters via Workers AI, cached by normalized query + date so
  // identical searches skip the model entirely.
  let filters = {};
  let aiError = null;
  let raw = '';
  let cached = false;
  const model = env.CONCIERGE_MODEL || DEFAULT_MODEL;
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

  // Cost saver: trivial queries ("carnival", "bahamas") don't need the model, 
  // route them straight to a line/region filter and skip AI entirely.
  const trivial = trivialFilters(q);
  const cachedFilters = trivial ? null : await getCachedFilters(q, today);
  if (trivial) {
    filters = trivial;
  } else if (cachedFilters) {
    filters = cachedFilters;
    cached = true;
  } else {
    try {
      const out = await env.AI.run(model, {
        messages: [
          { role: 'system', content: systemPrompt(today) },
          { role: 'user', content: EXAMPLE_USER },
          { role: 'assistant', content: EXAMPLE_ASSISTANT },
          { role: 'user', content: EXAMPLE2_USER },
          { role: 'assistant', content: EXAMPLE2_ASSISTANT },
          { role: 'user', content: q },
        ],
        max_tokens: 300,
        temperature: 0,
      });
      raw = safeStringify(out); // full response, for debugging
      let r = out && (out.response != null ? out.response : out.result);
      // Workers AI may return the answer as a string OR as an already-parsed object.
      if (typeof r === 'string') filters = extractJson(r) || {};
      else if (r && typeof r === 'object') filters = normalizeFilters(r);
      // Cache only successful, non-empty extractions.
      if (Object.keys(filters).length) putCachedFilters(ctx, q, today, filters);
    } catch (err) {
      aiError = String((err && err.message) || err);
    }
  }
  // Safety net: never search a past month (the catalog excludes past sailings).
  if (filters.month) filters.month = futureMonth(filters.month, today);

  // 2) Match against the catalog. Prefer CruiseFeed (61 lines, server-side
  // filtering); fall back to the Widgety catalog if it isn't configured/errors.
  let matches = [];
  let matchError = null;
  try {
    // Prefer our local catalog (complete + instant); fall back to the live API.
    const local = await dbSearchSailings(env, filters, { limit: 60 });
    matches = local != null ? local.slice(0, 12) : await searchCruiseFeed(env, filters, { limit: 10 });
  } catch (err) {
    matchError = `cruisefeed: ${String((err && err.status) || (err && err.message) || err)}`;
  }

  // Usage log for the admin dashboard (best-effort).
  logConcierge(env, ctx, { userId: user.id, q, cached, aiSkipped: !!trivial, resultCount: matches.length });

  // Internal diagnostics (raw model output, upstream error strings, model name)
  // are only returned when CONCIERGE_DEBUG is enabled, never to normal clients.
  const payload = { query: q, filters, cached, ai_skipped: !!trivial, source: 'cruisefeed', count: matches.length, matches };
  if (env.CONCIERGE_DEBUG) {
    Object.assign(payload, { ai_error: aiError, ai_raw: raw, match_error: matchError, model });
  }
  return json(payload, 200);
}

// Pull the first {...} block out of the model's text and parse it.
function extractJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return normalizeFilters(JSON.parse(m[0])); } catch { return null; }
}

function safeStringify(v) {
  try { return JSON.stringify(v); } catch { return String(v); }
}

// Best-effort usage log (for the admin Neptune dashboard). Never throws.
function logConcierge(env, ctx, r) {
  try {
    const p = env.DB
      .prepare('INSERT INTO concierge_log (id, user_id, created_at, q, cached, ai_skipped, result_count) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), r.userId || null, Date.now(), String(r.q || '').slice(0, 120), r.cached ? 1 : 0, r.aiSkipped ? 1 : 0, r.resultCount || 0)
      .run();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p.catch(() => {}));
  } catch (_) {}
}

// Cheap pre-filter: if the whole query is essentially just a cruise line or a
// region ("carnival", "the bahamas"), return filters directly so we can skip the
// model. Returns null for anything richer (dates, nights, phrases) -> use AI.
const TRIVIAL_FILLER = /\b(a|an|the|to|for|in|on|cruise|cruises|cruising|trip|vacation|please|find|me|get|go|going|want|looking|show)\b/g;
function trivialFilters(q) {
  const ql = String(q).toLowerCase().replace(TRIVIAL_FILLER, ' ').replace(/[^a-z0-9&/ ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!ql || ql.length > 24) return null; // longer -> likely natural language
  const region = CF_REGIONS.find((r) => r.toLowerCase() === ql);
  if (region) return { destination: region };
  if (ql.length >= 4) {
    const line = CF_LINES.find((l) => l.toLowerCase() === ql || l.toLowerCase().includes(ql));
    if (line) return { cruise_line: line };
  }
  return null;
}

// --- Rate limiting (fixed hourly window per user, D1-backed) ---
const RATE_LIMIT = 40;      // searches per user per window
const RATE_WINDOW = 3600000; // 1 hour

async function checkRate(env, userId) {
  const now = Date.now();
  try {
    const row = await env.DB.prepare('SELECT count, reset_at FROM ai_rate WHERE user_id = ?').bind(userId).first();
    let count = 0, resetAt = now + RATE_WINDOW;
    if (row && now < row.reset_at) { count = row.count; resetAt = row.reset_at; }
    if (count >= RATE_LIMIT) return { ok: false, retryMs: resetAt - now };
    await env.DB
      .prepare('INSERT INTO ai_rate (user_id, count, reset_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET count = ?, reset_at = ?')
      .bind(userId, count + 1, resetAt, count + 1, resetAt)
      .run();
    return { ok: true };
  } catch (_) {
    return { ok: true }; // table not applied yet, don't block search
  }
}

// --- Caching the AI extraction (Cloudflare Cache API, keyed by date + query) ---
function cacheReq(q, today) {
  const norm = String(q).toLowerCase().replace(/\s+/g, ' ').trim();
  return new Request(`https://cache.internal/concierge/${today}/${encodeURIComponent(norm)}`);
}
async function getCachedFilters(q, today) {
  try {
    const hit = await caches.default.match(cacheReq(q, today));
    if (hit) return await hit.json();
  } catch (_) {}
  return null;
}
function putCachedFilters(ctx, q, today, filters) {
  try {
    const res = new Response(JSON.stringify(filters), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' },
    });
    const p = caches.default.put(cacheReq(q, today), res);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
  } catch (_) {}
}

// Roll a "YYYY-MM" forward by whole years until it is the current month or later,
// so an unqualified month like "February" never resolves into the past.
function futureMonth(m, today) {
  if (!/^\d{4}-\d{2}$/.test(m)) return m;
  const cur = String(today).slice(0, 7);
  if (m >= cur) return m;
  let [y, mo] = m.split('-').map(Number);
  while (`${y}-${String(mo).padStart(2, '0')}` < cur) y += 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

// Keep only the filter fields we understand, unwrapping common envelopes.
function normalizeFilters(o) {
  if (!o || typeof o !== 'object') return {};
  if (o.response && typeof o.response === 'object') o = o.response;
  if (o.filters && typeof o.filters === 'object') o = o.filters;
  const keys = ['destination', 'month', 'nights_min', 'nights_max', 'cruise_line',
    'type', 'budget_pp', 'party', 'embark_port', 'departure_from', 'departure_to'];
  const out = {};
  for (const k of keys) if (o[k] != null && o[k] !== '') out[k] = o[k];
  // Map the model's `ship` to the search's ship_name filter. When a specific
  // ship is named it's the strongest intent, so don't also constrain by a
  // (possibly guessed) cruise line, the ship already identifies the line.
  const ship = o.ship || o.ship_name || o.vessel;
  if (typeof ship === 'string' && ship.trim()) {
    out.ship_name = ship.trim().slice(0, 80);
    delete out.cruise_line;
  }
  return out;
}

