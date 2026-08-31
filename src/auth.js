// Authentication: signup, login, logout, session lookup, password reset.

import {
  json,
  parseCookies,
  cookieHeader,
  clearCookieHeader,
  randomToken,
  sha256Hex,
  hashPassword,
  verifyPassword,
  isValidEmail,
  normalizeEmail,
} from './util.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  updateUserPassword,
  createSession,
  getSession,
  deleteSession,
  deleteUserSessions,
  createResetToken,
  getResetToken,
  markResetTokenUsed,
  setLastLogin,
  updateAdvisorProfile,
  updateUserBasic,
  createAgency,
  setUserAgency,
} from './db.js';
import { sendResetEmail, sendAdminNotice, sendSignupEmail, sendAgreementEmail } from './email.js';
import { sendAgencyAgreement, agreementLink } from './boldsign.js';

export const SESSION_COOKIE = 'cs_session';

// Bump when the Advisor Terms & Conditions change; recorded per advisor at signup.
const TERMS_VERSION = '2026-08-15';

function sessionTtlMs(env) {
  const days = parseInt(env.SESSION_TTL_DAYS || '30', 10);
  return days * 24 * 60 * 60 * 1000;
}

function resetTtlMs(env) {
  const mins = parseInt(env.RESET_TTL_MINUTES || '60', 10);
  return mins * 60 * 1000;
}

function publicUser(u) {
  const base = {
    id: u.id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    phone: u.phone,
    role: u.role === 'advisor' || u.role === 'admin' ? u.role : 'client',
    status: ['pending', 'declined', 'suspended'].includes(u.status) ? u.status : 'active',
    // Client's saved location (state), used to pre-fill the quote form. Advisors
    // override this with their business location from advisor_profile below.
    location: u.location || null,
  };
  // Surface a few advisor-profile fields so quotes/emails can show contact info.
  if (base.role === 'advisor' && u.advisor_profile) {
    let p = u.advisor_profile;
    if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = null; } }
    if (p) {
      base.agency = p.agency || null;
      base.location = p.location || null;
      base.hours = p.hours || null;
      base.website = p.website || null;
      base.bio = p.bio || null;
      // Cruise lines the advisor chose to follow. Empty/absent = all lines.
      base.preferred_lines = Array.isArray(p.preferred_lines) ? p.preferred_lines : [];
    }
  }
  // Agency membership (owner sees all seats' quotes; seat sees only their own).
  base.agency_id = u.agency_id || null;
  base.agency_role = u.agency_role || null;
  return base;
}

// An account is an admin if its email is listed in the ADMIN_EMAILS env var
// (comma-separated) or its role is 'admin'.
export function isAdmin(user, env) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return isAdminEmail(user.email, env);
}

// True if the given email is listed in the ADMIN_EMAILS env var (comma-separated).
export function isAdminEmail(email, env) {
  const list = String(env.ADMIN_EMAILS || '')
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.includes(String(email || '').toLowerCase());
}

// Resolve the authenticated user (or null) from the session cookie.
export async function getCurrentUser(request, env) {
  const cookies = parseCookies(request);
  const raw = cookies[SESSION_COOKIE];
  if (!raw) return null;
  const id = await sha256Hex(raw);
  const session = await getSession(env.DB, id);
  if (!session) return null;
  if (session.expires_at < Date.now()) {
    await deleteSession(env.DB, id);
    return null;
  }
  const user = await findUserById(env.DB, session.user_id);
  if (!user) return null;
  const pu = publicUser(user);
  // Elevate accounts listed in ADMIN_EMAILS to the admin role.
  if (isAdmin(pu, env)) pu.role = 'admin';
  // A suspended account is treated as signed out everywhere.
  if (pu.status === 'suspended' && pu.role !== 'admin') return null;
  return pu;
}

async function startSession(env, userId) {
  const raw = randomToken(32);
  const id = await sha256Hex(raw);
  const ttl = sessionTtlMs(env);
  await createSession(env.DB, { id, userId, expiresAt: Date.now() + ttl });
  return { raw, maxAge: Math.floor(ttl / 1000) };
}

// Validate a client-supplied attribution object (first-touch UTM / referrer)
// into a compact JSON string to store, or null. Only known keys, size-bounded.
function normalizeAttribution(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const s = (v) => (v == null ? null : String(v).slice(0, 200));
  const out = {
    source: s(obj.source), medium: s(obj.medium), campaign: s(obj.campaign),
    content: s(obj.content), term: s(obj.term), referrer: s(obj.referrer),
    landing: s(obj.landing), ts: typeof obj.ts === 'number' ? obj.ts : null,
  };
  if (!Object.values(out).some((v) => v)) return null;
  return JSON.stringify(out);
}

// POST /api/auth/signup  { email, password, first_name, last_name, phone }
export async function handleSignup(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const first = String(body.first_name || '').trim().slice(0, 100);
  const last = String(body.last_name || '').trim().slice(0, 100);
  const phone = String(body.phone || '').trim().slice(0, 40);
  const location = String(body.location || '').trim().slice(0, 100);
  const attribution = normalizeAttribution(body.attribution);

  if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);

  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  // Never allow self-registration of a configured admin email. Admin accounts
  // must be provisioned deliberately; without this, anyone could POST signup
  // with an operator's email and have their session elevated to admin below.
  if (isAdminEmail(email, env)) {
    return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);
  }

  const role = body.role === 'advisor' ? 'advisor' : 'client';
  const password_hash = await hashPassword(password);

  // Capture the extra business details from the advisor application form.
  // Advisors must supply a valid CLIA (7-digit) or IATA/IATAN (8-digit) number.
  let advisor_profile = null;
  if (role === 'advisor') {
    const s = (v) => String(v || '').trim().slice(0, 200);
    // These are all required for an advisor application.
    if (!last) return json({ error: 'missing_last_name', message: 'Last name is required.' }, 400);
    if (!phone) return json({ error: 'missing_phone', message: 'A phone / SMS number is required.' }, 400);
    if (!s(body.agency)) return json({ error: 'missing_agency', message: 'Your host agency is required.' }, 400);
    if (!location) return json({ error: 'missing_location', message: 'Your city and state are required.' }, 400);
    const credential_type = s(body.credential_type).toUpperCase();
    const credential = String(body.credential || '').replace(/[^0-9]/g, '');
    const credentialOk =
      (credential_type === 'CLIA' && /^\d{7}$/.test(credential)) ||
      (credential_type === 'IATA' && /^\d{8}$/.test(credential));
    if (!credentialOk) {
      return json(
        {
          error: 'invalid_credential',
          message: 'A valid CLIA (7 digits) or IATA / IATAN (8 digits) number is required to register as a travel advisor.',
        },
        400
      );
    }
    if (!body.terms_accepted) {
      return json({ error: 'terms_required', message: 'You must accept the Advisor Terms & Conditions.' }, 400);
    }
    advisor_profile = {
      agency: s(body.agency),
      website: s(body.website),
      location: s(body.location),
      hours: s(body.hours),
      bio: String(body.bio || '').trim().slice(0, 800),
      credential_type,
      credential,
      experience: s(body.experience),
      source: s(body.source),
      terms_version: TERMS_VERSION,
      terms_accepted_at: Date.now(),
    };
  }

  // Advisors must be approved before they can see leads.
  const status = role === 'advisor' ? 'pending' : 'active';
  const user = await createUser(env.DB, {
    id: crypto.randomUUID(),
    email,
    password_hash,
    first_name: first,
    last_name: last,
    phone,
    role,
    advisor_profile,
    location,
    attribution,
    status,
  });

  // Notify the operators, and welcome/confirm to the new user (best-effort).
  notifyNewSignup(env, ctx, request, user, advisor_profile);
  {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const send = sendSignupEmail(env, {
      to: user.email,
      firstName: user.first_name,
      role: user.role,
      baseUrl: base,
    }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }

  // Advisors also get the Participating Agreement (BoldSign shareable link) to
  // sign; their account stays pending until an admin approves it after the
  // signed document comes back.
  if (role === 'advisor') {
    const url = agreementLink(env, {
      agentName: [first, last].filter(Boolean).join(' '),
      agencyName: advisor_profile && advisor_profile.agency,
      email,
      phone,
    });
    if (url) {
      const send = sendAgreementEmail(env, { to: email, firstName: first, url }).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
    }
  }

  const pu = publicUser(user);
  if (isAdmin(pu, env)) pu.role = 'admin';

  const { raw, maxAge } = await startSession(env, user.id);
  return json({ user: pu }, 201, {
    'Set-Cookie': cookieHeader(SESSION_COOKIE, raw, { maxAge }),
  });
}

// POST /api/agency/signup, register an agency + its owner (an advisor). The
// owner is pending until an admin approves, then can add advisor seats.
export async function handleAgencySignup(request, env, ctx) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const s = (v, n = 200) => String(v || '').trim().slice(0, n);
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  const first = s(body.first_name, 100);
  const last = s(body.last_name, 100);
  const phone = s(body.phone, 40);
  const agencyName = s(body.agency_name, 160);

  if (!isValidEmail(email)) return json({ error: 'invalid_email', message: 'Enter a valid email address.' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);
  if (!agencyName) return json({ error: 'missing_agency', message: 'Agency name is required.' }, 400);

  const credential_type = s(body.credential_type).toUpperCase();
  const credential = String(body.credential || '').replace(/[^0-9]/g, '');
  const credentialOk =
    (credential_type === 'CLIA' && /^\d{7}$/.test(credential)) ||
    (credential_type === 'IATA' && /^\d{8}$/.test(credential));
  if (!credentialOk) {
    return json({ error: 'invalid_credential', message: 'A valid CLIA (7 digits) or IATA / IATAN (8 digits) number is required.' }, 400);
  }
  if (!body.terms_accepted) {
    return json({ error: 'terms_required', message: 'You must accept the Advisor Terms & Conditions.' }, 400);
  }

  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);
  if (isAdminEmail(email, env)) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  // Guard before creating any account: the agencies table must exist.
  try { await env.DB.prepare('SELECT 1 FROM agencies LIMIT 1').all(); }
  catch { return json({ error: 'not_migrated', message: 'Agency accounts are not set up yet. The database migration (0011) still needs to be applied.' }, 503); }

  const password_hash = await hashPassword(password);
  const advisor_profile = {
    agency: agencyName,
    website: s(body.website),
    location: s(body.location),
    hours: s(body.hours),
    bio: String(body.bio || '').trim().slice(0, 800),
    credential_type,
    credential,
    experience: s(body.experience),
    source: s(body.source),
    terms_version: TERMS_VERSION,
    terms_accepted_at: Date.now(),
  };

  const owner = await createUser(env.DB, {
    id: crypto.randomUUID(),
    email,
    password_hash,
    first_name: first,
    last_name: last,
    phone,
    role: 'advisor',
    advisor_profile,
    status: 'pending',
  });

  const agency = await createAgency(env.DB, {
    id: crypto.randomUUID(),
    name: agencyName,
    owner_user_id: owner.id,
    phone,
    website: advisor_profile.website,
    location: advisor_profile.location,
  });
  await setUserAgency(env.DB, owner.id, agency.id, 'owner');

  // Email the Participating Agency Agreement (BoldSign shareable link) to sign;
  // the account stays pending until an admin approves it after the signed doc.
  {
    const url = agreementLink(env, { agentName: [first, last].filter(Boolean).join(' '), agencyName, email, phone });
    if (url) {
      const send = sendAgreementEmail(env, { to: email, firstName: first, url }).catch(() => {});
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
    }
  }

  notifyNewSignup(env, ctx, request, owner, advisor_profile);
  {
    const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
    const send = sendSignupEmail(env, { to: owner.email, firstName: owner.first_name, role: 'advisor', baseUrl: base }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
  }

  const pu = publicUser({ ...owner, agency_id: agency.id, agency_role: 'owner' });
  const { raw, maxAge } = await startSession(env, owner.id);
  return json({ user: pu }, 201, { 'Set-Cookie': cookieHeader(SESSION_COOKIE, raw, { maxAge }) });
}

function notifyNewSignup(env, ctx, request, user, profile) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '(no name)';
  const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  let notice;
  if (user.role === 'advisor') {
    const p = profile || {};
    const cred = p.credential_type ? `${p.credential_type} ${p.credential || ''}`.trim() : '';
    notice = {
      subject: `New advisor application: ${p.agency || fullName}`,
      title: 'New advisor application',
      intro: 'An advisor applied and is waiting for approval in the admin queue.',
      rows: [
        ['Name', fullName],
        ['Email', user.email],
        ['Phone', user.phone],
        ['Agency', p.agency],
        ['Credential', cred],
        ['Location', p.location],
      ],
      ctaUrl: `${base}/admin`,
      ctaText: 'Review in admin',
    };
  } else {
    notice = {
      subject: `New client signup: ${fullName}`,
      title: 'New client signup',
      intro: 'A new client just created an account.',
      rows: [
        ['Name', fullName],
        ['Email', user.email],
        ['Phone', user.phone],
      ],
    };
  }
  const send = sendAdminNotice(env, notice).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);
}

// POST /api/auth/login  { email, password }
export async function handleLogin(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');

  const user = await findUserByEmail(env.DB, email);
  // Always run a verify to keep timing roughly constant whether or not the
  // account exists (mitigates user enumeration via timing).
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');

  if (!user || !ok) {
    return json({ error: 'invalid_credentials', message: 'Email or password is incorrect.' }, 401);
  }

  // Suspended accounts cannot sign in (admins are never suspended).
  if (user.status === 'suspended' && !isAdmin(publicUser(user), env)) {
    return json(
      { error: 'account_suspended', message: 'This account has been suspended. Please contact support.' },
      403
    );
  }

  // Record the login time (best-effort; ignore if the column isn't migrated).
  try { await setLastLogin(env.DB, user.id); } catch {}

  const pu = publicUser(user);
  if (isAdmin(pu, env)) pu.role = 'admin'; // so the login page routes admins to /admin

  const { raw, maxAge } = await startSession(env, user.id);
  return json({ user: pu }, 200, {
    'Set-Cookie': cookieHeader(SESSION_COOKIE, raw, { maxAge }),
  });
}

// POST /api/auth/logout
export async function handleLogout(request, env) {
  const cookies = parseCookies(request);
  const raw = cookies[SESSION_COOKIE];
  if (raw) await deleteSession(env.DB, await sha256Hex(raw));
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader(SESSION_COOKIE) });
}

// GET /api/auth/me
export async function handleMe(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ user: null }, 200);
  return json({ user }, 200);
}

// POST /api/profile  (any authenticated user), update basic name/phone.
export async function handleUpdateProfile(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const s = (v, n = 100) => String(v == null ? '' : v).trim().slice(0, n);
  const firstName = s(body.first_name, 100);
  if (!firstName) return json({ error: 'invalid_request', message: 'First name is required.' }, 400);
  await updateUserBasic(env.DB, user.id, {
    first_name: firstName,
    last_name: s(body.last_name, 100),
    phone: s(body.phone, 40),
  });
  return json({ ok: true }, 200);
}

// POST /api/advisor/profile  (authenticated advisor), update editable
// contact / agency details. Credentials and terms acceptance are preserved.
export async function handleUpdateAdvisorProfile(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const s = (v, n = 200) => String(v == null ? '' : v).trim().slice(0, n);

  const full = await findUserById(env.DB, user.id);
  if (!full) return json({ error: 'not_found' }, 404);
  let prof = full.advisor_profile;
  if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = {}; } }
  prof = prof || {};

  // Only the editable fields; keep credential_type/credential/terms_* intact.
  prof.agency = s(body.agency);
  prof.website = s(body.website);
  prof.location = s(body.location);
  prof.hours = s(body.hours, 300);
  prof.bio = s(body.bio, 800);

  const firstName = s(body.first_name, 80);
  if (!firstName) return json({ error: 'invalid_request', message: 'First name is required.' }, 400);

  await updateAdvisorProfile(env.DB, user.id, {
    first_name: firstName,
    last_name: s(body.last_name, 80),
    phone: s(body.phone, 40),
    profile: prof,
  });
  return json({ ok: true }, 200);
}

// POST /api/advisor/lines  (authenticated advisor), set the cruise lines this
// advisor wants to see leads for and be emailed about. An empty list means "all
// lines" (no filtering). Stored on advisor_profile.preferred_lines.
export async function handleSetAdvisorLines(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const raw = Array.isArray(body.lines) ? body.lines : [];
  // Normalize: trimmed strings, de-duped, capped for sanity.
  const seen = new Set();
  const lines = [];
  for (const v of raw) {
    const name = String(v == null ? '' : v).trim().slice(0, 120);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(name);
    if (lines.length >= 60) break;
  }

  const full = await findUserById(env.DB, user.id);
  if (!full) return json({ error: 'not_found' }, 404);
  let prof = full.advisor_profile;
  if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = {}; } }
  prof = prof || {};
  prof.preferred_lines = lines;

  await updateAdvisorProfile(env.DB, user.id, {
    first_name: full.first_name,
    last_name: full.last_name,
    phone: full.phone,
    profile: prof,
  });
  return json({ ok: true, lines }, 200);
}

// POST /api/auth/forgot  { email }
// Always returns a generic success so the response can't be used to discover
// which emails have accounts.
export async function handleForgot(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const email = normalizeEmail(body.email);
  const generic = { ok: true, message: 'If that email has an account, a reset link is on its way.' };

  if (!isValidEmail(email)) return json(generic, 200);

  // Do the lookup, token creation, and email send out of band so the response
  // time is the same whether or not the account exists, otherwise the extra
  // DB write + Resend round-trip for real accounts is a timing enumeration
  // oracle. Errors are swallowed so nothing about the account surfaces.
  const work = (async () => {
    try {
      const user = await findUserByEmail(env.DB, email);
      if (!user) return;
      const raw = randomToken(32);
      const id = await sha256Hex(raw);
      await createResetToken(env.DB, { id, userId: user.id, expiresAt: Date.now() + resetTtlMs(env) });
      const base = env.APP_URL || new URL(request.url).origin;
      const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${raw}`;
      await sendResetEmail(env, { to: user.email, resetUrl });
    } catch (_) { /* never surface account existence to the caller */ }
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(work);

  return json(generic, 200);
}

// POST /api/auth/reset  { token, password }
export async function handleReset(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const rawToken = String(body.token || '');
  const password = String(body.password || '');
  if (!rawToken) return json({ error: 'invalid_token' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400);

  const id = await sha256Hex(rawToken);
  const record = await getResetToken(env.DB, id);
  if (!record || record.used || record.expires_at < Date.now()) {
    return json({ error: 'invalid_or_expired', message: 'This reset link is invalid or has expired.' }, 400);
  }

  const password_hash = await hashPassword(password);
  await updateUserPassword(env.DB, record.user_id, password_hash);
  await markResetTokenUsed(env.DB, id);
  // Invalidate existing sessions so a compromised session can't persist.
  await deleteUserSessions(env.DB, record.user_id);

  return json({ ok: true, message: 'Your password has been reset. You can now sign in.' }, 200);
}
