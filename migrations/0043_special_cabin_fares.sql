-- 0043_special_cabin_fares.sql
-- Let an advisor list multiple cabin categories with a price on a special
-- (like a quote's per-cabin line items). JSON array of { type, code, fare }.
-- Optional/additive; the code degrades gracefully until this is applied.
-- Apply in the D1 Console (cruiseshoppers database), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE specials ADD COLUMN cabin_fares TEXT;
