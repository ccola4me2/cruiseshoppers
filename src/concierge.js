// AI cruise concierge (spike): turn a shopper's sentence into structured search
// filters using Workers AI (env.AI — runs in-Worker, no external key), then match
// against our existing Widgety catalog. The model only extracts intent; the
// catalog does the matching, so cost per call is tiny.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import { getCatalogForEnv } from './widgety.js';
import { searchCruiseFeed } from './cruisefeed.js';

// A capable, current model — small models returned empty/garbled JSON. Overridable
// via the CONCIERGE_MODEL var so we can swap or downsize without a deploy.
const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

function systemPrompt(today) {
  return `Today's date is ${today}. You extract cruise-search filters from a shopper's message and reply with ONLY a JSON object (no prose, no code fences).
Resolve dates to "YYYY-MM" relative to today, ALWAYS in the future: if a month or date (e.g. "February", "2/15") has already passed this year, use next year. "next month", "this summer", "next spring" are relative to today.
Fields (all optional — omit any you cannot infer):
- destination: a region such as Caribbean, Bahamas, Mediterranean, Alaska, Europe, Mexico, Hawaii, "Canada/New England", "Northern Europe", "Panama Canal", Asia, Australia, "South America"
- month: "YYYY-MM"
- nights_min, nights_max: integers. Interpret "weekend"=2-3, "long weekend"=3-4, "a week"=6-8, "about 10 nights"=9-11, "two weeks"=13-15
- cruise_line: the line if named (Carnival, Royal Caribbean, Norwegian, MSC, Princess, Holland America, Celebrity, Disney, Virgin Voyages, Costa, etc.)
- type: "Ocean", "River", or "Tour"
- budget_pp: integer US dollars per person if a budget is mentioned
Reply with {} only if truly nothing is clear.`;
}

// One-shot example to lock the output format.
const EXAMPLE_USER = 'a relaxing week-long Alaska cruise on Princess';
const EXAMPLE_ASSISTANT = '{"destination":"Alaska","nights_min":6,"nights_max":8,"cruise_line":"Princess"}';

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

  // 1) Extract filters via Workers AI.
  let filters = {};
  let aiError = null;
  let raw = '';
  const model = env.CONCIERGE_MODEL || DEFAULT_MODEL;
  const now = new Date();
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
  try {
    const out = await env.AI.run(model, {
      messages: [
        { role: 'system', content: systemPrompt(today) },
        { role: 'user', content: EXAMPLE_USER },
        { role: 'assistant', content: EXAMPLE_ASSISTANT },
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
  } catch (err) {
    aiError = String((err && err.message) || err);
  }
  // Safety net: never search a past month (the catalog excludes past sailings).
  if (filters.month) filters.month = futureMonth(filters.month, today);

  // 2) Match against the catalog. Prefer CruiseFeed (61 lines, server-side
  // filtering); fall back to the Widgety catalog if it isn't configured/errors.
  let matches = [];
  let source = null;
  let matchError = null;
  if (env.CRUISEFEED_KEY) {
    try {
      matches = await searchCruiseFeed(env, filters, { limit: 12 });
      source = 'cruisefeed';
    } catch (err) {
      matchError = `cruisefeed: ${String((err && err.status) || (err && err.message) || err)}`;
    }
  }
  if (source == null) {
    try {
      const sailings = await getCatalogForEnv(env);
      matches = filterSailings(sailings, filters).slice(0, 12);
      source = 'widgety';
    } catch (err) {
      return json({ query: q, filters, ai_error: aiError, match_error: matchError,
        source: null, count: 0, matches: [], message: 'Cruise catalog is unavailable right now.' }, 200);
    }
  }

  return json({ query: q, filters, ai_error: aiError, ai_raw: raw, match_error: matchError,
    model, source, count: matches.length, matches }, 200);
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
  return out;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function filterSailings(sailings, f) {
  f = f || {};
  const dest = String(f.destination || '').toLowerCase().trim();
  const line = String(f.cruise_line || '').toLowerCase().trim();
  const type = String(f.type || '').toLowerCase().trim();
  const month = /^\d{4}-\d{2}$/.test(f.month || '') ? f.month : null;
  const nmin = num(f.nights_min);
  const nmax = num(f.nights_max);
  return sailings
    .filter((s) => {
      if (dest) {
        const hay = `${s.destination || ''} ${s.name || ''}`.toLowerCase();
        if (!hay.includes(dest)) return false;
      }
      if (line && !String(s.line || '').toLowerCase().includes(line)) return false;
      if (type && !String(s.type || '').toLowerCase().includes(type)) return false;
      if (month && !String(s.depart_date || '').startsWith(month)) return false;
      if (nmin != null && (s.nights == null || s.nights < nmin)) return false;
      if (nmax != null && (s.nights == null || s.nights > nmax)) return false;
      return true;
    })
    .sort((a, b) => String(a.depart_date || '9999').localeCompare(String(b.depart_date || '9999')));
}
