// Cruise Shoppers Worker: routes API calls, gates protected pages behind auth
// (with client vs advisor roles), and serves the static site.

import { json, redirect } from './util.js';
import {
  handleSignup,
  handleLogin,
  handleLogout,
  handleMe,
  handleForgot,
  handleReset,
  handleUpdateAdvisorProfile,
  handleUpdateProfile,
  handleAgencySignup,
  getCurrentUser,
  isAdmin,
} from './auth.js';
import {
  handleListAgencyAdvisors,
  handleAddAgencyAdvisor,
  handleSetSeatStatus,
  handleListAgencyQuotes,
} from './agency.js';
import {
  handleCreateReview,
  handleListAdvisorReviews,
  handleAdminListReviews,
  handleAdminSetReviewStatus,
} from './reviews.js';
import {
  handleListSearches,
  handleCreateSearch,
  handleDeleteSearch,
} from './searches.js';
import { handleSeo } from './seo.js';
import { getSailingDetail } from './widgety.js';
import { handleConcierge } from './concierge.js';
import { handleSailingsCruiseFeed } from './cruisefeed.js';
import {
  handleCreateQuote,
  handleListQuotes,
  handleCreateOffer,
  handleListOffers,
  handleGetRequest,
  handleListMyQuotes,
  handleRespondQuote,
  handleListMessages,
  handleCreateMessage,
  handleSetBooking,
} from './quotes.js';
import {
  handleListAdvisorSpecials,
  handleCreateSpecial,
  handleEditSpecial,
  handleSpecialStatus,
  handleDeleteSpecial,
  handleListPublicSpecials,
} from './specials.js';
import {
  handleListAdvisors,
  handleSetUserStatus,
  handleDeleteUser,
  handleEmailTest,
  handleListClients,
  handleListAllOffers,
  handleListAllRequests,
  handleListAdmins,
  handleAddAdmin,
  handleResetUser,
} from './admin.js';

// Client pages that require any authenticated session.
const CLIENT_PAGE_PREFIXES = ['/app', '/quote', '/my-quotes', '/profile'];
// Advisor pages that are public (auth entry points).
const ADVISOR_PUBLIC = new Set([
  '/advisor/login',
  '/advisor/login.html',
  '/advisor/signup',
  '/advisor/signup.html',
]);
// Admin pages that are public (the admin sign-in page itself).
const ADMIN_PUBLIC = new Set(['/admin/login', '/admin/login.html']);
// Agency pages that are public (signup + login entry points).
const AGENCY_PUBLIC = new Set([
  '/agency/login',
  '/agency/login.html',
  '/agency/signup',
  '/agency/signup.html',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/api/')) return handleApi(request, env, ctx, path);

    // SEO landing pages, hub, sitemap, robots (public, Worker-rendered).
    const seo = handleSeo(url);
    if (seo) return seo;

    const next = encodeURIComponent(path + url.search);

    // Admin area: requires an admin session (except the admin login page).
    if (isAdminArea(path) && !ADMIN_PUBLIC.has(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) return redirect(`/admin/login?next=${next}`, 302);
      // Logged in but not an admin (e.g. a client): send to the admin login so
      // they can sign in with an admin account, rather than bouncing home.
      if (!isAdmin(user, env)) return redirect(`/admin/login?next=${next}`, 302);
    }
    // Agency area: requires an active agency owner (except login/signup pages).
    else if (isAgencyArea(path) && !AGENCY_PUBLIC.has(path)) {
      const user = await getCurrentUser(request, env);
      if (!user) return redirect(`/agency/login?next=${next}`, 302);
      if (user.role !== 'advisor' || user.agency_role !== 'owner') return redirect('/advisor', 302);
      if (user.status !== 'active') return redirect('/advisor/pending', 302);
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

function isAgencyArea(path) {
  return path === '/agency' || path === '/agency.html' || path.startsWith('/agency/');
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
  // Backed entirely by CruiseFeed.
  if (path === '/api/sailings') {
    return handleSailingsCruiseFeed(request, env);
  }
  // AI cruise concierge — sentence -> filters -> catalog match (logged-in only).
  if (path === '/api/concierge') {
    return handleConcierge(request, env, ctx);
  }
  // Per-itinerary detail (ship name + departure/arrival ports) — public.
  if (path === '/api/sailing-detail') {
    return getSailingDetail(request, env);
  }

  // Quote requests: clients create, advisors list.
  if (path === '/api/quotes' && request.method === 'POST') return handleCreateQuote(request, env, ctx);
  if (path === '/api/quotes' && request.method === 'GET') return handleListQuotes(request, env);

  // Advisor quote offers (priced responses).
  if (path === '/api/advisor/offers' && request.method === 'POST') return handleCreateOffer(request, env, ctx);
  if (path === '/api/advisor/offers' && request.method === 'GET') return handleListOffers(request, env);
  if (path === '/api/advisor/offers/booking' && request.method === 'POST') return handleSetBooking(request, env);
  if (path === '/api/advisor/request' && request.method === 'GET') return handleGetRequest(request, env);
  if (path === '/api/advisor/profile' && request.method === 'POST') return handleUpdateAdvisorProfile(request, env);

  // Agencies (multi-seat): owner signup + seat management + agency quotes.
  if (path === '/api/agency/signup' && request.method === 'POST') return handleAgencySignup(request, env, ctx);
  if (path === '/api/agency/advisors' && request.method === 'GET') return handleListAgencyAdvisors(request, env);
  if (path === '/api/agency/advisors' && request.method === 'POST') return handleAddAgencyAdvisor(request, env);
  if (path === '/api/agency/advisors/status' && request.method === 'POST') return handleSetSeatStatus(request, env);
  if (path === '/api/agency/quotes' && request.method === 'GET') return handleListAgencyQuotes(request, env);

  // Advisor specials (highlighted deals) + public listing for clients.
  if (path === '/api/advisor/specials' && request.method === 'GET') return handleListAdvisorSpecials(request, env);
  if (path === '/api/advisor/specials' && request.method === 'POST') return handleCreateSpecial(request, env, ctx);
  if (path === '/api/advisor/specials/edit' && request.method === 'POST') return handleEditSpecial(request, env);
  if (path === '/api/advisor/specials/status' && request.method === 'POST') return handleSpecialStatus(request, env);
  if (path === '/api/advisor/specials/delete' && request.method === 'POST') return handleDeleteSpecial(request, env);
  if (path === '/api/specials' && request.method === 'GET') return handleListPublicSpecials(request, env);

  // Advisor reviews / ratings.
  if (path === '/api/reviews' && request.method === 'POST') return handleCreateReview(request, env);
  if (path === '/api/advisor/reviews' && request.method === 'GET') return handleListAdvisorReviews(request, env);
  if (path === '/api/admin/reviews' && request.method === 'GET') return handleAdminListReviews(request, env);
  if (path === '/api/admin/reviews/status' && request.method === 'POST') return handleAdminSetReviewStatus(request, env);

  // Saved searches + alerts (client).
  if (path === '/api/searches' && request.method === 'GET') return handleListSearches(request, env);
  if (path === '/api/searches' && request.method === 'POST') return handleCreateSearch(request, env);
  if (path === '/api/searches/delete' && request.method === 'POST') return handleDeleteSearch(request, env);

  // Client profile (basic name/phone).
  if (path === '/api/profile' && request.method === 'POST') return handleUpdateProfile(request, env);

  // Client-facing quotes (view + accept).
  if (path === '/api/my/quotes' && request.method === 'GET') return handleListMyQuotes(request, env);
  if ((path === '/api/my/quotes/respond' || path === '/api/my/quotes/accept') && request.method === 'POST') return handleRespondQuote(request, env, ctx);

  // Messages on an accepted quote (client <-> advisor).
  if (path === '/api/messages' && request.method === 'GET') return handleListMessages(request, env);
  if (path === '/api/messages' && request.method === 'POST') return handleCreateMessage(request, env, ctx);

  // Admin: review advisor applications.
  if (path === '/api/admin/advisors' && request.method === 'GET') return handleListAdvisors(request, env);
  if (path === '/api/admin/clients' && request.method === 'GET') return handleListClients(request, env);
  if (path === '/api/admin/admins' && request.method === 'GET') return handleListAdmins(request, env);
  if (path === '/api/admin/add-admin' && request.method === 'POST') return handleAddAdmin(request, env, ctx);
  if (path === '/api/admin/reset-user' && request.method === 'POST') return handleResetUser(request, env);
  if (path === '/api/admin/requests' && request.method === 'GET') return handleListAllRequests(request, env);
  if (path === '/api/admin/offers' && request.method === 'GET') return handleListAllOffers(request, env);
  // advisor-status kept as an alias for the generalized user-status handler.
  if ((path === '/api/admin/user-status' || path === '/api/admin/advisor-status') && request.method === 'POST')
    return handleSetUserStatus(request, env);
  if (path === '/api/admin/user-delete' && request.method === 'POST') return handleDeleteUser(request, env);
  if (path === '/api/admin/email-test' && request.method === 'GET') return handleEmailTest(request, env);

  return json({ error: 'not_found' }, 404);
}
