-- CruiseShoppers: agencies with multiple advisor "seats". An agency has an
-- owner (an advisor) who can see every seat's quotes; each seat sees only its
-- own. Apply in the D1 Console, or:
--   npx wrangler d1 migrations apply cruiseshoppers --remote

CREATE TABLE IF NOT EXISTS agencies (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  owner_user_id  TEXT,
  phone          TEXT,
  website        TEXT,
  location       TEXT,
  created_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agencies_owner ON agencies (owner_user_id);

-- Link users to an agency and their role within it.
ALTER TABLE users ADD COLUMN agency_id TEXT;      -- FK to agencies.id
ALTER TABLE users ADD COLUMN agency_role TEXT;    -- 'owner' | 'seat'
