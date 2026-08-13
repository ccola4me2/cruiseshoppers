// Thin D1 query helpers. All timestamps are epoch milliseconds.

export async function findUserByEmail(db, email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
}

export async function findUserById(db, id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
}

export async function createUser(db, user) {
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, phone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      user.id,
      user.email,
      user.password_hash,
      user.first_name || null,
      user.last_name || null,
      user.phone || null,
      now,
      now
    )
    .run();
  return { ...user, created_at: now, updated_at: now };
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
