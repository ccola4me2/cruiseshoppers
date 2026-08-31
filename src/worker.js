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
  handleSetAdvisorLines,
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
import { handleConcierge } from './concierge.js';
import { handleSailingsCruiseFeed, handleShipsByLine, handleShipDates, handleCruiseLines } from './cruisefeed.js';
import { importCatalogStep, importStatus } from './catalog.js';
import { handleShipImages } from './shipimg.js';
import {
  handleCreateQuote,
  handleListQuotes,
  handleDismissLead,
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
  handleSetAdvisorSpecialsPlan,
  handleSetUserStatus,
  handleDeleteUser,
  handleEmailTest,
  handleListClients,
  handleListAllOffers,
  handleAdminArchiveOffer,
  handleAdminDeleteOffer,
  handleAdminListSpecials,
  handleAdminArchiveSpecial,
  handleAdminDeleteSpecial,
  handleListAllRequests,
  handleAdminArchiveRequest,
  handleAdminDeleteRequest,
  handleListAdmins,
  handleAddAdmin,
  handleResetUser,
  handleConciergeStats,
  handleListBookings,
  handleAcceptedQuotes,
  handleAttributionReport,
  handleSetAgencyStatus,
  handleAdminAddAgency,
  handleAdminAddSeat,
} from './admin.js';

// Client pages that require any authenticated session. The full Specials
// browsing page is sign-in only (the homepage carousel + /api/specials stay
// public); anonymous visitors are sent to /login?next=/specials.
const CLIENT_PAGE_PREFIXES = ['/app', '/quote', '/my-quotes', '/profile', '/specials'];
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

    // Google Search Console site-verification file: serve verbatim (no redirect
    // or HTML transform) so the check always sees the exact expected content.
    if (path === '/google705e17e34b2526c5.html') {
      return new Response('google-site-verification: google705e17e34b2526c5.html', {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (path.startsWith('/api/')) {
      try {
        return await handleApi(request, env, ctx, path);
      } catch (err) {
        // Last-resort boundary: never leak a stack trace or a bare 500 to the
        // client. Individual handlers still do their own error handling.
        console.error('API error', path, err && (err.stack || err.message || err));
        return json({ error: 'server_error', message: 'Something went wrong. Please try again.' }, 500);
      }
    }

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

    return serveAsset(request, env);
  },

  // Cron trigger: advance the CruiseFeed catalog import into D1. Resumable and
  // quota-aware, so a run is a no-op once the current snapshot is fully loaded.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      importCatalogStep(env, { maxPages: 8 }).catch((e) => console.error('catalog import', e))
    );
  },
};

// Serve a static asset, injecting the Cloudflare Web Analytics beacon into HTML
// pages when CF_BEACON_TOKEN is set (privacy-friendly, cookieless analytics).
async function serveAsset(request, env) {
  let res = await env.ASSETS.fetch(request);
  const ct = res.headers.get('content-type') || '';
  const isHtml = ct.includes('text/html');

  // First-touch lead attribution: the first time a visitor lands on any page
  // with UTM params (e.g. a link shared on Facebook), remember where they came
  // from in a cookie. It rides along until they submit a quote request, so the
  // admin can see which channel / person's link drove the lead. First-touch: we
  // only set it if not already present, so the original source wins.
  let setCookie = null;
  if (isHtml && !getCookie(request, 'cs_attr')) {
    const attr = attributionFromRequest(request);
    if (attr) {
      const value = encodeURIComponent(JSON.stringify(attr));
      // 90 days, path=/, Lax so it survives the normal same-site navigation.
      setCookie = `cs_attr=${value}; Path=/; Max-Age=7776000; SameSite=Lax`;
    }
  }

  const token = env.CF_BEACON_TOKEN;
  if (isHtml && token) {
    const beacon = `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token":"${token}"}'></script>`;
    res = new HTMLRewriter()
      .on('body', { element(el) { el.append(beacon, { html: true }); } })
      .transform(res);
  }

  if (!setCookie) return res;
  // Copy the response so we can attach the cookie (and keep it out of any shared
  // cache, since it now carries a per-visitor Set-Cookie).
  const out = new Response(res.body, res);
  out.headers.append('Set-Cookie', setCookie);
  out.headers.set('Cache-Control', 'private, no-store');
  return out;
}

// Read one cookie value from the request, or null.
function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

// Build a first-touch attribution object from the request's UTM params (and the
// referrer as a fallback source). Returns null when there's nothing to record.
function attributionFromRequest(request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  const g = (k) => { const v = p.get(k); return v ? String(v).slice(0, 200) : null; };
  const utm = {
    source: g('utm_source'),
    medium: g('utm_medium'),
    campaign: g('utm_campaign'),
    content: g('utm_content'),
    term: g('utm_term'),
  };
  const hasUtm = Object.values(utm).some(Boolean);
  const referer = request.headers.get('Referer') || '';
  let refHost = null;
  if (!hasUtm && referer) {
    try {
      const rh = new URL(referer).hostname.replace(/^www\./, '');
      // Ignore our own domain: only an external referrer is a real "source".
      if (rh && rh !== url.hostname.replace(/^www\./, '')) refHost = rh.slice(0, 120);
    } catch (_) {}
  }
  if (!hasUtm && !refHost) return null;
  return {
    ...utm,
    referrer: refHost,
    landing: (url.pathname + url.search).slice(0, 300),
    ts: Date.now(),
  };
}

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
  if (path === '/api/auth/forgot' && request.method === 'POST') return handleForgot(request, env, ctx);
  if (path === '/api/auth/reset' && request.method === 'POST') return handleReset(request, env);

  // Sailings data, public (browse without an account; no pricing is returned).
  // Backed entirely by CruiseFeed.
  if (path === '/api/sailings') {
    return handleSailingsCruiseFeed(request, env);
  }
  // Ship names for one cruise line (free reference), the "choose a ship"
  // dropdown. No metered catalog query.
  if (path === '/api/ships') {
    return handleShipsByLine(request, env);
  }
  if (path === '/api/cruise-lines' && request.method === 'GET') {
    return handleCruiseLines(request, env);
  }
  // Every departure date for one ship, the advisor special picker and the
  // client "Find a sailing" picker. Metered (high limit) but per-IP rate-limited.
  if (path === '/api/ship-dates') {
    return handleShipDates(request, env);
  }
  // Ship photos (Wikimedia), cached at the edge, used to illustrate result cards.
  if (path === '/api/ship-images' && request.method === 'POST') {
    return handleShipImages(request, env, ctx);
  }
  // AI cruise concierge, sentence -> filters -> catalog match (logged-in only).
  if (path === '/api/concierge') {
    return handleConcierge(request, env, ctx);
  }

  // Quote requests: clients create, advisors list.
  if (path === '/api/quotes' && request.method === 'POST') return handleCreateQuote(request, env, ctx);
  if (path === '/api/quotes' && request.method === 'GET') return handleListQuotes(request, env);
  if (path === '/api/advisor/leads/dismiss' && request.method === 'POST') return handleDismissLead(request, env);

  // Advisor quote offers (priced responses).
  if (path === '/api/advisor/offers' && request.method === 'POST') return handleCreateOffer(request, env, ctx);
  if (path === '/api/advisor/offers' && request.method === 'GET') return handleListOffers(request, env);
  if (path === '/api/advisor/offers/booking' && request.method === 'POST') return handleSetBooking(request, env);
  if (path === '/api/advisor/request' && request.method === 'GET') return handleGetRequest(request, env);
  if (path === '/api/advisor/profile' && request.method === 'POST') return handleUpdateAdvisorProfile(request, env);
  if (path === '/api/advisor/lines' && request.method === 'POST') return handleSetAdvisorLines(request, env);

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
  if (path === '/api/admin/advisor-specials-plan' && request.method === 'POST') return handleSetAdvisorSpecialsPlan(request, env);
  if (path === '/api/admin/clients' && request.method === 'GET') return handleListClients(request, env);
  if (path === '/api/admin/admins' && request.method === 'GET') return handleListAdmins(request, env);
  if (path === '/api/admin/add-admin' && request.method === 'POST') return handleAddAdmin(request, env, ctx);
  if (path === '/api/admin/reset-user' && request.method === 'POST') return handleResetUser(request, env);
  if (path === '/api/admin/requests' && request.method === 'GET') return handleListAllRequests(request, env);
  if (path === '/api/admin/request-archive' && request.method === 'POST') return handleAdminArchiveRequest(request, env);
  if (path === '/api/admin/request-delete' && request.method === 'POST') return handleAdminDeleteRequest(request, env);
  if (path === '/api/admin/offers' && request.method === 'GET') return handleListAllOffers(request, env);
  if (path === '/api/admin/offer-archive' && request.method === 'POST') return handleAdminArchiveOffer(request, env);
  if (path === '/api/admin/offer-delete' && request.method === 'POST') return handleAdminDeleteOffer(request, env);
  if (path === '/api/admin/specials' && request.method === 'GET') return handleAdminListSpecials(request, env);
  if (path === '/api/admin/special-archive' && request.method === 'POST') return handleAdminArchiveSpecial(request, env);
  if (path === '/api/admin/special-delete' && request.method === 'POST') return handleAdminDeleteSpecial(request, env);
  // advisor-status kept as an alias for the generalized user-status handler.
  if ((path === '/api/admin/user-status' || path === '/api/admin/advisor-status') && request.method === 'POST')
    return handleSetUserStatus(request, env);
  if (path === '/api/admin/user-delete' && request.method === 'POST') return handleDeleteUser(request, env);
  if (path === '/api/admin/email-test' && request.method === 'GET') return handleEmailTest(request, env);
  if (path === '/api/admin/concierge-stats' && request.method === 'GET') return handleConciergeStats(request, env);
  if (path === '/api/admin/bookings' && request.method === 'GET') return handleListBookings(request, env);
  if (path === '/api/admin/accepted-quotes' && request.method === 'GET') return handleAcceptedQuotes(request, env);
  if (path === '/api/admin/attribution-report' && request.method === 'GET') return handleAttributionReport(request, env);
  if (path === '/api/admin/agency-status' && request.method === 'POST') return handleSetAgencyStatus(request, env);
  if (path === '/api/admin/add-agency' && request.method === 'POST') return handleAdminAddAgency(request, env);
  if (path === '/api/admin/add-seat' && request.method === 'POST') return handleAdminAddSeat(request, env);
  // Catalog import (admin): trigger one import step or read its status. Lets an
  // admin kick off / advance the CruiseFeed -> D1 import without waiting for cron.
  if (path === '/api/admin/import-catalog' && request.method === 'POST') return handleImportCatalog(request, env);
  if (path === '/api/admin/import-status' && request.method === 'GET') return handleImportStatus(request, env);

  return json({ error: 'not_found' }, 404);
}

// Admin-only: run one bounded catalog import step (optionally ?force=1 and
// ?pages=N) and return progress. Safe to call repeatedly to advance the import.
async function handleImportCatalog(request, env) {
  const user = await getCurrentUser(request, env);
  if (!isAdmin(user, env)) return json({ error: 'forbidden' }, 403);
  const url = new URL(request.url);
  const force = url.searchParams.get('force') === '1';
  const maxPages = Math.min(Math.max(parseInt(url.searchParams.get('pages') || '8', 10) || 8, 1), 25);
  const result = await importCatalogStep(env, { maxPages, force });
  return json(result, result.ok ? 200 : 502);
}

async function handleImportStatus(request, env) {
  const user = await getCurrentUser(request, env);
  if (!isAdmin(user, env)) return json({ error: 'forbidden' }, 403);
  return json(await importStatus(env), 200);
}
