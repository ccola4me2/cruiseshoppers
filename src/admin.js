// Admin: review and approve/decline travel-advisor applications.
// Access is limited to admins (see isAdmin in auth.js — ADMIN_EMAILS env var).

import { json } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import { listAdvisors, setUserStatus, findUserById, listClients, deleteUser, listAllQuoteOffers } from './db.js';
import { sendAdvisorApprovedEmail, emailDiagnostics } from './email.js';

const ALLOWED_STATUS = new Set(['active', 'pending', 'declined', 'suspended']);

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
      terms_version: profile.terms_version || null,
      terms_accepted_at: profile.terms_accepted_at || null,
    };
  });
  return json({ advisors, count: advisors.length }, 200);
}

// GET /api/admin/offers — every advisor quote across all advisors.
export async function handleListAllOffers(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const rows = await listAllQuoteOffers(env.DB, 500);
  const offers = rows.map((r) => ({
    id: r.id,
    quote_request_id: r.quote_request_id,
    advisor_name: r.advisor_name,
    advisor_email: r.advisor_email,
    price: r.price,
    specials: r.specials,
    additional_info: r.additional_info,
    status: r.status,
    created_at: r.created_at,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    client_first: r.client_first,
    client_last: r.client_last,
    client_email: r.client_email,
  }));
  return json({ offers, count: offers.length }, 200);
}

// GET /api/admin/clients — list client accounts with login + quote activity.
export async function handleListClients(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const rows = await listClients(env.DB, 1000);
  // Don't list admin accounts (their DB role is 'client' but they're operators).
  const clients = rows
    .filter((r) => !isAdmin({ email: r.email, role: r.role }, env))
    .map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    status: r.status || 'active',
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

// POST /api/admin/user-status  { id, status }   (also served at /advisor-status)
// Set the status of any client or advisor. Admins cannot be modified.
export async function handleSetUserStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const id = String(body.id || '').trim();
  const status = String(body.status || '').trim().toLowerCase();
  if (!id || !ALLOWED_STATUS.has(status)) return json({ error: 'invalid_request' }, 400);

  const target = await findUserById(env.DB, id);
  if (!target) return json({ error: 'not_found' }, 404);
  if (isAdmin({ email: target.email, role: target.role }, env)) {
    return json({ error: 'forbidden', message: 'Admin accounts cannot be modified here.' }, 403);
  }

  const wasApproved = target.status === 'active';
  await setUserStatus(env.DB, id, status);

  // Notify an advisor when they are newly approved (best-effort; never blocks
  // the change if email is unconfigured or the send fails).
  let emailed = false;
  if (target.role === 'advisor' && status === 'active' && !wasApproved && target.email) {
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

// POST /api/admin/user-delete  { id }
// Permanently delete a client or advisor. Admins cannot be deleted.
export async function handleDeleteUser(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request' }, 400);

  const target = await findUserById(env.DB, id);
  if (!target) return json({ error: 'not_found' }, 404);
  if (isAdmin({ email: target.email, role: target.role }, env)) {
    return json({ error: 'forbidden', message: 'Admin accounts cannot be deleted here.' }, 403);
  }

  try {
    await deleteUser(env.DB, id);
  } catch (err) {
    return json({ error: 'delete_failed', message: 'Could not delete this account: ' + (err && err.message ? err.message : 'unknown error') }, 500);
  }
  return json({ ok: true, id, deleted: true }, 200);
}
