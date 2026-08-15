// Thin D1 query helpers. All timestamps are epoch milliseconds.

export async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function createUser(db, user) {
  const now = Date.now();
  const role = user.role === 'advisor' ? 'advisor' : 'client';
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
  return { ...q, status: 'new', created_at: now };
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
    .prepare("UPDATE quote_offers SET status = 'declined' WHERE quote_request_id = ? AND id != ? AND status = 'submitted'")
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
                r.sailing_name, r.cruise_line, r.ship, r.sailing_dates, r.departure_port, r.destination
         FROM quote_offers o
         JOIN quote_requests r ON r.id = o.quote_request_id
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
