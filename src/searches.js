// Saved searches: a logged-in client saves their search filters and can opt in
// to email alerts when a new matching special is posted.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import { createSavedSearch, listSavedSearches, deleteSavedSearch } from './db.js';

// GET /api/searches, the client's saved searches.
export async function handleListSearches(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rows = await listSavedSearches(env.DB, user.id);
  const searches = rows.map((s) => {
    let criteria = {};
    try { criteria = s.criteria ? JSON.parse(s.criteria) : {}; } catch { criteria = {}; }
    return { id: s.id, name: s.name, criteria, alerts: !!s.alerts, created_at: s.created_at };
  });
  return json({ searches, count: searches.length }, 200);
}

// POST /api/searches  { name, criteria, alerts }, save a search.
export async function handleCreateSearch(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const criteria = body.criteria && typeof body.criteria === 'object' ? body.criteria : {};
  const clip = (v, n = 120) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const cruiseLine = clip(body.cruise_line, 120) || clip(criteria.line, 120);
  const name = clip(body.name, 120) || autoName(criteria);

  let special;
  try {
    special = await createSavedSearch(env.DB, {
      id: crypto.randomUUID(),
      user_id: user.id,
      name,
      criteria: JSON.stringify(criteria).slice(0, 4000),
      cruise_line: cruiseLine,
      alerts: !!body.alerts,
    });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Saved searches are not set up yet. The database migration (0014) still needs to be applied.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not save your search. Please try again.' }, 500);
  }
  return json({ ok: true, id: special.id, name }, 201);
}

// POST /api/searches/delete  { id }
export async function handleDeleteSearch(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request' }, 400);
  await deleteSavedSearch(env.DB, id, user.id);
  return json({ ok: true }, 200);
}

function autoName(c) {
  const parts = [c.destination, c.line, c.type, c.length ? `${c.length} nights` : '', c.port].filter(Boolean);
  return parts.slice(0, 3).join(' · ') || 'My search';
}
