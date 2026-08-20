-- Cruise Shoppers: support quoting a fare per requested cabin type. The client's
-- selected cabin types are stored on the request (JSON array), and each advisor
-- quote can carry a fare per cabin type (JSON array of {type, fare}). The client
-- comparison chart then shows one row per cabin type and flags the lowest fare in
-- each row. Both optional/additive.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_requests ADD COLUMN cabin_types TEXT;
ALTER TABLE quote_offers ADD COLUMN cabin_fares TEXT;
