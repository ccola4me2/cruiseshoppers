-- Cruise Shoppers: per-user rate limiting for the Neptune AI concierge, so the
-- Workers AI + CruiseFeed usage stays bounded. Fixed hourly window per user.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS ai_rate (
  user_id  TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
