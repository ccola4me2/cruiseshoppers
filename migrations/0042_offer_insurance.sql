-- 0042_offer_insurance.sql
-- Lets an advisor quote a cruise-insurance price on their offer when the client
-- asked for insurance. Shown with the quote to the client.
ALTER TABLE quote_offers ADD COLUMN insurance_amount REAL;
