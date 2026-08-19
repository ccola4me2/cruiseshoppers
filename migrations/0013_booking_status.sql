-- Cruise Shoppers: booking close-out. After a client accepts a quote, the
-- advisor marks the outcome (booked / not booked) so leads convert to a final
-- state and win-rate can be measured. Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN booking_status TEXT;   -- booked | not_booked
ALTER TABLE quote_offers ADD COLUMN booking_amount TEXT;   -- optional total booked
ALTER TABLE quote_offers ADD COLUMN booking_ref TEXT;      -- optional confirmation number
ALTER TABLE quote_offers ADD COLUMN booking_at INTEGER;    -- when it was marked
