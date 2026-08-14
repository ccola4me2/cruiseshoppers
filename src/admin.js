// Admin: review and approve/decline travel-advisor applications.
// Access is limited to admins (see isAdmin in auth.js — ADMIN_EMAILS env var).

import { json } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import { listAdvisors, setUserStatus, findUserById } from './db.js';

const ALLOWED_STATUS = new Set(['active', 'pending', 'declined']);

async function requireAdmin(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return { error: json({ error: 'unauthorized' }, 401) };
  if (!isAdmin(user, env)) return { error: json({ error: 'forbidden' }, 403) };
  return { user };
}

// GET /api/admin/advisors — list every advisor with their application details.
export async function handleListAdvisors(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const rows = await listAdvisors(env.DB, 500);
  const advisors = rows.map((r) => {
    let profile = {};
    try { if (r.advisor_profile) profile = JSON.parse(r.advisor_profile) || {}; } catch {}
    return {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
      status: r.status || 'active',
      created_at: r.created_at,
      agency: profile.agency || null,
      website: profile.website || null,
      location: profile.location || null,
      credential_type: profile.credential_type || null,
      credential: profile.credential || null,
      experience: profile.experience || null,
      source: profile.source || null,
    };
  });
  return json({ advisors, count: advisors.length }, 200);
}

// POST /api/admin/advisor-status  { id, status }
export async function handleSetAdvisorStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  if (!id || !ALLOWED_STATUS.has(status)) return json({ error: 'invalid_request' }, 400);

  const target = await findUserById(env.DB, id);
  if (!target || target.role !== 'advisor') return json({ error: 'not_found' }, 404);

  await setUserStatus(env.DB, id, status);
  return json({ ok: true, id, status }, 200);
}
