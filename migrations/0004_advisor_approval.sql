-- CruiseShoppers: advisor approval gate.
-- New advisors start 'pending' and cannot see leads until an admin approves.
-- Apply in the D1 Console (paste and Execute), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

-- Account status: 'active' (default, all existing users + clients),
-- 'pending' (advisor awaiting approval), or 'declined'.
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
