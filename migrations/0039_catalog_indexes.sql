-- 0039_catalog_indexes.sql
-- Extra indexes on the sailings catalog so the browse filters and facet lists
-- (destination, departure port, cruise line, ships-by-line) use an index scan
-- instead of reading all ~75k rows. Complements the ship_norm / line_norm /
-- depart_date indexes from 0031. Index-only: no code change needed.
CREATE INDEX IF NOT EXISTS idx_sailings_destination ON sailings (destination, depart_date);
CREATE INDEX IF NOT EXISTS idx_sailings_embark      ON sailings (departure_port, depart_date);
CREATE INDEX IF NOT EXISTS idx_sailings_cruise_line ON sailings (cruise_line, depart_date);
CREATE INDEX IF NOT EXISTS idx_sailings_line_ship   ON sailings (line_norm, ship);
