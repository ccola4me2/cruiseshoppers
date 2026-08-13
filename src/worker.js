// CruiseShoppers Worker: routes API calls, gates protected pages behind auth,
// and serves the static site from the ASSETS binding.

import { json, redirect } from './util.js';
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  handleForgot,
  handleReset,
  getCurrentUser,
} from './auth.js';
import { handleSailings } from './widgety.js';

// Pages that require an authenticated session. Unauthenticated visitors are
// redirected to /login; the sailing catalog and quote flow live here.
const PROTECTED_PAGE_PREFIXES = ['/app', '/quote'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // --- API routes -------------------------------------------------------
    if (path.startsWith('/api/')) {
      return handleApi(request, env, ctx, path);
    }

    // --- Gate protected pages --------------------------------------------
    if (isProtectedPage(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) {
        const next = encodeURIComponent(path + url.search);
        return redirect(`/login?next=${next}`, 302);
      }
    }

    // --- Static assets ----------------------------------------------------
    return env.ASSETS.fetch(request);
  },
};

function isProtectedPage(path) {
  // Match /app, /app/, /app.html, /quote, etc., but not asset paths.
  return PROTECTED_PAGE_PREFIXES.some(
    (p) => path === p || path === `${p}.html` || path.startsWith(`${p}/`)
  );
}

async function handleApi(request, env, ctx, path) {
  // Auth endpoints (public).
  if (path === '/api/auth/signup' && request.method === 'POST') return handleSignup(request, env);
  if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env);
  if (path === '/api/auth/me' && request.method === 'GET') return handleMe(request, env);
  if (path === '/api/auth/forgot' && request.method === 'POST') return handleForgot(request, env);
  if (path === '/api/auth/reset' && request.method === 'POST') return handleReset(request, env);

  // Sailings data (auth required: this is the gated content).
  if (path === '/api/sailings') {
    const user = await getCurrentUser(request, env);
    if (!user) return json({ error: 'unauthorized' }, 401);
    return handleSailings(request, env, ctx);
  }

  return json({ error: 'not_found' }, 404);
}
