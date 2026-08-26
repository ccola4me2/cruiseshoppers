-- 0031_sailings_catalog.sql
-- Local copy of the CruiseFeed sailings catalog. A scheduled import fills this
-- from the CruiseFeed bulk export so searches, pickers, and ship-date lookups
-- read from our own database instead of a metered API call per search.
--
-- ship_norm / line_norm are lowercased, alphanumeric-only forms used for robust
-- matching against the names the dropdowns send (spelling/spacing variants).

CREATE TABLE IF NOT EXISTS sailings (
  id              TEXT PRIMARY KEY,   -- CruiseFeed cruise id (cru_...)
  cruise_line     TEXT,
  ship            TEXT,               -- ship_name as CruiseFeed returns it
  ship_norm       TEXT,
  line_norm       TEXT,
  name            TEXT,               -- itinerary title
  depart_date     TEXT,               -- YYYY-MM-DD
  return_date     TEXT,
  nights          INTEGER,
  departure_port  TEXT,
  disembark_port  TEXT,
  destination     TEXT,               -- region
  round_trip      INTEGER,
  price_amount    REAL,
  price_currency  TEXT,
  updated_at      INTEGER             -- import timestamp (ms)
);

CREATE INDEX IF NOT EXISTS idx_sailings_ship_norm ON sailings (ship_norm, depart_date);
CREATE INDEX IF NOT EXISTS idx_sailings_line_norm ON sailings (line_norm);
CREATE INDEX IF NOT EXISTS idx_sailings_depart ON sailings (depart_date);

-- Small key/value store for import progress: the paging cursor, the snapshot
-- date last imported (x-data-as-of), row counts, and last-run timestamps.
CREATE TABLE IF NOT EXISTS catalog_import_state (
  k TEXT PRIMARY KEY,
  v TEXT
);
