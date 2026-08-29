// Quote requests (leads): clients create them, advisors list them.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import {
  createQuoteRequest,
  listQuoteRequests,
  listAllRequests,
  findQuoteRequestById,
  listRequestsForClient,
  findSpecialById,
  findUserById,
  createQuoteOffer,
  listQuoteOffersByAdvisor,
  listOffersForClient,
  findOfferById,
  updateOfferStatus,
  declineSiblingOffers,
  setRequoteReason,
  listSiblingActiveOffers,
  setOfferBooking,
  listActiveAdvisorEmails,
  listActiveAdvisorLinePrefs,
  createMessage,
  listMessagesByOffer,
  setLastRead,
  getUnreadCounts,
  getAdvisorRatings,
  getReviewByClientAdvisor,
  dismissLeadForAdvisor,
  listDismissedLeadIds,
} from './db.js';
import { sendAdminNotice, sendQuoteToClient, sendQuoteAccepted, sendQuoteResponse, sendQuoteNotSelected, sendAdvisorNewRequest, sendNewMessage, sendRequestReceived } from './email.js';

// POST /api/quotes  (authenticated client), save a quote request.
// Body: the selected sailing fields + optional note. Contact info is taken
// from the logged-in user's account (not trusted from the client).
export async function handleCreateQuote(request, env, ctx) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }

  const s = body.sailing || {};
  const clip = (v, n = 400) => (v == null ? null : String(v).slice(0, n));

  const cabins = clip(body.cabins, 60);
  const guests = clip(body.guests, 60);
  const noteParts = [];
  if (guests) noteParts.push(`Guests: ${guests}`);
  if (cabins) noteParts.push(`Cabins: ${cabins}`);
  if (body.notes) noteParts.push(String(body.notes).slice(0, 1000));
  const combinedNotes = noteParts.join(' | ') || null;

  let itinerary = null;
  try {
    if (Array.isArray(s.itinerary)) itinerary = JSON.stringify(s.itinerary).slice(0, 6000);
  } catch {}

  // Structured cabin types the client is interested in (for per-cabin quoting).
  let cabinTypes = null;
  if (Array.isArray(body.cabin_types)) {
    const clean = body.cabin_types
      .filter((t) => typeof t === 'string' && t.trim())
      .slice(0, 8)
      .map((t) => t.trim().slice(0, 40));
    if (clean.length) cabinTypes = JSON.stringify(clean);
  }

  // If this request originated from a special, route it only to the posting
  // advisor. Trust the special record for the target, not the client payload.
  let specialId = null;
  let targetAdvisorId = null;
  const rawSpecialId = clip(s.special_id || body.special_id, 60);
  if (rawSpecialId) {
    const special = await findSpecialById(env.DB, rawSpecialId);
    if (special && special.status === 'active') {
      // Only lock the lead to the posting advisor if they're still an active
      // advisor. If they've since been suspended/removed, a locked lead would
      // be invisible to everyone (they can't open it, and it's filtered from
      // every other advisor), so fall back to a normal broadcast lead.
      const advisor = await findUserById(env.DB, special.advisor_id).catch(() => null);
      const advisorOk = advisor && advisor.role === 'advisor' && (advisor.status === 'active' || advisor.status == null);
      if (advisorOk) {
        specialId = special.id;
        targetAdvisorId = special.advisor_id;
      }
    }
  }

  const q = await createQuoteRequest(env.DB, {
    id: crypto.randomUUID(),
    user_id: user.id,
    first_name: clip(body.first_name, 100) || user.first_name,
    last_name: clip(body.last_name, 100) || user.last_name,
    email: user.email,
    phone: clip(body.phone, 40) || user.phone,
    sailing_name: clip(s.name),
    cruise_line: clip(s.line),
    ship: clip(s.ship),
    sailing_dates: clip(s.sailing_dates || s.depart_date),
    departure_port: clip(s.departure_port),
    destination: clip(s.destination),
    itinerary,
    notes: combinedNotes,
    special_id: specialId,
    target_advisor_id: targetAdvisorId,
    cabin_types: cabinTypes,
  });

  // Notify the operators of the new lead (best-effort, in the background).
  const clientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '(no name)';
  const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  // Client + trip rows go in the table; the client's own answers (cabins,
  // ages, cabin types, discounts, etc.) render as a separate line-by-line block.
  const detailRows = [
    ['Client', clientName],
    ['Email', q.email],
    ['Phone', q.phone],
    ['Cruise line', q.cruise_line],
    ['Ship', q.ship],
    ['Sailing', q.sailing_name],
    ['Dates', q.sailing_dates],
    ['Departs', q.departure_port],
    ['Destination', q.destination],
  ];
  const notice = {
    subject: `New quote request: ${q.sailing_name || q.destination || 'cruise'}`,
    title: 'New quote request (lead)',
    intro: 'A client requested a personalized quote.',
    rows: detailRows,
    notes: q.notes,
    ctaUrl: `${base}/advisor`,
    ctaText: 'View leads',
  };
  const send = sendAdminNotice(env, notice).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);

  // Notify advisors so they can price this request (best-effort). A special is
  // routed only to the advisor who posted it; otherwise all active advisors.
  const notifyAdvisors = (async () => {
    try {
      let advisors;
      if (targetAdvisorId) {
        const adv = await findUserById(env.DB, targetAdvisorId);
        advisors = adv && adv.email ? [adv.email] : [];
      } else {
        // Only email advisors who follow this cruise line (an empty preference
        // means they follow all lines).
        const prefs = await listActiveAdvisorLinePrefs(env.DB);
        advisors = prefs
          .filter((a) => !a.preferred_lines.length || lineMatchesAny(q.cruise_line, a.preferred_lines))
          .map((a) => a.email);
      }
      if (!advisors.length) return;
      // Advisors receive an anonymized request: no client name/email/phone.
      const advisorRows = detailRows.filter(([k]) => !['Client', 'Email', 'Phone'].includes(k));
      advisorRows.unshift(['Request', String(q.id).slice(0, 8).toUpperCase()]);
      await sendAdvisorNewRequest(env, {
        advisors,
        rows: advisorRows,
        notes: q.notes,
        clientName: null,
        quoteUrl: `${base}/advisor?request=${encodeURIComponent(q.id)}`,
      });
    } catch (_) {}
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notifyAdvisors);

  // Confirm to the client that we received the request (best-effort).
  if (q.email) {
    const sailing = [q.cruise_line, q.ship, q.sailing_name, q.sailing_dates,
      q.departure_port ? `Departs ${q.departure_port}` : '']
      .filter(Boolean).join(' | ');
    const confirmP = sendRequestReceived(env, {
      to: q.email,
      firstName: q.first_name,
      sailing,
      quotesUrl: `${base}/my-quotes`,
    }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(confirmP);
  }

  return json({ ok: true, id: q.id }, 201);
}

// GET /api/advisor/request?id=  (active advisor), one request, so an advisor
// arriving from a new-request email can open and price it.
export async function handleGetRequest(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') return json({ error: 'pending_approval' }, 403);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: 'invalid_request' }, 400);
  const r = await findQuoteRequestById(env.DB, id);
  if (!r) return json({ error: 'not_found' }, 404);
  // Requests that came from a special are reserved for the advisor who posted
  // it, other advisors must not be able to read the lead's trip details.
  if (r.target_advisor_id && r.target_advisor_id !== user.id) {
    return json({ error: 'not_found' }, 404);
  }
  return json({
    request: {
      id: r.id,
      ref: String(r.id).slice(0, 8).toUpperCase(),
      cruise_line: r.cruise_line,
      ship: r.ship,
      sailing_name: r.sailing_name,
      sailing_dates: r.sailing_dates,
      departure_port: r.departure_port,
      destination: r.destination,
      notes: r.notes,
      created_at: r.created_at,
    },
  }, 200);
}

// POST /api/advisor/offers  (active advisor), submit a priced quote on a request.
export async function handleCreateOffer(request, env, ctx) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') {
    return json({ error: 'pending_approval', message: 'Your advisor account is awaiting approval.' }, 403);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }

  const rid = String(body.quote_request_id || '').trim();
  if (!rid) return json({ error: 'invalid_request', message: 'Missing quote request.' }, 400);
  const req = await findQuoteRequestById(env.DB, rid);
  if (!req) return json({ error: 'not_found', message: 'That request no longer exists.' }, 404);

  // Requests that came from a special are reserved for the advisor who posted
  // it, only they may quote it.
  if (req.target_advisor_id && req.target_advisor_id !== user.id) {
    return json({ error: 'forbidden', message: 'This request is reserved for the advisor who posted the special.' }, 403);
  }

  const clip = (v, n = 2000) => (v == null ? null : String(v).slice(0, n));
  // Numeric all-in total (headline + basis for the Best-value ranking).
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
  };
  // Per-cabin-type fares: [{ type, fare }] when the client requested multiple
  // cabin types and the advisor priced each one.
  let cabinFares = null;
  const cf = Array.isArray(body.cabin_fares) ? body.cabin_fares : [];
  const cleanFares = cf
    .map((c) => ({ type: String((c && c.type) || '').trim().slice(0, 40), fare: num(c && c.fare) }))
    .filter((c) => c.type && c.fare != null && c.fare > 0)
    .slice(0, 8);
  if (cleanFares.length) cabinFares = JSON.stringify(cleanFares);

  // Numeric all-in total. If only per-cabin fares were given, use the lowest as
  // the headline ("from") amount.
  let total_price = num(body.total_price);
  if (total_price == null && cleanFares.length) {
    total_price = Math.min(...cleanFares.map((c) => c.fare));
  }
  // Keep the legacy free-text `price` in sync so emails/admin/lists still show
  // an amount. Prefer the numeric total; fall back to any free-text price sent.
  const price = total_price != null ? String(total_price) : clip(body.price, 120);
  if (!price) return json({ error: 'missing_price', message: 'A total fare is required.' }, 400);

  const offer = await createQuoteOffer(env.DB, {
    id: crypto.randomUUID(),
    quote_request_id: rid,
    advisor_id: user.id,
    advisor_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
    advisor_email: user.email,
    advisor_phone: user.phone || null,
    advisor_hours: user.hours || null,
    price,
    total_price,
    specials: clip(body.specials),
    additional_info: clip(body.additional_info),
    base_fare: num(body.base_fare),
    taxes_fees: num(body.taxes_fees),
    obc_amount: num(body.obc_amount),
    gratuities_included: body.gratuities_included == null ? null : (body.gratuities_included ? 1 : 0),
    deposit_amount: num(body.deposit_amount),
    // Store an ISO date (YYYY-MM-DD) only; ignore anything else.
    final_payment_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.final_payment_date || '').trim())
      ? String(body.final_payment_date).trim() : null,
    cabin_fares: cabinFares,
  });

  // Notify the client that a quote is ready (best-effort, in the background).
  if (req.email) {
    const advisorRatings = await getAdvisorRatings(env.DB, [user.id]);
    const advisorRt = advisorRatings[user.id];
    const sailing = [req.cruise_line, req.ship, req.sailing_name, req.sailing_dates,
      req.departure_port ? `Departs ${req.departure_port}` : '']
      .filter(Boolean).join(' | ');
    const emailP = sendQuoteToClient(env, {
      to: req.email,
      clientName: req.first_name,
      advisorName: offer.advisor_name,
      agency: user.agency,
      location: user.location,
      advisorEmail: offer.advisor_email,
      advisorPhone: user.phone,
      advisorHours: user.hours,
      advisorBio: user.bio,
      advisorRating: advisorRt ? advisorRt.avg : null,
      advisorReviewCount: advisorRt ? advisorRt.count : 0,
      sailing,
      price: offer.price,
      specials: offer.specials,
      additionalInfo: offer.additional_info,
      quotesUrl: new URL('/my-quotes', request.url).toString(),
    }).catch(() => {});
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(emailP);
  }

  return json({ ok: true, id: offer.id, created_at: offer.created_at }, 201);
}

// GET /api/my/quotes  (authenticated client), quotes advisors submitted on
// this client's own requests.
export async function handleListMyQuotes(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const rows = await listOffersForClient(env.DB, user.id, 200);
  const quotes = rows.map((r) => {
    let prof = r.advisor_profile_json;
    if (typeof prof === 'string') { try { prof = JSON.parse(prof); } catch { prof = null; } }
    prof = prof || {};
    return {
      id: r.id,
      quote_request_id: r.quote_request_id,
      price: r.price,
      total_price: r.total_price != null ? Number(r.total_price) : null,
      specials: r.specials,
      additional_info: r.additional_info,
      base_fare: r.base_fare != null ? Number(r.base_fare) : null,
      taxes_fees: r.taxes_fees != null ? Number(r.taxes_fees) : null,
      obc_amount: r.obc_amount != null ? Number(r.obc_amount) : null,
      gratuities_included: r.gratuities_included == null ? null : (r.gratuities_included ? 1 : 0),
      deposit_amount: r.deposit_amount != null ? Number(r.deposit_amount) : null,
      final_payment_date: r.final_payment_date || null,
      cabin_fares: safeParse(r.cabin_fares) || null,
      advisor_name: r.advisor_name,
      advisor_email: r.advisor_email,
      advisor_phone: r.advisor_phone || r.advisor_phone_live || null,
      advisor_hours: r.advisor_hours || prof.hours || null,
      advisor_agency: prof.agency || null,
      advisor_location: prof.location || null,
      advisor_bio: prof.bio || null,
      status: r.status,
      created_at: r.created_at,
      sailing_name: r.sailing_name,
      cruise_line: r.cruise_line,
      ship: r.ship,
      sailing_dates: r.sailing_dates,
      departure_port: r.departure_port,
      destination: r.destination,
      booking_status: r.booking_status || null,
    };
  });
  const unread = await getUnreadCounts(env.DB, user.id, quotes.map((q) => q.id));
  for (const q of quotes) q.unread = unread[q.id] || 0;

  // Attach each advisor's rating, and let the client review after acceptance.
  const advisorIds = [...new Set(rows.map((r) => r.advisor_id).filter(Boolean))];
  const ratings = await getAdvisorRatings(env.DB, advisorIds);
  for (let i = 0; i < quotes.length; i++) {
    const advId = rows[i].advisor_id;
    const rt = ratings[advId];
    quotes[i].advisor_rating = rt ? rt.avg : null;
    quotes[i].advisor_review_count = rt ? rt.count : 0;
    if (quotes[i].status === 'accepted') {
      quotes[i].can_review = true;
      const existing = await getReviewByClientAdvisor(env.DB, user.id, advId);
      quotes[i].my_review = existing ? { rating: existing.rating, comment: existing.comment } : null;
    }
  }

  // Also return the client's own requests, so requests still awaiting quotes show.
  const reqRows = await listRequestsForClient(env.DB, user.id, 200);
  const requests = reqRows.map((r) => ({
    id: r.id,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    created_at: r.created_at,
  }));
  return json({ quotes, requests, count: quotes.length }, 200);
}

// POST /api/my/quotes/respond  (authenticated client)
// Body: { offer_id, action: 'accept'|'decline'|'requote'|'hold'|'release', reason? }.
// requote requires a reason (sent to the advisor). hold/release are reversible,
// private "still deciding" markers that don't notify the advisor.
export async function handleRespondQuote(request, env, ctx) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const offerId = String(body.offer_id || '').trim();
  const action = String(body.action || 'accept').trim().toLowerCase();
  // hold = "still deciding" (reversible), release = undo a hold back to open.
  const STATUS = { accept: 'accepted', decline: 'declined', requote: 'requote', hold: 'hold', release: 'submitted' };
  if (!offerId || !STATUS[action]) return json({ error: 'invalid_request' }, 400);

  const offer = await findOfferById(env.DB, offerId);
  if (!offer) return json({ error: 'not_found' }, 404);
  const req = await findQuoteRequestById(env.DB, offer.quote_request_id);
  if (!req || req.user_id !== user.id) return json({ error: 'forbidden' }, 403);

  // A finalized quote (accepted/declined) can't be changed further.
  if (offer.status === 'accepted' || offer.status === 'declined') {
    return json({ error: 'already_final', message: 'This quote has already been closed.' }, 409);
  }
  // A revision request must explain what to change, or the advisor can't act on it.
  const reason = body.reason == null ? null : String(body.reason).slice(0, 1000).trim() || null;
  if (action === 'requote' && !reason) {
    return json({ error: 'reason_required', message: 'Please tell the advisor what you would like revised.' }, 400);
  }

  const status = STATUS[action];
  const sailing = [req.cruise_line, req.ship, req.sailing_name, req.sailing_dates].filter(Boolean).join(' | ');
  const clientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;

  // On accept, capture the other advisors' active quotes (they just lost)
  // before declining them, so we can email each one.
  let losers = [];
  if (action === 'accept') {
    losers = await listSiblingActiveOffers(env.DB, offer.quote_request_id, offerId);
    await declineSiblingOffers(env.DB, offer.quote_request_id, offerId);
  }
  await updateOfferStatus(env.DB, offerId, status);
  if (action === 'requote') { try { await setRequoteReason(env.DB, offerId, reason); } catch (_) {} }

  // Notify the advisor of the decision (best-effort). Hold/release are private
  // "still deciding" markers, no advisor email.
  if (offer.advisor_email && action !== 'hold' && action !== 'release') {
    let p;
    if (action === 'accept') {
      p = sendQuoteAccepted(env, { to: offer.advisor_email, advisorName: offer.advisor_name, clientName, clientEmail: user.email, sailing, price: offer.price });
    } else {
      p = sendQuoteResponse(env, { to: offer.advisor_email, advisorName: offer.advisor_name, clientName, sailing, action, reason });
    }
    if (p && ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p.catch(() => {}));
  }

  // Email the advisors who were not selected (best-effort, deduped).
  if (action === 'accept' && losers.length) {
    const seen = new Set([String(offer.advisor_email || '').toLowerCase()]);
    const loserP = (async () => {
      for (const l of losers) {
        const em = String(l.advisor_email || '').toLowerCase();
        if (!em || seen.has(em)) continue;
        seen.add(em);
        try { await sendQuoteNotSelected(env, { to: l.advisor_email, advisorName: l.advisor_name, sailing }); } catch (_) {}
      }
    })();
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(loserP);
  }

  return json({ ok: true, id: offerId, status }, 200);
}

// Resolve who can see/post messages on an offer: the client who owns the
// request, or the advisor who made the offer.
async function threadContext(env, user, offerId) {
  const offer = await findOfferById(env.DB, offerId);
  if (!offer) return { error: json({ error: 'not_found' }, 404) };
  const req = await findQuoteRequestById(env.DB, offer.quote_request_id);
  if (!req) return { error: json({ error: 'not_found' }, 404) };
  const isClient = req.user_id === user.id;
  const isAdvisor = offer.advisor_id === user.id;
  if (!isClient && !isAdvisor) return { error: json({ error: 'forbidden' }, 403) };
  return { offer, req, isClient, isAdvisor };
}

// GET /api/messages?offer_id=, messages on an accepted quote (participants only).
export async function handleListMessages(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  const offerId = (new URL(request.url).searchParams.get('offer_id') || '').trim();
  if (!offerId) return json({ error: 'invalid_request' }, 400);
  const c = await threadContext(env, user, offerId);
  if (c.error) return c.error;
  const rows = await listMessagesByOffer(env.DB, offerId);
  const messages = rows.map((r) => ({
    id: r.id, sender_role: r.sender_role, sender_name: r.sender_name,
    body: r.body, created_at: r.created_at, mine: r.sender_id === user.id,
  }));
  // Opening the thread marks it read for this user.
  await setLastRead(env.DB, offerId, user.id, Date.now());
  return json({ messages, count: messages.length }, 200);
}

// POST /api/messages  { offer_id, body }, post a message (participants only).
export async function handleCreateMessage(request, env, ctx) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const offerId = String(body.offer_id || '').trim();
  const text = String(body.body || '').trim().slice(0, 4000);
  if (!offerId || !text) return json({ error: 'invalid_request', message: 'A message is required.' }, 400);

  const c = await threadContext(env, user, offerId);
  if (c.error) return c.error;
  if (c.offer.status !== 'accepted') {
    return json({ error: 'not_accepted', message: 'Messaging opens once the quote is accepted.' }, 403);
  }

  const senderRole = c.isAdvisor ? 'advisor' : 'client';
  const senderName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  const msg = await createMessage(env.DB, {
    id: crypto.randomUUID(),
    offer_id: offerId,
    sender_id: user.id,
    sender_role: senderRole,
    sender_name: senderName,
    body: text,
  });

  // Notify the other party (best-effort).
  const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const sailing = [c.req.cruise_line, c.req.ship, c.req.sailing_name].filter(Boolean).join(' | ');
  const preview = text.slice(0, 160);
  let notify = null;
  if (senderRole === 'client' && c.offer.advisor_email) {
    notify = sendNewMessage(env, { to: c.offer.advisor_email, toName: c.offer.advisor_name, fromName: senderName, sailing, preview, url: `${base}/advisor` });
  } else if (senderRole === 'advisor' && c.req.email) {
    notify = sendNewMessage(env, { to: c.req.email, toName: c.req.first_name, fromName: senderName, sailing, preview, url: `${base}/my-quotes` });
  }
  if (notify && ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notify.catch(() => {}));

  return json({ ok: true, id: msg.id, created_at: msg.created_at, sender_role: senderRole, sender_name: senderName, mine: true }, 201);
}

// POST /api/advisor/offers/booking  (advisor), record booked / not booked.
export async function handleSetBooking(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const offerId = String(body.offer_id || '').trim();
  const status = body.status === 'booked' ? 'booked' : body.status === 'not_booked' ? 'not_booked' : null;
  if (!offerId || !status) return json({ error: 'invalid_request' }, 400);
  const offer = await findOfferById(env.DB, offerId);
  if (!offer || offer.advisor_id !== user.id) return json({ error: 'not_found' }, 404);
  if (offer.status !== 'accepted') {
    return json({ error: 'not_accepted', message: 'You can record a booking only after the client accepts your quote.' }, 403);
  }
  const clip = (v, n = 120) => (v == null ? null : String(v).trim().slice(0, n) || null);
  const num = (v) => {
    if (v == null || v === '') return null;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isFinite(n) ? n : null;
  };
  const fareType = body.fare_type === 'net_rate' ? 'net_rate' : body.fare_type === 'commissionable' ? 'commissionable' : null;
  const cruiseFare = num(body.cruise_fare);
  const addonsHigh = num(body.addons_high);
  const addonsLow = num(body.addons_low);
  // Total booked = cruise fare + add-ons (kept in booking_amount for display).
  const total = status === 'booked' && (cruiseFare != null || addonsHigh != null || addonsLow != null)
    ? (cruiseFare || 0) + (addonsHigh || 0) + (addonsLow || 0)
    : num(body.amount);
  try {
    await setOfferBooking(env.DB, offerId, user.id, {
      status,
      amount: total,
      ref: clip(body.ref, 80),
      passengers: clip(body.passengers, 200),
      invoice: clip(body.invoice, 80),
      fare_type: fareType,
      cruise_fare: cruiseFare,
      addons_high: addonsHigh,
      addons_low: addonsLow,
    });
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such column|no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'Booking tracking is not set up yet. The database migration (0013) still needs to be applied.' }, 503);
    }
    return json({ error: 'save_failed', message: 'Could not save. Please try again.' }, 500);
  }
  return json({ ok: true, booking_status: status }, 200);
}

// GET /api/advisor/offers  (active advisor), the advisor's own submitted quotes.
export async function handleListOffers(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') return json({ error: 'pending_approval' }, 403);

  const rows = await listQuoteOffersByAdvisor(env.DB, user.id, 300);
  const offers = rows.map((r) => {
    // The client stays anonymous until they accept this advisor's quote.
    const revealed = r.status === 'accepted';
    return {
      id: r.id,
      quote_request_id: r.quote_request_id,
      price: r.price,
      specials: r.specials,
      additional_info: r.additional_info,
      // "hold" is the client's private "still deciding" marker — the advisor
      // just sees it as an open (submitted) quote, not that the client paused on it.
      status: r.status === 'hold' ? 'submitted' : r.status,
      requote_reason: r.requote_reason || null,
      created_at: r.created_at,
      sailing_name: r.sailing_name,
      cruise_line: r.cruise_line,
      ship: r.ship,
      sailing_dates: r.sailing_dates,
      departure_port: r.departure_port,
      destination: r.destination,
      client_revealed: revealed,
      client_first: revealed ? r.client_first : null,
      client_last: revealed ? r.client_last : null,
      client_email: revealed ? r.client_email : null,
      booking_status: r.booking_status || null,
      booking_amount: r.booking_amount || null,
      booking_ref: r.booking_ref || null,
      booking_passengers: r.booking_passengers || null,
      booking_invoice: r.booking_invoice || null,
      booking_fare_type: r.booking_fare_type || null,
      booking_cruise_fare: r.booking_cruise_fare != null ? Number(r.booking_cruise_fare) : null,
      booking_addons_high: r.booking_addons_high != null ? Number(r.booking_addons_high) : null,
      booking_addons_low: r.booking_addons_low != null ? Number(r.booking_addons_low) : null,
    };
  });
  const unread = await getUnreadCounts(env.DB, user.id, offers.map((o) => o.id));
  for (const o of offers) o.unread = unread[o.id] || 0;
  return json({ offers, count: offers.length }, 200);
}

// GET /api/quotes  (authenticated advisor), list all leads.
export async function handleListQuotes(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') {
    return json(
      { error: 'pending_approval', message: 'Your advisor account is awaiting approval.' },
      403
    );
  }

  // Includes offer/accepted counts so the portal can mark requests closed.
  // A request tied to a special is visible only to the advisor who posted it,
  // and requests this advisor passed on ("No quote") are hidden for good.
  const rows = await listAllRequests(env.DB, 300);
  const dismissed = await listDismissedLeadIds(env.DB, user.id);
  const visible = rows.filter(
    (r) =>
      !r.archived_at && // an admin archived/removed it, hide from advisors
      (!r.target_advisor_id || r.target_advisor_id === user.id) &&
      !dismissed.has(r.id)
  );
  // Leads are anonymous to advisors: no client name/email/phone until the
  // client accepts a quote. Only a short reference is exposed.
  const leads = visible.map((r) => ({
    id: r.id,
    ref: String(r.id).slice(0, 8).toUpperCase(),
    created_at: r.created_at,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    notes: r.notes,
    itinerary: safeParse(r.itinerary),
    cabin_types: safeParse(r.cabin_types) || [],
    // This lead came from THIS advisor's own special (leads are already filtered
    // to the posting advisor via target_advisor_id), so flag it in the portal.
    is_special: !!(r.special_id && r.target_advisor_id === user.id),
    // Deliberately NOT exposing offer_count: an advisor must never see how many
    // other advisors quoted, or their prices, only their own quotes.
    closed: (r.accepted_count || 0) > 0,
  }));

  // Every cruise line present in this advisor's leads, so the portal can offer
  // the full choice list even after we filter the leads down below.
  const allLines = [...new Set(leads.map((l) => l.cruise_line).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));

  // The advisor can choose which cruise lines to follow; leads for other lines
  // are hidden. An empty selection means "all lines".
  const preferred = Array.isArray(user.preferred_lines) ? user.preferred_lines : [];
  const filtered = preferred.length
    ? leads.filter((l) => lineMatchesAny(l.cruise_line, preferred))
    : leads;

  return json({
    leads: filtered,
    count: filtered.length,
    all_lines: allLines,
    preferred_lines: preferred,
  }, 200);
}

// Loose cruise-line match: case-insensitive, punctuation-insensitive, and
// prefix-tolerant so "Royal Caribbean" matches "Royal Caribbean International".
function lineNorm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, '');
}
function lineMatchesAny(line, list) {
  const a = lineNorm(line);
  if (!a) return false;
  return (list || []).some((sel) => {
    const b = lineNorm(sel);
    return b && (a === b || a.startsWith(b) || b.startsWith(a));
  });
}

// POST /api/advisor/leads/dismiss  (active advisor), pass on a request. It's
// hidden from this advisor's portal permanently; other advisors are unaffected.
export async function handleDismissLead(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') return json({ error: 'pending_approval' }, 403);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const rid = String(body.quote_request_id || '').trim();
  if (!rid) return json({ error: 'invalid_request', message: 'Missing quote request.' }, 400);

  const req = await findQuoteRequestById(env.DB, rid);
  if (!req) return json({ error: 'not_found' }, 404);

  try {
    await dismissLeadForAdvisor(env.DB, user.id, rid);
  } catch (e) {
    const msg = String((e && e.message) || '');
    if (/no such table/i.test(msg)) {
      return json({ error: 'not_migrated', message: 'This feature is not set up yet. Apply migration 0035 (advisor_lead_dismissals) in the D1 console.' }, 503);
    }
    return json({ error: 'save_failed', message: `Could not pass on this request: ${msg.slice(0, 200)}` }, 500);
  }
  return json({ ok: true }, 200);
}

function safeParse(s) {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
