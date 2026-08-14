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
  const profile = user.advisor_profile ? JSON.stringify(user.advisor_profile) : null;
  try {
    await db
      .prepare(
        `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, role, advisor_profile, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        now,
        now
      )
      .run();
  } catch (err) {
    // Fallback if migration 0003 (advisor_profile column) hasn't been applied yet,
    // so account creation never breaks.
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
  return { ...user, role, created_at: now, updated_at: now };
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
