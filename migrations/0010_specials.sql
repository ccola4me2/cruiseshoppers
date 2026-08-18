-- CruiseShoppers: advisor-posted "specials" (highlighted deals) that clients
-- can browse. A quote request made on a special is routed only to the advisor
-- who posted it (target_advisor_id).
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS specials (
  id              TEXT PRIMARY KEY,
  advisor_id      TEXT NOT NULL,
  cruise_line     TEXT,
  ship            TEXT,
  headline        TEXT NOT NULL,
  description     TEXT,
  sail_dates      TEXT,          -- free-text sail date(s)
  rate_from       TEXT,          -- "rates from" price per person
  brochure_price  TEXT,          -- optional compare-at price
  us_canada_only  INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'active',   -- active | off
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER,
  FOREIGN KEY (advisor_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_specials_advisor ON specials (advisor_id);
CREATE INDEX IF NOT EXISTS idx_specials_status ON specials (status);

-- A quote request can originate from a special; if so it is routed to just
-- the posting advisor.
ALTER TABLE quote_requests ADD COLUMN special_id TEXT;
ALTER TABLE quote_requests ADD COLUMN target_advisor_id TEXT;
