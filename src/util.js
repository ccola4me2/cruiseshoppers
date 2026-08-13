// Shared helpers: JSON responses, cookies, crypto (password hashing, tokens).

const encoder = new TextEncoder();

export function json(obj, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
  });
}

export function redirect(location, status = 302, extraHeaders = {}) {
  return new Response(null, { status, headers: { Location: location, ...extraHeaders } });
}

// ---------------------------------------------------------------------------
// Base64 helpers (URL-safe not required; standard base64 is fine for storage)
// ---------------------------------------------------------------------------
export function bytesToB64(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------
export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const out = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq > 0) out[part.slice(0, eq)] = decodeURIComponent(part.slice(eq + 1));
  }
  return out;
}

export function cookieHeader(name, value, { maxAge, expires } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax`;
  if (typeof maxAge === 'number') c += `; Max-Age=${maxAge}`;
  if (expires) c += `; Expires=${expires}`;
  return c;
}

export function clearCookieHeader(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ---------------------------------------------------------------------------
// Random tokens
// ---------------------------------------------------------------------------
export function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return toHex(buf);
}

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

// ---------------------------------------------------------------------------
// Password hashing: PBKDF2/SHA-256 via Web Crypto (available in Workers).
// Stored format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>
// ---------------------------------------------------------------------------
const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN_BITS = 256;

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToB64(salt)}$${bytesToB64(new Uint8Array(bits))}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, iterStr, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'pbkdf2') return false;
    const iterations = parseInt(iterStr, 10);
    const salt = b64ToBytes(saltB64);
    const expected = b64ToBytes(hashB64);
    const bits = await deriveBits(password, salt, iterations, expected.length * 8);
    const actual = new Uint8Array(bits);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

async function deriveBits(password, salt, iterations, lengthBits = PBKDF2_KEYLEN_BITS) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    lengthBits
  );
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}
