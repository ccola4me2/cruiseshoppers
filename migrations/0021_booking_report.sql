-- Cruise Shoppers: richer booking report on an accepted offer (CruiseCompete-style
-- commission tracking). booking_status / booking_amount / booking_ref / booking_at
-- already exist (0013). These add the reporting detail. All optional/additive.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN booking_passengers  TEXT;
ALTER TABLE quote_offers ADD COLUMN booking_invoice      TEXT;
ALTER TABLE quote_offers ADD COLUMN booking_fare_type    TEXT;
ALTER TABLE quote_offers ADD COLUMN booking_cruise_fare  REAL;
ALTER TABLE quote_offers ADD COLUMN booking_addons_high  REAL;
ALTER TABLE quote_offers ADD COLUMN booking_addons_low   REAL;
