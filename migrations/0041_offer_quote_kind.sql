-- 0041_offer_quote_kind.sql
-- How the client should read a quote's cabin lines:
--   'options' = alternatives to compare (client picks one; no total)
--   'cabins'  = separate cabins that add up to a total
-- Null defaults to 'options'.
ALTER TABLE quote_offers ADD COLUMN quote_kind TEXT;
