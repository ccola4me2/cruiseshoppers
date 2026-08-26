-- 0029_special_all_dates.sql
-- Lets an advisor post a special that covers EVERY departure of a chosen ship
-- (cruise line + ship, no single date) instead of one exact sailing. When set to
-- 1, depart_date is left null and the special badges all of that ship's sailings.
-- The app writes it with a graceful fallback, so applying this is safe anytime.
ALTER TABLE specials ADD COLUMN all_dates INTEGER DEFAULT 0;
