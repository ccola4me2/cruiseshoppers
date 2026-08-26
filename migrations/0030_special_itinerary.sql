-- 0030_special_itinerary.sql
-- Free-text itinerary for a special entered manually (e.g. "4-Night Bahamas from
-- Tampa"), used when the chosen ship has no departures in the CruiseFeed catalog
-- so the advisor types the sailing details themselves.
-- The app writes it with a graceful fallback, so applying this is safe anytime.
ALTER TABLE specials ADD COLUMN itinerary TEXT;
