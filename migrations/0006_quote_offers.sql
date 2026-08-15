-- CruiseShoppers: advisor quote offers (an advisor's priced response to a
-- client's quote request). Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS quote_offers (
  id                TEXT PRIMARY KEY,
  quote_request_id  TEXT NOT NULL,
  advisor_id        TEXT NOT NULL,
  advisor_name      TEXT,
  advisor_email     TEXT,
  price             TEXT,
  specials          TEXT,          -- special offers on the sailing
  additional_info   TEXT,          -- anything else the advisor wants to add
  status            TEXT NOT NULL DEFAULT 'submitted',
  created_at        INTEGER NOT NULL,
  FOREIGN KEY (quote_request_id) REFERENCES quote_requests (id) ON DELETE CASCADE,
  FOREIGN KEY (advisor_id) REFERENCES users (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_offers_request ON quote_offers (quote_request_id);
CREATE INDEX IF NOT EXISTS idx_offers_advisor ON quote_offers (advisor_id);
