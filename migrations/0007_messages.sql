-- CruiseShoppers: client <-> advisor messages on an accepted quote.
-- Apply in the D1 Console, or:  npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS messages (
  id           TEXT PRIMARY KEY,
  offer_id     TEXT NOT NULL,
  sender_id    TEXT NOT NULL,
  sender_role  TEXT NOT NULL,        -- 'client' or 'advisor'
  sender_name  TEXT,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  FOREIGN KEY (offer_id) REFERENCES quote_offers (id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_messages_offer ON messages (offer_id, created_at);
