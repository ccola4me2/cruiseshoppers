-- CruiseShoppers: store the business details an advisor submits at application.
-- Apply in the D1 Console (paste and Execute), or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

-- JSON blob: { agency, website, location, credential, experience, source }.
ALTER TABLE users ADD COLUMN advisor_profile TEXT;
