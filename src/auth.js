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
} from './db.js';
import { sendResetEmail } from './email.js';

export const SESSION_COOKIE = 'cs_session';

function sessionTtlMs(env) {
  const days = parseInt(env.SESSION_TTL_DAYS || '30', 10);
  return days * 24 * 60 * 60 * 1000;
}

function resetTtlMs(env) {
  const mins = parseInt(env.RESET_TTL_MINUTES || '60', 10);
  return mins * 60 * 1000;
}

function publicUser(u) {
  return {
    id: u.id,
    email: u.email,
    first_name: u.first_name,
    last_name: u.last_name,
    phone: u.phone,
    role: u.role === 'advisor' ? 'advisor' : 'client',
  };
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
  return user ? publicUser(user) : null;
}

async function startSession(env, userId) {
  const raw = randomToken(32);
  const id = await sha256Hex(raw);
  const ttl = sessionTtlMs(env);
  await createSession(env.DB, { id, userId, expiresAt: Date.now() + ttl });
  return { raw, maxAge: Math.floor(ttl / 1000) };
}

// POST /api/auth/signup  { email, password, first_name, last_name, phone }
export async function handleSignup(request, env) {
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

  if (!isValidEmail(email)) return json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return json({ error: 'weak_password', message: 'Password must be at least 8 characters.' }, 400);
  if (!first) return json({ error: 'missing_name', message: 'First name is required.' }, 400);

  const existing = await findUserByEmail(env.DB, email);
  if (existing) return json({ error: 'email_taken', message: 'An account with that email already exists.' }, 409);

  const role = body.role === 'advisor' ? 'advisor' : 'client';
  const password_hash = await hashPassword(password);
  const user = await createUser(env.DB, {
    id: crypto.randomUUID(),
    email,
    password_hash,
    first_name: first,
    last_name: last,
    phone,
    role,
  });

  const { raw, maxAge } = await startSession(env, user.id);
  return json({ user: publicUser(user) }, 201, {
    'Set-Cookie': cookieHeader(SESSION_COOKIE, raw, { maxAge }),
  });
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

  const { raw, maxAge } = await startSession(env, user.id);
  return json({ user: publicUser(user) }, 200, {
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

// POST /api/auth/forgot  { email }
// Always returns a generic success so the response can't be used to discover
// which emails have accounts.
export async function handleForgot(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const email = normalizeEmail(body.email);
  const generic = { ok: true, message: 'If that email has an account, a reset link is on its way.' };

  if (!isValidEmail(email)) return json(generic, 200);

  const user = await findUserByEmail(env.DB, email);
  if (user) {
    const raw = randomToken(32);
    const id = await sha256Hex(raw);
    await createResetToken(env.DB, { id, userId: user.id, expiresAt: Date.now() + resetTtlMs(env) });
    const base = env.APP_URL || new URL(request.url).origin;
    const resetUrl = `${base.replace(/\/$/, '')}/reset-password?token=${raw}`;
    await sendResetEmail(env, { to: user.email, resetUrl });
  }
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
