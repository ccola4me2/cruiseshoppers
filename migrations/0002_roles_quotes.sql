-- CruiseShoppers: add user roles + store quote requests (leads) for advisors.
-- Apply in the D1 Console (paste and Execute), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

-- Role on each account: 'client' (default) or 'advisor'.
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'client';

-- Quote requests submitted by clients; visible to advisors as leads.
CREATE TABLE IF NOT EXISTS quote_requests (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  first_name     TEXT,
  last_name      TEXT,
  email          TEXT,
  phone          TEXT,
  sailing_name   TEXT,
  cruise_line    TEXT,
  ship           TEXT,
  sailing_dates  TEXT,
  departure_port TEXT,
  destination    TEXT,
  itinerary      TEXT,          -- JSON string of the day-by-day itinerary
  notes          TEXT,          -- optional message from the client
  status         TEXT NOT NULL DEFAULT 'new',
  created_at     INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_quotes_created ON quote_requests (created_at);
CREATE INDEX IF NOT EXISTS idx_quotes_user ON quote_requests (user_id);
