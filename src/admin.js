// Admin: review and approve/decline travel-advisor applications.
// Access is limited to admins (see isAdmin in auth.js — ADMIN_EMAILS env var).

import { json, randomToken, sha256Hex, hashPassword, isValidEmail, normalizeEmail } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import { listAdvisors, setUserStatus, findUserById, findUserByEmail, createUser, listClients, deleteUser, listAllQuoteOffers, listAllRequests, listAdmins, createResetToken, listBookedOffers } from './db.js';
import { sendAdvisorApprovedEmail, emailDiagnostics, sendResetEmail, sendAdminInvite } from './email.js';

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

// GET /api/admin/requests — every client quote request with its quote status.
export async function handleListAllRequests(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const rows = await listAllRequests(env.DB, 500);
  const requests = rows.map((r) => ({
    id: r.id,
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
    created_at: r.created_at,
    offer_count: r.offer_count || 0,
    accepted_count: r.accepted_count || 0,
  }));
  return json({ requests, count: requests.length }, 200);
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
    booking_status: r.booking_status || null,
    booking_amount: r.booking_amount || null,
    booking_ref: r.booking_ref || null,
  }));
  const booked = offers.filter((o) => o.booking_status === 'booked').length;
  const accepted = offers.filter((o) => o.status === 'accepted').length;
  return json({ offers, count: offers.length, accepted, booked }, 200);
}

// GET /api/admin/admins — list admin accounts (role 'admin' or in ADMIN_EMAILS).
export async function handleListAdmins(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const emails = String(env.ADMIN_EMAILS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const rows = await listAdmins(env.DB, emails);
  const set = new Set(emails.map((e) => e.toLowerCase()));
  const admins = rows.map((r) => ({
    id: r.id,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    created_at: r.created_at,
    last_login_at: r.last_login_at || null,
    via: r.role === 'admin' ? 'role' : (set.has(String(r.email || '').toLowerCase()) ? 'ADMIN_EMAILS' : 'role'),
  }));
  return json({ admins, count: admins.length, configured_emails: emails }, 200);
}

// POST /api/admin/add-admin  { first_name, last_name, email, password }
// Create a new admin account with an admin-assigned temporary password.
export async function handleAddAdmin(request, env, ctx) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const first = String(body.first_name || '').trim().slice(0, 100);
  const last = String(body.last_name || '').trim().slice(0, 100);

  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);
  if (!isValidEmail(email)) return json({ error: 'invalid_email', message: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Temporary password must be at least 8 characters.' }, 400);

  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  const password_hash = await hashPassword(password);
  const user = await createUser(env.DB, {
    id: crypto.randomUUID(),
    email,
    password_hash,
    first_name: first,
    last_name: last,
    phone: null,
    role: 'admin',
    status: 'active',
  });

  let emailed = false;
  try {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const r = await sendAdminInvite(env, { to: email, firstName: first, tempPassword: password, loginUrl: `${base}/admin/login` });
    emailed = !!(r && r.sent);
  } catch (_) {}

  return json({ ok: true, id: user.id, email, emailed }, 201);
}

// POST /api/admin/reset-user  { id } — send a password-reset link to any user.
export async function handleResetUser(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request' }, 400);
  const target = await findUserById(env.DB, id);
  if (!target || !target.email) return json({ error: 'not_found' }, 404);

  const raw = randomToken(32);
  const tokenId = await sha256Hex(raw);
  const mins = parseInt(env.RESET_TTL_MINUTES || '60', 10);
  await createResetToken(env.DB, { id: tokenId, userId: target.id, expiresAt: Date.now() + mins * 60 * 1000 });
  const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const resetUrl = `${base}/reset-password?token=${raw}`;
  let emailed = false;
  try { const r = await sendResetEmail(env, { to: target.email, resetUrl }); emailed = !!(r && r.sent); } catch (_) {}
  return json({ ok: true, emailed, email: target.email }, 200);
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

// GET /api/admin/concierge-stats — Neptune (AI concierge) usage for the dashboard.
export async function handleConciergeStats(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const now = Date.now();
  const dayAgo = now - 86400000;
  const weekAgo = now - 7 * 86400000;
  const db = env.DB;
  const one = async (sql, ...b) => { try { return await db.prepare(sql).bind(...b).first(); } catch { return null; } };
  const many = async (sql, ...b) => { try { return (await db.prepare(sql).bind(...b).all()).results || []; } catch { return []; } };

  const total = (await one('SELECT COUNT(*) c FROM concierge_log'))?.c || 0;
  const today = (await one('SELECT COUNT(*) c FROM concierge_log WHERE created_at >= ?', dayAgo))?.c || 0;
  const week = (await one('SELECT COUNT(*) c FROM concierge_log WHERE created_at >= ?', weekAgo))?.c || 0;
  const cachedWeek = (await one('SELECT COUNT(*) c FROM concierge_log WHERE cached = 1 AND created_at >= ?', weekAgo))?.c || 0;
  const skippedWeek = (await one('SELECT COUNT(*) c FROM concierge_log WHERE ai_skipped = 1 AND created_at >= ?', weekAgo))?.c || 0;
  const resultsWeek = (await one('SELECT COALESCE(SUM(result_count),0) s FROM concierge_log WHERE created_at >= ?', weekAgo))?.s || 0;
  const aiCallsWeek = Math.max(0, week - cachedWeek - skippedWeek);
  const daily = await many("SELECT strftime('%Y-%m-%d', created_at/1000, 'unixepoch') d, COUNT(*) c FROM concierge_log WHERE created_at >= ? GROUP BY d ORDER BY d", weekAgo);
  const topQueries = await many("SELECT q, COUNT(*) c FROM concierge_log WHERE created_at >= ? AND q IS NOT NULL AND q != '' GROUP BY q ORDER BY c DESC LIMIT 12", weekAgo);

  return json({ total, today, week, cachedWeek, skippedWeek, aiCallsWeek, resultsWeek, daily, topQueries }, 200);
}

// GET /api/admin/bookings — every reported booking with commission detail.
export async function handleListBookings(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const rows = await listBookedOffers(env.DB, 1000);
  const num = (v) => (v != null ? Number(v) : null);
  const bookings = rows.map((r) => {
    let prof = r.advisor_profile_json;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = null; } }
    prof = prof || {};
    return {
      id: r.id,
      booked_at: r.booking_at || r.created_at || null,
      advisor_name: r.advisor_name || null,
      advisor_email: r.advisor_email || null,
      agency: prof.agency || null,
      cruise_line: r.cruise_line || null,
      ship: r.ship || null,
      sailing: r.sailing_name || null,
      sailing_dates: r.sailing_dates || null,
      passengers: r.booking_passengers || null,
      booking_ref: r.booking_ref || null,
      invoice: r.booking_invoice || null,
      fare_type: r.booking_fare_type || null,
      cruise_fare: num(r.booking_cruise_fare),
      addons_high: num(r.booking_addons_high),
      addons_low: num(r.booking_addons_low),
      total: num(r.booking_amount),
    };
  });
  const sum = (k) => bookings.reduce((a, b) => a + (b[k] || 0), 0);
  const totals = {
    cruise_fare: sum('cruise_fare'),
    addons_high: sum('addons_high'),
    addons_low: sum('addons_low'),
    total: sum('total'),
  };
  return json({ bookings, count: bookings.length, totals }, 200);
}
