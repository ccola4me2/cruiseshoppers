-- 0032_user_location.sql
-- Client's location (US state, or "Other / Outside the U.S.") captured at signup,
-- so advisors have a sense of where a shopper is. Written with a graceful
-- fallback, so applying this is safe anytime.
ALTER TABLE users ADD COLUMN location TEXT;
