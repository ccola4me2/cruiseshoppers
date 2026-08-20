-- Cruise Shoppers: structured price breakdown on advisor quotes, so the client
-- My Quotes comparison chart can compute a true net value ("Best value") across
-- offers instead of only comparing free-text prices. All fields are optional;
-- the free-text `price` column stays as the headline/summary.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN base_fare REAL;
ALTER TABLE quote_offers ADD COLUMN taxes_fees REAL;
ALTER TABLE quote_offers ADD COLUMN obc_amount REAL;
ALTER TABLE quote_offers ADD COLUMN gratuities_included INTEGER;
