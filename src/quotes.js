// Quote requests (leads): clients create them, advisors list them.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import { createQuoteRequest, listQuoteRequests } from './db.js';

// POST /api/quotes  (authenticated client) — save a quote request.
// Body: the selected sailing fields + optional note. Contact info is taken
// from the logged-in user's account (not trusted from the client).
export async function handleCreateQuote(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const s = body.sailing || {};
  const clip = (v, n = 400) => (v == null ? null : String(v).slice(0, n));

  let itinerary = null;
  try {
    if (Array.isArray(s.itinerary)) itinerary = JSON.stringify(s.itinerary).slice(0, 6000);
  } catch {}

  const q = await createQuoteRequest(env.DB, {
    id: crypto.randomUUID(),
    user_id: user.id,
    first_name: user.first_name,
    last_name: user.last_name,
    email: user.email,
    phone: user.phone,
    sailing_name: clip(s.name),
    cruise_line: clip(s.line),
    ship: clip(s.ship),
    sailing_dates: clip(s.sailing_dates || s.depart_date),
    departure_port: clip(s.departure_port),
    destination: clip(s.destination),
    itinerary,
    notes: clip(body.notes, 1000),
  });

  return json({ ok: true, id: q.id }, 201);
}

// GET /api/quotes  (authenticated advisor) — list all leads.
export async function handleListQuotes(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);

  const rows = await listQuoteRequests(env.DB, 200);
  const leads = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    notes: r.notes,
    itinerary: safeParse(r.itinerary),
    status: r.status,
  }));
  return json({ leads, count: leads.length }, 200);
}

function safeParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
