-- Optional expiration date for a special (YYYY-MM-DD). When set and past, the
-- special auto-drops off the client listings; null means no expiry.
ALTER TABLE specials ADD COLUMN expires_on TEXT;
