// AI cruise concierge (spike): turn a shopper's sentence into structured search
// filters using Workers AI (env.AI — runs in-Worker, no external key), then match
// against our existing Widgety catalog. The model only extracts intent; the
// catalog does the matching, so cost per call is tiny.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import { getCatalogForEnv } from './widgety.js';
import { searchCruiseFeed } from './cruisefeed.js';

// Small, cheap instruction-tuned model. Change here if we tune later.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const SYSTEM = `You extract cruise-search filters from a shopper's message.
Respond with ONLY a JSON object and nothing else. All fields are optional; omit any you cannot infer.
Fields:
- destination: a region like Caribbean, Bahamas, Mediterranean, Alaska, Europe, Mexico, Hawaii, "Canada/New England", "Northern Europe", Transatlantic, "Panama Canal", Asia, Australia, "South America"
- month: "YYYY-MM" when a month/year is implied
- nights_min: integer
- nights_max: integer
- cruise_line: a cruise line name if named
- type: "Ocean", "River", or "Tour"
- budget_pp: integer US dollars per person if a budget is mentioned
- party: short description of who is traveling
Return {} if nothing is clear.`;

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
  try {
    const out = await env.AI.run(MODEL, {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: q },
      ],
      max_tokens: 300,
      temperature: 0,
    });
    raw = (out && (out.response || out.result || '')) || '';
    filters = extractJson(raw) || {};
  } catch (err) {
    aiError = String((err && err.message) || err);
  }

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
    source, count: matches.length, matches }, 200);
}

// Pull the first {...} block out of the model's text and parse it.
function extractJson(text) {
  if (!text) return null;
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
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
