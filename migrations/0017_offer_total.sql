-- Cruise Shoppers: numeric all-in Total price on a quote. This is the headline
-- amount (fare, taxes, fees, gratuities all included) and the basis for the
-- comparison chart's Best-value ranking (Total price minus onboard credit).
-- The existing free-text `price` column is kept in sync for display/back-compat.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN total_price REAL;
