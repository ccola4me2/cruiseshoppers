-- 0040_offer_cabin.sql
-- Let an advisor specify, on their quote, which cabin category they're pricing
-- (Interior / Ocean View / Balcony / Suite) and the specific stateroom category
-- code (e.g. "4B", "BB"). Shown to the client with the quote.
ALTER TABLE quote_offers ADD COLUMN cabin_category TEXT;
ALTER TABLE quote_offers ADD COLUMN cabin_code TEXT;
