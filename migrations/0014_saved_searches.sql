-- Cruise Shoppers: clients save searches and (optionally) get alerted when a
-- new matching special is posted. Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS saved_searches (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL,
  name         TEXT,
  criteria     TEXT,                            -- JSON of the search filters
  cruise_line  TEXT,                            -- extracted for alert matching
  alerts       INTEGER NOT NULL DEFAULT 0,      -- 1 = email me on matching specials
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_searches (user_id);
CREATE INDEX IF NOT EXISTS idx_saved_alerts ON saved_searches (alerts);
