// Admin: review and approve/decline travel-advisor applications.
// Access is limited to admins (see isAdmin in auth.js — ADMIN_EMAILS env var).

import { json } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import { listAdvisors, setUserStatus, findUserById, listClients } from './db.js';
import { sendAdvisorApprovedEmail, emailDiagnostics } from './email.js';

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

// GET /api/admin/clients — list client accounts with login + quote activity.
export async function handleListClients(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const rows = await listClients(env.DB, 1000);
  const clients = rows.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    created_at: r.created_at,
    last_login_at: r.last_login_at || null,
    quote_count: r.quote_count || 0,
  }));
  return json({ clients, count: clients.length }, 200);
}

// GET /api/admin/email-test[?send=1] : show email config and optionally send.
export async function handleEmailTest(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const url = new URL(request.url);
  const doSend = url.searchParams.get('send') === '1';
  const diag = await emailDiagnostics(env, { doSend });
  return json(diag, 200);
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

  const wasApproved = target.status === 'active';
  await setUserStatus(env.DB, id, status);

  // Notify the advisor when they are newly approved (best-effort; never blocks
  // the approval if email is unconfigured or the send fails).
  let emailed = false;
  if (status === 'active' && !wasApproved && target.email) {
    try {
      const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
      const r = await sendAdvisorApprovedEmail(env, {
        to: target.email,
        firstName: target.first_name,
        loginUrl: `${base}/advisor/login`,
      });
      emailed = !!(r && r.sent);
    } catch (_) {}
  }

  return json({ ok: true, id, status, emailed }, 200);
}
