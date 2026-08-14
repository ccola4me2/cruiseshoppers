-- CruiseShoppers: record each account's most recent log-in.
-- Apply in the D1 Console (paste and Execute), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

-- Epoch-ms timestamp of the last successful login; NULL until they log in.
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
