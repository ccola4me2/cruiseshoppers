-- CruiseShoppers: advisor contact details on a quote offer, so the client's
-- "quote is ready" email can show how to reach the advisor directly.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN advisor_phone TEXT;   -- direct phone / SMS
ALTER TABLE quote_offers ADD COLUMN advisor_hours TEXT;   -- available hours
