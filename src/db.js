// Thin D1 query helpers. All timestamps are epoch milliseconds.

export async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function createUser(db, user) {
  const now = Date.now();
  const role = ['advisor', 'admin'].includes(user.role) ? user.role : 'client';
  const status = user.status === 'pending' ? 'pending' : 'active';
  const profile = user.advisor_profile ? JSON.stringify(user.advisor_profile) : null;
  try {
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, advisor_profile, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user.id,
        user.email,
        user.password_hash,
        user.first_name || null,
        user.last_name || null,
        user.phone || null,
        role,
        profile,
        status,
        now,
        now
      )
      .run();
  } catch (err) {
    // Fallback if migrations 0003 (advisor_profile) / 0004 (status) haven't been
    // applied yet, so account creation never breaks.
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        user.id,
        user.email,
        user.password_hash,
        user.first_name || null,
        user.last_name || null,
        user.phone || null,
        role,
        now,
        now
      )
      .run();
  }
  return { ...user, role, status, created_at: now, updated_at: now };
}

// --- Saved searches + alerts ---
export async function createSavedSearch(db, s) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO saved_searches (id, user_id, name, criteria, cruise_line, alerts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(s.id, s.user_id, s.name || null, s.criteria || null, s.cruise_line || null, s.alerts ? 1 : 0, now)
    .run();
  return { ...s, created_at: now };
}

export async function listSavedSearches(db, userId, limit = 50) {
  try {
    const res = await db
      .prepare('SELECT * FROM saved_searches WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(userId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

export async function deleteSavedSearch(db, id, userId) {
  await db.prepare('DELETE FROM saved_searches WHERE id = ? AND user_id = ?').bind(id, userId).run();
}

// Clients with an alert saved-search matching a cruise line (for new specials).
export async function listAlertRecipientsForCruiseLine(db, cruiseLine) {
  if (!cruiseLine) return [];
  try {
    const res = await db
      .prepare(
        `SELECT DISTINCT s.name AS search_name, u.email, u.first_name
         FROM saved_searches s JOIN users u ON u.id = s.user_id
         WHERE s.alerts = 1 AND s.cruise_line IS NOT NULL
           AND LOWER(s.cruise_line) = LOWER(?) AND u.email IS NOT NULL`
      )
      .bind(cruiseLine)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// --- Agencies (multi-seat advisor organizations) ---
export async function createAgency(db, a) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO agencies (id, name, owner_user_id, phone, website, location, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(a.id, a.name, a.owner_user_id || null, a.phone || null, a.website || null, a.location || null, now)
    .run();
  return { ...a, created_at: now };
}

export async function findAgencyById(db, id) {
  try {
    return await db.prepare('SELECT * FROM agencies WHERE id = ?').bind(id).first();
  } catch (_) {
    return null;
  }
}

export async function setUserAgency(db, userId, agencyId, agencyRole) {
  await db
    .prepare('UPDATE users SET agency_id = ?, agency_role = ?, updated_at = ? WHERE id = ?')
    .bind(agencyId || null, agencyRole || null, Date.now(), userId)
    .run();
}

// Advisors (owner + seats) belonging to an agency.
export async function listAgencyAdvisors(db, agencyId, limit = 200) {
  try {
    const res = await db
      .prepare("SELECT * FROM users WHERE agency_id = ? AND role = 'advisor' ORDER BY created_at ASC LIMIT ?")
      .bind(agencyId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// All offers submitted by any advisor in the agency (owner view).
export async function listAgencyOffers(db, agencyId, limit = 500) {
  try {
    const res = await db
      .prepare(
        `SELECT o.*,
                r.sailing_name, r.cruise_line, r.ship, r.sailing_dates, r.departure_port, r.destination,
                r.first_name AS client_first, r.last_name AS client_last, r.email AS client_email,
                u.first_name AS advisor_first, u.last_name AS advisor_last
         FROM quote_offers o
         LEFT JOIN quote_requests r ON r.id = o.quote_request_id
         LEFT JOIN users u ON u.id = o.advisor_id
         WHERE u.agency_id = ?
         ORDER BY o.created_at DESC
         LIMIT ?`
      )
      .bind(agencyId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// --- Advisor reviews / ratings ---
export async function upsertReview(db, r) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO advisor_reviews (id, advisor_id, client_id, offer_id, rating, comment, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'visible', ?, ?)
       ON CONFLICT (client_id, advisor_id) DO UPDATE SET
         rating = excluded.rating, comment = excluded.comment, offer_id = excluded.offer_id, updated_at = excluded.updated_at`
    )
    .bind(r.id, r.advisor_id, r.client_id, r.offer_id || null, r.rating, r.comment || null, now, now)
    .run();
}

export async function getReviewByClientAdvisor(db, clientId, advisorId) {
  try {
    return await db
      .prepare('SELECT * FROM advisor_reviews WHERE client_id = ? AND advisor_id = ?')
      .bind(clientId, advisorId)
      .first();
  } catch (_) {
    return null;
  }
}

export async function listReviewsByAdvisor(db, advisorId, limit = 100) {
  try {
    const res = await db
      .prepare("SELECT * FROM advisor_reviews WHERE advisor_id = ? AND status = 'visible' ORDER BY created_at DESC LIMIT ?")
      .bind(advisorId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// Average rating + count for a set of advisor ids: { [id]: {avg, count} }.
export async function getAdvisorRatings(db, advisorIds) {
  const ids = [...new Set((advisorIds || []).filter(Boolean))];
  if (!ids.length) return {};
  try {
    const placeholders = ids.map(() => '?').join(',');
    const res = await db
      .prepare(
        `SELECT advisor_id, AVG(rating) AS avg, COUNT(*) AS count
         FROM advisor_reviews WHERE status = 'visible' AND advisor_id IN (${placeholders})
         GROUP BY advisor_id`
      )
      .bind(...ids)
      .all();
    const out = {};
    for (const row of res.results || []) {
      out[row.advisor_id] = { avg: Math.round(Number(row.avg) * 10) / 10, count: Number(row.count) };
    }
    return out;
  } catch (_) {
    return {};
  }
}

export async function setReviewStatus(db, id, status) {
  await db.prepare('UPDATE advisor_reviews SET status = ?, updated_at = ? WHERE id = ?').bind(status, Date.now(), id).run();
}

export async function listAllReviews(db, limit = 300) {
  try {
    const res = await db
      .prepare(
        `SELECT rv.*, a.first_name AS advisor_first, a.last_name AS advisor_last,
                c.first_name AS client_first, c.last_name AS client_last
         FROM advisor_reviews rv
         LEFT JOIN users a ON a.id = rv.advisor_id
         LEFT JOIN users c ON c.id = rv.client_id
         ORDER BY rv.created_at DESC LIMIT ?`
      )
      .bind(limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// --- Advisor administration ---
export async function listAdvisors(db, limit = 500) {
  const res = await db
    .prepare("SELECT * FROM users WHERE role = 'advisor' ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all();
  return res.results || [];
}

// Emails of all approved advisors (for new-request notifications).
export async function listActiveAdvisorEmails(db) {
  const res = await db
    .prepare("SELECT email FROM users WHERE role = 'advisor' AND status = 'active' AND email IS NOT NULL")
    .all();
  return (res.results || []).map((r) => r.email).filter(Boolean);
}

// Admin accounts: DB role 'admin' or email listed in ADMIN_EMAILS.
export async function listAdmins(db, emails) {
  const list = (emails || []).map((e) => String(e).toLowerCase().trim()).filter(Boolean);
  let sql = "SELECT * FROM users WHERE role = 'admin'";
  const binds = [];
  if (list.length) {
    sql += ` OR lower(email) IN (${list.map(() => '?').join(',')})`;
    binds.push(...list);
  }
  sql += ' ORDER BY created_at DESC';
  const res = await db.prepare(sql).bind(...binds).all();
  return res.results || [];
}

export async function setUserStatus(db, id, status) {
  await db
    .prepare('UPDATE users SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, Date.now(), id)
    .run();
}

// List client accounts with a count of the quote requests each has submitted.
// SELECT * tolerates the last_login_at column being absent (pre-migration 0005).
export async function listClients(db, limit = 1000) {
  const res = await db
    .prepare(
      `SELECT u.*,
              (SELECT COUNT(*) FROM quote_requests q WHERE q.user_id = u.id) AS quote_count
       FROM users u
       WHERE u.role = 'client' OR u.role IS NULL
       ORDER BY u.created_at DESC
       LIMIT ?`
    )
    .bind(limit)
    .all();
  return res.results || [];
}

export async function setLastLogin(db, id) {
  await db
    .prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
    .bind(Date.now(), id)
    .run();
}

// Hard-delete a user. Remove dependent rows explicitly (don't rely on D1
// honoring ON DELETE CASCADE), atomically via a batch.
export async function deleteUser(db, id) {
  await db.batch([
    db.prepare('DELETE FROM quote_requests WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ?').bind(id),
    db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
}

// --- Quote requests (leads) ---
export async function createQuoteRequest(db, q) {
  const now = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO quote_requests
           (id, user_id, first_name, last_name, email, phone, sailing_name, cruise_line, ship,
            sailing_dates, departure_port, destination, itinerary, notes, special_id, target_advisor_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .bind(
        q.id, q.user_id, q.first_name || null, q.last_name || null, q.email || null, q.phone || null,
        q.sailing_name || null, q.cruise_line || null, q.ship || null, q.sailing_dates || null,
        q.departure_port || null, q.destination || null, q.itinerary || null, q.notes || null,
        q.special_id || null, q.target_advisor_id || null, now
      )
      .run();
  } catch {
    // Fallback if migration 0010 (special_id / target_advisor_id) isn't applied yet.
    await db
      .prepare(
        `INSERT INTO quote_requests
           (id, user_id, first_name, last_name, email, phone, sailing_name, cruise_line, ship,
            sailing_dates, departure_port, destination, itinerary, notes, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`
      )
      .bind(
        q.id, q.user_id, q.first_name || null, q.last_name || null, q.email || null, q.phone || null,
        q.sailing_name || null, q.cruise_line || null, q.ship || null, q.sailing_dates || null,
        q.departure_port || null, q.destination || null, q.itinerary || null, q.notes || null, now
      )
      .run();
  }
  return { ...q, status: 'new', created_at: now };
}

// --- Advisor specials (highlighted deals clients can browse) ---
export async function createSpecial(db, s) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO specials
         (id, advisor_id, cruise_line, ship, headline, description, sail_dates, rate_from, brochure_price, us_canada_only, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    )
    .bind(
      s.id, s.advisor_id, s.cruise_line || null, s.ship || null, s.headline, s.description || null,
      s.sail_dates || null, s.rate_from || null, s.brochure_price || null, s.us_canada_only ? 1 : 0, now, now
    )
    .run();
  return { ...s, status: 'active', created_at: now };
}

export async function listSpecialsByAdvisor(db, advisorId, limit = 200) {
  try {
    const res = await db
      .prepare('SELECT * FROM specials WHERE advisor_id = ? ORDER BY created_at DESC LIMIT ?')
      .bind(advisorId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// Active specials from active advisors, with the advisor's name/agency for display.
export async function listActiveSpecials(db, limit = 100) {
  try {
    const res = await db
      .prepare(
        `SELECT s.*, u.first_name AS advisor_first, u.last_name AS advisor_last,
                u.advisor_profile AS advisor_profile_json
         FROM specials s
         LEFT JOIN users u ON u.id = s.advisor_id
         WHERE s.status = 'active' AND (u.status IS NULL OR u.status = 'active')
         ORDER BY s.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

export async function findSpecialById(db, id) {
  try {
    return await db.prepare('SELECT * FROM specials WHERE id = ?').bind(id).first();
  } catch (_) {
    return null;
  }
}

export async function updateSpecial(db, id, advisorId, s) {
  await db
    .prepare(
      `UPDATE specials SET cruise_line = ?, ship = ?, headline = ?, description = ?, sail_dates = ?,
                           rate_from = ?, brochure_price = ?, us_canada_only = ?, updated_at = ?
       WHERE id = ? AND advisor_id = ?`
    )
    .bind(
      s.cruise_line || null, s.ship || null, s.headline, s.description || null, s.sail_dates || null,
      s.rate_from || null, s.brochure_price || null, s.us_canada_only ? 1 : 0, Date.now(), id, advisorId
    )
    .run();
}

export async function deleteSpecial(db, id, advisorId) {
  await db.prepare('DELETE FROM specials WHERE id = ? AND advisor_id = ?').bind(id, advisorId).run();
}

// Record the booking outcome on an advisor's accepted offer.
export async function setOfferBooking(db, offerId, advisorId, { status, amount, ref }) {
  await db
    .prepare(
      `UPDATE quote_offers SET booking_status = ?, booking_amount = ?, booking_ref = ?, booking_at = ?
       WHERE id = ? AND advisor_id = ? AND status = 'accepted'`
    )
    .bind(status || null, amount || null, ref || null, Date.now(), offerId, advisorId)
    .run();
}

export async function setSpecialStatus(db, id, advisorId, status) {
  await db
    .prepare('UPDATE specials SET status = ?, updated_at = ? WHERE id = ? AND advisor_id = ?')
    .bind(status, Date.now(), id, advisorId)
    .run();
}

export async function offAllSpecials(db, advisorId) {
  await db
    .prepare("UPDATE specials SET status = 'off', updated_at = ? WHERE advisor_id = ?")
    .bind(Date.now(), advisorId)
    .run();
}

export async function listQuoteRequests(db, limit = 200) {
  const res = await db
    .prepare('SELECT * FROM quote_requests ORDER BY created_at DESC LIMIT ?')
    .bind(limit)
    .all();
  return res.results || [];
}

export async function findQuoteRequestById(db, id) {
  return db.prepare('SELECT * FROM quote_requests WHERE id = ?').bind(id).first();
}

// All client requests (admin), with a count of offers and whether one accepted.
export async function listAllRequests(db, limit = 500) {
  try {
    const res = await db
      .prepare(
        `SELECT r.*,
                (SELECT COUNT(*) FROM quote_offers o WHERE o.quote_request_id = r.id) AS offer_count,
                (SELECT COUNT(*) FROM quote_offers o WHERE o.quote_request_id = r.id AND o.status = 'accepted') AS accepted_count
         FROM quote_requests r
         ORDER BY r.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all();
    return res.results || [];
  } catch (_) {
    // Fallback if quote_offers doesn't exist yet: return requests without counts.
    const res = await db
      .prepare('SELECT * FROM quote_requests ORDER BY created_at DESC LIMIT ?')
      .bind(limit)
      .all();
    return res.results || [];
  }
}

// A client's own submitted quote requests.
export async function listRequestsForClient(db, userId, limit = 200) {
  const res = await db
    .prepare('SELECT * FROM quote_requests WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .bind(userId, limit)
    .all();
  return res.results || [];
}

// --- Advisor quote offers (priced responses to a request) ---
export async function createQuoteOffer(db, o) {
  const now = Date.now();
  try {
    await db
      .prepare(
        `INSERT INTO quote_offers
           (id, quote_request_id, advisor_id, advisor_name, advisor_email, advisor_phone, advisor_hours, price, specials, additional_info, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`
      )
      .bind(
        o.id, o.quote_request_id, o.advisor_id, o.advisor_name || null, o.advisor_email || null,
        o.advisor_phone || null, o.advisor_hours || null,
        o.price || null, o.specials || null, o.additional_info || null, now
      )
      .run();
  } catch {
    // Fallback if migration 0009 (advisor_phone / advisor_hours) isn't applied yet.
    await db
      .prepare(
        `INSERT INTO quote_offers
           (id, quote_request_id, advisor_id, advisor_name, advisor_email, price, specials, additional_info, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`
      )
      .bind(
        o.id, o.quote_request_id, o.advisor_id, o.advisor_name || null, o.advisor_email || null,
        o.price || null, o.specials || null, o.additional_info || null, now
      )
      .run();
  }
  return { ...o, status: 'submitted', created_at: now };
}

// Every submitted offer (admin), joined to the request for context.
export async function listAllQuoteOffers(db, limit = 500) {
  try {
    const res = await db
      .prepare(
        `SELECT o.*,
                r.sailing_name, r.cruise_line, r.ship, r.sailing_dates, r.departure_port, r.destination,
                r.first_name AS client_first, r.last_name AS client_last, r.email AS client_email
         FROM quote_offers o
         LEFT JOIN quote_requests r ON r.id = o.quote_request_id
         ORDER BY o.created_at DESC
         LIMIT ?`
      )
      .bind(limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

export async function findOfferById(db, id) {
  return db.prepare('SELECT * FROM quote_offers WHERE id = ?').bind(id).first();
}

export async function updateOfferStatus(db, id, status) {
  await db.prepare('UPDATE quote_offers SET status = ? WHERE id = ?').bind(status, id).run();
}

// When a client accepts one offer, mark the others on the same request as not selected.
export async function declineSiblingOffers(db, requestId, keepOfferId) {
  await db
    .prepare("UPDATE quote_offers SET status = 'declined' WHERE quote_request_id = ? AND id != ? AND status != 'accepted'")
    .bind(requestId, keepOfferId)
    .run();
}

// --- Messages (client <-> advisor on an accepted quote) ---
export async function createMessage(db, m) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO messages (id, offer_id, sender_id, sender_role, sender_name, body, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(m.id, m.offer_id, m.sender_id, m.sender_role, m.sender_name || null, m.body, now)
    .run();
  return { ...m, created_at: now };
}

// Mark a thread read for a user (best-effort; no-op if table not migrated).
export async function setLastRead(db, offerId, userId, ts) {
  try {
    await db
      .prepare('INSERT OR REPLACE INTO message_reads (offer_id, user_id, last_read_at) VALUES (?, ?, ?)')
      .bind(offerId, userId, ts)
      .run();
  } catch (_) {}
}

// Map of offer_id -> count of messages from the OTHER party since the user last
// read that thread. Returns {} if the read-tracking table isn't migrated.
export async function getUnreadCounts(db, userId, offerIds) {
  if (!offerIds || !offerIds.length) return {};
  try {
    const ph = offerIds.map(() => '?').join(',');
    const res = await db
      .prepare(
        `SELECT m.offer_id AS oid, COUNT(*) AS c
         FROM messages m
         WHERE m.offer_id IN (${ph}) AND m.sender_id != ?
           AND m.created_at > COALESCE(
             (SELECT last_read_at FROM message_reads r WHERE r.offer_id = m.offer_id AND r.user_id = ?), 0)
         GROUP BY m.offer_id`
      )
      .bind(...offerIds, userId, userId)
      .all();
    const map = {};
    for (const row of res.results || []) map[row.oid] = row.c;
    return map;
  } catch (_) {
    return {};
  }
}

export async function listMessagesByOffer(db, offerId, limit = 500) {
  try {
    const res = await db
      .prepare('SELECT * FROM messages WHERE offer_id = ? ORDER BY created_at ASC LIMIT ?')
      .bind(offerId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// Offers on a given client's requests (for the client's "My quotes" page).
// Returns [] if the quote_offers table hasn't been created yet.
export async function listOffersForClient(db, userId, limit = 200) {
  try {
    const res = await db
      .prepare(
        `SELECT o.*,
                r.sailing_name, r.cruise_line, r.ship, r.sailing_dates, r.departure_port, r.destination,
                u.phone AS advisor_phone_live, u.advisor_profile AS advisor_profile_json
         FROM quote_offers o
         JOIN quote_requests r ON r.id = o.quote_request_id
         LEFT JOIN users u ON u.id = o.advisor_id
         WHERE r.user_id = ?
         ORDER BY o.created_at DESC
         LIMIT ?`
      )
      .bind(userId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

// Update a user's basic contact fields (used by the client profile page).
export async function updateUserBasic(db, userId, { first_name, last_name, phone }) {
  await db
    .prepare('UPDATE users SET first_name = ?, last_name = ?, phone = ?, updated_at = ? WHERE id = ?')
    .bind(first_name || null, last_name || null, phone || null, Date.now(), userId)
    .run();
}

// Update an advisor's editable profile fields. `profile` is the full
// advisor_profile object to persist (caller merges patches into it).
export async function updateAdvisorProfile(db, userId, { first_name, last_name, phone, profile }) {
  const now = Date.now();
  const profileJson = profile ? JSON.stringify(profile) : null;
  await db
    .prepare('UPDATE users SET first_name = ?, last_name = ?, phone = ?, advisor_profile = ?, updated_at = ? WHERE id = ?')
    .bind(first_name || null, last_name || null, phone || null, profileJson, now, userId)
    .run();
}

// An advisor's own submitted offers, joined to the request for context.
export async function listQuoteOffersByAdvisor(db, advisorId, limit = 300) {
  try {
    const res = await db
      .prepare(
        `SELECT o.*,
                r.sailing_name, r.cruise_line, r.ship, r.sailing_dates, r.departure_port, r.destination,
                r.first_name AS client_first, r.last_name AS client_last, r.email AS client_email
         FROM quote_offers o
         LEFT JOIN quote_requests r ON r.id = o.quote_request_id
         WHERE o.advisor_id = ?
         ORDER BY o.created_at DESC
         LIMIT ?`
      )
      .bind(advisorId, limit)
      .all();
    return res.results || [];
  } catch (_) {
    return [];
  }
}

export async function updateUserPassword(db, userId, passwordHash) {
  await db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(passwordHash, Date.now(), userId)
    .run();
}

// --- Sessions ---
export async function createSession(db, { id, userId, expiresAt }) {
  await db
    .prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(id, userId, Date.now(), expiresAt)
    .run();
}

export async function getSession(db, id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').bind(id).first();
}

export async function deleteSession(db, id) {
  await db.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

export async function deleteUserSessions(db, userId) {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

// --- Password reset tokens ---
export async function createResetToken(db, { id, userId, expiresAt }) {
  await db
    .prepare(
      'INSERT INTO password_reset_tokens (id, user_id, created_at, expires_at, used) VALUES (?, ?, ?, ?, 0)'
    )
    .bind(id, userId, Date.now(), expiresAt)
    .run();
}

export async function getResetToken(db, id) {
  return db.prepare('SELECT * FROM password_reset_tokens WHERE id = ?').bind(id).first();
}

export async function markResetTokenUsed(db, id) {
  await db.prepare('UPDATE password_reset_tokens SET used = 1 WHERE id = ?').bind(id).run();
}
