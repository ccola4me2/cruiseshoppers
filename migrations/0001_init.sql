-- CruiseShoppers initial schema.
-- Apply with either:
--   npx wrangler d1 migrations apply cruiseshoppers --remote
-- or by pasting this file into the D1 "Console" tab in the Cloudflare dashboard.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,           -- format: pbkdf2$<iterations>$<salt_b64>$<hash_b64>
  first_name    TEXT,
  last_name     TEXT,
  phone         TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

-- Case-insensitive email lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users (email);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,           -- sha256(session token) hex; the raw token lives only in the cookie
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id         TEXT PRIMARY KEY,           -- sha256(reset token) hex
  user_id    TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used       INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_reset_user ON password_reset_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_reset_expires ON password_reset_tokens (expires_at);
