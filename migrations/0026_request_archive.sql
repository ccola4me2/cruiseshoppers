-- Admin archive for client quote requests (leads).
-- archived_at is null for active requests, or a timestamp (ms) when archived.
ALTER TABLE quote_requests ADD COLUMN archived_at INTEGER;
