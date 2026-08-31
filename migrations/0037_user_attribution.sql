-- 0037_user_attribution.sql
-- Store where a client came from (first-touch UTM / referrer) on their user
-- record at signup, so the admin can see the source of a signup even before the
-- client submits their first quote request. JSON string, same shape as
-- quote_requests.attribution.
ALTER TABLE users ADD COLUMN attribution TEXT;
