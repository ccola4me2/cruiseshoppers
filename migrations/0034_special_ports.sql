-- 0034_special_ports.sql
-- Store the departure port and destination/region on a special so the quote
-- request page (and the advisor lead) can show full sailing details, not just
-- the ship + dates. Both are optional free text captured from the catalog pick
-- (or typed for a manual special).
ALTER TABLE specials ADD COLUMN departure_port TEXT;
ALTER TABLE specials ADD COLUMN destination TEXT;
