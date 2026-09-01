// Agency owner endpoints: manage advisor "seats" and view all agency quotes.
// A seat sees only its own quotes (handled by the normal advisor filters);
// the owner sees every seat's quotes here.

import { json } from './util.js';
import { hashPassword, isValidEmail, normalizeEmail } from './util.js';
import { getCurrentUser } from './auth.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  setUserAgency,
  setUserStatus,
  findAgencyById,
  listAgencyAdvisors,
  listAgencyOffers,
  getUnreadCounts,
  setMustChangePassword,
} from './db.js';
import { sendSeatInvite } from './email.js';
import { agreementLink } from './boldsign.js';

// Maximum advisors an agency can add (not counting the owner). Generous soft
// cap to prevent abuse; raise freely as agencies grow.
const MAX_SEATS = 25;

async function requireOwner(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return { error: json({ error: 'unauthorized' }, 401) };
  if (user.role !== 'advisor') return { error: json({ error: 'forbidden' }, 403) };
  if (!user.agency_id || user.agency_role !== 'owner') {
    return { error: json({ error: 'forbidden', message: 'Only an agency owner can manage the agency.' }, 403) };
  }
  if (user.status !== 'active') {
    return { error: json({ error: 'pending_approval', message: 'Your agency account is awaiting approval.' }, 403) };
  }
  return { user };
}

// GET /api/agency/advisors, owner + seats in the agency.
export async function handleListAgencyAdvisors(request, env) {
  const { user, error } = await requireOwner(request, env);
  if (error) return error;
  const agency = await findAgencyById(env.DB, user.agency_id);
  const rows = await listAgencyAdvisors(env.DB, user.agency_id);
  const advisors = rows.map((u) => ({
    id: u.id,
    name: [u.first_name, u.last_name].filter(Boolean).join(' ') || '(no name)',
    email: u.email,
    status: u.status || 'active',
    role: u.agency_role || 'seat',
    is_owner: u.agency_role === 'owner',
    is_me: u.id === user.id,
    created_at: u.created_at,
    last_login_at: u.last_login_at || null,
  }));
  const seatsUsed = advisors.filter((a) => !a.is_owner && a.status !== 'suspended').length;

  // Participating Agency Agreement: a BoldSign shareable-template link the owner
  // opens to sign, pre-filled with their details. Null when none is configured.
  const agreementUrl = agreementLink(env, {
    agentName: [user.first_name, user.last_name].filter(Boolean).join(' '),
    agencyName: agency ? agency.name : '',
    email: user.email,
    phone: user.phone,
  });

  return json({
    agency: agency ? { id: agency.id, name: agency.name } : null,
    advisors,
    count: advisors.length,
    seats_used: seatsUsed,
    seats_max: MAX_SEATS,
    seats_remaining: Math.max(0, MAX_SEATS - seatsUsed),
    agreement_url: agreementUrl,
  }, 200);
}

// POST /api/agency/advisors, add a new advisor seat with a temp password.
export async function handleAddAgencyAdvisor(request, env) {
  const { user, error } = await requireOwner(request, env);
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const first = String(body.first_name || '').trim().slice(0, 100);
  const last = String(body.last_name || '').trim().slice(0, 100);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);
  if (!isValidEmail(email)) return json({ error: 'invalid_email', message: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Temporary password must be at least 8 characters.' }, 400);

  // Enforce the seat limit (advisors under the agency, not counting the owner).
  const roster = await listAgencyAdvisors(env.DB, user.agency_id);
  const seatsUsed = roster.filter((u) => u.agency_role !== 'owner' && u.status !== 'suspended').length;
  if (seatsUsed >= MAX_SEATS) {
    return json({ error: 'seat_limit', message: `Your agency has reached its limit of ${MAX_SEATS} advisor seats.` }, 409);
  }

  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  const agency = await findAgencyById(env.DB, user.agency_id);
  const agencyName = (agency && agency.name) || user.agency || '';
  const password_hash = await hashPassword(password);
  const seat = await createUser(env.DB, {
    id: crypto.randomUUID(),
    email,
    password_hash,
    first_name: first,
    last_name: last,
    phone: null,
    role: 'advisor',
    status: 'active',
    advisor_profile: {
      agency: agencyName,
      location: (agency && agency.location) || null,
      website: (agency && agency.website) || null,
    },
  });
  await setUserAgency(env.DB, seat.id, user.agency_id, 'seat');
  // Temp password was set by the owner: force a change on first sign-in.
  await setMustChangePassword(env.DB, seat.id, 1);

  let emailed = false;
  try {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const r = await sendSeatInvite(env, { to: email, firstName: first, agencyName, tempPassword: password, loginUrl: `${base}/advisor/login` });
    emailed = !!(r && r.sent);
  } catch (_) {}

  return json({ ok: true, id: seat.id, email, emailed }, 201);
}

// POST /api/agency/advisors/status, suspend/reactivate a seat.
export async function handleSetSeatStatus(request, env) {
  const { user, error } = await requireOwner(request, env);
  if (error) return error;
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  const status = body.status === 'suspended' ? 'suspended' : 'active';
  if (!id) return json({ error: 'invalid_request' }, 400);
  if (id === user.id) return json({ error: 'forbidden', message: 'You cannot change your own status.' }, 400);
  const target = await findUserById(env.DB, id);
  if (!target || target.agency_id !== user.agency_id || target.agency_role === 'owner') {
    return json({ error: 'not_found' }, 404);
  }
  await setUserStatus(env.DB, id, status);
  return json({ ok: true, status }, 200);
}

// GET /api/agency/quotes, all offers submitted by advisors in the agency.
export async function handleListAgencyQuotes(request, env) {
  const { user, error } = await requireOwner(request, env);
  if (error) return error;
  const rows = await listAgencyOffers(env.DB, user.agency_id, 500);
  const offers = rows.map((o) => {
    const revealed = o.status === 'accepted';
    return {
      id: o.id,
      quote_request_id: o.quote_request_id,
      price: o.price,
      specials: o.specials,
      additional_info: o.additional_info,
      status: o.status,
      created_at: o.created_at,
      advisor_name: [o.advisor_first, o.advisor_last].filter(Boolean).join(' ') || 'Advisor',
      sailing_name: o.sailing_name,
      cruise_line: o.cruise_line,
      ship: o.ship,
      sailing_dates: o.sailing_dates,
      departure_port: o.departure_port,
      destination: o.destination,
      client_revealed: revealed,
      client_first: revealed ? o.client_first : null,
      client_last: revealed ? o.client_last : null,
      client_email: revealed ? o.client_email : null,
      booking_status: o.booking_status || null,
    };
  });
  const unread = await getUnreadCounts(env.DB, user.id, offers.map((o) => o.id));
  for (const o of offers) o.unread = unread[o.id] || 0;
  return json({ offers, count: offers.length }, 200);
}
