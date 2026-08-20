-- Cruise Shoppers: extend the structured quote with payment terms — deposit due
-- now and the final-payment (paid-in-full) date — so the client comparison chart
-- can show them side by side. Both optional; additive columns.
-- Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_offers ADD COLUMN deposit_amount REAL;
ALTER TABLE quote_offers ADD COLUMN final_payment_date TEXT;
