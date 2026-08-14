// CruiseShoppers Worker: routes API calls, gates protected pages behind auth
// (with client vs advisor roles), and serves the static site.

import { json, redirect } from './util.js';
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  handleForgot,
  handleReset,
  getCurrentUser,
  isAdmin,
} from './auth.js';
import { handleSailings, getSailingDetail } from './widgety.js';
import { handleCreateQuote, handleListQuotes } from './quotes.js';
import {
  handleListAdvisors,
  handleSetUserStatus,
  handleDeleteUser,
  handleEmailTest,
  handleListClients,
} from './admin.js';

// Client pages that require any authenticated session.
const CLIENT_PAGE_PREFIXES = ['/app', '/quote'];
// Advisor pages that are public (auth entry points).
const ADVISOR_PUBLIC = new Set([
  '/advisor/login',
  '/advisor/login.html',
  '/advisor/signup',
  '/advisor/signup.html',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) return handleApi(request, env, ctx, path);

    const next = encodeURIComponent(path + url.search);

    // Admin area: requires an admin session.
    if (isAdminArea(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) return redirect(`/login?next=${next}`, 302);
      if (!isAdmin(user, env)) return redirect('/', 302);
    }
    // Advisor area: requires an advisor session (except the login/signup pages).
    else if (isAdvisorArea(path) && !ADVISOR_PUBLIC.has(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) return redirect(`/advisor/login?next=${next}`, 302);
      if (user.role !== 'advisor') return redirect('/app', 302); // clients don't belong here
      // Not yet approved: keep them on the pending page, off the leads dashboard.
      if (user.status !== 'active' && !isAdvisorPending(path)) {
        return redirect('/advisor/pending', 302);
      }
    }
    // Client area: any authenticated session.
    else if (isClientPage(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) return redirect(`/login?next=${next}`, 302);
    }

    return env.ASSETS.fetch(request);
  },
};

function isAdvisorArea(path) {
  return path === '/advisor' || path === '/advisor.html' || path.startsWith('/advisor/');
}

function isAdvisorPending(path) {
  return path === '/advisor/pending' || path === '/advisor/pending.html';
}

function isAdminArea(path) {
  return path === '/admin' || path === '/admin.html' || path.startsWith('/admin/');
}

function isClientPage(path) {
  return CLIENT_PAGE_PREFIXES.some(
    (p) => path === p || path === `${p}.html` || path.startsWith(`${p}/`)
  );
}

async function handleApi(request, env, ctx, path) {
  // Auth (public)
  if (path === '/api/auth/signup' && request.method === 'POST') return handleSignup(request, env, ctx);
  if (path === '/api/auth/login' && request.method === 'POST') return handleLogin(request, env);
  if (path === '/api/auth/logout' && request.method === 'POST') return handleLogout(request, env);
  if (path === '/api/auth/me' && request.method === 'GET') return handleMe(request, env);
  if (path === '/api/auth/forgot' && request.method === 'POST') return handleForgot(request, env);
  if (path === '/api/auth/reset' && request.method === 'POST') return handleReset(request, env);

  // Sailings data — public (browse without an account; no pricing is returned).
  if (path === '/api/sailings') {
    return handleSailings(request, env, ctx);
  }
  // Per-itinerary detail (ship name + departure/arrival ports) — public.
  if (path === '/api/sailing-detail') {
    return getSailingDetail(request, env);
  }

  // Quote requests: clients create, advisors list.
  if (path === '/api/quotes' && request.method === 'POST') return handleCreateQuote(request, env, ctx);
  if (path === '/api/quotes' && request.method === 'GET') return handleListQuotes(request, env);

  // Admin: review advisor applications.
  if (path === '/api/admin/advisors' && request.method === 'GET') return handleListAdvisors(request, env);
  if (path === '/api/admin/clients' && request.method === 'GET') return handleListClients(request, env);
  // advisor-status kept as an alias for the generalized user-status handler.
  if ((path === '/api/admin/user-status' || path === '/api/admin/advisor-status') && request.method === 'POST')
    return handleSetUserStatus(request, env);
  if (path === '/api/admin/user-delete' && request.method === 'POST') return handleDeleteUser(request, env);
  if (path === '/api/admin/email-test' && request.method === 'GET') return handleEmailTest(request, env);

  return json({ error: 'not_found' }, 404);
}
