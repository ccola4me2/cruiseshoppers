-- 0024_special_cabin_category.sql
-- Adds a cabin category (e.g. "Oceanview Balcony", "Interior", "Suite") to a
-- special so it can be shown as its own field on the deal card. The app writes
-- it with a graceful fallback, so applying this is safe at any time.
ALTER TABLE specials ADD COLUMN cabin_category TEXT;
