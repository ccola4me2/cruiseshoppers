// Quote requests (leads): clients create them, advisors list them.

import { json } from './util.js';
import { getCurrentUser } from './auth.js';
import {
  createQuoteRequest,
  listQuoteRequests,
  listAllRequests,
  findQuoteRequestById,
  listRequestsForClient,
  createQuoteOffer,
  listQuoteOffersByAdvisor,
  listOffersForClient,
  findOfferById,
  updateOfferStatus,
  declineSiblingOffers,
  listActiveAdvisorEmails,
  createMessage,
  listMessagesByOffer,
  setLastRead,
  getUnreadCounts,
} from './db.js';
import { sendAdminNotice, sendQuoteToClient, sendQuoteAccepted, sendQuoteResponse, sendAdvisorNewRequest, sendNewMessage } from './email.js';

// POST /api/quotes  (authenticated client) — save a quote request.
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
  });

  // Notify the operators of the new lead (best-effort, in the background).
  const clientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || '(no name)';
  const base = (env.APP_URL || new URL(request.url).origin).replace(/\/$/, '');
  const notice = {
    subject: `New quote request: ${q.sailing_name || q.destination || 'cruise'}`,
    title: 'New quote request (lead)',
    intro: 'A client requested a personalized quote.',
    rows: [
      ['Client', clientName],
      ['Email', q.email],
      ['Phone', q.phone],
      ['Cruise line', q.cruise_line],
      ['Ship', q.ship],
      ['Sailing', q.sailing_name],
      ['Dates', q.sailing_dates],
      ['Departs', q.departure_port],
      ['Destination', q.destination],
      ['Notes', q.notes],
    ],
    ctaUrl: `${base}/advisor`,
    ctaText: 'View leads',
  };
  const send = sendAdminNotice(env, notice).catch(() => {});
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(send);

  // Notify approved advisors so they can price this request (best-effort).
  const notifyAdvisors = (async () => {
    try {
      const advisors = await listActiveAdvisorEmails(env.DB);
      if (!advisors.length) return;
      const sailing = [q.cruise_line, q.ship, q.sailing_name, q.sailing_dates,
        q.departure_port ? `Departs ${q.departure_port}` : '']
        .filter(Boolean).join(' | ');
      await sendAdvisorNewRequest(env, {
        advisors,
        sailing,
        clientName,
        quoteUrl: `${base}/advisor?request=${encodeURIComponent(q.id)}`,
      });
    } catch (_) {}
  })();
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(notifyAdvisors);

  return json({ ok: true, id: q.id }, 201);
}

// GET /api/advisor/request?id=  (active advisor) — one request, so an advisor
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
  return json({
    request: {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      email: r.email,
      phone: r.phone,
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

// POST /api/advisor/offers  (active advisor) — submit a priced quote on a request.
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

  const clip = (v, n = 2000) => (v == null ? null : String(v).slice(0, n));
  const price = clip(body.price, 120);
  if (!price) return json({ error: 'missing_price', message: 'A price is required.' }, 400);

  const offer = await createQuoteOffer(env.DB, {
    id: crypto.randomUUID(),
    quote_request_id: rid,
    advisor_id: user.id,
    advisor_name: [user.first_name, user.last_name].filter(Boolean).join(' ') || null,
    advisor_email: user.email,
    advisor_phone: user.phone || null,
    advisor_hours: user.hours || null,
    price,
    specials: clip(body.specials),
    additional_info: clip(body.additional_info),
  });

  // Notify the client that a quote is ready (best-effort, in the background).
  if (req.email) {
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

// GET /api/my/quotes  (authenticated client) — quotes advisors submitted on
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
      specials: r.specials,
      additional_info: r.additional_info,
      advisor_name: r.advisor_name,
      advisor_email: r.advisor_email,
      advisor_phone: r.advisor_phone || r.advisor_phone_live || null,
      advisor_hours: r.advisor_hours || prof.hours || null,
      advisor_agency: prof.agency || null,
      advisor_location: prof.location || null,
      status: r.status,
      created_at: r.created_at,
      sailing_name: r.sailing_name,
      cruise_line: r.cruise_line,
      ship: r.ship,
      sailing_dates: r.sailing_dates,
      departure_port: r.departure_port,
      destination: r.destination,
    };
  });
  const unread = await getUnreadCounts(env.DB, user.id, quotes.map((q) => q.id));
  for (const q of quotes) q.unread = unread[q.id] || 0;

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
// Body: { offer_id, action: 'accept' | 'decline' | 'requote' }.
export async function handleRespondQuote(request, env, ctx) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  let body;
  try { body = await request.json(); } catch { return json({ error: 'invalid_request' }, 400); }
  const offerId = String(body.offer_id || '').trim();
  const action = String(body.action || 'accept').trim().toLowerCase();
  if (!offerId || !['accept', 'decline', 'requote'].includes(action)) {
    return json({ error: 'invalid_request' }, 400);
  }

  const offer = await findOfferById(env.DB, offerId);
  if (!offer) return json({ error: 'not_found' }, 404);
  const req = await findQuoteRequestById(env.DB, offer.quote_request_id);
  if (!req || req.user_id !== user.id) return json({ error: 'forbidden' }, 403);

  const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : 'requote';
  await updateOfferStatus(env.DB, offerId, status);
  if (action === 'accept') {
    // Accepting closes the request: other quotes are no longer selectable.
    await declineSiblingOffers(env.DB, offer.quote_request_id, offerId);
  }

  // Notify the advisor of the client's decision (best-effort).
  if (offer.advisor_email) {
    const clientName = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
    const sailing = [req.cruise_line, req.ship, req.sailing_name, req.sailing_dates].filter(Boolean).join(' | ');
    let p;
    if (action === 'accept') {
      p = sendQuoteAccepted(env, { to: offer.advisor_email, advisorName: offer.advisor_name, clientName, clientEmail: user.email, sailing, price: offer.price });
    } else {
      p = sendQuoteResponse(env, { to: offer.advisor_email, advisorName: offer.advisor_name, clientName, sailing, action });
    }
    if (p && ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p.catch(() => {}));
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

// GET /api/messages?offer_id=  — messages on an accepted quote (participants only).
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

// POST /api/messages  { offer_id, body }  — post a message (participants only).
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

// GET /api/advisor/offers  (active advisor) — the advisor's own submitted quotes.
export async function handleListOffers(request, env) {
  const user = await getCurrentUser(request, env);
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (user.role !== 'advisor') return json({ error: 'forbidden' }, 403);
  if (user.status !== 'active') return json({ error: 'pending_approval' }, 403);

  const rows = await listQuoteOffersByAdvisor(env.DB, user.id, 300);
  const offers = rows.map((r) => ({
    id: r.id,
    quote_request_id: r.quote_request_id,
    price: r.price,
    specials: r.specials,
    additional_info: r.additional_info,
    status: r.status,
    created_at: r.created_at,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    client_first: r.client_first,
    client_last: r.client_last,
    client_email: r.client_email,
  }));
  const unread = await getUnreadCounts(env.DB, user.id, offers.map((o) => o.id));
  for (const o of offers) o.unread = unread[o.id] || 0;
  return json({ offers, count: offers.length }, 200);
}

// GET /api/quotes  (authenticated advisor) — list all leads.
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
  const rows = await listAllRequests(env.DB, 300);
  const leads = rows.map((r) => ({
    id: r.id,
    created_at: r.created_at,
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    phone: r.phone,
    sailing_name: r.sailing_name,
    cruise_line: r.cruise_line,
    ship: r.ship,
    sailing_dates: r.sailing_dates,
    departure_port: r.departure_port,
    destination: r.destination,
    notes: r.notes,
    itinerary: safeParse(r.itinerary),
    offer_count: r.offer_count || 0,
    closed: (r.accepted_count || 0) > 0,
  }));
  return json({ leads, count: leads.length }, 200);
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
