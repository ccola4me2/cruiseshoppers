-- Cruise Shoppers: client reviews of advisors. A client may review an advisor
-- once they've accepted that advisor's quote. One review per client+advisor
-- (updatable). Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS advisor_reviews (
  id          TEXT PRIMARY KEY,
  advisor_id  TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  offer_id    TEXT,                              -- the accepted offer it relates to
  rating      INTEGER NOT NULL,                  -- 1..5
  comment     TEXT,
  status      TEXT NOT NULL DEFAULT 'visible',   -- visible | hidden
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER,
  UNIQUE (client_id, advisor_id)
);
CREATE INDEX IF NOT EXISTS idx_reviews_advisor ON advisor_reviews (advisor_id);
CREATE INDEX IF NOT EXISTS idx_reviews_client ON advisor_reviews (client_id);
