-- 0023_offer_archive.sql
-- Lets admins archive (soft-hide) an advisor quote from the admin Quotes view.
-- archived_at is null for active quotes, or a timestamp (ms) when archived.
-- The app degrades gracefully if this column is absent, so it is safe to apply
-- at any time.
ALTER TABLE quote_offers ADD COLUMN archived_at INTEGER;
