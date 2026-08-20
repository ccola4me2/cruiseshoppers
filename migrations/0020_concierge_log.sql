-- Cruise Shoppers: log each Neptune (AI concierge) search so the admin can watch
-- usage and cache/skip rates against CruiseFeed's metered plan. Best-effort log;
-- absence never blocks search.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS concierge_log (
  id           TEXT PRIMARY KEY,
  user_id      TEXT,
  created_at   INTEGER NOT NULL,
  q            TEXT,
  cached       INTEGER DEFAULT 0,
  ai_skipped   INTEGER DEFAULT 0,
  result_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_concierge_log_created ON concierge_log (created_at);
