-- 0025_special_depart_date.sql
-- Optional exact departure date (YYYY-MM-DD) for a special, so it can be matched
-- to one specific catalog sailing (ship + date) instead of just the ship.
-- The app writes it with a graceful fallback, so applying this is safe anytime.
ALTER TABLE specials ADD COLUMN depart_date TEXT;
