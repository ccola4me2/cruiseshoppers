-- CruiseShoppers: per-user last-read time per thread, for unread badges.
-- Apply in the D1 Console, or:  npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS message_reads (
  offer_id     TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  last_read_at INTEGER NOT NULL,
  PRIMARY KEY (offer_id, user_id)
);
