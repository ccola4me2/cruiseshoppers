-- 0045_request_info.sql
-- Lets an advisor ask a client for more information on a request before quoting
-- (relayed by the platform, no contact details exchanged). Stores the latest
-- pending question; the client's reply is appended to the request notes and the
-- question is cleared. Optional/additive.
-- Apply in the D1 Console (cruiseshoppers database), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

ALTER TABLE quote_requests ADD COLUMN info_request TEXT;
ALTER TABLE quote_requests ADD COLUMN info_request_advisor_id TEXT;
ALTER TABLE quote_requests ADD COLUMN info_request_at INTEGER;
