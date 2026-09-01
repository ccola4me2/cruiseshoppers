// Admin: review and approve/decline travel-advisor applications.
// Access is limited to admins (see isAdmin in auth.js, ADMIN_EMAILS env var).

import { json, randomToken, sha256Hex, hashPassword, isValidEmail, normalizeEmail } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import { listAdvisors, setUserStatus, findUserById, findUserByEmail, createUser, listClients, deleteUser, listAllQuoteOffers, listAllRequests, listAdmins, createResetToken, listBookedOffers, listAcceptedOffers, createAgency, setUserAgency, findAgencyById, setAgencyUsersStatus, setOfferArchived, deleteOffer, setRequestArchived, deleteQuoteRequest, listAllSpecials, setSpecialArchived, adminDeleteSpecial, setSpecialAdvisor, setSpecialsPlan, updateAdvisorProfile, setUserEmail } from './db.js';
import { sendAdvisorApprovedEmail, emailDiagnostics, sendResetEmail, sendAdminInvite, sendSeatInvite } from './email.js';

const ALLOWED_STATUS = new Set(['active', 'pending', 'declined', 'suspended']);

async function requireAdmin(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return { error: json({ error: 'unauthorized' }, 401) };
  if (!isAdmin(user, env)) return { error: json({ error: 'forbidden' }, 403) };
  return { user };
}

// GET /api/admin/advisors, list every advisor with their application details.
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
      specials_plan: r.specials_plan || 'off',
      created_at: r.created_at,
      agency_id: r.agency_id || null,
      agency_role: r.agency_role || null,
      agency: profile.agency || null,
      website: profile.website || null,
      location: profile.location || null,
      hours: profile.hours || null,
      bio: profile.bio || null,
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

// POST /api/admin/advisor-update - edit an advisor's profile (name, contact,
// agency, credential, bio) and optionally their login email.
export async function handleAdminUpdateAdvisor(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing advisor id.' }, 400);

  const target = await findUserById(env.DB, id);
  if (!target || target.role !== 'advisor') return json({ error: 'not_found', message: 'Advisor not found.' }, 404);

  const s = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);
  const first = s(body.first_name, 100);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);

  // Merge the editable profile fields, preserving credential/terms metadata.
  let prof = target.advisor_profile;
  if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = {}; } }
  prof = prof || {};
  prof.agency = s(body.agency, 160);
  prof.website = s(body.website);
  prof.location = s(body.location, 120);
  prof.hours = s(body.hours, 300);
  prof.bio = String(body.bio || '').trim().slice(0, 800);
  if (body.credential_type != null) prof.credential_type = s(body.credential_type, 10).toUpperCase();
  if (body.credential != null) prof.credential = String(body.credential).replace(/[^0-9]/g, '').slice(0, 12);

  // Optional email change (login identity): validate + ensure it's not taken.
  const newEmail = body.email != null ? normalizeEmail(body.email) : null;
  if (newEmail && newEmail !== target.email) {
    if (!isValidEmail(newEmail)) return json({ error: 'invalid_email', message: 'Enter a valid email address.' }, 400);
    const clash = await findUserByEmail(env.DB, newEmail);
    if (clash && clash.id !== id) return json({ error: 'email_taken', message: 'Another account already uses that email.' }, 409);
    try { await setUserEmail(env.DB, id, newEmail); } catch (_) { return json({ error: 'save_failed', message: 'Could not update the email.' }, 500); }
  }

  await updateAdvisorProfile(env.DB, id, {
    first_name: first,
    last_name: s(body.last_name, 100),
    phone: s(body.phone, 40),
    profile: prof,
  });

  // Account type: individual advisor vs. agency owner. Lets an admin fix a
  // signup that chose the wrong one.
  const type = body.account_type === 'agency' ? 'agency' : (body.account_type === 'individual' ? 'individual' : null);
  if (type) {
    const isOwner = target.agency_role === 'owner';
    if (type === 'agency' && !isOwner) {
      // Promote to an agency owner: spin up an agency record for them.
      try {
        const agencyName = prof.agency || [first, s(body.last_name, 100)].filter(Boolean).join(' ') || 'Agency';
        const agencyId = crypto.randomUUID();
        await createAgency(env.DB, {
          id: agencyId, name: agencyName, owner_user_id: id,
          phone: s(body.phone, 40), website: prof.website, location: prof.location,
        });
        await setUserAgency(env.DB, id, agencyId, 'owner');
      } catch (_) {
        return json({ error: 'save_failed', message: 'Saved the profile, but could not convert to an agency. The agencies table may be missing (migration 0011).' }, 500);
      }
    } else if (type === 'individual' && target.agency_id) {
      // Demote to an individual advisor: detach from any agency.
      await setUserAgency(env.DB, id, null, null);
    } else if (type === 'agency' && isOwner && prof.agency && target.agency_id) {
      // Already an owner: keep the agency name in sync with the edited field.
      try { await env.DB.prepare('UPDATE agencies SET name = ? WHERE id = ?').bind(prof.agency, target.agency_id).run(); } catch (_) {}
    }
  }

  return json({ ok: true, id }, 200);
}

// POST /api/admin/advisor-specials-plan - set an advisor's Specials Program plan
// ('off' | 'ten' | 'twentyfive' | 'unlimited'). This is the admin gate: 'off'
// hides the advisor's specials from clients and blocks new ones until they pay.
export async function handleSetAdvisorSpecialsPlan(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const advisorId = String(body.advisor_id || '').trim();
  const plan = ['off', 'ten', 'twentyfive', 'unlimited'].includes(body.plan) ? body.plan : 'off';
  if (!advisorId) return json({ error: 'invalid_request' }, 400);
  const target = await findUserById(env.DB, advisorId);
  if (!target || target.role !== 'advisor') return json({ error: 'not_found' }, 404);
  await setSpecialsPlan(env.DB, advisorId, plan);
  return json({ ok: true, plan }, 200);
}

// GET /api/admin/requests, every client quote request with its quote status.
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
    archived_at: r.archived_at || null,
    attribution: parseAttribution(r.attribution),
  }));
  return json({ requests, count: requests.length }, 200);
}

// POST /api/admin/purge-leads  { confirm: "DELETE" } - wipe all leads & quotes
// (requests, offers, messages, read markers, reviews, and the now-orphaned "No
// quote" dismissals). Keeps accounts, specials, and the catalog. Irreversible.
export async function handlePurgeLeads(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { body = {}; }
  if (body.confirm !== 'DELETE') {
    return json({ error: 'confirm_required', message: 'Type DELETE to confirm.' }, 400);
  }
  const tables = ['messages', 'message_reads', 'advisor_reviews', 'quote_offers', 'quote_requests', 'advisor_lead_dismissals'];
  const deleted = {};
  for (const t of tables) {
    try {
      const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${t}`).first();
      await env.DB.prepare(`DELETE FROM ${t}`).run();
      deleted[t] = c ? c.n : 0;
    } catch (_) {
      deleted[t] = null; // table may not exist in an older DB; skip it
    }
  }
  return json({ ok: true, deleted }, 200);
}

// Parse the stored attribution JSON into an object for the admin UI, or null.
function parseAttribution(raw) {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object' ? o : null;
  } catch (_) { return null; }
}

// GET /api/admin/attribution-report - aggregate leads by where they came from
// (utm_content = person, utm_source, utm_campaign, and the full link), so the
// admin can track postings and campaigns. Optional ?from=YYYY-MM-DD&to=... and
// ?format=csv. Accepted = a lead with at least one accepted quote.
export async function handleAttributionReport(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const fromMs = dateToMs(url.searchParams.get('from'), false);
  const toMs = dateToMs(url.searchParams.get('to'), true);

  const rows = await listAllRequests(env.DB, 5000);
  const inRange = rows.filter((r) => {
    const t = Number(r.created_at) || 0;
    if (fromMs && t < fromMs) return false;
    if (toMs && t > toMs) return false;
    return true;
  });

  // Roll up into named buckets. A lead with no attribution is "Direct / untagged".
  const person = new Map();
  const source = new Map();
  const campaign = new Map();
  const link = new Map();
  let tagged = 0;
  let acceptedTotal = 0;

  const bump = (map, key, label, accepted) => {
    if (!map.has(key)) map.set(key, { key, label, leads: 0, accepted: 0 });
    const e = map.get(key);
    e.leads += 1;
    if (accepted) e.accepted += 1;
  };

  for (const r of inRange) {
    const a = parseAttribution(r.attribution);
    const accepted = (r.accepted_count || 0) > 0;
    if (accepted) acceptedTotal += 1;
    if (a && (a.source || a.content || a.campaign || a.referrer)) {
      tagged += 1;
      bump(person, (a.content || '(none)').toLowerCase(), a.content || '(no name)', accepted);
      bump(source, (a.source || (a.referrer ? `ref:${a.referrer}` : '(none)')).toLowerCase(), a.source || (a.referrer ? `Referral: ${a.referrer}` : '(no source)'), accepted);
      if (a.campaign) bump(campaign, a.campaign.toLowerCase(), a.campaign, accepted);
      const lk = [a.source || '-', a.medium || '-', a.campaign || '-', a.content || '-'].join(' / ');
      bump(link, lk.toLowerCase(), lk, accepted);
    } else {
      bump(person, '(untagged)', 'Direct / untagged', accepted);
      bump(source, '(untagged)', 'Direct / untagged', accepted);
    }
  }

  const sort = (map) => [...map.values()].sort((x, y) => y.leads - x.leads);
  const report = {
    total: inRange.length,
    tagged,
    untagged: inRange.length - tagged,
    accepted_total: acceptedTotal,
    by_person: sort(person),
    by_source: sort(source),
    by_campaign: sort(campaign),
    by_link: sort(link),
  };

  if (url.searchParams.get('format') === 'csv') {
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = ['Source,Medium,Campaign,Content (person),Leads,Accepted'];
    for (const e of report.by_link) {
      const [s, m, c, ct] = e.label.split(' / ');
      lines.push([s, m, c, ct, e.leads, e.accepted].map(esc).join(','));
    }
    return new Response(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="campaign-report.csv"',
        'Cache-Control': 'no-store',
      },
    });
  }

  return json(report, 200);
}

// Parse a YYYY-MM-DD string to an epoch-ms boundary (start of day, or end of day
// when `endOfDay`). Returns null when absent/invalid.
function dateToMs(s, endOfDay) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(endOfDay ? `${s}T23:59:59.999Z` : `${s}T00:00:00.000Z`);
  return isFinite(ms) ? ms : null;
}

// POST /api/admin/request-archive  { id, archived: true|false }, soft-hide/restore a lead.
export async function handleAdminArchiveRequest(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing request id.' }, 400);
  const archived = body.archived !== false; // default: archive
  try {
    await setRequestArchived(env.DB, id, archived);
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such column|no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Archiving requests is not set up yet. Apply migration 0026 (quote_requests.archived_at) in the D1 console.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not update the request. Please try again.' }, 500);
  }
  return json({ ok: true, id, archived }, 200);
}

// POST /api/admin/request-delete  { id }, permanently delete a lead + its offers.
export async function handleAdminDeleteRequest(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing request id.' }, 400);
  try {
    await deleteQuoteRequest(env.DB, id);
  } catch (_) {
    return json({ error: 'delete_failed', message: 'Could not delete the request. Please try again.' }, 500);
  }
  return json({ ok: true, id, deleted: true }, 200);
}

// GET /api/admin/offers, every advisor quote across all advisors.
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
    archived_at: r.archived_at || null,
  }));
  const booked = offers.filter((o) => o.booking_status === 'booked').length;
  const accepted = offers.filter((o) => o.status === 'accepted').length;
  return json({ offers, count: offers.length, accepted, booked }, 200);
}

// POST /api/admin/offer-archive  { id, archived: true|false }, soft-hide/restore.
export async function handleAdminArchiveOffer(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing quote id.' }, 400);
  const archived = body.archived !== false; // default: archive
  try {
    await setOfferArchived(env.DB, id, archived);
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such column|no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Archiving is not set up yet. Apply migration 0023 (archived_at) in the D1 console.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not update the quote. Please try again.' }, 500);
  }
  return json({ ok: true, id, archived }, 200);
}

// POST /api/admin/offer-delete  { id }, permanently delete a quote offer.
export async function handleAdminDeleteOffer(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing quote id.' }, 400);
  try {
    await deleteOffer(env.DB, id);
  } catch (_) {
    return json({ error: 'delete_failed', message: 'Could not delete the quote. Please try again.' }, 500);
  }
  return json({ ok: true, id, deleted: true }, 200);
}

// GET /api/admin/specials, every special across all advisors, any status.
export async function handleAdminListSpecials(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  const rows = await listAllSpecials(env.DB, 500);
  const specials = rows.map((r) => {
    let prof = r.advisor_profile_json;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = null; } }
    prof = prof || {};
    const advisor = [r.advisor_first, r.advisor_last].filter(Boolean).join(' ') || r.advisor_email || 'Advisor';
    return {
      id: r.id,
      headline: r.headline,
      description: r.description,
      cruise_line: r.cruise_line,
      ship: r.ship,
      sail_dates: r.sail_dates,
      rate_from: r.rate_from,
      brochure_price: r.brochure_price,
      us_canada_only: r.us_canada_only ? 1 : 0,
      status: r.status,
      created_at: r.created_at,
      advisor_id: r.advisor_id || null,
      advisor_name: advisor,
      advisor_email: r.advisor_email || null,
      advisor_agency: prof.agency || null,
    };
  });
  const active = specials.filter((s) => s.status === 'active').length;
  return json({ specials, count: specials.length, active }, 200);
}

// POST /api/admin/special-reassign  { id, advisor_id } - list a special under a
// different advisor. Its public name/agency and lead routing follow the new one.
export async function handleAdminReassignSpecial(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  const advisorId = String(body.advisor_id || '').trim();
  if (!id || !advisorId) return json({ error: 'invalid_request', message: 'Missing special or advisor.' }, 400);

  const target = await findUserById(env.DB, advisorId);
  if (!target || target.role !== 'advisor') {
    return json({ error: 'invalid_advisor', message: 'Pick an active travel-advisor account to list this special under.' }, 400);
  }
  const ok = await setSpecialAdvisor(env.DB, id, advisorId);
  if (!ok) return json({ error: 'save_failed', message: 'Could not reassign the special. Please try again.' }, 500);
  const name = [target.first_name, target.last_name].filter(Boolean).join(' ') || target.email;
  return json({ ok: true, id, advisor_id: advisorId, advisor_name: name }, 200);
}

// POST /api/admin/special-archive  { id, archived }, hide/restore a special.
export async function handleAdminArchiveSpecial(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing special id.' }, 400);
  const archived = body.archived !== false;
  try {
    await setSpecialArchived(env.DB, id, archived);
  } catch (_) {
    return json({ error: 'save_failed', message: 'Could not update the special. Please try again.' }, 500);
  }
  return json({ ok: true, id, archived }, 200);
}

// POST /api/admin/special-delete  { id }, permanently delete any special.
export async function handleAdminDeleteSpecial(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body; try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  if (!id) return json({ error: 'invalid_request', message: 'Missing special id.' }, 400);
  try {
    await adminDeleteSpecial(env.DB, id);
  } catch (_) {
    return json({ error: 'delete_failed', message: 'Could not delete the special. Please try again.' }, 500);
  }
  return json({ ok: true, id, deleted: true }, 200);
}

// GET /api/admin/admins, list admin accounts (role 'admin' or in ADMIN_EMAILS).
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

// POST /api/admin/reset-user  { id }, send a password-reset link to any user.
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

// GET /api/admin/clients, list client accounts with login + quote activity.
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
    attribution: parseAttribution(r.attribution),
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

// GET /api/admin/concierge-stats, Neptune (AI concierge) usage for the dashboard.
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

// GET /api/admin/bookings, every reported booking with commission detail.
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

// One CSV cell: quote it if it contains comma, quote, or newline; double inner quotes.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRows(rows) {
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
// A YYYY-MM-DD stamp from an epoch-ms value (UTC), or '' when missing.
function ymd(ms) {
  if (!ms) return '';
  const d = new Date(Number(ms));
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function csvResponse(name, rows) {
  const csv = '﻿' + csvRows(rows); // BOM so Excel reads UTF-8
  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  });
}

// GET /api/admin/accepted-quotes, every quote a client has accepted, with the
// advisor, sailing, quoted amount, booking outcome, and the 2.5% platform fee
// (charged only on a booked COMMISSIONABLE cruise fare the advisor reported).
// Query params: from=YYYY-MM-DD, to=YYYY-MM-DD (by accepted date), booked=1
// (booked only), format=csv, group=advisor (per-advisor summary CSV).
// Admin-only. JSON feeds the table; CSV streams a spreadsheet.
export async function handleAcceptedQuotes(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;

  const url = new URL(request.url);
  const from = (url.searchParams.get('from') || '').trim();
  const to = (url.searchParams.get('to') || '').trim();
  const bookedOnly = url.searchParams.get('booked') === '1';
  const fmt = (url.searchParams.get('format') || '').toLowerCase();
  const group = (url.searchParams.get('group') || '').toLowerCase();
  const RATE = Number(env.PLATFORM_FEE_RATE) || 0.025;
  const round2 = (n) => Math.round(n * 100) / 100;
  // Never let a non-numeric DB value turn a total into NaN ("$NaN" on screen).
  const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

  const rows = await listAcceptedOffers(env.DB, 5000);
  let quotes = rows.map((r) => {
    let prof = r.advisor_profile_json;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = null; } }
    prof = prof || {};
    const client = [r.client_first, r.client_last].filter(Boolean).join(' ').trim();
    const booked = r.booking_status === 'booked';
    const fareType = r.booking_fare_type || null;
    const cruiseFare = num(r.booking_cruise_fare);
    // The platform fee applies ONLY to a booked, commissionable cruise fare that
    // the advisor reported after closing the sale. Net-rate / unbooked = 0.
    const commissionableFare = booked && fareType === 'commissionable' && cruiseFare ? cruiseFare : 0;
    const platformFee = commissionableFare ? round2(commissionableFare * RATE) : 0;
    return {
      id: r.id,
      accepted_at: r.booking_at || r.created_at || null,
      advisor_name: r.advisor_name || null,
      advisor_email: r.advisor_email || null,
      agency: prof.agency || null,
      client: client || null,
      client_email: r.client_email || null,
      cruise_line: r.cruise_line || null,
      ship: r.ship || null,
      sailing: r.sailing_name || null,
      sailing_dates: r.sailing_dates || null,
      quoted_total: num(r.total_price),
      booking_status: r.booking_status || 'accepted',
      booked_total: num(r.booking_amount),
      booking_ref: r.booking_ref || null,
      fare_type: fareType,
      cruise_fare: cruiseFare,
      commissionable_fare: commissionableFare,
      platform_fee: platformFee,
    };
  });

  // Filters: accepted-date range (inclusive) and booked-only.
  quotes = quotes.filter((q) => {
    const d = ymd(q.accepted_at);
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    if (bookedOnly && q.booking_status !== 'booked') return false;
    return true;
  });

  const sum = (arr, k) => arr.reduce((a, b) => a + (b[k] || 0), 0);
  const totals = {
    count: quotes.length,
    quoted_total: round2(sum(quotes, 'quoted_total')),
    booked_total: round2(sum(quotes, 'booked_total')),
    commissionable_fare: round2(sum(quotes, 'commissionable_fare')),
    platform_fee: round2(sum(quotes, 'platform_fee')),
    rate: RATE,
  };

  // Per-advisor summary (grouped by advisor email, else name).
  const byAdvisor = new Map();
  for (const q of quotes) {
    const key = q.advisor_email || q.advisor_name || '-';
    let g = byAdvisor.get(key);
    if (!g) { g = { advisor_name: q.advisor_name, advisor_email: q.advisor_email, agency: q.agency, count: 0, quoted_total: 0, booked_total: 0, commissionable_fare: 0, platform_fee: 0 }; byAdvisor.set(key, g); }
    g.count += 1;
    g.quoted_total += q.quoted_total || 0;
    g.booked_total += q.booked_total || 0;
    g.commissionable_fare += q.commissionable_fare || 0;
    g.platform_fee += q.platform_fee || 0;
  }
  const advisors = [...byAdvisor.values()].map((g) => ({
    ...g,
    quoted_total: round2(g.quoted_total), booked_total: round2(g.booked_total),
    commissionable_fare: round2(g.commissionable_fare), platform_fee: round2(g.platform_fee),
  })).sort((a, b) => b.platform_fee - a.platform_fee || b.booked_total - a.booked_total);

  const stamp = ymd(Date.now());

  if (fmt === 'csv' && group === 'advisor') {
    const header = ['Advisor', 'Advisor email', 'Agency', 'Accepted quotes',
      'Quoted total (USD)', 'Booked total (USD)', 'Commissionable fare (USD)', `Platform fee @ ${(RATE * 100).toFixed(1)}% (USD)`];
    const body = advisors.map((a) => [a.advisor_name, a.advisor_email, a.agency, a.count,
      a.quoted_total || '', a.booked_total || '', a.commissionable_fare || '', a.platform_fee || '']);
    const totalRow = ['TOTAL', '', '', totals.count, totals.quoted_total || '', totals.booked_total || '',
      totals.commissionable_fare || '', totals.platform_fee || ''];
    return csvResponse(`advisor-commission-${stamp}.csv`, [header, ...body, totalRow]);
  }

  if (fmt === 'csv') {
    const header = ['Accepted', 'Advisor', 'Advisor email', 'Agency', 'Client', 'Client email',
      'Cruise line', 'Ship', 'Sailing', 'Sail dates', 'Quoted total (USD)', 'Booking status',
      'Booked total (USD)', 'Fare type', 'Commissionable fare (USD)', `Platform fee @ ${(RATE * 100).toFixed(1)}% (USD)`, 'Booking ref'];
    const body = quotes.map((q) => [
      ymd(q.accepted_at), q.advisor_name, q.advisor_email, q.agency, q.client, q.client_email,
      q.cruise_line, q.ship, q.sailing, q.sailing_dates,
      q.quoted_total != null ? q.quoted_total : '', q.booking_status,
      q.booked_total != null ? q.booked_total : '', q.fare_type || '',
      q.commissionable_fare || '', q.platform_fee || '', q.booking_ref,
    ]);
    const totalRow = ['', '', '', '', '', '', '', '', '', 'TOTAL',
      totals.quoted_total || '', '', totals.booked_total || '', '', totals.commissionable_fare || '', totals.platform_fee || '', ''];
    return csvResponse(`accepted-quotes-${stamp}.csv`, [header, ...body, totalRow]);
  }

  return json({ quotes, count: quotes.length, totals, advisors }, 200);
}

// POST /api/admin/agency-status  { agency_id, status }, suspend/reactivate a whole agency.
export async function handleSetAgencyStatus(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const agencyId = String(body.agency_id || '').trim();
  const status = body.status === 'suspended' ? 'suspended' : 'active';
  if (!agencyId) return json({ error: 'invalid_request' }, 400);
  const changed = await setAgencyUsersStatus(env.DB, agencyId, status);
  return json({ ok: true, status, changed }, 200);
}

// POST /api/admin/add-agency, create an agency + owner (approved), email an invite.
export async function handleAdminAddAgency(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const agencyName = String(body.agency_name || '').trim().slice(0, 160);
  const email = normalizeEmail(body.email);
  const first = String(body.first_name || '').trim().slice(0, 100);
  const last = String(body.last_name || '').trim().slice(0, 100);
  const password = String(body.password || '');
  const location = String(body.location || '').trim().slice(0, 160) || null;
  const website = String(body.website || '').trim().slice(0, 200) || null;
  const phone = String(body.phone || '').trim().slice(0, 40) || null;
  const credType = body.credential_type === 'IATA' ? 'IATA' : body.credential_type === 'CLIA' ? 'CLIA' : null;
  const credential = String(body.credential || '').replace(/[^0-9]/g, '') || null;

  if (!agencyName) return json({ error: 'missing_agency', message: 'Agency name is required.' }, 400);
  if (!first) return json({ error: 'missing_name', message: 'Owner first name is required.' }, 400);
  if (!isValidEmail(email)) return json({ error: 'invalid_email', message: 'Enter a valid owner email.' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Temporary password must be at least 8 characters.' }, 400);
  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  const agencyId = crypto.randomUUID();
  const ownerId = crypto.randomUUID();
  await createAgency(env.DB, { id: agencyId, name: agencyName, owner_user_id: ownerId, phone, website, location });
  const password_hash = await hashPassword(password);
  await createUser(env.DB, {
    id: ownerId, email, password_hash, first_name: first, last_name: last, phone,
    role: 'advisor', status: 'active',
    advisor_profile: { agency: agencyName, website, location, credential_type: credType, credential },
  });
  await setUserAgency(env.DB, ownerId, agencyId, 'owner');

  let emailed = false;
  try {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const r = await sendSeatInvite(env, { to: email, firstName: first, agencyName, tempPassword: password, loginUrl: `${base}/advisor/login` });
    emailed = !!(r && r.sent);
  } catch (_) {}

  return json({ ok: true, agency_id: agencyId, owner_id: ownerId, email, emailed }, 201);
}

// POST /api/admin/add-seat  { agency_id, first_name, last_name, email, password }, add a seat to any agency.
export async function handleAdminAddSeat(request, env) {
  const gate = await requireAdmin(request, env);
  if (gate.error) return gate.error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const agencyId = String(body.agency_id || '').trim();
  const email = normalizeEmail(body.email);
  const first = String(body.first_name || '').trim().slice(0, 100);
  const last = String(body.last_name || '').trim().slice(0, 100);
  const password = String(body.password || '');
  if (!agencyId) return json({ error: 'missing_agency', message: 'Choose an agency.' }, 400);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);
  if (!isValidEmail(email)) return json({ error: 'invalid_email', message: 'Enter a valid email.' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Temporary password must be at least 8 characters.' }, 400);
  const agency = await findAgencyById(env.DB, agencyId);
  if (!agency) return json({ error: 'not_found', message: 'That agency no longer exists.' }, 404);
  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  const seatId = crypto.randomUUID();
  const password_hash = await hashPassword(password);
  await createUser(env.DB, {
    id: seatId, email, password_hash, first_name: first, last_name: last, phone: null,
    role: 'advisor', status: 'active',
    advisor_profile: { agency: agency.name, website: agency.website || null, location: agency.location || null },
  });
  await setUserAgency(env.DB, seatId, agencyId, 'seat');

  let emailed = false;
  try {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const r = await sendSeatInvite(env, { to: email, firstName: first, agencyName: agency.name, tempPassword: password, loginUrl: `${base}/advisor/login` });
    emailed = !!(r && r.sent);
  } catch (_) {}

  return json({ ok: true, id: seatId, email, emailed }, 201);
}
