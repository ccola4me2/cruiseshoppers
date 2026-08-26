// Advisor reviews: a client can rate/review an advisor after accepting that
// advisor's quote. Ratings aggregate per advisor and surface on quotes,
// specials, and the quote email.

import { json } from './util.js';
import { getCurrentUser, isAdmin } from './auth.js';
import {
  findOfferById,
  findQuoteRequestById,
  upsertReview,
  listReviewsByAdvisor,
  getAdvisorRatings,
  listAllReviews,
  setReviewStatus,
} from './db.js';

// POST /api/reviews  { offer_id, rating, comment }, client reviews an advisor.
export async function handleCreateReview(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const offerId = String(body.offer_id || '').trim();
  const rating = Math.max(1, Math.min(5, parseInt(body.rating, 10) || 0));
  const comment = body.comment == null ? null : String(body.comment).trim().slice(0, 1200) || null;
  if (!offerId || rating < 1) return json({ error: 'invalid_request', message: 'A rating of 1 to 5 is required.' }, 400);

  const offer = await findOfferById(env.DB, offerId);
  if (!offer) return json({ error: 'not_found' }, 404);
  if (offer.status !== 'accepted') {
    return json({ error: 'not_accepted', message: 'You can review an advisor after you accept their quote.' }, 403);
  }
  const req = await findQuoteRequestById(env.DB, offer.quote_request_id);
  if (!req || req.user_id !== user.id) return json({ error: 'forbidden' }, 403);

  try {
    await upsertReview(env.DB, {
      id: crypto.randomUUID(),
      advisor_id: offer.advisor_id,
      client_id: user.id,
      offer_id: offerId,
      rating,
      comment,
    });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Reviews are not set up yet. The database migration (0012) still needs to be applied.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not save your review. Please try again.' }, 500);
  }
  return json({ ok: true, rating, comment }, 200);
}

// GET /api/advisor/reviews, the advisor's own rating + reviews.
export async function handleListAdvisorReviews(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  const rows = await listReviewsByAdvisor(env.DB, user.id, 100);
  const ratings = await getAdvisorRatings(env.DB, [user.id]);
  const reviews = rows.map((r) => ({ rating: r.rating, comment: r.comment, created_at: r.created_at }));
  return json({ summary: ratings[user.id] || { avg: 0, count: 0 }, reviews }, 200);
}

// GET /api/admin/reviews, all reviews (admin moderation).
export async function handleAdminListReviews(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user || !isAdmin(user, env)) return json({ error: 'forbidden' }, 403);
  const rows = await listAllReviews(env.DB, 300);
  const reviews = rows.map((r) => ({
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    created_at: r.created_at,
    advisor: [r.advisor_first, r.advisor_last].filter(Boolean).join(' ') || 'Advisor',
    client: [r.client_first, r.client_last].filter(Boolean).join(' ') || 'Client',
  }));
  return json({ reviews, count: reviews.length }, 200);
}

// POST /api/admin/reviews/status  { id, status }, hide/show a review.
export async function handleAdminSetReviewStatus(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user || !isAdmin(user, env)) return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const id = String(body.id || '').trim();
  const status = body.status === 'hidden' ? 'hidden' : 'visible';
  if (!id) return json({ error: 'invalid_request' }, 400);
  await setReviewStatus(env.DB, id, status);
  return json({ ok: true, status }, 200);
}
