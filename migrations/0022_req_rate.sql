-- 0022_req_rate.sql
-- Lightweight per-key request rate limiting. Used by the public search endpoint
-- as a backstop against automated abuse of the metered cruise catalogue.
-- The application degrades open if this table is absent, so applying it is safe
-- to do at any time.
CREATE TABLE IF NOT EXISTS req_rate (
  k        TEXT PRIMARY KEY,
  count    INTEGER NOT NULL DEFAULT 0,
  reset_at INTEGER NOT NULL
);
